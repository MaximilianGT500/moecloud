import { rm } from 'node:fs/promises';
import type { Sharp } from 'sharp';
import { randomId } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { canThumb, isHeif, isRaw } from '../lib/mime.ts';
import { splitName } from '../lib/names.ts';
import { loadSharp } from '../lib/sharp.ts';
import { record } from './activity.ts';
import { blobPath, getBlob, tmpPath, typeOf } from './blobs.ts';
import { createDerived, writableFolder } from './derived.ts';
import { heifExif, heifToWebp } from './heif.ts';
import { ingestBuffer } from './ingest.ts';
import { canFrame, imageFrame, tools } from './media.ts';
import { assertSpace, changed, requireAccess, requireMutable, type NodeRow } from './nodes.ts';
import { rawInfo, readRange } from './raw.ts';
import { assertNotInfected } from './scan.ts';
import { turned } from './thumbs.ts';
import type { UserRow } from './users.ts';
import { writeContent } from './versions.ts';

export const OUTPUTS = ['jpeg', 'png', 'webp', 'avif'] as const;
export type Output = (typeof OUTPUTS)[number] | 'tiff';

const MAX_BYTES = 300 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const WRITABLE: Record<string, Output> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};
const EXTENSIONS: Record<Output, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', tiff: 'tif' };

export interface EditInput {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  crop: { x: number; y: number; width: number; height: number } | null;
  maxEdge: number | null;
  format: Output | 'original';
  quality: number;
  save: 'version' | 'copy';
}

interface Source {
  image: Sharp;
  width: number;
  height: number;
  exif?: Record<string, unknown>;
  cleanup: () => Promise<void>;
}

const nothing = async () => undefined;

export const editable = (type: string | null) => canThumb(type) || isRaw(type) || isHeif(type) || (canFrame(type) && Boolean(tools.ffmpeg));

async function sized(image: Sharp) {
  const meta = await image.metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw badRequest('Das Bild lässt sich nicht lesen');
  if (width * height > MAX_PIXELS) throw badRequest('Das Bild ist zu groß zum Bearbeiten');
  return { width, height };
}

