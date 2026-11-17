import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run, value } from '../src/lib/db.ts';
import { remindExpiring } from '../src/services/accounts.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
const DAY = 86_400_000;
const ids: Record<string, number> = {};

type Person = { id: number; username: string; role: string; name: string; expiresAt: number | null; expired: boolean };

const people = async () => (await emi.get('/api/admin/users')).json().items as Person[];
const person = async (username: string) => (await people()).find((entry) => entry.username === username);

async function tryLogin(username: string, password: string) {
  const client = new Client(app);
  await client.get('/login', { accept: 'text/html' });
  const response = await client.form('/login', { _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' });
  return response;
}

const dav = (username: string, token: string) =>
  app.inject({
    method: 'PROPFIND' as 'GET',
    url: '/dav/',
    headers: { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`, depth: '0' },
  });

before(async () => {
  emi = await setUp(app);
});

after(() => app.close());

describe('Ablaufdatum', () => {
  it('liest das Ablaufdatum aus der CSV', async () => {
    const csv = [
      'username;name;password;role;gültig bis',
      'emily;Emily;emilys-passwort-12;user;31.12.2099',
      'mia;Mia;mias-passwort-123;user;2099-02-30',
      'lea;Lea;leas-passwort-123;user;2020-01-01',
      'emi;Emi;sehr-sicheres-passwort;admin;2099-01-01',
    ].join('\n');
    const preview = await emi.json('POST', '/api/admin/users/import', { csv });
    assert.equal(preview.statusCode, 200, preview.body);
    const lines = preview.json().lines as { username: string; status: string; message: string | null; expiresAt: number | null }[];
    assert.deepEqual(
      lines.map((line) => [line.username, line.status, line.message]),
      [
        ['emily', 'ready', null],
        ['mia', 'error', 'Das Ablaufdatum ist kein Datum wie 2027-03-31'],
        ['lea', 'error', 'Das Ablaufdatum muss in der Zukunft liegen'],
        ['emi', 'error', 'Admins bekommen kein Ablaufdatum'],
      ]
    );
    assert.equal(lines[0].expiresAt, new Date(2099, 11, 31, 23, 59, 59).getTime());
    const done = await emi.json('POST', '/api/admin/users/import', { csv, apply: true });
    assert.equal(done.json().created, 1);
    const emily = await person('emily');
    assert.equal(emily?.expiresAt, new Date(2099, 11, 31, 23, 59, 59).getTime());
    ids.emily = emily!.id;
  });

  it('prüft das Ablaufdatum beim Anlegen und Ändern', async () => {
    const base = { username: 'lea', name: 'Lea', password: 'leas-passwort-123' };
    const past = await emi.json('POST', '/api/admin/users', { ...base, expiresAt: Date.now() - 1000 });
    assert.equal(past.statusCode, 400);
    assert.equal(past.json().error.message, 'Das Ablaufdatum muss in der Zukunft liegen');
    const admin = await emi.json('POST', '/api/admin/users', { ...base, role: 'admin', expiresAt: Date.now() + 30 * DAY });
    assert.equal(admin.statusCode, 400);
    assert.equal(admin.json().error.message, 'Admins bekommen kein Ablaufdatum');
    const until = Date.now() + 30 * DAY;
    const created = await emi.json('POST', '/api/admin/users', { ...base, expiresAt: until });
    assert.equal(created.statusCode, 200, created.body);
    ids.lea = created.json().user.id;
    assert.equal((await person('lea'))?.expiresAt, until);
    const promote = await emi.json('PATCH', `/api/admin/users/${ids.lea}`, { role: 'admin', name: 'Lea Admin' });
    assert.equal(promote.statusCode, 400);
    assert.equal(promote.json().error.message, 'Admins bekommen kein Ablaufdatum');
    const unchanged = await person('lea');
    assert.equal(unchanged?.role, 'user');
    assert.equal(unchanged?.name, 'Lea');
    const promoted = await emi.json('PATCH', `/api/admin/users/${ids.lea}`, { role: 'admin', expiresAt: null });
    assert.equal(promoted.statusCode, 200, promoted.body);
    assert.equal((await person('lea'))?.expiresAt, null);
    await emi.json('PATCH', `/api/admin/users/${ids.lea}`, { role: 'user' });
  });

  it('sperrt abgelaufene Konten überall aus', async () => {
    const created = await emi.json('POST', '/api/admin/users', {
      username: 'mia',
      name: 'Mia',
      password: 'mias-passwort-123',
      expiresAt: Date.now() + 30 * DAY,
    });
    ids.mia = created.json().user.id;
    const mia = await login(app, 'mia', 'mias-passwort-123');
    const token = (await mia.json('POST', '/api/account/app-passwords', { name: 'Laptop' })).json().token as string;
    assert.equal((await dav('mia', token)).statusCode, 207);
    const account = (await mia.get('/api/account')).json();
    assert.equal(account.expiresAt, created.json().user.expiresAt);
    run('UPDATE users SET expires_at = ? WHERE id = ?', Date.now() - 1000, ids.mia);
    assert.equal((await mia.get('/api/account')).statusCode, 401);
    assert.equal((await dav('mia', token)).statusCode, 401);
    const denied = await tryLogin('mia', 'mias-passwort-123');
    assert.equal(denied.statusCode, 401);
    assert.ok(denied.body.includes('Dein Konto ist abgelaufen, wende dich an die Verwaltung'));
    const listed = await person('mia');
    assert.equal(listed?.expired, true);
    assert.ok(Number(value('SELECT COUNT(*) FROM sessions WHERE user_id = ?', ids.mia)) > 0);
    assert.ok(remindExpiring().ended > 0);
    assert.equal(Number(value('SELECT COUNT(*) FROM sessions WHERE user_id = ?', ids.mia)), 0);
    const past = await emi.json('PATCH', `/api/admin/users/${ids.mia}`, { expiresAt: Date.now() - DAY });
    assert.equal(past.statusCode, 400);
    const extended = await emi.json('PATCH', `/api/admin/users/${ids.mia}`, { expiresAt: Date.now() + 60 * DAY });
    assert.equal(extended.statusCode, 200, extended.body);
    assert.equal((await tryLogin('mia', 'mias-passwort-123')).statusCode, 303);
    assert.equal((await dav('mia', token)).statusCode, 207);
  });

  it('erinnert eine Woche vorher genau einmal', async () => {
    const emily = await login(app, 'emily', 'emilys-passwort-12');
    const reminders = async () =>
      (await emily.get('/api/notifications')).json().items.filter((item: { kind: string }) => item.kind === 'account_expiring') as {
        title: string;
        text: string;
        url: string;
      }[];
    remindExpiring();
    assert.equal((await reminders()).length, 0);
    await emi.json('PATCH', `/api/admin/users/${ids.emily}`, { expiresAt: Date.now() + 3 * DAY });
    remindExpiring();
    remindExpiring();
    const notes = await reminders();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Dein Konto läuft bald ab');
    assert.match(notes[0].text, /^Ab .+ kannst du dich nicht mehr anmelden\./);
    assert.equal(notes[0].url, '/account');
    await emi.json('PATCH', `/api/admin/users/${ids.emily}`, { expiresAt: Date.now() + 5 * DAY });
    remindExpiring();
    assert.equal((await reminders()).length, 2);
  });
});

describe('Eigenes Konto löschen', () => {
  it('löscht das Konto nur mit Einstellung, Benutzername und Passwort', async () => {
    const lea = await login(app, 'lea', 'leas-passwort-123');
    assert.equal((await lea.get('/api/account')).json().selfDelete, false);
    const off = await lea.json('POST', '/api/account/delete', { confirm: 'lea', password: 'leas-passwort-123' });
    assert.equal(off.statusCode, 403);
    assert.equal(off.json().error.message, 'Das eigene Konto zu löschen ist hier ausgeschaltet');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'users.selfDelete': true })).statusCode, 200);
    assert.equal((await lea.get('/api/account')).json().selfDelete, true);
    assert.equal((await emi.get('/api/account')).json().selfDelete, false);
    const name = await lea.json('POST', '/api/account/delete', { confirm: 'mia', password: 'leas-passwort-123' });
    assert.equal(name.statusCode, 400);
    assert.equal(name.json().error.message, 'Gib zur Bestätigung deinen Benutzernamen ein');
    const password = await lea.json('POST', '/api/account/delete', { confirm: 'Lea', password: 'falsch' });
    assert.equal(password.statusCode, 400);
    assert.equal(password.json().error.message, 'Das Passwort stimmt nicht');
    const last = await emi.json('POST', '/api/account/delete', { confirm: 'emi', password: 'sehr-sicheres-passwort' });
    assert.equal(last.statusCode, 400);
    assert.equal(last.json().error.message, 'Es muss immer mindestens einen Admin geben');
    await emi.json('POST', '/api/notifications/read', {});
    const done = await lea.json('POST', '/api/account/delete', { confirm: 'Lea', password: 'leas-passwort-123' });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal((await lea.get('/api/account')).statusCode, 401);
    assert.equal(await person('lea'), undefined);
    assert.equal((await tryLogin('lea', 'leas-passwort-123')).statusCode, 401);
    const note = (await emi.get('/api/notifications')).json().items.find((item: { kind: string }) => item.kind === 'admin_left');
    assert.equal(note.title, 'Lea hat das eigene Konto gelöscht');
    assert.equal(note.text, 'Benutzername: lea');
    const log = (await emi.get('/api/admin/audit?action=account_deleted')).json();
    assert.ok(JSON.stringify(log).includes('"username":"lea"'));
    await emi.json('PATCH', '/api/admin/settings', { 'users.selfDelete': false });
  });
});
