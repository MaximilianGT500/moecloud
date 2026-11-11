import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { parseFile } from 'music-metadata';
import { run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { canThumb, isHeif, isInlineImage, isRaw } from '../lib/mime.ts';
import { blobPath, getBlob, metaOf, previewPath, thumbPath, typeOf, type BlobRow } from './blobs.ts';
import { coverImage, hasCover } from './covers.ts';
import { heifToWebp } from './heif.ts';
import { canFrame, imageFrame, pdfPage, tools, videoFrame } from './media.ts';
import type { NodeRow } from './nodes.ts';
import { rawInfo, readRange } from './raw.ts';

sharp.cache(false);
sharp.concurrency(1);

const MAX_INPUT = 50 * 1024 * 1024 * 1024;
const THUMB_EDGE = 480;
const PREVIEW_EDGE = 2560;
const OPTIONS = { failOn: 'none', limitInputPixels: 268_402_689, animated: false } as const;

const pending = new Map<string, Promise<string | null>>();
const failed = new Set<string>();
let active = 0;
const waiting: (() => void)[] = [];

export type PreviewSource = 'image' | 'raw' | 'heif' | 'frame' | 'bundle' | 'video' | 'pdf' | 'audio';

type FileNode = Pick<NodeRow, 'type' | 'sha256' | 'mime' | 'size' | 'name'>;

interface Size {
  width: number | null;
  height: number | null;
}

interface Job {
  sha: string;
  size: number;
  name: string;
  type: string;
  source: PreviewSource;
}

export function previewSource(name: string, type: string | null, blob?: Pick<BlobRow, 'meta'> | null): PreviewSource | null {
  const value = type ?? '';
  if (canThumb(value)) return 'image';
  if (isRaw(value)) return 'raw';
  if (isHeif(value)) return 'heif';
  if (canFrame(value)) return tools.ffmpeg ? 'frame' : null;
  if (value.startsWith('video/')) return tools.ffmpeg ? 'video' : null;
  if (value === 'application/pdf') return tools.pdftoppm ? 'pdf' : null;
  if (value.startsWith('audio/')) return metaOf(blob).cover ? 'audio' : null;
  if (hasCover(name)) return 'bundle';
  return null;
}

const large = (source: PreviewSource | null, type: string) =>
  (source === 'image' || source === 'raw' || source === 'heif' || source === 'frame' || source === 'bundle') && !isInlineImage(type);

export function previews(
  node: Pick<NodeRow, 'type' | 'name' | 'mime' | 'size'>,
  blob: Pick<BlobRow, 'meta' | 'thumb' | 'scan_status'> | undefined | null
) {
  if (node.type !== 'file' || node.size === 0 || !blob || blob.thumb === -1 || blob.scan_status === 'infected') {
    return { thumb: false, rendition: false };
  }
  const type = typeOf(node, blob);
  const source = previewSource(node.name, type, blob);
  return { thumb: source !== null, rendition: large(source, type) };
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

export function turned(image: Sharp, orientation: number) {
  if (orientation === 2) return image.flop();
  if (orientation === 3) return image.rotate(180);
  if (orientation === 4) return image.flip();
  if (orientation === 5) return image.flop().rotate(270);
  if (orientation === 6) return image.rotate(90);
  if (orientation === 7) return image.flop().rotate(90);
  if (orientation === 8) return image.rotate(270);
  return image;
}

const swapped = (orientation: number, width: number | null, height: number | null): Size =>
  orientation >= 5 ? { width: height, height: width } : { width, height };

async function load(job: Job, path: string, edge: number): Promise<{ image: Sharp; size: Size; flatten?: boolean }> {
  const none: Size = { width: null, height: null };
  if (job.source === 'image') {
    const image = sharp(path, OPTIONS);
    const meta = await image.metadata();
    return {
      image: image.autoOrient(),
      size: { width: meta.autoOrient?.width ?? meta.width ?? null, height: meta.autoOrient?.height ?? meta.height ?? null },
    };
  }
  if (job.source === 'raw') {
    const info = await rawInfo(path);
    if (!info.preview) throw new Error('no preview');
    const image = sharp(await readRange(path, info.preview.offset, info.preview.length), OPTIONS);
    const own = (await image.metadata()).orientation;
    const orientation = own ?? info.orientation;
    return { image: own ? image.autoOrient() : turned(image, orientation), size: swapped(orientation, info.width, info.height) };
  }
  if (job.source === 'frame') {
    const frame = await imageFrame(path, job.type, edge);
    return { image: sharp(frame.data, OPTIONS), size: { width: frame.width, height: frame.height } };
  }
  if (job.source === 'bundle') {
    const cover = await coverImage(path, job.name);
    if (!cover) throw new Error('no preview');
    return { image: sharp(cover, OPTIONS).autoOrient(), size: none };
  }
  if (job.source === 'video') return { image: sharp(await videoFrame(path), OPTIONS), size: none };
  if (job.source === 'pdf') return { image: sharp(await pdfPage(path), OPTIONS), size: none, flatten: true };
  const tags = await parseFile(path, { skipCovers: false, duration: false });
  const picture = tags.common.picture?.[0];
  if (!picture) throw new Error('no preview');
  return { image: sharp(Buffer.from(picture.data), OPTIONS).autoOrient(), size: none };
}

async function produce(job: Job, edge: number, target: string): Promise<Size> {
  const path = blobPath(job.sha);
  const quality = edge > THUMB_EDGE ? 82 : 76;
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomId(8)}`;
  try {
    let size: Size;
    if (job.source === 'heif') {
      size = await heifToWebp(path, job.size, temp, edge, quality);
    } else {
      const loaded = await load(job, path, edge);
      let pipeline = loaded.image.resize(edge, edge, { fit: 'inside', withoutEnlargement: true });
      if (loaded.flatten) pipeline = pipeline.flatten({ background: '#ffffff' });
      await pipeline.webp({ quality, effort: edge > THUMB_EDGE ? 2 : 3 }).toFile(temp);
      size = loaded.size;
    }
    await rename(temp, target);
    return size;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function jobFor(node: FileNode) {
  if (node.type !== 'file' || !node.sha256 || node.size === 0 || node.size > MAX_INPUT) return null;
  const blob = getBlob(node.sha256);
  if (!blob || blob.thumb === -1 || blob.scan_status === 'infected') return null;
  const type = typeOf(node, blob);
  const source = previewSource(node.name, type, blob);
  if (!source) return null;
  return { blob, job: { sha: node.sha256, size: node.size, name: node.name, type, source } satisfies Job };
}

const exists = (path: string) =>
  stat(path).then(
    (info) => info.isFile(),
    () => false
  );

function once(key: string, work: () => Promise<string | null>) {
  let task = pending.get(key);
  if (!task) {
    task = slot(work).finally(() => pending.delete(key));
    pending.set(key, task);
  }
  return task;
}

export async function thumbnail(node: FileNode): Promise<string | null> {
  const found = jobFor(node);
  if (!found) return null;
  const { blob, job } = found;
  const target = thumbPath(job.sha);
  if (blob.thumb === 1 && (await exists(target))) return target;
  return once(`t:${job.sha}`, async () => {
    try {
      const size = await produce(job, THUMB_EDGE, target);
      const sized = (job.source === 'image' || job.source === 'raw' || job.source === 'heif' || job.source === 'frame') && size.width;
      if (sized) run('UPDATE blobs SET thumb = 1, width = ?, height = ? WHERE sha256 = ?', size.width, size.height, job.sha);
      else run('UPDATE blobs SET thumb = 1 WHERE sha256 = ?', job.sha);
      return target;
    } catch {
      run('UPDATE blobs SET thumb = -1 WHERE sha256 = ?', job.sha);
      await rm(target, { force: true });
      return null;
    }
  });
}

export async function rendition(node: FileNode): Promise<string | null> {
  const found = jobFor(node);
  if (!found || !large(found.job.source, found.job.type) || failed.has(found.job.sha)) return null;
  const { job } = found;
  const target = previewPath(job.sha);
  if (await exists(target)) return target;
  return once(`p:${job.sha}`, async () => {
    try {
      await produce(job, PREVIEW_EDGE, target);
      return target;
    } catch {
      if (failed.size >= 2000) failed.clear();
      failed.add(job.sha);
      return null;
    }
  });
}

export function dimensions(sha: string | null) {
  if (!sha) return null;
  const blob = getBlob(sha);
  return blob?.width && blob.height ? { width: blob.width, height: blob.height } : null;
}
