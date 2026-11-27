import { formsOfUser } from './forms.ts';
import type { Readable } from 'node:stream';
import { all } from '../lib/db.ts';
import { type NodeRow } from './nodes.ts';
import { listSearches } from './searches.ts';
import * as settings from './settings.ts';
import { prefsOf, quotaOf, type UserRow } from './users.ts';
import { zipStream } from './zip.ts';
import { ownCalendars } from '../calendar/calendars.ts';
import { exportIcs } from '../calendar/transfer.ts';
import { ownBooks } from '../contacts/books.ts';
import { exportVcf, type ContactRow } from '../contacts/store.ts';
import { exportBookmarks } from '../bookmarks/store.ts';
import { exportOpml } from '../feeds/store.ts';
import { snippetFileName, type SnippetRow } from '../snippets/store.ts';

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
  delete prefs.storageAsked;
  delete prefs.expiryWarned;
  const push = prefsOf(user).push;
  prefs.push = push ? { kind: push.kind, url: push.url } : null;
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
  const playlists = all<{ id: string; name: string; created_at: number }>(
    'SELECT id, name, created_at FROM playlists WHERE owner_id = ? ORDER BY created_at',
    user.id
  );
  const tracks = all<{ playlist_id: string; node_id: string }>(
    'SELECT pi.playlist_id, pi.node_id FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id WHERE p.owner_id = ? ORDER BY pi.position, pi.added_at',
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
    playlists: playlists.map((playlist) => ({
      name: playlist.name,
      createdAt: iso(playlist.created_at),
      files: tracks
        .filter((row) => row.playlist_id === playlist.id)
        .map((row) => path(row.node_id))
        .filter(Boolean),
    })),
    plays: all<{ node_id: string; count: number; played_at: number }>(
      'SELECT node_id, count, played_at FROM plays WHERE user_id = ? ORDER BY played_at DESC',
      user.id
    )
      .map((row) => ({ path: path(row.node_id), count: Number(row.count), playedAt: iso(row.played_at) }))
      .filter((row) => row.path),
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
        starts_at: number | null;
        message: string | null;
      }>(
        'SELECT node_id, label, password_hash, expires_at, upload_only, allow_upload, views, downloads, created_at, starts_at, message FROM links WHERE owner_id = ? ORDER BY created_at',
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
      startsAt: iso(row.starts_at),
      message: row.message,
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
    reactions: all<{ node_id: string; name: string; emoji: string; created_at: number }>(
      `SELECT c.node_id, n.name, r.emoji, r.created_at FROM comment_reactions r JOIN comments c ON c.id = r.comment_id
       JOIN nodes n ON n.id = c.node_id WHERE r.user_id = ? ORDER BY r.created_at`,
      user.id
    ).map((row) => ({ file: path(row.node_id) ?? row.name, emoji: row.emoji, createdAt: iso(row.created_at) })),
    searches: listSearches(user).map((search) => ({ name: search.name, query: search.query })),
    passkeys: all<{ name: string; created_at: number; last_used_at: number | null }>(
      'SELECT name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at',
      user.id
    ).map((row) => ({ name: row.name, createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at) })),
    appPasswords: all<{ name: string; created_at: number; last_used_at: number | null }>(
      'SELECT name, created_at, last_used_at FROM app_passwords WHERE user_id = ? ORDER BY created_at',
      user.id
    ).map((row) => ({ name: row.name, createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at) })),
    mailAccounts: all<{ name: string; email: string; display_name: string; imap_host: string; smtp_host: string; signature: string }>(
      'SELECT name, email, display_name, imap_host, smtp_host, signature FROM mail_accounts WHERE user_id = ? ORDER BY position',
      user.id
    ).map((row) => ({
      name: row.name,
      email: row.email,
      displayName: row.display_name,
      imap: row.imap_host,
      smtp: row.smtp_host,
      signature: row.signature,
    })),
    chatMessages: all<{ kind: string; name: string; body: string; created_at: number; edited_at: number | null }>(
      `SELECT r.kind, r.name, m.body, m.created_at, m.edited_at FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
       WHERE m.user_id = ? AND m.kind = 'text' AND m.deleted_at IS NULL ORDER BY m.id`,
      user.id
    ).map((row) => ({
      room: row.kind === 'self' ? 'Notizen an mich' : row.name || row.kind,
      text: row.body,
      createdAt: iso(row.created_at),
      editedAt: iso(row.edited_at),
    })),
    status:
      all<{ state: string; emoji: string; text: string; until: number | null }>(
        'SELECT state, emoji, text, until FROM user_status WHERE user_id = ?',
        user.id
      ).map((row) => ({
        state: row.state,
        emoji: row.emoji,
        text: row.text,
        until: iso(row.until),
      }))[0] ?? null,
    forms: formsOfUser(user.id).map((form) => ({
      title: form.title,
      description: form.description,
      questions: form.questions,
      createdAt: iso(form.createdAt),
      responses: form.answers.map((response) => ({ createdAt: iso(response.createdAt), answers: response.answers })),
    })),
  };
}

