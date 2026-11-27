import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageAddressObject } from 'imapflow';
import { config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { folderOverrides, imapOf, markAccount, passwordOf, type FolderRole, type MailAccountRow } from './accounts.ts';
import { mailFailure, resolveEndpoint } from './net.ts';

const IDLE_MS = 2 * 60_000;
const MAX_POOL = 40;
const MAX_MESSAGE = 40 * 1024 * 1024;

interface Pooled {
  client: ImapFlow;
  key: string;
  used: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const pool = new Map<string, Promise<Pooled>>();

const keyOf = (row: MailAccountRow) => [row.imap_host, row.imap_port, row.imap_security, row.login, row.secret, row.updated_at].join('|');

export async function openImap(row: MailAccountRow) {
  const endpoint = imapOf(row);
  const target = await resolveEndpoint('imap', endpoint);
  const client = new ImapFlow({
    host: target.address,
    port: endpoint.port,
    secure: endpoint.security === 'tls',
    doSTARTTLS: endpoint.security === 'starttls' ? true : endpoint.security === 'none' ? false : undefined,
    servername: target.servername,
    auth: { user: row.login, pass: passwordOf(row) },
    tls: { rejectUnauthorized: true, servername: target.servername, minVersion: 'TLSv1.2' },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    clientInfo: { name: 'MoeCloud', version: config.version },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 5 * 60_000,
    maxLiteralSize: MAX_MESSAGE + 1024 * 1024,
  });
  client.on('error', (error: Error) => log.debug({ error: error.message, account: row.id }, 'IMAP-Verbindung meldet einen Fehler'));
  try {
    await client.connect();
  } catch (error) {
    client.close();
    throw mailFailure(error, endpoint.host);
  }
  return client;
}

function drop(id: string) {
  const entry = pool.get(id);
  pool.delete(id);
  void entry
    ?.then((pooled) => {
      if (pooled.timer) clearTimeout(pooled.timer);
      pooled.client.logout().catch(() => pooled.client.close());
    })
    .catch(() => undefined);
}

function park(id: string, pooled: Pooled) {
  pooled.used = Date.now();
  if (pooled.timer) clearTimeout(pooled.timer);
  pooled.timer = setTimeout(() => {
    if (pool.get(id)) drop(id);
  }, IDLE_MS);
  pooled.timer.unref();
}

async function evict() {
  if (pool.size < MAX_POOL) return;
  let oldest: [string, number] | null = null;
  for (const [id, entry] of pool) {
    const pooled = await entry.catch(() => null);
    if (!pooled) continue;
    if (!oldest || pooled.used < oldest[1]) oldest = [id, pooled.used];
  }
  if (oldest) drop(oldest[0]);
}

async function acquire(row: MailAccountRow): Promise<Pooled> {
  const key = keyOf(row);
  const existing = pool.get(row.id);
  if (existing) {
    const pooled = await existing.catch(() => null);
    if (pooled && pooled.key === key && pooled.client.usable) return pooled;
    drop(row.id);
  }
  await evict();
  const created = openImap(row).then((client) => {
    const pooled: Pooled = { client, key, used: Date.now(), timer: null };
    client.on('close', () => {
      if (pool.get(row.id) === created) pool.delete(row.id);
    });
    return pooled;
  });
  pool.set(row.id, created);
  created.catch(() => {
    if (pool.get(row.id) === created) pool.delete(row.id);
  });
  return created;
}

const fatal = (error: unknown) => {
  const code = String((error as { code?: string }).code ?? '');
  return (
    code === 'NoConnection' ||
    code === 'ETIMEOUT' ||
    code === 'EConnectionClosed' ||
    !(error as { serverResponseCode?: string }).serverResponseCode
  );
};

export async function withImap<T>(row: MailAccountRow, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  let pooled: Pooled;
  try {
    pooled = await acquire(row);
  } catch (error) {
    const failure = mailFailure(error, row.imap_host);
    markAccount(row, failure.code);
    throw failure;
  }
  try {
    const result = await run(pooled.client);
    park(row.id, pooled);
    if (row.error) markAccount(row, null);
    return result;
  } catch (error) {
    if (error instanceof HttpError) {
      park(row.id, pooled);
      throw error;
    }
    if (fatal(error)) drop(row.id);
    else park(row.id, pooled);
    throw mailFailure(error, row.imap_host);
  }
}

export async function closeImap(id: string) {
  drop(id);
}

export async function verifyImap(row: MailAccountRow) {
  const client = await openImap(row);
  try {
    const folders = await client.list();
    return folders.length;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export interface Folder {
  path: string;
  name: string;
  delimiter: string;
  role: 'inbox' | FolderRole | 'flagged' | 'all' | null;
  depth: number;
  messages: number;
  unseen: number;
  selectable: boolean;
}

const SPECIAL: Record<string, Folder['role']> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
  '\\Flagged': 'flagged',
  '\\All': 'all',
};

const NAMES: [Folder['role'], RegExp][] = [
  ['sent', /^(sent|sent items|sent mail|sent messages|gesendet|gesendete objekte|gesendete elemente|gesendete nachrichten)$/i],
  ['drafts', /^(drafts|draft|entwürfe|entwurf)$/i],
  ['trash', /^(trash|deleted|deleted items|deleted messages|bin|papierkorb|gelöscht|gelöschte objekte|gelöschte elemente)$/i],
  ['junk', /^(junk|junk e-mail|junk email|spam|bulk mail|unerwünscht)$/i],
  ['archive', /^(archive|archiv|archives)$/i],
];

function roleOf(entry: ListResponse, overrides: Partial<Record<FolderRole, string>>): Folder['role'] {
  for (const [role, path] of Object.entries(overrides)) if (path === entry.path) return role as FolderRole;
  if (entry.path.toUpperCase() === 'INBOX') return 'inbox';
  if (entry.specialUse && SPECIAL[entry.specialUse]) return SPECIAL[entry.specialUse];
  const leaf = entry.name.trim();
  for (const [role, pattern] of NAMES) if (pattern.test(leaf)) return role;
  return null;
}

const ORDER: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 };

export async function listFolders(row: MailAccountRow): Promise<Folder[]> {
  const overrides = folderOverrides(row);
  return withImap(row, async (client) => {
    const entries = await client.list({ statusQuery: { messages: true, unseen: true } });
    const folders = entries
      .filter((entry) => !entry.flags.has('\\NonExistent'))
      .map((entry) => ({
        path: entry.path,
        name: entry.path.toUpperCase() === 'INBOX' ? 'INBOX' : entry.name,
        delimiter: entry.delimiter || '/',
        role: roleOf(entry, overrides),
        depth: entry.delimiter ? entry.path.split(entry.delimiter).length - 1 : 0,
        messages: entry.status?.messages ?? 0,
        unseen: entry.status?.unseen ?? 0,
        selectable: !entry.flags.has('\\Noselect'),
      }));
    const seen = new Set<string>();
    for (const folder of folders) {
      if (!folder.role || folder.role === 'inbox') continue;
      if (seen.has(folder.role)) folder.role = null;
      else seen.add(folder.role);
    }
    return folders.sort((a, b) => {
      const left = a.role && a.role in ORDER ? ORDER[a.role] : 10;
      const right = b.role && b.role in ORDER ? ORDER[b.role] : 10;
      return left - right || a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
    });
  });
}

export async function folderByRole(row: MailAccountRow, role: FolderRole, create = false) {
  const folders = await listFolders(row);
  const found = folders.find((folder) => folder.role === role);
  if (found || !create) return found?.path ?? null;
  const names: Record<FolderRole, string> = { sent: 'Sent', drafts: 'Drafts', trash: 'Trash', junk: 'Junk', archive: 'Archive' };
  const path = names[role];
  await withImap(row, async (client) => {
    await client.mailboxCreate(path).catch((error: { serverResponseCode?: string }) => {
      if (error.serverResponseCode !== 'ALREADYEXISTS') throw error;
    });
  });
  return path;
}

export interface Address {
  name: string;
  address: string;
}

const people = (list: MessageAddressObject[] | undefined): Address[] =>
  (list ?? []).map((entry) => ({ name: entry.name ?? '', address: entry.address ?? '' })).filter((entry) => entry.address || entry.name);

export interface Summary {
  uid: number;
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  date: number;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
  attachments: boolean;
}

function summarize(message: FetchMessageObject): Summary {
  const flags = message.flags ?? new Set<string>();
  const type = message.headers ? message.headers.toString('latin1') : '';
  const date = message.envelope?.date
    ? new Date(message.envelope.date).getTime()
    : message.internalDate
      ? new Date(message.internalDate).getTime()
      : 0;
  return {
    uid: message.uid,
    subject: message.envelope?.subject ?? '',
    from: people(message.envelope?.from),
    to: people(message.envelope?.to),
    cc: people(message.envelope?.cc),
    date: Number.isFinite(date) ? date : 0,
    size: message.size ?? 0,
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    forwarded: flags.has('$Forwarded'),
    draft: flags.has('\\Draft'),
    attachments: /multipart\/(mixed|related;[^\n]*application)/i.test(type),
  };
}

const QUERY = { uid: true, flags: true, envelope: true, internalDate: true, size: true, headers: ['content-type'] };

export interface ListOptions {
  offset: number;
  limit: number;
  q?: string;
  filter?: 'unread' | 'flagged' | 'attachments' | null;
}

export async function listMessages(row: MailAccountRow, folder: string, options: ListOptions) {
  return withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const box = client.mailbox;
      const total = box ? box.exists : 0;
      const validity = box ? String(box.uidValidity) : '';
      if (!total) return { total: 0, validity, items: [] as Summary[], more: false };
      const search: Record<string, unknown> = {};
      if (options.q) search.text = options.q;
      if (options.filter === 'unread') search.seen = false;
      if (options.filter === 'flagged') search.flagged = true;
      if (Object.keys(search).length || options.filter === 'attachments') {
        const found = Object.keys(search).length
          ? await client.search(search, { uid: true })
          : await client.search({ all: true }, { uid: true });
        const uids = (found || []).sort((a, b) => b - a);
        const wanted: Summary[] = [];
        let cursor = options.offset;
        while (wanted.length < options.limit && cursor < uids.length) {
          const chunk = uids.slice(cursor, cursor + Math.max(options.limit, 50));
          cursor += chunk.length;
          const fetched = await client.fetchAll(chunk, QUERY, { uid: true });
          const items = fetched.map(summarize).filter((item) => options.filter !== 'attachments' || item.attachments);
          wanted.push(...items.sort((a, b) => b.uid - a.uid));
        }
        return { total: uids.length, validity, items: wanted.slice(0, options.limit), more: cursor < uids.length };
      }
      const end = total - options.offset;
      if (end < 1) return { total, validity, items: [], more: false };
      const start = Math.max(1, end - options.limit + 1);
      const fetched = await client.fetchAll(`${start}:${end}`, QUERY);
      const items = fetched.map(summarize).sort((a, b) => b.uid - a.uid);
      return { total, validity, items, more: start > 1 };
    } finally {
      lock.release();
    }
  });
}

