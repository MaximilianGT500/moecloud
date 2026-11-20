import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { routesOf } from '../src/app.ts';
import { config } from '../src/config.ts';
import { parseNetworks, plainAddress } from '../src/lib/networks.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let device: Client;

const OUTSIDE = '203.0.113.9';

const from = (client: Client, remoteAddress: string, method: string, url: string, payload?: unknown) =>
  client.send({ method: method as 'GET', url, remoteAddress, payload: payload as never });

const save = (networks: string, remoteAddress = '127.0.0.1') =>
  from(emi, remoteAddress, 'PUT', '/api/admin/security/networks', { networks });

const fill = (url: string) => url.replace(/:[A-Za-z]+/g, 'x1').replace(/\*/g, 'x1');

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
  const token = await emi.json('POST', '/api/account/app-passwords', { name: 'Skript', admin: true });
  assert.equal(token.statusCode, 200, token.body);
  device = new Client(app);
  device.basic = `Basic ${Buffer.from(`emi:${token.json().token}`).toString('base64')}`;
});

after(async () => {
  await app.close();
});

describe('Netzlisten', () => {
  it('liest Adressen und Netze für IPv4 und IPv6', () => {
    const list = parseNetworks('192.168.1.0/24, 10.0.0.5\n2001:db8::/32;::1  10.0.0.5 [2001:DB8:AA::1]');
    assert.deepEqual(list.invalid, []);
    assert.deepEqual(list.entries, ['192.168.1.0/24', '10.0.0.5', '2001:db8::/32', '::1', '2001:db8:aa::1']);
    for (const inside of [
      '192.168.1.1',
      '192.168.1.255',
      '10.0.0.5',
      '::ffff:10.0.0.5',
      '2001:db8:1::5',
      '::1',
      '[::1]',
      'fe80::1%eth0'.replace('fe80::1', '::1'),
    ]) {
      assert.equal(list.has(inside), true, inside);
    }
    for (const outside of ['192.168.2.1', '10.0.0.6', '2001:db9::1', '::2', '', 'localhost', 'nichts', '1.2.3', '192.168.1.1.5']) {
      assert.equal(list.has(outside), false, outside);
    }
  });

  it('meldet, was keine Adresse und kein Netz ist', () => {
    const list = parseNetworks('abc 1.2.3.4/33 1.2.3.4/x 1.2.3.4/8/9 300.1.1.1 ::1/129 10.0.0.0/8 /24 1.2.3.4/-1 1.2.3.4/');
    assert.deepEqual(list.entries, ['10.0.0.0/8']);
    assert.deepEqual(list.invalid, [
      'abc',
      '1.2.3.4/33',
      '1.2.3.4/x',
      '1.2.3.4/8/9',
      '300.1.1.1',
      '::1/129',
      '/24',
      '1.2.3.4/-1',
      '1.2.3.4/',
    ]);
    assert.equal(parseNetworks('').entries.length, 0);
    assert.equal(parseNetworks('0.0.0.0/0').has('8.8.8.8'), true);
    assert.equal(parseNetworks('0.0.0.0/0').has('2001:db8::1'), false);
    assert.equal(plainAddress('::FFFF:192.0.2.1'), '192.0.2.1');
  });
});

