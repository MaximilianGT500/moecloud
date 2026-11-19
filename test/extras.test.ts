import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp, zip } from './helpers.ts';
import { run, value } from '../src/lib/db.ts';
import { clearLog, remember } from '../src/lib/log.ts';
import { purgeAppPasswords } from '../src/services/apppasswords.ts';
import { purgeVersions } from '../src/services/versions.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

async function folder(client: Client, parent: string, name: string): Promise<string> {
  return (await client.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function file(client: Client, parent: string, name: string, content: string) {
  const response = await client.upload(parent, name, Buffer.from(content), 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

async function write(client: Client, node: string, content: string) {
  const response = await client.send({
    method: 'PUT',
    url: `/api/nodes/${node}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(content),
  });
  assert.equal(response.statusCode, 200, response.body);
}

const names = async (client: Client, id: string) =>
  ((await client.get(`/api/nodes/${id}/children`)).json().items as { name: string }[]).map((item) => item.name).sort();

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await app.close();
});

describe('Benannte Versionen', () => {
  let node = '';

  it('bleiben erhalten, wenn MoeCloud alte Versionen aufräumt', async () => {
    await emi.json('PATCH', '/api/admin/settings', { 'storage.versions': 2 });
    node = await file(emi, root, 'Vertrag.txt', 'Fassung 1');
    for (const text of ['Fassung 2', 'Fassung 3']) await write(emi, node, text);
    let versions = (await emi.get(`/api/nodes/${node}/versions`)).json().items;
    assert.equal(versions.length, 2);
    const oldest = versions[1];
    assert.equal(oldest.label, null);
    const named = await emi.json('PATCH', `/api/nodes/${node}/versions/${oldest.id}`, { label: '  Unterschrieben   von Lea ' });
    assert.equal(named.statusCode, 200, named.body);
    assert.equal(named.json().items[1].label, 'Unterschrieben von Lea');
    for (const text of ['Fassung 4', 'Fassung 5', 'Fassung 6']) await write(emi, node, text);
    versions = (await emi.get(`/api/nodes/${node}/versions`)).json().items;
    assert.equal(versions.length, 3);
    assert.deepEqual(
      versions.map((version: { label: string | null }) => version.label),
      [null, null, 'Unterschrieben von Lea']
    );
    run('UPDATE versions SET created_at = ? WHERE node_id = ?', Date.now() - 400 * 24 * 60 * 60 * 1000, node);
    assert.equal(purgeVersions(30), 2);
    versions = (await emi.get(`/api/nodes/${node}/versions`)).json().items;
    assert.equal(versions.length, 1);
    const content = await emi.get(`/api/nodes/${node}/versions/${versions[0].id}/content`);
    assert.equal(content.body, 'Fassung 1');
  });

  it('lassen sich umbenennen und wieder freigeben, aber nur mit Schreibrecht', async () => {
    const [version] = (await emi.get(`/api/nodes/${node}/versions`)).json().items;
    const granted = await emi.json('POST', `/api/nodes/${node}/grants`, {
      userId: (await mia.get('/api/session')).json().user.id,
      permission: 'view',
    });
    assert.equal(granted.statusCode, 200, granted.body);
    const shared = (await mia.get(`/api/nodes/${node}/versions`)).json().items;
    assert.equal(shared[0].label, 'Unterschrieben von Lea');
    assert.equal((await mia.json('PATCH', `/api/nodes/${node}/versions/${version.id}`, { label: 'Meins' })).statusCode, 403);
    assert.equal((await emi.json('PATCH', `/api/nodes/${node}/versions/${version.id}`, { label: 'x'.repeat(61) })).statusCode, 400);
    assert.equal((await emi.json('PATCH', `/api/nodes/${node}/versions/nichts`, { label: 'Leer' })).statusCode, 404);
    const cleared = await emi.json('PATCH', `/api/nodes/${node}/versions/${version.id}`, { label: null });
    assert.equal(cleared.json().items[0].label, null);
    run('UPDATE versions SET created_at = ? WHERE node_id = ?', Date.now() - 400 * 24 * 60 * 60 * 1000, node);
    assert.equal(purgeVersions(30), 1);
  });
});

describe('Prüfsumme', () => {
  it('steht in den Angaben zur Datei', async () => {
    const node = await file(emi, root, 'Notiz.txt', 'Hallo Emily');
    const meta = (await emi.get(`/api/nodes/${node}/meta`)).json();
    assert.equal(meta.sha256, createHash('sha256').update('Hallo Emily').digest('hex'));
    const link = (await emi.json('POST', `/api/nodes/${node}/links`, {})).json().link;
    const open = new Client(app);
    await open.get(`/s/${link.token}`, { accept: 'text/html' });
    const shared = (await open.get(`/api/public/${link.token}/nodes/${node}/meta`)).json();
    assert.equal(shared.sha256, undefined);
  });
});

describe('Startdateien', () => {
  let starter = '';

  it('kopiert einen Ordner in jedes neue Konto', async () => {
    assert.equal((await emi.get('/api/admin/starter')).json().folder, null);
    starter = await folder(emi, root, 'Willkommen');
    assert.equal((await emi.json('PUT', '/api/admin/starter', { folderId: starter })).statusCode, 400);
    const guide = await folder(emi, starter, 'Anleitungen');
    await file(emi, guide, 'Erste Schritte.txt', 'Schön, dass du da bist');
    await file(emi, starter, 'Hausordnung.txt', 'Bitte nett bleiben');
    assert.equal((await mia.json('PUT', '/api/admin/starter', { folderId: starter })).statusCode, 403);
    const saved = await emi.json('PUT', '/api/admin/starter', { folderId: starter });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().folder.name, 'Willkommen');
    assert.equal(saved.json().folder.items, 3);
    assert.equal(saved.json().folder.bytes, 'Schön, dass du da bist'.length + 1 + 'Bitte nett bleiben'.length);
    await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' });
    const lea = await login(app, 'lea', 'leas-passwort-123');
    const home = (await lea.get('/api/session')).json().user.rootId;
    assert.deepEqual(await names(lea, home), ['Anleitungen', 'Hausordnung.txt']);
    const inner = ((await lea.get(`/api/nodes/${home}/children`)).json().items as { id: string; name: string; owner: unknown }[]).find(
      (item) => item.name === 'Anleitungen'
    )!;
    assert.equal(inner.owner, null);
    assert.deepEqual(await names(lea, inner.id), ['Erste Schritte.txt']);
    assert.equal((await lea.get('/api/account')).json().storage.used, saved.json().folder.bytes);
    assert.deepEqual(await names(mia, (await mia.get('/api/session')).json().user.rootId), []);
  });

  it('lässt Gastkonten leer und hört auf, wenn der Ordner weg ist', async () => {
    await emi.json('POST', '/api/admin/users', { username: 'gast', name: 'Emily', password: 'emilys-passwort-123', role: 'guest' });
    const guest = await login(app, 'gast', 'emilys-passwort-123');
    assert.deepEqual(await names(guest, (await guest.get('/api/session')).json().user.rootId), []);
    await emi.json('POST', '/api/nodes/trash', { ids: [starter] });
    assert.equal((await emi.get('/api/admin/starter')).json().folder, null);
    await emi.json('POST', '/api/admin/users', { username: 'spaeter', name: 'Mia Zwei', password: 'mias-passwort-456' });
    const later = await login(app, 'spaeter', 'mias-passwort-456');
    assert.deepEqual(await names(later, (await later.get('/api/session')).json().user.rootId), []);
    assert.equal((await emi.json('PUT', '/api/admin/starter', { folderId: null })).json().folder, null);
  });
});

describe('Serverprotokoll', () => {
  it('zeigt Admins die letzten Meldungen', async () => {
    clearLog();
    remember(30, ['MoeCloud läuft auf Port %d', 3000]);
    remember(40, [{ error: 'Zeit abgelaufen', kind: 'share', req: { url: '/s/geheim' } }, 'E-Mail konnte nicht gesendet werden']);
    remember(50, [new Error('Datenträger voll'), 'Aufräumen fehlgeschlagen']);
    remember(20, ['nur zum Suchen']);
    assert.equal((await mia.get('/api/admin/log')).statusCode, 403);
    const all = (await emi.get('/api/admin/log')).json();
    assert.deepEqual(
      all.items.map((entry: { level: string }) => entry.level),
      ['error', 'warn', 'info']
    );
    assert.equal(all.items[2].message, 'MoeCloud läuft auf Port 3000');
    assert.equal(all.items[1].message, 'E-Mail konnte nicht gesendet werden');
    assert.match(all.items[1].detail, /Zeit abgelaufen/);
    assert.match(all.items[1].detail, /kind: share/);
    assert.doesNotMatch(all.items[1].detail, /geheim/);
    assert.match(all.items[0].detail, /Error: Datenträger voll/);
    assert.equal((await emi.get('/api/admin/log?level=warn')).json().items.length, 2);
    assert.equal((await emi.get('/api/admin/log?level=error')).json().items.length, 1);
    assert.equal((await emi.json('DELETE', '/api/admin/log')).statusCode, 200);
    assert.equal((await emi.get('/api/admin/log')).json().items.length, 0);
  });

  it('behält nur die letzten Einträge', async () => {
    for (let index = 0; index < 450; index++) remember(40, [`Meldung ${index}`]);
    const items = (await emi.get('/api/admin/log')).json().items;
    assert.equal(items.length, 400);
    assert.equal(items[0].message, 'Meldung 449');
    assert.equal(items[399].message, 'Meldung 50');
    clearLog();
  });
});

describe('Gesperrte Dateiendungen', () => {
  let folderId = '';
  let auth = '';

  const dav = (method: string, url: string, headers: Record<string, string> = {}, payload?: string | Buffer) =>
    app.inject({ method: method as 'GET', url, headers: { authorization: auth, ...headers }, payload });

  it('räumt die Liste auf und lehnt Unsinn ab', async () => {
    assert.equal((await mia.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': 'exe' })).statusCode, 403);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': 'exe, ../etc' })).statusCode, 400);
    const saved = await emi.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': ' .EXE; scr,bat  exe ' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().settings['storage.blockedTypes'], 'bat, exe, scr');
  });

  it('greift beim Hochladen, Umbenennen, über WebDAV und über Links', async () => {
    folderId = await folder(emi, root, 'Eingang');
    const init = await emi.json('POST', '/api/uploads', { parentId: folderId, name: 'Setup.EXE', size: 4 });
    assert.equal(init.statusCode, 400);
    assert.match(init.json().error.message, /\.exe/);
    const node = await file(emi, folderId, 'Setup.exe.txt', 'Text');
    assert.equal((await emi.json('PATCH', `/api/nodes/${node}`, { name: 'Setup.bat' })).statusCode, 400);
    assert.equal((await emi.json('PATCH', `/api/nodes/${node}`, { name: 'Notizen.txt' })).statusCode, 200);
    assert.equal((await emi.json('POST', `/api/nodes/${folderId}/folders`, { name: 'Alte.exe' })).statusCode, 200);
    assert.equal((await emi.json('POST', `/api/nodes/${folderId}/text`, { name: 'Start.scr', content: '' })).statusCode, 400);
    const token = (await emi.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json().token;
    auth = `Basic ${Buffer.from(`emi:${token}`).toString('base64')}`;
    assert.equal((await dav('PUT', '/dav/Eingang/Spiel.exe', {}, 'MZ')).statusCode, 400);
    assert.equal((await dav('PUT', '/dav/Eingang/Spiel.txt', {}, 'MZ')).statusCode, 201);
    assert.equal((await dav('MOVE', '/dav/Eingang/Spiel.txt', { destination: '/dav/Eingang/Spiel.bat' })).statusCode, 400);
    const link = (await emi.json('POST', `/api/nodes/${folderId}/links`, { uploadOnly: true })).json().link;
    const visitor = new Client(app);
    await visitor.get(`/s/${link.token}`, { accept: 'text/html' });
    const viaLink = await visitor.json('POST', `/api/public/${link.token}/uploads`, { parentId: folderId, name: 'Rechnung.scr', size: 3 });
    assert.equal(viaLink.statusCode, 400);
    assert.deepEqual(await names(emi, folderId), ['Alte.exe', 'Notizen.txt', 'Spiel.txt']);
  });

  it('überspringt gesperrte Dateien beim Entpacken und lässt sie beim Kopieren nicht entstehen', async () => {
    const archive = await zip({ 'Liesmich.txt': 'Hallo Mia', 'Werkzeug/Start.bat': 'echo', 'Werkzeug/Hilfe.txt': 'Hilfe' });
    const node = (await emi.upload(folderId, 'Paket.zip', archive, 4096)).json().node;
    const result = await emi.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().files, 2);
    assert.equal(result.json().skipped.blocked, 1);
    const tools = ((await emi.get(`/api/nodes/${result.json().folderId}/children`)).json().items as { id: string; name: string }[]).find(
      (item) => item.name === 'Werkzeug'
    )!;
    assert.deepEqual(await names(emi, tools.id), ['Hilfe.txt']);
  });

  it('lässt nach dem Leeren der Liste wieder alles zu', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': '' })).statusCode, 200);
    const init = await emi.json('POST', '/api/uploads', { parentId: folderId, name: 'Setup.exe', size: 4 });
    assert.equal(init.statusCode, 200, init.body);
  });
});

describe('WebDAV mit Geteiltem und nur zum Lesen', () => {
  let lea: Client;
  let auth = '';
  let readOnly = '';

  const dav = (method: string, url: string, headers: Record<string, string> = {}, payload?: string | Buffer, basic = auth) =>
    app.inject({ method: method as 'GET', url, headers: { authorization: basic, ...headers }, payload });

  it('zeigt Freigaben neben den eigenen Ordnern und löst gleiche Namen auf', async () => {
    lea = await login(app, 'lea', 'leas-passwort-123');
    const leaId = (await lea.get('/api/session')).json().user.id;
    const leaRoot = (await lea.get('/api/session')).json().user.rootId;
    const miaId = (await mia.get('/api/session')).json().user.id;
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    const fromEmi = await folder(emi, root, 'Belege');
    await file(emi, fromEmi, 'Januar.txt', 'von Emi');
    const fromMia = await folder(mia, miaRoot, 'Belege');
    await file(mia, fromMia, 'Februar.txt', 'von Mia');
    const single = await file(mia, miaRoot, 'Einzeln.txt', 'eine Datei');
    await folder(lea, leaRoot, 'Belege');
    assert.equal((await emi.json('POST', `/api/nodes/${fromEmi}/grants`, { userId: leaId, permission: 'edit' })).statusCode, 200);
    assert.equal((await mia.json('POST', `/api/nodes/${fromMia}/grants`, { userId: leaId, permission: 'view' })).statusCode, 200);
    assert.equal((await mia.json('POST', `/api/nodes/${single}/grants`, { userId: leaId, permission: 'view' })).statusCode, 200);
    assert.equal(miaId > 0, true);
    const token = (await lea.json('POST', '/api/account/app-passwords', { name: 'Rechner', shared: true })).json().token;
    auth = `Basic ${Buffer.from(`lea:${token}`).toString('base64')}`;
    const list = await dav('PROPFIND', '/dav/', { depth: '1' });
    assert.equal(list.statusCode, 207);
    const hrefs = [...list.body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((match) => decodeURIComponent(match[1])).sort();
    assert.ok(hrefs.includes('/dav/Belege/'));
    assert.ok(hrefs.includes('/dav/Belege (Emi)/'));
    assert.ok(hrefs.includes('/dav/Belege (Mia)/'));
    assert.ok(hrefs.includes('/dav/Einzeln.txt'));
    assert.equal((await dav('GET', '/dav/Belege%20(Emi)/Januar.txt')).body, 'von Emi');
    assert.equal((await dav('GET', '/dav/Belege%20(Mia)/Februar.txt')).body, 'von Mia');
    assert.equal((await dav('GET', '/dav/Einzeln.txt')).body, 'eine Datei');
    assert.equal((await dav('PUT', '/dav/Belege%20(Emi)/Von%20Lea.txt', { 'content-type': 'text/plain' }, 'Hallo')).statusCode, 201);
    assert.deepEqual(await names(emi, fromEmi), ['Januar.txt', 'Von Lea.txt']);
    assert.equal((await dav('PUT', '/dav/Belege%20(Mia)/Nein.txt', { 'content-type': 'text/plain' }, 'Nein')).statusCode, 403);
    assert.equal((await dav('DELETE', '/dav/Belege%20(Emi)/')).statusCode, 403);
    assert.equal((await dav('MOVE', '/dav/Belege%20(Emi)/', { destination: '/dav/Anders/' })).statusCode, 403);
    assert.equal((await dav('MOVE', '/dav/Belege%20(Emi)/Januar.txt', { destination: '/dav/Belege/Januar.txt' })).statusCode, 400);
    assert.deepEqual(await names(emi, fromEmi), ['Januar.txt', 'Von Lea.txt']);
    const grant = value<string>('SELECT id FROM grants WHERE node_id = ? AND user_id = ?', fromEmi, leaId)!;
    await emi.json('DELETE', `/api/grants/${grant}`);
    assert.equal((await dav('GET', '/dav/Belege%20(Emi)/Januar.txt')).statusCode, 404);
    const again = await dav('PROPFIND', '/dav/', { depth: '1' });
    assert.doesNotMatch(again.body, /Belege%20\(Emi\)/);
    assert.match(again.body, /Belege%20\(Mia\)/);
  });

  it('lässt ein App-Passwort nur zum Lesen nichts ändern, weder über WebDAV noch über die API', async () => {
    const leaRoot = (await lea.get('/api/session')).json().user.rootId;
    await file(lea, leaRoot, 'Tagebuch.txt', 'nur lesen');
    const created = (await lea.json('POST', '/api/account/app-passwords', { name: 'Bilderrahmen', readOnly: true })).json();
    assert.equal(created.item.readOnly, true);
    const listed = (await lea.get('/api/account')).json().security.appPasswords as { name: string; readOnly: boolean; shared: boolean }[];
    assert.deepEqual(listed.map((entry) => [entry.name, entry.readOnly, entry.shared]).sort(), [
      ['Bilderrahmen', true, false],
      ['Rechner', false, true],
    ]);
    readOnly = `Basic ${Buffer.from(`lea:${created.token}`).toString('base64')}`;
    assert.equal((await dav('PROPFIND', '/dav/', { depth: '1' }, undefined, readOnly)).statusCode, 207);
    assert.equal((await dav('GET', '/dav/Tagebuch.txt', {}, undefined, readOnly)).body, 'nur lesen');
    for (const [method, url, headers] of [
      ['PUT', '/dav/Neu.txt', { 'content-type': 'text/plain' }],
      ['DELETE', '/dav/Tagebuch.txt', {}],
      ['MKCOL', '/dav/Ordner', {}],
      ['MOVE', '/dav/Tagebuch.txt', { destination: '/dav/Anders.txt' }],
      ['COPY', '/dav/Tagebuch.txt', { destination: '/dav/Kopie.txt' }],
      ['LOCK', '/dav/Tagebuch.txt', {}],
      ['PROPPATCH', '/dav/Tagebuch.txt', {}],
    ] as const) {
      const response = await dav(method, url, headers, method === 'PUT' ? 'x' : undefined, readOnly);
      assert.equal(response.statusCode, 403, `${method} ${url}`);
    }
    assert.deepEqual(
      (await names(lea, leaRoot)).filter((name) => name.endsWith('.txt')),
      ['Hausordnung.txt', 'Tagebuch.txt']
    );
    const api = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
      app.inject({
        method,
        url,
        headers: { authorization: readOnly, ...(payload ? { 'content-type': 'application/json' } : {}) },
        payload,
      });
    assert.equal((await api('GET', `/api/nodes/${leaRoot}/children`)).statusCode, 200);
    const refused = await api('POST', `/api/nodes/${leaRoot}/folders`, { name: 'Nein' });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().error.code, 'read_only');
    assert.equal((await api('POST', '/api/account/app-passwords', { name: 'Mehr Rechte' })).statusCode, 403);
    assert.equal((await api('DELETE', '/api/account/session')).statusCode, 403);
  });
});

describe('Registrierung mit Freigabe', () => {
  let nina = 0;

  const register = async (username: string, name: string) => {
    const page = new Client(app);
    await page.get('/register', { accept: 'text/html' });
    const response = await page.form('/register', {
      _csrf: page.cookies.get('moe_csrf')!,
      name,
      username,
      email: `${username}@example.com`,
      password: `${username}-passwort-123`,
    });
    return { page, response };
  };

  it('legt Konten an, die erst nach der Freigabe hineinkommen', async () => {
    assert.equal((await new Client(app).get('/register', { accept: 'text/html' })).statusCode, 404);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'approval' })).statusCode, 200);
    const { page, response } = await register('nina', 'Nina');
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /wartet auf die Freigabe durch die Verwaltung/);
    assert.equal((await page.get('/api/session')).statusCode, 401);
    const attempt = await page.form('/login', {
      _csrf: page.cookies.get('moe_csrf')!,
      login: 'nina',
      password: 'nina-passwort-123',
      next: '/files',
    });
    assert.equal(attempt.statusCode, 401);
    assert.match(attempt.body, /Dein Konto wartet noch auf die Freigabe/);
    const people = (await emi.get('/api/admin/users')).json().items as { id: number; username: string; pending: boolean }[];
    const entry = people.find((person) => person.username === 'nina')!;
    assert.equal(entry.pending, true);
    nina = entry.id;
    const notes = (await emi.get('/api/notifications')).json().items as { title: string }[];
    assert.ok(notes.some((note) => note.title === 'Nina wartet auf die Freigabe'));
    assert.equal((await emi.json('POST', `/api/nodes/${root}/grants`, { userId: nina, permission: 'view' })).statusCode >= 400, true);
    const found = (await emi.get('/api/users/search?q=nina')).json().items as { id: number }[];
    assert.equal(
      found.some((person) => person.id === nina),
      false
    );
  });

  it('gibt frei, lehnt ab und lässt Einladungen ohne Warten durch', async () => {
    assert.equal((await mia.json('POST', `/api/admin/users/${nina}/approve`)).statusCode, 403);
    const approved = await emi.json('POST', `/api/admin/users/${nina}/approve`);
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().user.pending, false);
    assert.equal((await emi.json('POST', `/api/admin/users/${nina}/approve`)).statusCode, 400);
    const client = await login(app, 'nina', 'nina-passwort-123');
    assert.equal((await client.get('/api/session')).json().user.name, 'Nina');
    const { response } = await register('otto', 'Otto Nein');
    assert.equal(response.statusCode, 200);
    const otto = ((await emi.get('/api/admin/users')).json().items as { id: number; username: string }[]).find(
      (person) => person.username === 'otto'
    )!;
    assert.equal((await emi.json('DELETE', `/api/admin/users/${otto.id}`)).statusCode, 200);
    const gone = new Client(app);
    await gone.get('/login', { accept: 'text/html' });
    const attempt = await gone.form('/login', {
      _csrf: gone.cookies.get('moe_csrf')!,
      login: 'otto',
      password: 'otto-passwort-123',
      next: '/files',
    });
    assert.equal(attempt.statusCode, 401);
    const invite = (await emi.json('POST', '/api/admin/invites', { days: 3 })).json();
    const token = new URL(invite.url).searchParams.get('invite')!;
    const invited = new Client(app);
    await invited.get(`/register?invite=${token}`, { accept: 'text/html' });
    const done = await invited.form('/register', {
      _csrf: invited.cookies.get('moe_csrf')!,
      invite: token,
      name: 'Pia',
      username: 'pia',
      password: 'pias-passwort-123',
    });
    assert.equal(done.statusCode, 303, done.body);
    const log = (await emi.get('/api/admin/audit')).json().items as { action: string }[];
    assert.ok(log.some((entry) => entry.action === 'user_approved'));
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'closed' })).statusCode, 200);
  });
});

describe('Notiz zur Freigabe', () => {
  it('begleitet Freigaben an Personen und Gruppen bis zur Empfängerin', async () => {
    const miaId = (await mia.get('/api/session')).json().user.id;
    const node = await folder(emi, root, 'Steuer 2026');
    const shared = await emi.json('POST', `/api/nodes/${node}/grants`, {
      userId: miaId,
      permission: 'view',
      note: '  Bitte bis   Freitag ansehen ',
    });
    assert.equal(shared.statusCode, 200, shared.body);
    assert.equal(shared.json().grant.note, 'Bitte bis Freitag ansehen');
    const listed = (await mia.get('/api/shared')).json().withMe as { name: string; shareNote: string | null }[];
    assert.equal(listed.find((entry) => entry.name === 'Steuer 2026')?.shareNote, 'Bitte bis Freitag ansehen');
    const notes = (await mia.get('/api/notifications')).json().items as { title: string; text: string }[];
    const note = notes.find((entry) => entry.title === 'Emi hat „Steuer 2026“ mit dir geteilt')!;
    assert.match(note.text, /^Notiz: Bitte bis Freitag ansehen /);
    const changed = await emi.json('PATCH', `/api/grants/${shared.json().grant.id}`, { note: 'Eilt nicht mehr' });
    assert.equal(changed.json().grant.note, 'Eilt nicht mehr');
    assert.equal(
      (await emi.json('PATCH', `/api/grants/${shared.json().grant.id}`, { permission: 'edit' })).json().grant.note,
      'Eilt nicht mehr'
    );
    assert.equal((await emi.json('PATCH', `/api/grants/${shared.json().grant.id}`, { note: null })).json().grant.note, null);
    assert.equal(
      (await emi.json('POST', `/api/nodes/${node}/grants`, { userId: miaId, permission: 'view', note: 'x'.repeat(301) })).statusCode,
      400
    );
    const group = (await emi.json('POST', '/api/admin/groups', { name: 'Haushalt', members: [miaId] })).json().group;
    const other = await folder(emi, root, 'Versicherungen');
    const viaGroup = await emi.json('POST', `/api/nodes/${other}/grants`, {
      groupId: group.id,
      permission: 'view',
      note: 'Für alle im Haushalt',
    });
    assert.equal(viaGroup.statusCode, 200, viaGroup.body);
    assert.equal(viaGroup.json().grant.note, 'Für alle im Haushalt');
    const again = (await mia.get('/api/shared')).json().withMe as { name: string; shareNote: string | null }[];
    assert.equal(again.find((entry) => entry.name === 'Versicherungen')?.shareNote, 'Für alle im Haushalt');
    const plain = await emi.json('POST', `/api/nodes/${await folder(emi, root, 'Ohne Notiz')}/grants`, {
      userId: miaId,
      permission: 'view',
    });
    assert.equal(plain.json().grant.note, null);
  });
});

describe('Unbenutzte Konten', () => {
  it('werden nach der eingestellten Zeit gesperrt, Admins und genutzte Konten nicht', async () => {
    const { disableInactive } = await import('../src/services/accounts.ts');
    const day = 24 * 60 * 60 * 1000;
    assert.equal(disableInactive(), 0);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'accounts.inactiveDays': 7 })).statusCode, 400);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'accounts.inactiveDays': 90 })).statusCode, 200);
    assert.equal(disableInactive(), 0);
    const ids = Object.fromEntries(
      ((await emi.get('/api/admin/users')).json().items as { id: number; username: string }[]).map((person) => [person.username, person.id])
    );
    const old = Date.now() - 200 * day;
    run(
      'UPDATE users SET created_at = ?, last_login_at = ?, seen_at = ? WHERE username IN (?, ?, ?, ?)',
      old,
      old,
      old,
      'emi',
      'lea',
      'nina',
      'pia'
    );
    run('DELETE FROM sessions WHERE user_id IN (?, ?)', ids.nina, ids.pia);
    run('UPDATE sessions SET last_seen_at = ? WHERE user_id = ?', old, ids.lea);
    run('UPDATE app_passwords SET last_used_at = ? WHERE user_id = ?', Date.now() - 3 * day, ids.lea);
    assert.equal(disableInactive(), 2);
    const people = (await emi.get('/api/admin/users')).json().items as { username: string; disabled: boolean; lastActiveAt: number }[];
    const state = Object.fromEntries(people.map((person) => [person.username, person.disabled]));
    assert.equal(state.emi, false);
    assert.equal(state.lea, false);
    assert.equal(state.mia, false);
    assert.equal(state.nina, true);
    assert.equal(state.pia, true);
    assert.ok(people.find((person) => person.username === 'lea')!.lastActiveAt > Date.now() - 4 * day);
    const notes = (await emi.get('/api/notifications')).json().items as { title: string; text: string }[];
    const note = notes.find((entry) => entry.title === '2 Konten nach 90 Tagen ohne Nutzung gesperrt')!;
    assert.match(note.text, /Nina/);
    assert.equal(disableInactive(), 0);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${ids.nina}`, { disabled: false })).statusCode, 200);
    assert.equal(disableInactive(), 0);
    const client = await login(app, 'nina', 'nina-passwort-123');
    assert.equal((await client.get('/api/session')).statusCode, 200);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'accounts.inactiveDays': 0 })).statusCode, 200);
  });
});

