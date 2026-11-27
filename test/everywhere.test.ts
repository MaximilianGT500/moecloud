import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { insertAccount } from '../src/mail/accounts.ts';
import { parseLrc } from '../src/services/lyrics.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let lea: Client;
let root = '';

function syncsafe(target: Buffer, offset: number, size: number) {
  for (let index = 0; index < 4; index++) target[offset + index] = (size >> (21 - index * 7)) & 0x7f;
}

function frame(id: string, data: Buffer) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  syncsafe(header, 4, data.length);
  return Buffer.concat([header, data]);
}

function mp3(frames: Buffer[]) {
  const body = Buffer.concat(frames);
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  syncsafe(header, 6, body.length);
  const audio = Buffer.alloc(417);
  audio.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([header, body, ...Array.from({ length: 6 }, () => audio)]);
}

const title = (text: string) => frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]));
const unsynced = (text: string) =>
  frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('deu', 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')]));

async function put(client: Client, parent: string, name: string, content: Buffer) {
  const response = await client.upload(parent, name, content, 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'lea-passwort-123' });
  lea = await login(app, 'lea', 'lea-passwort-123');
});

after(() => app.close());

describe('Überall suchen', () => {
  it('findet Kontakte, Termine, Aufgaben, Chat, Lesezeichen und Schnipsel auf einmal', async () => {
    const books = (await emi.get('/api/contacts/books')).json().books;
    const contact = await emi.json('POST', '/api/contacts', {
      bookId: books[0].id,
      data: { given: 'Mia', family: 'Ramenfreundin', emails: [{ type: 'home', value: 'mia@example.com', label: '' }] },
    });
    assert.equal(contact.statusCode, 200, contact.body);
    const calendars = (await emi.get('/api/calendar/calendars')).json().calendars;
    const start = Date.now() + 86_400_000;
    const event = await emi.json('POST', '/api/calendar/events', {
      calendarId: calendars[0].id,
      component: 'VEVENT',
      title: 'Ramen-Abend',
      start,
      end: start + 7_200_000,
    });
    assert.equal(event.statusCode, 200, event.body);
    const task = await emi.json('POST', '/api/calendar/events', {
      calendarId: calendars[0].id,
      component: 'VTODO',
      title: 'Ramen-Nudeln kaufen',
    });
    assert.equal(task.statusCode, 200, task.body);
    const self = (await emi.json('POST', '/api/chat/rooms', { kind: 'self' })).json().room;
    await emi.json('POST', `/api/chat/rooms/${self.id}/messages`, { body: 'Ramen-Rezept nicht vergessen' });
    await emi.json('POST', '/api/bookmarks', { url: 'https://ramen.example/laden', title: 'Ramen-Laden in Kyoto' });
    await emi.json('POST', '/api/snippets', { title: 'Ramen-Timer', language: 'bash', content: 'sleep 180 && echo fertig' });

    const result = await emi.get('/api/search/everywhere?q=ramen');
    assert.equal(result.statusCode, 200, result.body);
    const groups = Object.fromEntries(
      result.json().groups.map((group: { key: string; items: { title: string; href: string }[] }) => [group.key, group.items])
    );
    assert.deepEqual(Object.keys(groups).sort(), ['bookmarks', 'chat', 'contacts', 'events', 'snippets', 'tasks']);
    assert.equal(groups.contacts[0].title, 'Mia Ramenfreundin');
    assert.match(groups.contacts[0].href, /^\/contacts\?c=/);
    assert.equal(groups.events[0].title, 'Ramen-Abend');
    assert.equal(groups.tasks[0].title, 'Ramen-Nudeln kaufen');
    assert.match(groups.chat[0].href, new RegExp(`^/chat\\?room=${self.id}$`));
    assert.equal(groups.bookmarks[0].href, 'https://ramen.example/laden');
    assert.equal(groups.snippets[0].title, 'Ramen-Timer');
    assert.equal(result.json().mail, false, 'ohne Postfach keine Suche in E-Mails');
    const session = (await emi.get('/api/session')).json().user;
    insertAccount(session, {
      name: '',
      email: 'emi@example.com',
      displayName: 'Emi',
      login: 'emi@example.com',
      password: 'geheim',
      imap: { host: 'imap.example.com', port: 993, security: 'tls' },
      smtp: { host: 'smtp.example.com', port: 465, security: 'tls' },
    });
    assert.equal((await emi.get('/api/search/everywhere?q=ramen')).json().mail, true);

    const prefs = await emi.json('PATCH', '/api/account/prefs', { features: ['snippets', 'chat'] });
    assert.equal(prefs.statusCode, 200, prefs.body);
    const hidden = (await emi.get('/api/search/everywhere?q=ramen')).json().groups.map((group: { key: string }) => group.key);
    assert.ok(!hidden.includes('snippets') && !hidden.includes('chat'), 'ausgeblendete Bereiche bleiben draußen');
    await emi.json('PATCH', '/api/account/prefs', { features: [] });

    assert.deepEqual((await lea.get('/api/search/everywhere?q=ramen')).json().groups, [], 'nur eigene Sachen');
    assert.equal((await emi.get('/api/search/everywhere?q=r')).statusCode, 400);
  });
});

describe('Songtexte', () => {
  it('liest LRC mit Versatz, mehreren Zeitmarken und Wortzeiten', () => {
    const lines = parseLrc('[ti:Sommerlied]\n[offset:500]\n[00:12.50][01:02.00]Sonne <00:12.80>über dem Meer\n[00:05]Intro\nohne Zeit');
    assert.deepEqual(lines, [
      { time: 4.5, text: 'Intro' },
      { time: 12, text: 'Sonne über dem Meer' },
      { time: 61.5, text: 'Sonne über dem Meer' },
    ]);
    assert.deepEqual(parseLrc('Erste Zeile\n\nZweite Zeile'), [
      { time: null, text: 'Erste Zeile' },
      { time: null, text: 'Zweite Zeile' },
    ]);
  });

  it('nimmt eine LRC-Datei daneben oder den Text aus der Datei', async () => {
    const song = await put(emi, root, 'Sommerlied.mp3', mp3([title('Sommerlied')]));
    await put(emi, root, 'sommerlied.LRC', Buffer.from('[00:01.00]Erste Zeile\n[00:03.20]Zweite Zeile\n'));
    const synced = await emi.get(`/api/nodes/${song}/lyrics`);
    assert.equal(synced.statusCode, 200, synced.body);
    assert.deepEqual(synced.json(), {
      source: 'file',
      synced: true,
      lines: [
        { time: 1, text: 'Erste Zeile' },
        { time: 3.2, text: 'Zweite Zeile' },
      ],
    });

    const tagged = await put(emi, root, 'Regen.mp3', mp3([title('Regen'), unsynced('Es regnet\nauf das Dach')]));
    const embedded = (await emi.get(`/api/nodes/${tagged}/lyrics`)).json();
    assert.deepEqual(embedded, {
      source: 'tags',
      synced: false,
      lines: [
        { time: null, text: 'Es regnet' },
        { time: null, text: 'auf das Dach' },
      ],
    });

    const quiet = await put(emi, root, 'Stille.mp3', mp3([title('Stille')]));
    assert.deepEqual((await emi.get(`/api/nodes/${quiet}/lyrics`)).json(), { source: null, synced: false, lines: [] });

    const text = await put(emi, root, 'notiz.txt', Buffer.from('kein Lied'));
    assert.equal((await emi.get(`/api/nodes/${text}/lyrics`)).statusCode, 400);
    assert.equal((await lea.get(`/api/nodes/${song}/lyrics`)).statusCode, 404);
  });
});
