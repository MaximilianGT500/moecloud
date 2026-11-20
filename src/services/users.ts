import { log } from '../lib/log.ts';
import { rm } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { all, one, run, tx, value } from '../lib/db.ts';
import { hashPassword, randomId } from '../lib/crypto.ts';
import { conflict, HttpError, notFound, unauthorized } from '../lib/errors.ts';
import { isLang, type Lang } from '../lib/i18n.ts';
import * as settings from './settings.ts';

export type Role = 'admin' | 'user' | 'guest' | 'team';

export interface UserRow {
  id: number;
  username: string;
  username_key: string;
  email: string | null;
  email_key: string | null;
  name: string;
  password_hash: string | null;
  role: Role;
  disabled: number;
  quota_bytes: number | null;
  language: Lang | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last: number;
  oidc_sub: string | null;
  root_id: string;
  created_at: number;
  last_login_at: number | null;
  prefs: string | null;
  expires_at: number | null;
  terms_version: number;
  terms_at: number | null;
  avatar: string | null;
  pending: number;
  seen_at: number | null;
  must_change: number;
}

export const expired = (user: Pick<UserRow, 'expires_at'>, now = Date.now()) => Boolean(user.expires_at && Number(user.expires_at) <= now);

export const isPerson = (user: { role?: string } | null | undefined): boolean => Boolean(user) && user!.role !== 'team';

export const inactive = (user: Pick<UserRow, 'disabled' | 'expires_at'> & { role?: string; pending?: number }) =>
  Boolean(user.disabled) || Boolean(user.pending) || expired(user) || user.role === 'team';

export function assertActive(user: Pick<UserRow, 'disabled' | 'expires_at'> & { role?: string; pending?: number }) {
  if (user.role === 'team') throw unauthorized('Benutzername oder Passwort stimmen nicht');
  if (Number(user.pending) & 2) {
    throw new HttpError(401, 'Bestätige zuerst deine E-Mail-Adresse. Den Link dazu findest du in deinem Postfach', 'email_unconfirmed');
  }
  if (user.pending) throw unauthorized('Dein Konto wartet noch auf die Freigabe durch die Verwaltung');
  if (user.disabled) throw unauthorized('Dein Konto ist gesperrt, wende dich an die Verwaltung');
  if (expired(user)) throw unauthorized('Dein Konto ist abgelaufen, wende dich an die Verwaltung');
}

export const ACTIVE = "(disabled = 0 AND pending = 0 AND role != 'team' AND (expires_at IS NULL OR expires_at > ?))";
export const PERSON = "role != 'team'";

export interface PushTarget {
  kind: 'ntfy' | 'gotify';
  url: string;
  token: string | null;
}

export interface UserPrefs {
  mailShares: boolean;
  mailUploads: boolean;
  mailComments: boolean;
  mailWatch: boolean;
  mailAdmin: boolean;
  mailLogins: boolean;
  mailReminders: boolean;
  mailPlugins: boolean;
  storageWarned: boolean;
  storageAsked: number;
  expiryWarned: number;
  push: PushTarget | null;
  templates: string | null;
  notes: string | null;
  quiet: { from: number; to: number } | null;
  digest: 'off' | 'daily' | 'weekly';
  zone: string;
  theme: { id: string } | { own: settings.ThemeSpec; palette: settings.Palette } | null;
  start: 'files' | 'home';
  nav: { order: string[]; hidden: string[]; bar: string[] } | null;
  home: { order: string[]; hidden: string[] } | null;
}

export const preferredLanguage = (user: Pick<UserRow, 'language'>): Lang =>
  user.language && isLang(user.language) ? user.language : settings.get('site.language');

const PREF_DEFAULTS: UserPrefs = {
  mailShares: true,
  mailUploads: true,
  mailComments: true,
  mailWatch: true,
  mailAdmin: true,
  mailLogins: true,
  mailReminders: true,
  mailPlugins: true,
  storageWarned: false,
  storageAsked: 0,
  expiryWarned: 0,
  push: null,
  templates: null,
  notes: null,
  quiet: null,
  digest: 'off',
  zone: '',
  theme: null,
  start: 'files',
  nav: null,
  home: null,
};

