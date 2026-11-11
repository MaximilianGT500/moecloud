import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import libheif from 'libheif-js/wasm-bundle.js';

const MAX_PIXELS = 64_000_000;

const [input, output, edge, quality] = process.argv.slice(2);
const max = Number(edge);

sharp.cache(false);
sharp.concurrency(1);

function colourProfile(file: Buffer) {
  const head = file.subarray(0, 512 * 1024);
  for (let at = head.indexOf('colr', 4, 'latin1'); at !== -1; at = head.indexOf('colr', at + 4, 'latin1')) {
    const kind = head.toString('latin1', at + 4, at + 8);
    if (kind !== 'prof' && kind !== 'rICC') continue;
    const profile = head.subarray(at + 8, at - 4 + head.readUInt32BE(at - 4));
    if (profile.length >= 128 && profile.toString('latin1', 36, 40) === 'acsp' && profile.toString('latin1', 16, 20) === 'RGB ')
      return profile;
  }
  return Buffer.alloc(0);
}

function tiffHeader(width: number, height: number, alpha: number, profile: Buffer) {
  const entries: [number, number, number, number][] = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 4, 0],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 0],
    [277, 3, 1, 4],
    [278, 4, 1, height],
    [279, 4, 1, width * height * 4],
    [284, 3, 1, 1],
    [338, 3, 1, alpha],
  ];
  if (profile.length) entries.push([34675, 7, profile.length, 0]);
  const bits = 8 + 2 + entries.length * 12 + 4;
  const icc = bits + 8;
  const length = Math.ceil((icc + profile.length) / 4) * 4;
  const header = Buffer.alloc(length);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  header.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, count, value], index) => {
    const at = 10 + index * 12;
    header.writeUInt16LE(tag, at);
    header.writeUInt16LE(type, at + 2);
    header.writeUInt32LE(count, at + 4);
    const stored = tag === 258 ? bits : tag === 273 ? length : tag === 34675 ? icc : value;
    if (type === 3 && count === 1) header.writeUInt16LE(stored, at + 8);
    else header.writeUInt32LE(stored, at + 8);
  });
  for (let index = 0; index < 4; index++) header.writeUInt16LE(8, bits + index * 2);
  profile.copy(header, icc);
  return header;
}

const file = await readFile(input);
const images = new libheif.HeifDecoder().decode(file);
const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
if (!image) throw new Error('Kein Bild in der Datei');
const width = image.get_width();
const height = image.get_height();
if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) throw new Error('Das Bild ist zu groß');

const alpha = image.has_alpha_channel();
const header = tiffHeader(width, height, alpha ? 2 : 0, colourProfile(file));
const pixels = width * height * 4;
const tiff = Buffer.allocUnsafe(header.length + pixels);
header.copy(tiff);
const data = new Uint8ClampedArray(tiff.buffer, tiff.byteOffset + header.length, pixels);
await new Promise<void>((resolve, reject) => {
  image.display({ data, width, height }, (result) => (result ? resolve() : reject(new Error('Das Bild lässt sich nicht lesen'))));
});

let pipeline = sharp(tiff, { limitInputPixels: MAX_PIXELS });
if (!alpha) pipeline = pipeline.removeAlpha();
await pipeline
  .resize(max, max, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: Number(quality), effort: max > 480 ? 2 : 3 })
  .toFile(output);

process.stdout.write(JSON.stringify({ width, height }));
