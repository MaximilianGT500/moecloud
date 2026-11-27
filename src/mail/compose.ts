import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { all, one, run } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { blobPath } from '../services/blobs.ts';
import { getNode, resolveAccess } from '../services/nodes.ts';
import { notify } from '../services/notify.ts';
import { assertNotInfected } from '../services/scan.ts';
import * as settings from '../services/settings.ts';
import { getUser, type UserRow } from '../services/users.ts';
import { getAccount, smtpOf, smtpPasswordOf, type MailAccountRow } from './accounts.ts';
import { appendMessage, deleteMessages, findByMessageId, folderByRole, setFlags } from './imap.ts';
import { mailFailure, resolveEndpoint } from './net.ts';
import { loadMessage, messageAttachment } from './read.ts';

export const MAIL_SIZE_LIMIT = 25 * 1024 * 1024;

export interface Recipient {
  name: string;
  address: string;
}

export type AttachmentRef =
  { kind: 'node'; node: string } | { kind: 'message'; folder: string; uid: number; index: number } | { kind: 'upload'; index: number };

export interface Draft {
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: AttachmentRef[];
}

export interface Upload {
  name: string;
  type: string;
  data: Buffer;
}

export interface FollowUp {
  draft?: { folder: string; uid: number } | null;
  answered?: { folder: string; uid: number; forward: boolean } | null;
}

interface Built {
  raw: Buffer;
  copy: Buffer;
  envelope: { from: string; to: string[] };
  messageId: string;
}

const outboxDir = () => join(config.dataDir, 'mail', 'outbox');
const rawPath = (id: string, kind: 'send' | 'copy') => join(outboxDir(), `${id}.${kind}.eml`);

const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() || 'moecloud.local';

async function attachmentsOf(user: UserRow, row: MailAccountRow, refs: AttachmentRef[], uploads: Upload[]) {
  const files: { filename: string; content: Buffer; contentType: string }[] = [];
  let total = 0;
  for (const ref of refs) {
    let file: { filename: string; content: Buffer; contentType: string };
    if (ref.kind === 'node') {
      const access = resolveAccess(user, ref.node);
      const node = getNode(ref.node);
      if (!access || !node || node.type !== 'file' || !node.sha256 || node.trashed_at) {
        throw new HttpError(404, 'Eine angehängte Datei gibt es nicht mehr', 'mail_node');
      }
      assertNotInfected(node.sha256);
      total += node.size;
      if (total > MAIL_SIZE_LIMIT) break;
      file = { filename: node.name, content: await readFile(blobPath(node.sha256)), contentType: node.mime || 'application/octet-stream' };
    } else if (ref.kind === 'message') {
      const entry = await loadMessage(row, ref.folder, ref.uid);
      const found = await messageAttachment(entry, ref.index);
      file = { filename: found.name, content: found.data, contentType: found.type };
      total += found.data.length;
    } else {
      const upload = uploads[ref.index];
      if (!upload) throw new HttpError(400, 'Ein Anhang fehlt', 'mail_upload');
      file = { filename: upload.name, content: upload.data, contentType: upload.type || 'application/octet-stream' };
      total += upload.data.length;
    }
    if (total > MAIL_SIZE_LIMIT) break;
    files.push(file);
  }
  if (total > MAIL_SIZE_LIMIT) {
    throw new HttpError(413, 'Die Anhänge sind zusammen größer als {size} MB. Teile große Dateien lieber als Link.', 'mail_too_large', {
      size: MAIL_SIZE_LIMIT / 1024 / 1024,
    });
  }
  return files;
}

export async function buildMessage(user: UserRow, row: MailAccountRow, draft: Draft, uploads: Upload[]): Promise<Built> {
  const { default: MailComposer } = await import('nodemailer/lib/mail-composer');
  const messageId = `<${randomId(24)}@${domainOf(row.email)}>`;
  const from = { name: row.display_name || user.name, address: row.email };
  const base = {
    from,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    text: draft.text,
    ...(draft.html ? { html: draft.html } : {}),
    ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
    ...(draft.references.length ? { references: draft.references } : {}),
    messageId,
    date: new Date(),
    attachments: await attachmentsOf(user, row, draft.attachments, uploads),
    disableFileAccess: true,
    disableUrlAccess: true,
    xMailer: `MoeCloud ${config.version}`,
  };
  const sending = new MailComposer({ ...base, bcc: draft.bcc }).compile();
  const raw = await sending.build();
  const copyNode = new MailComposer({ ...base, bcc: draft.bcc }).compile();
  copyNode.keepBcc = true;
  const copy = await copyNode.build();
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map((entry) => entry.address);
  return { raw, copy, envelope: { from: row.email, to: [...new Set(recipients)] }, messageId };
}

