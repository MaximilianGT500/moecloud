import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const site = join(root, 'website');
const assets = join(site, 'assets');
const shots = join(root, 'docs/screenshots');

const SHOTS: [string, number][] = [
  ['files', 1600],
  ['mobile', 780],
  ['viewer', 1600],
  ['markdown', 1600],
  ['photos', 1600],
  ['share', 1600],
  ['public', 1600],
  ['comments', 1600],
  ['notifications', 1600],
  ['admin', 1600],
  ['admin-scan', 1600],
  ['storage', 1600],
];

async function fonts() {
  const dir = join(assets, 'fonts');
  await mkdir(dir, { recursive: true });
  const rounded = join(root, 'node_modules/@fontsource/m-plus-rounded-1c');
  const mono = join(root, 'node_modules/@fontsource/geist-mono');
  for (const weight of [400, 500, 700, 800]) {
    await copyFile(join(rounded, `files/m-plus-rounded-1c-latin-${weight}-normal.woff2`), join(dir, `m-plus-rounded-1c-${weight}.woff2`));
  }
  for (const weight of [400, 500]) {
    await copyFile(join(mono, `files/geist-mono-latin-${weight}-normal.woff2`), join(dir, `geist-mono-${weight}.woff2`));
  }
  await copyFile(join(rounded, 'LICENSE'), join(dir, 'OFL-m-plus-rounded-1c.txt'));
  await copyFile(join(mono, 'LICENSE'), join(dir, 'OFL-geist-mono.txt'));
}

async function icons() {
  const dir = join(assets, 'img');
  await mkdir(dir, { recursive: true });
  await copyFile(join(root, 'public/favicon.svg'), join(dir, 'logo.svg'));
  await copyFile(join(root, 'public/favicon-32.png'), join(dir, 'favicon-32.png'));
  await copyFile(join(root, 'public/apple-touch-icon.png'), join(dir, 'apple-touch-icon.png'));
  await copyFile(join(root, 'public/favicon.ico'), join(site, 'favicon.ico'));
  await sharp(join(dir, 'sticker.svg'), { density: 220 })
    .resize({ width: 824 })
    .webp({ quality: 90 })
    .toFile(join(dir, 'sticker-824.webp'));
  await sharp(join(dir, 'sticker.svg'), { density: 110 })
    .resize({ width: 412 })
    .webp({ quality: 90 })
    .toFile(join(dir, 'sticker-412.webp'));
}

async function screenshots() {
  const dir = join(assets, 'img/shots');
  await mkdir(dir, { recursive: true });
  for (const [name, width] of SHOTS) {
    const image = sharp(join(shots, `${name}.png`));
    const meta = await image.metadata();
    await image
      .resize({ width: Math.min(width, meta.width ?? width) })
      .webp({ quality: 84, effort: 5 })
      .toFile(join(dir, `${name}.webp`));
  }
}

async function demo() {
  const dir = join(assets, 'img/demo');
  await mkdir(dir, { recursive: true });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a62"/><stop offset="1" stop-color="#7b4ab8"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#s)"/>
    <circle cx="1120" cy="400" r="150" fill="#ffd27a" opacity="0.92"/>
    <path d="M0 700 L260 470 L470 650 L700 380 L980 670 L1200 510 L1600 740 L1600 1000 L0 1000 Z" fill="#2c1b4a" opacity="0.85"/>
    <path d="M0 820 C300 760 600 880 900 820 C1150 770 1400 840 1600 800 L1600 1000 L0 1000 Z" fill="#2c1b4a"/>
  </svg>`);
  await sharp(svg).resize({ width: 800 }).webp({ quality: 80 }).toFile(join(dir, 'sonnenuntergang.webp'));
}

async function og() {
  const { chromium } = await import('playwright');
  const data = async (file: string, type: string) => `data:${type};base64,${(await readFile(file)).toString('base64')}`;
  const html = (await readFile(join(root, 'tools/og.html'), 'utf8'))
    .replaceAll('{{font400}}', await data(join(assets, 'fonts/m-plus-rounded-1c-400.woff2'), 'font/woff2'))
    .replaceAll('{{font800}}', await data(join(assets, 'fonts/m-plus-rounded-1c-800.woff2'), 'font/woff2'))
    .replaceAll('{{sticker}}', await data(join(assets, 'img/sticker.svg'), 'image/svg+xml'))
    .replaceAll('{{shot}}', await data(join(assets, 'img/shots/files.webp'), 'image/webp'));
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await writeFile(join(assets, 'img/og.png'), await page.screenshot({ type: 'png' }));
  } finally {
    await browser.close();
  }
}

await fonts();
await icons();
await screenshots();
await demo();
await og();
process.stdout.write('Website-Dateien erzeugt\n');
