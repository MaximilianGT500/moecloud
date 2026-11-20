import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { hotp, totpCounter } from '../src/lib/crypto.ts';
import { all, one, run } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';
import * as settings from '../src/services/settings.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
let address = 0;

interface Check {
  id: string;
  level: 'ok' | 'hint' | 'warn';
  title: string;
  text: string;
  link: string | null;
}

const next = () => `127.0.9.${(address++ % 250) + 1}`;

async function report() {
  const response = await emi.get('/api/admin/security');
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as {
    items: Check[];
    counts: { ok: number; hint: number; warn: number };
    lockouts: { kind: string; id: string; label: string; until: number }[];
    contact: string;
    stats: { sessions: number; appPasswords: number; failedLogins: number };
  };
}

const level = async (id: string) => (await report()).items.find((item) => item.id === id)?.level;

async function tryLogin(username: string, password: string, remoteAddress = next()) {
  const client = new Client(app);
  await client.send({ method: 'GET', url: '/login', headers: { accept: 'text/html' }, remoteAddress });
  return client.send({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' }).toString(),
  });
}

before(async () => {
  emi = await setUp(app);
  const mail = await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  assert.equal(mail.statusCode, 200, mail.body);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'mias-passwort-123',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'mias-passwort-123');
  root = (await mia.get('/api/session')).json().user.rootId;
});

after(() => app.close());

