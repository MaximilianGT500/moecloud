import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run, value } from '../src/lib/db.ts';
import { randomId } from '../src/lib/crypto.ts';
import { purgeLinkEvents, warnExpiringLinks } from '../src/services/links.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let folder = '';
let file = '';
const DAY = 86_400_000;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

type Note = { kind: string; title: string; text: string; url: string };
const notes = async (client: Client, kind: string) =>
  ((await client.get('/api/notifications')).json().items as Note[]).filter((item) => item.kind === kind);
const message = (response: { json: () => { error: { message: string } } }) => response.json().error.message;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Urlaub 2026' })).json().node.id;
  file = (await emi.upload(folder, 'Strand.txt', Buffer.from('Sonne'), 4096)).json().node.id;
});

after(() => app.close());

describe('Wunschadresse für Links', () => {
  it('öffnet einen Link unter der eigenen Adresse', async () => {
    const created = await emi.json('POST', `/api/nodes/${folder}/links`, { slug: ' Urlaub-2026 ' });
    assert.equal(created.statusCode, 200, created.body);
    const link = created.json().link;
    assert.equal(link.slug, 'urlaub-2026');
    assert.match(link.url, /\/s\/urlaub-2026$/);
    const guest = new Client(app);
    assert.equal((await guest.get('/s/urlaub-2026', { accept: 'text/html' })).statusCode, 200);
    assert.equal((await guest.get('/s/URLAUB-2026', { accept: 'text/html' })).statusCode, 200);
    assert.equal((await guest.get('/api/public/urlaub-2026')).json().share.token, link.token);
    assert.equal((await guest.get(`/s/${link.token}`, { accept: 'text/html' })).statusCode, 200);
    for (const slug of ['ab', '-urlaub', 'urlaub-', 'mit leerzeichen', 'ümlaut', 'a'.repeat(65)]) {
      const wrong = await emi.json('POST', `/api/nodes/${file}/links`, { slug });
      assert.equal(wrong.statusCode, 400, slug);
    }
    const taken = await emi.json('POST', `/api/nodes/${file}/links`, { slug: 'urlaub-2026' });
    assert.equal(taken.statusCode, 409);
    assert.equal(message(taken), 'Diese Adresse ist schon vergeben');
    assert.equal((await emi.json('POST', `/api/nodes/${file}/links`, { slug: link.token })).statusCode, 409);
    const renamed = await emi.json('PATCH', `/api/links/${link.id}`, { slug: 'meer' });
    assert.equal(renamed.json().link.slug, 'meer');
    assert.equal((await guest.get('/s/urlaub-2026', { accept: 'text/html' })).statusCode, 404);
    assert.equal((await emi.json('PATCH', `/api/links/${link.id}`, { label: 'Fotos für Lea' })).json().link.slug, 'meer');
    await emi.json('PATCH', '/api/admin/settings', { 'share.slugs': false });
    const off = await emi.json('POST', `/api/nodes/${file}/links`, { slug: 'strand' });
    assert.equal(off.statusCode, 403);
    assert.equal((await emi.json('PATCH', `/api/links/${link.id}`, { slug: 'meer', label: 'Fotos' })).statusCode, 200);
    const cleared = await emi.json('PATCH', `/api/links/${link.id}`, { slug: null });
    assert.equal(cleared.json().link.slug, null);
    assert.match(cleared.json().link.url, new RegExp(`/s/${link.token}$`));
    await emi.json('PATCH', '/api/admin/settings', { 'share.slugs': true });
  });
});

