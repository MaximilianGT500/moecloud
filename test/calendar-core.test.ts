import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, lastOccurrence, parseRule, formatRule, describeRule } from '../shared/rrule.ts';
import { atMinute, isoWeek, localKey, utcOf, wallOf, addMonths, startOfWeek } from '../shared/time.ts';
import { easter, holidaysIn } from '../shared/holidays.ts';
import { parseQuick } from '../shared/quickadd.ts';
import { moonPhases } from '../shared/moon.ts';
import { emojiFor } from '../shared/emoji.ts';
import { readObjects, writeObject, occurrences, rangeEndOf, cloneData } from '../src/calendar/model.ts';
import { parseICS, serialize, vtimezone, guessZone } from '../src/calendar/ical.ts';
import { parseXml, child } from '../src/calendar/xml.ts';

const series = (rule: string, date: string, seconds: number, allDay = false, zone = 'Europe/Berlin', exdates: string[] = []) => ({
  start: { date, seconds, allDay, zone },
  rule: parseRule(rule),
  rdates: [],
  exdates: new Set(exdates),
});

test('Zeitzonen rechnen über die Zeitumstellung richtig', () => {
  const summer = utcOf({ year: 2026, month: 3, day: 29, hour: 12, minute: 0, second: 0 }, 'Europe/Berlin');
  assert.equal(new Date(summer).toISOString(), '2026-03-29T10:00:00.000Z');
  const gap = utcOf({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin');
  assert.equal(wallOf(gap, 'Europe/Berlin').hour, 3);
  const ambiguous = utcOf({ year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin');
  assert.equal(new Date(ambiguous).toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(localKey(Date.UTC(2026, 10, 19, 23, 30), 'Europe/Berlin'), '2026-11-20');
  assert.equal(atMinute('2026-11-19', 24 * 60, 'Europe/Berlin'), atMinute('2026-11-20', 0, 'Europe/Berlin'));
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(startOfWeek('2026-11-19', 1), '2026-11-16');
  assert.equal(startOfWeek('2026-11-19', 0), '2026-11-15');
});

test('Wiederholungsregeln erzeugen die richtigen Termine', () => {
  const weekly = expand(series('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5', '2026-03-23', 9 * 3600), Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  assert.equal(weekly.length, 5);
  assert.deepEqual(
    weekly.map((entry) => entry.date),
    ['2026-03-23', '2026-03-25', '2026-03-30', '2026-04-01', '2026-04-06']
  );
  assert.equal(wallOf(weekly[2].start, 'Europe/Berlin').hour, 9);
  const lastWorkday = expand(
    series('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-01-30', 15 * 3600),
    Date.UTC(2026, 0, 1),
    Date.UTC(2026, 6, 1)
  );
  assert.deepEqual(
    lastWorkday.map((entry) => entry.date),
    ['2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29', '2026-06-30']
  );
  const leap = expand(series('FREQ=YEARLY', '2024-02-29', 0, true, 'UTC'), Date.UTC(2024, 0, 1), Date.UTC(2033, 0, 1));
  assert.deepEqual(
    leap.map((entry) => entry.date),
    ['2024-02-29', '2028-02-29', '2032-02-29']
  );
  const excluded = expand(
    series('FREQ=DAILY;COUNT=4', '2026-11-01', 0, true, 'UTC', ['20261102']),
    Date.UTC(2026, 9, 1),
    Date.UTC(2026, 11, 1)
  );
  assert.deepEqual(
    excluded.map((entry) => entry.date),
    ['2026-11-01', '2026-11-03', '2026-11-04']
  );
  const old = expand(
    series('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2015-01-05', 8 * 3600, false, 'America/New_York'),
    Date.UTC(2026, 10, 16),
    Date.UTC(2026, 10, 23)
  );
  assert.equal(old.length, 5);
  assert.equal(lastOccurrence(series('FREQ=WEEKLY;INTERVAL=2;UNTIL=20260501T000000Z', '2026-01-05', 8 * 3600))?.date, '2026-04-27');
  assert.equal(formatRule(parseRule('freq=monthly;byday=-1fr;count=6')!), 'FREQ=MONTHLY;COUNT=6;BYDAY=-1FR');
  const tr = (text: string, params?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_match, key) => String(params?.[key] ?? ''));
  assert.equal(describeRule(parseRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')!, '2026-11-19', tr, 'de-DE'), 'Jeden Werktag');
  assert.equal(describeRule(parseRule('FREQ=MONTHLY;BYDAY=2TU')!, '2026-11-10', tr, 'de-DE'), 'Jeden Monat am 2. Dienstag');
});

test('Feiertage passen zu den Bundesländern', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  const bavaria = holidaysIn(2026, ['de-by']).map((holiday) => holiday.name.de);
  assert.ok(bavaria.includes('Fronleichnam'));
  assert.ok(bavaria.includes('Heilige Drei Könige'));
  const berlin = holidaysIn(2026, ['de-be']).map((holiday) => holiday.name.de);
  assert.ok(berlin.includes('Internationaler Frauentag'));
  assert.ok(!berlin.includes('Fronleichnam'));
  const saxony = holidaysIn(2026, ['de-sn']);
  assert.equal(saxony.find((holiday) => holiday.name.de === 'Buß- und Bettag')?.date, '2026-11-18');
  const observances = holidaysIn(2026, ['de'], true).map((holiday) => holiday.name.de);
  assert.ok(observances.includes('1. Advent'));
  assert.equal(holidaysIn(2026, ['de'], true).find((holiday) => holiday.name.de === '1. Advent')?.date, '2026-11-29');
  assert.equal(holidaysIn(2026, ['us']).find((holiday) => holiday.name.en === 'Independence Day')?.date, '2026-07-03');
});

test('Die Schnelleingabe versteht Deutsch und Englisch', () => {
  const today = '2026-11-19';
  const dentist = parseQuick('Zahnarzt morgen 15 Uhr', today);
  assert.equal(dentist.title, 'Zahnarzt');
  assert.equal(dentist.date, '2026-11-20');
  assert.equal(dentist.start, 15 * 60);
  const meeting = parseQuick('Meeting mit Emi am Freitag 10-11 #Arbeit', today);
  assert.equal(meeting.title, 'Meeting mit Emi');
  assert.equal(meeting.date, '2026-11-20');
  assert.equal(meeting.end, 11 * 60);
  assert.deepEqual(meeting.tags, ['Arbeit']);
  const yoga = parseQuick('Yoga dienstags und donnerstags 18 Uhr', today);
  assert.equal(yoga.rrule, 'FREQ=WEEKLY;BYDAY=TU,TH');
  const lunch = parseQuick('Lunch tomorrow at 12:30 for 1 hour @ Café Lea', today);
  assert.equal(lunch.title, 'Lunch');
  assert.equal(lunch.end, 13 * 60 + 30);
  assert.equal(lunch.location, 'Café Lea');
  const birthday = parseQuick('Mias Geburtstag am 3. März jährlich', today);
  assert.equal(birthday.date, '2027-03-03');
  assert.equal(birthday.allDay, true);
  assert.equal(birthday.rrule, 'FREQ=YEARLY');
});

test('Mondphasen und Symbole', () => {
  const phases = moonPhases(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1));
  const full = phases.find((entry) => entry.phase === 'full');
  assert.ok(full);
  assert.equal(new Date(full.utc).toISOString().slice(0, 10), '2026-11-24');
  assert.equal(emojiFor('Zahnarzt'), '🦷');
  assert.equal(emojiFor('Geburtstag von Mia'), '🎂');
});

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:serie-1',
  'DTSTART;TZID=W. Europe Standard Time:20261102T090000',
  'DTEND;TZID=W. Europe Standard Time:20261102T093000',
  'SUMMARY:Standup\\, Team',
  'RRULE:FREQ=DAILY;COUNT=5',
  'EXDATE;TZID=W. Europe Standard Time:20261104T090000',
  'X-CUSTOM-PROP:bleibt',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:serie-1',
  'RECURRENCE-ID;TZID=W. Europe Standard Time:20261105T090000',
  'DTSTART;TZID=W. Europe Standard Time:20261105T140000',
  'DTEND;TZID=W. Europe Standard Time:20261105T143000',
  'SUMMARY:Standup verschoben',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

test('iCalendar wird gelesen, ausgeklappt und verlustarm geschrieben', () => {
  const [object] = readObjects(SAMPLE, 'UTC');
  assert.equal(object.data.title, 'Standup, Team');
  assert.equal(object.data.zone, 'Europe/Berlin');
  assert.deepEqual(object.data.exdates, ['20261104T080000Z']);
  assert.equal(object.data.overrides.length, 1);
  assert.equal(object.data.alarms[0].offset, -15 * 60_000);
  const list = occurrences(object.data, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 10));
  assert.equal(list.length, 4);
  assert.equal(list.find((entry) => entry.override)?.instance.title, 'Standup verschoben');
  assert.ok(rangeEndOf(object.data)! >= Date.UTC(2026, 10, 6, 8, 30));
  const next = cloneData(object.data);
  next.location = 'Raum 4';
  const written = writeObject(object.ics, object.data, next);
  assert.match(written, /X-CUSTOM-PROP:bleibt/);
  assert.match(written, /LOCATION:Raum 4/);
  assert.match(written, /TRIGGER:-PT15M/);
  const again = readObjects(written, 'UTC')[0];
  assert.equal(again.data.overrides[0].title, 'Standup verschoben');
  assert.equal(guessZone('/mozilla.org/20070129_1/Europe/Vienna'), 'Europe/Vienna');
  const zone = serialize(vtimezone('Europe/Berlin', 2026));
  assert.match(zone, /BYMONTH=3;BYDAY=-1SU/);
  assert.match(zone, /BYMONTH=10;BYDAY=-1SU/);
  const folded = serialize(parseICS(`BEGIN:VCALENDAR\r\nX-LONG:${'ä'.repeat(100)}\r\nEND:VCALENDAR\r\n`)[0]);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});

test('XML wird mit Namensräumen gelesen', () => {
  const root = parseXml(
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><d:displayname/></d:prop></d:propfind>'
  );
  assert.equal(root?.name, 'propfind');
  const prop = child(root, 'DAV:', 'prop');
  assert.equal(prop?.children.length, 2);
  assert.equal(prop?.children[0].ns, 'urn:ietf:params:xml:ns:caldav');
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'));
});
