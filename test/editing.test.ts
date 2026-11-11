import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { PDFDocument } from '@pdfme/pdf-lib';
import exifr from 'exifr';
import sharp from 'sharp';
import { Client, createApp, login, setUp } from './helpers.ts';
import { pixel, proRaw } from './images.ts';
import { detectTools, tools } from '../src/services/media.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaRoot = '';
let miaId = 0;

interface Shown {
  id: string;
  name: string;
  parentId: string;
  mime: string;
}

async function upload(parent: string, name: string, content: Buffer, client = emi): Promise<Shown> {
  const response = await client.upload(parent, name, content);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node;
}

async function edit(id: string, body: Record<string, unknown>, client = emi) {
  return client.json('POST', `/api/nodes/${id}/edit`, body);
}

async function content(id: string, client = emi) {
  const response = await client.get(`/api/nodes/${id}/content`);
  assert.equal(response.statusCode, 200);
  return response.rawPayload;
}

async function quadrants(orientation: number) {
  const image = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ff0000' } })
    .composite([
      { input: { create: { width: 40, height: 20, channels: 3, background: '#00ff00' } }, left: 40, top: 0 },
      { input: { create: { width: 40, height: 20, channels: 3, background: '#0000ff' } }, left: 0, top: 20 },
      { input: { create: { width: 40, height: 20, channels: 3, background: '#ffff00' } }, left: 40, top: 20 },
    ])
    .png()
    .toBuffer();
  return sharp(image).withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer();
}

async function corners(image: Buffer) {
  const name = async (x: number, y: number) => {
    const { red, green, blue } = await pixel(image, x, y);
    if (red > 128 && green > 128) return 'Y';
    if (red > 128) return 'R';
    if (green > 128) return 'G';
    return blue > 128 ? 'B' : '?';
  };
  const { width, height } = await sharp(image).metadata();
  return `${width}x${height} ${await name(2, 2)}${await name(width! - 3, 2)}${await name(2, height! - 3)}${await name(width! - 3, height! - 3)}`;
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
});

after(async () => {
  await app.close();
});

