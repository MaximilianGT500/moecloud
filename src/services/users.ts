import { all, one, run, tx, value } from '../lib/db.ts';
import { hashPassword, randomId } from '../lib/crypto.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { isLang, type Lang } from '../lib/i18n.ts';
import * as settings from './settings.ts';

export interface UserRow {
  id: number;
  username: string;
  username_key: string;
  email: string | null;
  email_key: string | null;
  name: string;
  password_hash: string | null;
  role: 'admin' | 'user';
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
}

export interface UserPrefs {
  mailShares: boolean;
  mailUploads: boolean;
  mailComments: boolean;
  mailWatch: boolean;
  mailAdmin: boolean;
  mailLogins: boolean;
  storageWarned: boolean;
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
  storageWarned: false,
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
  role?: 'admin' | 'user';
  quota?: number | null;
  language?: Lang | null;
}

export const keyOf = (value: string) => value.normalize('NFC').trim().toLowerCase();

export const getUser = (id: number) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);

export function requireUser(id: number) {
  const user = getUser(id);
  if (!user) throw notFound('Diese Person gibt es nicht');
  return user;
}

export function findByLogin(login: string) {
  const key = keyOf(login);
  return one<UserRow>('SELECT * FROM users WHERE username_key = ? OR email_key = ?', key, key);
}

export const findByUsername = (username: string) => one<UserRow>('SELECT * FROM users WHERE username_key = ?', keyOf(username));

export const userCount = () => value<number>('SELECT COUNT(*) FROM users') ?? 0;

export async function createUser(input: NewUser): Promise<UserRow> {
  const usernameKey = keyOf(input.username);
  const emailKey = input.email ? keyOf(input.email) : null;
  if (one('SELECT 1 FROM users WHERE username_key = ?', usernameKey)) throw conflict('Der Benutzername ist schon vergeben');
  if (emailKey && one('SELECT 1 FROM users WHERE email_key = ?', emailKey)) throw conflict('Die E-Mail-Adresse wird schon genutzt');
  const hash = input.password ? await hashPassword(input.password) : null;
  const now = Date.now();
  const rootId = randomId();
  return tx(() => {
    const { lastId } = run(
      `INSERT INTO users (username, username_key, email, email_key, name, password_hash, role, quota_bytes, language, root_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now
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
}

export function quotaOf(user: Pick<UserRow, 'quota_bytes'>): number | null {
  const quota = user.quota_bytes ?? settings.get('storage.defaultQuota');
  return quota > 0 ? quota : null;
}

export const usageOf = (userId: number) =>
  value<number>("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE owner_id = ? AND type = 'file'", userId) ?? 0;

export function storageOf(user: UserRow) {
  return { used: usageOf(user.id), quota: quotaOf(user) };
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
  };
}

export function adminUser(user: UserRow) {
  return {
    ...publicUser(user),
    disabled: Boolean(user.disabled),
    quota: user.quota_bytes,
    effectiveQuota: quotaOf(user),
    used: usageOf(user.id),
    totp: Boolean(user.totp_enabled),
    passkeys: value<number>('SELECT COUNT(*) FROM passkeys WHERE user_id = ?', user.id) ?? 0,
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export const listUsers = () => all<UserRow>('SELECT * FROM users ORDER BY name COLLATE NOCASE');

export const adminCount = () => value<number>("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0") ?? 0;

export function deleteUser(id: number) {
  tx(() => {
    run('DELETE FROM sessions WHERE user_id = ?', id);
    run('DELETE FROM grants WHERE owner_id = ? OR user_id = ?', id, id);
    run('DELETE FROM links WHERE owner_id = ? OR created_by = ?', id, id);
    run('DELETE FROM stars WHERE user_id = ?', id);
    run('DELETE FROM uploads WHERE user_id = ?', id);
    run(`DELETE FROM versions WHERE node_id IN (SELECT id FROM nodes WHERE owner_id = ?)`, id);
    run('UPDATE nodes SET parent_id = NULL WHERE owner_id = ?', id);
    run('DELETE FROM nodes WHERE owner_id = ?', id);
    run('DELETE FROM users WHERE id = ?', id);
  });
}

export function searchUsers(query: string, exclude: number) {
  const q = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return all<UserRow>(
    `SELECT * FROM users WHERE id != ? AND disabled = 0 AND (name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
     ORDER BY name COLLATE NOCASE LIMIT 8`,
    exclude,
    q,
    q,
    q
  ).map((user) => ({ id: user.id, username: user.username, name: user.name, initials: initials(user.name) }));
}
