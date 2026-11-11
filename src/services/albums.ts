import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { kindOf } from '../lib/mime.ts';
import { getBlob, typeOf } from './blobs.ts';
import { present, requireAccess, resolveAccess, type NodeRow, type Presented } from './nodes.ts';
import type { UserRow } from './users.ts';

export const MAX_ALBUMS = 500;
export const MAX_ALBUM_ITEMS = 10_000;

export interface AlbumRow {
  id: string;
  owner_id: number;
  name: string;
  cover_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface AlbumView {
  id: string;
  name: string;
  count: number;
  coverId: string | null;
  cover: Presented | null;
  from: number | null;
  to: number | null;
  createdAt: number;
  updatedAt: number;
}

type Member = NodeRow & { sort_at: number };

function cleanName(raw: string) {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name) throw badRequest('Gib einen Namen ein');
  if ([...name].length > 100) throw badRequest('Der Name darf höchstens 100 Zeichen haben');
  return name;
}

export function ownAlbum(user: UserRow, id: string) {
  const album = one<AlbumRow>('SELECT * FROM albums WHERE id = ? AND owner_id = ?', id, user.id);
  if (!album) throw notFound('Das Album gibt es nicht mehr');
  return album;
}

const roleFor = (user: UserRow) => (node: NodeRow) => resolveAccess(user, node.id)?.role ?? 'view';

export function members(user: UserRow, album: AlbumRow): Member[] {
  const seen = new Map<string, boolean>();
  return all<Member>(
    `SELECT n.*, COALESCE(b.taken_at, n.modified_at) AS sort_at FROM album_items a
     JOIN nodes n ON n.id = a.node_id
     LEFT JOIN blobs b ON b.sha256 = n.sha256
     WHERE a.album_id = ? AND n.trashed_at IS NULL AND (b.scan_status IS NULL OR b.scan_status != 'infected')
     ORDER BY sort_at, n.seq`,
    album.id
  ).filter((node) => {
    if (node.owner_id === user.id) return true;
    if (!seen.has(node.id)) seen.set(node.id, Boolean(resolveAccess(user, node.id)));
    return seen.get(node.id)!;
  });
}

export function showAlbum(user: UserRow, album: AlbumRow, nodes = members(user, album)): AlbumView {
  const cover =
    nodes.find((node) => node.id === album.cover_id) ??
    nodes.findLast((node) => node.mime?.startsWith('image/')) ??
    nodes[nodes.length - 1] ??
    null;
  return {
    id: album.id,
    name: album.name,
    count: nodes.length,
    coverId: album.cover_id,
    cover: cover ? present([cover], user, roleFor(user))[0] : null,
    from: nodes[0]?.sort_at ?? null,
    to: nodes[nodes.length - 1]?.sort_at ?? null,
    createdAt: album.created_at,
    updatedAt: album.updated_at,
  };
}

export const listAlbums = (user: UserRow) =>
  all<AlbumRow>('SELECT * FROM albums WHERE owner_id = ? ORDER BY updated_at DESC', user.id).map((album) => showAlbum(user, album));

export function albumContent(user: UserRow, id: string) {
  const album = ownAlbum(user, id);
  const nodes = members(user, album);
  return { album: showAlbum(user, album, nodes), items: present(nodes, user, roleFor(user)), nodes };
}

const touch = (album: AlbumRow) => run('UPDATE albums SET updated_at = ? WHERE id = ?', Date.now(), album.id);

function mediaOnly(user: UserRow, ids: string[]) {
  return [...new Set(ids)].map((nodeId) => {
    const { node } = requireAccess(user, nodeId);
    const kind = node.type === 'file' ? kindOf(node.name, typeOf(node, node.sha256 ? getBlob(node.sha256) : null)) : 'folder';
    if (kind !== 'image' && kind !== 'video') throw badRequest('In Alben kommen nur Bilder und Videos');
    return node;
  });
}

export function addToAlbum(user: UserRow, id: string, ids: string[]) {
  const album = ownAlbum(user, id);
  const nodes = mediaOnly(user, ids);
  const count = value<number>('SELECT COUNT(*) FROM album_items WHERE album_id = ?', album.id) ?? 0;
  if (count + nodes.length > MAX_ALBUM_ITEMS) throw badRequest('Ein Album fasst höchstens {count} Elemente', { count: MAX_ALBUM_ITEMS });
  const now = Date.now();
  let added = 0;
  tx(() => {
    for (const node of nodes) {
      added += Number(
        run('INSERT OR IGNORE INTO album_items (album_id, node_id, added_at) VALUES (?, ?, ?)', album.id, node.id, now).changes
      );
    }
    touch(album);
  });
  publish([user.id], 'albums', { id: album.id });
  return added;
}

export function createAlbum(user: UserRow, rawName: string, ids: string[] = []) {
  const name = cleanName(rawName);
  if ((value<number>('SELECT COUNT(*) FROM albums WHERE owner_id = ?', user.id) ?? 0) >= MAX_ALBUMS) {
    throw badRequest('Du kannst höchstens {count} Alben anlegen', { count: MAX_ALBUMS });
  }
  if (ids.length) mediaOnly(user, ids);
  const now = Date.now();
  const album: AlbumRow = { id: randomId(), owner_id: user.id, name, cover_id: null, created_at: now, updated_at: now };
  run(
    'INSERT INTO albums (id, owner_id, name, cover_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
    album.id,
    album.owner_id,
    album.name,
    now,
    now
  );
  if (ids.length) addToAlbum(user, album.id, ids);
  publish([user.id], 'albums', { id: album.id });
  return ownAlbum(user, album.id);
}

export function removeFromAlbum(user: UserRow, id: string, ids: string[]) {
  const album = ownAlbum(user, id);
  let removed = 0;
  tx(() => {
    for (const nodeId of new Set(ids)) {
      removed += Number(run('DELETE FROM album_items WHERE album_id = ? AND node_id = ?', album.id, nodeId).changes);
    }
    if (album.cover_id && ids.includes(album.cover_id)) run('UPDATE albums SET cover_id = NULL WHERE id = ?', album.id);
    touch(album);
  });
  publish([user.id], 'albums', { id: album.id });
  return removed;
}

export function updateAlbum(user: UserRow, id: string, patch: { name?: string; coverId?: string | null }) {
  const album = ownAlbum(user, id);
  const name = patch.name === undefined ? album.name : cleanName(patch.name);
  let cover = album.cover_id;
  if (patch.coverId !== undefined) {
    if (patch.coverId && !one('SELECT 1 FROM album_items WHERE album_id = ? AND node_id = ?', album.id, patch.coverId)) {
      throw badRequest('Das Titelbild muss im Album liegen');
    }
    cover = patch.coverId;
  }
  run('UPDATE albums SET name = ?, cover_id = ?, updated_at = ? WHERE id = ?', name, cover, Date.now(), album.id);
  publish([user.id], 'albums', { id: album.id });
  return ownAlbum(user, album.id);
}

export function deleteAlbum(user: UserRow, id: string) {
  const album = ownAlbum(user, id);
  run('DELETE FROM albums WHERE id = ?', album.id);
  publish([user.id], 'albums', { id: album.id });
}
