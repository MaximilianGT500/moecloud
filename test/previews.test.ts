import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, setUp, zip } from './helpers.ts';
import { bitmap, fuji, photoshop, pixel, plain, proRaw, sigmaLike, targa } from './images.ts';
import { one, run } from '../src/lib/db.ts';
import { kindOf, mimeOf, resolveType } from '../src/lib/mime.ts';
import { detectTools, tools } from '../src/services/media.ts';
import { processNow, refreshPreviews } from '../src/services/processing.ts';
import * as settings from '../src/services/settings.ts';
import { sniffBuffer } from '../src/services/sniff.ts';

const app = await createApp();
let emi: Client;
let root = '';

interface Shown {
  id: string;
  kind: string;
  mime: string;
  thumb: boolean;
  rendition: boolean;
}

async function put(name: string, content: Buffer): Promise<Shown> {
  const response = await emi.upload(root, name, content, 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node;
}

const show = async (id: string): Promise<Shown> => (await emi.get(`/api/nodes/${id}`)).json().node;
const meta = async (id: string) => (await emi.get(`/api/nodes/${id}/meta`)).json();

async function image(id: string, kind: 'thumb' | 'preview') {
  const response = await emi.get(`/api/nodes/${id}/${kind}`);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'image/webp');
  return response.rawPayload;
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
});

describe('Dateitypen', () => {
  it('kennt Rohformate und weitere Bildformate am Namen', () => {
    assert.equal(mimeOf('IMG_0001.DNG'), 'image/x-adobe-dng');
    assert.equal(mimeOf('foto.cr3'), 'image/x-canon-cr3');
    assert.equal(mimeOf('foto.ARW'), 'image/x-sony-arw');
    assert.equal(mimeOf('foto.hif'), 'image/heif');
    assert.equal(mimeOf('foto.jfif'), 'image/jpeg');
    assert.equal(mimeOf('plakat.psb'), 'image/vnd.adobe.photoshop');
    for (const name of ['a.nef', 'a.raf', 'a.orf', 'a.rw2', 'a.pef', 'a.heic', 'a.psd', 'a.jxl', 'a.tga'])
      assert.equal(kindOf(name, null), 'image');
    assert.equal(kindOf('route.gpx', null), 'text');
    assert.equal(kindOf('untertitel.srt', null), 'text');
    assert.equal(kindOf('start.bat', null), 'text');
    assert.equal(kindOf('server.ts', null), 'code');
  });

  it('erkennt Inhalte an den ersten Bytes', async () => {
    assert.equal(sniffBuffer(Buffer.from('%PDF-1.7\n')), 'application/pdf');
    assert.equal(sniffBuffer(await plain(40, 40, '#fff')), 'image/jpeg');
    assert.equal(sniffBuffer(Buffer.from('Hallo Mia,\n\nschöne Grüße von Lea.\n')), 'text/plain');
    assert.equal(sniffBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00])), null);
    assert.equal(sniffBuffer(Buffer.alloc(0)), null);
    const stream = Buffer.alloc(188 * 3, 0x20);
    for (const at of [0, 188, 376]) stream[at] = 0x47;
    assert.equal(sniffBuffer(stream), 'video/mp2t');
  });

  it('übernimmt den erkannten Typ nur, wenn der Name nichts Genaues sagt', () => {
    assert.equal(resolveType('foto', null, 'image/png'), 'image/png');
    assert.equal(resolveType('foto.zip', null, 'image/png'), 'application/zip');
    assert.equal(resolveType('logo.ai', null, 'application/pdf'), 'application/pdf');
    assert.equal(resolveType('logo.eps', null, 'text/plain'), 'application/postscript');
    assert.equal(resolveType('film.ts', null, 'video/mp2t'), 'video/mp2t');
    assert.equal(resolveType('server.ts', null, 'text/plain'), 'text/typescript');
  });
});

