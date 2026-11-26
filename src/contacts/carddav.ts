import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { all, one, run, tx } from '../lib/db.ts';
import { t } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { XmlError, child, children, escapeXml, parseXml, textOf, type XmlNode } from '../calendar/xml.ts';
import { calendarAllowed } from '../calendar/guard.ts';
import { basicAuth } from '../services/apppasswords.ts';
import { needsSecondFactor } from '../services/auth.ts';
import * as settings from '../services/settings.ts';
import { getUser, keyOf, type UserRow } from '../services/users.ts';
import {
  announceContacts,
  bookMembers,
  canAt,
  contactsAllowed,
  ensureBooks,
  getBook,
  insertBook,
  ownBooks,
  requireBook,
  touchBook,
  visibleBooks,
  deleteBook,
  type BookAccess,
  type BookRow,
} from './books.ts';
import { contactByHref, exportVcf, liveByUid, storeCard, trashContact, type ContactRow } from './store.ts';
import { parseVCards, uidOf, unescapeValue, type VCard } from './vcard.ts';

const D = 'DAV:';
const CARD = 'urn:ietf:params:xml:ns:carddav';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const CS = 'http://calendarserver.org/ns/';
const PREFIXES: Record<string, string> = { [D]: 'd', [CARD]: 'card', [CAL]: 'cal', [CS]: 'cs' };
const ROOT = '/carddav';
const READ_METHODS = new Set(['OPTIONS', 'GET', 'HEAD', 'PROPFIND', 'REPORT']);
const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCOL';
const DAV_HEADER = '1, 3, addressbook, extended-mkcol';
const SYNC = 'http://moecloud.moestudio.net/ns/contacts-sync/';
const MAX_SIZE = 5 * 1024 * 1024;

type Kind = 'root' | 'principals' | 'principal' | 'addressbooks' | 'home' | 'book' | 'object';

interface Resource {
  kind: Kind;
  href: string;
  book?: BookRow;
  access?: BookAccess;
  object?: ContactRow | null;
  name?: string;
}

const enc = (value: string) => encodeURIComponent(value).replace(/%40/g, '@');

export const cardPrincipalHref = (user: UserRow) => `${ROOT}/principals/${enc(user.username)}/`;
export const cardHomeHref = (user: UserRow) => `${ROOT}/addressbooks/${enc(user.username)}/`;
const slugFor = (viewer: UserRow, book: BookRow) => (book.owner_id === viewer.id ? book.slug : `s-${book.id}`);
const bookHref = (viewer: UserRow, book: BookRow) => `${cardHomeHref(viewer)}${enc(slugFor(viewer, book))}/`;
const objectHref = (viewer: UserRow, book: BookRow, href: string) => `${bookHref(viewer, book)}${enc(href)}`;

