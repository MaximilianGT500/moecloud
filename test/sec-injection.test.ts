import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { routesOf } from '../src/app.ts';
import { one } from '../src/lib/db.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let nora: Client;
let root = '';
let file = '';

const char = (code: number) => String.fromCharCode(code);

const PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1 --",
  '" OR ""="',
  "'; DROP TABLE nodes; --",
  "' UNION SELECT password_hash FROM users --",
  "1; ATTACH DATABASE '/tmp/x.db' AS x; --",
  '%',
  '_',
  '\\',
  "\\'",
  '%27%20OR%201=1',
  'a" OR b',
  '"',
  '""',
  '"unbalanced',
  '*',
  'a*',
  '* *',
  '^a',
  'NEAR(a b)',
  'NEAR(',
  'a AND',
  'AND',
  'OR',
  'NOT',
  'a NOT',
  '(',
  ')',
  '(a',
  'a:b',
  'name:geheim',
  'content:x',
  'rowid:1',
  '{a b}:c',
  '-a',
  '+a',
  'a + b',
  `null${char(0)}byte`,
  `${char(1)}${char(2)}`,
  '😀'.repeat(50),
  'a'.repeat(5000),
  '${7*7}',
  '{{7*7}}',
  '<%= 7*7 %>',
  '#{7*7}',
  '$(id)',
  '`id`',
  '| id',
  '; id',
  '../../etc/passwd',
  '%00',
  'true',
  'null',
  'undefined',
  'NaN',
  '-1',
  '0',
  '1e309',
  '9'.repeat(40),
  '[object Object]',
  '__proto__',
  'constructor',
];