export function prefsOf(user: Pick<UserRow, 'prefs'>): UserPrefs {
  if (!user.prefs) return { ...PREF_DEFAULTS };
  try {
    return { ...PREF_DEFAULTS, ...(JSON.parse(user.prefs) as Partial<UserPrefs>) };
  } catch {
    return { ...PREF_DEFAULTS };
  }
}

export function updatePrefs(userId: number, patch: Partial<UserPrefs>) {
  const user = getUser(userId);
  if (!user) return null;
  const next = { ...prefsOf(user), ...patch };
  run('UPDATE users SET prefs = ? WHERE id = ?', JSON.stringify(next), userId);
  return next;
}

export interface NewUser {
  username: string;
  name: string;
  email?: string | null;
  password?: string | null;
  role?: Role;
  quota?: number | null;
  language?: Lang | null;
  expiresAt?: number | null;
  pending?: boolean | number;
  mustChange?: boolean;
}

export const keyOf = (value: string) => value.normalize('NFC').trim().toLowerCase();

const accountListeners: ((user: UserRow) => void)[] = [];

export const onAccount = (listener: (user: UserRow) => void) => {
  accountListeners.push(listener);
};

export const getUser = (id: number) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);

export function requireUser(id: number) {
  const user = getUser(id);
  if (!user || !isPerson(user)) throw notFound('Diese Person gibt es nicht');
  return user;
}

export function findByLogin(login: string) {
  const key = keyOf(login);
  return one<UserRow>('SELECT * FROM users WHERE username_key = ? OR email_key = ?', key, key);
}

export const findByUsername = (username: string) => one<UserRow>('SELECT * FROM users WHERE username_key = ?', keyOf(username));

export const userCount = () => value<number>(`SELECT COUNT(*) FROM users WHERE ${PERSON}`) ?? 0;

