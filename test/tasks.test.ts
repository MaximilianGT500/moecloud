import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let miaId = 0;
let leaId = 0;
let emiId = 0;
let team = '';
let other = '';

type Task = { id: string; title: string; status: string | null; completed: number | null; assignee: { id: number; name: string } | null };

const tasks = async (client: Client) => (await client.get('/api/calendar/tasks?completed=1')).json().items as Task[];

const notes = async (client: Client) =>
  ((await client.get('/api/notifications')).json().items as { kind: string; title: string; text: string }[]).filter(
    (item) => item.kind === 'task_assigned'
  );

before(async () => {
  emi = await setUp(app);
  emiId = (await emi.get('/api/session')).json().user.id;
  const make = async (username: string, name: string) => {
    const made = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}-passwort-123` });
    return (made.json().user?.id ?? made.json().id) as number;
  };
  miaId = await make('mia', 'Mia Weber');
  leaId = await make('lea', 'Lea Sato');
  mia = await login(app, 'mia', 'mia-passwort-123');
  lea = await login(app, 'lea', 'lea-passwort-123');
  team = (await emi.json('POST', '/api/calendar/calendars', { name: 'Team', color: '#3b82f6' })).json().calendar.id;
  other = (await emi.json('POST', '/api/calendar/calendars', { name: 'Privat', color: '#ec4899' })).json().calendar.id;
  assert.equal((await emi.json('PUT', `/api/calendar/calendars/${team}/shares/${miaId}`, { permission: 'write' })).statusCode, 200);
  assert.equal((await emi.json('PUT', `/api/calendar/calendars/${team}/shares/${leaId}`, { permission: 'read' })).statusCode, 200);
});

test('Mitglieder mit Schreibrecht lassen sich zuweisen', async () => {
  const members = (await mia.get(`/api/calendar/calendars/${team}/members`)).json().members as { id: number; name: string }[];
  assert.deepEqual(
    members.map((member) => member.id),
    [emiId, miaId]
  );
  assert.equal((await lea.get(`/api/calendar/calendars/${other}/members`)).statusCode, 404);
  const blocked = await emi.json('POST', '/api/calendar/events', {
    calendarId: team,
    component: 'VTODO',
    title: 'Präsentation vorbereiten',
    assignee: leaId,
  });
  assert.equal(blocked.statusCode, 400);
  const created = await emi.json('POST', '/api/calendar/events', {
    calendarId: team,
    component: 'VTODO',
    title: 'Präsentation vorbereiten',
    allDay: true,
    due: '2026-12-04',
    assignee: miaId,
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id as string;
  const assigned = await notes(mia);
  assert.equal(assigned.length, 1);
  assert.match(assigned[0].title, /Emi hat dir die Aufgabe „Präsentation vorbereiten“ zugewiesen/);
  assert.match(assigned[0].text, /04\.12\.2026/);
  const seen = (await mia.get('/api/calendar/tasks')).json().items as Task[];
  assert.equal(seen.find((task) => task.id === id)?.assignee?.name, 'Mia Weber');
  const detail = (await lea.get(`/api/calendar/events/${id}`)).json();
  assert.equal(detail.data.assignee, miaId);

  const progress = await mia.json('PATCH', `/api/calendar/events/${id}`, {
    changes: { status: 'IN-PROCESS', completed: false },
    scope: 'all',
  });
  assert.equal(progress.statusCode, 200, progress.body);
  assert.equal((await tasks(emi)).find((task) => task.id === id)?.status, 'IN-PROCESS');
  assert.equal((await mia.json('POST', `/api/calendar/events/${id}/complete`, { completed: true, recurrenceId: null })).statusCode, 200);
  const done = (await tasks(emi)).find((task) => task.id === id)!;
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.completed);
  const back = await mia.json('PATCH', `/api/calendar/events/${id}`, {
    changes: { status: 'NEEDS-ACTION', completed: false },
    scope: 'all',
  });
  assert.equal(back.statusCode, 200);
  const open = (await tasks(emi)).find((task) => task.id === id)!;
  assert.equal(open.status, 'NEEDS-ACTION');
  assert.equal(open.completed, null);

  assert.equal((await mia.json('PATCH', `/api/calendar/events/${id}`, { changes: { assignee: emiId }, scope: 'all' })).statusCode, 200);
  assert.equal((await notes(emi)).length, 1);
  assert.equal(
    (await emi.json('PATCH', `/api/calendar/events/${id}`, { changes: { assignee: emiId, title: 'Präsentation halten' }, scope: 'all' }))
      .statusCode,
    200
  );
  assert.equal((await notes(emi)).length, 1);
  assert.equal((await emi.json('PATCH', `/api/calendar/events/${id}`, { changes: { assignee: leaId }, scope: 'all' })).statusCode, 400);
  assert.equal((await lea.json('PATCH', `/api/calendar/events/${id}`, { changes: { assignee: leaId }, scope: 'all' })).statusCode, 403);

  const exported = await emi.get(`/api/calendar/calendars/${team}/export.ics`);
  assert.match(exported.body, /Präsentation halten/);
  assert.doesNotMatch(exported.body, /X-MOE-ASSIGNEE/);

  assert.equal((await emi.json('PATCH', `/api/calendar/events/${id}`, { changes: { assignee: miaId }, scope: 'all' })).statusCode, 200);
  const moved = await emi.json('PATCH', `/api/calendar/events/${id}`, { changes: { calendarId: other }, scope: 'all' });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal((await tasks(emi)).find((task) => task.title === 'Präsentation halten')?.assignee, null);
});
