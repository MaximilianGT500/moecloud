import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, setUp, setupCode } from './helpers.ts';
import { hotp, totpCounter } from '../src/lib/crypto.ts';
import { value } from '../src/lib/db.ts';
import { collectGarbage } from '../src/services/blobs.ts';

const app = await createApp();
let emi: Client;
let root = '';

before(async () => {
  assert.equal((await new Client(app).get('/')).headers.location, '/setup');
  const wrong = await new Client(app).json('POST', '/api/setup/check', { code: 'falsch' });
  assert.equal(wrong.statusCode, 403);
  assert.ok(setupCode().length > 0);
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
});

after(async () => {
  await app.close();
});

describe('Sicherheit', () => {
  it('blockt Änderungen ohne Sicherheitstoken', async () => {
    const response = await emi.send({
      method: 'POST',
      url: `/api/nodes/${root}/folders`,
      payload: { name: 'X' },
      headers: { 'x-csrf-token': 'nope' },
    });
    assert.equal(response.statusCode, 403);
  });

  it('blockt Anfragen von fremden Seiten', async () => {
    const response = await emi.send({
      method: 'POST',
      url: `/api/nodes/${root}/folders`,
      payload: { name: 'X' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(response.statusCode, 403);
  });

  it('setzt eine Content Security Policy mit Nonce', async () => {
    const response = await new Client(app).get('/login', { accept: 'text/html' });
    assert.equal(response.statusCode, 200);
    const policy = String(response.headers['content-security-policy']);
    assert.match(policy, /script-src 'nonce-[^']+' 'strict-dynamic'/);
    assert.match(response.body, /<form method="post" action="\/login"/);
  });

  it('liefert Dateien mit Sandbox aus', async () => {
    const created = await emi.upload(root, 'seite.html', Buffer.from('<script>alert(1)</script>'));
    const id = created.json().node.id;
    const response = await emi.get(`/api/nodes/${id}/content`);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(String(response.headers['content-security-policy']), /sandbox/);
  });
});

describe('Dateien', () => {
  let folder = '';
  let file = '';

  it('legt Ordner an und verhindert doppelte Namen', async () => {
    const created = await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Fotos' });
    assert.equal(created.statusCode, 200);
    folder = created.json().node.id;
    const twice = await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'fotos' });
    assert.equal(twice.statusCode, 409);
    const bad = await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'a/b' });
    assert.equal(bad.statusCode, 400);
  });

  it('antwortet bei ungültigen Eingaben mit einem eigenen Text', async () => {
    for (const payload of [{ name: 'x'.repeat(1001) }, { name: 7 }, {}]) {
      const response = await emi.json('POST', `/api/nodes/${root}/folders`, payload);
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.message, 'Die Eingabe ist ungültig');
    }
    const guest = await new Client(app).get(`/api/nodes/${root}/children`, { 'accept-language': 'en' });
    assert.equal(guest.statusCode, 401);
    assert.equal(guest.json().error.message, 'Please sign in');
  });

  it('lädt in Stücken hoch und liefert den Inhalt aus', async () => {
    const content = Buffer.from('Hallo Mia, hier ist die Einkaufsliste für Lea.');
    const response = await emi.upload(folder, 'notiz.txt', content, 7);
    assert.equal(response.statusCode, 200, response.body);
    file = response.json().node.id;
    const download = await emi.get(`/api/nodes/${file}/content?download=1`);
    assert.equal(download.body, content.toString());
    assert.match(String(download.headers['content-disposition']), /attachment/);
    const range = await emi.get(`/api/nodes/${file}/content`, { range: 'bytes=0-4' });
    assert.equal(range.statusCode, 206);
    assert.equal(range.body, 'Hallo');
    assert.equal(range.headers['content-range'], `bytes 0-4/${content.length}`);
  });

  it('setzt einen unterbrochenen Upload fort', async () => {
    const content = Buffer.from('0123456789abcdef');
    const init = (await emi.json('POST', '/api/uploads', { parentId: folder, name: 'fortsetzung.bin', size: content.length })).json();
    await emi.send({
      method: 'PUT',
      url: `/api/uploads/${init.id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: content.subarray(0, 6),
    });
    const wrong = await emi.send({
      method: 'PUT',
      url: `/api/uploads/${init.id}?offset=2`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: content.subarray(2, 6),
    });
    assert.equal(wrong.statusCode, 409);
    assert.equal(wrong.json().error.received, 6);
    const status = (await emi.get(`/api/uploads/${init.id}`)).json();
    assert.equal(status.received, 6);
    await emi.send({
      method: 'PUT',
      url: `/api/uploads/${init.id}?offset=6`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: content.subarray(6),
    });
    const done = await emi.json('POST', `/api/uploads/${init.id}/complete`);
    assert.equal(done.statusCode, 200);
    assert.equal(done.json().node.size, 16);
  });

  it('legt Ordnerstrukturen beim Hochladen an', async () => {
    const response = await emi.upload(root, 'bild.txt', Buffer.from('x'), 4, { relativePath: 'Urlaub/2026' });
    assert.equal(response.statusCode, 200);
    const list = (await emi.get(`/api/nodes/${root}/children`)).json();
    const urlaub = list.items.find((item: { name: string }) => item.name === 'Urlaub');
    assert.ok(urlaub);
    const inner = (await emi.get(`/api/nodes/${urlaub.id}/children`)).json();
    assert.equal(inner.items[0].name, '2026');
  });

  it('benennt um, kopiert, verschiebt und markiert', async () => {
    const renamed = await emi.json('PATCH', `/api/nodes/${file}`, { name: 'einkauf.txt' });
    assert.equal(renamed.json().node.name, 'einkauf.txt');
    const copy = await emi.json('POST', '/api/nodes/copy', { ids: [file], target: folder });
    assert.equal(copy.json().items[0].name, 'einkauf (2).txt');
    const moved = await emi.json('POST', '/api/nodes/move', { ids: [copy.json().items[0].id], target: root });
    assert.equal(moved.json().items[0].parentId, root);
    const cycle = await emi.json('POST', '/api/nodes/move', { ids: [folder], target: folder });
    assert.equal(cycle.statusCode, 400);
    await emi.json('PUT', `/api/nodes/${file}/star`, { starred: true });
    const starred = (await emi.get('/api/starred')).json();
    assert.equal(starred.items[0].id, file);
    const recent = (await emi.get('/api/recent')).json();
    assert.ok(recent.items.some((item: { id: string }) => item.id === file));
  });

  it('findet Dateien', async () => {
    const long = (await emi.get('/api/search?q=inkau')).json();
    assert.ok(long.items.some((item: { name: string }) => item.name === 'einkauf.txt'));
    const short = (await emi.get('/api/search?q=ei')).json();
    assert.ok(short.items.length >= 1);
    const filtered = (await emi.get('/api/search?q=Fotos&kind=folder')).json();
    assert.equal(filtered.items[0].type, 'folder');
  });

  it('speichert Versionen und stellt sie wieder her', async () => {
    const write = await emi.send({
      method: 'PUT',
      url: `/api/nodes/${file}/content`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('Neue Liste'),
    });
    assert.equal(write.statusCode, 200, write.body);
    const versions = (await emi.get(`/api/nodes/${file}/versions`)).json().items;
    assert.equal(versions.length, 1);
    const restored = await emi.json('POST', `/api/nodes/${file}/versions/${versions[0].id}/restore`);
    assert.equal(restored.statusCode, 200);
    const content = await emi.get(`/api/nodes/${file}/content`);
    assert.match(content.body, /Einkaufsliste/);
    assert.equal((await emi.get(`/api/nodes/${file}/versions`)).json().items.length, 1);
  });

  it('packt Ordner als ZIP', async () => {
    const response = await emi.get(`/api/zip?ids=${folder}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.equal(response.rawPayload.subarray(0, 2).toString(), 'PK');
  });

  it('erzeugt Vorschaubilder', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#8b5cf6' } })
      .png()
      .toBuffer();
    const image = await emi.upload(folder, 'lila.png', png, 64 * 1024);
    const id = image.json().node.id;
    assert.equal(image.json().node.thumb, true);
    const thumb = await emi.get(`/api/nodes/${id}/thumb`);
    assert.equal(thumb.statusCode, 200);
    assert.equal(thumb.headers['content-type'], 'image/webp');
    const meta = await sharp(thumb.rawPayload).metadata();
    assert.equal(meta.width, 480);
  });

  it('legt in den Papierkorb, stellt wieder her und löscht endgültig', async () => {
    const created = await emi.upload(root, 'weg.txt', Buffer.from('einmalig-inhalt-fuer-gc'));
    const id = created.json().node.id;
    const sha = value<string>('SELECT sha256 FROM nodes WHERE id = ?', id)!;
    await emi.json('POST', '/api/nodes/trash', { ids: [folder, id] });
    const list = (await emi.get(`/api/nodes/${root}/children`)).json();
    assert.ok(!list.items.some((item: { id: string }) => item.id === folder));
    const trash = (await emi.get('/api/trash')).json();
    assert.equal(trash.items.length, 2);
    const blocked = await emi.get(`/api/nodes/${file}/content`);
    assert.equal(blocked.statusCode, 404);
    await emi.json('POST', '/api/nodes/restore', { ids: [folder] });
    assert.equal((await emi.get(`/api/nodes/${file}/content`)).statusCode, 200);
    await emi.json('POST', '/api/nodes/delete', { ids: [id] });
    assert.equal(value<number>('SELECT refs FROM blobs WHERE sha256 = ?', sha), 0);
    assert.equal(await collectGarbage(0), 1);
    assert.equal(value<number>('SELECT COUNT(*) FROM blobs WHERE sha256 = ?', sha), 0);
  });
});

