import { all, one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { notFound } from '../lib/errors.ts';
import { getUser, type UserRow } from './users.ts';

export interface InviteRow {
  id: string;
  token_hash: string;
  created_by: number | null;
  note: string | null;
  quota_bytes: number | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: number | null;
  email: string | null;
}

export function createInvite(admin: UserRow, note: string | null, days: number, quota: number | null, email: string | null = null) {
  const token = randomId(24);
  const id = randomId();
  const now = Date.now();
  run(
    'INSERT INTO invites (id, token_hash, created_by, note, quota_bytes, created_at, expires_at, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    sha256(token),
    admin.id,
    note?.trim() || null,
    quota,
    now,
    now + Math.max(1, Math.min(90, days)) * 86_400_000,
    email
  );
  return { token, invite: one<InviteRow>('SELECT * FROM invites WHERE id = ?', id)! };
}

export function findInvite(token: string | undefined) {
  if (!token || token.length > 64) return null;
  const invite = one<InviteRow>('SELECT * FROM invites WHERE token_hash = ?', sha256(token));
  if (!invite || invite.used_at || invite.expires_at < Date.now()) return null;
  return invite;
}

export const useInvite = (id: string, userId: number) =>
  run('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?', Date.now(), userId, id);

export const listInvites = () => all<InviteRow>('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100');

export function deleteInvite(id: string) {
  if (run('DELETE FROM invites WHERE id = ?', id).changes === 0) throw notFound();
}

export function presentInvite(invite: InviteRow) {
  return {
    id: invite.id,
    note: invite.note,
    email: invite.email,
    quota: invite.quota_bytes,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    usedAt: invite.used_at,
    usedBy: invite.used_by ? (getUser(invite.used_by)?.name ?? null) : null,
    expired: !invite.used_at && invite.expires_at < Date.now(),
  };
}

export const purgeInvites = () => run('DELETE FROM invites WHERE used_at IS NULL AND expires_at < ?', Date.now() - 30 * 86_400_000);
