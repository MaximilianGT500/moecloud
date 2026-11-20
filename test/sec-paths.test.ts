import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import yazl from 'yazl';
import { Client, createApp, login, setUp } from './helpers.ts';
import { cleanName, cleanRelativePath } from '../src/lib/names.ts';
import { safePath } from '../src/services/archive.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let nora: Client;
let root = '';
let noraRoot = '';
let davMia = '';
let davNora = '';

const char = (code: number) => String.fromCharCode(code);

const HOSTILE = [
  '..',
  '.',
  '../oben.txt',
  '..\\oben.txt',
  'a/b.txt',
  'a\\b.txt',
  '/etc/passwd',
  'C:\\Windows\\win.ini',
  `null${char(0)}.txt`,
  `zeile${char(10)}zwei.txt`,
  `wagen${char(13)}.txt`,
  `tab${char(9)}.txt`,
  `esc${char(27)}[31m.txt`,
  `del${char(127)}.txt`,
  `${char(0x202e)}gpj.exe`,
  `rechnung${char(0x202e)}fdp.exe`,
  `a${char(0x2066)}b.txt`,
  '',
  ' ',
  `${char(9)}${char(10)}`,
  'ä'.repeat(200),
  'x'.repeat(256),
];

const FINE = [
  'normal.txt',
  '.versteckt',
  'mit leerzeichen.txt',
  'ünïcödé 日本語 🙂.txt',
  'CON',
  'a..b',
  'punkt.',
  'x'.repeat(255),
  "o'reilly & söhne <1>.txt",
];

async function folder(client: Client, parent: string, name: string): Promise<string> {
  const response = await client.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

async function names(client: Client, parent: string) {
  return ((await client.get(`/api/nodes/${parent}/children`)).json().items as { name: string }[]).map((entry) => entry.name).sort();
}

function archive(entries: [string, string, { mode?: number }?][]) {
  const file = new yazl.ZipFile();
  for (const [name, content, options] of entries) {
    const buffer = Buffer.from(content);
    const entry = file as unknown as { addBuffer(data: Buffer, name: string, options?: Record<string, unknown>): void };
    try {
      entry.addBuffer(buffer, name, options);
    } catch {
      entry.addBuffer(buffer, `platzhalter-${Math.abs(name.length)}`, options);
    }
  }
  file.end();
  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    file.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    file.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function rename(zip: Buffer, from: string, to: string) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to), 'Namen müssen gleich lang sein');
  let data = zip;
  let index = data.indexOf(from);
  let replaced = 0;
  while (index !== -1) {
    data = Buffer.concat([data.subarray(0, index), Buffer.from(to), data.subarray(index + Buffer.byteLength(from))]);
    replaced++;
    index = data.indexOf(from, index + Buffer.byteLength(to));
  }
  assert.ok(replaced >= 2, `${from} steht nicht im Archiv`);
  return data;
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
  noraRoot = (await nora.get('/api/session')).json().user.rootId;
  const token = async (client: Client, username: string) =>
    `Basic ${Buffer.from(`${username}:${(await client.json('POST', '/api/account/app-passwords', { name: 'Laufwerk', shared: true })).json().token}`).toString('base64')}`;
  davMia = await token(mia, 'mia');
  davNora = await token(nora, 'nora');
});

after(() => app.close());