describe('Sicherheitsprüfung der Verwaltung', () => {
  it('gehört nur Admins und nennt nichts Geheimes', async () => {
    assert.equal((await mia.get('/api/admin/security')).statusCode, 403);
    assert.equal((await new Client(app).get('/api/admin/security')).statusCode, 401);
    const data = await report();
    assert.ok(data.items.length >= 12, `nur ${data.items.length} Punkte`);
    assert.equal(data.counts.ok + data.counts.hint + data.counts.warn, data.items.length);
    for (const item of data.items) {
      assert.match(item.id, /^[a-z]+$/);
      assert.ok(['ok', 'hint', 'warn'].includes(item.level));
      assert.ok(item.title.length > 5 && item.text.length > 10, item.id);
      assert.doesNotMatch(item.title + item.text, /[!]/, `${item.id}: ohne Ausrufezeichen`);
      if (item.link) assert.match(item.link, /^\/(admin|account)/);
    }
    assert.deepEqual(
      data.items.map((item) => item.level),
      [...data.items.map((item) => item.level)].sort((a, b) => ['warn', 'hint', 'ok'].indexOf(a) - ['warn', 'hint', 'ok'].indexOf(b)),
      'Dringendes steht oben'
    );
    assert.doesNotMatch(JSON.stringify(data), /argon2|token_hash|secret|sehr-sicheres-passwort|smtp\.example/);
    const english = await emi.get('/api/admin/security', {
      cookie: `${[...emi.cookies].map(([k, v]) => `${k}=${v}`).join('; ')}; moe_lang=en`,
    });
    assert.equal(english.statusCode, 200);
  });

  it('reagiert auf das, was eingestellt ist', async () => {
    assert.equal(await level('https'), 'hint', 'localhost ohne HTTPS ist ein Hinweis');
    settings.set('site.url', 'http://cloud.example.org');
    assert.equal(await level('https'), 'warn', 'eine öffentliche Adresse ohne HTTPS ist dringend');
    settings.set('site.url', 'https://cloud.example.org');
    assert.equal(await level('https'), 'ok');
    assert.equal(await level('address'), 'ok');
    settings.set('site.url', '');
    assert.equal(await level('address'), 'hint');
    settings.set('site.url', 'http://localhost:3000');

    assert.equal(await level('admins'), 'warn', 'Emi hat noch keinen zweiten Faktor');
    const setup = (await emi.json('POST', '/api/account/totp/setup')).json();
    assert.equal((await emi.json('POST', '/api/account/totp/enable', { code: hotp(setup.secret, totpCounter()) })).statusCode, 200);
    assert.equal(await level('admins'), 'ok');

    assert.equal(await level('policy'), 'hint');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.require2fa': 'admins' })).statusCode, 200);
    assert.equal(await level('policy'), 'ok');

    assert.equal(await level('registration'), 'ok');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'open' })).statusCode, 200);
    assert.equal(await level('registration'), 'warn');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.confirmEmail': true })).statusCode, 200);
    assert.equal(await level('registration'), 'hint');
    await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'closed', 'auth.confirmEmail': false });

    assert.equal(await level('passwords'), 'hint');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordMin': 14, 'auth.passwordBreach': true })).statusCode, 200);
    assert.equal(await level('passwords'), 'ok');
    await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordBreach': false, 'auth.passwordMin': 10 });

    assert.equal(await level('tokens'), 'ok');
    const token = await emi.json('POST', '/api/account/app-passwords', { name: 'Sicherungsskript', admin: true });
    assert.equal(token.statusCode, 200, token.body);
    const tokens = (await report()).items.find((item) => item.id === 'tokens')!;
    assert.equal(tokens.level, 'hint');
    assert.match(tokens.text, /Sicherungsskript \(Emi\)/);
    assert.equal((await emi.json('DELETE', `/api/account/app-passwords/${token.json().item.id}`)).statusCode, 200);
    assert.equal(await level('tokens'), 'ok');

    assert.equal(await level('links'), 'ok');
    const folder = (await mia.json('POST', `/api/nodes/${root}/folders`, { name: 'Offen' })).json().node.id;
    const link = (await mia.json('POST', `/api/nodes/${folder}/links`, {})).json().link.id;
    assert.equal(await level('links'), 'hint');
    assert.equal((await mia.json('PATCH', `/api/links/${link}`, { password: 'ein-passwort-fuer-den-link' })).statusCode, 200);
    assert.equal(await level('links'), 'ok');

    assert.equal(await level('private'), 'ok');
    settings.set('import.private', true);
    assert.equal(await level('private'), 'hint');
    settings.set('import.private', false);

    assert.equal(await level('mail'), 'ok');
    settings.set('mail.enabled', false);
    assert.equal(await level('mail'), 'hint');
    settings.set('mail.enabled', true);

    settings.set('backup.last', Date.now() - 10 * 86_400_000);
    assert.equal(await level('backups'), 'warn');
    settings.set('backup.last', Date.now());
    assert.equal(await level('backups'), 'ok');

    settings.set('metrics.token', 'kurz');
    assert.equal(await level('metrics'), 'warn');
    settings.set('metrics.token', '');
    assert.equal(await level('metrics'), undefined);

    settings.set('updates.latest', {
      version: '99.0.0',
      date: '2026-12-01',
      url: 'https://example.com',
      security: true,
      notes: { de: [], en: [] },
      checkedAt: Date.now(),
    });
    assert.equal(await level('updates'), 'warn');
    settings.set('updates.latest', null);
  });

  it('zeigt gesperrte Anmeldungen und gibt sie wieder frei', async () => {
    const made = await emi.json('POST', '/api/admin/users', { username: 'lena', name: 'Lena', password: 'lenas-passwort-123' });
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual(
      (await report()).lockouts.filter((entry) => entry.label === 'lena'),
      []
    );
    const from = '203.0.113.77';
    let status = 0;
    for (let attempt = 0; attempt < 12; attempt++) status = (await tryLogin('lena', `falsch-${attempt}-falsch`, from)).statusCode;
    assert.equal(status, 429);
    assert.equal((await tryLogin('lena', 'lenas-passwort-123')).statusCode, 429);
    const data = await report();
    const locked = data.lockouts.find((entry) => entry.kind === 'account' && entry.label === 'lena');
    assert.ok(locked, JSON.stringify(data.lockouts));
    assert.match(locked.id, /^[0-9a-f]{24}$/);
    assert.ok(locked.until > Date.now() && locked.until < Date.now() + 16 * 60_000);
    assert.doesNotMatch(JSON.stringify(data.lockouts), /203\.0\.113\.77/, 'Adressen stehen gekürzt in der Liste');
    assert.ok(data.stats.failedLogins >= 10);

    for (const id of ['', 'x', '0'.repeat(24), `${locked.id}0`, "' OR 1=1 --"]) {
      const response = await emi.json('POST', '/api/admin/security/unlock', { id });
      assert.ok([400, 404].includes(response.statusCode), `${id} → ${response.statusCode}`);
    }
    assert.equal((await mia.json('POST', '/api/admin/security/unlock', { id: locked.id })).statusCode, 403);
    assert.equal((await tryLogin('lena', 'lenas-passwort-123')).statusCode, 429, 'ohne Freigabe bleibt die Sperre');
    const released = await emi.json('POST', '/api/admin/security/unlock', { id: locked.id });
    assert.equal(released.statusCode, 200, released.body);
    assert.ok(!(released.json().lockouts as { label: string }[]).some((entry) => entry.label === 'lena'));
    assert.equal((await tryLogin('lena', 'lenas-passwort-123')).statusCode, 303);
    const log = (await emi.get('/api/admin/audit?action=lockout_released')).json().items as { action: string }[];
    assert.equal(log.length, 1);
  });
});

