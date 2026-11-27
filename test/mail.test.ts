import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import MailComposer from 'nodemailer/lib/mail-composer';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, setUp } from './helpers.ts';
import { imapSink } from './imap.ts';
import { smtpSink } from './smtp.ts';

const app = await createApp();
const imap = await imapSink({ user: 'emi@example.com', pass: 'imap-geheim' });
const smtp = await smtpSink();
let emi: Client;
let accountId = '';

async function mime(options: ConstructorParameters<typeof MailComposer>[0]) {
  return new MailComposer({ disableFileAccess: true, disableUrlAccess: true, ...options }).compile().build();
}

const INVITE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:ramen-abend-1@example.com',
  'DTSTAMP:20261120T100000Z',
  'DTSTART:20261204T180000Z',
  'DTEND:20261204T200000Z',
  'SUMMARY:Ramen-Abend',
  'LOCATION:Kirschblüte',
  'ORGANIZER;CN=Mia Weber:mailto:mia@example.com',
  'ATTENDEE;CN=Emi;PARTSTAT=NEEDS-ACTION:mailto:emi@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

before(async () => {
  emi = await setUp(app);
  settings.set('webmail.private', true);
  imap.add(
    'INBOX',
    await mime({
      from: { name: 'Mia Weber', address: 'mia@example.com' },
      to: 'emi@example.com',
      subject: 'Fotos vom Wochenende',
      text: 'Hallo Emi,\nhier sind die Fotos. https://example.com/album',
      html: '<p>Hallo Emi,</p><p>hier sind die <b>Fotos</b>.</p><img src="https://example.com/pixel.png" alt=""><script>alert(1)</script>',
      attachments: [{ filename: 'strand.txt', content: 'Sand und Meer' }],
      messageId: '<fotos-1@example.com>',
    }),
    [],
    new Date('2026-11-20T09:00:00Z')
  );
  imap.add(
    'INBOX',
    await mime({
      from: { name: 'Lea', address: 'lea@example.com' },
      to: 'emi@example.com',
      subject: 'Einladung: Ramen-Abend',
      text: 'Kommst du mit?',
      icalEvent: { method: 'REQUEST', content: INVITE },
      messageId: '<ramen-1@example.com>',
    }),
    ['\\Seen'],
    new Date('2026-11-21T09:00:00Z')
  );
});

after(async () => {
  await imap.close();
  await smtp.close();
  await app.close();
});

const account = (path = '') => `/api/mail/accounts/${accountId}${path}`;

