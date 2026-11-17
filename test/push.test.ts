import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/lib/db.ts';
import { accountData } from '../src/services/export.ts';
import { getUser } from '../src/services/users.ts';
import { Client, createApp, httpSink, login, setUp, type Captured } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaId = 0;
let root = '';
let status = 200;
const sink = await httpSink(0, () => ({ status }));

async function eventually(check: () => boolean, timeout = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) assert.fail('Die Bedingung trat nicht ein');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const notes = async (client: Client, kind: string) =>
  ((await client.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[]).filter(
    (item) => item.kind === kind
  );

const body = (entry: Captured) => JSON.parse(entry.body) as Record<string, unknown>;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await sink.close();
  await app.close();
});

describe('Downloads über Links melden', () => {
  it('meldet Downloads höchstens einmal pro Stunde', async () => {
    const file = (await emi.upload(root, 'Bericht für Lea.txt', Buffer.from('Inhalt'), 4096)).json().node.id;
    const quiet = (await emi.json('POST', `/api/nodes/${file}/links`, {})).json().link;
    assert.equal(quiet.notifyDownloads, false);
    const created = await emi.json('POST', `/api/nodes/${file}/links`, { notifyDownloads: true });
    assert.equal(created.statusCode, 200, created.body);
    const link = created.json().link;
    assert.equal(link.notifyDownloads, true);
    const guest = new Client(app);
    const download = () => guest.get(`/api/public/${link.token}/nodes/${file}/content?download=1`);
    assert.equal((await guest.get(`/api/public/${quiet.token}/nodes/${file}/content?download=1`)).statusCode, 200);
    assert.equal((await notes(emi, 'link_download')).length, 0);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${file}/content`)).statusCode, 200);
    assert.equal((await notes(emi, 'link_download')).length, 0);
    assert.equal((await download()).statusCode, 200);
    assert.equal((await download()).statusCode, 200);
    const first = await notes(emi, 'link_download');
    assert.equal(first.length, 1);
    assert.equal(first[0].title, '„Bericht für Lea.txt“ wurde über deinen Link heruntergeladen');
    assert.match(first[0].text, /^Downloads über diesen Link bisher: 1\./);
    assert.equal(first[0].url, `/files/folder/${root}?select=${file}`);
    run('UPDATE links SET notified_at = ? WHERE id = ?', Date.now() - 2 * 60 * 60 * 1000, link.id);
    assert.equal((await download()).statusCode, 200);
    const second = await notes(emi, 'link_download');
    assert.equal(second.length, 2);
    assert.match(second[0].text, /^Downloads über diesen Link bisher: 3\./);
    const off = await emi.json('PATCH', `/api/links/${link.id}`, { allowDownload: false });
    assert.equal(off.json().link.notifyDownloads, false);
  });
});

describe('Push über ntfy und Gotify', () => {
  it('sperrt Adressen im lokalen Netz, bis ein Admin sie erlaubt', async () => {
    const literal = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url: `http://127.0.0.1:${sink.port}/mia-moecloud` });
    assert.equal(literal.statusCode, 403);
    assert.equal(literal.json().error.message, 'Adressen im lokalen Netz sind für Push gesperrt');
    const named = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url: `http://localhost:${sink.port}/mia-moecloud` });
    assert.equal(named.statusCode, 200, named.body);
    const tested = await mia.json('POST', '/api/account/push/test');
    assert.equal(tested.statusCode, 403);
    assert.equal(tested.json().error.message, 'Adressen im lokalen Netz sind für Push gesperrt');
    assert.equal(sink.received.length, 0);
    const topicless = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url: 'https://ntfy.sh/' });
    assert.equal(topicless.json().error.message, 'Gib die Adresse mit Thema an, etwa https://ntfy.sh/mein-thema');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'push.private': true })).statusCode, 200);
  });

  it('schickt Tests und Benachrichtigungen an ntfy', async () => {
    const url = `http://127.0.0.1:${sink.port}/mia-moecloud`;
    const saved = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url, token: 'tk_von_mia' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().push, { kind: 'ntfy', url, hasToken: true });
    const account = await mia.get('/api/account');
    assert.ok(!account.body.includes('tk_von_mia'));
    assert.equal(account.json().prefs.push, undefined);
    assert.deepEqual(account.json().push, { kind: 'ntfy', url, hasToken: true });
    assert.deepEqual(accountData(getUser(miaId)!).settings.push, { kind: 'ntfy', url });
    const tested = await mia.json('POST', '/api/account/push/test');
    assert.equal(tested.statusCode, 200, tested.body);
    const test = sink.received.at(-1)!;
    assert.equal(test.method, 'POST');
    assert.equal(test.url, '/');
    assert.equal(test.headers.authorization, 'Bearer tk_von_mia');
    assert.deepEqual(body(test), {
      topic: 'mia-moecloud',
      title: 'Test von MoeCloud',
      message: 'Wenn du das liest, kommen Benachrichtigungen bei dir an.',
      tags: ['cloud'],
    });
    const kept = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url });
    assert.equal(kept.json().push.hasToken, true);
    const before = sink.received.length;
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Urlaub mit Mia' })).json().node.id;
    await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: miaId, permission: 'view' });
    await eventually(() => sink.received.length > before);
    const shared = body(sink.received.at(-1)!);
    assert.equal(shared.title, (await notes(mia, 'shared'))[0].title);
    assert.match(String(shared.click), /^http:\/\/localhost:3000\/files\//);
    await mia.json('PATCH', '/api/account/prefs', { mailShares: false });
    const other = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Fotos für Mia' })).json().node.id;
    await emi.json('POST', `/api/nodes/${other}/grants`, { userId: miaId, permission: 'view' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(sink.received.length, before + 1);
    await mia.json('PATCH', '/api/account/prefs', { mailShares: true });
  });

  it('schickt an Gotify und meldet Fehler verständlich', async () => {
    const url = `http://127.0.0.1:${sink.port}/gotify`;
    const missing = await mia.json('PUT', '/api/account/push', { kind: 'gotify', url });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error.message, 'Gotify braucht einen App-Token');
    assert.equal((await mia.json('PUT', '/api/account/push', { kind: 'gotify', url, token: 'gotify-von-mia' })).statusCode, 200);
    assert.equal((await mia.json('POST', '/api/account/push/test')).statusCode, 200);
    const sent = sink.received.at(-1)!;
    assert.equal(sent.url, '/gotify/message');
    assert.equal(sent.headers['x-gotify-key'], 'gotify-von-mia');
    assert.equal(body(sent).priority, 5);
    status = 401;
    const rejected = await mia.json('POST', '/api/account/push/test');
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.message, 'Der Push-Dienst lehnt den Token ab');
    status = 500;
    const broken = await mia.json('POST', '/api/account/push/test');
    assert.equal(broken.json().error.message, 'Der Push-Dienst hat mit 500 geantwortet');
    status = 200;
    assert.equal((await mia.json('DELETE', '/api/account/push')).statusCode, 200);
    assert.equal((await mia.get('/api/account')).json().push, null);
    await emi.json('PATCH', '/api/admin/settings', { 'push.enabled': false });
    const disabled = await mia.json('PUT', '/api/account/push', { kind: 'ntfy', url: `http://127.0.0.1:${sink.port}/mia` });
    assert.equal(disabled.statusCode, 403);
    assert.equal(disabled.json().error.message, 'Push ist auf diesem Server ausgeschaltet');
    assert.equal((await mia.get('/api/account')).json().pushEnabled, false);
    await emi.json('PATCH', '/api/admin/settings', { 'push.enabled': true, 'push.private': false });
  });
});
