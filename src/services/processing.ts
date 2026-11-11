import { open } from 'node:fs/promises';
import sharp from 'sharp';
import exifr from 'exifr';
import { parseFile } from 'music-metadata';
import { all, one, run, tx } from '../lib/db.ts';
import { canThumb, extensionOf, isHeif, isRaw, isTextual, kindOf, mimeOf, resolveType } from '../lib/mime.ts';
import { log } from '../lib/log.ts';
import { documentText } from './archive.ts';
import { blobPath, getBlob, metaOf } from './blobs.ts';
import { heifExif } from './heif.ts';
import { pdfText, probe, tools } from './media.ts';
import { changed } from './nodes.ts';
import { canonMeta, rawInfo, readRange } from './raw.ts';
import * as settings from './settings.ts';
import { sniff } from './sniff.ts';
import { thumbnail } from './thumbs.ts';

const TEXT_LIMIT = 1024 * 1024;
const PREVIEW_REVISION = 2;
const DOCUMENTS = new Set(['docx', 'odt', 'odp', 'ods', 'pptx', 'xlsx']);
const EXIF_TAGS = ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'LensModel', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength'];
const EXIF_CODES: Record<string, string> = {
  36867: 'DateTimeOriginal',
  36868: 'CreateDate',
  33434: 'ExposureTime',
  33437: 'FNumber',
  34855: 'ISO',
  37386: 'FocalLength',
  42036: 'LensModel',
};

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopped = true;
export const progress = { processed: 0, failed: 0 };

function sample(sha: string) {
  return one<{ name: string; mime: string | null }>(
    `SELECT name, mime FROM nodes WHERE sha256 = ?
     UNION ALL SELECT n.name, v.mime FROM versions v JOIN nodes n ON n.id = v.node_id WHERE v.sha256 = ?
     LIMIT 1`,
    sha,
    sha
  );
}

function clean(value: unknown, digits = 3) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : undefined;
  if (typeof value === 'string') return value.replace(/\0/g, '').trim().slice(0, 200) || undefined;
  return undefined;
}

type Exif = Record<string, unknown>;

