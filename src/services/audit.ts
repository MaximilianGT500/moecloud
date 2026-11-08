import type { FastifyRequest } from 'fastify';
import { all, placeholders, run } from '../lib/db.ts';
import { truncateIp } from '../lib/http.ts';
import { getUser } from './users.ts';

export const AUDIT_ACTIONS = [
  'login',
  'login_failed',
  'logout',
  'password_changed',
  'password_reset_requested',
  'password_reset',
  'totp_enabled',
  'totp_disabled',
  'recovery_codes',
  'passkey_added',
  'passkey_removed',
  'app_password_created',
  'app_password_removed',
  'sessions_revoked',
  'registered',
  'user_created',
  'user_updated',
  'user_deleted',
  'user_disabled',
  'user_enabled',
  'role_changed',
  'admin_password_set',
  'admin_2fa_reset',
  'admin_logout',
  'files_transferred',
  'invite_created',
  'invite_deleted',
  'settings_changed',
  'mail_changed',
  'scan_changed',
  'webhook_changed',
  'link_removed',
  'virus_found',
  'virus_released',
  'virus_deleted',
  'backup_created',
  'backup_deleted',
  'backup_failed',
  'maintenance',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const SECURITY_ACTIONS: AuditAction[] = [
  'login',
  'login_failed',
  'password_changed',
  'password_reset',
  'totp_enabled',
  'totp_disabled',
  'recovery_codes',
  'passkey_added',
  'passkey_removed',
  'app_password_created',
  'app_password_removed',
  'sessions_revoked',
  'admin_password_set',
  'admin_2fa_reset',
  'admin_logout',
];

interface AuditRow {
  id: number;
  actor_id: number | null;
  subject_id: number | null;
  action: AuditAction;
  ip: string | null;
  details: string | null;
  created_at: number;
}

export interface AuditInput {
  actor?: number | null;
  subject?: number | null;
  request?: FastifyRequest | null;
  ip?: string | null;
  details?: Record<string, unknown>;
}

export function audit(action: AuditAction, input: AuditInput = {}) {
  const ip = input.ip ?? (input.request ? truncateIp(input.request.ip) : null);
  run(
    'INSERT INTO audit (actor_id, subject_id, action, ip, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.actor ?? null,
    input.subject ?? input.actor ?? null,
    action,
    ip || null,
    input.details && Object.keys(input.details).length ? JSON.stringify(input.details) : null,
    Date.now()
  );
}

export interface AuditQuery {
  before?: number;
  limit?: number;
  user?: number;
  actions?: AuditAction[];
}

export function listAudit(query: AuditQuery) {
  const where: string[] = [];
  const params: (number | string)[] = [];
  if (query.before) {
    where.push('id < ?');
    params.push(query.before);
  }
  if (query.user) {
    where.push('(actor_id = ? OR subject_id = ?)');
    params.push(query.user, query.user);
  }
  if (query.actions?.length) {
    where.push(`action IN (${placeholders(query.actions.length)})`);
    params.push(...query.actions);
  }
  const limit = Math.max(1, Math.min(200, query.limit ?? 50));
  const rows = all<AuditRow>(
    `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit + 1
  );
  const names = new Map<number, { name: string; username: string } | null>();
  const person = (id: number | null) => {
    if (!id) return null;
    if (!names.has(id)) {
      const user = getUser(id);
      names.set(id, user ? { name: user.name, username: user.username } : null);
    }
    const found = names.get(id);
    return found ? { id, ...found } : { id, name: '', username: '' };
  };
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      action: row.action,
      actor: person(row.actor_id),
      subject: row.subject_id && row.subject_id !== row.actor_id ? person(row.subject_id) : null,
      ip: row.ip,
      details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
      createdAt: row.created_at,
    })),
    more: rows.length > limit,
  };
}

export function purgeAudit(days: number) {
  if (days <= 0) return 0;
  return run('DELETE FROM audit WHERE created_at < ?', Date.now() - days * 86_400_000).changes;
}

export function recentFailures(minutes: number) {
  return (
    all<{ count: number }>(
      'SELECT COUNT(*) AS count FROM audit WHERE action = ? AND created_at > ?',
      'login_failed',
      Date.now() - minutes * 60_000
    )[0]?.count ?? 0
  );
}
