import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { outbox } from '../src/services/mail.ts';
import { parseCsv } from '../src/services/userimport.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;

const CSV = [
  'Benutzername;Name;E-Mail;Rolle;Speicher;Passwort;Sprache',
  'lea;Lea;lea@example.com;user;10 GB;passwort-von-lea;en',
  'emily;Emily;emily@example.com;admin;;;',
  'emi;Emi Doppelt;;;;passwort-egal-123;',
  'x;Kurz;;;;passwort-von-x;',
  '"mia";"Mia, die ""Zweite""";mia@example.com;Mitglied;1,5 GB;passwort-von-mia;de',
  'lea;Lea Doppelt;;;;passwort-von-lea2;',
].join('\r\n');

type Line = { line: number; username: string; status: string; message: string | null; quota: number | null; sent?: boolean };

before(async () => {
  emi = await setUp(app);
});

after(() => app.close());

describe('Personen aus CSV importieren', () => {
  it('liest Anführungszeichen, Semikolons und Zeilenumbrüche', () => {
    assert.deepEqual(parseCsv('a,b\n"x, y","z ""q"""\n\n1,2'), [
      ['a', 'b'],
      ['x, y', 'z "q"'],
      ['1', '2'],
    ]);
    assert.deepEqual(parseCsv('﻿name;username\r\nLea;lea'), [
      ['name', 'username'],
      ['Lea', 'lea'],
    ]);
  });

  it('zeigt vorher, was passieren würde', async () => {
    const preview = await emi.json('POST', '/api/admin/users/import', { csv: CSV });
    assert.equal(preview.statusCode, 200, preview.body);
    const lines: Line[] = preview.json().lines;
    assert.deepEqual(
      lines.map((line) => [line.line, line.username, line.status]),
      [
        [2, 'lea', 'ready'],
        [3, 'emily', 'error'],
        [4, 'emi', 'skipped'],
        [5, 'x', 'error'],
        [6, 'mia', 'ready'],
        [7, 'lea', 'error'],
      ]
    );
    assert.equal(lines[1].message, 'Ohne E-Mail-Versand braucht jede Person ein Passwort');
    assert.equal(lines[2].message, 'Den Benutzernamen gibt es schon');
    assert.equal(lines[3].message, 'Der Benutzername braucht mindestens 3 Zeichen');
    assert.equal(lines[4].quota, Math.round(1.5 * 1024 ** 3));
    assert.equal(lines[5].message, 'Der Benutzername steht mehrfach in der Datei');
    assert.equal((await emi.get('/api/admin/users')).json().items.length, 1);
  });

  it('legt die Personen an und schickt Links', async () => {
    await emi.json('PATCH', '/api/admin/mail', {
      'mail.enabled': true,
      'mail.host': 'smtp.example.com',
      'mail.port': 587,
      'mail.from': 'cloud@example.com',
    });
    const done = await emi.json('POST', '/api/admin/users/import', { csv: CSV, sendLinks: true, apply: true });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().created, 3);
    const lines: Line[] = done.json().lines;
    assert.deepEqual(
      lines.filter((line) => line.status === 'created').map((line) => [line.username, Boolean(line.sent)]),
      [
        ['lea', false],
        ['emily', true],
        ['mia', false],
      ]
    );
    assert.ok(outbox.some((mail) => mail.to === 'emily@example.com'));
    const people = (await emi.get('/api/admin/users')).json().items as {
      username: string;
      role: string;
      quota: number | null;
      name: string;
    }[];
    const find = (name: string) => people.find((person) => person.username === name)!;
    assert.equal(find('lea').quota, 10 * 1024 ** 3);
    assert.equal(find('emily').role, 'admin');
    assert.equal(find('mia').name, 'Mia, die "Zweite"');
    const lea = await login(app, 'lea', 'passwort-von-lea');
    assert.equal((await lea.get('/api/session')).json().user.username, 'lea');
    assert.equal((await lea.json('POST', '/api/admin/users/import', { csv: CSV })).statusCode, 403);
    const log = (await emi.get('/api/admin/audit?action=users_imported')).json();
    assert.ok(JSON.stringify(log).includes('users_imported'));
  });

  it('verlangt die nötigen Spalten', async () => {
    const response = await emi.json('POST', '/api/admin/users/import', { csv: 'email\nlea@example.com' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.message, 'Die Kopfzeile braucht mindestens die Spalten username und name');
  });
});
