import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { parseVCards, readContact } from '../src/contacts/vcard.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let miaId = 0;
let leaId = 0;
let bookId = '';
let contactId = '';
let fileId = '';

const basic = (username: string, token: string) => `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;

const blank = {
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
};

before(async () => {
  emi = await setUp(app);
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  leaId = (
    await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123', role: 'guest' })
  ).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
  bookId = (await emi.get('/api/contacts/books')).json().books[0].id;
  contactId = (
    await emi.json('POST', '/api/contacts', {
      bookId,
      data: {
        ...blank,
        given: 'Geheime',
        family: 'Quelle',
        emails: [{ type: 'home', value: 'quelle@example.org' }],
        birthday: '1980-02-03',
      },
    })
  ).json().contact.id;
  const root = (await emi.get('/api/session')).json().user.rootId as string;
  fileId = (await emi.upload(root, 'Adressen.vcf', Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Privat\r\nEND:VCARD\r\n'))).json().node.id;
});

after(() => app.close());

describe('Kontakte gegen fremden Zugriff', () => {
  it('lässt fremde Adressbücher und Kontakte nicht lesen oder ändern', async () => {
    assert.equal((await mia.get(`/api/contacts/${contactId}`)).statusCode, 404);
    assert.equal((await mia.get(`/api/contacts/${contactId}/vcard`)).statusCode, 404);
    assert.equal((await mia.get(`/api/contacts/${contactId}/photo`)).statusCode, 404);
    assert.equal((await mia.json('PUT', `/api/contacts/${contactId}`, { data: { ...blank, given: 'Gekapert' } })).statusCode, 404);
    assert.equal((await mia.send({ method: 'DELETE', url: `/api/contacts/${contactId}` })).statusCode, 404);
    assert.equal((await mia.json('POST', `/api/contacts/${contactId}/favorite`, { favorite: true })).statusCode, 404);
    assert.equal((await mia.json('POST', '/api/contacts/delete', { ids: [contactId] })).statusCode, 404);
    assert.equal((await mia.json('POST', '/api/contacts/labels', { ids: [contactId], label: 'Meins' })).statusCode, 404);
    const own = (await mia.get('/api/contacts/books')).json().books[0].id as string;
    assert.equal((await mia.json('POST', '/api/contacts/move', { ids: [contactId], book: own })).statusCode, 404);
    assert.equal((await mia.json('POST', '/api/contacts/merge', { ids: [contactId, contactId] })).statusCode, 400);
    assert.equal((await mia.json('PATCH', `/api/contacts/books/${bookId}`, { name: 'Meins' })).statusCode, 404);
    assert.equal((await mia.json('PUT', `/api/contacts/books/${bookId}/shares/${miaId}`, { permission: 'write' })).statusCode, 404);
    assert.equal((await mia.get(`/api/contacts/books/${bookId}/shares`)).statusCode, 404);
    assert.equal((await mia.get(`/api/contacts/export?book=${bookId}`)).statusCode, 404);
    const byIds = await mia.get(`/api/contacts/export?ids=${contactId}`);
    assert.doesNotMatch(byIds.body, /Geheime/);
    assert.equal((await mia.get(`/api/contacts?book=${bookId}`)).json().items.length, 0);
    assert.equal((await mia.get('/api/contacts?q=geheime')).json().items.length, 0);
    assert.equal((await mia.get('/api/contacts/suggest?q=quelle')).json().items.length, 0);
    assert.equal((await mia.get('/api/contacts/birthdays?from=2027-01-01&to=2027-12-31')).json().items.length, 0);
    assert.equal((await mia.get('/api/calendar/people?q=quelle&contacts=1')).json().contacts.length, 0);
    assert.equal((await mia.json('POST', '/api/contacts/import', { node: fileId })).statusCode, 404);
  });

  it('teilt nicht mit Gastkonten und sperrt Gäste aus', async () => {
    assert.equal((await emi.json('PUT', `/api/contacts/books/${bookId}/shares/${leaId}`, { permission: 'read' })).statusCode, 404);
    assert.equal((await lea.get('/api/contacts/books')).statusCode, 403);
    assert.equal((await lea.get('/contacts', { accept: 'text/html' })).statusCode, 404);
  });

  it('trennt CardDAV nach Konten und achtet auf schreibgeschützte App-Passwörter', async () => {
    const token = (await mia.json('POST', '/api/account/app-passwords', { name: 'Telefon' })).json().token as string;
    const dav = new Client(app);
    dav.basic = basic('mia', token);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/carddav/addressbooks/emi/', headers: { depth: '1' } })).statusCode, 403);
    assert.equal((await dav.send({ method: 'PROPFIND', url: '/carddav/principals/emi/', headers: { depth: '0' } })).statusCode, 403);
    const foreign = await dav.send({ method: 'PROPFIND', url: `/carddav/addressbooks/mia/s-${bookId}/`, headers: { depth: '1' } });
    assert.equal(foreign.statusCode, 404);
    assert.doesNotMatch(foreign.body, /Geheime/);
    const report = await dav.send({
      method: 'REPORT',
      url: `/carddav/addressbooks/mia/s-${bookId}/`,
      headers: { 'content-type': 'application/xml' },
      payload: '<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:prop><d:getetag/></d:prop></d:sync-collection>',
    });
    assert.doesNotMatch(report.body, /Geheime/);
    const readOnly = (await emi.json('POST', '/api/account/app-passwords', { name: 'Lesen', readOnly: true })).json().token as string;
    const reader = new Client(app);
    reader.basic = basic('emi', readOnly);
    const put = await reader.send({
      method: 'PUT',
      url: '/carddav/addressbooks/emi/contacts/neu.vcf',
      headers: { 'content-type': 'text/vcard' },
      payload: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:neu\r\nFN:Neu\r\nEND:VCARD\r\n',
    });
    assert.equal(put.statusCode, 403);
    assert.equal((await reader.send({ method: 'MKCOL', url: '/carddav/addressbooks/emi/neu/' })).statusCode, 403);
    assert.equal((await new Client(app).send({ method: 'PROPFIND', url: '/carddav/' })).statusCode, 401);
    const guestToken = (await lea.json('POST', '/api/account/app-passwords', { name: 'Gast' })).json().token as string | undefined;
    if (guestToken) {
      const guest = new Client(app);
      guest.basic = basic('lea', guestToken);
      assert.equal((await guest.send({ method: 'PROPFIND', url: '/carddav/' })).statusCode, 403);
    }
  });

  it('lässt keine fremden Zeilen in vCards und CSV einschleusen', async () => {
    const made = await emi.json('POST', '/api/contacts', {
      bookId,
      data: {
        ...blank,
        given: 'Mia\r\nEMAIL:boese@example.com',
        family: '=HYPERLINK("http://example.com")',
        note: 'Zeile\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Eingeschleust',
        phones: [{ type: 'mobile', value: '+49 170 1\nTEL:999' }],
        urls: [{ type: 'home', value: 'https://example.com\r\nX-EVIL:1' }],
        categories: ['a,b', 'c;d'],
      },
    });
    assert.equal(made.statusCode, 200, made.body);
    const id = made.json().contact.id as string;
    const vcard = (await emi.get(`/api/contacts/${id}/vcard`)).body;
    const cards = parseVCards(vcard);
    assert.equal(cards.length, 1);
    assert.ok(!cards[0].props.some((prop) => prop.name === 'X-EVIL' || (prop.name === 'EMAIL' && /boese/.test(prop.value))));
    const data = readContact(cards[0]);
    assert.equal(data.emails.length, 0);
    assert.equal(data.phones.length, 1);
    assert.deepEqual(data.categories, ['a,b', 'c;d']);
    const csv = (await emi.get(`/api/contacts/export?ids=${id}&format=csv`)).body;
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/example\.com""\)"/);
    const download = await emi.get(`/api/contacts/${id}/vcard`);
    assert.match(String(download.headers['content-disposition']), /^attachment/);
  });

  it('liefert als Foto nur echte Bilder aus', async () => {
    const token = (await emi.json('POST', '/api/account/app-passwords', { name: 'Fotos' })).json().token as string;
    const dav = new Client(app);
    dav.basic = basic('emi', token);
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    const put = await dav.send({
      method: 'PUT',
      url: '/carddav/addressbooks/emi/contacts/foto.vcf',
      headers: { 'content-type': 'text/vcard' },
      payload: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:foto\r\nFN:Foto\r\nPHOTO;ENCODING=b;TYPE=JPEG:${html}\r\nEND:VCARD\r\n`,
    });
    assert.equal(put.statusCode, 201, put.body);
    const found = (await emi.get('/api/contacts?q=foto')).json().items as { id: string; photo: string | null }[];
    assert.equal(found[0].photo, null);
    assert.equal((await emi.get(`/api/contacts/${found[0].id}/photo`)).statusCode, 404);
    const big = await dav.send({
      method: 'PUT',
      url: '/carddav/addressbooks/emi/contacts/gross.vcf',
      headers: { 'content-type': 'text/vcard' },
      payload: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:gross\r\nFN:Gross\r\nNOTE:${'x'.repeat(5_300_000)}\r\nEND:VCARD\r\n`,
    });
    assert.equal(big.statusCode, 403);
  });
});
