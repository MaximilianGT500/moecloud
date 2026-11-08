import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { record } from './activity.ts';
import { audience, requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, initials, type UserRow } from './users.ts';

interface CommentRow {
  id: string;
  node_id: string;
  user_id: number | null;
  text: string;
  created_at: number;
  updated_at: number;
}

function present(row: CommentRow, viewer: UserRow) {
  const author = row.user_id ? getUser(row.user_id) : null;
  return {
    id: row.id,
    text: row.text,
    author: author ? { id: author.id, name: author.name, initials: initials(author.name) } : null,
    mine: row.user_id === viewer.id,
    edited: row.updated_at > row.created_at,
    createdAt: row.created_at,
  };
}

function commentUrl(person: UserRow, node: NodeRow) {
  if (node.parent_id && resolveAccess(person, node.parent_id)) return `/files/folder/${node.parent_id}?select=${node.id}&tab=comments`;
  if (node.type === 'folder') return `/files/folder/${node.id}`;
  return '/files/shared';
}

export function listComments(user: UserRow, nodeId: string) {
  requireAccess(user, nodeId, 'view');
  return all<CommentRow>('SELECT * FROM comments WHERE node_id = ? ORDER BY created_at LIMIT 500', nodeId).map((row) => present(row, user));
}

export function addComment(user: UserRow, nodeId: string, raw: string) {
  const { node } = requireAccess(user, nodeId, 'view');
  const text = raw.trim();
  if (!text) throw badRequest('Schreib etwas in den Kommentar');
  if (text.length > 4000) throw badRequest('Ein Kommentar darf höchstens 4000 Zeichen haben');
  const id = randomId();
  const now = Date.now();
  run(
    'INSERT INTO comments (id, node_id, user_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    nodeId,
    user.id,
    text,
    now,
    now
  );
  record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'comment', name: node.name });
  const people = new Set(audience([node.id]));
  for (const row of all<{ user_id: number }>('SELECT DISTINCT user_id FROM comments WHERE node_id = ? AND user_id IS NOT NULL', nodeId)) {
    people.add(row.user_id);
  }
  people.delete(user.id);
  for (const person of people) {
    const target = getUser(person);
    if (!target) continue;
    notify(person, 'comment', { by: user.name, name: node.name, text: text.slice(0, 280) }, commentUrl(target, node));
  }
  publish(audience([node.id]), 'comment', { nodeId });
  return present(one<CommentRow>('SELECT * FROM comments WHERE id = ?', id)!, user);
}

export function deleteComment(user: UserRow, nodeId: string, id: string) {
  const access = requireAccess(user, nodeId, 'view');
  const row = one<CommentRow>('SELECT * FROM comments WHERE id = ? AND node_id = ?', id, nodeId);
  if (!row) throw notFound('Diesen Kommentar gibt es nicht mehr');
  if (row.user_id !== user.id && access.role !== 'owner') throw notFound('Diesen Kommentar gibt es nicht mehr');
  run('DELETE FROM comments WHERE id = ?', id);
  publish(audience([nodeId]), 'comment', { nodeId });
}