function segmentsOf(url: string): string[] | null {
  const path = url.split('?')[0];
  if (!path.startsWith(ROOT)) return null;
  try {
    return path
      .slice(ROOT.length)
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function bookBySlug(viewer: UserRow, slug: string) {
  if (slug.startsWith('s-')) {
    const book = getBook(slug.slice(2));
    if (book && book.owner_id !== viewer.id) {
      try {
        return requireBook(viewer, book.id, 'read');
      } catch {
        return null;
      }
    }
  }
  const own = one<BookRow>('SELECT * FROM address_books WHERE owner_id = ? AND slug = ?', viewer.id, slug);
  return own ? { book: own, access: 'owner' as BookAccess } : null;
}

function liveObject(book: BookRow, href: string) {
  const row = contactByHref(book.id, href);
  return row && !row.trashed_at ? row : null;
}

function resolve(viewer: UserRow, segments: string[]): Resource | 'forbidden' | null {
  if (!segments.length) return { kind: 'root', href: `${ROOT}/` };
  if (segments[0] === 'principals') {
    if (segments.length === 1) return { kind: 'principals', href: `${ROOT}/principals/` };
    if (keyOf(segments[1]) !== viewer.username_key) return 'forbidden';
    if (segments.length === 2) return { kind: 'principal', href: cardPrincipalHref(viewer) };
    return null;
  }
  if (segments[0] === 'addressbooks') {
    if (segments.length === 1) return { kind: 'addressbooks', href: `${ROOT}/addressbooks/` };
    if (keyOf(segments[1]) !== viewer.username_key) return 'forbidden';
    if (segments.length === 2) {
      ensureBooks(viewer);
      return { kind: 'home', href: cardHomeHref(viewer) };
    }
    const found = bookBySlug(viewer, segments[2]);
    if (segments.length === 3) {
      if (!found) return { kind: 'book', href: `${cardHomeHref(viewer)}${enc(segments[2])}/`, name: segments[2] };
      return { kind: 'book', href: bookHref(viewer, found.book), book: found.book, access: found.access };
    }
    if (segments.length === 4 && found) {
      return {
        kind: 'object',
        href: objectHref(viewer, found.book, segments[3]),
        book: found.book,
        access: found.access,
        object: liveObject(found.book, segments[3]),
        name: segments[3],
      };
    }
  }
  return null;
}

function authenticate(request: FastifyRequest, reply: FastifyReply): UserRow | null {
  if (!settings.get('contacts.enabled')) {
    reply.code(404).type('text/plain; charset=utf-8').send(t(request.lang, 'Kontakte sind auf diesem Server ausgeschaltet'));
    return null;
  }
  const result = basicAuth(request.headers.authorization, request.ip);
  if (result && result !== 'blocked') {
    if (needsSecondFactor(result.user)) {
      reply
        .code(403)
        .type('text/plain; charset=utf-8')
        .send(t(request.lang, 'Richte zuerst die Zwei-Faktor-Anmeldung ein, die Verwaltung verlangt sie'));
      return null;
    }
    if (!contactsAllowed(result.user)) {
      reply.code(403).type('text/plain; charset=utf-8').send(t(request.lang, 'Gastkonten haben keine Kontakte'));
      return null;
    }
    if ((result.readOnly || result.paused) && !READ_METHODS.has(request.method)) {
      reply.code(403).type('text/plain; charset=utf-8').send(t(request.lang, 'Dieses App-Passwort darf nur lesen'));
      return null;
    }
    return result.user;
  }
  reply
    .code(result === 'blocked' ? 429 : 401)
    .header('WWW-Authenticate', `Basic realm="${settings.get('site.name').replace(/"/g, '')}", charset="UTF-8"`)
    .type('text/plain; charset=utf-8')
    .send(
      result === 'blocked'
        ? t(request.lang, 'Zu viele Versuche, warte kurz und versuch es dann noch mal')
        : t(request.lang, 'Melde dich mit deinem Benutzernamen und einem App-Passwort an')
    );
  return null;
}

const tag = (ns: string, name: string) => `${PREFIXES[ns] ?? 'x'}:${name}`;

function emptyTag(ns: string, name: string, index: number) {
  if (PREFIXES[ns]) return `<${tag(ns, name)}/>`;
  return `<x${index}:${name} xmlns:x${index}="${escapeXml(ns)}"/>`;
}

const hrefTag = (href: string) => `<d:href>${escapeXml(href)}</d:href>`;

function privileges(access: BookAccess | undefined) {
  const read = '<d:privilege><d:read/></d:privilege><d:privilege><d:read-current-user-privilege-set/></d:privilege>';
  if (!access || !canAt(access, 'write')) return read;
  const write =
    '<d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:write-properties/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>';
  return access === 'owner' ? `${read}${write}<d:privilege><d:all/></d:privilege>` : `${read}${write}`;
}

const syncToken = (book: BookRow) => `${SYNC}${book.revision}`;

function property(resource: Resource, viewer: UserRow, ns: string, name: string, withData: boolean): string | null {
  const key = `${ns}|${name}`;
  const book = resource.book;
  switch (key) {
    case `${D}|current-user-principal`:
      return hrefTag(cardPrincipalHref(viewer));
    case `${D}|principal-URL`:
      return resource.kind === 'principal' ? hrefTag(cardPrincipalHref(viewer)) : null;
    case `${D}|principal-collection-set`:
      return hrefTag(`${ROOT}/principals/`);
    case `${CARD}|addressbook-home-set`:
      return resource.kind === 'principal' || resource.kind === 'root' ? hrefTag(cardHomeHref(viewer)) : null;
    case `${CAL}|calendar-home-set`:
      return (resource.kind === 'principal' || resource.kind === 'root') && calendarAllowed(viewer) && settings.get('calendar.caldav')
        ? hrefTag(`/caldav/calendars/${enc(viewer.username)}/`)
        : null;
    case `${CS}|email-address-set`:
      return resource.kind === 'principal' && viewer.email ? `<cs:email-address>${escapeXml(viewer.email)}</cs:email-address>` : null;
    case `${D}|displayname`:
      if (resource.kind === 'principal') return escapeXml(viewer.name);
      if (resource.kind === 'book' && book) {
        if (book.owner_id === viewer.id) return escapeXml(book.name);
        return escapeXml(`${book.name} (${getUser(book.owner_id)?.name ?? '?'})`);
      }
      if (resource.kind === 'home') return escapeXml(settings.get('site.name'));
      return null;
    case `${D}|resourcetype`:
      if (resource.kind === 'principal') return '<d:principal/><d:collection/>';
      if (resource.kind === 'book') return '<d:collection/><card:addressbook/>';
      if (resource.kind === 'object') return '';
      return '<d:collection/>';
    case `${D}|owner`:
      if (book) {
        const owner = getUser(book.owner_id);
        return owner ? hrefTag(cardPrincipalHref(owner)) : null;
      }
      return hrefTag(cardPrincipalHref(viewer));
    case `${D}|current-user-privilege-set`:
      if (resource.kind === 'book' || resource.kind === 'object') return privileges(resource.access);
      return privileges(resource.kind === 'home' ? 'owner' : 'read');
    case `${D}|supported-report-set`: {
      const report = (inner: string) => `<d:supported-report><d:report>${inner}</d:report></d:supported-report>`;
      if (resource.kind === 'book')
        return report('<card:addressbook-query/>') + report('<card:addressbook-multiget/>') + report('<d:sync-collection/>');
      return report('<d:expand-property/>');
    }
    case `${CARD}|supported-address-data`:
      return resource.kind === 'book'
        ? '<card:address-data-type content-type="text/vcard" version="3.0"/><card:address-data-type content-type="text/vcard" version="4.0"/>'
        : null;
    case `${CARD}|addressbook-description`:
      return resource.kind === 'book' && book ? escapeXml(book.description ?? '') : null;
    case `${CARD}|max-resource-size`:
      return resource.kind === 'book' ? String(MAX_SIZE) : null;
    case `${CS}|getctag`:
      return resource.kind === 'book' && book ? escapeXml(`${book.revision}`) : null;
    case `${D}|sync-token`:
      return resource.kind === 'book' && book ? escapeXml(syncToken(book)) : null;
    case `${D}|getetag`:
      if (resource.kind === 'object' && resource.object) return escapeXml(`"${resource.object.etag}"`);
      if (resource.kind === 'book' && book) return escapeXml(`"b${book.revision}"`);
      return null;
    case `${D}|getcontenttype`:
      return resource.kind === 'object' && resource.object ? 'text/vcard; charset=utf-8' : null;
    case `${D}|getcontentlength`:
      return resource.kind === 'object' && resource.object ? String(Buffer.byteLength(resource.object.vcard)) : null;
    case `${D}|getlastmodified`:
      if (resource.kind === 'object' && resource.object) return new Date(resource.object.updated_at).toUTCString();
      if (resource.kind === 'book' && book) return new Date(book.updated_at).toUTCString();
      return null;
    case `${CARD}|address-data`:
      return resource.kind === 'object' && resource.object && withData ? escapeXml(resource.object.vcard) : null;
    default:
      return null;
  }
}

const ALLPROP: [string, string][] = [
  [D, 'displayname'],
  [D, 'resourcetype'],
  [D, 'getetag'],
  [D, 'getcontenttype'],
  [D, 'getlastmodified'],
  [D, 'owner'],
  [D, 'current-user-privilege-set'],
  [CS, 'getctag'],
  [D, 'sync-token'],
];

function responseFor(resource: Resource, viewer: UserRow, wanted: [string, string][] | null, withData = true) {
  const found: string[] = [];
  const missing: string[] = [];
  (wanted ?? ALLPROP).forEach(([ns, name], index) => {
    const valueXml = property(resource, viewer, ns, name, withData);
    if (valueXml === null) {
      if (wanted) missing.push(emptyTag(ns, name, index));
      return;
    }
    found.push(
      PREFIXES[ns]
        ? `<${tag(ns, name)}>${valueXml}</${tag(ns, name)}>`
        : `<x${index}:${name} xmlns:x${index}="${escapeXml(ns)}">${valueXml}</x${index}:${name}>`
    );
  });
  let out = `<d:response>${hrefTag(resource.href)}`;
  if (found.length) out += `<d:propstat><d:prop>${found.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
  if (missing.length) out += `<d:propstat><d:prop>${missing.join('')}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`;
  if (!found.length && !missing.length) out += '<d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat>';
  return `${out}</d:response>`;
}

function multistatus(reply: FastifyReply, responses: string[], extra = '') {
  const namespaces = Object.entries(PREFIXES)
    .map(([ns, prefix]) => `xmlns:${prefix}="${ns}"`)
    .join(' ');
  return reply
    .code(207)
    .type('application/xml; charset=utf-8')
    .header('DAV', DAV_HEADER)
    .send(`<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${namespaces}>${responses.join('')}${extra}</d:multistatus>`);
}

function davError(reply: FastifyReply, status: number, condition: string) {
  return reply
    .code(status)
    .type('application/xml; charset=utf-8')
    .send(`<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:" xmlns:card="${CARD}">${condition}</d:error>`);
}

function requestedProps(root: XmlNode | null): [string, string][] | null {
  const prop = root ? child(root, D, 'prop') : null;
  return prop ? prop.children.map((entry) => [entry.ns, entry.name]) : null;
}

function bodyText(request: FastifyRequest) {
  const raw = request.body;
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return '';
}

function parseBody(request: FastifyRequest) {
  try {
    return parseXml(bodyText(request));
  } catch (error) {
    if (error instanceof XmlError) return 'invalid' as const;
    throw error;
  }
}

function objectsOf(viewer: UserRow, book: BookRow, access: BookAccess): Resource[] {
  return all<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND trashed_at IS NULL ORDER BY href', book.id).map((row) => ({
    kind: 'object' as Kind,
    href: objectHref(viewer, book, row.href),
    book,
    access,
    object: row,
    name: row.href,
  }));
}

