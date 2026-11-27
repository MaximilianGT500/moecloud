import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { seal, unseal } from '../services/seal.ts';
import * as settings from '../services/settings.ts';
import type { UserRow } from '../services/users.ts';
import type { Endpoint, Security } from './net.ts';

export interface MailAccountRow {
  id: string;
  user_id: number;
  name: string;
  email: string;
  display_name: string;
  login: string;
  secret: string;
  imap_host: string;
  imap_port: number;
  imap_security: Security;
  smtp_host: string;
  smtp_port: number;
  smtp_security: Security;
  smtp_login: string | null;
  smtp_secret: string | null;
  signature: string;
  folders: string | null;
  save_sent: number;
  notify: number;
  preset: number;
  position: number;
  seen_uid: number | null;
  seen_validity: string | null;
  error: string | null;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export type FolderRole = 'sent' | 'drafts' | 'trash' | 'junk' | 'archive';

export interface AccountInput {
  name: string;
  email: string;
  displayName: string;
  login: string;
  password: string;
  imap: Endpoint;
  smtp: Endpoint;
  smtpLogin?: string | null;
  smtpPassword?: string | null;
  preset?: boolean;
}

const PURPOSE = 'mail-account';

export const sealSecret = (password: string) => seal(password, PURPOSE);
export const passwordOf = (row: Pick<MailAccountRow, 'secret'>) => unseal(row.secret, PURPOSE);
export const smtpPasswordOf = (row: Pick<MailAccountRow, 'secret' | 'smtp_secret'>) =>
  row.smtp_secret ? unseal(row.smtp_secret, PURPOSE) : passwordOf(row);

export const imapOf = (row: MailAccountRow): Endpoint => ({ host: row.imap_host, port: row.imap_port, security: row.imap_security });
export const smtpOf = (row: MailAccountRow): Endpoint => ({ host: row.smtp_host, port: row.smtp_port, security: row.smtp_security });

export function folderOverrides(row: Pick<MailAccountRow, 'folders'>): Partial<Record<FolderRole, string>> {
  if (!row.folders) return {};
  try {
    return JSON.parse(row.folders) as Partial<Record<FolderRole, string>>;
  } catch {
    return {};
  }
}

export function presentAccount(row: MailAccountRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    displayName: row.display_name,
    login: row.login,
    imap: imapOf(row),
    smtp: smtpOf(row),
    smtpLogin: row.smtp_login,
    signature: row.signature,
    folders: folderOverrides(row),
    saveSent: Boolean(row.save_sent),
    notify: Boolean(row.notify),
    preset: Boolean(row.preset),
    error: row.error,
    checkedAt: row.checked_at,
  };
}

export type PresentedAccount = ReturnType<typeof presentAccount>;

export const listAccounts = (user: Pick<UserRow, 'id'>) =>
  all<MailAccountRow>('SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY position, created_at', user.id);

