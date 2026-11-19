import { all, one, run } from '../lib/db.ts';
import { hmac, randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { Limiter } from '../lib/limiter.ts';
import * as settings from './settings.ts';
import { findByLogin, getUser, inactive, type UserRow } from './users.ts';

export interface AppPasswordRow {
  id: string;
  user_id: number;
  name: string;
  token_hash: string;
  hint: string;
  created_at: number;
  last_used_at: number | null;
  scope: string;
  shared: number;
  expires_at: number | null;
}

export interface AppAuth {
  user: UserRow;
  readOnly: boolean;
  shared: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const failures = new Limiter(20, 10 * 60 * 1000);
const hash = (token: string) => hmac(settings.secret(), `app:${token}`);

function format(raw: string) {
  return raw.match(/.{1,6}/g)!.join('-');
}

const MAX_LIFETIME = 3660 * DAY;
const KEEP_EXPIRED = 30 * DAY;

export function createAppPassword(
  user: UserRow,
  name: string,
  options: { readOnly?: boolean; shared?: boolean; expiresAt?: number | null } = {}
) {
  const token = format(randomId(30));
  const id = randomId();
  const now = Date.now();
  const expiresAt = options.expiresAt ?? null;
  if (expiresAt !== null && expiresAt <= now) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
  if (expiresAt !== null && expiresAt > now + MAX_LIFETIME) throw badRequest('Das Ablaufdatum darf höchstens zehn Jahre entfernt sein');
  run(
    'INSERT INTO app_passwords (id, user_id, name, token_hash, hint, created_at, scope, shared, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    user.id,
    name.trim().slice(0, 60) || 'App-Passwort',
    hash(token.replace(/-/g, '')),
    token.slice(-4),
    now,
    options.readOnly ? 'read' : 'full',
    options.shared ? 1 : 0,
    expiresAt
  );
  return { token, row: one<AppPasswordRow>('SELECT * FROM app_passwords WHERE id = ?', id)! };
}

export const listAppPasswords = (userId: number) =>
  all<AppPasswordRow>('SELECT * FROM app_passwords WHERE user_id = ? ORDER BY created_at DESC', userId);

export function presentAppPassword(row: AppPasswordRow) {
  return {
    id: row.id,
    name: row.name,
    hint: row.hint,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    readOnly: row.scope === 'read',
    shared: Boolean(row.shared),
    expiresAt: row.expires_at,
    expired: row.expires_at !== null && row.expires_at <= Date.now(),
  };
}

export const purgeAppPasswords = (now = Date.now()) =>
  Number(run('DELETE FROM app_passwords WHERE expires_at IS NOT NULL AND expires_at < ?', now - KEEP_EXPIRED).changes);

export function deleteAppPassword(user: UserRow, id: string) {
  if (run('DELETE FROM app_passwords WHERE id = ? AND user_id = ?', id, user.id).changes === 0) {
    throw notFound('Dieses App-Passwort gibt es nicht mehr');
  }
}

const recentUse = new Map<string, number>();

export function basicAuth(header: string | undefined, ip: string): AppAuth | null | 'blocked' {
  if (failures.blocked(ip)) return 'blocked';
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 1) return null;
  const login = decoded.slice(0, split);
  const token = decoded.slice(split + 1).replace(/[\s-]/g, '');
  const user = findByLogin(login);
  const row = token.length === 30 ? one<AppPasswordRow>('SELECT * FROM app_passwords WHERE token_hash = ?', hash(token)) : undefined;
  const now = Date.now();
  if (!user || !row || row.user_id !== user.id || inactive(user) || (row.expires_at !== null && row.expires_at <= now)) {
    failures.hit(ip);
    return null;
  }
  if ((recentUse.get(row.id) ?? 0) < now - 60_000) {
    recentUse.set(row.id, now);
    run('UPDATE app_passwords SET last_used_at = ? WHERE id = ?', now, row.id);
  }
  const current = getUser(row.user_id);
  return current ? { user: current, readOnly: row.scope === 'read', shared: Boolean(row.shared) } : null;
}
