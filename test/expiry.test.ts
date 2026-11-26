import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { one, run } from '../src/lib/db.ts';
import { expireNodes } from '../src/services/expiry.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

before(async () => {
  emi = await setUp(app);
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  root = (await emi.get('/api/session')).json().user.rootId;
});

after(() => app.close());

const text = async (name: string, parent = root) =>
  (await emi.json('POST', `/api/nodes/${parent}/text`, { name, content: 'Hallo Lea' })).json().node.id as string;

describe('Ablaufdatum für Dateien und Ordner', () => {
  it('verschiebt abgelaufene Dateien in den Papierkorb und meldet das', async () => {
    const id = await text('Entwurf.txt');
    const soon = Date.now() + 5 * 60_000;
    const set = await emi.json('PUT', `/api/nodes/${id}/expiry`, { at: soon });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().node.expiresAt, soon);
    assert.equal(expireNodes(Date.now()), 0);
    assert.equal(expireNodes(soon + 1), 1);
    const row = one<{ trashed_at: number | null; expires_at: number | null }>('SELECT trashed_at, expires_at FROM nodes WHERE id = ?', id)!;
    assert.ok(row.trashed_at);
    assert.equal(row.expires_at, null);
    const notes = (await emi.get('/api/notifications')).json().items as { kind: string; title: string }[];
    assert.ok(notes.some((note) => note.kind === 'node_expired' && note.title.includes('Entwurf.txt')));
    const restored = await emi.json('POST', '/api/nodes/restore', { ids: [id] });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(expireNodes(soon + 1), 0, 'wiederhergestellte Dateien laufen nicht gleich wieder ab');
  });

  it('nimmt ganze Ordner mit und lässt sich wieder entfernen', async () => {
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Projekt Mia' })).json().node.id as string;
    const inside = await text('Notiz.txt', folder);
    const later = Date.now() + 3_600_000;
    await emi.json('PUT', `/api/nodes/${folder}/expiry`, { at: later });
    const cleared = await emi.json('PUT', `/api/nodes/${folder}/expiry`, { at: null });
    assert.equal(cleared.json().node.expiresAt, null);
    assert.equal(expireNodes(later + 1), 0);
    await emi.json('PUT', `/api/nodes/${folder}/expiry`, { at: later });
    assert.equal(expireNodes(later + 1), 1);
    assert.ok(one<{ trashed_at: number | null }>('SELECT trashed_at FROM nodes WHERE id = ?', inside)!.trashed_at);
  });

  it('lässt Inhalte eines wiederhergestellten Ordners nicht sofort wieder ablaufen', async () => {
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Urlaub Lea' })).json().node.id as string;
    const soon = await text('Bald.txt', folder);
    const later = await text('Später.txt', folder);
    const far = Date.now() + 30 * 86_400_000;
    await emi.json('PUT', `/api/nodes/${soon}/expiry`, { at: Date.now() + 120_000 });
    await emi.json('PUT', `/api/nodes/${later}/expiry`, { at: far });
    assert.equal((await emi.json('POST', '/api/nodes/trash', { ids: [folder] })).statusCode, 200);
    run('UPDATE nodes SET expires_at = ? WHERE id = ?', Date.now() - 1000, soon);
    assert.equal(expireNodes(), 0);
    assert.equal((await emi.json('POST', '/api/nodes/restore', { ids: [folder] })).statusCode, 200);
    const row = (id: string) =>
      one<{ expires_at: number | null; trashed_at: number | null }>('SELECT expires_at, trashed_at FROM nodes WHERE id = ?', id)!;
    assert.equal(row(soon).expires_at, null);
    assert.equal(row(later).expires_at, far);
    assert.equal(expireNodes(), 0);
    assert.equal(row(soon).trashed_at, null);
  });

  it('prüft Zeitpunkt und Rechte', async () => {
    const id = await text('Geheim.txt');
    assert.equal((await emi.json('PUT', `/api/nodes/${id}/expiry`, { at: Date.now() - 1000 })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/nodes/${id}/expiry`, { at: Date.now() + 11 * 365 * 86_400_000 })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/nodes/${id}/expiry`, { at: 'morgen' })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/nodes/${root}/expiry`, { at: Date.now() + 3_600_000 })).statusCode, 403);
    assert.equal((await mia.json('PUT', `/api/nodes/${id}/expiry`, { at: Date.now() + 3_600_000 })).statusCode, 404);
  });
});
