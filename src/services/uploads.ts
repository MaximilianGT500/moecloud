import type { Readable } from 'node:stream';
import { open, rm, stat } from 'node:fs/promises';
import { all, one, run, tx } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, badRequest, conflict, notFound, tooLarge } from '../lib/errors.ts';
import { cleanName, cleanRelativePath, uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import { append, hashFile, receive, tmpPath, type Received } from './blobs.ts';
import { ingest, ingestBuffer } from './ingest.ts';
import { notify } from './notify.ts';
import {
  assertSpace,
  changed,
  ensurePath,
  findChild,
  getNode,
  insertNode,
  remaining,
  requireFolder,
  taken,
  type NodeRow,
} from './nodes.ts';
import { linkFolder, type LinkRow } from './links.ts';
import * as settings from './settings.ts';
import { getUser, prefsOf, quotaOf, updatePrefs, usageOf, type UserRow } from './users.ts';
import { writeContent } from './versions.ts';

export const CHUNK_SIZE = 16 * 1024 * 1024;

export interface Actor {
  user: UserRow | null;
  link: LinkRow | null;
}

export interface UploadRow {
  id: string;
  user_id: number | null;
  link_id: string | null;
  parent_id: string;
  name: string;
  relative_path: string | null;
  size: number;
  received: number;
  mime: string | null;
  modified_at: number | null;
  conflict: 'rename' | 'replace';
  created_at: number;
  updated_at: number;
}

export interface Target {
  parentId: string;
  name: string;
  relativePath?: string[];
  conflict?: 'rename' | 'replace';
  modifiedAt?: number | null;
}

const uploadFile = (id: string) => tmpPath(`upload-${id}`);

export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function targetFolder(actor: Actor, parentId: string): NodeRow {
  if (actor.user) return requireFolder(actor.user, parentId, 'edit').node;
  if (actor.link) return linkFolder(actor.link, parentId, true);
  throw notFound();
}

function checkLimits(ownerId: number, actorId: number | null, size: number, replacing: NodeRow | undefined) {
  const max = settings.get('storage.maxUpload');
  if (max > 0 && size > max) throw tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) });
  assertSpace(ownerId, size - (replacing?.size ?? 0), actorId);
}

const linkNotices = new Map<
  string,
  { count: number; timer: ReturnType<typeof setTimeout>; folder: string; folderId: string; creator: number; label: string }
>();

function flushLinkNotice(id: string) {
  const entry = linkNotices.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  linkNotices.delete(id);
  notify(
    entry.creator,
    'request_upload',
    { count: entry.count, label: entry.label, folder: entry.folder },
    `/files/folder/${entry.folderId}`
  );
}

function noticeLinkUpload(link: LinkRow, folder: NodeRow) {
  if (!link.notify) return;
  const existing = linkNotices.get(link.id);
  if (existing) {
    existing.count++;
    existing.timer.refresh();
    return;
  }
  const timer = setTimeout(() => flushLinkNotice(link.id), 60_000);
  timer.unref();
  linkNotices.set(link.id, {
    count: 1,
    timer,
    folder: folder.name,
    folderId: folder.id,
    creator: link.created_by,
    label: link.label || folder.name,
  });
}

export function flushLinkNotices() {
  for (const id of [...linkNotices.keys()]) flushLinkNotice(id);
}

export function checkQuota(ownerId: number) {
  const owner = getUser(ownerId);
  if (!owner) return;
  const quota = quotaOf(owner);
  if (!quota) return;
  const percent = (usageOf(ownerId) / quota) * 100;
  const prefs = prefsOf(owner);
  if (percent >= 90 && !prefs.storageWarned) {
    updatePrefs(ownerId, { storageWarned: true });
    notify(ownerId, 'storage', { percent: Math.floor(percent) }, '/files/storage');
  } else if (percent < 80 && prefs.storageWarned) {
    updatePrefs(ownerId, { storageWarned: false });
  }
}