export async function createUser(input: NewUser): Promise<UserRow> {
  const usernameKey = keyOf(input.username);
  const emailKey = input.email ? keyOf(input.email) : null;
  if (one('SELECT 1 FROM users WHERE username_key = ?', usernameKey)) throw conflict('Der Benutzername ist schon vergeben');
  if (emailKey && one('SELECT 1 FROM users WHERE email_key = ?', emailKey)) throw conflict('Die E-Mail-Adresse wird schon genutzt');
  const hash = input.password ? await hashPassword(input.password) : null;
  const now = Date.now();
  const rootId = randomId();
  const user = tx(() => {
    const { lastId } = run(
      `INSERT INTO users (username, username_key, email, email_key, name, password_hash, role, quota_bytes, language, root_id, created_at, expires_at, pending, must_change)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.username.trim(),
      usernameKey,
      input.email?.trim() || null,
      emailKey,
      input.name.trim(),
      hash,
      input.role ?? 'user',
      input.quota ?? null,
      input.language ?? null,
      rootId,
      now,
      input.expiresAt ?? null,
      typeof input.pending === 'number' ? input.pending : input.pending ? 1 : 0,
      input.mustChange && hash ? 1 : 0
    );
    run(
      `INSERT INTO nodes (id, owner_id, parent_id, type, name, name_key, created_by, updated_by, created_at, updated_at, modified_at)
       VALUES (?, ?, NULL, 'folder', '', '', ?, ?, ?, ?, ?)`,
      rootId,
      lastId,
      lastId,
      lastId,
      now,
      now,
      now
    );
    return getUser(lastId)!;
  });
  for (const listener of accountListeners) {
    try {
      listener(user);
    } catch (error) {
      log.warn({ error: (error as Error).message, user: user.id }, 'Nach dem Anlegen des Kontos ist ein Schritt fehlgeschlagen');
    }
  }
  return user;
}

export function quotaOf(user: Pick<UserRow, 'quota_bytes'>): number | null {
  const quota = user.quota_bytes ?? settings.get('storage.defaultQuota');
  return quota > 0 ? quota : null;
}

export const usageOf = (userId: number) =>
  value<number>("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE owner_id = ? AND type = 'file'", userId) ?? 0;

export function storageOf(user: UserRow) {
  return { used: usageOf(user.id), quota: quotaOf(user), askedAt: prefsOf(user).storageAsked || null };
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    language: user.language,
    rootId: user.root_id,
    initials: initials(user.name),
    avatar: user.avatar ?? null,
  };
}

export function adminUser(user: UserRow) {
  return {
    ...publicUser(user),
    disabled: Boolean(user.disabled),
    pending: Boolean(user.pending),
    unconfirmed: Boolean(Number(user.pending) & 2),
    quota: user.quota_bytes,
    effectiveQuota: quotaOf(user),
    used: usageOf(user.id),
    totp: Boolean(user.totp_enabled),
    passkeys: value<number>('SELECT COUNT(*) FROM passkeys WHERE user_id = ?', user.id) ?? 0,
    hasPassword: Boolean(user.password_hash),
    mustChange: Boolean(user.must_change),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    lastActiveAt: lastActive(user),
    expiresAt: user.expires_at ?? null,
    expired: expired(user),
  };
}

const seen = new Map<number, number>();

export function touchSeen(userId: number, now = Date.now()) {
  if ((seen.get(userId) ?? 0) > now - 60 * 60 * 1000) return;
  seen.set(userId, now);
  run('UPDATE users SET seen_at = ? WHERE id = ?', now, userId);
}

export const lastActive = (user: Pick<UserRow, 'id' | 'seen_at' | 'last_login_at' | 'created_at'>) =>
  Math.max(
    Number(user.seen_at ?? 0),
    Number(user.last_login_at ?? 0),
    Number(user.created_at),
    Number(value<number>('SELECT MAX(last_seen_at) FROM sessions WHERE user_id = ?', user.id) ?? 0),
    Number(value<number>('SELECT MAX(last_used_at) FROM app_passwords WHERE user_id = ?', user.id) ?? 0)
  );

export function approveUser(id: number) {
  const done = run('UPDATE users SET pending = 0 WHERE id = ? AND pending != 0', id).changes > 0;
  if (done) run('DELETE FROM email_confirmations WHERE user_id = ?', id);
  return done;
}

export const listUsers = () => all<UserRow>(`SELECT * FROM users WHERE ${PERSON} ORDER BY name COLLATE NOCASE`);

export const adminCount = () => value<number>(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND ${ACTIVE}`, Date.now()) ?? 0;

export function deleteUser(id: number) {
  tx(() => {
    run('DELETE FROM sessions WHERE user_id = ?', id);
    run('DELETE FROM grants WHERE owner_id = ? OR user_id = ?', id, id);
    run('DELETE FROM links WHERE owner_id = ? OR (created_by = ? AND owner_id NOT IN (SELECT user_id FROM teams))', id, id);
    run('UPDATE links SET created_by = owner_id WHERE created_by = ?', id);
    run('UPDATE grants SET created_by = owner_id WHERE created_by = ? AND owner_id IN (SELECT user_id FROM teams)', id);
    run('DELETE FROM stars WHERE user_id = ?', id);
    run('DELETE FROM uploads WHERE user_id = ?', id);
    run(`DELETE FROM versions WHERE node_id IN (SELECT id FROM nodes WHERE owner_id = ?)`, id);
    run('UPDATE nodes SET parent_id = NULL WHERE owner_id = ?', id);
    run('DELETE FROM nodes WHERE owner_id = ?', id);
    run('DELETE FROM users WHERE id = ?', id);
  });
  rm(join(config.paths.avatars, `${id}.webp`), { force: true }, () => undefined);
}

export function searchUsers(query: string, exclude: number) {
  const q = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return all<UserRow>(
    `SELECT * FROM users WHERE id != ? AND ${ACTIVE}
       AND (name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR LOWER(email) = ?)
     ORDER BY name COLLATE NOCASE LIMIT 8`,
    exclude,
    Date.now(),
    q,
    q,
    query.trim().toLowerCase()
  ).map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    initials: initials(user.name),
    avatar: user.avatar,
    guest: user.role === 'guest',
  }));
}
