import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { config } from '../config.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';

export class RemoteError extends Error {
  status: number;
  params: Record<string, string | number>;
  constructor(message: string, status = 0, params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.params = params;
  }
}

export interface RemoteResult {
  status: number;
  text: string;
  etag: string | null;
  modified: string | null;
  url: string;
}

export function normalizeFeedUrl(input: string) {
  const trimmed = input
    .trim()
    .replace(/^webcals?:\/\//i, 'https://')
    .replace(/^feed:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RemoteError('Die Adresse sieht nicht richtig aus');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new RemoteError('Nur Adressen mit http://, https:// oder webcal:// gehen');
  url.hash = '';
  return url;
}

function open(url: URL, allowPrivate: boolean, headers: Record<string, string>, timeout: number) {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const lookup = guardedLookup(() => allowPrivate);
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        lookup,
        timeout,
        headers: {
          'user-agent': `MoeCloud/${config.version} (+https://github.com/MaximilianGT500/moecloud)`,
          accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
          ...headers,
        },
        ...(url.username ? { auth: `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` } : {}),
      },
      resolve
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end();
  });
}

async function body(response: IncomingMessage, limit: number) {
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
      throw new RemoteError('Die Datei ist zu groß');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchText(
  input: string,
  options: { allowPrivate: boolean; etag?: string | null; modified?: string | null; limit?: number; timeout?: number }
): Promise<RemoteResult> {
  let url = normalizeFeedUrl(input);
  for (let hop = 0; hop < 6; hop++) {
    if (!options.allowPrivate && privateLiteral(url)) throw new RemoteError('Adressen im lokalen Netz sind gesperrt');
    const headers: Record<string, string> = {};
    if (hop === 0 && options.etag) headers['if-none-match'] = options.etag;
    if (hop === 0 && options.modified) headers['if-modified-since'] = options.modified;
    let response: IncomingMessage;
    try {
      response = await open(url, options.allowPrivate, headers, options.timeout ?? 20_000);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'MOE_PRIVATE') throw new RemoteError('Adressen im lokalen Netz sind gesperrt');
      if (code === 'MOE_TIMEOUT') throw new RemoteError('Der Server hat nicht rechtzeitig geantwortet');
      if (code === 'ENOTFOUND' || (error as Error).message === 'ENOTFOUND') throw new RemoteError('Diese Adresse gibt es nicht');
      throw new RemoteError('Der Server ist nicht erreichbar');
    }
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RemoteError('Die Weiterleitung führt ins Leere');
      continue;
    }
    if (status === 304) {
      response.resume();
      return { status, text: '', etag: options.etag ?? null, modified: options.modified ?? null, url: url.href };
    }
    if (status === 401 || status === 403) {
      response.resume();
      throw new RemoteError('Der Server verlangt eine Anmeldung', status);
    }
    if (status === 404 || status === 410) {
      response.resume();
      throw new RemoteError('Unter dieser Adresse gibt es keinen Kalender (mehr)', status);
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new RemoteError('Der Server hat mit {status} geantwortet', status, { status });
    }
    const text = await body(response, options.limit ?? 20 * 1024 * 1024);
    return {
      status,
      text,
      etag: typeof response.headers.etag === 'string' ? response.headers.etag : null,
      modified: typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'] : null,
      url: url.href,
    };
  }
  throw new RemoteError('Zu viele Weiterleitungen');
}
