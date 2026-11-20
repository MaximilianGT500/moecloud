import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { all, one } from '../src/lib/db.ts';
import { audit } from '../src/services/audit.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaId = 0;

const BOM = String.fromCharCode(0xfeff);

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') value += char;
  }
  return rows;
}

async function exported(query = '', client = emi) {
  const response = await client.get(`/api/admin/audit/export${query}`);
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.body.startsWith(BOM), 'ohne BOM');
  const [header, ...rows] = parseCsv(response.body.slice(1));
  return { response, header, rows };
}

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: '=HYPERLINK("http://example.com";"Mia")',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  miaId = made.json().user.id;
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
});

after(async () => {
  await app.close();
});

describe('Protokoll als CSV', () => {
  it('liefert alle Ereignisse als Datei zum Herunterladen', async () => {
    const { response, header, rows } = await exported();
    assert.match(String(response.headers['content-type']), /^text\/csv; charset=utf-8/);
    assert.match(String(response.headers['content-disposition']), /^attachment; filename="moecloud-protokoll-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(header, ['Zeit', 'Ereignis', 'Benutzername', 'Name', 'Betrifft', 'Adresse', 'Details']);
    const total = Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE action != 'audit_exported'")!.n);
    assert.equal(rows.length, total);
    assert.ok(rows.every((row) => row.length === 7 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row[0])));
    const created = rows.find((row) => row[1] === 'user_created');
    assert.deepEqual(created?.slice(2, 5), ['emi', 'Emi', 'mia']);
    assert.equal(JSON.parse(created![6]).role, 'user');
    assert.ok(rows.some((row) => row[1] === 'login' && row[2] === 'mia'));
  });

  it('nimmt Zellen die Wirkung, die eine Tabellenkalkulation als Formel lesen würde', async () => {
    audit('settings_changed', { actor: miaId, details: { keys: ['"zitat"', 'zeile\numbruch'] } });
    const { response, rows } = await exported(`?user=${miaId}`);
    const own = rows.filter((row) => row[2] === 'mia');
    assert.ok(own.length >= 2);
    assert.deepEqual([...new Set(own.map((row) => row[3]))], [`'=HYPERLINK("http://example.com";"Mia")`]);
    assert.ok(response.body.includes(`"'=HYPERLINK(""http://example.com"";""Mia"")"`));
    assert.ok(!/(^|,|\n)"[=+\-@\t\r]/.test(response.body.slice(1)), 'eine Zelle beginnt mit einem Formelzeichen');
    const details = rows.find((row) => row[1] === 'settings_changed')![6];
    assert.deepEqual(JSON.parse(details).keys, ['"zitat"', 'zeile\numbruch']);
    for (const start of ['+1', '-1', '@x', '\tx', '\rx']) {
      audit('settings_changed', { actor: miaId, details: null as never, ip: start } as never);
    }
    const again = await exported(`?user=${miaId}`);
    assert.ok(!/(^|,|\n)"[=+\-@\t\r]/.test(again.response.body.slice(1)));
  });

  it('filtert wie die Liste nach Person und Bereich', async () => {
    const failed = new Client(app);
    await failed.get('/login', { accept: 'text/html' });
    await failed.form('/login', { _csrf: failed.cookies.get('moe_csrf')!, login: 'mia', password: 'falsch-falsch', next: '/files' });
    const onlyFailed = await exported('?action=login_failed');
    assert.ok(onlyFailed.rows.length >= 1);
    assert.ok(onlyFailed.rows.every((row) => row[1] === 'login_failed'));
    const both = await exported('?action=login_failed,login,gibt_es_nicht');
    assert.ok(both.rows.every((row) => row[1] === 'login_failed' || row[1] === 'login'));
    assert.ok(both.rows.length > onlyFailed.rows.length);
    const person = await exported(`?user=${miaId}&action=login`);
    assert.ok(person.rows.length >= 1);
    assert.ok(person.rows.every((row) => row[1] === 'login' && row[2] === 'mia'));
    const odd = await exported('?user=abc&action=');
    assert.ok(odd.rows.length > both.rows.length);
  });

  it('holt auch lange Protokolle vollständig', async () => {
    for (let index = 0; index < 450; index++) audit('link_removed', { actor: miaId, details: { index } });
    const { rows } = await exported('?action=link_removed');
    assert.equal(rows.length, 450);
    assert.deepEqual(
      rows.map((row) => JSON.parse(row[6]).index),
      Array.from({ length: 450 }, (_, index) => 449 - index)
    );
  });

  it('gehört nur Admins und vermerkt jeden Abruf', async () => {
    assert.equal((await mia.get('/api/admin/audit/export')).statusCode, 403);
    assert.equal((await new Client(app).get('/api/admin/audit/export')).statusCode, 401);
    const token = await emi.json('POST', '/api/account/app-passwords', { name: 'Ohne Verwaltung' });
    const device = new Client(app);
    device.basic = `Basic ${Buffer.from(`emi:${token.json().token}`).toString('base64')}`;
    assert.equal((await device.get('/api/admin/audit/export')).statusCode, 403);
    const before = all("SELECT id FROM audit WHERE action = 'audit_exported'").length;
    const { rows } = await exported('?action=login');
    const logged = all<{ details: string }>("SELECT details FROM audit WHERE action = 'audit_exported' ORDER BY id DESC");
    assert.equal(logged.length, before + 1);
    assert.equal(JSON.parse(logged[0].details).rows, rows.length);
    const listed = (await emi.get('/api/admin/audit?action=audit_exported')).json().items;
    assert.equal(listed[0].action, 'audit_exported');
  });
});
