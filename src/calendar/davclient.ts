import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { config } from '../config.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';
import { isZone } from '../../shared/time.ts';
import { colorOf } from './sources.ts';
import { child, children, parseXml, textOf, type XmlNode } from './xml.ts';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const APPLE = 'http://apple.com/ns/ical/';
const CS = 'http://calendarserver.org/ns/';

const TIMEOUT = 45_000;
const MAX_REDIRECTS = 5;
const LISTING = 8 * 1024 * 1024;
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gv', 'mil', 'nom', 'sch', 'ltd', 'plc']);

export class DavClientError extends Error {
  params: Record<string, string | number>;
  constructor(message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.params = params;
  }
}

export interface RemoteCalendar {
  url: string;
  name: string;
  color: string | null;
  description: string | null;
  zone: string | null;
  components: string[];
}

export interface DavSession {
  authorization: string;
  allowPrivate: boolean;
  domain: string;
}

export function registrable(host: string) {
  const name = host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(name) || name.includes(':')) return name;
  const parts = name.split('.');
  if (parts.length <= 2) return name;
  const count = parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-count).join('.');
}

export function davUrl(input: string) {
  const trimmed = input.trim().replace(/^caldavs?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new DavClientError('Die Adresse sieht nicht richtig aus');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DavClientError('Nur Adressen mit http:// oder https:// gehen');
  if (url.username || url.password) throw new DavClientError('Zugangsdaten gehören nicht in die Adresse');
  url.hash = '';
  url.search = '';
  return url;
}

export function davSession(url: URL, username: string, password: string, allowPrivate: boolean): DavSession {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
    allowPrivate,
    domain: registrable(url.hostname),
  };
}

function send(session: DavSession, method: string, url: URL, headers: Record<string, string>, body?: string) {
  if (!session.allowPrivate && privateLiteral(url)) throw new DavClientError('Adressen im lokalen Netz sind gesperrt');
  const start = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const trusted = registrable(url.hostname) === session.domain;
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = start(
      url,
      {
        method,
        lookup: guardedLookup(() => session.allowPrivate),
        timeout: TIMEOUT,
        headers: {
          'user-agent': `MoeCloud/${config.version} (+https://github.com/MaximilianGT500/moecloud)`,
          accept: 'application/xml, text/xml;q=0.9, */*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
          ...(trusted ? { authorization: session.authorization } : {}),
          ...headers,
          ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
        },
      },
      resolve
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

async function read(response: IncomingMessage, limit: number) {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      response.destroy();
      throw new DavClientError('Ein Kalender auf dem Server ist zu groß zum Importieren');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(error: unknown): DavClientError {
  if (error instanceof DavClientError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'MOE_PRIVATE') return new DavClientError('Adressen im lokalen Netz sind gesperrt');
  if (code === 'MOE_TIMEOUT') return new DavClientError('Der Server antwortet nicht');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new DavClientError('Den Server gibt es nicht');
  if (code === 'ECONNREFUSED') return new DavClientError('Der Server lehnt die Verbindung ab');
  if (code && /CERT|SSL|TLS/i.test(code)) return new DavClientError('Das Zertifikat des Servers ist ungültig');
  return new DavClientError('Die Verbindung ist abgebrochen');
}

interface DavResponse {
  url: URL;
  props: Map<string, XmlNode>;
}

async function call(session: DavSession, method: 'PROPFIND' | 'REPORT', start: URL, depth: '0' | '1', body: string, limit = LISTING) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: IncomingMessage;
    try {
      response = await send(session, method, url, { depth, 'content-type': 'application/xml; charset=utf-8' }, body);
    } catch (error) {
      throw failure(error);
    }
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.resume();
      const next = new URL(response.headers.location, url);
      if ((next.protocol !== 'http:' && next.protocol !== 'https:') || registrable(next.hostname) !== session.domain)
        throw new DavClientError('Der Server leitet auf eine andere Adresse um');
      url = next;
      continue;
    }
    if (status === 401 || status === 403) {
      response.resume();
      throw new DavClientError('Der Server lehnt die Zugangsdaten ab');
    }
    if (status === 404 || status === 405 || status === 501) {
      response.resume();
      return null;
    }
    if (status !== 207) {
      response.resume();
      throw new DavClientError('Der Server hat mit {status} geantwortet', { status });
    }
    let text: string;
    try {
      text = await read(response, limit);
    } catch (error) {
      throw failure(error);
    }
    let xml: XmlNode | null;
    try {
      xml = parseXml(text, limit);
    } catch {
      throw new DavClientError('Die Antwort des Servers ist kein gültiges XML');
    }
    if (!xml || xml.ns !== DAV || xml.name !== 'multistatus') throw new DavClientError('Unter der Adresse gibt es kein CalDAV');
    const responses: DavResponse[] = [];
    for (const entry of children(xml, DAV, 'response')) {
      const href = textOf(child(entry, DAV, 'href'));
      if (!href) continue;
      let target: URL;
      try {
        target = new URL(href, url);
      } catch {
        continue;
      }
      const props = new Map<string, XmlNode>();
      for (const propstat of children(entry, DAV, 'propstat')) {
        const code = /\s(\d{3})\s/.exec(` ${textOf(child(propstat, DAV, 'status'))} `)?.[1];
        if (code && code !== '200') continue;
        for (const prop of child(propstat, DAV, 'prop')?.children ?? []) props.set(`${prop.ns}|${prop.name}`, prop);
      }
      responses.push({ url: target, props });
    }
    return { url, responses };
  }
  throw new DavClientError('Zu viele Weiterleitungen');
}

