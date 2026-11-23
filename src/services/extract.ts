import { rm, statfs } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { Entry, ZipFile } from 'yauzl';
import { config } from '../config.ts';
import { HttpError, badRequest, forbidden, insufficientStorage, notFound, tooLarge } from '../lib/errors.ts';
import { cleanName, uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import { entryStream, isZip, openZip, safePath } from './archive.ts';
import { blobPath, receive } from './blobs.ts';
import { ingest } from './ingest.ts';
import { assertAllowedName, isBlockedName } from './filetypes.ts';
import {
  changed,
  ensurePath,
  findChild,
  getNode,
  insertNode,
  remaining,
  requireAccess,
  requireFolder,
  taken,
  type NodeRow,
} from './nodes.ts';
import { isRansomwareName } from './ransomware.ts';
import { assertNotInfected } from './scan.ts';
import * as settings from './settings.ts';
import { TarLimitError, detect, gunzip, gzipInnerName, isTarLike, openSource, scanLimit, tarEntries, unreadable } from './tar.ts';
import { checkQuota } from './uploads.ts';
import { getUser, type UserRow } from './users.ts';

const MAX_FILES = 10_000;
const DISK_RESERVE = 512 * 1024 * 1024;
const JUNK = /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

interface Planned {
  entry: Entry;
  segments: string[];
  folder: boolean;
}

type Skipped = { infected: number; encrypted: number; unsafe: number; tooLarge: number; blocked: number };

export interface ExtractResult {
  folderId: string;
  files: number;
  folders: number;
  skipped: Skipped;
}

function readEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (entry: Entry) => {
      entries.push(entry);
      if (entries.length > MAX_FILES * 2) {
        reject(badRequest('Das Archiv enthält mehr als {count} Dateien', { count: MAX_FILES }));
        return;
      }
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', reject);
    zip.readEntry();
  });
}

const isSymlink = (entry: Entry) => ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
const isEncrypted = (entry: Entry) => (entry.generalPurposeBitFlag & 1) === 1;
const blocked = (name: string) => isBlockedName(name) || isRansomwareName(name);
const noSkips = (): Skipped => ({ infected: 0, encrypted: 0, unsafe: 0, tooLarge: 0, blocked: 0 });

function segmentsOf(path: string): string[] | null {
  if (!safePath(path)) return null;
  const parts = path.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.length > 64) return null;
  try {
    return parts.map(cleanName);
  } catch {
    return null;
  }
}

const baseName = (name: string) => name.replace(/\.(zip|tar\.gz|tgz|tar|gz)$/i, '').trim() || name;

async function freeSpace() {
  const disk = await statfs(config.dataDir).catch(() => null);
  return disk ? disk.bavail * disk.bsize : Number.MAX_SAFE_INTEGER;
}

function spaceError(user: UserRow, ownerId: number) {
  if (ownerId === user.id) return insufficientStorage('Für den Inhalt des Archivs reicht dein Speicher nicht');
  if (getUser(ownerId)?.role === 'team')
    return insufficientStorage('Für den Inhalt des Archivs reicht der Speicher dieses Teamordners nicht');
  return insufficientStorage('Für den Inhalt des Archivs reicht der Speicher der Person nicht, der dieser Ordner gehört');
}

const diskFull = () => insufficientStorage('Auf dem Server ist nicht genug Platz frei');

async function space(user: UserRow, ownerId: number) {
  const quota = remaining(ownerId);
  const disk = (await freeSpace()) - DISK_RESERVE;
  return { limit: Math.max(0, Math.min(quota, disk)), error: () => (quota <= disk ? spaceError(user, ownerId) : diskFull()) };
}

function destinationFor(user: UserRow, node: NodeRow, parent: NodeRow) {
  return insertNode({
    ownerId: parent.owner_id,
    parentId: parent.id,
    type: 'folder',
    name: uniqueName(cleanName(baseName(node.name)), true, taken(parent.id)),
    actorId: user.id,
  });
}

async function place(
  user: UserRow,
  parent: NodeRow,
  destinationId: string,
  segments: string[],
  readable: Readable,
  size: number,
  modified: number
): Promise<{ sha256: string; size: number; folderId: string } | 'infected' | null> {
  const received = await receive(readable, size).catch(() => null);
  if (!received) return null;
  if (received.size !== size) {
    await rm(received.path, { force: true });
    return null;
  }
  const name = segments[segments.length - 1];
  try {
    await ingest(received, { userId: user.id, name, via: 'archive' });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'infected') return 'infected';
    throw error;
  }
  const folderId = ensurePath(parent.owner_id, user.id, destinationId, segments.slice(0, -1));
  insertNode({
    ownerId: parent.owner_id,
    parentId: folderId,
    type: 'file',
    name: findChild(folderId, name) ? uniqueName(name, false, taken(folderId)) : name,
    actorId: user.id,
    size: received.size,
    sha256: received.sha256,
    modifiedAt: modified,
  });
  return { sha256: received.sha256, size: received.size, folderId };
}

