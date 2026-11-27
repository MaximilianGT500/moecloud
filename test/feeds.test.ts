import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let lea: Client;
let server: Server;
let site = '';
let posts = 20;
const conditional: string[] = [];
const AUDIO = Buffer.alloc(64 * 1024, 7);

const rss = () => {
  const items = Array.from({ length: posts }, (_entry, index) => {
    const day = String((index % 27) + 1).padStart(2, '0');
    return `<item><title>Rezept ${index + 1}</title><link>${site}/rezepte/${index + 1}</link><guid>${site}/rezepte/${index + 1}</guid>
<pubDate>${new Date(Date.UTC(2026, 9, Number(day), 12, index)).toUTCString()}</pubDate><dc:creator>Emi</dc:creator>
<description><![CDATA[<p>Heute gibt es ${index === 0 ? 'Matcha-Eis' : `Gericht ${index + 1}`} <img src="/bilder/${index + 1}.jpg"></p>]]></description></item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Emis Küche</title><link>${site}/blog</link><image><url>${site}/logo.png</url></image>${items}</channel></rss>`;
};

const atom = () => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Mias Notizen</title>
  <link href="${site}/mia/"/>
  <entry>
    <id>urn:mia:1</id>
    <title>Gefährlich &lt;script&gt;alert(1)&lt;/script&gt;</title>
    <link href="${site}/mia/eins"/>
    <updated>2026-11-01T10:00:00Z</updated>
    <content type="html">&lt;p onclick="alert(1)"&gt;Hallo &lt;a href="/mia/zwei"&gt;weiter&lt;/a&gt;&lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt;&lt;img src="/mia/bild.png" onerror="alert(3)"&gt;&lt;iframe src="https://evil.example"&gt;&lt;/iframe&gt;</content>
  </entry>
</feed>`;

const podcast = () => `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Leas Podcast</title><link>${site}/podcast</link><itunes:author>Lea</itunes:author>
<item><title>Folge 1: Tee/Kaffee</title><guid isPermaLink="false">lea-1</guid><pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate>
<description>Wir reden über Tee.</description><enclosure url="${site}/folge1.mp3" length="${AUDIO.length}" type="audio/mpeg"/><itunes:duration>00:10:00</itunes:duration></item>
</channel></rss>`;

function page(feeds: [string, string][]) {
  return `<!doctype html><html><head><title>Blog</title>${feeds.map(([href, title]) => `<link rel="alternate" type="application/rss+xml" title="${title}" href="${href}">`).join('')}</head><body></body></html>`;
}

function serve(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url ?? '/', 'http://x').pathname;
  const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
    response.writeHead(status, { 'content-type': type, ...headers });
    response.end(body);
  };
  if (path === '/blog') return send(200, 'text/html; charset=utf-8', page([['/feed.xml', 'Beiträge']]));
  if (path === '/feed.xml') {
    const tag = `"v${posts}"`;
    if (request.headers['if-none-match'] === tag) {
      conditional.push(tag);
      response.writeHead(304, { etag: tag });
      response.end();
      return;
    }
    return send(200, 'application/rss+xml; charset=utf-8', rss(), { etag: tag });
  }
  if (path === '/mia/atom.xml') return send(200, 'application/atom+xml', atom());
  if (path === '/multi')
    return send(
      200,
      'text/html',
      page([
        ['/feed.xml', 'RSS'],
        ['/mia/atom.xml', 'Atom'],
      ])
    );
  if (path === '/mit-kommentaren')
    return send(
      200,
      'text/html',
      page([
        ['/feed.xml', 'Beiträge'],
        ['/comments/feed', 'Kommentare'],
      ])
    );
  if (path === '/podcast.xml') return send(200, 'application/rss+xml', podcast());
  if (path === '/kaputt.xml') return send(200, 'application/xml', '<?xml version="1.0"?><notiz><an>Emi</an></notiz>');
  if (path === '/text') return send(200, 'text/plain', 'Nur Text');
  if (path === '/folge1.mp3') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ''));
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), AUDIO.length - 1) : AUDIO.length - 1;
      return send(206, 'audio/mpeg', AUDIO.subarray(start, end + 1), {
        'content-range': `bytes ${start}-${end}/${AUDIO.length}`,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
      });
    }
    return send(200, 'audio/mpeg', AUDIO, { 'accept-ranges': 'bytes', 'content-length': String(AUDIO.length) });
  }
  return send(404, 'text/plain', 'weg');
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Feeds', () => {
  let blog = '';
  let firstItem = 0;
  let episode = 0;

  it('abonniert über die Webseite und lässt nur die neuesten Beiträge ungelesen', async () => {
    const added = await emi.json('POST', '/api/feeds', { url: `${site}/blog`, folder: 'Kochen' });
    assert.equal(added.statusCode, 200, added.body);
    const { feed, existing } = added.json();
    blog = feed.id;
    assert.equal(existing, false);
    assert.equal(feed.title, 'Emis Küche');
    assert.equal(feed.url, `${site}/feed.xml`);
    assert.equal(feed.folder, 'Kochen');
    assert.equal(feed.kind, 'news');
    assert.equal(feed.unread, 15);
    assert.match(feed.icon, /^\/api\/proxy\/image\?/);
    const again = await emi.json('POST', '/api/feeds', { url: `${site}/feed.xml` });
    assert.equal(again.json().existing, true);
    const list = (await emi.get('/api/feeds')).json();
    assert.equal(list.feeds.length, 1);
    assert.equal(list.feeds[0].total, 20);
  });

  it('listet, blättert und sucht Beiträge', async () => {
    const unread = (await emi.get('/api/feeds/items')).json();
    assert.equal(unread.items.length, 15);
    const times = unread.items.map((item: { publishedAt: number }) => item.publishedAt);
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a)
    );
    assert.equal(unread.items[0].feedTitle, 'Emis Küche');
    assert.match(unread.items[0].image, /^\/api\/proxy\/image\?/);
    const seen = new Set<number>();
    let cursor: string | null = '';
    while (cursor !== null) {
      const result = (await emi.get(`/api/feeds/items?filter=all&limit=8${cursor ? `&before=${cursor}` : ''}`)).json() as {
        items: { id: number }[];
        next: string | null;
      };
      for (const item of result.items) seen.add(item.id);
      cursor = result.next;
    }
    assert.equal(seen.size, 20);
    const found = (await emi.get('/api/feeds/items?filter=all&q=matcha')).json().items;
    assert.equal(found.length, 1);
    assert.equal(found[0].title, 'Rezept 1');
    assert.equal(found[0].summary, 'Heute gibt es Matcha-Eis');
    firstItem = found[0].id;
    assert.equal((await emi.get(`/api/feeds/items?filter=all&folder=Kochen`)).json().items.length, 20);
    assert.equal((await emi.get(`/api/feeds/items?filter=all&folder=Reisen`)).json().items.length, 0);
  });

  it('markiert Gelesenes, merkt Favoriten und zählt im Abzeichen', async () => {
    assert.equal((await emi.get('/api/badges')).json().feeds, 15);
    const unread = (await emi.get('/api/feeds/items')).json().items as { id: number }[];
    const one = await emi.json('POST', '/api/feeds/items/read', { ids: [unread[0].id] });
    assert.equal(one.json().changed, 1);
    assert.equal((await emi.get('/api/badges')).json().feeds, 14);
    assert.equal((await emi.json('POST', '/api/feeds/items/read', { feed: blog })).json().changed, 14);
    assert.equal((await emi.get('/api/badges')).json().feeds, 0);
    assert.equal((await emi.json('POST', '/api/feeds/items/read', { ids: [firstItem], read: false })).json().changed, 1);
    assert.equal((await emi.json('POST', `/api/feeds/items/${firstItem}/star`, { starred: true })).statusCode, 200);
    const starred = (await emi.get('/api/feeds/items?filter=starred')).json().items;
    assert.deepEqual(
      starred.map((item: { id: number }) => item.id),
      [firstItem]
    );
    assert.equal((await emi.get('/api/feeds')).json().starred, 1);
    assert.equal((await emi.json('POST', '/api/feeds/items/read', {})).statusCode, 400);
  });

  it('holt Neues und fragt mit ETag nach', async () => {
    posts = 21;
    const refreshed = await emi.json('POST', '/api/feeds/refresh', { feed: blog });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.deepEqual(refreshed.json(), { done: true, added: 1 });
    const again = await emi.json('POST', '/api/feeds/refresh', { feed: blog });
    assert.deepEqual(again.json(), { done: true, added: 0 });
    assert.deepEqual(conditional, ['"v21"']);
    assert.equal((await emi.get('/api/feeds')).json().feeds[0].unread, 2);
  });

  it('zeigt Beiträge sicher an und holt Bilder über den Server', async () => {
    const added = await emi.json('POST', '/api/feeds', { url: `${site}/mia/atom.xml` });
    assert.equal(added.statusCode, 200, added.body);
    const item = (await emi.get(`/api/feeds/items?feed=${added.json().feed.id}`)).json().items[0];
    assert.equal(item.title, 'Gefährlich <script>alert(1)</script>');
    const body = await emi.get(`/api/feeds/items/${item.id}/body?dark=1&size=l`);
    assert.equal(body.statusCode, 200);
    const csp = body.headers['content-security-policy'] as string;
    assert.match(csp, /^sandbox /);
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
    assert.doesNotMatch(body.body, /<script|onclick|onerror|<iframe/i);
    assert.match(body.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(body.body, new RegExp(`href="${site}/mia/zwei"`));
    assert.match(body.body, /src="http:\/\/localhost(:\d+)?\/api\/proxy\/image\?u=/);
    assert.match(body.body, /color-scheme" content="dark"/);
    assert.match(body.body, /font:20px/);
  });

  it('erkennt Podcasts, spielt über den Server ab und merkt sich die Stelle', async () => {
    const added = await emi.json('POST', '/api/feeds', { url: `${site}/podcast.xml`, folder: 'Hören' });
    assert.equal(added.json().feed.kind, 'podcast');
    const items = (await emi.get('/api/feeds/items?filter=media')).json().items;
    assert.equal(items.length, 1);
    episode = items[0].id;
    assert.deepEqual(items[0].media, { type: 'audio/mpeg', duration: 600, position: 0 });
    assert.equal((await emi.get('/api/feeds')).json().episodes, 1);
    const part = await emi.get(`/api/feeds/items/${episode}/media`, { range: 'bytes=100-199' });
    assert.equal(part.statusCode, 206, part.body);
    assert.equal(part.headers['content-range'], `bytes 100-199/${AUDIO.length}`);
    assert.equal(part.headers['content-type'], 'audio/mpeg');
    assert.equal(part.headers['accept-ranges'], 'bytes');
    assert.equal(part.rawPayload.length, 100);
    const whole = await emi.get(`/api/feeds/items/${episode}/media`);
    assert.equal(whole.statusCode, 200);
    assert.equal(whole.rawPayload.length, AUDIO.length);
    assert.equal((await emi.get(`/api/feeds/items/${firstItem}/media`)).statusCode, 404);
    const saved = await emi.send({
      method: 'PUT',
      url: `/api/feeds/items/${episode}/position`,
      payload: { position: 125.4, duration: 600 },
    });
    assert.deepEqual(saved.json(), { position: 125, done: false });
    assert.equal((await emi.get(`/api/feeds/items/${episode}`)).json().item.media.position, 125);
    const done = await emi.send({ method: 'PUT', url: `/api/feeds/items/${episode}/position`, payload: { position: 595 } });
    assert.deepEqual(done.json(), { position: 0, done: true });
    assert.equal((await emi.get(`/api/feeds/items/${episode}`)).json().item.read, true);
  });

  it('legt Folgen in den Dateien ab', async () => {
    const started = await emi.json('POST', `/api/feeds/items/${episode}/save`);
    assert.deepEqual(started.json(), { started: true });
    const rootId = (await emi.get('/api/session')).json().user.rootId;
    const childrenOf = async (id: string) =>
      ((await emi.get(`/api/nodes/${id}/children`)).json().items ?? []) as { id: string; name: string; size: number }[];
    let file: { name: string; size: number } | undefined;
    for (let tries = 0; tries < 100 && !file; tries++) {
      const podcasts = (await childrenOf(rootId)).find((node) => node.name === 'Podcasts');
      const show = podcasts && (await childrenOf(podcasts.id)).find((node) => node.name === 'Leas Podcast');
      file = show && (await childrenOf(show.id)).find((node) => node.name.endsWith('.mp3'));
      if (!file) await wait(50);
    }
    assert.ok(file, 'die Folge liegt in Podcasts/Leas Podcast');
    assert.equal(file.name, 'Folge 1: Tee Kaffee.mp3');
    assert.equal(file.size, AUDIO.length);
  });

  it('liest und schreibt OPML', async () => {
    const exported = await emi.get('/api/feeds/export');
    assert.equal(exported.statusCode, 200);
    assert.match(exported.body, /<outline text="Kochen" title="Kochen">/);
    assert.match(exported.body, new RegExp(`xmlUrl="${site}/feed.xml"`));
    const opml = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="Reisen"><outline type="rss" text="Kyoto" xmlUrl="${site}/kyoto.xml"/></outline>
      <outline type="rss" text="Doppelt" xmlUrl="${site}/feed.xml"/>
      <outline type="rss" text="Kaputt" xmlUrl="javascript:alert(1)"/>
    </body></opml>`;
    const boundary = '----moeopml';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="feeds.opml"\r\nContent-Type: text/x-opml\r\n\r\n${opml}\r\n--${boundary}--\r\n`
    );
    const imported = await emi.send({
      method: 'POST',
      url: '/api/feeds/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.deepEqual(imported.json(), { added: 1, skipped: 2 });
    let kyoto: { folder: string; error: string | null } | undefined;
    for (let tries = 0; tries < 100 && !kyoto?.error; tries++) {
      kyoto = (await emi.get('/api/feeds')).json().feeds.find((feed: { title: string }) => feed.title === 'Kyoto');
      if (!kyoto?.error) await wait(50);
    }
    assert.equal(kyoto?.folder, 'Reisen');
    assert.equal(kyoto?.error, 'Den Feed gibt es nicht mehr');
  });

  it('erklärt kaputte Feeds und Seiten mit mehreren Feeds', async () => {
    const broken = await emi.json('POST', '/api/feeds', { url: `${site}/kaputt.xml` });
    assert.equal(broken.statusCode, 422);
    assert.equal(broken.json().error.code, 'feed_invalid');
    const text = await emi.json('POST', '/api/feeds', { url: `${site}/text` });
    assert.equal(text.json().error.code, 'feed_invalid');
    const none = await emi.json('POST', '/api/feeds', { url: `${site}/nirgends` });
    assert.equal(none.statusCode, 424);
    const multi = await emi.json('POST', '/api/feeds', { url: `${site}/multi` });
    assert.equal(multi.statusCode, 409);
    assert.deepEqual(
      multi.json().error.feeds.map((feed: { url: string }) => feed.url),
      [`${site}/feed.xml`, `${site}/mia/atom.xml`]
    );
    const comments = await emi.json('POST', '/api/feeds', { url: `${site}/mit-kommentaren` });
    assert.equal(comments.json().existing, true, 'nimmt den Beitragsfeed statt der Kommentare');
    settings.set('feeds.private', false);
    try {
      const local = await emi.json('POST', '/api/feeds', { url: `${site}/blog` });
      assert.equal(local.statusCode, 400);
      assert.equal(local.json().error.code, 'remote_private');
    } finally {
      settings.set('feeds.private', true);
    }
  });

  it('hält Feeds getrennt, benennt Ordner um und löscht', async () => {
    assert.deepEqual((await lea.get('/api/feeds')).json().feeds, []);
    for (const url of [`/api/feeds/items/${firstItem}`, `/api/feeds/items/${firstItem}/body`, `/api/feeds/items/${episode}/media`]) {
      assert.equal((await lea.get(url)).statusCode, 404, url);
    }
    assert.equal((await lea.json('POST', `/api/feeds/items/${firstItem}/star`, { starred: true })).statusCode, 404);
    assert.equal((await lea.json('POST', '/api/feeds/items/read', { ids: [firstItem] })).json().changed, 0);
    assert.equal((await lea.json('DELETE', `/api/feeds/${blog}`)).statusCode, 404);
    assert.equal((await emi.json('POST', '/api/feeds/folders/rename', { from: 'Kochen', to: 'Essen' })).json().changed, 1);
    assert.equal((await emi.json('PATCH', `/api/feeds/${blog}`, { title: 'Emis Rezepte' })).json().feed.title, 'Emis Rezepte');
    assert.equal((await emi.json('DELETE', `/api/feeds/${blog}`)).statusCode, 200);
    assert.equal((await emi.get(`/api/feeds/items/${firstItem}`)).statusCode, 404);
  });

  it('verschwindet, wenn die Verwaltung Feeds abschaltet', async () => {
    settings.set('feeds.enabled', false);
    try {
      assert.equal((await emi.get('/api/feeds')).statusCode, 404);
      assert.equal((await emi.get('/api/badges')).json().feeds, 0);
    } finally {
      settings.set('feeds.enabled', true);
    }
  });
});