async function readExif(data: Buffer): Promise<Exif | undefined> {
  try {
    return ((await exifr.parse(data, { pick: EXIF_TAGS })) as Exif | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

async function canonExif(path: string): Promise<Exif | undefined> {
  const found: Exif = {};
  for (const box of await canonMeta(path)) {
    try {
      const tags = (await exifr.parse(box, { translateValues: false, gps: false })) as Exif | undefined;
      for (const [key, value] of Object.entries(tags ?? {})) found[EXIF_CODES[key] ?? key] = value;
    } catch {}
  }
  return Object.keys(found).length ? found : undefined;
}

async function rawExif(path: string): Promise<Exif | undefined> {
  const canon = await canonExif(path);
  if (canon) return canon;
  const { preview } = await rawInfo(path);
  return preview ? readExif(await readRange(path, preview.offset, Math.min(preview.length, 512 * 1024))) : undefined;
}

function exifDate(value: unknown) {
  if (value instanceof Date) return value;
  const parts = typeof value === 'string' ? value.trim().split(/[-: ]/).map(Number) : [];
  if (parts.length < 6 || !parts.every(Number.isFinite)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

function cameraName(make: unknown, model: unknown) {
  const brand = typeof make === 'string' ? make.trim() : '';
  const name = typeof model === 'string' ? model.trim() : '';
  const first = brand.split(/\s+/)[0].toLowerCase();
  return first && name.toLowerCase().startsWith(first) ? name : [brand, name].filter(Boolean).join(' ');
}

async function imageMeta(path: string, type: string) {
  const meta: Record<string, unknown> = {};
  let takenAt: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (canThumb(type)) {
    const info = await sharp(path, { failOn: 'none', limitInputPixels: 268_402_689 })
      .metadata()
      .catch(() => null);
    width = info?.autoOrient?.width ?? info?.width ?? null;
    height = info?.autoOrient?.height ?? info?.height ?? null;
  }
  let exif = await readExif(await head(path, 2 * 1024 * 1024));
  if (!exif && isRaw(type)) exif = await rawExif(path).catch(() => undefined);
  if (!exif && isHeif(type)) {
    const item = await heifExif(path).catch(() => null);
    if (item) exif = await readExif(item);
  }
  if (exif) {
    const date = exifDate(exif.DateTimeOriginal ?? exif.CreateDate);
    if (date && Number.isFinite(date.getTime()) && date.getFullYear() > 1900) takenAt = date.getTime();
    meta.camera = clean(cameraName(exif.Make, exif.Model));
    meta.lens = clean(exif.LensModel);
    meta.aperture = clean(exif.FNumber);
    meta.exposure = clean(exif.ExposureTime, 6);
    meta.iso = clean(exif.ISO);
    meta.focal = clean(exif.FocalLength);
  }
  return { meta, takenAt, width, height };
}

async function audioMeta(path: string) {
  const tags = await parseFile(path, { skipCovers: false, duration: true });
  return {
    meta: {
      title: clean(tags.common.title),
      artist: clean(tags.common.artist),
      album: clean(tags.common.album),
      year: clean(tags.common.year),
      duration: clean(tags.format.duration),
      bitrate: clean(tags.format.bitrate),
      codec: clean(tags.format.codec),
      cover: Boolean(tags.common.picture?.length),
    },
  };
}

async function head(path: string, limit: number) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readText(path: string) {
  const slice = await head(path, TEXT_LIMIT);
  let zeros = 0;
  for (const byte of slice.subarray(0, 8192)) if (byte === 0) zeros++;
  if (zeros > 8) return '';
  return slice.toString('utf8').replace(/\uFFFD/g, '');
}

async function extractText(path: string, name: string, mime: string) {
  if (!settings.get('search.content')) return '';
  const ext = extensionOf(name);
  if (isTextual(name, mime)) return readText(path);
  if (mime === 'application/pdf' && tools.pdftotext) return pdfText(path, TEXT_LIMIT);
  if (DOCUMENTS.has(ext)) return documentText(path, TEXT_LIMIT);
  return '';
}

export async function processBlob(sha: string) {
  const blob = getBlob(sha);
  if (!blob) return;
  const found = sample(sha);
  if (!found) {
    run('UPDATE blobs SET processed = 1 WHERE sha256 = ?', sha);
    return;
  }
  const path = blobPath(sha);
  const sniffed = blob.size > 0 ? await sniff(path).catch(() => null) : null;
  const mime = resolveType(found.name, found.mime, sniffed);
  const kind = kindOf(found.name, mime);
  let meta: Record<string, unknown> = {};
  let takenAt: number | null = null;
  let width: number | null = blob.width;
  let height: number | null = blob.height;
  try {
    if (kind === 'image') {
      const result = await imageMeta(path, mime);
      meta = result.meta;
      takenAt = result.takenAt;
      width = result.width ?? width;
      height = result.height ?? height;
    } else if (kind === 'video' && tools.ffprobe) {
      const result = await probe(path);
      meta = { duration: result.duration ?? undefined, codec: result.codec ?? undefined };
      takenAt = result.created;
      width = result.width;
      height = result.height;
    } else if (kind === 'audio') {
      meta = (await audioMeta(path)).meta;
    }
  } catch (error) {
    log.debug({ sha, error: (error as Error).message }, 'Metadaten nicht lesbar');
  }
  if (sniffed) meta.type = sniffed;
  const compact = Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== '' && value !== false));
  run(
    'UPDATE blobs SET meta = ?, taken_at = ?, width = ?, height = ? WHERE sha256 = ?',
    Object.keys(compact).length ? JSON.stringify(compact) : null,
    takenAt,
    width,
    height,
    sha
  );
  if (blob.size > 0 && blob.scan_status !== 'infected') {
    await thumbnail({ type: 'file', sha256: sha, mime: found.mime, size: blob.size, name: found.name }).catch(() => null);
    try {
      const text = (await extractText(path, found.name, mime)).trim();
      if (text)
        run(
          'INSERT INTO blob_text (sha256, content) VALUES (?, ?) ON CONFLICT(sha256) DO UPDATE SET content = excluded.content',
          sha,
          text
        );
    } catch (error) {
      log.debug({ sha, error: (error as Error).message }, 'Text nicht lesbar');
    }
  }
  run('UPDATE blobs SET processed = 1 WHERE sha256 = ?', sha);
  if (sniffed && sniffed !== metaOf(blob).type) {
    const folders = all<{ parent_id: string | null; name: string; mime: string | null }>(
      'SELECT parent_id, name, mime FROM nodes WHERE sha256 = ? AND trashed_at IS NULL LIMIT 200',
      sha
    )
      .filter((node) => resolveType(node.name, node.mime, sniffed) !== (node.mime ?? mimeOf(node.name)))
      .map((node) => node.parent_id);
    if (folders.length) changed(folders);
  }
}

async function drain() {
  if (running || stopped) return;
  running = true;
  try {
    for (;;) {
      if (stopped) break;
      const batch = all<{ sha256: string }>('SELECT sha256 FROM blobs WHERE processed = 0 AND refs > 0 ORDER BY created_at LIMIT 8');
      if (batch.length === 0) break;
      for (const row of batch) {
        if (stopped) break;
        try {
          await processBlob(row.sha256);
          progress.processed++;
        } catch (error) {
          progress.failed++;
          log.warn({ sha: row.sha256, error: (error as Error).message }, 'Verarbeitung fehlgeschlagen');
          run('UPDATE blobs SET processed = 2 WHERE sha256 = ?', row.sha256);
        }
      }
    }
  } finally {
    running = false;
  }
}

export function wake(delay = 400) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delay);
  timer.unref();
}

export function startProcessing() {
  stopped = false;
  wake(5000);
  const interval = setInterval(() => void drain(), 5 * 60_000);
  interval.unref();
  return () => {
    stopped = true;
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

export const pendingCount = () =>
  one<{ count: number }>('SELECT COUNT(*) AS count FROM blobs WHERE processed = 0 AND refs > 0')?.count ?? 0;

export async function processNow() {
  const previous = stopped;
  stopped = false;
  await drain();
  stopped = previous;
}

const RETYPE = {
  nodes: {
    select: "SELECT seq AS pos, name, mime, sha256 FROM nodes WHERE type = 'file' AND seq > ? ORDER BY seq LIMIT 2000",
    update: 'UPDATE nodes SET mime = ? WHERE seq = ?',
  },
  versions: {
    select: `SELECT v.rowid AS pos, n.name, v.mime, v.sha256 FROM versions v JOIN nodes n ON n.id = v.node_id
             WHERE v.rowid > ? ORDER BY v.rowid LIMIT 2000`,
    update: 'UPDATE versions SET mime = ? WHERE rowid = ?',
  },
};

function retype(table: keyof typeof RETYPE) {
  let changed = 0;
  for (let last = 0; ;) {
    const rows = all<{ pos: number; name: string; mime: string | null; sha256: string | null }>(RETYPE[table].select, last);
    if (rows.length === 0) return changed;
    last = rows[rows.length - 1].pos;
    for (const row of rows) {
      const mime = mimeOf(row.name);
      if (mime === row.mime) continue;
      run(RETYPE[table].update, mime, row.pos);
      if (row.sha256) run('UPDATE blobs SET processed = 0 WHERE sha256 = ?', row.sha256);
      changed++;
    }
  }
}

export function refreshPreviews() {
  if (settings.get('preview.revision') >= PREVIEW_REVISION) return null;
  const result = tx(() => {
    const retyped = retype('nodes') + retype('versions');
    run('UPDATE blobs SET processed = 0 WHERE refs > 0 AND thumb = -1');
    run(
      `UPDATE blobs SET processed = 0 WHERE refs > 0 AND sha256 IN (
         SELECT sha256 FROM nodes WHERE type = 'file' AND mime IN ('application/octet-stream', 'application/postscript', 'text/typescript')
       )`
    );
    run(
      `UPDATE blobs SET processed = 0 WHERE refs > 0 AND (width IS NULL OR thumb = 0) AND sha256 IN (
         SELECT sha256 FROM nodes WHERE type = 'file' AND mime LIKE 'image/%'
       )`
    );
    run('UPDATE blobs SET thumb = 0 WHERE thumb = -1');
    return { retyped, pending: pendingCount() };
  });
  settings.set('preview.revision', PREVIEW_REVISION);
  return result;
}

export function reindexText() {
  run('DELETE FROM blob_text');
  run('UPDATE blobs SET processed = 0 WHERE refs > 0');
  wake();
}
