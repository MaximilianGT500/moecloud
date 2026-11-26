import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { all, one } from '../src/lib/db.ts';
import { createPulse } from '../src/lib/moepulse.ts';
import { clearNoticeCache } from '../src/routes/pulse.ts';
import { pulse, pulseOptions, setPulse } from '../src/services/pulse.ts';
import * as settings from '../src/services/settings.ts';
import { checkForUpdates, updateStatus } from '../src/services/updates.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

delete process.env.MOEPULSE_DISABLED;
delete process.env.MOEPULSE_ENDPOINT;

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const release = (version: string, security = false) => ({
  version,
  title: null,
  date: Date.UTC(2026, 10, 30, 12),
  dateText: '30. November 2026',
  url: `https://moecloud.moestudio.net/changelog.html#v${version}`,
  security,
  channel: 'stable',
  notes:
    '### Neu\n\n- **Fotos** nach Orten sortieren\n- Schnellere [Suche](https://example.org)\n\n### Behoben\n\n- Ein Fehler beim Hochladen',
});

const fake = {
  calls: [] as Call[],
  offline: false,
  limited: false,
  latest: release('9.9.0', true) as ReturnType<typeof release> | null,
  tickets: [] as Record<string, unknown>[],
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const text = request.method === 'POST' ? await request.text() : '';
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  fake.calls.push({ method: request.method, path: url.pathname + url.search, body });
  if (fake.offline) throw new TypeError('fetch failed');
  if (url.pathname.startsWith('/v1/updates/')) {
    const latest = fake.latest;
    return json({
      ok: true,
      app: 'moecloud',
      version: url.searchParams.get('version'),
      channel: 'stable',
      latest,
      update: Boolean(latest),
      security: Boolean(latest?.security),
      yanked: false,
      behind: latest ? 1 : 0,
      releases: latest ? [latest] : [],
      checkedAt: Date.now(),
    });
  }
  if (url.pathname.startsWith('/v1/notices/')) {
    return json({
      ok: true,
      notices: [
        {
          id: 7,
          level: 'security',
          title: 'Bitte aktualisieren',
          body: 'Eine Lücke ist geschlossen',
          link: null,
          minVersion: null,
          maxVersion: null,
          createdAt: Date.now(),
        },
      ],
    });
  }
  if (url.pathname === '/v1/heartbeat')
    return json({ ok: true, interval: 21_600, errors: true, now: Date.now(), support: { unread: 2 }, notices: [] });
  if (url.pathname === '/v1/events') return json({ ok: true, accepted: (body?.events as unknown[]).length });
  if (url.pathname === '/v1/forget') return json({ ok: true });
  if (url.pathname.startsWith('/v1/tickets/')) {
    if (fake.limited) return json({ ok: false, error: 'limited', retry: 30 }, 429);
    const now = Date.now();
    if (url.pathname === '/v1/tickets/create') {
      const ticket = {
        id: `t${fake.tickets.length + 1}`,
        number: fake.tickets.length + 41,
        subject: body?.subject,
        category: body?.category,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        unread: false,
        last: { author: 'user', body: body?.message, createdAt: now },
        name: body?.name ?? null,
        email: body?.email ?? null,
        messages: [{ id: 1, author: 'user', body: body?.message, createdAt: now }],
      };
      fake.tickets.push(ticket);
      return json({ ok: true, ticket, support: { unread: 0 } });
    }
    if (url.pathname === '/v1/tickets/list') return json({ ok: true, tickets: fake.tickets, support: { unread: 1 } });
    const ticket = fake.tickets.find((entry) => entry.id === body?.id);
    if (!ticket) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, ticket, support: { unread: 0 } });
  }
  return json({ ok: false, error: 'not_found' }, 404);
}) as typeof globalThis.fetch;

const app = await createApp();
let emi: Client;
let mia: Client;

const support = (client: Client, payload: Record<string, unknown>) => client.json('POST', '/api/admin/moepulse/support', payload);
const sent = (path: string) => fake.calls.filter((call) => call.path.startsWith(path));

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
  settings.set('site.url', 'https://cloud.emi-und-lea.example');
});

beforeEach(async () => {
  await pulse().stop();
  setPulse(createPulse(pulseOptions({ endpoint: 'https://pulse.test', fetch: fetchFake, crashes: false })));
  clearNoticeCache();
  fake.calls = [];
  fake.offline = false;
  fake.limited = false;
  fake.latest = release('9.9.0', true);
  settings.set('pulse.stats', false);
  settings.set('pulse.errors', false);
  settings.set('updates.check', true);
});

