import { open } from 'node:fs/promises';
import sharp from 'sharp';
import exifr from 'exifr';
import { parseFile } from 'music-metadata';
import { all, one, run } from '../lib/db.ts';
import { extensionOf, isTextual, kindOf, mimeOf } from '../lib/mime.ts';
import { log } from '../lib/log.ts';
import { documentText } from './archive.ts';
import { blobPath, getBlob } from './blobs.ts';
import { pdfText, probe, tools } from './media.ts';
import * as settings from './settings.ts';
import { thumbnail } from './thumbs.ts';

const TEXT_LIMIT = 1024 * 1024;
const DOCUMENTS = new Set(['docx', 'odt', 'odp', 'ods', 'pptx', 'xlsx']);

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

function clean(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
  if (typeof value === 'string') return value.replace(/\0/g, '').trim().slice(0, 200) || undefined;
  return undefined;
}

async function imageMeta(path: string) {
  const meta: Record<string, unknown> = {};
  let takenAt: number | null = null;
  const info = await sharp(path, { failOn: 'none', limitInputPixels: 268_402_689 }).metadata();
  const width = info.autoOrient?.width ?? info.width ?? null;
  const height = info.autoOrient?.height ?? info.height ?? null;
  try {
    const exif = (await exifr.parse(await head(path, 2 * 1024 * 1024), {
      pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'LensModel', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength'],
    })) as Record<string, unknown> | undefined;
    if (exif) {
      const date = (exif.DateTimeOriginal ?? exif.CreateDate) as Date | undefined;
      if (date instanceof Date && Number.isFinite(date.getTime()) && date.getFullYear() > 1900) takenAt = date.getTime();
      meta.camera = clean([exif.Make, exif.Model].filter(Boolean).join(' '));
      meta.lens = clean(exif.LensModel);
      meta.aperture = clean(exif.FNumber);
      meta.exposure = clean(exif.ExposureTime);
      meta.iso = clean(exif.ISO);
      meta.focal = clean(exif.FocalLength);
    }
  } catch {}
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
  const mime = found.mime ?? mimeOf(found.name);
  const kind = kindOf(found.name, mime);
  const path = blobPath(sha);
  let meta: Record<string, unknown> = {};
  let takenAt: number | null = null;
  let width: number | null = blob.width;
  let height: number | null = blob.height;
  try {
    if (kind === 'image') {
      const result = await imageMeta(path);
      meta = result.meta;
      takenAt = result.takenAt;
      width = result.width;
      height = result.height;
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
    await thumbnail({ type: 'file', sha256: sha, mime, size: blob.size, name: found.name }).catch(() => null);
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

export function reindexText() {
  run('DELETE FROM blob_text');
  run('UPDATE blobs SET processed = 0 WHERE refs > 0');
  wake();
}