describe('Zugriffsprotokoll für Links', () => {
  it('merkt sich Aufrufe, Downloads, Uploads und falsche Passwörter', async () => {
    const link = (await emi.json('POST', `/api/nodes/${folder}/links`, { allowUpload: true, password: 'geheim-für-lea' })).json().link;
    const guest = new Client(app);
    const page = await guest.get(`/s/${link.token}`, { accept: 'text/html', 'user-agent': CHROME });
    assert.equal(page.statusCode, 200);
    const csrf = guest.cookies.get('moe_csrf')!;
    const wrong = await guest.send({
      method: 'POST',
      url: `/s/${link.token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': CHROME },
      payload: new URLSearchParams({ _csrf: csrf, password: 'falsch' }).toString(),
    });
    assert.equal(wrong.statusCode, 403);
    const right = await guest.send({
      method: 'POST',
      url: `/s/${link.token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': CHROME },
      payload: new URLSearchParams({ _csrf: csrf, password: 'geheim-für-lea' }).toString(),
    });
    assert.equal(right.statusCode, 303);
    assert.equal((await guest.get(`/s/${link.token}`, { accept: 'text/html', 'user-agent': CHROME })).statusCode, 200);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${file}/content?download=1`, { 'user-agent': CHROME })).statusCode, 200);
    const init = await guest.json('POST', `/api/public/${link.token}/uploads`, { parentId: folder, name: 'Gruß von Lea.txt', size: 5 });
    assert.equal(init.statusCode, 200, init.body);
    await guest.send({
      method: 'PUT',
      url: `/api/public/${link.token}/uploads/${init.json().id}?offset=0`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('Hallo'),
    });
    assert.equal((await guest.json('POST', `/api/public/${link.token}/uploads/${init.json().id}/complete`)).statusCode, 200);
    const events = (await emi.get(`/api/links/${link.id}/events`)).json().items as {
      kind: string;
      name: string | null;
      device: string | null;
    }[];
    assert.deepEqual(events.map((event) => [event.kind, event.name, event.device]).reverse(), [
      ['denied', null, 'Chrome auf Windows'],
      ['view', null, 'Chrome auf Windows'],
      ['download', 'Strand.txt', 'Chrome auf Windows'],
      ['upload', 'Gruß von Lea.txt', 'Browser'],
    ]);
    assert.equal((await mia.get(`/api/links/${link.id}/events`)).statusCode, 404);
    assert.ok(!JSON.stringify(events).includes('127.0.0.1'));
  });

  it('räumt alte und überzählige Einträge auf', async () => {
    const link = (await emi.json('POST', `/api/nodes/${file}/links`, {})).json().link;
    const now = Date.now();
    for (let index = 0; index < 1005; index++) {
      run('INSERT INTO link_events (id, link_id, kind, at) VALUES (?, ?, ?, ?)', randomId(), link.id, 'view', now - index * 1000);
    }
    run('INSERT INTO link_events (id, link_id, kind, at) VALUES (?, ?, ?, ?)', randomId(), link.id, 'view', now - 100 * DAY);
    assert.equal(purgeLinkEvents(90), 6);
    assert.equal(Number(value('SELECT COUNT(*) FROM link_events WHERE link_id = ?', link.id)), 1000);
    assert.equal(Number(value('SELECT MIN(at) FROM link_events WHERE link_id = ?', link.id)), now - 999 * 1000);
  });
});

describe('Erinnerung vor Ablauf', () => {
  it('erinnert einmal, bevor ein Link abläuft', async () => {
    const soon = (await emi.json('POST', `/api/nodes/${file}/links`, { label: 'Für Lea', expiresAt: Date.now() + DAY })).json().link;
    const late = (await emi.json('POST', `/api/nodes/${file}/links`, { expiresAt: Date.now() + 10 * DAY })).json().link;
    const short = (await emi.json('POST', `/api/nodes/${folder}/links`, { expiresAt: Date.now() + DAY })).json().link;
    run('UPDATE links SET created_at = ? WHERE id IN (?, ?)', Date.now() - 20 * DAY, soon.id, late.id);
    assert.equal(warnExpiringLinks(), 1);
    assert.equal(warnExpiringLinks(), 0);
    const sent = await notes(emi, 'link_expiring');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Dein Link zu „Für Lea“ läuft bald ab');
    assert.match(sent[0].text, /^Ab .+ kommt niemand mehr über den Link an den Inhalt\./);
    assert.equal(sent[0].url, `/files/folder/${folder}?select=${file}`);
    assert.equal(value('SELECT warned_at FROM links WHERE id = ?', short.id), null);
    await emi.json('PATCH', `/api/links/${soon.id}`, { label: 'Für Lea und Mia' });
    assert.notEqual(value('SELECT warned_at FROM links WHERE id = ?', soon.id), null);
    await emi.json('PATCH', `/api/links/${soon.id}`, { expiresAt: Date.now() + 36 * 60 * 60 * 1000 });
    assert.equal(value('SELECT warned_at FROM links WHERE id = ?', soon.id), null);
    assert.equal(warnExpiringLinks(), 1);
    assert.equal((await notes(emi, 'link_expiring')).length, 2);
  });
});

describe('Links melden', () => {
  it('nimmt Meldungen an und zeigt sie der Verwaltung', async () => {
    const link = (
      await mia.json(
        'POST',
        `/api/nodes/${(await mia.upload((await mia.get('/api/session')).json().user.rootId, 'Film.mkv', Buffer.from('x'), 4096)).json().node.id}/links`,
        { label: 'Filmabend' }
      )
    ).json().link;
    const guest = new Client(app);
    assert.equal((await guest.get(`/api/public/${link.token}`)).json().share.reports, true);
    assert.equal((await guest.json('POST', `/api/public/${link.token}/report`, { reason: 'langweilig' })).statusCode, 400);
    const sent = await guest.json('POST', `/api/public/${link.token}/report`, {
      reason: 'copyright',
      text: '  Der Film gehört Emily.  ',
      contact: 'emily@example.com',
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const note = (await notes(emi, 'admin_report'))[0];
    assert.equal(note.title, 'Jemand hat den Link „Filmabend“ gemeldet');
    assert.equal(note.text, 'Grund: Urheberrecht. Der Link gehört Mia.');
    assert.equal(note.url, '/admin/links');
    assert.equal((await mia.get('/api/admin/reports')).statusCode, 403);
    const open = (await emi.get('/api/admin/reports')).json().items;
    assert.equal(open.length, 1);
    assert.deepEqual(
      [open[0].label, open[0].reason, open[0].text, open[0].contact, open[0].owner.username, open[0].path, open[0].paused],
      ['Filmabend', 'copyright', 'Der Film gehört Emily.', 'emily@example.com', 'mia', `/s/${link.token}`, false]
    );
    const resolved = await emi.json('POST', `/api/admin/reports/${open[0].id}/resolve`, { pause: true });
    assert.equal(resolved.statusCode, 200, resolved.body);
    assert.deepEqual((await emi.get('/api/admin/reports')).json().items, []);
    assert.equal((await guest.get(`/api/public/${link.token}`)).statusCode, 404);
    assert.equal((await emi.json('POST', `/api/admin/reports/${open[0].id}/resolve`, {})).statusCode, 404);
    const log = JSON.stringify((await emi.get('/api/admin/audit')).json());
    assert.ok(log.includes('link_reported') && log.includes('report_resolved'));
    await emi.json('PATCH', `/api/admin/settings`, { 'share.reports': false });
    const other = (await emi.json('POST', `/api/nodes/${file}/links`, {})).json().link;
    assert.equal((await guest.get(`/api/public/${other.token}`)).json().share.reports, false);
    const off = await guest.json('POST', `/api/public/${other.token}/report`, { reason: 'other' });
    assert.equal(off.statusCode, 403);
    assert.equal(message(off), 'Melden ist auf diesem Server ausgeschaltet');
  });
});