function propfind(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid') return reply.code(400).send();
  const wanted = body && child(body, D, 'allprop') ? null : requestedProps(body);
  const deep = String(request.headers.depth ?? '1').toLowerCase() !== '0';
  const responses = [responseFor(resource, viewer, wanted, false)];
  if (deep) {
    if (resource.kind === 'home') {
      for (const { book, access } of visibleBooks(viewer))
        responses.push(responseFor({ kind: 'book', href: bookHref(viewer, book), book, access }, viewer, wanted, false));
    } else if (resource.kind === 'book' && resource.book && resource.access) {
      for (const object of objectsOf(viewer, resource.book, resource.access)) responses.push(responseFor(object, viewer, wanted, true));
    } else if (resource.kind === 'root' || resource.kind === 'principals') {
      responses.push(responseFor({ kind: 'principal', href: cardPrincipalHref(viewer) }, viewer, wanted, false));
    } else if (resource.kind === 'addressbooks') {
      responses.push(responseFor({ kind: 'home', href: cardHomeHref(viewer) }, viewer, wanted, false));
    }
  }
  return multistatus(reply, responses);
}

interface TextMatch {
  text: string;
  type: string;
  negate: boolean;
}

interface PropFilter {
  name: string;
  test: 'anyof' | 'allof';
  missing: boolean;
  matches: TextMatch[];
}

