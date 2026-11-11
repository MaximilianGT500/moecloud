import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import yauzl from 'yauzl';
import { Client, createApp, login, setUp } from './helpers.ts';
import { plain } from './images.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaId = 0;

interface Shown {
  id: string;
  name: string;
  tags: string[];
}

async function folder(parent: string, name: string): Promise<string> {
  const response = await emi.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

async function file(parent: string, name: string, content = 'Hallo Mia'): Promise<string> {
  const response = await emi.upload(parent, name, Buffer.from(content));
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await app.close();
});

describe('Schlagwörter', () => {
  it('legt Schlagwörter an, benennt sie um und hält Namen eindeutig', async () => {
    const created = await emi.json('POST', '/api/tags', { name: '  Urlaub   2026 ', color: 'teal' });
    assert.equal(created.statusCode, 200, created.body);
    assert.deepEqual({ ...created.json().tag, id: undefined }, { id: undefined, name: 'Urlaub 2026', color: 'teal', count: 0 });
    const twice = await emi.json('POST', '/api/tags', { name: 'urlaub 2026', color: 'red' });
    assert.equal(twice.statusCode, 409);
    assert.equal(twice.json().error.message, 'Das Schlagwort „urlaub 2026“ gibt es schon');
    assert.equal((await emi.json('POST', '/api/tags', { name: 'x', color: 'beige' })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/tags', { name: '   ', color: 'red' })).json().error.message, 'Gib einen Namen ein');
    const id = created.json().tag.id;
    const renamed = await emi.json('PATCH', `/api/tags/${id}`, { name: 'Reisen', color: 'blue' });
    assert.deepEqual([renamed.json().tag.name, renamed.json().tag.color], ['Reisen', 'blue']);
    const other = (await emi.json('POST', '/api/tags', { name: 'Arbeit', color: 'red' })).json().tag.id;
    assert.equal((await emi.json('PATCH', `/api/tags/${other}`, { name: 'REISEN' })).statusCode, 409);
    const list = (await emi.get('/api/tags')).json().items.map((tag: { name: string }) => tag.name);
    assert.deepEqual(list, ['Arbeit', 'Reisen']);
  });

  it('vergibt und entfernt Schlagwörter für mehrere Elemente', async () => {
    const tags = (await emi.get('/api/tags')).json().items as { id: string; name: string }[];
    const [work, travel] = [tags.find((tag) => tag.name === 'Arbeit')!.id, tags.find((tag) => tag.name === 'Reisen')!.id];
    const place = await folder(root, 'Ablage');
    const a = await file(place, 'Rechnung.txt');
    const b = await file(place, 'Plan.txt');
    const sub = await folder(place, 'Fotos');
    const applied = await emi.json('PUT', '/api/nodes/tags', { ids: [a, b, sub], add: [work, travel] });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().count, 3);
    await emi.json('PUT', '/api/nodes/tags', { ids: [b], remove: [travel] });
    const items = (await emi.get(`/api/nodes/${place}/children`)).json().items as Shown[];
    const byName = Object.fromEntries(items.map((item) => [item.name, item.tags]));
    assert.deepEqual(byName['Rechnung.txt'], [work, travel]);
    assert.deepEqual(byName['Plan.txt'], [work]);
    assert.deepEqual(byName.Fotos, [work, travel]);
    const view = (await emi.get(`/api/tags/${work}/nodes`)).json();
    assert.equal(view.tag.name, 'Arbeit');
    assert.deepEqual(view.items.map((item: Shown) => item.name).sort(), ['Fotos', 'Plan.txt', 'Rechnung.txt']);
    assert.equal(view.items.find((item: Shown) => item.name === 'Plan.txt').location, 'Ablage');
    const counts = Object.fromEntries(
      (await emi.get('/api/tags')).json().items.map((tag: { name: string; count: number }) => [tag.name, tag.count])
    );
    assert.deepEqual(counts, { Arbeit: 3, Reisen: 2 });
    assert.equal((await emi.json('PUT', '/api/nodes/tags', { ids: [root], add: [work] })).statusCode, 400);
  });

  it('blendet Elemente im Papierkorb aus und löscht Zuordnungen mit dem Schlagwort', async () => {
    const tag = (await emi.json('POST', '/api/tags', { name: 'Kurz', color: 'pink' })).json().tag.id;
    const note = await file(root, 'Notiz.txt');
    await emi.json('PUT', '/api/nodes/tags', { ids: [note], add: [tag] });
    await emi.json('POST', '/api/nodes/trash', { ids: [note] });
    assert.deepEqual((await emi.get(`/api/tags/${tag}/nodes`)).json().items, []);
    await emi.json('POST', '/api/nodes/restore', { ids: [note] });
    assert.equal((await emi.get(`/api/tags/${tag}/nodes`)).json().items.length, 1);
    assert.equal((await emi.json('DELETE', `/api/tags/${tag}`)).statusCode, 200);
    assert.equal((await emi.get(`/api/tags/${tag}/nodes`)).statusCode, 404);
    const item = ((await emi.get(`/api/nodes/${root}/children`)).json().items as Shown[]).find((entry) => entry.name === 'Notiz.txt');
    assert.deepEqual(item?.tags, []);
  });

  it('bleibt privat und gilt auch für geteilte Elemente', async () => {
    const shared = await folder(root, 'Gemeinsam');
    const plan = await file(shared, 'Reiseplan.txt');
    const own = (await emi.json('POST', '/api/tags', { name: 'Emis Wort', color: 'green' })).json().tag.id;
    await emi.json('PUT', '/api/nodes/tags', { ids: [plan], add: [own] });
    const granted = await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    assert.equal(granted.statusCode, 200, granted.body);
    const seen = ((await mia.get(`/api/nodes/${shared}/children`)).json().items as Shown[]).find((item) => item.name === 'Reiseplan.txt');
    assert.deepEqual(seen?.tags, []);
    assert.deepEqual((await mia.get('/api/tags')).json().items, []);
    assert.equal((await mia.get(`/api/tags/${own}/nodes`)).statusCode, 404);
    assert.equal((await mia.json('PUT', '/api/nodes/tags', { ids: [plan], add: [own] })).statusCode, 404);
    const hers = (await mia.json('POST', '/api/tags', { name: 'Emis Wort', color: 'yellow' })).json().tag.id;
    assert.equal((await mia.json('PUT', '/api/nodes/tags', { ids: [plan], add: [hers] })).statusCode, 200);
    assert.deepEqual(
      (await mia.get(`/api/tags/${hers}/nodes`)).json().items.map((item: Shown) => item.name),
      ['Reiseplan.txt']
    );
    assert.equal((await mia.get(`/api/tags/${hers}/nodes`)).json().items[0].location, null);
    const secret = await file(root, 'Geheim.txt');
    assert.equal((await mia.json('PUT', '/api/nodes/tags', { ids: [secret], add: [hers] })).statusCode, 404);
    const grant = (await emi.get(`/api/nodes/${shared}/shares`)).json().grants[0].id;
    await emi.json('DELETE', `/api/grants/${grant}`);
    assert.deepEqual((await mia.get(`/api/tags/${hers}/nodes`)).json().items, []);
    assert.equal((await mia.get('/api/tags')).json().items[0].count, 0);
  });
});

async function photo(parent: string, name: string, colour: string, client = emi): Promise<string> {
  const response = await client.upload(parent, name, await plain(64, 48, colour));
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

function zipNames(data: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names.sort()));
      zip.readEntry();
    });
  });
}

