import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { all, one, run, tx } from '../lib/db.ts';
import { t } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { ICalError } from './ical.ts';
import { occurrences, readObject } from './model.ts';
import { XmlError, child, children, escapeXml, parseXml, textOf, type XmlNode } from './xml.ts';
import { basicAuth } from '../services/apppasswords.ts';
import { needsSecondFactor } from '../services/auth.ts';
import {
  ensureCalendars,
  accessOf,
  announceCalendars,
  atLeast,
  getCalendar,
  insertCalendar,
  listCalendars,
  ownCalendars,
  removeShare,
  touchCalendar,
  trashCalendar,
  type Access,
  type CalendarRow,
} from './calendars.ts';
import { dataOf, eventByHref, storeItem, trashItem, type EventRow } from './events.ts';
import { afterChange } from './invitations.ts';
import * as settings from '../services/settings.ts';
import { exportIcs } from './transfer.ts';
import { contactsAllowed } from '../contacts/books.ts';
import { getUser, keyOf, zoneOf, type UserRow } from '../services/users.ts';

const D = 'DAV:';
const C = 'urn:ietf:params:xml:ns:caldav';
const CS = 'http://calendarserver.org/ns/';
const A = 'http://apple.com/ns/ical/';
const CARD = 'urn:ietf:params:xml:ns:carddav';
const PREFIXES: Record<string, string> = { [D]: 'd', [C]: 'cal', [CS]: 'cs', [A]: 'ical', [CARD]: 'card' };
const ROOT = '/caldav';
const READ_METHODS = new Set(['OPTIONS', 'GET', 'HEAD', 'PROPFIND', 'REPORT']);
const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL';
const SYNC = 'http://moecloud.moestudio.net/ns/sync/';

type Kind = 'root' | 'principals' | 'principal' | 'calendars' | 'home' | 'calendar' | 'object';

interface Resource {
  kind: Kind;
  href: string;
  owner?: UserRow;
  calendar?: CalendarRow;
  access?: Access;
  object?: EventRow | null;
  name?: string;
}

const enc = (value: string) => encodeURIComponent(value).replace(/%40/g, '@');

const principalHref = (user: UserRow) => `${ROOT}/principals/${enc(user.username)}/`;
const homeHref = (user: UserRow) => `${ROOT}/calendars/${enc(user.username)}/`;
const slugFor = (viewer: UserRow, calendar: CalendarRow) => (calendar.owner_id === viewer.id ? calendar.slug : `s-${calendar.id}`);
const calendarHref = (viewer: UserRow, calendar: CalendarRow) => `${homeHref(viewer)}${enc(slugFor(viewer, calendar))}/`;
const objectHref = (viewer: UserRow, calendar: CalendarRow, href: string) => `${calendarHref(viewer, calendar)}${enc(href)}`;

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

function calendarBySlug(viewer: UserRow, slug: string) {
  if (slug.startsWith('s-')) {
    const calendar = getCalendar(slug.slice(2));
    if (calendar && calendar.owner_id !== viewer.id && !calendar.trashed_at) {
      const access = accessOf(viewer, calendar);
      if (access && atLeast(access, 'read')) return { calendar, access };
    }
  }
  const own = one<CalendarRow>('SELECT * FROM calendars WHERE owner_id = ? AND slug = ? AND trashed_at IS NULL', viewer.id, slug);
  return own ? { calendar: own, access: 'owner' as Access } : null;
}

function resolve(viewer: UserRow, segments: string[]): Resource | 'forbidden' | null {
  if (!segments.length) return { kind: 'root', href: `${ROOT}/` };
  if (segments[0] === 'principals') {
    if (segments.length === 1) return { kind: 'principals', href: `${ROOT}/principals/` };
    if (keyOf(segments[1]) !== viewer.username_key) return 'forbidden';
    if (segments.length === 2) return { kind: 'principal', href: principalHref(viewer), owner: viewer };
    return null;
  }
  if (segments[0] === 'calendars') {
    if (segments.length === 1) return { kind: 'calendars', href: `${ROOT}/calendars/` };
    if (keyOf(segments[1]) !== viewer.username_key) return 'forbidden';
    if (segments.length === 2) {
      ensureCalendars(viewer);
      return { kind: 'home', href: homeHref(viewer), owner: viewer };
    }
    const found = calendarBySlug(viewer, segments[2]);
    if (segments.length === 3) {
      if (!found) return { kind: 'calendar', href: `${homeHref(viewer)}${enc(segments[2])}/`, owner: viewer, name: segments[2] };
      return {
        kind: 'calendar',
        href: calendarHref(viewer, found.calendar),
        owner: viewer,
        calendar: found.calendar,
        access: found.access,
      };
    }
    if (segments.length === 4 && found) {
      return {
        kind: 'object',
        href: objectHref(viewer, found.calendar, segments[3]),
        owner: viewer,
        calendar: found.calendar,
        access: found.access,
        object: eventByHref(found.calendar.id, segments[3]) ?? null,
        name: segments[3],
      };
    }
  }
  return null;
}

