import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, login, setUp, zip } from './helpers.ts';
import { routesOf } from '../src/app.ts';
import { one } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let nora: Client;
let lea: Client;

const x = {
  root: '',
  folder: '',
  sub: '',
  file: '',
  image: '',
  archive: '',
  version: '',
  comment: '',
  note: '',
  album: '',
  playlist: '',
  tag: '',
  search: '',
  link: '',
  grant: '',
  upload: '',
  appPassword: '',
  session: '',
  noraRoot: '',
  noraFolder: '',
  leaId: 0,
  noraId: 0,
  emilyId: 0,
};

interface Case {
  name: string;
  method: string;
  url: () => string;
  body?: () => unknown;
  raw?: () => Buffer;
  owner?: number[] | false;
  quiet?: string;
  type?: string;
  off?: RegExp;
}

const send = (client: Client, method: string, url: string, body?: unknown, raw?: Buffer, type = 'application/octet-stream') =>
  raw
    ? client.send({ method: method as 'PUT', url, headers: { 'content-type': type }, payload: raw })
    : client.send({
        method: method as 'POST',
        url,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
      });

async function folderOf(client: Client, parent: string, name: string): Promise<string> {
  const response = await client.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

async function fileOf(client: Client, parent: string, name: string, content: Buffer | string): Promise<string> {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const response = await client.upload(parent, name, data, 256 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

before(async () => {
  emi = await setUp(app);
  const mail = await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  assert.equal(mail.statusCode, 200, mail.body);
  for (const [username, name, role] of [
    ['mia', 'Mia', 'user'],
    ['nora', 'Nora', 'user'],
    ['lea', 'Lea', 'guest'],
    ['emily', 'Emily', 'user'],
  ]) {
    const made = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}s-passwort-123`, role });
    assert.equal(made.statusCode, 200, made.body);
    if (username === 'lea') x.leaId = made.json().user.id;
    if (username === 'nora') x.noraId = made.json().user.id;
    if (username === 'emily') x.emilyId = made.json().user.id;
  }
  mia = await login(app, 'mia', 'mias-passwort-123');
  nora = await login(app, 'nora', 'noras-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
  x.root = (await mia.get('/api/session')).json().user.rootId;
  x.noraRoot = (await nora.get('/api/session')).json().user.rootId;
  x.noraFolder = await folderOf(nora, x.noraRoot, 'Noras Ordner');
  x.folder = await folderOf(mia, x.root, 'Privat');
  x.sub = await folderOf(mia, x.folder, 'Unterlagen');
  x.file = await fileOf(mia, x.folder, 'geheim.txt', 'Erste Fassung');
  const changed = await send(mia, 'PUT', `/api/nodes/${x.file}/content`, undefined, Buffer.from('Zweite Fassung, streng geheim'));
  assert.equal(changed.statusCode, 200, changed.body);
  x.version = (await mia.get(`/api/nodes/${x.file}/versions`)).json().items[0].id;
  x.image = await fileOf(
    mia,
    x.folder,
    'bild.png',
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366cc' } })
      .png()
      .toBuffer()
  );
  x.archive = await fileOf(mia, x.folder, 'paket.zip', await zip({ 'a.txt': 'A', 'ordner/b.txt': 'B' }));
  x.comment = (await mia.json('POST', `/api/nodes/${x.file}/comments`, { text: 'Nur für mich' })).json().comment.id;
  x.note = (await mia.json('POST', '/api/notes', { title: 'Tagebuch', content: '- [ ] geheim' })).json().note.id;
  x.album = (await mia.json('POST', '/api/albums', { name: 'Urlaub', ids: [x.image] })).json().album.id;
  x.playlist = (await mia.json('POST', '/api/playlists', { name: 'Abends' })).json().playlist.id;
  x.tag = (await mia.json('POST', '/api/tags', { name: 'Steuer', color: 'blue' })).json().tag.id;
  x.search = (await mia.json('POST', '/api/searches', { name: 'Geheimes', query: 'q=geheim' })).json().search.id;
  x.link = (await mia.json('POST', `/api/nodes/${x.sub}/links`, {})).json().link.id;
  const grant = await mia.json('POST', `/api/nodes/${x.sub}/grants`, { userId: x.emilyId, permission: 'view' });
  assert.equal(grant.statusCode, 200, grant.body);
  x.grant = grant.json().grant.id;
  x.upload = (await mia.json('POST', '/api/uploads', { parentId: x.folder, name: 'teil.bin', size: 8 })).json().id;
  const password = await mia.json('POST', '/api/account/app-passwords', { name: 'Laptop' });
  assert.equal(password.statusCode, 200, password.body);
  x.appPassword = password.json().item.id;
  x.session = String(one<{ id: string }>('SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)', 'mia')!.id);
});

after(() => app.close());

const reads: Case[] = [
  { name: 'Datei', method: 'GET', url: () => `/api/nodes/${x.file}` },
  { name: 'Inhalt', method: 'GET', url: () => `/api/nodes/${x.file}/content` },
  { name: 'Metadaten', method: 'GET', url: () => `/api/nodes/${x.file}/meta` },
  { name: 'Aktivität', method: 'GET', url: () => `/api/nodes/${x.file}/activity` },
  { name: 'Versionen', method: 'GET', url: () => `/api/nodes/${x.file}/versions` },
  { name: 'Inhalt einer Version', method: 'GET', url: () => `/api/nodes/${x.file}/versions/${x.version}/content` },
  { name: 'Kommentare', method: 'GET', url: () => `/api/nodes/${x.file}/comments` },
  { name: 'Freigaben', method: 'GET', url: () => `/api/nodes/${x.sub}/shares` },
  { name: 'Ordnerinhalt', method: 'GET', url: () => `/api/nodes/${x.folder}/children` },
  { name: 'Ordnergröße', method: 'GET', url: () => `/api/nodes/${x.folder}/size` },
  { name: 'Vorschaubild', method: 'GET', url: () => `/api/nodes/${x.image}/thumb` },
  { name: 'Vorschau', method: 'GET', url: () => `/api/nodes/${x.image}/preview`, owner: [200, 404] },
  { name: 'Archivinhalt', method: 'GET', url: () => `/api/nodes/${x.archive}/archive` },
  { name: 'Datei aus dem Archiv', method: 'GET', url: () => `/api/nodes/${x.archive}/archive/entry?path=a.txt` },
  { name: 'ZIP des Ordners', method: 'GET', url: () => `/api/zip?ids=${x.folder}` },
  { name: 'Notiz', method: 'GET', url: () => `/api/notes/${x.note}` },
  { name: 'Album', method: 'GET', url: () => `/api/albums/${x.album}` },
  { name: 'Album als ZIP', method: 'GET', url: () => `/api/albums/${x.album}/zip` },
  { name: 'Wiedergabeliste', method: 'GET', url: () => `/api/playlists/${x.playlist}` },
  { name: 'Wiedergabeliste als M3U', method: 'GET', url: () => `/api/playlists/${x.playlist}/m3u` },
  { name: 'Dateien eines Schlagworts', method: 'GET', url: () => `/api/tags/${x.tag}/nodes` },
  { name: 'Aufrufe eines Links', method: 'GET', url: () => `/api/links/${x.link}/events` },
  { name: 'Stand eines Uploads', method: 'GET', url: () => `/api/uploads/${x.upload}` },
];

const writes: Case[] = [
  { name: 'Ordner anlegen', method: 'POST', url: () => `/api/nodes/${x.folder}/folders`, body: () => ({ name: 'Fremd' }) },
  {
    name: 'Textdatei anlegen',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/text`,
    body: () => ({ name: 'fremd.txt', content: 'x' }),
  },
  {
    name: 'Hochladen beginnen',
    method: 'POST',
    url: () => '/api/uploads',
    body: () => ({ parentId: x.folder, name: 'fremd.bin', size: 4 }),
  },
  { name: 'Umbenennen', method: 'PATCH', url: () => `/api/nodes/${x.sub}`, body: () => ({ name: 'Unterlagen neu' }) },
  { name: 'Inhalt überschreiben', method: 'PUT', url: () => `/api/nodes/${x.file}/content`, raw: () => Buffer.from('überschrieben') },
  { name: 'Beschreibung', method: 'PUT', url: () => `/api/nodes/${x.file}/description`, body: () => ({ text: 'fremd' }) },
  { name: 'Favorit', method: 'PUT', url: () => `/api/nodes/${x.file}/star`, body: () => ({ starred: true }) },
  { name: 'Kommentar', method: 'POST', url: () => `/api/nodes/${x.file}/comments`, body: () => ({ text: 'Hallo' }) },
  { name: 'Kommentar löschen', method: 'DELETE', url: () => `/api/nodes/${x.file}/comments/${x.comment}` },
  { name: 'Erinnerung', method: 'PUT', url: () => `/api/nodes/${x.file}/reminder`, body: () => ({ dueAt: Date.now() + 86_400_000 }) },
  { name: 'Erinnerung entfernen', method: 'DELETE', url: () => `/api/nodes/${x.file}/reminder`, quiet: 'removed' },
  { name: 'Sperren', method: 'POST', url: () => `/api/nodes/${x.file}/lock`, body: () => ({ minutes: 5 }) },
  { name: 'Entsperren', method: 'DELETE', url: () => `/api/nodes/${x.file}/lock` },
  { name: 'Farbe', method: 'PUT', url: () => '/api/nodes/color', body: () => ({ ids: [x.sub], color: 'teal' }) },
  { name: 'Symbol', method: 'PUT', url: () => '/api/nodes/icon', body: () => ({ ids: [x.sub], icon: 'lock' }) },
  { name: 'Bild drehen', method: 'POST', url: () => `/api/nodes/${x.image}/rotate`, body: () => ({ degrees: 90 }) },
  { name: 'Version wiederherstellen', method: 'POST', url: () => `/api/nodes/${x.file}/versions/${x.version}/restore` },
  { name: 'Archiv entpacken', method: 'POST', url: () => `/api/nodes/${x.archive}/extract`, body: () => ({}) },
  { name: 'Link anlegen', method: 'POST', url: () => `/api/nodes/${x.file}/links`, body: () => ({}) },
  {
    name: 'Freigabe anlegen',
    method: 'POST',
    url: () => `/api/nodes/${x.file}/grants`,
    body: () => ({ userId: x.noraId, permission: 'edit' }),
    owner: false,
  },
  { name: 'Link ändern', method: 'PATCH', url: () => `/api/links/${x.link}`, body: () => ({ label: 'gekapert' }) },
  { name: 'Freigabe ändern', method: 'PATCH', url: () => `/api/grants/${x.grant}`, body: () => ({ permission: 'edit' }) },
  {
    name: 'Kopieren in den eigenen Ordner',
    method: 'POST',
    url: () => '/api/nodes/copy',
    body: () => ({ ids: [x.file], target: x.noraFolder }),
    owner: false,
  },
  {
    name: 'Verschieben in den eigenen Ordner',
    method: 'POST',
    url: () => '/api/nodes/move',
    body: () => ({ ids: [x.file], target: x.noraFolder }),
    owner: false,
  },
  {
    name: 'Kopieren in den fremden Ordner',
    method: 'POST',
    url: () => '/api/nodes/copy',
    body: () => ({ ids: [x.noraFolder], target: x.folder }),
    owner: false,
  },
  { name: 'Verschieben im fremden Ordner', method: 'POST', url: () => '/api/nodes/move', body: () => ({ ids: [x.file], target: x.sub }) },
  {
    name: 'Mehrere umbenennen',
    method: 'POST',
    url: () => '/api/nodes/rename',
    body: () => ({ items: [{ id: x.image, name: 'foto.png' }] }),
  },
  {
    name: 'Fremdes als ZIP in den eigenen Ordner packen',
    method: 'POST',
    url: () => '/api/nodes/zip',
    body: () => ({ ids: [x.folder], name: 'beute.zip' }),
    owner: false,
  },
  { name: 'Notiz überschreiben', method: 'PUT', url: () => `/api/notes/${x.note}`, body: () => ({ content: 'fremd' }) },
  {
    name: 'Aufgabe abhaken',
    method: 'POST',
    url: () => `/api/notes/${x.note}/tasks`,
    body: () => ({ line: 0, text: 'fremd' }),
    owner: false,
  },
  { name: 'Album umbenennen', method: 'PATCH', url: () => `/api/albums/${x.album}`, body: () => ({ name: 'Fremd' }) },
  { name: 'Album füllen', method: 'POST', url: () => `/api/albums/${x.album}/items`, body: () => ({ ids: [x.image] }) },
  { name: 'Album leeren', method: 'POST', url: () => `/api/albums/${x.album}/remove`, body: () => ({ ids: [x.image] }) },
  { name: 'Liste umbenennen', method: 'PATCH', url: () => `/api/playlists/${x.playlist}`, body: () => ({ name: 'Fremd' }) },
  { name: 'Schlagwort ändern', method: 'PATCH', url: () => `/api/tags/${x.tag}`, body: () => ({ name: 'Fremd' }) },
  { name: 'Suche umbenennen', method: 'PATCH', url: () => `/api/searches/${x.search}`, body: () => ({ name: 'Fremd' }) },
  { name: 'Upload fortsetzen', method: 'PUT', url: () => `/api/uploads/${x.upload}?offset=0`, raw: () => Buffer.from('12345678') },
  { name: 'Upload abschließen', method: 'POST', url: () => `/api/uploads/${x.upload}/complete` },
  { name: 'Wiedergabe zählen', method: 'POST', url: () => '/api/music/played', body: () => ({ id: x.file }), owner: [400] },
  { name: 'Beobachten', method: 'PUT', url: () => `/api/nodes/${x.folder}/watch`, body: () => ({ watching: true }) },
  { name: 'Aufräumregel', method: 'PUT', url: () => `/api/nodes/${x.sub}/cleanup`, body: () => ({ days: 30 }) },
  {
    name: 'Wiedergabestand',
    method: 'PUT',
    url: () => `/api/nodes/${x.file}/position`,
    body: () => ({ seconds: 5, duration: 60 }),
    owner: [200, 400],
  },
  { name: 'Umwandeln', method: 'POST', url: () => `/api/nodes/${x.image}/convert`, body: () => ({ format: 'webp' }), owner: [200, 400] },
  { name: 'Bild bearbeiten', method: 'POST', url: () => `/api/nodes/${x.image}/edit`, body: () => ({ rotate: 90, save: 'copy' }) },
  {
    name: 'Version beschriften',
    method: 'PATCH',
    url: () => `/api/nodes/${x.file}/versions/${x.version}`,
    body: () => ({ label: 'fremd' }),
    owner: false,
  },
  {
    name: 'Von einer Adresse laden',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/import`,
    body: () => ({ url: 'https://example.com/a.txt' }),
    owner: false,
  },
  {
    name: 'Per WebDAV einsammeln',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/import/webdav`,
    body: () => ({ url: 'https://example.com/dav/', username: 'mia', password: 'x' }),
    owner: false,
  },
  {
    name: 'Direkt hochladen',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/upload`,
    raw: () =>
      Buffer.from(
        '--moe\r\nContent-Disposition: form-data; name="file"; filename="fremd.txt"\r\nContent-Type: text/plain\r\n\r\nfremd\r\n--moe--\r\n'
      ),
    type: 'multipart/form-data; boundary=moe',
    owner: false,
  },

  {
    name: 'Office-Datei anlegen',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/office/new`,
    body: () => ({ kind: 'document', name: 'Fremd' }),
    owner: false,
    off: /nicht eingerichtet/,
  },
  {
    name: 'Im Editor öffnen',
    method: 'POST',
    url: () => `/api/nodes/${x.file}/office/edit`,
    body: () => ({}),
    owner: false,
    off: /nicht eingerichtet/,
  },
  {
    name: 'Seiten einer PDF ändern',
    method: 'POST',
    url: () => `/api/nodes/${x.file}/pdf`,
    body: () => ({ pages: [{ page: 1, rotate: 90 }], save: 'copy' }),
    owner: false,
  },
  { name: 'Wiedergabeliste einlesen', method: 'POST', url: () => `/api/nodes/${x.file}/playlist`, owner: false },
  {
    name: 'Aus Vorlage anlegen',
    method: 'POST',
    url: () => `/api/nodes/${x.folder}/from-template`,
    body: () => ({ templateId: x.file, name: 'kopie.txt' }),
    owner: false,
  },
  {
    name: 'Link per E-Mail senden',
    method: 'POST',
    url: () => `/api/links/${x.link}/send`,
    body: () => ({ email: 'nora@example.com' }),
    owner: false,
  },
  { name: 'In den Papierkorb', method: 'POST', url: () => '/api/nodes/trash', body: () => ({ ids: [x.image] }) },
  { name: 'Aus dem Papierkorb holen', method: 'POST', url: () => '/api/nodes/restore', body: () => ({ ids: [x.image] }) },
];

const removals: Case[] = [
  { name: 'Link löschen', method: 'DELETE', url: () => `/api/links/${x.link}` },
  { name: 'Freigabe löschen', method: 'DELETE', url: () => `/api/grants/${x.grant}` },
  { name: 'Album löschen', method: 'DELETE', url: () => `/api/albums/${x.album}` },
  { name: 'Liste löschen', method: 'DELETE', url: () => `/api/playlists/${x.playlist}` },
  { name: 'Schlagwort löschen', method: 'DELETE', url: () => `/api/tags/${x.tag}` },
  { name: 'Suche löschen', method: 'DELETE', url: () => `/api/searches/${x.search}` },
  { name: 'Version löschen', method: 'DELETE', url: () => `/api/nodes/${x.file}/versions/${x.version}` },
  { name: 'Endgültig löschen', method: 'POST', url: () => '/api/nodes/delete', body: () => ({ ids: [x.archive] }), owner: false },
];

async function refused(client: Client, entry: Case, who: string) {
  const response = await send(client, entry.method, entry.url(), entry.body?.(), entry.raw?.(), entry.type);
  if (entry.quiet && response.statusCode === 200) {
    assert.equal(response.json()[entry.quiet], false, `${who}: ${entry.name} hat etwas entfernt`);
    return;
  }
  if (entry.off && response.statusCode === 400 && entry.off.test(response.body)) return;
  assert.ok(
    [403, 404].includes(response.statusCode),
    `${who}: ${entry.name} (${entry.method} ${entry.url()}) antwortet ${response.statusCode}: ${response.body.slice(0, 160)}`
  );
}

async function allowed(entry: Case) {
  if (entry.owner === false) return;
  const response = await send(mia, entry.method, entry.url(), entry.body?.(), entry.raw?.(), entry.type);
  const expected = entry.owner ?? [200, 201, 204];
  assert.ok(
    expected.includes(response.statusCode),
    `Mia selbst: ${entry.name} (${entry.method} ${entry.url()}) antwortet ${response.statusCode}: ${response.body.slice(0, 200)}`
  );
  if (entry.quiet) assert.equal(response.json()[entry.quiet], true, `Mia selbst: ${entry.name} hat nichts gefunden`);
}

describe('Fremde Dateien und fremde Dinge', () => {
  it('zeigt Fremden nichts, der Besitzerin aber alles', async () => {
    for (const entry of reads) {
      await refused(nora, entry, 'Nora');
      await refused(lea, entry, 'Lea als Gast');
      await allowed(entry);
    }
  });

  it('gibt auch der Verwaltung keinen stillen Zugriff auf private Dateien', async () => {
    for (const entry of reads.filter((item) => item.url().startsWith('/api/nodes/') || item.url().startsWith('/api/notes/'))) {
      await refused(emi, entry, 'Emi als Admin');
    }
  });

  it('lässt Fremde nichts ändern, die Besitzerin aber schon', async () => {
    for (const entry of writes) {
      await refused(nora, entry, 'Nora');
      await allowed(entry);
    }
    const content = await mia.get(`/api/nodes/${x.file}/content`);
    assert.doesNotMatch(content.body, /überschrieben von Nora/);
    assert.equal(
      outbox.filter((entry) => JSON.stringify(entry).includes('nora@example.com')).length,
      0,
      'Nora hat einen fremden Link verschickt'
    );
    assert.deepEqual((await nora.get(`/api/nodes/${x.noraFolder}/children`)).json().items, []);
  });

  it('lässt Fremde nichts löschen', async () => {
    x.version = (await mia.get(`/api/nodes/${x.file}/versions`)).json().items[0].id;
    for (const entry of removals) {
      await refused(nora, entry, 'Nora');
      await refused(lea, entry, 'Lea als Gast');
    }
    for (const entry of removals) await allowed(entry);
  });

  it('prüft jede lesende Route mit einer Datei-Kennung, nicht nur die bekannten', async () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const route of routesOf(app)) {
      if (route.method !== 'GET' || !route.url.startsWith('/api/nodes/:id')) continue;
      for (const id of [x.file, x.folder, x.image]) {
        const url = route.url
          .replace(':id', id)
          .replace(':version', x.version || '1')
          .replace(':page', '1')
          .replace(':index', '0')
          .replace(/\*$/, 'x');
        const response = await nora.get(url);
        checked++;
        if (![403, 404].includes(response.statusCode)) wrong.push(`GET ${url} → ${response.statusCode}`);
      }
    }
    assert.deepEqual(wrong, []);
    assert.ok(checked > 60, `nur ${checked} Abrufe geprüft`);
  });

  it('prüft jede schreibende Route mit einer Datei-Kennung, auch mit leerem Körper', async () => {
    const wrong: string[] = [];
    for (const route of routesOf(app)) {
      if (route.method === 'GET' || route.method === 'HEAD' || route.method === 'OPTIONS' || !route.url.startsWith('/api/nodes/:id'))
        continue;
      const url = route.url.replace(':id', x.file).replace(':version', '1').replace(':comment', '1');
      const response = await send(nora, route.method, url, {});
      const harmless = response.statusCode === 200 && response.json().removed === false;
      if (response.statusCode >= 200 && response.statusCode < 300 && !harmless)
        wrong.push(`${route.method} ${url} → ${response.statusCode}`);
      if (response.statusCode >= 500) wrong.push(`${route.method} ${url} → ${response.statusCode}`);
    }
    assert.deepEqual(wrong, []);
  });
});

describe('Fremde Kennungen in eigenen Dingen', () => {
  it('holt über Vorlagen, Alben, Listen, PDFs, Schlagwörter und Regeln nichts Fremdes herein', async () => {
    const tag = (await nora.json('POST', '/api/tags', { name: 'Noras', color: 'red' })).json().tag.id;
    const album = (await nora.json('POST', '/api/albums', { name: 'Noras Album' })).json().album.id;
    const playlist = (await nora.json('POST', '/api/playlists', { name: 'Noras Liste' })).json().playlist.id;
    const target = await folderOf(nora, x.noraRoot, 'Beute');
    const tries: [string, string, unknown][] = [
      ['POST', `/api/nodes/${target}/from-template`, { templateId: x.file, name: 'beute.txt' }],
      ['POST', `/api/nodes/${target}/from-template`, { templateId: x.folder, name: 'beute' }],
      ['POST', '/api/albums', { name: 'Beute', ids: [x.image, x.file] }],
      ['POST', `/api/albums/${album}/items`, { ids: [x.image] }],
      ['PATCH', `/api/albums/${album}`, { coverId: x.image }],
      ['POST', '/api/playlists', { name: 'Beute', ids: [x.file, x.image] }],
      ['POST', `/api/playlists/${playlist}/items`, { ids: [x.file] }],
      ['PATCH', `/api/playlists/${playlist}`, { order: [x.file] }],
      ['PUT', '/api/nodes/tags', { ids: [x.file, x.folder], add: [tag] }],
      ['PUT', '/api/nodes/tags', { ids: [target], add: [x.tag] }],
      ['POST', '/api/pdf/merge', { ids: [x.file, x.image], name: 'beute.pdf' }],
      ['POST', '/api/pdf/images', { ids: [x.image], name: 'beute.pdf' }],
      ['POST', '/api/nodes/zip', { ids: [x.file, x.image], name: 'beute.zip' }],
      ['POST', '/api/storage/duplicates', { keep: [x.file] }],
      ['PUT', '/api/templates', { folderId: x.folder }],
      ['POST', '/api/automations', { name: 'Absaugen', folderId: x.folder, actions: [{ type: 'move', folderId: target }] }],
      ['POST', '/api/automations', { name: 'Ablegen', folderId: target, actions: [{ type: 'move', folderId: x.folder }] }],
      ['POST', '/api/automations', { name: 'Fremdes Schlagwort', folderId: target, actions: [{ type: 'tag', tagId: x.tag }] }],
      ['POST', '/api/nodes/copy', { ids: [x.file], target }],
      ['POST', '/api/nodes/move', { ids: [x.image], target }],
      ['POST', '/api/nodes/restore', { ids: [x.file] }],
      ['POST', '/api/nodes/trash', { ids: [x.file, target] }],
      ['POST', '/api/music/played', { id: x.file }],
    ];
    for (const [method, url, body] of tries) {
      const response = await send(nora, method, url, body);
      assert.ok(response.statusCode < 500, `${method} ${url} → ${response.statusCode}: ${response.body.slice(0, 160)}`);
      assert.doesNotMatch(
        response.body,
        /geheim|bild\.png|Privat|Unterlagen|paket\.zip/,
        `${method} ${url} verrät fremde Namen: ${response.body.slice(0, 200)}`
      );
      if (response.statusCode < 300) {
        for (const id of [x.file, x.image, x.folder])
          assert.ok(!response.body.includes(id), `${method} ${url} nimmt eine fremde Kennung an`);
      }
    }
    assert.deepEqual((await nora.get(`/api/nodes/${target}/children`)).json().items, [], 'In Noras Ordner liegt etwas Neues');
    assert.equal((await nora.get(`/api/albums/${album}`)).json().album.count, 0);
    assert.equal((await nora.get(`/api/playlists/${playlist}`)).json().playlist.count, 0);
    assert.deepEqual((await nora.get(`/api/tags/${tag}/nodes`)).json().items, []);
    assert.equal((await nora.get('/api/automations')).json().items.length, 0);
    assert.equal((await mia.get(`/api/nodes/${x.file}`)).statusCode, 200);
    assert.equal((await mia.get(`/api/nodes/${x.file}`)).json().node.trashedAt, null);
    assert.deepEqual((await mia.get(`/api/nodes/${x.file}`)).json().node.tags, []);
  });

  it('findet in Suche, Fotos, Musik und Listen nur Eigenes und Geteiltes', async () => {
    for (const url of [
      '/api/search?q=geheim',
      '/api/search?q=bild',
      `/api/search?q=geheim&folder=${x.folder}`,
      '/api/search?q=Zweite%20Fassung',
      '/api/photos',
      `/api/photos?folder=${x.folder}`,
      '/api/music',
      '/api/recent',
      '/api/starred',
      '/api/shared',
      '/api/trash',
      '/api/activity',
      '/api/reminders',
      '/api/notes',
      '/api/notes/tasks',
      '/api/albums',
      '/api/playlists',
      '/api/tags',
      '/api/searches',
      '/api/home',
      '/api/storage',
      '/api/storage/report',
      '/api/storage/duplicates',
      '/api/notifications',
    ]) {
      const response = await nora.get(url);
      assert.ok(response.statusCode < 500, `${url} → ${response.statusCode}`);
      assert.doesNotMatch(response.body, /geheim|bild\.png|Tagebuch|Steuer|Abends|Urlaub|paket\.zip/, `${url} zeigt Nora etwas von Mia`);
    }
  });
});

describe('Dinge des eigenen Kontos', () => {
  it('lässt niemanden fremde App-Passwörter, Sitzungen oder Geräte entfernen', async () => {
    for (const url of [
      `/api/account/app-passwords/${x.appPassword}`,
      `/api/account/sessions/${x.session}`,
      '/api/account/passkeys/1',
      '/api/account/webpush/1',
    ]) {
      const response = await nora.json('DELETE', url);
      assert.ok(response.statusCode < 500, `${url} → ${response.statusCode}`);
      if (response.statusCode === 200) assert.notEqual(response.json().ok, true, `${url} meldet Erfolg`);
    }
    assert.ok(one('SELECT id FROM sessions WHERE id = ?', x.session), 'Mias Sitzung wurde entfernt');
    assert.equal((await mia.get('/api/session')).statusCode, 200);
    assert.equal(one<{ count: number }>('SELECT COUNT(*) AS count FROM app_passwords')!.count, 1);
  });

  it('nimmt beim Ändern des Kontos keine Rechte oder fremden Felder an', async () => {
    const before = one<{ role: string; quota_bytes: number | null; pending: number }>(
      'SELECT role, quota_bytes, pending FROM users WHERE username = ?',
      'nora'
    )!;
    const tried = await nora.json('PATCH', '/api/account', {
      name: 'Nora',
      role: 'admin',
      quota: 999_999_999_999,
      quota_bytes: 999_999_999_999,
      pending: 0,
      id: 1,
      username: 'emi',
      disabled: false,
    });
    assert.ok([200, 400].includes(tried.statusCode), tried.body);
    const after = one<{ role: string; quota_bytes: number | null; pending: number; username: string }>(
      'SELECT role, quota_bytes, pending, username FROM users WHERE id = ?',
      x.noraId
    )!;
    assert.deepEqual(
      [after.role, after.quota_bytes, after.pending, after.username],
      [before.role, before.quota_bytes, before.pending, 'nora']
    );
    const prefs = await nora.json('PATCH', '/api/account/prefs', {
      __proto__: { admin: true },
      constructor: { prototype: { admin: true } },
      role: 'admin',
    });
    assert.ok([200, 400].includes(prefs.statusCode), prefs.body);
    assert.equal(({} as Record<string, unknown>).admin, undefined);
    assert.equal((await nora.get('/api/admin/users')).statusCode, 403);
  });

  it('zeigt bei der Personensuche nur, was zum Teilen nötig ist', async () => {
    const found = await nora.get('/api/users/search?q=mi');
    assert.equal(found.statusCode, 200);
    for (const entry of found.json().items as Record<string, unknown>[]) {
      for (const field of Object.keys(entry)) {
        assert.ok(['id', 'name', 'username', 'initials', 'avatar', 'guest'].includes(field), `Feld „${field}“ in der Personensuche`);
      }
    }
    assert.doesNotMatch(found.body, /password|hash|totp|@example\.com/);
  });

  it('verrät über die Personensuche keine E-Mail-Adressen Stück für Stück', async () => {
    const names = async (query: string) =>
      ((await nora.get(`/api/users/search?q=${encodeURIComponent(query)}`)).json().items as { username: string }[]).map(
        (entry) => entry.username
      );
    for (const part of ['example', '@example.com', 'emi@', 'i@exam', 'emi@example.co']) {
      assert.ok(!(await names(part)).includes('emi'), `„${part}“ findet Emi über die Adresse`);
    }
    assert.deepEqual(await names('@example'), []);
    assert.deepEqual(await names('emi@example.com'), ['emi']);
    assert.deepEqual(await names('EMI@Example.com'), ['emi']);
    assert.deepEqual(await names('%'), []);
    assert.deepEqual(await names('_'), []);
  });

  it('gibt Gästen kein Personenverzeichnis, weil sie nichts teilen können', async () => {
    const response = await lea.get('/api/users/search?q=mi');
    assert.equal(response.statusCode, 403);
    assert.doesNotMatch(response.body, /"username"/);
    await emi.json('PATCH', '/api/admin/settings', { 'users.directory': false });
    const partial = await nora.get('/api/users/search?q=mi');
    assert.deepEqual(partial.json().items, []);
    const exact = await nora.get('/api/users/search?q=mia');
    assert.deepEqual(
      (exact.json().items as { username: string }[]).map((entry) => entry.username),
      ['mia']
    );
    assert.deepEqual((await nora.get('/api/users/search?q=emi%40example.com')).json().items, []);
    await emi.json('PATCH', '/api/admin/settings', { 'users.directory': true });
  });
});

describe('Freigabe nur zum Ansehen', () => {
  let shared = '';
  let inside = '';

  before(async () => {
    shared = await folderOf(mia, x.root, 'Zum Ansehen');
    inside = await fileOf(mia, shared, 'lesen.txt', 'Nur lesen');
    const grant = await mia.json('POST', `/api/nodes/${shared}/grants`, { userId: x.noraId, permission: 'view' });
    assert.equal(grant.statusCode, 200, grant.body);
  });

  it('lässt lesen, aber nichts ändern, und reicht nicht über den Ordner hinaus', async () => {
    assert.equal((await nora.get(`/api/nodes/${shared}/children`)).statusCode, 200);
    assert.equal((await nora.get(`/api/nodes/${inside}/content`)).body, 'Nur lesen');
    const denied: [string, string, unknown?, Buffer?][] = [
      ['POST', `/api/nodes/${shared}/folders`, { name: 'Neu' }],
      ['POST', `/api/nodes/${shared}/text`, { name: 'neu.txt', content: 'x' }],
      ['POST', '/api/uploads', { parentId: shared, name: 'neu.bin', size: 1 }],
      ['PATCH', `/api/nodes/${inside}`, { name: 'anders.txt' }],
      ['PUT', `/api/nodes/${inside}/content`, undefined, Buffer.from('geändert')],
      ['PUT', `/api/nodes/${inside}/description`, { text: 'x' }],
      ['POST', '/api/nodes/trash', { ids: [inside] }],
      ['POST', '/api/nodes/delete', { ids: [inside] }],
      ['POST', '/api/nodes/move', { ids: [inside], target: x.noraFolder }],
      ['POST', '/api/nodes/move', { ids: [x.noraFolder], target: shared }],
      ['POST', '/api/nodes/copy', { ids: [x.noraFolder], target: shared }],
      ['POST', `/api/nodes/${inside}/links`, {}],
      ['POST', `/api/nodes/${inside}/grants`, { userId: x.leaId, permission: 'view' }],
      ['PUT', '/api/nodes/color', { ids: [shared], color: 'red' }],
      ['PUT', '/api/nodes/icon', { ids: [shared], icon: 'star' }],
      ['POST', `/api/nodes/${inside}/lock`, { minutes: 5 }],
    ];
    for (const [method, url, body, raw] of denied) {
      const response = await send(nora, method, url, body, raw);
      assert.ok([403, 404].includes(response.statusCode), `${method} ${url} → ${response.statusCode}: ${response.body.slice(0, 120)}`);
    }
    assert.equal((await mia.get(`/api/nodes/${inside}/content`)).body, 'Nur lesen');
    assert.ok([403, 404].includes((await nora.get(`/api/nodes/${x.root}/children`)).statusCode));
    assert.ok([403, 404].includes((await nora.get(`/api/nodes/${x.folder}/children`)).statusCode));
    const copied = await send(nora, 'POST', '/api/nodes/copy', { ids: [inside], target: x.noraFolder });
    assert.equal(copied.statusCode, 200, 'Kopieren aus einer Nur-Lesen-Freigabe in den eigenen Bereich ist erlaubt');
  });

  it('endet, sobald die Freigabe weg ist', async () => {
    const shares = (await mia.get(`/api/nodes/${shared}/shares`)).json();
    const grant = (shares.grants as { id: string; user?: { id: number } }[]).find((entry) => entry.user?.id === x.noraId)!;
    assert.equal((await mia.json('DELETE', `/api/grants/${grant.id}`)).statusCode, 200);
    assert.ok([403, 404].includes((await nora.get(`/api/nodes/${inside}/content`)).statusCode));
    assert.ok([403, 404].includes((await nora.get(`/api/nodes/${shared}/children`)).statusCode));
  });
});
