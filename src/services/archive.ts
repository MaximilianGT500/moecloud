import type { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { badRequest, notFound } from '../lib/errors.ts';

const MAX_ENTRIES = 5000;

function open(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error || !zipfile) reject(error ?? new Error('zip'));
      else resolve(zipfile);
    });
  });
}

function each(zip: ZipFile, visit: (entry: Entry) => Promise<boolean | void> | boolean | void): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      Promise.resolve(visit(entry))
        .then((stop) => {
          if (stop) {
            zip.close();
            resolve();
          } else zip.readEntry();
        })
        .catch((error) => {
          zip.close();
          reject(error);
        });
    });
    zip.once('end', () => {
      zip.close();
      resolve();
    });
    zip.once('error', (error) => {
      zip.close();
      reject(error);
    });
    zip.readEntry();
  });
}

function stream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, readable) => {
      if (error || !readable) reject(error ?? new Error('stream'));
      else resolve(readable);
    });
  });
}

const safePath = (name: string) => !name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\');

export interface ArchiveEntry {
  path: string;
  size: number;
  compressed: number;
  modified: number;
  folder: boolean;
  encrypted: boolean;
}

export async function listArchive(path: string) {
  let zip: ZipFile;
  try {
    zip = await open(path);
  } catch {
    throw badRequest('Das Archiv lässt sich nicht lesen');
  }
  const entries: ArchiveEntry[] = [];
  let truncated = false;
  await each(zip, (entry) => {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      return true;
    }
    if (!safePath(entry.fileName)) return false;
    entries.push({
      path: entry.fileName,
      size: entry.uncompressedSize,
      compressed: entry.compressedSize,
      modified: entry.getLastModDate().getTime(),
      folder: entry.fileName.endsWith('/'),
      encrypted: (entry.generalPurposeBitFlag & 1) === 1,
    });
    return false;
  }).catch(() => {
    throw badRequest('Das Archiv lässt sich nicht lesen');
  });
  return { entries, truncated, total: zip.entryCount };
}

export async function openEntry(path: string, name: string, maxBytes: number) {
  if (!safePath(name) || name.endsWith('/')) throw notFound('Diese Datei gibt es im Archiv nicht');
  const zip = await open(path).catch(() => {
    throw badRequest('Das Archiv lässt sich nicht lesen');
  });
  const entry = await new Promise<Entry | null>((resolve, reject) => {
    zip.on('entry', (candidate: Entry) => {
      if (candidate.fileName === name) resolve(candidate);
      else zip.readEntry();
    });
    zip.once('end', () => resolve(null));
    zip.once('error', reject);
    zip.readEntry();
  }).catch(() => null);
  const fail = (error: Error) => {
    zip.close();
    return error;
  };
  if (!entry) throw fail(notFound('Diese Datei gibt es im Archiv nicht'));
  if ((entry.generalPurposeBitFlag & 1) === 1) throw fail(badRequest('Diese Datei ist verschlüsselt'));
  if (entry.uncompressedSize > maxBytes) throw fail(badRequest('Diese Datei ist zu groß, lade das ganze Archiv herunter'));
  const readable = await stream(zip, entry).catch((error: Error) => {
    throw fail(error);
  });
  const close = () => zip.close();
  readable.once('end', close);
  readable.once('close', close);
  readable.once('error', close);
  return { stream: readable, size: entry.uncompressedSize, modified: entry.getLastModDate().getTime() };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : '';
    }
    return ENTITIES[code] ?? match;
  });

export function xmlToText(xml: string) {
  return decode(
    xml
      .replace(/<\/(w:p|text:p|text:h|a:p|si|row)>/g, '\n')
      .replace(/<(w:tab|text:tab|w:br|text:line-break)[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DOCUMENT_PARTS = /^(word\/document\.xml|content\.xml|ppt\/slides\/slide\d+\.xml|xl\/sharedStrings\.xml)$/;

export async function documentText(path: string, limit = 1024 * 1024) {
  const zip = await open(path);
  const parts: string[] = [];
  let total = 0;
  await each(zip, async (entry) => {
    if (!DOCUMENT_PARTS.test(entry.fileName) || entry.uncompressedSize > 16 * 1024 * 1024) return false;
    const readable = await stream(zip, entry);
    const chunks: Buffer[] = [];
    for await (const chunk of readable) chunks.push(chunk as Buffer);
    const text = xmlToText(Buffer.concat(chunks).toString('utf8'));
    parts.push(text);
    total += text.length;
    return total >= limit;
  });
  return parts.join('\n\n').slice(0, limit);
}