describe('Namen', () => {
  it('mit Pfaden, Steuerzeichen oder Richtungswechseln nimmt die Prüfung nicht an', () => {
    for (const name of HOSTILE) assert.throws(() => cleanName(name), /Name/, JSON.stringify(name));
    for (const name of FINE) assert.equal(cleanName(name), name.normalize('NFC').trim(), JSON.stringify(name));
    for (const path of ['../a', 'a/../../b', '..', 'a/./../b', `a/${char(0)}/b`, 'a/'.repeat(70)]) {
      assert.throws(() => cleanRelativePath(path), /Name|tief/, JSON.stringify(path));
    }
    assert.deepEqual(cleanRelativePath('/a//b\\c/./d'), ['a', 'b', 'c', 'd']);
    assert.deepEqual(cleanRelativePath(''), []);
  });

  it('dieser Art lehnt jede Stelle ab, an der ein Name entsteht', async () => {
    const base = await folder(mia, root, 'Namen');
    const fileResponse = await mia.upload(base, 'vorlage.txt', Buffer.from('x'), 1024);
    const file = fileResponse.json().node.id as string;
    const tag = (await mia.json('POST', '/api/tags', { name: 'Marke', color: 'blue' })).json().tag.id;
    for (const name of HOSTILE) {
      const label = JSON.stringify(name);
      const tries: [string, string, unknown][] = [
        ['POST', `/api/nodes/${base}/folders`, { name }],
        ['POST', `/api/nodes/${base}/text`, { name, content: 'x' }],
        ['PATCH', `/api/nodes/${file}`, { name }],
        ['POST', '/api/nodes/rename', { items: [{ id: file, name }] }],
        ['POST', '/api/uploads', { parentId: base, name, size: 1 }],
        ['POST', '/api/uploads', { parentId: base, name: 'ok.txt', size: 1, relativePath: `${name}/unter` }],
        ['POST', '/api/nodes/zip', { ids: [file], name }],
        ['POST', `/api/nodes/${base}/office/new`, { kind: 'document', name }],
      ];
      for (const [method, url, body] of tries) {
        const response = await mia.json(method, url, body);
        if (url.endsWith('/office/new') && /nicht eingerichtet/.test(response.body)) continue;
        if (url === '/api/uploads' && 'relativePath' in (body as object) && (['', '.'].includes(name.trim()) || /[/\\]/.test(name)))
          continue;
        if (url === '/api/nodes/zip' && name.trim() === '') continue;
        assert.ok(
          response.statusCode >= 400 && response.statusCode < 500,
          `${method} ${url} mit ${label} → ${response.statusCode}: ${response.body.slice(0, 120)}`
        );
      }
      const renamed = await mia.json('PATCH', `/api/tags/${tag}`, { name });
      assert.ok(renamed.statusCode < 500, `Schlagwort ${label} → ${renamed.statusCode}`);
    }
    assert.deepEqual(await names(mia, base), ['vorlage.txt'], 'nichts wurde angelegt oder umbenannt');
    assert.deepEqual(
      (await names(mia, root)).filter((name) => name !== 'Namen'),
      [],
      'nichts ist eine Ebene höher gelandet'
    );
    for (const name of FINE) {
      const response = await mia.json('POST', `/api/nodes/${base}/folders`, { name });
      assert.equal(response.statusCode, 200, `${JSON.stringify(name)}: ${response.body}`);
    }
  });

  it('mit gesperrter Endung kommen auf keinem Weg herein, auch nicht mit Punkt oder Großbuchstaben getarnt', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': 'exe, bat' })).statusCode, 200);
    const base = await folder(mia, root, 'Gesperrt');
    const plain = (await mia.upload(base, 'harmlos.txt', Buffer.from('MZ'), 1024)).json().node.id as string;
    for (const name of ['a.exe', 'a.EXE', 'a.Exe', 'a.exe.', 'a.exe..', 'a.exe ', 'a.exe. ', 'a.tar.bat', '.exe.exe']) {
      const label = JSON.stringify(name);
      assert.equal((await mia.json('POST', '/api/uploads', { parentId: base, name, size: 2 })).statusCode, 400, `Hochladen ${label}`);
      assert.equal((await mia.json('POST', `/api/nodes/${base}/text`, { name, content: 'x' })).statusCode, 400, `Textdatei ${label}`);
      assert.equal((await mia.json('PATCH', `/api/nodes/${plain}`, { name })).statusCode, 400, `Umbenennen ${label}`);
      assert.equal(
        (await mia.json('POST', '/api/nodes/rename', { items: [{ id: plain, name }] })).statusCode,
        400,
        `Mehrere umbenennen ${label}`
      );
      const put = await app.inject({
        method: 'PUT',
        url: `/dav/Gesperrt/${encodeURIComponent(name)}`,
        headers: { authorization: davMia },
        payload: 'MZ',
      });
      assert.ok(put.statusCode >= 400 && put.statusCode < 500, `WebDAV PUT ${label} → ${put.statusCode}`);
      const move = await app.inject({
        method: 'MOVE',
        url: '/dav/Gesperrt/harmlos.txt',
        headers: { authorization: davMia, destination: `/dav/Gesperrt/${encodeURIComponent(name)}` },
      });
      assert.ok(move.statusCode >= 400 && move.statusCode < 500, `WebDAV MOVE ${label} → ${move.statusCode}`);
    }
    const packed = await archive([
      ['gut.txt', 'gut'],
      ['boese.exe', 'MZ'],
      ['tief/auch.BAT', 'echo'],
    ]);
    const zipped = (await mia.upload(base, 'paket.zip', packed, 1 << 20)).json().node.id as string;
    const extracted = await mia.json('POST', `/api/nodes/${zipped}/extract`, {});
    assert.equal(extracted.statusCode, 200, extracted.body);
    assert.equal(extracted.json().skipped.blocked, 2);
    assert.deepEqual(await names(mia, base), ['harmlos.txt', 'paket', 'paket.zip']);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'storage.blockedTypes': '' })).statusCode, 200);
  });
});

