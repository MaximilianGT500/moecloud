import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, login, setUp, zip } from './helpers.ts';
import { routesOf } from '../src/app.ts';
import { one, run } from '../src/lib/db.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let nora: Client;
let noraId = 0;
let address = 0;

const x = { root: '', shared: '', inner: '', file: '', image: '', archive: '', deep: '', secret: '', sibling: '', drop: '' };

const guest = () => new Client(app);

async function visitor(token: string) {
  const client = new Client(app);
  await client.get(`/s/${token}`, { accept: 'text/html' });
  assert.ok(client.cookies.get('moe_csrf'), 'die Seite setzt das Formular-Kennzeichen');
  return client;
}

async function drop(client: Client, token: string, parentId: string, name: string, content: string, extra: Record<string, unknown> = {}) {
  const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId, name, size: Buffer.byteLength(content), ...extra });
  if (init.statusCode !== 200) return init;
  const part = await client.send({
    method: 'PUT',
    url: `/api/public/${token}/uploads/${init.json().id}?offset=0`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(content),
  });
  if (part.statusCode !== 200) return part;
  return client.json('POST', `/api/public/${token}/uploads/${init.json().id}/complete`);
}
const from = () => `127.0.6.${(address++ % 250) + 1}`;

async function folder(client: Client, parent: string, name: string): Promise<string> {
  const response = await client.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

async function file(client: Client, parent: string, name: string, content: Buffer | string): Promise<string> {
  const response = await client.upload(parent, name, Buffer.isBuffer(content) ? content : Buffer.from(content), 1 << 20);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

async function link(client: Client, node: string, body: Record<string, unknown> = {}) {
  const response = await client.json('POST', `/api/nodes/${node}/links`, body);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().link as { id: string; token: string; blocked: string | null };
}

async function unlock(client: Client, token: string, password: string, remoteAddress = from()) {
  await client.send({ method: 'GET', url: `/s/${token}`, headers: { accept: 'text/html' }, remoteAddress });
  return client.send({
    method: 'POST',
    url: `/s/${token}`,
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ _csrf: client.cookies.get('moe_csrf')!, password }).toString(),
  });
}

const publicReads = () =>
  routesOf(app)
    .filter((route) => route.method === 'GET' && route.url.startsWith('/api/public/:token/nodes/:id'))
    .map((route) => route.url);

const fill = (url: string, token: string, id: string) =>
  url.replace(':token', token).replace(':id', id).replace(':index', '0').replace(/\*$/, 'x');