function filtersOf(root: XmlNode) {
  const filter = child(root, CARD, 'filter');
  const test = filter?.attrs.test?.toLowerCase() === 'allof' ? 'allof' : 'anyof';
  const props: PropFilter[] = children(filter, CARD, 'prop-filter').map((entry) => ({
    name: (entry.attrs.name ?? '').toUpperCase(),
    test: entry.attrs.test?.toLowerCase() === 'allof' ? 'allof' : 'anyof',
    missing: Boolean(child(entry, CARD, 'is-not-defined')),
    matches: children(entry, CARD, 'text-match').map((match) => ({
      text: textOf(match).toLowerCase(),
      type: (match.attrs['match-type'] ?? 'contains').toLowerCase(),
      negate: match.attrs['negate-condition']?.toLowerCase() === 'yes',
    })),
  }));
  const limit = Number(textOf(child(child(root, CARD, 'limit'), CARD, 'nresults'))) || 0;
  return { test, props, limit };
}

function textMatches(value: string, match: TextMatch) {
  const text = value.toLowerCase();
  const hit =
    match.type === 'equals'
      ? text === match.text
      : match.type === 'starts-with'
        ? text.startsWith(match.text)
        : match.type === 'ends-with'
          ? text.endsWith(match.text)
          : text.includes(match.text);
  return match.negate ? !hit : hit;
}

