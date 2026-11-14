import { createReadStream } from 'node:fs';
import { pipeline, type Transform } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const FILE_CSP =
  "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; font-src 'self' data:";
export const PDF_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'";

export function contentDisposition(name: string, type: 'inline' | 'attachment') {
  const fallback =
    name
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\%]/g, '_')
      .trim() || 'download';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  if (tail === undefined) return left;
  const right = tail ? tail.split(':') : [];
  return [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'), ...right];
}

export function truncateIp(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0`;
  return `${expandIpv6(ip.split('%')[0]).slice(0, 3).join(':')}::`;
}

export const originOf = (request: FastifyRequest) => `${request.protocol}://${request.host}`;

export function sameOrigin(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === originOf(request);
}

export const isSecure = (request: FastifyRequest) => request.protocol === 'https';

export function safeRedirect(target: unknown, fallback = '/files'): string {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

export interface FileResponse {
  path: string;
  size: number;
  type: string;
  etag: string;
  modified: number;
  name: string;
  disposition: 'inline' | 'attachment';
  cache?: string;
  csp?: string;
  transform?: (start: number) => Transform;
}

const RANGE = /^bytes=(\d*)-(\d*)$/;

export function sendFile(request: FastifyRequest, reply: FastifyReply, file: FileResponse) {
  const etag = `"${file.etag}"`;
  reply.header('ETag', etag);
  reply.header('Last-Modified', new Date(file.modified).toUTCString());
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cache-Control', file.cache ?? 'private, no-cache');
  reply.header('Content-Type', file.type);
  reply.header('Content-Disposition', contentDisposition(file.name, file.disposition));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Content-Security-Policy', file.csp ?? FILE_CSP);

  const match = request.headers['if-none-match'];
  if (match && (match === '*' || match.split(',').some((value) => value.trim() === etag))) return reply.code(304).send();

  let start = 0;
  let end = file.size - 1;
  let partial = false;
  const range = request.headers.range;
  const ifRange = request.headers['if-range'];
  if (range && file.size > 0 && (!ifRange || ifRange === etag)) {
    const parsed = RANGE.exec(range.trim());
    if (parsed && (parsed[1] || parsed[2])) {
      if (parsed[1]) {
        start = Number(parsed[1]);
        end = parsed[2] ? Math.min(Number(parsed[2]), file.size - 1) : file.size - 1;
      } else {
        start = Math.max(0, file.size - Number(parsed[2]));
      }
      if (start > end || start >= file.size) {
        reply.header('Content-Range', `bytes */${file.size}`);
        return reply.code(416).send();
      }
      partial = true;
    }
  }

  const length = file.size === 0 ? 0 : end - start + 1;
  reply.header('Content-Length', length);
  if (partial) {
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${file.size}`);
  }
  if (request.method === 'HEAD' || length === 0) return reply.send();
  const stream = createReadStream(file.path, { start, end });
  if (!file.transform) return reply.send(stream);
  return reply.send(pipeline(stream, file.transform(start), () => undefined));
}

export function serializeJson(data: unknown) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
