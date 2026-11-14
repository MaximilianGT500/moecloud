import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { outbox } from '../src/services/mail.ts';
import { Client, createApp, setUp } from './helpers.ts';

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const app = await createApp();
let emi: Client;

async function signIn(agent: string, device?: string) {
  const client = new Client(app);
  if (device) client.cookies.set('moe_device', device);
  await client.get('/login', { accept: 'text/html', 'user-agent': agent });
  const response = await client.send({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': 'unused', 'user-agent': agent },
    payload: new URLSearchParams({
      _csrf: client.cookies.get('moe_csrf')!,
      login: 'mia',
      password: 'passwort-von-mia',
      next: '/files',
    }).toString(),
  });
  assert.equal(response.statusCode, 303);
  await client.refreshCsrf();
  return client;
}

const alerts = async (client: Client) =>
  (await client.get('/api/notifications')).json().items.filter((item: { kind: string }) => item.kind === 'login_new');

before(async () => {
  emi = await setUp(app);
  const mail = await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  assert.equal(mail.statusCode, 200, mail.body);
  const created = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'passwort-von-mia',
  });
  assert.equal(created.statusCode, 200, created.body);
});

after(() => app.close());

describe('Anmeldung von einem neuen Gerät', () => {
  let laptop = '';

  it('merkt sich das erste Gerät ohne Meldung', async () => {
    const first = await signIn(FIREFOX);
    laptop = first.cookies.get('moe_device')!;
    assert.match(laptop, /^\w{40}$/);
    assert.equal((await alerts(first)).length, 0);
    const again = await signIn(FIREFOX, laptop);
    assert.equal((await alerts(again)).length, 0);
  });

  it('meldet ein unbekanntes Gerät in der Glocke und per E-Mail', async () => {
    const before = outbox.length;
    const phone = await signIn(SAFARI);
    const found = await alerts(phone);
    assert.equal(found.length, 1);
    assert.equal(found[0].title, 'Neue Anmeldung bei deinem Konto');
    assert.match(found[0].text, /^Safari auf iOS mit der IP-Adresse /);
    assert.equal(found[0].url, '/account#sitzungen');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mail = outbox.slice(before).find((entry) => entry.to === 'mia@example.com');
    assert.ok(mail);
    assert.match(mail.text, /Safari auf iOS/);
  });

  it('schickt keine E-Mail, wenn das abgeschaltet ist', async () => {
    const mia = await signIn(FIREFOX, laptop);
    const saved = await mia.json('PATCH', '/api/account/prefs', { mailLogins: false });
    assert.equal(saved.json().prefs.mailLogins, false);
    const before = outbox.length;
    const other = await signIn(FIREFOX);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(outbox.slice(before).filter((entry) => entry.to === 'mia@example.com').length, 0);
    assert.equal((await alerts(other)).length, 2);
  });

  it('vergisst fremde Geräte beim Abmelden aller anderen', async () => {
    const mia = await signIn(FIREFOX, laptop);
    const stranger = await signIn(SAFARI);
    const known = stranger.cookies.get('moe_device')!;
    const quiet = await signIn(SAFARI, known);
    const count = (await alerts(quiet)).length;
    const revoked = await mia.json('POST', '/api/account/sessions/revoke-others', {});
    assert.equal(revoked.statusCode, 200);
    assert.equal(mia.cookies.get('moe_device'), laptop);
    const back = await signIn(SAFARI, known);
    assert.equal((await alerts(back)).length, count + 1);
  });
});
