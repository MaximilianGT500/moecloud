import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { subtitleLanguage, toVtt } from '../src/lib/subtitles.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let miaId = 0;

async function folder(parent: string, name: string): Promise<string> {
  return (await emi.json('POST', `/api/nodes/${parent}/folders`, { name })).json().node.id;
}

async function file(parent: string, name: string, content: Buffer | string): Promise<string> {
  const response = await emi.upload(parent, name, Buffer.from(content), 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id;
}

const srt =
  '﻿1\r\n00:00:01,500 --> 00:00:04,000\r\n<font color="#ffff00">Hallo Mia</font>\r\n\r\n2\r\n0:01:02,25 --> 0:01:05,000\r\n{\\an8}Oben\r\n';

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(async () => {
  await app.close();
});

describe('Untertitel', () => {
  it('wandelt SRT in WebVTT um', () => {
    assert.equal(
      toVtt(Buffer.from(srt), 'Film.srt'),
      'WEBVTT\n\n1\n00:00:01.500 --> 00:00:04.000\nHallo Mia\n\n2\n00:01:02.250 --> 00:01:05.000\nOben\n'
    );
    assert.equal(toVtt(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]), 'Alt.srt'), 'WEBVTT\n\nGrüße\n');
    assert.equal(
      toVtt(Buffer.from('WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nLea\r\n'), 'a.vtt'),
      'WEBVTT\n\n00:01.000 --> 00:02.000\nLea\n'
    );
    assert.equal(toVtt(Buffer.from('00:01.000 --> 00:02.000\nLea\n'), 'b.VTT'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nLea\n');
  });

  it('erkennt passende Dateien und Sprachen am Namen', () => {
    assert.equal(subtitleLanguage('Film.mp4', 'Film.srt'), null);
    assert.equal(subtitleLanguage('Film.mp4', 'film.EN.vtt'), 'EN');
    assert.equal(subtitleLanguage('Film.mp4', 'Film.de.forced.srt'), 'de.forced');
    assert.equal(subtitleLanguage('Film.mp4', 'Filmabend.srt'), undefined);
    assert.equal(subtitleLanguage('Film.mp4', 'Film.ein sehr langer Zusatz.srt'), undefined);
  });

  it('findet Untertitel neben dem Video und liefert sie als WebVTT', async () => {
    const place = await folder(root, 'Filme');
    const video = await file(place, 'Urlaub.mp4', 'kein echtes Video');
    await file(place, 'Urlaub.srt', srt);
    await file(place, 'Urlaub.en.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello Lea\n');
    await file(place, 'Anderes.srt', srt);
    const list = (await emi.get(`/api/nodes/${video}/subtitles`)).json().items;
    assert.deepEqual(
      list.map((entry: { name: string; lang: string | null }) => [entry.name, entry.lang]),
      [
        ['Urlaub.en.vtt', 'en'],
        ['Urlaub.srt', null],
      ]
    );
    const vtt = await emi.get(`/api/nodes/${list[1].id}/vtt`);
    assert.equal(vtt.statusCode, 200);
    assert.equal(vtt.headers['content-type'], 'text/vtt; charset=utf-8');
    assert.match(vtt.body, /^WEBVTT\n\n1\n00:00:01\.500 --> 00:00:04\.000\nHallo Mia/);
    assert.equal((await emi.get(`/api/nodes/${video}/vtt`)).statusCode, 400);

    const single = await file(place, 'Kurz.mp4', 'kein Video');
    await file(place, 'Kurz.srt', srt);
    await emi.json('POST', `/api/nodes/${single}/grants`, { userId: miaId, permission: 'view' });
    assert.deepEqual((await mia.get(`/api/nodes/${single}/subtitles`)).json().items, []);
    await emi.json('POST', `/api/nodes/${place}/grants`, { userId: miaId, permission: 'view' });
    assert.equal((await mia.get(`/api/nodes/${video}/subtitles`)).json().items.length, 2);

    const link = (await emi.json('POST', `/api/nodes/${place}/links`, {})).json().link.token;
    const guest = new Client(app);
    const shared = (await guest.get(`/api/public/${link}/nodes/${video}/subtitles`)).json().items;
    assert.equal(shared.length, 2);
    const text = await guest.get(`/api/public/${link}/nodes/${shared[1].id}/vtt`);
    assert.match(text.body, /Hallo Mia/);
    const lonely = (await emi.json('POST', `/api/nodes/${video}/links`, {})).json().link.token;
    assert.deepEqual((await guest.get(`/api/public/${lonely}/nodes/${video}/subtitles`)).json().items, []);
  });
});

describe('Wiedergabe fortsetzen', () => {
  it('merkt sich die Stelle pro Person und Fassung', async () => {
    const place = await folder(root, 'Serien');
    const video = await file(place, 'Folge 1.mp4', 'erste Fassung');
    assert.equal((await emi.get(`/api/nodes/${video}/position`)).json().position, null);
    const saved = await emi.json('PUT', `/api/nodes/${video}/position`, { seconds: 100, duration: 600 });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await emi.get(`/api/nodes/${video}/position`)).json().position.seconds, 100);
    const listed = (await emi.get(`/api/nodes/${place}/children`)).json().items[0];
    assert.equal(listed.progress, 0.167);
    await emi.json('POST', `/api/nodes/${place}/grants`, { userId: miaId, permission: 'view' });
    assert.equal((await mia.get(`/api/nodes/${video}/position`)).json().position, null);
    assert.equal((await mia.json('PUT', `/api/nodes/${video}/position`, { seconds: 30, duration: 600 })).statusCode, 200);
    assert.equal((await emi.get(`/api/nodes/${video}/position`)).json().position.seconds, 100);

    assert.equal((await emi.json('PUT', `/api/nodes/${video}/position`, { seconds: 590, duration: 600 })).json().position, null);
    assert.equal((await emi.get(`/api/nodes/${place}/children`)).json().items[0].progress, null);

    await emi.json('PUT', `/api/nodes/${video}/position`, { seconds: 200, duration: 600 });
    const replaced = await emi.upload(place, 'Folge 1.mp4', Buffer.from('zweite Fassung'), 64 * 1024, { conflict: 'replace' });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal((await emi.get(`/api/nodes/${video}/position`)).json().position, null);
    assert.equal((await emi.json('PUT', `/api/nodes/${place}/position`, { seconds: 20, duration: 600 })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/nodes/${video}/position`, { seconds: -1, duration: 600 })).statusCode, 400);
  });
});