function finish(user: UserRow, node: NodeRow, parent: NodeRow, into: string, files: number, touched: Iterable<string>) {
  record({
    owner: parent.owner_id,
    actor: user.id,
    node: node.id,
    parent: parent.id,
    action: 'extract',
    name: node.name,
    details: { into, files },
  });
  changed([parent.id, ...touched]);
  checkQuota(parent.owner_id);
}

export async function extractArchive(user: UserRow, nodeId: string): Promise<ExtractResult> {
  const { node } = requireAccess(user, nodeId);
  if (node.type !== 'file' || !node.sha256) throw notFound('Diese Datei gibt es nicht mehr');
  const zip = isZip(node);
  if (!zip && !isTarLike(node)) throw badRequest('Entpacken geht nur mit ZIP-, TAR- und GZ-Archiven');
  if (!node.parent_id) throw notFound('Diese Datei gibt es nicht mehr');
  assertNotInfected(node.sha256);
  const parent = requireFolder(user, node.parent_id, 'edit').node;
  if (parent.trashed_at) throw forbidden('Der Ordner liegt im Papierkorb');
  if (zip) return extractZip(user, node, parent);
  const path = blobPath(node.sha256);
  const format = await detect(path).catch((error: unknown) => {
    throw error instanceof HttpError ? error : unreadable();
  });
  try {
    return format === 'gzip' ? await extractGzip(user, node, parent, path) : await extractTar(user, node, parent, path);
  } catch (error) {
    if (error instanceof TarLimitError) throw badRequest('Entpackt wäre das Archiv zu groß');
    if (error instanceof HttpError) throw error;
    throw unreadable();
  }
}

async function extractZip(user: UserRow, node: NodeRow, parent: NodeRow): Promise<ExtractResult> {
  const zip = await openZip(blobPath(node.sha256!)).catch(() => {
    throw unreadable();
  });
  try {
    const entries = await readEntries(zip).catch((error: unknown) => {
      if (error instanceof HttpError) throw error;
      throw unreadable();
    });
    const maxUpload = settings.get('storage.maxUpload');
    const skipped = noSkips();
    const plan: Planned[] = [];
    let total = 0;
    for (const entry of entries) {
      if (JUNK.test(entry.fileName)) continue;
      const segments = segmentsOf(entry.fileName);
      if (!segments || isSymlink(entry)) {
        skipped.unsafe++;
        continue;
      }
      const folder = entry.fileName.endsWith('/');
      if (!folder && isEncrypted(entry)) {
        skipped.encrypted++;
        continue;
      }
      if (!folder && maxUpload > 0 && entry.uncompressedSize > maxUpload) {
        skipped.tooLarge++;
        continue;
      }
      if (!folder && blocked(segments[segments.length - 1])) {
        skipped.blocked++;
        continue;
      }
      if (!folder) total += entry.uncompressedSize;
      plan.push({ entry, segments, folder });
    }
    const fileCount = plan.filter((item) => !item.folder).length;
    if (fileCount > MAX_FILES) throw badRequest('Das Archiv enthält mehr als {count} Dateien', { count: MAX_FILES });
    if (plan.length === 0) throw badRequest('Im Archiv gibt es nichts, was sich entpacken lässt');
    const room = await space(user, parent.owner_id);
    if (total > room.limit) throw room.error();

    const destination = destinationFor(user, node, parent);
    let files = 0;
    const folders = new Set<string>();
    for (const item of plan) {
      const current = getNode(destination.id);
      if (!current || current.trashed_at) break;
      if (item.folder) {
        folders.add(ensurePath(parent.owner_id, user.id, destination.id, item.segments));
        continue;
      }
      const readable = await entryStream(zip, item.entry).catch(() => null);
      if (!readable) {
        skipped.unsafe++;
        continue;
      }
      const placed = await place(
        user,
        parent,
        destination.id,
        item.segments,
        readable,
        item.entry.uncompressedSize,
        item.entry.getLastModDate().getTime()
      );
      if (placed === 'infected') skipped.infected++;
      else if (!placed) skipped.unsafe++;
      else {
        if (placed.folderId !== destination.id) folders.add(placed.folderId);
        files++;
      }
    }
    finish(user, node, parent, destination.name, files, [destination.id, ...folders]);
    return { folderId: destination.id, files, folders: folders.size, skipped };
  } finally {
    zip.close();
  }
}

interface TarPlan {
  segments: string[];
  kind: 'file' | 'folder' | 'hardlink';
  target: string | null;
}

