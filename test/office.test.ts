import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { run, value } from '../src/lib/db.ts';
import { forgetDiscovery, parseDiscovery } from '../src/services/wopi.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let office: Server;
let officeUrl = '';
let discoveryCalls = 0;
let discoveryStatus = 200;

const DISCOVERY = (base: string) => `<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app favIconUrl="${base}/browser/abc123/images/x-office-document.svg" name="writer">
      <action default="true" ext="sxw" name="view" urlsrc="${base}/browser/abc123/cool.html?"/>
      <action default="true" ext="odt" name="edit" urlsrc="${base}/browser/abc123/cool.html?"/>
      <action default="true" ext="docx" name="edit" urlsrc="${base}/browser/abc123/cool.html?"/>
      <action ext="pdf" name="view_comment" urlsrc="${base}/browser/abc123/cool.html?"/>
    </app>
    <app name="calc">
      <action default="true" ext="xlsx" name="edit" urlsrc="${base}/browser/abc123/cool.html?"/>
    </app>
    <app name="impress">
      <action default="true" ext="pptx" name="edit" urlsrc="${base}/browser/abc123/cool.html?"/>
    </app>
    <app name="application/vnd.oasis.opendocument.text">
      <action default="true" ext="" name="edit" urlsrc="${base}/browser/abc123/cool.html?"/>
    </app>
    <app name="Capabilities">
      <action ext="" name="getinfo" urlsrc="${base}/hosting/capabilities"/>
    </app>
  </net-zone>
</wopi-discovery>`;

async function file(client: Client, parent: string, name: string, content: string | Buffer) {
  const response = await client.upload(parent, name, Buffer.isBuffer(content) ? content : Buffer.from(content), 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

const wopi = (method: 'GET' | 'POST', path: string, token: string, headers: Record<string, string> = {}, payload?: Buffer) =>
  app.inject({ method, url: `${path}?access_token=${token}`, headers, payload });

before(async () => {
  office = createServer((request, response) => {
    if (request.url === '/hosting/discovery') {
      discoveryCalls++;
      response.writeHead(discoveryStatus, { 'content-type': 'text/xml' });
      response.end(discoveryStatus === 200 ? DISCOVERY('http://collabora.intern:9980') : 'kaputt');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => office.listen(0, '127.0.0.1', resolve));
  officeUrl = `http://127.0.0.1:${(office.address() as AddressInfo).port}`;
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await app.close();
  await new Promise((resolve) => office.close(resolve));
});

describe('Office: Einrichtung', () => {
  it('liest die Formate aus der Antwort von Collabora', () => {
    const actions = parseDiscovery(DISCOVERY('https://office.example.com'));
    assert.deepEqual([...actions.keys()].sort(), ['docx', 'odt', 'pdf', 'pptx', 'sxw', 'xlsx']);
    assert.equal(actions.get('docx')?.edit, 'https://office.example.com/browser/abc123/cool.html?');
    assert.equal(actions.get('sxw')?.edit, undefined);
    assert.equal(actions.get('pdf')?.view, 'https://office.example.com/browser/abc123/cool.html?');
    assert.equal(parseDiscovery('<action ext="docx" name="edit" urlsrc="javascript:alert(1)"/>').size, 0);
    assert.equal(
      parseDiscovery('<action ext="docx" name="edit" urlsrc="https://o.example/x?&lt;ui=UI_LLCC&amp;&gt;"/>').get('docx')?.edit,
      'https://o.example/x?'
    );
  });

  it('ist aus, bis eine Adresse eingetragen ist', async () => {
    assert.deepEqual((await emi.get('/api/office')).json(), { enabled: false, extensions: [] });
    const node = await file(emi, root, 'Brief.docx', 'kein echtes Dokument');
    assert.equal((await emi.json('POST', `/api/nodes/${node}/office/edit`)).statusCode, 400);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'collabora.url': 'office.example.com' })).statusCode, 400);
    assert.equal((await mia.json('PATCH', '/api/admin/settings', { 'collabora.url': officeUrl })).statusCode, 403);
    const saved = await emi.json('PATCH', '/api/admin/settings', { 'collabora.url': `${officeUrl}/` });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().settings['collabora.url'], officeUrl);
    const state = (await emi.get('/api/admin/office?refresh=1')).json();
    assert.equal(state.ok, true);
    assert.deepEqual(state.extensions, ['docx', 'odt', 'pptx', 'xlsx']);
    assert.deepEqual((await mia.get('/api/office')).json(), { enabled: true, extensions: ['docx', 'odt', 'pptx', 'xlsx'] });
    assert.equal((await mia.get('/api/admin/office')).statusCode, 403);
    const before = discoveryCalls;
    await emi.get('/api/office');
    await emi.get('/api/office');
    assert.equal(discoveryCalls, before);
    const page = await emi.get('/files', { accept: 'text/html' });
    const policy = String(page.headers['content-security-policy']);
    assert.match(policy, new RegExp(`frame-src 'self' ${officeUrl.replace(/[.:/]/g, '\\$&')}(;|$)`));
    assert.match(policy, new RegExp(`form-action 'self' ${officeUrl.replace(/[.:/]/g, '\\$&')}(;|$)`));
  });

  it('meldet, wenn Collabora nicht antwortet', async () => {
    discoveryStatus = 500;
    const state = (await emi.get('/api/admin/office?refresh=1')).json();
    assert.equal(state.ok, false);
    assert.equal(state.error, 'HTTP 500');
    assert.deepEqual((await emi.get('/api/office')).json(), { enabled: false, extensions: [] });
    const node = value<string>('SELECT id FROM nodes WHERE name = ?', 'Brief.docx')!;
    const refused = await emi.json('POST', `/api/nodes/${node}/office/edit`);
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.json().error.code, 'office_unavailable');
    discoveryStatus = 200;
    assert.equal((await emi.get('/api/admin/office?refresh=1')).json().ok, true);
  });
});

