import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp, zip } from './helpers.ts';
import { contentDisposition, escapeHtml, serializeJson } from '../src/lib/http.ts';
import { defuse } from '../src/lib/defuse.ts';
import { cleanCss } from '../src/services/themes.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';

const SCRIPT = '<script>alert(document.domain)</script>';

async function upload(name: string, content: string | Buffer, parent = root) {
  const response = await mia.upload(parent, name, Buffer.isBuffer(content) ? content : Buffer.from(content), 1 << 20);
  assert.equal(response.statusCode, 200, `${name}: ${response.body}`);
  return response.json().node.id as string;
}

const csp = (response: { headers: Record<string, unknown> }) => String(response.headers['content-security-policy'] ?? '');

function harmless(response: { headers: Record<string, unknown>; statusCode: number }, label: string) {
  const type = String(response.headers['content-type'] ?? '').toLowerCase();
  const policy = csp(response);
  const disposition = String(response.headers['content-disposition'] ?? '');
  assert.equal(response.headers['x-content-type-options'], 'nosniff', `${label}: nosniff fehlt`);
  const active = /html|xml|javascript|ecmascript|svg/.test(type);
  if (disposition.startsWith('attachment')) return;
  if (active) {
    assert.match(policy, /(^|;\s*)sandbox(;|$|\s)/, `${label}: ${type} ohne Sandbox`);
    assert.doesNotMatch(policy, /allow-scripts/, `${label}: Skripte erlaubt`);
    assert.match(policy, /default-src 'none'/, `${label}: ${policy}`);
  } else {
    assert.match(policy, /default-src 'none'|sandbox/, `${label}: keine einschränkende Richtlinie (${policy})`);
  }
  assert.doesNotMatch(policy, /unsafe-eval/, label);
}

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'mias-passwort-123');
  root = (await mia.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('Hochgeladene Dateien im Browser', () => {
  const samples: [string, string][] = [
    ['seite.html', `<html><body>${SCRIPT}</body></html>`],
    ['seite.htm', SCRIPT],
    ['seite.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body>${SCRIPT}</body></html>`],
    ['seite.shtml', SCRIPT],
    ['bild.svg', `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">${SCRIPT}</svg>`],
    ['daten.xml', `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="#"?><x>${SCRIPT}</x>`],
    ['stil.xsl', `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>`],
    ['skript.js', 'alert(document.cookie)'],
    ['skript.mjs', 'alert(document.cookie)'],
    ['stil.css', 'body{background:url(https://boese.example/x)}'],
    ['getarnt.png', `<html>${SCRIPT}</html>`],
    ['getarnt.jpg', `<svg xmlns="http://www.w3.org/2000/svg">${SCRIPT}</svg>`],
    ['getarnt.pdf', `<html>${SCRIPT}</html>`],
    ['getarnt.txt', `<html>${SCRIPT}</html>`],
    ['ohne-endung', `<html>${SCRIPT}</html>`],
    ['anwendung.hta', SCRIPT],
    ['flash.swf', 'FWS'],
    ['manifest.webmanifest', '{}'],
    ['seite.mht', `MIME-Version: 1.0\nContent-Type: text/html\n\n${SCRIPT}`],
    ['vorlage.md', `# Titel\n\n${SCRIPT}\n\n[klick](javascript:alert(1))`],
  ];

  it('laufen nie als Seite der Cloud', async () => {
    for (const [name, content] of samples) {
      const id = await upload(name, content);
      const inline = await mia.get(`/api/nodes/${id}/content`);
      assert.equal(inline.statusCode, 200, name);
      harmless(inline, name);
      const type = String(inline.headers['content-type']);
      assert.doesNotMatch(type, /^text\/html|^application\/xhtml|^text\/xml|^application\/xml|javascript/i, `${name} kommt als ${type}`);
      if (/svg/.test(type)) assert.match(csp(inline), /sandbox/, name);
      const download = await mia.get(`/api/nodes/${id}/content?download=1`);
      assert.match(String(download.headers['content-disposition']), /^attachment/, name);
      assert.equal(download.headers['x-content-type-options'], 'nosniff');
      assert.equal(download.headers['cross-origin-resource-policy'], 'same-origin', name);
    }
  });

  it('bleiben auch als Vorschau, Version, Archivinhalt und ZIP harmlos', async () => {
    const page = await upload('wechsel.html', `<html>${SCRIPT}</html>`);
    const changed = await mia.send({
      method: 'PUT',
      url: `/api/nodes/${page}/content`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('<html>neu</html>'),
    });
    assert.equal(changed.statusCode, 200);
    const version = (await mia.get(`/api/nodes/${page}/versions`)).json().items[0].id;
    const old = await mia.get(`/api/nodes/${page}/versions/${version}/content`);
    assert.match(String(old.headers['content-disposition']), /^attachment/);
    harmless(old, 'alte Fassung');

    const archive = await upload(
      'paket.zip',
      await zip({ 'index.html': SCRIPT, 'bild.svg': `<svg xmlns="http://www.w3.org/2000/svg">${SCRIPT}</svg>` })
    );
    for (const path of ['index.html', 'bild.svg']) {
      const entry = await mia.get(`/api/nodes/${archive}/archive/entry?path=${path}`);
      assert.equal(entry.statusCode, 200, path);
      assert.equal(entry.headers['content-type'], 'application/octet-stream');
      assert.match(String(entry.headers['content-disposition']), /^attachment/);
      assert.match(csp(entry), /sandbox/);
    }
    const packed = await mia.get(`/api/zip?ids=${page}`);
    assert.equal(packed.statusCode, 200);
    assert.match(String(packed.headers['content-type']), /zip/);
    assert.match(String(packed.headers['content-disposition']), /^attachment/);
  });

  it('als E-Mail und E-Book kommen ohne Skripte und ohne Nachladen von außen', async () => {
    const mail = await upload(
      'post.eml',
      [
        'From: Lea <lea@example.com>',
        'To: Mia <mia@example.com>',
        'Subject: Hallo',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        `<html><body onload="alert(1)"><img src="https://boese.example/pixel.gif">${SCRIPT}<form action="https://boese.example"><input name="x"></form><a href="javascript:alert(1)">klick</a><iframe src="https://boese.example"></iframe><meta http-equiv="refresh" content="0;url=https://boese.example"></body></html>`,
      ].join('\r\n')
    );
    const body = await mia.get(`/api/nodes/${mail}/email/body`);
    assert.equal(body.statusCode, 200, body.body.slice(0, 200));
    assert.match(csp(body), /(^|;\s*)sandbox/);
    assert.doesNotMatch(csp(body), /allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
    assert.match(csp(body), /default-src 'none'/);
    assert.match(csp(body), /img-src data:/, 'Bilder von außen lädt die Vorschau nicht nach');
    assert.equal(body.headers['referrer-policy'], 'no-referrer');
    assert.doesNotMatch(body.body, /<script/i);
    assert.doesNotMatch(body.body, /onload=/i);
    assert.doesNotMatch(body.body, /http-equiv=["']?refresh/i);
    assert.doesNotMatch(body.body, /href=["']?javascript:/i);
    assert.doesNotMatch(body.body, /<iframe/i);
    assert.doesNotMatch(body.body, /<form/i);

    const book = await upload(
      'buch.epub',
      await zip({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml':
          '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'content.opf':
          '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Buch</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
        'a.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body onload="alert(1)">${SCRIPT}<p>Text</p></body></html>`,
      })
    );
    const chapter = await mia.get(`/api/nodes/${book}/epub/-/a.xhtml`);
    assert.equal(chapter.statusCode, 200, chapter.body.slice(0, 200));
    assert.match(csp(chapter), /(^|;\s*)sandbox/);
    assert.doesNotMatch(csp(chapter), /allow-scripts|allow-forms|allow-top-navigation|allow-popups/);
    assert.match(csp(chapter), /default-src 'none'/);
    assert.match(csp(chapter), /form-action 'none'/);
    assert.match(csp(chapter), /base-uri 'none'/);
    assert.equal(chapter.headers['x-content-type-options'], 'nosniff');
    for (const path of ['../content.opf', '..%2f..%2fetc%2fpasswd', '/etc/passwd', 'a.xhtml%00.png', 'META-INF/../../x']) {
      const response = await mia.get(`/api/nodes/${book}/epub/-/${path}`);
      assert.ok([400, 404].includes(response.statusCode), `${path} → ${response.statusCode}`);
    }
  });
});

describe('Namen und Texte in Seiten und Kopfzeilen', () => {
  const NASTY = `"><img src=x onerror=alert(1)></script>${SCRIPT}'&`;

  it('landen nie ungeschützt im Quelltext', async () => {
    const folder = await mia.json('POST', `/api/nodes/${root}/folders`, { name: NASTY.replace(/\//g, '∕') });
    assert.equal(folder.statusCode, 200, folder.body);
    const id = folder.json().node.id;
    const page = await mia.get(`/files/folder/${id}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.doesNotMatch(page.body, /<script>alert/);
    assert.doesNotMatch(page.body, /<img src=x/);
    const scripts = [...page.body.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    for (const attributes of scripts) {
      assert.ok(
        /nonce="[^"]{16,}"/.test(attributes) || /type="application\/json"/.test(attributes),
        `Skript ohne Kennzeichen: ${attributes}`
      );
    }
    assert.match(csp(page), /script-src 'nonce-[^']+' 'strict-dynamic'/);
    assert.doesNotMatch(csp(page), /unsafe-inline|unsafe-eval/);
    for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "default-src 'self'"]) {
      assert.ok(csp(page).includes(directive), directive);
    }
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['cross-origin-opener-policy'], 'same-origin');
    assert.match(String(page.headers['cache-control']), /no-store/);
    const other = await mia.get('/files', { accept: 'text/html' });
    const nonce = (text: string) => /nonce-([^']+)'/.exec(text)?.[1];
    assert.notEqual(nonce(csp(page)), nonce(csp(other)), 'jede Seite bekommt ein eigenes Kennzeichen');

    const account = await mia.json('PATCH', '/api/account', { name: `Mia ${SCRIPT}` });
    assert.equal(account.statusCode, 200);
    const share = await mia.json('POST', `/api/nodes/${id}/links`, { label: NASTY.slice(0, 80), message: `Hallo ${SCRIPT}` });
    assert.equal(share.statusCode, 200, share.body);
    const visitor = await new Client(app).get(`/s/${share.json().link.token}`, { accept: 'text/html' });
    assert.equal(visitor.statusCode, 200);
    assert.doesNotMatch(visitor.body, /<script>alert/);
    assert.doesNotMatch(visitor.body, /<img src=x/);
    assert.doesNotMatch(visitor.body, /content=""[^>]*onerror/);
    for (const tag of visitor.body.matchAll(/<meta property="og:[^>]*>/g)) {
      assert.match(tag[0], /^<meta property="og:[a-z_:]+" content="[^"<>]*">$/, `bricht aus dem Attribut aus: ${tag[0]}`);
    }
    const locked = await mia.json('POST', `/api/nodes/${id}/links`, { label: NASTY.slice(0, 80), password: 'ein-passwort-fuer-den-link' });
    const prompt = await new Client(app).get(`/s/${locked.json().link.token}`, { accept: 'text/html' });
    assert.doesNotMatch(prompt.body, /<script>alert|<img src=x/);
    await mia.json('PATCH', '/api/account', { name: 'Mia' });
  });

  it('bleiben in JSON für die Seite und in Kopfzeilen an ihrem Platz', () => {
    const json = serializeJson({ name: `</script>${SCRIPT}<!--`, line: 'a\u2028b\u2029c', amp: '&amp;' });
    assert.doesNotMatch(json, /<|>|&/);
    assert.doesNotMatch(json, /\u2028|\u2029/);
    assert.deepEqual(JSON.parse(json), { name: `</script>${SCRIPT}<!--`, line: 'a\u2028b\u2029c', amp: '&amp;' });
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');

    for (const name of [
      'normal.txt',
      'mit "Anführung".txt',
      'zeile\r\nSet-Cookie: x=1.txt',
      'semikolon; filename=boese.exe',
      'prozent%0d%0aX-Header: 1.txt',
      'ümläüt und 日本語.txt',
      '../../etc/passwd',
      "o'reilly.txt",
      '\u202Egpj.exe',
      '',
    ]) {
      for (const kind of ['inline', 'attachment'] as const) {
        const header = contentDisposition(name, kind);
        assert.doesNotMatch(header, /[\r\n\u0000]/, JSON.stringify(name));
        assert.match(
          header,
          new RegExp(`^${kind}; filename="[^"\\\\\\r\\n]*"; filename\\*=UTF-8''[A-Za-z0-9%._~!$&+^\`|-]*$`),
          `${JSON.stringify(name)} → ${header}`
        );
      }
    }
  });

  it('kommen in Fehlermeldungen nicht als HTML zurück', async () => {
    for (const url of [
      `/api/nodes/${encodeURIComponent(SCRIPT)}`,
      `/api/search?q=${encodeURIComponent(SCRIPT)}`,
      `/api/gibt-es-nicht/${encodeURIComponent(SCRIPT)}`,
      `/s/${encodeURIComponent(SCRIPT)}`,
      `/files/${encodeURIComponent(SCRIPT)}`,
      `/login?next=${encodeURIComponent(SCRIPT)}&expired=1`,
      `/lang/${encodeURIComponent(SCRIPT)}`,
      `/plugin-pages/${encodeURIComponent(SCRIPT)}/x`,
      `/branding/${encodeURIComponent(SCRIPT)}`,
    ]) {
      for (const accept of ['text/html', 'application/json', '*/*']) {
        const response = await mia.get(url, { accept });
        assert.ok(response.statusCode < 500, `${url} → ${response.statusCode}`);
        assert.doesNotMatch(response.body, /<script>alert\(document\.domain\)/, `${url} (${accept}) gibt das Skript unverändert zurück`);
        if (String(response.headers['content-type']).startsWith('text/html')) assert.match(csp(response), /script-src 'nonce-/, url);
      }
    }
  });
});

describe('HTML aus E-Mails', () => {
  it('verliert alles Aktive, auch wenn es verschachtelt oder verschleiert ist', () => {
    const cases: [string, RegExp][] = [
      ['<script>alert(1)</script>', /<script|alert\(1\)/i],
      ['<SCRIPT SRC=//boese.example/x.js></SCRIPT>', /<script/i],
      ['<scr<script>x</script>ipt>alert(1)</scr<script>x</script>ipt>', /<script/i],
      ['<script\n>alert(1)</script\n>', /<script/i],
      ['<script>alert(1)', /<script/i],
      ['<img src=x onerror=alert(1)>', /onerror/i],
      ['<img src=x ONERROR="alert(1)">', /onerror/i],
      ["<img src=x onerror='alert(1)'>", /onerror/i],
      ['<img src=x oNlOaD=alert(1) onerror=alert(2)>', /onload|onerror/i],
      ['<svg/onload=alert(1)>', /onload/i],
      ['<div onmouseover="alert(1)" style="color:red">Text</div>', /onmouseover/i],
      ['<a href="javascript:alert(1)">klick</a>', /javascript:/i],
      ['<a href=" JaVaScRiPt:alert(1)">klick</a>', /javascript:/i],
      ["<a href='vbscript:msgbox(1)'>klick</a>", /vbscript:/i],
      ['<a href="data:text/html,<script>alert(1)</script>">klick</a>', /data:text\/html|<script/i],
      ['<iframe src="https://boese.example"></iframe>', /<iframe/i],
      ['<iframe srcdoc="<script>alert(1)</script>">', /<iframe|<script/i],
      ['<object data="x.swf"></object><embed src="x.swf">', /<object|<embed/i],
      ['<form action="https://boese.example"><input name="pw"></form>', /<form/i],
      ['<meta http-equiv="refresh" content="0;url=https://boese.example">', /<meta/i],
      ['<base href="https://boese.example/">', /<base/i],
      ['<link rel="stylesheet" href="https://boese.example/x.css">', /<link/i],
      ['<button formaction="javascript:alert(1)">x</button>', /javascript:/i],
    ];
    for (const [input, forbidden] of cases) {
      const output = defuse(input);
      assert.doesNotMatch(output, forbidden, `${input} → ${output}`);
    }
    const tricky = [
      '<img alt=x"><script>alert(1)</script><p class="x">',
      '<a title="x>y" onclick=alert(1)>klick</a>',
      "<a title='x>y' onclick=alert(1)>klick</a>",
      '<a href="jav&#x61;script:alert(1)">klick</a>',
      '<a href="jav&#97script:alert(1)">klick</a>',
      '<a href="&#106;avascript:alert(1)">klick</a>',
      '<a href="java&Tab;script:alert(1)">klick</a>',
      '<a href="java&NewLine;script:alert(1)">klick</a>',
      '<a href="javascript&colon;alert(1)">klick</a>',
      '<a href="java\nscript:alert(1)">klick</a>',
      '<a href="\x01javascript:alert(1)">klick</a>',
      '<a href=javascript:alert(1)>klick</a>',
      '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">',
      '<a href="data:image/svg+xml,<svg onload=alert(1)>">klick</a>',
      '<<script>script>alert(1)<</script>/script>',
      '<img src=x onerror=alert(1)//',
      '<img src=x onerror=alert(1) ',
      '<img ""><script>alert(1)</script>">',
      '<img src=x =onerror=alert(1)>',
      '<p/onclick=alert(1)>x</p>',
      '<math><mtext><script>alert(1)</script></mtext></math>',
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
      '<!--><script>alert(1)</script>-->',
      '<!-- --!><script>alert(1)</script>',
      '<![CDATA[<script>alert(1)</script>]]>',
      '<?xml version="1.0"?><script>alert(1)</script>',
      '<noscript><p title="</noscript><script>alert(1)</script>">',
      '<textarea></textarea><script>alert(1)</script>',
      '<plaintext><script>alert(1)</script>',
      '<a href="vbscript:msgbox(1)" HREF="https://example.com">klick</a>',
      '<div style="x" ONCLICK=alert(1) onClick=alert(2)>x</div>',
    ];
    for (const input of tricky) {
      const output = defuse(input);
      assert.doesNotMatch(output, /<script|<iframe|<object|<embed|<form|<meta|<base|<link/i, `${input} → ${output}`);
      for (const made of output.matchAll(/<[a-z][^>]*>/gi)) {
        assert.doesNotMatch(made[0], /\son[a-z]+\s*=/i, `${input} → ${output}`);
        assert.doesNotMatch(made[0], /(javascript|vbscript)\s*:|data:text|attributename/i, `${input} → ${output}`);
      }
      assert.equal(defuse(output), output, `zweimal entschärft bleibt gleich: ${input}`);
    }
    assert.equal(defuse('a < b und c > d, 3<4, <3'), 'a &lt; b und c > d, 3&lt;4, &lt;3');
    assert.equal(defuse('<p class=eins id="zwei" hidden>x</p>'), '<p class="eins" id="zwei" hidden>x</p>');
    assert.equal(defuse('<style>.a{color:red}</style><p>x</p>'), '<style>.a{color:red}</style><p>x</p>');
    assert.equal(defuse('<img src="data:image/png;base64,AAAA" alt="x">'), '<img src="data:image/png;base64,AAAA" alt="x">');

    for (const flood of ['<script>', '<', '<a ', '<a b="', '<!--', '<a href="', '<iframe><', '<p onclick=', '&#x61;', '<a b=c ']) {
      const started = Date.now();
      const output = defuse(flood.repeat(Math.ceil(2_000_000 / flood.length)));
      assert.ok(Date.now() - started < 4000, `${JSON.stringify(flood)} braucht ${Date.now() - started} ms`);
      assert.doesNotMatch(output.slice(0, 2000), /<script|<iframe|onclick/);
    }
    const harmless =
      '<table style="width:100%"><tr><td><p>Hallo <b>Mia</b>, <a href="https://example.com/a?b=1&amp;c=2">hier</a> ist das <img src="cid:bild1" alt="Bild"> Angebot.</p></td></tr></table>';
    assert.equal(defuse(harmless), harmless, 'gewöhnliche E-Mails bleiben, wie sie sind');
    assert.equal(defuse('Einmal online = immer online, onkel=1'), 'Einmal online = immer online, onkel=1', 'Fließtext bleibt unberührt');
  });
});

describe('Eigenes CSS und Markenbilder', () => {
  it('nimmt kein CSS an, das aus dem Stilblock ausbricht oder nach außen lädt', () => {
    for (const css of [
      '</style><script>alert(1)</script>',
      'a{}<!-- x',
      'a{} --> b{}',
      '@import url(https://boese.example/x.css);',
      '@IMPORT "https://boese.example/x.css";',
      'a{background:url(https://boese.example/x.png)}',
      'a{background:url( "//boese.example/x.png" )}',
      'a{background:URL(/api/account)}',
      'a{background:\\75rl(https://boese.example)}',
      'a{width:expression(alert(1))}',
      'a{behavior:url(#default#time2)}',
      'a{-moz-binding:url(x)}',
      'a{background:url(javascript:alert(1))}',
      '@charset "utf-7";',
      '@namespace svg url(http://www.w3.org/2000/svg);',
      '@font-face{font-family:x;src:url(https://boese.example/f.woff2)}',
    ]) {
      assert.throws(() => cleanCss(css), /CSS/, css);
    }
    assert.equal(
      cleanCss('  .a{color:red}\r\n.b{background:url(data:image/png;base64,AAAA)}  '),
      '.a{color:red}\n.b{background:url(data:image/png;base64,AAAA)}'
    );
    assert.equal(cleanCss(''), '');
  });

  it('wandelt Logo und Hintergrund neu und nimmt kein SVG und kein HTML', async () => {
    for (const [type, content] of [
      ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg">${SCRIPT}</svg>`],
      ['image/png', `<html>${SCRIPT}</html>`],
      ['text/html', `<html>${SCRIPT}</html>`],
    ]) {
      const response = await emi.send({
        method: 'PUT',
        url: '/api/admin/branding/logo',
        headers: { 'content-type': type },
        payload: Buffer.from(content),
      });
      assert.ok([400, 415].includes(response.statusCode), `${type} → ${response.statusCode}`);
    }
    assert.equal((await new Client(app).get('/branding/logo')).statusCode, 404, 'es wurde nichts gespeichert');
    assert.equal(
      (
        await mia.send({
          method: 'PUT',
          url: '/api/admin/branding/logo',
          headers: { 'content-type': 'image/png' },
          payload: Buffer.from('x'),
        })
      ).statusCode,
      403
    );
    for (const kind of ['logo', 'background', '..%2f..%2fetc%2fpasswd', 'logo.svg', '%00']) {
      const response = await new Client(app).get(`/branding/${kind}`);
      assert.ok([400, 404].includes(response.statusCode), `${kind} → ${response.statusCode}`);
    }
    const avatar = await mia.send({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { 'content-type': 'image/svg+xml' },
      payload: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${SCRIPT}</svg>`),
    });
    assert.ok([400, 415].includes(avatar.statusCode), `ein SVG wird kein Profilbild (${avatar.statusCode})`);
  });
});
