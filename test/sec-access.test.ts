import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { routesOf } from '../src/app.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const OPEN_API = [
  'POST /api/language',
  'POST /api/setup',
  'POST /api/setup/check',
  'POST /api/auth/passkey/options',
  'POST /api/auth/passkey/verify',
];

const OPEN_PAGES = new Set([
  'GET /',
  'GET /healthz',
  'GET /robots.txt',
  'GET /manifest.webmanifest',
  'GET /sw.js',
  'GET /favicon.svg',
  'GET /favicon.ico',
  'GET /favicon-32.png',
  'GET /apple-touch-icon.png',
  'GET /icons/icon-192.png',
  'GET /icons/icon-512.png',
  'GET /icons/maskable-512.png',
  'GET /assets/*',
  'GET /branding/:kind',
  'GET /lang/:lang',
  'GET /impressum',
  'GET /datenschutz',
  'GET /nutzungsbedingungen',
  'POST /nutzungsbedingungen',
  'GET /f/:token',
  'POST /f/:token',
  'GET /setup',
  'GET /login',
  'POST /login',
  'GET /login/2fa',
  'POST /login/2fa',
  'POST /login/2fa/passkey/options',
  'POST /login/2fa/passkey/verify',
  'GET /login/oidc',
  'GET /login/oidc/callback',
  'POST /logout',
  'GET /register',
  'POST /register',
  'GET /register/confirm',
  'GET /forgot',
  'POST /forgot',
  'GET /reset',
  'POST /reset',
  'GET /s/:token',
  'POST /s/:token',
  'GET /s/:token/thumb',
  'POST /share-target',
  'GET /metrics',
  'GET /plugin-pages/sdk.js',
  'GET /plugin-pages/sdk.css',
  'GET /plugin-pages/:id/*',
  'GET /.well-known/security.txt',
  'GET /.well-known/change-password',
  'GET /p/:token',
  'GET /holidays/:region',
  'GET /rsvp/:token',
  'POST /rsvp/:token',
  'GET /b/:slug',
  'GET /b/manage/:token',
  'GET /u/:token',
  'GET /.well-known/caldav',
  'PROPFIND /.well-known/caldav',
  'GET /.well-known/carddav',
  'PROPFIND /.well-known/carddav',
]);

const SIGNED_IN_PAGES = new Set([
  'GET /files',
  'GET /files/*',
  'GET /admin',
  'GET /admin/*',
  'GET /calendar',
  'GET /calendar/*',
  'GET /contacts',
  'GET /contacts/*',
  'GET /account',
  'GET /passwort',
  'POST /passwort',
]);

const OWN_AUTH = /^\/(dav|caldav|carddav|wopi\/|ext\/|browser\/|cool\/)/;

const fill = (url: string) =>
  url
    .replace(/:([a-zA-Z]+)/g, (_match, name: string) =>
      ['page', 'index', 'version', 'member', 'comment'].includes(name) ? '1' : 'abcdefghijkl'
    )
    .replace(/\*$/, 'x');

const routes = () => routesOf(app).filter((route) => route.method !== 'HEAD' && route.method !== 'OPTIONS');
const key = (route: { method: string; url: string }) => `${route.method} ${route.url}`;
const isOpenApi = (route: { method: string; url: string }) =>
  OPEN_API.includes(key(route)) || route.url.startsWith('/api/public/') || route.url.startsWith('/api/calendar/public/');

async function anonymous() {
  const client = new Client(app);
  await client.get('/login', { accept: 'text/html' });
  return client;
}

const call = (client: Client, route: { method: string; url: string }, headers: Record<string, string> = {}) =>
  client.send({
    method: route.method as 'GET',
    url: fill(route.url),
    headers: {
      accept: 'application/json',
      ...(UNSAFE.has(route.method)
        ? { 'content-type': 'application/json', 'x-csrf-token': client.csrf || client.cookies.get('moe_csrf') || '' }
        : {}),
      ...headers,
    },
    ...(UNSAFE.has(route.method) ? { payload: '{}' } : {}),
  });

const bare = (client: Client, route: { method: string; url: string }, token?: string) =>
  app.inject({
    method: route.method as 'POST',
    url: fill(route.url),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      cookie: [...client.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(token === undefined ? {} : { 'x-csrf-token': token }),
    },
    payload: '{}',
  });

before(async () => {
  emi = await setUp(app);
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123', role: 'guest' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
});

after(() => app.close());