after(async () => {
  await pulse().stop();
  await app.close();
});

describe('Nutzungsstatistik und Fehlerberichte', () => {
  it('ist ab Werk aus und schickt dann nichts', async () => {
    const state = await emi.get('/api/admin/pulse');
    assert.equal(state.statusCode, 200, state.body);
    const body = state.json();
    assert.deepEqual(body.value, { stats: false, errors: false });
    assert.equal(body.locked, false);
    assert.equal(body.texts.title, 'Nutzungsstatistik und Fehlerberichte');
    assert.equal(body.texts.stats.length, 5);
    pulse().capture(new Error('Nur ein Test'));
    pulse().count('upload');
    await pulse().flush(500);
    assert.equal(fake.calls.length, 0);
    assert.equal((await mia.get('/api/admin/pulse')).statusCode, 403);
    assert.equal((await mia.json('PUT', '/api/admin/pulse', { stats: true, errors: true })).statusCode, 403);
  });

  it('zeigt in der Vorschau, was gesendet würde, ohne Adressen', async () => {
    const preview = await emi.get('/api/admin/pulse/preview');
    assert.equal(preview.statusCode, 200, preview.body);
    const heartbeat = preview.json().heartbeat;
    assert.equal(heartbeat.app, 'moecloud');
    assert.equal(heartbeat.version, '1.9.0');
    assert.equal(heartbeat.features.database === 'sqlite' || heartbeat.features.database === 'postgres', true);
    assert.equal(heartbeat.metrics.users >= 2, true);
    assert.equal(typeof heartbeat.metrics.files, 'number');
    assert.ok(!preview.body.includes('emi-und-lea'), 'die eigene Adresse taucht nicht auf');
    assert.equal(fake.calls.length, 0, 'die Vorschau schickt nichts');
  });

  it('meldet sich nach dem Einschalten und schickt bereinigte Fehler', async () => {
    const changed = await emi.json('PUT', '/api/admin/pulse', { stats: true, errors: true });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual(changed.json().value, { stats: true, errors: true });
    assert.equal(settings.get('pulse.stats'), true);
    const beats = sent('/v1/heartbeat');
    assert.equal(beats.length, 1);
    assert.equal(beats[0].body?.app, 'moecloud');
    pulse().capture(new Error('Kaputt bei https://cloud.emi-und-lea.example/files/Lea.pdf'), { route: 'GET /api/test' });
    await pulse().flush(2000);
    const events = sent('/v1/events');
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events[0].body).includes('emi-und-lea'));
    const logged = one<{ details: string }>("SELECT details FROM audit WHERE action = 'pulse_changed' ORDER BY id DESC LIMIT 1")!;
    assert.deepEqual(JSON.parse(logged.details), { stats: true, errors: true });
    assert.equal((await emi.json('PUT', '/api/admin/pulse', { stats: 'ja', errors: true })).statusCode, 400);
  });

  it('löscht gesendete Daten und schaltet beides ab', async () => {
    await emi.json('PUT', '/api/admin/pulse', { stats: true, errors: false });
    const forgot = await emi.json('POST', '/api/admin/pulse/forget');
    assert.equal(forgot.statusCode, 200, forgot.body);
    assert.equal(forgot.json().ok, true);
    assert.equal(settings.get('pulse.stats'), false);
    assert.equal(sent('/v1/forget').length, 1);
    assert.ok(all("SELECT id FROM audit WHERE action = 'pulse_forgotten'").length >= 1);
  });

  it('nimmt Änderungen nur aus dem Browser an', async () => {
    const made = await emi.json('POST', '/api/account/app-passwords', { name: 'Skript' });
    assert.equal(made.statusCode, 200, made.body);
    const auth = `Basic ${Buffer.from(`emi:${made.json().token}`).toString('base64')}`;
    for (const [method, url] of [
      ['PUT', '/api/admin/pulse'],
      ['POST', '/api/admin/pulse/forget'],
      ['POST', '/api/admin/moepulse/support'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { authorization: auth, 'content-type': 'application/json' },
        payload: '{}',
      });
      assert.equal(response.statusCode, 403, `${method} ${url}`);
    }
  });
});

