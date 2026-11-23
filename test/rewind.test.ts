import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { one, run } from '../src/lib/db.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

const HOUR = 3_600_000;

interface Node {
  id: string;
  name: string;
}

interface Preview {
  counts: { trash: number; restore: number; rename: number; content: number; missing: number; deleted: number };
  total: number;
  items: { id: string; name: string; path: string; action: string; from?: string }[];
}

async function folder(client: Client, parent: string, name: string) {
  const made = await client.json('POST', `/api/nodes/${parent}/folders`, { name });
  assert.equal(made.statusCode, 200, made.body);
  return made.json().node as Node;
}

async function text(client: Client, parent: string, name: string, content: string) {
  const made = await client.json('POST', `/api/nodes/${parent}/text`, { name, content });
  assert.equal(made.statusCode, 200, made.body);
  return made.json().node as Node;
}

async function overwrite(client: Client, id: string, content: string) {
  const written = await client.send({
    method: 'PUT',
    url: `/api/nodes/${id}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(content),
  });
  assert.equal(written.statusCode, 200, written.body);
}

const read = async (id: string) => (await emi.get(`/api/nodes/${id}/content`)).body;
const node = (id: string) =>
  one<{ name: string; parent_id: string; trashed_at: number | null }>('SELECT name, parent_id, trashed_at FROM nodes WHERE id = ?', id)!;

function age(ms: number) {
  run('UPDATE nodes SET created_at = created_at - ?, updated_at = updated_at - ?, modified_at = modified_at - ?', ms, ms, ms);
  run('UPDATE versions SET created_at = created_at - ?, modified_at = modified_at - ?', ms, ms);
  run('UPDATE activity SET created_at = created_at - ?', ms);
  run('UPDATE nodes SET trashed_at = trashed_at - ? WHERE trashed_at IS NOT NULL', ms);
}

const preview = async (id: string, at: number, client = emi) => {
  const response = await client.get(`/api/nodes/${id}/rewind?at=${at}`);
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as Preview;
};

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
});

after(async () => {
  await app.close();
});

describe('Auf einen früheren Stand zurücksetzen', () => {
  it('holt Inhalte, Namen und Gelöschtes zurück und legt Neues in den Papierkorb', async () => {
    const project = await folder(emi, root, 'Projekt');
    const letter = await text(emi, project.id, 'brief.txt', 'Liebe Lea, hier ist der Plan.');
    const notes = await text(emi, project.id, 'notizen.md', 'Notizen, erste Fassung');
    await overwrite(emi, notes.id, 'Notizen, zweite Fassung');
    const photo = await text(emi, project.id, 'foto.txt', 'Ein Foto vom See');
    const gone = await text(emi, project.id, 'weg.txt', 'Das bleibt hoffentlich');
    const archive = await folder(emi, project.id, 'alt');
    const plan = await text(emi, archive.id, 'plan.txt', 'Der alte Plan');
    age(2 * HOUR);
    const at = Date.now() - HOUR;

    await overwrite(emi, letter.id, 'VERSCHLUESSELT 1');
    await overwrite(emi, notes.id, 'VERSCHLUESSELT 2');
    await overwrite(emi, notes.id, 'VERSCHLUESSELT 3');
    assert.equal((await emi.json('PATCH', `/api/nodes/${photo.id}`, { name: 'foto.txt.verschluesselt' })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/nodes/trash', { ids: [gone.id] })).statusCode, 200);
    const note = await text(emi, project.id, 'LIES_MICH.txt', 'Zahl uns');
    const fresh = await folder(emi, project.id, 'neu');
    await text(emi, fresh.id, 'drin.txt', 'Auch neu');
    const collection = await folder(emi, project.id, 'Sammlung');
    assert.equal((await emi.json('POST', '/api/nodes/move', { ids: [plan.id], target: collection.id })).statusCode, 200);

    const plan1 = await preview(project.id, at);
    assert.deepEqual(plan1.counts, { trash: 2, restore: 1, rename: 1, content: 2, missing: 0, deleted: 0 });
    assert.equal(plan1.total, 6);
    const byName = Object.fromEntries(plan1.items.map((item) => [item.name, item]));
    assert.equal(byName['brief.txt'].action, 'content');
    assert.equal(byName['notizen.md'].action, 'content');
    assert.equal(byName['foto.txt.verschluesselt'].action, 'rename');
    assert.equal(byName['foto.txt.verschluesselt'].from, 'foto.txt');
    assert.equal(byName['weg.txt'].action, 'restore');
    assert.equal(byName['LIES_MICH.txt'].action, 'trash');
    assert.equal(byName['neu'].action, 'trash');
    assert.equal(byName['drin.txt'], undefined, 'liegt in einem neuen Ordner, der als Ganzes geht');
    assert.equal(byName['Sammlung'], undefined, 'enthält eine ältere Datei und bleibt');
    assert.equal(byName['plan.txt'], undefined);

    const applied = await emi.json('POST', `/api/nodes/${project.id}/rewind`, { at });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.deepEqual(applied.json().done, { trash: 2, restore: 1, rename: 1, content: 2 });
    assert.equal(applied.json().skipped, 0);

    assert.equal(await read(letter.id), 'Liebe Lea, hier ist der Plan.');
    assert.equal(await read(notes.id), 'Notizen, zweite Fassung');
    assert.equal(node(photo.id).name, 'foto.txt');
    assert.equal(node(gone.id).trashed_at, null);
    assert.equal(node(gone.id).parent_id, project.id);
    assert.notEqual(node(note.id).trashed_at, null);
    assert.notEqual(node(fresh.id).trashed_at, null);
    assert.equal(node(collection.id).trashed_at, null);
    assert.equal(node(plan.id).trashed_at, null);

    const versions = (await emi.get(`/api/nodes/${letter.id}/versions`)).json().items as { id: string }[];
    assert.ok(versions.length >= 1, 'der verschlüsselte Inhalt bleibt als Version erhalten');

    const again = await preview(project.id, at);
    assert.equal(again.total, 0, JSON.stringify(again.items));
  });

  it('meldet, wenn die passende Version schon aufgeräumt ist', async () => {
    const box = await folder(emi, root, 'Kiste');
    const file = await text(emi, box.id, 'liste.txt', 'Inhalt von damals');
    age(2 * HOUR);
    const at = Date.now() - HOUR;
    const keep = settings.get('storage.versions');
    settings.set('storage.versions', 1);
    try {
      await overwrite(emi, file.id, 'zweite');
      await overwrite(emi, file.id, 'dritte');
      await overwrite(emi, file.id, 'vierte');
    } finally {
      settings.set('storage.versions', keep);
    }
    const plan = await preview(box.id, at);
    assert.equal(plan.counts.missing, 1);
    assert.equal(plan.counts.content, 0);
    assert.equal(plan.total, 0);
    assert.equal(plan.items[0].action, 'missing');
    const applied = (await emi.json('POST', `/api/nodes/${box.id}/rewind`, { at })).json();
    assert.equal(applied.missing, 1);
    assert.equal(await read(file.id), 'vierte');
  });

  it('zählt endgültig Gelöschtes, das sich nicht mehr zurückholen lässt', async () => {
    const box = await folder(emi, root, 'Leer');
    const file = await text(emi, box.id, 'kurz.txt', 'Gleich weg');
    age(2 * HOUR);
    const at = Date.now() - HOUR;
    await emi.json('POST', '/api/nodes/trash', { ids: [file.id] });
    assert.equal((await emi.json('POST', '/api/nodes/delete', { ids: [file.id] })).statusCode, 200);
    const plan = await preview(box.id, at);
    assert.equal(plan.counts.deleted, 1);
    assert.equal(plan.total, 0);
  });

  it('setzt auch den ganzen Speicher zurück', async () => {
    const before = await text(emi, root, 'oben.txt', 'Oben');
    age(2 * HOUR);
    const at = Date.now() - HOUR;
    await overwrite(emi, before.id, 'Oben verschlüsselt');
    const plan = await preview(root, at);
    assert.ok(plan.items.some((item) => item.id === before.id && item.action === 'content'));
    assert.equal((await emi.json('POST', `/api/nodes/${root}/rewind`, { at })).statusCode, 200);
    assert.equal(await read(before.id), 'Oben');
  });

  it('prüft Zeitpunkt und Rechte', async () => {
    const box = await folder(emi, root, 'Geschützt');
    for (const at of [String(Date.now() + HOUR), '0', 'abc', String(Date.now() - 400 * 24 * HOUR), '1.5']) {
      assert.equal((await emi.get(`/api/nodes/${box.id}/rewind?at=${at}`)).statusCode, 400, at);
    }
    assert.equal((await emi.json('POST', `/api/nodes/${box.id}/rewind`, { at: 'gestern' })).statusCode, 400);
    const foreign = await mia.get(`/api/nodes/${box.id}/rewind?at=${Date.now() - HOUR}`);
    assert.equal(foreign.statusCode, 404);
    assert.equal((await mia.json('POST', `/api/nodes/${box.id}/rewind`, { at: Date.now() - HOUR })).statusCode, 404);
    const miaId = (await mia.get('/api/session')).json().user.id as number;
    const shared = await emi.json('POST', `/api/nodes/${box.id}/grants`, { userId: miaId, permission: 'edit' });
    assert.equal(shared.statusCode, 200, shared.body);
    const edit = await mia.get(`/api/nodes/${box.id}/rewind?at=${Date.now() - HOUR}`);
    assert.equal(edit.statusCode, 400);
    assert.match(edit.json().error.message, /nur in deinen eigenen Ordnern/);
    const file = await text(emi, root, 'datei.txt', 'Keine Mappe');
    assert.equal((await emi.get(`/api/nodes/${file.id}/rewind?at=${Date.now() - HOUR}`)).statusCode, 400);
  });
});
