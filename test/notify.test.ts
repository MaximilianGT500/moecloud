import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import ece from 'http_ece';
import { run, value } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';
import { digestCutoff, flushSummaries, inQuiet, localClock, notify } from '../src/services/notify.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let root = '';
const ids: Record<string, number> = {};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BERLIN = 'Europe/Berlin';

interface Hit {
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}
const hits: Hit[] = [];
let status = 201;
const sink = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    hits.push({ url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks) });
    response.writeHead(status).end();
  });
});
let sinkUrl = '';

async function eventually(check: () => boolean, timeout = 3000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) assert.fail('Die Bedingung trat nicht ein');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const mailsTo = (address: string, from: number) => outbox.slice(from).filter((entry) => entry.to === address);
const share = async (name: string, userId: number) => {
  const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name })).json().node.id;
  assert.equal((await emi.json('POST', `/api/nodes/${folder}/grants`, { userId, permission: 'view' })).statusCode, 200);
};

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  for (const [username, name] of [
    ['mia', 'Mia'],
    ['lea', 'Lea'],
  ]) {
    ids[username] = (
      await emi.json('POST', '/api/admin/users', { username, name, email: `${username}@example.com`, password: `${username}-passwort-123` })
    ).json().user.id;
  }
  mia = await login(app, 'mia', 'mia-passwort-123');
  lea = await login(app, 'lea', 'lea-passwort-123');
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
  sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => sink.close(resolve));
  await app.close();
});

describe('Ruhezeiten und Zeitzonen', () => {
  it('rechnet in der Zeitzone der Person', () => {
    const evening = Date.UTC(2026, 10, 17, 21, 30);
    assert.deepEqual(localClock(BERLIN, evening), { minutes: 22 * 60 + 30, weekday: 2 });
    assert.deepEqual(localClock('America/New_York', evening), { minutes: 16 * 60 + 30, weekday: 2 });
    assert.deepEqual(localClock('Gibt/Es-Nicht', evening), { minutes: 21 * 60 + 30, weekday: 2 });
    assert.deepEqual(localClock(BERLIN, Date.UTC(2026, 6, 4, 22, 5)), { minutes: 5, weekday: 0 });
    const night = { quiet: { from: 22 * 60, to: 7 * 60 }, zone: BERLIN };
    assert.equal(inQuiet(night, evening), true);
    assert.equal(inQuiet(night, Date.UTC(2026, 10, 17, 20, 59)), false);
    assert.equal(inQuiet(night, Date.UTC(2026, 10, 18, 5, 59)), true);
    assert.equal(inQuiet(night, Date.UTC(2026, 10, 18, 6, 0)), false);
    const lunch = { quiet: { from: 12 * 60, to: 13 * 60 }, zone: BERLIN };
    assert.equal(inQuiet(lunch, Date.UTC(2026, 10, 17, 11, 30)), true);
    assert.equal(inQuiet(lunch, Date.UTC(2026, 10, 17, 12, 0)), false);
    assert.equal(inQuiet({ quiet: null, zone: BERLIN }, evening), false);
  });

  it('findet den letzten Zeitpunkt für die Zusammenfassung', () => {
    const tuesday = Date.UTC(2026, 10, 17, 8, 15);
    assert.equal(digestCutoff({ digest: 'off', zone: BERLIN }, tuesday), tuesday);
    assert.equal(digestCutoff({ digest: 'daily', zone: BERLIN }, tuesday), Date.UTC(2026, 10, 17, 7, 0));
    assert.equal(digestCutoff({ digest: 'daily', zone: BERLIN }, Date.UTC(2026, 10, 17, 6, 30)), Date.UTC(2026, 10, 16, 7, 0));
    assert.equal(digestCutoff({ digest: 'weekly', zone: BERLIN }, tuesday), Date.UTC(2026, 10, 16, 7, 0));
    assert.equal(digestCutoff({ digest: 'weekly', zone: BERLIN }, Date.UTC(2026, 10, 16, 6, 30)), Date.UTC(2026, 10, 9, 7, 0));
    assert.equal(digestCutoff({ digest: 'weekly', zone: BERLIN }, Date.UTC(2026, 10, 22, 12, 0)), Date.UTC(2026, 10, 16, 7, 0));
  });
});

