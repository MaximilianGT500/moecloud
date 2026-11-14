import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import Provider from 'oidc-provider';
import { Client, createApp, login, setUp } from './helpers.ts';
import { run, value } from '../src/lib/db.ts';
import * as settings from '../src/services/settings.ts';

const CALLBACK = 'http://localhost:3000/login/oidc/callback';

const accounts: Record<string, Record<string, unknown>> = {
  'mia-1': { email: 'mia@example.com', email_verified: true, name: 'Mia', preferred_username: 'mia' },
  'lea-1': { email: 'lea@example.com', email_verified: true, name: 'Lea Lang', preferred_username: 'lea', groups: ['moecloud-admins'] },
  'emily-1': { email: 'emily@example.com', email_verified: true, name: 'Emily', preferred_username: 'emily', groups: ['team'] },
  'fremd-1': { email: 'emi@example.com', email_verified: false, name: 'Fremd', preferred_username: 'fremd' },
};

let app: Awaited<ReturnType<typeof createApp>>;
let emi: Client;
let provider: Provider;
let issuer = '';
let server: ReturnType<Provider['listen']>;

function jar() {
  const cookies = new Map<string, string>();
  return {
    header: () => [...cookies].map(([key, val]) => `${key}=${val}`).join('; '),
    store(response: Response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
      }
    },
  };
}

async function signIn(client: Client, account: string, next = '/files') {
  const start = await client.get(`/login/oidc?next=${encodeURIComponent(next)}`);
  assert.equal(start.statusCode, 302, start.body);
  let location = String(start.headers.location);
  assert.ok(location.startsWith(issuer), location);
  const cookies = jar();
  for (let step = 0; step < 12; step++) {
    if (location.startsWith(CALLBACK)) break;
    const url = new URL(location, issuer);
    const interaction = /^\/interaction\/[^/]+$/.test(url.pathname);
    const response = await fetch(url, {
      method: interaction ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        cookie: cookies.header(),
        ...(interaction ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: interaction
        ? new URLSearchParams(step < 2 ? { prompt: 'login', login: account, password: 'egal' } : { prompt: 'consent' })
        : undefined,
    });
    cookies.store(response);
    const target = response.headers.get('location');
    if (!target) {
      const html = await response.text();
      if (html.includes('name="prompt" value="consent"')) {
        location = url.href;
        continue;
      }
      throw new Error(`Anbieter ohne Weiterleitung: ${response.status} ${html.slice(0, 300)}`);
    }
    location = new URL(target, url).href;
  }
  assert.ok(location.startsWith(CALLBACK), location);
  const callback = new URL(location);
  return client.get(`/login/oidc/callback${callback.search}`, { accept: 'text/html' });
}

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

before(async () => {
  const port = await freePort();
  issuer = `http://localhost:${port}`;
  provider = new Provider(issuer, {
    clients: [{ client_id: 'moecloud', client_secret: 'ein-langes-geheimnis-fuer-tests', redirect_uris: [CALLBACK] }],
    claims: { email: ['email', 'email_verified'], profile: ['name', 'preferred_username'], groups: ['groups'] },
    scopes: ['openid', 'offline_access', 'groups'],
    features: { devInteractions: { enabled: true } },
    cookies: { keys: ['test-schluessel-eins'] },
    jwks: {
      keys: [
        {
          ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }),
          kid: 'test',
          alg: 'RS256',
          use: 'sig',
        },
      ],
    },
    async findAccount(_context, id) {
      if (!accounts[id]) return undefined;
      return { accountId: id, claims: async () => ({ sub: id, ...accounts[id] }) };
    },
  });
  server = provider.listen(port);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  app = await createApp();
  emi = await setUp(app);
  const created = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'mias-langes-passwort',
  });
  assert.equal(created.statusCode, 200, created.body);
});

after(async () => {
  await app.close();
  server.close();
});

