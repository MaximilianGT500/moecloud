import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, badRequest, forbidden, tooMany } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { extensionFor } from '../lib/mime.ts';
import { cleanName } from '../lib/names.ts';
import { log } from '../lib/log.ts';
import { guardedLookup, isPublicAddress, privateLiteral } from '../lib/netguard.ts';
import { requireFolder } from './nodes.ts';
import { notify } from './notify.ts';
import * as settings from './settings.ts';
import { uploadStream } from './uploads.ts';
import { getUser, inactive, type UserRow } from './users.ts';

export interface ImportJob {
  id: string;
  userId: number;
  parentId: string;
  url: string;
  name: string | null;
  status: 'running' | 'done' | 'failed';
  received: number;
  total: number | null;
  error: string | null;
  nodeId: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const MAX_REDIRECTS = 5;
const TIMEOUT = 30_000;
const PER_USER = 3;
const KEEP = 60 * 60 * 1000;

const jobs = new Map<string, ImportJob>();
const pending = new Map<string, Promise<void>>();

export const importsSettled = () => Promise.all([...pending.values()]);

const allowPrivate = () => settings.get('import.private');

const safeLookup = guardedLookup(allowPrivate);

export { isPublicAddress };

export function parseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw badRequest('Die Adresse sieht nicht richtig aus');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Nur Adressen mit http:// oder https:// gehen');
  url.hash = '';
  return url;
}

function checkLiteral(url: URL) {
  if (!allowPrivate() && privateLiteral(url)) throw forbidden('Adressen im lokalen Netz sind für Downloads gesperrt');
}

interface Opened {
  response: IncomingMessage;
  url: URL;
}

function get(url: URL): Promise<IncomingMessage> {
  checkLiteral(url);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT,
        headers: { 'user-agent': `MoeCloud/${config.version}`, accept: '*/*' },
      },
      resolve
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end();
  });
}

export async function open(start: URL): Promise<Opened> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await get(url);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = parseUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw badRequest('Der Server hat mit {status} geantwortet', { status });
    }
    return { response, url };
  }
  throw badRequest('Zu viele Weiterleitungen');
}

function nameFromDisposition(header: string | undefined) {
  if (!header) return '';
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  return (plain?.[2] ?? plain?.[1] ?? '').trim();
}

export function fileName(url: URL, disposition: string | undefined, type: string | undefined) {
  let name = nameFromDisposition(disposition);
  if (!name) {
    const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
  }
  name = name.replace(/[/\\\u0000-\u001f\u007f]/g, '_').trim();
  const fallback = !name || name === '.' || name === '..';
  if (fallback) name = url.hostname || 'download';
  if ((fallback || !/\.[a-z0-9]{1,8}$/i.test(name)) && type) {
    const extension = extensionFor(type.split(';')[0].trim().toLowerCase());
    if (extension) name += `.${extension}`;
  }
  while (Buffer.byteLength(name) > 240) name = name.slice(0, -1);
  return name;
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

function counter(job: ImportJob) {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      job.received += chunk.length;
      done(null, chunk);
    },
  });
}

function tidy() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > KEEP) jobs.delete(id);
}

const present = ({ userId: _user, ...job }: ImportJob) => job;

export const listImports = (user: UserRow) =>
  [...jobs.values()]
    .filter((job) => job.userId === user.id)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(present);

async function work(job: ImportJob, lang: Lang) {
  try {
    const opened = await open(new URL(job.url));
    const length = Number(opened.response.headers['content-length']);
    job.total = Number.isFinite(length) && length >= 0 ? length : null;
    const name = cleanName(
      job.name || fileName(opened.url, opened.response.headers['content-disposition'], opened.response.headers['content-type'])
    );
    const user = getUser(job.userId);
    if (!user || inactive(user)) throw forbidden('Dein Konto ist gesperrt, wende dich an die Verwaltung');
    opened.response.setTimeout(TIMEOUT * 2, () =>
      opened.response.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' }))
    );
    const body = opened.response.pipe(counter(job));
    opened.response.once('error', (error) => body.destroy(error));
    opened.response.once('aborted', () => body.destroy(Object.assign(new Error('Abgebrochen'), { code: 'ECONNRESET' })));
    const node = await uploadStream(
      { user, link: null },
      { parentId: job.parentId, name, conflict: 'rename' },
      body,
      job.total ?? undefined
    );
    job.status = 'done';
    job.name = node.name;
    job.nodeId = node.id;
    notify(job.userId, 'import_done', { name: node.name }, `/files/folder/${node.parent_id}`, { email: false });
  } catch (error) {
    job.status = 'failed';
    job.error = reason(lang, error);
    log.info({ host: new URL(job.url).host, error: (error as Error).message }, 'Download aus dem Internet fehlgeschlagen');
    notify(job.userId, 'import_failed', { host: new URL(job.url).host, error: job.error }, null, { email: false });
  } finally {
    job.finishedAt = Date.now();
  }
}

export function startImport(user: UserRow, parentId: string, input: { url: string; name?: string | null }, lang: Lang) {
  if (!settings.get('import.enabled')) throw forbidden('Downloads aus dem Internet sind ausgeschaltet');
  requireFolder(user, parentId, 'edit');
  const url = parseUrl(input.url);
  checkLiteral(url);
  const name = input.name?.trim() ? cleanName(input.name) : null;
  tidy();
  const running = [...jobs.values()].filter((job) => job.userId === user.id && job.status === 'running').length;
  if (running >= PER_USER) throw tooMany('Es laufen schon drei Downloads, warte, bis einer fertig ist');
  const job: ImportJob = {
    id: randomId(12),
    userId: user.id,
    parentId,
    url: url.href,
    name,
    status: 'running',
    received: 0,
    total: null,
    error: null,
    nodeId: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  const promise = work(job, lang).finally(() => pending.delete(job.id));
  pending.set(job.id, promise);
  return present(job);
}
