import { readFile } from 'node:fs/promises';
import type { Address, Email } from 'postal-mime';
import { badRequest, notFound } from '../lib/errors.ts';
import { escapeHtml } from '../lib/http.ts';
import { blobPath } from './blobs.ts';
import type { NodeRow } from './nodes.ts';
import { assertNotInfected } from './scan.ts';

export const EMAIL_LIMIT = 25 * 1024 * 1024;
const INLINE_LIMIT = 5 * 1024 * 1024;
const KEEP = 2 * 60 * 1000;
const CACHED = 6;

export const EMAIL_CSP =
  "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'";

const HEAD =
  '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank">' +
  '<style>html{background:#fff;color:#1d1b20}body{margin:16px;font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}' +
  'img{max-width:100%;height:auto}.moe-text{white-space:pre-wrap}</style>';

const cache = new Map<string, { at: number; email: Promise<Email> }>();

export const isEmail = (node: Pick<NodeRow, 'name' | 'mime'>) => node.mime === 'message/rfc822' || /\.eml$/i.test(node.name);

function load(node: NodeRow) {
  if (node.type !== 'file' || !node.sha256 || !isEmail(node)) throw badRequest('Das ist keine E-Mail');
  if (node.size > EMAIL_LIMIT) throw badRequest('Die E-Mail ist zu groß für die Vorschau');
  assertNotInfected(node.sha256);
  const now = Date.now();
  for (const [key, entry] of cache) if (now - entry.at > KEEP) cache.delete(key);
  const sha = node.sha256;
  const known = cache.get(sha);
  if (known) return known.email;
  const email = import('postal-mime').then(async ({ default: PostalMime }) =>
    PostalMime.parse(await readFile(blobPath(sha)), { attachmentEncoding: 'arraybuffer', maxPartCount: 2000 })
  );
  email.catch(() => cache.delete(sha));
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!);
  cache.set(sha, { at: now, email });
  return email;
}

async function parsed(node: NodeRow) {
  try {
    return await load(node);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    throw badRequest('Die E-Mail lässt sich nicht lesen');
  }
}

const people = (list: Address[] | Address | undefined) =>
  (Array.isArray(list) ? list : list ? [list] : [])
    .flatMap((entry) => ('group' in entry && entry.group ? entry.group : [entry]))
    .map((entry) => ({ name: entry.name || '', address: 'address' in entry ? entry.address || '' : '' }))
    .filter((entry) => entry.name || entry.address);

const contentKey = (id: string | undefined) => id?.replace(/[<>\s]/g, '').toLowerCase() || null;

const bytesOf = (content: ArrayBuffer | Uint8Array | string) =>
  typeof content === 'string' ? Buffer.from(content) : content instanceof ArrayBuffer ? Buffer.from(content) : Buffer.from(content);

export function attachmentName(name: string | null | undefined, index: number) {
  const clean = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, 200);
  return clean && clean !== '.' && clean !== '..' ? clean : `Anhang ${index + 1}`;
}

const referenced = (email: Email) => {
  const html = email.html ?? '';
  return new Set(
    [...html.matchAll(/\bcid:([^"'\s)>]+)/gi)].map((match) => {
      try {
        return decodeURIComponent(match[1]).toLowerCase();
      } catch {
        return match[1].toLowerCase();
      }
    })
  );
};

export async function emailSummary(node: NodeRow) {
  const email = await parsed(node);
  const inline = referenced(email);
  return {
    subject: email.subject ?? '',
    from: people(email.from),
    to: people(email.to),
    cc: people(email.cc),
    replyTo: people(email.replyTo),
    date: email.date && !Number.isNaN(Date.parse(email.date)) ? Date.parse(email.date) : null,
    html: Boolean(email.html),
    remote: /<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i.test(email.html ?? ''),
    attachments: email.attachments
      .map((attachment, index) => ({
        index,
        name: attachmentName(attachment.filename, index),
        type: /^[\w.+-]+\/[\w.+-]+$/.test(attachment.mimeType) ? attachment.mimeType : 'application/octet-stream',
        size: bytesOf(attachment.content).length,
        inline: Boolean(contentKey(attachment.contentId) && inline.has(contentKey(attachment.contentId)!)),
      }))
      .filter((attachment) => !attachment.inline),
  };
}

export async function emailBody(node: NodeRow) {
  const email = await parsed(node);
  if (!email.html) return `${HEAD}<div class="moe-text">${escapeHtml(email.text ?? '')}</div>`;
  const images = new Map<string, string>();
  for (const attachment of email.attachments) {
    const key = contentKey(attachment.contentId);
    if (!key || !/^image\/[\w.+-]+$/.test(attachment.mimeType)) continue;
    const data = bytesOf(attachment.content);
    if (data.length <= INLINE_LIMIT) images.set(key, `data:${attachment.mimeType};base64,${data.toString('base64')}`);
  }
  const html = email.html.replace(/\bcid:([^"'\s)>]+)/gi, (_match, id: string) => {
    let key = id.toLowerCase();
    try {
      key = decodeURIComponent(id).toLowerCase();
    } catch {}
    return images.get(key) ?? 'data:,';
  });
  return `${HEAD}${html}`;
}

export async function emailAttachment(node: NodeRow, index: number) {
  const email = await parsed(node);
  const attachment = Number.isInteger(index) ? email.attachments[index] : undefined;
  if (!attachment) throw notFound('Diesen Anhang gibt es nicht');
  return { name: attachmentName(attachment.filename, index), data: bytesOf(attachment.content) };
}