describe('Rohformate', () => {
  it('zeigt das Vorschaubild aus einer DNG wie vom iPhone und dreht es richtig', async () => {
    const node = await put('IMG_0001.DNG', await proRaw());
    assert.deepEqual([node.kind, node.mime, node.thumb, node.rendition], ['image', 'image/x-adobe-dng', true, true]);
    await processNow();
    const top = await pixel(await image(node.id, 'thumb'), 60, 20);
    assert.deepEqual([top.width, top.height], [120, 160]);
    assert.ok(top.red > 180 && top.blue < 60, `oben ist ${top.red}/${top.green}/${top.blue}`);
    const bottom = await pixel(await image(node.id, 'preview'), 60, 140);
    assert.deepEqual([bottom.width, bottom.height], [120, 160]);
    assert.ok(bottom.blue > 180 && bottom.red < 60 && bottom.green < 60, `unten ist ${bottom.red}/${bottom.green}/${bottom.blue}`);
    const info = await meta(node.id);
    assert.deepEqual([info.width, info.height], [3024, 4032]);
    assert.equal(info.meta.camera, 'Apple iPhone 12 Pro');
    assert.equal(new Date(info.takenAt).getFullYear(), 2023);
    const listed = (await emi.get('/api/photos')).json().items;
    assert.ok(listed.some((item: Shown) => item.id === node.id));
  });

  it('lässt Rohdateien beim Drehen unangetastet', async () => {
    const node = await put('IMG_0002.dng', await proRaw(1));
    const response = await emi.json('POST', `/api/nodes/${node.id}/rotate`, { degrees: 90 });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.message, 'Dieses Bildformat kann MoeCloud nicht drehen');
  });

  it('findet das Vorschaubild auch ohne TIFF-Aufbau', async () => {
    const node = await put('Blume.x3f', await sigmaLike());
    const thumb = await pixel(await image(node.id, 'thumb'), 100, 150);
    assert.deepEqual([thumb.width, thumb.height], [400, 300]);
    assert.ok(thumb.green > 120 && thumb.red < 60, `links ist ${thumb.red}/${thumb.green}/${thumb.blue}`);
  });

  it('liest Vorschau und Bildgröße aus einer RAF', async () => {
    const node = await put('DSCF0001.RAF', await fuji());
    await processNow();
    const thumb = await pixel(await image(node.id, 'thumb'), 75, 50);
    assert.deepEqual([thumb.width, thumb.height], [150, 100]);
    const info = await meta(node.id);
    assert.deepEqual([info.width, info.height], [300, 200]);
  });

  it('bleibt ohne Vorschau, wenn die Datei keine mitbringt', async () => {
    const node = await put('leer.nef', Buffer.alloc(4096, 1));
    assert.equal(node.kind, 'image');
    await processNow();
    const after = await show(node.id);
    assert.deepEqual([after.thumb, after.rendition], [false, false]);
    assert.equal((await emi.get(`/api/nodes/${node.id}/thumb`)).statusCode, 404);
    assert.equal((await emi.get(`/api/nodes/${node.id}/preview`)).statusCode, 404);
  });
});

describe('HEIC und TIFF', () => {
  it('dekodiert HEIC, dreht es und rechnet die Farben um', async () => {
    const node = await put('IMG_0003.HEIC', await readFile(new URL('./fixtures/hochkant-p3.heic', import.meta.url)));
    assert.deepEqual([node.kind, node.thumb, node.rendition], ['image', true, true]);
    await processNow();
    const top = await pixel(await image(node.id, 'thumb'), 32, 20);
    assert.deepEqual([top.width, top.height], [64, 96]);
    assert.ok(top.red >= 210 && top.green <= 48, `oben ist ${top.red}/${top.green}/${top.blue}`);
    const bottom = await pixel(await image(node.id, 'preview'), 32, 85);
    assert.ok(bottom.blue > 150 && bottom.red < 60, `unten ist ${bottom.red}/${bottom.green}/${bottom.blue}`);
    const info = await meta(node.id);
    assert.deepEqual([info.width, info.height], [64, 96]);
    assert.equal(info.meta.camera, 'MoeCam Test 1');
    assert.equal(info.meta.exposure, 0.00025);
    const taken = new Date(info.takenAt);
    assert.deepEqual([taken.getFullYear(), taken.getMonth(), taken.getHours()], [2024, 4, 10]);
  });

  it('liefert für TIFF ein Bild, das der Browser zeigen kann', async () => {
    const tiff = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#208040' } })
      .tiff()
      .toBuffer();
    const node = await put('Scan.tif', tiff);
    assert.deepEqual([node.thumb, node.rendition], [true, true]);
    const large = await pixel(await image(node.id, 'preview'), 10, 10);
    assert.deepEqual([large.width, large.height], [300, 200]);
    const original = await emi.get(`/api/nodes/${node.id}/content`);
    assert.match(String(original.headers['content-disposition']), /^attachment/);
  });

  it('zeigt JPEG, PNG und Co. weiter im Original', async () => {
    const node = await put('Strand.jpg', await plain(200, 100, '#3070c0'));
    assert.deepEqual([node.thumb, node.rendition], [true, false]);
    assert.equal((await emi.get(`/api/nodes/${node.id}/preview`)).statusCode, 404);
  });
});