export function placeFile(actor: Actor, target: Target, content: Received | { sha256: string; size: number }): NodeRow {
  const parent = targetFolder(actor, target.parentId);
  const actorId = actor.user?.id ?? null;
  const node = tx(() => {
    const folderId = ensurePath(parent.owner_id, actorId, parent.id, target.relativePath ?? []);
    const existing = findChild(folderId, target.name);
    if (existing?.type === 'file' && target.conflict === 'replace' && !actor.link) {
      const updated = writeContent(existing, { sha256: content.sha256, size: content.size, modifiedAt: target.modifiedAt }, actorId);
      record({ owner: parent.owner_id, actor: actorId, node: updated.id, parent: folderId, action: 'edit', name: updated.name });
      return updated;
    }
    const name = existing ? uniqueName(target.name, false, taken(folderId)) : target.name;
    const created = insertNode({
      ownerId: parent.owner_id,
      parentId: folderId,
      type: 'file',
      name,
      actorId,
      size: content.size,
      sha256: content.sha256,
      modifiedAt: target.modifiedAt,
    });
    record({
      owner: parent.owner_id,
      actor: actorId,
      link: actor.link?.id ?? null,
      node: created.id,
      parent: folderId,
      action: actor.link ? 'link_upload' : 'upload',
      name,
    });
    changed([folderId, parent.id]);
    return created;
  });
  if (actor.link) noticeLinkUpload(actor.link, parent);
  checkQuota(parent.owner_id);
  return node;
}

export interface InitInput {
  parentId: string;
  name: string;
  size: number;
  modifiedAt?: number | null;
  relativePath?: string | null;
  conflict?: 'rename' | 'replace';
}

