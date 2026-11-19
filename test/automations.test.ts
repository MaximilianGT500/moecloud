import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, login, setUp } from './helpers.ts';
import { settled } from '../src/services/automations.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let inbox = '';
let archive = '';
let tag = '';
const year = String(new Date().getFullYear());
const today = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

async function folder(client: Client, parent: string, name: string): Promise<string> {
  return (await client.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function file(client: Client, parent: string, name: string, content: Buffer | string = 'Hallo Lea') {
  const response = await client.upload(parent, name, Buffer.from(content), 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  await settled();
  return response.json().node.id as string;
}

const names = async (client: Client, id: string) =>
  ((await client.get(`/api/nodes/${id}/children`)).json().items as { name: string }[]).map((item) => item.name).sort();

const child = async (client: Client, id: string, name: string) =>
  ((await client.get(`/api/nodes/${id}/children`)).json().items as { id: string; name: string; tags?: string[]; starred?: boolean }[]).find(
    (item) => item.name === name
  );

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  inbox = await folder(emi, root, 'Eingang');
  archive = await folder(emi, root, 'Archiv');
  tag = (await emi.json('POST', '/api/tags', { name: 'Rechnung', color: 'green' })).json().tag.id;
});

after(async () => {
  await app.close();
});

describe('Abläufe', () => {
  let rule = '';

  it('benennt neue Dateien um, vergibt ein Schlagwort und sortiert sie nach Jahr ein', async () => {
    const created = await emi.json('POST', '/api/automations', {
      name: 'Rechnungen ablegen',
      folderId: inbox,
      conditions: { kinds: ['pdf'] },
      actions: [
        { type: 'tag', tagId: tag },
        { type: 'rename', pattern: '{datum} {name}' },
        { type: 'move', folderId: archive, by: 'year' },
      ],
    });
    assert.equal(created.statusCode, 200, created.body);
    rule = created.json().automation.id;
    assert.equal(created.json().automation.folderName, 'Eingang');
    assert.equal(created.json().automation.actions[2].folderName, 'Archiv');
    await file(emi, inbox, 'Strom.pdf', '%PDF-1.4 Strom');
    await file(emi, inbox, 'Notiz.txt', 'bleibt liegen');
    assert.deepEqual(await names(emi, inbox), ['Notiz.txt']);
    assert.deepEqual(await names(emi, archive), [year]);
    const yearFolder = (await child(emi, archive, year))!.id;
    const moved = await child(emi, yearFolder, `${today} Strom.pdf`);
    assert.ok(moved, JSON.stringify(await names(emi, yearFolder)));
    assert.deepEqual(moved.tags, [tag]);
    const listed = (await emi.get(`/api/automations?folder=${inbox}`)).json().items;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].runs, 1);
    assert.equal(listed[0].error, null);
    assert.deepEqual((await mia.get('/api/automations')).json().items, []);
  });

  it('greift auch bei Dateien, die über einen Link zum Hochladen kommen', async () => {
    const link = (await emi.json('POST', `/api/nodes/${inbox}/links`, { uploadOnly: true })).json().link;
    const visitor = new Client(app);
    await visitor.get(`/s/${link.token}`, { accept: 'text/html' });
    const init = await visitor.json('POST', `/api/public/${link.token}/uploads`, { parentId: inbox, name: 'Wasser.pdf', size: 9 });
    assert.equal(init.statusCode, 200, init.body);
    await visitor.send({
      method: 'PUT',
      url: `/api/public/${link.token}/uploads/${init.json().id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('%PDF-1.4 '),
    });
    const done = await visitor.json('POST', `/api/public/${link.token}/uploads/${init.json().id}/complete`);
    assert.equal(done.statusCode, 200, done.body);
    await settled();
    const yearFolder = (await child(emi, archive, year))!.id;
    assert.ok((await names(emi, yearFolder)).includes(`${today} Wasser.pdf`));
  });

  it('markiert und meldet, auch in Unterordnern, wenn der Ablauf das vorsieht', async () => {
    const photos = await folder(emi, root, 'Fotos');
    const trip = await folder(emi, photos, 'Reise');
    const flat = (
      await emi.json('POST', '/api/automations', {
        name: 'Nur oben',
        folderId: photos,
        actions: [{ type: 'star' }],
      })
    ).json().automation.id;
    await file(emi, trip, 'Tief.txt');
    assert.equal((await child(emi, trip, 'Tief.txt'))!.starred, false);
    await emi.json('PATCH', `/api/automations/${flat}`, { deep: true, actions: [{ type: 'star' }, { type: 'notify' }] });
    await file(emi, trip, 'Strand.txt');
    assert.equal((await child(emi, trip, 'Strand.txt'))!.starred, true);
    const notes = (await emi.get('/api/notifications')).json().items as { title: string }[];
    assert.ok(notes.some((note) => note.title === 'Ablauf „Nur oben“ hat „Strand.txt“ bearbeitet'));
    await emi.json('PATCH', `/api/automations/${flat}`, { enabled: false });
    await file(emi, photos, 'Aus.txt');
    assert.equal((await child(emi, photos, 'Aus.txt'))!.starred, false);
  });

  it('wendet einen Ablauf auf Wunsch auf vorhandene Dateien an', async () => {
    const scans = await folder(emi, root, 'Scans');
    await file(emi, scans, 'Brief.pdf', '%PDF-1.4 a');
    await file(emi, scans, 'Bild.png', 'kein pdf');
    const created = (
      await emi.json('POST', '/api/automations', {
        name: 'Nummerieren',
        folderId: scans,
        conditions: { extensions: ['PDF'], nameContains: 'brief' },
        actions: [{ type: 'rename', pattern: 'Scan {nummer} {name}' }],
        enabled: false,
      })
    ).json().automation;
    assert.deepEqual(created.conditions.extensions, ['pdf']);
    const result = (await emi.json('POST', `/api/automations/${created.id}/run`)).json();
    assert.equal(result.applied, 1);
    assert.equal(result.checked, 2);
    assert.deepEqual(await names(emi, scans), ['Bild.png', 'Scan 001 Brief.pdf']);
  });

  it('prüft Eingaben und lässt fremde Ordner und Schlagwörter nicht zu', async () => {
    const body = { name: 'Test', folderId: inbox, actions: [{ type: 'star' }] };
    assert.equal((await emi.json('POST', '/api/automations', { ...body, name: ' ' })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/automations', { ...body, actions: [] })).statusCode, 400);
    assert.equal(
      (await emi.json('POST', '/api/automations', { ...body, actions: [{ type: 'rename', pattern: 'immer gleich' }] })).statusCode,
      400
    );
    assert.equal((await emi.json('POST', '/api/automations', { ...body, actions: [{ type: 'move', folderId: inbox }] })).statusCode, 400);
    assert.equal((await mia.json('POST', '/api/automations', body)).statusCode, 404);
    const foreign = (await mia.get('/api/session')).json().user.rootId;
    const other = await folder(mia, foreign, 'Bei Mia');
    await mia.json('POST', `/api/nodes/${other}/grants`, { userId: (await emi.get('/api/session')).json().user.id, permission: 'edit' });
    const across = await emi.json('POST', '/api/automations', { ...body, actions: [{ type: 'move', folderId: other }] });
    assert.equal(across.statusCode, 400);
    const miasTag = (await mia.json('POST', '/api/tags', { name: 'Mias', color: 'red' })).json().tag.id;
    assert.equal((await emi.json('POST', '/api/automations', { ...body, actions: [{ type: 'tag', tagId: miasTag }] })).statusCode, 404);
    assert.equal((await mia.json('DELETE', `/api/automations/${rule}`)).statusCode, 404);
    assert.equal((await emi.json('DELETE', `/api/automations/${rule}`)).statusCode, 200);
    await file(emi, inbox, 'Gas.pdf', '%PDF-1.4 Gas');
    assert.ok((await names(emi, inbox)).includes('Gas.pdf'));
  });

  it('hält Fehler fest, statt den Upload scheitern zu lassen', async () => {
    const target = await folder(emi, root, 'Ziel');
    const created = (
      await emi.json('POST', '/api/automations', { name: 'Ins Ziel', folderId: inbox, actions: [{ type: 'move', folderId: target }] })
    ).json().automation.id;
    await emi.json('POST', '/api/nodes/trash', { ids: [target] });
    await file(emi, inbox, 'Bleibt.txt');
    assert.ok((await names(emi, inbox)).includes('Bleibt.txt'));
    const listed = (await emi.get('/api/automations')).json().items.find((item: { id: string }) => item.id === created);
    assert.match(listed.error, /gibt es nicht mehr/);
    assert.equal(listed.runs, 0);
  });
});

describe('Abläufe bei gleichen Namen', () => {
  it('hängen eine Zahl an, statt an einem vergebenen Namen zu scheitern', async () => {
    const scans = await folder(emi, root, 'Doppelte Namen');
    await file(emi, scans, `${today} Seite.txt`, 'Schon da');
    const created = await emi.json('POST', '/api/automations', {
      name: 'Datum davor',
      folderId: scans,
      conditions: {},
      actions: [{ type: 'rename', pattern: '{datum} {name}' }],
    });
    assert.equal(created.statusCode, 200, created.body);
    await file(emi, scans, 'Seite.txt', 'Neu');
    assert.deepEqual(await names(emi, scans), [`${today} Seite (2).txt`, `${today} Seite.txt`]);
    const [rule] = (await emi.get(`/api/automations?folder=${scans}`)).json().items;
    assert.equal(rule.error, null);
    assert.equal(rule.runs, 1);
  });
});

describe('Abläufe mit Kopie und Album', () => {
  it('legen eine Kopie ab und sammeln Bilder in einem Album', async () => {
    const camera = await folder(emi, root, 'Kamera');
    const safe = await folder(emi, root, 'Sicherung');
    const inner = await folder(emi, camera, 'Auswahl');
    const album = (await emi.json('POST', '/api/albums', { name: 'Handy' })).json().album;
    const refusedSame = await emi.json('POST', '/api/automations', {
      name: 'Zu sich selbst',
      folderId: camera,
      conditions: {},
      actions: [{ type: 'copy', folderId: camera }],
    });
    assert.equal(refusedSame.statusCode, 400);
    const refusedDeep = await emi.json('POST', '/api/automations', {
      name: 'In den Unterordner',
      folderId: camera,
      deep: true,
      conditions: {},
      actions: [{ type: 'copy', folderId: inner }],
    });
    assert.equal(refusedDeep.statusCode, 400);
    const created = await emi.json('POST', '/api/automations', {
      name: 'Sichern und sammeln',
      folderId: camera,
      conditions: {},
      actions: [
        { type: 'copy', folderId: safe },
        { type: 'album', albumId: album.id },
      ],
    });
    assert.equal(created.statusCode, 200, created.body);
    const actions = created.json().automation.actions;
    assert.equal(actions[0].folderName, 'Sicherung');
    assert.equal(actions[1].albumName, 'Handy');
    const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a7' } })
      .jpeg()
      .toBuffer();
    await file(emi, camera, 'Foto.jpg', picture);
    await file(emi, camera, 'Liste.txt', 'kein Bild');
    assert.deepEqual(await names(emi, camera), ['Auswahl', 'Foto.jpg', 'Liste.txt']);
    assert.deepEqual(await names(emi, safe), ['Foto.jpg', 'Liste.txt']);
    const content = (await emi.get(`/api/albums/${album.id}`)).json();
    assert.deepEqual(
      content.items.map((item: { name: string }) => item.name),
      ['Foto.jpg']
    );
    const [rule] = (await emi.get(`/api/automations?folder=${camera}`)).json().items;
    assert.equal(rule.error, null);
    assert.equal(rule.runs, 2);
    const other = (await mia.json('POST', '/api/albums', { name: 'Fremd' })).json().album;
    const foreign = await emi.json('PATCH', `/api/automations/${rule.id}`, { actions: [{ type: 'album', albumId: other.id }] });
    assert.equal(foreign.statusCode, 404);
  });
});

describe('Umwandeln', () => {
  it('speichert Bilder in einem anderen Format neben das Original', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } })
      .png()
      .toBuffer();
    const pictures = await folder(emi, root, 'Bilder');
    const id = await file(emi, pictures, 'Logo.png', png);
    assert.deepEqual((await emi.get(`/api/nodes/${id}/convert`)).json().formats, ['jpeg', 'webp', 'avif']);
    const converted = await emi.json('POST', `/api/nodes/${id}/convert`, { format: 'jpeg' });
    assert.equal(converted.statusCode, 200, converted.body);
    assert.equal(converted.json().node.name, 'Logo.jpg');
    assert.equal(converted.json().node.mime, 'image/jpeg');
    const again = await emi.json('POST', `/api/nodes/${id}/convert`, { format: 'jpeg' });
    assert.equal(again.json().node.name, 'Logo (2).jpg');
    assert.equal((await emi.json('POST', `/api/nodes/${id}/convert`, { format: 'png' })).statusCode, 400);
    assert.equal((await emi.json('POST', `/api/nodes/${id}/convert`, { format: 'pdf' })).statusCode, 400);
    const text = await file(emi, pictures, 'Text.txt');
    assert.deepEqual((await emi.get(`/api/nodes/${text}/convert`)).json().formats, []);
    assert.equal((await emi.json('POST', `/api/nodes/${text}/convert`, { format: 'webp' })).statusCode, 400);
    assert.equal((await mia.json('POST', `/api/nodes/${id}/convert`, { format: 'webp' })).statusCode, 404);
  });

  it('läuft auch als Aktion in einem Ablauf', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#cc6633' } })
      .png()
      .toBuffer();
    const web = await folder(emi, root, 'Fürs Web');
    await emi.json('POST', '/api/automations', {
      name: 'Als WebP',
      folderId: web,
      conditions: { kinds: ['image'] },
      actions: [{ type: 'convert', format: 'webp' }],
    });
    await file(emi, web, 'Banner.png', png);
    assert.deepEqual(await names(emi, web), ['Banner.png', 'Banner.webp']);
  });
});