describe('Vorschaubilder aus Dokumenten', () => {
  const cover = (colour: string) =>
    sharp({ create: { width: 200, height: 280, channels: 3, background: colour } })
      .png()
      .toBuffer();

  it('nimmt das Vorschaubild aus OpenDocument, iWork und Krita', async () => {
    const letter = await put(
      'Brief.odt',
      await zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'Thumbnails/thumbnail.png': await cover('#c02020') })
    );
    assert.deepEqual([letter.kind, letter.thumb, letter.rendition], ['document', true, true]);
    assert.ok((await pixel(await image(letter.id, 'thumb'), 50, 50)).red > 150);
    assert.equal((await pixel(await image(letter.id, 'preview'), 50, 50)).height, 280);
    const slides = await put('Vortrag.key', await zip({ 'Index/Document.iwa': 'x', 'preview.jpg': await plain(320, 240, '#2020c0') }));
    assert.ok((await pixel(await image(slides.id, 'thumb'), 50, 50)).blue > 150);
    const drawing = await put(
      'Skizze.kra',
      await zip({ 'preview.png': await cover('#888888'), 'mergedimage.png': await cover('#20c020') })
    );
    assert.ok((await pixel(await image(drawing.id, 'thumb'), 50, 50)).green > 150);
  });

  it('findet das Titelbild eines E-Books und die erste Seite eines Comics', async () => {
    const book = await put(
      'Roman.epub',
      await zip({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/inhalt.opf"/></rootfiles></container>',
        'OEBPS/inhalt.opf':
          '<package><metadata><meta name="cover" content="titel"/></metadata><manifest>' +
          '<item id="kapitel" href="kapitel.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="bild" href="bilder/karte.png" media-type="image/png"/>' +
          '<item id="titel" href="bilder/titel%20bild.png" media-type="image/png"/></manifest></package>',
        'OEBPS/bilder/karte.png': await cover('#20c020'),
        'OEBPS/bilder/titel bild.png': await cover('#c020c0'),
      })
    );
    const front = await pixel(await image(book.id, 'thumb'), 50, 50);
    assert.ok(front.red > 150 && front.blue > 150 && front.green < 80);
    const comic = await put(
      'Heft.cbz',
      await zip({ 'seite10.png': await cover('#20c020'), 'seite2.png': await cover('#c0c020'), 'info.txt': 'x' })
    );
    const page = await pixel(await image(comic.id, 'thumb'), 50, 50);
    assert.ok(page.red > 150 && page.green > 150 && page.blue < 80);
  });

  it('bleibt beim Symbol, wenn das Dokument kein Vorschaubild hat', async () => {
    const node = await put('Tabelle.ods', await zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': '<x/>' }));
    assert.equal(node.thumb, true);
    await processNow();
    assert.deepEqual([(await show(node.id)).thumb, (await show(node.id)).rendition], [false, false]);
    const broken = await put('Notiz.pages', Buffer.from('kein Archiv'));
    await processNow();
    assert.equal((await show(broken.id)).thumb, false);
  });
});

