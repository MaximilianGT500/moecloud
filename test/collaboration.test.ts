import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, fakeClamd, login, setUp, zip } from './helpers.ts';
import { EICAR } from '../src/lib/clamav.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let root = '';
let miaId = 0;
let leaId = 0;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  leaId = (await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
});

const clamd = await fakeClamd((data) =>
  data.toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'Eicar-Signature' : null
);

after(async () => {
  await clamd.close();
  await app.close();
});

describe('Gruppen', () => {
  let groupId = 0;
  let folder = '';
  let grantId = '';

  it('legt Gruppen nur für Admins an', async () => {
    const denied = await mia.json('POST', '/api/admin/groups', { name: 'Familie' });
    assert.equal(denied.statusCode, 403);
    const created = await emi.json('POST', '/api/admin/groups', { name: 'Familie', members: [miaId] });
    assert.equal(created.statusCode, 200, created.body);
    groupId = created.json().group.id;
    assert.deepEqual(
      created.json().group.members.map((member: { name: string }) => member.name),
      ['Mia']
    );
    const twice = await emi.json('POST', '/api/admin/groups', { name: ' familie ' });
    assert.equal(twice.statusCode, 409);
  });

  it('teilt einen Ordner mit allen Mitgliedern', async () => {
    folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Urlaub' })).json().node.id;
    await emi.upload(folder, 'plan.txt', Buffer.from('Packliste'));
    const search = (await emi.get('/api/users/search?q=fam')).json();
    assert.equal(search.groups[0].name, 'Familie');
    const shared = await emi.json('POST', `/api/nodes/${folder}/grants`, { groupId, permission: 'view' });
    assert.equal(shared.statusCode, 200, shared.body);
    grantId = shared.json().grant.id;
    assert.equal(shared.json().grant.group.name, 'Familie');
    const withMia = (await mia.get('/api/shared')).json();
    assert.equal(withMia.withMe[0].name, 'Urlaub');
    assert.equal(withMia.withMe[0].viaGroup, 'Familie');
    assert.equal((await mia.get(`/api/nodes/${folder}/children`)).statusCode, 200);
    assert.equal((await lea.get(`/api/nodes/${folder}/children`)).statusCode, 404);
    const notes = (await mia.get('/api/notifications')).json();
    assert.match(notes.items[0].title, /Gruppe Familie/);
    const upload = await mia.upload(folder, 'idee.txt', Buffer.from('Mehr Eis'));
    assert.equal(upload.statusCode, 403);
  });

  it('gibt neuen Mitgliedern sofort Zugriff und nimmt ihn beim Entfernen wieder', async () => {
    const updated = await emi.json('PATCH', `/api/admin/groups/${groupId}`, { members: [miaId, leaId] });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal((await lea.get(`/api/nodes/${folder}/children`)).statusCode, 200);
    await emi.json('PATCH', `/api/admin/groups/${groupId}`, { members: [leaId] });
    assert.equal((await mia.get(`/api/nodes/${folder}/children`)).statusCode, 404);
    assert.equal((await mia.get('/api/shared')).json().withMe.length, 0);
  });

  it('ändert das Recht und erlaubt dann Uploads', async () => {
    const changed = await emi.json('PATCH', `/api/grants/${grantId}`, { permission: 'edit' });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().grant.permission, 'edit');
    const upload = await lea.upload(folder, 'idee.txt', Buffer.from('Mehr Eis'));
    assert.equal(upload.statusCode, 200, upload.body);
    const rename = await lea.json('PATCH', `/api/nodes/${folder}`, { name: 'Meins' });
    assert.equal(rename.statusCode, 403);
  });

  it('lässt nur mit eigenen Gruppen teilen', async () => {
    const other = (await emi.json('POST', '/api/admin/groups', { name: 'Team' })).json().group.id;
    const own = (
      await mia.json('POST', `/api/nodes/${(await mia.get('/api/session')).json().user.rootId}/folders`, { name: 'Notizen' })
    ).json().node.id;
    const denied = await mia.json('POST', `/api/nodes/${own}/grants`, { groupId: other, permission: 'view' });
    assert.equal(denied.statusCode, 404);
    assert.equal((await mia.get('/api/users/search?q=tea')).json().groups.length, 0);
  });

  it('räumt beim Löschen der Gruppe alle Freigaben weg', async () => {
    const byMe = (await emi.get('/api/shared')).json();
    assert.equal(byMe.grants[0].group.name, 'Familie');
    const removed = await emi.json('DELETE', `/api/admin/groups/${groupId}`);
    assert.equal(removed.statusCode, 200);
    assert.equal((await lea.get(`/api/nodes/${folder}/children`)).statusCode, 404);
    assert.equal((await emi.get('/api/shared')).json().grants.length, 0);
    const audit = (await emi.get('/api/admin/audit?action=group_deleted')).json();
    assert.equal(audit.items[0].details.name, 'Familie');
  });
});

