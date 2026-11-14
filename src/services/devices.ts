import type { FastifyReply, FastifyRequest } from 'fastify';
import { one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { isSecure, truncateIp } from '../lib/http.ts';
import { notify } from './notify.ts';
import type { UserRow } from './users.ts';

export const DEVICE_COOKIE = 'moe_device';
const KEEP = 400 * 24 * 60 * 60 * 1000;
const QUIET = new Set(['setup', 'register']);

function tokenOf(request: FastifyRequest) {
  const token = request.cookies?.[DEVICE_COOKIE];
  return token && /^[\w-]{32,64}$/.test(token) ? token : null;
}

const agentOf = (request: FastifyRequest) => String(request.headers['user-agent'] ?? '').slice(0, 300) || null;

function keep(request: FastifyRequest, reply: FastifyReply, user: UserRow, token: string) {
  const now = Date.now();
  run(
    `INSERT INTO devices (user_id, hash, agent, created_at, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, hash) DO UPDATE SET agent = excluded.agent, seen_at = excluded.seen_at`,
    user.id,
    sha256(token),
    agentOf(request),
    now,
    now
  );
  reply.setCookie(DEVICE_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(request), maxAge: KEEP / 1000 });
}

export function rememberDevice(request: FastifyRequest, reply: FastifyReply, user: UserRow, method: string) {
  const token = tokenOf(request) ?? randomId(40);
  const known = Boolean(one('SELECT 1 AS found FROM devices WHERE user_id = ? AND hash = ?', user.id, sha256(token)));
  const first = !known && !one('SELECT 1 AS found FROM devices WHERE user_id = ? LIMIT 1', user.id);
  keep(request, reply, user, token);
  if (known || first || QUIET.has(method)) return false;
  notify(user.id, 'login_new', { agent: agentOf(request) ?? '', ip: truncateIp(request.ip) || '?', method }, '/account#sitzungen');
  return true;
}

export const purgeDevices = () => run('DELETE FROM devices WHERE seen_at < ?', Date.now() - KEEP).changes;

export function forgetOtherDevices(request: FastifyRequest, reply: FastifyReply, user: UserRow) {
  const token = tokenOf(request) ?? randomId(40);
  const removed = run('DELETE FROM devices WHERE user_id = ? AND hash != ?', user.id, sha256(token)).changes;
  keep(request, reply, user, token);
  return removed;
}