describe('Anmeldung', () => {
  it('meldet mit Formular an und ab', async () => {
    const client = new Client(app);
    await client.get('/login', { accept: 'text/html' });
    const csrf = client.cookies.get('moe_csrf')!;
    const wrong = await client.form('/login', { _csrf: csrf, login: 'emi', password: 'falsch-falsch', next: '/files' });
    assert.equal(wrong.statusCode, 401);
    assert.match(wrong.body, /stimmt nicht/);
    const ok = await client.form('/login', { _csrf: csrf, login: 'EMI', password: 'sehr-sicheres-passwort', next: '/files' });
    assert.equal(ok.statusCode, 303);
    assert.equal(ok.headers.location, '/files');
    assert.ok(client.cookies.get('moe_session'));
  });

  it('verlangt den zweiten Faktor', async () => {
    const setup = (await emi.json('POST', '/api/account/totp/setup')).json();
    const enable = await emi.json('POST', '/api/account/totp/enable', { code: hotp(setup.secret, totpCounter()) });
    assert.equal(enable.statusCode, 200);
    assert.equal(enable.json().recoveryCodes.length, 10);
    const client = new Client(app);
    await client.get('/login', { accept: 'text/html' });
    const csrf = client.cookies.get('moe_csrf')!;
    const first = await client.form('/login', { _csrf: csrf, login: 'emi', password: 'sehr-sicheres-passwort', next: '/files' });
    assert.equal(first.statusCode, 303);
    assert.match(String(first.headers.location), /^\/login\/2fa/);
    assert.ok(!client.cookies.get('moe_session'));
    const code = enable.json().recoveryCodes[0];
    const second = await client.form('/login/2fa', { _csrf: csrf, code, next: '/files' });
    assert.equal(second.statusCode, 303);
    assert.ok(client.cookies.get('moe_session'));
    const reuse = new Client(app);
    await reuse.get('/login', { accept: 'text/html' });
    const again = reuse.cookies.get('moe_csrf')!;
    await reuse.form('/login', { _csrf: again, login: 'emi', password: 'sehr-sicheres-passwort', next: '/files' });
    const replay = await reuse.form('/login/2fa', { _csrf: again, code, next: '/files' });
    assert.equal(replay.statusCode, 400);
    const disable = await emi.json('POST', '/api/account/totp/disable', { code: enable.json().recoveryCodes[1] });
    assert.equal(disable.statusCode, 200);
  });
});

