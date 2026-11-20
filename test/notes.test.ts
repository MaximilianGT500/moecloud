import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { run } from '../src/lib/db.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaRoot = '';
let miaId = 0;

interface Note {
  id: string;
  name: string;
  title: string;
  excerpt: string;
  category: string;
  parentId: string;
  starred?: boolean;
}

const names = async (client: Client, id: string) =>
  ((await client.get(`/api/nodes/${id}/children`)).json().items as { name: string }[]).map((item) => item.name).sort();

const notes = async (client: Client) =>
  (await client.get('/api/notes')).json() as { folderId: string | null; items: Note[]; more: boolean };

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
});

after(async () => {
  await app.close();
});

describe('Notizen', () => {
  let first = '';
  let folderId = '';

  it('legt den Ordner erst mit der ersten Notiz an', async () => {
    assert.deepEqual(await notes(emi), { folderId: null, items: [], more: false });
    assert.deepEqual(await names(emi, root), []);
    const created = await emi.json('POST', '/api/notes', { title: 'Einkauf', content: '# Samstag\n\n- [ ] Brot\n- [x] **Milch**\n' });
    assert.equal(created.statusCode, 200, created.body);
    const note = created.json().note as Note;
    first = note.id;
    assert.equal(note.name, 'Einkauf.md');
    assert.equal(note.title, 'Einkauf');
    assert.equal(note.excerpt, 'Samstag Brot Milch');
    assert.equal(note.category, '');
    assert.deepEqual(await names(emi, root), ['Notizen']);
    const listed = await notes(emi);
    folderId = listed.folderId!;
    assert.equal(note.parentId, folderId);
    assert.deepEqual(
      listed.items.map((item) => item.title),
      ['Einkauf']
    );
  });

  it('zählt gleiche Titel hoch, sortiert in Kategorien ein und zeigt nur Textdateien', async () => {
    const second = (await emi.json('POST', '/api/notes', { title: 'Einkauf' })).json().note as Note;
    assert.equal(second.name, 'Einkauf (2).md');
    const untitled = (await emi.json('POST', '/api/notes', {})).json().note as Note;
    assert.equal(untitled.title, 'Neue Notiz');
    const sorted = (
      await emi.json('POST', '/api/notes', { title: 'Angebot', content: 'Bis Freitag', category: ' Arbeit / Kunden ' })
    ).json().note as Note;
    assert.equal(sorted.category, 'Arbeit/Kunden');
    assert.deepEqual(await names(emi, folderId), ['Arbeit', 'Einkauf (2).md', 'Einkauf.md', 'Neue Notiz.md']);
    assert.equal((await emi.json('POST', '/api/notes', { title: 'Tief', category: 'a/b/c/d' })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/notes', { title: 'Falsch', category: 'Einkauf.md' })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/notes', { title: 'a/b' })).statusCode, 400);
    await emi.upload(folderId, 'Foto.png', Buffer.from('kein Text'), 64);
    await emi.upload(folderId, 'Alt.txt', Buffer.from('aus dem Editor von früher'), 64);
    const listed = await notes(emi);
    assert.deepEqual(listed.items.map((item) => [item.title, item.category]).sort(), [
      ['Alt', ''],
      ['Angebot', 'Arbeit/Kunden'],
      ['Einkauf (2)', ''],
      ['Einkauf', ''],
      ['Neue Notiz', ''],
    ]);
    assert.equal(listed.items.find((item) => item.title === 'Alt')!.excerpt, 'aus dem Editor von früher');
    await emi.json('POST', '/api/nodes/trash', { ids: [second.id, untitled.id] });
    assert.equal((await notes(emi)).items.length, 3);
  });

  it('liest und speichert, ohne bei jedem Tastendruck eine Version anzulegen', async () => {
    const opened = (await emi.get(`/api/notes/${first}`)).json() as { note: Note; content: string; base: string };
    assert.equal(opened.content, '# Samstag\n\n- [ ] Brot\n- [x] **Milch**\n');
    assert.equal(opened.note.title, 'Einkauf');
    let base = opened.base;
    for (const text of ['# Samstag\n\n- [x] Brot\n', '# Samstag\n\n- [x] Brot\n- [ ] Äpfel\n']) {
      const saved = await emi.json('PUT', `/api/notes/${first}`, { content: text, base });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.notEqual(saved.json().base, base);
      base = saved.json().base;
    }
    assert.equal((await emi.get(`/api/nodes/${first}/content`)).body, '# Samstag\n\n- [x] Brot\n- [ ] Äpfel\n');
    assert.equal((await emi.get(`/api/nodes/${first}/versions`)).json().items.length, 0);
    const same = await emi.json('PUT', `/api/notes/${first}`, { content: '# Samstag\n\n- [x] Brot\n- [ ] Äpfel\n', base });
    assert.equal(same.json().base, base);

    const stale = await emi.json('PUT', `/api/notes/${first}`, { content: 'von einem alten Stand', base: opened.base });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'note_conflict');
    assert.equal((await emi.get(`/api/notes/${first}`)).json().content, '# Samstag\n\n- [x] Brot\n- [ ] Äpfel\n');

    run('UPDATE nodes SET updated_at = ? WHERE id = ?', Date.now() - 11 * 60 * 1000, first);
    const later = await emi.json('PUT', `/api/notes/${first}`, { content: 'Am nächsten Tag\n', base });
    assert.equal(later.statusCode, 200, later.body);
    assert.equal(later.json().note.excerpt, 'Am nächsten Tag');
    assert.equal((await emi.get(`/api/nodes/${first}/versions`)).json().items.length, 1);
    const again = await emi.json('PUT', `/api/notes/${first}`, { content: 'Am nächsten Tag, weiter\n', base: later.json().base });
    assert.equal(again.statusCode, 200);
    assert.equal((await emi.get(`/api/nodes/${first}/versions`)).json().items.length, 1);
    const edits = ((await emi.get(`/api/nodes/${first}/activity`)).json().items as { action: string }[]).filter(
      (entry) => entry.action === 'edit'
    );
    assert.equal(edits.length, 1);
  });

  it('lehnt anderes als Notizen und zu große Inhalte ab', async () => {
    const image = ((await emi.get(`/api/nodes/${folderId}/children`)).json().items as { id: string; name: string }[]).find(
      (item) => item.name === 'Foto.png'
    )!;
    assert.equal((await emi.get(`/api/notes/${image.id}`)).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/notes/${image.id}`, { content: 'x' })).statusCode, 400);
    assert.equal((await emi.get(`/api/notes/${folderId}`)).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/notes/${first}`, { content: 'ä'.repeat(600_000) })).statusCode, 413);
    assert.equal((await emi.json('POST', '/api/notes', { title: 'Riesig', content: 'ä'.repeat(600_000) })).statusCode, 413);
    assert.equal((await mia.get(`/api/notes/${first}`)).statusCode, 404);
    assert.equal((await mia.json('PUT', `/api/notes/${first}`, { content: 'fremd' })).statusCode, 404);
  });

  it('bleibt beim Ordner, auch wenn er umbenannt oder verschoben wird, und nimmt einen vorhandenen', async () => {
    const archive = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Archiv' })).json().node.id;
    assert.equal((await emi.json('PATCH', `/api/nodes/${folderId}`, { name: 'Zettelkasten' })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/nodes/move', { ids: [folderId], target: archive })).statusCode, 200);
    const listed = await notes(emi);
    assert.equal(listed.folderId, folderId);
    assert.equal(listed.items.length, 3);
    const more = (await emi.json('POST', '/api/notes', { title: 'Noch eine' })).json().note as Note;
    assert.equal(more.parentId, folderId);

    const own = (await mia.json('POST', `/api/nodes/${miaRoot}/folders`, { name: 'Notes' })).json().node.id;
    await mia.upload(own, 'Ideen.md', Buffer.from('Schon vorher da'), 64);
    const found = await notes(mia);
    assert.equal(found.folderId, own);
    assert.deepEqual(
      found.items.map((item) => [item.title, item.excerpt]),
      [['Ideen', 'Schon vorher da']]
    );
    await mia.json('POST', '/api/nodes/trash', { ids: [own] });
    assert.deepEqual(await notes(mia), { folderId: null, items: [], more: false });
    const fresh = (await mia.json('POST', '/api/notes', { title: 'Neu anfangen' })).json().note as Note;
    assert.notEqual(fresh.parentId, own);
    assert.deepEqual(await names(mia, miaRoot), ['Notizen']);
  });

  it('lässt geteilte Notizen mit Schreibrecht bearbeiten und Gäste außen vor', async () => {
    const shared = await emi.json('POST', `/api/nodes/${first}/grants`, { userId: miaId, permission: 'view' });
    assert.equal(shared.statusCode, 200, shared.body);
    const opened = (await mia.get(`/api/notes/${first}`)).json();
    assert.equal(opened.content, 'Am nächsten Tag, weiter\n');
    assert.equal((await mia.json('PUT', `/api/notes/${first}`, { content: 'von Mia', base: opened.base })).statusCode, 403);
    const grant = shared.json().grant.id;
    assert.equal((await emi.json('PATCH', `/api/grants/${grant}`, { permission: 'edit' })).statusCode, 200);
    const saved = await mia.json('PUT', `/api/notes/${first}`, { content: 'von Mia', base: opened.base });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await emi.get(`/api/notes/${first}`)).json().content, 'von Mia');
    assert.equal((await emi.get(`/api/nodes/${first}/versions`)).json().items.length, 2);

    await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123', role: 'guest' });
    const lea = await login(app, 'lea', 'leas-passwort-123');
    assert.deepEqual(await notes(lea), { folderId: null, items: [], more: false });
    assert.equal((await lea.json('POST', '/api/notes', { title: 'Gast' })).statusCode, 403);
  });

  it('sammelt die Aufgaben aus allen Notizen und hakt sie von dort aus ab', async () => {
    const list = (
      await emi.json('POST', '/api/notes', {
        title: 'Umzug',
        category: 'Privat',
        content:
          '# Umzug\n\n- [ ] Kartons besorgen\n- [x] Transporter buchen\n* [ ] Lea fragen\r\n\n```\n- [ ] steht nur im Code\n```\n1. [ ] Strom ummelden\n',
      })
    ).json().note as Note;
    await emi.json('POST', '/api/notes', { title: 'Ohne Aufgaben', content: 'Nur Text mit [Klammern].' });
    const tasks = (await emi.get('/api/notes/tasks')).json();
    assert.equal(tasks.open, 3);
    assert.equal(tasks.done, 1);
    assert.deepEqual(
      tasks.notes.map((note: { title: string; category: string }) => [note.title, note.category]),
      [['Umzug', 'Privat']]
    );
    assert.deepEqual(tasks.notes[0].tasks, [
      { line: 2, text: 'Kartons besorgen', done: false },
      { line: 3, text: 'Transporter buchen', done: true },
      { line: 4, text: 'Lea fragen', done: false },
      { line: 9, text: 'Strom ummelden', done: false },
    ]);

    const done = await emi.json('POST', `/api/notes/${list.id}/tasks`, { line: 4, text: 'Lea fragen' });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().done, true);
    const content = (await emi.get(`/api/notes/${list.id}`)).json().content as string;
    assert.match(content, /\* \[x\] Lea fragen\r\n/);
    assert.match(content, /- \[ \] steht nur im Code/);
    const back = await emi.json('POST', `/api/notes/${list.id}/tasks`, { line: 3, text: 'Transporter buchen' });
    assert.equal(back.json().done, false);
    const after = (await emi.get('/api/notes/tasks')).json();
    assert.deepEqual([after.open, after.done], [3, 1]);

    const stale = await emi.json('POST', `/api/notes/${list.id}/tasks`, { line: 2, text: 'Etwas anderes' });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'note_conflict');
    assert.equal((await emi.json('POST', `/api/notes/${list.id}/tasks`, { line: 0, text: 'Umzug' })).statusCode, 409);
    assert.equal((await mia.json('POST', `/api/notes/${list.id}/tasks`, { line: 2, text: 'Kartons besorgen' })).statusCode, 404);
    assert.deepEqual(
      (await mia.get('/api/notes/tasks')).json().notes.filter((note: { title: string }) => note.title === 'Umzug'),
      []
    );
  });
});
