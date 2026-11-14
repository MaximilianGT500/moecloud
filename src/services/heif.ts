import { fileURLToPath } from 'node:url';
import { execute } from './media.ts';
import { readRange } from './raw.ts';

const CHILD = fileURLToPath(new URL('./heif-child.ts', import.meta.url));
const MAX_BYTES = 256 * 1024 * 1024;
const HEAD = 512 * 1024;
const MAX_EXIF = 256 * 1024;

let queue: Promise<unknown> = Promise.resolve();

export function heifToWebp(input: string, size: number, output: string, edge: number, quality: number) {
  const job = queue.then(async () => {
    if (size > MAX_BYTES) throw new Error('Die Datei ist zu groß');
    const result = await execute(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', CHILD, input, output, String(edge), String(quality)],
      { timeout: 120_000, maxBytes: 4096 }
    );
    const { width, height } = JSON.parse(result.toString('utf8')) as { width: number; height: number };
    return { width, height };
  });
  queue = job.catch(() => undefined);
  return job;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(data: Buffer, start: number, end: number) {
  const found: Box[] = [];
  for (let at = start; at + 8 <= end;) {
    const size = data.readUInt32BE(at);
    if (size < 8) break;
    found.push({ type: data.toString('latin1', at + 4, at + 8), start: at + 8, end: Math.min(at + size, end) });
    at += size;
  }
  return found;
}

function uint(data: Buffer, at: number, bytes: number) {
  if (bytes <= 0 || at + bytes > data.length) return 0;
  return bytes === 8 ? data.readUInt32BE(at) * 2 ** 32 + data.readUInt32BE(at + 4) : data.readUIntBE(at, Math.min(bytes, 6));
}

function exifItem(data: Buffer, list: Box) {
  const version = data[list.start];
  const first = list.start + 4 + (version === 0 ? 2 : 4);
  for (const entry of boxes(data, first, list.end)) {
    if (entry.type !== 'infe') continue;
    const wide = data[entry.start] >= 3;
    const type = entry.start + 4 + (wide ? 4 : 2) + 2;
    if (data[entry.start] >= 2 && data.toString('latin1', type, type + 4) === 'Exif') return uint(data, entry.start + 4, wide ? 4 : 2);
  }
  return 0;
}

function location(data: Buffer, table: Box, wanted: number) {
  const version = data[table.start];
  const offsetSize = data[table.start + 4] >> 4;
  const lengthSize = data[table.start + 4] & 15;
  const baseSize = data[table.start + 5] >> 4;
  const indexSize = version > 0 ? data[table.start + 5] & 15 : 0;
  const idSize = version < 2 ? 2 : 4;
  const count = uint(data, table.start + 6, idSize);
  let at = table.start + 6 + idSize;
  for (let item = 0; item < count && at + idSize <= table.end; item++) {
    const id = uint(data, at, idSize);
    at += idSize;
    const method = version > 0 ? uint(data, at, 2) & 15 : 0;
    at += (version > 0 ? 2 : 0) + 2;
    const base = uint(data, at, baseSize);
    at += baseSize;
    const extents = uint(data, at, 2);
    at += 2;
    if (id === wanted && extents > 0 && method === 0) {
      return { offset: base + uint(data, at + indexSize, offsetSize), length: uint(data, at + indexSize + offsetSize, lengthSize) };
    }
    at += extents * (indexSize + offsetSize + lengthSize);
  }
  return null;
}

export async function heifExifRange(path: string): Promise<{ offset: number; length: number } | null> {
  const data = await readRange(path, 0, HEAD);
  const meta = boxes(data, 0, data.length).find((box) => box.type === 'meta');
  if (!meta) return null;
  const inner = boxes(data, meta.start + 4, meta.end);
  const list = inner.find((box) => box.type === 'iinf');
  const table = inner.find((box) => box.type === 'iloc');
  const id = list ? exifItem(data, list) : 0;
  const found = table && id ? location(data, table, id) : null;
  if (!found || found.length < 12) return null;
  const head = await readRange(path, found.offset, 4);
  const skip = head.length === 4 ? 4 + head.readUInt32BE(0) : 0;
  return skip > 0 && skip < found.length ? { offset: found.offset + skip, length: found.length - skip } : null;
}

export async function heifExif(path: string): Promise<Buffer | null> {
  const range = await heifExifRange(path);
  return range ? readRange(path, range.offset, Math.min(range.length, MAX_EXIF)) : null;
}
