import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.ts';
import { startPlugins, stopPlugins } from '../src/services/plugins.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaRoot = '';

const tick = (ms = 60) => new Promise((done) => setTimeout(done, ms));

type Listed = {
  id: string;
  status: string;
  hash: string;
  themes: number;
  routes: number;
  jobs: number;
  events: string[];
  error: string | null;
};

async function enable(id: string, values?: Record<string, unknown>) {
  if (values) {
    const saved = await emi.json('PUT', `/api/admin/plugins/${id}/settings`, { values });
    assert.equal(saved.statusCode, 200, saved.body);
  }
  const list = (await emi.json('POST', '/api/admin/plugins/rescan')).json().items as Listed[];
  const entry = list.find((plugin) => plugin.id === id) as Listed;
  const enabled = await emi.json('POST', `/api/admin/plugins/${id}/enable`, { hash: entry.hash });
  assert.equal(enabled.statusCode, 200, enabled.body);
  return enabled.json().plugin as Listed;
}

before(async () => {
  emi = await setUp(app);
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123', email: 'mia@example.com' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
  assert.deepEqual(await startPlugins(), { found: 0, active: 0 });
});

after(async () => {
  await stopPlugins();
  await app.close();
});

describe('Mitgelieferte Plugins', () => {
  it('lassen sich aus der Verwaltung hinzufügen, ohne Code hochzuladen', async () => {
    const bundled = (await readdir(config.paths.examples)).sort();
    assert.deepEqual(bundled, ['briefkasten', 'datei-webhook', 'farbpaket', 'inhaltsliste', 'statistik', 'upload-regeln']);
    const before = (await emi.get('/api/admin/plugins')).json();
    assert.equal(before.upload, false);
    assert.deepEqual(
      (before.examples as { id: string; installed: boolean }[]).map((example) => [example.id, example.installed]),
      bundled.map((id) => [id, false])
    );
    assert.equal((await mia.json('POST', '/api/admin/plugins/examples/statistik')).statusCode, 403);
    const added = await emi.json('POST', '/api/admin/plugins/examples/statistik');
    assert.equal(added.statusCode, 200, added.body);
    assert.deepEqual(added.json().installed, { id: 'statistik', version: '1.0.0', replaced: false });
    assert.equal((added.json().items as Listed[]).find((plugin) => plugin.id === 'statistik')?.status, 'off');
    assert.equal(
      (added.json().examples as { id: string; installed: boolean }[]).find((example) => example.id === 'statistik')?.installed,
      true
    );
    assert.equal((await emi.json('POST', '/api/admin/plugins/examples/statistik')).statusCode, 409);
    assert.equal((await emi.json('POST', '/api/admin/plugins/examples/gibt-es-nicht')).statusCode, 404);
    assert.equal((await emi.json('POST', '/api/admin/plugins/examples/..%2F..%2Fsrc')).statusCode, 404);
    for (const id of bundled.filter((name) => name !== 'statistik')) {
      assert.equal((await emi.json('POST', `/api/admin/plugins/examples/${id}`)).statusCode, 200);
    }
    const english = (await emi.get('/api/admin/plugins', { 'accept-language': 'en' })).json();
    assert.ok((english.examples as { installed: boolean }[]).every((example) => example.installed));
    const audit = (await emi.get('/api/admin/audit?action=plugin_installed')).json().items as { details: { name: string } }[];
    assert.equal(audit.length, 6);
  });

  it('Upload-Regeln lehnt nach Endung und Größe ab', async () => {
    const plugin = await enable('upload-regeln', { gesperrt: 'exe, .PDF', maxMb: 1 });
    assert.equal(plugin.status, 'active');
    const program = await mia.upload(miaRoot, 'Spiel.EXE', Buffer.from('MZ'), 4096);
    assert.equal(program.statusCode, 422, program.body);
    assert.deepEqual(program.json().error, { code: 'rejected', message: 'Diese Datei nimmt die Cloud nicht an (.exe)' });
    assert.equal((await mia.upload(miaRoot, 'Rechnung.pdf', Buffer.from('%PDF-1.7'), 4096)).statusCode, 422);
    const big = await mia.upload(miaRoot, 'gross.bin', Buffer.alloc(1024 * 1024 + 1), 512 * 1024);
    assert.equal(big.statusCode, 422, big.body);
    assert.equal(big.json().error.message, 'Diese Datei nimmt die Cloud nicht an (mehr als 1 MB)');
    assert.equal((await mia.upload(miaRoot, 'Notiz.txt', Buffer.from('passt'), 4096)).statusCode, 200);
    assert.deepEqual(
      ((await mia.get(`/api/nodes/${miaRoot}/children`)).json().items as { name: string }[]).map((item) => item.name),
      ['Notiz.txt']
    );

    await emi.json('PUT', '/api/admin/plugins/upload-regeln/settings', { values: { nurLinks: true, hinweis: 'Hier nicht' } });
    assert.equal((await mia.upload(miaRoot, 'Spiel.exe', Buffer.from('MZ'), 4096)).statusCode, 200);
    const folder = (await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Eingang' })).json().node.id as string;
    const link = (await mia.json('POST', `/api/nodes/${folder}/links`, { allowUpload: true })).json().link as { token: string };
    const guest = new Client(app);
    await guest.get(`/s/${link.token}`, { accept: 'text/html' });
    const send = async (name: string) => {
      const init = await guest.json('POST', `/api/public/${link.token}/uploads`, { parentId: folder, name, size: 2 });
      assert.equal(init.statusCode, 200, init.body);
      await guest.send({
        method: 'PUT',
        url: `/api/public/${link.token}/uploads/${init.json().id}?offset=0`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('MZ'),
      });
      return guest.json('POST', `/api/public/${link.token}/uploads/${init.json().id}/complete`);
    };
    const viaLink = await send('Trojaner.exe');
    assert.equal(viaLink.statusCode, 422, viaLink.body);
    assert.equal(viaLink.json().error.message, 'Hier nicht (.exe)');
    assert.equal((await send('Gruß von Lea.txt')).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/admin/plugins/upload-regeln/disable')).statusCode, 200);
    assert.equal((await mia.upload(miaRoot, 'Rechnung.pdf', Buffer.from('%PDF-1.7'), 4096)).statusCode, 200);
  });

  it('Datei-Webhook meldet Ereignisse signiert weiter', async () => {
    const received: { body: string; signature: string; type: string }[] = [];
    let status = 204;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          signature: String(request.headers['x-signature'] ?? ''),
          type: String(request.headers['content-type'] ?? ''),
        });
        response.statusCode = status;
        response.end();
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    try {
      const needs = await emi.json('POST', '/api/admin/plugins/datei-webhook/enable', {
        hash: ((await emi.get('/api/admin/plugins')).json().items as Listed[]).find((plugin) => plugin.id === 'datei-webhook')?.hash,
      });
      assert.equal(needs.statusCode, 400);
      assert.equal(needs.json().error.message, 'Trag zuerst die Einstellungen ein, es fehlt „Adresse“');
      const plugin = await enable('datei-webhook', { url, geheimnis: 'pssst', ereignisse: 'upload, rename' });
      assert.deepEqual(plugin.events, ['file.*']);

      const first = await mia.upload(miaRoot, 'Bericht.txt', Buffer.from('Zahlen'), 4096);
      await tick(200);
      assert.equal(received.length, 0);
      const blocked = (
        (await emi.json('POST', '/api/admin/plugins/rescan')).json().items as (Listed & { lastError: { message: string } | null })[]
      ).find((entry) => entry.id === 'datei-webhook');
      assert.equal(blocked?.lastError?.message, 'Die Adresse zeigt ins lokale Netz');

      await emi.json('PUT', '/api/admin/plugins/datei-webhook/settings', { values: { intern: true } });
      const nodeId = first.json().node.id as string;
      await mia.json('PATCH', `/api/nodes/${nodeId}`, { name: 'Bericht 2026.txt' });
      await mia.json('PUT', `/api/nodes/${nodeId}/star`, { starred: true });
      await mia.json('POST', '/api/nodes/trash', { ids: [nodeId] });
      await tick(300);
      assert.equal(received.length, 1);
      const report = JSON.parse(received[0].body) as Record<string, unknown>;
      assert.deepEqual(
        { event: report.event, name: report.name, nodeId: report.nodeId, by: report.by, viaLink: report.viaLink },
        { event: 'rename', name: 'Bericht 2026.txt', nodeId, by: 'mia', viaLink: false }
      );
      assert.match(String(report.at), /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(received[0].type, 'application/json');
      assert.equal(received[0].signature, createHmac('sha256', 'pssst').update(received[0].body).digest('hex'));
      assert.equal((await mia.get('/api/ext/datei-webhook/zuletzt')).statusCode, 403);
      const last = (await emi.get('/api/ext/datei-webhook/zuletzt')).json();
      assert.deepEqual({ status: last.status, event: last.event }, { status: 204, event: 'rename' });

      status = 500;
      await mia.upload(miaRoot, 'Noch eine.txt', Buffer.from('x'), 4096);
      await tick(300);
      assert.equal(received.length, 2);
      const failed = ((await emi.get('/api/admin/plugins')).json().items as (Listed & { lastError: { message: string } | null })[]).find(
        (entry) => entry.id === 'datei-webhook'
      );
      assert.equal(failed?.lastError?.message, 'Die Adresse antwortet mit 500');
      assert.equal(failed?.status, 'active');
    } finally {
      await emi.json('POST', '/api/admin/plugins/datei-webhook/disable');
      await new Promise((done) => server.close(done));
    }
  });

  it('Statistik zählt pro Person und bringt eine eigene Seite mit', async () => {
    const plugin = await enable('statistik');
    assert.deepEqual({ routes: plugin.routes, jobs: plugin.jobs, events: plugin.events }, { routes: 1, jobs: 1, events: ['file.*'] });
    const boot = (await mia.get('/api/plugins')).json();
    assert.deepEqual(boot.pages, [
      { plugin: 'statistik', id: 'uebersicht', label: 'Statistik', icon: 'chart', src: '/plugin-pages/statistik/index.html' },
    ]);
    const shell = await mia.get('/files/plugins/statistik/uebersicht', { accept: 'text/html' });
    assert.equal(shell.statusCode, 200);
    assert.match(shell.body, /"pages":\[\{"plugin":"statistik","id":"uebersicht","label":"Statistik"/);
    assert.match((await mia.get('/files', { accept: 'text/html', 'accept-language': 'en' })).body, /"label":"Statistics"/);

    const empty = (await mia.get('/api/ext/statistik/tage')).json().days as { day: string; counts: Record<string, number> }[];
    assert.equal(empty.length, 14);
    assert.equal(empty.at(-1)?.day, new Date().toISOString().slice(0, 10));
    assert.deepEqual(empty.at(-1)?.counts, {});

    const file = await mia.upload(miaRoot, 'Zählen.txt', Buffer.from('eins'), 4096);
    await mia.upload(miaRoot, 'Zählen 2.txt', Buffer.from('zwei'), 4096);
    await mia.json('PATCH', `/api/nodes/${file.json().node.id}`, { name: 'Gezählt.txt' });
    await emi.upload((await emi.get('/api/session')).json().user.rootId, 'Emis Datei.txt', Buffer.from('drei'), 4096);
    await tick(150);
    const mine = (await mia.get('/api/ext/statistik/tage?tage=7')).json().days as { counts: Record<string, number> }[];
    assert.equal(mine.length, 7);
    assert.deepEqual(mine.at(-1)?.counts, { upload: 2, rename: 1 });
    assert.deepEqual(
      ((await emi.get('/api/ext/statistik/tage?tage=500')).json().days as { counts: Record<string, number> }[]).at(-1)?.counts,
      {
        upload: 1,
      }
    );
    assert.equal(((await emi.get('/api/ext/statistik/tage?tage=500')).json().days as unknown[]).length, 90);
    assert.equal((await new Client(app).get('/api/ext/statistik/tage')).statusCode, 401);

    for (const [name, type] of [
      ['index.html', 'text/html'],
      ['app.js', 'text/javascript'],
      ['style.css', 'text/css'],
    ]) {
      const asset = await new Client(app).get(`/plugin-pages/statistik/${name}`);
      assert.equal(asset.statusCode, 200, name);
      assert.match(String(asset.headers['content-type']), new RegExp(`^${type}`));
      assert.match(String(asset.headers['content-security-policy']), /^sandbox allow-scripts/);
    }
    assert.equal((await new Client(app).get('/plugin-pages/statistik/..%2Findex.js')).statusCode, 404);
    assert.equal((await new Client(app).get('/plugin-pages/statistik/plugin.json')).statusCode, 404);
  });

  it('Inhaltsliste schreibt eine Übersicht in den Ordner', async () => {
    await enable('inhaltsliste', { name: 'Übersicht.md' });
    const folder = (await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Reise | 2026' })).json().node.id as string;
    await mia.json('POST', `/api/nodes/${folder}/folders`, { name: 'Fotos' });
    await mia.upload(folder, 'Zug_Tickets.pdf', Buffer.alloc(2048, 1), 4096);
    await mia.upload(folder, 'Adressen.txt', Buffer.from('Lea, Emily'), 4096);
    const actions = (await mia.get('/api/plugins')).json().actions as { plugin: string; id: string; label: string; kinds: string[] }[];
    assert.deepEqual(
      actions.map((action) => [action.plugin, action.id, action.label, action.kinds]),
      [['inhaltsliste', 'schreiben', 'Inhaltsliste schreiben', ['folder']]]
    );
    const run = await mia.json('POST', '/api/plugins/inhaltsliste/actions/schreiben', { ids: [folder] });
    assert.equal(run.statusCode, 200, run.body);
    assert.deepEqual(run.json(), { message: '„Übersicht.md“ liegt im Ordner', open: null, refresh: true });
    const items = (await mia.get(`/api/nodes/${folder}/children`)).json().items as { id: string; name: string }[];
    const overview = items.find((item) => item.name === 'Übersicht.md');
    assert.ok(overview);
    const text = (await mia.get(`/api/nodes/${overview.id}/content`)).body;
    const lines = text.split('\n');
    assert.equal(lines[0], '# Reise | 2026');
    assert.match(lines[2], /^3 Einträge, Stand \d/);
    assert.equal(lines[4], '| Name | Größe | Geändert |');
    assert.match(lines[6], /^\| Fotos\/ \|  \| /);
    assert.match(lines[7], /^\| Adressen\.txt \| 10 B \| /);
    assert.match(lines[8], /^\| Zug\\_Tickets\.pdf \| 2\.0 KB \| /);

    const again = await mia.send({
      method: 'POST',
      url: '/api/plugins/inhaltsliste/actions/schreiben',
      payload: { ids: [folder] },
      headers: { 'accept-language': 'en' },
    });
    assert.equal(again.json().message, '“Übersicht.md” is in the folder');
    const after = (await mia.get(`/api/nodes/${folder}/children`)).json().items as { id: string; name: string }[];
    assert.equal(after.filter((item) => item.name.startsWith('Übersicht')).length, 1);
    assert.match((await mia.get(`/api/nodes/${overview.id}/content`)).body, /^3 entries, as of /m);

    const fileOnly = await mia.json('POST', '/api/plugins/inhaltsliste/actions/schreiben', { ids: [overview.id] });
    assert.equal(fileOnly.statusCode, 400);
    const emiId = (await emi.get('/api/session')).json().user.id as number;
    const shared = await mia.json('POST', `/api/nodes/${folder}/grants`, { userId: emiId, permission: 'view' });
    assert.equal(shared.statusCode, 200, shared.body);
    const denied = await emi.json('POST', '/api/plugins/inhaltsliste/actions/schreiben', { ids: [folder] });
    assert.equal(denied.statusCode, 422, denied.body);
    assert.equal(denied.json().error.code, 'rejected');
    assert.equal((await mia.get(`/api/nodes/${overview.id}/content`)).body.split('\n')[2].startsWith('3 entries'), true);
  });

  it('Briefkasten nimmt Dateien über eine geheime Adresse an', async () => {
    const token = 'ein-langes-geheimnis-2026';
    const plugin = await enable('briefkasten', { token, konto: 'Mia', ordner: 'Eingang von außen' });
    assert.equal(plugin.routes, 2);
    const scanner = new Client(app);
    const put = (path: string, payload: Buffer | string, method = 'PUT') =>
      scanner.send({ method: method as 'PUT', url: `/ext/briefkasten/${path}`, payload, headers: { 'content-type': 'application/pdf' } });
    const before = ((await mia.get('/api/notifications')).json().items as unknown[]).length;
    const first = await put(`${token}/Scan%201.pdf`, Buffer.from('%PDF-1.7 eins'));
    assert.equal(first.statusCode, 201, first.body);
    assert.deepEqual(first.json(), { name: 'Scan 1.pdf', size: 13 });
    assert.match(String(first.headers['content-security-policy']), /sandbox/);
    const second = await put(`${token}/Scan%201.pdf`, Buffer.from('%PDF-1.7 zwei'), 'POST');
    assert.equal(second.json().name, 'Scan 1 (2).pdf');
    const folder = ((await mia.get(`/api/nodes/${miaRoot}/children`)).json().items as { id: string; name: string; type: string }[]).find(
      (item) => item.name === 'Eingang von außen'
    );
    assert.equal(folder?.type, 'folder');
    const inside = (await mia.get(`/api/nodes/${folder?.id}/children`)).json().items as { id: string; name: string }[];
    assert.deepEqual(inside.map((item) => item.name).sort(), ['Scan 1 (2).pdf', 'Scan 1.pdf']);
    assert.equal((await mia.get(`/api/nodes/${inside.find((item) => item.name === 'Scan 1.pdf')?.id}/content`)).body, '%PDF-1.7 eins');
    const notes = (await mia.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[];
    assert.equal(notes.length, before + 2);
    assert.deepEqual(
      { kind: notes[0].kind, title: notes[0].title, text: notes[0].text, url: notes[0].url },
      { kind: 'plugin', title: 'Neue Datei im Briefkasten', text: 'Scan 1 (2).pdf', url: `/files/folder/${folder?.id}` }
    );

    assert.equal((await put('falsches-geheimnis-123456/x.pdf', 'x')).statusCode, 404);
    assert.equal((await put(`${token}x/x.pdf`, 'x')).statusCode, 404);
    assert.equal((await put(`${token}/leer.pdf`, '')).statusCode, 400);
    assert.equal((await put(`${token}/a/b.pdf`, 'x')).statusCode, 404);
    assert.equal((await scanner.get(`/ext/briefkasten/${token}/Scan%201.pdf`)).statusCode, 405);
    assert.equal((await put(`${token}/..%2Fraus.pdf`, 'x')).statusCode, 404);
    await emi.json('PUT', '/api/admin/plugins/briefkasten/settings', { values: { konto: 'niemand' } });
    assert.equal((await put(`${token}/x.pdf`, 'x')).statusCode, 503);
    await emi.json('PUT', '/api/admin/plugins/briefkasten/settings', { values: { konto: 'mia', token: 'zu-kurz' } });
    assert.equal((await put('zu-kurz/x.pdf', 'x')).statusCode, 404);
    assert.equal((await emi.json('POST', '/api/admin/plugins/briefkasten/disable')).statusCode, 200);
    assert.equal((await put(`${token}/x.pdf`, 'x')).statusCode, 404);
  });

  it('Farbpaket bringt Themes ganz ohne Code', async () => {
    const plugin = await enable('farbpaket');
    assert.deepEqual({ status: plugin.status, themes: plugin.themes, routes: plugin.routes }, { status: 'active', themes: 4, routes: 0 });
    const themes = (await emi.get('/api/admin/plugins')).json().themes as { name: string; seed: string; plugin: string; corners: number }[];
    assert.deepEqual(
      themes.filter((theme) => theme.plugin === 'Farbpaket').map((theme) => [theme.name, theme.seed, theme.corners]),
      [
        ['Lavendel', '#9d8df1', 1],
        ['Espresso', '#6f4e37', 0.5],
        ['Neon', '#00e5a0', 0.1],
        ['Schiefer', '#5b7083', 0.5],
      ]
    );
  });
});
