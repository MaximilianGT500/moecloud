import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let root = '';
let file = '';
let port = 0;
let upstreamUrl = '';
let cookie = '';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
  upgrade?: boolean;
}

const seen: Seen[] = [];
const big = Buffer.alloc(300 * 1024, 'a');

const upstream = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
    if (request.url === '/hosting/discovery') {
      response.writeHead(200, { 'content-type': 'text/xml' });
      response.end(
        `<wopi-discovery><net-zone name="external-http"><app name="writer"><action ext="docx" name="edit" urlsrc="http://collabora.test:9980/browser/abc123/cool.html?"/></app></net-zone></wopi-discovery>`
      );
    } else if (request.url?.startsWith('/browser/abc123/cool.html')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': 'frame-ancestors localhost:*',
        'set-cookie': 'coolsecret=1; Path=/',
      });
      response.end(`<html>editor ${body}</html>`);
    } else if (request.url === '/browser/abc123/big.js') {
      response.writeHead(200, { 'content-type': 'application/javascript', 'content-length': String(big.length) });
      response.end(big);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('nicht da');
    }
  });
});

upstream.on('upgrade', (request, socket) => {
  seen.push({ method: 'GET', url: request.url ?? '', headers: request.headers, body: '', upgrade: true });
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSet-Cookie: coolsecret=2\r\n\r\n');
  socket.on('data', (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])));
  socket.on('error', () => socket.destroy());
});

const address = () => `http://127.0.0.1:${port}`;

function socketRequest(path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; socket?: Duplex }>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGVzdA==', 'Sec-WebSocket-Version': '13', ...headers },
    });
    request.on('upgrade', (response, socket) => resolve({ status: 101, headers: response.headers, socket }));
    request.on('response', (response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0, headers: response.headers });
    });
    request.on('error', reject);
    request.end();
  });
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const uploaded = await emi.upload(root, 'Brief.docx', Buffer.from('inhalt'), 64);
  file = uploaded.json().node.id;
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
  cookie = `moe_session=${emi.cookies.get('moe_session')}`;
});