describe('Archive entpacken', () => {
  it('entpackt ein ZIP mit Ordnern in einen neuen Ordner', async () => {
    const archive = await zip({
      'Rezepte/': '',
      'Rezepte/Kuchen.txt': 'Zucker, Mehl, Eier',
      'Rezepte/Suppen/Tomate.txt': 'Tomaten',
      'Notiz.md': '# Hallo',
      '__MACOSX/._Notiz.md': 'Müll',
      '.DS_Store': 'Müll',
    });
    const node = (await emi.upload(root, 'Sammlung.zip', archive, 1024)).json().node;
    const result = await emi.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().files, 3);
    assert.equal(result.json().folder.name, 'Sammlung');
    const inside = (await emi.get(`/api/nodes/${result.json().folderId}/children`)).json().items.map((item: { name: string }) => item.name);
    assert.deepEqual(inside.sort(), ['Notiz.md', 'Rezepte']);
    const found = (await emi.get('/api/search?q=Tomate')).json().items;
    assert.ok(found.some((item: { name: string }) => item.name === 'Tomate.txt'));
    const again = await emi.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.notEqual(again.json().folder.name, 'Sammlung');
    const activity = (await emi.get(`/api/nodes/${root}/activity`)).json().items;
    assert.ok(activity.some((entry: { action: string }) => entry.action === 'extract'));
  });

  it('überspringt Schadsoftware im Archiv', async () => {
    await emi.json('PATCH', '/api/admin/scan', { 'scan.enabled': true, 'scan.host': '127.0.0.1', 'scan.port': clamd.port });
    try {
      const archive = await zip({ 'gut.txt': 'Nur Text', 'boese.com': EICAR });
      const node = (await emi.upload(root, 'Gemischt.zip', archive, 4096)).json().node;
      const result = await emi.json('POST', `/api/nodes/${node.id}/extract`, {});
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().files, 1);
      assert.equal(result.json().skipped.infected, 1);
    } finally {
      await emi.json('PATCH', '/api/admin/scan', { 'scan.enabled': false });
    }
  });

  it('achtet auf Speicher und Rechte', async () => {
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    const big = await zip({ 'gross.bin': Buffer.alloc(200_000, 7) });
    const node = (await mia.upload(miaRoot, 'Gross.zip', big, 65536)).json().node;
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: 150_000 });
    const full = await mia.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.equal(full.statusCode, 507);
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: null });
    const folder = (await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Geteilt' })).json().node.id;
    const moved = await mia.json('POST', '/api/nodes/move', { ids: [node.id], target: folder });
    assert.equal(moved.statusCode, 200, moved.body);
    await mia.json('POST', `/api/nodes/${folder}/grants`, { userId: leaId, permission: 'view' });
    const denied = await lea.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.equal(denied.statusCode, 403);
  });

  it('lehnt kaputte Archive ab', async () => {
    const node = (await emi.upload(root, 'Kaputt.zip', Buffer.from('kein zip'), 64)).json().node;
    const result = await emi.json('POST', `/api/nodes/${node.id}/extract`, {});
    assert.equal(result.statusCode, 400);
  });
});

