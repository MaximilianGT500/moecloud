import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { config } from '../config.ts';
import { HttpError } from './errors.ts';
import { guardedLookup, privateLiteral } from './netguard.ts';

export interface Fetched {
  status: number;
  url: string;
  type: string;
  charset: string | null;
  body: Buffer;
  etag: string | null;
  modified: string | null;
}

export interface FetchOptions {
  allowPrivate: boolean;
  limit: number;
  accept: string;
  timeout?: number;
  etag?: string | null;
  modified?: string | null;
  range?: string;
}

export function webUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^feed:\/\//i, 'https://'));
  } catch {
    throw new HttpError(400, 'Die Adresse sieht nicht richtig aus', 'bad_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new HttpError(400, 'Nur Adressen mit http:// oder https:// gehen', 'bad_url');
  if (url.username || url.password) throw new HttpError(400, 'Zugangsdaten gehören nicht in die Adresse', 'bad_url');
  url.hash = '';
  return url;
}

function open(url: URL, options: FetchOptions, headers: Record<string, string>) {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(() => options.allowPrivate),
        timeout: options.timeout ?? 15_000,
        headers: {
          'user-agent': `Mozilla/5.0 (compatible; MoeCloud/${config.version}; +https://github.com/MaximilianGT500/moecloud)`,
          accept: options.accept,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'de,en;q=0.8',
          ...headers,
        },
      },
      resolve
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end();
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
      throw new HttpError(413, 'Die Antwort ist zu groß', 'remote_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function follow(input: string | URL, options: FetchOptions, extra: Record<string, string> = {}) {
  let url = typeof input === 'string' ? webUrl(input) : input;
  for (let hop = 0; hop < 6; hop++) {
    if (!options.allowPrivate && privateLiteral(url)) throw new HttpError(400, 'Adressen im lokalen Netz sind gesperrt', 'remote_private');
    const headers: Record<string, string> = { ...extra };
    if (hop === 0 && options.etag) headers['if-none-match'] = options.etag;
    if (hop === 0 && options.modified) headers['if-modified-since'] = options.modified;
    if (options.range) headers.range = options.range;
    let response: IncomingMessage;
    try {
      response = await open(url, options, headers);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'MOE_PRIVATE') throw new HttpError(400, 'Adressen im lokalen Netz sind gesperrt', 'remote_private');
      if (code === 'MOE_TIMEOUT') throw new HttpError(424, 'Die Seite hat nicht rechtzeitig geantwortet', 'remote_timeout');
      if (code === 'ENOTFOUND' || (error as Error).message === 'ENOTFOUND')
        throw new HttpError(400, 'Diese Adresse gibt es nicht', 'remote_dns');
      throw new HttpError(424, 'Die Seite ist nicht erreichbar', 'remote_unreachable');
    }
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new HttpError(424, 'Die Weiterleitung führt ins Leere', 'remote_redirect');
      continue;
    }
    return { url, status, response };
  }
  throw new HttpError(424, 'Zu viele Weiterleitungen', 'remote_redirect');
}

export async function streamRemote(input: string | URL, options: Omit<FetchOptions, 'limit' | 'etag' | 'modified'>) {
  const { url, status, response } = await follow(input, { ...options, limit: 0 }, { 'accept-encoding': 'identity' });
  response.setTimeout(0);
  const header = (name: string) => {
    const value = response.headers[name];
    return typeof value === 'string' ? value : null;
  };
  const declared = header('content-length');
  const length = declared === null ? null : Number(declared);
  return {
    status,
    url: url.href,
    type: String(header('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase(),
    length: length !== null && Number.isSafeInteger(length) && length >= 0 ? length : null,
    range: header('content-range'),
    ranges: header('accept-ranges') === 'bytes',
    response,
  };
}

export async function fetchRemote(input: string | URL, options: FetchOptions): Promise<Fetched> {
  const { url, status, response } = await follow(input, options);
  const type = String(response.headers['content-type'] ?? '').toLowerCase();
  const result = {
    status,
    url: url.href,
    type: type.split(';')[0].trim(),
    charset: /charset=["']?([\w.:-]+)/i.exec(type)?.[1] ?? null,
    etag: typeof response.headers.etag === 'string' ? response.headers.etag : null,
    modified: typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'] : null,
  };
  if (status === 304 || status < 200 || status >= 300) {
    response.resume();
    return { ...result, body: Buffer.alloc(0) };
  }
  return { ...result, body: await read(response, options.limit) };
}

export function decodeBody(body: Buffer, charset: string | null, sniff = true) {
  let label = charset;
  if (!label && sniff) {
    const head = body.subarray(0, 2048).toString('latin1');
    label =
      /<\?xml[^>]+encoding=["']([\w.:-]+)["']/i.exec(head)?.[1] ??
      /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content=["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1] ??
      null;
  }
  try {
    return new TextDecoder(label ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