describe('Erkennung am Inhalt', () => {
  it('zeigt Texte ohne Endung als Text', async () => {
    const node = await put('LIESMICH', Buffer.from('MoeCloud\n========\n\nHallo Emily, das ist ein Text ohne Endung.\n'));
    assert.equal(node.kind, 'other');
    await processNow();
    const after = await show(node.id);
    assert.deepEqual([after.kind, after.mime], ['text', 'text/plain']);
    const content = await emi.get(`/api/nodes/${node.id}/content`);
    assert.equal(content.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(String(content.headers['content-disposition']), /^inline/);
    const found = (await emi.get('/api/search?q=endung')).json().items;
    assert.ok(found.some((item: Shown) => item.id === node.id));
  });

  it('zeigt Bilder ohne Endung als Bild', async () => {
    const png = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#c08020' } })
      .png()
      .toBuffer();
    const node = await put('foto', png);
    await processNow();
    const after = await show(node.id);
    assert.deepEqual([after.kind, after.mime, after.thumb, after.rendition], ['image', 'image/png', true, false]);
    assert.equal((await pixel(await image(node.id, 'thumb'), 5, 5)).width, 90);
    assert.equal((await emi.get(`/api/nodes/${node.id}/content`)).headers['content-type'], 'image/png');
    assert.equal((await meta(node.id)).width, 90);
  });

  it('öffnet Illustrator-Dateien mit PDF-Inhalt als PDF', async () => {
    const node = await put('Logo.ai', Buffer.from('%PDF-1.5\n%âã\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1'));
    await processNow();
    assert.equal((await show(node.id)).kind, 'pdf');
    const content = await emi.get(`/api/nodes/${node.id}/content`);
    assert.equal(content.headers['content-type'], 'application/pdf');
    assert.match(String(content.headers['content-disposition']), /^inline/);
  });

  it('lässt unbekannte Binärdateien und TypeScript in Ruhe', async () => {
    const binary = await put('daten.bin', Buffer.from(Array.from({ length: 600 }, (_value, index) => (index * 37) % 256)));
    const source = await put('server.ts', Buffer.from('export const name: string = "Lea";\n'));
    const stream = Buffer.alloc(188 * 4, 0xff);
    for (let at = 0; at < stream.length; at += 188) stream[at] = 0x47;
    const film = await put('Aufnahme.ts', stream);
    await processNow();
    assert.equal((await show(binary.id)).kind, 'other');
    assert.equal((await show(source.id)).kind, 'code');
    assert.deepEqual([(await show(film.id)).kind, (await show(film.id)).mime], ['video', 'video/mp2t']);
  });
});

describe('Freigaben und Updates', () => {
  it('zeigt das große Vorschaubild auch über einen öffentlichen Link', async () => {
    const node = await put('IMG_0004.dng', await proRaw(3));
    const link = (await emi.json('POST', `/api/nodes/${node.id}/links`, {})).json().link;
    const guest = new Client(app);
    const shared = (await guest.get(`/api/public/${link.token}`)).json().share.node;
    assert.deepEqual([shared.kind, shared.thumb, shared.rendition], ['image', true, true]);
    const large = await guest.get(`/api/public/${link.token}/nodes/${node.id}/preview`);
    assert.equal(large.statusCode, 200);
    const turned = await pixel(large.rawPayload, 20, 60);
    assert.deepEqual([turned.width, turned.height], [160, 120]);
    assert.ok(turned.blue > 180 && turned.red < 60, `links ist ${turned.red}/${turned.green}/${turned.blue}`);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${root}/preview`)).statusCode, 404);
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Abgabe' })).json().node.id;
    const hidden = (await emi.upload(folder, 'IMG_0005.dng', await proRaw(8))).json().node.id;
    const request = (await emi.json('POST', `/api/nodes/${folder}/links`, { uploadOnly: true })).json().link;
    assert.equal((await guest.get(`/api/public/${request.token}/nodes/${hidden}/preview`)).statusCode, 404);
  });

  it('holt nach einem Update Typen und Vorschauen nach', async () => {
    const node = await put('Urlaub.cr2', await sigmaLike());
    await processNow();
    const sha = one<{ sha256: string }>('SELECT sha256 FROM nodes WHERE id = ?', node.id)!.sha256;
    run("UPDATE nodes SET mime = 'application/octet-stream' WHERE id = ?", node.id);
    run('UPDATE blobs SET thumb = -1, processed = 1, width = NULL, height = NULL WHERE sha256 = ?', sha);
    settings.set('preview.revision', 1);
    assert.equal((await show(node.id)).thumb, false);
    const result = refreshPreviews();
    assert.ok(result && result.retyped >= 1 && result.pending >= 1);
    assert.equal(one<{ mime: string }>('SELECT mime FROM nodes WHERE id = ?', node.id)!.mime, 'image/x-canon-cr2');
    const state = one<{ thumb: number; processed: number }>('SELECT thumb, processed FROM blobs WHERE sha256 = ?', sha)!;
    assert.deepEqual([state.thumb, state.processed], [0, 0]);
    assert.equal(refreshPreviews(), null);
    await processNow();
    assert.deepEqual([(await show(node.id)).kind, (await show(node.id)).thumb], ['image', true]);
  });
});

describe('Bildformate über ffmpeg', () => {
  it('erzeugt Vorschaubilder für BMP, PSD und TGA', async (context) => {
    const before = { ...tools };
    await detectTools();
    if (!tools.ffmpeg) {
      Object.assign(tools, before);
      context.skip('ffmpeg ist nicht installiert');
      return;
    }
    try {
      const picture = await put('Bild.bmp', bitmap());
      assert.deepEqual([picture.kind, picture.thumb, picture.rendition], ['image', true, false]);
      const left = await pixel(await image(picture.id, 'thumb'), 10, 10);
      assert.deepEqual([left.width, left.height], [64, 48]);
      assert.ok(left.red > 180 && left.blue < 80);
      const layered = await put('Plakat.psd', photoshop());
      assert.deepEqual([layered.kind, layered.thumb, layered.rendition], ['image', true, true]);
      const right = await pixel(await image(layered.id, 'preview'), 54, 10);
      assert.ok(right.blue > 180 && right.red < 80);
      await processNow();
      const info = await meta(layered.id);
      assert.deepEqual([info.width, info.height], [64, 48]);
      const texture = await put('Textur.tga', targa());
      assert.ok((await pixel(await image(texture.id, 'thumb'), 10, 10)).red > 180);
      const broken = await put('Kaputt.psd', Buffer.from('8BPS kaputt'));
      await processNow();
      assert.equal((await show(broken.id)).thumb, false);
    } finally {
      Object.assign(tools, before);
    }
  });

  it('zeigt diese Formate ohne ffmpeg als Bild ohne Vorschau', async () => {
    const node = await put('Entwurf.psd', photoshop(32, 32));
    assert.deepEqual([node.kind, node.thumb, node.rendition], ['image', false, false]);
    assert.equal((await emi.get(`/api/nodes/${node.id}/thumb`)).statusCode, 404);
  });
});
