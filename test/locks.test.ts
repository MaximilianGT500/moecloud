import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run, value } from '../src/lib/db.ts';
import { purgeLocks } from '../src/services/locks.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let root = '';
let folder = '';
let archive = '';
let file = '';

type Lock = { userId: number; name: string; mine: boolean; expiresAt: number | null } | null;

const write = (client: Client, id: string, text: string) =>
  client.send({
    method: 'PUT',
    url: `/api/nodes/${id}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(text),
  });

const lockIn = async (client: Client, id: string) =>
  ((await client.get(`/api/nodes/${folder}/children`)).json().items as { id: string; lock: Lock }[]).find((item) => item.id === id)?.lock;

const blocked = (response: { statusCode: number; json: () => { error: { message: string } } }, message: string) => {
  assert.equal(response.statusCode, 423);
  assert.equal(response.json().error.message, message);
};

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user
    .id;
  const leaId = (await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' })).json().user
    .id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
  folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Projekt' })).json().node.id;
  archive = (await emi.json('POST', `/api/nodes/${folder}/folders`, { name: 'Archiv' })).json().node.id;
  file = (await emi.upload(folder, 'Plan.txt', Buffer.from('Version eins'), 4096)).json().node.id;
  await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: miaId, permission: 'edit' });
  await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: leaId, permission: 'edit' });
});

after(() => app.close());

describe('Dateien sperren', () => {
  it('sperrt eine Datei für alle anderen', async () => {
    const locked = await mia.json('POST', `/api/nodes/${file}/lock`, { minutes: 60 });
    assert.equal(locked.statusCode, 200, locked.body);
    assert.equal(locked.json().lock.mine, true);
    assert.ok(Math.abs(locked.json().lock.expiresAt - (Date.now() + 3_600_000)) < 10_000);
    assert.deepEqual(await lockIn(lea, file), {
      userId: locked.json().lock.userId,
      name: 'Mia',
      mine: false,
      expiresAt: locked.json().lock.expiresAt,
    });
    assert.equal((await lockIn(mia, file))?.mine, true);
    const message = 'Mia hat die Datei gesperrt';
    blocked(await write(lea, file, 'Version von Lea'), message);
    blocked(await lea.json('PATCH', `/api/nodes/${file}`, { name: 'Plan von Lea.txt' }), message);
    blocked(await lea.json('POST', '/api/nodes/move', { ids: [file], target: archive }), message);
    blocked(await lea.json('POST', '/api/nodes/trash', { ids: [file] }), message);
    blocked(await lea.json('POST', `/api/nodes/${file}/lock`, {}), message);
    blocked(await lea.json('POST', '/api/uploads', { parentId: folder, name: 'Plan.txt', size: 4, conflict: 'replace' }), message);
    const inside = 'In diesem Ordner hat Mia eine Datei gesperrt';
    blocked(await emi.json('POST', '/api/nodes/trash', { ids: [folder] }), inside);
    blocked(await emi.json('PATCH', `/api/nodes/${folder}`, { name: 'Projekt alt' }), inside);
    assert.equal((await emi.json('PATCH', `/api/nodes/${archive}`, { name: 'Archiv 2026' })).statusCode, 200);
    assert.equal((await lea.get(`/api/nodes/${file}/content`)).body, 'Version eins');
    assert.equal((await write(mia, file, 'Version von Mia')).statusCode, 200);
    assert.equal((await mia.json('PATCH', `/api/nodes/${file}`, { name: 'Plan.md' })).statusCode, 200);
    const denied = await lea.json('DELETE', `/api/nodes/${file}/lock`);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.message, 'Entsperren können nur Mia, die Person, der die Datei gehört, und Admins');
  });

  it('sperrt auch WebDAV', async () => {
    const token = (await emi.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json().token as string;
    const authorization = `Basic ${Buffer.from(`emi:${token}`).toString('base64')}`;
    const dav = (method: string, url: string, headers: Record<string, string> = {}, payload?: string) =>
      app.inject({ method: method as 'GET', url, headers: { authorization, ...headers }, payload });
    assert.equal((await dav('PUT', '/dav/Projekt/Plan.md', {}, 'Version von Emi')).statusCode, 423);
    assert.equal((await dav('DELETE', '/dav/Projekt/Plan.md')).statusCode, 423);
    assert.equal((await dav('MOVE', '/dav/Projekt/Plan.md', { destination: '/dav/Plan.md' })).statusCode, 423);
    assert.equal((await dav('MOVE', '/dav/Projekt', { destination: '/dav/Projekt alt' })).statusCode, 423);
    assert.equal((await dav('LOCK', '/dav/Projekt/Plan.md', {}, '')).statusCode, 423);
    assert.equal((await dav('COPY', '/dav/Projekt/Plan.md', { destination: '/dav/Kopie.md' })).statusCode, 201);
    assert.equal((await dav('GET', '/dav/Projekt/Plan.md')).body, 'Version von Mia');
  });

  it('lässt Besitz und Admins entsperren und sagt Bescheid', async () => {
    const removed = await emi.json('DELETE', `/api/nodes/${file}/lock`);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().removed, true);
    assert.equal(await lockIn(mia, file), null);
    const note = (await mia.get('/api/notifications')).json().items.find((item: { kind: string }) => item.kind === 'lock_removed');
    assert.equal(note.title, 'Emi hat deine Sperre für „Plan.md“ gelöst');
    assert.equal(note.url, `/files/folder/${folder}?select=${file}`);
    assert.equal((await write(lea, file, 'Version von Lea')).statusCode, 200);
    assert.equal((await lea.json('DELETE', `/api/nodes/${file}/lock`)).json().removed, false);
  });

  it('läuft ab und gilt nur für Dateien', async () => {
    const open = await lea.json('POST', `/api/nodes/${file}/lock`, {});
    assert.equal(open.json().lock.expiresAt, null);
    blocked(await write(mia, file, 'Version von Mia'), 'Lea hat die Datei gesperrt');
    run('UPDATE locks SET expires_at = ? WHERE node_id = ?', Date.now() - 1000, file);
    assert.equal(await lockIn(mia, file), null);
    assert.equal((await write(mia, file, 'Version von Mia')).statusCode, 200);
    assert.equal(purgeLocks(), 1);
    assert.equal(Number(value('SELECT COUNT(*) FROM locks')), 0);
    const folderLock = await mia.json('POST', `/api/nodes/${folder}/lock`, {});
    assert.equal(folderLock.statusCode, 400);
    assert.equal(folderLock.json().error.message, 'Sperren geht nur bei Dateien');
    const tooLong = await mia.json('POST', `/api/nodes/${file}/lock`, { minutes: 60 * 24 * 31 });
    assert.equal(tooLong.statusCode, 400);
  });
});
