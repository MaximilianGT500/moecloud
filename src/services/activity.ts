import { all, one, run } from '../lib/db.ts';
import { initials, getUser } from './users.ts';

export type ActivityAction =
  | 'upload'
  | 'folder'
  | 'text'
  | 'edit'
  | 'rename'
  | 'move'
  | 'copy'
  | 'trash'
  | 'restore'
  | 'delete'
  | 'version_restore'
  | 'share_user'
  | 'unshare_user'
  | 'share_group'
  | 'unshare_group'
  | 'extract'
  | 'rotate'
  | 'share_link'
  | 'link_upload'
  | 'comment'
  | 'color';

interface ActivityRow {
  id: number;
  owner_id: number;
  actor_id: number | null;
  link_id: string | null;
  node_id: string | null;
  parent_id: string | null;
  action: ActivityAction;
  name: string;
  count: number;
  details: string | null;
  created_at: number;
}

export interface ActivityInput {
  owner: number;
  actor: number | null;
  link?: string | null;
  node?: string | null;
  parent?: string | null;
  action: ActivityAction;
  name: string;
  details?: Record<string, unknown>;
}

const GROUPED = new Set<ActivityAction>(['upload', 'link_upload', 'trash', 'restore', 'move', 'copy']);
const WINDOW = 3 * 60 * 1000;

export function record(input: ActivityInput) {
  const now = Date.now();
  if (GROUPED.has(input.action)) {
    const last = one<ActivityRow>(
      `SELECT * FROM activity WHERE owner_id = ? AND action = ? AND parent_id IS ? AND actor_id IS ? AND link_id IS ? AND created_at > ?
       ORDER BY id DESC LIMIT 1`,
      input.owner,
      input.action,
      input.parent ?? null,
      input.actor,
      input.link ?? null,
      now - WINDOW
    );
    if (last) {
      run(
        'UPDATE activity SET count = count + 1, name = ?, node_id = ?, created_at = ? WHERE id = ?',
        input.name,
        input.node ?? null,
        now,
        last.id
      );
      return;
    }
  }
  run(
    `INSERT INTO activity (owner_id, actor_id, link_id, node_id, parent_id, action, name, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.owner,
    input.actor,
    input.link ?? null,
    input.node ?? null,
    input.parent ?? null,
    input.action,
    input.name,
    input.details ? JSON.stringify(input.details) : null,
    now
  );
}

function present(rows: ActivityRow[], viewer: number) {
  const people = new Map<number, { id: number; name: string; initials: string } | null>();
  const person = (id: number | null) => {
    if (!id) return null;
    if (!people.has(id)) {
      const user = getUser(id);
      people.set(id, user ? { id: user.id, name: user.name, initials: initials(user.name) } : null);
    }
    return people.get(id) ?? null;
  };
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    name: row.name,
    count: row.count,
    nodeId: row.node_id,
    parentId: row.parent_id,
    actor: person(row.actor_id),
    self: row.actor_id === viewer,
    viaLink: Boolean(row.link_id),
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  }));
}

export function forNode(nodeId: string, viewer: number, limit = 40) {
  return present(
    all<ActivityRow>('SELECT * FROM activity WHERE node_id = ? OR parent_id = ? ORDER BY created_at DESC LIMIT ?', nodeId, nodeId, limit),
    viewer
  );
}

export function forUser(userId: number, before?: number, limit = 50) {
  const rows = all<ActivityRow>(
    'SELECT * FROM activity WHERE (owner_id = ? OR actor_id = ?) AND id < ? ORDER BY id DESC LIMIT ?',
    userId,
    userId,
    before ?? Number.MAX_SAFE_INTEGER,
    limit + 1
  );
  return { items: present(rows.slice(0, limit), userId), more: rows.length > limit };
}

export function purgeActivity(days: number) {
  if (days <= 0) return 0;
  return run('DELETE FROM activity WHERE created_at < ?', Date.now() - days * 86_400_000).changes;
}