export async function fetchSource(row: MailAccountRow, folder: string, uid: number, markSeen: boolean) {
  return withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const head = await client.fetchOne(String(uid), { uid: true, size: true, flags: true }, { uid: true });
      if (!head) throw new HttpError(404, 'Diese E-Mail gibt es nicht mehr', 'mail_gone');
      if ((head.size ?? 0) > MAX_MESSAGE) throw new HttpError(413, 'Diese E-Mail ist zu groß zum Anzeigen', 'mail_large');
      const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!message || !message.source) throw new HttpError(404, 'Diese E-Mail gibt es nicht mehr', 'mail_gone');
      const flags = head.flags ?? new Set<string>();
      if (markSeen && !flags.has('\\Seen')) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        flags.add('\\Seen');
      }
      return {
        source: message.source,
        validity: client.mailbox ? String(client.mailbox.uidValidity) : '',
        seen: flags.has('\\Seen'),
        flagged: flags.has('\\Flagged'),
        answered: flags.has('\\Answered'),
        draft: flags.has('\\Draft'),
      };
    } finally {
      lock.release();
    }
  });
}

export async function setFlags(
  row: MailAccountRow,
  folder: string,
  uids: number[] | 'all',
  changes: { seen?: boolean; flagged?: boolean; answered?: boolean; forwarded?: boolean }
) {
  const range = uids === 'all' ? '1:*' : uids.join(',');
  if (!range) return;
  await withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const add: string[] = [];
      const remove: string[] = [];
      const pick = (value: boolean | undefined, flag: string) => {
        if (value === true) add.push(flag);
        if (value === false) remove.push(flag);
      };
      pick(changes.seen, '\\Seen');
      pick(changes.flagged, '\\Flagged');
      pick(changes.answered, '\\Answered');
      pick(changes.forwarded, '$Forwarded');
      const options = uids === 'all' ? {} : { uid: true };
      if (add.length) await client.messageFlagsAdd(range, add, options);
      if (remove.length) await client.messageFlagsRemove(range, remove, options);
    } finally {
      lock.release();
    }
  });
}