describe('E-Mail', () => {
  it('lehnt falsche Zugangsdaten und Server im lokalen Netz ab', async () => {
    const wrong = await emi.json('POST', '/api/mail/accounts', {
      email: 'emi@example.com',
      password: 'falsch',
      imap: { host: '127.0.0.1', port: imap.port, security: 'none' },
      smtp: { host: '127.0.0.1', port: smtp.port, security: 'none' },
    });
    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.match(wrong.json().error.message, /IMAP/);
    settings.set('webmail.private', false);
    try {
      const blocked = await emi.json('POST', '/api/mail/accounts', {
        email: 'emi@example.com',
        password: 'imap-geheim',
        imap: { host: '127.0.0.1', port: imap.port, security: 'tls' },
        smtp: { host: '127.0.0.1', port: 465, security: 'tls' },
      });
      assert.equal(blocked.statusCode, 400, blocked.body);
      assert.equal(blocked.json().error.code, 'mail_port');
      const local = await emi.json('POST', '/api/mail/accounts', {
        email: 'emi@example.com',
        password: 'imap-geheim',
        imap: { host: '127.0.0.1', port: 993, security: 'tls' },
        smtp: { host: '127.0.0.1', port: 465, security: 'tls' },
      });
      assert.equal(local.json().error.code, 'mail_private');
    } finally {
      settings.set('webmail.private', true);
    }
  });

  it('richtet ein Postfach ein und zeigt Ordner', async () => {
    const suggestion = await emi.get('/api/mail/setup?email=emi%40gmx.de');
    assert.equal(suggestion.json().suggestion.imap.host, 'imap.gmx.net');
    const created = await emi.json('POST', '/api/mail/accounts', {
      name: 'Privat',
      email: 'emi@example.com',
      displayName: 'Emi Sommer',
      password: 'imap-geheim',
      imap: { host: '127.0.0.1', port: imap.port, security: 'none' },
      smtp: { host: '127.0.0.1', port: smtp.port, security: 'none' },
    });
    assert.equal(created.statusCode, 200, created.body);
    const presented = created.json().account;
    accountId = presented.id;
    assert.equal(presented.name, 'Privat');
    assert.equal(JSON.stringify(presented).includes('imap-geheim'), false, 'das Passwort bleibt auf dem Server');
    const folders = await emi.get(account('/folders'));
    assert.equal(folders.statusCode, 200, folders.body);
    const roles = Object.fromEntries(folders.json().folders.map((folder: { role: string; path: string }) => [folder.role, folder.path]));
    assert.equal(roles.inbox, 'INBOX');
    assert.equal(roles.sent, 'Sent');
    assert.equal(roles.trash, 'Trash');
    const inbox = folders.json().folders.find((folder: { role: string }) => folder.role === 'inbox');
    assert.equal(inbox.unseen, 1);
  });

  it('listet, liest und schützt vor fremden Inhalten', async () => {
    const list = await emi.get(account('/messages?folder=INBOX'));
    assert.equal(list.statusCode, 200, list.body);
    const items = list.json().items;
    assert.equal(items.length, 2);
    assert.equal(items[0].subject, 'Einladung: Ramen-Abend');
    assert.equal(items[1].subject, 'Fotos vom Wochenende');
    assert.equal(items[1].from[0].name, 'Mia Weber');
    assert.equal(items[1].seen, false);
    assert.equal(items[1].attachments, true);
    const uid = items[1].uid;
    const read = await emi.get(account(`/message?folder=INBOX&uid=${uid}`));
    assert.equal(read.statusCode, 200, read.body);
    const message = read.json().message;
    assert.equal(message.subject, 'Fotos vom Wochenende');
    assert.equal(message.remote, true);
    assert.deepEqual(
      message.attachments.map((entry: { name: string }) => entry.name),
      ['strand.txt']
    );
    assert.equal(
      imap.boxes
        .get('INBOX')!
        .messages.find((entry) => entry.uid === uid)!
        .flags.has('\\Seen'),
      true
    );
    const body = await emi.get(account(`/body?folder=INBOX&uid=${uid}`));
    assert.equal(body.statusCode, 200);
    assert.match(String(body.headers['content-security-policy']), /sandbox/);
    assert.match(String(body.headers['content-security-policy']), /img-src data:;/);
    assert.equal(body.body.includes('<script'), false);
    const images = await emi.get(account(`/body?folder=INBOX&uid=${uid}&images=1`));
    assert.match(images.body, /\/api\/proxy\/image\?u=/);
    const attachment = await emi.get(account(`/attachment?folder=INBOX&uid=${uid}&index=0`));
    assert.equal(attachment.body, 'Sand und Meer');
    assert.match(String(attachment.headers['content-disposition']), /attachment/);
    const saved = await emi.json('POST', account('/save'), { folder: 'INBOX', uid, indexes: [0] });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().nodes[0].name, 'strand.txt');
    const search = await emi.get(account('/messages?folder=INBOX&q=Ramen'));
    assert.equal(search.json().items.length, 1);
  });

  it('übernimmt Einladungen in den Kalender', async () => {
    const list = await emi.get(account('/messages?folder=INBOX'));
    const uid = list.json().items[0].uid;
    const read = await emi.get(account(`/message?folder=INBOX&uid=${uid}`));
    const invite = read.json().message.invite;
    assert.equal(invite.summary, 'Ramen-Abend');
    assert.equal(invite.method, 'REQUEST');
    const calendars = await emi.get('/api/calendar/calendars');
    const calendar = calendars.json().calendars[0].id;
    const imported = await emi.json('POST', account('/invite'), { folder: 'INBOX', uid, calendar });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.equal(imported.json().result.created, 1);
  });

  it('markiert, verschiebt, archiviert und löscht', async () => {
    const uids = (await emi.get(account('/messages?folder=INBOX'))).json().items.map((item: { uid: number }) => item.uid);
    const flagged = await emi.json('POST', account('/flags'), { folder: 'INBOX', uids: [uids[0]], flagged: true, seen: false });
    assert.equal(flagged.statusCode, 200, flagged.body);
    const filtered = await emi.get(account('/messages?folder=INBOX&filter=flagged'));
    assert.equal(filtered.json().items.length, 1);
    const archived = await emi.json('POST', account('/archive'), { folder: 'INBOX', uids: [uids[0]] });
    assert.equal(archived.statusCode, 200, archived.body);
    assert.equal(archived.json().folder, 'Archive');
    assert.equal(imap.boxes.get('Archive')!.messages.length, 1);
    const deleted = await emi.json('POST', account('/delete'), { folder: 'INBOX', uids: [uids[1]] });
    assert.equal(deleted.json().result, 'trashed');
    assert.equal(imap.boxes.get('Trash')!.messages.length, 1);
    const trashUid = imap.boxes.get('Trash')!.messages[0].uid;
    const gone = await emi.json('POST', account('/delete'), { folder: 'Trash', uids: [trashUid] });
    assert.equal(gone.json().result, 'deleted');
    assert.equal(imap.boxes.get('Trash')!.messages.length, 0);
    assert.equal(imap.boxes.get('INBOX')!.messages.length, 0);
  });

  it('sendet mit Anhängen aus den Dateien und legt eine Kopie ab', async () => {
    const rootId = (await emi.get('/api/session')).json().user.rootId;
    const uploaded = await emi.upload(rootId, 'menü.txt', Buffer.from('Ramen, Gyoza, Matcha'));
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const node = uploaded.json().node.id;
    const sent = await emi.json('POST', account('/send'), {
      to: [{ name: 'Mia', address: 'mia@example.com' }],
      cc: [],
      bcc: [{ name: '', address: 'lea@example.com' }],
      subject: 'Speisekarte',
      text: 'Hier ist die Karte.',
      attachments: [{ kind: 'node', node }],
    });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().sent, true);
    const received = await smtp.mailTo('mia@example.com');
    assert.match(received, /Subject: Speisekarte/);
    assert.match(received, /menü\.txt|men=C3=BC\.txt|=\?UTF-8\?/i);
    assert.equal(/^Bcc:/im.test(received), false, 'Bcc bleibt geheim');
    const copy = imap.boxes.get('Sent')!.messages.at(-1)!;
    assert.match(copy.raw.toString(), /Bcc: lea@example.com/);
    assert.equal(copy.flags.has('\\Seen'), true);
    const recipients = await emi.get('/api/mail/recipients?q=mi');
    assert.equal(recipients.json().recipients[0].address, 'mia@example.com');
  });

  it('plant Mails, nimmt sie zurück und hebt Entwürfe auf', async () => {
    const later = await emi.json('POST', account('/send'), {
      to: [{ name: 'Lea', address: 'lea@example.com' }],
      subject: 'Später',
      text: 'Kommt morgen an.',
      sendAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    assert.equal(later.statusCode, 200, later.body);
    assert.equal(later.json().sent, false);
    const queued = later.json().queued.id;
    assert.equal((await emi.get('/api/mail/outbox')).json().outbox.length, 1);
    assert.equal((await emi.json('DELETE', `/api/mail/outbox/${queued}`)).statusCode, 200);
    assert.equal((await emi.get('/api/mail/outbox')).json().outbox.length, 0);
    const soon = await emi.json('POST', account('/send'), {
      to: [{ name: 'Lea', address: 'lea@example.com' }],
      subject: 'Gleich',
      text: 'Gleich da.',
      sendAt: Date.now() + 5000,
    });
    assert.equal(soon.json().sent, false);
    const { flushOutbox } = await import('../src/mail/compose.ts');
    assert.equal(await flushOutbox(Date.now() + 10_000), 1);
    assert.match(await smtp.mailTo('lea@example.com'), /Subject: Gleich/);
    const draft = await emi.json('POST', account('/drafts'), {
      to: [{ name: '', address: 'mia@example.com' }],
      subject: 'Entwurf',
      text: 'Noch nicht fertig',
    });
    assert.equal(draft.statusCode, 200, draft.body);
    assert.equal(draft.json().draft.folder, 'Drafts');
    const again = await emi.json('POST', account('/drafts'), {
      to: [{ name: '', address: 'mia@example.com' }],
      subject: 'Entwurf',
      text: 'Jetzt fertig',
      draft: draft.json().draft,
    });
    assert.equal(imap.boxes.get('Drafts')!.messages.length, 1);
    assert.match(imap.boxes.get('Drafts')!.messages[0].raw.toString(), /Jetzt fertig/);
    assert.equal(imap.boxes.get('Drafts')!.messages[0].flags.has('\\Draft'), true);
    assert.ok(again.json().draft.uid);
  });

  it('meldet neue Mails und zählt ungelesene', async () => {
    const { checkNewMail } = await import('../src/mail/unread.ts');
    await checkNewMail();
    imap.add(
      'INBOX',
      await mime({ from: { name: 'Mia Weber', address: 'mia@example.com' }, to: 'emi@example.com', subject: 'Noch eine Frage', text: '?' })
    );
    assert.equal(await checkNewMail(), 1);
    const notes = await emi.get('/api/notifications');
    const latest = notes.json().items?.[0] ?? notes.json().notifications?.[0];
    assert.match(JSON.stringify(latest), /Mia Weber/);
    const badges = await emi.get('/api/badges');
    assert.equal(badges.json().mail, 1);
  });

  it('gibt fremde Postfächer nicht heraus', async () => {
    const made = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
    assert.equal(made.statusCode, 200, made.body);
    const { login } = await import('./helpers.ts');
    const mia = await login(app, 'mia', 'mias-passwort-123');
    assert.equal((await mia.get(account('/folders'))).statusCode, 404);
    assert.equal((await mia.get(account('/messages?folder=INBOX'))).statusCode, 404);
    assert.deepEqual((await mia.get('/api/mail/accounts')).json().accounts, []);
    settings.set('webmail.enabled', false);
    try {
      assert.equal((await emi.get('/api/mail/accounts')).statusCode, 404);
    } finally {
      settings.set('webmail.enabled', true);
    }
  });
});
