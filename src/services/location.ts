import { Transform } from 'node:stream';
import { isHeif } from '../lib/mime.ts';
import * as settings from './settings.ts';
import { heifExifRange } from './heif.ts';
import { readRange } from './raw.ts';

export interface Blank {
  start: number;
  end: number;
  fill: number;
}

const HEAD = 512 * 1024;
const GPS_TAG = 0x8825;
const SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
const XMP = 'http://ns.adobe.com/xap/1.0/\u0000';
const cache = new Map<string, Blank[]>();

export function tiffBlanks(data: Buffer, base: number): Blank[] {
  if (data.length < 8) return [];
  const order = data.toString('latin1', 0, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return [];
  const u16 = (at: number) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
  const u32 = (at: number) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
  if (u16(2) !== 42) return [];
  const first = u32(4);
  if (first + 2 > data.length) return [];
  let gps = 0;
  for (let index = 0, count = u16(first); index < count; index++) {
    const entry = first + 2 + index * 12;
    if (entry + 12 > data.length) break;
    if (u16(entry) === GPS_TAG) gps = u32(entry + 8);
  }
  if (!gps || gps + 2 > data.length) return [];
  const entries = u16(gps);
  const blanks: Blank[] = [];
  for (let index = 0; index < entries; index++) {
    const entry = gps + 2 + index * 12;
    if (entry + 12 > data.length) break;
    const size = (SIZES[u16(entry + 2)] ?? 0) * u32(entry + 4);
    const at = u32(entry + 8);
    if (size > 4 && at + size <= data.length) blanks.push({ start: base + at, end: base + at + size, fill: 0 });
  }
  blanks.push({ start: base + gps, end: base + Math.min(data.length, gps + 2 + entries * 12 + 4), fill: 0 });
  return blanks;
}

const hasLocation = (text: string) => /GPS(Latitude|Longitude|Altitude)|exif:GPS|drone-dji:(Gps|Latitude|Longitude)/i.test(text);

export function jpegBlanks(data: Buffer): Blank[] {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return [];
  const blanks: Blank[] = [];
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = data.readUInt16BE(at + 2);
    const start = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > data.length) break;
    if (marker === 0xe1) {
      if (data.toString('latin1', start, start + 6) === 'Exif\u0000\u0000') {
        blanks.push(...tiffBlanks(data.subarray(start + 6, end), start + 6));
      } else if (
        data.toString('latin1', start, start + XMP.length) === XMP &&
        hasLocation(data.toString('latin1', start + XMP.length, end))
      ) {
        blanks.push({ start: start + XMP.length, end, fill: 0x20 });
      }
    }
    at = end;
  }
  return blanks;
}

export function webpBlanks(data: Buffer): Blank[] {
  if (data.length < 12 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP') return [];
  const blanks: Blank[] = [];
  let at = 12;
  while (at + 8 <= data.length) {
    const type = data.toString('latin1', at, at + 4);
    const size = data.readUInt32LE(at + 4);
    const start = at + 8;
    const end = start + size;
    if (end > data.length) break;
    if (type === 'EXIF') {
      const skip = data.toString('latin1', start, start + 6) === 'Exif\u0000\u0000' ? 6 : 0;
      blanks.push(...tiffBlanks(data.subarray(start + skip, end), start + skip));
    } else if (type === 'XMP ' && hasLocation(data.toString('latin1', start, end))) {
      blanks.push({ start, end, fill: 0x20 });
    }
    at = end + (size % 2);
  }
  return blanks;
}

async function heifBlanks(path: string) {
  const range = await heifExifRange(path);
  if (!range) return [];
  return tiffBlanks(await readRange(path, range.offset, Math.min(range.length, HEAD)), range.offset);
}

export const stripsLocation = (type: string) => type === 'image/jpeg' || type === 'image/webp' || isHeif(type);

export const stripLocation = () => settings.get('share.stripLocation');

export async function locationBlanks(path: string, sha: string, type: string): Promise<Blank[]> {
  if (!stripsLocation(type)) return [];
  const known = cache.get(sha);
  if (known) return known;
  let blanks: Blank[] = [];
  try {
    if (isHeif(type)) blanks = await heifBlanks(path);
    else {
      const head = await readRange(path, 0, HEAD);
      blanks = type === 'image/jpeg' ? jpegBlanks(head) : webpBlanks(head);
    }
  } catch {
    blanks = [];
  }
  if (cache.size >= 2000) cache.clear();
  cache.set(sha, blanks);
  return blanks;
}

export function applyBlanks(chunk: Buffer, position: number, blanks: Blank[]) {
  let out = chunk;
  for (const range of blanks) {
    const from = Math.max(range.start, position);
    const to = Math.min(range.end, position + chunk.length);
    if (from >= to) continue;
    if (out === chunk) out = Buffer.from(chunk);
    out.fill(range.fill, from - position, to - position);
  }
  return out;
}

export function blanker(blanks: Blank[], start = 0) {
  let position = start;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const out = applyBlanks(chunk, position, blanks);
      position += chunk.length;
      callback(null, out);
    },
  });
}
