import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let miaId = 0;
let leaId = 0;
let direct = '';
let group = '';

before(async () => {
  emi = await setUp(app);
  for (const [username, name] of [
    ['mia', 'Mia'],
    ['lea', 'Lea'],
  ]) {
    const made = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}-passwort-123` });
    assert.equal(made.statusCode, 200, made.body);
  }
  mia = await login(app, 'mia', 'mia-passwort-123');
  lea = await login(app, 'lea', 'lea-passwort-123');
  miaId = (await mia.get('/api/session')).json().user.id;
  leaId = (await lea.get('/api/session')).json().user.id;
});

after(() => app.close());

describe('Chat', () => {
  it('hat für jede Person eine Ablage für Notizen an sich selbst', async () => {
    const rooms = await emi.get('/api/chat/rooms');
    assert.equal(rooms.statusCode, 200, rooms.body);
    assert.equal(rooms.json().rooms.length, 1);
    assert.equal(rooms.json().rooms[0].kind, 'self');
    const again = await emi.json('POST', '/api/chat/rooms', { kind: 'self' });
    assert.equal(again.json().room.id, rooms.json().rooms[0].id);
  });

  it('schreibt sich direkt, zählt Ungelesenes und meldet Neues', async () => {
    const people = await emi.get('/api/chat/people?q=mi');
    assert.equal(people.json().people[0].name, 'Mia');
    const opened = await emi.json('POST', '/api/chat/rooms', { kind: 'direct', user: miaId });
    assert.equal(opened.statusCode, 200, opened.body);
    direct = opened.json().room.id;
    assert.equal(opened.json().room.name, 'Mia');
    assert.equal(
      (await mia.json('POST', '/api/chat/rooms', { kind: 'direct', user: 1 })).json().room.id,
      direct,
      'derselbe Chat von beiden Seiten'
    );
    const sent = await emi.json('POST', `/api/chat/rooms/${direct}/messages`, { body: 'Hallo Mia, Ramen heute?' });
    assert.equal(sent.statusCode, 200, sent.body);
    await emi.json('POST', `/api/chat/rooms/${direct}/messages`, { body: 'Um 19 Uhr?', replyTo: sent.json().message.id });
    const rooms = (await mia.get('/api/chat/rooms')).json().rooms;
    const room = rooms.find((entry: { id: string }) => entry.id === direct);
    assert.equal(room.unread, 2);
    assert.equal(room.name, 'Emi');
    assert.equal(room.last.preview, 'Um 19 Uhr?');
    assert.equal((await mia.get('/api/badges')).json().chat, 2);
    const notes = (await mia.get('/api/notifications')).json();
    const items = notes.items ?? notes.notifications;
    assert.equal(items.filter((entry: { kind: string }) => entry.kind === 'chat_message').length, 1, 'zusammengefasst');
    const messages = (await mia.get(`/api/chat/rooms/${direct}/messages`)).json().messages;
    assert.equal(messages.length, 2);
    assert.equal(messages[1].replyTo.preview, 'Hallo Mia, Ramen heute?');
    assert.equal((await mia.json('POST', `/api/chat/rooms/${direct}/read`, {})).statusCode, 200);
    assert.equal((await mia.get('/api/badges')).json().chat, 0);
  });

  it('reagiert, bearbeitet und löscht', async () => {
    const messages = (await emi.get(`/api/chat/rooms/${direct}/messages`)).json().messages;
    const first = messages[0].id;
    const reacted = await mia.json('POST', `/api/chat/messages/${first}/reactions`, { emoji: '🍜' });
    assert.deepEqual(
      reacted.json().reactions.map((entry: { emoji: string; count: number }) => [entry.emoji, entry.count]),
      [['🍜', 1]]
    );
    assert.equal((await mia.json('PATCH', `/api/chat/messages/${first}`, { body: 'gehackt' })).statusCode, 403);
    const edited = await emi.json('PATCH', `/api/chat/messages/${first}`, { body: 'Hallo Mia, Ramen morgen?' });
    assert.equal(edited.json().message.body, 'Hallo Mia, Ramen morgen?');
    assert.ok(edited.json().message.editedAt);
    assert.equal((await emi.json('DELETE', `/api/chat/messages/${messages[1].id}`)).statusCode, 200);
    const after = (await mia.get(`/api/chat/rooms/${direct}/messages`)).json().messages;
    assert.equal(after[1].body, '');
    assert.ok(after[1].deletedAt);
  });

  it('teilt Dateien nur mit den Leuten im Chat', async () => {
    const folder = (await emi.json('POST', '/api/chat/folder')).json().id;
    const uploaded = await emi.upload(folder, 'karte.txt', Buffer.from('Shoyu-Ramen 12 €'));
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const node = uploaded.json().node.id;
    const sent = await emi.json('POST', `/api/chat/rooms/${direct}/messages`, { body: '', files: [node] });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().message.files[0].name, 'karte.txt');
    const fetched = await mia.get(`/api/chat/rooms/${direct}/files/${node}?download=1`);
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.body, 'Shoyu-Ramen 12 €');
    assert.equal((await mia.get(`/api/nodes/${node}`)).statusCode, 404, 'ohne Chat kein Zugriff');
    assert.equal((await lea.get(`/api/chat/rooms/${direct}/files/${node}`)).statusCode, 404);
    assert.equal((await lea.get(`/api/chat/rooms/${direct}/messages`)).statusCode, 404);
    const stolen = await mia.json('POST', `/api/chat/rooms/${direct}/messages`, { body: '', files: [node] });
    assert.equal(stolen.statusCode, 404, 'fremde Dateien lassen sich nicht weiterreichen');
    await emi.json('DELETE', `/api/chat/messages/${sent.json().message.id}`);
    assert.equal((await mia.get(`/api/chat/rooms/${direct}/files/${node}`)).statusCode, 404);
  });

  it('baut Gruppen mit Erwähnungen und Austritt', async () => {
    const created = await emi.json('POST', '/api/chat/rooms', { kind: 'group', name: 'Ramen-Club', members: [miaId] });
    assert.equal(created.statusCode, 200, created.body);
    group = created.json().room.id;
    const added = await emi.json('POST', `/api/chat/rooms/${group}/members`, { users: [leaId] });
    assert.equal(added.json().members.length, 3);
    const leaNotes = (await lea.get('/api/notifications')).json();
    assert.ok((leaNotes.items ?? leaNotes.notifications).some((entry: { kind: string }) => entry.kind === 'chat_added'));
    await mia.json('POST', `/api/chat/rooms/${group}/messages`, { body: 'Wer kommt mit, @lea?' });
    const notes = (await lea.get('/api/notifications')).json();
    assert.ok((notes.items ?? notes.notifications).some((entry: { kind: string }) => entry.kind === 'chat_mention'));
    assert.equal(
      (await mia.json('DELETE', `/api/chat/rooms/${group}/members/${leaId}`)).statusCode,
      403,
      'nur die Gründerin entfernt andere'
    );
    assert.equal((await lea.json('DELETE', `/api/chat/rooms/${group}/members/${leaId}`)).statusCode, 200);
    assert.equal((await lea.get(`/api/chat/rooms/${group}`)).statusCode, 404);
    const system = (await emi.get(`/api/chat/rooms/${group}/messages`))
      .json()
      .messages.filter((entry: { kind: string }) => entry.kind === 'system');
    assert.deepEqual(
      system.map((entry: { body: string }) => JSON.parse(entry.body).event),
      ['created', 'added', 'left']
    );
    const muted = await mia.json('PATCH', `/api/chat/rooms/${group}/settings`, { muted: true, pinned: true });
    assert.equal(muted.statusCode, 200);
    assert.equal((await mia.get('/api/chat/rooms')).json().rooms[0].id, group, 'angeheftet steht oben');
    const found = await emi.get('/api/chat/search?q=ramen');
    assert.ok(found.json().results.length >= 1);
  });

  it('setzt einen Status mit Ende', async () => {
    const set = await mia.json('PUT', '/api/account/status', {
      state: 'dnd',
      emoji: '🎧',
      text: 'Konzentriert',
      until: Date.now() + 60_000,
    });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().status.state, 'dnd');
    const details = (await emi.get(`/api/chat/rooms/${direct}`)).json();
    assert.equal(details.members.find((entry: { id: number }) => entry.id === miaId).status.text, 'Konzentriert');
    assert.equal((await mia.json('PUT', '/api/account/status', { state: 'away', until: Date.now() - 1000 })).statusCode, 400);
    const cleared = await mia.json('DELETE', '/api/account/status');
    assert.equal(cleared.json().status, null);
  });

  it('bleibt Gästen und bei ausgeschaltetem Chat verschlossen', async () => {
    const made = await emi.json('POST', '/api/admin/users', {
      username: 'gast',
      name: 'Gast',
      password: 'gast-passwort-123',
      role: 'guest',
    });
    assert.equal(made.statusCode, 200, made.body);
    const guest = await login(app, 'gast', 'gast-passwort-123');
    assert.equal((await guest.get('/api/chat/rooms')).statusCode, 403);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'chat.enabled': false })).statusCode, 200);
    try {
      assert.equal((await emi.get('/api/chat/rooms')).statusCode, 404);
      assert.equal((await emi.get('/chat', { accept: 'text/html' })).statusCode, 302);
    } finally {
      await emi.json('PATCH', '/api/admin/settings', { 'chat.enabled': true });
    }
  });
});