describe('Kontakt für Sicherheitsmeldungen', () => {
  it('gibt es erst mit einer Adresse und nur in sauberer Form', async () => {
    assert.equal((await new Client(app).get('/.well-known/security.txt')).statusCode, 404);
    assert.equal(await level('contact'), 'hint');
    for (const value of [
      'javascript:alert(1)',
      'http://example.com/melden',
      'ftp://example.com',
      'kein kontakt',
      'a b@example.com',
      'mia@example.com\nContact: mailto:boese@example.com',
      'mia@example.com\r\nExpires: 2099-01-01T00:00:00Z',
      'https://example.com/a b',
      'mailto:mia@example.com',
      '<mia@example.com>',
    ]) {
      const response = await emi.json('PATCH', '/api/admin/settings', { 'security.contact': value });
      assert.equal(response.statusCode, 400, JSON.stringify(value));
    }
    assert.equal((await mia.json('PATCH', '/api/admin/settings', { 'security.contact': 'mia@example.com' })).statusCode, 403);
    assert.equal(settings.get('security.contact'), '');

    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'security.contact': ' sicherheit@example.com ' })).statusCode, 200);
    const file = await new Client(app).get('/.well-known/security.txt');
    assert.equal(file.statusCode, 200);
    assert.match(String(file.headers['content-type']), /^text\/plain/);
    const lines = file.body.trim().split('\n');
    assert.deepEqual(lines.slice(0, 1), ['Contact: mailto:sicherheit@example.com']);
    assert.equal(lines.length, 4);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(file.body)![1]);
    assert.ok(
      expires > Date.now() + 30 * 86_400_000 && expires < Date.now() + 365 * 86_400_000,
      'das Ablaufdatum liegt in der Zukunft und unter einem Jahr'
    );
    assert.match(file.body, /^Preferred-Languages: de, en$/m);
    assert.match(file.body, /^Canonical: http:\/\/localhost:3000\/\.well-known\/security\.txt$/m);
    assert.equal(await level('contact'), undefined);

    assert.equal(
      (await emi.json('PATCH', '/api/admin/settings', { 'security.contact': 'https://example.com/sicherheit' })).statusCode,
      200
    );
    assert.match((await new Client(app).get('/.well-known/security.txt')).body, /^Contact: https:\/\/example\.com\/sicherheit$/m);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'security.contact': '' })).statusCode, 200);
    assert.equal((await new Client(app).get('/.well-known/security.txt')).statusCode, 404);
  });

  it('führt Passwortmanager zur richtigen Stelle', async () => {
    for (const client of [new Client(app), mia]) {
      const response = await client.get('/.well-known/change-password', { accept: 'text/html' });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/account#sicherheit');
    }
    const page = await new Client(app).get('/account', { accept: 'text/html' });
    assert.equal(page.statusCode, 302);
    assert.match(String(page.headers.location), /^\/login\?next=%2Faccount/);
  });
});

