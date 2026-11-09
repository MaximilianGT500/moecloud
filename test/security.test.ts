import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/lib/db.ts';
import { hotp, totpCounter } from '../src/lib/crypto.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let miaId = 0;
let leaId = 0;

before(async () => {
  emi = await setUp(app);
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  leaId = (await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' })).json().user.id;
});

after(async () => {
  await app.close();
});

async function enableTotp(client: Client) {
  const setup = (await client.json('POST', '/api/account/totp/setup')).json();
  const enabled = await client.json('POST', '/api/account/totp/enable', { code: hotp(setup.secret, totpCounter()) });
  assert.equal(enabled.statusCode, 200, enabled.body);
  return enabled.json().recoveryCodes as string[];
}

const person = async (id: number) => (await emi.get('/api/admin/users')).json().items.find((user: { id: number }) => user.id === id);

const dav = (token: string, username: string) =>
  app.inject({
    method: 'PROPFIND' as 'GET',
    url: '/dav/',
    headers: { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`, depth: '0' },
  });

async function startLogin(username: string, password: string) {
  const client = new Client(app);
  await client.get('/login', { accept: 'text/html' });
  const response = await client.form('/login', { _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' });
  return { client, response };
}

describe('Zwei-Faktor-Pflicht', () => {
  let lea: Client;
  let mia: Client;
  let leaRoot = '';
  let appPassword = '';

  it('lässt sich erst mit eigenem zweiten Faktor einschalten', async () => {
    const denied = await emi.json('PATCH', '/api/admin/settings', { 'auth.require2fa': 'all' });
    assert.equal(denied.statusCode, 400);
    await enableTotp(emi);
    const allowed = await emi.json('PATCH', '/api/admin/settings', { 'auth.require2fa': 'admins' });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.equal(allowed.json().settings['auth.require2fa'], 'admins');
  });

  it('betrifft mit „Für Admins“ nur Admins', async () => {
    lea = await login(app, 'lea', 'leas-passwort-123');
    leaRoot = (await lea.get('/api/session')).json().user.rootId;
    assert.equal((await lea.get(`/api/nodes/${leaRoot}/children`)).statusCode, 200);
    appPassword = (await lea.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json().token;
    assert.equal((await dav(appPassword, 'lea')).statusCode, 207);
    assert.equal((await person(leaId)).needs2fa, false);
  });

  it('erlaubt ohne zweiten Faktor nur noch die Einrichtung', async () => {
    await emi.json('PATCH', '/api/admin/settings', { 'auth.require2fa': 'all' });
    const blocked = await lea.get(`/api/nodes/${leaRoot}/children`);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'second_factor_required');
    const page = await lea.get('/files/recent', { accept: 'text/html' });
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, '/account');
    assert.equal((await lea.get('/account', { accept: 'text/html' })).statusCode, 200);
    const account = (await lea.get('/api/account')).json();
    assert.equal(account.security.required, true);
    assert.equal(account.security.setupRequired, true);
    assert.equal((await lea.json('POST', '/api/account/app-passwords', { name: 'Handy' })).statusCode, 403);
    assert.equal((await dav(appPassword, 'lea')).statusCode, 403);
    assert.equal((await person(leaId)).needs2fa, true);
  });

  it('gibt alles frei, sobald die Authenticator-App eingerichtet ist', async () => {
    const codes = await enableTotp(lea);
    assert.equal((await lea.get(`/api/nodes/${leaRoot}/children`)).statusCode, 200);
    assert.equal((await dav(appPassword, 'lea')).statusCode, 207);
    assert.equal((await person(leaId)).needs2fa, false);
    const disable = await lea.json('POST', '/api/account/totp/disable', { code: codes[0] });
    assert.equal(disable.statusCode, 400);
    assert.match(disable.json().error.message, /zweiten Faktor/);
  });

  it('fragt bei Konten mit Passkey nach dem Passkey statt nach einem Code', async () => {
    mia = await login(app, 'mia', 'mias-passwort-123');
    assert.equal((await mia.get('/api/account')).json().security.setupRequired, true);
    run(
      `INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
       VALUES (?, ?, ?, 0, ?, 'singleDevice', 0, 'Laptop', ?)`,
      'dGVzdC1wYXNza2V5',
      miaId,
      new Uint8Array([1, 2, 3]),
      JSON.stringify(['internal']),
      Date.now()
    );
    const { client, response } = await startLogin('mia', 'mias-passwort-123');
    assert.equal(response.statusCode, 303);
    assert.match(String(response.headers.location), /^\/login\/2fa/);
    assert.ok(!client.cookies.get('moe_session'));
    const page = await client.get('/login/2fa', { accept: 'text/html' });
    assert.match(page.body, /data-passkey-confirm/);
    assert.doesNotMatch(page.body, /name="code"/);
    const options = await client.json('POST', '/login/2fa/passkey/options', {});
    assert.equal(options.statusCode, 200, options.body);
    assert.deepEqual(
      options.json().allowCredentials.map((entry: { id: string }) => entry.id),
      ['dGVzdC1wYXNza2V5']
    );
    const bogus = await client.json('POST', '/login/2fa/passkey/verify', {
      response: { id: 'dGVzdC1wYXNza2V5', rawId: 'dGVzdC1wYXNza2V5', type: 'public-key', response: {} },
    });
    assert.equal(bogus.statusCode, 401);
    assert.ok(!client.cookies.get('moe_session'));
    const stranger = new Client(app);
    await stranger.get('/login', { accept: 'text/html' });
    assert.equal((await stranger.json('POST', '/login/2fa/passkey/options', {})).statusCode, 401);
  });

  it('lässt den letzten Passkey nicht entfernen, solange er der einzige Faktor ist', async () => {
    assert.equal((await mia.get('/api/account')).json().security.setupRequired, false);
    const removed = await mia.json('DELETE', '/api/account/passkeys/dGVzdC1wYXNza2V5');
    assert.equal(removed.statusCode, 400, removed.body);
    await emi.json('PATCH', '/api/admin/settings', { 'auth.require2fa': 'off' });
    const direct = await startLogin('mia', 'mias-passwort-123');
    assert.equal(direct.response.headers.location, '/files');
    assert.ok(direct.client.cookies.get('moe_session'));
    assert.equal((await mia.json('DELETE', '/api/account/passkeys/dGVzdC1wYXNza2V5')).statusCode, 200);
  });
});
