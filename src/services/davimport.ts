import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, badRequest, conflict, forbidden } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { cleanName, nameKey, uniqueName } from '../lib/names.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';
import { parseUrl } from './imports.ts';
import { changed, createFolder, ensurePath, requireFolder, taken } from './nodes.ts';
import { notify } from './notify.ts';
import * as settings from './settings.ts';
import { uploadStream } from './uploads.ts';
import { getUser, inactive, type UserRow } from './users.ts';

export interface DavJob {
  id: string;
  userId: number;
  parentId: string;
  folderId: string;
  folder: string;
  host: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  found: number;
  files: number;
  folders: number;
  bytes: number;
  failed: number;
  problems: string[];
  current: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface Remote {
  root: URL;
  authorization: string;
}

export interface DavEntry {
  href: string;
  folder: boolean;
  size: number | null;
  modifiedAt: number | null;
}

const TIMEOUT = 30_000;
const MAX_REDIRECTS = 5;
const MAX_LISTING = 32 * 1024 * 1024;
const MAX_DEPTH = 40;
const MAX_FILES = 500_000;
const PARALLEL = 3;
const KEEP = 6 * 60 * 60 * 1000;
const PROBLEMS = 20;

const jobs = new Map<string, DavJob>();
const pending = new Map<string, Promise<void>>();
const cancelled = new Set<string>();

export const davImportsSettled = () => Promise.all([...pending.values()]);

const allowPrivate = () => settings.get('import.private');
const lookup = guardedLookup(allowPrivate);

const PROPFIND =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

const unescapeXml = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const tag = (name: string) => new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i');

export function parseMultistatus(xml: string): DavEntry[] {
  const entries: DavEntry[] = [];
  const blocks = xml.matchAll(/<(?:[\w.-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?response\s*>/gi);
  for (const block of blocks) {
    const body = block[1];
    const href = tag('href').exec(body)?.[1];
    if (!href) continue;
    const type = tag('resourcetype').exec(body)?.[1] ?? '';
    const length = tag('getcontentlength').exec(body)?.[1]?.trim();
    const modified = tag('getlastmodified').exec(body)?.[1]?.trim();
    const size = length && /^\d+$/.test(length) ? Number(length) : null;
    const time = modified ? Date.parse(unescapeXml(modified)) : NaN;
    entries.push({
      href: unescapeXml(href.trim()),
      folder: /<(?:[\w.-]+:)?collection[\s/>]/i.test(type),
      size,
      modifiedAt: Number.isFinite(time) && time > 0 ? time : null,
    });
  }
  return entries;
}

function send(remote: Remote, method: string, url: URL, headers: Record<string, string>, body?: string): Promise<IncomingMessage> {
  if (!allowPrivate() && privateLiteral(url)) throw forbidden('Adressen im lokalen Netz sind für Downloads gesperrt');
  const start = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = start(
      url,
      {
        method,
        lookup,
        timeout: TIMEOUT,
        headers: {
          'user-agent': `MoeCloud/${config.version}`,
          accept: '*/*',
          ...(url.origin === remote.root.origin ? { authorization: remote.authorization } : {}),
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

async function open(remote: Remote, method: 'PROPFIND' | 'GET', start: URL, headers: Record<string, string>, body?: string) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await send(remote, method, url, headers, body);
    const status = response.statusCode ?? 0;
    if ([301, 302, 307, 308].includes(status) && response.headers.location) {
      response.resume();
      const next = parseUrl(new URL(response.headers.location, url).href);
      if (next.origin !== remote.root.origin) throw badRequest('Der Server leitet auf eine andere Adresse um');
      url = next;
      continue;
    }
    if (status === 401 || status === 403) {
      response.resume();
      throw badRequest('Der Server lehnt die Zugangsdaten ab');
    }
    if (status === 404) {
      response.resume();
      throw badRequest(method === 'GET' ? 'Die Datei gibt es auf dem Server nicht mehr' : 'Unter der Adresse gibt es keinen WebDAV-Ordner');
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw badRequest('Der Server hat mit {status} geantwortet', { status });
    }
    return { response, url };
  }
  throw badRequest('Zu viele Weiterleitungen');
}

async function text(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_LISTING) {
      response.destroy();
      throw badRequest('Ein Ordner auf dem Server ist zu groß zum Auflisten');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const withSlash = (url: URL) => {
  const copy = new URL(url.href);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
};

const samePath = (a: URL, b: URL) => decodePath(a.pathname).replace(/\/+$/, '') === decodePath(b.pathname).replace(/\/+$/, '');

function decodePath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function list(remote: Remote, folder: URL) {
  const { response, url } = await open(
    remote,
    'PROPFIND',
    folder,
    { depth: '1', 'content-type': 'application/xml; charset=utf-8' },
    PROPFIND
  );
  const base = withSlash(url);
  const xml = await text(response);
  if (!/<(?:[\w.-]+:)?multistatus[\s>]/i.test(xml)) throw badRequest('Unter der Adresse gibt es keinen WebDAV-Ordner');
  const children: (DavEntry & { url: URL; name: string })[] = [];
  for (const entry of parseMultistatus(xml)) {
    let target: URL;
    try {
      target = new URL(entry.href, base);
    } catch {
      continue;
    }
    if (target.origin !== base.origin || samePath(target, base)) continue;
    const inside = decodePath(target.pathname);
    const prefix = decodePath(base.pathname);
    if (!inside.startsWith(prefix)) continue;
    const name = inside.slice(prefix.length).replace(/\/+$/, '');
    if (!name || name.includes('/')) continue;
    children.push({ ...entry, url: entry.folder ? withSlash(target) : target, name });
  }
  return children;
}

function reason(lang: Lang, error: unknown) {
  if (error instanceof HttpError) return t(lang, error.message, error.params);
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'MOE_PRIVATE') return t(lang, 'Adressen im lokalen Netz sind für Downloads gesperrt');
  if (code === 'MOE_TIMEOUT') return t(lang, 'Der Server antwortet nicht');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return t(lang, 'Den Server gibt es nicht');
  if (code === 'ECONNREFUSED') return t(lang, 'Der Server lehnt die Verbindung ab');
  if (code && /CERT|SSL|TLS/i.test(code)) return t(lang, 'Das Zertifikat des Servers ist ungültig');
  return t(lang, 'Die Verbindung ist abgebrochen');
}

const fatal = (error: unknown) =>
  error instanceof HttpError && ([403, 404, 507].includes(error.status) || error.message === 'Dein Speicher ist voll');

function safeName(raw: string) {
  try {
    return cleanName(raw);
  } catch {
    return null;
  }
}

interface RemoteFile {
  url: URL;
  name: string;
  size: number | null;
  modifiedAt: number | null;
}

async function fetchFile(job: DavJob, remote: Remote, user: UserRow, entry: RemoteFile, folderId: string) {
  const { response } = await open(remote, 'GET', entry.url, {});
  response.setTimeout(TIMEOUT * 2, () => response.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
  const body = response.pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        job.bytes += chunk.length;
        done(null, chunk);
      },
    })
  );
  response.once('error', (error) => body.destroy(error));
  response.once('aborted', () => body.destroy(Object.assign(new Error('Abgebrochen'), { code: 'ECONNRESET' })));
  await uploadStream(
    { user, link: null },
    { parentId: folderId, name: entry.name, conflict: 'rename', modifiedAt: entry.modifiedAt },
    body,
    entry.size ?? undefined
  );
}

async function work(job: DavJob, remote: Remote, lang: Lang) {
  const active = new Set<Promise<void>>();
  let stop: unknown = null;
  const problem = (path: string[], name: string, error: unknown) => {
    job.failed += 1;
    if (job.problems.length < PROBLEMS) job.problems.push(`${[...path, name].join('/')}: ${reason(lang, error)}`);
  };
  try {
    const queue: { url: URL; path: string[]; folderId: string }[] = [{ url: withSlash(remote.root), path: [], folderId: job.folderId }];
    while (queue.length && !stop) {
      if (cancelled.has(job.id)) break;
      const folder = queue.shift()!;
      let children: Awaited<ReturnType<typeof list>>;
      try {
        children = await list(remote, folder.url);
      } catch (error) {
        if (folder.path.length === 0) throw error;
        problem(folder.path.slice(0, -1), folder.path.at(-1)!, error);
        continue;
      }
      const user = getUser(job.userId);
      if (!user || inactive(user)) throw forbidden('Dein Konto ist gesperrt, wende dich an die Verwaltung');
      const names = new Set<string>();
      job.found += children.filter((child) => !child.folder).length;
      if (job.found > MAX_FILES) throw badRequest('Das sind zu viele Dateien für einen Import');
      for (const child of children) {
        if (stop || cancelled.has(job.id)) break;
        const name = safeName(child.name);
        if (!name) {
          if (!child.folder) problem(folder.path, child.name, badRequest('Der Name geht in MoeCloud nicht'));
          continue;
        }
        if (child.folder) {
          if (folder.path.length >= MAX_DEPTH) {
            problem(folder.path, name, badRequest('Der Ordner liegt zu tief'));
            continue;
          }
          const unique = uniqueName(name, true, (key) => names.has(key));
          names.add(nameKey(unique));
          const owner = requireFolder(user, folder.folderId, 'edit').node.owner_id;
          const folderId = ensurePath(owner, user.id, folder.folderId, [unique]);
          job.folders += 1;
          queue.push({ url: child.url, path: [...folder.path, unique], folderId });
          continue;
        }
        while (active.size >= PARALLEL) await Promise.race(active);
        if (stop || cancelled.has(job.id)) break;
        job.current = [...folder.path, name].join('/');
        const task = fetchFile(job, remote, user, { ...child, name }, folder.folderId)
          .then(() => {
            job.files += 1;
          })
          .catch((error: unknown) => {
            if (fatal(error)) stop = error;
            else problem(folder.path, name, error);
          })
          .finally(() => active.delete(task));
        active.add(task);
      }
    }
    await Promise.all(active);
    if (stop) throw stop;
    job.status = cancelled.has(job.id) ? 'cancelled' : 'done';
  } catch (error) {
    await Promise.all(active);
    job.status = 'failed';
    job.error = reason(lang, error);
    log.info({ host: job.host, error: (error as Error).message }, 'Import über WebDAV fehlgeschlagen');
  } finally {
    job.current = null;
    job.finishedAt = Date.now();
    cancelled.delete(job.id);
    changed([job.folderId, job.parentId]);
    const url = `/files/folder/${job.folderId}`;
    const params = { folder: job.folder, host: job.host, files: job.files, failed: job.failed, error: job.error ?? '' };
    if (job.status === 'done') notify(job.userId, job.failed ? 'dav_import_partial' : 'dav_import_done', params, url);
    else if (job.status === 'failed') notify(job.userId, 'dav_import_failed', params, job.files ? url : null);
  }
}

function tidy() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > KEEP) jobs.delete(id);
}

