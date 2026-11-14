import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blocks, moment, parseCalendar, parseContacts, unfold } from '../web/src/app/files/preview/pim.ts';

const CALENDAR = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'SUMMARY:Grillabend bei Mia',
  'DTSTART;TZID=Europe/Berlin:20261121T180000',
  'DTEND;TZID=Europe/Berlin:20261121T220000',
  'LOCATION:Garten\\, Hinterhof',
  'DESCRIPTION:Bitte Salat mitbringen.\\nGetränke gibt es da.',
  'RRULE:FREQ=YEARLY',
  'BEGIN:VALARM',
  'SUMMARY:Erinnerung',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Ausflug mit Le',
  ' a',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261103',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Telefonat',
  'DTSTART:20261031T090000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const CONTACTS = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Hoffmann;Lea;;;',
  'FN:Lea Hoffmann',
  'ORG:Moe GmbH;Entwicklung',
  'TITLE:Entwicklerin',
  'TEL;TYPE=CELL:+49 151 2345678',
  'TEL;TYPE="work,voice":030 1234',
  'EMAIL;TYPE=INTERNET:lea@example.com',
  'item1.ADR;TYPE=HOME:;;Gartenweg 5;Berlin;;10115;Deutschland',
  'BDAY:1994-05-17',
  'URL:https://example.com/lea',
  'URL:javascript:alert(1)',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:4.0',
  'N:Weber;Mia;;;',
  'EMAIL:mailto:mia@example.com',
  'END:VCARD',
].join('\n');

describe('Kalender und Kontakte lesen', () => {
  it('faltet Zeilen und lässt verschachtelte Teile aus', () => {
    assert.deepEqual(unfold('A:1\r\n B\r\nC:2\n\tD'), ['A:1B', 'C:2D']);
    const events = blocks(CALENDAR, 'VEVENT');
    assert.equal(events.length, 3);
    assert.ok(!events[0].some((entry) => entry.value === 'Erinnerung'));
  });

  it('liest Termine mit Zeitzonen, ganzen Tagen und Wiederholung', () => {
    const events = parseCalendar(CALENDAR);
    assert.deepEqual(
      events.map((event) => event.title),
      ['Telefonat', 'Ausflug mit Lea', 'Grillabend bei Mia']
    );
    const grill = events[2];
    assert.equal(grill.start?.time, Date.UTC(2026, 10, 21, 17, 0, 0));
    assert.equal(grill.end?.time, Date.UTC(2026, 10, 21, 21, 0, 0));
    assert.equal(grill.location, 'Garten, Hinterhof');
    assert.equal(grill.description, 'Bitte Salat mitbringen.\nGetränke gibt es da.');
    assert.equal(grill.repeats, true);
    assert.equal(events[1].start?.allDay, true);
    assert.equal(events[0].start?.time, Date.UTC(2026, 9, 31, 9, 0, 0));
    assert.equal(moment({ name: 'DTSTART', params: { TZID: 'Unbekannt/Zone' }, value: '20260101T120000' })?.allDay, false);
  });

  it('liest Kontakte aus vCard 3 und 4', () => {
    const [lea, mia] = parseContacts(CONTACTS);
    assert.equal(lea.name, 'Lea Hoffmann');
    assert.equal(lea.organization, 'Moe GmbH');
    assert.equal(lea.role, 'Entwicklerin');
    assert.deepEqual(lea.phones, [
      { type: 'cell', value: '+49 151 2345678' },
      { type: 'work', value: '030 1234' },
    ]);
    assert.deepEqual(lea.emails, ['lea@example.com']);
    assert.deepEqual(lea.addresses, ['Gartenweg 5, Berlin, 10115, Deutschland']);
    assert.equal(lea.birthday, '1994-05-17');
    assert.deepEqual(lea.urls, ['https://example.com/lea']);
    assert.equal(mia.name, 'Mia Weber');
    assert.deepEqual(mia.emails, ['mia@example.com']);
  });
});
