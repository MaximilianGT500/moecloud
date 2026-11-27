import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { all } from '../lib/db.ts';
import { badRequest, forbidden, HttpError } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { importForUser } from '../calendar/transfer.ts';
import { appAllowed } from '../services/apps.ts';
import { createDerived, writableFolder } from '../services/derived.ts';
import { baseUrl } from '../services/links.ts';
import * as settings from '../services/settings.ts';
import type { UserRow } from '../services/users.ts';
import {
  deleteAccount,
  insertAccount,
  listAccounts,
  patchAccount,
  presentAccount,
  reorderAccounts,
  replaceConnection,
  requireAccount,
  resolveInput,
  suggestServers,
  type AccountInput,
  type MailAccountRow,
} from './accounts.ts';
import {
  cancelOutbox,
  discardOutboxFor,
  listOutbox,
  saveDraft,
  sendMessage,
  verifySmtp,
  type AttachmentRef,
  type Draft,
  type Upload,
} from './compose.ts';
import {
  closeImap,
  createFolder,
  deleteFolder,
  deleteMessages,
  folderByRole,
  listFolders,
  listMessages,
  moveMessages,
  renameFolder,
  setFlags,
  verifyImap,
} from './imap.ts';
import { calendarPart, forgetMessage, loadMessage, mailCsp, messageAttachment, messageBody, presentMessage } from './read.ts';
import { forgetUnread, noteUnread, refreshBadge, unreadByAccount } from './unread.ts';

const endpoint = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Gib den Server an')
    .max(253)
    .regex(/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/, 'Der Servername sieht nicht richtig aus'),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
});

const address = z.string().trim().toLowerCase().max(254).email('Die E-Mail-Adresse sieht nicht richtig aus');

const accountSchema = z.object({
  name: z.string().trim().max(60).default(''),
  email: address,
  displayName: z.string().trim().max(120).default(''),
  login: z.string().trim().max(254).default(''),
  password: z.string().min(1, 'Gib das Passwort ein').max(1000),
  imap: endpoint.optional(),
  smtp: endpoint.optional(),
  smtpLogin: z.string().trim().max(254).nullable().optional(),
  smtpPassword: z.string().max(1000).nullable().optional(),
  preset: z.boolean().default(false),
});

const folderName = z.string().min(1).max(500);
const uidList = z.array(z.number().int().positive()).min(1).max(1000);
const recipient = z.object({ name: z.string().trim().max(200).default(''), address });
const recipients = z.array(recipient).max(200).default([]);

const attachment = z.union([
  z.object({ kind: z.literal('node'), node: z.string().min(1).max(40) }),
  z.object({ kind: z.literal('message'), folder: folderName, uid: z.number().int().positive(), index: z.number().int().min(0).max(2000) }),
  z.object({ kind: z.literal('upload'), index: z.number().int().min(0).max(50) }),
]);

const reference = z.object({ folder: folderName, uid: z.number().int().positive() });

const draftSchema = z.object({
  to: recipients,
  cc: recipients,
  bcc: recipients,
  subject: z.string().max(998).default(''),
  text: z.string().max(2_000_000).default(''),
  html: z.string().max(4_000_000).nullable().default(null),
  inReplyTo: z.string().max(998).nullable().default(null),
  references: z.array(z.string().max(998)).max(100).default([]),
  attachments: z.array(attachment).max(50).default([]),
  draft: reference.nullable().default(null),
  answered: reference
    .extend({ forward: z.boolean().default(false) })
    .nullable()
    .default(null),
  sendAt: z.number().int().min(0).nullable().default(null),
});

type DraftInput = z.infer<typeof draftSchema>;

