import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run, value } from '../src/lib/db.ts';
import { fireReminders } from '../src/services/reminders.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let root = '';
let folder = '';
let file = '';
let leaGrant = '';

type Item = { id: string; name: string; description: string | null; reminder: { dueAt: number; note: string | null } | null };
type Note = { kind: string; title: string; text: string; url: string };

const items = async (client: Client, id: string) => (await client.get(`/api/nodes/${id}/children`)).json().items as Item[];
const notes = async (client: Client, kind: string) =>
  ((await client.get('/api/notifications')).json().items as Note[]).filter((item) => item.kind === kind);
const message = (response: { json: () => { error: { message: string } } }) => response.json().error.message;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const ids: Record<string, number> = {};
  for (const [username, name] of [
    ['mia', 'Mia'],
    ['lea', 'Lea'],
    ['emily', 'Emily'],
  ]) {
    ids[username] = (await emi.json('POST', '/api/admin/users', { username, name, password: `${username}-passwort-123` })).json().user.id;
  }
  mia = await login(app, 'mia', 'mia-passwort-123');
  lea = await login(app, 'lea', 'lea-passwort-123');
  folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Projekt' })).json().node.id;
  file = (await emi.upload(folder, 'Plan.txt', Buffer.from('Version eins'), 4096)).json().node.id;
  await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: ids.mia, permission: 'edit' });
  leaGrant = (await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: ids.lea, permission: 'view' })).json().grant.id;
});

after(() => app.close());

describe('Erwähnungen', () => {
  it('benachrichtigt erwähnte Personen mit Zugriff', async () => {
    const text = 'Schau mal @mia, und @Lea. bitte auch. @emily und @niemand haben keinen Zugriff, mail@mia.de ist eine Adresse.';
    const sent = await emi.json('POST', `/api/nodes/${file}/comments`, { text });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(sent.json().comment.mentions, [
      { username: 'mia', name: 'Mia', me: false },
      { username: 'lea', name: 'Lea', me: false },
    ]);
    for (const client of [mia, lea]) {
      const mentions = await notes(client, 'mention');
      assert.equal(mentions.length, 1);
      assert.equal(mentions[0].title, 'Emi hat dich in einem Kommentar zu „Plan.txt“ erwähnt');
      assert.equal(mentions[0].text, text);
      assert.equal(mentions[0].url, `/files/folder/${folder}?select=${file}&tab=comments`);
      assert.equal((await notes(client, 'comment')).length, 0);
    }
    const seen = (await mia.get(`/api/nodes/${file}/comments`)).json().items[0];
    assert.deepEqual(
      seen.mentions.map((entry: { username: string; me: boolean }) => [entry.username, entry.me]),
      [
        ['mia', true],
        ['lea', false],
      ]
    );
    await mia.json('POST', `/api/nodes/${file}/comments`, { text: 'Mach ich.' });
    assert.equal((await notes(emi, 'comment')).length, 1);
    assert.equal((await notes(lea, 'comment')).length, 1);
    assert.equal((await notes(emi, 'mention')).length, 0);
  });

  it('schlägt nur Personen mit Zugriff vor', async () => {
    const forEmi = (await emi.get(`/api/nodes/${file}/comments/people`)).json().items;
    assert.deepEqual(
      forEmi.map((person: { username: string; name: string; initials: string }) => [person.username, person.name, person.initials]),
      [
        ['lea', 'Lea', 'LE'],
        ['mia', 'Mia', 'MI'],
      ]
    );
    const forLea = (await lea.get(`/api/nodes/${file}/comments/people`)).json().items;
    assert.deepEqual(
      forLea.map((person: { username: string }) => person.username),
      ['emi', 'mia']
    );
    const emily = await login(app, 'emily', 'emily-passwort-123');
    assert.equal((await emily.get(`/api/nodes/${file}/comments/people`)).statusCode, 404);
  });
});

