import { all, one, placeholders, run, tx } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, insufficientStorage, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { kindOf, mimeOf } from '../lib/mime.ts';
import { cleanName, nameKey, uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import { typeOf, type BlobRow } from './blobs.ts';
import { previews } from './thumbs.ts';
import { getUser, quotaOf, usageOf, type UserRow } from './users.ts';

export interface NodeRow {
  seq: number;
  id: string;
  owner_id: number;
  parent_id: string | null;
  type: 'file' | 'folder';
  name: string;
  name_key: string;
  size: number;
  mime: string | null;
  sha256: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: number;
  updated_at: number;
  modified_at: number;
  trashed_at: number | null;
  trash_root: number;
  etag: number;
  color: string | null;
}

export type Role = 'owner' | 'edit' | 'view';
const RANK: Record<Role, number> = { view: 1, edit: 2, owner: 3 };

export interface Access {
  node: NodeRow;
  role: Role;
  rootId: string;
}

const CHAIN = `WITH RECURSIVE chain(id, depth) AS (
  SELECT ?, 0
  UNION ALL
  SELECT n.parent_id, c.depth + 1 FROM nodes n JOIN chain c ON n.id = c.id WHERE n.parent_id IS NOT NULL AND c.depth < 256
)`;

const TREE = (filter: string) => `WITH RECURSIVE tree(id, depth) AS (
  SELECT ?, 0
  UNION ALL
  SELECT n.id, t.depth + 1 FROM nodes n JOIN tree t ON n.parent_id = t.id ${filter}
)`;

export const getNode = (id: string) => one<NodeRow>('SELECT * FROM nodes WHERE id = ?', id);

export const chain = (id: string) =>
  all<NodeRow & { depth: number }>(`${CHAIN} SELECT n.*, c.depth FROM chain c JOIN nodes n ON n.id = c.id ORDER BY c.depth DESC`, id);

export function subtree(rootId: string, includeTrashed = false) {
  return all<NodeRow & { depth: number }>(
    `${TREE(includeTrashed ? '' : 'WHERE n.trashed_at IS NULL')} SELECT n.*, t.depth FROM tree t JOIN nodes n ON n.id = t.id ORDER BY t.depth`,
    rootId
  );
}

export function resolveAccess(user: UserRow, nodeId: string): Access | null {
  const node = getNode(nodeId);
  if (!node) return null;
  if (node.owner_id === user.id) return { node, role: 'owner', rootId: user.root_id };
  const grants = all<{ permission: 'view' | 'edit'; node_id: string; depth: number }>(
    `${CHAIN} SELECT g.permission, g.node_id, c.depth FROM chain c JOIN grants g ON g.node_id = c.id
     WHERE g.user_id = ? AND (g.expires_at IS NULL OR g.expires_at > ?)
     UNION ALL
     SELECT gg.permission, gg.node_id, c.depth FROM chain c
     JOIN group_grants gg ON gg.node_id = c.id
     JOIN group_members m ON m.group_id = gg.group_id
     WHERE m.user_id = ? AND (gg.expires_at IS NULL OR gg.expires_at > ?)`,
    nodeId,
    user.id,
    Date.now(),
    user.id,
    Date.now()
  );
  if (grants.length === 0) return null;
  let role: Role = 'view';
  let top = grants[0];
  for (const grant of grants) {
    if (grant.permission === 'edit') role = 'edit';
    if (grant.depth > top.depth) top = grant;
  }
  return { node, role, rootId: top.node_id };
}

export function requireAccess(user: UserRow, nodeId: string, need: Role = 'view', allowTrashed = false): Access {
  const access = resolveAccess(user, nodeId);
  if (!access || (access.node.trashed_at && !allowTrashed)) throw notFound('Diese Datei oder diesen Ordner gibt es nicht mehr');
  if (RANK[access.role] < RANK[need]) throw forbidden('Dafür fehlen dir die Rechte');
  return access;
}

export function requireFolder(user: UserRow, nodeId: string, need: Role = 'view') {
  const access = requireAccess(user, nodeId, need);
  if (access.node.type !== 'folder') throw badRequest('Das ist kein Ordner');
  return access;
}

export function requireMutable(user: UserRow, nodeId: string): Access {
  const access = requireAccess(user, nodeId, 'view');
  if (!access.node.parent_id) throw forbidden('Den Hauptordner kannst du nicht ändern');
  if (access.role === 'owner') return access;
  if (access.rootId === access.node.id) throw forbidden('Diesen geteilten Ordner kann nur die Person ändern, der er gehört');
  if (access.role !== 'edit') throw forbidden('Dafür fehlen dir die Rechte');
  return access;
}

export function breadcrumbs(access: Access) {
  const nodes = chain(access.node.id);
  const start = Math.max(
    0,
    nodes.findIndex((node) => node.id === access.rootId)
  );
  return nodes.slice(start).map((node) => ({ id: node.id, name: node.name }));
}

export const findChild = (parentId: string, name: string) =>
  one<NodeRow>('SELECT * FROM nodes WHERE parent_id = ? AND name_key = ? AND trashed_at IS NULL', parentId, nameKey(name));

export const taken = (parentId: string) => (key: string) =>
  Boolean(one('SELECT 1 FROM nodes WHERE parent_id = ? AND name_key = ? AND trashed_at IS NULL', parentId, key));

export const children = (folderId: string, foldersOnly = false) =>
  all<NodeRow>(
    `SELECT * FROM nodes WHERE parent_id = ? AND trashed_at IS NULL ${foldersOnly ? "AND type = 'folder'" : ''} ORDER BY type DESC, name_key`,
    folderId
  );

export interface NewNode {
  ownerId: number;
  parentId: string;
  type: 'file' | 'folder';
  name: string;
  actorId: number | null;
  size?: number;
  sha256?: string | null;
  modifiedAt?: number | null;
}

export function insertNode(input: NewNode): NodeRow {
  const now = Date.now();
  const id = randomId();
  run(
    `INSERT INTO nodes (id, owner_id, parent_id, type, name, name_key, size, mime, sha256, created_by, updated_by, created_at, updated_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.ownerId,
    input.parentId,
    input.type,
    input.name,
    nameKey(input.name),
    input.type === 'file' ? (input.size ?? 0) : 0,
    input.type === 'file' ? mimeOf(input.name) : null,
    input.type === 'file' ? (input.sha256 ?? null) : null,
    input.actorId,
    input.actorId,
    now,
    now,
    input.modifiedAt && input.modifiedAt > 0 ? Math.min(input.modifiedAt, now + 60_000) : now
  );
  run('UPDATE nodes SET updated_at = ? WHERE id = ?', now, input.parentId);
  return getNode(id)!;
}

export function audience(nodeIds: Iterable<string | null>): number[] {
  const users = new Set<number>();
  for (const id of new Set(nodeIds)) {
    if (!id) continue;
    const owner = one<{ owner_id: number }>('SELECT owner_id FROM nodes WHERE id = ?', id);
    if (owner) users.add(owner.owner_id);
    for (const row of all<{ user_id: number }>(
      `${CHAIN} SELECT g.user_id FROM chain c JOIN grants g ON g.node_id = c.id WHERE g.expires_at IS NULL OR g.expires_at > ?
       UNION
       SELECT m.user_id FROM chain c JOIN group_grants gg ON gg.node_id = c.id JOIN group_members m ON m.group_id = gg.group_id
       WHERE gg.expires_at IS NULL OR gg.expires_at > ?`,
      id,
      Date.now(),
      Date.now()
    )) {
      users.add(row.user_id);
    }
  }
  return [...users];
}

export function changed(folderIds: Iterable<string | null>, extraUsers: number[] = []) {
  const folders = [...new Set(folderIds)].filter((id): id is string => Boolean(id));
  publish([...audience(folders), ...extraUsers], 'change', { folders });
}

export function remaining(ownerId: number): number {
  const owner = getUser(ownerId);
  if (!owner) return 0;
  const quota = quotaOf(owner);
  return quota === null ? Number.MAX_SAFE_INTEGER : Math.max(0, quota - usageOf(ownerId));
}

export function assertSpace(ownerId: number, bytes: number, actorId: number | null) {
  if (bytes <= 0) return;
  if (remaining(ownerId) < bytes) {
    throw insufficientStorage(
      ownerId === actorId ? 'Dein Speicher ist voll' : 'Der Speicher der Person, der dieser Ordner gehört, ist voll'
    );
  }
}

export function createFolder(user: UserRow, parentId: string, rawName: unknown) {
  const parent = requireFolder(user, parentId, 'edit');
  const name = cleanName(rawName);
  if (findChild(parentId, name)) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name });
  const node = insertNode({ ownerId: parent.node.owner_id, parentId, type: 'folder', name, actorId: user.id });
  record({ owner: node.owner_id, actor: user.id, node: node.id, parent: parentId, action: 'folder', name });
  changed([parentId]);
  return node;
}

export function ensurePath(ownerId: number, actorId: number | null, parentId: string, segments: string[]) {
  let current = parentId;
  for (const segment of segments) {
    const existing = findChild(current, segment);
    if (existing?.type === 'folder') {
      current = existing.id;
      continue;
    }
    const name = existing ? uniqueName(segment, true, taken(current)) : segment;
    current = insertNode({ ownerId, parentId: current, type: 'folder', name, actorId }).id;
  }
  return current;
}

export function rename(user: UserRow, id: string, rawName: unknown) {
  const { node } = requireMutable(user, id);
  const name = cleanName(rawName);
  if (name === node.name) return node;
  const existing = findChild(node.parent_id!, name);
  if (existing && existing.id !== node.id) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name });
  run(
    `UPDATE nodes SET name = ?, name_key = ?, mime = CASE WHEN type = 'file' THEN ? ELSE mime END, updated_at = ?, updated_by = ?, etag = etag + 1 WHERE id = ?`,
    name,
    nameKey(name),
    mimeOf(name),
    Date.now(),
    user.id,
    id
  );
  record({ owner: node.owner_id, actor: user.id, node: id, parent: node.parent_id, action: 'rename', name, details: { from: node.name } });
  changed([node.parent_id]);
  return getNode(id)!;
}

export function renameMany(user: UserRow, changes: { id: string; name: unknown }[]) {
  if (new Set(changes.map((change) => change.id)).size !== changes.length) throw badRequest('Jedes Element darf nur einmal vorkommen');
  const planned = changes
    .map((change) => ({ node: requireMutable(user, change.id).node, name: cleanName(change.name) }))
    .filter((entry) => entry.name !== entry.node.name);
  const parents = new Map<string, typeof planned>();
  for (const entry of planned) parents.set(entry.node.parent_id!, [...(parents.get(entry.node.parent_id!) ?? []), entry]);
  for (const [parentId, entries] of parents) {
    const moving = new Set(entries.map((entry) => entry.node.id));
    const occupied = new Set(children(parentId).flatMap((child) => (moving.has(child.id) ? [] : [child.name_key])));
    for (const entry of entries) {
      const key = nameKey(entry.name);
      if (occupied.has(key)) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name: entry.name });
      occupied.add(key);
    }
  }
  const now = Date.now();
  tx(() => {
    for (const entry of planned) run('UPDATE nodes SET name_key = ? WHERE id = ?', `/${entry.node.id}`, entry.node.id);
    for (const entry of planned) {
      run(
        `UPDATE nodes SET name = ?, name_key = ?, mime = CASE WHEN type = 'file' THEN ? ELSE mime END, updated_at = ?, updated_by = ?, etag = etag + 1 WHERE id = ?`,
        entry.name,
        nameKey(entry.name),
        mimeOf(entry.name),
        now,
        user.id,
        entry.node.id
      );
      record({
        owner: entry.node.owner_id,
        actor: user.id,
        node: entry.node.id,
        parent: entry.node.parent_id,
        action: 'rename',
        name: entry.name,
        details: { from: entry.node.name },
      });
    }
  });
  changed([...parents.keys()]);
  return changes.map((change) => getNode(change.id)!);
}

export function move(user: UserRow, ids: string[], targetId: string) {
  const target = requireFolder(user, targetId, 'edit');
  const lineage = new Set(chain(targetId).map((node) => node.id));
  const folders = new Set<string | null>([targetId]);
  const moved: NodeRow[] = [];
  tx(() => {
    for (const id of ids) {
      const { node } = requireMutable(user, id);
      if (node.parent_id === targetId) continue;
      if (lineage.has(node.id)) throw badRequest('Einen Ordner kannst du nicht in sich selbst verschieben');
      if (node.owner_id !== target.node.owner_id) throw badRequest('Zwischen deinen Dateien und geteilten Ordnern kannst du nur kopieren');
      const name = uniqueName(node.name, node.type === 'folder', taken(targetId));
      run(
        'UPDATE nodes SET parent_id = ?, name = ?, name_key = ?, updated_at = ?, updated_by = ?, etag = etag + 1 WHERE id = ?',
        targetId,
        name,
        nameKey(name),
        Date.now(),
        user.id,
        node.id
      );
      folders.add(node.parent_id);
      moved.push(getNode(node.id)!);
      record({
        owner: node.owner_id,
        actor: user.id,
        node: node.id,
        parent: targetId,
        action: 'move',
        name,
        details: { to: target.node.name },
      });
    }
  });
  changed(folders);
  return moved;
}

export function moveTo(user: UserRow, id: string, targetId: string, rawName: string) {
  const { node } = requireMutable(user, id);
  const target = requireFolder(user, targetId, 'edit');
  const name = cleanName(rawName);
  if (chain(targetId).some((entry) => entry.id === node.id)) throw badRequest('Einen Ordner kannst du nicht in sich selbst verschieben');
  if (node.owner_id !== target.node.owner_id) throw badRequest('Zwischen deinen Dateien und geteilten Ordnern kannst du nur kopieren');
  const existing = findChild(targetId, name);
  if (existing && existing.id !== node.id) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name });
  run(
    `UPDATE nodes SET parent_id = ?, name = ?, name_key = ?, mime = CASE WHEN type = 'file' THEN ? ELSE mime END, updated_at = ?, updated_by = ?, etag = etag + 1 WHERE id = ?`,
    targetId,
    name,
    nameKey(name),
    mimeOf(name),
    Date.now(),
    user.id,
    id
  );
  record({
    owner: node.owner_id,
    actor: user.id,
    node: id,
    parent: targetId,
    action: node.parent_id === targetId ? 'rename' : 'move',
    name,
    details: node.parent_id === targetId ? { from: node.name } : { to: target.node.name },
  });
  changed([node.parent_id, targetId]);
  return getNode(id)!;
}

export function copyTo(user: UserRow, id: string, targetId: string, rawName: string) {
  const source = requireAccess(user, id, 'view').node;
  const target = requireFolder(user, targetId, 'edit');
  const name = cleanName(rawName);
  if (!source.parent_id) throw badRequest('Den Hauptordner kannst du nicht kopieren');
  if (findChild(targetId, name)) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name });
  assertSpace(
    target.node.owner_id,
    subtree(source.id).reduce((total, node) => total + node.size, 0),
    user.id
  );
  const created = tx(() => copyTree(source, targetId, name, target.node.owner_id, user.id));
  record({ owner: target.node.owner_id, actor: user.id, node: created.id, parent: targetId, action: 'copy', name });
  changed([targetId]);
  return created;
}

function copyTree(source: NodeRow, parentId: string, name: string, ownerId: number, actorId: number) {
  const nodes = subtree(source.id);
  const mapping = new Map<string, string>();
  let first: NodeRow | null = null;
  for (const node of nodes) {
    const parent = node.id === source.id ? parentId : mapping.get(node.parent_id!);
    if (!parent) continue;
    const created = insertNode({
      ownerId,
      parentId: parent,
      type: node.type,
      name: node.id === source.id ? name : node.name,
      actorId,
      size: node.size,
      sha256: node.sha256,
      modifiedAt: node.modified_at,
    });
    mapping.set(node.id, created.id);
    first ??= created;
  }
  return first!;
}

export function copy(user: UserRow, ids: string[], targetId: string) {
  const target = requireFolder(user, targetId, 'edit');
  const sources = ids.map((id) => requireAccess(user, id, 'view').node);
  for (const source of sources) if (!source.parent_id) throw badRequest('Den Hauptordner kannst du nicht kopieren');
  const bytes = sources.reduce((sum, source) => sum + subtree(source.id).reduce((total, node) => total + node.size, 0), 0);
  assertSpace(target.node.owner_id, bytes, user.id);
  const copies = tx(() =>
    sources.map((source) => {
      const name = uniqueName(source.name, source.type === 'folder', taken(targetId));
      const created = copyTree(source, targetId, name, target.node.owner_id, user.id);
      record({ owner: target.node.owner_id, actor: user.id, node: created.id, parent: targetId, action: 'copy', name });
      return created;
    })
  );
  changed([targetId]);
  return copies;
}

export function trash(user: UserRow, ids: string[]) {
  const now = Date.now();
  const folders = new Set<string | null>();
  tx(() => {
    for (const id of ids) {
      const { node } = requireMutable(user, id);
      run(`${TREE('WHERE n.trashed_at IS NULL')} UPDATE nodes SET trashed_at = ? WHERE id IN (SELECT id FROM tree)`, id, now);
      run('UPDATE nodes SET trash_root = 1 WHERE id = ?', id);
      record({ owner: node.owner_id, actor: user.id, node: id, parent: node.parent_id, action: 'trash', name: node.name });
      folders.add(node.parent_id);
    }
  });
  changed(folders);
}

export function restore(user: UserRow, ids: string[]) {
  const folders = new Set<string | null>();
  const restored: NodeRow[] = [];
  tx(() => {
    for (const id of ids) {
      const node = getNode(id);
      if (!node || node.owner_id !== user.id || !node.trashed_at || !node.trash_root) throw notFound('Das liegt nicht im Papierkorb');
      const parent = node.parent_id ? getNode(node.parent_id) : null;
      const parentId = parent && !parent.trashed_at ? parent.id : user.root_id;
      const name = uniqueName(node.name, node.type === 'folder', taken(parentId));
      run('UPDATE nodes SET parent_id = ?, name = ?, name_key = ?, trash_root = 0 WHERE id = ?', parentId, name, nameKey(name), id);
      run(`${TREE('WHERE n.trashed_at = ?')} UPDATE nodes SET trashed_at = NULL WHERE id IN (SELECT id FROM tree)`, id, node.trashed_at);
      folders.add(parentId);
      restored.push(getNode(id)!);
      record({ owner: node.owner_id, actor: user.id, node: id, parent: parentId, action: 'restore', name });
    }
  });
  changed(folders);
  return restored;
}

function destroyTree(id: string) {
  run(`${TREE('')} DELETE FROM nodes WHERE id IN (SELECT id FROM tree)`, id);
}

export function destroy(user: UserRow, ids: string[]) {
  tx(() => {
    for (const id of ids) {
      const node = getNode(id);
      if (!node || node.owner_id !== user.id || !node.trashed_at) throw notFound('Das liegt nicht im Papierkorb');
      destroyTree(id);
      record({ owner: user.id, actor: user.id, node: id, parent: node.parent_id, action: 'delete', name: node.name });
    }
  });
  publish([user.id], 'change', { folders: [], trash: true });
}

export const FOLDER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'] as const;

export function setColor(user: UserRow, ids: string[], color: string | null) {
  const folders = new Set<string | null>();
  tx(() => {
    for (const id of ids) {
      const access = requireAccess(user, id, 'edit');
      if (access.node.type !== 'folder' || !access.node.parent_id) throw badRequest('Farben gibt es nur für Ordner');
      run('UPDATE nodes SET color = ? WHERE id = ?', color, id);
      folders.add(access.node.parent_id);
    }
  });
  changed(folders);
}

export function emptyTrash(user: UserRow) {
  const roots = all<{ id: string }>('SELECT id FROM nodes WHERE owner_id = ? AND trash_root = 1 AND trashed_at IS NOT NULL', user.id);
  tx(() => roots.forEach((root) => destroyTree(root.id)));
  publish([user.id], 'change', { folders: [], trash: true });
  return roots.length;
}

export function purgeTrash(days: number) {
  if (days <= 0) return 0;
  const roots = all<{ id: string; owner_id: number }>(
    'SELECT id, owner_id FROM nodes WHERE trash_root = 1 AND trashed_at IS NOT NULL AND trashed_at < ?',
    Date.now() - days * 86_400_000
  );
  tx(() => roots.forEach((root) => destroyTree(root.id)));
  if (roots.length) publish(new Set(roots.map((root) => root.owner_id)), 'change', { folders: [], trash: true });
  return roots.length;
}

export function setStar(user: UserRow, id: string, starred: boolean) {
  requireAccess(user, id, 'view');
  if (starred) run('INSERT OR IGNORE INTO stars (user_id, node_id, created_at) VALUES (?, ?, ?)', user.id, id, Date.now());
  else run('DELETE FROM stars WHERE user_id = ? AND node_id = ?', user.id, id);
}

export const recent = (user: UserRow) =>
  all<NodeRow>(
    "SELECT * FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL ORDER BY updated_at DESC LIMIT 60",
    user.id
  );

export function starred(user: UserRow) {
  return all<NodeRow>(
    'SELECT n.* FROM stars s JOIN nodes n ON n.id = s.node_id WHERE s.user_id = ? AND n.trashed_at IS NULL ORDER BY s.created_at DESC',
    user.id
  ).filter((node) => node.owner_id === user.id || resolveAccess(user, node.id));
}

export const trashed = (user: UserRow) =>
  all<NodeRow>('SELECT * FROM nodes WHERE owner_id = ? AND trash_root = 1 AND trashed_at IS NOT NULL ORDER BY trashed_at DESC', user.id);

const DOCUMENT_MIMES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/markdown',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
];

const KIND_FILTERS: Record<string, string> = {
  folder: "n.type = 'folder'",
  image: "n.mime LIKE 'image/%'",
  video: "n.mime LIKE 'video/%'",
  audio: "n.mime LIKE 'audio/%'",
  pdf: "n.mime = 'application/pdf'",
  document: `n.mime IN (${DOCUMENT_MIMES.map((mime) => `'${mime}'`).join(', ')})`,
};

export type Found = NodeRow & { parent_name: string | null; snippet?: string | null };

function contentQuery(text: string) {
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/["*^():]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((word, index) => `"${word}"${index === words.length - 1 && word.length >= 2 ? '*' : ''}`).join(' ');
}

export interface SearchFilters {
  kind?: string;
  after?: number;
  before?: number;
  minSize?: number;
  maxSize?: number;
  tag?: string;
}

function searchFilter(user: UserRow, filters: SearchFilters) {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (filters.kind && KIND_FILTERS[filters.kind]) parts.push(KIND_FILTERS[filters.kind]);
  if (filters.after !== undefined) {
    parts.push('n.modified_at >= ?');
    params.push(filters.after);
  }
  if (filters.before !== undefined) {
    parts.push('n.modified_at < ?');
    params.push(filters.before);
  }
  if (filters.minSize !== undefined) {
    parts.push("n.type = 'file' AND n.size >= ?");
    params.push(filters.minSize);
  }
  if (filters.maxSize !== undefined) {
    parts.push("n.type = 'file' AND n.size < ?");
    params.push(filters.maxSize);
  }
  if (filters.tag) {
    parts.push('n.id IN (SELECT nt.node_id FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.tag_id = ? AND t.owner_id = ?)');
    params.push(filters.tag, user.id);
  }
  return { sql: parts.map((part) => `AND ${part}`).join(' '), params, active: parts.length > 0 };
}

export function search(user: UserRow, query: string, filters: SearchFilters = {}, content = true): Found[] {
  const text = query.trim().slice(0, 200);
  const filter = searchFilter(user, filters);
  if (!text) {
    if (!filter.active) return [];
    return all<Found>(
      `SELECT n.*, p.name AS parent_name FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
       WHERE n.owner_id = ? AND n.trashed_at IS NULL AND n.parent_id IS NOT NULL ${filter.sql}
       ORDER BY n.modified_at DESC LIMIT 200`,
      user.id,
      ...filter.params
    );
  }
  let byName: Found[];
  if ([...text].length >= 3) {
    byName = all<Found>(
      `SELECT n.*, p.name AS parent_name FROM nodes_fts f
       JOIN nodes n ON n.seq = f.rowid
       LEFT JOIN nodes p ON p.id = n.parent_id
       WHERE nodes_fts MATCH ? AND n.owner_id = ? AND n.trashed_at IS NULL AND n.parent_id IS NOT NULL ${filter.sql}
       ORDER BY rank LIMIT 100`,
      `"${text.replace(/"/g, '""')}"`,
      user.id,
      ...filter.params
    );
  } else {
    const like = `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    byName = all<Found>(
      `SELECT n.*, p.name AS parent_name FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
       WHERE n.owner_id = ? AND n.trashed_at IS NULL AND n.parent_id IS NOT NULL AND n.name LIKE ? ESCAPE '\\' ${filter.sql}
       ORDER BY n.updated_at DESC LIMIT 100`,
      user.id,
      like,
      ...filter.params
    );
  }
  const match = content && filters.kind !== 'folder' ? contentQuery(text) : null;
  if (!match) return byName;
  let inside: Found[] = [];
  try {
    inside = all<Found>(
      `SELECT n.*, p.name AS parent_name, snippet(blob_text_fts, 0, char(1), char(2), '…', 14) AS snippet
       FROM blob_text_fts f
       JOIN blob_text b ON b.id = f.rowid
       JOIN nodes n ON n.sha256 = b.sha256
       LEFT JOIN nodes p ON p.id = n.parent_id
       WHERE blob_text_fts MATCH ? AND n.owner_id = ? AND n.trashed_at IS NULL AND n.parent_id IS NOT NULL ${filter.sql}
       ORDER BY rank LIMIT 60`,
      match,
      user.id,
      ...filter.params
    );
  } catch {
    inside = [];
  }
  const seen = new Map(byName.map((node) => [node.id, node]));
  for (const node of inside) {
    const existing = seen.get(node.id);
    if (existing) existing.snippet = node.snippet;
    else {
      seen.set(node.id, node);
      byName.push(node);
    }
  }
  return byName;
}

function inChunks<T>(values: string[], fn: (chunk: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let index = 0; index < values.length; index += 500) out.push(...fn(values.slice(index, index + 500)));
  return out;
}

export interface Presented {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  kind: string;
  mime: string | null;
  size: number;
  items: number | null;
  createdAt: number;
  updatedAt: number;
  modifiedAt: number;
  trashedAt: number | null;
  version: string;
  thumb: boolean;
  rendition: boolean;
  starred: boolean;
  tags: string[];
  shared: boolean;
  role: Role;
  owner: { id: number; name: string } | null;
  color: string | null;
  infected: boolean;
  takenAt: number | null;
  width: number | null;
  height: number | null;
  location?: string | null;
  snippet?: string | null;
  progress: number | null;
  watching: boolean;
}

type BlobInfo = Pick<BlobRow, 'sha256' | 'thumb' | 'meta' | 'scan_status' | 'taken_at' | 'width' | 'height'>;

export function blobInfo(shas: string[]) {
  return new Map(
    inChunks([...new Set(shas)], (chunk) =>
      all<BlobInfo>(
        `SELECT sha256, thumb, meta, scan_status, taken_at, width, height FROM blobs WHERE sha256 IN (${placeholders(chunk.length)})`,
        ...chunk
      )
    ).map((row) => [row.sha256, row])
  );
}

export function present(nodes: NodeRow[], viewer: UserRow, role: Role | ((node: NodeRow) => Role) = 'owner'): Presented[] {
  if (nodes.length === 0) return [];
  const ids = nodes.map((node) => node.id);
  const stars = new Set(
    inChunks(ids, (chunk) =>
      all<{ node_id: string }>(
        `SELECT node_id FROM stars WHERE user_id = ? AND node_id IN (${placeholders(chunk.length)})`,
        viewer.id,
        ...chunk
      )
    ).map((row) => row.node_id)
  );
  const tagged = new Map<string, string[]>();
  for (const row of inChunks(ids, (chunk) =>
    all<{ node_id: string; tag_id: string }>(
      `SELECT nt.node_id, nt.tag_id FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
       WHERE t.owner_id = ? AND nt.node_id IN (${placeholders(chunk.length)}) ORDER BY t.name_key`,
      viewer.id,
      ...chunk
    )
  )) {
    tagged.set(row.node_id, [...(tagged.get(row.node_id) ?? []), row.tag_id]);
  }
  const files = new Map(nodes.filter((node) => node.sha256).map((node) => [node.id, node.sha256]));
  const progress = new Map(
    inChunks([...files.keys()], (chunk) =>
      all<{ node_id: string; sha256: string; seconds: number; duration: number }>(
        `SELECT node_id, sha256, seconds, duration FROM positions WHERE user_id = ? AND node_id IN (${placeholders(chunk.length)})`,
        viewer.id,
        ...chunk
      )
    )
      .filter((row) => files.get(row.node_id) === row.sha256 && row.duration > 0)
      .map((row) => [row.node_id, Math.min(1, Math.round((row.seconds / row.duration) * 1000) / 1000)])
  );
  const shared = new Set(
    inChunks(ids, (chunk) =>
      all<{ node_id: string }>(
        `SELECT node_id FROM links WHERE node_id IN (${placeholders(chunk.length)})
         UNION SELECT node_id FROM grants WHERE node_id IN (${placeholders(chunk.length)})
         UNION SELECT node_id FROM group_grants WHERE node_id IN (${placeholders(chunk.length)})`,
        ...chunk,
        ...chunk,
        ...chunk
      )
    ).map((row) => row.node_id)
  );
  const folderIds = nodes.filter((node) => node.type === 'folder').map((node) => node.id);
  const counts = new Map(
    inChunks(folderIds, (chunk) =>
      all<{ parent_id: string; count: number }>(
        `SELECT parent_id, COUNT(*) AS count FROM nodes WHERE parent_id IN (${placeholders(chunk.length)}) AND trashed_at IS NULL GROUP BY parent_id`,
        ...chunk
      )
    ).map((row) => [row.parent_id, row.count])
  );
  const watching = new Set(
    inChunks(folderIds, (chunk) =>
      all<{ node_id: string }>(
        `SELECT node_id FROM watches WHERE user_id = ? AND node_id IN (${placeholders(chunk.length)})`,
        viewer.id,
        ...chunk
      )
    ).map((row) => row.node_id)
  );
  const blobs = blobInfo(nodes.filter((node) => node.sha256).map((node) => node.sha256!));
  const owners = new Map<number, string>();
  for (const node of nodes) {
    if (node.owner_id !== viewer.id && !owners.has(node.owner_id)) owners.set(node.owner_id, getUser(node.owner_id)?.name ?? '');
  }
  return nodes.map((node) => {
    const blob = node.sha256 ? blobs.get(node.sha256) : undefined;
    const mime = node.type === 'file' ? typeOf(node, blob) : null;
    return {
      id: node.id,
      parentId: node.parent_id,
      type: node.type,
      name: node.name,
      kind: kindOf(node.name, mime, node.type),
      mime,
      size: node.size,
      items: node.type === 'folder' ? (counts.get(node.id) ?? 0) : null,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      modifiedAt: node.modified_at,
      trashedAt: node.trashed_at,
      version: `${node.etag}${node.sha256 ? `-${node.sha256.slice(0, 12)}` : ''}`,
      ...previews(node, blob),
      starred: stars.has(node.id),
      tags: tagged.get(node.id) ?? [],
      shared: shared.has(node.id),
      role: typeof role === 'function' ? role(node) : role,
      owner: node.owner_id === viewer.id ? null : { id: node.owner_id, name: owners.get(node.owner_id) ?? '' },
      color: node.type === 'folder' ? node.color : null,
      infected: blob?.scan_status === 'infected',
      takenAt: blob?.taken_at ?? null,
      width: blob?.width ?? null,
      height: blob?.height ?? null,
      location: 'parent_name' in node ? ((node as { parent_name: string | null }).parent_name ?? null) : undefined,
      snippet: 'snippet' in node ? ((node as { snippet?: string | null }).snippet ?? null) : undefined,
      progress: progress.get(node.id) ?? null,
      watching: watching.has(node.id),
    };
  });
}