describe('Bilder bearbeiten', () => {
  it('dreht, spiegelt und schneidet so zu, wie die Vorschau es zeigt', async () => {
    const photo = await upload(root, 'Quadrate.jpg', await quadrants(6));
    assert.equal(await corners(await (await emi.get(`/api/nodes/${photo.id}/thumb`)).rawPayload), '40x80 BRYG');
    const rotated = await edit(photo.id, { rotate: 90, flipH: true, format: 'png' });
    assert.equal(rotated.statusCode, 200, rotated.body);
    const copy = rotated.json().node;
    assert.deepEqual([copy.name, copy.parentId, copy.mime], ['Quadrate (bearbeitet).png', root, 'image/png']);
    assert.equal(await corners(await content(copy.id)), '80x40 BYRG');
    const cropped = (await edit(photo.id, { crop: { x: 0, y: 0.5, width: 1, height: 0.5 }, format: 'png' })).json().node;
    assert.equal(cropped.name, 'Quadrate (bearbeitet) (2).png');
    assert.equal(await corners(await content(cropped.id)), '40x40 YGYG');
    const flipped = (await edit(photo.id, { flipV: true, rotate: 270, format: 'png' })).json().node;
    assert.equal(await corners(await content(flipped.id)), '80x40 BYRG');
    assert.equal(await corners(await content(photo.id)), '80x40 RGBY');
  });

  it('verkleinert, wandelt um und behält das Original', async () => {
    const big = await upload(
      root,
      'Groß.png',
      await sharp({ create: { width: 1200, height: 600, channels: 4, background: '#3366cc80' } })
        .png()
        .toBuffer()
    );
    const small = (await edit(big.id, { maxEdge: 300, format: 'jpeg', quality: 80 })).json().node;
    assert.equal(small.name, 'Groß (bearbeitet).jpg');
    const meta = await sharp(await content(small.id)).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['jpeg', 300, 150, false]);
    for (const format of ['webp', 'avif']) {
      const converted = (await edit(big.id, { format })).json().node;
      assert.equal((await sharp(await content(converted.id)).metadata()).format, format === 'avif' ? 'heif' : 'webp');
    }
    const tooBig = await edit(big.id, { maxEdge: 5000, format: 'png' });
    assert.equal((await sharp(await content(tooBig.json().node.id)).metadata()).width, 1200);
  });

  it('speichert auf Wunsch als neue Version im selben Format', async () => {
    const photo = await upload(root, 'Version.jpg', await quadrants(1));
    const saved = await edit(photo.id, { rotate: 180, save: 'version' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().node.id, photo.id);
    assert.equal(await corners(await content(photo.id)), '80x40 YBGR');
    assert.equal((await emi.get(`/api/nodes/${photo.id}/versions`)).json().items.length, 1);
    const wrong = await edit(photo.id, { format: 'png', save: 'version' });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().error.message, 'Eine neue Version geht nur im selben Format. Speichere stattdessen eine Kopie');
  });

  it('macht aus HEIC und Rohformaten ein JPEG mit Aufnahmedatum', async () => {
    const heic = await upload(root, 'IMG_0001.HEIC', await readFile(new URL('./fixtures/hochkant-p3.heic', import.meta.url)));
    assert.equal((await edit(heic.id, { save: 'version' })).json().error.message, 'Wähle ein Format zum Speichern');
    const jpeg = (await edit(heic.id, { format: 'jpeg' })).json().node;
    assert.equal(jpeg.name, 'IMG_0001 (bearbeitet).jpg');
    const data = await content(jpeg.id);
    const top = await pixel(data, 32, 20);
    assert.deepEqual([top.width, top.height], [64, 96]);
    assert.ok(top.red > 200 && top.blue < 70, `oben ist ${top.red}/${top.green}/${top.blue}`);
    const tags = await exifr.parse(data, { pick: ['DateTimeOriginal', 'Make', 'Model'] });
    assert.equal(tags.Make, 'MoeCam');
    assert.equal(tags.Model, 'Test 1');
    assert.equal(new Date(tags.DateTimeOriginal).getFullYear(), 2024);
    const dng = await upload(root, 'IMG_0002.DNG', await proRaw());
    const fromRaw = (await edit(dng.id, { format: 'jpeg', crop: { x: 0, y: 0, width: 1, height: 0.5 } })).json().node;
    const half = await pixel(await content(fromRaw.id), 60, 30);
    assert.deepEqual([half.width, half.height], [120, 80]);
    assert.ok(half.red > 180 && half.blue < 60);
  });

  it('legt Kopien aus geteilten Ordnern bei dir ab und prüft die Rechte', async () => {
    const shared = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Für Mia' })).json().node.id;
    const photo = await upload(shared, 'Gemeinsam.jpg', await quadrants(1));
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    const copy = await edit(photo.id, { rotate: 90, format: 'jpeg' }, mia);
    assert.equal(copy.statusCode, 200, copy.body);
    assert.equal(copy.json().node.parentId, miaRoot);
    assert.equal((await edit(photo.id, { rotate: 90, save: 'version' }, mia)).statusCode, 403);
    const text = await upload(root, 'Notiz.txt', Buffer.from('Hallo Lea'));
    assert.equal((await edit(text.id, { format: 'png' })).json().error.message, 'Dieses Bildformat kann MoeCloud nicht bearbeiten');
    assert.equal((await edit(photo.id, { crop: { x: 0, y: 0, width: 0, height: 1 } })).statusCode, 400);
  });
});

async function pdf(widths: number[]) {
  const document = await PDFDocument.create();
  for (const width of widths) document.addPage([width, 200]);
  return Buffer.from(await document.save());
}

const sizes = async (data: Buffer) =>
  (await PDFDocument.load(data)).getPages().map((page) => `${Math.round(page.getWidth())}:${page.getRotation().angle}`);

