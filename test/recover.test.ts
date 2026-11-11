import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { createApp, setUp, zip, type Client } from './helpers.ts';
import { proRaw } from './images.ts';
import { config } from '../src/config.ts';
import { all, one, value } from '../src/lib/db.ts';
import { blobPath } from '../src/services/blobs.ts';
import type { NodeRow } from '../src/services/nodes.ts';
import { processNow } from '../src/services/processing.ts';
import { hintOf, identify, recoverFiles, surveyStrays } from '../src/services/recover.ts';
import { findByUsername } from '../src/services/users.ts';

const app = await createApp();
let emi: Client;

const at = (year: number, month: number, day: number, hour = 12, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second);

function plant(content: Buffer, modified: Date, sha = createHash('sha256').update(content).digest('hex')) {
  const path = blobPath(sha);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  utimesSync(path, modified, modified);
  return sha;
}

function syncsafe(target: Buffer, offset: number, size: number) {
  for (let index = 0; index < 4; index++) target[offset + index] = (size >> (21 - index * 7)) & 0x7f;
}

function mp3(tags: Record<string, string>) {
  const frames = Object.entries(tags).map(([id, text]) => {
    const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    syncsafe(header, 4, data.length);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(frames);
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  syncsafe(header, 6, body.length);
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([header, body, ...Array.from({ length: 6 }, () => frame)]);
}

function wav() {
  const data = Buffer.alloc(44 + 1600);
  data.write('RIFF', 0, 'latin1');
  data.writeUInt32LE(36 + 1600, 4);
  data.write('WAVEfmt ', 8, 'latin1');
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36, 'latin1');
  data.writeUInt32LE(1600, 40);
  return data;
}

function box(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function wordDocument() {
  const file = Buffer.alloc(512 * 3);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(file, 0);
  file.writeUInt16LE(0x3e, 24);
  file.writeUInt16LE(3, 26);
  file.writeUInt16LE(0xfffe, 28);
  file.writeUInt16LE(9, 30);
  file.writeUInt16LE(6, 32);
  file.writeUInt32LE(1, 44);
  file.writeUInt32LE(1, 48);
  file.writeUInt32LE(4096, 56);
  file.writeUInt32LE(0xfffffffe, 60);
  file.writeUInt32LE(0xfffffffe, 68);
  file.writeUInt32LE(0, 76);
  for (let index = 1; index < 109; index++) file.writeUInt32LE(0xffffffff, 76 + index * 4);
  for (let index = 0; index < 128; index++)
    file.writeUInt32LE(index === 0 ? 0xfffffffd : index === 1 ? 0xfffffffe : 0xffffffff, 512 + index * 4);
  const entry = (slot: number, name: string, type: number) => {
    const offset = 1024 + slot * 128;
    file.write(name, offset, 'utf16le');
    file.writeUInt16LE((name.length + 1) * 2, offset + 64);
    file[offset + 66] = type;
    file.writeUInt32LE(0xffffffff, offset + 68);
    file.writeUInt32LE(0xffffffff, offset + 72);
    file.writeUInt32LE(slot === 0 ? 1 : 0xffffffff, offset + 76);
  };
  entry(0, 'Root Entry', 5);
  entry(1, 'WordDocument', 2);
  return file;
}

async function children(parentId: string) {
  return all<NodeRow>('SELECT * FROM nodes WHERE parent_id = ? AND trashed_at IS NULL ORDER BY name_key', parentId);
}

function child(parentId: string, name: string) {
  const node = one<NodeRow>('SELECT * FROM nodes WHERE parent_id = ? AND name = ? AND trashed_at IS NULL', parentId, name);
  assert.ok(node, `${name} fehlt`);
  return node;
}

function walk(rootId: string, path: string) {
  return path.split('/').reduce((node, name) => child(node.id, name), { id: rootId } as NodeRow);
}

let rootId = '';
let known = '';
let broken = '';
const planted = new Map<string, string>();

before(async () => {
  emi = await setUp(app);
  rootId = findByUsername('emi')!.root_id;
  const upload = await emi.upload(rootId, 'bekannt.txt', Buffer.from('Diese Datei kennt die Datenbank schon'), 1024);
  assert.equal(upload.statusCode, 200, upload.body);
  known = createHash('sha256').update('Diese Datei kennt die Datenbank schon').digest('hex');

  const photo = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#8b5cf6' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Moe', Model: 'Kamera' }, IFD2: { DateTimeOriginal: '2024:07:14 18:32:05' } })
    .toBuffer();
  const plain = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#10b981' } })
    .png()
    .toBuffer();
  const docx = await zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml':
      '<w:document><w:body><w:p><w:r><w:t>Mietvertrag für Lea</w:t></w:r></w:p><w:p><w:r><w:t>Seite 1</w:t></w:r></w:p></w:body></w:document>',
  });
  const files: [string, Buffer, Date][] = [
    ['foto', photo, at(2026, 1, 2)],
    ['raw', Buffer.from(await proRaw()), at(2026, 1, 3)],
    ['png', plain, at(2025, 3, 1, 10, 0, 0)],
    ['heic', readFileSync(join(import.meta.dirname, 'fixtures/hochkant-p3.heic')), at(2025, 4, 1)],
    [
      'svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
      at(2025, 4, 2, 8, 0, 0),
    ],
    ['mp3', mp3({ TIT2: 'Sommerlied', TPE1: 'Lea' }), at(2025, 5, 1)],
    ['wav', wav(), at(2025, 5, 2, 7, 30, 0)],
    [
      'mp4',
      Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1')), box('mdat', Buffer.alloc(64))]),
      at(2023, 12, 24, 18, 0, 0),
    ],
    ['pdf', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), at(2025, 5, 5, 9, 0, 0)],
    ['pdf2', Buffer.from('%PDF-1.4\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), at(2025, 5, 5, 9, 0, 0)],
    ['docx', docx, at(2025, 6, 1, 11, 0, 0)],
    ['doc', wordDocument(), at(2025, 6, 2, 11, 0, 0)],
    ['csv', Buffer.from('Name;Ort\nEmi;Berlin\nMia;Hamburg\nLea;Köln\n'), at(2025, 6, 3, 11, 0, 0)],
    ['md', Buffer.from('# Einkaufsliste\n\n- Äpfel für Emi\n- Brot für Mia\n'), at(2025, 6, 4, 11, 0, 0)],
    ['txt', Buffer.from('Notizen für Mia:\nMorgen anrufen\n'), at(2025, 6, 4, 11, 0, 0)],
    ['json', Buffer.from('{"name":"Lea","stadt":"Köln"}'), at(2025, 6, 5, 11, 0, 0)],
    ['zip', await zip({ 'notiz.txt': 'Mia' }), at(2025, 6, 6, 11, 0, 0)],
    ['bin', Buffer.from('MOEDATA\0\xff\x10\x20binär', 'latin1'), at(2025, 6, 7, 11, 0, 0)],
    ['leer', Buffer.alloc(0), at(2025, 6, 8, 11, 0, 0)],
  ];
  for (const [key, content, modified] of files) planted.set(key, plant(content, modified));
  broken = plant(Buffer.from('Dieser Inhalt passt nicht zum Namen'), at(2025, 7, 1), 'ab'.repeat(32));
  writeFileSync(join(config.paths.blobs, 'notizen-von-mia.txt'), 'Mia');
  writeFileSync(join(config.paths.blobs, 'ab', 'kein-blob'), 'Lea');
});

after(() => app.close());

describe('Dateien ohne Datenbank wiederherstellen', () => {
  it('erkennt die Art am Inhalt', async () => {
    const kinds = Object.fromEntries(
      await Promise.all([...planted].map(async ([key, sha]) => [key, await identify(blobPath(sha), readFileSync(blobPath(sha)).length)]))
    );
    assert.deepEqual(kinds, {
      foto: 'jpg',
      raw: 'dng',
      png: 'png',
      heic: 'heic',
      svg: 'svg',
      mp3: 'mp3',
      wav: 'wav',
      mp4: 'mp4',
      pdf: 'pdf',
      pdf2: 'pdf',
      docx: 'docx',
      doc: 'doc',
      csv: 'csv',
      md: 'md',
      txt: 'txt',
      json: 'json',
      zip: 'zip',
      bin: 'bin',
      leer: '',
    });
  });

  it('nimmt die erste sinnvolle Zeile als Namen', () => {
    assert.equal(hintOf('\n\n# Reise nach Kyoto\nTag 1'), 'Reise nach Kyoto');
    assert.equal(hintOf('---\n- [Packliste](packliste.md) für **Emi**'), 'Packliste für Emi');
    assert.equal(hintOf('{\n  "a": 1\n}'), '');
    assert.equal(hintOf('Rechnung: 2026/114?'), 'Rechnung 2026/114');
    assert.equal(
      hintOf('Lea schreibt hier einen sehr langen ersten Satz, der weit über sechzig Zeichen hinausgeht und gekürzt wird.'),
      'Lea schreibt hier einen sehr langen ersten Satz, der weit'
    );
  });

  it('zeigt im Probelauf, was es findet, ohne etwas zu ändern', async () => {
    const before = value<number>('SELECT COUNT(*) FROM nodes');
    const survey = await surveyStrays();
    assert.equal(survey.count, planted.size + 1);
    assert.equal(survey.foreign, 2);
    assert.equal(survey.kinds.image?.count, 5);
    assert.equal(survey.kinds.pdf?.count, 2);
    assert.equal(value<number>('SELECT COUNT(*) FROM nodes'), before);
  });

  it('holt alle unbekannten Dateien mit Namen aus Aufnahmedatum und Tags zurück', async () => {
    const emiRow = findByUsername('emi')!;
    const steps: number[] = [];
    const result = await recoverFiles(emiRow, (progress) => steps.push(progress.done));
    assert.equal(result.imported, planted.size);
    assert.equal(result.folder, 'Wiederhergestellt');
    assert.deepEqual(result.corrupted, [blobPath(broken)]);
    assert.equal(result.foreign, 2);
    assert.equal(result.overQuota, null);
    assert.equal(steps.at(-1), planted.size + 1);

    const top = walk(rootId, 'Wiederhergestellt');
    assert.deepEqual(
      (await children(top.id)).map((node) => node.name),
      ['Archive', 'Audio', 'Bilder', 'Code', 'Dokumente', 'PDFs', 'Sonstiges', 'Tabellen', 'Texte', 'Videos']
    );
    const photo = walk(rootId, 'Wiederhergestellt/Bilder/2024/2024-07-14 18.32.05.jpg');
    assert.equal(photo.mime, 'image/jpeg');
    assert.equal(photo.owner_id, emiRow.id);
    assert.equal(photo.sha256, planted.get('foto'));
    assert.equal(photo.modified_at, at(2024, 7, 14, 18, 32, 5).getTime());
    assert.equal(walk(rootId, 'Wiederhergestellt/Bilder/2023/2023-08-09 14.15.16.dng').mime, 'image/x-adobe-dng');
    assert.equal(walk(rootId, 'Wiederhergestellt/Bilder/2025/2025-03-01 10.00.00.png').modified_at, at(2025, 3, 1, 10).getTime());
    walk(rootId, 'Wiederhergestellt/Bilder/2025/2025-04-02 08.00.00.svg');
    assert.ok(all<NodeRow>("SELECT * FROM nodes WHERE name LIKE '%.heic'").length === 1);
    assert.equal(walk(rootId, 'Wiederhergestellt/Audio/Lea - Sommerlied.mp3').mime, 'audio/mpeg');
    walk(rootId, 'Wiederhergestellt/Audio/2025-05-02 07.30.00.wav');
    assert.equal(walk(rootId, 'Wiederhergestellt/Videos/2023/2023-12-24 18.00.00.mp4').mime, 'video/mp4');
    const pdfs = (await children(walk(rootId, 'Wiederhergestellt/PDFs').id)).map((node) => node.name);
    assert.deepEqual(pdfs, ['2025-05-05 09.00.00 (2).pdf', '2025-05-05 09.00.00.pdf']);
    walk(rootId, 'Wiederhergestellt/Dokumente/Mietvertrag für Lea.docx');
    assert.equal(walk(rootId, 'Wiederhergestellt/Dokumente/2025-06-02 11.00.00.doc').mime, 'application/msword');
    walk(rootId, 'Wiederhergestellt/Tabellen/2025-06-03 11.00.00.csv');
    walk(rootId, 'Wiederhergestellt/Texte/Einkaufsliste.md');
    walk(rootId, 'Wiederhergestellt/Texte/Notizen für Mia.txt');
    walk(rootId, 'Wiederhergestellt/Code/2025-06-05 11.00.00.json');
    walk(rootId, 'Wiederhergestellt/Archive/2025-06-06 11.00.00.zip');
    walk(rootId, 'Wiederhergestellt/Sonstiges/2025-06-07 11.00.00.bin');
    assert.equal(walk(rootId, 'Wiederhergestellt/Sonstiges/2025-06-08 11.00.00').size, 0);

    for (const sha of planted.values()) assert.equal(value<number>('SELECT refs FROM blobs WHERE sha256 = ?', sha), 1, sha);
    assert.equal(value<number>('SELECT refs FROM blobs WHERE sha256 = ?', known), 1);
    assert.equal(value('SELECT sha256 FROM blobs WHERE sha256 = ?', broken), undefined);
    const entry = one<{ details: string }>("SELECT details FROM audit WHERE action = 'files_recovered'");
    assert.equal(JSON.parse(entry!.details).count, planted.size);
  });

  it('lässt sich gefahrlos wiederholen', async () => {
    const nodes = value<number>('SELECT COUNT(*) FROM nodes');
    const result = await recoverFiles(findByUsername('emi')!);
    assert.equal(result.imported, 0);
    assert.deepEqual(result.corrupted, [blobPath(broken)]);
    assert.equal(value<number>('SELECT COUNT(*) FROM nodes'), nodes);
  });

  it('übergibt die Dateien an die normale Verarbeitung', async () => {
    await processNow();
    assert.equal(value<number>('SELECT COUNT(*) FROM blobs WHERE processed = 0 AND refs > 0'), 0);
    assert.equal(value<number>('SELECT taken_at FROM blobs WHERE sha256 = ?', planted.get('foto')), at(2024, 7, 14, 18, 32, 5).getTime());
    const photo = walk(rootId, 'Wiederhergestellt/Bilder/2024/2024-07-14 18.32.05.jpg');
    const thumb = await emi.get(`/api/nodes/${photo.id}/thumb`);
    assert.equal(thumb.statusCode, 200);
    const listing = (await emi.get(`/api/nodes/${walk(rootId, 'Wiederhergestellt/Audio').id}/children`)).json().items;
    assert.ok(listing.some((item: { name: string }) => item.name === 'Lea - Sommerlied.mp3'));
  });
});
