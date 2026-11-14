import { all, one, run } from '../lib/db.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { requireAccess, trash, TREE } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, type UserRow } from './users.ts';

const DAY = 24 * 60 * 60 * 1000;
const EVERY = 60 * 60 * 1000;
const BATCH = 500;

interface RuleRow {
  node_id: string;
  user_id: number;
  days: number;
  created_at: number;
  run_at: number | null;
}

export const ruleDays = (nodeId: string) => {
  const days = one<{ days: number }>('SELECT days FROM rules WHERE node_id = ?', nodeId)?.days;
  return days === undefined ? null : Number(days);
};

export function setRule(user: UserRow, nodeId: string, days: number | null) {
  const { node } = requireAccess(user, nodeId);
  if (node.type !== 'folder') throw badRequest('Aufräumregeln gibt es nur für Ordner');
  if (!node.parent_id) throw badRequest('Für den Hauptordner gibt es keine Aufräumregel');
  if (node.owner_id !== user.id) throw forbidden('Eine Aufräumregel kann nur festlegen, wem der Ordner gehört');
  if (days === null) {
    run('DELETE FROM rules WHERE node_id = ?', node.id);
    return null;
  }
  run(
    `INSERT INTO rules (node_id, user_id, days, created_at, run_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (node_id) DO UPDATE SET days = excluded.days, run_at = NULL`,
    node.id,
    user.id,
    days,
    Date.now()
  );
  return days;
}

export function expiredIn(nodeId: string, days: number, now = Date.now(), limit = BATCH) {
  return all<{ id: string }>(
    `${TREE("WHERE n.type = 'folder' AND n.trashed_at IS NULL")}
     SELECT n.id FROM nodes n WHERE n.parent_id IN (SELECT id FROM tree) AND n.type = 'file' AND n.trashed_at IS NULL AND n.updated_at < ?
     ORDER BY n.updated_at LIMIT ?`,
    nodeId,
    now - days * DAY,
    limit
  ).map((row) => row.id);
}

export function applyRules(now = Date.now()) {
  let total = 0;
  const due = all<RuleRow & { name: string }>(
    `SELECT r.*, n.name FROM rules r JOIN nodes n ON n.id = r.node_id
     WHERE n.trashed_at IS NULL AND (r.run_at IS NULL OR r.run_at < ?) ORDER BY r.run_at`,
    now - EVERY
  );
  for (const rule of due) {
    run('UPDATE rules SET run_at = ? WHERE node_id = ?', now, rule.node_id);
    const user = getUser(rule.user_id);
    if (!user || user.disabled) continue;
    let count = 0;
    for (const id of expiredIn(rule.node_id, Number(rule.days), now)) {
      try {
        trash(user, [id]);
        count++;
      } catch (error) {
        log.debug({ error: (error as Error).message, id }, 'Aufräumregel hat eine Datei übersprungen');
      }
    }
    if (!count) continue;
    total += count;
    notify(user.id, 'cleanup', { count, folder: rule.name, days: Number(rule.days) }, '/files/trash', { email: false });
  }
  return total;
}
