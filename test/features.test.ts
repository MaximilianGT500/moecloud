import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, fakeClamd, httpSink, login, setUp, zip } from './helpers.ts';
import { EICAR } from '../src/lib/clamav.ts';
import { value } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';
import { recordUsage, usageHistory } from '../src/services/usage.ts';
import { processNow } from '../src/services/processing.ts';
import { job } from '../src/services/scan.ts';
import { flushLinkNotices } from '../src/services/uploads.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaId = 0;
let lea = 0;

const bad = new Set<string>();
const clamd = await fakeClamd((data) => {
  const text = data.toString('latin1');
  if (text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return 'Eicar-Signature';
  for (const marker of bad) if (text.includes(marker)) return 'Moe.Test.Marker';
  return null;
});

async function eventually(check: () => boolean, timeout = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) assert.fail('Die Bedingung trat nicht ein');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const created = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'mias-passwort-123',
  });
  miaId = created.json().user.id;
  lea = (await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await clamd.close();
  await app.close();
});

describe('Virenscan', () => {
  before(async () => {
    const saved = await emi.json('PATCH', '/api/admin/scan', { 'scan.enabled': true, 'scan.host': '127.0.0.1', 'scan.port': clamd.port });
    assert.equal(saved.statusCode, 200, saved.body);
  });

  it('prüft die Verbindung mit der Testsignatur', async () => {
    const test = await emi.json('POST', '/api/admin/scan/test', {});
    assert.equal(test.statusCode, 200, test.body);
    assert.equal(test.json().detects, true);
    assert.match(test.json().version, /ClamAV/);
  });

  it('weist Schadsoftware auf allen Wegen ab', async () => {
    const chunked = await emi.upload(root, 'eicar.com', Buffer.from(EICAR), 16);
    assert.equal(chunked.statusCode, 422);
    assert.equal(chunked.json().error.code, 'infected');
    assert.match(chunked.json().error.message, /Eicar-Signature/);
    assert.equal(value<number>('SELECT COUNT(*) FROM uploads'), 0);
    const multipart = await emi.send({
      method: 'POST',
      url: `/api/nodes/${root}/upload`,
      headers: { 'content-type': 'multipart/form-data; boundary=moe' },
      payload: `--moe\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n${EICAR}\r\n--moe--\r\n`,
    });
    assert.equal(multipart.statusCode, 422);
    const clean = await emi.upload(root, 'sauber.txt', Buffer.from('Nur ein Gedicht über Wolken'));
    assert.equal(clean.statusCode, 200);
    assert.equal(
      value<string>('SELECT scan_status FROM blobs WHERE sha256 = (SELECT sha256 FROM nodes WHERE id = ?)', clean.json().node.id),
      'clean'
    );
    const audit = (await emi.get('/api/admin/audit?action=virus_found')).json();
    assert.ok(audit.items.length >= 2);
    const notes = (await emi.get('/api/notifications')).json();
    assert.ok(notes.items.some((note: { kind: string }) => note.kind === 'admin_virus'));
  });

  it('prüft auch WebDAV und Datei-Anfragen', async () => {
    const token = (await emi.json('POST', '/api/account/app-passwords', { name: 'Test' })).json().token;
    const auth = `Basic ${Buffer.from(`emi:${token}`).toString('base64')}`;
    const put = await app.inject({ method: 'PUT', url: '/dav/virus.txt', headers: { authorization: auth }, payload: EICAR });
    assert.equal(put.statusCode, 422);
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Anfragen' })).json().node.id;
    const link = (await emi.json('POST', `/api/nodes/${folder}/links`, { uploadOnly: true })).json().link;
    const guest = new Client(app);
    await guest.get(`/s/${link.token}`, { accept: 'text/html' });
    const init = await guest.json('POST', `/api/public/${link.token}/uploads`, { parentId: folder, name: 'x.txt', size: EICAR.length });
    await guest.send({
      method: 'PUT',
      url: `/api/public/${link.token}/uploads/${init.json().id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(EICAR),
    });
    const done = await guest.json('POST', `/api/public/${link.token}/uploads/${init.json().id}/complete`);
    assert.equal(done.statusCode, 422);
  });

  it('sperrt Dateien, die eine spätere Prüfung findet, und gibt sie wieder frei', async () => {
    const created = await emi.upload(root, 'spaeter.txt', Buffer.from('Hier steckt MOE-MARKER-1 drin'));
    const id = created.json().node.id;
    bad.add('MOE-MARKER-1');
    const run = await emi.json('POST', '/api/admin/scan/run', { all: true });
    assert.equal(run.statusCode, 200);
    while (job.running) await new Promise((resolve) => setTimeout(resolve, 20));
    const blocked = await emi.get(`/api/nodes/${id}/content`);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'infected');
    const listing = (await emi.get(`/api/nodes/${root}/children`)).json();
    assert.equal(listing.items.find((item: { id: string }) => item.id === id).infected, true);
    const quarantine = (await emi.get('/api/admin/scan/quarantine')).json();
    assert.equal(quarantine.items.length, 1);
    const release = await emi.json('POST', '/api/admin/scan/release', { sha256: quarantine.items[0].sha256 });
    assert.equal(release.json().ok, true);
    assert.equal((await emi.get(`/api/nodes/${id}/content`)).statusCode, 200);
  });

  it('löscht gesperrte Dateien endgültig', async () => {
    bad.add('MOE-MARKER-2');
    const created = await emi.upload(root, 'weg.txt', Buffer.from('MOE-MARKER-2'), 4);
    assert.equal(created.statusCode, 422);
    bad.delete('MOE-MARKER-2');
    const kept = await emi.upload(root, 'weg.txt', Buffer.from('MOE-MARKER-3'));
    bad.add('MOE-MARKER-3');
    await emi.json('POST', '/api/admin/scan/run', { all: true });
    while (job.running) await new Promise((resolve) => setTimeout(resolve, 20));
    const sha = value<string>('SELECT sha256 FROM nodes WHERE id = ?', kept.json().node.id)!;
    const removed = await emi.json('POST', '/api/admin/scan/delete', { sha256: sha });
    assert.equal(removed.json().removed, 1);
    assert.equal((await emi.get(`/api/nodes/${kept.json().node.id}`)).statusCode, 404);
  });

  it('reagiert auf einen ausgefallenen Scanner wie eingestellt', async () => {
    await emi.json('PATCH', '/api/admin/scan', { 'scan.port': 9, 'scan.onError': 'reject' });
    const rejected = await emi.upload(root, 'ohne-scan.txt', Buffer.from('Scanner ist weg'));
    assert.equal(rejected.statusCode, 503);
    await emi.json('PATCH', '/api/admin/scan', { 'scan.onError': 'allow' });
    const allowed = await emi.upload(root, 'ohne-scan.txt', Buffer.from('Scanner ist weg'));
    assert.equal(allowed.statusCode, 200);
    await emi.json('PATCH', '/api/admin/scan', { 'scan.enabled': false, 'scan.port': clamd.port });
  });
});

describe('E-Mail', () => {
  it('ist ohne Einrichtung aus', async () => {
    assert.equal((await new Client(app).get('/forgot', { accept: 'text/html' })).statusCode, 404);
  });

  it('richtet den Versand ein und schickt eine Test-E-Mail', async () => {
    const saved = await emi.json('PATCH', '/api/admin/mail', {
      'mail.enabled': true,
      'mail.host': 'smtp.example.com',
      'mail.port': 587,
      'mail.user': 'cloud',
      'mail.password': 'smtp-geheim',
      'mail.from': 'cloud@example.com',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().hasPassword, true);
    assert.equal(saved.json().settings['mail.password'], undefined);
    const test = await emi.json('POST', '/api/admin/mail/test', {});
    assert.equal(test.statusCode, 200, test.body);
    assert.equal(outbox.at(-1)?.to, 'emi@example.com');
  });

  it('setzt ein vergessenes Passwort zurück', async () => {
    const guest = new Client(app);
    const page = await guest.get('/forgot', { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    const sent = await guest.form('/forgot', { _csrf: guest.cookies.get('moe_csrf')!, login: 'mia' });
    assert.equal(sent.statusCode, 303);
    const mail = outbox.at(-1)!;
    assert.equal(mail.to, 'mia@example.com');
    const token = /token=([A-Za-z0-9]+)/.exec(mail.text)![1];
    const unknown = await guest.form('/forgot', { _csrf: guest.cookies.get('moe_csrf')!, login: 'niemand' });
    assert.equal(unknown.statusCode, 303);
    assert.equal(outbox.at(-1), mail);
    const form = await guest.get(`/reset?token=${token}`, { accept: 'text/html' });
    assert.equal(form.statusCode, 200);
    const short = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'kurz' });
    assert.equal(short.statusCode, 400);
    const reset = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'neues-passwort-mia' });
    assert.equal(reset.statusCode, 303);
    assert.equal((await mia.get('/api/session')).statusCode, 401);
    const again = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'noch-ein-passwort' });
    assert.equal(again.statusCode, 400);
    mia = await login(app, 'mia', 'neues-passwort-mia');
    const security = (await mia.get('/api/account/security')).json();
    assert.ok(security.items.some((entry: { action: string }) => entry.action === 'password_reset'));
  });

  it('verschickt Einladungen und Links für neue Passwörter', async () => {
    const invite = await emi.json('POST', '/api/admin/invites', { email: 'neu@example.com', days: 3 });
    assert.equal(invite.statusCode, 200, invite.body);
    assert.equal(outbox.at(-1)?.to, 'neu@example.com');
    assert.match(outbox.at(-1)!.text, /register\?invite=/);
    const created = await emi.json('POST', '/api/admin/users', {
      username: 'emily',
      name: 'Emily',
      email: 'emily@example.com',
      sendLink: true,
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().sent, true);
    assert.equal(outbox.at(-1)?.to, 'emily@example.com');
  });

  it('schickt einen öffentlichen Link per E-Mail', async () => {
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Für Lea' })).json().node.id;
    const { id, url } = (
      await emi.json('POST', `/api/nodes/${folder}/links`, { password: 'geheim-fuer-lea', expiresAt: Date.now() + 3 * 86_400_000 })
    ).json().link;
    const sent = await emi.json('POST', `/api/links/${id}/send`, { email: 'lea@example.com' });
    assert.equal(sent.statusCode, 200, sent.body);
    const mail = outbox.at(-1)!;
    assert.equal(mail.to, 'lea@example.com');
    assert.equal(mail.subject, 'Emi teilt „Für Lea“ mit dir');
    assert.ok(mail.text.includes(url));
    assert.match(mail.text, /mit einem Passwort geschützt/);
    assert.match(mail.text, /Der Link gilt bis zum \d+\. \w+ \d{4}\./);
    assert.ok(!mail.text.includes('geheim-fuer-lea'));
    assert.ok(!mail.html.includes('geheim-fuer-lea'));
    for (const email of ['', 'keine-adresse', 'lea@example.com,mia@example.com', 'Lea <lea@example.com>']) {
      assert.equal((await emi.json('POST', `/api/links/${id}/send`, { email })).statusCode, 400, email);
    }
    assert.equal((await mia.json('POST', `/api/links/${id}/send`, { email: 'lea@example.com' })).statusCode, 404);
    await emi.json('PATCH', `/api/links/${id}`, { paused: true });
    const count = outbox.length;
    const paused = await emi.json('POST', `/api/links/${id}/send`, { email: 'lea@example.com' });
    assert.equal(paused.statusCode, 400);
    assert.equal(paused.json().error.message, 'Dieser Link ist gerade pausiert');
    assert.equal(outbox.length, count);
  });
});

describe('Benachrichtigungen und Aktivität', () => {
  let folder = '';

  before(async () => {
    folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Urlaub' })).json().node.id;
  });

  it('meldet Freigaben in der App und per E-Mail', async () => {
    await mia.json('POST', '/api/notifications/read', {});
    const before = outbox.length;
    await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: miaId, permission: 'edit' });
    const notes = (await mia.get('/api/notifications')).json();
    assert.equal(notes.unread, 1);
    assert.match(notes.items[0].title, /Urlaub/);
    await eventually(() => outbox.slice(before).some((mail) => mail.to === 'mia@example.com'));
    await mia.json('POST', '/api/notifications/read', {});
    assert.equal((await mia.get('/api/notifications')).json().unread, 0);
    await mia.json('PATCH', '/api/account/prefs', { mailShares: false });
    const count = outbox.length;
    const other = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Rezepte' })).json().node.id;
    await emi.json('POST', `/api/nodes/${other}/grants`, { userId: miaId, permission: 'view' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(outbox.length, count);
  });

  it('meldet Uploads über Anfrage-Links gesammelt', async () => {
    const link = (await emi.json('POST', `/api/nodes/${folder}/links`, { uploadOnly: true, label: 'Fotos von der Feier' })).json().link;
    assert.equal(link.notify, true);
    const guest = new Client(app);
    await guest.get(`/s/${link.token}`, { accept: 'text/html' });
    for (const name of ['a.txt', 'b.txt']) {
      const init = await guest.json('POST', `/api/public/${link.token}/uploads`, { parentId: folder, name, size: 1 });
      await guest.send({
        method: 'PUT',
        url: `/api/public/${link.token}/uploads/${init.json().id}?offset=0`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      });
      await guest.json('POST', `/api/public/${link.token}/uploads/${init.json().id}/complete`);
    }
    flushLinkNotices();
    const notes = (await emi.get('/api/notifications')).json();
    const upload = notes.items.find((note: { kind: string }) => note.kind === 'request_upload');
    assert.match(upload.title, /2 Dateien/);
    const quiet = (await emi.json('POST', `/api/nodes/${folder}/links`, { allowUpload: true, notify: false })).json().link;
    assert.equal(quiet.notify, false);
    const changed = await emi.json('PATCH', `/api/links/${quiet.id}`, { notify: true });
    assert.equal(changed.json().link.notify, true);
  });

  it('zeigt die Aktivität eines Ordners', async () => {
    await mia.upload(folder, 'strand.txt', Buffer.from('Strand'));
    await mia.upload(folder, 'berge.txt', Buffer.from('Berge'));
    const file = (await emi.get(`/api/nodes/${folder}/children`)).json().items.find((item: { name: string }) => item.name === 'berge.txt');
    await emi.json('PATCH', `/api/nodes/${file.id}`, { name: 'Berge.txt' });
    const items = (await emi.get(`/api/nodes/${folder}/activity`)).json().items;
    const upload = items.find(
      (item: { action: string; actor: { name: string } | null }) => item.action === 'upload' && item.actor?.name === 'Mia'
    );
    assert.equal(upload.count, 2);
    assert.ok(items.some((item: { action: string }) => item.action === 'rename'));
    assert.ok(items.some((item: { action: string; viaLink: boolean }) => item.action === 'link_upload' && item.viaLink));
    assert.equal((await new Client(app).get(`/api/nodes/${folder}/activity`)).statusCode, 401);
  });

  it('zeigt Freigaben in der Aktivität nur, wem sie etwas angehen', async () => {
    const actions = async (client: Client, id = folder) =>
      (await client.get(`/api/nodes/${id}/activity`)).json().items.map((item: { action: string }) => item.action) as string[];
    const owner = await actions(emi);
    assert.ok(owner.includes('share_user'));
    assert.ok(owner.includes('share_link'));
    const editor = await actions(mia);
    assert.ok(!editor.includes('share_user'));
    assert.ok(editor.includes('share_link'));
    assert.ok(editor.includes('upload'));
    await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: lea, permission: 'view' });
    const viewer = await actions(await login(app, 'lea', 'leas-passwort-123'));
    assert.ok(!viewer.includes('share_user'));
    assert.ok(!viewer.includes('share_link'));
    assert.ok(viewer.includes('upload'));
    const inner = (await emi.json('POST', `/api/nodes/${folder}/folders`, { name: 'Strandtage' })).json().node.id;
    const note = (await emi.json('POST', `/api/nodes/${root}/text`, { name: 'Notiz.txt' })).json().node.id;
    await emi.json('POST', '/api/nodes/move', { ids: [note], target: inner });
    assert.ok((await actions(mia, note)).includes('move'));
    const elsewhere = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Nur für mich' })).json().node.id;
    await emi.json('POST', `/api/nodes/${note}/grants`, { userId: miaId, permission: 'view' });
    await emi.json('POST', '/api/nodes/move', { ids: [note], target: elsewhere });
    const moved = (await mia.get(`/api/nodes/${note}/activity`)).json().items as { action: string; details: { to?: string } | null }[];
    assert.ok(!moved.some((item) => item.details?.to === 'Nur für mich'));
    assert.ok((await actions(emi, note)).filter((action) => action === 'move').length >= 1);
  });

  it('sammelt Kommentare und benachrichtigt die anderen', async () => {
    const added = await mia.json('POST', `/api/nodes/${folder}/comments`, { text: 'Die Fotos sind toll' });
    assert.equal(added.statusCode, 200, added.body);
    const notes = (await emi.get('/api/notifications')).json();
    const note = notes.items.find((entry: { kind: string }) => entry.kind === 'comment');
    assert.equal(note.url, `/files/folder/${root}?select=${folder}&tab=comments`);
    const list = (await emi.get(`/api/nodes/${folder}/comments`)).json().items;
    assert.equal(list[0].text, 'Die Fotos sind toll');
    assert.equal(list[0].mine, false);
    assert.equal((await emi.send({ method: 'DELETE', url: `/api/nodes/${folder}/comments/${list[0].id}` })).statusCode, 200);
    assert.equal((await emi.get(`/api/nodes/${folder}/comments`)).json().items.length, 0);
    const empty = await mia.json('POST', `/api/nodes/${folder}/comments`, { text: '   ' });
    assert.equal(empty.statusCode, 400);
  });

  it('färbt Ordner ein', async () => {
    const saved = await emi.json('PUT', '/api/nodes/color', { ids: [folder], color: 'teal' });
    assert.equal(saved.statusCode, 200);
    const item = (await emi.get(`/api/nodes/${root}/children`)).json().items.find((entry: { id: string }) => entry.id === folder);
    assert.equal(item.color, 'teal');
    assert.equal((await emi.json('PUT', '/api/nodes/color', { ids: [folder], color: 'neon' })).statusCode, 400);
    const file = (await emi.get(`/api/nodes/${folder}/children`)).json().items.find((entry: { type: string }) => entry.type === 'file');
    assert.equal((await emi.json('PUT', '/api/nodes/color', { ids: [file.id], color: 'red' })).statusCode, 400);
  });
});

describe('Vorschauen, Fotos und Suche', () => {
  let photo = '';

  it('liest Aufnahmedatum und Kamera aus Fotos', async () => {
    const image = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#7cc3e0' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'Moe', Model: 'Kamera 1' }, IFD2: { DateTimeOriginal: '2024:05:17 10:30:00' } })
      .toBuffer();
    photo = (await emi.upload(root, 'Strand.jpg', image, 4096)).json().node.id;
    await processNow();
    const meta = (await emi.get(`/api/nodes/${photo}/meta`)).json();
    assert.equal(meta.width, 320);
    assert.equal(new Date(meta.takenAt).getUTCFullYear(), 2024);
    assert.equal(meta.meta.camera, 'Moe Kamera 1');
    const photos = (await emi.get('/api/photos')).json();
    assert.equal(photos.items[0].id, photo);
    assert.equal(photos.items[0].takenAt, meta.takenAt);
  });

  it('findet Wörter im Inhalt von Texten und Dokumenten', async () => {
    await emi.upload(root, 'Rezept.md', Buffer.from('# Kuchen\n\nMan nehme Zitronenkuchen und Puderzucker.'));
    const docx = await zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Quartalsbericht mit Himbeerkonfitüre</w:t></w:r></w:p></w:body></w:document>',
    });
    await emi.upload(root, 'Bericht.docx', docx, 4096);
    await processNow();
    const found = (await emi.get('/api/search?q=zitronenkuch')).json().items;
    assert.equal(found[0].name, 'Rezept.md');
    assert.match(found[0].snippet, /\u0001Zitronenkuchen\u0002/);
    const word = (await emi.get('/api/search?q=himbeerkonfiture')).json().items;
    assert.equal(word[0].name, 'Bericht.docx');
    const filtered = (await emi.get('/api/search?q=zitronenkuchen&kind=image')).json().items;
    assert.equal(filtered.length, 0);
  });

  it('zeigt den Inhalt von ZIP-Archiven', async () => {
    const archive = await zip({ 'Fotos/strand.txt': 'Sand', 'liesmich.txt': 'Hallo aus dem Archiv' });
    const id = (await emi.upload(root, 'Paket.zip', archive, 4096)).json().node.id;
    const listing = (await emi.get(`/api/nodes/${id}/archive`)).json();
    assert.deepEqual(listing.entries.map((entry: { path: string }) => entry.path).sort(), ['Fotos/strand.txt', 'liesmich.txt']);
    const entry = await emi.get(`/api/nodes/${id}/archive/entry?path=liesmich.txt`);
    assert.equal(entry.body, 'Hallo aus dem Archiv');
    assert.equal((await emi.get(`/api/nodes/${id}/archive/entry?path=../x`)).statusCode, 404);
    const text = (await emi.upload(root, 'kein-archiv.txt', Buffer.from('x'))).json().node.id;
    assert.equal((await emi.get(`/api/nodes/${text}/archive`)).statusCode, 400);
  });

  it('packt alle eigenen Dateien in ein ZIP', async () => {
    const response = await emi.send({ method: 'GET', url: `/api/zip?ids=${root}` });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.equal(response.rawPayload.subarray(0, 2).toString(), 'PK');
  });

  it('zeigt, was Speicher belegt', async () => {
    await emi.upload(root, 'kopie-1.bin', Buffer.alloc(2048, 7), 4096);
    await emi.upload(root, 'kopie-2.bin', Buffer.alloc(2048, 7), 4096);
    const report = (await emi.get('/api/storage/report')).json();
    assert.ok(report.groups.image.count >= 1);
    const group = report.duplicates.find((entry: { items: { name: string }[] }) => entry.items.some((item) => item.name === 'kopie-1.bin'));
    assert.equal(group.items.length, 2);
    assert.equal(group.count, 2);
    assert.equal(group.wasted, 2048);
    assert.ok(report.largest.length > 0);
  });

  it('räumt doppelte Dateien auf und behält eine Kopie', async () => {
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Doppelt' })).json().node.id;
    const content = Buffer.alloc(3000, 9);
    const first = (await emi.upload(root, 'Original von Mia.bin', content, 4096)).json().node.id;
    await emi.upload(folder, 'Kopie A.bin', content, 4096);
    await emi.upload(folder, 'Kopie B.bin', content, 4096);
    const before = (await emi.get('/api/storage/report')).json();
    const group = before.duplicates.find((entry: { items: { id: string }[] }) => entry.items.some((item) => item.id === first));
    assert.equal(group.count, 3);
    assert.equal(group.items[0].id, first);
    const cleaned = await emi.json('POST', '/api/storage/duplicates', { keep: [first] });
    assert.equal(cleaned.statusCode, 200, cleaned.body);
    assert.deepEqual(cleaned.json(), { removed: 2, size: 6000 });
    const after = (await emi.get('/api/storage/report')).json();
    assert.ok(!after.duplicates.some((entry: { items: { id: string }[] }) => entry.items.some((item) => item.id === first)));
    assert.equal((await emi.get(`/api/nodes/${folder}/children`)).json().items.length, 0);
    assert.equal((await emi.get(`/api/nodes/${first}`)).statusCode, 200);
    assert.equal((await mia.json('POST', '/api/storage/duplicates', { keep: [first] })).statusCode, 404);
  });

  it('zeigt Fotos von diesem Tag aus früheren Jahren', async () => {
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Erinnerungen' })).json().node.id;
    const shot = (taken: string, background: string) =>
      sharp({ create: { width: 64, height: 48, channels: 3, background } })
        .jpeg()
        .withExif({ IFD2: { DateTimeOriginal: taken } })
        .toBuffer();
    await emi.upload(folder, 'Kyoto.jpg', await shot('2023:11:13 12:00:00', '#d05050'), 4096);
    await emi.upload(folder, 'Ostsee.jpg', await shot('2021:11:13 12:00:00', '#5080d0'), 4096);
    await emi.upload(folder, 'Anderer Tag.jpg', await shot('2023:11:14 12:00:00', '#50d080'), 4096);
    await emi.upload(folder, 'Heute.jpg', await shot('2026:11:13 12:00:00', '#d0d050'), 4096);
    await processNow();
    const { groups } = (await emi.get('/api/photos/memories?date=2026-11-13&offset=0')).json();
    assert.deepEqual(
      groups.map((group: { year: number; items: { name: string }[] }) => [group.year, group.items.map((item) => item.name)]),
      [
        [2023, ['Kyoto.jpg']],
        [2021, ['Ostsee.jpg']],
      ]
    );
    assert.deepEqual((await emi.get('/api/photos/memories?date=kaputt')).json().groups, []);
    assert.deepEqual((await emi.get('/api/photos/memories?date=2026-11-12&offset=0')).json().groups, []);
  });
});

describe('Verwaltung', () => {
  it('führt ein Protokoll', async () => {
    const log = (await emi.get('/api/admin/audit')).json();
    const actions = log.items.map((entry: { action: string }) => entry.action);
    assert.ok(actions.includes('user_created'));
    assert.ok(actions.includes('mail_changed'));
    assert.equal((await mia.get('/api/admin/audit')).statusCode, 403);
    const failed = new Client(app);
    await failed.get('/login', { accept: 'text/html' });
    await failed.form('/login', { _csrf: failed.cookies.get('moe_csrf')!, login: 'mia', password: 'falsch-falsch', next: '/files' });
    const failures = (await emi.get('/api/admin/audit?action=login_failed')).json();
    assert.equal(failures.items[0].details.login, 'mia');
  });

  it('listet alle Links und entfernt sie', async () => {
    const own = (await mia.get('/api/session')).json().user.rootId;
    const folder = (await mia.json('POST', `/api/nodes/${own}/folders`, { name: 'Öffentlich' })).json().node.id;
    const link = (await mia.json('POST', `/api/nodes/${folder}/links`, {})).json().link;
    const list = (await emi.get('/api/admin/links')).json().items;
    const entry = list.find((item: { id: string }) => item.id === link.id);
    assert.equal(entry.owner.username, 'mia');
    assert.equal(entry.node.name, 'Öffentlich');
    assert.equal((await emi.send({ method: 'DELETE', url: `/api/admin/links/${link.id}` })).statusCode, 200);
    assert.equal((await new Client(app).get(`/api/public/${link.token}`)).statusCode, 404);
  });

  it('übergibt Dateien beim Löschen einer Person', async () => {
    const leaClient = await login(app, 'lea', 'leas-passwort-123');
    const own = (await leaClient.get('/api/session')).json().user.rootId;
    await leaClient.upload(own, 'Abschlussarbeit.txt', Buffer.from('Kapitel 1'));
    const removed = await emi.send({ method: 'DELETE', url: `/api/admin/users/${lea}?transfer=${miaId}` });
    assert.equal(removed.statusCode, 200, removed.body);
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    const items = (await mia.get(`/api/nodes/${miaRoot}/children`)).json().items;
    const folder = items.find((item: { name: string }) => item.name === 'Von Lea');
    assert.ok(folder);
    const inner = (await mia.get(`/api/nodes/${folder.id}/children`)).json().items;
    assert.equal(inner[0].name, 'Abschlussarbeit.txt');
    assert.equal(inner[0].role, 'owner');
  });

  it('erstellt, listet und löscht Sicherungen', async () => {
    const created = await emi.json('POST', '/api/admin/backups', {});
    assert.equal(created.statusCode, 200, created.body);
    const name = created.json().item.name;
    const list = (await emi.get('/api/admin/backups')).json().items;
    assert.ok(list.some((item: { name: string }) => item.name === name));
    const download = await emi.get(`/api/admin/backups/${name}`);
    assert.equal(download.rawPayload.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await emi.get('/api/admin/backups/..%2Fmoecloud.db')).statusCode, 404);
    assert.equal((await emi.send({ method: 'DELETE', url: `/api/admin/backups/${name}` })).statusCode, 200);
  });

  it('zeigt Ankündigungen und sperrt im Wartungsmodus', async () => {
    await emi.json('PATCH', '/api/admin/settings', { 'notice.text': 'Am Sonntag gibt es ein Update', 'notice.level': 'warning' });
    const page = await mia.get('/files', { accept: 'text/html' });
    assert.match(page.body, /Am Sonntag gibt es ein Update/);
    const loginPage = await new Client(app).get('/login', { accept: 'text/html' });
    assert.match(loginPage.body, /Am Sonntag gibt es ein Update/);
    await emi.json('PATCH', '/api/admin/settings', { 'maintenance.enabled': true, 'maintenance.message': 'Wir ziehen um' });
    const blocked = await mia.get('/api/session');
    assert.equal(blocked.statusCode, 200);
    const files = await mia.get(`/api/nodes/${(await mia.get('/api/session')).json().user.rootId}/children`);
    assert.equal(files.statusCode, 503);
    const html = await mia.get('/files', { accept: 'text/html' });
    assert.equal(html.statusCode, 503);
    assert.match(html.body, /Wir ziehen um/);
    assert.equal((await emi.get(`/api/nodes/${root}/children`)).statusCode, 200);
    assert.equal((await app.inject({ method: 'PROPFIND', url: '/dav/' })).statusCode, 503);
    await emi.json('PATCH', '/api/admin/settings', { 'maintenance.enabled': false, 'notice.text': '' });
    assert.equal((await mia.get(`/api/nodes/${(await mia.get('/api/session')).json().user.rootId}/children`)).statusCode, 200);
  });

  it('liefert Metriken nur mit Token', async () => {
    assert.equal((await new Client(app).get('/metrics')).statusCode, 404);
    const token = (await emi.json('POST', '/api/admin/metrics', { enabled: true })).json().token;
    assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 401);
    const metrics = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${token}` } });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /moecloud_users\{state="active"\} \d+/);
    assert.match(metrics.body, /moecloud_database_bytes\{kind="(sqlite|postgres)",version="(SQLite|PostgreSQL) [\d.]+"\} \d+/);
  });

  it('schickt Benachrichtigungen an einen Webhook', async () => {
    const sink = await httpSink();
    try {
      const created = await emi.json('POST', '/api/admin/webhooks', {
        name: 'Eigener Dienst',
        kind: 'json',
        events: ['user_registered', 'test'],
        config: { url: `http://127.0.0.1:${sink.port}/hook`, secret: 'signatur' },
      });
      assert.equal(created.statusCode, 200, created.body);
      const item = created.json().item;
      assert.deepEqual(item.secrets, { url: true, secret: true });
      const test = await emi.json('POST', `/api/admin/webhooks/${item.id}/test`, {});
      assert.equal(test.json().ok, true);
      assert.equal(sink.received[0].method, 'POST');
      assert.match(String(sink.received[0].headers['x-moecloud-signature']), /^sha256=[0-9a-f]{64}$/);
      assert.equal(JSON.parse(sink.received[0].body).event, 'test');
      const invalid = await emi.json('POST', '/api/admin/webhooks', { kind: 'discord', config: { url: 'https://example.com/x' } });
      assert.equal(invalid.statusCode, 400);
    } finally {
      await sink.close();
    }
  });

  it('prüft, ob es eine neue Version gibt', async () => {
    const feed = await httpSink(Number(process.env.TEST_FEED_PORT), () => ({
      body: JSON.stringify({
        version: '99.0.0',
        date: '2026-12-24',
        changelog: 'https://moecloud.moestudio.net/changelog.html#v99.0.0',
        security: true,
        notes: { de: ['Neu'], en: ['New'] },
      }),
    }));
    try {
      const status = await emi.json('POST', '/api/admin/updates/check', {});
      assert.equal(status.statusCode, 200, status.body);
      assert.equal(status.json().available, true);
      assert.equal(status.json().latest.version, '99.0.0');
      const notes = (await emi.get('/api/notifications')).json();
      assert.ok(notes.items.some((note: { kind: string }) => note.kind === 'admin_update'));
    } finally {
      await feed.close();
    }
  });

  it('gibt die Übersicht mit Zustand aus', async () => {
    const overview = (await emi.get('/api/admin/overview')).json();
    assert.ok(overview.groups.image.count >= 1);
    assert.ok(overview.top.length >= 1);
    assert.equal(overview.health.mail, true);
    assert.equal(overview.updates.available, true);
    const today = overview.history.at(-1);
    assert.equal(today.day, new Date().toISOString().slice(0, 10));
    assert.equal(today.bytes, overview.logical);
    assert.equal(today.files, overview.files);
  });

  it('merkt sich den Speicher Tag für Tag', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    assert.equal(recordUsage(now - 2 * day, true), true);
    assert.equal(recordUsage(now - day, true), true);
    assert.equal(recordUsage(now - day + 1000), false);
    const history = usageHistory(365, now);
    assert.deepEqual(
      history.slice(-3).map((entry) => entry.day),
      [now - 2 * day, now - day, now].map((time) => new Date(time).toISOString().slice(0, 10))
    );
    assert.equal(usageHistory(1, now).length, 1);
    recordUsage(now - 4 * 366 * day, true);
    recordUsage(now, true);
    assert.ok(usageHistory(5000, now).every((entry) => entry.day >= new Date(now - 3 * 366 * day).toISOString().slice(0, 10)));
  });
});
