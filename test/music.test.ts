import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { processNow } from '../src/services/processing.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaRoot = '';
let emiId = 0;

interface Track {
  id: string;
  name: string;
  track: { title: string; artist: string; album: string; year: number | null; number: number | null; duration: number | null };
}

function syncsafe(target: Buffer, offset: number, size: number) {
  for (let index = 0; index < 4; index++) target[offset + index] = (size >> (21 - index * 7)) & 0x7f;
}

function mp3(tags: Record<string, string>) {
  const frames = Object.entries(tags).map(([id, text]) => {
    const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    syncsafe(header, 4, data.length);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(frames);
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  syncsafe(header, 6, body.length);
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([header, body, ...Array.from({ length: 6 }, () => frame)]);
}

async function folder(client: Client, parent: string, name: string): Promise<string> {
  return (await client.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function put(client: Client, parent: string, name: string, content: Buffer) {
  const response = await client.upload(parent, name, content, 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

const titles = async (client: Client, id: string) =>
  ((await client.get(`/api/playlists/${id}`)).json().items as Track[]).map((item) => item.track.title);

before(async () => {
  emi = await setUp(app);
  const session = (await emi.get('/api/session')).json().user;
  root = session.rootId;
  emiId = session.id;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  miaRoot = (await mia.get('/api/session')).json().user.rootId;
});

after(async () => {
  await app.close();
});

describe('Musik und Wiedergabelisten', () => {
  let music = '';
  let summer = '';
  let song = '';
  let rain = '';
  let plain = '';
  let text = '';
  let list = '';

  it('zeigt alle Titel mit den Angaben aus der Datei oder aus dem Namen', async () => {
    music = await folder(emi, root, 'Musik');
    summer = await folder(emi, music, 'Sommer');
    song = await put(emi, summer, '01 Sommerlied.mp3', mp3({ TIT2: 'Sommerlied', TPE1: 'Lea', TALB: 'Sommer', TRCK: '1/2', TDRC: '2025' }));
    rain = await put(emi, summer, '02 Regen.mp3', mp3({ TIT2: 'Regen', TPE1: 'Lea', TALB: 'Sommer', TRCK: '2/2' }));
    plain = await put(emi, music, '03 - Ohne Angaben.mp3', mp3({}));
    text = await put(emi, music, 'Liedtexte.txt', Buffer.from('kein Lied'));
    await processNow();
    const listed = (await emi.get('/api/music')).json() as { items: Track[]; more: boolean };
    assert.equal(listed.more, false);
    const byName = Object.fromEntries(listed.items.map((item) => [item.name, item.track]));
    assert.deepEqual(Object.keys(byName).sort(), ['01 Sommerlied.mp3', '02 Regen.mp3', '03 - Ohne Angaben.mp3']);
    assert.deepEqual(
      { ...byName['01 Sommerlied.mp3'], duration: null },
      { title: 'Sommerlied', artist: 'Lea', album: 'Sommer', year: 2025, number: 1, duration: null }
    );
    assert.equal(byName['02 Regen.mp3'].number, 2);
    assert.deepEqual(
      { ...byName['03 - Ohne Angaben.mp3'], duration: null },
      { title: 'Ohne Angaben', artist: '', album: '', year: null, number: 3, duration: null }
    );
    assert.deepEqual((await mia.get('/api/music')).json(), { items: [], more: false });
  });

  it('zählt, was gehört wurde, und merkt sich den letzten Zeitpunkt, getrennt für jede Person', async () => {
    const plays = async (client: Client) =>
      Object.fromEntries(
        ((await client.get('/api/music')).json().items as (Track & { plays: number; playedAt: number | null })[]).map((item) => [
          item.id,
          [item.plays, item.playedAt !== null],
        ])
      );
    assert.deepEqual((await plays(emi))[song], [0, false]);
    assert.equal((await emi.json('POST', '/api/music/played', { id: song })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/music/played', { id: song })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/music/played', { id: rain })).statusCode, 200);
    const counted = await plays(emi);
    assert.deepEqual(counted[song], [2, true]);
    assert.deepEqual(counted[rain], [1, true]);
    assert.deepEqual(counted[plain], [0, false]);
    assert.equal((await emi.json('POST', '/api/music/played', { id: text })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/music/played', { id: music })).statusCode, 400);
    assert.equal((await mia.json('POST', '/api/music/played', { id: song })).statusCode, 404);
    assert.equal((await emi.json('DELETE', '/api/music/played')).statusCode, 200);
    assert.deepEqual((await plays(emi))[song], [0, false]);
  });

  it('legt Wiedergabelisten an, füllt sie auch aus Ordnern und hält die Reihenfolge', async () => {
    const created = await emi.json('POST', '/api/playlists', { name: '  Abends   am See ', ids: [rain, song] });
    assert.equal(created.statusCode, 200, created.body);
    list = created.json().playlist.id;
    assert.equal(created.json().playlist.name, 'Abends am See');
    assert.equal(created.json().playlist.count, 2);
    assert.deepEqual(await titles(emi, list), ['Regen', 'Sommerlied']);
    assert.equal((await emi.json('POST', `/api/playlists/${list}/items`, { ids: [music] })).json().added, 1);
    assert.deepEqual(await titles(emi, list), ['Regen', 'Sommerlied', 'Ohne Angaben']);
    assert.equal((await emi.json('POST', `/api/playlists/${list}/items`, { ids: [text] })).statusCode, 400);
    assert.equal((await emi.json('POST', '/api/playlists', { name: ' ' })).statusCode, 400);

    const sorted = await emi.json('PATCH', `/api/playlists/${list}`, { order: [plain, rain, 'gibtEsNicht'] });
    assert.equal(sorted.statusCode, 200, sorted.body);
    assert.deepEqual(await titles(emi, list), ['Ohne Angaben', 'Regen', 'Sommerlied']);
    assert.equal((await emi.json('POST', `/api/playlists/${list}/remove`, { ids: [rain] })).json().removed, 1);
    assert.deepEqual(await titles(emi, list), ['Ohne Angaben', 'Sommerlied']);
    assert.equal((await emi.json('PATCH', `/api/playlists/${list}`, { name: 'Abends' })).json().playlist.name, 'Abends');
    assert.deepEqual(
      ((await emi.get('/api/playlists')).json().items as { name: string; count: number }[]).map((entry) => [entry.name, entry.count]),
      [['Abends', 2]]
    );
    assert.equal((await mia.get(`/api/playlists/${list}`)).statusCode, 404);
    assert.equal((await mia.json('POST', `/api/playlists/${list}/items`, { ids: [song] })).statusCode, 404);
    assert.deepEqual((await mia.get('/api/playlists')).json().items, []);
  });

  it('gibt eine Liste als M3U aus und liest eine aus der Cloud ein', async () => {
    const exported = await emi.get(`/api/playlists/${list}/m3u`);
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers['content-disposition']), /Abends\.m3u8/);
    const lines = exported.body.trim().split('\n');
    assert.deepEqual(lines.slice(0, 2), ['#EXTM3U', '#PLAYLIST:Abends']);
    assert.match(lines[2], /^#EXTINF:-?\d+,Ohne Angaben$/);
    assert.equal(lines[3], 'Musik/03 - Ohne Angaben.mp3');
    assert.match(lines[4], /^#EXTINF:-?\d+,Lea - Sommerlied$/);
    assert.equal(lines[5], 'Musik/Sommer/01 Sommerlied.mp3');

    const file = await put(
      emi,
      music,
      'Putzen.m3u8',
      Buffer.from(
        [
          '#EXTM3U',
          '#PLAYLIST:Zum Putzen',
          '#EXTINF:12,Lea - Regen',
          'Sommer/02 Regen.mp3',
          './03 - Ohne Angaben.mp3',
          '..\\Musik\\Sommer\\01 Sommerlied.mp3',
          '/Musik/Sommer/02 Regen.mp3',
          'https://example.org/radio.mp3',
          'Fehlt.mp3',
          'Liedtexte.txt',
          '',
        ].join('\r\n')
      )
    );
    const imported = await emi.json('POST', `/api/nodes/${file}/playlist`, {});
    assert.equal(imported.statusCode, 200, imported.body);
    assert.equal(imported.json().added, 3);
    assert.equal(imported.json().missing, 3);
    assert.equal(imported.json().playlist.name, 'Zum Putzen');
    assert.deepEqual(await titles(emi, imported.json().playlist.id), ['Regen', 'Ohne Angaben', 'Sommerlied']);

    const empty = await put(emi, music, 'Leer.m3u', Buffer.from('#EXTM3U\nNirgends.mp3\n'));
    assert.equal((await emi.json('POST', `/api/nodes/${empty}/playlist`, {})).statusCode, 400);
    assert.equal((await emi.json('POST', `/api/nodes/${text}/playlist`, {})).statusCode, 400);
    const old = await put(emi, music, 'Alt.m3u', Buffer.from('Sommer/02 Regen.mp3\n', 'latin1'));
    const named = await emi.json('POST', `/api/nodes/${old}/playlist`, {});
    assert.equal(named.json().playlist.name, 'Alt');
    assert.equal((await emi.get('/api/playlists')).json().items.length, 3);
    assert.equal((await emi.json('DELETE', `/api/playlists/${named.json().playlist.id}`)).statusCode, 200);
    assert.equal((await emi.get('/api/playlists')).json().items.length, 2);
  });

  it('lässt Gelöschtes und nicht mehr Geteiltes aus der Liste verschwinden', async () => {
    await emi.json('POST', '/api/nodes/trash', { ids: [plain] });
    assert.deepEqual(await titles(emi, list), ['Sommerlied']);
    assert.equal((await emi.get('/api/music')).json().items.length, 2);
    await emi.json('POST', '/api/nodes/restore', { ids: [plain] });
    assert.deepEqual(await titles(emi, list), ['Ohne Angaben', 'Sommerlied']);

    const album = await folder(mia, miaRoot, 'Mias Platten');
    const foreign = await put(mia, album, 'Fremd.mp3', mp3({ TIT2: 'Von Mia', TPE1: 'Mia' }));
    await processNow();
    assert.equal((await emi.json('POST', `/api/playlists/${list}/items`, { ids: [foreign] })).statusCode, 404);
    const grant = await mia.json('POST', `/api/nodes/${album}/grants`, { userId: emiId, permission: 'view' });
    assert.equal(grant.statusCode, 200, grant.body);
    assert.equal((await emi.json('POST', `/api/playlists/${list}/items`, { ids: [foreign] })).json().added, 1);
    assert.deepEqual(await titles(emi, list), ['Ohne Angaben', 'Sommerlied', 'Von Mia']);
    assert.equal((await emi.get('/api/music')).json().items.length, 3);
    const exported = (await emi.get(`/api/playlists/${list}/m3u`)).body.trim().split('\n');
    assert.equal(exported[exported.length - 1], 'Mias Platten/Fremd.mp3');
    assert.equal((await mia.json('DELETE', `/api/grants/${grant.json().grant.id}`)).statusCode, 200);
    assert.deepEqual(await titles(emi, list), ['Ohne Angaben', 'Sommerlied']);
    assert.equal(
      ((await emi.get('/api/playlists')).json().items as { id: string; count: number }[]).find((entry) => entry.id === list)!.count,
      2
    );
  });
});
