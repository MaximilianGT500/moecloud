import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.ts';
import { value } from '../src/lib/db.ts';
import { installPlugin } from '../src/services/plugin-install.ts';
import { activePlugins, reconcilePlugins, startPlugins, stopPlugins } from '../src/services/plugins.ts';
import * as settings from '../src/services/settings.ts';
import { outbox } from '../src/services/mail.ts';
import { Client, createApp, login, setUp, zip } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaRoot = '';

const dir = (id: string) => join(config.paths.plugins, id);
const tick = (ms = 40) => new Promise((done) => setTimeout(done, ms));

const MANIFEST = {
  id: 'zettel',
  name: { de: 'Zettel', en: 'Notes' },
  version: '1.0.0',
  description: 'Stempelt Textdateien und zählt Uploads',
  author: 'Emi Sato',
  homepage: 'https://example.com/zettel',
  api: 1,
  moecloud: '>=1.5.0',
  permissions: ['files', 'network', 'users', 'notify'],
  settings: [
    { key: 'gruss', label: { de: 'Gruß', en: 'Greeting' }, type: 'text', default: 'Hallo' },
    { key: 'token', label: 'Token', type: 'secret', required: true, hint: 'Bleibt geheim' },
    { key: 'grenze', label: 'Grenze', type: 'number', min: 1, max: 10, default: 3 },
    {
      key: 'modus',
      label: 'Modus',
      type: 'select',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { key: 'laut', label: 'Laut', type: 'boolean' },
  ],
  actions: [
    { id: 'stempeln', label: { de: 'Stempeln', en: 'Stamp' }, icon: 'bolt', kinds: ['file'], extensions: ['txt'], multiple: true },
    { id: 'nur-admin', label: 'Nur für Admins', admin: true },
    { id: 'ohne-code', label: 'Ohne Code' },
  ],
  pages: [{ id: 'start', label: 'Zettel', icon: 'chart', path: 'web/index.html' }],
  themes: [{ name: 'Zettelgelb', seed: '#EAB308', style: 'tonal', font: 'serif', corners: 0.5 }],
};

const CODE = (extra = '') => `
export default function setup(moe) {
  const push = (key, entry) => moe.store.set(key, [...(moe.store.get(key) ?? []), entry]);
  moe.on('file.upload', (event) => push('uploads', event.name + ':' + event.actorId));
  moe.on('audit.*', (event, name) => push('audits', name));
  moe.on('file.comment', () => { throw new Error('Kommentare mag ich nicht'); });
  moe.filter('upload', (upload) => {
    if (upload.name.endsWith('.exe')) throw moe.reject('Programme nimmt diese Cloud nicht an');
    if (upload.name === 'kaputt.txt') throw new Error('Absicht');
  });
  moe.route('GET', '/zustand', (request) => ({
    user: request.user.username,
    gruss: moe.settings.get('gruss'),
    token: moe.settings.get('token'),
    alle: moe.settings.all(),
    uploads: moe.store.get('uploads') ?? [],
    audits: moe.store.get('audits') ?? [],
    gesehen: moe.store.get('gesehen'),
    keys: moe.store.keys(),
    query: request.query,
    lang: request.lang,
  }));
  moe.route('POST', '/echo/:name', (request, reply) => {
    reply.status(201).header('X-Zettel', request.params.name).header('Set-Cookie', 'boese=1');
    return { body: request.body, raw: request.rawBody.length, cookie: request.headers.cookie ?? null };
  });
  moe.route('GET', '/geheim', () => 'nur für Admins', { admin: true });
  moe.route('GET', '/html', (request, reply) => { reply.type('text/html; charset=utf-8'); return '<script>alert(1)</script>'; });
  moe.route('GET', '/fehler', () => { throw new Error('kaputt'); });
  moe.route('GET', '/dateien/*', (request) => ({ rest: request.params['*'], liste: moe.files.list(request.user.id).map((file) => file.name) }));
  moe.route('POST', '/melden', (request) => {
    moe.notify(request.user.id, { title: 'Zettel fertig', text: request.body.text, url: '/files' });
    return { ok: true };
  });
  moe.route('POST', '/holen', async (request) => {
    try {
      const response = await moe.fetch(request.body.url, { private: request.body.private === true });
      return { status: response.status, text: response.text() };
    } catch (error) {
      return { fehler: error.message };
    }
  });
  moe.route('GET', '/leute', () => moe.users.list().map((user) => user.username));
  moe.publicRoute('POST', '/eingang', (request) => ({ ok: true, user: request.user, body: request.body, signatur: request.headers['x-signatur'] ?? null }));
  moe.action('stempeln', async ({ user, nodes, lang }) => {
    for (const node of nodes) {
      const text = (await moe.files.read(user.id, node.id)).toString('utf8');
      await moe.files.write(user.id, node.parentId, node.name, text + ' | ' + moe.settings.get('gruss') + ' ' + user.name, { conflict: 'replace' });
    }
    return { message: nodes.length + ' gestempelt (' + lang + ')', refresh: true, open: 'javascript:alert(1)' };
  });
  moe.action('nur-admin', () => ({ open: '/admin/plugins' }));
  moe.settings.onChange((values) => moe.store.set('gesehen', values.gruss));
  ${extra}
  return () => { globalThis.zettelBeendet = (globalThis.zettelBeendet ?? 0) + 1; };
}
`;

async function writePlugin(id: string, manifest: Record<string, unknown> | string, code?: string, files: Record<string, string> = {}) {
  await rm(dir(id), { recursive: true, force: true });
  await mkdir(join(dir(id), 'web'), { recursive: true });
  await writeFile(join(dir(id), 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (code !== undefined) await writeFile(join(dir(id), 'index.js'), code);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir(id), name, '..'), { recursive: true });
    await writeFile(join(dir(id), name), content);
  }
}

