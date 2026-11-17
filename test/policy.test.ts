import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.ts';
import { outbox } from '../src/services/mail.ts';
import { reportDue, sendWeeklyReports, weeklyReport } from '../src/services/report.ts';
import * as settings from '../src/services/settings.ts';
import { recordUsage } from '../src/services/usage.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let miaId = 0;
const LEAKED = 'sommer-in-kyoto-2026';
const leakedHash = createHash('sha1').update(LEAKED).digest('hex').toUpperCase();
const asked: { url: string; padding: string | undefined }[] = [];
const hibp = createServer((request, response) => {
  asked.push({ url: request.url ?? '', padding: request.headers['add-padding'] as string | undefined });
  const lines = ['0018A45C4D1DEF81644B54AB7F969B88D65:3', `${leakedHash.slice(5)}:1042`, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0'];
  response.writeHead(200, { 'content-type': 'text/plain' }).end(lines.join('\r\n'));
});
const message = (response: { json: () => { error: { message: string } } }) => response.json().error.message;

before(async () => {
  emi = await setUp(app);
  miaId = (
    await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', email: 'mia@example.com', password: 'mias-passwort-123' })
  ).json().user.id;
  await new Promise<void>((resolve) => hibp.listen(0, '127.0.0.1', resolve));
  config.breachUrl = `http://127.0.0.1:${(hibp.address() as AddressInfo).port}/range/`;
});

after(async () => {
  hibp.close();
  await app.close();
});

describe('Passwort-Richtlinie', () => {
  it('verlangt die eingestellte Mindestlänge', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordMin': 8 })).statusCode, 400);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordMin': 14 })).statusCode, 200);
    const mia = await login(app, 'mia', 'mias-passwort-123');
    assert.equal((await mia.get('/api/account')).json().passwordMin, 14);
    const short = await mia.json('POST', '/api/account/password', { current: 'mias-passwort-123', next: 'nur-zwölf-123' });
    assert.equal(short.statusCode, 400);
    assert.equal(message(short), 'Das Passwort braucht mindestens 14 Zeichen');
    const created = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort' });
    assert.equal(message(created), 'Das Passwort braucht mindestens 14 Zeichen');
    const reset = await emi.json('PATCH', `/api/admin/users/${miaId}`, { password: 'zu-kurz-12345' });
    assert.equal(message(reset), 'Das Passwort braucht mindestens 14 Zeichen');
    const csv = 'username;name;password\nlea;Lea;leas-passwort\nemily;Emily;emilys-langes-passwort';
    const lines = (await emi.json('POST', '/api/admin/users/import', { csv })).json().lines as { status: string; message: string | null }[];
    assert.deepEqual(
      lines.map((line) => [line.status, line.message]),
      [
        ['error', 'Das Passwort braucht mindestens 14 Zeichen'],
        ['ready', null],
      ]
    );
    const long = await mia.json('POST', '/api/account/password', { current: 'mias-passwort-123', next: 'mias-langes-passwort' });
    assert.equal(long.statusCode, 200, long.body);
    await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordMin': 10 });
  });

  it('lehnt Passwörter aus Datenlecks ab, ohne sie zu verraten', async () => {
    const mia = await login(app, 'mia', 'mias-langes-passwort');
    assert.equal((await mia.json('POST', '/api/account/password', { current: 'mias-langes-passwort', next: LEAKED })).statusCode, 200);
    assert.equal(asked.length, 0);
    await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordBreach': true });
    const again = await login(app, 'mia', LEAKED);
    const refused = await again.json('POST', '/api/account/password', { current: LEAKED, next: LEAKED });
    assert.equal(refused.statusCode, 400);
    assert.equal(message(refused), 'Dieses Passwort stand schon in einem Datenleck. Nimm ein anderes');
    assert.deepEqual(asked, [{ url: `/range/${leakedHash.slice(0, 5)}`, padding: 'true' }]);
    const fine = await again.json('POST', '/api/account/password', { current: LEAKED, next: 'herbst-in-kyoto-2026' });
    assert.equal(fine.statusCode, 200, fine.body);
    assert.equal(asked.length, 2);
    assert.ok(asked.every((entry) => /^\/range\/[0-9A-F]{5}$/.test(entry.url)));
    const admin = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: LEAKED });
    assert.equal(message(admin), 'Dieses Passwort stand schon in einem Datenleck. Nimm ein anderes');
    config.breachUrl = 'http://127.0.0.1:9/range/';
    const offline = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: LEAKED });
    assert.equal(offline.statusCode, 200, offline.body);
    await emi.json('PATCH', '/api/admin/settings', { 'auth.passwordBreach': false });
  });
});

describe('Wochenbericht', () => {
  it('fasst die Woche für Admins zusammen', async () => {
    recordUsage(Date.now(), true);
    const report = weeklyReport('de');
    assert.equal(report.title, 'Wochenbericht für MoeCloud Test');
    assert.match(report.lines[0], /^Speicher: 0 B belegt, \+0 B in den letzten sieben Tagen\.$/);
    assert.equal(report.lines[1], 'Konten: 3 aktive Konten, 3 neue diese Woche.');
    assert.match(report.lines[2], /^Anmeldungen: \d+ erfolgreich, 0 fehlgeschlagen\.$/);
    assert.equal(report.lines[3], 'Teilen: 0 neue Links.');
    assert.equal(report.lines.at(-1), 'Sicherung: Es gibt noch keine.');
    assert.equal(weeklyReport('en').title, 'Weekly report for MoeCloud Test');
  });

  it('kommt montags einmal und auf Wunsch sofort', async () => {
    const monday = new Date(2026, 10, 16, 8, 0);
    assert.equal(reportDue(monday), null);
    assert.equal(message(await emi.json('POST', '/api/admin/report/send')), 'Der E-Mail-Versand ist auf diesem Server nicht eingerichtet');
    await emi.json('PATCH', '/api/admin/mail', {
      'mail.enabled': true,
      'mail.host': 'smtp.example.com',
      'mail.port': 587,
      'mail.from': 'cloud@example.com',
    });
    assert.equal(reportDue(monday), null);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'report.weekly': true })).statusCode, 200);
    assert.equal(reportDue(new Date(2026, 10, 16, 7, 59)), null);
    assert.equal(reportDue(monday), '2026-11-16');
    const start = outbox.length;
    assert.equal(await sendWeeklyReports(monday), 1);
    assert.equal(await sendWeeklyReports(new Date(2026, 10, 16, 8, 5)), 0);
    assert.equal(reportDue(new Date(2026, 10, 19, 12, 0)), null);
    assert.equal(reportDue(new Date(2026, 10, 23, 9, 0)), '2026-11-23');
    const mails = outbox.slice(start);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'emi@example.com');
    assert.equal(mails[0].subject, 'Wochenbericht für MoeCloud Test');
    assert.match(mails[0].text, /Konten: \d+ aktive Konten/);
    assert.equal(settings.get('report.sent'), '2026-11-16');
    const now = await emi.json('POST', '/api/admin/report/send');
    assert.equal(now.statusCode, 200, now.body);
    assert.equal(outbox.length, start + 2);
    const mia = await login(app, 'mia', 'herbst-in-kyoto-2026');
    assert.equal((await mia.json('POST', '/api/admin/report/send')).statusCode, 403);
  });
});