describe('Ablaufdatum für App-Passwörter', () => {
  it('lässt abgelaufene Passwörter nicht mehr hinein und räumt sie später weg', async () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal((await mia.json('POST', '/api/account/app-passwords', { name: 'Alt', expiresAt: Date.now() - 1000 })).statusCode, 400);
    assert.equal(
      (await mia.json('POST', '/api/account/app-passwords', { name: 'Ewig', expiresAt: Date.now() + 4000 * day })).statusCode,
      400
    );
    const created = (await mia.json('POST', '/api/account/app-passwords', { name: 'Urlaub', expiresAt: Date.now() + 7 * day })).json();
    assert.equal(created.item.expired, false);
    assert.ok(created.item.expiresAt > Date.now() + 6 * day);
    const basic = `Basic ${Buffer.from(`mia:${created.token}`).toString('base64')}`;
    const drive = () => app.inject({ method: 'PROPFIND' as 'GET', url: '/dav/', headers: { authorization: basic, depth: '0' } });
    assert.equal((await drive()).statusCode, 207);
    run('UPDATE app_passwords SET expires_at = ? WHERE id = ?', Date.now() - 1000, created.item.id);
    assert.equal((await drive()).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/session', headers: { authorization: basic } })).statusCode, 401);
    const listed = (await mia.get('/api/account')).json().security.appPasswords as { id: string; expired: boolean }[];
    assert.equal(listed.find((entry) => entry.id === created.item.id)!.expired, true);
    assert.equal(purgeAppPasswords(), 0);
    run('UPDATE app_passwords SET expires_at = ? WHERE id = ?', Date.now() - 31 * day, created.item.id);
    assert.equal(purgeAppPasswords(), 1);
    const endless = (await mia.json('POST', '/api/account/app-passwords', { name: 'Rechner' })).json();
    assert.equal(endless.item.expiresAt, null);
    assert.equal(purgeAppPasswords(), 0);
  });
});

