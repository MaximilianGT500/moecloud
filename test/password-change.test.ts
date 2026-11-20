import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { all, one, run } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';

const app = await createApp();
let emi: Client;
let address = 0;

const START = 'start-passwort-123';
const OWN = 'mein-eigenes-passwort-9';

const flagOf = (username: string) =>
  Number(one<{ must_change: number }>('SELECT must_change FROM users WHERE username = ?', username)?.must_change);

async function signIn(username: string, password: string) {
  const remoteAddress = `127.0.8.${(address++ % 250) + 1}`;
  const client = new Client(app);
  await client.send({ method: 'GET', url: '/login', headers: { accept: 'text/html' }, remoteAddress });
  const response = await client.send({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' }).toString(),
  });
  if (response.statusCode === 303) await client.refreshCsrf();
  return { client, response };
}

async function person(username: string, name: string, extra: Record<string, unknown> = {}) {
  const made = await emi.json('POST', '/api/admin/users', { username, name, email: `${username}@example.com`, password: START, ...extra });
  assert.equal(made.statusCode, 200, made.body);
  return made.json().user as { id: number; mustChange: boolean };
}

const change = (client: Client, fields: Record<string, string>) => client.form('/passwort', { _csrf: client.csrf, ...fields });

before(async () => {
  emi = await setUp(app);
  const mail = await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  assert.equal(mail.statusCode, 200, mail.body);
});

after(async () => {
  await app.close();
});

