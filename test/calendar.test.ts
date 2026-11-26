import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, setUp, login, Client } from './helpers.ts';
import { fireAlarms } from '../src/calendar/alarms.ts';
import { outbox } from '../src/services/mail.ts';
import * as settings from '../src/services/settings.ts';

const basic = (username: string, token: string) => `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;

const app = await createApp();
const admin = await setUp(app);
settings.set('calendar.holidays', 'de-by');
after(() => app.close());

const DAY = 86_400_000;
let calendarId = '';
let mia: Client;

test('Nach der Einrichtung gibt es einen persönlichen Kalender', async () => {
  const response = await admin.get('/api/calendar/calendars');
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.calendars.length, 1);
  assert.equal(body.calendars[0].name, 'Persönlich');
  assert.equal(body.prefs.holidays[0], 'de-by');
  calendarId = body.calendars[0].id;
  const page = await admin.get('/calendar', { accept: 'text/html' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /moe-boot/);
});

test('Termine anlegen, ändern und als Serie bearbeiten', async () => {
  const start = Date.UTC(2026, 10, 2, 8, 0);
  const created = await admin.json('POST', '/api/calendar/events', {
    calendarId,
    title: 'Standup',
    start,
    end: start + 30 * 60_000,
    zone: 'Europe/Berlin',
    rrule: 'FREQ=DAILY;COUNT=10',
    categories: ['Arbeit'],
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const range = `from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 10, 30)}`;
  let list = (await admin.get(`/api/calendar/occurrences?${range}`))
    .json()
    .items.filter((item: { eventId: string }) => item.eventId === id);
  assert.equal(list.length, 10);
  const third = list[2];
  const moved = await admin.json('PATCH', `/api/calendar/events/${id}`, {
    scope: 'this',
    recurrenceId: third.recurrenceId,
    changes: { start: third.start + 2 * 3_600_000, end: third.end + 2 * 3_600_000, title: 'Standup spät' },
  });
  assert.equal(moved.statusCode, 200, moved.body);
  list = (await admin.get(`/api/calendar/occurrences?${range}`)).json().items.filter((item: { eventId: string }) => item.eventId === id);
  assert.equal(list.length, 10);
  assert.equal(list.find((item: { override: boolean }) => item.override).title, 'Standup spät');
  const removed = await admin.send({ method: 'DELETE', url: `/api/calendar/events/${id}?scope=this&rid=${list[4].recurrenceId}` });
  assert.equal(removed.statusCode, 200);
  list = (await admin.get(`/api/calendar/occurrences?${range}`)).json().items.filter((item: { eventId: string }) => item.eventId === id);
  assert.equal(list.length, 9);
  const split = await admin.json('PATCH', `/api/calendar/events/${id}`, {
    scope: 'following',
    recurrenceId: list[6].recurrenceId,
    changes: { title: 'Standup neu', start: list[6].start + 3_600_000, end: list[6].end + 3_600_000 },
  });
  assert.equal(split.statusCode, 200, split.body);
  const newId = split.json().created;
  assert.ok(newId);
  const all = (await admin.get(`/api/calendar/occurrences?${range}`)).json().items;
  const head = all.filter((item: { eventId: string }) => item.eventId === id);
  const tail = all.filter((item: { eventId: string }) => item.eventId === newId);
  assert.equal(head.length + tail.length, 9);
  assert.ok(tail.every((item: { title: string }) => item.title === 'Standup neu'));
  const detail = (await admin.get(`/api/calendar/events/${newId}`)).json();
  assert.match(detail.recurrence, /Täglich/);
  const search = (await admin.get('/api/calendar/search?q=standup')).json().items;
  assert.ok(search.length >= 2);
});

test('Ganztägige Termine, Aufgaben und Papierkorb', async () => {
  const created = await admin.json('POST', '/api/calendar/events', {
    calendarId,
    title: 'Urlaub',
    allDay: true,
    start: '2026-12-21',
    end: '2026-12-24',
  });
  assert.equal(created.statusCode, 200, created.body);
  const list = (await admin.get(`/api/calendar/occurrences?from=${Date.UTC(2026, 11, 20)}&to=${Date.UTC(2026, 11, 28)}`)).json().items;
  const holiday = list.find((item: { title: string }) => item.title === 'Urlaub');
  assert.equal(holiday.startDate, '2026-12-21');
  assert.equal(holiday.endDate, '2026-12-24');
  const task = await admin.json('POST', '/api/calendar/events', {
    calendarId,
    component: 'VTODO',
    title: 'Steuererklärung',
    allDay: true,
    due: '2026-12-01',
    priority: 1,
  });
  assert.equal(task.statusCode, 200, task.body);
  let tasks = (await admin.get('/api/calendar/tasks')).json().items;
  assert.equal(tasks.length, 1);
  await admin.json('POST', `/api/calendar/events/${task.json().id}/complete`, { completed: true });
  tasks = (await admin.get('/api/calendar/tasks')).json().items;
  assert.ok(tasks[0].completed);
  const trashed = await admin.send({ method: 'DELETE', url: `/api/calendar/events/${created.json().id}` });
  assert.equal(trashed.json().trashed, true);
  const trash = (await admin.get('/api/calendar/trash')).json();
  assert.equal(trash.events.length, 1);
  const restored = await admin.json('POST', `/api/calendar/events/${created.json().id}/restore`, {});
  assert.equal(restored.statusCode, 200);
});

test('Kalender teilen und einladen', async () => {
  const user = await admin.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(user.statusCode, 200, user.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
  const miaId = user.json().user.id;
  const share = await admin.json('PUT', `/api/calendar/calendars/${calendarId}/shares/${miaId}`, { permission: 'read' });
  assert.equal(share.statusCode, 200, share.body);
  const calendars = (await mia.get('/api/calendar/calendars')).json().calendars;
  assert.equal(calendars.length, 2);
  assert.equal(calendars.find((entry: { id: string }) => entry.id === calendarId).access, 'read');
  const start = Date.UTC(2026, 10, 25, 13, 0);
  const meeting = await admin.json('POST', '/api/calendar/events', {
    calendarId,
    title: 'Planung',
    start,
    end: start + 3_600_000,
    attendees: [{ email: 'mia@example.com' }, { email: 'lea@example.org', name: 'Lea' }],
  });
  assert.equal(meeting.statusCode, 200, meeting.body);
  const notifications = (await mia.get('/api/notifications')).json().items;
  assert.ok(notifications.some((entry: { kind: string }) => entry.kind === 'invitation'));
  const rsvp = await mia.json('POST', `/api/calendar/events/${meeting.json().id}/rsvp`, { status: 'ACCEPTED' });
  assert.equal(rsvp.statusCode, 200, rsvp.body);
  const detail = (await admin.get(`/api/calendar/events/${meeting.json().id}`)).json();
  assert.equal(detail.data.attendees.find((entry: { email: string }) => entry.email === 'mia@example.com').status, 'ACCEPTED');
  const forbidden = await mia.json('PATCH', `/api/calendar/events/${meeting.json().id}`, { changes: { title: 'Nope' } });
  assert.equal(forbidden.statusCode, 403);
});

test('Erinnerungen werden fällig', async () => {
  const start = Date.now() + 15 * 60_000;
  const created = await admin.json('POST', '/api/calendar/events', {
    calendarId,
    title: 'Gleich',
    start,
    end: start + 30 * 60_000,
    alarms: [{ offset: -10 * 60_000 }],
  });
  assert.equal(created.statusCode, 200);
  const fired = fireAlarms(Date.now() + 6 * 60_000);
  assert.ok(fired >= 1);
  const items = (await admin.get('/api/notifications')).json().items;
  assert.ok(items.some((entry: { kind: string; title: string }) => entry.kind === 'event_reminder' && entry.title.startsWith('Gleich')));
});

test('Import, Export und öffentliche Links', async () => {
  const ics =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:import-1\r\nDTSTART:20261201T100000Z\r\nDTEND:20261201T110000Z\r\nSUMMARY:Importiert\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const imported = await admin.json('POST', `/api/calendar/calendars/${calendarId}/import`, { text: ics });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.equal(imported.json().created, 1);
  const again = await admin.json('POST', `/api/calendar/calendars/${calendarId}/import`, { text: ics });
  assert.equal(again.json().skipped, 1);
  const exported = await admin.get(`/api/calendar/calendars/${calendarId}/export.ics`);
  assert.match(exported.body, /SUMMARY:Importiert/);
  const made = await admin.json('PUT', `/api/calendar/calendars/${calendarId}/public`, { mode: 'busy' });
  const token = made.json().token;
  const feed = await new Client(app).get(`/p/${token}.ics`);
  assert.equal(feed.statusCode, 200);
  assert.doesNotMatch(feed.body, /Importiert/);
  assert.match(feed.body, /Beschäftigt/);
  const page = await new Client(app).get(`/p/${token}`, { accept: 'text/html' });
  assert.equal(page.statusCode, 200);
  const holidays = await new Client(app).get('/holidays/de-by.ics');
  assert.match(holidays.body, /Fronleichnam/);
});

test('Buchungsseiten und Terminumfragen', async () => {
  const page = await admin.json('POST', '/api/calendar/booking-pages', {
    title: 'Sprechstunde',
    durations: [30],
    notice: 0,
    availability: {
      weekly: {
        '0': [[0, 1440]],
        '1': [[0, 1440]],
        '2': [[0, 1440]],
        '3': [[0, 1440]],
        '4': [[0, 1440]],
        '5': [[0, 1440]],
        '6': [[0, 1440]],
      },
      dates: {},
    },
  });
  assert.equal(page.statusCode, 200, page.body);
  const slug = page.json().page.slug;
  const guest = new Client(app);
  await guest.get(`/b/${slug}`, { accept: 'text/html' });
  const slotsResponse = await guest.get(`/api/calendar/public/book/${slug}/slots?duration=30&days=3`);
  assert.equal(slotsResponse.statusCode, 200, slotsResponse.body);
  const slots = slotsResponse.json();
  const first = slots.days.flatMap((day: { slots: number[] }) => day.slots)[2];
  assert.ok(first);
  const booked = await guest.json('POST', `/api/calendar/public/book/${slug}`, {
    start: first,
    duration: 30,
    name: 'Lea',
    email: 'lea@example.org',
  });
  assert.equal(booked.statusCode, 200, booked.body);
  const twice = await guest.json('POST', `/api/calendar/public/book/${slug}`, {
    start: first,
    duration: 30,
    name: 'Lea',
    email: 'lea@example.org',
  });
  assert.equal(twice.statusCode, 409);
  const cancelled = await guest.json('POST', `/api/calendar/public/booking/${booked.json().token}/cancel`, {});
  assert.equal(cancelled.json().booking.status, 'cancelled');

  const poll = await admin.json('POST', '/api/calendar/polls', {
    title: 'Teamessen',
    options: [
      { start: Date.UTC(2026, 11, 3, 18), end: Date.UTC(2026, 11, 3, 21) },
      { start: Date.UTC(2026, 11, 4, 18), end: Date.UTC(2026, 11, 4, 21) },
    ],
  });
  assert.equal(poll.statusCode, 200, poll.body);
  const { token, options } = poll.json().poll;
  await guest.get(`/u/${token}`, { accept: 'text/html' });
  const vote = await guest.json('POST', `/api/calendar/public/polls/${token}/votes`, {
    name: 'Lea',
    email: 'lea@example.org',
    answers: { [options[0].id]: 'yes', [options[1].id]: 'maybe' },
  });
  assert.equal(vote.statusCode, 200, vote.body);
  const final = await admin.json('POST', `/api/calendar/polls/${poll.json().poll.id}/finalize`, {
    option: options[0].id,
    calendarId,
    invite: true,
  });
  assert.equal(final.statusCode, 200, final.body);
  assert.ok(final.json().eventId);
});

test('CalDAV synchronisiert mit App-Passwort', async () => {
  const token = (await admin.json('POST', '/api/account/app-passwords', { name: 'Telefon' })).json().token as string;
  const dav = new Client(app);
  dav.basic = basic('emi', token);
  const root = await dav.send({
    method: 'PROPFIND',
    url: '/caldav/',
    headers: { depth: '0', 'content-type': 'application/xml' },
    payload: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
  });
  assert.equal(root.statusCode, 207);
  assert.match(root.body, /\/caldav\/principals\/emi\//);
  const home = await dav.send({
    method: 'PROPFIND',
    url: '/caldav/calendars/emi/',
    headers: { depth: '1', 'content-type': 'application/xml' },
    payload:
      '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><cs:getctag/><d:sync-token/></d:prop></d:propfind>',
  });
  assert.equal(home.statusCode, 207);
  assert.match(home.body, /Persönlich/);
  const slug = /\/caldav\/calendars\/emi\/([^/<]+)\//.exec(home.body.replace('/caldav/calendars/emi/<', ''))?.[1] ?? calendarId;
  const initial = await dav.send({
    method: 'REPORT',
    url: `/caldav/calendars/emi/${slug}/`,
    headers: { 'content-type': 'application/xml' },
    payload:
      '<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>',
  });
  assert.equal(initial.statusCode, 207, initial.body);
  const syncToken = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(initial.body)?.[1];
  assert.ok(syncToken);
  const put = await dav.send({
    method: 'PUT',
    url: `/caldav/calendars/emi/${slug}/phone-1.ics`,
    headers: { 'content-type': 'text/calendar', 'if-none-match': '*' },
    payload:
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:phone-1\r\nDTSTART;TZID=Europe/Berlin:20261210T090000\r\nDTEND;TZID=Europe/Berlin:20261210T100000\r\nSUMMARY:Vom Telefon\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  });
  assert.equal(put.statusCode, 201, put.body);
  assert.ok(put.headers.etag);
  const changes = await dav.send({
    method: 'REPORT',
    url: `/caldav/calendars/emi/${slug}/`,
    headers: { 'content-type': 'application/xml' },
    payload: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${syncToken}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
  });
  assert.match(changes.body, /phone-1\.ics/);
  const query = await dav.send({
    method: 'REPORT',
    url: `/caldav/calendars/emi/${slug}/`,
    headers: { 'content-type': 'application/xml', depth: '1' },
    payload:
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="20261209T000000Z" end="20261211T000000Z"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>',
  });
  assert.match(query.body, /Vom Telefon/);
  const web = (await admin.get(`/api/calendar/occurrences?from=${Date.UTC(2026, 11, 10)}&to=${Date.UTC(2026, 11, 11)}`)).json().items;
  assert.ok(web.some((item: { title: string }) => item.title === 'Vom Telefon'));
  const conflict = await dav.send({
    method: 'PUT',
    url: `/caldav/calendars/emi/${slug}/phone-1.ics`,
    headers: { 'content-type': 'text/calendar', 'if-match': '"falsch"' },
    payload: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  });
  assert.equal(conflict.statusCode, 412);
  const removed = await dav.send({ method: 'DELETE', url: `/caldav/calendars/emi/${slug}/phone-1.ics` });
  assert.equal(removed.statusCode, 204);
  const wrong = new Client(app);
  wrong.basic = basic('emi', 'falsch');
  assert.equal((await wrong.send({ method: 'PROPFIND', url: '/caldav/' })).statusCode, 401);
  const made = await dav.send({
    method: 'MKCALENDAR',
    url: '/caldav/calendars/emi/arbeit/',
    headers: { 'content-type': 'application/xml' },
    payload:
      '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>Arbeit</d:displayname></d:prop></d:set></c:mkcalendar>',
  });
  assert.equal(made.statusCode, 201);
  assert.ok((await admin.get('/api/calendar/calendars')).json().calendars.some((entry: { name: string }) => entry.name === 'Arbeit'));
});

test('Einstellungen, Statistik und Frei/Belegt', async () => {
  const prefs = await admin.json('PATCH', '/api/calendar/prefs', { weekStart: 0, slot: 15, holidays: ['de-be', 'xx'] });
  assert.equal(prefs.statusCode, 200);
  assert.deepEqual(prefs.json().prefs.holidays, ['de-be']);
  const stats = await admin.get(`/api/calendar/stats?from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 11, 1)}`);
  assert.equal(stats.statusCode, 200);
  assert.ok(stats.json().total.minutes > 0);
  const miaId = (await mia.get('/api/session')).json().user.id;
  const busy = (
    await admin.get(`/api/calendar/freebusy?users=${miaId}&from=${Date.UTC(2026, 10, 25)}&to=${Date.UTC(2026, 10, 26)}`)
  ).json();
  assert.equal(busy.people[0].visible, true);
  assert.ok(busy.people[0].busy.length >= 1);
  settings.set('mail.enabled', true);
  settings.set('mail.host', 'localhost');
  settings.set('mail.from', 'kalender@example.com');
  const start = Date.UTC(2026, 11, 15, 9);
  await admin.json('POST', '/api/calendar/events', {
    calendarId,
    title: 'Extern',
    start,
    end: start + DAY / 24,
    attendees: [{ email: 'gast@example.net' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(outbox.some((mail) => mail.to === 'gast@example.net' && mail.ical?.method === 'REQUEST'));
});