async function heifTags(path: string) {
  const item = await heifExif(path).catch(() => null);
  if (!item) return undefined;
  const { default: exifr } = await import('exifr');
  const tags = (await exifr.parse(item, { pick: ['DateTimeOriginal', 'Make', 'Model'], reviveValues: false }).catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return tags ?? undefined;
}

async function load(node: NodeRow, type: string): Promise<Source> {
  const path = blobPath(node.sha256!);
  const options = { failOn: 'error', limitInputPixels: MAX_PIXELS, animated: false } as const;
  const sharp = await loadSharp();
  if (canThumb(type)) {
    const image = sharp(path, options);
    return { image: image.autoOrient(), ...(await sized(image)), cleanup: nothing };
  }
  if (isRaw(type)) {
    const info = await rawInfo(path);
    if (!info.preview) throw badRequest('Diese Rohdatei bringt kein Bild mit, das MoeCloud bearbeiten kann');
    const jpeg = await readRange(path, info.preview.offset, info.preview.length);
    const own = (await sharp(jpeg).metadata()).orientation;
    if (own || info.orientation === 1) {
      const image = sharp(jpeg, options);
      return { image: image.autoOrient(), ...(await sized(image)), cleanup: nothing };
    }
    const flat = await turned(sharp(jpeg, options), info.orientation).raw().toBuffer({ resolveWithObject: true });
    return { image: sharp(flat.data, { raw: flat.info }), width: flat.info.width, height: flat.info.height, cleanup: nothing };
  }
  if (isHeif(type)) {
    const temp = tmpPath(`edit-${randomId(12)}.tif`);
    try {
      await heifToWebp(path, node.size, temp, 65_535, 100);
      const image = sharp(temp, options);
      return { image, ...(await sized(image)), exif: await heifTags(path), cleanup: () => rm(temp, { force: true }) };
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
  if (canFrame(type) && tools.ffmpeg) {
    const frame = await imageFrame(path, type, 16_384);
    const image = sharp(frame.data, options);
    return { image, ...(await sized(image)), cleanup: nothing };
  }
  throw badRequest('Dieses Bildformat kann MoeCloud nicht bearbeiten');
}

function encode(image: Sharp, format: Output, quality: number) {
  if (format === 'jpeg') return image.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
  if (format === 'png') return image.png({ compressionLevel: 8 });
  if (format === 'webp') return image.webp({ quality });
  if (format === 'avif') return image.avif({ quality, effort: 4 });
  return image.tiff({ compression: 'lzw' });
}

export function editedName(name: string, format: Output, original: Output | null, template: string) {
  const [base, ext] = splitName(name);
  const extension = format === original && ext ? ext.slice(1) : EXTENSIONS[format];
  return `${template.replace('{name}', base)}.${extension}`;
}

export async function editImage(user: UserRow, nodeId: string, input: EditInput, suffix: string) {
  const { node } = requireAccess(user, nodeId);
  if (node.type !== 'file' || !node.sha256) throw badRequest('Bearbeiten geht nur mit Bildern');
  assertNotInfected(node.sha256);
  if (node.size > MAX_BYTES) throw badRequest('Das Bild ist zu groß zum Bearbeiten');
  const type = typeOf(node, getBlob(node.sha256));
  if (!editable(type)) throw badRequest('Dieses Bildformat kann MoeCloud nicht bearbeiten');
  const original = WRITABLE[type] ?? null;
  const format = input.format === 'original' ? original : input.format;
  if (!format) throw badRequest('Wähle ein Format zum Speichern');
  if (input.save === 'version') {
    if (format !== original) throw badRequest('Eine neue Version geht nur im selben Format. Speichere stattdessen eine Kopie');
    requireMutable(user, node.id);
  }
  const target = input.save === 'copy' ? writableFolder(user, node.parent_id) : null;
  const source = await load(node, type);
  let output: Buffer;
  try {
    const swap = input.rotate === 90 || input.rotate === 270;
    let image = source.image;
    if (swap ? input.flipH : input.flipV) image = image.flip();
    if (swap ? input.flipV : input.flipH) image = image.flop();
    if (input.rotate) image = image.rotate(input.rotate);
    const width = swap ? source.height : source.width;
    const height = swap ? source.width : source.height;
    if (input.crop) {
      const left = Math.min(width - 1, Math.max(0, Math.round(input.crop.x * width)));
      const top = Math.min(height - 1, Math.max(0, Math.round(input.crop.y * height)));
      const region = {
        left,
        top,
        width: Math.max(1, Math.min(width - left, Math.round(input.crop.width * width))),
        height: Math.max(1, Math.min(height - top, Math.round(input.crop.height * height))),
      };
      if (region.width !== width || region.height !== height) image = image.extract(region);
    }
    if (input.maxEdge) image = image.resize(input.maxEdge, input.maxEdge, { fit: 'inside', withoutEnlargement: true });
    image = image.withMetadata({ orientation: 1 });
    if (source.exif) {
      const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : undefined);
      const ifd0 = Object.fromEntries(
        [
          ['Make', text(source.exif.Make)],
          ['Model', text(source.exif.Model)],
        ].filter((entry): entry is [string, string] => Boolean(entry[1]))
      );
      const taken = text(source.exif.DateTimeOriginal);
      image = image.withExif({ IFD0: ifd0, ...(taken ? { IFD2: { DateTimeOriginal: taken } } : {}) });
    }
    output = await encode(image, format, input.quality).toBuffer();
  } finally {
    await source.cleanup();
  }
  if (input.save === 'version') {
    assertSpace(node.owner_id, output.length - node.size, user.id);
    const sha256 = await ingestBuffer(output, { userId: user.id, name: node.name, via: 'editor' });
    const updated = writeContent(node, { sha256, size: output.length }, user.id);
    record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'edit', name: node.name });
    changed([node.parent_id]);
    return updated;
  }
  return createDerived(user, target!, editedName(node.name, format, original, suffix), output);
}
