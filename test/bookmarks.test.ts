import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let lea: Client;
let server: Server;
let site = '';

const ARTICLE = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Ramen &amp; Gyoza – Rezept</title>
<meta property="og:title" content="Die beste Ramen-Brühe">
<meta name="description" content="Wie Emi ihre Brühe in drei Stunden kocht.">
<meta property="og:image" content="/bilder/ramen.jpg">
<link rel="icon" href="/icon.png" sizes="32x32">
<link rel="apple-touch-icon" href="/touch.png">
<link rel="alternate" type="application/rss+xml" title="Rezepte" href="/feed.xml">
</head><body><h1>Ramen</h1></body></html>`;

function serve(request: { url?: string }, response: import('node:http').ServerResponse) {
  const path = new URL(request.url ?? '/', 'http://x').pathname;
  if (path === '/artikel' || path === '/zweiter') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(path === '/artikel' ? ARTICLE : ARTICLE.replace('Die beste Ramen-Brühe', 'Gyoza falten'));
    return;
  }
  if (path === '/plan.pdf') {
    response.writeHead(200, { 'content-type': 'application/pdf' });
    response.end('%PDF-1.4');
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('weg');
}

before(async () => {
  server = createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  settings.set('feeds.private', true);
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'lea-passwort-123' });
  assert.equal(made.statusCode, 200, made.body);
  lea = await login(app, 'lea', 'lea-passwort-123');
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function multipart(name: string, content: string, type = 'text/html') {
  const boundary = `----moe${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload };
}

