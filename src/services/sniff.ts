import { open } from 'node:fs/promises';

const SAMPLE = 8192;
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

const starts = (data: Buffer, bytes: number[], at = 0) => bytes.every((byte, index) => data[at + index] === byte);
const every = (data: Buffer, start: number, step: number, byte: number) => [0, 1, 2].every((index) => data[start + index * step] === byte);

function looksLikeText(data: Buffer) {
  for (const byte of data) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d && byte !== 0x1b) return false;
  }
  return true;
}

export function sniffBuffer(data: Buffer): string | null {
  if (data.length === 0) return null;
  if (starts(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(data, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts(data, [0x52, 0x49, 0x46, 0x46]) && starts(data, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts(data, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = data.toString('latin1', 8, 12);
    if (HEIF_BRANDS.has(brand)) return 'image/heic';
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    return null;
  }
  if (data.length >= 392 && (every(data, 0, 188, 0x47) || every(data, 4, 192, 0x47))) return 'video/mp2t';
  return looksLikeText(data) ? 'text/plain' : null;
}

export async function sniff(path: string): Promise<string | null> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(SAMPLE);
    const { bytesRead } = await handle.read(buffer, 0, SAMPLE, 0);
    return sniffBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
