import { run } from '../lib/db.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { notify } from './notify.ts';
import { assertUnlocked, changed, lockOf, requireAccess, resolveAccess } from './nodes.ts';
import { getUser, type UserRow } from './users.ts';

export const MAX_LOCK_MINUTES = 30 * 24 * 60;

export function lockNode(user: UserRow, nodeId: string, minutes: number | null) {
  const { node } = requireAccess(user, nodeId, 'edit');
  if (node.type !== 'file') throw badRequest('Sperren geht nur bei Dateien');
  assertUnlocked(node, user.id);
  const now = Date.now();
  run(
    `INSERT INTO locks (node_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (node_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    node.id,
    user.id,
    now,
    minutes ? now + minutes * 60_000 : null
  );
  changed([node.parent_id]);
  return lockOf(node.id)!;
}

export function unlockNode(user: UserRow, nodeId: string) {
  const { node } = requireAccess(user, nodeId, 'view');
  const lock = lockOf(node.id);
  if (lock && lock.userId !== user.id && node.owner_id !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'Entsperren können nur {name}, die Person, der die Datei gehört, und Admins', 'forbidden', {
      name: lock.name,
    });
  }
  run('DELETE FROM locks WHERE node_id = ?', node.id);
  if (!lock) return false;
  changed([node.parent_id]);
  const holder = lock.userId === user.id ? null : getUser(lock.userId);
  if (holder) {
    const url =
      node.parent_id && resolveAccess(holder, node.parent_id) ? `/files/folder/${node.parent_id}?select=${node.id}` : '/files/shared';
    notify(holder.id, 'lock_removed', { name: user.name, file: node.name }, url, { email: false });
  }
  return true;
}

export const purgeLocks = (now = Date.now()) => run('DELETE FROM locks WHERE expires_at IS NOT NULL AND expires_at <= ?', now).changes;