function cardMatches(card: VCard | undefined, filter: ReturnType<typeof filtersOf>) {
  if (!filter.props.length) return true;
  if (!card) return false;
  const results = filter.props.map((prop) => {
    const values = card.props.filter((entry) => entry.name === prop.name).map((entry) => unescapeValue(entry.value));
    if (prop.missing) return values.length === 0;
    if (!values.length) return false;
    if (!prop.matches.length) return true;
    const checks = prop.matches.map((match) => values.some((value) => textMatches(value, match)));
    return prop.test === 'allof' ? checks.every(Boolean) : checks.some(Boolean);
  });
  return filter.test === 'allof' ? results.every(Boolean) : results.some(Boolean);
}

function report(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid' || !body) return reply.code(400).send();
  const wanted = requestedProps(body) ?? [
    [D, 'getetag'],
    [CARD, 'address-data'],
  ];
  if (resource.kind !== 'book' || !resource.book || !resource.access) {
    if (body.name === 'principal-property-search' || body.name === 'expand-property')
      return multistatus(reply, [responseFor(resource, viewer, wanted, false)]);
    return reply.code(501).send();
  }
  const book = resource.book;
  const access = resource.access;
  const objectResponse = (row: ContactRow) =>
    responseFor({ kind: 'object', href: objectHref(viewer, book, row.href), book, access, object: row }, viewer, wanted, true);
  if (body.ns === CARD && body.name === 'addressbook-query') {
    const filter = filtersOf(body);
    const rows = all<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND trashed_at IS NULL ORDER BY href', book.id).filter((row) =>
      cardMatches(filter.props.length ? parseVCards(row.vcard, 1)[0] : undefined, filter)
    );
    const limited = filter.limit > 0 ? rows.slice(0, filter.limit) : rows;
    return multistatus(reply, limited.map(objectResponse));
  }
  if (body.ns === CARD && body.name === 'addressbook-multiget') {
    const responses: string[] = [];
    for (const node of children(body, D, 'href')) {
      const href = textOf(node);
      let path = href;
      try {
        path = new URL(href, 'http://local').pathname;
      } catch {}
      const name = segmentsOf(path)?.[3];
      const row = name ? liveObject(book, name) : null;
      responses.push(row ? objectResponse(row) : `<d:response>${hrefTag(href)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
    }
    return multistatus(reply, responses);
  }
  if (body.ns === D && body.name === 'sync-collection') {
    const token = textOf(child(body, D, 'sync-token'));
    const responses: string[] = [];
    if (!token) {
      for (const object of objectsOf(viewer, book, access)) responses.push(responseFor(object, viewer, wanted, true));
    } else {
      if (!token.startsWith(SYNC)) return davError(reply, 403, '<d:valid-sync-token/>');
      const since = Number(token.slice(SYNC.length));
      if (!Number.isInteger(since) || since < 0 || since > book.revision) return davError(reply, 403, '<d:valid-sync-token/>');
      const changes = all<{ href: string; deleted: number }>(
        'SELECT href, deleted FROM contact_changes WHERE book_id = ? AND revision > ? ORDER BY revision',
        book.id,
        since
      );
      for (const change of changes) {
        const href = objectHref(viewer, book, change.href);
        const row = change.deleted ? null : liveObject(book, change.href);
        responses.push(row ? objectResponse(row) : `<d:response>${hrefTag(href)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
      }
    }
    return multistatus(reply, responses, `<d:sync-token>${escapeXml(syncToken(getBook(book.id)!))}</d:sync-token>`);
  }
  return reply.code(501).send();
}