const present = ({ userId: _user, ...job }: DavJob) => job;

export const listDavImports = (user: UserRow) =>
  [...jobs.values()]
    .filter((job) => job.userId === user.id)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(present);

export function cancelDavImport(user: UserRow, id: string) {
  const job = jobs.get(id);
  if (!job || job.userId !== user.id) return false;
  if (job.status === 'running') cancelled.add(id);
  return true;
}

export function startDavImport(
  user: UserRow,
  parentId: string,
  input: { url: string; username: string; password: string; name?: string | null },
  lang: Lang
) {
  if (!settings.get('import.enabled')) throw forbidden('Downloads aus dem Internet sind ausgeschaltet');
  const parent = requireFolder(user, parentId, 'edit').node;
  const root = parseUrl(input.url);
  if (root.username || root.password) throw badRequest('Zugangsdaten gehören nicht in die Adresse');
  root.search = '';
  if (!allowPrivate() && privateLiteral(root)) throw forbidden('Adressen im lokalen Netz sind für Downloads gesperrt');
  tidy();
  if ([...jobs.values()].some((job) => job.userId === user.id && job.status === 'running')) {
    throw conflict('Es läuft schon ein Import, warte, bis er fertig ist');
  }
  const wanted = input.name?.trim() ? cleanName(input.name) : cleanName(t(lang, 'Import von {host}', { host: root.hostname }));
  const folder = createFolder(user, parent.id, uniqueName(wanted, true, taken(parent.id)));
  const job: DavJob = {
    id: randomId(12),
    userId: user.id,
    parentId: parent.id,
    folderId: folder.id,
    folder: folder.name,
    host: root.host,
    status: 'running',
    found: 0,
    files: 0,
    folders: 0,
    bytes: 0,
    failed: 0,
    problems: [],
    current: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  const authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`, 'utf8').toString('base64')}`;
  const promise = work(job, { root, authorization }, lang).finally(() => pending.delete(job.id));
  pending.set(job.id, promise);
  return present(job);
}
