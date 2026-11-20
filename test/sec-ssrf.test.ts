import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, httpSink, setUp } from './helpers.ts';
import { guardedLookup, isPublicAddress, privateLiteral } from '../src/lib/netguard.ts';
import { importsSettled, parseUrl } from '../src/services/imports.ts';
import * as settings from '../src/services/settings.ts';

const app = await createApp();
let emi: Client;
let root = '';
let sink: Awaited<ReturnType<typeof httpSink>>;

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  sink = await httpSink(0, () => ({ status: 200, body: 'INTERN', type: 'text/plain' }));
});

after(async () => {
  await app.close();
  await sink.close();
});

describe('Anfragen des Servers nach außen', () => {
  it('erkennen jede Schreibweise einer internen Adresse', () => {
    const internal = [
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '100.127.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2001:db8::1',
      '2001::1',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '100::1',
      'nicht-eine-adresse',
      '',
      '999.1.1.1',
    ];
    for (const address of internal) assert.equal(isPublicAddress(address), false, address);
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '172.15.255.255',
      '172.32.0.1',
      '100.63.255.255',
      '2606:4700:4700::1111',
      '2a00:1450:4001::64',
    ]) {
      assert.equal(isPublicAddress(address), true, address);
    }
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0x7f.0.0.1/',
      'http://0177.0.0.1/',
      'http://017700000001/',
      'http://0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[0:0:0:0:0:ffff:a00:1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1:8080/',
      'http://user:pass@10.0.0.1/',
      'http://[fd00::1]/',
      'https://[fe80::1]/',
    ]) {
      assert.equal(privateLiteral(new URL(url)), true, url);
    }
    assert.equal(privateLiteral(new URL('https://example.com/')), false);
    assert.equal(privateLiteral(new URL('https://1.1.1.1/')), false);
  });

  it('prüfen den Namen erst beim Verbinden, damit ein Wechsel der Adresse nichts bringt', async () => {
    const lookup = guardedLookup(() => false);
    const resolve = (host: string) =>
      new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) =>
        lookup(host, {}, (error, address) => done({ error, address }))
      );
    for (const host of ['localhost', 'ip6-localhost']) {
      const result = await resolve(host);
      if (result.error?.code === 'ENOTFOUND') continue;
      assert.equal(result.error?.code, 'MOE_PRIVATE', host);
    }
    const open = guardedLookup(() => true);
    const allowed = await new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) =>
      open('localhost', {}, (error, address) => done({ error, address }))
    );
    assert.equal(allowed.error, null);
    assert.ok(String(allowed.address).length > 0);
  });

  it('nehmen nur http und https', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://127.0.0.1:6379/_FLUSHALL',
      'dict://127.0.0.1:11211/stats',
      'data:text/plain,hallo',
      'javascript:alert(1)',
      'ldap://127.0.0.1/',
      'smb://server/freigabe',
      'jar:http://example.com/x!/y',
      'netdoc:///etc/passwd',
      '//example.com/x',
      '/etc/passwd',
      'example.com/x',
      '',
      'http://',
    ]) {
      assert.throws(() => parseUrl(url), /Adresse/, url);
    }
    assert.equal(parseUrl(' https://example.com/a#abschnitt ').href, 'https://example.com/a');
  });

  it('holen über „Von Adresse laden“ nichts aus dem eigenen Netz', async () => {
    const port = sink.port;
    assert.equal(settings.get('import.private'), false);
    const spellings = [
      `http://127.0.0.1:${port}/geheim`,
      `http://127.1:${port}/geheim`,
      `http://2130706433:${port}/geheim`,
      `http://0x7f.0.0.1:${port}/geheim`,
      `http://0:${port}/geheim`,
      `http://[::1]:${port}/geheim`,
      `http://[::ffff:127.0.0.1]:${port}/geheim`,
      `http://localhost:${port}/geheim`,
      `http://LOCALHOST:${port}/geheim`,
      `http://localhost.:${port}/geheim`,
      `http://user:pass@127.0.0.1:${port}/geheim`,
      `http://127.0.0.1:${port}/geheim#@example.com`,
      `http://example.com@127.0.0.1:${port}/geheim`,
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://192.168.1.1/',
      'http://10.0.0.1/',
      'http://[fd00::1]/',
    ];
    for (const url of spellings) {
      const response = await emi.json('POST', `/api/nodes/${root}/import`, { url });
      await importsSettled();
      assert.ok([202, 400, 403].includes(response.statusCode), `${url} → ${response.statusCode}`);
      if (response.statusCode === 202) {
        const job = ((await emi.get('/api/imports')).json().items as { id: string; status: string; error: string | null }[]).find(
          (entry) => entry.id === response.json().job.id
        );
        assert.ok(job, url);
        assert.notEqual(job.status, 'done', `${url} wurde geladen`);
      }
    }
    assert.equal(sink.received.length, 0, 'beim internen Dienst kam eine Anfrage an');
    assert.deepEqual((await emi.get(`/api/nodes/${root}/children`)).json().items, [], 'es wurde etwas abgelegt');

    settings.set('import.private', true);
    const allowed = await emi.json('POST', `/api/nodes/${root}/import`, { url: `http://127.0.0.1:${port}/erlaubt.txt` });
    await importsSettled();
    settings.set('import.private', false);
    assert.equal(allowed.statusCode, 202);
    assert.equal(sink.received.length, 1, 'mit der Erlaubnis der Verwaltung kommt die Anfrage an, der Test misst also richtig');
    assert.equal(sink.received[0].headers.cookie, undefined, 'eigene Cookies wandern nicht mit');
    assert.equal(sink.received[0].headers.authorization, undefined);
  });

  it('gelten genauso für den Umzug per WebDAV und für Push', async () => {
    const port = sink.port;
    const before = sink.received.length;
    for (const url of [
      `http://127.0.0.1:${port}/dav/`,
      `http://[::1]:${port}/dav/`,
      `http://2130706433:${port}/dav/`,
      'http://169.254.169.254/',
    ]) {
      const response = await emi.json('POST', `/api/nodes/${root}/import/webdav`, { url, username: 'mia', password: 'geheim' });
      assert.equal(response.statusCode, 403, `${url} → ${response.statusCode}`);
    }
    const byName = await emi.json('POST', `/api/nodes/${root}/import/webdav`, {
      url: `http://localhost:${port}/dav/`,
      username: 'mia',
      password: 'geheim',
    });
    assert.ok([202, 400, 403].includes(byName.statusCode));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'push.enabled': true })).statusCode, 200);
    for (const url of [`http://127.0.0.1:${port}/thema`, `http://[::1]:${port}/thema`, 'http://10.0.0.5/thema']) {
      const response = await emi.json('PUT', '/api/account/push', { kind: 'ntfy', url });
      assert.equal(response.statusCode, 403, `${url} → ${response.statusCode}`);
    }
    const subscription = await emi.json('POST', '/api/account/webpush', {
      endpoint: `http://127.0.0.1:${port}/push`,
      keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
    });
    assert.ok([400, 403].includes(subscription.statusCode), `Web-Push an interne Adresse → ${subscription.statusCode}`);
    assert.equal(sink.received.length, before, 'beim internen Dienst kam eine Anfrage an');
  });
});
