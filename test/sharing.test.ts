import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { run } from '../src/lib/db.ts';
import { expireGrants } from '../src/services/grants.ts';
import { expireGroupGrants } from '../src/services/groups.ts';
import { flushWatches } from '../src/services/watches.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaId = 0;
const hour = 3_600_000;

async function folder(parent: string, name: string): Promise<string> {
  return (await emi.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function file(client: Client, parent: string, name: string, content: Buffer | string = 'Hallo Lea'): Promise<string> {
  const response = await client.upload(parent, name, Buffer.from(content), 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

const names = (items: { name: string }[]) => items.map((item) => item.name).sort();

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await app.close();
});

describe('Suchfilter', () => {
  it('filtert nach Datum, Größe, Art und Schlagwort, auch ohne Suchbegriff', async () => {
    const place = await folder(root, 'Archiv');
    const old = await file(emi, place, 'Rechnung alt.pdf', 'a'.repeat(10));
    const fresh = await file(emi, place, 'Rechnung neu.pdf', 'b'.repeat(5000));
    await file(emi, place, 'Notiz Rechnung.txt', 'c');
    run('UPDATE nodes SET modified_at = ? WHERE id = ?', Date.now() - 400 * 24 * hour, old);
    const search = async (params: Record<string, string | number>) =>
      names(
        (await emi.get(`/api/search?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`)).json()
          .items
      );
    assert.deepEqual(await search({ q: 'Rechnung' }), ['Notiz Rechnung.txt', 'Rechnung alt.pdf', 'Rechnung neu.pdf']);
    assert.deepEqual(await search({ q: 'Rechnung', after: Date.now() - 30 * 24 * hour }), ['Notiz Rechnung.txt', 'Rechnung neu.pdf']);
    assert.deepEqual(await search({ q: 'Rechnung', before: Date.now() - 365 * 24 * hour }), ['Rechnung alt.pdf']);
    assert.deepEqual(await search({ q: 'Rechnung', minSize: 1000 }), ['Rechnung neu.pdf']);
    assert.deepEqual(await search({ q: 'Rechnung', maxSize: 100, kind: 'pdf' }), ['Rechnung alt.pdf']);
    assert.deepEqual(await search({ minSize: 1000 }), ['Rechnung neu.pdf']);
    assert.deepEqual(await search({ q: '' }), []);
    const tag = (await emi.json('POST', '/api/tags', { name: 'Steuer', color: 'green' })).json().tag.id;
    await emi.json('PUT', '/api/nodes/tags', { ids: [fresh], add: [tag] });
    assert.deepEqual(await search({ tag }), ['Rechnung neu.pdf']);
    assert.deepEqual(await search({ q: 'Notiz', tag }), []);
    assert.deepEqual(await search({ q: 'Rechnung', minSize: 'viel' }), ['Notiz Rechnung.txt', 'Rechnung alt.pdf', 'Rechnung neu.pdf']);
  });
});

describe('Freigaben mit Ablaufdatum', () => {
  it('endet zur festgelegten Zeit für Personen und Gruppen', async () => {
    const place = await folder(root, 'Für eine Woche');
    const inside = await file(emi, place, 'Plan.txt');
    const past = await emi.json('POST', `/api/nodes/${place}/grants`, { userId: miaId, permission: 'view', expiresAt: Date.now() - 1000 });
    assert.equal(past.statusCode, 400);
    assert.equal(past.json().error.message, 'Das Ablaufdatum muss in der Zukunft liegen');
    const created = await emi.json('POST', `/api/nodes/${place}/grants`, {
      userId: miaId,
      permission: 'view',
      expiresAt: Date.now() + hour,
    });
    assert.equal(created.statusCode, 200, created.body);
    const grant = created.json().grant;
    assert.ok(grant.expiresAt > Date.now());
    assert.equal((await mia.get(`/api/nodes/${inside}`)).statusCode, 200);
    const shared = (await mia.get('/api/shared')).json().withMe.find((item: { id: string }) => item.id === place);
    assert.equal(shared.shareEnds, grant.expiresAt);

    const endless = await emi.json('PATCH', `/api/grants/${grant.id}`, { expiresAt: null });
    assert.equal(endless.json().grant.expiresAt, null);
    assert.equal(endless.json().grant.permission, 'view');
    await emi.json('PATCH', `/api/grants/${grant.id}`, { expiresAt: Date.now() + hour, permission: 'edit' });

    run('UPDATE grants SET expires_at = ? WHERE id = ?', Date.now() - 1, grant.id);
    assert.equal((await mia.get(`/api/nodes/${inside}`)).statusCode, 404);
    assert.equal(
      (await mia.get('/api/shared')).json().withMe.some((item: { id: string }) => item.id === place),
      false
    );
    const again = await emi.json('POST', `/api/nodes/${place}/grants`, { userId: miaId, permission: 'view', expiresAt: Date.now() + hour });
    assert.equal(again.statusCode, 200, again.body);
    run('UPDATE grants SET expires_at = ? WHERE id = ?', Date.now() - 1, again.json().grant.id);
    assert.equal(expireGrants(), 1);
    assert.equal((await emi.get(`/api/nodes/${place}/shares`)).json().grants.length, 0);
    const activity = (await emi.get('/api/activity')).json().items;
    assert.ok(
      activity.some(
        (entry: { action: string; details: { expired?: boolean } }) => entry.action === 'unshare_user' && entry.details?.expired
      )
    );

    const group = (await emi.json('POST', '/api/admin/groups', { name: 'Familie', members: [miaId] })).json().group;
    const viaGroup = await emi.json('POST', `/api/nodes/${place}/grants`, {
      groupId: group.id,
      permission: 'view',
      expiresAt: Date.now() + hour,
    });
    assert.equal(viaGroup.statusCode, 200, viaGroup.body);
    assert.equal((await mia.get(`/api/nodes/${inside}`)).statusCode, 200);
    run('UPDATE group_grants SET expires_at = ? WHERE id = ?', Date.now() - 1, viaGroup.json().grant.id);
    assert.equal((await mia.get(`/api/nodes/${inside}`)).statusCode, 404);
    assert.equal(expireGroupGrants(), 1);
  });
});

describe('Ordner beobachten', () => {
  it('meldet Änderungen anderer in beobachteten Ordnern gesammelt', async () => {
    const team = await folder(root, 'Team');
    const sub = await folder(team, 'Entwürfe');
    await emi.json('POST', `/api/nodes/${team}/grants`, { userId: miaId, permission: 'edit' });
    assert.equal((await mia.json('PUT', `/api/nodes/${team}/watch`, { watching: true })).json().watching, true);
    assert.equal((await mia.get(`/api/nodes/${root}/children`)).statusCode, 404);
    const listed = (await mia.get('/api/shared')).json().withMe.find((item: { id: string }) => item.id === team);
    assert.equal(listed.watching, true);
    assert.equal((await emi.json('PUT', `/api/nodes/${team}/watch`, { watching: true })).statusCode, 200);
    assert.equal((await emi.json('PUT', `/api/nodes/${root}/watch`, { watching: true })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/nodes/${await file(emi, team, 'Datei.txt')}/watch`, { watching: true })).statusCode, 400);
    flushWatches();
    await mia.json('POST', '/api/notifications/read', {});
    await emi.json('DELETE', '/api/notifications');
    await mia.json('DELETE', '/api/notifications');

    await file(emi, sub, 'Kapitel 1.md');
    await file(emi, sub, 'Kapitel 2.md');
    await file(mia, team, 'Ideen von Mia.md');
    flushWatches();
    const forMia = (await mia.get('/api/notifications')).json().items;
    assert.deepEqual(
      forMia.map((entry: { title: string; text: string; url: string }) => [entry.title, entry.text, entry.url]),
      [['Emi hat in „Team“ etwas geändert', '2 neue Elemente', `/files/folder/${team}`]]
    );
    const forEmi = (await emi.get('/api/notifications')).json().items;
    assert.deepEqual(
      forEmi.map((entry: { title: string; text: string }) => [entry.title, entry.text]),
      [['Mia hat in „Team“ etwas geändert', 'Neu: Ideen von Mia.md']]
    );

    assert.equal((await mia.json('PUT', `/api/nodes/${team}/watch`, { watching: false })).json().watching, false);
    await file(emi, team, 'Noch eine.txt');
    flushWatches();
    assert.equal((await mia.get('/api/notifications')).json().items.length, 1);
  });
});
