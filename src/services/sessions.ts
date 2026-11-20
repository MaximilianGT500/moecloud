import type { FastifyReply, FastifyRequest } from 'fastify';
import { all, one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { isSecure, truncateIp } from '../lib/http.ts';
import { rememberDevice } from './devices.ts';
import { rememberOrigin } from './origins.ts';
import * as settings from './settings.ts';
import { getUser, inactive, type UserRow } from './users.ts';

export const SESSION_COOKIE = 'moe_session';
const DAY = 24 * 60 * 60 * 1000;
const TOUCH_EVERY = 5 * 60 * 1000;
const COOKIE_DAYS = 400;

const days = (key: 'auth.sessionDays' | 'auth.sessionMaxDays', min: number) => {
  const value = Number(settings.get(key));
  return Number.isFinite(value) ? Math.min(365, Math.max(min, Math.floor(value))) : min;
};

export function sessionRules() {
  const limit = days('auth.sessionMaxDays', 0) * DAY;
  const idle = days('auth.sessionDays', 1) * DAY;
  return { idle: limit ? Math.min(idle, limit) : idle, limit };
}

type Times = Pick<SessionRow, 'created_at' | 'last_seen_at' | 'expires_at'>;

function alive(session: Times, now: number, rules = sessionRules()) {
  if (Number(session.expires_at) <= now) return false;
  if (Number(session.last_seen_at) + rules.idle <= now) return false;
  return !rules.limit || Number(session.created_at) + rules.limit > now;
}

function cookieAge(session: Times, now: number, rules = sessionRules()) {
  const left = rules.limit ? Number(session.created_at) + rules.limit - now : COOKIE_DAYS * DAY;
  return Math.max(60, Math.floor(left / 1000));
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, session: Times, now: number) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(request),
    maxAge: cookieAge(session, now),
  });
}

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
    expires_at: now + sessionRules().idle,
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
  if (user.role === 'admin') rememberOrigin(request);
  setSessionCookie(request, reply, token, session, now);
  rememberDevice(request, reply, user, method);
  return session;
}

export function sessionUser(cookieHeader: string | undefined) {
  const match = /(?:^|;\s*)moe_session=([^;]+)/.exec(cookieHeader ?? '');
  const token = match ? decodeURIComponent(match[1]) : '';
  if (!token || token.length > 100) return null;
  const session = one<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!session || !alive(session, Date.now())) return null;
  const user = getUser(session.user_id);
  return user && !inactive(user) ? { user, method: session.method } : null;
}

export function readSession(request: FastifyRequest, reply?: FastifyReply): Auth | null {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const session = one<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!session) return null;
  const now = Date.now();
  const rules = sessionRules();
  if (!alive(session, now, rules)) {
    run('DELETE FROM sessions WHERE id = ?', session.id);
    return null;
  }
  const user = getUser(session.user_id);
  if (!user || inactive(user)) return null;
  if (now - session.last_seen_at > TOUCH_EVERY) {
    session.last_seen_at = now;
    session.expires_at = now + rules.idle;
    run(
      'UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = ? WHERE id = ?',
      now,
      session.expires_at,
      truncateIp(request.ip) || null,
      session.id
    );
    if (reply) setSessionCookie(request, reply, token, session, now);
  }
  return { user, session };
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(request) });
}

export const destroySession = (id: string) => run('DELETE FROM sessions WHERE id = ?', id);

export const destroyUserSessions = (userId: number, keep?: string) =>
  keep ? run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keep) : run('DELETE FROM sessions WHERE user_id = ?', userId);

export function listSessions(userId: number) {
  const now = Date.now();
  const rules = sessionRules();
  return all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', userId, now).filter(
    (session) => alive(session, now, rules)
  );
}

export function purgeExpiredSessions() {
  const now = Date.now();
  const rules = sessionRules();
  const idle = run('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?', now, now - rules.idle).changes;
  const old = rules.limit ? run('DELETE FROM sessions WHERE created_at <= ?', now - rules.limit).changes : 0;
  return { changes: idle + old };
}

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