describe('Anmeldung über SSO', () => {
  it('bleibt aus, solange nichts eingerichtet ist', async () => {
    const client = new Client(app);
    const page = await client.get('/login', { accept: 'text/html' });
    assert.doesNotMatch(page.body, /\/login\/oidc/);
    const start = await client.get('/login/oidc?next=/files');
    assert.equal(start.statusCode, 302);
    assert.match(String(start.headers.location), /^\/login\?next=/);
  });

  it('lässt Admins den Anbieter einrichten und prüfen', async () => {
    const empty = await emi.json('PATCH', '/api/admin/sso', { 'oidc.enabled': true });
    assert.equal(empty.statusCode, 400);
    const saved = await emi.json('PATCH', '/api/admin/sso', {
      'oidc.enabled': true,
      'oidc.issuer': issuer,
      'oidc.clientId': 'moecloud',
      'oidc.clientSecret': 'ein-langes-geheimnis-fuer-tests',
      'oidc.label': 'Mit Moe-ID anmelden',
      'oidc.adminGroup': 'moecloud-admins',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const view = saved.json();
    assert.equal(view.hasSecret, true);
    assert.equal(view.ready, true);
    assert.equal(view.callback, CALLBACK);
    assert.equal(JSON.stringify(view).includes('ein-langes-geheimnis'), false);
    const test = await emi.json('POST', '/api/admin/sso/test', {});
    assert.equal(test.statusCode, 200, test.body);
    assert.equal(test.json().issuer, issuer);
    assert.equal(test.json().groups, true);
    const page = await new Client(app).get('/login', { accept: 'text/html' });
    assert.match(page.body, /Mit Moe-ID anmelden/);
  });

  it('verknüpft ein Konto über die bestätigte E-Mail-Adresse', async () => {
    const client = new Client(app);
    const done = await signIn(client, 'mia-1', '/files/recent');
    assert.equal(done.statusCode, 303, done.body);
    assert.equal(done.headers.location, '/files/recent');
    const session = (await client.get('/api/session')).json();
    assert.equal(session.user.username, 'mia');
    assert.equal(value<string>("SELECT oidc_sub FROM users WHERE username = 'mia'"), `${issuer}#mia-1`);
    const again = await signIn(new Client(app), 'mia-1');
    assert.equal(again.statusCode, 303);
  });

  it('lässt Fremde ohne Freigabe nicht herein', async () => {
    const unknown = await signIn(new Client(app), 'emily-1');
    assert.equal(unknown.statusCode, 403);
    assert.match(unknown.body, /noch keinen Zugang/);
    const unverified = await signIn(new Client(app), 'fremd-1');
    assert.equal(unverified.statusCode, 403);
    assert.equal(value<string | null>("SELECT oidc_sub FROM users WHERE username = 'emi'"), null);
    assert.ok((value<number>("SELECT COUNT(*) FROM audit WHERE action = 'login_failed'") ?? 0) >= 2);
  });

  it('legt Konten an und vergibt Admin über die Gruppe', async () => {
    const saved = await emi.json('PATCH', '/api/admin/sso', { 'oidc.autoCreate': true });
    assert.equal(saved.statusCode, 200);
    const client = new Client(app);
    assert.equal((await signIn(client, 'lea-1')).statusCode, 303);
    const lea = (await client.get('/api/session')).json().user;
    assert.equal(lea.username, 'lea');
    assert.equal(lea.name, 'Lea Lang');
    assert.equal(lea.role, 'admin');
    const emily = new Client(app);
    assert.equal((await signIn(emily, 'emily-1')).statusCode, 303);
    const user = (await emily.get('/api/session')).json().user;
    assert.equal(user.role, 'user');
    assert.equal(user.email, 'emily@example.com');
    assert.ok(user.rootId);
  });

  it('verlangt bei SSO keinen eigenen zweiten Faktor', async () => {
    settings.set('auth.require2fa', 'all');
    const client = new Client(app);
    await signIn(client, 'emily-1');
    const files = await client.get('/api/nodes/' + (await client.get('/api/session')).json().user.rootId + '/children');
    assert.equal(files.statusCode, 200);
    const account = (await client.get('/api/account')).json();
    assert.equal(account.security.setupRequired, false);
    assert.deepEqual(account.security.sso, { enabled: true });
    const password = await login(app, 'mia', 'mias-langes-passwort');
    assert.equal((await password.get('/api/account')).json().security.setupRequired, true);
    settings.set('auth.require2fa', 'off');
  });

  it('trennt die Verknüpfung nur mit Passwort', async () => {
    const client = new Client(app);
    await signIn(client, 'emily-1');
    await client.refreshCsrf();
    assert.equal((await client.json('DELETE', '/api/account/sso')).statusCode, 400);
    const mia = await login(app, 'mia', 'mias-langes-passwort');
    assert.equal((await mia.json('DELETE', '/api/account/sso')).statusCode, 200);
    assert.equal(value<string | null>("SELECT oidc_sub FROM users WHERE username = 'mia'"), null);
  });

  it('weist kaputte oder fremde Antworten ab', async () => {
    const client = new Client(app);
    const start = await client.get('/login/oidc?next=/files');
    assert.equal(start.statusCode, 302);
    const forged = await client.get('/login/oidc/callback?code=falsch&state=falsch', { accept: 'text/html' });
    assert.equal(forged.statusCode, 401);
    const missing = await new Client(app).get('/login/oidc/callback?code=x&state=y', { accept: 'text/html' });
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body, /abgelaufen/);
    const denied = await new Client(app).get('/login/oidc/callback?error=access_denied', { accept: 'text/html' });
    assert.equal(denied.statusCode, 401);
    assert.match(denied.body, /abgebrochen/);
    run("UPDATE users SET disabled = 1 WHERE username = 'lea'");
    const blocked = await signIn(new Client(app), 'lea-1');
    assert.equal(blocked.statusCode, 401);
    assert.match(blocked.body, /gesperrt/);
  });
});
