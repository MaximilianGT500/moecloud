import { posix } from 'node:path';
import type { Entry, ZipFile } from 'yauzl';
import { extensionOf } from '../lib/mime.ts';
import { entryStream, openZip, safePath } from './archive.ts';

const MAX_ENTRIES = 20_000;
const MAX_IMAGE = 64 * 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;

const OPEN_DOCUMENT = ['Thumbnails/thumbnail.png'];
const OFFICE = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png'];
const IWORK = ['preview.jpg', 'QuickLook/Thumbnail.jpg', 'QuickLook/Thumbnail.png'];
const PAGES = /\.(jpe?g|png|webp|gif|avif)$/i;

const COVERS: Record<string, string[]> = {
  odt: OPEN_DOCUMENT,
  ods: OPEN_DOCUMENT,
  odp: OPEN_DOCUMENT,
  odg: OPEN_DOCUMENT,
  ott: OPEN_DOCUMENT,
  ots: OPEN_DOCUMENT,
  otp: OPEN_DOCUMENT,
  otg: OPEN_DOCUMENT,
  docx: OFFICE,
  xlsx: OFFICE,
  pptx: OFFICE,
  ppsx: OFFICE,
  dotx: OFFICE,
  xltx: OFFICE,
  potx: OFFICE,
  pages: IWORK,
  numbers: IWORK,
  key: IWORK,
  kra: ['mergedimage.png', 'preview.png'],
  ora: ['mergedimage.png', 'Thumbnails/thumbnail.png'],
  xmind: ['Thumbnails/thumbnail.png'],
  sketch: ['previews/preview.png'],
  procreate: ['QuickLook/Thumbnail.png'],
  fig: ['thumbnail.png'],
  ggb: ['geogebra_thumbnail.png'],
  '3mf': ['Metadata/thumbnail.png', 'Metadata/thumbnail.jpg', 'Metadata/thumbnail.jpeg'],
  epub: [],
  cbz: [],
};

export const hasCover = (name: string) => Object.hasOwn(COVERS, extensionOf(name));

function list(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, Entry>();
    zip.on('entry', (entry: Entry) => {
      if (safePath(entry.fileName) && !entry.fileName.endsWith('/')) found.set(entry.fileName, entry);
      if (found.size >= MAX_ENTRIES) resolve(found);
      else zip.readEntry();
    });
    zip.once('end', () => resolve(found));
    zip.once('error', reject);
    zip.readEntry();
  });
}

async function content(zip: ZipFile, entry: Entry | undefined, limit: number) {
  if (!entry || entry.uncompressedSize === 0 || entry.uncompressedSize > limit || (entry.generalPurposeBitFlag & 1) === 1) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of await entryStream(zip, entry)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(Boolean) ?? '';

async function bookCover(zip: ZipFile, entries: Map<string, Entry>) {
  const container = (await content(zip, entries.get('META-INF/container.xml'), MAX_XML))?.toString('utf8') ?? '';
  const root = attribute(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? '', 'full-path');
  const manifest = (await content(zip, entries.get(root), MAX_XML))?.toString('utf8') ?? '';
  const items = [...manifest.matchAll(/<item\b[^>]*>/gi)].map((match) => ({
    id: attribute(match[0], 'id'),
    href: attribute(match[0], 'href'),
    type: attribute(match[0], 'media-type'),
    properties: attribute(match[0], 'properties'),
  }));
  const named = [...manifest.matchAll(/<meta\b[^>]*>/gi)].find((match) => attribute(match[0], 'name') === 'cover');
  const wanted = named ? attribute(named[0], 'content') : '';
  const images = items.filter((item) => item.type.startsWith('image/'));
  const cover =
    images.find((item) => item.properties.split(/\s+/).includes('cover-image')) ??
    images.find((item) => item.id === wanted) ??
    images.find((item) => /cover/i.test(item.id) || /cover/i.test(item.href));
  if (!cover) return null;
  let href = cover.href;
  try {
    href = decodeURIComponent(href);
  } catch {}
  return content(zip, entries.get(posix.join(posix.dirname(root), href)), MAX_IMAGE);
}

export async function coverImage(path: string, name: string): Promise<Buffer | null> {
  const ext = extensionOf(name);
  const zip = await openZip(path);
  try {
    const entries = await list(zip);
    if (ext === 'epub') return await bookCover(zip, entries);
    if (ext === 'cbz') {
      const first = [...entries.keys()].filter((entry) => PAGES.test(entry)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0];
      return await content(zip, entries.get(first), MAX_IMAGE);
    }
    for (const candidate of COVERS[ext] ?? []) {
      const image = await content(zip, entries.get(candidate), MAX_IMAGE);
      if (image) return image;
    }
    return null;
  } finally {
    zip.close();
  }
}