function etagMatches(header: string | undefined, etag: string | null) {
  if (!header) return true;
  if (header.trim() === '*') return etag !== null;
  if (!etag) return false;
  return header.split(',').some((entry) => entry.trim().replace(/^W\//, '') === `"${etag}"`);
}

function put(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  if (resource.kind !== 'object' || !resource.book || !resource.access || !resource.name) return reply.code(409).send();
  const book = resource.book;
  if (!canAt(resource.access, 'write')) return reply.code(403).send();
  const existing = resource.object ?? null;
  const ifMatch = request.headers['if-match'];
  const ifNoneMatch = request.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.trim() === '*' && existing) return reply.code(412).send();
  if (ifMatch && !etagMatches(ifMatch, existing?.etag ?? null)) return reply.code(412).send();
  const text = bodyText(request);
  if (!text.trim()) return reply.code(400).send();
  if (Buffer.byteLength(text) > MAX_SIZE) return davError(reply, 403, '<card:max-resource-size/>');
  let cards: VCard[];
  try {
    cards = parseVCards(text, 2);
  } catch {
    return davError(reply, 403, '<card:valid-address-data/>');
  }
  if (cards.length !== 1) return davError(reply, 403, '<card:valid-address-data/>');
  const card = cards[0];
  const uid = uidOf(card);
  if (uid) {
    const clash = liveByUid(book.id, uid);
    if (clash && clash.href !== resource.name)
      return davError(reply, 403, `<card:no-uid-conflict>${hrefTag(objectHref(viewer, book, clash.href))}</card:no-uid-conflict>`);
  }
  const row = tx(() => {
    if (!existing) run('DELETE FROM contacts WHERE book_id = ? AND href = ? AND trashed_at IS NOT NULL', book.id, resource.name);
    return storeCard(book, card, { actor: viewer.id, previous: existing, href: resource.name, text: uid ? text : undefined });
  });
  announceContacts(bookMembers(book.id));
  reply.code(existing ? 204 : 201).header('Location', objectHref(viewer, book, row.href));
  if (uid) reply.header('ETag', `"${row.etag}"`);
  return reply.send();
}

function mkcol(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  if (resource.kind !== 'book' || resource.book || !resource.name) return reply.code(405).send();
  if (resource.name.startsWith('s-') || resource.name.length > 120) return reply.code(403).send();
  const body = parseBody(request);
  if (body === 'invalid') return reply.code(400).send();
  const props = body ? child(child(body, D, 'set'), D, 'prop') : null;
  const type = child(props, D, 'resourcetype');
  if (type && !child(type, CARD, 'addressbook')) return reply.code(403).send();
  insertBook(viewer, {
    name: textOf(child(props, D, 'displayname')) || resource.name,
    description: textOf(child(props, CARD, 'addressbook-description')) || null,
    slug: resource.name,
  });
  return reply.code(201).send();
}

function proppatch(request: FastifyRequest, reply: FastifyReply, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid' || !body) return reply.code(400).send();
  const ok: string[] = [];
  const denied: string[] = [];
  const book = resource.book;
  const isOwner = resource.kind === 'book' && book && resource.access === 'owner';
  for (const operation of body.children) {
    const remove = operation.name === 'remove';
    for (const prop of child(operation, D, 'prop')?.children ?? []) {
      const key = `${prop.ns}|${prop.name}`;
      const label = emptyTag(prop.ns, prop.name, ok.length + denied.length);
      if (!book || resource.kind !== 'book') denied.push(label);
      else if (key === `${D}|displayname` && isOwner && !remove) {
        run('UPDATE address_books SET name = ? WHERE id = ?', textOf(prop).slice(0, 100) || book.name, book.id);
        ok.push(label);
      } else if (key === `${CARD}|addressbook-description` && isOwner) {
        run('UPDATE address_books SET description = ? WHERE id = ?', remove ? null : textOf(prop).slice(0, 2000) || null, book.id);
        ok.push(label);
      } else if (prop.ns === CS || prop.ns.startsWith('http://apple.com/') || prop.ns.startsWith('http://me.com/')) ok.push(label);
      else denied.push(label);
    }
  }
  if (book && ok.length) {
    touchBook(book.id, null);
    announceContacts(bookMembers(book.id));
  }
  let out = `<d:response>${hrefTag(resource.href)}`;
  if (ok.length) out += `<d:propstat><d:prop>${ok.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
  if (denied.length) out += `<d:propstat><d:prop>${denied.join('')}</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat>`;
  return multistatus(reply, [`${out}</d:response>`]);
}

async function handle(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'OPTIONS') {
    return reply.code(200).header('DAV', DAV_HEADER).header('Allow', ALLOW).header('Content-Length', '0').send();
  }
  const viewer = authenticate(request, reply);
  if (!viewer) return reply;
  const segments = segmentsOf(request.url);
  if (!segments) return reply.code(404).send();
  const resource = resolve(viewer, segments);
  if (resource === 'forbidden') return reply.code(403).send();
  if (!resource) return reply.code(404).send();
  reply.header('DAV', DAV_HEADER);
  try {
    switch (request.method) {
      case 'PROPFIND':
        if (resource.kind === 'book' && !resource.book) return reply.code(404).send();
        if (resource.kind === 'object' && !resource.object) return reply.code(404).send();
        return propfind(request, reply, viewer, resource);
      case 'REPORT':
        return report(request, reply, viewer, resource);
      case 'GET':
      case 'HEAD': {
        if (resource.kind === 'object') {
          if (!resource.object) return reply.code(404).send();
          reply.header('ETag', `"${resource.object.etag}"`).header('Last-Modified', new Date(resource.object.updated_at).toUTCString());
          if (request.headers['if-none-match'] && etagMatches(request.headers['if-none-match'], resource.object.etag))
            return reply.code(304).send();
          return reply.type('text/vcard; charset=utf-8').send(request.method === 'HEAD' ? undefined : resource.object.vcard);
        }
        if (resource.kind === 'book' && resource.book) {
          const rows = all<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND trashed_at IS NULL ORDER BY name', resource.book.id);
          return reply.type('text/vcard; charset=utf-8').send(request.method === 'HEAD' ? undefined : exportVcf(rows));
        }
        return reply
          .type('text/plain; charset=utf-8')
          .send(t(request.lang, 'Das ist der CardDAV-Zugang von {site}.', { site: settings.get('site.name') }));
      }
      case 'PUT':
        return put(request, reply, viewer, resource);
      case 'DELETE': {
        if (resource.kind === 'object') {
          if (!resource.object || !resource.book) return reply.code(404).send();
          if (!canAt(resource.access, 'write')) return reply.code(403).send();
          if (request.headers['if-match'] && !etagMatches(request.headers['if-match'], resource.object.etag)) return reply.code(412).send();
          const row = resource.object;
          tx(() => trashContact(row, viewer.id));
          announceContacts(bookMembers(row.book_id));
          return reply.code(204).send();
        }
        if (resource.kind === 'book' && resource.book) {
          if (resource.access === 'owner' && ownBooks(viewer.id).length <= 1) return reply.code(403).send();
          deleteBook(viewer, resource.book.id);
          return reply.code(204).send();
        }
        return reply.code(403).send();
      }
      case 'MKCOL':
        return mkcol(request, reply, viewer, resource);
      case 'PROPPATCH':
        return proppatch(request, reply, resource);
      default:
        return reply.code(405).header('Allow', ALLOW).send();
    }
  } catch (error) {
    log.warn({ error: (error as Error).message, method: request.method, url: request.url }, 'CardDAV-Anfrage fehlgeschlagen');
    throw error;
  }
}

export async function carddavRoutes(app: FastifyInstance) {
  const methods = ['OPTIONS', 'GET', 'HEAD', 'PUT', 'DELETE', 'PROPFIND', 'PROPPATCH', 'REPORT', 'MKCOL'];
  await app.register(async (dav) => {
    dav.removeAllContentTypeParsers();
    dav.addContentTypeParser('*', { parseAs: 'string', bodyLimit: MAX_SIZE + 1024 * 1024 }, (_request, body, done) => done(null, body));
    dav.route({ method: methods, url: ROOT, handler: handle, compress: false, exposeHeadRoute: false });
    dav.route({ method: methods, url: `${ROOT}/*`, handler: handle, compress: false, exposeHeadRoute: false });
    dav.route({
      method: ['GET', 'PROPFIND', 'OPTIONS', 'HEAD'],
      url: '/.well-known/carddav',
      exposeHeadRoute: false,
      handler: async (_request, reply) => (settings.get('contacts.enabled') ? reply.redirect(`${ROOT}/`, 301) : reply.code(404).send()),
    });
  });
}
