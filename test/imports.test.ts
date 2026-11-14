import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, setUp } from './helpers.ts';
import { fileName, importsSettled, isPublicAddress } from '../src/services/imports.ts';
import * as settings from '../src/services/settings.ts';
import { findByUsername } from '../src/services/users.ts';

let app: Awaited<ReturnType<typeof createApp>>;
let emi: Client;
let root = '';
let server: Server;
let base = '';

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/Bericht.pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.end('%PDF-1.4 Bericht von Mia');
    } else if (request.url === '/weiter') {
      response.writeHead(302, { location: '/Notizen%20von%20Lea.txt' });
      response.end();
    } else if (request.url === '/Notizen%20von%20Lea.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('Einkaufsliste für Lea');
    } else if (request.url === '/download?id=7') {
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': "attachment; filename*=UTF-8''Fotos%20Kyoto.zip",
      });
      response.end('PK\u0003\u0004');
    } else if (request.url === '/gross') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.alloc(64 * 1024, 1));
    } else if (request.url === '/kreis') {
      response.writeHead(302, { location: '/kreis' });
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  app = await createApp();
  emi = await setUp(app);
  root = findByUsername('emi')!.root_id!;
});

after(async () => {
  await app.close();
  server.close();
});

async function load(url: string, name?: string) {
  const response = await emi.json('POST', `/api/nodes/${root}/import`, { url, ...(name ? { name } : {}) });
  await importsSettled();
  return response;
}

const job = async (id: string) =>
  (await emi.get('/api/imports')).json().items.find((entry: { id: string }) => entry.id === id) as {
    status: string;
    name: string | null;
    error: string | null;
    received: number;
  };

describe('Aus dem Internet laden', () => {
  it('erkennt Adressen im lokalen Netz', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.178.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd12::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'localhost',
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.4.4']) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  it('findet einen passenden Dateinamen', () => {
    assert.equal(fileName(new URL('https://example.com/a/Urlaub%20Kyoto.jpg?x=1'), undefined, 'image/jpeg'), 'Urlaub Kyoto.jpg');
    assert.equal(
      fileName(new URL('https://example.com/get'), 'attachment; filename="Rechnung Mai.pdf"', 'application/pdf'),
      'Rechnung Mai.pdf'
    );
    assert.equal(
      fileName(new URL('https://example.com/get'), "attachment; filename*=UTF-8''%C3%9Cbersicht.csv", undefined),
      'Übersicht.csv'
    );
    assert.equal(fileName(new URL('https://example.com/'), undefined, 'application/pdf'), 'example.com.pdf');
    assert.equal(fileName(new URL('https://example.com/..%2F..%2Fpasswd'), undefined, undefined), '.._.._passwd');
  });

  it('sperrt lokale Adressen, solange die Verwaltung sie nicht erlaubt', async () => {
    const literal = await emi.json('POST', `/api/nodes/${root}/import`, { url: `${base}/Bericht.pdf` });
    assert.equal(literal.statusCode, 403);
    const named = await load(`${base.replace('127.0.0.1', 'localhost')}/Bericht.pdf`);
    assert.equal(named.statusCode, 202, named.body);
    const failed = await job(named.json().job.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error!, /lokalen Netz/);
    assert.equal((await emi.json('POST', `/api/nodes/${root}/import`, { url: 'ftp://example.com/x' })).statusCode, 400);
    assert.equal((await emi.json('POST', `/api/nodes/${root}/import`, { url: 'kein link' })).statusCode, 400);
  });

  it('lädt Dateien herunter, auch über Weiterleitungen', async () => {
    settings.set('import.private', true);
    const pdf = await load(`${base}/Bericht.pdf`);
    assert.equal(pdf.statusCode, 202, pdf.body);
    const done = await job(pdf.json().job.id);
    assert.equal(done.status, 'done', done.error ?? '');
    assert.equal(done.name, 'Bericht.pdf');
    const listing = (await emi.get(`/api/nodes/${root}/children`)).json().items as { id: string; name: string; mime: string }[];
    const file = listing.find((item) => item.name === 'Bericht.pdf')!;
    assert.equal(file.mime, 'application/pdf');
    assert.equal((await emi.get(`/api/nodes/${file.id}/content`)).body, '%PDF-1.4 Bericht von Mia');
    const moved = await job((await load(`${base}/weiter`)).json().job.id);
    assert.equal(moved.name, 'Notizen von Lea.txt');
    const named = await job((await load(`${base}/download?id=7`)).json().job.id);
    assert.equal(named.name, 'Fotos Kyoto.zip');
    const again = await job((await load(`${base}/Bericht.pdf`)).json().job.id);
    assert.equal(again.name, 'Bericht (2).pdf');
    const custom = await job((await load(`${base}/Bericht.pdf`, 'Quartal.pdf')).json().job.id);
    assert.equal(custom.name, 'Quartal.pdf');
    const notes = (await emi.get('/api/notifications')).json().items as { title: string }[];
    assert.ok(notes.some((note) => note.title === '„Bericht.pdf“ ist fertig geladen'));
  });

  it('meldet Fehler beim Herunterladen', async () => {
    const missing = await job((await load(`${base}/fehlt`)).json().job.id);
    assert.equal(missing.status, 'failed');
    assert.match(missing.error!, /404/);
    const loop = await job((await load(`${base}/kreis`)).json().job.id);
    assert.match(loop.error!, /Weiterleitungen/);
    settings.set('storage.maxUpload', 1024);
    const big = await job((await load(`${base}/gross`)).json().job.id);
    assert.equal(big.status, 'failed');
    assert.match(big.error!, /höchstens/);
    settings.set('storage.maxUpload', 0);
    const notes = (await emi.get('/api/notifications')).json().items as { title: string; text: string }[];
    assert.ok(notes.some((note) => note.title.startsWith('Der Download von 127.0.0.1') && /404/.test(note.text)));
  });

  it('lässt sich ausschalten', async () => {
    settings.set('import.enabled', false);
    assert.equal((await emi.json('POST', `/api/nodes/${root}/import`, { url: `${base}/Bericht.pdf` })).statusCode, 403);
    settings.set('import.enabled', true);
  });
});
