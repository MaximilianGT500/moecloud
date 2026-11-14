import type { FormatEnum } from 'sharp';
import { badRequest } from '../lib/errors.ts';
import { loadSharp } from '../lib/sharp.ts';
import { record } from './activity.ts';
import { blobPath, getBlob, typeOf } from './blobs.ts';
import { ingestBuffer } from './ingest.ts';
import { assertSpace, changed, type NodeRow } from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import type { UserRow } from './users.ts';
import { writeContent } from './versions.ts';

const MAX_BYTES = 100 * 1024 * 1024;
const FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff']);
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff']);

export async function rotateImage(user: UserRow, node: NodeRow, degrees: 90 | 180 | 270) {
  if (node.type !== 'file' || !node.sha256) throw badRequest('Drehen geht nur mit Bildern');
  assertNotInfected(node.sha256);
  if (!TYPES.has(typeOf(node, getBlob(node.sha256)))) throw badRequest('Dieses Bildformat kann MoeCloud nicht drehen');
  if (node.size > MAX_BYTES) throw badRequest('Das Bild ist zu groß zum Drehen');
  const sharp = await loadSharp();
  const source = sharp(blobPath(node.sha256), { failOn: 'error' });
  const meta = await source.metadata().catch(() => null);
  if (!meta?.format || !FORMATS.has(meta.format) || (meta.pages ?? 1) > 1) {
    throw badRequest('Dieses Bildformat kann MoeCloud nicht drehen');
  }
  const output = await source
    .rotate()
    .rotate(degrees)
    .withMetadata({ orientation: 1 })
    .toFormat(meta.format as keyof FormatEnum, meta.format === 'jpeg' ? { quality: 92, mozjpeg: true } : { quality: 92 })
    .toBuffer();
  assertSpace(node.owner_id, output.length - node.size, user.id);
  const sha256 = await ingestBuffer(output, { userId: user.id, name: node.name, via: 'editor' });
  const updated = writeContent(node, { sha256, size: output.length }, user.id);
  record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'rotate', name: node.name });
  changed([node.parent_id]);
  return updated;
}