function connectionOf(input: z.infer<typeof accountSchema>): AccountInput {
  if (!input.preset && (!input.imap || !input.smtp)) throw badRequest('Gib den Server für eingehende und ausgehende E-Mails an');
  const resolved = resolveInput({
    name: input.name || input.email,
    email: input.email,
    displayName: input.displayName,
    login: input.login || input.email,
    password: input.password,
    imap: input.imap ?? { host: '', port: 993, security: 'tls' },
    smtp: input.smtp ?? { host: '', port: 465, security: 'tls' },
    smtpLogin: input.smtpLogin ?? null,
    smtpPassword: input.smtpPassword ?? null,
    preset: input.preset,
  });
  return resolved;
}

function probeRow(user: UserRow, input: AccountInput): MailAccountRow {
  return {
    ...insertShape(input),
    id: `probe-${user.id}`,
    user_id: user.id,
  } as MailAccountRow;
}

function insertShape(input: AccountInput) {
  return {
    name: input.name,
    email: input.email,
    display_name: input.displayName,
    login: input.login,
    secret: '',
    imap_host: input.imap.host,
    imap_port: input.imap.port,
    imap_security: input.imap.security,
    smtp_host: input.smtp.host,
    smtp_port: input.smtp.port,
    smtp_security: input.smtp.security,
    smtp_login: input.smtpLogin || null,
    smtp_secret: null,
    signature: '',
    folders: null,
    save_sent: 1,
    notify: 1,
    preset: input.preset ? 1 : 0,
    position: 0,
    seen_uid: null,
    seen_validity: null,
    error: null,
    checked_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

async function testConnection(user: UserRow, input: AccountInput, lang: Lang) {
  const { sealSecret } = await import('./accounts.ts');
  const row = probeRow(user, input);
  row.secret = sealSecret(input.password);
  if (input.smtpLogin && input.smtpPassword) row.smtp_secret = sealSecret(input.smtpPassword);
  try {
    await verifyImap(row);
  } catch (error) {
    if (error instanceof HttpError)
      throw new HttpError(error.status, 'Eingang (IMAP): {reason}', error.code, { reason: t(lang, error.message, error.params) });
    throw error;
  }
  try {
    await verifySmtp(row);
  } catch (error) {
    if (error instanceof HttpError)
      throw new HttpError(error.status, 'Ausgang (SMTP): {reason}', error.code, { reason: t(lang, error.message, error.params) });
    throw error;
  }
}

const draftOf = (input: DraftInput): Draft => ({
  to: input.to,
  cc: input.cc,
  bcc: input.bcc,
  subject: input.subject,
  text: input.text,
  html: input.html,
  inReplyTo: input.inReplyTo,
  references: input.references,
  attachments: input.attachments as AttachmentRef[],
});

async function readCompose(request: FastifyRequest) {
  const uploads: Upload[] = [];
  let payload: unknown = request.body;
  if (request.isMultipart()) {
    payload = undefined;
    const parts = request.parts({ limits: { files: 50, fileSize: 25 * 1024 * 1024, fields: 4, parts: 60, fieldSize: 8 * 1024 * 1024 } });
    let total = 0;
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'payload') {
          try {
            payload = JSON.parse(String(part.value));
          } catch {
            throw badRequest('Die Anfrage ist ungültig');
          }
        }
        continue;
      }
      const data = await part.toBuffer();
      total += data.length;
      if (total > 25 * 1024 * 1024)
        throw new HttpError(413, 'Die Anhänge sind zusammen größer als {size} MB. Teile große Dateien lieber als Link.', 'mail_too_large', {
          size: 25,
        });
      uploads.push({ name: (part.filename || 'Anhang').slice(0, 255), type: part.mimetype || 'application/octet-stream', data });
    }
  }
  return { input: parse(draftSchema, payload), uploads };
}

const folderQuery = z.object({ folder: folderName, uid: z.coerce.number().int().positive() });

function account(request: FastifyRequest<{ Params: { id: string } }>) {
  return requireAccount(me(request), request.params.id);
}

function sendDocument(reply: FastifyReply, html: string, csp: string) {
  reply.header('Content-Type', 'text/html; charset=utf-8');
  reply.header('Content-Security-Policy', csp);
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cache-Control', 'private, no-cache');
  return reply.send(html);
}

