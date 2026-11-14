import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let root = '';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% Rechnung für Lea\n%%EOF\n');

const message = [
  'From: Mia Weber <mia@example.com>',
  'To: Emi Sato <emi@example.com>, Lea <lea@example.com>',
  'Cc: emily@example.com',
  'Subject: =?UTF-8?Q?Rechnung_f=C3=BCr_Oktober?=',
  'Date: Tue, 03 Nov 2026 09:30:00 +0100',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="aussen"',
  '',
  '--aussen',
  'Content-Type: multipart/related; boundary="innen"',
  '',
  '--innen',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hallo Emi,</p><p>hier die Rechnung.</p><img src="cid:logo@moe"><img src="https://tracker.example.com/p.gif"><script>alert(1)</script>',
  '--innen',
  'Content-Type: image/png',
  'Content-ID: <logo@moe>',
  'Content-Transfer-Encoding: base64',
  '',
  PIXEL.toString('base64'),
  '--innen--',
  '--aussen',
  'Content-Type: application/pdf; name="Rechnung.pdf"',
  'Content-Disposition: attachment; filename="../Rechnung.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  PDF.toString('base64'),
  '--aussen--',
  '',
].join('\r\n');

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('E-Mails ansehen', () => {
  let mail = '';

  before(async () => {
    mail = (await emi.upload(root, 'Rechnung Oktober.eml', Buffer.from(message), 1 << 20)).json().node.id;
  });

  it('zeigt Absender, Empfänger und Anhänge', async () => {
    const response = await emi.get(`/api/nodes/${mail}/email`);
    assert.equal(response.statusCode, 200, response.body);
    const summary = response.json();
    assert.equal(summary.subject, 'Rechnung für Oktober');
    assert.deepEqual(summary.from, [{ name: 'Mia Weber', address: 'mia@example.com' }]);
    assert.deepEqual(
      summary.to.map((entry: { address: string }) => entry.address),
      ['emi@example.com', 'lea@example.com']
    );
    assert.equal(summary.cc[0].address, 'emily@example.com');
    assert.equal(summary.date, Date.parse('2026-11-03T08:30:00Z'));
    assert.equal(summary.html, true);
    assert.equal(summary.remote, true);
    assert.deepEqual(summary.attachments, [
      { index: 1, name: '.._Rechnung.pdf', type: 'application/pdf', size: PDF.length, inline: false },
    ]);
  });

  it('zeigt den Inhalt abgeschottet und ohne Bilder aus dem Internet', async () => {
    const body = await emi.get(`/api/nodes/${mail}/email/body`);
    assert.equal(body.statusCode, 200);
    assert.match(String(body.headers['content-type']), /^text\/html/);
    const policy = String(body.headers['content-security-policy']);
    assert.match(policy, /^sandbox allow-popups allow-popups-to-escape-sandbox;/);
    assert.doesNotMatch(policy, /allow-scripts|allow-same-origin/);
    assert.match(policy, /img-src data:;/);
    assert.equal(body.headers['x-frame-options'], 'SAMEORIGIN');
    assert.match(body.body, /<img src="data:image\/png;base64,iVBOR/);
    assert.match(body.body, /<base target="_blank">/);
  });

  it('lädt Anhänge herunter', async () => {
    const file = await emi.get(`/api/nodes/${mail}/email/attachments/1`);
    assert.equal(file.statusCode, 200);
    assert.deepEqual(file.rawPayload, PDF);
    assert.match(String(file.headers['content-disposition']), /attachment; filename=".._Rechnung.pdf"/);
    assert.equal(file.headers['content-type'], 'application/octet-stream');
    assert.equal((await emi.get(`/api/nodes/${mail}/email/attachments/9`)).statusCode, 404);
  });

  it('zeigt reine Textmails mit maskiertem HTML', async () => {
    const text = (await emi.upload(root, 'Notiz.eml', Buffer.from('Subject: Kurz\r\n\r\nHallo <b>Mia</b> & Lea\r\n'))).json().node.id;
    const body = await emi.get(`/api/nodes/${text}/email/body`);
    assert.match(body.body, /<div class="moe-text">Hallo &lt;b&gt;Mia&lt;\/b&gt; &amp; Lea/);
    const other = (await emi.upload(root, 'Liste.txt', Buffer.from('Milch'))).json().node.id;
    assert.equal((await emi.get(`/api/nodes/${other}/email`)).statusCode, 400);
  });

  it('funktioniert über öffentliche Links', async () => {
    const link = (await emi.json('POST', `/api/nodes/${mail}/links`, { allowDownload: false })).json().link;
    const guest = new Client(app);
    const summary = await guest.get(`/api/public/${link.token}/nodes/${mail}/email`);
    assert.equal(summary.statusCode, 200, summary.body);
    assert.equal(summary.json().subject, 'Rechnung für Oktober');
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${mail}/email/body`)).statusCode, 200);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${mail}/email/attachments/1`)).statusCode, 403);
  });
});