async function transportFor(row: MailAccountRow) {
  const endpoint = smtpOf(row);
  const target = await resolveEndpoint('smtp', endpoint);
  const { createTransport } = await import('nodemailer');
  let helo = 'moecloud';
  try {
    helo = new URL(settings.get('site.url')).hostname || helo;
  } catch {}
  return {
    endpoint,
    transport: createTransport({
      host: target.address,
      port: endpoint.port,
      secure: endpoint.security === 'tls',
      requireTLS: endpoint.security === 'starttls',
      ignoreTLS: endpoint.security === 'none',
      auth: { user: row.smtp_login || row.login, pass: smtpPasswordOf(row) },
      tls: { servername: target.servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      name: helo,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  };
}

export async function verifySmtp(row: MailAccountRow) {
  const { endpoint, transport } = await transportFor(row);
  try {
    await transport.verify();
  } catch (error) {
    throw mailFailure(error, endpoint.host);
  } finally {
    transport.close();
  }
}

async function deliver(row: MailAccountRow, envelope: Built['envelope'], raw: Buffer) {
  const { endpoint, transport } = await transportFor(row);
  try {
    await transport.sendMail({ envelope, raw });
  } catch (error) {
    throw mailFailure(error, endpoint.host);
  } finally {
    transport.close();
  }
}

export function rememberRecipients(userId: number, recipients: Recipient[]) {
  const now = Date.now();
  for (const recipient of recipients) {
    const address = recipient.address.trim().toLowerCase();
    if (!address) continue;
    run(
      `INSERT INTO mail_senders (user_id, address, name, used, used_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, address) DO UPDATE SET used = mail_senders.used + 1, used_at = excluded.used_at,
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE mail_senders.name END`,
      userId,
      address,
      recipient.name.trim().slice(0, 200),
      now
    );
  }
}

async function afterSend(row: MailAccountRow, copy: Buffer, followUp: FollowUp) {
  if (row.save_sent) {
    try {
      const sent = await folderByRole(row, 'sent', true);
      if (sent) await appendMessage(row, sent, copy, ['\\Seen']);
    } catch (error) {
      log.warn({ error: (error as Error).message, account: row.id }, 'Gesendete E-Mail ließ sich nicht ablegen');
    }
  }
  if (followUp.draft) await deleteMessages(row, followUp.draft.folder, [followUp.draft.uid]).catch(() => undefined);
  if (followUp.answered) {
    await setFlags(
      row,
      followUp.answered.folder,
      [followUp.answered.uid],
      followUp.answered.forward ? { forwarded: true } : { answered: true }
    ).catch(() => undefined);
  }
}

export interface OutboxRow {
  id: string;
  account_id: string;
  user_id: number;
  send_at: number;
  envelope: string;
  subject: string;
  recipients: string;
  followup: string | null;
  state: 'waiting' | 'sending' | 'failed';
  error: string | null;
  attempts: number;
  created_at: number;
}

export const presentOutbox = (row: OutboxRow) => ({
  id: row.id,
  account: row.account_id,
  sendAt: row.send_at,
  subject: row.subject,
  recipients: row.recipients,
  state: row.state,
  error: row.error,
});

export async function sendMessage(
  user: UserRow,
  row: MailAccountRow,
  draft: Draft,
  uploads: Upload[],
  followUp: FollowUp,
  sendAt: number | null
) {
  if (!draft.to.length && !draft.cc.length && !draft.bcc.length)
    throw new HttpError(400, 'Gib mindestens eine Adresse an', 'mail_recipients');
  const built = await buildMessage(user, row, draft, uploads);
  rememberRecipients(user.id, [...draft.to, ...draft.cc, ...draft.bcc]);
  if (!sendAt || sendAt <= Date.now() + 1500) {
    await deliver(row, built.envelope, built.raw);
    await afterSend(row, built.copy, followUp);
    return { sent: true as const, messageId: built.messageId };
  }
  const id = randomId(18);
  await mkdir(outboxDir(), { recursive: true });
  await writeFile(rawPath(id, 'send'), built.raw);
  await writeFile(rawPath(id, 'copy'), built.copy);
  run(
    `INSERT INTO mail_outbox (id, account_id, user_id, send_at, envelope, subject, recipients, followup, state, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', 0, ?)`,
    id,
    row.id,
    user.id,
    sendAt,
    JSON.stringify(built.envelope),
    draft.subject.slice(0, 300),
    [...draft.to, ...draft.cc]
      .map((entry) => entry.name || entry.address)
      .join(', ')
      .slice(0, 300),
    JSON.stringify(followUp),
    Date.now()
  );
  scheduleOutbox();
  return { sent: false as const, queued: presentOutbox(one<OutboxRow>('SELECT * FROM mail_outbox WHERE id = ?', id)!) };
}

export const listOutbox = (user: Pick<UserRow, 'id'>) =>
  all<OutboxRow>('SELECT * FROM mail_outbox WHERE user_id = ? ORDER BY send_at', user.id).map(presentOutbox);

export async function cancelOutbox(user: Pick<UserRow, 'id'>, id: string) {
  const changed = run("DELETE FROM mail_outbox WHERE id = ? AND user_id = ? AND state != 'sending'", id, user.id).changes;
  if (!changed) throw new HttpError(409, 'Die E-Mail ist schon unterwegs', 'mail_outbox_busy');
  await rm(rawPath(id, 'send'), { force: true });
  await rm(rawPath(id, 'copy'), { force: true });
}

export async function discardOutboxFor(accountId: string) {
  for (const row of all<{ id: string }>('SELECT id FROM mail_outbox WHERE account_id = ?', accountId)) {
    await rm(rawPath(row.id, 'send'), { force: true });
    await rm(rawPath(row.id, 'copy'), { force: true });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleOutbox() {
  const next = one<{ send_at: number }>("SELECT send_at FROM mail_outbox WHERE state = 'waiting' ORDER BY send_at LIMIT 1");
  if (timer) clearTimeout(timer);
  timer = null;
  if (!next) return;
  const wait = Math.max(0, Math.min(next.send_at - Date.now(), 60_000));
  timer = setTimeout(() => {
    timer = null;
    void flushOutbox().finally(scheduleOutbox);
  }, wait);
  timer.unref();
}

let flushing = false;

export async function flushOutbox(now = Date.now()) {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const due = all<OutboxRow>("SELECT * FROM mail_outbox WHERE state = 'waiting' AND send_at <= ? ORDER BY send_at LIMIT 20", now);
    for (const item of due) {
      if (
        run("UPDATE mail_outbox SET state = 'sending', attempts = attempts + 1 WHERE id = ? AND state = 'waiting'", item.id).changes === 0
      )
        continue;
      const row = getAccount(item.account_id);
      const user = getUser(item.user_id);
      try {
        if (!row || !user) throw new HttpError(404, 'Das Postfach gibt es nicht mehr', 'mail_account_gone');
        const raw = await readFile(rawPath(item.id, 'send'));
        const copy = await readFile(rawPath(item.id, 'copy'));
        await deliver(row, JSON.parse(item.envelope) as Built['envelope'], raw);
        run('DELETE FROM mail_outbox WHERE id = ?', item.id);
        await rm(rawPath(item.id, 'send'), { force: true });
        await rm(rawPath(item.id, 'copy'), { force: true });
        await afterSend(row, copy, item.followup ? (JSON.parse(item.followup) as FollowUp) : {});
        sent++;
      } catch (error) {
        const message = error instanceof HttpError ? error.message : (error as Error).message;
        const retry = item.attempts + 1 < 3 && !(error instanceof HttpError && error.code === 'mail_auth');
        run(
          'UPDATE mail_outbox SET state = ?, error = ?, send_at = ? WHERE id = ?',
          retry ? 'waiting' : 'failed',
          message.slice(0, 300),
          retry ? Date.now() + 5 * 60_000 : item.send_at,
          item.id
        );
        if (!retry && user) notify(user.id, 'mail_failed', { subject: item.subject || '–' }, '/mail?outbox=1');
        log.warn({ error: message, outbox: item.id }, 'E-Mail aus dem Postausgang ließ sich nicht senden');
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export async function saveDraft(
  user: UserRow,
  row: MailAccountRow,
  draft: Draft,
  uploads: Upload[],
  previous: { folder: string; uid: number } | null
) {
  const built = await buildMessage(user, row, draft, uploads);
  const folder = (await folderByRole(row, 'drafts', true))!;
  let uid = await appendMessage(row, folder, built.copy, ['\\Draft', '\\Seen']);
  if (!uid) uid = await findByMessageId(row, folder, built.messageId);
  if (previous && !(previous.folder === folder && previous.uid === uid)) {
    await deleteMessages(row, previous.folder, [previous.uid]).catch(() => undefined);
  }
  return { folder, uid };
}
