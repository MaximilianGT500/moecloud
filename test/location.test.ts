import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import exifr from 'exifr';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { heifExif } from '../src/services/heif.ts';
import { applyBlanks, jpegBlanks, locationBlanks, webpBlanks } from '../src/services/location.ts';
import { Client, createApp, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let root = '';

const photo = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#8040c0' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Moe', Model: 'Kamera 1' },
      IFD2: { DateTimeOriginal: '2025:06:01 10:00:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 0/1 3600/100', GPSLongitudeRef: 'E', GPSLongitude: '135/1 46/1 0/1' },
    })
    .toBuffer();

function firstEntry(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (failed, stream) => {
          if (failed || !stream) return reject(failed);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
      });
      zip.readEntry();
    });
  });
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('Standort in geteilten Fotos', () => {
  let original: Buffer;
  let file = '';
  let folder = '';
  let token = '';

  before(async () => {
    original = await photo();
    folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Kyoto' })).json().node.id;
    file = (await emi.upload(folder, 'Tempel.jpg', original, 4096)).json().node.id;
    token = (await emi.json('POST', `/api/nodes/${folder}/links`, {})).json().link.token;
  });

  it('entfernt GPS-Daten aus Downloads über Links und lässt den Rest heil', async () => {
    assert.ok((await exifr.gps(original))?.latitude);
    const guest = new Client(app);
    const shared = await guest.get(`/api/public/${token}/nodes/${file}/content?download=1`);
    assert.equal(shared.statusCode, 200);
    assert.equal(shared.rawPayload.length, original.length);
    assert.equal(await exifr.gps(shared.rawPayload), undefined);
    const tags = await exifr.parse(shared.rawPayload);
    assert.equal(tags.Make, 'Moe');
    assert.ok(tags.DateTimeOriginal instanceof Date);
    assert.equal((await sharp(shared.rawPayload).metadata()).width, 64);
    assert.notEqual(shared.headers.etag, `"${(await emi.get(`/api/nodes/${file}`)).json().node.version}"`);
    const part = await guest.get(`/api/public/${token}/nodes/${file}/content?download=1`, { range: 'bytes=100-399' });
    assert.equal(part.statusCode, 206);
    assert.deepEqual(part.rawPayload, shared.rawPayload.subarray(100, 400));
  });

  it('lässt die eigenen Dateien unverändert', async () => {
    const own = await emi.get(`/api/nodes/${file}/content?download=1`);
    assert.deepEqual(own.rawPayload, original);
  });

  it('entfernt GPS-Daten auch im ZIP', async () => {
    const download = await new Client(app).get(`/api/public/${token}/zip`);
    assert.equal(download.statusCode, 200);
    const entry = await firstEntry(download.rawPayload);
    assert.equal(entry.length, original.length);
    assert.equal(await exifr.gps(entry), undefined);
  });

  it('lässt sich ausschalten', async () => {
    const saved = await emi.json('PATCH', '/api/admin/settings', { 'share.stripLocation': false });
    assert.equal(saved.statusCode, 200, saved.body);
    const shared = await new Client(app).get(`/api/public/${token}/nodes/${file}/content?download=1`);
    assert.deepEqual(shared.rawPayload, original);
    await emi.json('PATCH', '/api/admin/settings', { 'share.stripLocation': true });
  });

  it('findet Standorte in XMP und WebP', async () => {
    const xmp = Buffer.from(
      'http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta><rdf:Description exif:GPSLatitude="35,0.6N"/></x:xmpmeta>',
      'latin1'
    );
    const segment = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(xmp.length + 2) >> 8, (xmp.length + 2) & 0xff]), xmp]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), segment, Buffer.from([0xff, 0xda, 0x00, 0x02])]);
    const blanks = jpegBlanks(jpeg);
    assert.equal(blanks.length, 1);
    assert.equal(blanks[0].fill, 0x20);
    assert.equal(blanks[0].end, 4 + 2 + xmp.length);
    const webp = await sharp(await photo())
      .webp()
      .keepExif()
      .toBuffer();
    const tiff = async (data: Buffer) => (await sharp(data).metadata()).exif!.subarray(6);
    assert.ok((await exifr.gps(await tiff(webp)))?.latitude);
    const clean = applyBlanks(webp, 0, webpBlanks(webp));
    assert.equal(await exifr.gps(await tiff(clean)), undefined);
    assert.equal((await sharp(clean).metadata()).width, 64);
  });

  it('findet Standorte in HEIF-Containern', async () => {
    const heif = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#40c080' } })
      .avif()
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 0/1 3600/100', GPSLongitudeRef: 'E', GPSLongitude: '135/1 46/1 0/1' } })
      .toBuffer();
    const path = join(tmpdir(), `moecloud-standort-${process.pid}.heic`);
    writeFileSync(path, heif);
    try {
      assert.ok((await exifr.gps((await heifExif(path))!))?.latitude);
      const blanks = await locationBlanks(path, `heif-${process.pid}`, 'image/heic');
      assert.ok(blanks.length > 0);
      writeFileSync(path, applyBlanks(heif, 0, blanks));
      assert.equal(await exifr.gps((await heifExif(path))!), undefined);
      assert.equal((await sharp(path).metadata()).width, 64);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
