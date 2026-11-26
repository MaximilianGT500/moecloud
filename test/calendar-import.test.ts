import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import yazl from 'yazl';
import { calendarImportsSettled } from '../src/calendar/importer.ts';
import { colorOf, fromCsv, fromFile, parseDateText } from '../src/calendar/sources.ts';
import { registrable } from '../src/calendar/davclient.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let base = '';
let feed: Server;
let feedUrl = '';
let miaToken = '';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 26//EN',
  'X-WR-CALNAME:Familie Sato',
  'X-APPLE-CALENDAR-COLOR:#FF2968FF',
  'X-WR-TIMEZONE:Europe/Berlin',
  'BEGIN:VEVENT',
  'UID:sommerfest-2026@example.com',
  'DTSTAMP:20261101T100000Z',
  'DTSTART;TZID=Europe/Berlin:20261212T180000',
  'DTEND;TZID=Europe/Berlin:20261212T220000',
  'SUMMARY:Weihnachtsfeier bei Lea',
  'LOCATION:Bei Lea\\, Gartenstraße 4',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:geburtstag-mia@example.com',
  'DTSTAMP:20261101T100000Z',
  'DTSTART;VALUE=DATE:20260314',
  'DTEND;VALUE=DATE:20260315',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Geburtstag Mia',
  'END:VEVENT',
  'BEGIN:VTODO',
  'UID:geschenk@example.com',
  'DTSTAMP:20261101T100000Z',
  'DUE;VALUE=DATE:20261210',
  'SUMMARY:Geschenk für Emily besorgen',
  'END:VTODO',
  'END:VCALENDAR',
  '',
].join('\r\n');

const GOOGLE_CSV = [
  'Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private',
  'Zahnarzt,12/03/2026,9:30 AM,12/03/2026,10:15 AM,False,"Kontrolle, danach Kaffee",Praxis Mia,True',
  'Urlaub mit Lea,12/24/2026,,12/27/2026,,True,,,False',
].join('\r\n');

const OUTLOOK_CSV = [
  '"Betreff","Beginnt am","Beginnt um","Endet am","Endet um","Ganztägiges Ereignis","Beschreibung","Ort","Kategorien"',
  '"Teamrunde","01.12.2026","10:00:00","01.12.2026","11:00:00","Aus","Agenda folgt","Raum 2","Arbeit;Wichtig"',
  '"Betriebsausflug","05.12.2026","00:00:00","06.12.2026","00:00:00","Ein","","",""',
].join('\r\n');

type Job = {
  id: string;
  status: string;
  error: string | null;
  warnings: string[];
  calendars: { key: string; name: string; color: string | null; events: number; tasks: number }[];
  results: { name: string; calendarId: string; created: number; updated: number; skipped: number; createdCalendar: boolean }[] | null;
};

type Part = { name: string; filename: string; content: Buffer | string };

async function upload(client: Client, files: Part[]) {
  const boundary = `----moe${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      Buffer.from(file.content),
      Buffer.from('\r\n')
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return client.send({
    method: 'POST',
    url: '/api/calendar/import',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  });
}

async function settled(client: Client, id: string) {
  await calendarImportsSettled();
  return (await client.get(`/api/calendar/import/${id}`)).json().job as Job;
}

function zip(entries: [string, string | Buffer][]) {
  return new Promise<Buffer>((resolve) => {
    const archive = new yazl.ZipFile();
    for (const [name, content] of entries) archive.addBuffer(Buffer.from(content), name);
    archive.end();
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const occurrences = async (client: Client, from: number, to: number) =>
  (await client.get(`/api/calendar/occurrences?from=${from}&to=${to}&tasks=1`)).json().items as { title: string; calendarId: string }[];

before(async () => {
  emi = await setUp(app);
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  feed = createServer((request, response) => {
    if (request.url === '/familie.ics') {
      response.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
      response.end(ICS);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => feed.listen(0, '127.0.0.1', () => resolve()));
  feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/familie.ics`;
  const arbeit = (await mia.json('POST', '/api/calendar/calendars', { name: 'Arbeit von Mia', color: '#14b8a6' })).json();
  const calendarId = arbeit.calendar?.id ?? arbeit.id;
  const start = Date.UTC(2026, 11, 2, 9, 0);
  for (const [index, title] of ['Projektstart', 'Abstimmung mit Lea', 'Rückblick'].entries()) {
    const made = await mia.json('POST', '/api/calendar/events', {
      calendarId,
      component: 'VEVENT',
      title,
      start: start + index * 86_400_000,
      end: start + index * 86_400_000 + 3_600_000,
      allDay: false,
    });
    assert.equal(made.statusCode, 200, made.body);
  }
  await mia.json('POST', '/api/calendar/events', { calendarId, component: 'VTODO', title: 'Bericht schreiben', due: start });
  miaToken = (await mia.json('POST', '/api/account/app-passwords', { name: 'Umzug' })).json().token as string;
});

