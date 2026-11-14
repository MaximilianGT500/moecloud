import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/lib/db.ts';
import { applyRules } from '../src/services/rules.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaId = 0;

async function folder(parent: string, name: string) {
  const response = await emi.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

async function file(parent: string, name: string, age = 0) {
  const response = await emi.upload(parent, name, Buffer.from(`${name} von Lea`));
  assert.equal(response.statusCode, 200, response.body);
  const id = response.json().node.id as string;
  if (age) run('UPDATE nodes SET updated_at = ? WHERE id = ?', Date.now() - age * DAY, id);
  return id;
}

const trashed = async () => ((await emi.get('/api/trash')).json().items as { name: string }[]).map((item) => item.name).sort();

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const created = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'passwort-von-mia',
  });
  miaId = created.json().user.id;
  mia = await login(app, 'mia', 'passwort-von-mia');
});

after(() => app.close());

describe('Aufräumregeln', () => {
  let downloads = '';

  it('legt alte Dateien nach der Frist in den Papierkorb', async () => {
    downloads = await folder(root, 'Downloads');
    const inner = await folder(downloads, 'Rechnungen');
    await file(downloads, 'Alt.pdf', 40);
    await file(inner, 'Tief.pdf', 31);
    await file(downloads, 'Neu.pdf');
    await file(downloads, 'Knapp.pdf', 29);
    const saved = await emi.json('PUT', `/api/nodes/${downloads}/cleanup`, { days: 30 });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().cleanup, 30);
    const shown = (await emi.get(`/api/nodes/${root}/children`)).json().items.find((item: { id: string }) => item.id === downloads);
    assert.equal(shown.cleanup, 30);
    assert.equal(applyRules(), 2);
    assert.deepEqual(await trashed(), ['Alt.pdf', 'Tief.pdf']);
    const names = ((await emi.get(`/api/nodes/${downloads}/children`)).json().items as { name: string }[]).map((item) => item.name).sort();
    assert.deepEqual(names, ['Knapp.pdf', 'Neu.pdf', 'Rechnungen']);
    const notes = (await emi.get('/api/notifications')).json().items;
    assert.equal(notes[0].kind, 'cleanup');
    assert.equal(notes[0].title, '2 Dateien aus „Downloads“ aufgeräumt');
    assert.equal(notes[0].url, '/files/trash');
    assert.equal(applyRules(), 0);
  });

  it('lässt Wiederhergestelltes wieder die volle Frist liegen', async () => {
    const old = ((await emi.get('/api/trash')).json().items as { id: string; name: string }[]).find((item) => item.name === 'Alt.pdf')!;
    const restored = await emi.json('POST', '/api/nodes/restore', { ids: [old.id] });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(applyRules(Date.now() + 2 * 60 * 60 * 1000), 0);
    assert.deepEqual(await trashed(), ['Tief.pdf']);
  });

  it('erlaubt Regeln nur für eigene Ordner', async () => {
    const shared = await folder(root, 'Gemeinsam');
    await emi.json('POST', `/api/nodes/${shared}/grants`, { userId: miaId, permission: 'edit' });
    assert.equal((await mia.json('PUT', `/api/nodes/${shared}/cleanup`, { days: 7 })).statusCode, 403);
    assert.equal((await emi.json('PUT', `/api/nodes/${root}/cleanup`, { days: 7 })).statusCode, 400);
    const single = await file(shared, 'Einzeln.txt');
    assert.equal((await emi.json('PUT', `/api/nodes/${single}/cleanup`, { days: 7 })).statusCode, 400);
    const zero = await emi.json('PUT', `/api/nodes/${shared}/cleanup`, { days: 0 });
    assert.equal(zero.statusCode, 400);
    assert.equal(zero.json().error.message, 'Wähle zwischen 1 und 3650 Tagen');
    await emi.json('PUT', `/api/nodes/${shared}/cleanup`, { days: 14 });
    assert.equal((await mia.get(`/api/nodes/${shared}/children`)).json().folder.cleanup, 14);
  });

  it('schaltet die Regel wieder aus', async () => {
    const off = await emi.json('PUT', `/api/nodes/${downloads}/cleanup`, { days: null });
    assert.equal(off.json().cleanup, null);
    run('UPDATE nodes SET updated_at = ? WHERE parent_id = ?', Date.now() - 400 * DAY, downloads);
    assert.equal(applyRules(Date.now() + 2 * 60 * 60 * 1000), 0);
  });
});
