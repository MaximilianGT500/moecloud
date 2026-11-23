import { all, one, tx } from '../lib/db.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { record } from './activity.ts';
import { getNode, rename, requireFolder, restore, subtree, trash, TREE, type NodeRow } from './nodes.ts';
import type { UserRow } from './users.ts';
import { writeContent } from './versions.ts';

export type RewindAction = 'trash' | 'restore' | 'rename' | 'content' | 'missing';

export interface RewindItem {
  id: string;
  type: 'file' | 'folder';
  name: string;
  path: string;
  action: RewindAction;
  from?: string;
  version?: string;
}

interface VersionRow {
  id: string;
  node_id: string;
  sha256: string;
  created_at: number;
  modified_at: number;
}

export const REWIND_DAYS = 365;
const SHOWN = 500;

function folderOf(user: UserRow, folderId: string) {
  const { node } = requireFolder(user, folderId, 'edit');
  if (node.owner_id !== user.id) throw badRequest('Zurücksetzen geht nur in deinen eigenen Ordnern');
  return node;
}

function checkTime(at: number) {
  const now = Date.now();
  if (!Number.isSafeInteger(at) || at <= 0 || at >= now) throw badRequest('Wähl einen Zeitpunkt in der Vergangenheit');
  if (at < now - REWIND_DAYS * 86_400_000) throw badRequest('Weiter als {count} Tage zurück geht es nicht', { count: REWIND_DAYS });
}

