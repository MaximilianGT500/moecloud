import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { getNode, requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, inactive, type UserRow } from './users.ts';

interface ReminderRow {
  id: string;
  user_id: number;
  node_id: string;
  due_at: number;
  note: string | null;
  created_at: number;
}

const MAX_AHEAD = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_PER_USER = 500;

function urlFor(user: UserRow, node: NodeRow) {
  if (node.parent_id && resolveAccess(user, node.parent_id)) return `/files/folder/${node.parent_id}?select=${node.id}`;
  if (node.type === 'folder') return `/files/folder/${node.id}`;
  return '/files/shared';
}

export function setReminder(user: UserRow, nodeId: string, dueAt: number, rawNote: string | null | undefined) {
  const { node } = requireAccess(user, nodeId, 'view');
  if (!node.parent_id) throw badRequest('An den Hauptordner kannst du dich nicht erinnern lassen');
  const now = Date.now();
  if (dueAt <= now) throw badRequest('Der Zeitpunkt muss in der Zukunft liegen');
  if (dueAt > now + MAX_AHEAD) throw badRequest('Der Zeitpunkt liegt zu weit in der Zukunft');
  const note = rawNote?.trim() || null;
  if (note && note.length > 500) throw badRequest('Die Notiz darf höchstens 500 Zeichen haben');
  const existing = one<ReminderRow>('SELECT * FROM reminders WHERE user_id = ? AND node_id = ?', user.id, node.id);
  if (!existing && Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', user.id)?.n ?? 0) >= MAX_PER_USER) {
    throw badRequest('Du hast schon sehr viele Erinnerungen, lösch erst ein paar');
  }
  run(
    `INSERT INTO reminders (id, user_id, node_id, due_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, node_id) DO UPDATE SET due_at = excluded.due_at, note = excluded.note`,
    randomId(),
    user.id,
    node.id,
    dueAt,
    note,
    now
  );
  publish([user.id], 'change', { folders: [node.parent_id] });
  return { dueAt, note };
}

export function removeReminder(user: UserRow, nodeId: string) {
  const { changes } = run('DELETE FROM reminders WHERE user_id = ? AND node_id = ?', user.id, nodeId);
  const node = changes ? getNode(nodeId) : undefined;
  if (node?.parent_id) publish([user.id], 'change', { folders: [node.parent_id] });
  return changes > 0;
}

export function listReminders(user: UserRow) {
  return all<ReminderRow & { name: string; type: 'file' | 'folder' }>(
    `SELECT r.*, n.name, n.type FROM reminders r JOIN nodes n ON n.id = r.node_id
     WHERE r.user_id = ? AND n.trashed_at IS NULL ORDER BY r.due_at LIMIT 200`,
    user.id
  )
    .map((row) => {
      const node = getNode(row.node_id);
      return node && resolveAccess(user, node.id)
        ? { nodeId: row.node_id, name: row.name, type: row.type, dueAt: Number(row.due_at), note: row.note, url: urlFor(user, node) }
        : null;
    })
    .filter((entry) => entry !== null);
}

export function fireReminders(now = Date.now()) {
  const due = all<ReminderRow>('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at LIMIT 500', now);
  let sent = 0;
  for (const row of due) {
    run('DELETE FROM reminders WHERE id = ?', row.id);
    const user = getUser(row.user_id);
    const node = getNode(row.node_id);
    if (!user || inactive(user) || !node || node.trashed_at || !resolveAccess(user, node.id)) continue;
    notify(user.id, 'reminder', { name: node.name, note: row.note ?? '' }, urlFor(user, node));
    if (node.parent_id) publish([user.id], 'change', { folders: [node.parent_id] });
    sent += 1;
  }
  return sent;
}
