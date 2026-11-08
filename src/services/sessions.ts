import type { FastifyReply, FastifyRequest } from 'fastify';
import { all, one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { isSecure, truncateIp } from '../lib/http.ts';
import { getUser, type UserRow } from './users.ts';

export const SESSION_COOKIE = 'moe_session';
const LIFETIME = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY = 5 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: number;
  token_hash: string;
  csrf: string;
  method: string;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export interface Auth {
  user: UserRow;
  session: SessionRow;
}

export function createSession(request: FastifyRequest, reply: FastifyReply, user: UserRow, method: string) {
  const token = randomId(43);
  const now = Date.now();
  const session: SessionRow = {
    id: randomId(20),
    user_id: user.id,
    token_hash: sha256(token),
    csrf: randomId(32),
    method,
    user_agent: String(request.headers['user-agent'] ?? '').slice(0, 300) || null,
    ip: truncateIp(request.ip) || null,
    created_at: now,
    last_seen_at: now,
    expires_at: now + LIFETIME,
  };
  run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf, method, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.user_id,
    session.token_hash,
    session.csrf,
    session.method,
    session.user_agent,
    session.ip,
    session.created_at,
    session.last_seen_at,
    session.expires_at
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(request),
    maxAge: LIFETIME / 1000,
  });
  return session;
}

export function readSession(request: FastifyRequest): Auth | null {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const session = one<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at <= now) {
    run('DELETE FROM sessions WHERE id = ?', session.id);
    return null;
  }
  const user = getUser(session.user_id);
  if (!user || user.disabled) return null;
  if (now - session.last_seen_at > TOUCH_EVERY) {
    session.last_seen_at = now;
    session.expires_at = now + LIFETIME;
    run(
      'UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = ? WHERE id = ?',
      now,
      session.expires_at,
      truncateIp(request.ip) || null,
      session.id
    );
  }
  return { user, session };
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(request) });
}

export const destroySession = (id: string) => run('DELETE FROM sessions WHERE id = ?', id);

export const destroyUserSessions = (userId: number, keep?: string) =>
  keep ? run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keep) : run('DELETE FROM sessions WHERE user_id = ?', userId);

export const listSessions = (userId: number) =>
  all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', userId, Date.now());

export const purgeExpiredSessions = () => run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());

export function describeSession(session: SessionRow, current: string) {
  return {
    id: session.id,
    current: session.id === current,
    method: session.method,
    userAgent: session.user_agent,
    ip: session.ip,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
  };
}
