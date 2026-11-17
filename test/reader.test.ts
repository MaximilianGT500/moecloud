import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PDFDocument } from '@pdfme/pdf-lib';
import { config } from '../src/config.ts';
import { detectTools, tools } from '../src/services/media.ts';
import { officeFailures } from '../src/services/office.ts';
import { Client, createApp, login, setUp, zip } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const CONTAINER =
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const chapter = (title: string, extra = '') =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../style.css"/></head><body><h1>${title}</h1>${extra}</body></html>`;

async function modernBook() {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Emis Reise &amp; mehr</dc:title><dc:creator id="a">Emi Sato</dc:creator></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/kapitel%201.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/kapitel2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="img" href="bilder/karte.png" media-type="image/png"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="css"/></spine></package>`,
    'OEBPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/kapitel%201.xhtml">Aufbruch</a></li><li><a href="text/kapitel2.xhtml#teil">Ankunft &amp; <i>Ruhe</i></a></li></ol></nav></body></html>`,
    'OEBPS/text/kapitel 1.xhtml': chapter('Aufbruch', '<img src="../bilder/karte.png" alt="Karte"/><script>alert(1)</script>'),
    'OEBPS/text/kapitel2.xhtml': chapter('Ankunft'),
    'OEBPS/style.css': 'h1 { color: #333; }',
    'OEBPS/bilder/karte.png': PIXEL,
  });
}

async function classicBook() {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER.replace('OEBPS/content.opf', 'buch.opf'),
    'buch.opf': `<package version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Leas Notizen</dc:title></metadata>
      <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="eins.html" media-type="application/xhtml+xml"/><item id="b" href="zwei.html" media-type="application/xhtml+xml"/></manifest>
      <spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    'toc.ncx': `<ncx><navMap><navPoint id="1"><navLabel><text>Erster Teil</text></navLabel><content src="eins.html"/></navPoint></navMap></ncx>`,
    'eins.html': '<html><body><p>Eins</p></body></html>',
    'zwei.html': '<html><body><p>Zwei</p></body></html>',
  });
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(() => app.close());

describe('E-Books', () => {
  it('liest Titel, Kapitel und Inhaltsverzeichnis', async () => {
    const book = (await emi.upload(root, 'Reise.epub', await modernBook(), 65_536)).json().node;
    const info = await emi.get(`/api/nodes/${book.id}/epub`);
    assert.equal(info.statusCode, 200, info.body);
    assert.deepEqual(info.json(), {
      title: 'Emis Reise & mehr',
      author: 'Emi Sato',
      chapters: [
        { title: 'Aufbruch', path: 'OEBPS/text/kapitel 1.xhtml' },
        { title: 'Ankunft & Ruhe', path: 'OEBPS/text/kapitel2.xhtml' },
      ],
    });
    const old = (await emi.upload(root, 'Notizen.epub', await classicBook(), 65_536)).json().node;
    assert.deepEqual((await emi.get(`/api/nodes/${old.id}/epub`)).json(), {
      title: 'Leas Notizen',
      author: null,
      chapters: [
        { title: 'Erster Teil', path: 'eins.html' },
        { title: null, path: 'zwei.html' },
      ],
    });
    const plain = (await emi.upload(root, 'Liste.txt', Buffer.from('kein Buch'), 4096)).json().node;
    assert.equal((await emi.get(`/api/nodes/${plain.id}/epub`)).json().error.message, 'Das ist kein E-Book im EPUB-Format');
    const broken = (await emi.upload(root, 'Kaputt.epub', await zip({ 'hallo.txt': 'x' }), 4096)).json().node;
    assert.equal((await emi.get(`/api/nodes/${broken.id}/epub`)).json().error.message, 'Das E-Book lässt sich nicht lesen');
    assert.equal((await mia.get(`/api/nodes/${book.id}/epub`)).statusCode, 404);
  });

  it('liefert Kapitel und Bilder ohne Skripte aus', async () => {
    const book = (await emi.get('/api/search?q=Reise.epub')).json().items[0];
    const text = await emi.get(`/api/nodes/${book.id}/epub/-/OEBPS/text/kapitel%201.xhtml`);
    assert.equal(text.statusCode, 200, text.body);
    assert.equal(text.headers['content-type'], 'application/xhtml+xml');
    assert.ok(text.body.includes('<h1>Aufbruch</h1>'));
    const policy = String(text.headers['content-security-policy']);
    assert.match(policy, /default-src 'none'/);
    assert.ok(!policy.includes('script-src'));
    assert.equal(text.headers['x-content-type-options'], 'nosniff');
    const image = await emi.get(`/api/nodes/${book.id}/epub/-/OEBPS/bilder/karte.png`);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.deepEqual(image.rawPayload, PIXEL);
    assert.match(String((await emi.get(`/api/nodes/${book.id}/epub/-/OEBPS/style.css`)).headers['content-type']), /^text\/css/);
    for (const path of ['OEBPS/fehlt.xhtml', '..%2F..%2Fetc%2Fpasswd', 'META-INF/container.xml', 'OEBPS/../../x']) {
      assert.equal((await emi.get(`/api/nodes/${book.id}/epub/-/${path}`)).statusCode, 404, path);
    }
    assert.equal((await mia.get(`/api/nodes/${book.id}/epub/-/OEBPS/style.css`)).statusCode, 404);
    const link = (await emi.json('POST', `/api/nodes/${book.id}/links`, {})).json().link;
    const guest = new Client(app);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${book.id}/epub`)).json().chapters.length, 2);
    assert.equal((await guest.get(`/api/public/${link.token}/nodes/${book.id}/epub/-/OEBPS/text/kapitel2.xhtml`)).statusCode, 200);
  });
});

