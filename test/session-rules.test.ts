import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { Client, createApp, setUp } from './helpers.ts';
import { all, one, run } from '../src/lib/db.ts';
import { listSessions, purgeExpiredSessions } from '../src/services/sessions.ts';

const app = await createApp();
let emi: Client;
let address = 0;

const DAY = 86_400_000;
const PASSWORD = 'sehr-sicheres-passwort';

interface Row {
  id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

const cookieOf = (response: LightMyRequestResponse) =>
  (response.cookies as { name: string; value: string; maxAge?: number }[]).find((cookie) => cookie.name === 'moe_session');

async function signIn() {
  const remoteAddress = `127.0.7.${(address++ % 250) + 1}`;
  const client = new Client(app);
  await client.send({ method: 'GET', url: '/login', headers: { accept: 'text/html' }, remoteAddress });
  const response = await client.send({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ _csrf: client.cookies.get('moe_csrf')!, login: 'emi', password: PASSWORD, next: '/files' }).toString(),
  });
  assert.equal(response.statusCode, 303, response.body);
  const session = one<Row>('SELECT id, created_at, last_seen_at, expires_at FROM sessions ORDER BY created_at DESC, id DESC LIMIT 1')!;
  return { client, response, session };
}

const rules = async (idle: number, limit: number) => {
  const saved = await emi.json('PATCH', '/api/admin/settings', { 'auth.sessionDays': idle, 'auth.sessionMaxDays': limit });
  assert.equal(saved.statusCode, 200, saved.body);
};

const near = (value: number, expected: number, slack = 60_000) => Math.abs(Number(value) - expected) < slack;

before(async () => {
  emi = await setUp(app);
});

after(async () => {
  await app.close();
});

describe('Regeln für Sitzungen', () => {
  it('bleibt ohne Änderung bei 30 Tagen', async () => {
    const settings = (await emi.get('/api/admin/settings')).json().settings;
    assert.equal(settings['auth.sessionDays'], 30);
    assert.equal(settings['auth.sessionMaxDays'], 30);
    const { response, session } = await signIn();
    assert.ok(near((cookieOf(response)?.maxAge ?? 0) * 1000, 30 * DAY));
    assert.ok(near(session.expires_at, Date.now() + 30 * DAY));
  });

  it('meldet ab, wer länger als eingestellt nicht da war', async () => {
    await rules(2, 0);
    const { client, response, session } = await signIn();
    assert.ok(near((cookieOf(response)?.maxAge ?? 0) * 1000, 400 * DAY), String(cookieOf(response)?.maxAge));
    assert.ok(near(session.expires_at, Date.now() + 2 * DAY));
    assert.equal((await client.get('/api/session')).statusCode, 200);
    run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now() - 2 * DAY - 60_000, session.id);
    assert.equal((await client.get('/api/session')).statusCode, 401);
    assert.equal(one('SELECT 1 AS found FROM sessions WHERE id = ?', session.id), undefined);
  });

  it('verlängert bei Nutzung und erneuert dabei das Cookie', async () => {
    await rules(2, 0);
    const { client, session } = await signIn();
    const quiet = await client.get('/api/session');
    assert.equal(cookieOf(quiet), undefined);
    const before = Date.now() - DAY;
    run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', before, before + 2 * DAY, session.id);
    const used = await client.get('/api/session');
    assert.equal(used.statusCode, 200);
    assert.ok(near((cookieOf(used)?.maxAge ?? 0) * 1000, 400 * DAY));
    const row = one<Row>('SELECT id, created_at, last_seen_at, expires_at FROM sessions WHERE id = ?', session.id)!;
    assert.ok(near(row.last_seen_at, Date.now()));
    assert.ok(near(row.expires_at, Date.now() + 2 * DAY));
  });

  it('verlangt spätestens nach der Höchstdauer eine neue Anmeldung, auch bei täglicher Nutzung', async () => {
    await rules(30, 7);
    const { client, response, session } = await signIn();
    assert.ok(near((cookieOf(response)?.maxAge ?? 0) * 1000, 7 * DAY));
    assert.ok(near(session.expires_at, Date.now() + 7 * DAY), 'die kürzere Frist gilt');
    run('UPDATE sessions SET created_at = ?, last_seen_at = ? WHERE id = ?', Date.now() - 5 * DAY, Date.now() - 6 * 60_000, session.id);
    const used = await client.get('/api/session');
    assert.equal(used.statusCode, 200);
    assert.ok(near((cookieOf(used)?.maxAge ?? 0) * 1000, 2 * DAY), String(cookieOf(used)?.maxAge));
    run('UPDATE sessions SET created_at = ?, last_seen_at = ? WHERE id = ?', Date.now() - 7 * DAY - 60_000, Date.now(), session.id);
    assert.equal((await client.get('/api/session')).statusCode, 401);
  });

  it('wendet kürzere Regeln sofort auf laufende Sitzungen an', async () => {
    await rules(30, 0);
    const { client, session } = await signIn();
    const me = one<{ user_id: number }>('SELECT user_id FROM sessions WHERE id = ?', session.id)!.user_id;
    run('UPDATE sessions SET last_seen_at = ?, created_at = ? WHERE id = ?', Date.now() - 3 * DAY, Date.now() - 20 * DAY, session.id);
    assert.ok(listSessions(me).some((entry) => entry.id === session.id));
    await rules(2, 0);
    assert.ok(!listSessions(me).some((entry) => entry.id === session.id));
    const account = await emi.get('/api/account');
    assert.ok(!(account.json().security.sessions as { id: string }[]).some((entry) => entry.id === session.id));
    assert.equal((await client.get('/api/session')).statusCode, 401);
  });

  it('räumt abgelaufene Sitzungen beim Aufräumen weg', async () => {
    await rules(3, 10);
    const idle = await signIn();
    const old = await signIn();
    const fresh = await signIn();
    run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now() - 4 * DAY, idle.session.id);
    run('UPDATE sessions SET created_at = ? WHERE id = ?', Date.now() - 11 * DAY, old.session.id);
    const removed = purgeExpiredSessions().changes;
    assert.ok(removed >= 2, String(removed));
    const left = all<{ id: string }>('SELECT id FROM sessions').map((row) => row.id);
    assert.ok(!left.includes(idle.session.id) && !left.includes(old.session.id));
    assert.ok(left.includes(fresh.session.id));
  });

  it('nimmt nur sinnvolle Werte an', async () => {
    for (const body of [
      { 'auth.sessionDays': 0 },
      { 'auth.sessionDays': 366 },
      { 'auth.sessionDays': 1.5 },
      { 'auth.sessionMaxDays': -1 },
      { 'auth.sessionMaxDays': 366 },
    ]) {
      const refused = await emi.json('PATCH', '/api/admin/settings', body);
      assert.equal(refused.statusCode, 400, JSON.stringify(body));
    }
    await rules(30, 30);
    assert.equal((await emi.get('/api/session')).statusCode, 200);
  });
});
