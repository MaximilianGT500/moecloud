import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { davImportsSettled, parseMultistatus } from '../src/services/davimport.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let base = '';
let token = '';

type Item = { id: string; name: string; type: string; size: number; modifiedAt: number };

const children = async (client: Client, id: string) => (await client.get(`/api/nodes/${id}/children`)).json().items as Item[];
const names = async (client: Client, id: string) => (await children(client, id)).map((item) => item.name).sort();

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  const miaRoot = (await mia.get('/api/session')).json().user.rootId;
  const trip = (await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Urlaub & Meer' })).json().node.id;
  const deep = (await mia.json('POST', `/api/nodes/${trip}/folders`, { name: 'Tag 1 #früh' })).json().node.id;
  await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Leer' });
  await mia.upload(miaRoot, 'Notizen für Lea.txt', Buffer.from('Einkaufsliste'), 4096, { modifiedAt: Date.UTC(2024, 4, 17, 10, 30) });
  await mia.upload(trip, 'Strand 100%.txt', Buffer.from('Sonne und Sand'), 4096);
  await mia.upload(deep, 'Überblick.md', Buffer.from('# Tag 1\n\nFrüh raus.'), 4096);
  await mia.upload(deep, 'groß.bin', Buffer.alloc(300_000, 7), 65_536);
  token = (await mia.json('POST', '/api/account/app-passwords', { name: 'Umzug' })).json().token as string;
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(() => app.close());

describe('Import über WebDAV', () => {
  it('liest Antworten verschiedener Server', () => {
    const nextcloud = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
      <d:response><d:href>/remote.php/dav/files/mia/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/mia/Fotos%20%26%20Videos/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Fri, 17 May 2024 10:30:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/mia/Brief%20an%20Lea.odt</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>4711</d:getcontentlength><d:getlastmodified>Fri, 17 May 2024 10:30:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
    </d:multistatus>`;
    assert.deepEqual(parseMultistatus(nextcloud), [
      { href: '/remote.php/dav/files/mia/', folder: true, size: null, modifiedAt: null },
      { href: '/remote.php/dav/files/mia/Fotos%20%26%20Videos/', folder: true, size: null, modifiedAt: Date.UTC(2024, 4, 17, 10, 30) },
      { href: '/remote.php/dav/files/mia/Brief%20an%20Lea.odt', folder: false, size: 4711, modifiedAt: Date.UTC(2024, 4, 17, 10, 30) },
    ]);
    const apache = `<D:multistatus xmlns:D="DAV:"><D:response xmlns:lp1="DAV:"><D:href>/dav/a&amp;b.txt</D:href><D:propstat><D:prop><lp1:resourcetype/><lp1:getcontentlength>12</lp1:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>`;
    assert.deepEqual(parseMultistatus(apache), [{ href: '/dav/a&b.txt', folder: false, size: 12, modifiedAt: null }]);
    const bare = `<multistatus xmlns="DAV:"><response><href>http://nas.example/dav/Musik/</href><propstat><prop><resourcetype><collection></collection></resourcetype></prop></propstat></response></multistatus>`;
    assert.deepEqual(parseMultistatus(bare), [{ href: 'http://nas.example/dav/Musik/', folder: true, size: null, modifiedAt: null }]);
  });

  it('sperrt Adressen im lokalen Netz, bis ein Admin sie erlaubt', async () => {
    const blocked = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url: `${base}/dav/`, username: 'mia', password: token });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.message, 'Adressen im lokalen Netz sind für Downloads gesperrt');
    const inline = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: 'https://mia:geheim@cloud.example.com/dav/',
      username: 'mia',
      password: token,
    });
    assert.equal(inline.statusCode, 400);
    assert.equal(inline.json().error.message, 'Zugangsdaten gehören nicht in die Adresse');
    assert.deepEqual(await names(emi, root), []);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'import.private': true })).statusCode, 200);
  });

  it('holt Ordner und Dateien samt Änderungsdatum', async () => {
    const started = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url: `${base}/dav`, username: 'mia', password: token });
    assert.equal(started.statusCode, 202, started.body);
    const job = started.json().job;
    assert.equal(job.status, 'running');
    assert.equal(job.folder, 'Import von 127.0.0.1');
    assert.ok(!started.body.includes(token));
    const second = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url: `${base}/dav`, username: 'mia', password: token });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error.message, 'Es läuft schon ein Import, warte, bis er fertig ist');
    await davImportsSettled();
    const done = (await emi.get('/api/imports/webdav')).json().items[0];
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.deepEqual([done.files, done.found, done.folders, done.failed, done.bytes], [4, 4, 3, 0, 300_000 + 13 + 14 + 20]);
    assert.ok(!JSON.stringify(done).includes(token));
    assert.deepEqual(await names(emi, root), ['Import von 127.0.0.1']);
    const top = await children(emi, job.folderId);
    assert.deepEqual(top.map((item) => item.name).sort(), ['Leer', 'Notizen für Lea.txt', 'Urlaub & Meer']);
    assert.equal(top.find((item) => item.name === 'Notizen für Lea.txt')!.modifiedAt, Date.UTC(2024, 4, 17, 10, 30));
    const trip = top.find((item) => item.name === 'Urlaub & Meer')!;
    assert.deepEqual(await names(emi, trip.id), ['Strand 100%.txt', 'Tag 1 #früh']);
    const deep = (await children(emi, trip.id)).find((item) => item.type === 'folder')!;
    const files = await children(emi, deep.id);
    assert.deepEqual(files.map((item) => [item.name, item.size]).sort(), [
      ['groß.bin', 300_000],
      ['Überblick.md', 20],
    ]);
    const text = files.find((item) => item.name === 'Überblick.md')!;
    assert.equal((await emi.get(`/api/nodes/${text.id}/content`)).body, '# Tag 1\n\nFrüh raus.');
    const note = (await emi.get('/api/notifications')).json().items.find((item: { kind: string }) => item.kind === 'dav_import_done');
    assert.equal(note.title, `Der Import von 127.0.0.1:${new URL(base).port} ist fertig`);
    assert.equal(note.text, '4 Dateien liegen jetzt in „Import von 127.0.0.1“.');
    assert.equal(note.url, `/files/folder/${job.folderId}`);
  });

  it('meldet falsche Zugangsdaten und fehlende Ordner', async () => {
    const wrong = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: `${base}/dav/`,
      username: 'mia',
      password: 'falsch',
      name: 'Zweiter Versuch',
    });
    assert.equal(wrong.statusCode, 202);
    await davImportsSettled();
    const failed = (await emi.get('/api/imports/webdav')).json().items[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'Der Server lehnt die Zugangsdaten ab');
    assert.equal(failed.folder, 'Zweiter Versuch');
    const missing = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: `${base}/dav/Gibt es nicht/`,
      username: 'mia',
      password: token,
    });
    assert.equal(missing.statusCode, 202);
    await davImportsSettled();
    assert.equal((await emi.get('/api/imports/webdav')).json().items[0].error, 'Unter der Adresse gibt es keinen WebDAV-Ordner');
    const plain = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url: `${base}/healthz`, username: 'mia', password: token });
    assert.equal(plain.statusCode, 202);
    await davImportsSettled();
    assert.match((await emi.get('/api/imports/webdav')).json().items[0].error, /WebDAV-Ordner|geantwortet/);
    const notes = (await emi.get('/api/notifications')).json().items.filter((item: { kind: string }) => item.kind === 'dav_import_failed');
    assert.equal(notes.length, 3);
    assert.equal(notes[2].text, 'Der Server lehnt die Zugangsdaten ab');
  });

  it('holt nur einen Unterordner und lässt sich abbrechen', async () => {
    const part = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: `${base}/dav/Urlaub%20%26%20Meer/`,
      username: 'mia',
      password: token,
      name: 'Nur der Urlaub',
    });
    assert.equal(part.statusCode, 202, part.body);
    const cancel = await emi.json('DELETE', `/api/imports/webdav/${part.json().job.id}`);
    assert.equal(cancel.statusCode, 200);
    assert.equal((await mia.json('DELETE', `/api/imports/webdav/${part.json().job.id}`)).statusCode, 404);
    await davImportsSettled();
    const job = (await emi.get('/api/imports/webdav')).json().items[0];
    assert.equal(job.status, 'cancelled');
    assert.equal(job.files, 0);
    const again = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: `${base}/dav/Urlaub%20%26%20Meer/`,
      username: 'mia',
      password: token,
      name: 'Nur der Urlaub',
    });
    await davImportsSettled();
    const result = (await emi.get('/api/imports/webdav')).json().items[0];
    assert.deepEqual([result.status, result.files, result.folders, result.folder], ['done', 3, 1, 'Nur der Urlaub (2)']);
    assert.deepEqual(await names(emi, again.json().job.folderId), ['Strand 100%.txt', 'Tag 1 #früh']);
    await emi.json('PATCH', '/api/admin/settings', { 'import.enabled': false });
    const off = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url: `${base}/dav/`, username: 'mia', password: token });
    assert.equal(off.statusCode, 403);
  });
});