describe('Hilfe und Versionsprüfung', () => {
  it('reicht Tickets an MoeStudio durch und übersetzt Fehler', async () => {
    const created = await support(emi, {
      action: 'create',
      input: { subject: 'Upload bricht ab', message: 'Seit gestern bricht jeder große Upload ab.', category: 'bug', name: 'Emi' },
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().number, 41);
    assert.equal(created.json().subject, 'Upload bricht ab');
    const posted = sent('/v1/tickets/create')[0];
    assert.equal(posted.body?.category, 'bug');
    assert.equal(posted.body?.diagnostics, null);
    const list = await support(emi, { action: 'list' });
    assert.equal(list.json().tickets.length, 1);
    assert.equal(list.json().unread, 1);
    assert.equal((await support(emi, { action: 'get', id: 'gibt-es-nicht' })).statusCode, 404);
    assert.equal((await support(emi, { action: 'raten' })).statusCode, 400);
    fake.limited = true;
    const limited = await emi.send({
      method: 'POST',
      url: '/api/admin/moepulse/support',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'list' }),
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(JSON.parse(limited.body).error, 'limited');
    assert.equal(JSON.parse(limited.body).message, 'Gerade kommen zu viele Nachrichten an. Versuch es etwas später noch einmal.');
    assert.equal((await support(mia, { action: 'list' })).statusCode, 403);
    const logged = one<{ details: string }>("SELECT details FROM audit WHERE action = 'support_ticket' ORDER BY id DESC LIMIT 1")!;
    assert.deepEqual(JSON.parse(logged.details), { number: 41 });
  });

  it('holt Hinweise und lässt sie weg, wenn die Versionsprüfung aus ist', async () => {
    const notices = await support(emi, { action: 'notices' });
    assert.equal(notices.statusCode, 200, notices.body);
    assert.equal(notices.json().notices[0].title, 'Bitte aktualisieren');
    await support(emi, { action: 'notices' });
    assert.equal(sent('/v1/notices/').length, 1, 'Hinweise bleiben fünf Minuten zwischengespeichert');
    settings.set('updates.check', false);
    fake.calls = [];
    const quiet = await support(emi, { action: 'notices' });
    assert.deepEqual(quiet.json().notices, []);
    assert.equal(fake.calls.length, 0);
    const update = await support(emi, { action: 'update' });
    assert.equal(update.json().update, null);
  });

  it('fragt MoePulse nach Updates und fällt sonst auf die Website zurück', async () => {
    const previous = process.env.UPDATE_CHECK_URL;
    delete process.env.UPDATE_CHECK_URL;
    try {
      const status = await checkForUpdates(true);
      assert.equal(status.latest?.source, 'pulse');
      assert.equal(status.latest?.version, '9.9.0');
      assert.equal(status.available, true);
      assert.equal(status.latest?.security, true);
      assert.deepEqual(status.latest?.notes.de, ['Fotos nach Orten sortieren', 'Schnellere Suche', 'Ein Fehler beim Hochladen']);
      assert.equal(sent('/v1/updates/moecloud').length, 1);
      assert.match(sent('/v1/updates/moecloud')[0].path, /version=1\.9\.0/);
      const note = all<{ params: string }>("SELECT params FROM notifications WHERE kind = 'admin_update'").map((row) =>
        JSON.parse(row.params)
      );
      assert.ok(note.some((params) => params.version === '9.9.0' && params.security === 1));
      const relayed = await support(emi, { action: 'update', force: true });
      assert.equal(relayed.json().update.latest.version, '9.9.0');
      assert.equal((await emi.get('/api/admin/pulse')).json().updates, true);

      fake.latest = null;
      setPulse(createPulse(pulseOptions({ endpoint: 'https://pulse.test', fetch: fetchFake, crashes: false })));
      await assert.rejects(checkForUpdates(true));
      assert.equal(updateStatus().latest?.source, 'pulse');
    } finally {
      process.env.UPDATE_CHECK_URL = previous;
    }
    assert.equal((await emi.get('/api/admin/pulse')).json().updates, false, 'mit eigener Adresse bleibt die Hilfe bei der Website');
    assert.equal((await support(emi, { action: 'update' })).json().update, null);
    const feedOnly = await checkForUpdates(true).catch((error: Error) => error);
    assert.ok(feedOnly instanceof Error || feedOnly.latest?.source === 'feed');
    assert.equal(sent('/v1/updates/moecloud').length, 3, 'eine eigene Adresse für den Feed fragt MoePulse nicht');
  });
});