describe('Vorschau über LibreOffice', () => {
  it('wandelt Office-Dateien in eine PDF um, wenn LibreOffice da ist', async (context) => {
    await detectTools();
    const note = (await emi.upload(root, 'Zettel.txt', Buffer.from('kein Office'), 4096)).json().node;
    if (!tools.soffice) {
      const letter = (await emi.upload(root, 'Brief an Lea.rtf', Buffer.from('{\\rtf1 Hallo}'), 4096)).json().node;
      assert.equal(letter.office, false);
      assert.equal((await emi.get(`/api/nodes/${letter.id}/office?prepare=1`)).statusCode, 400);
      context.skip('LibreOffice ist nicht installiert');
      return;
    }
    const rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}}\\f0\\fs28 Hallo Lea, dies ist ein Brief von Mia.\\par Zweite Zeile.\\par}';
    const letter = (await emi.upload(root, 'Brief an Lea.rtf', Buffer.from(rtf), 4096)).json().node;
    assert.equal(letter.office, true);
    assert.equal(note.office, false);
    const prepared = await emi.get(`/api/nodes/${letter.id}/office?prepare=1`);
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.deepEqual(prepared.json(), { ok: true });
    const pdf = await emi.get(`/api/nodes/${letter.id}/office`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(String(pdf.headers['content-disposition']), /^inline; filename="Brief an Lea\.pdf"/);
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await PDFDocument.load(pdf.rawPayload)).getPageCount(), 1);
    const started = Date.now();
    assert.equal((await emi.get(`/api/nodes/${letter.id}/office?prepare=1`)).statusCode, 200);
    assert.ok(Date.now() - started < 1000);
    const wrong = await emi.get(`/api/nodes/${note.id}/office`);
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().error.message, 'Für diese Datei gibt es keine Vorschau als PDF');
    assert.equal((await mia.get(`/api/nodes/${letter.id}/office`)).statusCode, 404);
    const broken = (await emi.upload(root, 'Kaputt.odp', Buffer.from('das ist keine Präsentation'), 4096)).json().node;
    const failed = await emi.get(`/api/nodes/${broken.id}/office?prepare=1`);
    assert.equal(failed.statusCode, 200);
    assert.equal(typeof failed.json().ok, 'boolean');
  });

  it('nutzt mit OFFICE_URL einen eigenen Dienst für die Umwandlung', async () => {
    const page = await PDFDocument.create();
    page.addPage();
    const pdf = Buffer.from(await page.save());
    const seen: { call: string; type: string; body: Buffer }[] = [];
    let mode: 'pdf' | 'fehler' | 'html' = 'pdf';
    const service = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.push({ call: `${request.method} ${request.url}`, type: String(request.headers['content-type']), body: Buffer.concat(chunks) });
        if (mode === 'fehler') {
          response.writeHead(503, { 'content-type': 'text/plain' });
          response.end('gerade nicht');
          return;
        }
        response.writeHead(200, { 'content-type': mode === 'pdf' ? 'application/pdf' : 'text/html' });
        response.end(mode === 'pdf' ? pdf : '<html>Hallo</html>');
      });
    });
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    const previous = { url: config.officeUrl, program: tools.soffice };
    config.officeUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
    tools.soffice = false;
    try {
      const slides = (await emi.upload(root, 'Vortrag von Lea.odp', Buffer.from('Folien für den Dienst'), 4096)).json().node;
      assert.equal(slides.office, true);
      assert.equal((await emi.get('/api/admin/overview')).json().health.tools.soffice, true);
      const prepared = await emi.get(`/api/nodes/${slides.id}/office?prepare=1`);
      assert.equal(prepared.statusCode, 200, prepared.body);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].call, 'POST /forms/libreoffice/convert');
      assert.match(seen[0].type, /^multipart\/form-data; boundary=/);
      assert.match(seen[0].body.toString('latin1'), /name="files"; filename="dokument\.odp"/);
      assert.ok(seen[0].body.includes(Buffer.from('Folien für den Dienst')));
      assert.deepEqual((await emi.get(`/api/nodes/${slides.id}/office`)).rawPayload, pdf);
      assert.equal(seen.length, 1);
      const show = (await emi.upload(root, 'Schau von Mia.ppsx', Buffer.from('Bildschirmschau für den Dienst'), 4096)).json().node;
      assert.deepEqual((await emi.get(`/api/nodes/${show.id}/office?prepare=1`)).json(), { ok: true });
      assert.match(seen[1].body.toString('latin1'), /name="files"; filename="dokument\.pptx"/);
      assert.ok(seen[1].body.includes(Buffer.from('Bildschirmschau für den Dienst')));

      mode = 'fehler';
      const sheet = (await emi.upload(root, 'Tabelle von Mia.ods', Buffer.from('Zahlen für den Dienst'), 4096)).json().node;
      assert.deepEqual((await emi.get(`/api/nodes/${sheet.id}/office?prepare=1`)).json(), { ok: false });
      assert.equal(seen.length, 3);
      const failed = await emi.get(`/api/nodes/${sheet.id}/office`);
      assert.equal(failed.statusCode, 400);
      assert.equal(failed.json().error.message, 'Das Dokument lässt sich nicht für die Vorschau umwandeln');
      mode = 'pdf';
      assert.deepEqual((await emi.get(`/api/nodes/${sheet.id}/office?prepare=1`)).json(), { ok: false });
      assert.equal(seen.length, 3);
      officeFailures.clear();
      mode = 'html';
      assert.deepEqual((await emi.get(`/api/nodes/${sheet.id}/office?prepare=1`)).json(), { ok: false });
      assert.equal(seen.length, 4);
      officeFailures.clear();
      mode = 'pdf';
      assert.deepEqual((await emi.get(`/api/nodes/${sheet.id}/office?prepare=1`)).json(), { ok: true });
      assert.equal(seen.length, 5);
    } finally {
      config.officeUrl = previous.url;
      tools.soffice = previous.program;
      await new Promise((resolve) => service.close(resolve));
    }
    const later = (await emi.upload(root, 'Später.odp', Buffer.from('ohne Dienst'), 4096)).json().node;
    assert.equal(later.office, previous.program);
  });

  it('lädt beim Umwandeln nichts aus dem Netz nach', async (context) => {
    await detectTools();
    if (!tools.soffice) {
      context.skip('LibreOffice ist nicht installiert');
      return;
    }
    const hits: string[] = [];
    const outside = createServer((request, response) => {
      hits.push(`${request.method} ${request.url}`);
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PIXEL);
    });
    await new Promise<void>((resolve) => outside.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${(outside.address() as AddressInfo).port}/bild.png`;
    try {
      const invitation = await zip({
        mimetype: 'application/vnd.oasis.opendocument.text',
        'META-INF/manifest.xml':
          '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
        'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:body><office:text><text:p>Einladung von Mia</text:p><text:p><draw:frame draw:name="Bild" text:anchor-type="as-char" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="${address}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p></office:text></office:body></office:document-content>`,
      });
      const node = (await emi.upload(root, 'Einladung von Mia.odt', invitation, 65_536)).json().node;
      assert.equal(node.office, true);
      const prepared = await emi.get(`/api/nodes/${node.id}/office?prepare=1`);
      assert.equal(prepared.statusCode, 200, prepared.body);
      const pdf = await emi.get(`/api/nodes/${node.id}/office`);
      assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
      assert.deepEqual(hits, []);
    } finally {
      await new Promise((resolve) => outside.close(resolve));
    }
  });
});
