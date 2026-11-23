import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { all, one } from '../src/lib/db.ts';
import { ransomwareName } from '../src/lib/ransomware.ts';
import { resetBurst } from '../src/services/ransomware.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaRoot = '';

async function appPassword(name: string) {
  const made = await mia.json('POST', '/api/account/app-passwords', { name });
  assert.equal(made.statusCode, 200, made.body);
  return { id: made.json().item.id as string, auth: `Basic ${Buffer.from(`mia:${made.json().token}`).toString('base64')}` };
}

const dav = (auth: string, method: string, path: string, extra: { payload?: string; headers?: Record<string, string> } = {}) =>
  app.inject({ method: method as 'PUT', url: `/dav/${path}`, headers: { authorization: auth, ...extra.headers }, payload: extra.payload });

const pausedOf = (id: string) => one<{ paused_at: number | null }>('SELECT paused_at FROM app_passwords WHERE id = ?', id)!.paused_at;

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
});

beforeEach(() => {
  resetBurst();
  settings.set('security.ransomware', true);
  settings.set('security.burst', true);
  settings.set('security.burstPause', true);
  settings.set('security.burstLimit', 20);
});

after(async () => {
  await app.close();
});

describe('Bekannte Erpressungstrojaner', () => {
  it('erkennt typische Endungen und Erpresserbriefe', () => {
    for (const name of [
      'rechnung.pdf.locky',
      'Urlaub.JPG.WNCRY',
      'tabelle.xlsx.cerber3',
      'brief.docx.djvus',
      'HOW_TO_DECRYPT.txt',
      'how_to_decrypt.html',
      '@WanaDecryptor@.exe',
      '@Please_Read_Me@.txt',
      '# DECRYPT MY FILES #.html',
      'notiz.txt.locky. ',
    ]) {
      assert.equal(ransomwareName(name), true, name);
    }
    for (const name of [
      'buch.djvu',
      'locky.txt',
      'readme.txt',
      'bericht.pdf',
      '.locky',
      'decrypt.txt',
      'konto.encrypted',
      'msgstore.db.crypt14',
      '',
    ]) {
      assert.equal(ransomwareName(name), false, name);
    }
  });

  it('weist solche Dateien beim Hochladen, Anlegen, Umbenennen und über WebDAV ab', async () => {
    const upload = await mia.upload(miaRoot, 'rechnung.pdf.locky', Buffer.from('verschlüsselt'), 1024);
    assert.equal(upload.statusCode, 403, upload.body);
    assert.equal(upload.json().error.code, 'ransomware');
    assert.match(upload.json().error.message, /Erpressungstrojaner/);
    const note = await mia.json('POST', `/api/nodes/${miaRoot}/text`, { name: 'HOW_TO_DECRYPT.txt', content: 'Zahl uns' });
    assert.equal(note.statusCode, 403);
    const file = await mia.json('POST', `/api/nodes/${miaRoot}/text`, { name: 'plan.txt', content: 'Der Plan' });
    assert.equal(file.statusCode, 200, file.body);
    const renamed = await mia.json('PATCH', `/api/nodes/${file.json().node.id}`, { name: 'plan.txt.wncry' });
    assert.equal(renamed.statusCode, 403);
    const device = await appPassword('Laptop');
    assert.equal((await dav(device.auth, 'PUT', 'foto.jpg.cerber', { payload: 'x' })).statusCode, 403);
    const moved = await dav(device.auth, 'MOVE', 'plan.txt', {
      headers: { destination: 'http://localhost/dav/plan.txt.locky', host: 'localhost' },
    });
    assert.equal(moved.statusCode, 403);
    assert.equal(all("SELECT id FROM nodes WHERE name LIKE '%.locky' OR name LIKE '%.wncry' OR name LIKE '%.cerber'").length, 0);
  });

  it('lässt sich abschalten', async () => {
    settings.set('security.ransomware', false);
    const upload = await mia.upload(miaRoot, 'archiv.zip.locky', Buffer.from('erlaubt'), 1024);
    assert.equal(upload.statusCode, 200, upload.body);
  });
});

