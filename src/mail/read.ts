import type { Address as PostalAddress, Email } from 'postal-mime';
import { one } from '../lib/db.ts';
import { defuse } from '../lib/defuse.ts';
import { HttpError } from '../lib/errors.ts';
import { escapeHtml } from '../lib/http.ts';
import { attachmentName, EMAIL_HEAD } from '../services/email.ts';
import { rewriteRemoteImages } from '../services/imageproxy.ts';
import { getProp, getText, parseICS } from '../calendar/ical.ts';
import type { MailAccountRow } from './accounts.ts';
import { fetchSource } from './imap.ts';

const KEEP = 3 * 60 * 1000;
const CACHED = 12;
const INLINE_LIMIT = 5 * 1024 * 1024;
const TEXT_LIMIT = 400_000;

interface Entry {
  at: number;
  email: Promise<Email>;
  flags: { seen: boolean; flagged: boolean; answered: boolean; draft: boolean };
  size: number;
}

const cache = new Map<string, Entry>();

const keyOf = (row: MailAccountRow, folder: string, uid: number) => `${row.id}\u0000${row.updated_at}\u0000${folder}\u0000${uid}`;

async function parse(source: Buffer) {
  const { default: PostalMime } = await import('postal-mime');
  return PostalMime.parse(source, { attachmentEncoding: 'arraybuffer', maxPartCount: 2000 });
}

export async function loadMessage(row: MailAccountRow, folder: string, uid: number, markSeen = false) {
  const key = keyOf(row, folder, uid);
  const now = Date.now();
  for (const [stale, entry] of cache) if (now - entry.at > KEEP) cache.delete(stale);
  const known = cache.get(key);
  if (known && !markSeen) return known;
  const fetched = await fetchSource(row, folder, uid, markSeen);
  const email = parse(fetched.source).catch(() => {
    throw new HttpError(422, 'Diese E-Mail lässt sich nicht lesen', 'mail_parse');
  });
  const entry: Entry = {
    at: now,
    email,
    flags: { seen: fetched.seen, flagged: fetched.flagged, answered: fetched.answered, draft: fetched.draft },
    size: fetched.source.length,
  };
  email.catch(() => cache.delete(key));
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  return entry;
}

export const forgetMessage = (row: MailAccountRow, folder: string, uid: number) => cache.delete(keyOf(row, folder, uid));

export interface Person {
  name: string;
  address: string;
}

export const people = (list: PostalAddress[] | PostalAddress | undefined): Person[] =>
  (Array.isArray(list) ? list : list ? [list] : [])
    .flatMap((entry) => ('group' in entry && entry.group ? entry.group : [entry]))
    .map((entry) => ({ name: entry.name || '', address: 'address' in entry ? entry.address || '' : '' }))
    .filter((entry) => entry.name || entry.address);

const contentKey = (id: string | undefined) => id?.replace(/[<>\s]/g, '').toLowerCase() || null;

const bytesOf = (content: ArrayBuffer | Uint8Array | string) =>
  typeof content === 'string' ? Buffer.from(content) : content instanceof ArrayBuffer ? Buffer.from(content) : Buffer.from(content);