describe('Archive', () => {
  it('erkennt Pfade, die aus dem Zielordner herausführen', () => {
    for (const path of ['../oben.txt', 'a/../../b.txt', '/etc/passwd', 'C:\\Windows\\x', '..\\..\\x', 'a/../b', './../x']) {
      assert.equal(safePath(path), false, JSON.stringify(path));
    }
    for (const path of ['a.txt', 'ordner/b.txt', 'ordner/', 'a..b/c', '.versteckt/x']) assert.equal(safePath(path), true, path);
  });

  it('entpackt nichts außerhalb des neuen Ordners und folgt keinen Verknüpfungen', async () => {
    const base = await folder(mia, root, 'Entpacken');
    const raw = await archive([
      ['gut/innen.txt', 'gut'],
      ['AAAAAAAAAA.txt', 'eins'],
      ['BBBBBBBBBBBBBBBB.txt', 'zwei'],
      ['CCCCCCCCCCC', 'drei'],
      ['DDDDDDD.txt', 'vier'],
    ]);
    const traversal: [string, string][] = [
      ['AAAAAAAAAA.txt', '../../oben.txt'],
      ['BBBBBBBBBBBBBBBB.txt', 'gut/../../../weg.txt'],
      ['CCCCCCCCCCC', '/etc/passwd'],
      ['DDDDDDD.txt', 'C:\\boot.ini'],
    ];
    for (const [from, to] of traversal) {
      const id = (await mia.upload(base, 'falle.zip', rename(raw, from, to), 1 << 20)).json().node.id as string;
      const listing = await mia.get(`/api/nodes/${id}/archive`);
      assert.ok(listing.statusCode < 500, `${to}: Inhalt → ${listing.statusCode}`);
      for (const path of [to, '../../../../etc/passwd', 'gibt-es-nicht', '']) {
        const entry = await mia.get(`/api/nodes/${id}/archive/entry?path=${encodeURIComponent(path)}`);
        assert.ok([400, 404].includes(entry.statusCode), `${to}: ${path} → ${entry.statusCode}`);
        assert.doesNotMatch(entry.body, /root:/);
      }
      const result = await mia.json('POST', `/api/nodes/${id}/extract`, {});
      assert.ok([200, 400].includes(result.statusCode), `${to}: ${result.body}`);
      if (result.statusCode === 200) {
        assert.ok(result.json().skipped.unsafe >= 1, `${to}: ${JSON.stringify(result.json().skipped)}`);
        assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: [result.json().folderId] })).statusCode, 200);
      }
      assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: [id] })).statusCode, 200);
      assert.deepEqual(await names(mia, base), [], `${to}: im Ordner ist etwas liegen geblieben`);
      assert.ok(
        !(await names(mia, root)).some((name) => /oben|weg|passwd|boot|etc/.test(name)),
        `${to}: etwas ist im Hauptordner gelandet`
      );
    }

    const mixed = rename(
      await archive([
        ['gut/innen.txt', 'gut'],
        ['EEEE.txt', 'steuerzeichen'],
        ['verknuepfung', '/etc/passwd', { mode: 0o120777 }],
      ]),
      'EEEE.txt',
      `E${char(7)}EE.txt`
    );
    const id = (await mia.upload(base, 'gemischt.zip', mixed, 1 << 20)).json().node.id as string;
    const linked = await mia.get(`/api/nodes/${id}/archive/entry?path=verknuepfung`);
    assert.doesNotMatch(linked.body, /root:/, 'die Vorschau folgt keiner Verknüpfung, sie zeigt höchstens deren Text');
    const result = await mia.json('POST', `/api/nodes/${id}/extract`, {});
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().files, 1);
    assert.equal(result.json().skipped.unsafe, 2, JSON.stringify(result.json().skipped));
    assert.deepEqual(await names(mia, base), ['gemischt', 'gemischt.zip']);
    assert.deepEqual(await names(mia, result.json().folderId), ['gut']);
  });
});