describe('Office: Bearbeiten über WOPI', () => {
  let node = '';
  let token = '';

  it('öffnet eine Datei mit Adresse, Token und Rechten', async () => {
    node = value<string>('SELECT id FROM nodes WHERE name = ?', 'Brief.docx')!;
    const opened = await emi.send({
      method: 'POST',
      url: `/api/nodes/${node}/office/edit`,
      headers: { origin: 'https://cloud.example.com', 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const session = opened.json();
    token = session.token;
    assert.equal(session.write, true);
    assert.equal(session.origin, officeUrl);
    assert.equal(session.name, 'Brief.docx');
    assert.ok(session.ttl > Date.now() + 9 * 60 * 60 * 1000);
    const target = new URL(session.url);
    assert.equal(target.origin, officeUrl);
    assert.equal(target.pathname, '/browser/abc123/cool.html');
    assert.match(target.searchParams.get('WOPISrc')!, new RegExp(`/wopi/files/${node}$`));
    assert.equal(target.searchParams.get('closebutton'), 'true');
    assert.equal(target.searchParams.get('permission'), null);
    assert.equal(value<number>('SELECT COUNT(*) FROM office_tokens WHERE token_hash = ?', token), 0);
    const text = await file(emi, root, 'Notiz.txt', 'kein Office');
    assert.equal((await emi.json('POST', `/api/nodes/${text}/office/edit`)).statusCode, 400);
    assert.equal((await emi.json('POST', `/api/nodes/${root}/office/edit`)).statusCode, 400);
    assert.equal((await mia.json('POST', `/api/nodes/${node}/office/edit`)).statusCode, 404);
  });

  it('beantwortet CheckFileInfo und liefert den Inhalt nur mit gültigem Token', async () => {
    const info = await wopi('GET', `/wopi/files/${node}`, token);
    assert.equal(info.statusCode, 200, info.body);
    const body = info.json();
    assert.equal(body.BaseFileName, 'Brief.docx');
    assert.equal(body.Size, 'kein echtes Dokument'.length);
    assert.equal(body.UserFriendlyName, 'Emi');
    assert.equal(body.UserCanWrite, true);
    assert.equal(body.UserCanNotWriteRelative, true);
    assert.equal(body.PostMessageOrigin, 'https://cloud.example.com');
    assert.equal(typeof body.OwnerId, 'string');
    assert.equal(typeof body.UserId, 'string');
    assert.match(body.LastModifiedTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(info.headers['cache-control'], 'no-store');
    const content = await wopi('GET', `/wopi/files/${node}/contents`, token);
    assert.equal(content.statusCode, 200);
    assert.equal(content.body, 'kein echtes Dokument');
    assert.equal(content.headers['content-type'], 'application/octet-stream');
    assert.equal((await wopi('GET', `/wopi/files/${node}`, 'x'.repeat(48))).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: `/wopi/files/${node}` })).statusCode, 401);
    assert.equal((await wopi('GET', `/wopi/files/${root}`, token)).statusCode, 401);
    const other = value<string>('SELECT id FROM nodes WHERE name = ?', 'Notiz.txt')!;
    assert.equal((await wopi('GET', `/wopi/files/${other}/contents`, token)).statusCode, 401);
    const bearer = await app.inject({ method: 'GET', url: `/wopi/files/${node}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(bearer.statusCode, 200);
    assert.equal((await wopi('POST', `/wopi/files/${node}`, token, { 'x-wopi-override': 'PUT_RELATIVE' })).statusCode, 501);
  });

  it('speichert als neue Version und erkennt fremde Änderungen', async () => {
    const info = (await wopi('GET', `/wopi/files/${node}`, token)).json();
    const saved = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      token,
      { 'content-type': 'application/octet-stream', 'x-wopi-override': 'PUT', 'x-cool-wopi-timestamp': info.LastModifiedTime },
      Buffer.from('Fassung aus Collabora')
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const after = saved.json().LastModifiedTime;
    assert.notEqual(after, info.LastModifiedTime);
    assert.equal((await emi.get(`/api/nodes/${node}/content`)).body, 'Fassung aus Collabora');
    const versions = (await emi.get(`/api/nodes/${node}/versions`)).json().items;
    assert.equal(versions.length, 1);
    assert.equal(versions[0].size, 'kein echtes Dokument'.length);
    const stale = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      token,
      { 'content-type': 'application/octet-stream', 'x-cool-wopi-timestamp': info.LastModifiedTime },
      Buffer.from('veraltet')
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().COOLStatusCode, 1010);
    assert.equal((await emi.get(`/api/nodes/${node}/content`)).body, 'Fassung aus Collabora');
    const forced = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      token,
      { 'content-type': 'application/x-binary' },
      Buffer.from('überschrieben')
    );
    assert.equal(forced.statusCode, 200, forced.body);
    assert.equal((await emi.get(`/api/nodes/${node}/content`)).body, 'überschrieben');
    assert.equal((await wopi('GET', `/wopi/files/${node}`, token)).json().LastModifiedTime, forced.json().LastModifiedTime);
    const edits = async () =>
      ((await emi.get(`/api/nodes/${node}/activity`)).json().items as { action: string }[]).filter((entry) => entry.action === 'edit')
        .length;
    assert.equal(await edits(), 1);
    assert.equal((await emi.get(`/api/nodes/${node}/versions`)).json().items.length, 1);

    run('UPDATE versions SET created_at = created_at - ? WHERE node_id = ?', 11 * 60 * 1000, node);
    const later = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      token,
      { 'content-type': 'application/octet-stream' },
      Buffer.from('später')
    );
    assert.equal(later.statusCode, 200, later.body);
    assert.equal((await emi.get(`/api/nodes/${node}/versions`)).json().items.length, 2);
    assert.equal(await edits(), 2);

    const again = (await emi.json('POST', `/api/nodes/${node}/office/edit`)).json();
    const fresh = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      again.token,
      { 'content-type': 'application/octet-stream' },
      Buffer.from('neue Sitzung')
    );
    assert.equal(fresh.statusCode, 200, fresh.body);
    assert.equal((await emi.get(`/api/nodes/${node}/versions`)).json().items.length, 3);
    assert.equal(await edits(), 3);
  });

  it('gibt Leserechten nur die Ansicht und folgt Freigaben sofort', async () => {
    const miaId = (await mia.get('/api/session')).json().user.id;
    const grant = (await emi.json('POST', `/api/nodes/${node}/grants`, { userId: miaId, permission: 'view' })).json();
    const opened = (await mia.json('POST', `/api/nodes/${node}/office/edit`)).json();
    assert.equal(opened.write, false);
    assert.equal(new URL(opened.url).searchParams.get('permission'), 'readonly');
    assert.equal((await wopi('GET', `/wopi/files/${node}`, opened.token)).json().UserCanWrite, false);
    const refused = await wopi(
      'POST',
      `/wopi/files/${node}/contents`,
      opened.token,
      { 'content-type': 'application/octet-stream' },
      Buffer.from('nein')
    );
    assert.equal(refused.statusCode, 401);
    const id = grant.grant?.id ?? grant.id ?? value<string>('SELECT id FROM grants WHERE node_id = ?', node);
    await emi.json('PATCH', `/api/grants/${id}`, { permission: 'edit' });
    assert.equal((await wopi('GET', `/wopi/files/${node}`, opened.token)).json().UserCanWrite, true);
    assert.equal((await emi.json('POST', `/api/nodes/${node}/lock`, { minutes: 30 })).statusCode, 200);
    assert.equal((await wopi('GET', `/wopi/files/${node}`, opened.token)).json().UserCanWrite, false);
    assert.equal((await emi.json('DELETE', `/api/nodes/${node}/lock`)).statusCode, 200);
    await emi.json('DELETE', `/api/grants/${id}`);
    assert.equal((await wopi('GET', `/wopi/files/${node}`, opened.token)).statusCode, 401);
    assert.equal((await wopi('GET', `/wopi/files/${node}/contents`, opened.token)).statusCode, 401);
  });

  it('lässt Token ablaufen und mit dem Konto enden', async () => {
    run('UPDATE office_tokens SET expires_at = ? WHERE user_id = ?', Date.now() - 1000, (await emi.get('/api/session')).json().user.id);
    assert.equal((await wopi('GET', `/wopi/files/${node}`, token)).statusCode, 401);
    const fresh = (await emi.json('POST', `/api/nodes/${node}/office/edit`)).json();
    assert.equal(value<number>('SELECT COUNT(*) FROM office_tokens'), 2);
    assert.equal((await wopi('GET', `/wopi/files/${node}`, fresh.token)).statusCode, 200);
    await emi.json('POST', '/api/nodes/trash', { ids: [node] });
    assert.equal((await wopi('GET', `/wopi/files/${node}`, fresh.token)).statusCode, 401);
  });
});

describe('Office: neue Dokumente', () => {
  it('legt leere Dokumente in der Sprache der Person an', async () => {
    const made = await emi.json('POST', `/api/nodes/${root}/office/new`, { kind: 'document' });
    assert.equal(made.statusCode, 200, made.body);
    assert.equal(made.json().node.name, 'Dokument.docx');
    assert.ok(made.json().node.size > 3000);
    const again = await emi.json('POST', `/api/nodes/${root}/office/new`, { kind: 'document' });
    assert.equal(again.json().node.name, 'Dokument (2).docx');
    const sheet = await emi.json('POST', `/api/nodes/${root}/office/new`, { kind: 'spreadsheet', name: 'Haushalt 2027' });
    assert.equal(sheet.json().node.name, 'Haushalt 2027.xlsx');
    const slides = await emi.json('POST', `/api/nodes/${root}/office/new`, { kind: 'presentation', name: 'Vortrag.pptx' });
    assert.equal(slides.json().node.name, 'Vortrag.pptx');
    const bytes = (await emi.get(`/api/nodes/${made.json().node.id}/content`)).rawPayload;
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.ok(bytes.includes(Buffer.from('word/document.xml')));
    assert.equal((await emi.json('POST', `/api/nodes/${root}/office/new`, { kind: 'zeichnung' })).statusCode, 400);
    const opened = await emi.json('POST', `/api/nodes/${slides.json().node.id}/office/edit`);
    assert.equal(opened.statusCode, 200, opened.body);
  });

  it('geht nur mit eingerichtetem Office und Schreibrecht', async () => {
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    assert.equal((await mia.json('POST', `/api/nodes/${root}/office/new`, { kind: 'document' })).statusCode, 404);
    assert.equal((await mia.json('POST', `/api/nodes/${miaRoot}/office/new`, { kind: 'document' })).statusCode, 200);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'collabora.url': '' })).statusCode, 200);
    forgetDiscovery();
    assert.equal((await mia.json('POST', `/api/nodes/${miaRoot}/office/new`, { kind: 'document' })).statusCode, 400);
    assert.deepEqual((await mia.get('/api/office')).json(), { enabled: false, extensions: [] });
    const page = await emi.get('/files', { accept: 'text/html' });
    assert.match(String(page.headers['content-security-policy']), /frame-src 'self';/);
  });
});
