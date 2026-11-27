import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/lib/db.ts';
import { expireSnippets } from '../src/snippets/store.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let lea: Client;
let guest: Client;

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'lea-passwort-123' });
  assert.equal(made.statusCode, 200, made.body);
  lea = await login(app, 'lea', 'lea-passwort-123');
  guest = new Client(app);
});

after(() => app.close());

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop()!;

describe('Schnipsel', () => {
  let id = '';
  let token = '';

  it('legt Schnipsel an, sucht und ändert sie', async () => {
    const created = await emi.json('POST', '/api/snippets', {
      title: 'Ramen-Timer',
      language: 'typescript',
      content: 'const minuten = 3;\nconsole.log(`Ramen in ${minuten} Minuten`);\n',
    });
    assert.equal(created.statusCode, 200, created.body);
    const { snippet } = created.json();
    id = snippet.id;
    assert.equal(snippet.lines, 2);
    assert.equal(snippet.shared, false);
    assert.equal(snippet.link, null);
    await emi.json('POST', '/api/snippets', { title: 'Matcha', language: 'markdown', content: '# Matcha\n\n- 2 g Pulver\n- 70 ml Wasser' });
    const list = (await emi.get('/api/snippets')).json().snippets;
    assert.equal(list.length, 2);
    assert.equal(list[0].preview.startsWith('# Matcha'), true);
    assert.equal(list[0].content, undefined, 'die Liste schickt nur eine Vorschau');
    assert.equal((await emi.get('/api/snippets?q=minuten')).json().snippets[0].id, id);
    const changed = await emi.json('PATCH', `/api/snippets/${id}`, { title: 'Ramen-Timer v2' });
    assert.equal(changed.json().snippet.content.includes('minuten'), true);
    assert.equal(changed.json().snippet.title, 'Ramen-Timer v2');
    assert.equal((await emi.json('POST', '/api/snippets', { title: 'leer', language: 'text', content: '   ' })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/snippets', { title: 'x', language: 'brainfuck', content: '+' })).statusCode, 400);
    const huge = await emi.json('POST', '/api/snippets', { title: 'groß', language: 'text', content: 'ä'.repeat(300 * 1024) });
    assert.equal(huge.statusCode, 400);
  });

  it('teilt per Link mit Seite, Rohtext und Aufrufzähler', async () => {
    const shared = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true } });
    assert.equal(shared.statusCode, 200, shared.body);
    const { snippet } = shared.json();
    assert.equal(snippet.shared, true);
    assert.match(snippet.link, /\/t\/[A-Za-z0-9_-]{22}$/);
    token = tokenOf(snippet.link);
    const page = await guest.get(`/t/${token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<meta name="robots" content="noindex">/);
    assert.match(page.body, /Ramen-Timer v2/);
    const data = await guest.get(`/api/public/snippets/${token}`);
    assert.equal(data.statusCode, 200, data.body);
    assert.equal(data.json().snippet.content.startsWith('const minuten'), true);
    assert.equal(data.json().snippet.by, 'Emi');
    const raw = await guest.get(`/t/${token}/raw`);
    assert.equal(raw.statusCode, 200);
    assert.match(raw.headers['content-type'] as string, /^text\/plain/);
    assert.equal(raw.headers['x-content-type-options'], 'nosniff');
    assert.match(raw.headers['content-security-policy'] as string, /sandbox/);
    assert.match(raw.headers['content-disposition'] as string, /Ramen-Timer v2\.ts/);
    assert.equal((await emi.get(`/api/snippets/${id}`)).json().snippet.views, 2);
  });

  it('schützt mit Passwort und gibt den Inhalt erst danach heraus', async () => {
    const short = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true, password: 'abc' } });
    assert.equal(short.statusCode, 400);
    await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true, password: 'ramen-geheim' } });
    const data = (await guest.get(`/api/public/snippets/${token}`)).json().snippet;
    assert.equal(data.protected, true);
    assert.equal(data.content, undefined);
    assert.equal((await guest.get(`/t/${token}/raw`)).statusCode, 404);
    const wrong = await guest.json('POST', `/api/public/snippets/${token}/view`, { password: 'falsch' });
    assert.equal(wrong.statusCode, 403);
    const right = await guest.json('POST', `/api/public/snippets/${token}/view`, { password: 'ramen-geheim' });
    assert.equal(right.statusCode, 200, right.body);
    assert.match(right.json().content, /Ramen in/);
    const kept = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true, renew: true } });
    assert.equal(kept.json().snippet.protected, true, 'das Passwort bleibt beim neuen Link');
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 404, 'der alte Link ist tot');
    token = tokenOf(kept.json().snippet.link);
    const open = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true, password: null } });
    assert.equal(open.json().snippet.protected, false);
  });

  it('verbrennt Einmal-Links nach dem ersten Lesen', async () => {
    const created = (
      await emi.json('POST', '/api/snippets', { title: 'WLAN', language: 'text', content: 'Passwort: ramen-und-gyoza' })
    ).json().snippet;
    const shared = (
      await emi.send({ method: 'PUT', url: `/api/snippets/${created.id}/share`, payload: { shared: true, burn: true } })
    ).json().snippet;
    const burnToken = tokenOf(shared.link);
    const preview = (await guest.get(`/api/public/snippets/${burnToken}`)).json().snippet;
    assert.equal(preview.burn, true);
    assert.equal(preview.content, undefined, 'eine Vorschau verbrennt nichts');
    const read = await guest.json('POST', `/api/public/snippets/${burnToken}/view`, {});
    assert.deepEqual(read.json(), { content: 'Passwort: ramen-und-gyoza', burned: true });
    assert.equal((await guest.json('POST', `/api/public/snippets/${burnToken}/view`, {})).statusCode, 404);
    assert.equal((await guest.get(`/t/${burnToken}`, { accept: 'text/html' })).statusCode, 404);
    assert.equal((await emi.get(`/api/snippets/${created.id}`)).statusCode, 404);
  });

  it('läuft ab und hält sich an die Regeln für Links', async () => {
    const past = await emi.send({
      method: 'PUT',
      url: `/api/snippets/${id}/share`,
      payload: { shared: true, expiresAt: Date.now() - 1000 },
    });
    assert.equal(past.statusCode, 400);
    settings.set('share.maxDays', 7);
    try {
      const capped = await emi.send({
        method: 'PUT',
        url: `/api/snippets/${id}/share`,
        payload: { shared: true, expiresAt: Date.now() + 30 * 86_400_000 },
      });
      assert.ok(capped.json().snippet.expiresAt <= Date.now() + 7 * 86_400_000 + 1000);
    } finally {
      settings.set('share.maxDays', 0);
    }
    settings.set('share.requirePassword', true);
    try {
      const missing = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true } });
      assert.equal(missing.statusCode, 400);
    } finally {
      settings.set('share.requirePassword', false);
    }
    run('UPDATE snippets SET expires_at = ? WHERE id = ?', Date.now() - 1, id);
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 404);
    assert.equal(expireSnippets(), 1);
    assert.equal((await emi.get(`/api/snippets/${id}`)).json().snippet.shared, false);
    const again = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true, expiresAt: null } });
    assert.equal(again.json().snippet.expiresAt, null);
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 200);
    const off = await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: false } });
    assert.equal(off.json().snippet.link, null);
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 404);
  });

  it('speichert Schnipsel als Datei', async () => {
    const saved = await emi.json('POST', `/api/snippets/${id}/save`, {});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().node.name, 'Ramen-Timer v2.ts');
    const raw = await emi.get(`/api/snippets/${id}/raw`);
    assert.match(raw.body, /Ramen in/);
  });

  it('hält Schnipsel getrennt und verschwindet, wenn abgeschaltet', async () => {
    assert.deepEqual((await lea.get('/api/snippets')).json().snippets, []);
    assert.equal((await lea.get(`/api/snippets/${id}`)).statusCode, 404);
    assert.equal((await lea.json('PATCH', `/api/snippets/${id}`, { title: 'Meins' })).statusCode, 404);
    assert.equal((await lea.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true } })).statusCode, 404);
    assert.equal((await lea.json('DELETE', `/api/snippets/${id}`)).statusCode, 404);
    await emi.send({ method: 'PUT', url: `/api/snippets/${id}/share`, payload: { shared: true } });
    settings.set('snippets.enabled', false);
    try {
      assert.equal((await emi.get('/api/snippets')).statusCode, 404);
      assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 404);
      assert.equal((await guest.get(`/t/${token}`, { accept: 'text/html' })).statusCode, 404);
    } finally {
      settings.set('snippets.enabled', true);
    }
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 200);
    assert.equal((await emi.json('DELETE', `/api/snippets/${id}`)).statusCode, 200);
    assert.equal((await guest.get(`/api/public/snippets/${token}`)).statusCode, 404);
  });
});