async function noServerError(client: Client, method: string, url: string, body?: unknown, raw?: string) {
  const response = await client.send({
    method: method as 'GET',
    url,
    ...(raw !== undefined
      ? { headers: { 'content-type': 'application/json' }, payload: raw }
      : body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
  });
  assert.ok(response.statusCode < 500, `${method} ${url.slice(0, 140)} → ${response.statusCode}: ${response.body.slice(0, 200)}`);
  assert.doesNotMatch(
    response.body,
    /SQLITE_|SqliteError|syntax error|no such (table|column)|node_modules|at async |\.ts:\d+:\d+|fts5:/i,
    `${method} ${url.slice(0, 140)} verrät Inneres`
  );
  return response;
}

before(async () => {
  emi = await setUp(app);
  for (const [username, name] of [
    ['mia', 'Mia'],
    ['nora', 'Nora'],
  ]) {
    const made = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}s-passwort-123` });
    assert.equal(made.statusCode, 200, made.body);
  }
  mia = await login(app, 'mia', 'mias-passwort-123');
  nora = await login(app, 'nora', 'noras-passwort-123');
  root = (await mia.get('/api/session')).json().user.rootId;
  file = (await mia.upload(root, 'geheim.txt', Buffer.from('Mias streng geheimer Inhalt'), 1024)).json().node.id;
  const noraRoot = (await nora.get('/api/session')).json().user.rootId;
  await nora.upload(noraRoot, 'noras-datei.txt', Buffer.from('Noras Inhalt'), 1024);
});

after(() => app.close());

describe('Eingaben, die etwas einschleusen wollen', () => {
  it('bringen die Suche nicht durcheinander und zeigen nichts Fremdes', async () => {
    for (const payload of PAYLOADS) {
      const query = encodeURIComponent(payload);
      for (const url of [
        `/api/search?q=${query}`,
        `/api/search?q=geheim&kind=${query}`,
        `/api/search?q=geheim&tag=${query}`,
        `/api/search?q=geheim&after=${query}&before=${query}`,
        `/api/search?q=geheim&minSize=${query}&maxSize=${query}`,
        `/api/search?q=geheim&folder=${query}`,
        `/api/users/search?q=${query}`,
        `/api/photos?folder=${query}&before=${query}`,
        `/api/music?order=${query}`,
        `/api/activity?before=${query}&action=${query}`,
        `/api/nodes/${root}/children?sort=${query}&order=${query}&limit=${query}&offset=${query}`,
        `/api/notes?category=${query}`,
        `/api/tags/${query}/nodes`,
        `/api/automations?folder=${query}`,
        `/api/account/security?before=${query}`,
      ]) {
        const response = await noServerError(nora, 'GET', url);
        assert.doesNotMatch(
          response.body,
          /geheim\.txt|streng geheimer|password_hash|\$argon2/,
          `${url.slice(0, 120)} zeigt Nora etwas von Mia`
        );
      }
      const admin = await noServerError(emi, 'GET', `/api/admin/audit?action=${query}&user=${query}&before=${query}`);
      assert.doesNotMatch(admin.body, /\$argon2|token_hash/);
      await noServerError(emi, 'GET', `/api/admin/users?q=${query}&sort=${query}`);
    }
    const own = await mia.get('/api/search?q=geheim');
    assert.equal(own.statusCode, 200);
    assert.match(own.body, /geheim\.txt/, 'die eigene Suche findet die Datei weiterhin');
    assert.ok(one('SELECT 1 AS found FROM nodes WHERE id = ?', file), 'die Tabelle steht noch');
  });

  it('als Dateiname oder Dateityp treffen keine eingebauten Namen der Sprache', async () => {
    const tricky = [
      'a.constructor',
      'a.__proto__',
      'a.prototype',
      'a.tostring',
      'a.valueof',
      'a.hasownproperty',
      'constructor',
      '__proto__',
      'toString',
    ];
    for (const name of tricky) {
      const up = await mia.upload(root, name, Buffer.from('Inhalt'), 1024);
      assert.equal(up.statusCode, 200, `${name}: ${up.body}`);
      const id = up.json().node.id as string;
      assert.equal(typeof up.json().node.mime, 'string', name);
      for (const route of routesOf(app)) {
        if (route.method !== 'GET' || !route.url.startsWith('/api/nodes/:id')) continue;
        const url = route.url.replace(':id', id).replace(':version', 'x').replace(':page', '1').replace(':index', '0').replace(/\*$/, 'x');
        const response = await mia.get(url);
        assert.ok(response.statusCode < 500, `${name}: GET ${url} → ${response.statusCode}`);
        assert.doesNotMatch(String(response.headers['content-type']), /function|object|native/, `${name}: ${url}`);
      }
      for (const [method, url, body] of [
        ['POST', '/api/nodes/copy', { ids: [id], target: root }],
        ['POST', `/api/nodes/${id}/convert`, { format: 'pdf' }],
        ['POST', `/api/nodes/${id}/extract`, {}],
        ['PATCH', `/api/nodes/${id}`, { name: `umbenannt-${name}` }],
        ['POST', '/api/nodes/trash', { ids: [id] }],
      ] as [string, string, unknown][]) {
        await noServerError(mia, method, url, body);
      }
    }
    for (const type of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'x/__proto__']) {
      const dav = await mia.json('POST', '/api/account/app-passwords', { name: `Typ ${type}` });
      const authorization = `Basic ${Buffer.from(`mia:${dav.json().token}`).toString('base64')}`;
      const put = await app.inject({
        method: 'PUT',
        url: `/dav/typ-${encodeURIComponent(type.replace('/', '-'))}.bin`,
        headers: { authorization, 'content-type': type },
        payload: 'x',
      });
      assert.ok(put.statusCode < 500, `PUT mit Typ ${type} → ${put.statusCode}`);
      const get = await app.inject({
        method: 'GET',
        url: `/dav/typ-${encodeURIComponent(type.replace('/', '-'))}.bin`,
        headers: { authorization },
      });
      assert.ok(get.statusCode < 500, `GET mit Typ ${type} → ${get.statusCode}`);
      assert.doesNotMatch(String(get.headers['content-type']), /function|native/);
    }
    for (const url of [
      '/api/search?q=Inhalt',
      '/api/recent',
      '/api/home',
      `/api/nodes/${root}/children`,
      '/api/storage/report',
      '/api/trash',
      '/api/activity',
    ]) {
      await noServerError(mia, 'GET', url);
    }
    for (const kind of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      await noServerError(mia, 'GET', `/api/search?q=geheim&kind=${kind}`);
      await noServerError(mia, 'GET', `/api/search?kind=${kind}`);
      await noServerError(emi, 'GET', `/api/admin/log?level=${kind}`);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('als Kennung führen auf keiner Route zu einem Serverfehler', async () => {
    const ids = [
      "'",
      "' OR 1=1 --",
      '...',
      '%2e%2e%2f%2e%2e%2fetc',
      '%00',
      '-1',
      '0',
      '1e9',
      '1.5',
      '1e309',
      '0x10',
      '+1',
      '%201',
      '1%20OR%201=1',
      '9007199254740993',
      '9'.repeat(30),
      'NaN',
      'null',
      'undefined',
      '__proto__',
      'constructor',
      'toString',
      'a'.repeat(500),
      '%F0%9F%98%80',
      '%ff',
      '{}',
      '[]',
      '*',
      '%25',
    ];
    const skip = /logout|\/session$|sessions\/|\/delete$|setup|maintenance/;
    let checked = 0;
    for (const route of routesOf(app)) {
      if (route.method !== 'GET' || !route.url.includes(':') || skip.test(route.url)) continue;
      for (const id of ids) {
        const url = route.url.replace(/:[a-zA-Z]+/g, id).replace(/\*$/, id);
        for (const client of [mia, emi]) {
          const response = await client.get(url);
          checked++;
          assert.ok(response.statusCode < 500, `GET ${url.slice(0, 140)} → ${response.statusCode}: ${response.body.slice(0, 160)}`);
          assert.doesNotMatch(response.body, /SQLITE_|syntax error|node_modules|\.ts:\d+:\d+/i, url.slice(0, 140));
        }
      }
    }
    assert.ok(checked > 3000, `nur ${checked} Abrufe geprüft`);
  });

  it('als kaputter oder absichtlich falsch geformter Körper ebenso wenig', async () => {
    const bodies: (string | undefined)[] = [
      undefined,
      '',
      '{',
      '}',
      'null',
      'true',
      '0',
      '"text"',
      '[]',
      '[[[[[[[[[[]]]]]]]]]]',
      '{"__proto__":{"polluted":true}}',
      '{"constructor":{"prototype":{"polluted":true}}}',
      '{"ids":"abc","id":{"$ne":null},"name":{"toString":1},"target":[]}',
      '{"ids":[null,1,{},[],"x"],"name":null,"parentId":null,"size":"groß"}',
      `{"ids":[${Array.from({ length: 3000 }, () => '"abcdefghijkl"').join(',')}]}`,
      `{"name":"${'x'.repeat(200_000)}"}`,
      `{"a":${'{"a":'.repeat(2000)}1${'}'.repeat(2000)}}`,
      '{"name":"a\\u0000b","text":"\\ud800","content":"\\uffff"}',
      '{"size":-1,"offset":-1,"line":-1,"days":-1,"seconds":-1,"degrees":45,"expiresAt":-1,"dueAt":0}',
      '{"size":1e400,"quota":1e400,"expiresAt":1e400}',
      '{"email":"a@b.c\\r\\nBcc: x@y.z","username":"../x","password":"kurz"}',
    ];
    const skip =
      /logout|\/session$|sessions\/revoke|account\/delete$|\/setup|maintenance|updates|\/test$|report\/send|import|backups|plugins|sso|mail$|\/users\/:id$|site-theme|starter|scan|webhooks|reindex/;
    const client = await login(app, 'nora', 'noras-passwort-123');
    let checked = 0;
    for (const route of routesOf(app)) {
      if (!route.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(route.method) || skip.test(route.url)) continue;
      const url = route.url.replace(/:[a-zA-Z]+/g, 'abcdefghijkl').replace(/\*$/, 'x');
      for (const raw of bodies) {
        for (const who of route.url.startsWith('/api/admin/') ? [emi] : [client]) {
          const response = await who.send({
            method: route.method as 'POST',
            url,
            ...(raw === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: raw }),
          });
          checked++;
          assert.ok(
            response.statusCode < 500,
            `${route.method} ${url} mit ${String(raw).slice(0, 60)} → ${response.statusCode}: ${response.body.slice(0, 200)}`
          );
          assert.doesNotMatch(response.body, /SQLITE_|syntax error|node_modules|\.ts:\d+:\d+|"stack"/i, `${route.method} ${url}`);
        }
      }
    }
    assert.ok(checked > 2500, `nur ${checked} Anfragen geprüft`);
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype wurde verändert');
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
    assert.equal((await mia.get('/api/session')).statusCode, 200, 'der Server läuft weiter');
  });

  it('mit falschem Inhaltstyp oder riesigem Körper prallen ab', async () => {
    for (const [type, payload] of [
      ['text/plain', 'name=x'],
      ['application/xml', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><name>&y;</name>'],
      ['text/xml', '<name>x</name>'],
      ['application/x-www-form-urlencoded', 'name=x'],
      ['multipart/form-data; boundary=x', '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nx\r\n--x--\r\n'],
      ['application/json; charset=utf-7', '{"name":"x"}'],
      ['application/jsonx', '{"name":"x"}'],
    ] as [string, string][]) {
      const response = await mia.send({ method: 'POST', url: '/api/tags', headers: { 'content-type': type }, payload });
      assert.ok(response.statusCode >= 400 && response.statusCode < 500, `${type} → ${response.statusCode}`);
      assert.doesNotMatch(response.body, /root:x:0/);
    }
    const big = await mia.send({
      method: 'POST',
      url: '/api/tags',
      headers: { 'content-type': 'application/json' },
      payload: `{"name":"${'x'.repeat(3 * 1024 * 1024)}"}`,
    });
    assert.equal(big.statusCode, 413);
    const long = await mia.get(`/api/search?q=${'a'.repeat(20_000)}`);
    assert.ok(long.statusCode < 500);
    const many = await mia.get(`/api/search?${Array.from({ length: 2000 }, (_, index) => `p${index}=1`).join('&')}`);
    assert.ok(many.statusCode < 500);
    const repeated = await mia.get('/api/search?q=a&q=b&q[]=c&q[x]=d&kind=image&kind=video');
    assert.ok(repeated.statusCode < 500, `mehrfache Parameter → ${repeated.statusCode}`);
  });

  it('über eine echte Verbindung mit zu vielen Daten bekommen eine klare Absage', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const cookie = [...mia.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const send = (path: string, size: number, headers: Record<string, string | number> = {}) =>
      new Promise<{ status: number; body: string }>((resolve) => {
        const call = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: 'PUT',
            agent: false,
            headers: { cookie, 'x-csrf-token': mia.csrf, 'content-type': 'application/octet-stream', 'content-length': size, ...headers },
          },
          (response) => {
            let body = '';
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
          }
        );
        call.on('error', (error) => resolve({ status: 0, body: (error as NodeJS.ErrnoException).code ?? 'Fehler' }));
        call.setTimeout(8000, () => {
          resolve({ status: -1, body: 'keine Antwort' });
          call.destroy();
        });
        call.end(Buffer.alloc(size, 1));
      });
    for (const size of [64, 100_000]) {
      const init = await mia.json('POST', '/api/uploads', { parentId: root, name: `zuviel-${size}.bin`, size: 4 });
      const answer = await send(`/api/uploads/${init.json().id}?offset=0`, size);
      assert.ok([400, 0].includes(answer.status), `${size} Bytes für 4 angekündigte → ${answer.status} ${answer.body}`);
      if (answer.status === 400) assert.match(answer.body, /mehr Daten als angekündigt/);
      const state = await mia.get(`/api/uploads/${init.json().id}`);
      assert.ok(state.json().received <= 4, 'es wurde nicht mehr gespeichert als angekündigt');
      const complete = await mia.json('POST', `/api/uploads/${init.json().id}/complete`);
      assert.equal(complete.statusCode, 400, 'ein unvollständiger Upload wird keine Datei');
    }
    const smuggled = await send('/api/uploads/abcdefghijklmnopqrstuvwx?offset=0', 4, { 'transfer-encoding': 'chunked' });
    assert.ok([400, 404, 0].includes(smuggled.status), `Content-Length zusammen mit Transfer-Encoding → ${smuggled.status}`);
    const names = ((await mia.get(`/api/nodes/${root}/children`)).json().items as { name: string }[]).map((entry) => entry.name);
    assert.ok(!names.some((name) => name.startsWith('zuviel-')), 'aus dem abgebrochenen Upload wurde eine Datei');
  });
});
