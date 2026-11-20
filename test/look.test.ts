import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { run } from '../src/lib/db.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

async function folder(client: Client, parent: string, name: string): Promise<string> {
  return (await client.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function put(client: Client, parent: string, name: string, content: Buffer) {
  const response = await client.upload(parent, name, content, 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

const listed = async (client: Client, parent: string) =>
  (await client.get(`/api/nodes/${parent}/children`)).json().items as { id: string; icon: string | null; color: string | null }[];

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(() => app.close());

describe('Symbole für Ordner', () => {
  it('setzt, zeigt und entfernt ein Symbol, auch für mehrere Ordner', async () => {
    const first = await folder(emi, root, 'Reisen');
    const second = await folder(emi, root, 'Rezepte');
    const set = await emi.json('PUT', '/api/nodes/icon', { ids: [first, second], icon: 'travel' });
    assert.equal(set.statusCode, 200, set.body);
    let items = await listed(emi, root);
    assert.equal(items.find((item) => item.id === first)?.icon, 'travel');
    assert.equal(items.find((item) => item.id === second)?.icon, 'travel');
    await emi.json('PUT', '/api/nodes/color', { ids: [first], color: 'teal' });
    await emi.json('PUT', '/api/nodes/icon', { ids: [second], icon: null });
    items = await listed(emi, root);
    assert.deepEqual([items.find((item) => item.id === first)?.icon, items.find((item) => item.id === first)?.color], ['travel', 'teal']);
    assert.equal(items.find((item) => item.id === second)?.icon, null);
  });

  it('nimmt nur bekannte Symbole, nur Ordner und nur mit Schreibrecht', async () => {
    const own = await folder(emi, root, 'Belege');
    const file = await put(emi, root, 'notiz.txt', Buffer.from('hallo'));
    assert.equal((await emi.json('PUT', '/api/nodes/icon', { ids: [own], icon: 'rakete' })).statusCode, 400);
    assert.equal((await emi.json('PUT', '/api/nodes/icon', { ids: [file], icon: 'star' })).statusCode, 400);
    assert.equal((await emi.json('PUT', '/api/nodes/icon', { ids: [root], icon: 'star' })).statusCode, 400);
    assert.equal((await mia.json('PUT', '/api/nodes/icon', { ids: [own], icon: 'star' })).statusCode, 404);
    assert.equal((await listed(emi, root)).find((item) => item.id === file)?.icon, null);
  });
});

describe('Links mit Beginn, Nachricht und Theme', () => {
  it('schaltet einen Link erst zum Beginn frei und sagt vorher, ab wann er gilt', async () => {
    const id = await put(emi, root, 'einladung.txt', Buffer.from('Bis bald'));
    const startsAt = Date.now() + 3 * 86_400_000;
    const created = await emi.json('POST', `/api/nodes/${id}/links`, { startsAt, message: '  Für Lea, bitte bis Freitag ansehen.  ' });
    assert.equal(created.statusCode, 200, created.body);
    const link = created.json().link;
    assert.equal(link.startsAt, startsAt);
    assert.equal(link.scheduled, true);
    assert.equal(link.message, 'Für Lea, bitte bis Freitag ansehen.');
    const guest = new Client(app);
    const early = await guest.get(`/s/${link.token}`);
    assert.equal(early.statusCode, 404);
    assert.match(early.body, /noch nicht freigeschaltet/);
    assert.match(early.body, new RegExp(String(new Date(startsAt).getFullYear())));
    assert.equal((await guest.get(`/api/public/${link.token}`)).statusCode, 404);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${id}/content`)).statusCode, 404);

    run('UPDATE links SET starts_at = ? WHERE id = ?', Date.now() - 1000, link.id);
    const open = await guest.get(`/api/public/${link.token}`);
    assert.equal(open.statusCode, 200, open.body);
    assert.equal(open.json().share.message, 'Für Lea, bitte bis Freitag ansehen.');
    const shown = (await emi.get(`/api/nodes/${id}/shares`)).json().links[0];
    assert.equal(shown.scheduled, false);
  });

  it('prüft Beginn und Ablauf gegeneinander und lässt den Beginn wieder entfernen', async () => {
    const id = await put(emi, root, 'plan.txt', Buffer.from('Plan'));
    const soon = Date.now() + 86_400_000;
    const wrong = await emi.json('POST', `/api/nodes/${id}/links`, { startsAt: soon + 1000, expiresAt: soon });
    assert.equal(wrong.statusCode, 400);
    assert.match(wrong.json().error.message, /Beginn/);
    const link = (await emi.json('POST', `/api/nodes/${id}/links`, { startsAt: soon, expiresAt: soon + 86_400_000 })).json().link;
    const later = await emi.json('PATCH', `/api/links/${link.id}`, { startsAt: soon + 2 * 86_400_000 });
    assert.equal(later.statusCode, 400);
    const kept = await emi.json('PATCH', `/api/links/${link.id}`, { label: 'Plan für Mia' });
    assert.equal(kept.json().link.startsAt, soon);
    const cleared = await emi.json('PATCH', `/api/links/${link.id}`, { startsAt: null, message: '' });
    assert.equal(cleared.json().link.startsAt, null);
    assert.equal(cleared.json().link.scheduled, false);
    assert.equal(cleared.json().link.message, null);
    assert.equal((await emi.json('PATCH', `/api/links/${link.id}`, { message: 'x'.repeat(501) })).statusCode, 400);
  });

  it('zeigt die Seite eines Links im gewählten Theme', async () => {
    const id = await put(emi, root, 'fotos.txt', Buffer.from('Fotos'));
    const unknown = await emi.json('POST', `/api/nodes/${id}/links`, { theme: 'gibt-es-nicht' });
    assert.equal(unknown.statusCode, 400);
    const link = (await emi.json('POST', `/api/nodes/${id}/links`, { theme: 'ozean' })).json().link;
    assert.equal(link.theme, 'ozean');
    const guest = new Client(app);
    const page = await guest.get(`/s/${link.token}`);
    assert.equal(page.statusCode, 200);
    const boot = JSON.parse(/<script type="application\/json" id="moe-boot">(.*?)<\/script>/s.exec(page.body)![1]);
    assert.equal(boot.theme.id, 'ozean');
    assert.equal(boot.site.seed, '#0284c7');
    const plain = (await emi.json('PATCH', `/api/links/${link.id}`, { theme: null })).json().link;
    assert.equal(plain.theme, null);
    const again = JSON.parse(
      /<script type="application\/json" id="moe-boot">(.*?)<\/script>/s.exec((await guest.get(`/s/${link.token}`)).body)![1]
    );
    assert.notEqual(again.theme.id, 'ozean');
  });
});

describe('Einstellungen für Navigation und Startseite', () => {
  it('merkt sich Reihenfolge, Ausgeblendetes und die untere Leiste', async () => {
    const nav = { order: ['notes', 'files', 'photos'], hidden: ['music'], bar: ['home', 'files', 'notes', 'shared'] };
    const saved = await emi.json('PATCH', '/api/account/prefs', { nav, home: { order: ['starred', 'recent'], hidden: ['storage'] } });
    assert.equal(saved.statusCode, 200, saved.body);
    const account = (await emi.get('/api/account')).json();
    assert.deepEqual(account.prefs.nav, nav);
    assert.deepEqual(account.prefs.home, { order: ['starred', 'recent'], hidden: ['storage'] });
    const page = await emi.get('/files');
    const boot = JSON.parse(/<script type="application\/json" id="moe-boot">(.*?)<\/script>/s.exec(page.body)![1]);
    assert.deepEqual(boot.nav, nav);
    const reset = await emi.json('PATCH', '/api/account/prefs', { nav: null, home: null });
    assert.equal(reset.json().prefs.nav, null);
    assert.equal(reset.json().prefs.home, null);
  });

  it('lässt höchstens vier Einträge in der unteren Leiste zu', async () => {
    const response = await emi.json('PATCH', '/api/account/prefs', {
      nav: { order: [], hidden: [], bar: ['home', 'files', 'photos', 'notes', 'music'] },
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().error.message, /höchstens vier/);
  });
});