describe('Links mit Grenzen', () => {
  let file = '';

  before(async () => {
    file = (await emi.upload(root, 'Angebot.txt', Buffer.from('Nur für dich'))).json().node.id;
  });

  it('läuft nach der erlaubten Zahl an Downloads ab', async () => {
    const created = await emi.json('POST', `/api/nodes/${file}/links`, { maxDownloads: 2 });
    assert.equal(created.statusCode, 200, created.body);
    const { token, maxDownloads } = created.json().link;
    assert.equal(maxDownloads, 2);
    const guest = new Client(app);
    assert.equal((await guest.get(`/api/public/${token}`)).json().share.downloadsLeft, 2);
    const preview = await guest.get(`/api/public/${token}/nodes/${file}/content`);
    assert.equal(preview.body, 'Nur für dich');
    const resumed = await guest.get(`/api/public/${token}/nodes/${file}/content?download=1`, { range: 'bytes=4-' });
    assert.equal(resumed.statusCode, 206);
    assert.equal((await guest.get(`/api/public/${token}`)).json().share.downloadsLeft, 2);
    for (let round = 0; round < 2; round++) {
      const download = await guest.get(`/api/public/${token}/nodes/${file}/content?download=1`);
      assert.equal(download.statusCode, 200, download.body);
    }
    const blocked = await guest.get(`/api/public/${token}/nodes/${file}/content?download=1`);
    assert.equal(blocked.statusCode, 404);
    const page = await guest.get(`/s/${token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 404);
    assert.match(page.body, /so oft genutzt/);
    const listed = (await emi.get(`/api/nodes/${file}/shares`)).json().links[0];
    assert.equal(listed.exhausted, true);
    assert.equal(listed.downloads, 2);
    const raised = await emi.json('PATCH', `/api/links/${listed.id}`, { maxDownloads: 3 });
    assert.equal(raised.statusCode, 200, raised.body);
    assert.equal((await guest.get(`/api/public/${token}`)).json().share.downloadsLeft, 1);
  });

  it('pausiert Links und gibt sie wieder frei', async () => {
    const { id, token } = (await emi.json('POST', `/api/nodes/${file}/links`, {})).json().link;
    const guest = new Client(app);
    assert.equal((await guest.get(`/api/public/${token}`)).json().share.downloadsLeft, null);
    const paused = await emi.json('PATCH', `/api/links/${id}`, { paused: true });
    assert.equal(paused.json().link.paused, true);
    const page = await guest.get(`/s/${token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 404);
    assert.match(page.body, /pausiert/);
    assert.equal((await guest.get(`/api/public/${token}/nodes/${file}/content`)).statusCode, 404);
    const admin = (await emi.get('/api/admin/links')).json().items.find((link: { id: string }) => link.id === id);
    assert.equal(admin.paused, true);
    await emi.json('PATCH', `/api/links/${id}`, { paused: false });
    assert.equal((await guest.get(`/s/${token}`, { accept: 'text/html' })).statusCode, 200);
  });

  it('lehnt unsinnige Grenzen ab', async () => {
    const zero = await emi.json('POST', `/api/nodes/${file}/links`, { maxDownloads: 0 });
    assert.equal(zero.statusCode, 400);
  });
});

describe('Bilder drehen', () => {
  it('dreht ein Bild und behält die alte Fassung', async () => {
    const png = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#8b5cf6' } })
      .png()
      .toBuffer();
    const node = (await emi.upload(root, 'Quer.png', png, 1024)).json().node;
    const rotated = await emi.json('POST', `/api/nodes/${node.id}/rotate`, { degrees: 90 });
    assert.equal(rotated.statusCode, 200, rotated.body);
    assert.notEqual(rotated.json().node.version, node.version);
    const content = await emi.get(`/api/nodes/${node.id}/content`);
    const meta = await sharp(content.rawPayload).metadata();
    assert.equal(meta.width, 2);
    assert.equal(meta.height, 4);
    assert.equal(meta.format, 'png');
    const versions = (await emi.get(`/api/nodes/${node.id}/versions`)).json().items;
    assert.equal(versions.length, 1);
    const activity = (await emi.get(`/api/nodes/${node.id}/activity`)).json().items;
    assert.equal(activity[0].action, 'rotate');
  });

  it('dreht nur Bilder und nur mit Bearbeitungsrecht', async () => {
    const text = (await emi.upload(root, 'Text.txt', Buffer.from('Kein Bild'))).json().node;
    assert.equal((await emi.json('POST', `/api/nodes/${text.id}/rotate`, { degrees: 90 })).statusCode, 400);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Bilder' })).json().node.id;
    const image = (await emi.upload(folder, 'Klein.png', png, 1024)).json().node;
    await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: miaId, permission: 'view' });
    assert.equal((await mia.json('POST', `/api/nodes/${image.id}/rotate`, { degrees: 90 })).statusCode, 403);
    assert.equal((await emi.json('POST', `/api/nodes/${image.id}/rotate`, { degrees: 45 })).statusCode, 400);
  });
});