describe('PDF-Werkzeuge', () => {
  it('nennt Seiten, ordnet sie neu, dreht sie und speichert eine Kopie', async () => {
    const report = await upload(root, 'Bericht.pdf', await pdf([100, 200, 300]));
    const info = (await emi.get(`/api/nodes/${report.id}/pdf`)).json();
    assert.deepEqual(info.pages, [
      { width: 100, height: 200, rotation: 0 },
      { width: 200, height: 200, rotation: 0 },
      { width: 300, height: 200, rotation: 0 },
    ]);
    const saved = await emi.json('POST', `/api/nodes/${report.id}/pdf`, {
      pages: [{ page: 3 }, { page: 1, rotate: 90 }],
      name: 'Auszug',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().node.name, 'Auszug.pdf');
    assert.deepEqual(await sizes(await content(saved.json().node.id)), ['300:0', '100:90']);
    const unnamed = (await emi.json('POST', `/api/nodes/${report.id}/pdf`, { pages: [{ page: 2, rotate: 270 }] })).json().node;
    assert.equal(unnamed.name, 'Bericht (bearbeitet).pdf');
    assert.deepEqual(await sizes(await content(report.id)), ['100:0', '200:0', '300:0']);
  });

  it('speichert als neue Version und prüft Seiten und Rechte', async () => {
    const plan = await upload(root, 'Plan.pdf', await pdf([150, 250]));
    const version = await emi.json('POST', `/api/nodes/${plan.id}/pdf`, { pages: [{ page: 2 }], save: 'version' });
    assert.equal(version.json().node.id, plan.id);
    assert.deepEqual(await sizes(await content(plan.id)), ['250:0']);
    assert.equal((await emi.get(`/api/nodes/${plan.id}/versions`)).json().items.length, 1);
    const beyond = await emi.json('POST', `/api/nodes/${plan.id}/pdf`, { pages: [{ page: 5 }] });
    assert.equal(beyond.json().error.message, 'Diese Seite gibt es in der PDF nicht');
    assert.equal(
      (await emi.json('POST', `/api/nodes/${plan.id}/pdf`, { pages: [] })).json().error.message,
      'Wähle mindestens eine Seite aus'
    );
    const text = await upload(root, 'Liste.txt', Buffer.from('Hallo Emily'));
    assert.equal((await emi.get(`/api/nodes/${text.id}/pdf`)).json().error.message, 'Das geht nur mit PDF-Dateien');
    const broken = await upload(root, 'Kaputt.pdf', Buffer.from('%PDF-1.7 kaputt'));
    assert.equal((await emi.get(`/api/nodes/${broken.id}/pdf`)).json().error.message, '„Kaputt.pdf“ lässt sich nicht als PDF lesen');
    const shared = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'PDFs für Mia' })).json().node.id;
    const handout = await upload(shared, 'Handout.pdf', await pdf([120, 220]));
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    assert.equal((await mia.json('POST', `/api/nodes/${handout.id}/pdf`, { pages: [{ page: 1 }], save: 'version' })).statusCode, 403);
    const copy = (await mia.json('POST', `/api/nodes/${handout.id}/pdf`, { pages: [{ page: 2 }], name: 'Nur Seite 2' })).json().node;
    assert.equal(copy.parentId, miaRoot);
  });

  it('fügt PDFs in der gewählten Reihenfolge zusammen', async () => {
    const one = await upload(root, 'Teil 1.pdf', await pdf([110, 120]));
    const two = await upload(root, 'Teil 2.pdf', await pdf([130]));
    const merged = await emi.json('POST', '/api/pdf/merge', { ids: [two.id, one.id], name: 'Gesamt' });
    assert.equal(merged.statusCode, 200, merged.body);
    assert.equal(merged.json().node.name, 'Gesamt.pdf');
    assert.deepEqual(await sizes(await content(merged.json().node.id)), ['130:0', '110:0', '120:0']);
    assert.equal(
      (await emi.json('POST', '/api/pdf/merge', { ids: [one.id], name: 'x' })).json().error.message,
      'Wähle mindestens zwei PDFs aus'
    );
    assert.equal((await emi.json('POST', '/api/pdf/merge', { ids: [one.id, two.id], name: 'a/b' })).statusCode, 400);
  });

  it('zeigt Seiten als Bild, wenn Poppler da ist', async (context) => {
    await detectTools();
    if (!tools.pdftoppm) {
      context.skip('pdftoppm ist nicht installiert');
      return;
    }
    const sheet = await upload(root, 'Blatt.pdf', await pdf([300, 600]));
    const second = await emi.get(`/api/nodes/${sheet.id}/pdf/2?size=200`);
    assert.equal(second.statusCode, 200);
    assert.equal(second.headers['content-type'], 'image/png');
    assert.equal((await sharp(second.rawPayload).metadata()).width, 200);
    assert.equal((await emi.get(`/api/nodes/${sheet.id}/pdf/9`)).statusCode, 404);
  });
});
