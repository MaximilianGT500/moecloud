import { all, one, run, tx } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { notFound } from '../lib/errors.ts';
import { mimeOf } from '../lib/mime.ts';
import { record } from './activity.ts';
import { changed, getNode, requireAccess, type NodeRow } from './nodes.ts';
import * as settings from './settings.ts';
import { getUser, type UserRow } from './users.ts';

export interface VersionRow {
  id: string;
  node_id: string;
  sha256: string;
  size: number;
  mime: string | null;
  author_id: number | null;
  modified_at: number;
  created_at: number;
}

export interface Content {
  sha256: string;
  size: number;
  modifiedAt?: number | null;
}

export function prune(nodeId: string, keep = settings.get('storage.versions')) {
  const rows = all<{ id: string }>('SELECT id FROM versions WHERE node_id = ? ORDER BY created_at DESC', nodeId);
  for (const row of rows.slice(Math.max(0, keep))) run('DELETE FROM versions WHERE id = ?', row.id);
}

export function purgeVersions(days: number) {
  if (days <= 0) return 0;
  return run('DELETE FROM versions WHERE created_at < ?', Date.now() - days * 24 * 60 * 60 * 1000).changes;
}

export function writeContent(node: NodeRow, content: Content, actorId: number | null): NodeRow {
  const now = Date.now();
  const modified = content.modifiedAt && content.modifiedAt > 0 ? Math.min(content.modifiedAt, now + 60_000) : now;
  tx(() => {
    const keep = settings.get('storage.versions');
    if (node.sha256 && node.sha256 !== content.sha256 && node.size > 0 && keep > 0) {
      run(
        `INSERT INTO versions (id, node_id, sha256, size, mime, author_id, modified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        randomId(),
        node.id,
        node.sha256,
        node.size,
        node.mime,
        node.updated_by,
        node.modified_at,
        now
      );
    }
    run(
      `UPDATE nodes SET sha256 = ?, size = ?, mime = ?, modified_at = ?, updated_at = ?, updated_by = ?, etag = etag + 1 WHERE id = ?`,
      content.sha256,
      content.size,
      mimeOf(node.name),
      modified,
      now,
      actorId,
      node.id
    );
    if (node.parent_id) run('UPDATE nodes SET updated_at = ? WHERE id = ?', now, node.parent_id);
    prune(node.id, keep);
  });
  changed([node.parent_id]);
  return getNode(node.id)!;
}

export function listVersions(user: UserRow, nodeId: string) {
  requireAccess(user, nodeId, 'view');
  return all<VersionRow>('SELECT * FROM versions WHERE node_id = ? ORDER BY created_at DESC', nodeId).map((row) => ({
    id: row.id,
    size: row.size,
    modifiedAt: row.modified_at,
    createdAt: row.created_at,
    author: row.author_id ? (getUser(row.author_id)?.name ?? null) : null,
  }));
}

export function getVersion(user: UserRow, nodeId: string, versionId: string) {
  const access = requireAccess(user, nodeId, 'view');
  const version = one<VersionRow>('SELECT * FROM versions WHERE id = ? AND node_id = ?', versionId, nodeId);
  if (!version) throw notFound('Diese Version gibt es nicht mehr');
  return { access, version };
}

export function restoreVersion(user: UserRow, nodeId: string, versionId: string) {
  const { version } = getVersion(user, nodeId, versionId);
  const { node } = requireAccess(user, nodeId, 'edit');
  return tx(() => {
    run('DELETE FROM versions WHERE id = ?', versionId);
    const restored = writeContent(node, { sha256: version.sha256, size: version.size, modifiedAt: version.modified_at }, user.id);
    record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'version_restore', name: node.name });
    return restored;
  });
}

export function deleteVersion(user: UserRow, nodeId: string, versionId: string) {
  getVersion(user, nodeId, versionId);
  requireAccess(user, nodeId, 'edit');
  run('DELETE FROM versions WHERE id = ?', versionId);
}
