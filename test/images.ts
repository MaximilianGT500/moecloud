import sharp from 'sharp';

interface Tag {
  tag: number;
  type: 2 | 3 | 4;
  values: number[] | string;
}

const SIZES = { 2: 1, 3: 2, 4: 4 };

function directory(tags: Tag[], at: number) {
  const head = Buffer.alloc(2 + tags.length * 12 + 4);
  const extra: Buffer[] = [];
  let cursor = at + head.length;
  head.writeUInt16BE(tags.length, 0);
  tags.forEach((entry, index) => {
    const size = SIZES[entry.type];
    const list = typeof entry.values === 'string' ? [...Buffer.from(`${entry.values}\0`, 'latin1')] : entry.values;
    const data = Buffer.alloc(list.length * size);
    list.forEach((value, position) => {
      if (size === 1) data.writeUInt8(value, position);
      else if (size === 2) data.writeUInt16BE(value, position * 2);
      else data.writeUInt32BE(value, position * 4);
    });
    const offset = 2 + index * 12;
    head.writeUInt16BE(entry.tag, offset);
    head.writeUInt16BE(entry.type, offset + 2);
    head.writeUInt32BE(list.length, offset + 4);
    if (data.length <= 4) data.copy(head, offset + 8);
    else {
      head.writeUInt32BE(cursor, offset + 8);
      extra.push(data);
      cursor += data.length;
    }
  });
  return Buffer.concat([head, ...extra]);
}

export const halves = (width: number, height: number, left: string, right: string) =>
  sharp({ create: { width, height, channels: 3, background: left } })
    .composite([{ input: { create: { width: width / 2, height, channels: 3, background: right } }, left: width / 2, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();

export const plain = (width: number, height: number, colour: string) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg({ quality: 90 })
    .toBuffer();

export async function proRaw(orientation = 6) {
  const preview = await halves(160, 120, '#d01010', '#1010d0');
  const mask = await plain(320, 240, '#10c010');
  const lossless = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 0x0c, 0x0b, 0xd0, 0x0f, 0xc0, 0x01, 0x01, 0x11, 0x00]),
    Buffer.alloc(64, 0x55),
    Buffer.from([0xff, 0xd9]),
  ]);
  const build = (at: { raw: number; mask: number; exif: number; preview: number; maskData: number; tile: number }) => [
    directory(
      [
        { tag: 254, type: 4, values: [1] },
        { tag: 256, type: 4, values: [160] },
        { tag: 257, type: 4, values: [120] },
        { tag: 259, type: 3, values: [7] },
        { tag: 262, type: 3, values: [6] },
        { tag: 271, type: 2, values: 'Apple' },
        { tag: 272, type: 2, values: 'iPhone 12 Pro' },
        { tag: 273, type: 4, values: [at.preview] },
        { tag: 274, type: 3, values: [orientation] },
        { tag: 277, type: 3, values: [3] },
        { tag: 278, type: 4, values: [120] },
        { tag: 279, type: 4, values: [preview.length] },
        { tag: 330, type: 4, values: [at.raw, at.mask] },
        { tag: 34665, type: 4, values: [at.exif] },
      ],
      8
    ),
    directory(
      [
        { tag: 254, type: 4, values: [0] },
        { tag: 256, type: 4, values: [4032] },
        { tag: 257, type: 4, values: [3024] },
        { tag: 259, type: 3, values: [7] },
        { tag: 262, type: 3, values: [34892] },
        { tag: 322, type: 4, values: [4032] },
        { tag: 323, type: 4, values: [3024] },
        { tag: 324, type: 4, values: [at.tile] },
        { tag: 325, type: 4, values: [lossless.length] },
      ],
      at.raw
    ),
    directory(
      [
        { tag: 254, type: 4, values: [65540] },
        { tag: 256, type: 4, values: [320] },
        { tag: 257, type: 4, values: [240] },
        { tag: 259, type: 3, values: [7] },
        { tag: 262, type: 3, values: [6] },
        { tag: 273, type: 4, values: [at.maskData] },
        { tag: 277, type: 3, values: [3] },
        { tag: 278, type: 4, values: [240] },
        { tag: 279, type: 4, values: [mask.length] },
      ],
      at.mask
    ),
    directory([{ tag: 36867, type: 2, values: '2023:08:09 14:15:16' }], at.exif),
  ];
  const draft = build({ raw: 0, mask: 0, exif: 0, preview: 0, maskData: 0, tile: 0 });
  const raw = 8 + draft[0].length;
  const maskAt = raw + draft[1].length;
  const exif = maskAt + draft[2].length;
  const previewAt = exif + draft[3].length;
  const maskData = previewAt + preview.length;
  const tile = maskData + mask.length;
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
  return Buffer.concat([header, ...build({ raw, mask: maskAt, exif, preview: previewAt, maskData, tile }), preview, mask, lossless]);
}