export const exportName = (user: UserRow) => `moecloud-${user.username}-${new Date().toISOString().slice(0, 10)}.zip`;

export function exportStream(user: UserRow): Readable {
  const roots = all<NodeRow>('SELECT * FROM nodes WHERE parent_id = ? AND trashed_at IS NULL ORDER BY name_key', user.root_id);
  const data = Buffer.from(`${JSON.stringify(accountData(user), null, 2)}\n`);
  const used = new Set<string>();
  const calendars = ownCalendars(user.id)
    .filter((calendar) => calendar.kind === 'local')
    .map((calendar) => {
      const base = calendar.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Kalender';
      let name = `${base}.ics`;
      for (let index = 2; used.has(name.toLowerCase()); index++) name = `${base} (${index}).ics`;
      used.add(name.toLowerCase());
      return { name: `kalender/${name}`, data: Buffer.from(exportIcs(calendar), 'utf8') };
    });
  const books = ownBooks(user.id).map((book) => {
    const base = book.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Kontakte';
    let name = `${base}.vcf`;
    for (let index = 2; used.has(`k:${name.toLowerCase()}`); index++) name = `${base} (${index}).vcf`;
    used.add(`k:${name.toLowerCase()}`);
    return {
      name: `kontakte/${name}`,
      data: Buffer.from(
        exportVcf(all<ContactRow>('SELECT vcard FROM contacts WHERE book_id = ? AND trashed_at IS NULL ORDER BY name', book.id)),
        'utf8'
      ),
    };
  });
  const extras = [{ name: 'konto.json', data }, ...calendars, ...books];
  if (all('SELECT id FROM bookmarks WHERE user_id = ? LIMIT 1', user.id).length)
    extras.push({ name: 'lesezeichen.html', data: Buffer.from(exportBookmarks(user), 'utf8') });
  if (all('SELECT id FROM feed_sources WHERE user_id = ? LIMIT 1', user.id).length)
    extras.push({ name: 'feeds.opml', data: Buffer.from(exportOpml(user, 'Feeds'), 'utf8') });
  const snippetNames = new Set<string>();
  for (const row of all<SnippetRow>('SELECT * FROM snippets WHERE user_id = ? ORDER BY created_at', user.id)) {
    const wanted = snippetFileName(row, 'Schnipsel');
    let name = wanted;
    for (let index = 2; snippetNames.has(name.toLowerCase()); index++) name = wanted.replace(/(\.[^.]+)?$/, ` (${index})$1`);
    snippetNames.add(name.toLowerCase());
    extras.push({ name: `schnipsel/${name}`, data: Buffer.from(row.content, 'utf8') });
  }
  return zipStream(roots, { prefix: FOLDER, extras });
}
