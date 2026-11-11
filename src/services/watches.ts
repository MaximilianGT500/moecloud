import { all, one, run } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import type { ActivityInput } from './activity.ts';
import { requireAccess, resolveAccess } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, type UserRow } from './users.ts';

const ADDED = new Set(['upload', 'link_upload', 'folder', 'text', 'copy', 'extract', 'restore', 'move']);
const CHANGED = new Set(['edit', 'rename', 'version_restore', 'rotate']);
const REMOVED = new Set(['trash', 'delete']);
const QUIET = 60_000;
const LONGEST = 5 * 60_000;

interface Pending {
  user: number;
  folder: string;
  actors: Set<string>;
  added: number;
  changed: number;
  removed: number;
  name: string;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, Pending>();

export function setWatch(user: UserRow, id: string, watching: boolean) {
  const { node } = requireAccess(user, id);
  if (node.type !== 'folder') throw badRequest('Beobachten geht nur bei Ordnern');
  if (!node.parent_id) throw badRequest('Deinen Hauptordner kannst du nicht beobachten');
  if (watching) run('INSERT OR IGNORE INTO watches (user_id, node_id, created_at) VALUES (?, ?, ?)', user.id, node.id, Date.now());
  else run('DELETE FROM watches WHERE user_id = ? AND node_id = ?', user.id, node.id);
  return watching;
}

function flush(key: string) {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  if (entry.timer) clearTimeout(entry.timer);
  const user = getUser(entry.user);
  if (!user || user.disabled) return;
  const access = resolveAccess(user, entry.folder);
  if (!access || access.node.trashed_at) return;
  notify(
    entry.user,
    'watch',
    {
      folder: access.node.name,
      by: entry.actors.size === 1 ? [...entry.actors][0] : '',
      added: entry.added,
      changed: entry.changed,
      removed: entry.removed,
      name: entry.name,
    },
    `/files/folder/${entry.folder}`
  );
}

export function flushWatches() {
  for (const key of [...pending.keys()]) flush(key);
}

export function noteActivity(input: ActivityInput) {
  const kind = ADDED.has(input.action) ? 'added' : CHANGED.has(input.action) ? 'changed' : REMOVED.has(input.action) ? 'removed' : null;
  if (!kind || !input.parent || !one('SELECT 1 FROM watches LIMIT 1')) return;
  const watchers = all<{ user_id: number; node_id: string }>(
    `WITH RECURSIVE up(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM nodes WHERE id = ?
       UNION ALL SELECT n.id, n.parent_id, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id WHERE up.depth < 64
     )
     SELECT w.user_id, w.node_id FROM watches w JOIN up ON up.id = w.node_id ORDER BY up.depth`,
    input.parent
  );
  const actor = input.actor ? (getUser(input.actor)?.name ?? '') : '';
  const seen = new Set<number>();
  for (const watch of watchers) {
    if (watch.user_id === input.actor || seen.has(watch.user_id)) continue;
    seen.add(watch.user_id);
    const key = `${watch.user_id}:${watch.node_id}`;
    const entry = pending.get(key) ?? {
      user: watch.user_id,
      folder: watch.node_id,
      actors: new Set<string>(),
      added: 0,
      changed: 0,
      removed: 0,
      name: input.name,
      started: Date.now(),
      timer: null,
    };
    entry.actors.add(actor);
    entry[kind]++;
    entry.name = input.name;
    if (entry.timer) clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(QUIET, entry.started + LONGEST - Date.now()));
    entry.timer = setTimeout(() => flush(key), wait);
    entry.timer.unref?.();
    pending.set(key, entry);
  }
}