async function extractTar(user: UserRow, node: NodeRow, parent: NodeRow, path: string): Promise<ExtractResult> {
  const limit = await scanLimit(path);
  const maxUpload = settings.get('storage.maxUpload');
  const skipped = noSkips();
  const plan = new Map<number, TarPlan>();
  const sizes = new Map<string, number>();
  const room = await space(user, parent.owner_id);
  let total = 0;
  let count = 0;
  for await (const entry of tarEntries(await openSource(path, limit))) {
    if (JUNK.test(entry.name)) continue;
    if (entry.kind === 'symlink' || entry.kind === 'other') {
      skipped.unsafe++;
      continue;
    }
    const segments = segmentsOf(entry.name);
    if (!segments) {
      skipped.unsafe++;
      continue;
    }
    if (entry.kind === 'folder') {
      plan.set(entry.index, { segments, kind: 'folder', target: null });
      continue;
    }
    const size = entry.kind === 'hardlink' ? sizes.get(entry.link ?? '') : entry.size;
    if (size === undefined) {
      skipped.unsafe++;
      continue;
    }
    if (maxUpload > 0 && size > maxUpload) {
      skipped.tooLarge++;
      continue;
    }
    if (blocked(segments[segments.length - 1])) {
      skipped.blocked++;
      continue;
    }
    if (++count > MAX_FILES) throw badRequest('Das Archiv enthält mehr als {count} Dateien', { count: MAX_FILES });
    total += size;
    if (total > room.limit) throw room.error();
    if (entry.kind === 'file') sizes.set(entry.name, size);
    plan.set(entry.index, { segments, kind: entry.kind, target: entry.kind === 'hardlink' ? entry.link : null });
  }
  if (plan.size === 0) throw badRequest('Im Archiv gibt es nichts, was sich entpacken lässt');

  const destination = destinationFor(user, node, parent);
  const stored = new Map<string, { sha256: string; size: number }>();
  const folders = new Set<string>();
  let files = 0;
  for await (const entry of tarEntries(await openSource(path, limit))) {
    const item = plan.get(entry.index);
    if (!item) continue;
    const current = getNode(destination.id);
    if (!current || current.trashed_at) break;
    if (item.kind === 'folder') {
      folders.add(ensurePath(parent.owner_id, user.id, destination.id, item.segments));
      continue;
    }
    if (item.kind === 'hardlink') {
      const source = stored.get(item.target ?? '');
      if (!source) {
        skipped.unsafe++;
        continue;
      }
      const name = item.segments[item.segments.length - 1];
      const folderId = ensurePath(parent.owner_id, user.id, destination.id, item.segments.slice(0, -1));
      if (folderId !== destination.id) folders.add(folderId);
      insertNode({
        ownerId: parent.owner_id,
        parentId: folderId,
        type: 'file',
        name: findChild(folderId, name) ? uniqueName(name, false, taken(folderId)) : name,
        actorId: user.id,
        size: source.size,
        sha256: source.sha256,
        modifiedAt: entry.modified,
      });
      files++;
      continue;
    }
    const placed = await place(user, parent, destination.id, item.segments, entry.body(), entry.size, entry.modified);
    if (placed === 'infected') skipped.infected++;
    else if (!placed) skipped.unsafe++;
    else {
      stored.set(entry.name, placed);
      if (placed.folderId !== destination.id) folders.add(placed.folderId);
      files++;
    }
  }
  finish(user, node, parent, destination.name, files, [destination.id, ...folders]);
  return { folderId: destination.id, files, folders: folders.size, skipped };
}

async function extractGzip(user: UserRow, node: NodeRow, parent: NodeRow, path: string): Promise<ExtractResult> {
  const name = uniqueName(cleanName(gzipInnerName(node.name)), false, taken(parent.id));
  assertAllowedName(name);
  const maxUpload = settings.get('storage.maxUpload');
  const room = await space(user, parent.owner_id);
  const capped = maxUpload > 0 && maxUpload < room.limit;
  const limit = Math.min(capped ? maxUpload : room.limit, Number.MAX_SAFE_INTEGER);
  const received = await receive(gunzip(path), limit, () =>
    capped ? tooLarge('Entpackt ist die Datei größer als erlaubt') : room.error()
  ).catch((error: unknown) => {
    throw error instanceof HttpError ? error : unreadable();
  });
  const skipped = noSkips();
  try {
    await ingest(received, { userId: user.id, name, via: 'archive' });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'infected') {
      skipped.infected++;
      return { folderId: parent.id, files: 0, folders: 0, skipped };
    }
    throw error;
  }
  insertNode({
    ownerId: parent.owner_id,
    parentId: parent.id,
    type: 'file',
    name,
    actorId: user.id,
    size: received.size,
    sha256: received.sha256,
    modifiedAt: node.modified_at,
  });
  finish(user, node, parent, parent.name, 1, []);
  return { folderId: parent.id, files: 1, folders: 0, skipped };
}
