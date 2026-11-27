import { hmac, safeEqual } from '../lib/crypto.ts';
import { HttpError } from '../lib/errors.ts';
import { fetchRemote } from '../lib/remote.ts';
import * as settings from './settings.ts';

const DAY = 24 * 60 * 60;
const LIMIT = 6 * 1024 * 1024;
const TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;

const keyOf = () => `${settings.secret()}:image-proxy`;

export function proxied(url: string, days = 7) {
  const expires = (Math.floor(Date.now() / 1000) + days * DAY).toString(36);
  const encoded = Buffer.from(url).toString('base64url');
  const signature = hmac(keyOf(), `${encoded}.${expires}`).slice(0, 32);
  return `/api/proxy/image?u=${encoded}&e=${expires}&s=${signature}`;
}

export function rewriteRemoteImages(html: string, base: string) {
  const wrap = (url: string) => `${base}${proxied(url.replace(/&amp;/g, '&'))}`.replace(/&/g, '&amp;');
  return html
    .replace(/(\s(?:src|background|poster)=")(https?:\/\/[^"]+)"/gi, (_match, prefix: string, url: string) => `${prefix}${wrap(url)}"`)
    .replace(/url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi, (_match, quote: string, url: string) => `url(${quote}${wrap(url)}${quote})`);
}

export async function loadProxied(query: { u?: string; e?: string; s?: string }) {
  const { u, e, s } = query;
  if (!u || !e || !s || !/^[\w-]+$/.test(u) || !/^[0-9a-z]+$/.test(e))
    throw new HttpError(400, 'Die Adresse des Bildes ist ungültig', 'proxy_bad');
  if (!safeEqual(hmac(keyOf(), `${u}.${e}`).slice(0, 32), s))
    throw new HttpError(403, 'Die Adresse des Bildes ist ungültig', 'proxy_signature');
  if (Number.parseInt(e, 36) * 1000 < Date.now()) throw new HttpError(410, 'Die Adresse des Bildes ist abgelaufen', 'proxy_expired');
  const url = Buffer.from(u, 'base64url').toString('utf8');
  const fetched = await fetchRemote(url, {
    allowPrivate: settings.get('feeds.private'),
    limit: LIMIT,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
    timeout: 10_000,
  });
  if (fetched.status < 200 || fetched.status >= 300) throw new HttpError(404, 'Das Bild ist nicht da', 'proxy_missing');
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(fetched.body);
  const svg = !detected && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(fetched.body.subarray(0, 4096).toString('utf8'));
  const type = svg ? 'image/svg+xml' : (detected?.mime ?? '');
  if (!TYPES.test(type)) throw new HttpError(415, 'Das ist kein Bild', 'proxy_type');
  return { type, body: fetched.body };
}