async function trashOrDelete(row: MailAccountRow, folder: string, uids: number[]) {
  const trash = await folderByRole(row, 'trash');
  if (!trash || trash === folder) {
    await deleteMessages(row, folder, uids);
    return 'deleted' as const;
  }
  await moveMessages(row, folder, uids, trash);
  return 'trashed' as const;
}

export async function mailRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const user = request.auth?.user;
    if (user && !appAllowed('mail', user)) throw forbidden('Gastkonten haben kein E-Mail');
  });
  app.get('/api/mail/accounts', async (request) => {
    const user = me(request);
    const preset = settings.get('webmail.preset');
    return {
      accounts: listAccounts(user).map(presentAccount),
      preset: preset ? { name: preset.name, domain: preset.domain } : null,
      custom: settings.get('webmail.custom'),
      limit: settings.get('webmail.maxAccounts'),
      email: user.email ?? '',
    };
  });

  app.get<{ Querystring: { email?: string } }>('/api/mail/setup', async (request) => {
    const email = parse(address, request.query.email ?? '');
    return { suggestion: suggestServers(email) };
  });

  app.post('/api/mail/accounts', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const input = connectionOf(parse(accountSchema, request.body));
    await testConnection(user, input, request.lang);
    const row = insertAccount(user, input);
    void refreshBadge(user.id).catch(() => undefined);
    return { account: presentAccount(row) };
  });

  app.put<{ Params: { id: string } }>(
    '/api/mail/accounts/:id/connection',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => {
      const user = me(request);
      const row = account(request);
      const input = connectionOf(parse(accountSchema, request.body));
      await testConnection(user, { ...input, name: row.name }, request.lang);
      await closeImap(row.id);
      forgetUnread(row.id);
      return { account: presentAccount(replaceConnection(row, { ...input, name: row.name })) };
    }
  );

  app.patch<{ Params: { id: string } }>('/api/mail/accounts/:id', async (request) => {
    const row = account(request);
    const input = parse(
      z
        .object({
          name: z.string().trim().min(1, 'Gib einen Namen ein').max(60),
          displayName: z.string().trim().max(120),
          signature: z.string().max(5000),
          saveSent: z.boolean(),
          notify: z.boolean(),
          folders: z.record(z.enum(['sent', 'drafts', 'trash', 'junk', 'archive']), folderName),
        })
        .partial(),
      request.body
    );
    return { account: presentAccount(patchAccount(row, input)) };
  });

  app.delete<{ Params: { id: string } }>('/api/mail/accounts/:id', async (request) => {
    const user = me(request);
    const row = account(request);
    await discardOutboxFor(row.id);
    await closeImap(row.id);
    forgetUnread(row.id);
    deleteAccount(row);
    void refreshBadge(user.id).catch(() => undefined);
    return { ok: true };
  });

  app.put('/api/mail/accounts/order', async (request) => {
    const input = parse(z.object({ ids: z.array(z.string().max(40)).max(50) }), request.body);
    reorderAccounts(me(request), input.ids);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/mail/accounts/:id/folders', async (request) => {
    const row = account(request);
    const folders = await listFolders(row);
    const inbox = folders.find((folder) => folder.role === 'inbox');
    if (inbox) noteUnread(row.id, inbox.unseen);
    return { folders };
  });

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/folders', async (request) => {
    const input = parse(z.object({ path: z.string().trim().min(1, 'Gib einen Namen ein').max(200) }), request.body);
    await createFolder(account(request), input.path);
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/mail/accounts/:id/folders', async (request) => {
    const input = parse(z.object({ path: folderName, next: z.string().trim().min(1, 'Gib einen Namen ein').max(200) }), request.body);
    if (input.path.toUpperCase() === 'INBOX') throw badRequest('Den Posteingang kannst du nicht umbenennen');
    await renameFolder(account(request), input.path, input.next);
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/mail/accounts/:id/folders', async (request) => {
    const path = parse(folderName, request.query.path ?? '');
    if (path.toUpperCase() === 'INBOX') throw badRequest('Den Posteingang kannst du nicht löschen');
    await deleteFolder(account(request), path);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/mail/accounts/:id/messages',
    async (request) => {
      const row = account(request);
      const query = parse(
        z.object({
          folder: folderName.default('INBOX'),
          offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          q: z.string().trim().max(200).optional(),
          filter: z.enum(['unread', 'flagged', 'attachments']).optional(),
        }),
        request.query
      );
      return listMessages(row, query.folder, {
        offset: query.offset,
        limit: query.limit,
        q: query.q || undefined,
        filter: query.filter ?? null,
      });
    }
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/mail/accounts/:id/message',
    async (request) => {
      const row = account(request);
      const query = parse(folderQuery.extend({ seen: z.enum(['0', '1']).default('1') }), request.query);
      const entry = await loadMessage(row, query.folder, query.uid, query.seen === '1');
      const message = await presentMessage(row, query.folder, query.uid, entry);
      if (query.seen === '1') void refreshBadge(row.user_id).catch(() => undefined);
      return { message };
    }
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/mail/accounts/:id/body',
    async (request, reply) => {
      const row = account(request);
      const query = parse(folderQuery.extend({ images: z.enum(['0', '1']).default('0') }), request.query);
      const entry = await loadMessage(row, query.folder, query.uid);
      const origin = query.images === '1' ? baseUrl(request) : null;
      return sendDocument(reply, await messageBody(entry, origin), mailCsp(origin));
    }
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/mail/accounts/:id/attachment',
    async (request, reply) => {
      const row = account(request);
      const query = parse(folderQuery.extend({ index: z.coerce.number().int().min(0).max(2000) }), request.query);
      const file = await messageAttachment(await loadMessage(row, query.folder, query.uid), query.index);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', contentDisposition(file.name, 'attachment'));
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, no-cache');
      return reply.send(file.data);
    }
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/mail/accounts/:id/source',
    async (request, reply) => {
      const row = account(request);
      const query = parse(folderQuery, request.query);
      const { fetchSource } = await import('./imap.ts');
      const fetched = await fetchSource(row, query.folder, query.uid, false);
      reply.header('Content-Type', 'message/rfc822');
      reply.header('Content-Disposition', contentDisposition(`E-Mail ${query.uid}.eml`, 'attachment'));
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(fetched.source);
    }
  );

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/flags', async (request) => {
    const row = account(request);
    const input = parse(
      z.object({
        folder: folderName,
        uids: z.union([uidList, z.literal('all')]),
        seen: z.boolean().optional(),
        flagged: z.boolean().optional(),
      }),
      request.body
    );
    await setFlags(row, input.folder, input.uids, { seen: input.seen, flagged: input.flagged });
    if (input.uids !== 'all') for (const uid of input.uids) forgetMessage(row, input.folder, uid);
    if (input.seen !== undefined) void refreshBadge(row.user_id).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/move', async (request) => {
    const row = account(request);
    const input = parse(z.object({ folder: folderName, uids: uidList, to: folderName }), request.body);
    await moveMessages(row, input.folder, input.uids, input.to);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/archive', async (request) => {
    const row = account(request);
    const input = parse(z.object({ folder: folderName, uids: uidList }), request.body);
    const archive = (await folderByRole(row, 'archive', true))!;
    await moveMessages(row, input.folder, input.uids, archive);
    return { ok: true, folder: archive };
  });

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/delete', async (request) => {
    const row = account(request);
    const input = parse(z.object({ folder: folderName, uids: uidList }), request.body);
    const result = await trashOrDelete(row, input.folder, input.uids);
    void refreshBadge(row.user_id).catch(() => undefined);
    return { result };
  });

  app.post<{ Params: { id: string } }>(
    '/api/mail/accounts/:id/send',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request) => {
      const user = me(request);
      const row = account(request);
      const { input, uploads } = await readCompose(request);
      return sendMessage(user, row, draftOf(input), uploads, { draft: input.draft, answered: input.answered }, input.sendAt);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/mail/accounts/:id/drafts',
    { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (request) => {
      const user = me(request);
      const row = account(request);
      const { input, uploads } = await readCompose(request);
      return { draft: await saveDraft(user, row, draftOf(input), uploads, input.draft) };
    }
  );

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/save', async (request) => {
    const user = me(request);
    const row = account(request);
    const input = parse(
      folderQuery.extend({
        uid: z.number().int().positive(),
        indexes: z.array(z.number().int().min(0).max(2000)).min(1).max(50),
        parent: z.string().max(40).nullable().default(null),
      }),
      request.body
    );
    const entry = await loadMessage(row, input.folder, input.uid);
    const folder = writableFolder(user, input.parent);
    const nodes = [];
    for (const index of input.indexes) {
      const file = await messageAttachment(entry, index);
      const node = await createDerived(user, folder, file.name, file.data, 'api');
      nodes.push({ id: node.id, name: node.name });
    }
    return { nodes, folder: { id: folder.id, name: folder.name } };
  });

  app.post<{ Params: { id: string } }>('/api/mail/accounts/:id/invite', async (request) => {
    const user = me(request);
    const row = account(request);
    if (!appAllowed('calendar', user)) throw forbidden('Der Kalender ist ausgeschaltet');
    const input = parse(folderQuery.extend({ uid: z.number().int().positive(), calendar: z.string().min(1).max(40) }), request.body);
    const email = await (await loadMessage(row, input.folder, input.uid)).email;
    const text = calendarPart(email);
    if (!text) throw badRequest('In dieser E-Mail steckt keine Einladung');
    return { result: importForUser(user, input.calendar, text, 'merge') };
  });

  app.post('/api/mail/senders/trust', async (request) => {
    const user = me(request);
    const input = parse(z.object({ address, trusted: z.boolean() }), request.body);
    const { run } = await import('../lib/db.ts');
    run(
      `INSERT INTO mail_senders (user_id, address, trusted) VALUES (?, ?, ?)
       ON CONFLICT(user_id, address) DO UPDATE SET trusted = excluded.trusted`,
      user.id,
      input.address,
      input.trusted ? 1 : 0
    );
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string } }>('/api/mail/recipients', async (request) => {
    const user = me(request);
    const q = String(request.query.q ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const like = `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const seen = new Set<string>();
    const results: { name: string; address: string; source: 'recent' | 'contact' | 'person' }[] = [];
    const add = (name: string, value: string, source: 'recent' | 'contact' | 'person') => {
      const key = value.toLowerCase();
      if (!key || seen.has(key) || results.length >= 10) return;
      seen.add(key);
      results.push({ name, address: key, source });
    };
    for (const entry of all<{ address: string; name: string }>(
      "SELECT address, name FROM mail_senders WHERE user_id = ? AND used > 0 AND (address LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY used DESC, used_at DESC LIMIT 10",
      user.id,
      like,
      like
    ))
      add(entry.name, entry.address, 'recent');
    if (appAllowed('contacts', user) && q.length >= 1) {
      const { suggestContacts } = await import('../contacts/store.ts');
      for (const contact of suggestContacts(user, q)) add(contact.name, contact.email, 'contact');
    }
    if (settings.get('users.directory') && q.length >= 2) {
      for (const person of all<{ name: string; email: string | null }>(
        "SELECT name, email FROM users WHERE id != ? AND email IS NOT NULL AND disabled = 0 AND role IN ('user', 'admin') AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') LIMIT 6",
        user.id,
        like,
        like
      ))
        if (person.email) add(person.name, person.email, 'person');
    }
    return { recipients: results };
  });

  app.get('/api/mail/outbox', async (request) => ({ outbox: listOutbox(me(request)) }));

  app.delete<{ Params: { id: string } }>('/api/mail/outbox/:id', async (request) => {
    await cancelOutbox(me(request), request.params.id);
    return { ok: true };
  });

  app.get('/api/mail/unread', async (request) => ({ accounts: await unreadByAccount(me(request)) }));
}