function authenticate(request: FastifyRequest, reply: FastifyReply): UserRow | null {
  if (!settings.get('calendar.caldav') || !settings.get('calendar.enabled')) {
    reply.code(404).type('text/plain; charset=utf-8').send(t(request.lang, 'CalDAV ist auf diesem Server ausgeschaltet'));
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
    if (result.user.role === 'guest') {
      reply.code(403).type('text/plain; charset=utf-8').send(t(request.lang, 'Gastkonten haben keinen Kalender'));
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

function privileges(access: Access | undefined) {
  const read = '<d:privilege><d:read/></d:privilege><d:privilege><d:read-current-user-privilege-set/></d:privilege>';
  if (!access || !atLeast(access, 'write')) return read;
  const write =
    '<d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:write-properties/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>';
  return access === 'owner' ? `${read}${write}<d:privilege><d:all/></d:privilege>` : `${read}${write}`;
}

const syncToken = (calendar: CalendarRow) => `${SYNC}${calendar.revision}`;

function colorOf(calendar: CalendarRow, viewer: UserRow) {
  if (calendar.owner_id === viewer.id) return calendar.color;
  return (
    one<{ color: string | null }>('SELECT color FROM calendar_shares WHERE calendar_id = ? AND user_id = ?', calendar.id, viewer.id)
      ?.color ?? calendar.color
  );
}

function property(resource: Resource, viewer: UserRow, ns: string, name: string, withData: boolean): string | null {
  const key = `${ns}|${name}`;
  const calendar = resource.calendar;
  switch (key) {
    case `${D}|current-user-principal`:
      return hrefTag(principalHref(viewer));
    case `${D}|principal-URL`:
      return resource.kind === 'principal' ? hrefTag(principalHref(viewer)) : null;
    case `${D}|principal-collection-set`:
      return hrefTag(`${ROOT}/principals/`);
    case `${C}|calendar-home-set`:
      return resource.kind === 'principal' || resource.kind === 'root' ? hrefTag(homeHref(viewer)) : null;
    case `${CARD}|addressbook-home-set`:
      return (resource.kind === 'principal' || resource.kind === 'root') && contactsAllowed(viewer)
        ? hrefTag(`/carddav/addressbooks/${enc(viewer.username)}/`)
        : null;
    case `${C}|calendar-user-address-set`:
      return resource.kind === 'principal'
        ? `${viewer.email ? hrefTag(`mailto:${viewer.email}`) : ''}${hrefTag(principalHref(viewer))}`
        : null;
    case `${CS}|email-address-set`:
      return resource.kind === 'principal' && viewer.email ? `<cs:email-address>${escapeXml(viewer.email)}</cs:email-address>` : null;
    case `${D}|displayname`:
      if (resource.kind === 'principal') return escapeXml(viewer.name);
      if (resource.kind === 'calendar' && calendar) {
        if (calendar.owner_id === viewer.id) return escapeXml(calendar.name);
        const owner = getUser(calendar.owner_id);
        return escapeXml(`${calendar.name} (${owner?.name ?? '?'})`);
      }
      if (resource.kind === 'home') return escapeXml(settings.get('site.name'));
      return null;
    case `${D}|resourcetype`:
      if (resource.kind === 'principal') return '<d:principal/><d:collection/>';
      if (resource.kind === 'calendar' && calendar)
        return calendar.kind === 'subscription' ? '<d:collection/><cal:calendar/>' : '<d:collection/><cal:calendar/>';
      if (resource.kind === 'object') return '';
      return '<d:collection/>';
    case `${D}|owner`:
      if (calendar) {
        const owner = getUser(calendar.owner_id);
        return owner ? hrefTag(principalHref(owner)) : null;
      }
      return hrefTag(principalHref(viewer));
    case `${D}|current-user-privilege-set`:
      if (resource.kind === 'calendar') return privileges(calendar?.kind === 'subscription' ? 'read' : resource.access);
      if (resource.kind === 'object') return privileges(calendar?.kind === 'subscription' ? 'read' : resource.access);
      return privileges(resource.kind === 'home' ? 'owner' : 'read');
    case `${D}|supported-report-set`: {
      const report = (inner: string) => `<d:supported-report><d:report>${inner}</d:report></d:supported-report>`;
      if (resource.kind === 'calendar')
        return report('<cal:calendar-query/>') + report('<cal:calendar-multiget/>') + report('<d:sync-collection/>');
      return report('<d:expand-property/>');
    }
    case `${C}|supported-calendar-component-set`:
      if (!calendar) return resource.kind === 'home' ? '<cal:comp name="VEVENT"/><cal:comp name="VTODO"/>' : null;
      return calendar.components
        .split(',')
        .map((component) => `<cal:comp name="${escapeXml(component)}"/>`)
        .join('');
    case `${C}|supported-calendar-data`:
      return resource.kind === 'calendar' ? '<cal:calendar-data content-type="text/calendar" version="2.0"/>' : null;
    case `${C}|calendar-description`:
      return resource.kind === 'calendar' && calendar ? escapeXml(calendar.description ?? '') : null;
    case `${C}|max-resource-size`:
      return resource.kind === 'calendar' ? '10485760' : null;
    case `${A}|calendar-color`:
      return resource.kind === 'calendar' && calendar ? `${colorOf(calendar, viewer)}FF` : null;
    case `${A}|calendar-order`:
      return resource.kind === 'calendar' && calendar ? String(calendar.position + 1) : null;
    case `${CS}|getctag`:
      return resource.kind === 'calendar' && calendar ? escapeXml(`${calendar.revision}`) : null;
    case `${D}|sync-token`:
      return resource.kind === 'calendar' && calendar ? escapeXml(syncToken(calendar)) : null;
    case `${CS}|source`:
      return resource.kind === 'calendar' && calendar?.source_url ? hrefTag(calendar.source_url) : null;
    case `${D}|getetag`:
      if (resource.kind === 'object' && resource.object) return escapeXml(`"${resource.object.etag}"`);
      if (resource.kind === 'calendar' && calendar) return escapeXml(`"c${calendar.revision}"`);
      return null;
    case `${D}|getcontenttype`:
      if (resource.kind === 'object' && resource.object)
        return `text/calendar; charset=utf-8; component=${resource.object.component.toLowerCase()}`;
      return null;
    case `${D}|getcontentlength`:
      return resource.kind === 'object' && resource.object ? String(Buffer.byteLength(resource.object.ics)) : null;
    case `${D}|getlastmodified`:
      if (resource.kind === 'object' && resource.object) return new Date(resource.object.updated_at).toUTCString();
      if (resource.kind === 'calendar' && calendar) return new Date(calendar.updated_at).toUTCString();
      return null;
    case `${C}|calendar-data`:
      return resource.kind === 'object' && resource.object && withData ? escapeXml(resource.object.ics) : null;
    case `${D}|quota-available-bytes`:
    case `${D}|quota-used-bytes`:
      return null;
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
  [C, 'supported-calendar-component-set'],
  [CS, 'getctag'],
  [D, 'sync-token'],
  [A, 'calendar-color'],
];

function responseFor(resource: Resource, viewer: UserRow, wanted: [string, string][] | null, withData = true) {
  const found: string[] = [];
  const missing: string[] = [];
  const list = wanted ?? ALLPROP;
  list.forEach(([ns, name], index) => {
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
    .header('DAV', '1, 3, calendar-access, extended-mkcol')
    .send(`<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${namespaces}>${responses.join('')}${extra}</d:multistatus>`);
}

function davError(reply: FastifyReply, status: number, condition: string) {
  return reply
    .code(status)
    .type('application/xml; charset=utf-8')
    .send(`<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:" xmlns:cal="${C}">${condition}</d:error>`);
}

function requestedProps(root: XmlNode | null): [string, string][] | null {
  if (!root) return null;
  const prop = child(root, D, 'prop');
  if (!prop) return null;
  return prop.children.map((entry) => [entry.ns, entry.name]);
}

function calendarsOf(viewer: UserRow) {
  const views = listCalendars(viewer);
  const out: { calendar: CalendarRow; access: Access }[] = [];
  for (const entry of views) {
    if (entry.access === 'freebusy') continue;
    const calendar = getCalendar(entry.id);
    if (calendar && !calendar.trashed_at) out.push({ calendar, access: entry.access });
  }
  return out;
}

function objectsOf(viewer: UserRow, calendar: CalendarRow, access: Access): Resource[] {
  return all<EventRow>('SELECT * FROM events WHERE calendar_id = ? AND trashed_at IS NULL ORDER BY href', calendar.id).map((row) => ({
    kind: 'object' as Kind,
    href: objectHref(viewer, calendar, row.href),
    owner: viewer,
    calendar,
    access,
    object: row,
    name: row.href,
  }));
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

function propfind(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid') return reply.code(400).send();
  const wanted = body && child(body, D, 'allprop') ? null : requestedProps(body);
  const depth = String(request.headers.depth ?? '1').toLowerCase();
  const deep = depth !== '0';
  const responses = [responseFor(resource, viewer, wanted, false)];
  if (deep) {
    if (resource.kind === 'home') {
      for (const { calendar, access } of calendarsOf(viewer)) {
        responses.push(
          responseFor({ kind: 'calendar', href: calendarHref(viewer, calendar), owner: viewer, calendar, access }, viewer, wanted, false)
        );
      }
    } else if (resource.kind === 'calendar' && resource.calendar && resource.access) {
      for (const object of objectsOf(viewer, resource.calendar, resource.access)) responses.push(responseFor(object, viewer, wanted, true));
    } else if (resource.kind === 'root') {
      responses.push(responseFor({ kind: 'principal', href: principalHref(viewer), owner: viewer }, viewer, wanted, false));
    } else if (resource.kind === 'calendars') {
      responses.push(responseFor({ kind: 'home', href: homeHref(viewer), owner: viewer }, viewer, wanted, false));
    } else if (resource.kind === 'principals') {
      responses.push(responseFor({ kind: 'principal', href: principalHref(viewer), owner: viewer }, viewer, wanted, false));
    }
  }
  return multistatus(reply, responses);
}

function parseIcalTime(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0)
  );
}

interface Filter {
  component: string | null;
  start: number | null;
  end: number | null;
  uid: string | null;
}

function filterOf(root: XmlNode): Filter {
  const filter = child(root, C, 'filter');
  const calendar = child(filter, C, 'comp-filter');
  const inner = calendar ? child(calendar, C, 'comp-filter') : null;
  const range = inner ? child(inner, C, 'time-range') : null;
  const uidFilter = inner ? children(inner, C, 'prop-filter').find((entry) => entry.attrs.name?.toUpperCase() === 'UID') : null;
  return {
    component: inner?.attrs.name?.toUpperCase() ?? null,
    start: parseIcalTime(range?.attrs.start),
    end: parseIcalTime(range?.attrs.end),
    uid: uidFilter ? textOf(child(uidFilter, C, 'text-match')) : null,
  };
}

function matches(row: EventRow, filter: Filter) {
  if (filter.component && row.component !== filter.component) return false;
  if (filter.uid && row.uid !== filter.uid) return false;
  if (filter.start === null && filter.end === null) return true;
  const from = filter.start ?? -8.64e15;
  const to = filter.end ?? 8.64e15;
  if (row.start_at === null) return row.component === 'VTODO';
  if (row.start_at >= to + 86_400_000) return false;
  if (row.range_end !== null && row.range_end <= from - 86_400_000) return false;
  const data = dataOf(row);
  return occurrences(data, from, to, 1).length > 0 || (row.component === 'VTODO' && data.due === null && data.start === null);
}

function report(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid' || !body) return reply.code(400).send();
  const wanted = requestedProps(body) ?? [
    [D, 'getetag'],
    [C, 'calendar-data'],
  ];
  if (resource.kind !== 'calendar' || !resource.calendar || !resource.access) {
    if (body.name === 'principal-property-search' || body.name === 'expand-property')
      return multistatus(reply, [responseFor(resource, viewer, wanted, false)]);
    return reply.code(501).send();
  }
  const calendar = resource.calendar;
  const access = resource.access;
  if (body.ns === C && body.name === 'calendar-query') {
    const filter = filterOf(body);
    const rows = all<EventRow>('SELECT * FROM events WHERE calendar_id = ? AND trashed_at IS NULL', calendar.id).filter((row) =>
      matches(row, filter)
    );
    return multistatus(
      reply,
      rows.map((row) =>
        responseFor(
          { kind: 'object', href: objectHref(viewer, calendar, row.href), owner: viewer, calendar, access, object: row },
          viewer,
          wanted,
          true
        )
      )
    );
  }
  if (body.ns === C && body.name === 'calendar-multiget') {
    const responses: string[] = [];
    for (const node of children(body, D, 'href')) {
      const href = textOf(node);
      let path = href;
      try {
        path = new URL(href, 'http://local').pathname;
      } catch {}
      const segments = segmentsOf(path);
      const name = segments?.[3];
      const row = name ? eventByHref(calendar.id, name) : undefined;
      if (!row) {
        responses.push(`<d:response>${hrefTag(href)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
        continue;
      }
      responses.push(
        responseFor(
          { kind: 'object', href: objectHref(viewer, calendar, row.href), owner: viewer, calendar, access, object: row },
          viewer,
          wanted,
          true
        )
      );
    }
    return multistatus(reply, responses);
  }
  if (body.ns === D && body.name === 'sync-collection') {
    const token = textOf(child(body, D, 'sync-token'));
    const responses: string[] = [];
    if (!token) {
      for (const object of objectsOf(viewer, calendar, access)) responses.push(responseFor(object, viewer, wanted, true));
    } else {
      if (!token.startsWith(SYNC)) return davError(reply, 403, '<d:valid-sync-token/>');
      const since = Number(token.slice(SYNC.length));
      if (!Number.isInteger(since) || since < 0 || since > calendar.revision) return davError(reply, 403, '<d:valid-sync-token/>');
      const changes = all<{ href: string; deleted: number }>(
        'SELECT href, deleted FROM changes WHERE calendar_id = ? AND revision > ? ORDER BY revision',
        calendar.id,
        since
      );
      for (const change of changes) {
        const href = objectHref(viewer, calendar, change.href);
        const row = change.deleted ? undefined : eventByHref(calendar.id, change.href);
        if (!row) responses.push(`<d:response>${hrefTag(href)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
        else responses.push(responseFor({ kind: 'object', href, owner: viewer, calendar, access, object: row }, viewer, wanted, true));
      }
    }
    const current = getCalendar(calendar.id)!;
    return multistatus(reply, responses, `<d:sync-token>${escapeXml(syncToken(current))}</d:sync-token>`);
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
  if (resource.kind !== 'object' || !resource.calendar || !resource.access || !resource.name) return reply.code(409).send();
  const calendar = resource.calendar;
  if (!atLeast(resource.access, 'write') || calendar.kind !== 'local') return reply.code(403).send();
  const existing = resource.object ?? null;
  const ifMatch = request.headers['if-match'];
  const ifNoneMatch = request.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.trim() === '*' && existing) return reply.code(412).send();
  if (ifMatch && !etagMatches(ifMatch, existing?.etag ?? null)) return reply.code(412).send();
  const text = bodyText(request);
  if (!text) return reply.code(400).send();
  const owner = getUser(calendar.owner_id);
  let parsed;
  try {
    parsed = readObject(text, calendar.zone ?? (owner ? zoneOf(owner) : settings.get('calendar.zone')));
  } catch (error) {
    if (error instanceof ICalError) return davError(reply, 403, '<cal:valid-calendar-data/>');
    throw error;
  }
  if (!calendar.components.split(',').includes(parsed.data.component)) return davError(reply, 403, '<cal:supported-calendar-component/>');
  const clash = one<EventRow>(
    'SELECT * FROM events WHERE calendar_id = ? AND uid = ? AND trashed_at IS NULL AND href != ?',
    calendar.id,
    parsed.uid,
    resource.name
  );
  if (clash) return davError(reply, 403, `<cal:no-uid-conflict>${hrefTag(objectHref(viewer, calendar, clash.href))}</cal:no-uid-conflict>`);
  const before = existing ? dataOf(existing) : null;
  const row = tx(() => {
    if (!existing) run('DELETE FROM events WHERE calendar_id = ? AND href = ? AND trashed_at IS NOT NULL', calendar.id, resource.name);
    const stored = storeItem(calendar, parsed.data, parsed.ics, { actor: viewer.id, previous: existing, href: resource.name });
    afterChange(viewer, stored, before, parsed.data);
    return stored;
  });
  return reply
    .code(existing ? 204 : 201)
    .header('ETag', `"${row.etag}"`)
    .header('Location', objectHref(viewer, calendar, row.href))
    .send();
}

function mkcalendar(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  if (resource.kind !== 'calendar' || resource.calendar || !resource.name) return reply.code(405).send();
  if (resource.name.startsWith('s-') || resource.name.length > 120) return reply.code(403).send();
  const body = parseBody(request);
  if (body === 'invalid') return reply.code(400).send();
  const props = body ? child(child(body, D, 'set'), D, 'prop') : null;
  if (body && body.ns === D && body.name === 'mkcol') {
    const type = child(props, D, 'resourcetype');
    if (type && !child(type, C, 'calendar')) return reply.code(403).send();
  }
  const name = textOf(child(props, D, 'displayname')) || resource.name;
  const colorText = textOf(child(props, A, 'calendar-color'));
  const color = /^#[0-9a-f]{6}/i.test(colorText) ? colorText.slice(0, 7).toLowerCase() : undefined;
  const description = textOf(child(props, C, 'calendar-description')) || undefined;
  const set = child(props, C, 'supported-calendar-component-set');
  const comps = set
    ? children(set, C, 'comp')
        .map((entry) => entry.attrs.name?.toUpperCase())
        .filter((entry): entry is string => entry === 'VEVENT' || entry === 'VTODO')
    : [];
  insertCalendar(viewer, { name, color, description, slug: resource.name, components: comps.length ? comps.join(',') : 'VEVENT,VTODO' });
  return reply.code(201).send();
}

function proppatch(request: FastifyRequest, reply: FastifyReply, viewer: UserRow, resource: Resource) {
  const body = parseBody(request);
  if (body === 'invalid' || !body) return reply.code(400).send();
  const ok: string[] = [];
  const denied: string[] = [];
  const calendar = resource.calendar;
  const isOwner = resource.kind === 'calendar' && calendar && resource.access === 'owner';
  for (const operation of body.children) {
    const remove = operation.name === 'remove';
    for (const prop of child(operation, D, 'prop')?.children ?? []) {
      const key = `${prop.ns}|${prop.name}`;
      const label = emptyTag(prop.ns, prop.name, ok.length + denied.length);
      if (!calendar || resource.kind !== 'calendar') {
        denied.push(label);
        continue;
      }
      if (key === `${A}|calendar-color` && !remove) {
        const color = textOf(prop).slice(0, 7).toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(color)) {
          if (isOwner) run('UPDATE calendars SET color = ? WHERE id = ?', color, calendar.id);
          else run('UPDATE calendar_shares SET color = ? WHERE calendar_id = ? AND user_id = ?', color, calendar.id, viewer.id);
          ok.push(label);
        } else denied.push(label);
      } else if (key === `${D}|displayname` && isOwner && !remove) {
        run('UPDATE calendars SET name = ? WHERE id = ?', textOf(prop).slice(0, 100) || calendar.name, calendar.id);
        ok.push(label);
      } else if (key === `${C}|calendar-description` && isOwner) {
        run('UPDATE calendars SET description = ? WHERE id = ?', remove ? null : textOf(prop).slice(0, 2000), calendar.id);
        ok.push(label);
      } else if (key === `${A}|calendar-order`) {
        const position = Math.min(100_000, Math.max(0, Math.floor(Number(textOf(prop)) - 1) || 0));
        if (isOwner) run('UPDATE calendars SET position = ? WHERE id = ?', position, calendar.id);
        else run('UPDATE calendar_shares SET position = ? WHERE calendar_id = ? AND user_id = ?', position, calendar.id, viewer.id);
        ok.push(label);
      } else if (key === `${C}|calendar-timezone` || key.startsWith(`${A}|`) || key.startsWith(`${CS}|`)) {
        ok.push(label);
      } else denied.push(label);
    }
  }
  if (calendar && ok.length) {
    touchCalendar(calendar.id, null);
    announceCalendars([viewer.id, calendar.owner_id]);
  }
  let out = `<d:response>${hrefTag(resource.href)}`;
  if (ok.length) out += `<d:propstat><d:prop>${ok.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`;
  if (denied.length) out += `<d:propstat><d:prop>${denied.join('')}</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat>`;
  return multistatus(reply, [`${out}</d:response>`]);
}

async function handle(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'OPTIONS') {
    return reply
      .code(200)
      .header('DAV', '1, 3, calendar-access, extended-mkcol')
      .header('Allow', ALLOW)
      .header('Content-Length', '0')
      .send();
  }
  const viewer = authenticate(request, reply);
  if (!viewer) return reply;
  const segments = segmentsOf(request.url);
  if (!segments) return reply.code(404).send();
  const resource = resolve(viewer, segments);
  if (resource === 'forbidden') return reply.code(403).send();
  if (!resource) return reply.code(404).send();
  reply.header('DAV', '1, 3, calendar-access, extended-mkcol');
  try {
    switch (request.method) {
      case 'PROPFIND':
        if (resource.kind === 'calendar' && !resource.calendar) return reply.code(404).send();
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
          return reply.type('text/calendar; charset=utf-8').send(request.method === 'HEAD' ? undefined : resource.object.ics);
        }
        if (resource.kind === 'calendar' && resource.calendar) {
          return reply.type('text/calendar; charset=utf-8').send(request.method === 'HEAD' ? undefined : exportIcs(resource.calendar));
        }
        return reply
          .type('text/plain; charset=utf-8')
          .send(t(request.lang, 'Das ist der CalDAV-Zugang von {site}.', { site: settings.get('site.name') }));
      }
      case 'PUT':
        return put(request, reply, viewer, resource);
      case 'DELETE': {
        if (resource.kind === 'object') {
          if (!resource.object || !resource.calendar) return reply.code(404).send();
          if (!resource.access || !atLeast(resource.access, 'write') || resource.calendar.kind !== 'local') return reply.code(403).send();
          if (request.headers['if-match'] && !etagMatches(request.headers['if-match'], resource.object.etag)) return reply.code(412).send();
          const row = resource.object;
          const before = dataOf(row);
          tx(() => trashItem(row, viewer.id));
          afterChange(viewer, row, before, null);
          return reply.code(204).send();
        }
        if (resource.kind === 'calendar' && resource.calendar) {
          if (resource.access === 'owner') {
            const own = ownCalendars(viewer.id).filter((entry) => entry.kind === 'local').length;
            if (own <= 1 && resource.calendar.kind === 'local') return reply.code(403).send();
            trashCalendar(viewer, resource.calendar.id);
          } else removeShare(viewer, resource.calendar.id, viewer.id);
          return reply.code(204).send();
        }
        return reply.code(403).send();
      }
      case 'MKCALENDAR':
      case 'MKCOL':
        return mkcalendar(request, reply, viewer, resource);
      case 'PROPPATCH':
        return proppatch(request, reply, viewer, resource);
      default:
        return reply.code(405).header('Allow', ALLOW).send();
    }
  } catch (error) {
    log.warn({ error: (error as Error).message, method: request.method, url: request.url }, 'CalDAV-Anfrage fehlgeschlagen');
    throw error;
  }
}

export async function caldavRoutes(app: FastifyInstance) {
  const methods = ['OPTIONS', 'GET', 'HEAD', 'PUT', 'DELETE', 'PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR', 'MKCOL'];
  await app.register(async (dav) => {
    dav.removeAllContentTypeParsers();
    dav.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 12 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    dav.route({ method: methods, url: ROOT, handler: handle, compress: false, exposeHeadRoute: false });
    dav.route({ method: methods, url: `${ROOT}/*`, handler: handle, compress: false, exposeHeadRoute: false });
    dav.route({
      method: ['GET', 'PROPFIND', 'OPTIONS', 'HEAD'],
      url: '/.well-known/caldav',
      exposeHeadRoute: false,
      handler: async (_request, reply) => reply.redirect(`${ROOT}/`, 301),
    });
  });
}