describe('Zugriff auf alle Routen', () => {
  it('kennt jede Route außerhalb der API mit ihrer Einordnung', () => {
    const unknown = routes()
      .filter((route) => !route.url.startsWith('/api/'))
      .filter((route) => !OPEN_PAGES.has(key(route)) && !SIGNED_IN_PAGES.has(key(route)) && !OWN_AUTH.test(route.url))
      .map(key);
    assert.deepEqual(unknown, [], 'Neue Routen müssen in test/sec-access.test.ts eingeordnet werden');
    assert.ok(routes().length > 380, `nur ${routes().length} Routen gefunden`);
  });

  it('lässt ohne Anmeldung keine einzige geschützte API-Route durch', async () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const route of routes()) {
      if (!route.url.startsWith('/api/') || isOpenApi(route)) continue;
      const response = await call(await anonymous(), route);
      checked++;
      if (response.statusCode !== 401) wrong.push(`${key(route)} → ${response.statusCode}`);
    }
    assert.deepEqual(wrong, []);
    assert.ok(checked > 280, `nur ${checked} Routen geprüft`);
  });

  it('antwortet ohne Anmeldung auch mit gültigem Körper nicht anders', async () => {
    const samples: [string, string, unknown][] = [
      ['POST', '/api/tags', { name: 'Urlaub' }],
      ['POST', '/api/notes', { title: 'Offen' }],
      ['POST', '/api/music/played', { id: 'abcdefghijkl' }],
      ['PUT', '/api/nodes/icon', { ids: ['abcdefghijkl'], icon: 'star' }],
      ['POST', '/api/account/app-passwords', { name: 'Test' }],
      ['POST', '/api/admin/users', { username: 'x', name: 'X', password: 'ein-langes-passwort-1' }],
      ['PATCH', '/api/admin/settings', { 'site.name': 'Fremd' }],
    ];
    for (const [method, url, body] of samples) {
      const client = await anonymous();
      const response = await client.send({
        method: method as 'POST',
        url,
        headers: { 'content-type': 'application/json', 'x-csrf-token': client.cookies.get('moe_csrf')! },
        payload: JSON.stringify(body),
      });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
      assert.equal(response.json().error.code, 'unauthorized');
    }
  });

  it('schickt geschützte Seiten ohne Anmeldung zur Anmeldung', async () => {
    for (const route of [...SIGNED_IN_PAGES]) {
      const [method, pattern] = route.split(' ');
      const url = fill(pattern);
      const response = await app.inject({ method: method as 'GET' | 'POST', url, headers: { accept: 'text/html' } });
      assert.equal(response.statusCode, 302, route);
      assert.match(String(response.headers.location), /^\/login(\?|$)/, route);
    }
  });

  it('gibt die Verwaltung nur Admins, auf jeder einzelnen Route', async () => {
    const admin = routes().filter((route) => route.url.startsWith('/api/admin/'));
    assert.ok(admin.length > 80, `nur ${admin.length} Admin-Routen gefunden`);
    for (const [name, client] of [
      ['Mia', mia],
      ['Lea als Gast', lea],
    ] as const) {
      const wrong: string[] = [];
      for (const route of admin) {
        const response = await call(client, route);
        if (response.statusCode !== 403) wrong.push(`${key(route)} → ${response.statusCode}`);
      }
      assert.deepEqual(wrong, [], name);
    }
    for (const url of ['/admin', '/admin/people', '/admin/settings']) {
      const page = await mia.get(url, { accept: 'text/html' });
      assert.notEqual(page.statusCode, 200, url);
    }
  });

  it('verlangt für jede schreibende API-Route das Formular-Kennzeichen', async () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const route of routes()) {
      if (!route.url.startsWith('/api/') || !UNSAFE.has(route.method)) continue;
      checked++;
      for (const client of [mia, emi]) {
        const missing = await bare(client, route);
        if (![403, 429].includes(missing.statusCode)) wrong.push(`${key(route)} ohne Kennzeichen → ${missing.statusCode}`);
        const foreign = await bare(client, route, 'a'.repeat(32));
        if (![403, 429].includes(foreign.statusCode)) wrong.push(`${key(route)} mit falschem Kennzeichen → ${foreign.statusCode}`);
        const other = await bare(client, route, client === mia ? emi.csrf : mia.csrf);
        if (![403, 429].includes(other.statusCode))
          wrong.push(`${key(route)} mit dem Kennzeichen einer anderen Person → ${other.statusCode}`);
      }
    }
    assert.deepEqual(wrong, []);
    assert.ok(checked > 190, `nur ${checked} Routen geprüft`);
  });

  it('weist schreibende Anfragen von fremden Seiten ab, auch mit richtigem Kennzeichen', async () => {
    const wrong: string[] = [];
    for (const route of routes()) {
      if (!route.url.startsWith('/api/') || !UNSAFE.has(route.method) || isOpenApi(route)) continue;
      const origin = await call(mia, route, { origin: 'https://boese.example', host: 'localhost:3000' });
      if (![403, 429].includes(origin.statusCode)) wrong.push(`${key(route)} mit fremder Herkunft → ${origin.statusCode}`);
      const site = await call(mia, route, { 'sec-fetch-site': 'cross-site' });
      if (![403, 429].includes(site.statusCode)) wrong.push(`${key(route)} mit Sec-Fetch-Site cross-site → ${site.statusCode}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('kennt keine weiteren Methoden und verrät bei Fehlern nichts über das Innere', async () => {
    for (const method of ['TRACE', 'CONNECT']) {
      const response = await mia.send({ method: method as 'GET', url: '/api/session' }).catch(() => null);
      assert.ok(!response || response.statusCode >= 400, method);
    }
    const broken = await mia.send({
      method: 'POST',
      url: '/api/tags',
      headers: { 'content-type': 'application/json', 'x-csrf-token': mia.csrf },
      payload: '{"name": ',
    });
    assert.equal(broken.statusCode, 400);
    assert.doesNotMatch(broken.body, /node_modules|at [A-Za-z.]+ \(|\.ts:\d+|SyntaxError|stack/);
    const missing = await mia.get('/api/gibt-es-nicht');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['x-powered-by'], undefined);
    assert.equal(missing.headers.server, undefined);
  });
});
