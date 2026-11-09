import { statfs } from 'node:fs/promises';
import type { Entry, ZipFile } from 'yauzl';
import { config } from '../config.ts';
import { HttpError, badRequest, forbidden, insufficientStorage, notFound } from '../lib/errors.ts';
import { cleanName, uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import { entryStream, openZip, safePath } from './archive.ts';
import { blobPath, receive } from './blobs.ts';
import { ingest } from './ingest.ts';
import { changed, ensurePath, findChild, getNode, insertNode, remaining, requireAccess, requireFolder, taken } from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import * as settings from './settings.ts';
import { checkQuota } from './uploads.ts';
import type { UserRow } from './users.ts';

const MAX_FILES = 10_000;
const DISK_RESERVE = 512 * 1024 * 1024;
const JUNK = /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);

interface Planned {
  entry: Entry;
  segments: string[];
  folder: boolean;
}

export interface ExtractResult {
  folderId: string;
  files: number;
  folders: number;
  skipped: { infected: number; encrypted: number; unsafe: number; tooLarge: number };
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

function segmentsOf(entry: Entry): string[] | null {
  if (!safePath(entry.fileName)) return null;
  const parts = entry.fileName.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.length > 64) return null;
  try {
    return parts.map(cleanName);
  } catch {
    return null;
  }
}

const baseName = (name: string) => name.replace(/\.zip$/i, '').trim() || name;

async function freeSpace() {
  const disk = await statfs(config.dataDir).catch(() => null);
  return disk ? disk.bavail * disk.bsize : Number.MAX_SAFE_INTEGER;
}

export async function extractArchive(user: UserRow, nodeId: string): Promise<ExtractResult> {
  const { node } = requireAccess(user, nodeId);
  if (node.type !== 'file' || !node.sha256) throw notFound('Diese Datei gibt es nicht mehr');
  if (!ZIP_TYPES.has(node.mime ?? '') && !/\.zip$/i.test(node.name)) throw badRequest('Entpacken geht nur mit ZIP-Archiven');
  if (!node.parent_id) throw notFound('Diese Datei gibt es nicht mehr');
  assertNotInfected(node.sha256);
  const parent = requireFolder(user, node.parent_id, 'edit').node;
  if (parent.trashed_at) throw forbidden('Der Ordner liegt im Papierkorb');

  const zip = await openZip(blobPath(node.sha256)).catch(() => {
    throw badRequest('Das Archiv lässt sich nicht lesen');
  });
  try {
    const entries = await readEntries(zip).catch((error: unknown) => {
      if (error instanceof HttpError) throw error;
      throw badRequest('Das Archiv lässt sich nicht lesen');
    });
    const maxUpload = settings.get('storage.maxUpload');
    const skipped = { infected: 0, encrypted: 0, unsafe: 0, tooLarge: 0 };
    const plan: Planned[] = [];
    let total = 0;
    for (const entry of entries) {
      if (JUNK.test(entry.fileName)) continue;
      const segments = segmentsOf(entry);
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
      if (!folder) total += entry.uncompressedSize;
      plan.push({ entry, segments, folder });
    }
    const fileCount = plan.filter((item) => !item.folder).length;
    if (fileCount > MAX_FILES) throw badRequest('Das Archiv enthält mehr als {count} Dateien', { count: MAX_FILES });
    if (plan.length === 0) throw badRequest('Im Archiv gibt es nichts, was sich entpacken lässt');
    if (total > remaining(parent.owner_id)) {
      throw insufficientStorage(
        parent.owner_id === user.id
          ? 'Für den Inhalt des Archivs reicht dein Speicher nicht'
          : 'Für den Inhalt des Archivs reicht der Speicher der Person nicht, der dieser Ordner gehört'
      );
    }
    if (total + DISK_RESERVE > (await freeSpace())) throw insufficientStorage('Auf dem Server ist nicht genug Platz frei');

    const destination = insertNode({
      ownerId: parent.owner_id,
      parentId: parent.id,
      type: 'folder',
      name: uniqueName(cleanName(baseName(node.name)), true, taken(parent.id)),
      actorId: user.id,
    });
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
      const received = await receive(readable, item.entry.uncompressedSize).catch(() => null);
      if (!received) {
        skipped.unsafe++;
        continue;
      }
      const name = item.segments[item.segments.length - 1];
      try {
        await ingest(received, { userId: user.id, name, via: 'archive' });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'infected') {
          skipped.infected++;
          continue;
        }
        throw error;
      }
      const folderId = ensurePath(parent.owner_id, user.id, destination.id, item.segments.slice(0, -1));
      if (folderId !== destination.id) folders.add(folderId);
      insertNode({
        ownerId: parent.owner_id,
        parentId: folderId,
        type: 'file',
        name: findChild(folderId, name) ? uniqueName(name, false, taken(folderId)) : name,
        actorId: user.id,
        size: received.size,
        sha256: received.sha256,
        modifiedAt: item.entry.getLastModDate().getTime(),
      });
      files++;
    }
    record({
      owner: parent.owner_id,
      actor: user.id,
      node: node.id,
      parent: parent.id,
      action: 'extract',
      name: node.name,
      details: { into: destination.name, files },
    });
    changed([parent.id, destination.id, ...folders]);
    checkQuota(parent.owner_id);
    return { folderId: destination.id, files, folders: folders.size, skipped };
  } finally {
    zip.close();
  }
}