export function planRewind(user: UserRow, folderId: string, at: number) {
  const folder = folderOf(user, folderId);
  checkTime(at);
  const nodes = subtree(folder.id, true).filter((node) => node.id !== folder.id);
  const byId = new Map<string, NodeRow>(nodes.map((node) => [node.id, node]));
  byId.set(folder.id, folder);

  const pathOf = (node: NodeRow) => {
    const parts: string[] = [];
    let current: NodeRow | undefined = node;
    let guard = 0;
    while (current && current.id !== folder.id && guard++ < 256) {
      parts.unshift(current.name);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return parts.join('/');
  };

  const trashedBefore = (node: NodeRow) => {
    let current = node.parent_id ? byId.get(node.parent_id) : undefined;
    let guard = 0;
    while (current && current.id !== folder.id && guard++ < 256) {
      if (current.trashed_at !== null && Number(current.trashed_at) <= at) return true;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return false;
  };

  const restoreRoots = nodes
    .filter(
      (node) =>
        node.trashed_at !== null && node.trash_root && Number(node.trashed_at) > at && Number(node.created_at) <= at && !trashedBefore(node)
    )
    .sort((a, b) => Number(b.trashed_at) - Number(a.trashed_at) || a.seq - b.seq);

  const ancestors = (node: NodeRow, visit: (ancestor: NodeRow) => boolean) => {
    let current: NodeRow | undefined = node;
    let guard = 0;
    while (current && guard++ < 256) {
      if (visit(current)) return true;
      if (current.id === folder.id) return false;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return false;
  };

  const rootIds = new Set(restoreRoots.map((node) => node.id));
  const restoredIds = new Set<string>();
  for (const node of nodes) {
    if (node.trashed_at === null) continue;
    const stamp = Number(node.trashed_at);
    ancestors(node, (ancestor) => {
      if (rootIds.has(ancestor.id) && Number(ancestor.trashed_at) === stamp) {
        restoredIds.add(node.id);
        return true;
      }
      return Number(ancestor.trashed_at ?? Number.NaN) !== stamp;
    });
  }

  const present = nodes.filter((node) => node.trashed_at === null || restoredIds.has(node.id));
  const childrenOf = new Map<string, NodeRow[]>();
  for (const node of present) {
    if (!node.parent_id) continue;
    childrenOf.set(node.parent_id, [...(childrenOf.get(node.parent_id) ?? []), node]);
  }

  const hasOlder = new Map<string, boolean>();
  const older = (node: NodeRow): boolean => {
    const known = hasOlder.get(node.id);
    if (known !== undefined) return known;
    hasOlder.set(node.id, false);
    const result = Number(node.created_at) <= at || (childrenOf.get(node.id) ?? []).some((child) => older(child));
    hasOlder.set(node.id, result);
    return result;
  };

  const fresh = present.filter((node) => node.trashed_at === null && Number(node.created_at) > at);
  const freshIds = new Set(fresh.map((node) => node.id));
  const whole = (node: NodeRow) => freshIds.has(node.id) && !(node.type === 'folder' && older(node));
  const trashRoots = fresh.filter(
    (node) => whole(node) && !ancestors(node, (ancestor) => ancestor.id !== node.id && ancestor.id !== folder.id && whole(ancestor))
  );
  const trashRootIds = new Set(trashRoots.map((node) => node.id));
  const goingAway = new Set<string>();
  for (const node of present) {
    if (ancestors(node, (ancestor) => trashRootIds.has(ancestor.id))) goingAway.add(node.id);
  }

  const kept = present.filter((node) => !goingAway.has(node.id) && Number(node.created_at) <= at);
  const keptIds = new Set(kept.map((node) => node.id));

  const renames = new Map<string, string>();
  for (const row of all<{ node_id: string | null; details: string | null }>(
    "SELECT node_id, details FROM activity WHERE owner_id = ? AND action = 'rename' AND created_at > ? ORDER BY created_at, id",
    user.id,
    at
  )) {
    if (!row.node_id || !keptIds.has(row.node_id) || renames.has(row.node_id) || !row.details) continue;
    try {
      const from = (JSON.parse(row.details) as { from?: unknown }).from;
      if (typeof from === 'string' && from) renames.set(row.node_id, from);
    } catch {}
  }

  const versions = new Map<string, VersionRow[]>();
  for (const row of all<VersionRow>(
    `${TREE('')} SELECT v.id, v.node_id, v.sha256, v.created_at, v.modified_at FROM versions v JOIN tree t ON t.id = v.node_id ORDER BY v.created_at, v.id`,
    folder.id
  )) {
    if (!keptIds.has(row.node_id)) continue;
    versions.set(row.node_id, [...(versions.get(row.node_id) ?? []), row]);
  }

  const items: RewindItem[] = [];
  const add = (node: NodeRow, action: RewindAction, extra: Partial<RewindItem> = {}) =>
    items.push({ id: node.id, type: node.type, name: node.name, path: pathOf(node), action, ...extra });

  for (const node of trashRoots) add(node, 'trash');
  for (const node of restoreRoots) add(node, 'restore');
  for (const node of kept) {
    const from = renames.get(node.id);
    if (from && from !== node.name) add(node, 'rename', { from });
    if (node.type !== 'file') continue;
    const list = versions.get(node.id) ?? [];
    const index = list.findIndex((version) => Number(version.created_at) > at);
    if (index === -1) continue;
    const target = list[index];
    if (target.sha256 === node.sha256) continue;
    const known = index > 0 || Number(target.modified_at) <= at;
    if (known) add(node, 'content', { version: target.id });
    else add(node, 'missing');
  }

  const deleted = Number(
    one<{ n: number }>(
      `${TREE('')} SELECT COUNT(*) AS n FROM activity a WHERE a.owner_id = ? AND a.action = 'delete' AND a.created_at > ?
         AND (a.parent_id IN (SELECT id FROM tree))`,
      folder.id,
      user.id,
      at
    )?.n ?? 0
  );

  const counts = { trash: 0, restore: 0, rename: 0, content: 0, missing: 0, deleted };
  for (const item of items) counts[item.action]++;
  const order: Record<RewindAction, number> = { restore: 0, content: 1, rename: 2, trash: 3, missing: 4 };
  const sorted = [...items].sort((a, b) => order[a.action] - order[b.action] || a.path.localeCompare(b.path));
  return {
    folder: { id: folder.id, name: folder.name, root: folder.parent_id === null },
    at,
    counts,
    total: items.filter((item) => item.action !== 'missing').length,
    items: sorted.slice(0, SHOWN),
    more: Math.max(0, sorted.length - SHOWN),
    plan: items,
  };
}

export function applyRewind(user: UserRow, folderId: string, at: number) {
  const planned = planRewind(user, folderId, at);
  const done = { trash: 0, restore: 0, rename: 0, content: 0 };
  let skipped = 0;
  const attempt = (work: () => void) => {
    try {
      work();
      return true;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      skipped++;
      return false;
    }
  };

  const toTrash = planned.plan.filter((item) => item.action === 'trash').map((item) => item.id);
  for (let start = 0; start < toTrash.length; start += 200) {
    const chunk = toTrash.slice(start, start + 200);
    if (attempt(() => trash(user, chunk))) done.trash += chunk.length;
    else for (const id of chunk) if (attempt(() => trash(user, [id]))) done.trash++;
  }

  for (const item of planned.plan.filter((entry) => entry.action === 'restore')) {
    if (attempt(() => restore(user, [item.id]))) done.restore++;
  }

  for (const item of planned.plan.filter((entry) => entry.action === 'rename')) {
    if (attempt(() => rename(user, item.id, item.from))) done.rename++;
  }

  for (const item of planned.plan.filter((entry) => entry.action === 'content')) {
    const ok = attempt(() =>
      tx(() => {
        const node = getNode(item.id);
        const version = one<{ id: string; sha256: string; size: number; modified_at: number }>(
          'SELECT id, sha256, size, modified_at FROM versions WHERE id = ? AND node_id = ?',
          item.version,
          item.id
        );
        if (!node || node.trashed_at !== null || !version) throw badRequest('Die Version gibt es nicht mehr');
        writeContent(node, { sha256: version.sha256, size: Number(version.size), modifiedAt: Number(version.modified_at) }, user.id);
        record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'version_restore', name: node.name });
      })
    );
    if (ok) done.content++;
  }

  return { folder: planned.folder, at, done, skipped, missing: planned.counts.missing, deleted: planned.counts.deleted };
}
