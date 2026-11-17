import { posix } from 'node:path';
import { badRequest, notFound } from '../lib/errors.ts';
import { openEntry } from './archive.ts';

const MAX_XML = 4 * 1024 * 1024;
const MAX_CHAPTERS = 2000;

export interface EpubInfo {
  title: string | null;
  author: string | null;
  chapters: { title: string | null; path: string }[];
}

const TYPES: Record<string, string> = {
  xhtml: 'application/xhtml+xml',
  xml: 'application/xhtml+xml',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
};

export const epubType = (path: string) => TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export const EPUB_CSP =
  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

async function text(file: string, name: string) {
  const entry = await openEntry(file, name, MAX_XML);
  const chunks: Buffer[] = [];
  for await (const chunk of entry.stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (value: string) =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
      }
      return ENTITIES[code] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined);

function resolve(base: string, href: string) {
  let path = href.split('#')[0];
  try {
    path = decodeURIComponent(path);
  } catch {}
  return posix.normalize(posix.join(posix.dirname(base), path)).replace(/^(\.\.\/)+/, '');
}

function titlesFrom(xml: string, file: string) {
  const titles = new Map<string, string>();
  const add = (href: string | undefined, label: string) => {
    if (!href || !label) return;
    const path = resolve(file, href);
    if (!titles.has(path)) titles.set(path, label.slice(0, 200));
  };
  if (/<ncx[\s>]/i.test(xml)) {
    for (const point of xml.matchAll(/<navPoint[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\s[^>]*>/gi)) {
      add(attribute(point[0].slice(point[0].lastIndexOf('<content')), 'src'), decode(point[1]));
    }
    return titles;
  }
  const nav = /<nav\b[^>]*(?:epub:type|role)\s*=\s*["'][^"']*(?:toc|doc-toc)[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(xml)?.[1] ?? xml;
  for (const link of nav.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi)) add(attribute(link[0], 'href'), decode(link[1]));
  return titles;
}

export async function epubInfo(file: string): Promise<EpubInfo> {
  let container: string;
  try {
    container = await text(file, 'META-INF/container.xml');
  } catch {
    throw badRequest('Das E-Book lässt sich nicht lesen');
  }
  const rootTag = /<rootfile\s[^>]*>/i.exec(container)?.[0];
  const opfPath = rootTag ? attribute(rootTag, 'full-path') : undefined;
  if (!opfPath) throw badRequest('Das E-Book lässt sich nicht lesen');
  const opf = await text(file, opfPath).catch(() => {
    throw badRequest('Das E-Book lässt sich nicht lesen');
  });
  const manifest = new Map<string, { href: string; type: string; properties: string }>();
  for (const item of opf.matchAll(/<item\s[^>]*>/gi)) {
    const id = attribute(item[0], 'id');
    const href = attribute(item[0], 'href');
    if (id && href) {
      manifest.set(id, { href, type: attribute(item[0], 'media-type') ?? '', properties: attribute(item[0], 'properties') ?? '' });
    }
  }
  const spineTag = /<spine\b[^>]*>/i.exec(opf)?.[0] ?? '';
  const tocItem =
    [...manifest.values()].find((item) => /\bnav\b/.test(item.properties)) ??
    manifest.get(attribute(spineTag, 'toc') ?? '') ??
    [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml');
  let titles = new Map<string, string>();
  if (tocItem) {
    const tocPath = resolve(opfPath, tocItem.href);
    titles = await text(file, tocPath)
      .then((xml) => titlesFrom(xml, tocPath))
      .catch(() => new Map());
  }
  const chapters: EpubInfo['chapters'] = [];
  for (const ref of opf.matchAll(/<itemref\s[^>]*>/gi)) {
    const item = manifest.get(attribute(ref[0], 'idref') ?? '');
    if (!item || !/x?html|xml/i.test(item.type || item.href)) continue;
    const path = resolve(opfPath, item.href);
    chapters.push({ title: titles.get(path) ?? null, path });
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  if (chapters.length === 0) throw badRequest('Das E-Book hat keine Kapitel, die MoeCloud anzeigen kann');
  const meta = (name: string) => {
    const match = new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i').exec(opf);
    return match ? decode(match[1]).slice(0, 300) || null : null;
  };
  return { title: meta('title'), author: meta('creator'), chapters };
}

export async function epubFile(file: string, path: string) {
  let name = path;
  try {
    name = decodeURIComponent(path);
  } catch {}
  if (!name || name.startsWith('META-INF/')) throw notFound('Diese Datei gibt es im E-Book nicht');
  const entry = await openEntry(file, name, 64 * 1024 * 1024).catch(() => {
    throw notFound('Diese Datei gibt es im E-Book nicht');
  });
  return { ...entry, type: epubType(name) };
}
