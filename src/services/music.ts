import { open } from 'node:fs/promises';
import { all, IN_LIST, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { kindOf } from '../lib/mime.ts';
import { splitName } from '../lib/names.ts';
import { blobPath, metaOf, typeOf } from './blobs.ts';
import { chain, findChild, getNode, present, requireAccess, resolveAccess, subtree, type NodeRow, type Presented } from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import type { UserRow } from './users.ts';

export const MAX_TRACKS = 10_000;
export const MAX_PLAYLISTS = 200;
export const MAX_PLAYLIST_ITEMS = 5000;
const MAX_M3U_BYTES = 1024 * 1024;

export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  number: number | null;
  duration: number | null;
}

export interface TrackView extends Presented {
  track: TrackInfo;
  plays: number;
  playedAt: number | null;
}

export interface PlaylistRow {
  id: string;
  owner_id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

const text = (input: unknown) => (typeof input === 'string' ? input : '');
const number = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : null);

function trackInfo(node: NodeRow, meta: Record<string, unknown>): TrackInfo {
  const base = splitName(node.name)[0];
  const lead = /^(\d{1,3})(?=[\s._-])/.exec(base);
  return {
    title: text(meta.title) || base.replace(/^\d{1,3}[\s._-]+/, '') || base,
    artist: text(meta.artist),
    album: text(meta.album),
    year: number(meta.year),
    number: number(meta.track) ?? (lead ? Number(lead[1]) : null),
    duration: number(meta.duration),
  };
}

function metas(nodes: NodeRow[]) {
  const shas = [...new Set(nodes.map((node) => node.sha256).filter((sha): sha is string => Boolean(sha)))];
  const found = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < shas.length; index += 2000) {
    const rows = all<{ sha256: string; meta: string | null }>(
      `SELECT sha256, meta FROM blobs WHERE sha256 ${IN_LIST}`,
      JSON.stringify(shas.slice(index, index + 2000))
    );
    for (const row of rows) found.set(row.sha256, metaOf(row));
  }
  return found;
}

const isAudio = (node: NodeRow) => {
  if (node.type !== 'file') return false;
  const type = typeOf(node, null);
  return kindOf(node.name, type) === 'audio' && !type.endsWith('mpegurl');
};

function playsOf(user: UserRow) {
  const rows = all<{ node_id: string; count: number; played_at: number }>(
    'SELECT node_id, count, played_at FROM plays WHERE user_id = ?',
    user.id
  );
  return new Map(rows.map((row) => [row.node_id, row]));
}

function showTracks(user: UserRow, nodes: NodeRow[], own = false): TrackView[] {
  const meta = metas(nodes);
  const played = playsOf(user);
  const role = own ? () => 'owner' as const : (node: NodeRow) => resolveAccess(user, node.id)?.role ?? 'view';
  return present(nodes, user, role).map((item, index) => ({
    ...item,
    track: trackInfo(nodes[index], meta.get(nodes[index].sha256 ?? '') ?? {}),
    plays: Number(played.get(nodes[index].id)?.count ?? 0),
    playedAt: played.get(nodes[index].id) ? Number(played.get(nodes[index].id)!.played_at) : null,
  }));
}

export function recordPlay(user: UserRow, id: string, now = Date.now()) {
  const { node } = requireAccess(user, id);
  if (!isAudio(node) || node.trashed_at) throw badRequest('Das ist kein Musikstück');
  run(
    `INSERT INTO plays (user_id, node_id, count, played_at) VALUES (?, ?, 1, ?)
     ON CONFLICT (user_id, node_id) DO UPDATE SET count = plays.count + 1, played_at = excluded.played_at`,
    user.id,
    node.id,
    now
  );
  publish([user.id], 'plays', { id: node.id });
}

export function clearPlays(user: UserRow) {
  run('DELETE FROM plays WHERE user_id = ?', user.id);
}