describe('Dateien des Servers', () => {
  it('lassen sich über keine Adresse auslesen', async () => {
    const secret = /"name": "moecloud"|"dependencies"|root:x:0:0|BEGIN (RSA|OPENSSH)|SQLite format 3/;
    const paths = [
      '/assets/../package.json',
      '/assets/..%2f..%2fpackage.json',
      '/assets/%2e%2e/%2e%2e/package.json',
      '/assets/%2e%2e%2f%2e%2e%2fpackage.json',
      '/assets/..%5c..%5cpackage.json',
      '/assets/....//....//package.json',
      '/assets/%252e%252e/package.json',
      '/assets//etc/passwd',
      '/assets/%00/../package.json',
      '/assets/..;/package.json',
      '/icons/../../package.json',
      '/icons/..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/favicon.svg/../package.json',
      '/favicon..%2f..%2fpackage.json',
      '/plugin-pages/x/..%2f..%2f..%2fpackage.json',
      '/plugin-pages/../package.json',
      '/plugin-pages/sdk.js/../../package.json',
      '/branding/..%2f..%2fpackage.json',
      '/api/avatars/..%2f..%2fpackage.json',
      '/api/admin/backups/..%2f..%2fpackage.json',
      '/api/admin/backups/..%2fmoecloud.db',
      '/api/admin/backups/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/api/admin/backups/moecloud.db',
      '/api/admin/backups/%00',
      '/.env',
      '/.git/config',
      '/package.json',
      '/data/moecloud.db',
      '/src/app.ts',
      '/node_modules/fastify/package.json',
      '/assets/',
      '/assets',
    ];
    for (const path of paths) {
      for (const client of [emi, new Client(app)]) {
        const response = await client.get(path);
        assert.ok(response.statusCode < 500, `${path} → ${response.statusCode}`);
        assert.doesNotMatch(response.body, secret, `${path} liefert eine Datei des Servers`);
        if (response.statusCode === 200) assert.doesNotMatch(String(response.headers['content-type']), /json|sqlite|octet-stream/, path);
      }
    }
    for (const name of ['..%2f..%2fpackage.json', '%2e%2e', 'moecloud.db', 'a/b', '%00']) {
      const removed = await emi.json('DELETE', `/api/admin/backups/${name}`);
      assert.ok([400, 404].includes(removed.statusCode), `Löschen von ${name} → ${removed.statusCode}`);
    }
  });
});

