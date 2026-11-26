import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let calendarId = '';
let eventId = '';
let miaId = 0;

const basic = (username: string, token: string) => `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'mias-passwort-123',
  });
  miaId = made.json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  calendarId = (await emi.get('/api/calendar/calendars')).json().calendars[0].id;
  const start = Date.UTC(2026, 11, 2, 8);
  eventId = (
    await emi.json('POST', '/api/calendar/events', {
      calendarId,
      title: 'Geheimes Treffen',
      location: 'Hinterzimmer',
      start,
      end: start + 3_600_000,
    })
  ).json().id;
});

after(() => app.close());

describe('Kalender gegen fremden Zugriff', () => {
  it('lässt fremde Kalender und Termine nicht lesen oder ändern', async () => {
    assert.equal((await mia.get(`/api/calendar/events/${eventId}`)).statusCode, 404);
    assert.equal((await mia.json('PATCH', `/api/calendar/events/${eventId}`, { changes: { title: 'Gekapert' } })).statusCode, 404);
    assert.equal((await mia.send({ method: 'DELETE', url: `/api/calendar/events/${eventId}` })).statusCode, 404);
    assert.equal((await mia.json('PATCH', `/api/calendar/calendars/${calendarId}`, { name: 'Meins' })).statusCode, 404);
    assert.equal((await mia.get(`/api/calendar/calendars/${calendarId}/export.ics`)).statusCode, 404);
    assert.equal((await mia.json('PUT', `/api/calendar/calendars/${calendarId}/shares/${miaId}`, { permission: 'write' })).statusCode, 404);
    const range = `from=${Date.UTC(2026, 11, 1)}&to=${Date.UTC(2026, 11, 31)}`;
    const items = (await mia.get(`/api/calendar/occurrences?${range}`)).json().items as { title: string }[];
    assert.ok(!items.some((item) => item.title === 'Geheimes Treffen'));
    const search = (await mia.get('/api/calendar/search?q=geheim')).json().items as unknown[];
    assert.equal(search.length, 0);
  });

  it('zeigt bei frei/beschäftigt keine Details', async () => {
    const shared = await emi.json('PUT', `/api/calendar/calendars/${calendarId}/shares/${miaId}`, { permission: 'freebusy' });
    assert.equal(shared.statusCode, 200, shared.body);
    const range = `from=${Date.UTC(2026, 11, 1)}&to=${Date.UTC(2026, 11, 31)}`;
    const body = (await mia.get(`/api/calendar/occurrences?${range}`)).body;
    assert.doesNotMatch(body, /Geheimes Treffen|Hinterzimmer/);
    const detail = await mia.get(`/api/calendar/events/${eventId}`);
    assert.equal(detail.json().busyOnly, true);
    assert.doesNotMatch(detail.body, /Geheimes Treffen|Hinterzimmer/);
    await emi.send({ method: 'DELETE', url: `/api/calendar/calendars/${calendarId}/shares/${miaId}` });
  });

  it('trennt CalDAV nach Konten und achtet auf schreibgeschützte App-Passwörter', async () => {
    const token = (await mia.json('POST', '/api/account/app-passwords', { name: 'Telefon' })).json().token as string;
    const dav = new Client(app);
    dav.basic = basic('mia', token);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/caldav/calendars/emi/', headers: { depth: '1' } })).statusCode, 403);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/caldav/principals/emi/', headers: { depth: '0' } })).statusCode, 403);
    const foreign = await dav.send({ method: 'PROPFIND', url: `/caldav/calendars/mia/s-${calendarId}/`, headers: { depth: '1' } });
    assert.equal(foreign.statusCode, 404);
    assert.doesNotMatch(foreign.body, /Geheimes Treffen/);
    const object = await dav.send({ method: 'GET', url: `/caldav/calendars/mia/s-${calendarId}/${eventId}.ics` });
    assert.doesNotMatch(object.body, /Geheimes Treffen/);
    const readOnly = (await emi.json('POST', '/api/account/app-passwords', { name: 'Lesen', readOnly: true })).json();
    assert.ok(readOnly.token);
    {
      const reader = new Client(app);
      reader.basic = basic('emi', readOnly.token);
      const put = await reader.send({
        method: 'PUT',
        url: `/caldav/calendars/emi/${calendarId}/neu.ics`,
        headers: { 'content-type': 'text/calendar' },
        payload:
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:neu\r\nDTSTART:20261201T100000Z\r\nSUMMARY:Neu\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      });
      assert.equal(put.statusCode, 403);
    }
    const anonymous = await new Client(app).send({ method: 'PROPFIND', url: '/caldav/' });
    assert.equal(anonymous.statusCode, 401);
  });

  it('gibt öffentliche Kalender nur mit gültigem Link und nur so weit frei, wie eingestellt', async () => {
    const visitor = new Client(app);
    assert.equal((await visitor.get('/p/falsch')).statusCode, 404);
    const made = await emi.json('PUT', `/api/calendar/calendars/${calendarId}/public`, { mode: 'busy' });
    const token = made.json().token as string;
    const range = `from=${Date.UTC(2026, 11, 1)}&to=${Date.UTC(2026, 11, 31)}`;
    const items = await visitor.get(`/api/calendar/public/calendars/${token}/occurrences?${range}`);
    assert.equal(items.statusCode, 200);
    assert.doesNotMatch(items.body, /Geheimes Treffen|Hinterzimmer/);
    const feed = await visitor.get(`/p/${token}.ics`);
    assert.doesNotMatch(feed.body, /Geheimes Treffen|Hinterzimmer/);
    await emi.json('PUT', `/api/calendar/calendars/${calendarId}/public`, { mode: null });
    assert.equal((await visitor.get(`/p/${token}.ics`)).statusCode, 404);
  });

  it('nimmt keine Skripte in öffentliche Seiten auf', async () => {
    const page = await emi.json('POST', '/api/calendar/booking-pages', {
      title: '<script>alert(1)</script>Sprechstunde',
      description: '<img src=x onerror=alert(1)>',
      durations: [30],
    });
    assert.equal(page.statusCode, 200, page.body);
    const html = (await new Client(app).get(`/b/${page.json().page.slug}`, { accept: 'text/html' })).body;
    assert.doesNotMatch(html, /<script>alert|<img src=x/);
  });
});