type Listed = {
  id: string;
  status: string;
  hash: string;
  error: string | null;
  errors: number;
  lastError: { message: string; where: string } | null;
};
const listed = async (id: string) =>
  ((await emi.json('POST', '/api/admin/plugins/rescan')).json().items as Listed[]).find((plugin) => plugin.id === id) as Listed &
    Record<string, unknown>;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123', email: 'mia@example.com' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
  await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  await writePlugin('zettel', MANIFEST, CODE(), {
    'web/index.html':
      '<!doctype html><link rel="stylesheet" href="/plugin-pages/sdk.css"><script src="/plugin-pages/sdk.js"></script><script src="app.js"></script><h1>Zettel</h1>',
    'web/app.js': 'moecloud.ready.then(() => moecloud.api("GET", "/zustand"));',
    'geheim.txt': 'nicht für den Browser',
  });
  assert.deepEqual(await startPlugins(), { found: 1, active: 0 });
});

after(async () => {
  await stopPlugins();
  await app.close();
});

describe('Plugins', () => {
  it('zeigt gefundene Plugins und lädt nichts ohne Freigabe', async () => {
    assert.equal((await mia.get('/api/admin/plugins')).statusCode, 403);
    const list = (await emi.get('/api/admin/plugins')).json();
    assert.equal(list.enabled, true);
    assert.equal(list.upload, false);
    assert.equal(list.dir, config.paths.plugins);
    assert.equal(list.items.length, 1);
    const plugin = list.items[0];
    assert.deepEqual(
      {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        author: plugin.author,
        status: plugin.status,
        error: plugin.error,
        files: plugin.files,
      },
      { id: 'zettel', name: 'Zettel', version: '1.0.0', author: 'Emi Sato', status: 'off', error: null, files: 5 }
    );
    assert.match(plugin.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(plugin.permissions, ['files', 'network', 'users', 'notify']);
    assert.deepEqual(plugin.actions, ['Stempeln', 'Nur für Admins', 'Ohne Code']);
    assert.deepEqual(plugin.pages, ['Zettel']);
    assert.equal(plugin.themes, 1);
    assert.deepEqual(
      plugin.settings.map((field: { key: string; type: string; value: unknown; filled?: boolean }) => [
        field.key,
        field.type,
        field.value,
        field.filled,
      ]),
      [
        ['gruss', 'text', 'Hallo', undefined],
        ['token', 'secret', null, false],
        ['grenze', 'number', 3, undefined],
        ['modus', 'select', 'a', undefined],
        ['laut', 'boolean', false, undefined],
      ]
    );
    assert.deepEqual(list.themes, []);
    assert.equal((await mia.get('/api/ext/zettel/zustand')).json().error.message, 'Dieses Plugin läuft nicht');
    assert.deepEqual((await mia.get('/api/plugins')).json(), { actions: [], pages: [] });
    assert.equal((await new Client(app).get('/plugin-pages/zettel/index.html')).statusCode, 404);
    assert.deepEqual(activePlugins(), []);
  });

  it('schaltet ein Plugin erst mit passender Prüfsumme und vollständigen Einstellungen ein', async () => {
    const { hash } = await listed('zettel');
    assert.equal((await mia.json('POST', '/api/admin/plugins/zettel/enable', { hash })).statusCode, 403);
    assert.equal((await emi.json('POST', '/api/admin/plugins/zettel/enable', { hash: 'a'.repeat(64) })).statusCode, 409);
    assert.equal(
      (await emi.json('POST', '/api/admin/plugins/zettel/enable', { hash })).json().error.message,
      'Trag zuerst die Einstellungen ein, es fehlt „Token“'
    );
    const save = (values: Record<string, unknown>) => emi.json('PUT', '/api/admin/plugins/zettel/settings', { values });
    assert.equal((await save({ unbekannt: 'x' })).json().error.message, 'Die Einstellung „unbekannt“ kennt das Plugin nicht');
    assert.equal((await save({ token: 'abc', grenze: 11 })).json().error.message, '„Grenze“ ist zu groß');
    assert.equal((await save({ token: 'abc', grenze: 'viel' })).json().error.message, '„Grenze“ muss eine Zahl sein');
    assert.equal((await save({ token: 'abc', modus: 'c' })).json().error.message, '„Modus“ kennt diese Auswahl nicht');
    assert.equal((await save({ token: 'abc', laut: 'ja' })).json().error.message, '„Laut“ braucht Ja oder Nein');
    assert.equal((await save({ gruss: 'Moin' })).json().error.message, '„Token“ fehlt');
    const saved = await save({ token: 'streng-geheim', gruss: 'Moin', grenze: 5, modus: 'b', laut: true });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      saved.json().plugin.settings.map((field: { value: unknown; filled?: boolean }) => field.filled ?? field.value),
      ['Moin', true, 5, 'b', true]
    );
    assert.ok(!saved.body.includes('streng-geheim'));
    assert.equal((await save({ token: null, gruss: 'Moin moin' })).statusCode, 200);

    const enabled = await emi.json('POST', '/api/admin/plugins/zettel/enable', { hash });
    assert.equal(enabled.statusCode, 200, enabled.body);
    assert.equal(enabled.json().plugin.status, 'active');
    assert.equal(enabled.json().plugin.routes, 10);
    assert.deepEqual(enabled.json().plugin.events, ['file.upload', 'audit.*', 'file.comment']);
    assert.deepEqual(enabled.json().themes, [
      {
        name: 'Zettelgelb',
        seed: '#eab308',
        style: 'tonal',
        secondary: null,
        tertiary: null,
        font: 'serif',
        corners: 0.5,
        plugin: 'Zettel',
      },
    ]);
    assert.deepEqual(activePlugins(), ['zettel']);
    const audit = (await emi.get('/api/admin/audit')).json().items as { action: string; details: Record<string, unknown> }[];
    assert.deepEqual(audit.find((entry) => entry.action === 'plugin_enabled')?.details, { name: 'Zettel', id: 'zettel', version: '1.0.0' });
    const english = new Client(app);
    english.cookies = new Map(emi.cookies);
    assert.equal((await english.get('/api/admin/plugins', { 'accept-language': 'en' })).json().items[0].settings[0].label.length > 0, true);
  });

  it('gibt Plugins eigene Routen mit Anmeldung, Rollen und sicheren Antworten', async () => {
    await emi.json('PUT', '/api/admin/plugins/zettel/settings', { values: { gruss: 'Moin moin' } });
    await tick();
    const state = await mia.get('/api/ext/zettel/zustand?farbe=blau&farbe=rot');
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(state.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal(state.headers['cache-control'], 'no-store');
    assert.deepEqual(
      { user: state.json().user, gruss: state.json().gruss, token: state.json().token, lang: state.json().lang, query: state.json().query },
      { user: 'mia', gruss: 'Moin moin', token: 'streng-geheim', lang: 'de', query: { farbe: 'blau' } }
    );
    assert.deepEqual(state.json().alle, { gruss: 'Moin moin', token: 'streng-geheim', grenze: 5, modus: 'b', laut: true });
    assert.equal(state.json().gesehen, 'Moin moin');
    assert.equal((await new Client(app).get('/api/ext/zettel/zustand')).statusCode, 401);

    const echo = await mia.json('POST', '/api/ext/zettel/echo/lea', { hallo: 'Welt' });
    assert.equal(echo.statusCode, 201, echo.body);
    assert.equal(echo.headers['x-zettel'], 'lea');
    assert.ok(!String(echo.headers['set-cookie'] ?? '').includes('boese'));
    assert.deepEqual(echo.json(), { body: { hallo: 'Welt' }, raw: 16, cookie: null });
    const foreign = await mia.send({
      method: 'POST',
      url: '/api/ext/zettel/echo/lea',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'falsch' },
    });
    assert.equal(foreign.statusCode, 403);
    const broken = await mia.send({
      method: 'POST',
      url: '/api/ext/zettel/echo/lea',
      payload: '{kaputt',
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(broken.statusCode, 400);

    assert.equal((await mia.get('/api/ext/zettel/geheim')).statusCode, 403);
    const secret = await emi.get('/api/ext/zettel/geheim');
    assert.equal(secret.body, 'nur für Admins');
    assert.match(String(secret.headers['content-type']), /^text\/plain/);
    const html = await mia.get('/api/ext/zettel/html');
    assert.match(String(html.headers['content-type']), /^text\/html/);
    assert.equal(html.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal(html.headers['x-content-type-options'], 'nosniff');

    const failed = await mia.get('/api/ext/zettel/fehler');
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().error.message, 'Das Plugin hat einen Fehler gemeldet');
    const after = await listed('zettel');
    assert.equal(after.errors, 1);
    assert.deepEqual(
      { message: after.lastError?.message, where: after.lastError?.where },
      { message: 'kaputt', where: 'Route GET /fehler' }
    );

    assert.equal((await mia.get('/api/ext/zettel/gibt-es-nicht')).statusCode, 404);
    assert.equal((await mia.json('DELETE', '/api/ext/zettel/zustand')).statusCode, 405);
    assert.deepEqual((await mia.get('/api/ext/zettel/dateien/a/b.txt')).json().rest, 'a/b.txt');
    assert.deepEqual((await emi.get('/api/ext/zettel/leute')).json(), ['emi', 'mia']);
    assert.equal((await mia.get('/api/ext/zettel/eingang')).statusCode, 404);
    assert.equal((await mia.json('POST', '/api/ext/zettel/eingang', {})).statusCode, 404);

    const outside = new Client(app);
    const hook = await outside.send({
      method: 'POST',
      url: '/ext/zettel/eingang',
      payload: JSON.stringify({ ereignis: 'push' }),
      headers: { 'content-type': 'application/json', 'x-signatur': 'sha256=abc', origin: 'https://example.com' },
    });
    assert.equal(hook.statusCode, 200, hook.body);
    assert.deepEqual(hook.json(), { ok: true, user: null, body: { ereignis: 'push' }, signatur: 'sha256=abc' });
    const withCookie = await mia.send({
      method: 'POST',
      url: '/ext/zettel/eingang',
      payload: 'a=1&b=zwei',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.deepEqual(withCookie.json(), { ok: true, user: null, body: { a: '1', b: 'zwei' }, signatur: null });
    assert.equal((await outside.get('/ext/zettel/zustand')).statusCode, 404);
  });

  it('meldet Ereignisse und lässt Filter Uploads ablehnen', async () => {
    const first = await mia.upload(miaRoot, 'Einkauf.txt', Buffer.from('Milch'), 4096);
    assert.equal(first.statusCode, 200, first.body);
    await mia.json('POST', `/api/nodes/${first.json().node.id}/comments`, { text: 'Hafermilch' });
    await tick();
    const state = (await mia.get('/api/ext/zettel/zustand')).json();
    const miaId = (await mia.get('/api/session')).json().user.id;
    assert.deepEqual(state.uploads, [`Einkauf.txt:${miaId}`]);
    assert.ok(state.audits.includes('audit.plugin_enabled'));
    assert.ok(state.audits.includes('audit.plugin_settings'));
    assert.deepEqual(state.keys.sort(), ['audits', 'gesehen', 'uploads']);
    assert.equal((await listed('zettel')).lastError?.where, 'Ereignis file.comment');

    const rejected = await mia.upload(miaRoot, 'Spiel.exe', Buffer.from('MZ'), 4096);
    assert.equal(rejected.statusCode, 422, rejected.body);
    assert.equal(rejected.json().error.message, 'Programme nimmt diese Cloud nicht an');
    assert.equal(rejected.json().error.code, 'rejected');
    const token = (await mia.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json().token as string;
    const dav = await app.inject({
      method: 'PUT',
      url: '/dav/Werkzeug.exe',
      payload: 'MZ',
      headers: { authorization: `Basic ${Buffer.from(`mia:${token}`).toString('base64')}` },
    });
    assert.equal(dav.statusCode, 422);
    assert.equal((await mia.get('/api/search?q=exe')).json().items.length, 0);

    const errorsBefore = (await listed('zettel')).errors;
    const tolerated = await mia.upload(miaRoot, 'kaputt.txt', Buffer.from('trotzdem'), 4096);
    assert.equal(tolerated.statusCode, 200, tolerated.body);
    const afterFilter = await listed('zettel');
    assert.equal(afterFilter.errors, errorsBefore + 1);
    assert.deepEqual(
      { message: afterFilter.lastError?.message, where: afterFilter.lastError?.where },
      { message: 'Absicht', where: 'Filter upload' }
    );
  });

  it('bietet Aktionen und Seiten nur denen an, die sie nutzen dürfen', async () => {
    const boot = (await mia.get('/api/plugins')).json();
    assert.deepEqual(boot.actions, [
      {
        plugin: 'zettel',
        id: 'stempeln',
        label: 'Stempeln',
        icon: 'bolt',
        kinds: ['file'],
        extensions: ['txt'],
        multiple: true,
        confirm: '',
      },
    ]);
    assert.deepEqual(boot.pages, [
      { plugin: 'zettel', id: 'start', label: 'Zettel', icon: 'chart', src: '/plugin-pages/zettel/index.html' },
    ]);
    assert.deepEqual(
      (await emi.get('/api/plugins')).json().actions.map((action: { id: string }) => action.id),
      ['stempeln', 'nur-admin']
    );

    const note = (await mia.get('/api/search?q=Einkauf.txt')).json().items[0];
    const done = await mia.json('POST', '/api/plugins/zettel/actions/stempeln', { ids: [note.id] });
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual(done.json(), { message: '1 gestempelt (de)', open: null, refresh: true });
    const fresh = (await mia.get('/api/search?q=Einkauf.txt')).json().items[0];
    assert.equal((await mia.get(`/api/nodes/${fresh.id}/content`)).body, 'Milch | Moin moin Mia');
    assert.equal((await mia.get(`/api/nodes/${fresh.id}/versions`)).json().items.length, 1);

    const image = (await mia.upload(miaRoot, 'Bild.png', Buffer.from('kein Bild'), 4096)).json().node;
    assert.equal(
      (await mia.json('POST', '/api/plugins/zettel/actions/stempeln', { ids: [image.id] })).json().error.message,
      'Die Aktion passt nicht zu „Bild.png“'
    );
    assert.equal((await mia.json('POST', '/api/plugins/zettel/actions/nur-admin', { ids: [note.id] })).statusCode, 404);
    assert.equal((await mia.json('POST', '/api/plugins/zettel/actions/ohne-code', { ids: [note.id] })).statusCode, 404);
    assert.equal((await emi.json('POST', '/api/plugins/zettel/actions/stempeln', { ids: [note.id] })).statusCode, 404);
    const own = (await emi.upload(root, 'Admin.txt', Buffer.from('x'), 4096)).json().node;
    assert.deepEqual((await emi.json('POST', '/api/plugins/zettel/actions/nur-admin', { ids: [own.id] })).json(), {
      message: null,
      open: '/admin/plugins',
      refresh: false,
    });

    const guest = new Client(app);
    const page = await guest.get('/plugin-pages/zettel/index.html');
    assert.equal(page.statusCode, 200);
    assert.match(String(page.headers['content-type']), /^text\/html/);
    assert.match(String(page.headers['content-security-policy']), /^sandbox allow-scripts /);
    assert.ok(!String(page.headers['content-security-policy']).includes('allow-same-origin'));
    assert.match(String(page.headers['content-security-policy']), /connect-src 'none'/);
    assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN');
    assert.match(String((await guest.get('/plugin-pages/zettel/app.js')).headers['content-type']), /javascript/);
    for (const path of [
      '../plugin.json',
      '..%2Fplugin.json',
      '%2e%2e/index.js',
      'gibt-es-nicht.html',
      '.geheim',
      'app.js/..%2f..%2fgeheim.txt',
    ]) {
      assert.equal((await guest.get(`/plugin-pages/zettel/${path}`)).statusCode, 404, path);
    }
    assert.equal((await guest.get('/plugin-pages/andere/index.html')).statusCode, 404);
    const sdk = await guest.get('/plugin-pages/sdk.js');
    assert.equal(sdk.statusCode, 200);
    assert.match(sdk.body, /window\.moecloud = \{/);
    assert.match((await guest.get('/plugin-pages/sdk.css')).body, /--moe-primary/);
  });

  it('lässt Plugins benachrichtigen und nur geprüft ins Netz', async () => {
    outbox.length = 0;
    const sent = await mia.json('POST', '/api/ext/zettel/melden', { text: 'Drei Dateien sind gestempelt' });
    assert.equal(sent.statusCode, 200, sent.body);
    const notes = (await mia.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[];
    assert.deepEqual(
      { kind: notes[0].kind, title: notes[0].title, text: notes[0].text, url: notes[0].url },
      { kind: 'plugin', title: 'Zettel fertig', text: 'Drei Dateien sind gestempelt', url: '/files' }
    );
    await tick(80);
    assert.equal(outbox.filter((mail) => mail.to === 'mia@example.com' && mail.subject.includes('Zettel fertig')).length, 1);

    const server = createServer((_request, response) => response.end('nur intern'));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      assert.deepEqual((await mia.json('POST', '/api/ext/zettel/holen', { url })).json(), { fehler: 'Die Adresse zeigt ins lokale Netz' });
      assert.deepEqual((await mia.json('POST', '/api/ext/zettel/holen', { url: url.replace('127.0.0.1', 'localhost') })).json(), {
        fehler: 'Die Adresse zeigt ins lokale Netz',
      });
      assert.deepEqual((await mia.json('POST', '/api/ext/zettel/holen', { url, private: true })).json(), {
        status: 200,
        text: 'nur intern',
      });
      assert.match((await mia.json('POST', '/api/ext/zettel/holen', { url: 'file:///etc/passwd' })).json().fehler, /Nur http/);
    } finally {
      await new Promise((done) => server.close(done));
    }

    await writePlugin(
      'karg',
      { id: 'karg', name: 'Karg', version: '1.0.0', api: 1, permissions: ['files'] },
      `export default (moe) => {
        const versuch = async (work) => { try { await work(); return 'erlaubt'; } catch (error) { return error.message; } };
        moe.route('GET', '/rechte', async (request) => ({
          dateien: await versuch(() => moe.files.list(request.user.id)),
          leute: await versuch(() => moe.users.list()),
          einer: await versuch(() => moe.users.get(request.user.id)),
          netz: await versuch(() => moe.fetch('https://example.com/')),
          melden: await versuch(() => moe.notify(request.user.id, { title: 'Hallo' })),
        }));
      };`
    );
    const karg = await listed('karg');
    assert.equal((await emi.json('POST', '/api/admin/plugins/karg/enable', { hash: karg.hash })).json().plugin.status, 'active');
    const missing = (name: string) => `Dafür muss in plugin.json unter permissions „${name}“ stehen`;
    assert.deepEqual((await mia.get('/api/ext/karg/rechte')).json(), {
      dateien: 'erlaubt',
      leute: missing('users'),
      einer: missing('users'),
      netz: missing('network'),
      melden: missing('notify'),
    });
    assert.equal((await emi.json('POST', '/api/admin/plugins/karg/disable')).statusCode, 200);
    await writePlugin('unbekannt', { id: 'unbekannt', name: 'Unbekannt', version: '1.0.0', api: 1, permissions: ['mail'] });
    assert.match(String((await listed('unbekannt')).error), /plugin\.json passt nicht: permissions/);
    await rm(dir('unbekannt'), { recursive: true, force: true });
    await rm(dir('karg'), { recursive: true, force: true });
    await emi.json('POST', '/api/admin/plugins/rescan');
  });

  it('hält ein Plugin an, sobald sich seine Dateien ändern', async () => {
    const before = await listed('zettel');
    const known = (await mia.get('/api/ext/zettel/zustand')).json().uploads as string[];
    const stops = (globalThis as { zettelBeendet?: number }).zettelBeendet ?? 0;
    await writeFile(join(dir('zettel'), 'index.js'), CODE("moe.route('GET', '/neu', () => ({ neu: true }));"));
    const changed = await listed('zettel');
    assert.equal(changed.status, 'changed');
    assert.notEqual(changed.hash, before.hash);
    assert.equal((globalThis as { zettelBeendet?: number }).zettelBeendet, stops + 1);
    assert.equal((await mia.get('/api/ext/zettel/zustand')).statusCode, 404);
    assert.deepEqual((await mia.get('/api/plugins')).json(), { actions: [], pages: [] });
    const upload = await mia.upload(miaRoot, 'Jetzt.exe', Buffer.from('MZ'), 4096);
    assert.equal(upload.statusCode, 200);
    const alerts = async () =>
      ((await emi.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[]).filter(
        (note) => note.kind === 'admin_plugin'
      );
    const first = await alerts();
    assert.equal(first.length, 1);
    assert.deepEqual(
      { title: first[0].title, text: first[0].text, url: first[0].url },
      {
        title: 'Das Plugin „Zettel“ steht still',
        text: 'Seine Dateien haben sich seit der Freigabe geändert. Schau sie dir an und gib das Plugin neu frei.',
        url: '/admin/plugins',
      }
    );
    await listed('zettel');
    assert.equal((await alerts()).length, 1);
    assert.equal(
      ((await mia.get('/api/notifications')).json().items as { kind: string }[]).filter((note) => note.kind === 'admin_plugin').length,
      0
    );
    const stopped = (await emi.get('/api/admin/audit?action=plugin_stopped')).json().items as { details: Record<string, string> }[];
    assert.deepEqual(
      stopped.map((entry) => [entry.details.id, entry.details.reason]),
      [['zettel', 'changed']]
    );

    assert.equal((await emi.json('POST', '/api/admin/plugins/zettel/enable', { hash: before.hash })).statusCode, 409);
    const again = await emi.json('POST', '/api/admin/plugins/zettel/enable', { hash: changed.hash });
    assert.equal(again.json().plugin.status, 'active');
    assert.deepEqual((await mia.get('/api/ext/zettel/neu')).json(), { neu: true });
    assert.deepEqual((await mia.get('/api/ext/zettel/zustand')).json().uploads, known);

    const off = await emi.json('POST', '/api/admin/plugins/zettel/disable');
    assert.equal(off.json().plugin.status, 'off');
    assert.equal((await mia.get('/api/ext/zettel/neu')).statusCode, 404);
    assert.equal((await new Client(app).get('/plugin-pages/zettel/index.html')).statusCode, 404);
    assert.equal((globalThis as { zettelBeendet?: number }).zettelBeendet, stops + 2);
    assert.equal(value<number>("SELECT COUNT(*) FROM plugin_store WHERE plugin = 'zettel'"), 3);
  });

  it('erklärt, warum sich ein Plugin nicht laden lässt', async () => {
    await mkdir(dir('leer'), { recursive: true });
    await writePlugin('schief', '{ kein json');
    await writePlugin('falscher-name', { ...MANIFEST, id: 'anders' });
    await writePlugin(
      'zu-neu',
      { id: 'zu-neu', name: 'Zu neu', version: '1.0.0', api: 1, moecloud: '>=99.0.0' },
      'export default () => {};'
    );
    await writePlugin(
      'stolpert',
      { id: 'stolpert', name: 'Stolpert', version: '0.1.0', api: 1 },
      "export default () => { throw new Error('Start misslungen'); };"
    );
    await writePlugin('ohne-funktion', { id: 'ohne-funktion', name: 'Ohne Funktion', version: '0.1.0', api: 1 }, 'export const wert = 1;');
    await writePlugin('altes-api', { id: 'altes-api', name: 'Altes API', version: '0.1.0', api: 2 });
    await writePlugin('verlinkt', { id: 'verlinkt', name: 'Verlinkt', version: '0.1.0', api: 1 }, 'export default () => {};');
    await symlink('/etc/hostname', join(dir('verlinkt'), 'fremd.txt'));
    await writePlugin('nur-themes', {
      id: 'nur-themes',
      name: 'Nur Themes',
      version: '2.0.0',
      api: 1,
      themes: [{ name: 'Nacht', seed: '#1e3a8a' }],
    });
    const items = (await emi.json('POST', '/api/admin/plugins/rescan')).json().items as Listed[];
    const by = (id: string) => items.find((plugin) => plugin.id === id) as Listed;
    assert.deepEqual([by('leer').status, by('leer').error], ['invalid', 'Im Ordner fehlt die Datei plugin.json']);
    assert.deepEqual([by('schief').status, by('schief').error], ['invalid', 'plugin.json ist kein gültiges JSON']);
    assert.deepEqual([by('falscher-name').status, by('falscher-name').error], ['invalid', 'Der Ordner muss wie das Plugin heißen: anders']);
    assert.equal(by('altes-api').status, 'invalid');
    assert.match(String(by('altes-api').error), /^plugin\.json passt nicht: api /);
    assert.deepEqual([by('verlinkt').status, by('verlinkt').error], ['invalid', 'Verknüpfungen sind in Plugins nicht erlaubt: fremd.txt']);
    assert.equal((await emi.json('POST', '/api/admin/plugins/verlinkt/enable', { hash: 'a'.repeat(64) })).statusCode, 400);

    const enable = async (id: string) => emi.json('POST', `/api/admin/plugins/${id}/enable`, { hash: by(id).hash });
    assert.equal(
      (await enable('zu-neu')).json().error.message,
      'Das Plugin ließ sich nicht starten: Das Plugin braucht MoeCloud 99.0.0 oder neuer'
    );
    assert.equal((await enable('stolpert')).json().error.message, 'Das Plugin ließ sich nicht starten: Start misslungen');
    assert.equal(
      (await enable('ohne-funktion')).json().error.message,
      'Das Plugin ließ sich nicht starten: Das Plugin exportiert keine Funktion als default'
    );
    assert.equal((await listed('stolpert')).status, 'off');
    const themes = await enable('nur-themes');
    assert.equal(themes.json().plugin.status, 'active');
    assert.deepEqual(themes.json().themes, [
      {
        name: 'Nacht',
        seed: '#1e3a8a',
        style: 'content',
        secondary: null,
        tertiary: null,
        font: 'rounded',
        corners: 1,
        plugin: 'Nur Themes',
      },
    ]);
    assert.equal((await emi.json('POST', '/api/admin/plugins/gibt-es-nicht/enable', { hash: 'a'.repeat(64) })).statusCode, 404);
    assert.deepEqual(activePlugins(), ['nur-themes']);
  });

  it('führt Aufgaben regelmäßig aus und übersteht einen Neustart', async () => {
    await writePlugin(
      'uhr',
      { id: 'uhr', name: 'Uhr', version: '1.0.0', api: 1 },
      "export default (moe) => { moe.job('zaehlen', '1s', () => moe.store.set('ticks', (moe.store.get('ticks') ?? 0) + 1)); moe.route('GET', '/ticks', () => ({ ticks: moe.store.get('ticks') ?? 0, dev: moe.dev })); };"
    );
    config.plugins.dev = true;
    try {
      const { hash } = await listed('uhr');
      assert.equal((await emi.json('POST', '/api/admin/plugins/uhr/enable', { hash })).json().plugin.jobs, 1);
      await tick(2300);
      const ticks = (await emi.get('/api/ext/uhr/ticks')).json();
      assert.ok(ticks.ticks >= 1 && ticks.ticks <= 3, String(ticks.ticks));
      assert.equal(ticks.dev, true);
    } finally {
      config.plugins.dev = false;
    }
    await stopPlugins();
    assert.deepEqual(activePlugins(), []);
    assert.equal((await emi.get('/api/ext/uhr/ticks')).statusCode, 404);
    const restarted = await startPlugins();
    assert.equal(restarted.active, 2);
    assert.deepEqual(activePlugins().sort(), ['nur-themes', 'uhr']);
    const frozen = (await emi.get('/api/ext/uhr/ticks')).json().ticks;
    await tick(1300);
    assert.equal((await emi.get('/api/ext/uhr/ticks')).json().ticks, frozen);
  });

  it('übernimmt Freigaben und Einstellungen von der Kommandozeile im laufenden Betrieb', async () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'cli.ts', ...args], {
        cwd: resolve(import.meta.dirname, '..'),
        env: process.env,
        encoding: 'utf8',
        timeout: 60_000,
      });
    await writePlugin(
      'gast',
      { id: 'gast', name: 'Gast', version: '0.3.0', api: 1 },
      "export default (moe) => moe.route('GET', '/', () => 'hier');"
    );
    const list = cli('plugins');
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /^gast\s+0\.3\.0\s+aus$/m);
    assert.match(list.stdout, /^uhr\s+1\.0\.0\s+freigegeben$/m);
    assert.match(list.stdout, /^stolpert\s+0\.1\.0\s+aus$/m);
    assert.match(list.stdout, /^leer\s+ungültig: Im Ordner fehlt die Datei plugin\.json$/m);
    assert.equal(await reconcilePlugins(), false);

    const enabled = cli('plugins', 'enable', 'gast');
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.match(enabled.stdout, /gast ist freigegeben/);
    assert.equal((await emi.get('/api/ext/gast')).statusCode, 404);
    await tick(3200);
    assert.equal(await reconcilePlugins(), true);
    assert.equal((await emi.get('/api/ext/gast')).body, 'hier');
    assert.equal(await reconcilePlugins(), false);

    assert.equal(cli('plugins', 'enable', 'gibt-es-nicht').status, 1);
    assert.match(cli('plugins', 'enable', 'verlinkt').stderr, /Dieses Plugin lässt sich nicht einschalten/);
    assert.equal(settings.get('maintenance.enabled'), false);
    assert.equal(cli('maintenance', 'on').status, 0);
    assert.equal(cli('plugins', 'disable', 'gast').status, 0);
    await tick(3200);
    assert.equal(settings.get('maintenance.enabled'), true);
    assert.equal((await mia.get('/api/themes')).statusCode, 503);
    assert.equal(cli('maintenance', 'off').status, 0);
    assert.equal(await reconcilePlugins(), true);
    assert.equal((await emi.get('/api/ext/gast')).statusCode, 404);
    await tick(3200);
    assert.equal((await mia.get('/api/themes')).statusCode, 200);
  });

  it('installiert Plugins aus einem ZIP und lässt den Browser das nur auf Wunsch tun', async () => {
    const archive = join(config.paths.tmp, 'karte.zip');
    const manifest = { id: 'karte', name: 'Karte', version: '1.2.0', api: 1 };
    await writeFile(
      archive,
      await zip({
        'karte-1.2.0/plugin.json': JSON.stringify(manifest),
        'karte-1.2.0/index.js': "export default (moe) => moe.route('GET', '/', () => 'da');",
        'karte-1.2.0/web/x.html': 'x',
      })
    );
    assert.deepEqual(await installPlugin(archive), { id: 'karte', version: '1.2.0', replaced: false });
    assert.equal(await readFile(join(dir('karte'), 'web/x.html'), 'utf8'), 'x');
    const first = await listed('karte');
    assert.equal(first.status, 'off');
    assert.equal((await emi.json('POST', '/api/admin/plugins/karte/enable', { hash: first.hash })).json().plugin.status, 'active');
    assert.equal((await emi.get('/api/ext/karte')).body, 'da');

    await writeFile(
      archive,
      await zip({
        'plugin.json': JSON.stringify({ ...manifest, version: '1.3.0' }),
        'index.js': "export default (moe) => moe.route('GET', '/', () => 'neu');",
      })
    );
    assert.deepEqual(await installPlugin(archive), { id: 'karte', version: '1.3.0', replaced: true });
    assert.equal((await emi.get('/api/ext/karte')).statusCode, 404);
    assert.equal((await listed('karte')).status, 'changed');

    await writeFile(archive, await zip({ 'liesmich.txt': 'nichts' }));
    await assert.rejects(installPlugin(archive), /Im Archiv fehlt die Datei plugin\.json/);
    await writeFile(archive, 'kein zip');
    await assert.rejects(installPlugin(archive), /Das ist kein ZIP-Archiv mit einem Plugin/);

    const packed = await zip({ 'plugin.json': JSON.stringify({ id: 'paket', name: 'Paket', version: '0.0.1', api: 1 }) });
    const post = (client: Client) =>
      client.send({
        method: 'POST',
        url: '/api/admin/plugins/upload',
        payload: packed,
        headers: { 'content-type': 'application/octet-stream' },
      });
    assert.equal((await post(emi)).json().error.message, 'Plugins im Browser hochzuladen ist auf diesem Server abgeschaltet');
    assert.equal((await emi.json('DELETE', '/api/admin/plugins/karte')).statusCode, 400);
    config.plugins.upload = true;
    try {
      assert.equal((await post(mia)).statusCode, 403);
      const uploaded = await post(emi);
      assert.equal(uploaded.statusCode, 200, uploaded.body);
      assert.deepEqual(uploaded.json().installed, { id: 'paket', version: '0.0.1', replaced: false });
      assert.equal((await emi.get('/api/admin/plugins')).json().upload, true);
      const removed = await emi.json('DELETE', '/api/admin/plugins/karte');
      assert.equal(removed.statusCode, 200, removed.body);
      assert.ok(!(removed.json().items as Listed[]).some((plugin) => plugin.id === 'karte'));
      assert.equal(value<number>("SELECT COUNT(*) FROM plugin_store WHERE plugin = 'karte'"), 0);
      assert.equal((await emi.json('DELETE', '/api/admin/plugins/..%2Fblobs')).statusCode, 404);
    } finally {
      config.plugins.upload = false;
    }
  });

  it('bemerkt geänderte Dateien von selbst und startet nichts doppelt', async () => {
    const counter = globalThis as { doppeltGestartet?: number; doppeltBeendet?: number };
    const code = (answer: string) =>
      `export default async (moe) => {
        globalThis.doppeltGestartet = (globalThis.doppeltGestartet ?? 0) + 1;
        await new Promise((done) => setTimeout(done, 60));
        moe.route('GET', '/', () => '${answer}');
        return () => { globalThis.doppeltBeendet = (globalThis.doppeltBeendet ?? 0) + 1; };
      };`;
    const file = join(dir('doppelt'), 'index.js');
    const quiet = async () =>
      ((await emi.get('/api/admin/plugins')).json().items as Listed[]).find((plugin) => plugin.id === 'doppelt') as Listed;
    await writePlugin('doppelt', { id: 'doppelt', name: 'Doppelt', version: '1.0.0', api: 1 }, code('eins'));
    const { hash } = await listed('doppelt');
    const answers = await Promise.all([
      emi.json('POST', '/api/admin/plugins/doppelt/enable', { hash }),
      emi.json('POST', '/api/admin/plugins/rescan'),
      emi.json('POST', '/api/admin/plugins/doppelt/enable', { hash }),
      emi.json('POST', '/api/admin/plugins/rescan'),
      reconcilePlugins(),
    ]);
    assert.deepEqual(
      answers.slice(0, 4).map((answer) => (answer as { statusCode: number }).statusCode),
      [200, 200, 200, 200]
    );
    assert.equal((counter.doppeltGestartet ?? 0) - (counter.doppeltBeendet ?? 0), 1);
    assert.equal((await emi.get('/api/ext/doppelt')).body, 'eins');

    assert.equal(await reconcilePlugins(), false);
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    assert.equal(await reconcilePlugins(), true);
    assert.equal((await quiet()).status, 'active');
    assert.equal(await reconcilePlugins(), false);
    assert.equal((counter.doppeltGestartet ?? 0) - (counter.doppeltBeendet ?? 0), 1);

    await writeFile(file, code('zwei'));
    assert.equal((await quiet()).status, 'active');
    assert.equal(await reconcilePlugins(), true);
    const stopped = await quiet();
    assert.equal(stopped.status, 'changed');
    assert.notEqual(stopped.hash, hash);
    assert.equal((await emi.get('/api/ext/doppelt')).statusCode, 404);
    assert.equal((counter.doppeltGestartet ?? 0) - (counter.doppeltBeendet ?? 0), 0);
    assert.equal(await reconcilePlugins(), false);

    config.plugins.dev = true;
    try {
      await stopPlugins();
      await startPlugins();
      assert.equal((await emi.get('/api/ext/doppelt')).body, 'zwei');
      await writeFile(file, code('drei'));
      let body = '';
      for (let round = 0; round < 60 && body !== 'drei'; round += 1) {
        await tick(100);
        body = (await emi.get('/api/ext/doppelt')).body;
      }
      assert.equal(body, 'drei');
      assert.equal((counter.doppeltGestartet ?? 0) - (counter.doppeltBeendet ?? 0), 1);
    } finally {
      config.plugins.dev = false;
      await stopPlugins();
      await startPlugins();
    }
    assert.equal((await quiet()).status, 'changed');
    assert.equal((counter.doppeltGestartet ?? 0) - (counter.doppeltBeendet ?? 0), 0);
  });

  it('meldet Admins, wenn ein freigegebenes Plugin stillsteht', async () => {
    const alerts = async (name: string) =>
      ((await emi.get('/api/notifications')).json().items as { kind: string; title: string; text: string }[])
        .filter((note) => note.kind === 'admin_plugin' && note.title === `Das Plugin „${name}“ steht still`)
        .map((note) => note.text);
    const flag = globalThis as { brichtJetzt?: boolean };
    await writePlugin(
      'bricht',
      { id: 'bricht', name: 'Bricht', version: '1.0.0', api: 1 },
      "export default (moe) => { if (globalThis.brichtJetzt) throw new Error('Heute nicht'); moe.route('GET', '/', () => 'ok'); };"
    );
    const { hash } = await listed('bricht');
    assert.equal((await emi.json('POST', '/api/admin/plugins/bricht/enable', { hash })).json().plugin.status, 'active');
    assert.deepEqual(await alerts('Bricht'), []);

    flag.brichtJetzt = true;
    await stopPlugins();
    await startPlugins();
    assert.deepEqual(await alerts('Bricht'), ['Der Start ist misslungen: Heute nicht']);
    const failed = ((await emi.get('/api/admin/plugins')).json().items as Listed[]).find((plugin) => plugin.id === 'bricht');
    assert.deepEqual({ status: failed?.status, error: failed?.error }, { status: 'failed', error: 'Heute nicht' });
    await stopPlugins();
    await startPlugins();
    await listed('bricht');
    assert.equal((await alerts('Bricht')).length, 1);

    flag.brichtJetzt = false;
    assert.equal((await emi.json('POST', '/api/admin/plugins/bricht/enable', { hash })).json().plugin.status, 'active');
    await rm(dir('bricht'), { recursive: true, force: true });
    assert.equal(await listed('bricht'), undefined);
    assert.equal((await emi.get('/api/ext/bricht')).statusCode, 404);
    assert.deepEqual(await alerts('bricht'), ['Sein Ordner fehlt auf dem Server.']);
    await listed('bricht');
    assert.equal((await alerts('bricht')).length, 1);

    await writePlugin('bricht', '{ kaputt');
    assert.equal((await listed('bricht')).status, 'invalid');
    assert.deepEqual(await alerts('bricht'), [
      'Sein Ordner lässt sich nicht mehr lesen: plugin.json ist kein gültiges JSON',
      'Sein Ordner fehlt auf dem Server.',
    ]);
    const reasons = ((await emi.get('/api/admin/audit?action=plugin_stopped')).json().items as { details: Record<string, string> }[])
      .filter((entry) => entry.details.id === 'bricht')
      .map((entry) => entry.details.reason);
    assert.deepEqual(reasons, ['invalid', 'missing', 'failed']);
    await rm(dir('bricht'), { recursive: true, force: true });
  });
});
