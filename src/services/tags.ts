import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { FOLDER_COLORS, requireAccess, resolveAccess, type Found, type NodeRow } from './nodes.ts';
import type { UserRow } from './users.ts';

export const TAG_COLORS = FOLDER_COLORS;
export const MAX_TAGS = 200;

export interface TagRow {
  id: string;
  owner_id: number;
  name: string;
  name_key: string;
  color: string;
  created_at: number;
}

export interface TagView {
  id: string;
  name: string;
  color: string;
  count: number;
}

const keyOf = (name: string) => name.toLocaleLowerCase('de');

function cleanName(raw: string) {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name) throw badRequest('Gib einen Namen ein');
  if ([...name].length > 40) throw badRequest('Ein Schlagwort darf höchstens 40 Zeichen haben');
  return name;
}

const present = (tag: TagRow, count = 0): TagView => ({ id: tag.id, name: tag.name, color: tag.color, count });

export function ownTag(user: UserRow, id: string) {
  const tag = one<TagRow>('SELECT * FROM tags WHERE id = ? AND owner_id = ?', id, user.id);
  if (!tag) throw notFound('Das Schlagwort gibt es nicht mehr');
  return tag;
}

function visible(user: UserRow) {
  const cache = new Map<string, boolean>();
  return (node: Pick<NodeRow, 'id' | 'owner_id'>) => {
    if (node.owner_id === user.id) return true;
    if (!cache.has(node.id)) cache.set(node.id, Boolean(resolveAccess(user, node.id)));
    return cache.get(node.id)!;
  };
}

export function listTags(user: UserRow): TagView[] {
  const tags = all<TagRow>('SELECT * FROM tags WHERE owner_id = ? ORDER BY name_key', user.id);
  const canSee = visible(user);
  const counts = new Map<string, number>();
  for (const row of all<{ tag_id: string; id: string; owner_id: number }>(
    `SELECT nt.tag_id, n.id, n.owner_id FROM node_tags nt
     JOIN tags t ON t.id = nt.tag_id
     JOIN nodes n ON n.id = nt.node_id
     WHERE t.owner_id = ? AND n.trashed_at IS NULL`,
    user.id
  )) {
    if (canSee(row)) counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1);
  }
  return tags.map((tag) => present(tag, counts.get(tag.id)));
}

function assertFree(user: UserRow, name: string, except?: string) {
  const existing = one<{ id: string }>('SELECT id FROM tags WHERE owner_id = ? AND name_key = ?', user.id, keyOf(name));
  if (existing && existing.id !== except) throw conflict('Das Schlagwort „{name}“ gibt es schon', { name });
}

export function createTag(user: UserRow, rawName: string, color: string) {
  const name = cleanName(rawName);
  assertFree(user, name);
  if ((value<number>('SELECT COUNT(*) FROM tags WHERE owner_id = ?', user.id) ?? 0) >= MAX_TAGS) {
    throw badRequest('Du kannst höchstens {count} Schlagwörter anlegen', { count: MAX_TAGS });
  }
  const tag: TagRow = { id: randomId(), owner_id: user.id, name, name_key: keyOf(name), color, created_at: Date.now() };
  run(
    'INSERT INTO tags (id, owner_id, name, name_key, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    tag.id,
    tag.owner_id,
    tag.name,
    tag.name_key,
    tag.color,
    tag.created_at
  );
  publish([user.id], 'tags', {});
  return present(tag);
}

export function updateTag(user: UserRow, id: string, patch: { name?: string; color?: string }) {
  const tag = ownTag(user, id);
  const name = patch.name === undefined ? tag.name : cleanName(patch.name);
  if (patch.name !== undefined) assertFree(user, name, tag.id);
  const color = patch.color ?? tag.color;
  run('UPDATE tags SET name = ?, name_key = ?, color = ? WHERE id = ?', name, keyOf(name), color, tag.id);
  publish([user.id], 'tags', {});
  return present({ ...tag, name, name_key: keyOf(name), color });
}

export function deleteTag(user: UserRow, id: string) {
  const tag = ownTag(user, id);
  run('DELETE FROM tags WHERE id = ?', tag.id);
  publish([user.id], 'tags', {});
}

export function applyTags(user: UserRow, nodeIds: string[], add: string[], remove: string[]) {
  const wanted = [...new Set([...add, ...remove])];
  if (wanted.length === 0) return 0;
  for (const tagId of wanted) ownTag(user, tagId);
  const nodes = [...new Set(nodeIds)].map((nodeId) => requireAccess(user, nodeId).node);
  if (nodes.some((node) => !node.parent_id)) throw badRequest('Deinem Hauptordner kannst du keine Schlagwörter geben');
  const now = Date.now();
  tx(() => {
    for (const node of nodes) {
      for (const tagId of add) run('INSERT OR IGNORE INTO node_tags (tag_id, node_id, created_at) VALUES (?, ?, ?)', tagId, node.id, now);
      for (const tagId of remove) run('DELETE FROM node_tags WHERE tag_id = ? AND node_id = ?', tagId, node.id);
    }
  });
  publish([user.id], 'change', { folders: [...new Set(nodes.map((node) => node.parent_id))] });
  publish([user.id], 'tags', {});
  return nodes.length;
}

export function taggedNodes(user: UserRow, tagId: string) {
  const tag = ownTag(user, tagId);
  const canSee = visible(user);
  const nodes = all<Found>(
    `SELECT n.*, p.name AS parent_name FROM node_tags nt
     JOIN nodes n ON n.id = nt.node_id
     LEFT JOIN nodes p ON p.id = n.parent_id
     WHERE nt.tag_id = ? AND n.trashed_at IS NULL
     ORDER BY nt.created_at DESC`,
    tag.id
  )
    .filter(canSee)
    .map((node) => (node.owner_id === user.id ? node : { ...node, parent_name: null }));
  return { tag: present(tag, nodes.length), nodes };
}

export function taggedIds(user: UserRow, tagId: string) {
  const tag = ownTag(user, tagId);
  return new Set(all<{ node_id: string }>('SELECT node_id FROM node_tags WHERE tag_id = ?', tag.id).map((row) => row.node_id));
}