after(async () => {
  await new Promise<void>((resolve) => feed.close(() => resolve()));
  await app.close();
});

describe('Kalender aus anderen Diensten lesen', () => {
  it('versteht Datumsangaben und Farben', () => {
    assert.deepEqual(parseDateText('03.12.26', 'mdy'), { year: 2026, month: 12, day: 3, minutes: null });
    assert.deepEqual(parseDateText('12/03/2026', 'mdy'), { year: 2026, month: 12, day: 3, minutes: null });
    assert.deepEqual(parseDateText('03/12/2026 14:30', 'dmy'), { year: 2026, month: 12, day: 3, minutes: 870 });
    assert.deepEqual(parseDateText('2026-12-03T07:05:00Z', 'dmy'), { year: 2026, month: 12, day: 3, minutes: 425 });
    assert.equal(parseDateText('31.02.2026', 'dmy'), null);
    assert.equal(colorOf('#FF2968FF'), '#ff2968');
    assert.equal(colorOf('turquoise'), '#06b6d4');
    assert.equal(colorOf('nicht'), null);
    assert.equal(registrable('p63-caldav.icloud.com'), 'icloud.com');
    assert.equal(registrable('dav.example.co.uk'), 'example.co.uk');
    assert.equal(registrable('192.168.1.20'), '192.168.1.20');
  });

  it('liest CSV aus Google, Outlook und MoeCloud', () => {
    const [google] = fromCsv(GOOGLE_CSV, 'google.csv', 'Europe/Berlin', 'g');
    assert.equal(google.events, 2);
    assert.match(google.text, /DTSTART:20261203T083000Z/);
    assert.match(google.text, /DTEND:20261203T091500Z/);
    assert.match(google.text, /DTSTART;VALUE=DATE:20261224/);
    assert.match(google.text, /DTEND;VALUE=DATE:20261228/);
    assert.match(google.text, /CLASS:PRIVATE/);
    const [outlook] = fromCsv(OUTLOOK_CSV, 'outlook.csv', 'Europe/Berlin', 'o');
    assert.equal(outlook.events, 2);
    assert.match(outlook.text, /DTSTART:20261201T090000Z/);
    assert.match(outlook.text, /CATEGORIES:Arbeit,Wichtig/);
    assert.match(outlook.text, /DTSTART;VALUE=DATE:20261205\r?\n(?:.*\r?\n)*?DTEND;VALUE=DATE:20261206/);
    const own = fromCsv(
      [
        'Titel;Beginn Datum;Beginn Uhrzeit;Ende Datum;Ende Uhrzeit;Ganztägig;Ort;Kalender;Notizen',
        'Yoga;03.12.26;18:30;03.12.26;19:30;nein;Studio;Sport;',
        'Ausflug;06.12.26;;06.12.26;;ja;;Familie;Mit Lea',
      ].join('\r\n'),
      'moecloud.csv',
      'Europe/Berlin',
      'm'
    );
    assert.deepEqual(
      own.map((source) => [source.name, source.events]),
      [
        ['Sport', 1],
        ['Familie', 1],
      ]
    );
    assert.throws(() => fromCsv('Name;Telefon\nLea;123', 'kontakte.csv', 'Europe/Berlin', 'k'), /Spalten für Titel und Beginn/);
  });

  it('liest ICS, ZIP aus Google Takeout und Dateien in Windows-Zeichensatz', async () => {
    const [ics] = await fromFile('familie.ics', Buffer.from(ICS), 'Europe/Berlin', 'a');
    assert.deepEqual([ics.name, ics.color, ics.zone, ics.events, ics.tasks], ['Familie Sato', '#ff2968', 'Europe/Berlin', 2, 1]);
    const archive = await zip([
      ['Takeout/Kalender/Emi Sato.ics', ICS.replace('X-WR-CALNAME:Familie Sato', 'X-WR-CALNAME:Emi Sato')],
      ['Takeout/Kalender/Feiertage.ics', ICS.replace('X-WR-CALNAME:Familie Sato\r\n', '')],
      ['Takeout/Kalender/info.json', '{}'],
      ['__MACOSX/._Emi Sato.ics', 'x'],
    ]);
    const sources = await fromFile('takeout-20261126.zip', archive, 'Europe/Berlin', 'z');
    assert.deepEqual(
      sources.map((source) => source.name),
      ['Emi Sato', 'Feiertage']
    );
    const latin = Buffer.from(`${OUTLOOK_CSV.replace('Teamrunde', 'Übergabe')}`, 'latin1');
    const [decoded] = await fromFile('export.csv', latin, 'Europe/Berlin', 'w');
    assert.match(decoded.text, /SUMMARY:Übergabe/);
    await assert.rejects(fromFile('bild.png', Buffer.from('nicht'), 'Europe/Berlin', 'p'), /weder eine ICS-, CSV- noch ZIP-Datei/);
  });
});