export function requireAccount(user: Pick<UserRow, 'id'>, id: string) {
  const row = one<MailAccountRow>('SELECT * FROM mail_accounts WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) throw notFound('Dieses Postfach gibt es nicht');
  return row;
}

export const getAccount = (id: string) => one<MailAccountRow>('SELECT * FROM mail_accounts WHERE id = ?', id);

export function presetFor(email: string) {
  const preset = settings.get('webmail.preset');
  if (!preset) return null;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (preset.domain && domain !== preset.domain) return null;
  return preset;
}

export function presetLogin(email: string) {
  const preset = settings.get('webmail.preset');
  return preset?.login === 'local' ? email.split('@')[0] : email;
}

export function resolveInput(input: AccountInput): AccountInput {
  if (input.preset) {
    const preset = presetFor(input.email);
    if (!preset) throw new HttpError(400, 'Für diese Adresse gibt es keine Vorgabe der Verwaltung', 'mail_preset');
    return { ...input, imap: preset.imap, smtp: preset.smtp, login: input.login || presetLogin(input.email), smtpLogin: null };
  }
  if (!settings.get('webmail.custom')) {
    throw new HttpError(403, 'Eigene Mailserver hat die Verwaltung abgeschaltet', 'mail_custom');
  }
  return input;
}

export function insertAccount(user: Pick<UserRow, 'id'>, input: AccountInput) {
  const count = value<number>('SELECT COUNT(*) FROM mail_accounts WHERE user_id = ?', user.id) ?? 0;
  const limit = settings.get('webmail.maxAccounts');
  if (count >= limit) throw new HttpError(400, 'Mehr als {count} Postfächer gehen nicht', 'mail_limit', { count: limit });
  const id = randomId(16);
  const now = Date.now();
  run(
    `INSERT INTO mail_accounts (id, user_id, name, email, display_name, login, secret, imap_host, imap_port, imap_security,
       smtp_host, smtp_port, smtp_security, smtp_login, smtp_secret, preset, position, checked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    input.name,
    input.email,
    input.displayName,
    input.login,
    sealSecret(input.password),
    input.imap.host,
    input.imap.port,
    input.imap.security,
    input.smtp.host,
    input.smtp.port,
    input.smtp.security,
    input.smtpLogin || null,
    input.smtpLogin && input.smtpPassword ? sealSecret(input.smtpPassword) : null,
    input.preset ? 1 : 0,
    count,
    now,
    now,
    now
  );
  return getAccount(id)!;
}

export interface AccountPatch {
  name?: string;
  displayName?: string;
  signature?: string;
  saveSent?: boolean;
  notify?: boolean;
  folders?: Partial<Record<FolderRole, string>>;
}

export function patchAccount(row: MailAccountRow, patch: AccountPatch) {
  const next = {
    name: patch.name ?? row.name,
    display_name: patch.displayName ?? row.display_name,
    signature: patch.signature ?? row.signature,
    save_sent: patch.saveSent === undefined ? row.save_sent : patch.saveSent ? 1 : 0,
    notify: patch.notify === undefined ? row.notify : patch.notify ? 1 : 0,
    folders: patch.folders === undefined ? row.folders : JSON.stringify(patch.folders),
  };
  run(
    'UPDATE mail_accounts SET name = ?, display_name = ?, signature = ?, save_sent = ?, notify = ?, folders = ?, updated_at = ? WHERE id = ?',
    next.name,
    next.display_name,
    next.signature,
    next.save_sent,
    next.notify,
    next.folders,
    Date.now(),
    row.id
  );
  return getAccount(row.id)!;
}

export function replaceConnection(row: MailAccountRow, input: AccountInput) {
  run(
    `UPDATE mail_accounts SET email = ?, login = ?, secret = ?, imap_host = ?, imap_port = ?, imap_security = ?, smtp_host = ?, smtp_port = ?,
       smtp_security = ?, smtp_login = ?, smtp_secret = ?, preset = ?, error = NULL, checked_at = ?, seen_uid = NULL, seen_validity = NULL, updated_at = ?
     WHERE id = ?`,
    input.email,
    input.login,
    sealSecret(input.password),
    input.imap.host,
    input.imap.port,
    input.imap.security,
    input.smtp.host,
    input.smtp.port,
    input.smtp.security,
    input.smtpLogin || null,
    input.smtpLogin && input.smtpPassword ? sealSecret(input.smtpPassword) : null,
    input.preset ? 1 : 0,
    Date.now(),
    Date.now(),
    row.id
  );
  return getAccount(row.id)!;
}

export const deleteAccount = (row: MailAccountRow) => run('DELETE FROM mail_accounts WHERE id = ?', row.id);

export function reorderAccounts(user: Pick<UserRow, 'id'>, ids: string[]) {
  tx(() => {
    ids.forEach((id, index) => run('UPDATE mail_accounts SET position = ? WHERE id = ? AND user_id = ?', index, id, user.id));
  });
}

export const markAccount = (row: Pick<MailAccountRow, 'id'>, error: string | null) =>
  run('UPDATE mail_accounts SET error = ?, checked_at = ? WHERE id = ?', error, Date.now(), row.id);

export type ProviderNote = 'google' | 'microsoft' | 'apple' | 'yahoo' | 'imap' | 'telekom';

interface Provider {
  domains: string[];
  imap: Endpoint;
  smtp: Endpoint;
  note?: ProviderNote;
}

const tls = (host: string, port = 993): Endpoint => ({ host, port, security: 'tls' });
const starttls = (host: string, port = 587): Endpoint => ({ host, port, security: 'starttls' });

const PROVIDERS: Provider[] = [
  {
    domains: ['gmail.com', 'googlemail.com'],
    imap: tls('imap.gmail.com'),
    smtp: tls('smtp.gmail.com', 465),
    note: 'google',
  },
  {
    domains: ['outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'msn.com'],
    imap: tls('outlook.office365.com'),
    smtp: starttls('smtp-mail.outlook.com'),
    note: 'microsoft',
  },
  {
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: tls('imap.mail.me.com'),
    smtp: starttls('smtp.mail.me.com'),
    note: 'apple',
  },
  {
    domains: ['yahoo.com', 'yahoo.de', 'ymail.com'],
    imap: tls('imap.mail.yahoo.com'),
    smtp: tls('smtp.mail.yahoo.com', 465),
    note: 'yahoo',
  },
  {
    domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
    imap: tls('imap.gmx.net'),
    smtp: tls('mail.gmx.net', 465),
    note: 'imap',
  },
  { domains: ['web.de'], imap: tls('imap.web.de'), smtp: starttls('smtp.web.de'), note: 'imap' },
  {
    domains: ['t-online.de', 'magenta.de'],
    imap: tls('secureimap.t-online.de'),
    smtp: tls('securesmtp.t-online.de', 465),
    note: 'telekom',
  },
  { domains: ['posteo.de', 'posteo.net', 'posteo.org', 'posteo.eu'], imap: tls('posteo.de'), smtp: tls('posteo.de', 465) },
  { domains: ['mailbox.org'], imap: tls('imap.mailbox.org'), smtp: tls('smtp.mailbox.org', 465) },
  { domains: ['freenet.de'], imap: tls('mx.freenet.de'), smtp: starttls('mx.freenet.de') },
  { domains: ['aol.com', 'aol.de'], imap: tls('imap.aol.com'), smtp: tls('smtp.aol.com', 465) },
  { domains: ['ionos.de', '1und1.de', 'online.de'], imap: tls('imap.ionos.de'), smtp: tls('smtp.ionos.de', 465) },
  { domains: ['strato.de'], imap: tls('imap.strato.de'), smtp: tls('smtp.strato.de', 465) },
  { domains: ['fastmail.com', 'fastmail.fm'], imap: tls('imap.fastmail.com'), smtp: tls('smtp.fastmail.com', 465) },
];

export function suggestServers(email: string) {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  const preset = presetFor(email);
  if (preset) {
    return { source: 'preset' as const, name: preset.name, imap: preset.imap, smtp: preset.smtp, login: presetLogin(email), note: null };
  }
  const provider = PROVIDERS.find((entry) => entry.domains.includes(domain));
  if (provider)
    return { source: 'known' as const, name: domain, imap: provider.imap, smtp: provider.smtp, login: email, note: provider.note ?? null };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return {
    source: 'guess' as const,
    name: domain,
    imap: tls(`imap.${domain}`),
    smtp: tls(`smtp.${domain}`, 465),
    login: email,
    note: null,
  };
}