describe('WebDAV', () => {
  const dav = (method: string, url: string, authorization: string, headers: Record<string, string> = {}, payload?: string) =>
    app.inject({ method: method as 'GET', url, headers: { authorization, ...headers }, ...(payload === undefined ? {} : { payload }) });

  it('bleibt im eigenen Laufwerk, wie auch immer der Pfad geschrieben ist', async () => {
    const mine = await folder(mia, root, 'Mias Ordner');
    await mia.upload(mine, 'geheim.txt', Buffer.from('Nur für Mia'), 1024);
    await folder(nora, noraRoot, 'Noras Ordner');
    for (const path of [
      '/dav/..%2f..%2fetc%2fpasswd',
      '/dav/%2e%2e/%2e%2e/etc/passwd',
      '/dav/Noras%20Ordner/..%2f..%2fMias%20Ordner/geheim.txt',
      '/dav/..%2fMias%20Ordner/geheim.txt',
      '/dav/Mias%20Ordner/geheim.txt',
      '/dav/Mias%20Ordner%2fgeheim.txt',
      '/dav/%2e%2e%2fMias%20Ordner',
      `/dav/${mine}`,
      `/dav/${root}/Mias%20Ordner/geheim.txt`,
      '/dav/mia/Mias%20Ordner/geheim.txt',
      '/dav/~mia/Mias%20Ordner/geheim.txt',
      '/dav/%00',
      '/dav/%ff%fe',
    ]) {
      for (const method of ['GET', 'PROPFIND', 'DELETE', 'PUT', 'MKCOL', 'PROPPATCH', 'LOCK']) {
        const response = await dav(method, path, davNora, { depth: '1' }, method === 'PUT' ? 'überschrieben' : undefined);
        assert.ok(response.statusCode < 500, `${method} ${path} → ${response.statusCode}`);
        assert.doesNotMatch(response.body, /Nur für Mia|geheim\.txt/, `${method} ${path} zeigt Mias Datei`);
      }
    }
    assert.equal((await dav('GET', '/dav/Mias%20Ordner/geheim.txt', davMia)).body, 'Nur für Mia');
    assert.deepEqual(await names(mia, mine), ['geheim.txt']);
    assert.ok(!(await names(mia, root)).some((name) => /passwd|etc/.test(name)));
  });

  it('nimmt als Ziel nur Pfade im eigenen Laufwerk', async () => {
    await mia.upload(root, 'quelle.txt', Buffer.from('Quelle'), 1024);
    for (const [destination, expected] of [
      ['https://boese.example/dav/ziel.txt', [502, 400, 403]],
      ['http://localhost:3000/anderswo/ziel.txt', [403, 502]],
      ['http://localhost/anderswo/ziel.txt', [403]],
      ['/api/nodes/abc', [403]],
      ['/files/ziel.txt', [403]],
      ['/davx/ziel.txt', [403]],
      ['/dav/../etc/ziel.txt', [403, 409, 400, 201, 204]],
      ['/dav/gibt/es/nicht/ziel.txt', [409]],
      ['/dav/..%2f..%2fziel.txt', [400, 409, 403]],
      [`/dav/zeile${encodeURIComponent(char(10))}.txt`, [400]],
      ['', [400]],
    ] as [string, number[]][]) {
      for (const method of ['COPY', 'MOVE']) {
        const response = await dav(method, '/dav/quelle.txt', davMia, { destination });
        assert.ok(expected.includes(response.statusCode), `${method} nach ${JSON.stringify(destination)} → ${response.statusCode}`);
      }
    }
    assert.ok((await names(mia, root)).includes('quelle.txt'), 'die Quelle liegt noch an ihrem Platz');
    assert.ok(!(await names(nora, noraRoot)).some((name) => /ziel|quelle/.test(name)), 'bei Nora ist nichts angekommen');
  });

  it('gibt über geteilte Ordner nur das frei, was die Freigabe erlaubt', async () => {
    const shared = await folder(mia, root, 'Nur lesen');
    await mia.upload(shared, 'lesen.txt', Buffer.from('Zum Lesen'), 1024);
    const noraId = (await nora.get('/api/session')).json().user.id;
    assert.equal((await mia.json('POST', `/api/nodes/${shared}/grants`, { userId: noraId, permission: 'view' })).statusCode, 200);
    assert.equal((await dav('GET', '/dav/Nur%20lesen/lesen.txt', davNora)).body, 'Zum Lesen');
    for (const [method, url, headers] of [
      ['PUT', '/dav/Nur%20lesen/neu.txt', {}],
      ['PUT', '/dav/Nur%20lesen/lesen.txt', {}],
      ['MKCOL', '/dav/Nur%20lesen/Neu', {}],
      ['DELETE', '/dav/Nur%20lesen/lesen.txt', {}],
      ['DELETE', '/dav/Nur%20lesen', {}],
      ['MOVE', '/dav/Nur%20lesen/lesen.txt', { destination: '/dav/Noras%20Ordner/lesen.txt' }],
      ['MOVE', '/dav/Nur%20lesen/lesen.txt', { destination: '/dav/Nur%20lesen/anders.txt' }],
      ['MOVE', '/dav/Noras%20Ordner', { destination: '/dav/Nur%20lesen/Noras%20Ordner' }],
      ['COPY', '/dav/Noras%20Ordner', { destination: '/dav/Nur%20lesen/Kopie' }],
    ] as [string, string, Record<string, string>][]) {
      const response = await dav(method, url, davNora, headers, method === 'PUT' ? 'von Nora' : undefined);
      assert.ok([403, 404, 405, 409, 423].includes(response.statusCode), `${method} ${url} → ${response.statusCode}`);
    }
    const patched = await dav(
      'PROPPATCH',
      '/dav/Nur%20lesen/lesen.txt',
      davNora,
      {},
      '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>anders</d:displayname></d:prop></d:set></d:propertyupdate>'
    );
    assert.ok([207, 403].includes(patched.statusCode));
    assert.deepEqual(await names(mia, shared), ['lesen.txt']);
    assert.equal(
      (await mia.get(`/api/nodes/${(await mia.get(`/api/nodes/${shared}/children`)).json().items[0].id}/content`)).body,
      'Zum Lesen'
    );
    const plain = await nora.json('POST', '/api/account/app-passwords', { name: 'Ohne Geteiltes' });
    const narrow = `Basic ${Buffer.from(`nora:${plain.json().token}`).toString('base64')}`;
    assert.equal(
      (await dav('GET', '/dav/Nur%20lesen/lesen.txt', narrow)).statusCode,
      404,
      'ohne die Einstellung taucht Geteiltes im Laufwerk nicht auf'
    );
  });

  it('lässt sich von riesigen oder kaputten Anfragen nicht aufhalten', async () => {
    for (const piece of ['<d:prop>', '<prop', '<x:prop xmlns="', '<d:prop><a', 'xmlns:a="', '<d:prop></d:prop>', '<!--', '&lt;']) {
      const body = piece.repeat(Math.floor(200_000 / piece.length));
      for (const method of ['PROPFIND', 'PROPPATCH']) {
        const started = Date.now();
        const response = await dav(method, '/dav/', davMia, { depth: '0', 'content-type': 'application/xml' }, body);
        assert.ok(response.statusCode < 500, `${method} mit ${piece} → ${response.statusCode}`);
        assert.ok(Date.now() - started < 3000, `${method} mit ${JSON.stringify(piece)} braucht ${Date.now() - started} ms`);
      }
    }
    const huge = await dav('PROPPATCH', '/dav/', davMia, { depth: '0' }, 'x'.repeat(400_000));
    assert.ok([400, 413].includes(huge.statusCode), `zu großer Körper → ${huge.statusCode}`);
    const deep = await dav('PROPFIND', '/dav/', davMia, { depth: 'infinity' });
    assert.equal(deep.statusCode, 207);
    assert.ok(deep.body.length < 200_000, 'auch mit Depth: infinity kommt nur eine Ebene');
    for (let round = 0; round < 60; round++) await dav('LOCK', `/dav/sperre-${round}.txt`, davMia, {}, '<d:lockinfo xmlns:d="DAV:"/>');
    assert.equal((await dav('PROPFIND', '/dav/', davMia, { depth: '0' })).statusCode, 207);
  });

  it('verlangt ein App-Passwort und nimmt weder Sitzung noch Konto-Passwort', async () => {
    const cookie = [...mia.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    for (const headers of [
      {},
      { cookie },
      { cookie, 'x-csrf-token': mia.csrf },
      { authorization: `Basic ${Buffer.from('mia:mias-passwort-123').toString('base64')}` },
      { authorization: 'Basic' },
      { authorization: 'Basic !!!' },
      { authorization: `Bearer ${'A'.repeat(30)}` },
      { authorization: `Basic ${Buffer.from(':').toString('base64')}` },
      { authorization: `Basic ${Buffer.from('mia').toString('base64')}` },
    ] as Record<string, string>[]) {
      for (const method of ['PROPFIND', 'GET', 'PUT', 'DELETE', 'MKCOL']) {
        const response = await app.inject({ method: method as 'GET', url: '/dav/quelle.txt', headers, remoteAddress: '127.0.8.1' });
        assert.ok(
          [401, 429].includes(response.statusCode),
          `${method} mit ${JSON.stringify(Object.keys(headers))} → ${response.statusCode}`
        );
        assert.doesNotMatch(response.body, /Quelle/);
      }
    }
    const options = await app.inject({ method: 'OPTIONS', url: '/dav/' });
    assert.equal(options.statusCode, 200);
    assert.equal(options.headers['access-control-allow-origin'], undefined, 'keine Freigabe für fremde Seiten');
  });
});