function referenced(html: string) {
  return new Set(
    [...html.matchAll(/\bcid:([^"'\s)>]+)/gi)].map((match) => {
      try {
        return decodeURIComponent(match[1]).toLowerCase();
      } catch {
        return match[1].toLowerCase();
      }
    })
  );
}

export function calendarPart(email: Email) {
  const part = email.attachments.find((attachment) => /^(text|application)\/(calendar|ics)$/i.test(attachment.mimeType));
  return part ? bytesOf(part.content).toString('utf8') : null;
}

function invitation(email: Email) {
  const text = calendarPart(email);
  if (!text) return null;
  try {
    const roots = parseICS(text);
    const root = roots[0];
    if (!root) return null;
    const method = (getProp(root, 'METHOD')?.value ?? 'PUBLISH').toUpperCase();
    const event = root.children.find((component) => component.name === 'VEVENT');
    if (!event) return null;
    const start = getProp(event, 'DTSTART');
    const end = getProp(event, 'DTEND');
    const organizer = getProp(event, 'ORGANIZER');
    return {
      method,
      uid: getText(event, 'UID') ?? '',
      summary: getText(event, 'SUMMARY') ?? '',
      location: getText(event, 'LOCATION') ?? '',
      start: start?.value ?? null,
      end: end?.value ?? null,
      allDay: Boolean(start && (start.params.VALUE?.[0] === 'DATE' || /^\d{8}$/.test(start.value))),
      organizer: organizer ? (organizer.params.CN?.[0] ?? organizer.value.replace(/^mailto:/i, '')) : null,
    };
  } catch {
    return null;
  }
}

function unsubscribe(email: Email) {
  const header = email.headers.find((entry) => entry.key === 'list-unsubscribe')?.value ?? '';
  if (!header) return null;
  const links = [...header.matchAll(/<([^>]+)>/g)].map((match) => match[1].trim());
  const web = links.find((link) => /^https:\/\//i.test(link)) ?? null;
  const mail = links.find((link) => /^mailto:/i.test(link)) ?? null;
  return web || mail ? { web, mail: mail ? mail.replace(/^mailto:/i, '') : null } : null;
}

export function trustedSender(userId: number, address: string) {
  return Boolean(
    one<{ trusted: number }>(
      'SELECT trusted FROM mail_senders WHERE user_id = ? AND address = ? AND trusted = 1',
      userId,
      address.toLowerCase()
    )
  );
}

export async function presentMessage(row: MailAccountRow, folder: string, uid: number, entry: Entry) {
  const email = await entry.email;
  const inline = referenced(email.html ?? '');
  const from = people(email.from);
  const date = email.date && !Number.isNaN(Date.parse(email.date)) ? Date.parse(email.date) : null;
  return {
    account: row.id,
    folder,
    uid,
    subject: email.subject ?? '',
    from,
    sender: people(email.sender),
    to: people(email.to),
    cc: people(email.cc),
    bcc: people(email.bcc),
    replyTo: people(email.replyTo),
    date,
    messageId: email.messageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    references: email.references ?? null,
    flags: entry.flags,
    size: entry.size,
    html: Boolean(email.html),
    text: (email.text ?? '').slice(0, TEXT_LIMIT),
    remote: /<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i.test(email.html ?? ''),
    trusted: Boolean(from[0]?.address && trustedSender(row.user_id, from[0].address)),
    attachments: email.attachments
      .map((attachment, index) => ({
        index,
        name: attachmentName(attachment.filename, index),
        type: /^[\w.+-]+\/[\w.+-]+$/.test(attachment.mimeType) ? attachment.mimeType.toLowerCase() : 'application/octet-stream',
        size: bytesOf(attachment.content).length,
        inline: Boolean(contentKey(attachment.contentId) && inline.has(contentKey(attachment.contentId)!)),
      }))
      .filter((attachment) => !attachment.inline && !/^(text|application)\/(calendar|ics)$/.test(attachment.type)),
    invite: invitation(email),
    unsubscribe: unsubscribe(email),
  };
}

const linkify = (text: string) =>
  escapeHtml(text).replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, (url) => `<a href="${url}" rel="noreferrer noopener">${url}</a>`);

export async function messageBody(entry: Entry, images: string | null) {
  const email = await entry.email;
  if (!email.html) return `${EMAIL_HEAD}<div class="moe-text">${linkify(email.text ?? '')}</div>`;
  const pictures = new Map<string, string>();
  for (const attachment of email.attachments) {
    const key = contentKey(attachment.contentId);
    if (!key || !/^image\/[\w.+-]+$/.test(attachment.mimeType)) continue;
    const data = bytesOf(attachment.content);
    if (data.length <= INLINE_LIMIT) pictures.set(key, `data:${attachment.mimeType};base64,${data.toString('base64')}`);
  }
  let html = defuse(email.html).replace(/\bcid:([^"'\s)>]+)/gi, (_match, id: string) => {
    let key = id.toLowerCase();
    try {
      key = decodeURIComponent(id).toLowerCase();
    } catch {}
    return pictures.get(key) ?? 'data:,';
  });
  if (images) html = rewriteRemoteImages(html, images);
  return `${EMAIL_HEAD}${html}`;
}

export async function messageAttachment(entry: Entry, index: number) {
  const email = await entry.email;
  const attachment = Number.isInteger(index) ? email.attachments[index] : undefined;
  if (!attachment) throw new HttpError(404, 'Diesen Anhang gibt es nicht', 'mail_attachment');
  return {
    name: attachmentName(attachment.filename, index),
    type: /^[\w.+-]+\/[\w.+-]+$/.test(attachment.mimeType) ? attachment.mimeType.toLowerCase() : 'application/octet-stream',
    data: bytesOf(attachment.content),
  };
}

export function mailCsp(images: string | null) {
  return `sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:${images ? ` ${images}` : ''}; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'`;
}