describe('Auffällig viele Änderungen', () => {
  it('hält ein Gerät an, das in kurzer Zeit sehr viele Dateien ändert', async () => {
    const device = await appPassword('Büro-PC');
    for (let index = 0; index < 25; index++) {
      assert.equal((await dav(device.auth, 'PUT', `neu-${index}.txt`, { payload: `Neu ${index}` })).statusCode, 201);
    }
    assert.equal(pausedOf(device.id), null, 'neue Dateien zählen nicht');
    for (let index = 0; index < 19; index++) {
      const put = await dav(device.auth, 'PUT', `neu-${index}.txt`, { payload: `Verschlüsselt ${index}` });
      assert.ok(put.statusCode < 300, `${index}: ${put.statusCode}`);
    }
    assert.equal(pausedOf(device.id), null);
    const last = await dav(device.auth, 'DELETE', 'neu-20.txt');
    assert.equal(last.statusCode, 403);
    assert.match(last.body, /angehalten/);
    assert.notEqual(pausedOf(device.id), null);
    assert.equal((await dav(device.auth, 'PUT', 'noch-eins.txt', { payload: 'x' })).statusCode, 403);
    assert.equal((await dav(device.auth, 'GET', 'neu-1.txt')).statusCode, 200, 'lesen geht weiter');
    assert.equal((await dav(device.auth, 'PROPFIND', '', { headers: { depth: '1' } })).statusCode, 207);
    const api = await app.inject({
      method: 'POST',
      url: `/api/nodes/${miaRoot}/folders`,
      headers: { authorization: device.auth, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Neu' }),
    });
    assert.equal(api.statusCode, 403);
    assert.equal(JSON.parse(api.body).error.code, 'device_paused');

    const own = (await mia.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[];
    const note = own.find((entry) => entry.kind === 'device_burst');
    assert.ok(note, JSON.stringify(own.map((entry) => entry.kind)));
    assert.match(note.title, /„Büro-PC“ ist angehalten/);
    assert.match(note.text, /20 Änderungen/);
    assert.equal(note.url, '/account#app-passwoerter');
    const admins = (await emi.get('/api/notifications')).json().items as { kind: string; title: string }[];
    assert.ok(admins.some((entry) => entry.kind === 'admin_burst' && /Ein Gerät von Mia wurde angehalten/.test(entry.title)));
    const logged = one<{ details: string }>("SELECT details FROM audit WHERE action = 'device_burst' ORDER BY id DESC LIMIT 1")!;
    assert.deepEqual(JSON.parse(logged.details), { appPassword: 'Büro-PC', count: 20, paused: true });

    const listed = (await mia.get('/api/account')).json().security.appPasswords as { id: string; paused: { count: number } | null }[];
    assert.equal(listed.find((entry) => entry.id === device.id)?.paused?.count, 20);

    const self = await app.inject({
      method: 'POST',
      url: `/api/account/app-passwords/${device.id}/resume`,
      headers: { authorization: device.auth },
    });
    assert.equal(self.statusCode, 403, 'das Gerät kann sich nicht selbst freigeben');
    const resumed = await mia.json('POST', `/api/account/app-passwords/${device.id}/resume`);
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().item.paused, null);
    assert.equal(pausedOf(device.id), null);
    assert.equal((await dav(device.auth, 'PUT', 'neu-1.txt', { payload: 'wieder erlaubt' })).statusCode, 204);
    assert.equal((await mia.json('POST', `/api/account/app-passwords/${device.id}/resume`)).statusCode, 200);
    assert.equal((await emi.json('POST', `/api/account/app-passwords/${device.id}/resume`)).statusCode, 404);
    assert.ok(all("SELECT id FROM audit WHERE action = 'device_resumed'").length >= 1);
  });

  it('meldet nur, wenn das Anhalten aus ist, und schweigt, wenn die Erkennung aus ist', async () => {
    settings.set('security.burstPause', false);
    const device = await appPassword('Tablet');
    for (let index = 0; index < 3; index++) await dav(device.auth, 'PUT', `t-${index}.txt`, { payload: 'a' });
    for (let index = 0; index < 20; index++) {
      const put = await dav(device.auth, 'PUT', `t-${index % 3}.txt`, { payload: `b${index}` });
      assert.ok(put.statusCode < 300, String(put.statusCode));
    }
    assert.equal(pausedOf(device.id), null);
    const notes = (await mia.get('/api/notifications')).json().items as { kind: string; title: string }[];
    assert.ok(notes.some((entry) => entry.kind === 'device_burst' && /Auffällig viele Änderungen über „Tablet“/.test(entry.title)));

    settings.set('security.burst', false);
    const quiet = await appPassword('Handy');
    for (let index = 0; index < 30; index++) await dav(quiet.auth, 'PUT', `t-${index % 3}.txt`, { payload: `c${index}` });
    assert.equal(pausedOf(quiet.id), null);
    assert.ok(
      !((await mia.get('/api/notifications')).json().items as { kind: string; title: string }[]).some(
        (entry) => entry.kind === 'device_burst' && /Handy/.test(entry.title)
      )
    );
  });

  it('nimmt nur sinnvolle Einstellungen an und zeigt den Schutz in der Sicherheitsprüfung', async () => {
    for (const value of [5, 20_000, 1.5]) {
      assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'security.burstLimit': value })).statusCode, 400, String(value));
    }
    const report = (await emi.get('/api/admin/security')).json();
    assert.deepEqual(report.ransomware, { names: true, burst: true, pause: true, limit: 20 });
    assert.equal(report.items.find((item: { id: string }) => item.id === 'ransomware').level, 'ok');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'security.ransomware': false })).statusCode, 200);
    assert.equal(
      (await emi.get('/api/admin/security')).json().items.find((item: { id: string }) => item.id === 'ransomware').level,
      'hint'
    );
  });
});