export function listTracks(user: UserRow) {
  const rows = all<NodeRow>(
    `SELECT n.* FROM nodes n
     WHERE n.owner_id = ? AND n.type = 'file' AND n.trashed_at IS NULL AND n.size > 0 AND n.mime LIKE 'audio/%'
       AND n.mime NOT LIKE '%mpegurl'
       AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.sha256 = n.sha256 AND b.scan_status = 'infected')
     ORDER BY n.seq DESC LIMIT ?`,
    user.id,
    MAX_TRACKS + 1
  );
  return { items: showTracks(user, rows.slice(0, MAX_TRACKS), true), more: rows.length > MAX_TRACKS };
}

function cleanName(raw: string) {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name) throw badRequest('Gib einen Namen ein');
  if ([...name].length > 100) throw badRequest('Der Name darf höchstens 100 Zeichen haben');
  return name;
}

export function ownPlaylist(user: UserRow, id: string) {
  const playlist = one<PlaylistRow>('SELECT * FROM playlists WHERE id = ? AND owner_id = ?', id, user.id);
  if (!playlist) throw notFound('Die Wiedergabeliste gibt es nicht mehr');
  return playlist;
}

function members(user: UserRow, playlist: PlaylistRow) {
  const seen = new Map<string, boolean>();
  return all<NodeRow>(
    `SELECT n.* FROM playlist_items p JOIN nodes n ON n.id = p.node_id
     WHERE p.playlist_id = ? AND n.trashed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.sha256 = n.sha256 AND b.scan_status = 'infected')
     ORDER BY p.position, p.added_at, n.seq`,
    playlist.id
  ).filter((node) => {
    if (node.owner_id === user.id) return true;
    if (!seen.has(node.id)) seen.set(node.id, Boolean(resolveAccess(user, node.id)));
    return seen.get(node.id)!;
  });
}

export function showPlaylist(user: UserRow, playlist: PlaylistRow, nodes = members(user, playlist)) {
  const first = nodes.slice(0, 24);
  const known = metas(first);
  const cover = first.find((node) => known.get(node.sha256 ?? '')?.cover) ?? null;
  return {
    id: playlist.id,
    name: playlist.name,
    count: nodes.length,
    cover: cover ? present([cover], user, (node) => resolveAccess(user, node.id)?.role ?? 'view')[0] : null,
    createdAt: playlist.created_at,
    updatedAt: playlist.updated_at,
  };
}

export const listPlaylists = (user: UserRow) =>
  all<PlaylistRow>('SELECT * FROM playlists WHERE owner_id = ? ORDER BY name COLLATE NOCASE, created_at', user.id).map((playlist) =>
    showPlaylist(user, playlist)
  );

export function playlistContent(user: UserRow, id: string) {
  const playlist = ownPlaylist(user, id);
  const nodes = members(user, playlist);
  return { playlist: showPlaylist(user, playlist, nodes), items: showTracks(user, nodes), nodes };
}

function audioOf(user: UserRow, ids: string[]) {
  const found: NodeRow[] = [];
  for (const id of new Set(ids)) {
    const { node } = requireAccess(user, id);
    if (node.type === 'folder') {
      const inside = subtree(node.id).filter(isAudio);
      const paths = new Map<string, string>([[node.id, '']]);
      for (const entry of subtree(node.id)) {
        if (entry.type === 'folder' && entry.parent_id && paths.has(entry.parent_id)) {
          paths.set(entry.id, `${paths.get(entry.parent_id)}/${entry.name_key}`);
        }
      }
      inside.sort((a, b) =>
        `${paths.get(a.parent_id ?? '') ?? ''}/${a.name_key}`.localeCompare(
          `${paths.get(b.parent_id ?? '') ?? ''}/${b.name_key}`,
          undefined,
          {
            numeric: true,
          }
        )
      );
      found.push(...inside);
    } else if (isAudio(node)) {
      found.push(node);
    } else {
      throw badRequest('In Wiedergabelisten kommt nur Musik');
    }
  }
  return found;
}