export async function sigmaLike() {
  const small = await plain(64, 48, '#c0c000');
  const large = await halves(400, 300, '#10a0a0', '#a010a0');
  const filler = (length: number, seed: number) => Buffer.from(Array.from({ length }, (_value, index) => (index * 7 + seed) % 251));
  return Buffer.concat([
    Buffer.from('FOVb', 'latin1'),
    filler(3000, 3),
    Buffer.from([0xff, 0xd8, 0xff, 0x10]),
    filler(500, 9),
    small,
    filler(2000, 5),
    large,
    filler(1500, 11),
  ]);
}

export async function fuji() {
  const preview = await plain(150, 100, '#e08020');
  const header = Buffer.alloc(148);
  header.write('FUJIFILMCCD-RAW 0201FF129502X-T4', 0, 'latin1');
  const table = Buffer.alloc(4 + 8 + 8);
  table.writeUInt32BE(2, 0);
  table.writeUInt16BE(0x100, 4);
  table.writeUInt16BE(4, 6);
  table.writeUInt16BE(208, 8);
  table.writeUInt16BE(312, 10);
  table.writeUInt16BE(0x111, 12);
  table.writeUInt16BE(4, 14);
  table.writeUInt16BE(200, 16);
  table.writeUInt16BE(300, 18);
  header.writeUInt32BE(header.length, 84);
  header.writeUInt32BE(preview.length, 88);
  header.writeUInt32BE(header.length + preview.length, 92);
  header.writeUInt32BE(table.length, 96);
  return Buffer.concat([header, preview, table, Buffer.alloc(256, 0x33)]);
}

const pixels = (width: number, height: number, colour: (x: number, y: number) => [number, number, number]) =>
  Array.from({ length: height }, (_row, y) => Array.from({ length: width }, (_cell, x) => colour(x, y)));

const split = (width: number) => (x: number) => (x < width / 2 ? [220, 30, 30] : [30, 30, 220]) as [number, number, number];

export function bitmap(width = 64, height = 48) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const file = Buffer.alloc(54 + row * height);
  file.write('BM', 0, 'latin1');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(row * height, 34);
  pixels(width, height, split(width)).forEach((line, y) => {
    line.forEach(([red, green, blue], x) => {
      const at = 54 + (height - 1 - y) * row + x * 3;
      file[at] = blue;
      file[at + 1] = green;
      file[at + 2] = red;
    });
  });
  return file;
}

export function photoshop(width = 64, height = 48) {
  const header = Buffer.alloc(26 + 12 + 2);
  header.write('8BPS', 0, 'latin1');
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(8, 22);
  header.writeUInt16BE(3, 24);
  const image = pixels(width, height, split(width));
  const planes = [0, 1, 2].map((channel) => Buffer.from(image.flatMap((line) => line.map((pixel) => pixel[channel]))));
  return Buffer.concat([header, ...planes]);
}

export function targa(width = 64, height = 48) {
  const header = Buffer.alloc(18);
  header[2] = 2;
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = 24;
  header[17] = 0x20;
  const body = Buffer.from(pixels(width, height, split(width)).flatMap((line) => line.flatMap(([red, green, blue]) => [blue, green, red])));
  return Buffer.concat([header, body]);
}

export async function pixel(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 3;
  return { width: info.width, height: info.height, red: data[at], green: data[at + 1], blue: data[at + 2] };
}
