import { all, run } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { changed, getNode, requireMutable, trash, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, type UserRow } from './users.ts';

const DAY = 86_400_000;
export const MAX_EXPIRY = 10 * 365 * DAY;

export function setExpiry(user: UserRow, id: string, at: number | null, now = Date.now()) {
  const { node } = requireMutable(user, id);
  if (at !== null) {
    if (at < now + 60_000) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
    if (at > now + MAX_EXPIRY) throw badRequest('Das Ablaufdatum darf höchstens zehn Jahre in der Zukunft liegen');
  }
  run('UPDATE nodes SET expires_at = ?, expires_by = ? WHERE id = ?', at, at === null ? null : user.id, id);
  changed([node.parent_id, node.id]);
  return getNode(id)!;
}

export function expireNodes(now = Date.now()) {
  const due = all<NodeRow & { expires_by: number | null }>(
    'SELECT * FROM nodes WHERE expires_at IS NOT NULL AND expires_at <= ? AND trashed_at IS NULL ORDER BY expires_at LIMIT 500',
    now
  );
  let moved = 0;
  for (const node of due) {
    const owner = getUser(node.owner_id);
    if (!owner) continue;
    try {
      trash(owner, [node.id]);
      moved++;
    } catch (error) {
      log.debug({ error: (error as Error).message, node: node.id }, 'Abgelaufenes Element bleibt vorerst liegen');
      continue;
    }
    const who = owner.role !== 'team' ? owner.id : node.expires_by && getUser(node.expires_by) ? node.expires_by : null;
    if (who) notify(who, 'node_expired', { name: node.name, folder: node.type === 'folder' ? 1 : 0 }, '/files/trash');
  }
  return moved;
}