describe('Erinnerungen', () => {
  it('merkt sich eine Erinnerung je Person und Datei', async () => {
    const past = await mia.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: Date.now() - 1000 });
    assert.equal(past.statusCode, 400);
    assert.equal(message(past), 'Der Zeitpunkt muss in der Zukunft liegen');
    const far = await mia.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: Date.now() + 6 * 365 * 86_400_000 });
    assert.equal(message(far), 'Der Zeitpunkt liegt zu weit in der Zukunft');
    const miaRoot = (await mia.get('/api/session')).json().user.rootId;
    assert.equal(
      message(await mia.json('PUT', `/api/nodes/${miaRoot}/reminder`, { dueAt: Date.now() + 60_000 })),
      'An den Hauptordner kannst du dich nicht erinnern lassen'
    );
    const due = Date.now() + 3_600_000;
    assert.equal((await mia.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: due + 5000, note: 'erster Versuch' })).statusCode, 200);
    const set = await mia.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: due, note: '  Lea wegen des Plans anrufen  ' });
    assert.deepEqual(set.json().reminder, { dueAt: due, note: 'Lea wegen des Plans anrufen' });
    assert.equal(Number(value('SELECT COUNT(*) FROM reminders')), 1);
    assert.deepEqual((await items(mia, folder))[0].reminder, { dueAt: due, note: 'Lea wegen des Plans anrufen' });
    assert.equal((await items(emi, folder))[0].reminder, null);
    assert.deepEqual((await mia.get('/api/reminders')).json().items, [
      {
        nodeId: file,
        name: 'Plan.txt',
        type: 'file',
        dueAt: due,
        note: 'Lea wegen des Plans anrufen',
        url: `/files/folder/${folder}?select=${file}`,
      },
    ]);
    assert.deepEqual((await emi.get('/api/reminders')).json().items, []);
  });

  it('erinnert zur gewählten Zeit genau einmal', async () => {
    assert.equal(fireReminders(), 0);
    run('UPDATE reminders SET due_at = ?', Date.now() - 1000);
    assert.equal(fireReminders(), 1);
    assert.equal(fireReminders(), 0);
    const sent = await notes(mia, 'reminder');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Erinnerung: „Plan.txt“');
    assert.equal(sent[0].text, 'Lea wegen des Plans anrufen');
    assert.equal(sent[0].url, `/files/folder/${folder}?select=${file}`);
    assert.equal((await items(mia, folder))[0].reminder, null);
  });

  it('lässt sich löschen und schweigt ohne Zugriff', async () => {
    await mia.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: Date.now() + 60_000 });
    assert.equal((await mia.json('DELETE', `/api/nodes/${file}/reminder`)).json().removed, true);
    assert.equal((await mia.json('DELETE', `/api/nodes/${file}/reminder`)).json().removed, false);
    await lea.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: Date.now() + 60_000 });
    await mia.json('PUT', `/api/nodes/${folder}/reminder`, { dueAt: Date.now() + 60_000 });
    assert.equal((await emi.json('DELETE', `/api/grants/${leaGrant}`)).statusCode, 200);
    assert.equal((await lea.json('PUT', `/api/nodes/${file}/reminder`, { dueAt: Date.now() + 60_000 })).statusCode, 404);
    run('UPDATE reminders SET due_at = ?', Date.now() - 1000);
    assert.equal(fireReminders(), 1);
    assert.equal(Number(value('SELECT COUNT(*) FROM reminders')), 0);
    assert.equal((await notes(lea, 'reminder')).length, 0);
    const forFolder = (await notes(mia, 'reminder'))[0];
    assert.equal(forFolder.title, 'Erinnerung: „Projekt“');
    assert.equal(forFolder.text, 'Du wolltest an diese Datei erinnert werden.');
    assert.equal(forFolder.url, `/files/folder/${folder}`);
  });
});

