import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import sharp from 'sharp';
import { contactImportsSettled, cardsFromCsv } from '../src/contacts/transfer.ts';
import { applyContact, normalizeDate, parseVCards, photoOf, readContact, serializeVCard, uidOf } from '../src/contacts/vcard.ts';
import { Client, createApp, login, setUp, zip } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaId = 0;

const basic = (username: string, token: string) => `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;

const APPLE = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'PRODID:-//Apple Inc.//iPhone OS 26.1//EN',
  'N:Weber;Mia;;;',
  'FN:Mia Weber',
  'ORG:Kirschblüte GmbH;Design;',
  'TITLE:Designerin',
  'item1.EMAIL;type=INTERNET;type=pref:mia@example.com',
  'item1.X-ABLabel:_$!<Other>!$_',
  'EMAIL;type=INTERNET;type=WORK:mia.weber@kirschbluete.example',
  'TEL;type=CELL;type=VOICE;type=pref:+49 151 1234567',
  'item2.TEL:+49 30 999',
  'item2.X-ABLabel:Oma',
  'item3.ADR;type=HOME;type=pref:;;Hauptstraße 5;Berlin;;10115;Deutschland',
  'item3.X-ABADR:de',
  'BDAY;X-APPLE-OMIT-YEAR=1604:1604-05-17',
  'item4.X-ABDATE;type=pref:2015-06-20',
  'item4.X-ABLabel:_$!<Anniversary>!$_',
  'NOTE:Mag Ramen\\, Kaffee und\\nKatzen',
  'X-SOCIALPROFILE;type=instagram:https://instagram.com/mia',
  'CATEGORIES:Freunde,Arbeit',
  'UID:8D1B4F2A-mia',
  'END:VCARD',
  '',
].join('\r\n');

const LEGACY = [
  'BEGIN:VCARD',
  'VERSION:2.1',
  'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;Lea;;;',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Lea M=C3=BCller',
  'TEL;CELL;PREF:0170 1234',
  'TEL;WORK;FAX:030 555',
  'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Zeile eins=0D=0AZeile zwei, mit Komma=',
  'und mehr',
  'EMAIL;INTERNET:lea@example.org',
  'BDAY:19920229',
  'END:VCARD',
  '',
].join('\r\n');

const MODERN = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1',
  'FN:Emily Sato',
  'N:Sato;Emily;;;',
  'BDAY:--0812',
  'EMAIL;TYPE=work;PREF=1:emily@example.net',
  'TEL;VALUE=uri;TYPE="voice,home":tel:+81-3-1234-5678',
  'END:VCARD',
  '',
].join('\r\n');

const GOOGLE = [
  'First Name,Middle Name,Last Name,Nickname,Organization Name,Organization Title,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value,Address 1 - Label,Address 1 - Street,Address 1 - City,Address 1 - Postal Code,Address 1 - Country',
  'Lea,,Schmidt,Leo,,,1990-03-14,Kennt Emi aus der Schule,* myContacts ::: * starred ::: Familie,Home,lea.schmidt@example.org ::: lea@work.example,Mobile,+49 170 2223334,Arbeit,+49 40 123,Home,Gartenstraße 4,Hamburg,20095,Deutschland',
  'Mia,,Kobayashi,,Kirschblüte GmbH,CEO,--11-02,,* myContacts,Work,mia.k@kirschbluete.example,,,,,,,,,',
].join('\r\n');

const OUTLOOK = [
  '"Vorname","Nachname","Firma","Position","E-Mail-Adresse","Mobiltelefon","Telefon geschäftlich","Straße geschäftlich","Ort geschäftlich","Postleitzahl geschäftlich","Geburtstag","Kategorien"',
  '"Emily","Weber","Moe GmbH","Leitung","emily.weber@moe.example","0171 555","040 777","Hafenweg 1","Hamburg","20457","24.12.1985","Arbeit;Wichtig"',
].join('\r\n');

type Part = { name: string; filename: string; content: Buffer | string; type?: string };

function multipart(files: Part[]) {
  const boundary = `----moe${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`
      ),
      Buffer.from(file.content),
      Buffer.from('\r\n')
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(chunks) };
}

type Summary = {
  id: string;
  name: string;
  bookId: string;
  email: string | null;
  favorite: boolean;
  categories: string[];
  photo: string | null;
};

const list = async (client: Client, query = '') => (await client.get(`/api/contacts${query}`)).json().items as Summary[];

const books = async (client: Client) =>
  (await client.get('/api/contacts/books')).json().books as { id: string; name: string; access: string; count: number; shares: number }[];

const contactInput = (data: Record<string, unknown>) => ({
  kind: 'individual',
  name: '',
  prefix: '',
  given: '',
  additional: '',
  family: '',
  suffix: '',
  nickname: '',
  organization: '',
  department: '',
  title: '',
  emails: [],
  phones: [],
  addresses: [],
  urls: [],
  birthday: null,
  anniversary: null,
  note: '',
  categories: [],
  ...data,
});

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'mias-passwort-123',
  });
  miaId = made.json().user?.id ?? made.json().id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

describe('vCard', () => {
  it('liest Apple-, vCard-2.1- und vCard-4-Karten', () => {
    const cards = parseVCards(APPLE + LEGACY + MODERN);
    assert.equal(cards.length, 3);
    const apple = readContact(cards[0]);
    assert.equal(apple.name, 'Mia Weber');
    assert.equal(apple.organization, 'Kirschblüte GmbH');
    assert.equal(apple.department, 'Design');
    assert.deepEqual(
      apple.emails.map((entry) => [entry.type, entry.value]),
      [
        ['other', 'mia@example.com'],
        ['work', 'mia.weber@kirschbluete.example'],
      ]
    );
    assert.deepEqual(
      apple.phones.map((entry) => [entry.type, entry.label, entry.value]),
      [
        ['mobile', null, '+49 151 1234567'],
        ['other', 'Oma', '+49 30 999'],
      ]
    );
    assert.equal(apple.addresses[0].locality, 'Berlin');
    assert.equal(apple.birthday, '--05-17');
    assert.equal(apple.anniversary, '2015-06-20');
    assert.equal(apple.note, 'Mag Ramen, Kaffee und\nKatzen');
    assert.deepEqual(apple.categories, ['Freunde', 'Arbeit']);
    const legacy = readContact(cards[1]);
    assert.equal(legacy.name, 'Lea Müller');
    assert.equal(legacy.family, 'Müller');
    assert.equal(legacy.note, 'Zeile eins\nZeile zwei, mit Kommaund mehr');
    assert.deepEqual(
      legacy.phones.map((entry) => entry.type),
      ['mobile', 'fax']
    );
    assert.equal(legacy.birthday, '1992-02-29');
    const modern = readContact(cards[2]);
    assert.equal(modern.birthday, '--08-12');
    assert.equal(modern.phones[0].value, '+81-3-1234-5678');
    assert.equal(modern.phones[0].type, 'home');
    assert.equal(uidOf(cards[2]), 'urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1');
  });

  it('schreibt Änderungen zurück und behält unbekannte Felder', () => {
    const card = parseVCards(APPLE)[0];
    const data = readContact(card);
    data.phones.push({ type: 'work', value: '+49 40 1', label: null });
    data.birthday = '1991-05-17';
    const text = serializeVCard(applyContact(card, data, uidOf(card)!));
    assert.match(text, /X-SOCIALPROFILE;TYPE=instagram:https:\/\/instagram\.com\/mia/);
    assert.match(text, /item\d+\.X-ABLABEL:Oma/);
    assert.match(text, /BDAY;VALUE=date:1991-05-17/);
    assert.doesNotMatch(text, /X-ABADR/);
    const again = readContact(parseVCards(text)[0]);
    assert.equal(again.phones.length, 3);
    assert.equal(again.phones[1].label, 'Oma');
    assert.equal(again.anniversary, '2015-06-20');
    const modern = parseVCards(MODERN)[0];
    const next = serializeVCard(applyContact(modern, readContact(modern), uidOf(modern)!));
    assert.match(next, /VERSION:4\.0/);
    assert.match(next, /BDAY:--0812/);
    assert.equal(normalizeDate('19900517'), '1990-05-17');
    assert.equal(normalizeDate('--1224'), '--12-24');
    assert.equal(normalizeDate('2023-02-30'), null);
  });

  it('liest CSV von Google und Outlook', () => {
    const google = cardsFromCsv(GOOGLE, 'google.csv').map(readContact);
    assert.equal(google.length, 2);
    assert.equal(google[0].name, 'Lea Schmidt');
    assert.equal(google[0].nickname, 'Leo');
    assert.equal(google[0].emails.length, 2);
    assert.equal(google[0].phones[1].type, 'work');
    assert.equal(google[0].addresses[0].locality, 'Hamburg');
    assert.deepEqual(google[0].categories, ['Familie']);
    assert.equal(google[0].birthday, '1990-03-14');
    assert.equal(google[1].birthday, '--11-02');
    assert.equal(google[1].title, 'CEO');
    const outlook = cardsFromCsv(OUTLOOK, 'outlook.csv').map(readContact);
    assert.equal(outlook[0].name, 'Emily Weber');
    assert.equal(outlook[0].birthday, '1985-12-24');
    assert.deepEqual(
      outlook[0].phones.map((entry) => entry.type),
      ['mobile', 'work']
    );
    assert.equal(outlook[0].addresses[0].type, 'work');
    assert.deepEqual(outlook[0].categories, ['Arbeit', 'Wichtig']);
    assert.throws(() => cardsFromCsv('Betreff,Beginnt am\r\nA,B', 'termine.csv'));
  });
});

describe('Kontakte im Browser', () => {
  let bookId = '';
  let lea = '';

  it('legt das Adressbuch an und speichert Kontakte', async () => {
    const own = await books(emi);
    assert.equal(own.length, 1);
    assert.equal(own[0].name, 'Kontakte');
    bookId = own[0].id;
    const created = await emi.json('POST', '/api/contacts', {
      bookId,
      data: contactInput({
        given: 'Lea',
        family: 'Sato',
        emails: [{ type: 'home', value: 'lea@example.org' }],
        phones: [{ type: 'mobile', value: '+49 170 1112223' }],
        birthday: '1994-12-03',
        categories: ['Familie'],
      }),
    });
    assert.equal(created.statusCode, 200, created.body);
    const contact = created.json().contact;
    lea = contact.id;
    assert.equal(contact.data.name, 'Lea Sato');
    assert.equal(contact.data.emails[0].value, 'lea@example.org');
    const empty = await emi.json('POST', '/api/contacts', { bookId, data: contactInput({}) });
    assert.equal(empty.statusCode, 400);
    const vcard = await emi.get(`/api/contacts/${lea}/vcard`);
    assert.match(vcard.body, /FN:Lea Sato/);
    assert.match(vcard.headers['content-type'] as string, /text\/vcard/);
  });

  it('sucht, markiert und vergibt Labels', async () => {
    assert.equal((await list(emi, '?q=sato')).length, 1);
    assert.equal((await list(emi, '?q=1112223')).length, 1);
    assert.equal((await list(emi, '?q=niemand')).length, 0);
    assert.equal((await emi.json('POST', `/api/contacts/${lea}/favorite`, { favorite: true })).statusCode, 200);
    assert.equal((await list(emi, '?favorites=1')).length, 1);
    assert.equal((await emi.json('POST', '/api/contacts/labels', { ids: [lea], label: 'Freunde' })).json().changed, 1);
    const labels = (await emi.get('/api/contacts/labels')).json().labels as { name: string; count: number }[];
    assert.deepEqual(
      labels.map((entry) => entry.name),
      ['Familie', 'Freunde']
    );
    assert.equal((await list(emi, '?label=freunde')).length, 1);
    assert.equal((await emi.json('PATCH', '/api/contacts/labels', { from: 'Freunde', to: 'Clique' })).json().changed, 1);
    assert.ok((await list(emi))[0].categories.includes('Clique'));
  });

  it('ändert, verschiebt und stellt aus dem Papierkorb wieder her', async () => {
    const detail = (await emi.get(`/api/contacts/${lea}`)).json().contact;
    const updated = await emi.json('PUT', `/api/contacts/${lea}`, {
      data: { ...detail.data, organization: 'Moe GmbH', title: 'Entwicklerin' },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().contact.data.organization, 'Moe GmbH');
    const work = (await emi.json('POST', '/api/contacts/books', { name: 'Arbeit' })).json().book;
    const moved = await emi.json('PUT', `/api/contacts/${lea}`, { data: updated.json().contact.data, bookId: work.id });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(moved.json().contact.bookId, work.id);
    assert.equal((await list(emi, `?book=${bookId}`)).length, 0);
    assert.equal((await emi.json('DELETE', `/api/contacts/${lea}`)).json().trashed, true);
    assert.equal((await list(emi)).length, 0);
    assert.equal((await list(emi, '?trash=1')).length, 1);
    assert.equal((await emi.json('POST', `/api/contacts/${lea}/restore`)).statusCode, 200);
    assert.equal((await list(emi)).length, 1);
    assert.equal((await emi.json('DELETE', `/api/contacts/books/${work.id}`)).statusCode, 200);
    assert.equal((await list(emi)).length, 0);
    const last = await emi.json('DELETE', `/api/contacts/books/${bookId}`);
    assert.equal(last.statusCode, 400);
  });

  it('zeigt Geburtstage, Vorschläge und doppelte Kontakte', async () => {
    const add = async (data: Record<string, unknown>) =>
      (await emi.json('POST', '/api/contacts', { bookId, data: contactInput(data) })).json().contact.id as string;
    const first = await add({
      given: 'Emily',
      family: 'Weber',
      emails: [{ type: 'work', value: 'emily@moe.example' }],
      birthday: '--02-29',
    });
    const second = await add({ given: 'Emily', family: 'Weber', phones: [{ type: 'mobile', value: '0171 555' }], note: 'Zweiter Eintrag' });
    await add({ given: 'Mia', family: 'Weber', emails: [{ type: 'home', value: 'mia.weber@example.com' }], birthday: '1990-01-05' });
    const birthdays = (await emi.get('/api/contacts/birthdays?from=2027-01-01&to=2028-01-31')).json().items as {
      name: string;
      date: string;
      age: number | null;
    }[];
    assert.deepEqual(
      birthdays.map((entry) => [entry.name, entry.date, entry.age]),
      [
        ['Mia Weber', '2027-01-05', 37],
        ['Emily Weber', '2027-02-28', null],
        ['Mia Weber', '2028-01-05', 38],
      ]
    );
    const leap = (await emi.get('/api/contacts/birthdays?from=2028-02-01&to=2028-03-01')).json().items as { date: string }[];
    assert.deepEqual(
      leap.map((entry) => entry.date),
      ['2028-02-29']
    );
    assert.equal((await emi.get('/api/contacts/birthdays?from=2027-01-01&to=2029-01-01')).statusCode, 400);
    const suggestions = (await emi.get('/api/contacts/suggest?q=weber')).json().items as { email: string }[];
    assert.deepEqual(
      suggestions.map((entry) => entry.email),
      ['emily@moe.example', 'mia.weber@example.com']
    );
    const people = (await emi.get('/api/calendar/people?q=emily&contacts=1')).json();
    assert.equal(people.contacts[0].email, 'emily@moe.example');
    const groups = (await emi.get('/api/contacts/duplicates')).json().groups as { reasons: string[]; items: { id: string }[] }[];
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].reasons, ['name']);
    const merged = await emi.json('POST', '/api/contacts/merge', { ids: [first, second] });
    assert.equal(merged.statusCode, 200, merged.body);
    const data = merged.json().contact.data;
    assert.equal(data.emails[0].value, 'emily@moe.example');
    assert.equal(data.phones[0].value, '0171 555');
    assert.equal(data.note, 'Zweiter Eintrag');
    assert.equal((await emi.get('/api/contacts/duplicates')).json().groups.length, 0);
    assert.equal((await list(emi, '?trash=1')).length, 1);
  });

  it('speichert Fotos verkleinert', async () => {
    const id = (await list(emi, '?q=emily'))[0].id;
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ec4899' } })
      .png()
      .toBuffer();
    const upload = multipart([{ name: 'file', filename: 'emily.png', content: png, type: 'image/png' }]);
    const stored = await emi.send({ method: 'PUT', url: `/api/contacts/${id}/photo`, ...upload });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.ok(stored.json().contact.photo);
    const photo = await emi.get(`/api/contacts/${id}/photo`);
    assert.equal(photo.headers['content-type'], 'image/jpeg');
    const meta = await sharp(photo.rawPayload).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
    const vcard = (await emi.get(`/api/contacts/${id}/vcard`)).body;
    assert.match(vcard, /PHOTO;ENCODING=b;TYPE=JPEG:/);
    assert.ok(photoOf(parseVCards(vcard)[0]));
    const broken = multipart([{ name: 'file', filename: 'kaputt.png', content: Buffer.from('kein Bild'), type: 'image/png' }]);
    assert.equal((await emi.send({ method: 'PUT', url: `/api/contacts/${id}/photo`, ...broken })).statusCode, 400);
    assert.equal((await emi.json('DELETE', `/api/contacts/${id}/photo`)).json().contact.photo, null);
    assert.equal((await emi.get(`/api/contacts/${id}/photo`)).statusCode, 404);
  });

  it('importiert vCard, CSV und ZIP und exportiert wieder', async () => {
    const archive = await zip({ 'Contacts/Lea.vcf': LEGACY, 'Contacts/Emily.vcf': MODERN });
    const upload = multipart([
      { name: 'file', filename: 'iPhone.vcf', content: APPLE },
      { name: 'file', filename: 'Google.csv', content: GOOGLE },
      { name: 'file', filename: 'takeout.zip', content: archive },
    ]);
    const started = await emi.send({ method: 'POST', url: '/api/contacts/import', ...upload });
    assert.equal(started.statusCode, 200, started.body);
    const job = started.json().job;
    assert.equal(job.count, 5);
    assert.equal(job.sample[0].name, 'Mia Weber');
    const run = await emi.json('POST', `/api/contacts/import/${job.id}/run`, { book: 'new', name: 'Vom Telefon', mode: 'merge' });
    assert.equal(run.statusCode, 200, run.body);
    assert.deepEqual([run.json().created, run.json().updated, run.json().skipped], [5, 0, 0]);
    const target = run.json().book.id as string;
    const imported = await list(emi, `?book=${target}`);
    assert.equal(imported.length, 5);
    assert.ok(imported.find((entry) => entry.name === 'Lea Schmidt')?.favorite);
    const again = await emi.send({
      method: 'POST',
      url: '/api/contacts/import',
      ...multipart([{ name: 'file', filename: 'iPhone.vcf', content: APPLE }]),
    });
    const rerun = await emi.json('POST', `/api/contacts/import/${again.json().job.id}/run`, { book: target, mode: 'merge' });
    assert.deepEqual([rerun.json().created, rerun.json().updated, rerun.json().skipped], [0, 0, 1]);
    assert.equal((await emi.json('POST', `/api/contacts/import/${again.json().job.id}/run`, { book: target })).statusCode, 404);
    const bad = await emi.send({
      method: 'POST',
      url: '/api/contacts/import',
      ...multipart([{ name: 'file', filename: 'notiz.txt', content: 'Hallo Lea' }]),
    });
    assert.equal(bad.statusCode, 400);
    const root = (await emi.get('/api/session')).json().user.rootId as string;
    const file = await emi.upload(
      root,
      'Visitenkarte Emily.vcf',
      Buffer.from(MODERN.replace('Emily Sato', 'Emily Sato-Weber').replace('4fbe8971', '5fbe8971'))
    );
    const node = await emi.json('POST', '/api/contacts/import', { node: file.json().node.id });
    assert.equal(node.statusCode, 200, node.body);
    assert.equal(node.json().job.count, 1);
    assert.equal(node.json().job.sample[0].name, 'Emily Sato-Weber');
    await contactImportsSettled();
    const vcf = await emi.get(`/api/contacts/export?book=${target}`);
    assert.equal(parseVCards(vcf.body).length, 5);
    assert.match(vcf.headers['content-disposition'] as string, /Vom%20Telefon\.vcf|Vom Telefon\.vcf/);
    const csv = await emi.get(`/api/contacts/export?book=${target}&format=csv`);
    assert.match(csv.body, /"First Name","Middle Name","Last Name"/);
    assert.match(csv.body, /"\+49 170 2223334"/);
    assert.match(csv.body, /\* starred/);
    const back = cardsFromCsv(csv.body, 'export.csv').map(readContact);
    assert.equal(back.length, 5);
    assert.ok(back.some((entry) => entry.name === 'Lea Schmidt' && entry.emails.length === 2));
  });

  it('teilt Adressbücher mit anderen', async () => {
    const familie = (await emi.json('POST', '/api/contacts/books', { name: 'Familie' })).json().book;
    const made = await emi.json('POST', '/api/contacts', { bookId: familie.id, data: contactInput({ given: 'Oma', family: 'Sato' }) });
    const id = made.json().contact.id;
    assert.equal((await mia.get(`/api/contacts/${id}`)).statusCode, 404);
    assert.equal((await emi.json('PUT', `/api/contacts/books/${familie.id}/shares/${miaId}`, { permission: 'read' })).statusCode, 200);
    const shared = (await books(mia)).find((entry) => entry.id === familie.id);
    assert.equal(shared?.access, 'read');
    assert.equal((await list(mia, `?book=${familie.id}`)).length, 1);
    const blocked = await mia.json('PUT', `/api/contacts/${id}`, { data: contactInput({ given: 'Opa' }) });
    assert.equal(blocked.statusCode, 403);
    const note = (await mia.get('/api/notifications')).json().items.find((item: { kind: string }) => item.kind === 'contacts_shared');
    assert.ok(note);
    assert.equal((await emi.json('PUT', `/api/contacts/books/${familie.id}/shares/${miaId}`, { permission: 'write' })).statusCode, 200);
    assert.equal((await mia.json('PUT', `/api/contacts/${id}`, { data: contactInput({ given: 'Opa', family: 'Sato' }) })).statusCode, 200);
    assert.equal((await emi.get(`/api/contacts/${id}`)).json().contact.data.name, 'Opa Sato');
    assert.equal((await mia.json('DELETE', `/api/contacts/books/${familie.id}`)).json().left, true);
    assert.equal((await mia.get(`/api/contacts/${id}`)).statusCode, 404);
    assert.equal((await emi.get(`/api/contacts/books/${familie.id}/shares`)).json().shares.length, 0);
  });
});

describe('CardDAV', () => {
  let dav: Client;
  let token = '';

  before(async () => {
    token = (await emi.json('POST', '/api/account/app-passwords', { name: 'iPhone' })).json().token as string;
    dav = new Client(app);
    dav.basic = basic('emi', token);
  });

  it('findet das Adressbuch über well-known und Principal', async () => {
    const known = await dav.send({
      method: 'PROPFIND',
      url: '/.well-known/carddav',
      headers: { depth: '0', 'content-type': 'application/xml' },
      payload: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    });
    assert.equal(known.statusCode, 301);
    assert.equal(known.headers.location, '/carddav/');
    const root = await dav.send({
      method: 'PROPFIND',
      url: '/carddav/',
      headers: { depth: '0', 'content-type': 'application/xml' },
      payload: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    });
    assert.equal(root.statusCode, 207, root.body);
    assert.match(root.body, /\/carddav\/principals\/emi\//);
    const principal = await dav.send({
      method: 'PROPFIND',
      url: '/carddav/principals/emi/',
      headers: { depth: '0', 'content-type': 'application/xml' },
      payload:
        '<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:prop><card:addressbook-home-set/><cal:calendar-home-set/></d:prop></d:propfind>',
    });
    assert.match(principal.body, /<card:addressbook-home-set><d:href>\/carddav\/addressbooks\/emi\/<\/d:href>/);
    assert.match(principal.body, /\/caldav\/calendars\/emi\//);
    const caldav = await dav.send({
      method: 'PROPFIND',
      url: '/caldav/principals/emi/',
      headers: { depth: '0', 'content-type': 'application/xml' },
      payload:
        '<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>',
    });
    assert.match(caldav.body, /\/carddav\/addressbooks\/emi\//);
    const home = await dav.send({
      method: 'PROPFIND',
      url: '/carddav/addressbooks/emi/',
      headers: { depth: '1', 'content-type': 'application/xml' },
      payload:
        '<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><cs:getctag/><d:sync-token/></d:prop></d:propfind>',
    });
    assert.equal(home.statusCode, 207);
    assert.match(home.body, /<card:addressbook\/>/);
    assert.match(home.body, /\/carddav\/addressbooks\/emi\/contacts\//);
    assert.match(home.body, /Vom Telefon/);
  });

  it('synchronisiert Kontakte in beide Richtungen', async () => {
    const url = '/carddav/addressbooks/emi/contacts/';
    const initial = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml' },
      payload:
        '<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>',
    });
    assert.equal(initial.statusCode, 207, initial.body);
    const syncToken = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(initial.body)?.[1];
    assert.ok(syncToken);
    const card = APPLE.replace('UID:8D1B4F2A-mia', 'UID:phone-mia').replace('FN:Mia Weber', 'FN:Mia vom Telefon');
    const put = await dav.send({
      method: 'PUT',
      url: `${url}phone-mia.vcf`,
      headers: { 'content-type': 'text/vcard', 'if-none-match': '*' },
      payload: card,
    });
    assert.equal(put.statusCode, 201, put.body);
    assert.ok(put.headers.etag);
    const again = await dav.send({
      method: 'PUT',
      url: `${url}phone-mia.vcf`,
      headers: { 'content-type': 'text/vcard', 'if-none-match': '*' },
      payload: card,
    });
    assert.equal(again.statusCode, 412);
    const clash = await dav.send({ method: 'PUT', url: `${url}other.vcf`, headers: { 'content-type': 'text/vcard' }, payload: card });
    assert.equal(clash.statusCode, 403);
    assert.match(clash.body, /no-uid-conflict/);
    const invalid = await dav.send({ method: 'PUT', url: `${url}broken.vcf`, headers: { 'content-type': 'text/vcard' }, payload: 'Hallo' });
    assert.equal(invalid.statusCode, 403);
    const get = await dav.get(`${url}phone-mia.vcf`);
    assert.equal(get.body, card);
    assert.equal(get.headers.etag, put.headers.etag);
    const web = await list(emi, '?q=telefon');
    assert.ok(web.some((entry) => entry.name === 'Mia vom Telefon'));
    const changes = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml' },
      payload: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${syncToken}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
    });
    assert.match(changes.body, /phone-mia\.vcf/);
    const next = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(changes.body)?.[1];
    const fromWeb = web.find((entry) => entry.name === 'Mia vom Telefon')!;
    const detail = (await emi.get(`/api/contacts/${fromWeb.id}`)).json().contact;
    const edited = await emi.json('PUT', `/api/contacts/${fromWeb.id}`, { data: { ...detail.data, nickname: 'Mimi' } });
    assert.equal(edited.statusCode, 200, edited.body);
    const multiget = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml', depth: '1' },
      payload: `<card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop><d:href>${url}phone-mia.vcf</d:href><d:href>${url}fehlt.vcf</d:href></card:addressbook-multiget>`,
    });
    assert.match(multiget.body, /NICKNAME:Mimi/);
    assert.match(multiget.body, /X-SOCIALPROFILE/);
    assert.match(multiget.body, /fehlt\.vcf<\/d:href><d:status>HTTP\/1\.1 404/);
    const query = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml', depth: '1' },
      payload:
        '<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop><card:filter><card:prop-filter name="EMAIL"><card:text-match collation="i;unicode-casemap" match-type="contains">EMILY@MOE</card:text-match></card:prop-filter></card:filter></card:addressbook-query>',
    });
    assert.equal(query.statusCode, 207);
    assert.match(query.body, /Emily Weber/);
    assert.doesNotMatch(query.body, /Mia vom Telefon/);
    const removed = await dav.send({ method: 'DELETE', url: `${url}phone-mia.vcf`, headers: { 'if-match': '"falsch"' } });
    assert.equal(removed.statusCode, 412);
    assert.equal((await dav.send({ method: 'DELETE', url: `${url}phone-mia.vcf` })).statusCode, 204);
    const after = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml' },
      payload: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${next}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
    });
    assert.match(after.body, /phone-mia\.vcf<\/d:href><d:status>HTTP\/1\.1 404/);
    assert.ok((await list(emi, '?trash=1')).some((entry) => entry.name === 'Mia vom Telefon'));
    const stale = await dav.send({
      method: 'REPORT',
      url,
      headers: { 'content-type': 'application/xml' },
      payload:
        '<d:sync-collection xmlns:d="DAV:"><d:sync-token>http://example.com/1</d:sync-token><d:prop><d:getetag/></d:prop></d:sync-collection>',
    });
    assert.equal(stale.statusCode, 403);
  });

  it('legt Adressbücher an und achtet auf Rechte', async () => {
    const made = await dav.send({
      method: 'MKCOL',
      url: '/carddav/addressbooks/emi/verein/',
      headers: { 'content-type': 'application/xml' },
      payload:
        '<d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:set><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Sportverein</d:displayname></d:prop></d:set></d:mkcol>',
    });
    assert.equal(made.statusCode, 201, made.body);
    assert.ok((await books(emi)).some((entry) => entry.name === 'Sportverein'));
    const patched = await dav.send({
      method: 'PROPPATCH',
      url: '/carddav/addressbooks/emi/verein/',
      headers: { 'content-type': 'application/xml' },
      payload:
        '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>Turnverein</d:displayname></d:prop></d:set></d:propertyupdate>',
    });
    assert.equal(patched.statusCode, 207);
    assert.ok((await books(emi)).some((entry) => entry.name === 'Turnverein'));
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/carddav/addressbooks/mia/', headers: { depth: '0' } })).statusCode, 403);
    const readOnly = (await emi.json('POST', '/api/account/app-passwords', { name: 'Nur lesen', readOnly: true })).json().token as string;
    const viewer = new Client(app);
    viewer.basic = basic('emi', readOnly);
    const denied = await viewer.send({
      method: 'PUT',
      url: '/carddav/addressbooks/emi/verein/neu.vcf',
      headers: { 'content-type': 'text/vcard' },
      payload: MODERN,
    });
    assert.equal(denied.statusCode, 403);
    const wrong = new Client(app);
    wrong.basic = basic('emi', 'falsch');
    assert.equal((await wrong.send({ method: 'PROPFIND', url: '/carddav/' })).statusCode, 401);
    assert.equal((await dav.send({ method: 'DELETE', url: '/carddav/addressbooks/emi/verein/' })).statusCode, 204);
    assert.ok(!(await books(emi)).some((entry) => entry.name === 'Turnverein'));
  });

  it('lässt sich ausschalten', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'contacts.enabled': false })).statusCode, 200);
    assert.equal((await emi.get('/api/contacts/books')).statusCode, 404);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/carddav/' })).statusCode, 404);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/.well-known/carddav' })).statusCode, 404);
    assert.equal((await emi.get('/contacts', { accept: 'text/html' })).statusCode, 404);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'contacts.enabled': true })).statusCode, 200);
    assert.equal((await emi.get('/api/contacts/books')).statusCode, 200);
  });
});