const prop = (response: DavResponse, ns: string, name: string) => response.props.get(`${ns}|${name}`) ?? null;

const hrefIn = (response: DavResponse, base: URL, ns: string, name: string) => {
  const node = prop(response, ns, name);
  const href = textOf(child(node, DAV, 'href'));
  if (!href) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
};

const isCalendar = (response: DavResponse) => {
  const type = prop(response, DAV, 'resourcetype');
  return Boolean(child(type, CAL, 'calendar')) && !child(type, CS, 'subscribed') && !child(type, CS, 'shared-owner-proxy');
};

const DISCOVER = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/></d:prop></d:propfind>`;
const HOME = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const LIST = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:calendar-description/><c:calendar-timezone/><c:supported-calendar-component-set/></d:prop></d:propfind>`;

function describe(response: DavResponse): RemoteCalendar | null {
  if (!isCalendar(response)) return null;
  const set = prop(response, CAL, 'supported-calendar-component-set');
  const components = set
    ? children(set, CAL, 'comp')
        .map((comp) => (comp.attrs.name ?? '').toUpperCase())
        .filter((name) => name === 'VEVENT' || name === 'VTODO')
    : ['VEVENT', 'VTODO'];
  if (!components.length) return null;
  const zoneText = textOf(prop(response, CAL, 'calendar-timezone'));
  const tzid = /^TZID:(.+)$/m.exec(zoneText.replace(/\r/g, ''))?.[1]?.trim() ?? '';
  const path = decodeURIComponent(response.url.pathname.replace(/\/+$/, '').split('/').pop() ?? '');
  return {
    url: response.url.href.endsWith('/') ? response.url.href : `${response.url.href}/`,
    name: textOf(prop(response, DAV, 'displayname')).slice(0, 100) || path || 'Kalender',
    color: colorOf(textOf(prop(response, APPLE, 'calendar-color'))),
    description: textOf(prop(response, CAL, 'calendar-description')).slice(0, 2000) || null,
    zone: isZone(tzid) ? tzid : null,
    components,
  };
}

async function listHome(session: DavSession, home: URL) {
  const listing = await call(session, 'PROPFIND', home, '1', LIST);
  if (!listing) return [];
  const found: RemoteCalendar[] = [];
  const seen = new Set<string>();
  for (const response of listing.responses) {
    const calendar = describe(response);
    if (!calendar || seen.has(calendar.url)) continue;
    seen.add(calendar.url);
    found.push(calendar);
  }
  return found;
}

export async function discoverCalendars(session: DavSession, start: URL): Promise<RemoteCalendar[]> {
  const candidates = [start];
  const wellKnown = new URL('/.well-known/caldav', start);
  if (start.pathname === '/' || start.pathname === '') candidates.unshift(wellKnown);
  else candidates.push(wellKnown);
  for (const candidate of candidates) {
    const found = await call(session, 'PROPFIND', candidate, '0', DISCOVER);
    if (!found) continue;
    const self = found.responses[0];
    if (!self) continue;
    const direct = describe(self);
    if (direct) return [direct];
    let home = hrefIn(self, found.url, CAL, 'calendar-home-set');
    const principal = hrefIn(self, found.url, DAV, 'current-user-principal');
    if (!home && principal) {
      const own = await call(session, 'PROPFIND', principal, '0', HOME);
      const entry = own?.responses[0];
      if (entry && own) home = hrefIn(entry, own.url, CAL, 'calendar-home-set');
    }
    const calendars = await listHome(session, home ?? found.url);
    if (calendars.length) return calendars;
    if (home) break;
  }
  throw new DavClientError('Auf dem Server hat MoeCloud keine Kalender gefunden');
}

const QUERY = (component: string) =>
  `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${component}"/></c:comp-filter></c:filter></c:calendar-query>`;

const MULTIGET = (hrefs: string[]) =>
  `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs
    .map((href) => `<d:href>${href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</d:href>`)
    .join('')}</c:calendar-multiget>`;

export async function fetchCalendarData(session: DavSession, calendar: RemoteCalendar, limit: number) {
  const url = new URL(calendar.url);
  const texts: string[] = [];
  let bytes = 0;
  for (const component of calendar.components) {
    const result = await call(session, 'REPORT', url, '1', QUERY(component), Math.max(1024, limit - bytes));
    if (!result) continue;
    const missing: string[] = [];
    for (const response of result.responses) {
      if (response.url.pathname.replace(/\/+$/, '') === url.pathname.replace(/\/+$/, '')) continue;
      const data = textOf(prop(response, CAL, 'calendar-data'));
      if (data) {
        texts.push(data);
        bytes += data.length;
      } else missing.push(response.url.pathname);
    }
    for (let index = 0; index < missing.length; index += 100) {
      const batch = await call(session, 'REPORT', url, '1', MULTIGET(missing.slice(index, index + 100)), Math.max(1024, limit - bytes));
      for (const response of batch?.responses ?? []) {
        const data = textOf(prop(response, CAL, 'calendar-data'));
        if (!data) continue;
        texts.push(data);
        bytes += data.length;
      }
    }
    if (bytes > limit) throw new DavClientError('Ein Kalender auf dem Server ist zu groß zum Importieren');
  }
  return { texts, bytes };
}