export async function initUpload(actor: Actor, input: InitInput) {
  const parent = targetFolder(actor, input.parentId);
  const name = cleanName(input.name);
  const segments = cleanRelativePath(input.relativePath);
  const conflictMode = actor.link ? 'rename' : (input.conflict ?? 'rename');
  const replacing = conflictMode === 'replace' && segments.length === 0 ? findChild(parent.id, name) : undefined;
  checkLimits(parent.owner_id, actor.user?.id ?? null, input.size, replacing?.type === 'file' ? replacing : undefined);
  const id = randomId(24);
  const now = Date.now();
  const handle = await open(uploadFile(id), 'wx');
  await handle.close();
  run(
    `INSERT INTO uploads (id, user_id, link_id, parent_id, name, relative_path, size, received, modified_at, conflict, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    actor.user?.id ?? null,
    actor.link?.id ?? null,
    parent.id,
    name,
    segments.length ? segments.join('/') : null,
    input.size,
    input.modifiedAt ?? null,
    conflictMode,
    now,
    now
  );
  return { id, chunkSize: CHUNK_SIZE, received: 0 };
}

export function getUpload(actor: Actor, id: string) {
  const upload = one<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
  const mine = upload && (actor.user ? upload.user_id === actor.user.id : actor.link ? upload.link_id === actor.link.id : false);
  if (!upload || !mine) throw notFound('Diesen Upload gibt es nicht mehr');
  return upload;
}

const busy = new Set<string>();

export async function appendChunk(actor: Actor, id: string, offset: number, stream: Readable) {
  const upload = getUpload(actor, id);
  if (busy.has(id)) throw conflict('Dieser Upload läuft gerade schon');
  if (offset !== upload.received)
    throw conflict('Der Upload geht an einer anderen Stelle weiter', undefined, { received: upload.received });
  busy.add(id);
  const path = uploadFile(id);
  try {
    await append(path, stream, upload.size - upload.received, () => badRequest('Es kamen mehr Daten als angekündigt'));
  } finally {
    const size = await stat(path)
      .then((info) => info.size)
      .catch(() => upload.received);
    const received = Math.min(size, upload.size);
    run('UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?', received, Date.now(), id);
    busy.delete(id);
  }
  return { received: one<{ received: number }>('SELECT received FROM uploads WHERE id = ?', id)?.received ?? 0 };
}

export async function completeUpload(actor: Actor, id: string) {
  const upload = getUpload(actor, id);
  if (upload.received !== upload.size) throw badRequest('Der Upload ist noch nicht vollständig');
  if (busy.has(id)) throw conflict('Dieser Upload läuft gerade schon');
  busy.add(id);
  try {
    const path = uploadFile(id);
    const target: Target = {
      parentId: upload.parent_id,
      name: upload.name,
      relativePath: upload.relative_path ? upload.relative_path.split('/') : [],
      conflict: upload.conflict,
      modifiedAt: upload.modified_at,
    };
    const parent = targetFolder(actor, upload.parent_id);
    const replacing = target.conflict === 'replace' && !target.relativePath?.length ? findChild(parent.id, target.name) : undefined;
    checkLimits(parent.owner_id, actor.user?.id ?? null, upload.size, replacing?.type === 'file' ? replacing : undefined);
    const sha256 = await hashFile(path);
    await ingest(
      { path, size: upload.size, sha256 },
      { userId: actor.user?.id ?? null, name: upload.name, via: actor.link ? 'link' : 'upload' }
    );
    run('DELETE FROM uploads WHERE id = ?', id);
    return placeFile(actor, target, { sha256, size: upload.size });
  } catch (error) {
    if (error instanceof HttpError && (error.code === 'infected' || error.code === 'scan_unavailable')) {
      run('DELETE FROM uploads WHERE id = ?', id);
    }
    if (!one('SELECT 1 FROM uploads WHERE id = ?', id)) await rm(uploadFile(id), { force: true });
    throw error;
  } finally {
    busy.delete(id);
  }
}

export async function abortUpload(actor: Actor, id: string) {
  getUpload(actor, id);
  run('DELETE FROM uploads WHERE id = ?', id);
  await rm(uploadFile(id), { force: true });
}

export async function cleanupUploads(maxAgeMs = 24 * 60 * 60 * 1000) {
  const stale = all<{ id: string }>('SELECT id FROM uploads WHERE updated_at < ?', Date.now() - maxAgeMs);
  for (const row of stale) {
    run('DELETE FROM uploads WHERE id = ?', row.id);
    await rm(uploadFile(row.id), { force: true });
  }
  return stale.length;
}

export async function uploadStream(actor: Actor, target: Target, stream: Readable, declared?: number) {
  const parent = targetFolder(actor, target.parentId);
  const name = cleanName(target.name);
  const max = settings.get('storage.maxUpload');
  if (declared !== undefined) checkLimits(parent.owner_id, actor.user?.id ?? null, declared, undefined);
  const limit = Math.min(max > 0 ? max : Number.MAX_SAFE_INTEGER, Math.max(0, remaining(parent.owner_id)));
  const received = await receive(stream, limit, () =>
    max > 0 && limit === max
      ? tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) })
      : tooLarge('Dein Speicher ist voll')
  );
  await ingest(received, { userId: actor.user?.id ?? null, name, via: actor.link ? 'link' : 'api' });
  return placeFile(actor, { ...target, name }, received);
}

export async function createTextFile(user: UserRow, parentId: string, rawName: unknown, content = '') {
  const parent = requireFolder(user, parentId, 'edit').node;
  const name = cleanName(rawName);
  if (findChild(parent.id, name)) throw conflict('Hier gibt es schon etwas mit dem Namen „{name}“', { name });
  const buffer = Buffer.from(content, 'utf8');
  assertSpace(parent.owner_id, buffer.length, user.id);
  const sha256 = await ingestBuffer(buffer, { userId: user.id, name, via: 'editor' });
  const node = insertNode({
    ownerId: parent.owner_id,
    parentId: parent.id,
    type: 'file',
    name,
    actorId: user.id,
    size: buffer.length,
    sha256,
  });
  record({ owner: parent.owner_id, actor: user.id, node: node.id, parent: parent.id, action: 'text', name });
  changed([parent.id]);
  return getNode(node.id)!;
}
