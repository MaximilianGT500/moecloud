import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { record } from './activity.ts';
import { audience, requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import { getUser, inactive, initials, keyOf, type UserRow } from './users.ts';

interface CommentRow {
  id: string;
  node_id: string;
  user_id: number | null;
  text: string;
  created_at: number;
  updated_at: number;
}

const MENTION = /(?<![\w@.-])@([a-zA-Z0-9._-]{3,32})/g;

export const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '✅'];

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  people: string[];
}

interface ReactionRow {
  comment_id: string;
  emoji: string;
  user_id: number;
}

function summarize(rows: ReactionRow[], viewer: UserRow) {
  const out = new Map<string, Reaction[]>();
  const names = new Map<number, string | null>();
  for (const row of rows) {
    const list = out.get(row.comment_id) ?? [];
    let entry = list.find((item) => item.emoji === row.emoji);
    if (!entry) {
      entry = { emoji: row.emoji, count: 0, mine: false, people: [] };
      list.push(entry);
    }
    entry.count++;
    if (row.user_id === viewer.id) entry.mine = true;
    else if (entry.people.length < 10) {
      if (!names.has(row.user_id)) {
        const person = getUser(row.user_id);
        names.set(row.user_id, person && !inactive(person) ? person.name : null);
      }
      const name = names.get(row.user_id);
      if (name) entry.people.push(name);
    }
    out.set(row.comment_id, list);
  }
  return out;
}

function mentioned(text: string, people: Map<string, UserRow>) {
  const found = new Map<number, UserRow>();
  for (const match of text.matchAll(MENTION)) {
    const handle = match[1].replace(/[.-]+$/, '');
    const person = people.get(keyOf(match[1])) ?? people.get(keyOf(handle));
    if (person) found.set(person.id, person);
  }
  return [...found.values()];
}

function peopleOf(nodeId: string) {
  const people = new Map<string, UserRow>();
  for (const id of audience([nodeId])) {
    const person = getUser(id);
    if (person && !inactive(person)) people.set(person.username_key, person);
  }
  return people;
}

export function commentPeople(user: UserRow, nodeId: string) {
  requireAccess(user, nodeId, 'view');
  return [...peopleOf(nodeId).values()]
    .filter((person) => person.id !== user.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((person) => ({
      id: person.id,
      name: person.name,
      username: person.username,
      initials: initials(person.name),
      avatar: person.avatar ?? null,
    }));
}

function present(row: CommentRow, viewer: UserRow, people: Map<string, UserRow>, reactions: Map<string, Reaction[]> = new Map()) {
  const author = row.user_id ? getUser(row.user_id) : null;
  return {
    id: row.id,
    text: row.text,
    mentions: mentioned(row.text, people).map((person) => ({ username: person.username, name: person.name, me: person.id === viewer.id })),
    author: author ? { id: author.id, name: author.name, initials: initials(author.name), avatar: author.avatar ?? null } : null,
    mine: row.user_id === viewer.id,
    edited: row.updated_at > row.created_at,
    createdAt: row.created_at,
    reactions: reactions.get(row.id) ?? [],
  };
}

function commentUrl(person: UserRow, node: NodeRow) {
  if (node.parent_id && resolveAccess(person, node.parent_id)) return `/files/folder/${node.parent_id}?select=${node.id}&tab=comments`;
  if (node.type === 'folder') return `/files/folder/${node.id}`;
  return '/files/shared';
}

export function listComments(user: UserRow, nodeId: string) {
  requireAccess(user, nodeId, 'view');
  const people = peopleOf(nodeId);
  const reactions = summarize(
    all<ReactionRow>(
      `SELECT r.comment_id, r.emoji, r.user_id FROM comment_reactions r JOIN comments c ON c.id = r.comment_id
       WHERE c.node_id = ? ORDER BY r.created_at, r.user_id`,
      nodeId
    ),
    user
  );
  return all<CommentRow>('SELECT * FROM comments WHERE node_id = ? ORDER BY created_at LIMIT 500', nodeId).map((row) =>
    present(row, user, people, reactions)
  );
}

export function reactToComment(user: UserRow, nodeId: string, id: string, emoji: string, on: boolean) {
  requireAccess(user, nodeId, 'view');
  if (!REACTIONS.includes(emoji)) throw badRequest('Diese Reaktion gibt es nicht');
  const row = one<CommentRow>('SELECT * FROM comments WHERE id = ? AND node_id = ?', id, nodeId);
  if (!row) throw notFound('Diesen Kommentar gibt es nicht mehr');
  if (on) {
    run(
      'INSERT INTO comment_reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      id,
      user.id,
      emoji,
      Date.now()
    );
  } else {
    run('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?', id, user.id, emoji);
  }
  publish(audience([nodeId]), 'comment', { nodeId });
  const reactions = summarize(
    all<ReactionRow>('SELECT comment_id, emoji, user_id FROM comment_reactions WHERE comment_id = ? ORDER BY created_at, user_id', id),
    user
  );
  return present(row, user, peopleOf(nodeId), reactions);
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
  const known = peopleOf(node.id);
  const named = new Set(mentioned(text, known).map((person) => person.id));
  for (const person of people) {
    const target = getUser(person);
    if (!target) continue;
    const params = { by: user.name, name: node.name, text: text.slice(0, 280) };
    notify(person, named.has(person) ? 'mention' : 'comment', params, commentUrl(target, node));
  }
  publish(audience([node.id]), 'comment', { nodeId });
  return present(one<CommentRow>('SELECT * FROM comments WHERE id = ?', id)!, user, known);
}

export function deleteComment(user: UserRow, nodeId: string, id: string) {
  const access = requireAccess(user, nodeId, 'view');
  const row = one<CommentRow>('SELECT * FROM comments WHERE id = ? AND node_id = ?', id, nodeId);
  if (!row) throw notFound('Diesen Kommentar gibt es nicht mehr');
  if (row.user_id !== user.id && access.role !== 'owner') throw notFound('Diesen Kommentar gibt es nicht mehr');
  run('DELETE FROM comments WHERE id = ?', id);
  publish(audience([nodeId]), 'comment', { nodeId });
}
