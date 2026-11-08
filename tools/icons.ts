import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(join(root, 'public/favicon.svg'), 'utf8');

const square = source.replace('rx="18"', 'rx="0"');
const maskable = square.replace(/<g fill="none"([^>]*)>/, '<g fill="none"$1 transform="translate(32 32) scale(0.78) translate(-32 -32)">');

const png = (svg: string, size: number) =>
  sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await mkdir(join(root, 'public/icons'), { recursive: true });
await mkdir(join(root, 'docs'), { recursive: true });
await writeFile(join(root, 'public/apple-touch-icon.png'), await png(square, 180));
await writeFile(join(root, 'public/icons/icon-192.png'), await png(source, 192));
await writeFile(join(root, 'public/icons/icon-512.png'), await png(source, 512));
await writeFile(join(root, 'public/icons/maskable-512.png'), await png(maskable, 512));
await writeFile(join(root, 'public/favicon-32.png'), await png(source, 32));
await writeFile(join(root, 'docs/logo.png'), await png(source, 512));
await writeFile(
  join(root, 'public/favicon.ico'),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(source, size) }))))
);
process.stdout.write('Icons erzeugt\n');
