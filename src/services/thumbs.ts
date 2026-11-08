import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';
import { run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { canThumb, mimeOf } from '../lib/mime.ts';
import { blobPath, getBlob, metaOf, thumbPath, type BlobRow } from './blobs.ts';
import { pdfPage, tools, videoFrame } from './media.ts';
import type { NodeRow } from './nodes.ts';

sharp.cache(false);
sharp.concurrency(1);

const MAX_INPUT = 50 * 1024 * 1024 * 1024;
const pending = new Map<string, Promise<string | null>>();
let active = 0;
const waiting: (() => void)[] = [];

export type PreviewSource = 'image' | 'video' | 'pdf' | 'audio';

export function previewSource(mime: string | null, blob?: Pick<BlobRow, 'meta'> | null): PreviewSource | null {
  const type = mime ?? '';
  if (canThumb(type)) return 'image';
  if (type.startsWith('video/') && tools.ffmpeg) return 'video';
  if (type === 'application/pdf' && tools.pdftoppm) return 'pdf';
  if (type.startsWith('audio/') && metaOf(blob).cover) return 'audio';
  return null;
}

export function hasPreview(
  node: Pick<NodeRow, 'type' | 'mime' | 'size'>,
  blob: Pick<BlobRow, 'meta' | 'thumb' | 'scan_status'> | undefined | null
) {
  if (node.type !== 'file' || node.size === 0 || !blob) return false;
  if (blob.thumb === -1 || blob.scan_status === 'infected') return false;
  return previewSource(node.mime, blob) !== null;
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function input(source: PreviewSource, path: string): Promise<string | Buffer | null> {
  if (source === 'image') return path;
  if (source === 'video') return videoFrame(path);
  if (source === 'pdf') return pdfPage(path);
  const tags = await parseFile(path, { skipCovers: false, duration: false });
  const picture = tags.common.picture?.[0];
  return picture ? Buffer.from(picture.data) : null;
}

async function render(sha: string, source: PreviewSource): Promise<string | null> {
  const target = thumbPath(sha);
  try {
    const data = await input(source, blobPath(sha));
    if (!data) throw new Error('no preview');
    const image = sharp(data, { failOn: 'none', limitInputPixels: 268_402_689, animated: false });
    const meta = await image.metadata();
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomId(8)}`;
    let pipeline = image.autoOrient().resize(480, 480, { fit: 'inside', withoutEnlargement: true });
    if (source === 'pdf') pipeline = pipeline.flatten({ background: '#ffffff' });
    await pipeline.webp({ quality: 76, effort: 3 }).toFile(temp);
    await rename(temp, target);
    if (source === 'image') {
      run(
        'UPDATE blobs SET thumb = 1, width = ?, height = ? WHERE sha256 = ?',
        meta.autoOrient?.width ?? meta.width ?? null,
        meta.autoOrient?.height ?? meta.height ?? null,
        sha
      );
    } else {
      run('UPDATE blobs SET thumb = 1 WHERE sha256 = ?', sha);
    }
    return target;
  } catch {
    run('UPDATE blobs SET thumb = -1 WHERE sha256 = ?', sha);
    await rm(target, { force: true });
    return null;
  }
}

export async function thumbnail(node: Pick<NodeRow, 'type' | 'sha256' | 'mime' | 'size' | 'name'>): Promise<string | null> {
  if (node.type !== 'file' || !node.sha256 || node.size === 0 || node.size > MAX_INPUT) return null;
  const sha = node.sha256;
  const blob = getBlob(sha);
  if (!blob || blob.thumb === -1 || blob.scan_status === 'infected') return null;
  const source = previewSource(node.mime ?? mimeOf(node.name), blob);
  if (!source) return null;
  if (blob.thumb === 1) {
    const exists = await stat(thumbPath(sha)).catch(() => null);
    if (exists) return thumbPath(sha);
  }
  let job = pending.get(sha);
  if (!job) {
    job = slot(() => render(sha, source)).finally(() => pending.delete(sha));
    pending.set(sha, job);
  }
  return job;
}

export function dimensions(sha: string | null) {
  if (!sha) return null;
  const blob = getBlob(sha);
  return blob?.width && blob.height ? { width: blob.width, height: blob.height } : null;
}
