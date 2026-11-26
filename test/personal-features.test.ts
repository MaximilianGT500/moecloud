import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as settings from '../src/services/settings.ts';
import { findByUsername, prefsOf } from '../src/services/users.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;

before(async () => {
  emi = await setUp(app);
});

after(() => app.close());

const boot = (page: string) =>
  JSON.parse(/<script[^>]*id="moe-boot"[^>]*>([^<]*)<\/script>/.exec(page)![1]) as { featuresOff: string[]; calendarOn: unknown };

describe('Funktionen pro Person', () => {
  it('blendet Funktionen pro Person aus, ohne die Schnittstelle zu sperren', async () => {
    const saved = await emi.json('PATCH', '/api/account/prefs', { features: ['music', 'calendar', 'polls'] });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().prefs.features, ['music', 'calendar', 'polls']);
    const page = await emi.get('/files', { accept: 'text/html' });
    assert.deepEqual(boot(page.body).featuresOff, ['music', 'calendar', 'polls']);
    assert.equal((await emi.get('/api/calendar/calendars')).statusCode, 200);
    assert.equal((await emi.json('PATCH', '/api/account/prefs', { features: ['gibt-es-nicht'] })).statusCode, 400);
    assert.equal((await emi.json('PATCH', '/api/account/prefs', { features: [] })).json().prefs.features.length, 0);
  });

  it('übernimmt die Vorgabe der Verwaltung für neue Konten', async () => {
    const changed = await emi.json('PATCH', '/api/admin/settings', { 'accounts.features': ['booking', 'polls', 'forms'] });
    assert.equal(changed.statusCode, 200, changed.body);
    const made = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
    assert.equal(made.statusCode, 200, made.body);
    assert.deepEqual(prefsOf(findByUsername('mia')!).features, ['booking', 'polls', 'forms']);
    const mia = await login(app, 'mia', 'mias-passwort-123');
    const page = await mia.get('/files', { accept: 'text/html' });
    assert.deepEqual(boot(page.body).featuresOff, ['booking', 'polls', 'forms']);
    assert.deepEqual(prefsOf(findByUsername('emi')!).features, [], 'bestehende Konten bleiben, wie sie sind');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'accounts.features': ['zaubern'] })).statusCode, 400);
    settings.set('accounts.features', []);
  });

  it('gibt Gästen keinen Kalender', async () => {
    const made = await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123', role: 'guest' });
    assert.equal(made.statusCode, 200, made.body);
    const lea = await login(app, 'lea', 'leas-passwort-123');
    assert.equal((await lea.get('/api/calendar/calendars')).statusCode, 403);
    assert.equal((await lea.get('/calendar', { accept: 'text/html' })).statusCode, 404);
    assert.equal(boot((await lea.get('/files', { accept: 'text/html' })).body).calendarOn, null);
  });

  it('schaltet den Kalender für alle ab, wenn die Verwaltung das will', async () => {
    settings.set('calendar.enabled', false);
    try {
      assert.equal((await emi.get('/api/calendar/calendars')).statusCode, 404);
      assert.equal((await emi.get('/calendar', { accept: 'text/html' })).statusCode, 404);
      assert.equal((await new Client(app).get('/b/irgendwas', { accept: 'text/html' })).statusCode, 404);
      assert.equal((await new Client(app).send({ method: 'PROPFIND', url: '/caldav/' })).statusCode, 404);
    } finally {
      settings.set('calendar.enabled', true);
    }
  });
});