describe('Kalender importieren', () => {
  it('zeigt mehrere Dateien vorher an und legt neue Kalender an', async () => {
    const response = await upload(emi, [
      { name: 'files', filename: 'familie.ics', content: ICS },
      { name: 'files', filename: 'google.csv', content: GOOGLE_CSV },
      { name: 'files', filename: 'kaputt.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' },
    ]);
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json().job as Job;
    assert.equal(job.status, 'ready');
    assert.deepEqual(
      job.calendars.map((entry) => [entry.name, entry.events, entry.tasks]),
      [
        ['Familie Sato', 2, 1],
        ['google', 2, 0],
      ]
    );
    assert.equal(job.warnings.length, 1);
    const existing = (await emi.get('/api/calendar/calendars')).json().calendars as { id: string; name: string }[];
    const run = await emi.json('POST', `/api/calendar/import/${job.id}/run`, {
      calendars: [
        { key: job.calendars[0].key, target: 'new', name: 'Familie', color: '#ec4899' },
        { key: job.calendars[1].key, target: existing[0].id },
      ],
      mode: 'merge',
    });
    assert.equal(run.statusCode, 200, run.body);
    const done = run.json().job as Job;
    assert.equal(done.status, 'done');
    assert.deepEqual(
      done.results!.map((result) => [result.name, result.created, result.createdCalendar]),
      [
        ['Familie', 3, true],
        [existing[0].name, 2, false],
      ]
    );
    const calendars = (await emi.get('/api/calendar/calendars')).json().calendars as { id: string; name: string; color: string }[];
    const family = calendars.find((entry) => entry.name === 'Familie');
    assert.equal(family?.color, '#ec4899');
    const titles = (await occurrences(emi, Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 31))).map((item) => item.title);
    assert.ok(titles.includes('Weihnachtsfeier bei Lea'));
    assert.ok(titles.includes('Zahnarzt'));

    const again = (await upload(emi, [{ name: 'files', filename: 'familie.ics', content: ICS }])).json().job as Job;
    const repeated = await emi.json('POST', `/api/calendar/import/${again.id}/run`, {
      calendars: [{ key: again.calendars[0].key, target: family!.id }],
      mode: 'merge',
    });
    assert.equal(repeated.json().job.results[0].created, 0);
    assert.equal(repeated.json().job.results[0].skipped, 3);
  });

  it('importiert .ics-Dateien aus den eigenen Dateien', async () => {
    const root = (await emi.get('/api/session')).json().user.rootId as string;
    const uploaded = await emi.upload(root, 'Termine von Lea.ics', Buffer.from(ICS.replace('Familie Sato', 'Lea')), 4096);
    const node = uploaded.json().node.id as string;
    const response = await emi.json('POST', '/api/calendar/import', { node });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().job.calendars[0].name, 'Lea');
    const stranger = await mia.json('POST', '/api/calendar/import', { node });
    assert.equal(stranger.statusCode, 404);
    assert.equal((await mia.get(`/api/calendar/import/${response.json().job.id}`)).statusCode, 404);
  });

  it('kopiert einen Kalender einmal von einer Adresse', async () => {
    const blocked = (await emi.json('POST', '/api/calendar/import', { url: feedUrl })).json().job as Job;
    const failed = await settled(emi, blocked.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'Adressen im lokalen Netz sind gesperrt');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'calendar.subscriptionsPrivate': true })).statusCode, 200);
    const job = await settled(emi, (await emi.json('POST', '/api/calendar/import', { url: feedUrl })).json().job.id);
    assert.equal(job.status, 'ready', job.error ?? '');
    assert.equal(job.calendars[0].name, 'Familie Sato');
    const run = await emi.json('POST', `/api/calendar/import/${job.id}/run`, { calendars: [{ key: job.calendars[0].key, target: 'new' }] });
    assert.equal(run.json().job.results[0].created, 3);
    const calendars = (await emi.get('/api/calendar/calendars')).json().calendars as { name: string; kind: string }[];
    assert.ok(calendars.some((entry) => entry.name === 'Familie Sato' && entry.kind === 'local'));
  });

  it('holt Kalender und Aufgaben aus einem CalDAV-Konto', async () => {
    const wrong = await settled(
      emi,
      (
        await emi.json('POST', '/api/calendar/import', { caldav: { url: `${base}/caldav/`, username: 'mia', password: 'falsch-falsch' } })
      ).json().job.id
    );
    assert.equal(wrong.status, 'failed');
    assert.equal(wrong.error, 'Der Server lehnt die Zugangsdaten ab');
    const wellKnown = await fetch(`${base}/.well-known/caldav`, {
      method: 'PROPFIND',
      redirect: 'manual',
      headers: { 'content-type': 'application/xml; charset=utf-8', depth: '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    });
    assert.equal(wellKnown.status, 301);
    const started = await emi.json('POST', '/api/calendar/import', { caldav: { url: base, username: 'mia', password: miaToken } });
    assert.equal(started.statusCode, 200, started.body);
    assert.ok(!started.body.includes(miaToken));
    const job = await settled(emi, started.json().job.id);
    assert.equal(job.status, 'ready', `${job.error} ${job.warnings.join(' / ')}`);
    const work = job.calendars.find((entry) => entry.name === 'Arbeit von Mia');
    assert.ok(work, JSON.stringify(job.calendars));
    assert.deepEqual([work.events, work.tasks, work.color], [3, 1, '#14b8a6']);
    const run = await emi.json('POST', `/api/calendar/import/${job.id}/run`, {
      calendars: job.calendars.map((entry) => ({ key: entry.key, target: entry.key === work.key ? 'new' : 'skip' })),
    });
    assert.equal(run.statusCode, 200, run.body);
    assert.equal(run.json().job.results[0].created, 4);
    const titles = (await occurrences(emi, Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 10))).map((item) => item.title);
    assert.ok(titles.includes('Abstimmung mit Lea'));
    const tasks = (await emi.get('/api/calendar/tasks')).json();
    assert.ok(JSON.stringify(tasks).includes('Bericht schreiben'));
  });

  it('macht aus einem Abo einen eigenen Kalender', async () => {
    const subscribed = await emi.json('POST', '/api/calendar/subscriptions', { url: feedUrl, name: 'Abo Familie' });
    assert.equal(subscribed.statusCode, 200, subscribed.body);
    const id = subscribed.json().calendar.id as string;
    const event = {
      calendarId: id,
      component: 'VEVENT',
      title: 'Neu',
      start: Date.UTC(2026, 11, 20, 10),
      end: Date.UTC(2026, 11, 20, 11),
      allDay: false,
    };
    assert.equal((await emi.json('POST', '/api/calendar/events', event)).statusCode, 403);
    assert.equal((await mia.json('POST', `/api/calendar/calendars/${id}/detach`, {})).statusCode, 404);
    assert.equal((await emi.json('POST', `/api/calendar/calendars/${id}/detach`, {})).statusCode, 200);
    const calendar = ((await emi.get('/api/calendar/calendars')).json().calendars as { id: string; kind: string }[]).find(
      (entry) => entry.id === id
    );
    assert.equal(calendar?.kind, 'local');
    assert.equal((await emi.json('POST', '/api/calendar/events', event)).statusCode, 200);
    assert.equal((await emi.json('POST', `/api/calendar/calendars/${id}/detach`, {})).statusCode, 400);
  });

  it('lässt sich für Adressen und Konten abschalten', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'calendar.imports': false })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/calendar/import', { url: feedUrl })).statusCode, 403);
    assert.equal(
      (await emi.json('POST', '/api/calendar/import', { caldav: { url: base, username: 'mia', password: miaToken } })).statusCode,
      403
    );
    assert.equal((await upload(emi, [{ name: 'files', filename: 'familie.ics', content: ICS }])).statusCode, 200);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'calendar.imports': true })).statusCode, 200);
  });
});
