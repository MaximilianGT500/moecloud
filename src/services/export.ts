import type { Readable } from 'node:stream';
import { all } from '../lib/db.ts';
import { type NodeRow } from './nodes.ts';
import { listSearches } from './searches.ts';
import * as settings from './settings.ts';
import { prefsOf, quotaOf, type UserRow } from './users.ts';
import { zipStream } from './zip.ts';

const FOLDER = 'Dateien';

const iso = (time: number | null | undefined) => (time ? new Date(time).toISOString() : null);

function pathsOf(user: UserRow) {
  const rows = all<{ id: string; parent_id: string | null; name: string }>(
    'SELECT id, parent_id, name FROM nodes WHERE owner_id = ? AND trashed_at IS NULL',
    user.id
  );
  const nodes = new Map(rows.map((row) => [row.id, row]));
  const known = new Map<string, string | null>([[user.root_id, FOLDER]]);
  return (id: string): string | null => {
    const chain: string[] = [];
    let current: string | null = id;
    while (current && !known.has(current)) {
      const row = nodes.get(current);
      if (!row) {
        current = null;
        break;
      }
      chain.push(current);
      current = row.parent_id;
    }
    let path = current ? (known.get(current) ?? null) : null;
    for (const step of chain.reverse()) {
      path = path === null ? null : `${path}/${nodes.get(step)!.name}`;
      known.set(step, path);
    }
    return known.get(id) ?? null;
  };
}

export function accountData(user: UserRow) {
  const path = pathsOf(user);
  const named = <T extends { node_id: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, path: path(row.node_id) })).filter((row) => row.path);
  const prefs: Record<string, unknown> = { ...prefsOf(user) };
  delete prefs.storageWarned;
  const tags = all<{ id: string; name: string; color: string | null }>(
    'SELECT id, name, color FROM tags WHERE owner_id = ? ORDER BY name_key',
    user.id
  );
  const tagged = all<{ tag_id: string; node_id: string }>(
    'SELECT nt.tag_id, nt.node_id FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.owner_id = ?',
    user.id
  );
  const albums = all<{ id: string; name: string; created_at: number }>(
    'SELECT id, name, created_at FROM albums WHERE owner_id = ? ORDER BY created_at',
    user.id
  );
  const items = all<{ album_id: string; node_id: string }>(
    'SELECT ai.album_id, ai.node_id FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE a.owner_id = ? ORDER BY ai.added_at',
    user.id
  );
  return {
    format: 'moecloud-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    site: { name: settings.get('site.name'), url: settings.get('site.url') || null },
    profile: {
      username: user.username,
      name: user.name,
      email: user.email,
      language: user.language,
      role: user.role,
      quota: quotaOf(user),
      createdAt: iso(user.created_at),
      lastLoginAt: iso(user.last_login_at),
    },
    settings: prefs,
    starred: named(all<{ node_id: string }>('SELECT node_id FROM stars WHERE user_id = ? ORDER BY created_at', user.id)).map(
      (row) => row.path
    ),
    tags: tags.map((tag) => ({
      name: tag.name,
      color: tag.color,
      files: tagged
        .filter((row) => row.tag_id === tag.id)
        .map((row) => path(row.node_id))
        .filter(Boolean),
    })),
    albums: albums.map((album) => ({
      name: album.name,
      createdAt: iso(album.created_at),
      files: items
        .filter((row) => row.album_id === album.id)
        .map((row) => path(row.node_id))
        .filter(Boolean),
    })),
    links: named(
      all<{
        node_id: string;
        label: string | null;
        password_hash: string | null;
        expires_at: number | null;
        upload_only: number;
        allow_upload: number;
        views: number;
        downloads: number;
        created_at: number;
      }>(
        'SELECT node_id, label, password_hash, expires_at, upload_only, allow_upload, views, downloads, created_at FROM links WHERE owner_id = ? ORDER BY created_at',
        user.id
      )
    ).map((row) => ({
      path: row.path,
      label: row.label,
      password: Boolean(row.password_hash),
      uploadOnly: Boolean(row.upload_only),
      allowUpload: Boolean(row.allow_upload),
      views: row.views,
      downloads: row.downloads,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
    })),
    shares: [
      ...named(
        all<{ node_id: string; target: string; permission: string; expires_at: number | null }>(
          `SELECT g.node_id, u.username AS target, g.permission, g.expires_at FROM grants g JOIN users u ON u.id = g.user_id
           WHERE g.owner_id = ? ORDER BY g.created_at`,
          user.id
        )
      ).map((row) => ({ path: row.path, user: row.target, permission: row.permission, expiresAt: iso(row.expires_at) })),
      ...named(
        all<{ node_id: string; target: string; permission: string; expires_at: number | null }>(
          `SELECT g.node_id, gr.name AS target, g.permission, g.expires_at FROM group_grants g JOIN groups gr ON gr.id = g.group_id
           WHERE g.owner_id = ? ORDER BY g.created_at`,
          user.id
        )
      ).map((row) => ({ path: row.path, group: row.target, permission: row.permission, expiresAt: iso(row.expires_at) })),
    ],
    sharedWithMe: all<{ name: string; owner: string; permission: string }>(
      `SELECT n.name, u.username AS owner, g.permission FROM grants g JOIN nodes n ON n.id = g.node_id JOIN users u ON u.id = g.owner_id
       WHERE g.user_id = ? AND n.trashed_at IS NULL ORDER BY g.created_at`,
      user.id
    ),
    comments: all<{ node_id: string; name: string; text: string; created_at: number }>(
      `SELECT c.node_id, n.name, c.text, c.created_at FROM comments c JOIN nodes n ON n.id = c.node_id
       WHERE c.user_id = ? ORDER BY c.created_at`,
      user.id
    ).map((row) => ({ file: path(row.node_id) ?? row.name, text: row.text, createdAt: iso(row.created_at) })),
    searches: listSearches(user).map((search) => ({ name: search.name, query: search.query })),
    passkeys: all<{ name: string; created_at: number; last_used_at: number | null }>(
      'SELECT name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at',
      user.id
    ).map((row) => ({ name: row.name, createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at) })),
    appPasswords: all<{ name: string; created_at: number; last_used_at: number | null }>(
      'SELECT name, created_at, last_used_at FROM app_passwords WHERE user_id = ? ORDER BY created_at',
      user.id
    ).map((row) => ({ name: row.name, createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at) })),
  };
}

export const exportName = (user: UserRow) => `moecloud-${user.username}-${new Date().toISOString().slice(0, 10)}.zip`;

export function exportStream(user: UserRow): Readable {
  const roots = all<NodeRow>('SELECT * FROM nodes WHERE parent_id = ? AND trashed_at IS NULL ORDER BY name_key', user.root_id);
  const data = Buffer.from(`${JSON.stringify(accountData(user), null, 2)}\n`);
  return zipStream(roots, { prefix: FOLDER, extras: [{ name: 'konto.json', data }] });
}