describe('Speicherwarnung für Teamordner', () => {
  const warnings = async (client: Client) =>
    ((await client.get('/api/notifications')).json().items as { kind: string; title: string; url: string }[]).filter(
      (entry) => entry.kind === 'team_storage'
    );

  it('geht an die Leitung und ohne Leitung an die Admins', async () => {
    const miaId = ((await emi.get('/api/admin/users')).json().items as { id: number; username: string }[]).find(
      (person) => person.username === 'mia'
    )!.id;
    const team = (await emi.json('POST', '/api/admin/teams', { name: 'Vertrieb', quota: 1024 * 1024 })).json().team;
    assert.equal((await emi.json('PUT', `/api/teams/${team.id}/people/${miaId}`, { role: 'manage' })).statusCode, 200);
    const first = await mia.upload(team.rootId, 'Katalog.bin', Buffer.alloc(950 * 1024, 1), 256 * 1024);
    assert.equal(first.statusCode, 200, first.body);
    const forMia = await warnings(mia);
    assert.equal(forMia.length, 1);
    assert.equal(forMia[0].title, 'Der Teamordner „Vertrieb“ ist zu 92 % voll');
    assert.equal(forMia[0].url, `/files/folder/${team.rootId}`);
    assert.equal((await warnings(emi)).length, 0);
    const second = await mia.upload(team.rootId, 'Notiz.bin', Buffer.alloc(1024, 2), 256 * 1024);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal((await warnings(mia)).length, 1);

    const other = (await emi.json('POST', '/api/admin/teams', { name: 'Lager', quota: 1024 * 1024 })).json().team;
    assert.equal((await emi.json('PUT', `/api/teams/${other.id}/people/${miaId}`, { role: 'edit' })).statusCode, 200);
    const third = await mia.upload(other.rootId, 'Bestand.bin', Buffer.alloc(960 * 1024, 3), 256 * 1024);
    assert.equal(third.statusCode, 200, third.body);
    assert.equal((await warnings(mia)).length, 1);
    const forAdmins = await warnings(emi);
    assert.equal(forAdmins.length, 1);
    assert.equal(forAdmins[0].title, 'Der Teamordner „Lager“ ist zu 93 % voll');
    assert.equal(forAdmins[0].url, '/admin/teams');
  });
});