describe('Lesezeichen', () => {
  let first = '';

  it('liest Titel, Beschreibung, Symbol und Vorschaubild von der Seite und entfernt Tracking', async () => {
    const created = await emi.json('POST', '/api/bookmarks', {
      url: `${site}/artikel?utm_source=newsletter&seite=2&fbclid=abc`,
      tags: ['Kochen', 'kochen', 'Rezepte'],
    });
    assert.equal(created.statusCode, 200, created.body);
    const { bookmark, existing } = created.json();
    first = bookmark.id;
    assert.equal(existing, false);
    assert.equal(bookmark.url, `${site}/artikel?seite=2`);
    assert.equal(bookmark.title, 'Die beste Ramen-Brühe');
    assert.equal(bookmark.description, 'Wie Emi ihre Brühe in drei Stunden kocht.');
    assert.deepEqual(bookmark.tags, ['Kochen', 'Rezepte']);
    assert.match(bookmark.icon, /^\/api\/proxy\/image\?u=/);
    assert.match(bookmark.image, /^\/api\/proxy\/image\?u=/);
    assert.equal(bookmark.status, 200);
    const icon = Buffer.from(new URL(bookmark.icon, site).searchParams.get('u')!, 'base64url').toString();
    assert.equal(icon, `${site}/touch.png`, 'das größte Symbol gewinnt');
    const again = await emi.json('POST', '/api/bookmarks', {
      url: `${site.replace('127.0.0.1', '127.0.0.1')}/artikel/?seite=2&utm_medium=mail`,
    });
    assert.equal(again.json().existing, true);
    assert.equal(again.json().bookmark.id, first);
  });

  it('speichert auch ohne lesbare Seite und nimmt den Dateinamen', async () => {
    const pdf = await emi.json('POST', '/api/bookmarks', { url: `${site}/plan.pdf`, later: true });
    assert.equal(pdf.json().bookmark.title, 'plan.pdf');
    assert.equal(pdf.json().bookmark.later, true);
    const gone = await emi.json('POST', '/api/bookmarks', { url: `${site}/verschwunden`, title: 'Alte Seite' });
    assert.equal(gone.json().bookmark.title, 'Alte Seite');
    assert.equal(gone.json().bookmark.dead, true);
    const bad = await emi.json('POST', '/api/bookmarks', { url: 'javascript:alert(1)' });
    assert.equal(bad.statusCode, 400);
    const ftp = await emi.json('POST', '/api/bookmarks', { url: 'ftp://example.com/datei' });
    assert.equal(ftp.statusCode, 400);
  });

  it('holt im lokalen Netz nichts ab, wenn das ausgeschaltet ist', async () => {
    settings.set('feeds.private', false);
    try {
      const created = await emi.json('POST', '/api/bookmarks', { url: `${site}/zweiter` });
      assert.equal(created.statusCode, 200, created.body);
      assert.equal(created.json().bookmark.title, '127.0.0.1');
      assert.equal(created.json().bookmark.status, null);
      const preview = await emi.json('POST', '/api/bookmarks/preview', { url: `${site}/zweiter` });
      assert.equal(preview.statusCode, 400);
      assert.equal(preview.json().error.code, 'remote_private');
    } finally {
      settings.set('feeds.private', true);
    }
    const preview = await emi.json('POST', '/api/bookmarks/preview', { url: `${site}/artikel` });
    assert.equal(preview.json().title, 'Die beste Ramen-Brühe');
    assert.equal(preview.json().feeds[0].url, `${site}/feed.xml`);
  });

  it('sucht, filtert, sortiert und zählt', async () => {
    const all = (await emi.get('/api/bookmarks')).json();
    assert.equal(all.total, 4);
    assert.deepEqual(all.counts, { total: 4, later: 1, dead: 1, untagged: 3 });
    assert.equal((await emi.get('/api/bookmarks?q=brühe')).json().items[0].id, first);
    assert.equal((await emi.get('/api/bookmarks?q=RAMEN')).json().total, 1);
    assert.equal((await emi.get('/api/bookmarks?tag=kochen')).json().total, 1);
    assert.equal((await emi.get('/api/bookmarks?filter=later')).json().items[0].title, 'plan.pdf');
    assert.equal((await emi.get('/api/bookmarks?filter=dead')).json().items[0].title, 'Alte Seite');
    const names = (await emi.get('/api/bookmarks?sort=name')).json().items.map((item: { title: string }) => item.title);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    );
    const tags = (await emi.get('/api/bookmarks/tags')).json().tags;
    assert.deepEqual(tags, [
      { tag: 'Kochen', count: 1 },
      { tag: 'Rezepte', count: 1 },
    ]);
    const page = (await emi.get('/api/bookmarks?limit=2')).json();
    assert.equal(page.items.length, 2);
    assert.equal(page.more, true);
  });

  it('ändert, verschlagwortet, benennt Schlagwörter um und zählt Besuche', async () => {
    const changed = await emi.json('PATCH', `/api/bookmarks/${first}`, { title: 'Ramen-Brühe', tags: ['Kochen', 'Japan'], later: true });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(changed.json().bookmark.tags, ['Kochen', 'Japan']);
    const ids = (await emi.get('/api/bookmarks')).json().items.map((item: { id: string }) => item.id);
    assert.equal((await emi.json('POST', '/api/bookmarks/tag', { ids, add: ['Sammlung'], remove: ['japan'] })).statusCode, 200);
    const renamed = await emi.json('POST', '/api/bookmarks/tags/rename', { from: 'sammlung', to: 'Archiv' });
    assert.equal(renamed.json().changed, 4);
    const after = (await emi.get(`/api/bookmarks?tag=Archiv`)).json();
    assert.equal(after.total, 4);
    assert.ok(after.items.every((item: { tags: string[] }) => !item.tags.includes('Japan')));
    for (let index = 0; index < 3; index++) await emi.json('POST', `/api/bookmarks/${first}/visit`);
    const top = (await emi.get('/api/bookmarks?sort=visits')).json().items[0];
    assert.equal(top.id, first);
    assert.equal(top.visits, 3);
    const clash = await emi.json('PATCH', `/api/bookmarks/${first}`, { url: `${site}/plan.pdf` });
    assert.equal(clash.statusCode, 409);
  });

  it('importiert und exportiert Lesezeichen im Browserformat', async () => {
    const file = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Lesezeichenleiste</H3>
  <DL><p>
    <DT><A HREF="https://mia.example/" ADD_DATE="1700000000">Mias Seite</A>
    <DT><H3>Reisen</H3>
    <DL><p>
      <DT><A HREF="https://kyoto.example/tempel" ADD_DATE="1700000100" TAGS="japan,tempel" TOREAD="1">Tempel in Kyoto</A>
      <DD>Die schönsten Tempel &amp; Gärten
    </DL><p>
    <DT><A HREF="javascript:void(0)">Bookmarklet</A>
    <DT><A HREF="${site}/artikel?seite=2">Schon da</A>
  </DL><p>
</DL><p>`;
    const imported = await emi.send({ method: 'POST', url: '/api/bookmarks/import', ...multipart('bookmarks.html', file) });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.deepEqual(imported.json(), { added: 2, skipped: 1 });
    const kyoto = (await emi.get('/api/bookmarks?q=kyoto')).json().items[0];
    assert.deepEqual(kyoto.tags, ['japan', 'tempel', 'Reisen']);
    assert.equal(kyoto.description, 'Die schönsten Tempel & Gärten');
    assert.equal(kyoto.later, true);
    assert.equal(kyoto.createdAt, 1700000100 * 1000);
    const mia = (await emi.get('/api/bookmarks?q=mias')).json().items[0];
    assert.deepEqual(mia.tags, [], 'Standardordner werden nicht zu Schlagwörtern');
    const exported = await emi.get('/api/bookmarks/export');
    assert.equal(exported.statusCode, 200);
    assert.match(exported.headers['content-disposition'] as string, /attachment/);
    assert.match(exported.body, /<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.match(exported.body, /HREF="https:\/\/kyoto\.example\/tempel"[^>]*TAGS="japan,tempel,Reisen"/);
    assert.match(exported.body, /<DD>Die schönsten Tempel &amp; Gärten/);
    const again = await emi.send({ method: 'POST', url: '/api/bookmarks/import', ...multipart('bookmarks.html', exported.body) });
    assert.equal(again.json().added, 0);
    const empty = await emi.send({ method: 'POST', url: '/api/bookmarks/import', ...multipart('leer.html', '<html></html>') });
    assert.equal(empty.statusCode, 400);
  });

  it('prüft Links im Hintergrund und findet tote', async () => {
    const started = await emi.json('POST', '/api/bookmarks/check');
    assert.equal(started.statusCode, 200, started.body);
    assert.equal(started.json().started, true);
    for (let tries = 0; tries < 100 && (await emi.get('/api/bookmarks')).json().checking; tries++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const dead = (await emi.get('/api/bookmarks?filter=dead'))
      .json()
      .items.map((item: { title: string }) => item.title)
      .sort();
    assert.deepEqual(dead, ['Alte Seite', 'Mias Seite', 'Tempel in Kyoto']);
    const refreshed = await emi.json('POST', `/api/bookmarks/${first}/refresh`);
    assert.equal(refreshed.json().bookmark.title, 'Ramen-Brühe', 'eigener Titel bleibt');
  });

  it('hält Lesezeichen getrennt und löscht sie', async () => {
    assert.equal((await lea.get('/api/bookmarks')).json().total, 0);
    assert.equal((await lea.json('PATCH', `/api/bookmarks/${first}`, { title: 'Meins' })).statusCode, 404);
    assert.equal((await lea.json('DELETE', `/api/bookmarks/${first}`)).json().removed, 0);
    assert.equal((await lea.json('POST', `/api/bookmarks/${first}/visit`)).statusCode, 404);
    const removed = await emi.json('POST', '/api/bookmarks/remove', { ids: [first] });
    assert.equal(removed.json().removed, 1);
    assert.equal((await emi.json('DELETE', `/api/bookmarks/${first}`)).json().removed, 0);
  });

  it('verschwindet, wenn die Verwaltung Lesezeichen abschaltet', async () => {
    settings.set('bookmarks.enabled', false);
    try {
      assert.equal((await emi.get('/api/bookmarks')).statusCode, 404);
      assert.equal((await emi.get('/bookmarks')).statusCode, 302);
    } finally {
      settings.set('bookmarks.enabled', true);
    }
    assert.equal((await emi.get('/bookmarks')).statusCode, 200);
  });
});
