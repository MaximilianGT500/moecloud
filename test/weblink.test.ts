import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, setUp } from './helpers.ts';
import { parseWeblink, weblinkFile } from '../web/src/app/files/preview/weblink.ts';

const app = await createApp();
let emi: Client;
let root = '';

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('Weblinks', () => {
  it('baut aus einer Adresse eine Datei mit sprechendem Namen', () => {
    const made = weblinkFile('https://www.example.com/docs/start?x=1#top');
    assert.deepEqual(made, {
      name: 'example.com docs start.url',
      content: '[InternetShortcut]\r\nURL=https://www.example.com/docs/start?x=1#top\r\n',
    });
    assert.deepEqual(parseWeblink(made.name, made.content), {
      url: 'https://www.example.com/docs/start?x=1#top',
      host: 'www.example.com',
      safe: true,
    });
    assert.equal(weblinkFile('https://moestudio.net').name, 'moestudio.net.url');
  });

  it('nimmt nur Webadressen ohne Zugangsdaten an', () => {
    assert.throws(() => weblinkFile('javascript:alert(1)'));
    assert.throws(() => weblinkFile('https://emi:geheim@example.com/'));
    assert.throws(() => weblinkFile('kein link'));
  });

  it('liest Verknüpfungen von Windows und macOS und stuft alles andere als unsicher ein', () => {
    const plist =
      '<?xml version="1.0"?><plist version="1.0"><dict><key>URL</key><string>https://example.org/a?b=1&amp;c=2</string></dict></plist>';
    assert.deepEqual(parseWeblink('Seite.webloc', plist), { url: 'https://example.org/a?b=1&c=2', host: 'example.org', safe: true });
    assert.equal(parseWeblink('x.url', '[InternetShortcut]\nURL=javascript:alert(1)\n')?.safe, false);
    assert.equal(parseWeblink('x.url', '[InternetShortcut]\nURL=file:///etc/passwd\n')?.safe, false);
    assert.equal(parseWeblink('x.url', '[InternetShortcut]\nURL=https://emi:pw@example.com\n')?.safe, false);
    assert.equal(parseWeblink('x.url', 'nichts'), null);
    assert.equal(parseWeblink('x.url', '[InternetShortcut]\nURL=nur text\n'), null);
  });

  it('legt die Datei über die Schnittstelle an und gibt sie als Text zurück', async () => {
    const file = weblinkFile('https://example.com/handbuch');
    const created = await emi.json('POST', `/api/nodes/${root}/text`, file);
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().node.name, 'example.com handbuch.url');
    const content = await emi.get(`/api/nodes/${created.json().node.id}/content`);
    assert.equal(content.statusCode, 200);
    assert.equal(parseWeblink(file.name, content.body)?.url, 'https://example.com/handbuch');
    assert.doesNotMatch(String(content.headers['content-type']), /html/);
  });
});

describe('Teilen aus anderen Apps', () => {
  it('nennt im Manifest Kurzbefehle und das Teilen-Ziel', async () => {
    const manifest = (await new Client(app).get('/manifest.webmanifest')).json();
    assert.equal(manifest.share_target.action, '/share-target');
    assert.equal(manifest.share_target.method, 'POST');
    assert.deepEqual(
      manifest.shortcuts.map((entry: { url: string }) => entry.url),
      ['/files/notes', '/files/photos', '/files/recent', '/files/starred']
    );
  });

  it('schickt ohne den Helfer im Browser zurück zu den Dateien, statt einen Fehler zu zeigen', async () => {
    const boundary = 'moe-grenze';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhallo\r\n--${boundary}--\r\n`;
    const response = await new Client(app).send({
      method: 'POST',
      url: '/share-target',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, '/files?geteilt=0');
  });

  it('liefert den Helfer mit dem Abfangen des Teilens aus', async () => {
    const worker = await new Client(app).get('/sw.js');
    assert.equal(worker.statusCode, 200);
    assert.match(worker.body, /url\.pathname !== '\/share-target'/);
    assert.match(worker.body, /caches\.open\('moe-share'\)/);
    assert.doesNotThrow(() => new Function(worker.body.replace(/self\./g, 'globalThis.__sw.')));
  });
});