const touch = (playlist: PlaylistRow) => run('UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), playlist.id);

function append(playlist: PlaylistRow, nodes: NodeRow[]) {
  const count = value<number>('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?', playlist.id) ?? 0;
  let position = (value<number>('SELECT COALESCE(MAX(position), 0) FROM playlist_items WHERE playlist_id = ?', playlist.id) ?? 0) + 1;
  const now = Date.now();
  let added = 0;
  tx(() => {
    for (const node of nodes) {
      if (count + added >= MAX_PLAYLIST_ITEMS) {
        throw badRequest('Eine Wiedergabeliste fasst höchstens {count} Titel', { count: MAX_PLAYLIST_ITEMS });
      }
      const changes = run(
        'INSERT OR IGNORE INTO playlist_items (playlist_id, node_id, position, added_at) VALUES (?, ?, ?, ?)',
        playlist.id,
        node.id,
        position,
        now
      ).changes;
      if (Number(changes) > 0) {
        added += 1;
        position += 1;
      }
    }
    touch(playlist);
  });
  return added;
}

export function addToPlaylist(user: UserRow, id: string, ids: string[]) {
  const playlist = ownPlaylist(user, id);
  const added = append(playlist, audioOf(user, ids));
  publish([user.id], 'playlists', { id: playlist.id });
  return added;
}

export function createPlaylist(user: UserRow, rawName: string, ids: string[] = []) {
  const name = cleanName(rawName);
  if ((value<number>('SELECT COUNT(*) FROM playlists WHERE owner_id = ?', user.id) ?? 0) >= MAX_PLAYLISTS) {
    throw badRequest('Du kannst höchstens {count} Wiedergabelisten anlegen', { count: MAX_PLAYLISTS });
  }
  const nodes = ids.length ? audioOf(user, ids) : [];
  const now = Date.now();
  const id = randomId();
  run('INSERT INTO playlists (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, user.id, name, now, now);
  const playlist = ownPlaylist(user, id);
  if (nodes.length) append(playlist, nodes);
  publish([user.id], 'playlists', { id });
  return ownPlaylist(user, id);
}

export function removeFromPlaylist(user: UserRow, id: string, ids: string[]) {
  const playlist = ownPlaylist(user, id);
  let removed = 0;
  tx(() => {
    for (const nodeId of new Set(ids)) {
      removed += Number(run('DELETE FROM playlist_items WHERE playlist_id = ? AND node_id = ?', playlist.id, nodeId).changes);
    }
    touch(playlist);
  });
  publish([user.id], 'playlists', { id: playlist.id });
  return removed;
}

export function updatePlaylist(user: UserRow, id: string, patch: { name?: string; order?: string[] }) {
  const playlist = ownPlaylist(user, id);
  const name = patch.name === undefined ? playlist.name : cleanName(patch.name);
  tx(() => {
    if (patch.order) {
      const current = all<{ node_id: string }>(
        'SELECT node_id FROM playlist_items WHERE playlist_id = ? ORDER BY position, added_at',
        playlist.id
      ).map((row) => row.node_id);
      const known = new Set(current);
      const wanted = [...new Set(patch.order)].filter((nodeId) => known.has(nodeId));
      const placed = new Set(wanted);
      const next = [...wanted, ...current.filter((nodeId) => !placed.has(nodeId))];
      next.forEach((nodeId, index) =>
        run('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND node_id = ?', index + 1, playlist.id, nodeId)
      );
    }
    run('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', name, Date.now(), playlist.id);
  });
  publish([user.id], 'playlists', { id: playlist.id });
  return ownPlaylist(user, playlist.id);
}

export function deletePlaylist(user: UserRow, id: string) {
  const playlist = ownPlaylist(user, id);
  run('DELETE FROM playlists WHERE id = ?', playlist.id);
  publish([user.id], 'playlists', { id: playlist.id });
}

function pathOf(user: UserRow, node: NodeRow) {
  const stop = node.owner_id === user.id ? user.root_id : (resolveAccess(user, node.id)?.rootId ?? node.id);
  const parts: string[] = [];
  for (const entry of chain(node.id).reverse()) {
    if (entry.id === user.root_id && node.owner_id === user.id) break;
    parts.unshift(entry.name);
    if (entry.id === stop) break;
  }
  return parts.join('/');
}

export function exportM3u(user: UserRow, id: string) {
  const { playlist, items, nodes } = playlistContent(user, id);
  const lines = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];
  for (const [index, item] of items.entries()) {
    const label = [item.track.artist, item.track.title]
      .filter(Boolean)
      .join(' - ')
      .replace(/[\r\n]+/g, ' ');
    lines.push(`#EXTINF:${item.track.duration === null ? -1 : Math.round(item.track.duration)},${label}`);
    lines.push(pathOf(user, nodes[index]));
  }
  return { name: playlist.name, text: `${lines.join('\n')}\n` };
}

function walk(user: UserRow, start: NodeRow, path: string): NodeRow | null {
  let current: NodeRow | undefined = path.startsWith('/') ? getNode(user.root_id) : start;
  for (const part of path.split('/')) {
    if (!current) return null;
    if (!part || part === '.') continue;
    if (part === '..') {
      current = current.parent_id ? getNode(current.parent_id) : undefined;
      continue;
    }
    current = findChild(current.id, part);
  }
  if (!current || !isAudio(current) || !resolveAccess(user, current.id)) return null;
  return current;
}

export async function importM3u(user: UserRow, nodeId: string) {
  const { node } = requireAccess(user, nodeId);
  const [base, extension] = splitName(node.name);
  if (node.type !== 'file' || !['.m3u', '.m3u8'].includes(extension.toLowerCase())) {
    throw badRequest('Das ist keine Wiedergabeliste. MoeCloud liest Dateien mit der Endung .m3u oder .m3u8');
  }
  if (node.size > MAX_M3U_BYTES) throw badRequest('Diese Wiedergabeliste ist zu groß');
  assertNotInfected(node.sha256);
  let raw = Buffer.alloc(0);
  if (node.sha256 && node.size > 0) {
    const handle = await open(blobPath(node.sha256), 'r');
    try {
      raw = await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  const decoded = raw.toString('utf8');
  const content = decoded.includes('�') ? raw.toString('latin1') : decoded.replace(/^﻿/, '');
  const folder = node.parent_id ? getNode(node.parent_id) : undefined;
  if (!folder) throw notFound('Den Ordner dieser Datei gibt es nicht mehr');
  const found: NodeRow[] = [];
  const seen = new Set<string>();
  let missing = 0;
  let title = '';
  for (const line of content.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry) continue;
    if (entry.startsWith('#')) {
      if (entry.toUpperCase().startsWith('#PLAYLIST:')) title = entry.slice(10).trim();
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
      missing += 1;
      continue;
    }
    const path = entry.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '/');
    const target = walk(user, folder, path) ?? (path.startsWith('/') ? null : walk(user, folder, `/${path}`));
    if (!target) missing += 1;
    else if (!seen.has(target.id)) {
      seen.add(target.id);
      found.push(target);
    }
  }
  if (found.length === 0) throw badRequest('Keiner der Titel aus dieser Datei liegt in deiner Cloud');
  const playlist = createPlaylist(user, title || base);
  append(playlist, found.slice(0, MAX_PLAYLIST_ITEMS));
  publish([user.id], 'playlists', { id: playlist.id });
  return { playlist: showPlaylist(user, ownPlaylist(user, playlist.id)), added: Math.min(found.length, MAX_PLAYLIST_ITEMS), missing };
}
