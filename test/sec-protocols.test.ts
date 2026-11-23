import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { routesOf } from '../src/app.ts';
import { one } from '../src/lib/db.ts';
import * as settings from '../src/services/settings.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'mias-passwort-123');
  root = (await mia.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('Kopfzeilen', () => {
  it('schützen jede Seite vor Einbetten, Raten des Typs und fremden Skripten', async () => {
    for (const [client, url] of [
      [new Client(app), '/login'],
      [new Client(app), '/forgot'],
      [new Client(app), '/gibt-es-nicht'],
      [mia, '/files'],
      [mia, '/account'],
      [mia, '/files/folder/abcdefghijkl'],
      [emi, '/admin'],
      [emi, '/admin/settings'],
    ] as [Client, string][]) {
      const response = await client.get(url, { accept: 'text/html' });
      const type = String(response.headers['content-type'] ?? '');
      if (!type.startsWith('text/html')) continue;
      const policy = String(response.headers['content-security-policy']);
      assert.equal(response.headers['x-frame-options'], 'DENY', url);
      assert.equal(response.headers['x-content-type-options'], 'nosniff', url);
      assert.equal(response.headers['cross-origin-opener-policy'], 'same-origin', url);
      assert.match(String(response.headers['referrer-policy']), /strict-origin-when-cross-origin|no-referrer/, url);
      const signedIn = client === mia || client === emi;
      assert.match(
        String(response.headers['permissions-policy']),
        signedIn
          ? /^camera=\(self\), microphone=\(self\), display-capture=\(self\), geolocation=\(\), payment=\(\), usb=\(\)$/
          : /^camera=\(\), microphone=\(\), display-capture=\(\), geolocation=\(\), payment=\(\), usb=\(\)$/,
        url
      );
      assert.match(policy, /frame-ancestors 'none'/, url);
      assert.match(policy, /object-src 'none'/, url);
      assert.match(policy, /base-uri 'none'/, url);
      assert.match(policy, /form-action 'self'/, url);
      assert.match(policy, /script-src 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'/, url);
      assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*|http:|data: *;? *script/, url);
      assert.doesNotMatch(policy, /script-src[^;]*(https?:|'self')/, `${url}: Skripte nur mit Kennzeichen`);
      assert.equal(response.headers['x-powered-by'], undefined, url);
      assert.equal(response.headers.server, undefined, url);
    }
  });

  it('verlangen HTTPS dauerhaft, sobald die Cloud über HTTPS läuft', async () => {
    const secure = await new Client(app).send({
      method: 'GET',
      url: '/login',
      headers: { accept: 'text/html', 'x-forwarded-proto': 'https', host: 'cloud.example.org' },
    });
    assert.match(String(secure.headers['strict-transport-security']), /^max-age=(\d+)/);
    assert.ok(Number(/max-age=(\d+)/.exec(String(secure.headers['strict-transport-security']))![1]) >= 15_552_000);
    const plain = await new Client(app).get('/login', { accept: 'text/html' });
    assert.equal(plain.headers['strict-transport-security'], undefined, 'ohne HTTPS gäbe die Kopfzeile nur Verwirrung');
    const local = await new Client(app).send({
      method: 'GET',
      url: '/login',
      headers: { accept: 'text/html', 'x-forwarded-proto': 'https', host: 'localhost:3000' },
    });
    assert.equal(local.headers['strict-transport-security'], undefined, 'für localhost wird nichts festgeschrieben');
  });

  it('geben fremden Seiten keinen Lesezugriff auf die API', async () => {
    for (const [method, url] of [
      ['GET', '/api/session'],
      ['GET', '/api/account'],
      ['GET', `/api/nodes/${root}/children`],
      ['GET', '/api/gibt-es-nicht'],
      ['GET', '/healthz'],
      ['GET', '/manifest.webmanifest'],
      ['OPTIONS', '/api/session'],
      ['OPTIONS', '/api/tags'],
      ['OPTIONS', '/api/account/password'],
    ] as [string, string][]) {
      const response = await mia.send({
        method: method as 'GET',
        url,
        headers: {
          origin: 'https://boese.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-csrf-token, content-type, authorization',
        },
      });
      for (const header of [
        'access-control-allow-origin',
        'access-control-allow-credentials',
        'access-control-allow-headers',
        'access-control-allow-methods',
        'access-control-expose-headers',
      ]) {
        assert.equal(response.headers[header], undefined, `${method} ${url}: ${header}`);
      }
      if (method === 'OPTIONS') assert.ok(response.statusCode >= 400, `${method} ${url} → ${response.statusCode}`);
    }
  });

  it('halten Antworten der API aus jedem Zwischenspeicher heraus', async () => {
    const wrong: string[] = [];
    for (const route of routesOf(app)) {
      if (route.method !== 'GET' || !route.url.startsWith('/api/') || route.url === '/api/events' || route.url.includes('/export'))
        continue;
      const url = route.url.replace(/:[a-zA-Z]+/g, 'abcdefghijkl').replace(/\*$/, 'x');
      for (const client of [mia, new Client(app)]) {
        const response = await client.get(url);
        const cache = String(response.headers['cache-control'] ?? '');
        if (!/no-store|no-cache|private/.test(cache)) wrong.push(`${url} (${response.statusCode}) → „${cache}“`);
        if (/public/.test(cache)) wrong.push(`${url} ist öffentlich zwischenspeicherbar`);
      }
    }
    assert.deepEqual(wrong, []);
    const session = await mia.get('/api/session');
    assert.equal(session.headers['cache-control'], 'no-store');
    const page = await mia.get('/files', { accept: 'text/html' });
    assert.match(String(page.headers['cache-control']), /no-store/);
  });

  it('lassen sich nicht über Zusatz-Kopfzeilen aushebeln', async () => {
    const tag = (await mia.json('POST', '/api/tags', { name: 'Bleibt', color: 'blue' })).json().tag.id;
    for (const headers of [
      { 'x-http-method-override': 'DELETE' },
      { 'x-http-method': 'DELETE' },
      { 'x-method-override': 'DELETE' },
      { 'x-original-url': `/api/admin/users` },
      { 'x-rewrite-url': '/api/admin/users' },
      { 'x-forwarded-uri': '/api/admin/users' },
    ] as Record<string, string>[]) {
      const response = await mia.get(`/api/tags/${tag}/nodes`, headers);
      assert.equal(response.statusCode, 200, JSON.stringify(headers));
      assert.doesNotMatch(response.body, /"username"/);
      const posted = await mia.send({ method: 'POST', url: `/api/tags/${tag}`, headers });
      assert.ok([404, 405].includes(posted.statusCode), `POST mit ${JSON.stringify(headers)} → ${posted.statusCode}`);
    }
    assert.ok(one('SELECT 1 AS found FROM tags WHERE id = ?', tag), 'das Schlagwort gibt es noch');
    const viaQuery = await mia.get(`/api/tags/${tag}/nodes?_method=DELETE`);
    assert.equal(viaQuery.statusCode, 200);
    assert.ok(one('SELECT 1 AS found FROM tags WHERE id = ?', tag));
  });
});

describe('Einrichtung, Metriken und Erweiterungen', () => {
  it('lässt sich nach dem ersten Mal nicht noch einmal einrichten', async () => {
    const palette = settings.get('site.palette');
    for (const client of [new Client(app), mia, emi]) {
      await client.get('/login', { accept: 'text/html' });
      const again = await client.json('POST', '/api/setup', {
        code: 'irgendwas',
        siteName: 'Übernommen',
        siteUrl: 'https://boese.example',
        language: 'de',
        seed: '#8b5cf6',
        palette,
        registration: 'open',
        defaultQuota: 0,
        admin: { username: 'boese', name: 'Böse', email: 'boese@example.com', password: 'sehr-sicheres-passwort' },
      });
      assert.equal(again.statusCode, 403, again.body);
      const check = await client.json('POST', '/api/setup/check', { code: 'irgendwas' });
      assert.equal(check.statusCode, 403);
    }
    assert.equal(one('SELECT 1 AS found FROM users WHERE username = ?', 'boese'), undefined);
    assert.equal(settings.get('site.name'), 'MoeCloud Test');
    assert.equal(settings.get('site.url'), 'http://localhost:3000');
    const page = await new Client(app).get('/setup', { accept: 'text/html' });
    assert.equal(page.statusCode, 302);
    assert.equal(settings.get('setup.code'), '', 'der Einrichtungscode ist verbraucht');
  });

  it('zeigt Metriken nur mit dem Token', async () => {
    assert.equal((await new Client(app).get('/metrics')).statusCode, 404, 'ohne Token in den Einstellungen gibt es die Seite nicht');
    settings.set('metrics.token', 'ein-langes-zufaelliges-token-123456');
    try {
      for (const headers of [
        {},
        { authorization: 'Bearer falsch' },
        { authorization: 'Bearer ' },
        { authorization: 'ein-langes-zufaelliges-token-123456' },
        { authorization: 'Basic ZWluLWxhbmdlcw==' },
        { authorization: 'Bearer ein-langes-zufaelliges-token-12345' },
        { authorization: 'Bearer ein-langes-zufaelliges-token-1234567' },
        { 'x-metrics-token': 'ein-langes-zufaelliges-token-123456' },
      ] as Record<string, string>[]) {
        const response = await emi.get('/metrics', headers);
        assert.equal(response.statusCode, 401, JSON.stringify(headers));
        assert.doesNotMatch(response.body, /moecloud_users/);
      }
      assert.equal(
        (await new Client(app).get('/metrics?token=ein-langes-zufaelliges-token-123456')).statusCode,
        401,
        'das Token gehört nicht in die Adresse'
      );
      const good = await new Client(app).get('/metrics', { authorization: 'Bearer ein-langes-zufaelliges-token-123456' });
      assert.equal(good.statusCode, 200);
      assert.match(good.body, /moecloud_users/);
      assert.doesNotMatch(good.body, /emi|mia|example\.com|password|argon2/, 'in den Metriken stehen Zahlen, keine Personen');
    } finally {
      settings.set('metrics.token', '');
    }
  });

  it('verrät Unangemeldeten nur, was die Anmeldeseite braucht', async () => {
    const health = await new Client(app).get('/healthz');
    assert.deepEqual(Object.keys(health.json()).sort(), ['ok', 'version']);
    const page = await new Client(app).get('/login', { accept: 'text/html' });
    assert.doesNotMatch(page.body, /emi@example\.com|"users"|rootId|password_hash|secret\.key|mail\.pass|smtp/i);
    assert.doesNotMatch(page.body, /"csrf":"[^"]{32}"[^<]*"user":\{/);
    const manifest = await new Client(app).get('/manifest.webmanifest');
    assert.equal(manifest.statusCode, 200);
    assert.doesNotMatch(manifest.body, /emi|mia|rootId/);
    const robots = await new Client(app).get('/robots.txt');
    assert.match(robots.body, /Disallow: \//);
    for (const url of [
      '/api/session',
      '/api/account',
      '/api/home',
      '/api/admin/overview',
      '/api/admin/system',
      '/api/admin/log',
      '/api/plugins',
      '/api/themes',
      '/api/office',
    ]) {
      const response = await new Client(app).get(url);
      assert.equal(response.statusCode, 401, url);
      assert.deepEqual(Object.keys(response.json()), ['error'], url);
    }
  });

  it('reicht an Erweiterungen weder Sitzung noch Kennwörter weiter und nimmt unbekannte nicht an', async () => {
    for (const [method, url] of [
      ['GET', '/ext/gibt-es-nicht'],
      ['POST', '/ext/gibt-es-nicht/hook'],
      ['GET', '/ext/..%2f..%2fapi%2fadmin%2fusers'],
      ['GET', '/ext/__proto__'],
      ['GET', '/ext/constructor/x'],
      ['GET', '/api/ext/gibt-es-nicht'],
      ['POST', '/api/ext/__proto__/x'],
      ['GET', '/plugin-pages/gibt-es-nicht/index.html'],
      ['GET', '/plugin-pages/__proto__/index.html'],
      ['GET', '/plugin-pages/constructor/..%2f..%2fpackage.json'],
    ] as [string, string][]) {
      for (const client of [mia, emi]) {
        const response = await client.send({ method: method as 'GET', url });
        assert.equal(response.statusCode, 404, `${method} ${url} → ${response.statusCode}`);
        assert.doesNotMatch(response.body, /"username"|dependencies/);
      }
    }
    const anonymous = await new Client(app).send({
      method: 'POST',
      url: '/api/ext/gibt-es-nicht/x',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.ok([401, 403].includes(anonymous.statusCode));
  });

  it('nimmt geteilte Inhalte aus anderen Apps nur mit Sitzung in großem Umfang an', async () => {
    const small = await new Client(app).send({
      method: 'POST',
      url: '/share-target',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      payload: '--x\r\nContent-Disposition: form-data; name="title"\r\n\r\nHallo\r\n--x--\r\n',
    });
    assert.equal(small.statusCode, 303);
    assert.match(String(small.headers.location), /^\/files/);
    assert.equal((await mia.get(`/api/nodes/${root}/children`)).json().items.length, 0, 'ohne die App im Hintergrund wird nichts abgelegt');
  });
});