describe('Teilen', () => {
  let mia: Client;
  let miaId = 0;
  let shared = '';

  before(async () => {
    const created = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
    assert.equal(created.statusCode, 200, created.body);
    miaId = created.json().user.id;
    mia = new Client(app);
    await mia.get('/login', { accept: 'text/html' });
    await mia.form('/login', { _csrf: mia.cookies.get('moe_csrf')!, login: 'mia', password: 'mias-passwort-123', next: '/files' });
    await mia.refreshCsrf();
    shared = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Gemeinsam' })).json().node.id;
    await emi.upload(shared, 'plan.md', Buffer.from('# Plan'));
  });

  it('teilt mit Personen und achtet auf Rechte', async () => {
    const search = (await emi.get('/api/users/search?q=mi')).json();
    assert.equal(search.items[0].username, 'mia');
    const grant = await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'view' });
    assert.equal(grant.statusCode, 200);
    const list = (await mia.get('/api/shared')).json();
    assert.equal(list.withMe[0].id, shared);
    const children = (await mia.get(`/api/nodes/${shared}/children`)).json();
    assert.equal(children.items[0].name, 'plan.md');
    assert.equal(children.role, 'view');
    const denied = await mia.upload(shared, 'mia.txt', Buffer.from('hallo'));
    assert.equal(denied.statusCode, 403);
    await emi.json('PATCH', `/api/grants/${grant.json().grant.id}`, { permission: 'edit' });
    const allowed = await mia.upload(shared, 'mia.txt', Buffer.from('hallo'));
    assert.equal(allowed.statusCode, 200);
    const owner = value<number>('SELECT owner_id FROM nodes WHERE id = ?', allowed.json().node.id);
    assert.notEqual(owner, miaId);
    const renameRoot = await mia.json('PATCH', `/api/nodes/${shared}`, { name: 'Meins' });
    assert.equal(renameRoot.statusCode, 403);
    const ownRoot = (await mia.get('/api/session')).json().user.rootId;
    const crossMove = await mia.json('POST', '/api/nodes/move', { ids: [allowed.json().node.id], target: ownRoot });
    assert.equal(crossMove.statusCode, 400);
    const crossCopy = await mia.json('POST', '/api/nodes/copy', { ids: [allowed.json().node.id], target: ownRoot });
    assert.equal(crossCopy.statusCode, 200);
  });

  it('erstellt Links mit Passwort', async () => {
    const created = await emi.json('POST', `/api/nodes/${shared}/links`, { password: 'geheim-123', allowUpload: true });
    assert.equal(created.statusCode, 200, created.body);
    const { token } = created.json().link;
    const guest = new Client(app);
    const page = await guest.get(`/s/${token}`, { accept: 'text/html' });
    assert.match(page.body, /Geschützter Link|Passwort/);
    assert.equal((await guest.get(`/api/public/${token}`)).statusCode, 401);
    const csrf = guest.cookies.get('moe_csrf')!;
    const wrong = await guest.form(`/s/${token}`, { _csrf: csrf, password: 'nein' });
    assert.equal(wrong.statusCode, 403);
    const unlock = await guest.form(`/s/${token}`, { _csrf: csrf, password: 'geheim-123' });
    assert.equal(unlock.statusCode, 303);
    const info = (await guest.get(`/api/public/${token}`)).json();
    assert.equal(info.share.node.name, 'Gemeinsam');
    const items = (await guest.get(`/api/public/${token}/nodes/${shared}/children`)).json().items;
    const plan = items.find((item: { name: string }) => item.name === 'plan.md');
    const content = await guest.get(`/api/public/${token}/nodes/${plan.id}/content?download=1`);
    assert.equal(content.body, '# Plan');
    const outside = await guest.get(`/api/public/${token}/nodes/${root}/children`);
    assert.equal(outside.statusCode, 404);
    const init = await guest.json('POST', `/api/public/${token}/uploads`, { parentId: shared, name: 'gast.txt', size: 4 });
    assert.equal(init.statusCode, 200, init.body);
    await guest.send({
      method: 'PUT',
      url: `/api/public/${token}/uploads/${init.json().id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('gast'),
    });
    const done = await guest.json('POST', `/api/public/${token}/uploads/${init.json().id}/complete`);
    assert.equal(done.statusCode, 200, done.body);
    const zip = await guest.get(`/api/public/${token}/zip`);
    assert.equal(zip.rawPayload.subarray(0, 2).toString(), 'PK');
  });

  it('beachtet das Speicherkontingent', async () => {
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: 1024 });
    const ownRoot = (await mia.get('/api/session')).json().user.rootId;
    const tooBig = await mia.upload(ownRoot, 'gross.bin', Buffer.alloc(4096, 1), 4096);
    assert.equal(tooBig.statusCode, 507);
  });
});

describe('WebDAV', () => {
  let auth = '';

  before(async () => {
    const created = (await emi.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json();
    auth = `Basic ${Buffer.from(`emi:${created.token}`).toString('base64')}`;
  });

  const dav = (method: string, url: string, headers: Record<string, string> = {}, payload?: string | Buffer) =>
    app.inject({ method: method as 'GET', url, headers: { authorization: auth, ...headers }, payload });

  it('lehnt falsche Zugangsdaten ab', async () => {
    const response = await app.inject({
      method: 'PROPFIND' as 'GET',
      url: '/dav/',
      headers: { authorization: `Basic ${Buffer.from('emi:falsch').toString('base64')}` },
    });
    assert.equal(response.statusCode, 401);
    assert.match(String(response.headers['www-authenticate']), /Basic/);
  });

  it('listet, schreibt, verschiebt und löscht', async () => {
    const options = await app.inject({ method: 'OPTIONS', url: '/dav/' });
    assert.equal(options.headers.dav, '1, 2');
    const list = await dav('PROPFIND', '/dav/', { depth: '1' });
    assert.equal(list.statusCode, 207);
    assert.match(list.body, /<d:href>\/dav\/Fotos\/<\/d:href>/);
    assert.equal((await dav('MKCOL', '/dav/Dokumente')).statusCode, 201);
    assert.equal((await dav('MKCOL', '/dav/Fehlt/Unterordner')).statusCode, 409);
    const put = await dav(
      'PUT',
      '/dav/Dokumente/br%C3%BCcke.txt',
      { 'content-type': 'application/json', 'x-oc-mtime': '1700000000' },
      '{"a":1}'
    );
    assert.equal(put.statusCode, 201);
    const get = await dav('GET', '/dav/Dokumente/br%C3%BCcke.txt');
    assert.equal(get.body, '{"a":1}');
    const overwrite = await dav('PUT', '/dav/Dokumente/br%C3%BCcke.txt', {}, 'neu');
    assert.equal(overwrite.statusCode, 204);
    const move = await dav('MOVE', '/dav/Dokumente/br%C3%BCcke.txt', { destination: 'http://localhost:80/dav/Dokumente/neu.txt' });
    assert.equal(move.statusCode, 201);
    const copy = await dav('COPY', '/dav/Dokumente/neu.txt', { destination: '/dav/kopie.txt' });
    assert.equal(copy.statusCode, 201);
    const blocked = await dav('COPY', '/dav/Dokumente/neu.txt', { destination: '/dav/kopie.txt', overwrite: 'F' });
    assert.equal(blocked.statusCode, 412);
    const lock = await dav('LOCK', '/dav/kopie.txt', {}, '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"/>');
    assert.equal(lock.statusCode, 200);
    assert.match(String(lock.headers['lock-token']), /opaquelocktoken/);
    const patch = await dav(
      'PROPPATCH',
      '/dav/kopie.txt',
      {},
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop><Z:Win32LastModifiedTime>Sat, 07 Nov 2026 21:00:00 GMT</Z:Win32LastModifiedTime></D:prop></D:set></D:propertyupdate>'
    );
    assert.equal(patch.statusCode, 207);
    assert.match(patch.body, /Win32LastModifiedTime/);
    assert.equal((await dav('DELETE', '/dav/kopie.txt')).statusCode, 204);
    assert.equal((await dav('PROPFIND', '/dav/kopie.txt', { depth: '0' })).statusCode, 404);
    const file = await dav('PROPFIND', '/dav/Dokumente/neu.txt', { depth: '0' });
    assert.match(file.body, /<d:getcontentlength>3<\/d:getcontentlength>/);
  });
});