describe('Zusammenfassung per E-Mail', () => {
  it('sammelt E-Mails und schickt sie zur gewählten Zeit', async () => {
    const wrong = await mia.json('PATCH', '/api/account/prefs', { zone: 'Mars/Olympus' });
    assert.equal(wrong.statusCode, 400);
    const saved = await mia.json('PATCH', '/api/account/prefs', { digest: 'daily', zone: BERLIN });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().prefs.digest, 'daily');
    const start = outbox.length;
    await share('Fotos für Mia', ids.mia);
    await share('Rezepte für Mia', ids.mia);
    await settle();
    assert.equal(mailsTo('mia@example.com', start).length, 0);
    const created = Date.UTC(2026, 10, 17, 9, 0);
    run('UPDATE notifications SET created_at = ? WHERE user_id = ?', created, ids.mia);
    assert.equal(await flushSummaries(created + 3 * HOUR), 0);
    assert.equal(await flushSummaries(Date.UTC(2026, 10, 18, 6, 59)), 0);
    assert.equal(await flushSummaries(Date.UTC(2026, 10, 18, 7, 1)), 1);
    const sent = mailsTo('mia@example.com', start);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, '2 Neuigkeiten in MoeCloud Test');
    assert.match(sent[0].text, /• Emi hat „Fotos für Mia“ mit dir geteilt/);
    assert.match(sent[0].text, /• Emi hat „Rezepte für Mia“ mit dir geteilt/);
    assert.equal(await flushSummaries(Date.UTC(2026, 10, 19, 7, 1)), 0);
    assert.equal(mailsTo('mia@example.com', start).length, 1);
  });

  it('schickt Dringendes sofort und Gelesenes gar nicht', async () => {
    const start = outbox.length;
    notify(ids.mia, 'login_new', { device: 'Firefox auf Linux', ip: '203.0.113.7' }, '/account#sitzungen');
    await eventually(() => mailsTo('mia@example.com', start).length === 1);
    assert.equal(mailsTo('mia@example.com', start)[0].subject, 'Neue Anmeldung bei deinem Konto');
    await share('Noten für Mia', ids.mia);
    await settle();
    assert.equal(Number(value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND mail_state = 1', ids.mia)), 1);
    await mia.json('POST', '/api/notifications/read', {});
    assert.equal(await flushSummaries(Date.now() + 26 * HOUR), 0);
    assert.equal(Number(value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND mail_state = 1', ids.mia)), 0);
    assert.equal(mailsTo('mia@example.com', start).length, 1);
    await share('Pläne für Mia', ids.mia);
    await settle();
    assert.equal(await flushSummaries(Date.now() + 26 * HOUR), 1);
    const single = mailsTo('mia@example.com', start)[1];
    assert.equal(single.subject, 'Emi hat „Pläne für Mia“ mit dir geteilt');
    await mia.json('PATCH', '/api/account/prefs', { digest: 'off' });
  });
});

describe('Ruhezeiten', () => {
  it('hält E-Mail und Push zurück und fasst danach zusammen', async () => {
    await emi.json('PATCH', '/api/admin/settings', { 'push.private': true });
    assert.equal((await lea.json('PUT', '/api/account/push', { kind: 'ntfy', url: `${sinkUrl}/lea-moecloud` })).statusCode, 200);
    const same = await lea.json('PATCH', '/api/account/prefs', { quiet: { from: 60, to: 60 } });
    assert.equal(same.statusCode, 400);
    const now = localClock(BERLIN).minutes;
    const quiet = { from: (now + 1440 - 60) % 1440, to: (now + 60) % 1440 };
    const saved = await lea.json('PATCH', '/api/account/prefs', { quiet, zone: BERLIN });
    assert.deepEqual(saved.json().prefs.quiet, quiet);
    const mails = outbox.length;
    const pushes = hits.length;
    await share('Fotos für Lea', ids.lea);
    await share('Musik für Lea', ids.lea);
    await settle();
    assert.equal(hits.length, pushes);
    assert.equal(mailsTo('lea@example.com', mails).length, 0);
    assert.equal((await lea.get('/api/notifications')).json().items.length, 2);
    assert.equal(await flushSummaries(), 0);
    assert.equal(await flushSummaries(Date.now() + 2 * HOUR), 2);
    assert.equal(hits.length, pushes + 1);
    const summary = JSON.parse(hits.at(-1)!.body.toString()) as { title: string; message: string };
    assert.equal(summary.title, '2 neue Benachrichtigungen');
    assert.equal(summary.message, 'Emi hat „Fotos für Lea“ mit dir geteilt\nEmi hat „Musik für Lea“ mit dir geteilt');
    assert.equal(mailsTo('lea@example.com', mails)[0].subject, '2 Neuigkeiten in MoeCloud Test');
    notify(ids.lea, 'login_new', { device: 'Firefox auf Linux', ip: '203.0.113.7' }, '/account#sitzungen');
    await eventually(() => hits.length === pushes + 2);
    assert.equal(JSON.parse(hits.at(-1)!.body.toString()).title, 'Neue Anmeldung bei deinem Konto');
    assert.equal((await lea.json('PATCH', '/api/account/prefs', { quiet: null })).json().prefs.quiet, null);
    await lea.json('DELETE', '/api/account/push');
  });
});

describe('Push im Browser', () => {
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const auth = randomBytes(16).toString('base64url');
  const keys = { p256dh: browser.getPublicKey('base64url'), auth };
  const decrypt = (hit: Hit) =>
    JSON.parse(ece.decrypt(hit.body, { version: 'aes128gcm', privateKey: browser, authSecret: auth }).toString()) as {
      title: string;
      text: string;
      url: string | null;
    };

  it('meldet Browser an und verschlüsselt die Nachrichten', async () => {
    await emi.json('PATCH', '/api/admin/settings', { 'push.private': false });
    const info = (await lea.get('/api/account/webpush')).json();
    assert.equal(info.enabled, true);
    assert.equal(Buffer.from(info.publicKey, 'base64url').length, 65);
    assert.deepEqual(info.items, []);
    const endpoint = `${sinkUrl}/push/lea-firefox`;
    assert.equal((await lea.json('POST', '/api/account/webpush', { endpoint, keys })).statusCode, 400);
    assert.equal((await lea.json('POST', '/api/account/webpush', { endpoint: 'https://127.0.0.1/push', keys })).statusCode, 403);
    await emi.json('PATCH', '/api/admin/settings', { 'push.private': true });
    const first = await lea.json('POST', '/api/account/webpush', { endpoint, keys });
    assert.equal(first.statusCode, 200, first.body);
    const saved = await lea.send({
      method: 'POST',
      url: '/api/account/webpush',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
      },
      payload: JSON.stringify({ endpoint, keys }),
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(first.json().id, saved.json().id);
    const listed = (await lea.get(`/api/account/webpush?endpoint=${encodeURIComponent(endpoint)}`)).json().items;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].current, true);
    assert.equal(listed[0].device, 'Firefox auf Linux');
    const before = hits.length;
    const tested = await lea.json('POST', '/api/account/webpush/test');
    assert.equal(tested.statusCode, 200, tested.body);
    const hit = hits[before];
    assert.equal(hit.url, '/push/lea-firefox');
    assert.equal(hit.headers['content-encoding'], 'aes128gcm');
    assert.equal(hit.headers.ttl, '86400');
    assert.deepEqual(decrypt(hit), {
      title: 'Test von MoeCloud',
      text: 'Wenn du das liest, kommen Benachrichtigungen bei dir an.',
      url: '/account#push',
    });
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(String(hit.headers.authorization))!;
    assert.equal(key, info.publicKey);
    const [head, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { aud: string; sub: string; exp: number };
    assert.equal(claims.aud, sinkUrl);
    assert.equal(claims.sub, 'mailto:cloud@example.com');
    assert.ok(claims.exp > Date.now() / 1000);
    const point = Buffer.from(key, 'base64url');
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    assert.ok(
      verify(
        'sha256',
        Buffer.from(`${head}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url')
      )
    );
    assert.ok(!(await lea.get('/api/account')).body.includes(auth));
    assert.equal((await lea.get('/api/account')).json().webPush, 1);
    const worker = await new Client(app).get('/sw.js');
    assert.equal(worker.statusCode, 200);
    assert.match(String(worker.headers['content-type']), /^text\/javascript/);
    assert.equal(worker.headers['service-worker-allowed'], '/');
    assert.ok(worker.body.includes('showNotification'));
  });

  it('schickt Benachrichtigungen an den Browser und vergisst abgemeldete', async () => {
    const before = hits.length;
    await share('Bilder für Lea', ids.lea);
    await eventually(() => hits.length > before);
    const shared = decrypt(hits.at(-1)!);
    assert.equal(shared.title, 'Emi hat „Bilder für Lea“ mit dir geteilt');
    assert.match(String(shared.url), /^(http:\/\/localhost:3000)?\/files\//);
    assert.equal(
      (await mia.json('DELETE', `/api/account/webpush/${(await lea.get('/api/account/webpush')).json().items[0].id}`)).statusCode,
      404
    );
    status = 410;
    const gone = await lea.json('POST', '/api/account/webpush/test');
    assert.equal(gone.statusCode, 400);
    assert.equal(gone.json().error.message, 'Die Testnachricht kam bei keinem Browser an');
    assert.deepEqual((await lea.get('/api/account/webpush')).json().items, []);
    status = 201;
    const again = (await lea.json('POST', '/api/account/webpush', { endpoint: `${sinkUrl}/push/lea-chrome`, keys })).json();
    assert.equal((await lea.json('DELETE', `/api/account/webpush/${again.id}`)).statusCode, 200);
    await emi.json('PATCH', '/api/admin/settings', { 'push.enabled': false });
    assert.equal((await lea.get('/api/account/webpush')).json().publicKey, null);
    assert.equal((await lea.json('POST', '/api/account/webpush', { endpoint: `${sinkUrl}/push/x`, keys })).statusCode, 403);
    await emi.json('PATCH', '/api/admin/settings', { 'push.enabled': true, 'push.private': false });
  });
});
