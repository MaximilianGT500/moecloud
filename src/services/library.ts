import { all, placeholders, value } from '../lib/db.ts';
import type { NodeRow } from './nodes.ts';
import { quotaOf, usageOf, type UserRow } from './users.ts';

export interface PhotoCursor {
  at: number;
  seq: number;
}

export function photos(user: UserRow, cursor: PhotoCursor | null, limit = 120) {
  const rows = all<NodeRow & { sort_at: number }>(
    `SELECT n.*, COALESCE(b.taken_at, n.modified_at) AS sort_at
     FROM nodes n JOIN blobs b ON b.sha256 = n.sha256
     WHERE n.owner_id = ? AND n.type = 'file' AND n.trashed_at IS NULL AND n.size > 0
       AND (n.mime LIKE 'image/%' OR n.mime LIKE 'video/%')
       AND (b.scan_status IS NULL OR b.scan_status != 'infected')
       AND (COALESCE(b.taken_at, n.modified_at) < ? OR (COALESCE(b.taken_at, n.modified_at) = ? AND n.seq < ?))
     ORDER BY sort_at DESC, n.seq DESC LIMIT ?`,
    user.id,
    cursor?.at ?? Number.MAX_SAFE_INTEGER,
    cursor?.at ?? Number.MAX_SAFE_INTEGER,
    cursor?.seq ?? Number.MAX_SAFE_INTEGER,
    limit + 1
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { nodes: page, next: rows.length > limit && last ? { at: last.sort_at, seq: last.seq } : null };
}

export const KIND_GROUPS = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

const ARCHIVES = new Set([
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/x-iso9660-image',
  'application/x-apple-diskimage',
]);

export function groupOf(mime: string | null): KindGroup {
  const type = mime ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (ARCHIVES.has(type)) return 'archive';
  if (
    type === 'application/pdf' ||
    type.startsWith('text/') ||
    type.includes('officedocument') ||
    type.includes('opendocument') ||
    type.includes('msword') ||
    type.includes('ms-excel') ||
    type.includes('ms-powerpoint') ||
    ['application/json', 'application/xml', 'application/rtf', 'application/javascript', 'application/epub+zip'].includes(type)
  ) {
    return 'document';
  }
  return 'other';
}

function byGroup(rows: { mime: string | null; size: number; count: number }[]) {
  const totals = Object.fromEntries(KIND_GROUPS.map((group) => [group, { size: 0, count: 0 }])) as Record<
    KindGroup,
    { size: number; count: number }
  >;
  for (const row of rows) {
    const group = totals[groupOf(row.mime)];
    group.size += row.size;
    group.count += row.count;
  }
  return totals;
}

export function storageReport(user: UserRow) {
  const active = all<{ mime: string | null; size: number; count: number }>(
    "SELECT mime, COALESCE(SUM(size), 0) AS size, COUNT(*) AS count FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL GROUP BY mime",
    user.id
  );
  const trash =
    value<number>("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NOT NULL", user.id) ?? 0;
  const versions =
    value<number>('SELECT COALESCE(SUM(v.size), 0) FROM versions v JOIN nodes n ON n.id = v.node_id WHERE n.owner_id = ?', user.id) ?? 0;
  const largest = all<NodeRow>(
    "SELECT * FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL AND size > 0 ORDER BY size DESC LIMIT 15",
    user.id
  );
  const groups = all<{ sha256: string; count: number; size: number }>(
    `SELECT sha256, COUNT(*) AS count, MAX(size) AS size FROM nodes
     WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL AND size > 0 AND sha256 IS NOT NULL
     GROUP BY sha256 HAVING COUNT(*) > 1 ORDER BY MAX(size) * (COUNT(*) - 1) DESC LIMIT 20`,
    user.id
  );
  const duplicates = groups.length
    ? all<NodeRow & { parent_name: string | null }>(
        `SELECT n.*, p.name AS parent_name FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
         WHERE n.owner_id = ? AND n.type = 'file' AND n.trashed_at IS NULL AND n.sha256 IN (${placeholders(groups.length)})
         ORDER BY n.sha256, n.created_at`,
        user.id,
        ...groups.map((group) => group.sha256)
      )
    : [];
  return {
    used: usageOf(user.id),
    quota: quotaOf(user),
    trash,
    versions,
    groups: byGroup(active),
    largest,
    duplicates: groups.map((group) => ({
      sha256: group.sha256,
      size: group.size,
      wasted: group.size * (group.count - 1),
      nodes: duplicates.filter((node) => node.sha256 === group.sha256),
    })),
  };
}

export function serverGroups() {
  return byGroup(
    all<{ mime: string | null; size: number; count: number }>(
      "SELECT mime, COALESCE(SUM(size), 0) AS size, COUNT(*) AS count FROM nodes WHERE type = 'file' GROUP BY mime"
    )
  );
}
