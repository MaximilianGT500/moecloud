import { createReadStream } from 'node:fs';
import { open, stat, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { HttpError, badRequest, notFound } from '../lib/errors.ts';
import { safePath, type ArchiveEntry } from './archive.ts';

export const TAR_NAMES = /\.(tar|tar\.gz|tgz|gz)$/i;
const TAR_TYPES = new Set([
  'application/x-tar',
  'application/x-gtar',
  'application/gzip',
  'application/x-gzip',
  'application/x-compressed-tar',
]);
const BLOCK = 512;
const CHUNK = 1024 * 1024;
const META_LIMIT = 256 * 1024;
const MAX_HEADERS = 100_000;
const MAX_LIST = 5000;
const LIST_BUDGET = 1024 * 1024 * 1024;
const NO_DATA = new Set(['1', '2', '3', '4', '5', '6']);
const META = new Set(['L', 'K', 'x', 'X', 'g']);

export type TarKind = 'file' | 'folder' | 'hardlink' | 'symlink' | 'other';

export interface TarEntry {
  index: number;
  name: string;
  size: number;
  modified: number;
  kind: TarKind;
  link: string | null;
  body: () => Readable;
}

export class TarLimitError extends Error {}

interface Left {
  left: number;
}

interface Source {
  read(size: number): Promise<Buffer | null>;
  take(state: Left): Promise<Buffer | null>;
  skip(state: Left): Promise<void>;
  close(): Promise<void>;
}

export const isTarLike = (node: { name: string; mime: string | null }) => TAR_NAMES.test(node.name) || TAR_TYPES.has(node.mime ?? '');

export const unreadable = () => badRequest('Das Archiv lässt sich nicht lesen');

class Serial {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

class StreamSource implements Source {
  private iterator: AsyncIterator<Buffer>;
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;
  private serial = new Serial();
  private consumed = 0;
  private stream: Readable;
  private limit: number;

  constructor(stream: Readable, limit: number) {
    this.stream = stream;
    this.limit = limit;
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(min: number) {
    while (this.buffer.length < min && !this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      this.consumed += chunk.length;
      if (this.consumed > this.limit) throw new TarLimitError();
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    }
  }

  read(size: number) {
    return this.serial.run(async () => {
      await this.fill(size);
      if (this.buffer.length < size) {
        if (!this.buffer.length) return null;
        throw unreadable();
      }
      const out = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return out;
    });
  }

  take(state: Left) {
    return this.serial.run(async () => {
      if (state.left <= 0) return null;
      if (!this.buffer.length) await this.fill(1);
      if (!this.buffer.length) throw unreadable();
      const size = Math.min(CHUNK, state.left, this.buffer.length);
      const out = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      state.left -= size;
      return out;
    });
  }

  async skip(state: Left) {
    while ((await this.take(state)) !== null);
  }

  async close() {
    await this.iterator.return?.().catch(() => undefined);
    this.stream.destroy();
  }
}

class FileSource implements Source {
  private position = 0;
  private serial = new Serial();
  private handle: FileHandle;
  private size: number;

  constructor(handle: FileHandle, size: number) {
    this.handle = handle;
    this.size = size;
  }

  read(size: number) {
    return this.serial.run(async () => {
      if (size > 0 && this.position >= this.size) return null;
      if (this.position + size > this.size) throw unreadable();
      const out = Buffer.alloc(size);
      const { bytesRead } = await this.handle.read(out, 0, size, this.position);
      if (bytesRead < size) throw unreadable();
      this.position += size;
      return out;
    });
  }

  take(state: Left) {
    return this.serial.run(async () => {
      if (state.left <= 0) return null;
      const size = Math.min(CHUNK, state.left);
      if (this.position + size > this.size) throw unreadable();
      const out = Buffer.allocUnsafe(size);
      const { bytesRead } = await this.handle.read(out, 0, size, this.position);
      if (bytesRead < size) throw unreadable();
      this.position += size;
      state.left -= size;
      return out;
    });
  }

  skip(state: Left) {
    return this.serial.run(async () => {
      if (this.position + state.left > this.size) throw unreadable();
      this.position += state.left;
      state.left = 0;
    });
  }

  close() {
    return this.handle.close().catch(() => undefined);
  }
}

async function isGzip(path: string) {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(2);
    const { bytesRead } = await handle.read(head, 0, 2, 0);
    return bytesRead === 2 && head[0] === 0x1f && head[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

export function gunzip(path: string) {
  const file = createReadStream(path);
  const inflate = createGunzip();
  file.on('error', (error) => inflate.destroy(error));
  inflate.on('close', () => file.destroy());
  return file.pipe(inflate) as Readable;
}

export async function openSource(path: string, limit = Number.MAX_SAFE_INTEGER): Promise<Source> {
  if (await isGzip(path)) return new StreamSource(gunzip(path), limit);
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  return new FileSource(handle, size);
}

export async function scanLimit(path: string) {
  const { size } = await stat(path);
  return Math.max(size * 50, 16 * 1024 * 1024 * 1024);
}

const text = (block: Buffer, start: number, length: number) => {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8');
};

function number(block: Buffer, start: number, length: number) {
  const field = block.subarray(start, start + length);
  if (field[0] === 0xff) return -1;
  if (field[0] & 0x80) {
    let value = field[0] & 0x7f;
    for (let index = 1; index < field.length; index++) {
      value = value * 256 + field[index];
      if (value > Number.MAX_SAFE_INTEGER) throw unreadable();
    }
    return value;
  }
  const raw = text(block, start, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw unreadable();
  const value = parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) throw unreadable();
  return value;
}

const isEmpty = (block: Buffer) => block.every((byte) => byte === 0);

export function isTarHeader(block: Buffer) {
  if (block.length < BLOCK) return false;
  const stored = text(block, 148, 8).trim();
  if (!/^[0-7]{1,8}$/.test(stored)) return false;
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK; index++) {
    const byte = index >= 148 && index < 156 ? 32 : block[index];
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  const value = parseInt(stored, 8);
  return value === unsigned || value === signed;
}

function parsePax(data: Buffer) {
  const values: Record<string, string> = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    if (space === -1) break;
    const length = Number(data.subarray(offset, space).toString('ascii'));
    if (!Number.isInteger(length) || length <= space - offset || offset + length > data.length) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

const padded = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

const sparse = (meta: Record<string, string>) =>
  ['GNU.sparse.major', 'GNU.sparse.map', 'GNU.sparse.numblocks', 'GNU.sparse.size', 'GNU.sparse.realsize'].some((key) => key in meta);

const normalize = (name: string) => name.replace(/^(?:\.?\/)+/, '');

export async function detect(path: string): Promise<'tar' | 'gzip'> {
  const gzip = await isGzip(path);
  const source = await openSource(path);
  try {
    const first = await source.read(BLOCK).catch(() => null);
    if (first && (isTarHeader(first) || isEmpty(first))) return 'tar';
    if (gzip) return 'gzip';
    throw unreadable();
  } finally {
    await source.close();
  }
}

export async function* tarEntries(source: Source): AsyncGenerator<TarEntry> {
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = Object.create(null);
  let global: Record<string, string> = Object.create(null);
  let zeros = 0;
  let headers = 0;
  let metaRun = 0;
  let index = 0;
  const chunks = async function* (state: Left) {
    for (;;) {
      const chunk = await source.take(state);
      if (!chunk) return;
      yield chunk;
    }
  };
  try {
    for (;;) {
      const header = await source.read(BLOCK);
      if (!header) return;
      if (isEmpty(header)) {
        if (++zeros >= 2) return;
        continue;
      }
      zeros = 0;
      if (!isTarHeader(header)) throw unreadable();
      if (++headers > MAX_HEADERS) throw badRequest('Das Archiv enthält mehr als {count} Dateien', { count: MAX_HEADERS });
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
      let size = number(header, 124, 12);
      if (size < 0) throw unreadable();
      if (META.has(type)) {
        if (++metaRun > 8) throw unreadable();
        const state = { left: size };
        if (size > META_LIMIT) {
          await source.skip(state);
        } else {
          const data = await source.read(size + padded(size));
          if (!data) throw unreadable();
          const content = data.subarray(0, size);
          if (type === 'L') longName = text(content, 0, content.length);
          else if (type === 'K') longLink = text(content, 0, content.length);
          else if (type === 'x' || type === 'X') pax = parsePax(content);
          else if (type === 'g') global = { ...global, ...parsePax(content) };
          continue;
        }
        if (padded(size) && !(await source.read(padded(size)))) throw unreadable();
        continue;
      }
      metaRun = 0;
      if (type === 'S' && header[482]) {
        for (;;) {
          const extension = await source.read(BLOCK);
          if (!extension) throw unreadable();
          if (!extension[504]) break;
        }
      }
      const meta = { ...global, ...pax };
      if (meta.size !== undefined) {
        const declared = Number(meta.size);
        if (!Number.isSafeInteger(declared) || declared < 0) throw unreadable();
        size = declared;
      }
      const magic = text(header, 257, 6);
      const prefix = magic.startsWith('ustar') ? text(header, 345, 155) : '';
      const base = text(header, 0, 100);
      const name = normalize(meta.path ?? longName ?? (prefix ? `${prefix}/${base}` : base));
      const seconds = meta.mtime !== undefined ? Number(meta.mtime) : number(header, 136, 12);
      const link = type === '1' || type === '2' ? normalize(meta.linkpath ?? longLink ?? text(header, 157, 100)) : null;
      longName = null;
      longLink = null;
      pax = Object.create(null);
      const dataSize = NO_DATA.has(type) ? 0 : size;
      let kind: TarKind =
        type === '0' || type === '7'
          ? name.endsWith('/')
            ? 'folder'
            : 'file'
          : type === '5' || type === 'D'
            ? 'folder'
            : type === '1'
              ? 'hardlink'
              : type === '2'
                ? 'symlink'
                : 'other';
      if (kind === 'file' && sparse(meta)) kind = 'other';
      const state = { left: dataSize };
      const clean = name.replace(/\/+$/, '');
      if (!(kind === 'folder' && (!clean || clean === '.'))) {
        yield {
          index: index++,
          name: kind === 'folder' ? `${clean}/` : name,
          size: kind === 'file' ? dataSize : 0,
          modified: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : Date.now(),
          kind,
          link,
          body: () => Readable.from(chunks(state), { objectMode: false }),
        };
      }
      await source.skip(state);
      if (padded(dataSize) && !(await source.read(padded(dataSize)))) throw unreadable();
    }
  } finally {
    await source.close();
  }
}

export const gzipInnerName = (name: string) =>
  name
    .replace(/\.gz$/i, '')
    .replace(/\.tgz$/i, '.tar')
    .trim() || 'datei';

async function gzipSize(path: string) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 18) return 0;
    const tail = Buffer.alloc(4);
    await handle.read(tail, 0, 4, size - 4);
    return tail.readUInt32LE(0);
  } finally {
    await handle.close();
  }
}

const fail = (error: unknown) => (error instanceof HttpError ? error : unreadable());

export async function listTar(path: string, name: string, modified: number) {
  const format = await detect(path).catch((error: unknown) => {
    throw fail(error);
  });
  if (format === 'gzip') {
    const entry: ArchiveEntry = {
      path: gzipInnerName(name),
      size: await gzipSize(path),
      compressed: (await stat(path)).size,
      modified,
      folder: false,
      encrypted: false,
    };
    return { entries: [entry], truncated: false, total: 1 };
  }
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let truncated = false;
  try {
    for await (const entry of tarEntries(await openSource(path, LIST_BUDGET))) {
      if ((entry.kind !== 'file' && entry.kind !== 'folder') || !safePath(entry.name) || seen.has(entry.name)) continue;
      if (entries.length >= MAX_LIST) {
        truncated = true;
        break;
      }
      seen.add(entry.name);
      entries.push({
        path: entry.name,
        size: entry.size,
        compressed: 0,
        modified: entry.modified,
        folder: entry.kind === 'folder',
        encrypted: false,
      });
    }
  } catch (error) {
    if (!(error instanceof TarLimitError)) throw fail(error);
    truncated = true;
  }
  return { entries, truncated, total: entries.length };
}

export async function openTarEntry(path: string, archiveName: string, name: string, maxBytes: number) {
  if (!safePath(name) || name.endsWith('/')) throw notFound('Diese Datei gibt es im Archiv nicht');
  const format = await detect(path).catch((error: unknown) => {
    throw fail(error);
  });
  if (format === 'gzip') {
    if (name !== gzipInnerName(archiveName)) throw notFound('Diese Datei gibt es im Archiv nicht');
    return { stream: gunzip(path), size: null, modified: null };
  }
  const iterator = tarEntries(await openSource(path, await scanLimit(path)));
  const finish = () => {
    void iterator.return(undefined).catch(() => undefined);
  };
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const entry = next.value;
      if (entry.kind !== 'file' || entry.name !== name) continue;
      if (entry.size > maxBytes) throw badRequest('Diese Datei ist zu groß, lade das ganze Archiv herunter');
      const stream = entry.body();
      stream.once('end', finish);
      stream.once('close', finish);
      stream.once('error', finish);
      return { stream, size: entry.size, modified: entry.modified };
    }
  } catch (error) {
    finish();
    throw fail(error);
  }
  finish();
  throw notFound('Diese Datei gibt es im Archiv nicht');
}