describe('Konto absichern', () => {
  it('meldet alles andere ab, widerruft App-Passwörter und pausiert auf Wunsch die Links', async () => {
    const second = await login(app, 'mia', 'mias-passwort-123');
    const third = await login(app, 'mia', 'mias-passwort-123');
    const device = await mia.json('POST', '/api/account/app-passwords', { name: 'Laptop' });
    assert.equal(device.statusCode, 200);
    const basic = new Client(app);
    basic.basic = `Basic ${Buffer.from(`mia:${device.json().token}`).toString('base64')}`;
    assert.equal((await basic.get('/api/session')).statusCode, 200);
    const folder = (await mia.json('POST', `/api/nodes/${root}/folders`, { name: 'Geteilt' })).json().node.id;
    const link = (await mia.json('POST', `/api/nodes/${folder}/links`, {})).json().link as { id: string; token: string };
    assert.equal((await new Client(app).get(`/api/public/${link.token}`)).statusCode, 200);

    assert.equal(
      (await basic.json('POST', '/api/account/secure', { password: 'mias-passwort-123' })).statusCode,
      403,
      'ein App-Passwort sichert kein Konto ab'
    );
    assert.equal((await mia.json('POST', '/api/account/secure', {})).statusCode, 400);
    const wrong = await mia.json('POST', '/api/account/secure', { password: 'falsch-falsch-falsch' });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().error.code, 'password_required');
    assert.equal((await second.get('/api/session')).statusCode, 200, 'ohne das richtige Passwort passiert nichts');

    outbox.length = 0;
    const done = await mia.json('POST', '/api/account/secure', { password: 'mias-passwort-123', links: true });
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual(Object.keys(done.json()).sort(), ['appPasswords', 'links', 'sessions']);
    assert.ok(done.json().sessions >= 2);
    assert.equal(done.json().appPasswords, 1);
    assert.ok(done.json().links >= 1);
    assert.equal((await mia.get('/api/session')).statusCode, 200, 'der eigene Browser bleibt angemeldet');
    assert.equal((await second.get('/api/session')).statusCode, 401);
    assert.equal((await third.get('/api/session')).statusCode, 401);
    assert.equal((await basic.get('/api/session')).statusCode, 401);
    assert.equal((await new Client(app).get(`/api/public/${link.token}`)).statusCode, 404, 'der Link ist pausiert');
    assert.equal((await mia.json('PATCH', `/api/links/${link.id}`, { paused: false })).statusCode, 200, 'und lässt sich wieder freigeben');
    assert.equal((await new Client(app).get(`/api/public/${link.token}`)).statusCode, 200);
    const log = (await mia.get('/api/account/security')).json().items as { action: string }[];
    assert.ok(log.some((entry) => entry.action === 'account_secured'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      outbox.some((entry) => JSON.stringify(entry).includes('mia@example.com') && /abgesichert/.test(JSON.stringify(entry))),
      'Mia bekommt eine E-Mail darüber'
    );

    const keep = await mia.json('POST', '/api/account/secure', {
      password: 'mias-passwort-123',
      sessions: false,
      appPasswords: false,
      links: false,
    });
    assert.equal(keep.statusCode, 200);
    assert.deepEqual(keep.json(), { sessions: 0, appPasswords: 0, links: 0 });
  });

  it('und jede Änderung an der Anmeldung landet als Hinweis beim Konto', async () => {
    run('DELETE FROM notifications');
    outbox.length = 0;
    const created = await mia.json('POST', '/api/account/app-passwords', { name: 'Tablet' });
    assert.equal(created.statusCode, 200);
    const changed = await mia.json('POST', '/api/account/password', { current: 'mias-passwort-123', next: 'mias-neues-passwort-456' });
    assert.equal(changed.statusCode, 200, changed.body);
    const kinds = all<{ kind: string; params: string }>(
      "SELECT kind, params FROM notifications WHERE user_id = (SELECT id FROM users WHERE username = 'mia')"
    );
    assert.deepEqual(kinds.map((row) => JSON.parse(row.params).change).sort(), ['app_password', 'password']);
    assert.ok(kinds.every((row) => row.kind === 'account_change'));
    const shown = (await mia.get('/api/notifications')).json().items as { title: string; text: string }[];
    assert.ok(shown.some((entry) => /Passwort wurde geändert/.test(entry.title)));
    assert.ok(shown.some((entry) => /App-Passwort „Tablet“/.test(entry.title)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mails = outbox.map((entry) => JSON.stringify(entry)).filter((entry) => entry.includes('"mia@example.com"'));
    assert.ok(
      mails.some((entry) => /Passwort wurde geändert/.test(entry)),
      'die Änderung des Passworts kommt per E-Mail'
    );
    assert.doesNotMatch(mails.join('\n'), /mias-neues-passwort-456|mias-passwort-123/, 'Passwörter stehen in keiner E-Mail');
    assert.equal(
      one<{ count: number }>('SELECT COUNT(*) AS count FROM notifications WHERE user_id = 1')!.count,
      0,
      'andere Konten erfahren davon nichts'
    );
  });
});