describe('Passwortwechsel bei der nächsten Anmeldung', () => {
  it('legt Konten mit fälligem Wechsel an und zeigt das in der Verwaltung', async () => {
    const mia = await person('mia', 'Mia', { mustChange: true });
    assert.equal(mia.mustChange, true);
    const lea = await person('lea', 'Lea');
    assert.equal(lea.mustChange, false);
    const list = (await emi.get('/api/admin/users')).json().items as { username: string; mustChange: boolean }[];
    assert.equal(list.find((entry) => entry.username === 'mia')?.mustChange, true);
    assert.equal(list.find((entry) => entry.username === 'emi')?.mustChange, false);
    const withoutPassword = await emi.json('POST', '/api/admin/users', {
      username: 'emily',
      name: 'Emily',
      email: 'emily@example.com',
      sendLink: true,
      mustChange: true,
    });
    assert.equal(withoutPassword.statusCode, 400, withoutPassword.body);
    assert.equal(one('SELECT 1 AS found FROM users WHERE username = ?', 'emily'), undefined);
  });

  it('lässt bis zum neuen Passwort nur den Wechsel zu', async () => {
    const { client: mia, response } = await signIn('mia', START);
    assert.equal(response.statusCode, 303);
    for (const url of ['/files', '/files/home', '/account', '/admin']) {
      const page = await mia.get(url, { accept: 'text/html' });
      assert.equal(page.statusCode, 302, url);
      assert.equal(page.headers.location, '/passwort', url);
    }
    const session = await mia.get('/api/session');
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().mustChangePassword, true);
    for (const [method, url, body] of [
      ['GET', '/api/account', undefined],
      ['GET', `/api/nodes/${session.json().user.rootId}/children`, undefined],
      ['GET', '/api/notifications', undefined],
      ['POST', '/api/account/app-passwords', { name: 'Laptop' }],
      ['PATCH', '/api/account', { name: 'Mia Sommer' }],
    ] as const) {
      const blocked = await mia.json(method, url, body);
      assert.equal(blocked.statusCode, 403, `${method} ${url}: ${blocked.body}`);
      assert.equal(blocked.json().error.code, 'password_change_required', url);
    }
    const shared = await mia.form('/share-target', { title: 'Notiz', text: 'Hallo' });
    assert.equal(shared.statusCode, 303);
    assert.equal(shared.headers.location, '/passwort');
    const page = await mia.get('/passwort', { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /action="\/passwort"/);
    assert.match(page.body, /name="current"/);
    assert.match(page.body, /Hallo Mia/);
    assert.equal(flagOf('mia'), 1);
  });

  it('prüft das bisherige und das neue Passwort', async () => {
    const { client: mia } = await signIn('mia', START);
    const foreign = await mia.form('/passwort', { _csrf: 'x'.repeat(32), current: START, password: OWN });
    assert.equal(foreign.statusCode, 403);
    const wrong = await change(mia, { current: 'falsch-falsch-falsch', password: OWN });
    assert.equal(wrong.statusCode, 400);
    assert.match(wrong.body, /Das aktuelle Passwort stimmt nicht/);
    const same = await change(mia, { current: START, password: START });
    assert.equal(same.statusCode, 400);
    assert.match(same.body, /muss sich vom alten unterscheiden/);
    const short = await change(mia, { current: START, password: 'kurz' });
    assert.equal(short.statusCode, 400);
    assert.match(short.body, /action="\/passwort"/);
    assert.equal(flagOf('mia'), 1);
    assert.equal((await mia.get('/api/account')).statusCode, 403);
  });

  it('gibt nach dem Wechsel alles frei und meldet andere Geräte ab', async () => {
    const { client: other } = await signIn('mia', START);
    const { client: mia } = await signIn('mia', START);
    const done = await change(mia, { current: START, password: OWN });
    assert.equal(done.statusCode, 303, done.body);
    assert.equal(done.headers.location, '/files');
    assert.equal(flagOf('mia'), 0);
    assert.equal((await mia.get('/files', { accept: 'text/html' })).statusCode, 200);
    assert.equal((await mia.get('/api/account')).statusCode, 200);
    assert.equal((await mia.get('/api/session')).json().mustChangePassword, false);
    assert.equal((await other.get('/api/session')).statusCode, 401);
    const again = await mia.get('/passwort', { accept: 'text/html' });
    assert.equal(again.statusCode, 302);
    assert.equal(again.headers.location, '/account#sicherheit');
    assert.equal((await signIn('mia', START)).response.statusCode, 401);
    assert.equal((await signIn('mia', OWN)).response.statusCode, 303);
    const logged = all<{ action: string }>(
      "SELECT action FROM audit WHERE action = 'password_changed' AND actor_id = (SELECT id FROM users WHERE username = 'mia')"
    );
    assert.equal(logged.length, 1);
  });

  it('nimmt das neue Passwort auch über die API an', async () => {
    const lea = await login(app, 'lea', START);
    const id = (await lea.get('/api/session')).json().user.id as number;
    const flagged = await emi.json('PATCH', `/api/admin/users/${id}`, { mustChange: true });
    assert.equal(flagged.statusCode, 200, flagged.body);
    assert.equal(flagged.json().user.mustChange, true);
    assert.equal((await lea.get('/api/account')).statusCode, 403);
    const same = await lea.json('POST', '/api/account/password', { current: START, next: START });
    assert.equal(same.statusCode, 400, same.body);
    const done = await lea.json('POST', '/api/account/password', { current: START, next: OWN });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(flagOf('lea'), 0);
    assert.equal((await lea.get('/api/account')).statusCode, 200);
  });

  it('lässt Admins den Wechsel nachträglich verlangen und zurücknehmen', async () => {
    const { client: mia } = await signIn('mia', OWN);
    const id = (await mia.get('/api/session')).json().user.id as number;
    const me = (await emi.get('/api/session')).json().user.id as number;
    assert.equal((await emi.json('PATCH', `/api/admin/users/${me}`, { mustChange: true })).statusCode, 400);
    assert.equal(flagOf('emi'), 0);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { mustChange: true })).statusCode, 200);
    assert.equal((await mia.get('/api/account')).statusCode, 403);
    const fields = all<{ details: string }>("SELECT details FROM audit WHERE action = 'user_updated' AND subject_id = ?", id).map(
      (row) => JSON.parse(row.details).fields as string[]
    );
    assert.ok(fields.some((list) => list.includes('mustChange')));
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { mustChange: false })).json().user.mustChange, false);
    assert.equal((await mia.get('/api/account')).statusCode, 200);
    const reset = await emi.json('PATCH', `/api/admin/users/${id}`, { password: START, mustChange: true });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(flagOf('mia'), 1);
    run('UPDATE users SET password_hash = NULL, must_change = 0 WHERE username = ?', 'lea');
    const lea = one<{ id: number }>('SELECT id FROM users WHERE username = ?', 'lea')!.id;
    const noPassword = await emi.json('PATCH', `/api/admin/users/${lea}`, { mustChange: true });
    assert.equal(noPassword.statusCode, 400, noPassword.body);
    assert.equal(flagOf('lea'), 0);
  });

  it('lässt App-Passwörter weiterarbeiten und hebt die Pflicht beim Zurücksetzen per E-Mail auf', async () => {
    const id = one<{ id: number }>('SELECT id FROM users WHERE username = ?', 'mia')!.id;
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { mustChange: false })).statusCode, 200);
    const { client: mia } = await signIn('mia', START);
    const made = await mia.json('POST', '/api/account/app-passwords', { name: 'Laptop' });
    assert.equal(made.statusCode, 200, made.body);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { mustChange: true })).statusCode, 200);
    const device = new Client(app);
    device.basic = `Basic ${Buffer.from(`mia:${made.json().token}`).toString('base64')}`;
    assert.equal((await device.get('/api/account')).statusCode, 200);
    assert.equal((await mia.get('/api/account')).statusCode, 403);

    outbox.length = 0;
    const visitor = new Client(app);
    await visitor.get('/forgot', { accept: 'text/html' });
    const asked = await visitor.form('/forgot', { _csrf: visitor.cookies.get('moe_csrf')!, login: 'mia' });
    assert.ok(asked.statusCode < 400, asked.body);
    let link = '';
    for (let attempt = 0; attempt < 40 && !link; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      link = /\/reset\?token=([\w-]+)/.exec(outbox.map((mail) => mail.text).join('\n'))?.[1] ?? '';
    }
    assert.ok(link, 'kein Link in der E-Mail');
    const reset = await visitor.form('/reset', {
      _csrf: visitor.cookies.get('moe_csrf')!,
      token: link,
      password: 'noch-ein-neues-passwort-4',
    });
    assert.equal(reset.statusCode, 303, reset.body);
    assert.equal(flagOf('mia'), 0);
  });

  it('verlangt den Wechsel auf Wunsch für alle Konten aus einer CSV-Datei', async () => {
    const csv = ['username,name,password', `emily,Emily,${START}`].join('\n');
    const kept = await emi.json('POST', '/api/admin/users/import', { csv, apply: true, mustChange: true });
    assert.equal(kept.statusCode, 200, kept.body);
    assert.equal(kept.json().created, 1);
    assert.equal(flagOf('emily'), 1);
    const { client: emily, response } = await signIn('emily', START);
    assert.equal(response.statusCode, 303);
    assert.equal((await emily.get('/files', { accept: 'text/html' })).headers.location, '/passwort');
  });
});