export async function moveMessages(row: MailAccountRow, folder: string, uids: number[], target: string) {
  if (!uids.length || folder === target) return;
  await withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uids.join(','), target, { uid: true });
    } finally {
      lock.release();
    }
  });
}

export async function deleteMessages(row: MailAccountRow, folder: string, uids: number[]) {
  if (!uids.length) return;
  await withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete(uids.join(','), { uid: true });
    } finally {
      lock.release();
    }
  });
}

export async function appendMessage(row: MailAccountRow, folder: string, raw: Buffer, flags: string[]) {
  return withImap(row, async (client) => {
    const result = await client.append(folder, raw, flags, new Date());
    return result && typeof result === 'object' && 'uid' in result && result.uid ? Number(result.uid) : null;
  });
}

export async function findByMessageId(row: MailAccountRow, folder: string, messageId: string) {
  return withImap(row, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const found = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      return found && found.length ? Math.max(...found) : null;
    } finally {
      lock.release();
    }
  });
}

export async function createFolder(row: MailAccountRow, path: string) {
  await withImap(row, async (client) => {
    await client.mailboxCreate(path);
  });
}

export async function renameFolder(row: MailAccountRow, path: string, next: string) {
  await withImap(row, async (client) => {
    await client.mailboxRename(path, next);
  });
}

export async function deleteFolder(row: MailAccountRow, path: string) {
  await withImap(row, async (client) => {
    await client.mailboxDelete(path);
  });
}

export async function inboxStatus(row: MailAccountRow) {
  return withImap(row, async (client) => {
    const status = await client.status('INBOX', { unseen: true, uidNext: true, uidValidity: true });
    if (!status) return { unseen: 0, uidNext: 0, validity: '' };
    return { unseen: status.unseen ?? 0, uidNext: Number(status.uidNext ?? 0), validity: String(status.uidValidity ?? '') };
  });
}

export async function newSince(row: MailAccountRow, after: number) {
  return withImap(row, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const found = await client.search({ uid: `${after + 1}:*`, seen: false }, { uid: true });
      const uids = (found || []).filter((uid) => uid > after).sort((a, b) => b - a);
      const latest = uids.slice(0, 5);
      const items = latest.length ? (await client.fetchAll(latest.join(','), QUERY, { uid: true })).map(summarize) : [];
      return { count: uids.length, items: items.sort((a, b) => b.uid - a.uid) };
    } finally {
      lock.release();
    }
  });
}