describe('Alben', () => {
  let trip = '';
  let photos: string[] = [];

  before(async () => {
    const one = await folder(root, 'Kamera');
    const two = await folder(root, 'Handy');
    photos = [await photo(one, 'Strand.jpg', '#2080c0'), await photo(two, 'Berg.jpg', '#20a040'), await photo(two, 'Wald.jpg', '#107020')];
  });

  it('sammelt Bilder aus mehreren Ordnern ohne sie zu verschieben', async () => {
    const created = await emi.json('POST', '/api/albums', { name: ' Sommer   2026 ', ids: photos.slice(0, 2) });
    assert.equal(created.statusCode, 200, created.body);
    const album = created.json().album;
    trip = album.id;
    assert.deepEqual([album.name, album.count, album.coverId], ['Sommer 2026', 2, null]);
    assert.ok(album.cover && album.from && album.to);
    const added = await emi.json('POST', `/api/albums/${trip}/items`, { ids: [photos[2], photos[0]] });
    assert.equal(added.json().added, 1);
    const content = (await emi.get(`/api/albums/${trip}`)).json();
    assert.deepEqual(content.items.map((item: Shown) => item.name).sort(), ['Berg.jpg', 'Strand.jpg', 'Wald.jpg']);
    assert.equal(content.album.count, 3);
    const where = ((await emi.get(`/api/nodes/${root}/children`)).json().items as Shown[]).map((item) => item.name);
    assert.ok(where.includes('Kamera') && where.includes('Handy'));
    const list = (await emi.get('/api/albums')).json().items;
    assert.deepEqual(
      list.map((entry: { name: string; count: number }) => [entry.name, entry.count]),
      [['Sommer 2026', 3]]
    );
  });

  it('nimmt nur Bilder und Videos und prüft das Titelbild', async () => {
    const text = await file(root, 'Liste.txt');
    const rejected = await emi.json('POST', `/api/albums/${trip}/items`, { ids: [text] });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.message, 'In Alben kommen nur Bilder und Videos');
    assert.equal((await emi.json('POST', `/api/albums/${trip}/items`, { ids: [root] })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/albums', { name: 'Leer', ids: [text] })).statusCode, 400);
    assert.equal(((await emi.get('/api/albums')).json().items as unknown[]).length, 1);
    const outside = await photo(root, 'Allein.jpg', '#c02020');
    const wrong = await emi.json('PATCH', `/api/albums/${trip}`, { coverId: outside });
    assert.equal(wrong.json().error.message, 'Das Titelbild muss im Album liegen');
    const cover = await emi.json('PATCH', `/api/albums/${trip}`, { coverId: photos[0], name: 'Sommer' });
    assert.deepEqual([cover.json().album.name, cover.json().album.coverId, cover.json().album.cover.id], ['Sommer', photos[0], photos[0]]);
    const removed = await emi.json('POST', `/api/albums/${trip}/remove`, { ids: [photos[0]] });
    assert.equal(removed.json().removed, 1);
    const after = (await emi.get(`/api/albums/${trip}`)).json().album;
    assert.deepEqual([after.count, after.coverId], [2, null]);
    await emi.json('POST', `/api/albums/${trip}/items`, { ids: [photos[0]] });
  });

  it('blendet Bilder im Papierkorb aus und vergisst endgültig gelöschte', async () => {
    await emi.json('POST', '/api/nodes/trash', { ids: [photos[1]] });
    assert.equal((await emi.get(`/api/albums/${trip}`)).json().album.count, 2);
    await emi.json('POST', '/api/nodes/restore', { ids: [photos[1]] });
    assert.equal((await emi.get(`/api/albums/${trip}`)).json().album.count, 3);
    const extra = await photo(root, 'Weg.jpg', '#808080');
    await emi.json('POST', `/api/albums/${trip}/items`, { ids: [extra] });
    await emi.json('POST', '/api/nodes/trash', { ids: [extra] });
    await emi.json('POST', '/api/nodes/delete', { ids: [extra] });
    assert.equal((await emi.get(`/api/albums/${trip}`)).json().album.count, 3);
  });

  it('lädt ein Album als ZIP herunter und löscht nur das Album', async () => {
    const download = await emi.get(`/api/albums/${trip}/zip`);
    assert.equal(download.statusCode, 200);
    assert.match(String(download.headers['content-disposition']), /Sommer\.zip/);
    assert.deepEqual(await zipNames(download.rawPayload), ['Berg.jpg', 'Strand.jpg', 'Wald.jpg']);
    const doomed = (await emi.json('POST', '/api/albums', { name: 'Kurz', ids: [photos[0]] })).json().album.id;
    assert.equal((await emi.json('DELETE', `/api/albums/${doomed}`)).statusCode, 200);
    assert.equal((await emi.get(`/api/albums/${doomed}`)).statusCode, 404);
    assert.equal((await emi.get(`/api/nodes/${photos[0]}`)).statusCode, 200);
  });

  it('gehört nur einer Person und zeigt Geteiltes nur mit Zugriff', async () => {
    assert.deepEqual((await mia.get('/api/albums')).json().items, []);
    assert.equal((await mia.get(`/api/albums/${trip}`)).statusCode, 404);
    assert.equal((await mia.json('POST', `/api/albums/${trip}/items`, { ids: photos })).statusCode, 404);
    const shared = await folder(root, 'Für Mia');
    const gift = await photo(shared, 'Geschenk.jpg', '#c0a020');
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    const hers = (await mia.json('POST', '/api/albums', { name: 'Von Emi', ids: [gift] })).json().album;
    assert.equal(hers.count, 1);
    assert.equal((await mia.json('POST', `/api/albums/${hers.id}/items`, { ids: [photos[0]] })).statusCode, 404);
    const grant = (await emi.get(`/api/nodes/${shared}/shares`)).json().grants[0].id;
    await emi.json('DELETE', `/api/grants/${grant}`);
    const after = (await mia.get(`/api/albums/${hers.id}`)).json();
    assert.deepEqual([after.album.count, after.items.length, after.album.cover], [0, 0, null]);
  });
});

describe('Mehrere umbenennen', () => {
  let place = '';
  const names = async () =>
    (await emi.get(`/api/nodes/${place}/children`))
      .json()
      .items.map((item: Shown) => item.name)
      .sort();

  before(async () => {
    place = await folder(root, 'Umbenennen');
  });

  it('benennt mehrere auf einmal um und tauscht Namen', async () => {
    const first = await file(place, 'IMG_0001.jpg');
    const second = await file(place, 'IMG_0002.jpg');
    const notes = await file(place, 'Notizen.txt');
    const response = await emi.json('POST', '/api/nodes/rename', {
      items: [
        { id: first, name: 'IMG_0002.jpg' },
        { id: second, name: 'IMG_0001.jpg' },
        { id: notes, name: 'Notizen.txt' },
      ],
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      response.json().items.map((item: Shown) => item.name),
      ['IMG_0002.jpg', 'IMG_0001.jpg', 'Notizen.txt']
    );
    assert.deepEqual(await names(), ['IMG_0001.jpg', 'IMG_0002.jpg', 'Notizen.txt']);
    const renamed = (await emi.json('POST', '/api/nodes/rename', { items: [{ id: notes, name: 'Liste von Lea.md' }] })).json().items[0];
    assert.equal(renamed.mime, 'text/markdown');
    const activity = (await emi.get('/api/activity')).json().items;
    assert.ok(activity.some((entry: { action: string; name: string }) => entry.action === 'rename' && entry.name === 'Liste von Lea.md'));
  });

  it('prüft alle Namen bevor es etwas ändert', async () => {
    const one = await file(place, 'Eins.txt');
    const two = await file(place, 'Zwei.txt');
    const before = await names();
    const clash = await emi.json('POST', '/api/nodes/rename', {
      items: [
        { id: one, name: 'Neu.txt' },
        { id: two, name: 'IMG_0001.jpg' },
      ],
    });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.message, 'Hier gibt es schon etwas mit dem Namen „IMG_0001.jpg“');
    const twice = await emi.json('POST', '/api/nodes/rename', {
      items: [
        { id: one, name: 'Gleich.txt' },
        { id: two, name: 'gleich.TXT' },
      ],
    });
    assert.equal(twice.statusCode, 409);
    assert.equal((await emi.json('POST', '/api/nodes/rename', { items: [{ id: one, name: 'a/b' }] })).statusCode, 400);
    const repeated = await emi.json('POST', '/api/nodes/rename', {
      items: [
        { id: one, name: 'A.txt' },
        { id: one, name: 'B.txt' },
      ],
    });
    assert.equal(repeated.json().error.message, 'Jedes Element darf nur einmal vorkommen');
    assert.deepEqual(await names(), before);
  });

  it('braucht Bearbeitungsrechte', async () => {
    const shared = await folder(root, 'Nur lesen');
    const inside = await file(shared, 'Plan.txt');
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    const denied = await mia.json('POST', '/api/nodes/rename', { items: [{ id: inside, name: 'Meins.txt' }] });
    assert.equal(denied.statusCode, 403);
    assert.equal((await emi.get(`/api/nodes/${inside}`)).json().node.name, 'Plan.txt');
  });
});

describe('Als ZIP packen', () => {
  let place = '';
  let pictures = '';
  let notes = '';

  before(async () => {
    place = await folder(root, 'Packen');
    pictures = await folder(place, 'Bilder');
    await file(pictures, 'Strand.txt', 'Sand');
    await folder(pictures, 'Leer');
    notes = await file(place, 'Notizen.txt', 'Hallo Lea');
  });

  it('packt Ordner und Dateien in ein Archiv daneben', async () => {
    const response = await emi.json('POST', '/api/nodes/zip', { ids: [pictures, notes], name: 'Paket' });
    assert.equal(response.statusCode, 200, response.body);
    const node = response.json().node;
    assert.equal(node.name, 'Paket.zip');
    assert.equal(node.parentId, place);
    const content = await emi.get(`/api/nodes/${node.id}/content`);
    assert.deepEqual(await zipNames(content.rawPayload), ['Bilder/', 'Bilder/Leer/', 'Bilder/Strand.txt', 'Notizen.txt']);
    const again = await emi.json('POST', '/api/nodes/zip', { ids: [notes], name: 'Paket.zip' });
    assert.equal(again.json().node.name, 'Paket (2).zip');
    assert.equal((await emi.json('POST', '/api/nodes/zip', { ids: [notes], name: ' ' })).statusCode, 400);
  });

  it('legt das Archiv ohne Schreibrecht in die eigenen Dateien', async () => {
    const shared = await folder(root, 'Zum Packen');
    const inside = await file(shared, 'Liste.txt', 'Milch');
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    const response = await mia.json('POST', '/api/nodes/zip', { ids: [inside], name: 'Von Emi' });
    assert.equal(response.statusCode, 200, response.body);
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    assert.equal(response.json().node.parentId, miaRoot);
    assert.deepEqual(await zipNames((await mia.get(`/api/nodes/${response.json().node.id}/content`)).rawPayload), ['Liste.txt']);
  });

  it('hält Speicherplatz und Dateigröße ein', async () => {
    const big = (await emi.upload(place, 'Rauschen.bin', randomBytes(4000))).json().node.id;
    await emi.json('PATCH', '/api/admin/settings', { 'storage.maxUpload': 1000 });
    const limited = await emi.json('POST', '/api/nodes/zip', { ids: [big], name: 'Zu groß' });
    assert.equal(limited.statusCode, 413);
    await emi.json('PATCH', '/api/admin/settings', { 'storage.maxUpload': 0 });
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: 1024 });
    await emi.json('POST', `/api/nodes/${place}/grants`, { userId: miaId, permission: 'view' });
    const full = await mia.json('POST', '/api/nodes/zip', { ids: [big], name: 'Voll' });
    assert.equal(full.statusCode, 507);
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: null });
    const names = (await emi.get(`/api/nodes/${place}/children`)).json().items.map((item: Shown) => item.name);
    assert.ok(!names.some((name: string) => name.startsWith('Zu groß')));
  });
});
