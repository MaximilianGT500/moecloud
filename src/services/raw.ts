import { open, type FileHandle } from 'node:fs/promises';

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4, 0, 0, 8, 8, 8];
const MAX_IFDS = 64;
const MAX_ENTRIES = 512;
const MAX_DEPTH = 3;
const MAX_OFFSETS = 4096;
const MAX_MARKERS = 256;
const MAX_HITS = 512;
const MAX_JPEG = 64 * 1024 * 1024;
const SCAN_BYTES = 512 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const ENOUGH = 1600;
const PLENTY = 2560;
const PREVIEW_KINDS = new Set([0, 1, 65537]);
const SOI = Buffer.from([0xff, 0xd8, 0xff]);

interface Reader {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

interface Entry {
  type: number;
  count: number;
  bytes: number;
  at: number;
}

interface Tiff {
  magic: number;
  ifds: Map<number, Entry>[];
  values(entry: Entry | undefined, max?: number): Promise<number[]>;
}

interface Candidate extends Embedded {
  components: number;
}

export interface Embedded {
  offset: number;
  length: number;
  width: number;
  height: number;
}

export interface RawInfo {
  preview: Embedded | null;
  orientation: number;
  width: number | null;
  height: number | null;
}

function reader(handle: FileHandle, size: number): Reader {
  return {
    size,
    async read(offset, length) {
      const count = Math.min(length, size - offset);
      if (!(offset >= 0) || !(count > 0)) return Buffer.alloc(0);
      const buffer = Buffer.allocUnsafe(count);
      const { bytesRead } = await handle.read(buffer, 0, count, offset);
      return buffer.subarray(0, bytesRead);
    },
  };
}

async function tiff(file: Reader, base = 0): Promise<Tiff | null> {
  const head = await file.read(base, 8);
  if (head.length < 8) return null;
  const order = head.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (buffer: Buffer, at: number) => (le ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (buffer: Buffer, at: number) => (le ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const ifds: Map<number, Entry>[] = [];
  const seen = new Set<number>();

  const values = async (entry: Entry | undefined, max = 16) => {
    const width = entry ? (TYPE_SIZE[entry.type] ?? 0) : 0;
    if (!entry || (width !== 1 && width !== 2 && width !== 4)) return [];
    const data = await file.read(base + entry.at, Math.min(entry.count, max) * width);
    const out: number[] = [];
    for (let at = 0; at + width <= data.length; at += width) out.push(width === 2 ? u16(data, at) : width === 4 ? u32(data, at) : data[at]);
    return out;
  };

  const visit = async (start: number, depth: number) => {
    let offset = start;
    while (offset > 0 && !seen.has(offset) && ifds.length < MAX_IFDS) {
      seen.add(offset);
      const size = await file.read(base + offset, 2);
      if (size.length < 2) return;
      const count = u16(size, 0);
      if (count === 0 || count > MAX_ENTRIES) return;
      const raw = await file.read(base + offset + 2, count * 12 + 4);
      if (raw.length < count * 12) return;
      const tags = new Map<number, Entry>();
      for (let index = 0; index < count; index++) {
        const at = index * 12;
        const type = u16(raw, at + 2);
        const amount = u32(raw, at + 4);
        const bytes = (TYPE_SIZE[type] ?? 0) * amount;
        tags.set(u16(raw, at), { type, count: amount, bytes, at: bytes <= 4 ? offset + 2 + at + 8 : u32(raw, at + 8) });
      }
      ifds.push(tags);
      if (depth < MAX_DEPTH) for (const sub of await values(tags.get(330))) await visit(sub, depth + 1);
      offset = raw.length >= count * 12 + 4 ? u32(raw, count * 12) : 0;
    }
  };

  await visit(u32(head, 4), 0);
  return ifds.length ? { magic: u16(head, 2), ifds, values } : null;
}

async function jpegFrame(file: Reader, start: number) {
  const first = await file.read(start, 4);
  if (first.length < 4 || first[0] !== 0xff || first[1] !== 0xd8 || first[2] !== 0xff) return null;
  let position = start + 2;
  for (let guard = 0; guard < MAX_MARKERS; guard++) {
    const head = await file.read(position, 4);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      position += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = head.readUInt16BE(2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const frame = await file.read(position + 4, 6);
      if (frame.length < 6 || marker > 0xc2 || frame[0] !== 8) return null;
      const height = frame.readUInt16BE(1);
      const width = frame.readUInt16BE(3);
      const components = frame[5];
      if (Math.min(width, height) < 32 || (components !== 1 && components !== 3)) return null;
      return { width, height, components };
    }
    position += 2 + length;
  }
  return null;
}

async function scanEnd(file: Reader, start: number, limit: number) {
  let position = start;
  while (position < limit) {
    const data = await file.read(position, Math.min(CHUNK, limit - position));
    if (data.length < 2) return -1;
    let index = 0;
    for (;;) {
      index = data.indexOf(0xff, index);
      if (index === -1 || index >= data.length - 1) break;
      const next = data[index + 1];
      if (next !== 0 && next !== 0xff && (next < 0xd0 || next > 0xd7)) return position + index;
      index += next === 0xff ? 1 : 2;
    }
    position += data.length - 1;
  }
  return -1;
}

async function jpegEnd(file: Reader, start: number) {
  const limit = Math.min(file.size, start + MAX_JPEG);
  let position = start + 2;
  for (let guard = 0; guard < MAX_MARKERS; guard++) {
    const head = await file.read(position, 4);
    if (head.length < 2 || head[0] !== 0xff) return limit;
    const marker = head[1];
    if (marker === 0xd9) return position + 2;
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      position += 2;
      continue;
    }
    if (head.length < 4) return limit;
    const length = head.readUInt16BE(2);
    if (length < 2) return limit;
    position += 2 + length;
    if (position >= limit) return limit;
    if (marker === 0xda) {
      position = await scanEnd(file, position, limit);
      if (position < 0) return limit;
    }
  }
  return limit;
}

function best(candidates: Candidate[]) {
  const colour = candidates.filter((candidate) => candidate.components === 3);
  const pool = colour.length ? colour : candidates;
  return pool.reduce<Candidate | null>(
    (top, candidate) => (!top || candidate.width * candidate.height > top.width * top.height ? candidate : top),
    null
  );
}

const longEdge = (candidate: Candidate | null) => (candidate ? Math.max(candidate.width, candidate.height) : 0);

function fullSize(candidate: Candidate, width: number, height: number) {
  const close = (inner: number, outer: number) => inner <= outer && inner >= outer * 0.9;
  return (
    close(Math.max(candidate.width, candidate.height), Math.max(width, height)) &&
    close(Math.min(candidate.width, candidate.height), Math.min(width, height))
  );
}

async function embedded(file: Reader, info: RawInfo): Promise<Candidate | null> {
  const candidates: Candidate[] = [];
  const blocked: [number, number][] = [];

  const add = async (offset: number | undefined, length = 0) => {
    if (!offset || offset >= file.size || candidates.some((candidate) => candidate.offset === offset)) return null;
    const frame = await jpegFrame(file, offset);
    if (!frame) return null;
    const known = length > 0 && offset + length <= file.size;
    const candidate = { offset, length: known ? length : 0, ...frame };
    candidates.push(candidate);
    return candidate;
  };

  const head = await file.read(0, 128);
  const parsed = await tiff(file);
  if (parsed) {
    let area = 0;
    for (const tags of parsed.ifds) {
      const number = async (tag: number) => (await parsed.values(tags.get(tag), 1))[0] as number | undefined;
      const kind = (await number(254)) ?? 0;
      const strips = tags.get(273);
      const tiles = tags.get(324);
      const isPreview = PREVIEW_KINDS.has(kind);
      if (info.orientation === 1) {
        const orientation = await number(274);
        if (orientation && orientation >= 1 && orientation <= 8) info.orientation = orientation;
      }
      if (isPreview) {
        await add(await number(513), await number(514));
        const compression = await number(259);
        if (strips?.count === 1 && (compression === 6 || compression === 7)) await add(await number(273), await number(279));
        const panasonic = tags.get(0x2e);
        if (parsed.magic === 0x55 && panasonic && panasonic.bytes > 4) await add(panasonic.at, panasonic.bytes);
      }
      if (!isPreview || tiles || (strips && strips.count > 1)) {
        const offsets = await parsed.values(tiles ?? strips, MAX_OFFSETS);
        const counts = await parsed.values(tags.get(tiles ? 325 : 279), MAX_OFFSETS);
        if (offsets.length) {
          const start = Math.min(...offsets);
          const end = Math.max(...offsets.map((offset, index) => offset + (counts[index] ?? 0)));
          blocked.push([start, end]);
        }
      }
      if (kind === 0) {
        const crop = await parsed.values(tags.get(0xc620), 2);
        const width = crop[0] ?? (await number(256));
        const height = crop[1] ?? (await number(257));
        if (width && height && width * height > area) {
          area = width * height;
          info.width = width;
          info.height = height;
        }
      }
    }
    if (parsed.magic === 0x55) {
      const tags = parsed.ifds[0];
      const [top, left, bottom, right] = await Promise.all([4, 5, 6, 7].map(async (tag) => (await parsed.values(tags.get(tag), 1))[0]));
      if (right > left && bottom > top) {
        info.width = right - left;
        info.height = bottom - top;
      }
    }
  } else if (head.toString('latin1', 0, 15) === 'FUJIFILMCCD-RAW' && head.length >= 100) {
    await add(head.readUInt32BE(84), head.readUInt32BE(88));
    const table = await file.read(head.readUInt32BE(92), Math.min(head.readUInt32BE(96), 4096));
    const count = table.length >= 4 ? Math.min(table.readUInt32BE(0), 256) : 0;
    for (let index = 0, at = 4; index < count && at + 8 <= table.length; index++) {
      const tag = table.readUInt16BE(at);
      if (tag === 0x111 || (tag === 0x100 && !info.width)) {
        info.height = table.readUInt16BE(at + 4);
        info.width = table.readUInt16BE(at + 6);
      }
      at += 4 + table.readUInt16BE(at + 2);
    }
  } else if (head.toString('latin1', 4, 12) === 'ftypcrx ') {
    const box = await file.read(0, 256 * 1024);
    const at = box.indexOf('CMT1', 0, 'latin1');
    const meta = at > 4 ? await tiff(file, at + 4) : null;
    if (meta) {
      const tags = meta.ifds[0];
      const [width, height, orientation] = await Promise.all([256, 257, 274].map(async (tag) => (await meta.values(tags.get(tag), 1))[0]));
      if (width && height) {
        info.width = width;
        info.height = height;
      }
      if (orientation >= 1 && orientation <= 8) info.orientation = orientation;
    }
  }

  let top = best(candidates);
  if (longEdge(top) >= ENOUGH) return top;

  const limit = Math.min(file.size, SCAN_BYTES);
  let hits = 0;
  for (let offset = 0; offset < limit && hits < MAX_HITS; offset += CHUNK) {
    const data = await file.read(offset, CHUNK + 2);
    let index = 0;
    while ((index = data.indexOf(SOI, index)) !== -1 && index < CHUNK && hits < MAX_HITS) {
      const at = offset + index;
      index++;
      if (blocked.some(([start, end]) => at >= start && at < end)) continue;
      hits++;
      const found = await add(at);
      if (found && found.components === 3 && longEdge(found) >= PLENTY) return found;
    }
  }
  top = best(candidates);
  return top;
}

export async function rawInfo(path: string): Promise<RawInfo> {
  const handle = await open(path, 'r');
  try {
    const file = reader(handle, (await handle.stat()).size);
    const info: RawInfo = { preview: null, orientation: 1, width: null, height: null };
    const found = await embedded(file, info);
    if (found) {
      const length = found.length || (await jpegEnd(file, found.offset)) - found.offset;
      info.preview = { offset: found.offset, length: Math.min(length, MAX_JPEG), width: found.width, height: found.height };
      if (info.width && info.height && fullSize(found, info.width, info.height)) {
        info.width = found.width;
        info.height = found.height;
      }
    }
    return info;
  } finally {
    await handle.close();
  }
}

export async function readRange(path: string, offset: number, length: number) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function canonMeta(path: string): Promise<Buffer[]> {
  const head = await readRange(path, 0, 256 * 1024);
  if (head.toString('latin1', 4, 12) !== 'ftypcrx ') return [];
  const boxes: Buffer[] = [];
  for (const name of ['CMT1', 'CMT2']) {
    const at = head.indexOf(name, 0, 'latin1');
    if (at < 4) continue;
    const size = head.readUInt32BE(at - 4);
    if (size > 8 && at - 4 + size <= head.length) boxes.push(head.subarray(at + 4, at - 4 + size));
  }
  return boxes;
}