before(async () => {
  emi = await setUp(app);
  for (const [username, name] of [
    ['mia', 'Mia'],
    ['nora', 'Nora'],
  ]) {
    const made = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}s-passwort-123` });
    assert.equal(made.statusCode, 200, made.body);
    if (username === 'nora') noraId = made.json().user.id;
  }
  mia = await login(app, 'mia', 'mias-passwort-123');
  nora = await login(app, 'nora', 'noras-passwort-123');
  x.root = (await mia.get('/api/session')).json().user.rootId;
  x.shared = await folder(mia, x.root, 'Geteilt');
  x.inner = await folder(mia, x.shared, 'Innen');
  x.file = await file(mia, x.shared, 'offen.txt', 'Für alle sichtbar');
  x.deep = await file(mia, x.inner, 'tief.txt', 'Auch sichtbar');
  x.image = await file(
    mia,
    x.shared,
    'bild.png',
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc6633' } })
      .png()
      .toBuffer()
  );
  x.archive = await file(mia, x.shared, 'paket.zip', await zip({ 'a.txt': 'A' }));
  x.sibling = await folder(mia, x.root, 'Daneben');
  x.secret = await file(mia, x.sibling, 'geheim.txt', 'Niemals öffentlich');
  x.drop = await folder(mia, x.root, 'Briefkasten');
  await file(mia, x.drop, 'vorhanden.txt', 'Schon da');
});

after(() => app.close());

describe('Öffentliche Links', () => {
  it('reichen genau so weit wie der geteilte Ordner', async () => {
    const { token } = await link(mia, x.shared);
    const client = guest();
    assert.equal((await client.get(`/api/public/${token}`)).statusCode, 200);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.shared}/children`)).statusCode, 200);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.deep}/content`)).body, 'Auch sichtbar');
    const routes = publicReads();
    assert.ok(routes.length >= 12, `nur ${routes.length} öffentliche Leserouten`);
    const wrong: string[] = [];
    for (const route of routes) {
      for (const id of [x.secret, x.sibling, x.root, x.drop, 'abcdefghijkl']) {
        const response = await client.get(fill(route, token, id));
        if (response.statusCode !== 404) wrong.push(`${fill(route, token, id)} → ${response.statusCode}`);
        if (/geheim|Niemals|Daneben|Briefkasten/.test(response.body)) wrong.push(`${fill(route, token, id)} verrät Namen`);
      }
    }
    assert.deepEqual(wrong, []);
    for (const ids of [x.secret, `${x.file},${x.secret}`, x.root, x.sibling]) {
      assert.equal((await client.get(`/api/public/${token}/zip?ids=${ids}`)).statusCode, 404, ids);
    }
    const crumbs = (await client.get(`/api/public/${token}/nodes/${x.inner}/children`)).json().breadcrumbs as { name: string }[];
    assert.deepEqual(
      crumbs.map((entry) => entry.name),
      ['Geteilt', 'Innen'],
      'der Pfad beginnt beim geteilten Ordner, nicht bei Mias Hauptordner'
    );
    const info = JSON.stringify((await client.get(`/api/public/${token}`)).json());
    assert.doesNotMatch(info, /username|email|rootId|ownerId|owner_id|sha256/);
  });

  it('auf eine einzelne Datei zeigen nichts daneben', async () => {
    const { token } = await link(mia, x.file);
    const client = guest();
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/content`)).body, 'Für alle sichtbar');
    for (const id of [x.image, x.deep, x.shared, x.inner, x.secret]) {
      for (const route of publicReads()) {
        const response = await client.get(fill(route, token, id));
        assert.ok([400, 404].includes(response.statusCode), `${fill(route, token, id)} → ${response.statusCode}`);
        assert.doesNotMatch(response.body, /bild\.png|tief\.txt|geheim/);
      }
    }
    const init = await (
      await visitor(token)
    ).json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'rein.txt', size: 1 });
    assert.equal(init.statusCode, 404, `Hochladen über einen Datei-Link → ${init.statusCode}`);
    const own = await (await visitor(token)).json('POST', `/api/public/${token}/uploads`, { parentId: x.file, name: 'rein.txt', size: 1 });
    assert.equal(own.statusCode, 400, 'eine Datei ist kein Ordner');
  });

  it('mit Passwort geben ohne das Passwort nichts preis, auf keiner Route', async () => {
    const { token, id } = await link(mia, x.shared, { password: 'streng-geheim-1' });
    const client = guest();
    const page = await client.get(`/s/${token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.doesNotMatch(page.body, /Geteilt|offen\.txt|bild\.png|Mia/, 'die Passwortseite nennt weder Namen noch Inhalt');
    assert.doesNotMatch(page.body, /og:title|og:image/);
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    const wrong: string[] = [];
    const routes = routesOf(app).filter((route) => route.url.startsWith('/api/public/:token'));
    assert.ok(routes.length >= 18);
    for (const route of routes) {
      const url = fill(route.url, token, x.file).replace(':upload', 'abcdefghijklmnopqrstuvwx');
      const response = await client.send({
        method: route.method as 'GET',
        url,
        ...(route.method === 'GET'
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              payload: JSON.stringify({ parentId: x.shared, name: 'a.txt', size: 1, reason: 'other' }),
            }),
      });
      if (response.statusCode !== 401) wrong.push(`${route.method} ${url} → ${response.statusCode}`);
      if (/offen|Geteilt|bild/.test(response.body)) wrong.push(`${route.method} ${url} verrät Namen`);
    }
    assert.equal((await client.get(`/s/${token}/thumb`)).statusCode, 401);
    assert.deepEqual(wrong, []);

    const miss = await unlock(client, token, 'falsch');
    assert.equal(miss.statusCode, 403);
    assert.equal(client.cookies.get(`moe_l_${id}`), undefined);
    const hit = await unlock(client, token, 'streng-geheim-1');
    assert.equal(hit.statusCode, 303);
    const cookie = [hit.headers['set-cookie']].flat().find((entry) => String(entry).startsWith(`moe_l_${id}=`));
    assert.match(String(cookie), /HttpOnly/i);
    assert.match(String(cookie), /SameSite=Lax/i);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/content`)).statusCode, 200);

    const other = await link(mia, x.inner, { password: 'anderes-passwort-2' });
    const forged = guest();
    forged.cookies.set(`moe_l_${other.id}`, client.cookies.get(`moe_l_${id}`)!);
    assert.equal((await forged.get(`/api/public/${other.token}`)).statusCode, 401, 'ein Schlüssel passt nur zu seinem Link');

    assert.equal((await mia.json('PATCH', `/api/links/${id}`, { password: 'neues-passwort-3' })).statusCode, 200);
    assert.equal(
      (await client.get(`/api/public/${token}`)).statusCode,
      401,
      'nach einem neuen Passwort gilt der alte Schlüssel nicht mehr'
    );
    assert.equal(
      one('SELECT 1 AS found FROM links WHERE password_hash = ?', 'neues-passwort-3'),
      undefined,
      'Passwörter liegen nur als Hash vor'
    );
  });

  it('lassen das Passwort nicht erraten', async () => {
    const { token } = await link(mia, x.shared, { password: 'nicht-zu-erraten-9' });
    const client = guest();
    const address = '127.0.7.7';
    let status = 0;
    for (let attempt = 0; attempt < 24; attempt++) status = (await unlock(client, token, `versuch-${attempt}`, address)).statusCode;
    assert.equal(status, 429);
    assert.equal((await unlock(client, token, 'nicht-zu-erraten-9', address)).statusCode, 429);
    assert.equal(
      (await unlock(guest(), token, 'nicht-zu-erraten-9', '127.0.7.8')).statusCode,
      303,
      'andere Besucher bleiben nicht ausgesperrt'
    );
  });

  it('gelten nicht mehr, wenn sie abgelaufen, pausiert, aufgebraucht, verschoben oder gelöscht sind', async () => {
    const check = async (token: string, label: string) => {
      const client = guest();
      await client.get('/login', { accept: 'text/html' });
      assert.equal((await client.get(`/s/${token}`, { accept: 'text/html' })).statusCode, 404, `${label}: Seite`);
      assert.equal((await client.get(`/api/public/${token}`)).statusCode, 404, `${label}: API`);
      assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/content`)).statusCode, 404, `${label}: Inhalt`);
      assert.equal((await client.get(`/api/public/${token}/zip`)).statusCode, 404, `${label}: ZIP`);
      const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'a.txt', size: 1 });
      assert.equal(init.statusCode, 404, `${label}: Hochladen`);
    };
    const expired = await link(mia, x.shared, { allowUpload: true });
    run('UPDATE links SET expires_at = ? WHERE id = ?', Date.now() - 1000, expired.id);
    await check(expired.token, 'abgelaufen');

    const paused = await link(mia, x.shared, { allowUpload: true });
    assert.equal((await mia.json('PATCH', `/api/links/${paused.id}`, { paused: true })).statusCode, 200);
    await check(paused.token, 'pausiert');

    const later = await link(mia, x.shared, { allowUpload: true, startsAt: Date.now() + 3_600_000 });
    await check(later.token, 'noch nicht freigeschaltet');

    const once = await link(mia, x.file, { maxDownloads: 1 });
    const client = guest();
    assert.equal((await client.get(`/api/public/${once.token}/nodes/${x.file}/content?download=1`)).statusCode, 200);
    assert.equal((await client.get(`/api/public/${once.token}/nodes/${x.file}/content?download=1`)).statusCode, 404);
    assert.equal((await guest().get(`/api/public/${once.token}`)).statusCode, 404, 'aufgebraucht');

    const gone = await link(mia, x.shared);
    assert.equal((await mia.json('DELETE', `/api/links/${gone.id}`)).statusCode, 200);
    await check(gone.token, 'gelöscht');

    const scratch = await folder(mia, x.root, 'Wird gelöscht');
    const inside = await file(mia, scratch, 'weg.txt', 'weg');
    const trashed = await link(mia, scratch);
    assert.equal((await guest().get(`/api/public/${trashed.token}/nodes/${inside}/content`)).statusCode, 200);
    assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: [inside] })).statusCode, 200);
    assert.equal(
      (await guest().get(`/api/public/${trashed.token}/nodes/${inside}/content`)).statusCode,
      404,
      'Gelöschtes im geteilten Ordner'
    );
    assert.equal((await mia.json('POST', '/api/nodes/restore', { ids: [inside] })).statusCode, 200);
    assert.equal((await mia.json('POST', '/api/nodes/move', { ids: [inside], target: x.sibling })).statusCode, 200);
    assert.equal(
      (await guest().get(`/api/public/${trashed.token}/nodes/${inside}/content`)).statusCode,
      404,
      'aus dem Ordner Verschobenes'
    );
    assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: [scratch] })).statusCode, 200);
    assert.equal((await guest().get(`/api/public/${trashed.token}`)).statusCode, 404, 'der ganze Ordner im Papierkorb');

    for (const token of ['abcdefghijklmnopqrstuv', "'--", 'a'.repeat(200), '%00', 'a%2Fb', '%E2%80%AE']) {
      assert.ok([400, 404].includes((await guest().get(`/s/${token}`, { accept: 'text/html' })).statusCode), token);
      assert.ok([400, 404].includes((await guest().get(`/api/public/${token}`)).statusCode), token);
    }
  });

  it('nur zum Ansehen geben nichts zum Herunterladen heraus', async () => {
    const { token } = await link(mia, x.shared, { allowDownload: false });
    const client = guest();
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/content`)).statusCode, 200);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/content?download=1`)).statusCode, 403);
    assert.equal((await client.get(`/api/public/${token}/zip`)).statusCode, 403);
    assert.equal((await client.get(`/api/public/${token}/zip?ids=${x.file}`)).statusCode, 403);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.archive}/archive/entry?path=a.txt`)).statusCode, 403);
    assert.equal((await client.get(`/api/public/${token}/nodes/${x.file}/email/attachments/0`)).statusCode, 403);
    const inline = await client.get(`/api/public/${token}/nodes/${x.file}/content`);
    assert.match(String(inline.headers['content-disposition']), /^inline/);
  });

  it('ohne Erlaubnis nehmen nichts an', async () => {
    const { token } = await link(mia, x.shared);
    const client = await visitor(token);
    const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'rein.txt', size: 4 });
    assert.equal(init.statusCode, 403);
    assert.match(init.json().error.message, /nichts hochladen/);
    const bare = await guest().json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'rein.txt', size: 4 });
    assert.equal(bare.statusCode, 403, 'ohne Formular-Kennzeichen geht es gar nicht erst los');
    const before = (await mia.get(`/api/nodes/${x.shared}/children`)).json().items.length;
    for (const [method, url] of [
      ['POST', `/api/public/${token}/nodes/${x.shared}/folders`],
      ['DELETE', `/api/public/${token}/nodes/${x.file}`],
      ['PATCH', `/api/public/${token}/nodes/${x.file}`],
      ['PUT', `/api/public/${token}/nodes/${x.file}/content`],
      ['POST', `/api/public/${token}/nodes/trash`],
    ]) {
      const response = await client.json(method, url, { name: 'x', ids: [x.file] });
      assert.equal(response.statusCode, 404, `${method} ${url} → ${response.statusCode}`);
    }
    assert.equal((await mia.get(`/api/nodes/${x.shared}/children`)).json().items.length, before);
  });

  it('nur zum Hochladen zeigen nichts und überschreiben nichts', async () => {
    const { token } = await link(mia, x.drop, { uploadOnly: true });
    const client = await visitor(token);
    const info = await client.get(`/api/public/${token}`);
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().share.node.items, null, 'wie viel schon im Briefkasten liegt, bleibt verborgen');
    assert.doesNotMatch(info.body, /vorhanden/);
    const existing = ((await mia.get(`/api/nodes/${x.drop}/children`)).json().items as { id: string }[])[0].id;
    for (const route of publicReads()) {
      for (const id of [x.drop, existing]) {
        const response = await client.get(fill(route, token, id));
        assert.ok(
          [403, 404].includes(response.statusCode) || (response.statusCode === 200 && /"items":\[\]/.test(response.body)),
          `${fill(route, token, id)} → ${response.statusCode}`
        );
        assert.doesNotMatch(response.body, /vorhanden|Schon da/);
      }
    }
    assert.equal((await client.get(`/api/public/${token}/zip`)).statusCode, 403);
    assert.equal((await client.get(`/s/${token}/thumb`)).statusCode, 404);

    const sent = await drop(client, token, x.drop, 'vorhanden.txt', 'Von außen', { conflict: 'replace' });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.doesNotMatch(sent.body, /sha256|parentId|"name"/, 'die Antwort beschreibt die Ablage nicht');
    const names = ((await mia.get(`/api/nodes/${x.drop}/children`)).json().items as { name: string; id: string }[])
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(names, ['vorhanden (2).txt', 'vorhanden.txt'], 'eine gleichnamige Datei wird nicht überschrieben');
    assert.equal((await mia.get(`/api/nodes/${existing}/content`)).body, 'Schon da');
    const uploaded = sent.json().node?.id ?? sent.json().id;
    if (uploaded) {
      assert.equal(
        (await client.get(`/api/public/${token}/nodes/${uploaded}/content`)).statusCode,
        404,
        'auch das eigene Hochgeladene lässt sich nicht zurückholen'
      );
    }
    for (const parentId of [x.shared, x.root, x.sibling, existing]) {
      const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId, name: 'fremd.txt', size: 1 });
      assert.ok([400, 404].includes(init.statusCode), `Hochladen nach ${parentId} → ${init.statusCode}`);
    }
  });

  it('nehmen beim Hochladen keine Pfade und keine gefährlichen Namen an', async () => {
    const { token } = await link(mia, x.shared, { allowUpload: true });
    const client = await visitor(token);
    for (const name of ['../oben.txt', '..', '.', 'a/b.txt', 'a\\b.txt', 'null\u0000.txt', 'zeile\n.txt', '', ' ', 'x'.repeat(300)]) {
      const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name, size: 1 });
      assert.equal(init.statusCode, 400, JSON.stringify(name));
    }
    for (const relativePath of ['../../Daneben', '..', 'a/../../b', '/etc', 'C:\\Windows', 'a/\u0000/b']) {
      const init = await client.json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'ok.txt', size: 1, relativePath });
      if (init.statusCode === 200) {
        const done = await client.send({
          method: 'PUT',
          url: `/api/public/${token}/uploads/${init.json().id}?offset=0`,
          headers: { 'content-type': 'application/octet-stream' },
          payload: Buffer.from('x'),
        });
        assert.equal(done.statusCode, 200);
        assert.equal((await client.json('POST', `/api/public/${token}/uploads/${init.json().id}/complete`)).statusCode, 200);
      } else {
        assert.equal(init.statusCode, 400, JSON.stringify(relativePath));
      }
    }
    const outside = (await mia.get(`/api/nodes/${x.sibling}/children`)).json().items as { name: string }[];
    assert.ok(!outside.some((entry) => entry.name === 'ok.txt'), 'nichts landet neben dem geteilten Ordner');
    const top = (await mia.get(`/api/nodes/${x.root}/children`)).json().items as { name: string }[];
    assert.ok(!top.some((entry) => ['ok.txt', 'etc', 'b', 'Windows', 'C:'].includes(entry.name)), 'nichts landet in Mias Hauptordner');

    const first = await client.json('POST', `/api/public/${token}/uploads`, { parentId: x.shared, name: 'lang.bin', size: 4 });
    assert.equal(first.statusCode, 200);
    const other = await link(mia, x.inner, { allowUpload: true });
    const foreign = await (
      await visitor(other.token)
    ).send({
      method: 'PUT',
      url: `/api/public/${other.token}/uploads/${first.json().id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('abcd'),
    });
    assert.equal(foreign.statusCode, 404, 'ein Upload gehört zu seinem Link');
    assert.equal((await mia.get(`/api/uploads/${first.json().id}`)).statusCode, 404, 'und nicht zu einem Konto');
  });

  it('hängen am Konto dahinter', async () => {
    const lea = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' });
    const leaId = lea.json().user.id as number;
    const client = await login(app, 'lea', 'leas-passwort-123');
    const root = (await client.get('/api/session')).json().user.rootId;
    const shared = await folder(client, root, 'Leas Ordner');
    const inside = await file(client, shared, 'lea.txt', 'Von Lea');
    const { token, id } = await link(client, shared);
    assert.equal((await guest().get(`/api/public/${token}/nodes/${inside}/content`)).statusCode, 200);

    assert.equal((await emi.json('PATCH', `/api/admin/users/${leaId}`, { disabled: true })).statusCode, 200);
    assert.equal((await guest().get(`/s/${token}`, { accept: 'text/html' })).statusCode, 404, 'gesperrtes Konto');
    assert.equal((await guest().get(`/api/public/${token}/nodes/${inside}/content`)).statusCode, 404);
    const listed = ((await emi.get('/api/admin/links')).json().items as { id: string; blocked: string | null }[]).find(
      (entry) => entry.id === id
    )!;
    assert.equal(listed.blocked, 'account');
    assert.equal((await emi.json('PATCH', `/api/admin/users/${leaId}`, { disabled: false })).statusCode, 200);
    assert.equal(
      (await guest().get(`/api/public/${token}/nodes/${inside}/content`)).statusCode,
      200,
      'nach der Freigabe gilt der Link wieder'
    );

    assert.equal((await emi.json('PATCH', `/api/admin/users/${leaId}`, { expiresAt: Date.now() + 60_000 })).statusCode, 200);
    run('UPDATE users SET expires_at = ? WHERE id = ?', Date.now() - 1000, leaId);
    assert.equal((await guest().get(`/api/public/${token}`)).statusCode, 404, 'abgelaufenes Konto');
    run('UPDATE users SET expires_at = NULL WHERE id = ?', leaId);

    assert.equal((await emi.json('DELETE', `/api/admin/users/${leaId}`)).statusCode, 200);
    assert.equal((await guest().get(`/api/public/${token}`)).statusCode, 404, 'gelöschtes Konto');
    assert.equal(one('SELECT 1 AS found FROM links WHERE id = ?', id), undefined);
  });

  it('von Mitbearbeitenden enden, wenn deren Zugriff endet', async () => {
    const work = await folder(mia, x.root, 'Gemeinsam');
    const paper = await file(mia, work, 'papier.txt', 'Entwurf');
    const grant = await mia.json('POST', `/api/nodes/${work}/grants`, { userId: noraId, permission: 'edit' });
    assert.equal(grant.statusCode, 200, grant.body);
    const { token, id } = await link(nora, work);
    assert.equal((await guest().get(`/api/public/${token}/nodes/${paper}/content`)).statusCode, 200);

    assert.equal((await mia.json('PATCH', `/api/grants/${grant.json().grant.id}`, { permission: 'view' })).statusCode, 200);
    assert.equal((await guest().get(`/api/public/${token}/nodes/${paper}/content`)).statusCode, 404, 'nur noch Lesen');
    const seen = ((await mia.get(`/api/nodes/${work}/shares`)).json().links as { id: string; blocked: string | null }[]).find(
      (entry) => entry.id === id
    )!;
    assert.equal(seen.blocked, 'access', 'Mia sieht, dass der Link ruht');
    assert.equal((await mia.json('PATCH', `/api/grants/${grant.json().grant.id}`, { permission: 'edit' })).statusCode, 200);
    assert.equal((await guest().get(`/api/public/${token}/nodes/${paper}/content`)).statusCode, 200);

    assert.equal((await mia.json('DELETE', `/api/grants/${grant.json().grant.id}`)).statusCode, 200);
    assert.equal((await guest().get(`/s/${token}`, { accept: 'text/html' })).statusCode, 404, 'Freigabe entzogen');
    assert.equal((await guest().get(`/api/public/${token}/nodes/${paper}/content`)).statusCode, 404);
    assert.equal((await mia.json('DELETE', `/api/links/${id}`)).statusCode, 200, 'die Besitzerin räumt den Link weg');
  });

  it('lassen sich von der Verwaltung entfernen, aber nicht umbauen', async () => {
    const { token, id } = await link(mia, x.shared, { password: 'nur-fuer-freunde-1' });
    for (const body of [
      { removePassword: true },
      { password: 'vom-admin-gesetzt-1' },
      { paused: false },
      { allowUpload: true },
      { slug: 'kurz' },
    ]) {
      assert.equal((await emi.json('PATCH', `/api/links/${id}`, body)).statusCode, 404, JSON.stringify(body));
    }
    assert.equal((await emi.get(`/api/links/${id}/events`)).statusCode, 404);
    assert.equal((await emi.json('DELETE', `/api/links/${id}`)).statusCode, 404);
    assert.equal((await guest().get(`/api/public/${token}`)).statusCode, 401, 'das Passwort steht noch');
    assert.equal((await emi.json('DELETE', `/api/admin/links/${id}`)).statusCode, 200);
    assert.equal((await guest().get(`/s/${token}`, { accept: 'text/html' })).statusCode, 404);
  });

  it('kann nur anlegen, wer den Ordner bearbeiten darf, und Gäste gar nicht', async () => {
    assert.ok([403, 404].includes((await nora.json('POST', `/api/nodes/${x.shared}/links`, {})).statusCode));
    const view = await mia.json('POST', `/api/nodes/${x.shared}/grants`, { userId: noraId, permission: 'view' });
    assert.equal(view.statusCode, 200);
    assert.equal((await nora.json('POST', `/api/nodes/${x.shared}/links`, {})).statusCode, 403, 'Nur-Lesen reicht nicht für einen Link');
    assert.equal((await mia.json('DELETE', `/api/grants/${view.json().grant.id}`)).statusCode, 200);
    assert.equal((await mia.json('POST', `/api/nodes/${x.root}/links`, {})).statusCode, 400, 'der Hauptordner lässt sich nicht teilen');
    await emi.json('PATCH', '/api/admin/settings', { 'share.links': false });
    assert.equal((await mia.json('POST', `/api/nodes/${x.shared}/links`, {})).statusCode, 403);
    await emi.json('PATCH', '/api/admin/settings', { 'share.links': true, 'share.requirePassword': true });
    assert.equal((await mia.json('POST', `/api/nodes/${x.shared}/links`, {})).statusCode, 400);
    await emi.json('PATCH', '/api/admin/settings', { 'share.requirePassword': false });
  });

  it('liefern Dateien so aus, dass sie im Browser nichts anstellen', async () => {
    const page = await file(mia, x.shared, 'seite.html', '<script>alert(document.cookie)</script>');
    const vector = await file(mia, x.shared, 'bild.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { token } = await link(mia, x.shared);
    for (const id of [page, vector]) {
      const response = await guest().get(`/api/public/${token}/nodes/${id}/content`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.match(String(response.headers['content-security-policy']), /sandbox/);
      assert.match(String(response.headers['content-security-policy']), /default-src 'none'/);
      assert.doesNotMatch(String(response.headers['content-security-policy']), /allow-scripts|allow-same-origin/);
    }
    const share = await guest().get(`/s/${token}`, { accept: 'text/html' });
    assert.equal(share.headers['x-frame-options'], 'DENY');
    assert.match(String(share.headers['content-security-policy']), /frame-ancestors 'none'|frame-ancestors 'self'/);
    assert.equal(share.headers['referrer-policy'], 'no-referrer');
  });
});
