import { all, IN_LIST, value } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { getNode, trash, type NodeRow } from './nodes.ts';
import { quotaOf, usageOf, type UserRow } from './users.ts';

export interface PhotoCursor {
  at: number;
  seq: number;
}

export function photos(user: UserRow, cursor: PhotoCursor | null, limit = 120) {
  const rows = all<NodeRow & { sort_at: number }>(
    `SELECT n.*, n.media_at AS sort_at FROM nodes n
     WHERE n.owner_id = ? AND n.media_at IS NOT NULL AND n.trashed_at IS NULL AND n.size > 0
       AND (n.media_at, n.seq) < (?, ?)
       AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.sha256 = n.sha256 AND b.scan_status = 'infected')
     ORDER BY n.media_at DESC, n.seq DESC LIMIT ?`,
    user.id,
    cursor?.at ?? Number.MAX_SAFE_INTEGER,
    cursor?.seq ?? Number.MAX_SAFE_INTEGER,
    limit + 1
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { nodes: page, next: rows.length > limit && last ? { at: last.sort_at, seq: last.seq } : null };
}

const DAY = 24 * 60 * 60 * 1000;
const MEMORY_YEARS = 30;
const MEMORY_ITEMS = 24;

export function memories(user: UserRow, date: string, offset: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return [];
  const [year, month, day] = match.slice(1).map(Number);
  const shift = Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? Math.round(offset) * 60_000 : 0;
  const windows: { year: number; from: number; to: number }[] = [];
  for (let past = year - 1; past >= Math.max(1970, year - MEMORY_YEARS); past--) {
    const start = Date.UTC(past, month - 1, day);
    if (new Date(start).getUTCDate() !== day) continue;
    windows.push({ year: past, from: start + shift, to: start + shift + DAY });
  }
  if (windows.length === 0) return [];
  const rows = all<NodeRow & { sort_at: number }>(
    `SELECT n.*, n.media_at AS sort_at FROM nodes n
     WHERE n.owner_id = ? AND n.media_at IS NOT NULL AND n.trashed_at IS NULL AND n.size > 0
       AND (${windows.map(() => '(n.media_at >= ? AND n.media_at < ?)').join(' OR ')})
       AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.sha256 = n.sha256 AND b.scan_status = 'infected')
     ORDER BY n.media_at, n.seq LIMIT 1000`,
    user.id,
    ...windows.flatMap((window) => [window.from, window.to])
  );
  return windows
    .map((window) => ({
      year: window.year,
      nodes: rows.filter((row) => row.sort_at >= window.from && row.sort_at < window.to).slice(0, MEMORY_ITEMS),
    }))
    .filter((group) => group.nodes.length > 0);
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

const DUPLICATES_SHOWN = 25;

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
        `SELECT * FROM (
           SELECT n.*, p.name AS parent_name, ROW_NUMBER() OVER (PARTITION BY n.sha256 ORDER BY n.created_at, n.seq) AS position
           FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
           WHERE n.owner_id = ? AND n.type = 'file' AND n.trashed_at IS NULL AND n.sha256 ${IN_LIST}
         ) ranked WHERE position <= ? ORDER BY sha256, position`,
        user.id,
        JSON.stringify(groups.map((group) => group.sha256)),
        DUPLICATES_SHOWN
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
      count: group.count,
      wasted: group.size * (group.count - 1),
      nodes: duplicates.filter((node) => node.sha256 === group.sha256),
    })),
  };
}

export function cleanDuplicates(user: UserRow, keep: string[]) {
  let removed = 0;
  let size = 0;
  for (const id of new Set(keep)) {
    const node = getNode(id);
    if (!node || node.owner_id !== user.id || node.type !== 'file' || node.trashed_at || !node.sha256) {
      throw notFound('Diese Datei oder diesen Ordner gibt es nicht mehr');
    }
    const copies = all<{ id: string; size: number }>(
      "SELECT id, size FROM nodes WHERE owner_id = ? AND sha256 = ? AND type = 'file' AND trashed_at IS NULL AND id != ?",
      user.id,
      node.sha256,
      node.id
    );
    if (!copies.length) continue;
    trash(
      user,
      copies.map((copy) => copy.id)
    );
    removed += copies.length;
    size += copies.reduce((sum, copy) => sum + Number(copy.size), 0);
  }
  return { removed, size };
}

export function serverGroups() {
  return byGroup(
    all<{ mime: string | null; size: number; count: number }>(
      "SELECT mime, COALESCE(SUM(size), 0) AS size, COUNT(*) AS count FROM nodes WHERE type = 'file' GROUP BY mime"
    )
  );
}