describe('Verwaltung nur aus bestimmten Netzen', () => {
  it('ist ohne Liste von überall erreichbar', async () => {
    assert.equal((await from(emi, OUTSIDE, 'GET', '/api/admin/users')).statusCode, 200);
    const report = (await emi.get('/api/admin/security')).json();
    assert.equal(report.networks, '');
    assert.equal(report.address, '127.0.0.1');
    assert.ok(!report.items.some((item: { id: string }) => item.id === 'networks'));
  });

  it('nimmt keine Liste an, die ungültig ist oder die eigene Adresse aussperrt', async () => {
    const invalid = await save('192.168.1.0/24\nkein-netz');
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.json().error.message, /kein-netz/);
    const locked = await save('192.168.1.0/24');
    assert.equal(locked.statusCode, 400);
    assert.match(locked.json().error.message, /127\.0\.0\.1/);
    const many = await save(Array.from({ length: 51 }, (_, index) => `10.0.${index}.0/24`).join('\n') + '\n127.0.0.1');
    assert.equal(many.statusCode, 400);
    assert.equal(settings.get('security.adminNetworks'), '');
    assert.equal((await mia.json('PUT', '/api/admin/security/networks', { networks: '127.0.0.1' })).statusCode, 403);
    assert.equal(settings.get('security.adminNetworks'), '');
  });

  it('sperrt danach alle anderen Adressen aus, auch Admins und ihre App-Passwörter', async () => {
    const saved = await save('127.0.0.1, 10.0.0.0/8 ; 2001:db8::/32\n127.0.0.1');
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().networks, '127.0.0.1\n10.0.0.0/8\n2001:db8::/32');
    for (const client of [emi, device]) {
      const blocked = await from(client, OUTSIDE, 'GET', '/api/admin/users');
      assert.equal(blocked.statusCode, 403, blocked.body);
      assert.equal(blocked.json().error.code, 'admin_network');
      for (const inside of ['127.0.0.1', '10.200.3.4', '::ffff:10.1.1.1', '2001:db8:5::1']) {
        assert.equal((await from(client, inside, 'GET', '/api/admin/users')).statusCode, 200, inside);
      }
    }
    const report = (await emi.get('/api/admin/security')).json();
    assert.equal(report.networks, '127.0.0.1\n10.0.0.0/8\n2001:db8::/32');
    const check = report.items.find((item: { id: string }) => item.id === 'networks');
    assert.equal(check?.level, 'ok');
    assert.match(check.text, /10\.0\.0\.0\/8/);
    const trusted = config.trustProxy;
    config.trustProxy = true;
    try {
      const open = (await emi.get('/api/admin/security')).json().items.find((item: { id: string }) => item.id === 'networks');
      assert.equal(open?.level, 'warn');
      assert.match(open.text, /TRUST_PROXY=true/);
    } finally {
      config.trustProxy = trusted;
    }
  });

  it('lässt alles andere von überall zu und verrät Mitgliedern nichts', async () => {
    assert.equal((await from(emi, OUTSIDE, 'GET', '/api/account')).statusCode, 200);
    assert.equal((await from(emi, OUTSIDE, 'GET', '/files')).statusCode, 200);
    assert.equal((await from(device, OUTSIDE, 'GET', '/api/account')).statusCode, 200);
    const member = await from(mia, OUTSIDE, 'GET', '/api/admin/users');
    assert.equal(member.statusCode, 403);
    assert.equal(member.json().error.code, 'forbidden');
    assert.equal((await from(mia, OUTSIDE, 'GET', '/admin')).statusCode, 404);
    const page = await emi.send({ method: 'GET', url: '/admin/people', remoteAddress: OUTSIDE, headers: { accept: 'text/html' } });
    assert.equal(page.statusCode, 403);
    assert.match(page.body, /Von hier aus nicht erreichbar/);
    assert.match(page.body, /203\.0\.113\.9/);
    assert.equal((await emi.get('/admin/people', { accept: 'text/html' })).statusCode, 200);
  });

  it('gilt für jede einzelne Route der Verwaltung', async () => {
    const admin = routesOf(app).filter(
      (route) => route.url.startsWith('/api/admin/') && route.method !== 'HEAD' && route.method !== 'OPTIONS'
    );
    assert.ok(admin.length > 80, `nur ${admin.length} Routen`);
    const wrong: string[] = [];
    for (const route of admin) {
      const response = await from(emi, OUTSIDE, route.method, fill(route.url), ['GET', 'DELETE'].includes(route.method) ? undefined : {});
      if (response.statusCode !== 403 || response.json().error?.code !== 'admin_network')
        wrong.push(`${route.method} ${route.url} → ${response.statusCode}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('lässt sich von drinnen ändern, aber nicht von draußen', async () => {
    assert.equal((await save('', OUTSIDE)).statusCode, 403);
    const narrowed = await save('10.0.0.0/8', '10.9.9.9');
    assert.equal(narrowed.statusCode, 200, narrowed.body);
    assert.equal((await emi.get('/api/admin/users')).statusCode, 403);
    assert.equal((await from(emi, '10.9.9.9', 'GET', '/api/admin/users')).statusCode, 200);
  });

  it('hebt die Beschränkung von der Kommandozeile aus auf', async () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'cli.ts', ...args], {
        cwd: resolve(import.meta.dirname, '..'),
        env: process.env,
        encoding: 'utf8',
        timeout: 60_000,
      });
    const shown = cli('admin-networks');
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /nur erreichbar aus: 10\.0\.0\.0\/8/);
    assert.equal(cli('admin-networks', 'weg').status, 1);
    const cleared = cli('admin-networks', 'clear');
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.match(cleared.stdout, /wieder von überall erreichbar/);
    settings.reset();
    assert.equal((await emi.get('/api/admin/users')).statusCode, 200);
    assert.equal((await from(emi, OUTSIDE, 'GET', '/api/admin/users')).statusCode, 200);
    assert.match(cli('admin-networks').stdout, /von überall erreichbar/);
  });
});
