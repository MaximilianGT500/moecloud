import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, setUp } from './helpers.ts';
import { safeRedirect } from '../src/lib/http.ts';

const app = await createApp();
let emi: Client;

const HOSTILE = [
  'https://boese.example',
  'http://boese.example/files',
  '//boese.example',
  '///boese.example',
  '////boese.example/files',
  '/\\boese.example',
  '\\\\boese.example',
  '/\\/boese.example',
  '/\t/boese.example',
  '/\n/boese.example',
  '/\r/boese.example',
  '/\t\\boese.example',
  '\t//boese.example',
  ' //boese.example',
  '/ /boese.example',
  '/%09/boese.example',
  '/%2f%2fboese.example',
  '/%5cboese.example',
  '/.//boese.example',
  '/files/..//boese.example',
  '/files\\..\\..\\boese.example',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'boese.example',
  '@boese.example',
  '/@boese.example/../..//boese.example',
  'https:boese.example',
  'https:/boese.example',
  '/\u0000/boese.example',
  '/\u000b/boese.example',
  '/\u2028/boese.example',
  '/files\u0000',
  '/files\r\nSet-Cookie: moe_session=fremd',
  '/files\nLocation: https://boese.example',
  `/${'a'.repeat(5000)}`,
];

const lands = (target: string) => {
  const cleaned = target.replace(/[\t\n\r]/g, '');
  const url = new URL(cleaned, 'https://cloud.example');
  return url;
};

before(async () => {
  emi = await setUp(app);
});

after(() => app.close());

describe('Weiterleitungen', () => {
  it('führen nie auf eine fremde Seite, auch nicht mit Tabulatoren, Rückstrichen oder kodierten Zeichen', () => {
    for (const payload of HOSTILE) {
      const result = safeRedirect(payload);
      const url = lands(result);
      assert.equal(url.origin, 'https://cloud.example', `${JSON.stringify(payload)} → ${JSON.stringify(result)} landet auf ${url.origin}`);
      assert.doesNotMatch(result, /[\u0000-\u001f\u007f\\]/, `${JSON.stringify(payload)} behält Steuerzeichen oder Rückstriche`);
      assert.ok(result.startsWith('/') && !result.startsWith('//'), JSON.stringify(payload));
      assert.ok(result.length <= 2100, 'zu lange Ziele werden nicht übernommen');
      for (const wrong of [undefined, null, 5, {}, ['/files'], true]) assert.equal(safeRedirect(wrong), '/files');
    }
  });

  it('lassen eigene Ziele mit Abfrage und Anker durch', () => {
    for (const fine of [
      '/files',
      '/files/folder/abc?select=def',
      '/account#sicherheit',
      '/files/search?q=%C3%A4%20b&type=image',
      '/admin/settings',
      '/s/abcdefghij',
      '/files/folder/abc?name=a%2Fb',
    ]) {
      assert.equal(safeRedirect(fine), fine);
    }
    assert.equal(safeRedirect('/nirgends', '/'), '/nirgends');
    assert.equal(safeRedirect('https://boese.example', '/'), '/');
  });

  it('gelten für die Anmeldung, die Sprache und den zweiten Schritt', async () => {
    for (const payload of HOSTILE) {
      const query = encodeURIComponent(payload);
      const responses = [
        await emi.get(`/login?next=${query}`, { accept: 'text/html' }),
        await emi.get(`/lang/en?next=${query}`, { accept: 'text/html' }),
        await new Client(app).get(`/login/2fa?next=${query}`, { accept: 'text/html' }),
      ];
      for (const response of responses) {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          const location = String(response.headers.location);
          const url = lands(location);
          assert.equal(url.origin, 'https://cloud.example', `${JSON.stringify(payload)} → ${JSON.stringify(location)}`);
          const inner = url.searchParams.get('next');
          if (inner) assert.equal(lands(inner).origin, 'https://cloud.example', `next in ${location}`);
        } else {
          assert.ok(response.statusCode < 500, `${JSON.stringify(payload)} → ${response.statusCode}`);
        }
      }
    }
  });

  it('gelten auch für das Anmeldeformular', async () => {
    for (const payload of HOSTILE) {
      const guest = new Client(app);
      await guest.get('/login', { accept: 'text/html' });
      const response = await guest.send({
        method: 'POST',
        url: '/login',
        remoteAddress: `127.0.1.${HOSTILE.indexOf(payload) + 1}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          _csrf: guest.cookies.get('moe_csrf')!,
          login: 'emi',
          password: 'sehr-sicheres-passwort',
          next: payload,
        }).toString(),
      });
      if (response.statusCode === 400 && payload.includes(String.fromCharCode(0))) continue;
      assert.equal(response.statusCode, 303, `${JSON.stringify(payload)} → ${response.statusCode}`);
      const location = String(response.headers.location);
      assert.equal(lands(location).origin, 'https://cloud.example', `${JSON.stringify(payload)} → ${JSON.stringify(location)}`);
      assert.ok(!location.startsWith('//'));
    }
  });

  it('schreiben ein fremdes Ziel auch nicht in die Seite', async () => {
    const page = await new Client(app).get(`/login?next=${encodeURIComponent('https://boese.example/"><script>alert(1)</script>')}`, {
      accept: 'text/html',
    });
    assert.equal(page.statusCode, 200);
    assert.doesNotMatch(page.body, /<script>alert/);
    assert.doesNotMatch(page.body, /(href|action|value|content)="https:\/\/boese\.example/);
    assert.match(page.body, /name="next" value="\/files"/);
  });
});