after(async () => {
  await app.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

describe('Collabora über die Adresse der Cloud', () => {
  it('leitet nichts weiter, solange nichts eingerichtet ist', async () => {
    assert.equal((await fetch(`${address()}/browser/abc123/big.js`, { headers: { cookie } })).status, 404);
    assert.equal((await socketRequest('/cool/abc/ws', { cookie })).status, 404);
    assert.equal((await emi.get('/api/office')).json().enabled, false);
  });

  it('fragt Collabora intern ab und öffnet den Editor unter der eigenen Adresse', async () => {
    const saved = await emi.json('PATCH', '/api/admin/settings', {
      'collabora.internal': `${upstreamUrl}/`,
      'collabora.host': 'http://moecloud:3000',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const state = (await emi.get('/api/admin/office?refresh=1')).json();
    assert.deepEqual(state, { enabled: true, ok: true, error: null, builtIn: true, secure: false, extensions: ['docx'] });
    assert.equal((await emi.get('/api/office')).json().enabled, true);

    const opened = await emi.send({
      method: 'POST',
      url: `/api/nodes/${file}/office/edit`,
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const url = new URL(opened.json().url);
    assert.equal(url.origin, 'http://localhost:3000');
    assert.equal(url.pathname, '/browser/abc123/cool.html');
    assert.equal(url.searchParams.get('WOPISrc'), `http://moecloud:3000/wopi/files/${file}`);
    assert.equal(opened.json().origin, 'http://localhost:3000');

    const secure = await emi.send({
      method: 'POST',
      url: `/api/nodes/${file}/office/edit`,
      headers: { host: 'cloud.example.com', 'x-forwarded-proto': 'https', origin: 'https://cloud.example.com' },
    });
    assert.equal(secure.statusCode, 503);
    assert.equal(secure.json().error.code, 'office_scheme');
    assert.match(secure.json().error.message, /Office rechnet mit HTTP, die Cloud läuft hier aber über HTTPS/);
  });

  it('reicht Seiten und Formulare nur für Angemeldete durch und behält die eigenen Cookies für sich', async () => {
    seen.length = 0;
    const anonymous = await fetch(`${address()}/browser/abc123/big.js`);
    assert.equal(anonymous.status, 401);
    assert.equal(seen.length, 0);

    const script = await fetch(`${address()}/browser/abc123/big.js`, { headers: { cookie, authorization: 'Bearer geheim' } });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-type'), 'application/javascript');
    assert.equal((await script.arrayBuffer()).byteLength, big.length);
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].headers.host, `127.0.0.1:${port}`);
    assert.equal(seen[0].headers['x-forwarded-proto'], 'http');

    const body = 'access_token=abc123&access_token_ttl=1795000000000';
    const page = await fetch(
      `${address()}/browser/abc123/cool.html?WOPISrc=http%3A%2F%2Fmoecloud%3A3000%2Fwopi%2Ffiles%2F${file}&lang=de`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }
    );
    assert.equal(page.status, 200);
    assert.equal(await page.text(), `<html>editor ${body}</html>`);
    assert.equal(page.headers.get('set-cookie'), null);
    assert.equal(page.headers.get('content-security-policy'), 'frame-ancestors localhost:*');
    assert.equal(page.headers.get('x-frame-options'), null);
    const posted = seen.find((entry) => entry.method === 'POST')!;
    assert.equal(posted.body, body);
    assert.equal(posted.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.match(posted.url, /^\/browser\/abc123\/cool\.html\?WOPISrc=http%3A%2F%2Fmoecloud%3A3000/);

    const json = await fetch(`${address()}/browser/abc123/cool.html`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{"kaputt":',
    });
    assert.equal(await json.text(), '<html>editor {"kaputt":</html>');
    assert.equal((await fetch(`${address()}/browser/abc123/fehlt.css`, { headers: { cookie } })).status, 404);
  });

  it('sperrt die Verwaltung von Collabora und alles außerhalb des Editors', async () => {
    seen.length = 0;
    for (const path of [
      '/browser/dist/admin/admin.html',
      '/browser/abc123/admin/admin.html',
      '/cool/adminws',
      '/cool/convert-to/pdf',
      '/cool/getMetrics',
      '/browser/..%2Fhosting/discovery',
      '/browser/abc123/%2e%2e/%2e%2e/hosting/discovery',
    ]) {
      const response = await fetch(`${address()}${path}`, { headers: { cookie } });
      assert.equal(response.status, 404, path);
    }
    assert.equal((await socketRequest('/cool/adminws', { cookie })).status, 404);
    assert.equal(seen.length, 0);
    const discovery = await fetch(`${address()}/hosting/discovery`, { headers: { cookie } });
    assert.notEqual(discovery.status, 200);
    assert.equal(seen.length, 0);
  });

  it('verbindet WebSockets in beide Richtungen', async () => {
    seen.length = 0;
    assert.equal((await socketRequest('/cool/abc/ws?WOPISrc=x', {})).status, 401);
    assert.equal((await socketRequest('/cool/abc/ws?WOPISrc=x', { cookie: 'moe_session=falsch' })).status, 401);
    assert.equal(seen.length, 0);
    const opened = await socketRequest('/cool/abc/ws?WOPISrc=x&compat=/ws', { cookie, origin: 'http://localhost:3000' });
    assert.equal(opened.status, 101);
    assert.equal(opened.headers['set-cookie'], undefined);
    assert.equal(opened.headers.upgrade, 'websocket');
    const socket = opened.socket!;
    const answer = new Promise<string>((resolve) => socket.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8'))));
    socket.write('hallo');
    assert.equal(await answer, 'echo:hallo');
    socket.destroy();
    const kept = await socketRequest('/cool/abc/ws?WOPISrc=x', { cookie });
    assert.equal(kept.status, 101);
    kept.socket!.on('error', () => undefined);
    const upgraded = seen.find((entry) => entry.upgrade)!;
    assert.equal(upgraded.url, '/cool/abc/ws?WOPISrc=x&compat=/ws');
    assert.equal(upgraded.headers.cookie, undefined);
    assert.equal(upgraded.headers.host, 'localhost:3000');
    assert.equal(upgraded.headers.origin, 'http://localhost:3000');
    assert.equal(upgraded.headers.upgrade, 'websocket');
  });

  it('lässt die eigene Adresse von Collabora vorgehen und meldet einen Ausfall', async () => {
    const direct = await emi.json('PATCH', '/api/admin/settings', { 'collabora.url': 'https://office.example.com' });
    assert.equal(direct.statusCode, 200, direct.body);
    assert.equal((await fetch(`${address()}/browser/abc123/big.js`, { headers: { cookie } })).status, 404);
    const state = (await emi.get('/api/admin/office?refresh=1')).json();
    assert.equal(state.ok, true);
    assert.equal(state.builtIn, false);
    const opened = await emi.send({
      method: 'POST',
      url: `/api/nodes/${file}/office/edit`,
      headers: { host: 'cloud.example.com', 'x-forwarded-proto': 'https', origin: 'https://cloud.example.com' },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(new URL(opened.json().url).origin, 'https://office.example.com');
    assert.equal(opened.json().origin, 'https://office.example.com');

    await emi.json('PATCH', '/api/admin/settings', { 'collabora.url': '', 'collabora.internal': 'http://127.0.0.1:1' });
    const down = await fetch(`${address()}/browser/abc123/big.js`, { headers: { cookie } });
    assert.equal(down.status, 502);
    assert.equal((await socketRequest('/cool/abc/ws', { cookie })).status, 502);
    const broken = (await emi.get('/api/admin/office?refresh=1')).json();
    assert.equal(broken.enabled, true);
    assert.equal(broken.ok, false);
  });
});