describe('Beschreibungen', () => {
  it('speichert Beschreibungen und findet sie in der Suche', async () => {
    const saved = await emi.json('PUT', `/api/nodes/${file}/description`, { text: '  Fahrplan für den Umzug\r\nmit Lea abgestimmt  ' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().description, 'Fahrplan für den Umzug\nmit Lea abgestimmt');
    assert.equal((await items(mia, folder))[0].description, 'Fahrplan für den Umzug\nmit Lea abgestimmt');
    const found = (await emi.get('/api/search?q=fahrplan')).json().items as { id: string }[];
    assert.deepEqual(
      found.map((item) => item.id),
      [file]
    );
    assert.deepEqual((await emi.get('/api/search?q=100%25')).json().items, []);
    assert.equal((await mia.json('PUT', `/api/nodes/${folder}/description`, { text: 'x' })).statusCode, 403);
    assert.equal((await mia.json('PUT', `/api/nodes/${file}/description`, { text: 'Von Mia ergänzt' })).statusCode, 200);
    const long = await emi.json('PUT', `/api/nodes/${file}/description`, { text: 'a'.repeat(2001) });
    assert.equal(message(long), 'Die Beschreibung darf höchstens 2000 Zeichen haben');
    assert.equal((await emi.json('PUT', `/api/nodes/${file}/description`, { text: '   ' })).json().description, null);
    assert.equal((await items(emi, folder))[0].description, null);
  });
});

describe('Vorlagen', () => {
  it('legt neue Dateien aus dem Vorlagenordner an', async () => {
    assert.deepEqual((await emi.get('/api/templates')).json(), { folder: null, items: [] });
    assert.equal(
      message(await emi.json('PUT', '/api/templates', { folderId: root })),
      'Nimm einen eigenen Ordner für Vorlagen, nicht den Hauptordner'
    );
    const templates = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Vorlagen' })).json().node.id;
    const protocol = (await emi.upload(templates, 'Protokoll.md', Buffer.from('# Protokoll\n\nDabei: Emi, Mia, Lea'), 4096)).json().node.id;
    await emi.json('POST', `/api/nodes/${templates}/folders`, { name: 'Alt' });
    const set = await emi.json('PUT', '/api/templates', { folderId: templates });
    assert.equal(set.statusCode, 200, set.body);
    assert.deepEqual(set.json().folder, { id: templates, name: 'Vorlagen' });
    assert.deepEqual(
      set.json().items.map((item: { name: string }) => item.name),
      ['Protokoll.md']
    );
    const made = await emi.json('POST', `/api/nodes/${folder}/from-template`, { templateId: protocol, name: 'Protokoll Mai' });
    assert.equal(made.statusCode, 200, made.body);
    assert.equal(made.json().node.name, 'Protokoll Mai.md');
    assert.equal(made.json().node.parentId, folder);
    assert.equal((await emi.get(`/api/nodes/${made.json().node.id}/content`)).body, '# Protokoll\n\nDabei: Emi, Mia, Lea');
    assert.equal(
      (await emi.json('POST', `/api/nodes/${folder}/from-template`, { templateId: protocol, name: 'Protokoll Mai.md' })).statusCode,
      409
    );
    assert.equal((await emi.json('POST', `/api/nodes/${folder}/from-template`, { templateId: file, name: 'Kopie' })).statusCode, 404);
    assert.equal((await mia.json('POST', `/api/nodes/${folder}/from-template`, { templateId: protocol, name: 'Kopie' })).statusCode, 404);
    await emi.json('POST', '/api/nodes/trash', { ids: [templates] });
    assert.deepEqual((await emi.get('/api/templates')).json(), { folder: null, items: [] });
    assert.equal((await emi.json('PUT', '/api/templates', { folderId: null })).statusCode, 200);
  });
});

describe('Reaktionen auf Kommentare', () => {
  type Reaction = { emoji: string; count: number; mine: boolean; people: string[] };
  const react = (client: Client, comment: string, emoji: string, on = true, node = file) =>
    client.json('POST', `/api/nodes/${node}/comments/${comment}/reactions`, { emoji, on });
  const reactionsOf = async (client: Client, comment: string) =>
    ((await client.get(`/api/nodes/${file}/comments`)).json().items as { id: string; reactions: Reaction[] }[]).find(
      (item) => item.id === comment
    )!.reactions;

  before(async () => {
    const leaId = (await lea.get('/api/session')).json().user.id;
    const granted = await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: leaId, permission: 'view' });
    assert.equal(granted.statusCode, 200, granted.body);
  });

  it('zählt Reaktionen pro Person und zeigt, wer reagiert hat', async () => {
    const comment = (await mia.json('POST', `/api/nodes/${file}/comments`, { text: 'Fertig für heute' })).json().comment.id as string;
    const first = await react(emi, comment, '👍');
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json().comment.reactions, [{ emoji: '👍', count: 1, mine: true, people: [] }]);
    assert.equal((await react(emi, comment, '👍')).json().comment.reactions[0].count, 1);
    await react(mia, comment, '👍');
    await react(mia, comment, '❤️');
    await react(lea, comment, '🎉');
    assert.deepEqual(await reactionsOf(mia, comment), [
      { emoji: '👍', count: 2, mine: true, people: ['Emi'] },
      { emoji: '❤️', count: 1, mine: true, people: [] },
      { emoji: '🎉', count: 1, mine: false, people: ['Lea'] },
    ]);
    assert.deepEqual(await reactionsOf(emi, comment), [
      { emoji: '👍', count: 2, mine: true, people: ['Mia'] },
      { emoji: '❤️', count: 1, mine: false, people: ['Mia'] },
      { emoji: '🎉', count: 1, mine: false, people: ['Lea'] },
    ]);
    const removed = await react(mia, comment, '👍', false);
    assert.deepEqual(removed.json().comment.reactions[0], { emoji: '👍', count: 1, mine: false, people: ['Emi'] });
    assert.equal((await react(mia, comment, '👍', false)).statusCode, 200);
    assert.equal((await notes(mia, 'comment')).filter((item) => /reagiert/.test(item.title)).length, 0);
  });

  it('nimmt nur bekannte Reaktionen und nur mit Zugriff an', async () => {
    const comment = (await emi.json('POST', `/api/nodes/${file}/comments`, { text: 'Noch eine Frage' })).json().comment.id as string;
    for (const emoji of ['💩', 'A', '', '👍👍', '<b>']) {
      assert.equal((await react(mia, comment, emoji)).statusCode, 400, emoji);
    }
    assert.equal((await mia.json('POST', `/api/nodes/${file}/comments/${comment}/reactions`, { emoji: '👍' })).statusCode, 400);
    const emily = await login(app, 'emily', 'emily-passwort-123');
    assert.equal((await react(emily, comment, '👍')).statusCode, 404);
    const other = (await emi.upload(folder, 'Andere.txt', Buffer.from('x'), 4096)).json().node.id as string;
    assert.equal((await react(emi, comment, '👍', true, other)).statusCode, 404);
    assert.equal((await react(emi, 'gibt-es-nicht', '👍')).statusCode, 404);
    await react(lea, comment, '👀');
    assert.equal(value<number>('SELECT COUNT(*) FROM comment_reactions WHERE comment_id = ?', comment), 1);
    await emi.json('DELETE', `/api/nodes/${file}/comments/${comment}`);
    assert.equal(value<number>('SELECT COUNT(*) FROM comment_reactions WHERE comment_id = ?', comment), 0);
  });
});
