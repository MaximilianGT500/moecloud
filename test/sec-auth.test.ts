import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { hotp, totpCounter } from '../src/lib/crypto.ts';
import { all, one, run } from '../src/lib/db.ts';
import { outbox } from '../src/services/mail.ts';
import * as settings from '../src/services/settings.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let leaId = 0;
let address = 0;

const nextAddress = () => `127.0.2.${(address++ % 250) + 1}`;

async function createUser(username: string, name: string, extra: Record<string, unknown> = {}) {
  const response = await emi.json('POST', '/api/admin/users', { username, name, password: `${username}s-passwort-123`, ...extra });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().user.id as number;
}

async function loginForm(username: string, password: string, headers: Record<string, string> = {}, remoteAddress = nextAddress()) {
  const client = new Client(app);
  await client.send({ method: 'GET', url: '/login', headers: { accept: 'text/html', ...headers }, remoteAddress });
  const response = await client.send({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams({ _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' }).toString(),
  });
  return { client, response };
}

function basic(username: string, token: string) {
  const client = new Client(app);
  client.basic = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
  return client;
}

async function appPassword(client: Client, body: Record<string, unknown>) {
  const response = await client.json('POST', '/api/account/app-passwords', body);
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { token: string; item: { id: string; admin: boolean; readOnly: boolean } };
}

const cookieOf = (response: { headers: Record<string, unknown> }, name: string) =>
  ([response.headers['set-cookie']].flat().filter(Boolean) as string[]).find((entry) => entry.startsWith(`${name}=`)) ?? '';

before(async () => {
  emi = await setUp(app);
  const mail = await emi.json('PATCH', '/api/admin/mail', {
    'mail.enabled': true,
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.from': 'cloud@example.com',
  });
  assert.equal(mail.statusCode, 200, mail.body);
  await createUser('mia', 'Mia', { email: 'mia@example.com' });
  leaId = await createUser('lea', 'Lea', { email: 'lea@example.com' });
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(() => app.close());

describe('Sitzungen', () => {
  it('setzt Cookies, an die kein Skript und keine fremde Seite kommt', async () => {
    const plain = await loginForm('mia', 'mias-passwort-123');
    assert.equal(plain.response.statusCode, 303);
    const session = cookieOf(plain.response, 'moe_session');
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    assert.match(session, /Path=\//i);
    assert.doesNotMatch(session, /Domain=/i);
    assert.doesNotMatch(session, /;\s*Secure/i, 'ohne HTTPS gäbe es mit Secure keine Anmeldung');
    const secure = await loginForm('mia', 'mias-passwort-123', { 'x-forwarded-proto': 'https' });
    assert.match(cookieOf(secure.response, 'moe_session'), /;\s*Secure/i);
    const first = await new Client(app).send({
      method: 'GET',
      url: '/login',
      headers: { accept: 'text/html', 'x-forwarded-proto': 'https' },
    });
    assert.match(cookieOf(first, 'moe_csrf'), /HttpOnly/i);
    assert.match(cookieOf(first, 'moe_csrf'), /;\s*Secure/i);
    assert.match(String(first.headers['strict-transport-security'] ?? ''), /^$|max-age=\d+/);
  });

  it('glaubt fremden Rechnern weder HTTPS noch eine andere Herkunft', async () => {
    const response = await new Client(app).send({
      method: 'GET',
      url: '/login',
      remoteAddress: '203.0.113.9',
      headers: { accept: 'text/html', 'x-forwarded-proto': 'https', 'x-forwarded-for': '10.1.2.3', 'x-forwarded-host': 'boese.example' },
    });
    assert.doesNotMatch(cookieOf(response, 'moe_csrf'), /;\s*Secure/i);
    assert.doesNotMatch(response.body, /boese\.example/);
  });

  it('gibt bei der Anmeldung eine neue Sitzung aus und übernimmt keine mitgebrachte', async () => {
    const planted = 'A'.repeat(43);
    const client = new Client(app);
    client.cookies.set('moe_session', planted);
    await client.get('/login', { accept: 'text/html' });
    const response = await client.send({
      method: 'POST',
      url: '/login',
      remoteAddress: nextAddress(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: client.cookies.get('moe_csrf')!,
        login: 'mia',
        password: 'mias-passwort-123',
        next: '/files',
      }).toString(),
    });
    assert.equal(response.statusCode, 303);
    assert.notEqual(client.cookies.get('moe_session'), planted);
    assert.ok((client.cookies.get('moe_session') ?? '').length >= 40);
    const again = await loginForm('mia', 'mias-passwort-123');
    assert.notEqual(again.client.cookies.get('moe_session'), client.cookies.get('moe_session'));
    const stored = all<{ token_hash: string }>('SELECT token_hash FROM sessions');
    assert.ok(stored.length > 0);
    for (const row of stored)
      assert.notEqual(row.token_hash, client.cookies.get('moe_session'), 'Sitzungen liegen nur als Hash in der Datenbank');
    const session = await client.get('/api/session');
    assert.notEqual(session.json().csrf, client.cookies.get('moe_csrf'), 'nach der Anmeldung gilt ein neues Formular-Kennzeichen');
  });

  it('beendet die Sitzung beim Abmelden auch auf dem Server', async () => {
    const { client } = await loginForm('mia', 'mias-passwort-123');
    await client.refreshCsrf();
    const token = client.cookies.get('moe_session')!;
    const out = await client.form('/logout', { _csrf: client.csrf });
    assert.equal(out.statusCode, 303);
    const stale = new Client(app);
    stale.cookies.set('moe_session', token);
    assert.equal((await stale.get('/api/session')).statusCode, 401);
    assert.equal((await stale.get('/files', { accept: 'text/html' })).statusCode, 302);
  });

  it('lässt sich nicht von einer fremden Seite abmelden', async () => {
    const { client } = await loginForm('mia', 'mias-passwort-123');
    const foreign = await client.send({
      method: 'POST',
      url: '/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://boese.example', host: 'localhost:3000' },
      payload: '',
    });
    assert.ok(foreign.statusCode >= 400, `Abmelden von fremder Seite → ${foreign.statusCode}`);
    assert.equal((await client.get('/api/session')).statusCode, 200);
  });

  it('meldet alle anderen Geräte ab, wenn sich das Passwort ändert', async () => {
    await createUser('nora', 'Nora');
    const first = await login(app, 'nora', 'noras-passwort-123');
    const second = await login(app, 'nora', 'noras-passwort-123');
    const wrong = await first.json('POST', '/api/account/password', { current: 'falsch-falsch-falsch', next: 'noras-neues-passwort-456' });
    assert.equal(wrong.statusCode, 400);
    const changed = await first.json('POST', '/api/account/password', { current: 'noras-passwort-123', next: 'noras-neues-passwort-456' });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((await first.get('/api/session')).statusCode, 200);
    assert.equal((await second.get('/api/session')).statusCode, 401);
    assert.equal((await loginForm('nora', 'noras-passwort-123')).response.statusCode, 401);
    assert.equal((await loginForm('nora', 'noras-neues-passwort-456')).response.statusCode, 303);
  });

  it('endet sofort, wenn die Verwaltung das Konto sperrt, und kommt mit der Freigabe nicht von selbst zurück', async () => {
    const id = await createUser('emily', 'Emily');
    const emily = await login(app, 'emily', 'emilys-passwort-123');
    const device = await appPassword(emily, { name: 'Laptop' });
    assert.equal((await basic('emily', device.token).get('/api/session')).statusCode, 200);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { disabled: true })).statusCode, 200);
    assert.equal((await emily.get('/api/session')).statusCode, 401);
    assert.equal((await emily.get('/api/nodes/abcdefghijkl')).statusCode, 401);
    assert.equal((await basic('emily', device.token).get('/api/session')).statusCode, 401);
    const dav = await app.inject({
      method: 'PROPFIND',
      url: '/dav/',
      headers: { authorization: `Basic ${Buffer.from(`emily:${device.token}`).toString('base64')}`, depth: '0' },
    });
    assert.equal(dav.statusCode, 401);
    const blocked = await loginForm('emily', 'emilys-passwort-123');
    assert.notEqual(blocked.response.statusCode, 303);
    assert.equal(blocked.client.cookies.get('moe_session'), undefined);
  });
});

describe('Anmeldung', () => {
  it('verrät nicht, ob es ein Konto gibt', async () => {
    const unknown = await loginForm('gibt-es-nicht', 'irgendein-passwort-1');
    const wrong = await loginForm('mia', 'irgendein-passwort-1');
    assert.equal(unknown.response.statusCode, 401);
    assert.equal(wrong.response.statusCode, 401);
    const text = (body: string) =>
      /class="[^"]*alert[^"]*"[^>]*>([\s\S]*?)<\/div>/
        .exec(body)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim();
    assert.ok(text(unknown.response.body), 'die Seite zeigt eine Fehlermeldung');
    assert.equal(text(unknown.response.body), text(wrong.response.body));
    assert.equal(unknown.client.cookies.get('moe_session'), undefined);
  });

  it('sperrt nach vielen Fehlversuchen, auch wenn das richtige Passwort dabei ist', async () => {
    await createUser('lena', 'Lena');
    const from = '127.0.3.7';
    let last = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      last = (await loginForm('lena', `falsch-${attempt}-passwort`, {}, from)).response.statusCode;
    }
    assert.equal(last, 429);
    assert.equal((await loginForm('lena', 'lenas-passwort-123', {}, from)).response.statusCode, 429);
    assert.equal(
      (await loginForm('LENA', 'lenas-passwort-123', {}, nextAddress())).response.statusCode,
      429,
      'die Sperre hängt am Konto, nicht an der Schreibweise'
    );
    assert.equal((await loginForm('mia', 'mias-passwort-123', {}, nextAddress())).response.statusCode, 303, 'andere Konten bleiben offen');
  });

  it('nimmt beim Registrieren keine Rolle, kein Kontingent und keine Freigabe aus dem Formular an', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'open' })).statusCode, 200);
    const guest = new Client(app);
    await guest.get('/register', { accept: 'text/html' });
    const response = await guest.send({
      method: 'POST',
      url: '/register',
      remoteAddress: nextAddress(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: guest.cookies.get('moe_csrf')!,
        username: 'schlau',
        name: 'Schlau',
        email: 'schlau@example.com',
        password: 'ein-langes-passwort-1',
        role: 'admin',
        quota: '0',
        quota_bytes: '999999999999',
        pending: '0',
        disabled: '0',
        id: '1',
        totp_enabled: '0',
        terms: 'on',
      }).toString(),
    });
    assert.ok([200, 303].includes(response.statusCode), response.body.slice(0, 200));
    const row = one<{ role: string; id: number }>('SELECT role, id FROM users WHERE username = ?', 'schlau');
    assert.ok(row, 'das Konto wurde angelegt');
    assert.equal(row.role, 'user');
    assert.notEqual(row.id, 1);
    assert.equal(one<{ role: string }>('SELECT role FROM users WHERE id = 1')!.role, 'admin');
    await emi.json('PATCH', '/api/admin/settings', { 'auth.registration': 'closed' });
    const closed = await new Client(app).get('/register', { accept: 'text/html' });
    assert.equal(closed.statusCode, 404);
  });

  it('lässt den letzten Admin nicht verschwinden und niemanden sich selbst befördern', async () => {
    assert.equal((await emi.json('PATCH', '/api/admin/users/1', { role: 'user' })).statusCode, 400);
    assert.equal((await emi.json('PATCH', '/api/admin/users/1', { disabled: true })).statusCode, 400);
    assert.equal((await emi.json('DELETE', '/api/admin/users/1')).statusCode, 400);
    assert.equal((await mia.json('PATCH', '/api/admin/users/2', { role: 'admin' })).statusCode, 403);
    assert.equal(
      (await mia.json('POST', '/api/admin/users', { username: 'neu', name: 'Neu', password: 'ein-langes-passwort-1', role: 'admin' }))
        .statusCode,
      403
    );
    assert.equal(one<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")!.count, 1);
  });
});

describe('Passwort vergessen', () => {
  const tokenOf = (text: string) => /\/reset\?token=([0-9A-Za-z]+)/.exec(text)?.[1] ?? '';
  const resets = () => outbox.map((entry) => JSON.stringify(entry)).filter((entry) => entry.includes('/reset?token='));

  async function forgot(loginName: string, headers: Record<string, string> = {}) {
    const guest = new Client(app);
    await guest.get('/forgot', { accept: 'text/html' });
    return guest.send({
      method: 'POST',
      url: '/forgot',
      remoteAddress: nextAddress(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      payload: new URLSearchParams({ _csrf: guest.cookies.get('moe_csrf')!, login: loginName }).toString(),
    });
  }

  it('antwortet für bekannte und unbekannte Konten gleich', async () => {
    outbox.length = 0;
    const known = await forgot('lea@example.com');
    const unknown = await forgot('niemand@example.com');
    const noMail = await forgot('lena');
    for (const response of [known, unknown, noMail]) {
      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.location, '/forgot?sent=1');
    }
    assert.equal(resets().length, 1);
    assert.match(resets()[0], /lea@example\.com/);
  });

  it('schickt einen Link, der einmal gilt, abläuft und alle Sitzungen beendet', async () => {
    const lea = await login(app, 'lea', 'leas-passwort-123');
    outbox.length = 0;
    await forgot('lea');
    const token = tokenOf(resets()[0]);
    assert.ok(token.length >= 32, 'der Link trägt ein langes Zufallszeichen');
    assert.equal(
      one('SELECT 1 AS found FROM password_resets WHERE token_hash = ?', token),
      undefined,
      'in der Datenbank liegt nur der Hash'
    );
    const page = await new Client(app).get(`/reset?token=${token}`, { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    for (const wrong of ['', 'x', `${token}x`, token.slice(0, -1), token.toLowerCase(), 'A'.repeat(40), "' OR 1=1 --"]) {
      if (wrong === token) continue;
      assert.equal(
        (await new Client(app).get(`/reset?token=${encodeURIComponent(wrong)}`, { accept: 'text/html' })).statusCode,
        404,
        wrong
      );
    }
    const guest = new Client(app);
    await guest.get(`/reset?token=${token}`, { accept: 'text/html' });
    const weak = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'kurz' });
    assert.equal(weak.statusCode, 400);
    const done = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'leas-ganz-neues-passwort-9' });
    assert.equal(done.statusCode, 303, done.body.slice(0, 200));
    assert.equal((await lea.get('/api/session')).statusCode, 401, 'alte Sitzungen sind beendet');
    const again = await guest.form('/reset', { _csrf: guest.cookies.get('moe_csrf')!, token, password: 'noch-ein-anderes-passwort-9' });
    assert.equal(again.statusCode, 400, 'der Link gilt nur einmal');
    assert.equal((await new Client(app).get(`/reset?token=${token}`, { accept: 'text/html' })).statusCode, 404);
    assert.equal((await loginForm('lea', 'leas-ganz-neues-passwort-9')).response.statusCode, 303);
    assert.equal((await loginForm('lea', 'noch-ein-anderes-passwort-9')).response.statusCode, 401);
    outbox.length = 0;
    await forgot('lea');
    const late = tokenOf(resets()[0]);
    run('UPDATE password_resets SET expires_at = ? WHERE used_at IS NULL', Date.now() - 1000);
    assert.equal(
      (await new Client(app).get(`/reset?token=${late}`, { accept: 'text/html' })).statusCode,
      404,
      'abgelaufene Links gelten nicht'
    );
    run('DELETE FROM password_resets');
  });

  it('baut den Link nie aus einer untergeschobenen Adresse', async () => {
    outbox.length = 0;
    await forgot('mia', { host: 'boese.example', 'x-forwarded-host': 'boese.example' });
    assert.equal(resets().length, 1);
    assert.doesNotMatch(resets()[0], /boese\.example/);
    assert.match(resets()[0], /http:\/\/localhost:3000\/reset\?token=/);
    const saved = settings.get('site.url');
    settings.set('site.url', '');
    settings.set('site.origins', []);
    try {
      await loginForm('emi', 'sehr-sicheres-passwort', { host: 'cloud.example.org', 'x-forwarded-proto': 'https' });
      assert.deepEqual(settings.get('site.origins'), ['https://cloud.example.org']);
      await loginForm('mia', 'mias-passwort-123', { host: 'boese.example' });
      assert.deepEqual(settings.get('site.origins'), ['https://cloud.example.org'], 'nur Adressen, über die sich Admins anmelden, zählen');
      run('DELETE FROM password_resets');
      outbox.length = 0;
      await forgot('mia', { host: 'boese.example' });
      assert.equal(resets().length, 1);
      assert.doesNotMatch(resets()[0], /boese\.example/);
      assert.match(resets()[0], /https:\/\/cloud\.example\.org\/reset\?token=/);
    } finally {
      settings.set('site.url', saved);
      run('DELETE FROM password_resets');
    }
  });

  it('gibt höchstens drei Links pro Stunde aus', async () => {
    outbox.length = 0;
    for (let round = 0; round < 6; round++) await forgot('mia');
    assert.equal(resets().length, 3);
    run('DELETE FROM password_resets');
  });
});

describe('Zweiter Faktor', () => {
  it('lässt ohne den Code nicht hinein, nimmt keinen Code zweimal und sperrt beim Raten', async () => {
    await createUser('ida', 'Ida');
    const ida = await login(app, 'ida', 'idas-passwort-123');
    const setup = (await ida.json('POST', '/api/account/totp/setup')).json();
    const first = hotp(setup.secret, totpCounter());
    const enabled = await ida.json('POST', '/api/account/totp/enable', { code: first });
    assert.equal(enabled.statusCode, 200, enabled.body);
    const recovery = enabled.json().recoveryCodes as string[];
    assert.ok(recovery.length >= 8);
    const stored = one<{ totp_secret: string }>('SELECT totp_secret FROM users WHERE username = ?', 'ida')!;
    assert.ok(stored.totp_secret);

    const from = '127.0.4.4';
    const half = await loginForm('ida', 'idas-passwort-123', {}, from);
    assert.equal(half.response.statusCode, 303);
    assert.match(String(half.response.headers.location), /^\/login\/2fa/);
    assert.equal(half.client.cookies.get('moe_session'), undefined, 'vor dem Code gibt es keine Sitzung');
    assert.equal((await half.client.get('/api/session')).statusCode, 401);
    assert.equal((await half.client.get('/api/nodes/abcdefghijkl')).statusCode, 401);

    const step = (code: string) =>
      half.client.send({
        method: 'POST',
        url: '/login/2fa',
        remoteAddress: from,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ _csrf: half.client.cookies.get('moe_csrf')!, code, next: '/files' }).toString(),
      });
    const replay = await step(first);
    assert.notEqual(replay.statusCode, 303, 'ein schon benutzter Code gilt kein zweites Mal');
    assert.equal(half.client.cookies.get('moe_session'), undefined);

    const once = await step(recovery[0]);
    assert.equal(once.statusCode, 303, once.body.slice(0, 200));
    assert.equal((await half.client.get('/api/session')).statusCode, 200);

    const second = await loginForm('ida', 'idas-passwort-123', {}, '127.0.4.5');
    const reuse = await second.client.send({
      method: 'POST',
      url: '/login/2fa',
      remoteAddress: '127.0.4.5',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: second.client.cookies.get('moe_csrf')!, code: recovery[0], next: '/files' }).toString(),
    });
    assert.notEqual(reuse.statusCode, 303, 'ein Wiederherstellungscode gilt nur einmal');

    let status = 0;
    for (let attempt = 0; attempt < 14; attempt++) {
      status = (
        await second.client.send({
          method: 'POST',
          url: '/login/2fa',
          remoteAddress: '127.0.4.5',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: new URLSearchParams({
            _csrf: second.client.cookies.get('moe_csrf')!,
            code: String(100000 + attempt),
            next: '/files',
          }).toString(),
        })
      ).statusCode;
    }
    assert.ok([429, 303, 401, 400].includes(status));
    assert.equal(second.client.cookies.get('moe_session'), undefined, 'Raten führt nicht hinein');
    const locked = await second.client.send({
      method: 'POST',
      url: '/login/2fa',
      remoteAddress: '127.0.4.5',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: second.client.cookies.get('moe_csrf')!, code: recovery[1], next: '/files' }).toString(),
    });
    assert.notEqual(locked.statusCode, 303, 'nach zu vielen Versuchen hilft auch ein richtiger Code erst später');
  });
});

describe('App-Passwörter', () => {
  it('kommen an die Dateien, aber nicht an das Konto dahinter', async () => {
    const device = await appPassword(mia, { name: 'Laptop' });
    assert.equal(one('SELECT 1 AS found FROM app_passwords WHERE token_hash = ?', device.token.replace(/-/g, '')), undefined);
    const client = basic('mia', device.token);
    assert.equal((await client.get('/api/session')).statusCode, 200);
    const root = (await client.get('/api/session')).json().user.rootId;
    assert.equal((await client.json('POST', `/api/nodes/${root}/folders`, { name: 'Vom Laptop' })).statusCode, 200);
    assert.equal((await client.json('PATCH', '/api/account', { name: 'Mia M.' })).statusCode, 200);
    assert.equal((await client.get('/api/account')).statusCode, 200);

    const refused: [string, string, unknown?][] = [
      ['POST', '/api/account/app-passwords', { name: 'Noch eins' }],
      ['POST', '/api/account/password', { current: 'mias-passwort-123', next: 'ein-ganz-neues-passwort-1' }],
      ['PATCH', '/api/account', { email: 'fremd@example.com' }],
      ['PATCH', '/api/account', { email: 'fremd@example.com', password: 'mias-passwort-123' }],
      ['POST', '/api/account/totp/setup'],
      ['POST', '/api/account/totp/enable', { code: '123456' }],
      ['POST', '/api/account/totp/disable', { code: '123456' }],
      ['POST', '/api/account/totp/recovery', { code: '123456' }],
      ['POST', '/api/account/passkeys/options'],
      ['POST', '/api/account/passkeys', { response: {}, name: 'x' }],
      ['PATCH', '/api/account/passkeys/abc', { name: 'x' }],
      ['DELETE', '/api/account/passkeys/abc'],
      ['DELETE', '/api/account/sso'],
      ['DELETE', '/api/account/session'],
      ['DELETE', '/api/account/sessions/abc'],
      ['POST', '/api/account/sessions/revoke-others'],
      ['POST', '/api/account/delete', { password: 'mias-passwort-123', confirm: 'mia' }],
    ];
    for (const [method, url, body] of refused) {
      const response = await client.json(method, url, body);
      assert.equal(response.statusCode, 403, `${method} ${url} → ${response.statusCode}: ${response.body.slice(0, 120)}`);
      assert.equal(response.json().error.code, 'session_required', `${method} ${url}`);
    }
    const row = one<{ email: string; password_hash: string; totp_enabled: number }>(
      'SELECT email, password_hash, totp_enabled FROM users WHERE username = ?',
      'mia'
    )!;
    assert.equal(row.email, 'mia@example.com');
    assert.equal(row.totp_enabled, 0);
    assert.equal((await loginForm('mia', 'mias-passwort-123')).response.statusCode, 303);
    assert.equal((await mia.get('/api/session')).statusCode, 200, 'Mias Sitzung im Browser läuft weiter');

    const other = await appPassword(mia, { name: 'Tablet' });
    assert.equal(
      (await client.json('DELETE', `/api/account/app-passwords/${other.item.id}`)).statusCode,
      403,
      'ein Gerät meldet kein anderes ab'
    );
    assert.equal(
      (await client.json('DELETE', `/api/account/app-passwords/${device.item.id}`)).statusCode,
      200,
      'sich selbst darf es abmelden'
    );
    assert.equal((await client.get('/api/session')).statusCode, 401);
    assert.equal((await basic('mia', other.token).get('/api/session')).statusCode, 200);
  });

  it('bedienen die Verwaltung nur, wenn das beim Anlegen erlaubt wurde', async () => {
    const plain = await appPassword(emi, { name: 'Sync' });
    assert.equal(plain.item.admin, false);
    const sync = basic('emi', plain.token);
    assert.equal((await sync.get('/api/session')).statusCode, 200);
    for (const [method, url, body] of [
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/settings'],
      ['GET', '/api/admin/backups'],
      ['GET', '/api/admin/plugins'],
      ['PATCH', '/api/admin/settings', { 'site.name': 'Gekapert' }],
      ['POST', '/api/admin/users', { username: 'heimlich', name: 'Heimlich', password: 'ein-langes-passwort-1', role: 'admin' }],
      ['PATCH', '/api/admin/users/2', { role: 'admin' }],
    ] as [string, string, unknown?][]) {
      const response = await sync.json(method, url, body);
      assert.equal(response.statusCode, 403, `${method} ${url} → ${response.statusCode}`);
      assert.equal(response.json().error.code, 'app_password_scope');
    }
    assert.equal(settings.get('site.name'), 'MoeCloud Test');
    assert.equal(one('SELECT 1 AS found FROM users WHERE username = ?', 'heimlich'), undefined);

    const script = await appPassword(emi, { name: 'Skript', admin: true });
    assert.equal(script.item.admin, true);
    assert.equal((await basic('emi', script.token).get('/api/admin/users')).statusCode, 200);
    assert.equal((await basic('emi', script.token).json('POST', '/api/account/app-passwords', { name: 'x' })).statusCode, 403);

    const both = await emi.json('POST', '/api/account/app-passwords', { name: 'Beides', admin: true, readOnly: true });
    assert.equal(both.statusCode, 400);
    const notAdmin = await mia.json('POST', '/api/account/app-passwords', { name: 'Hochstapler', admin: true });
    assert.equal(notAdmin.statusCode, 403);
    assert.equal(one<{ count: number }>("SELECT COUNT(*) AS count FROM app_passwords WHERE scope = 'admin'")!.count, 1);
    const listed = (await emi.get('/api/account')).json().security.appPasswords as { name: string; admin: boolean }[];
    assert.equal(listed.find((entry) => entry.name === 'Skript')!.admin, true);
    assert.equal(listed.find((entry) => entry.name === 'Sync')!.admin, false);
  });

  it('verlieren die Verwaltung, sobald das Konto kein Admin mehr ist', async () => {
    const id = await createUser('ada', 'Ada', { role: 'admin' });
    const ada = await login(app, 'ada', 'adas-passwort-123');
    const script = await appPassword(ada, { name: 'Skript', admin: true });
    assert.equal((await basic('ada', script.token).get('/api/admin/users')).statusCode, 200);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { role: 'user' })).statusCode, 200);
    assert.equal((await basic('ada', script.token).get('/api/admin/users')).statusCode, 403);
    assert.equal((await ada.get('/api/admin/users')).statusCode, 403);
    assert.equal((await basic('ada', script.token).get('/api/session')).statusCode, 200);
  });

  it('nur zum Lesen ändern nichts, weder über die API noch im Laufwerk', async () => {
    const reader = await appPassword(mia, { name: 'Bilderrahmen', readOnly: true });
    const client = basic('mia', reader.token);
    const root = (await client.get('/api/session')).json().user.rootId;
    assert.equal((await client.get(`/api/nodes/${root}/children`)).statusCode, 200);
    for (const [method, url, body] of [
      ['POST', `/api/nodes/${root}/folders`, { name: 'Nein' }],
      ['POST', '/api/uploads', { parentId: root, name: 'nein.txt', size: 1 }],
      ['PATCH', '/api/account', { name: 'Nein' }],
      ['PATCH', '/api/account/prefs', { start: 'home' }],
      ['POST', '/api/tags', { name: 'Nein', color: 'red' }],
      ['DELETE', '/api/trash'],
      ['POST', '/api/notes', { title: 'Nein' }],
    ] as [string, string, unknown?][]) {
      const response = await client.json(method, url, body);
      assert.equal(response.statusCode, 403, `${method} ${url} → ${response.statusCode}`);
      assert.equal(response.json().error.code, 'read_only');
    }
    const authorization = `Basic ${Buffer.from(`mia:${reader.token}`).toString('base64')}`;
    assert.equal((await app.inject({ method: 'PROPFIND', url: '/dav/', headers: { authorization, depth: '1' } })).statusCode, 207);
    for (const [method, url, headers] of [
      ['PUT', '/dav/nein.txt', {}],
      ['MKCOL', '/dav/Nein', {}],
      ['DELETE', '/dav/Vom%20Laptop', {}],
      ['MOVE', '/dav/Vom%20Laptop', { destination: '/dav/Anders' }],
      ['COPY', '/dav/Vom%20Laptop', { destination: '/dav/Kopie' }],
      ['PROPPATCH', '/dav/Vom%20Laptop', {}],
      ['LOCK', '/dav/Vom%20Laptop', {}],
    ] as [string, string, Record<string, string>][]) {
      const response = await app.inject({ method: method as 'PUT', url, headers: { authorization, ...headers }, payload: 'x' });
      assert.equal(response.statusCode, 403, `${method} ${url} → ${response.statusCode}`);
    }
    const names = ((await mia.get(`/api/nodes/${root}/children`)).json().items as { name: string }[]).map((entry) => entry.name);
    assert.deepEqual(names, ['Vom Laptop']);
  });

  it('gelten nur mit dem richtigen Namen, bis zum Ablauf und nicht nach vielen Fehlversuchen', async () => {
    const device = await appPassword(mia, { name: 'Kurz', expiresAt: Date.now() + 60_000 });
    assert.equal((await basic('mia', device.token).get('/api/session')).statusCode, 200);
    assert.equal((await basic('MIA', device.token).get('/api/session')).statusCode, 200);
    assert.equal(
      (await basic('emi', device.token).get('/api/session')).statusCode,
      401,
      'ein fremder Name mit Mias App-Passwort gilt nicht'
    );
    assert.equal(
      (await basic('mia', 'mias-passwort-123').get('/api/session')).statusCode,
      401,
      'das Konto-Passwort gilt nicht als App-Passwort'
    );
    assert.equal((await basic('mia', '').get('/api/session')).statusCode, 401);
    run('UPDATE app_passwords SET expires_at = ? WHERE id = ?', Date.now() - 1000, device.item.id);
    assert.equal((await basic('mia', device.token).get('/api/session')).statusCode, 401);
    run('UPDATE app_passwords SET expires_at = NULL WHERE id = ?', device.item.id);

    const from = '127.0.5.5';
    const guess = (token: string) =>
      app.inject({
        method: 'GET',
        url: '/api/session',
        remoteAddress: from,
        headers: { authorization: `Basic ${Buffer.from(`mia:${token}`).toString('base64')}` },
      });
    for (let attempt = 0; attempt < 25; attempt++) await guess(`${'A'.repeat(29)}${attempt % 10}`);
    assert.equal((await guess(device.token)).statusCode, 401, 'nach zu vielen Fehlversuchen von einer Adresse ist erst einmal Schluss');
    assert.equal((await basic('mia', device.token).get('/api/session')).statusCode, 200, 'von anderen Adressen geht es weiter');
  });
});

describe('E-Mail-Adresse', () => {
  it('ändert sich nur mit dem Passwort, und die alte Adresse erfährt davon', async () => {
    outbox.length = 0;
    const without = await mia.json('PATCH', '/api/account', { email: 'neu@example.com' });
    assert.equal(without.statusCode, 400);
    assert.equal(without.json().error.code, 'password_required');
    const wrong = await mia.json('PATCH', '/api/account', { email: 'neu@example.com', password: 'falsch-falsch-falsch' });
    assert.equal(wrong.statusCode, 400);
    assert.equal(one<{ email: string }>('SELECT email FROM users WHERE username = ?', 'mia')!.email, 'mia@example.com');
    const notices = () => outbox.map((entry) => JSON.stringify(entry)).filter((entry) => entry.includes('neu@example.com'));
    assert.equal(notices().length, 0);
    const same = await mia.json('PATCH', '/api/account', { email: 'mia@example.com', name: 'Mia' });
    assert.equal(same.statusCode, 200, 'ohne Änderung der Adresse fragt niemand nach dem Passwort');
    const taken = await mia.json('PATCH', '/api/account', { email: 'emi@example.com', password: 'mias-passwort-123' });
    assert.equal(taken.statusCode, 409);
    const changed = await mia.json('PATCH', '/api/account', { email: 'neu@example.com', password: 'mias-passwort-123' });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(one<{ email: string }>('SELECT email FROM users WHERE username = ?', 'mia')!.email, 'neu@example.com');
    assert.equal(notices().length, 1);
    const notice = notices()[0];
    assert.match(notice, /"mia@example\.com"/, 'der Hinweis geht an die alte Adresse');
    assert.match(notice, /neu@example\.com/);
    const log = (await mia.get('/api/account/security')).json().items as { action: string }[];
    assert.ok(log.some((entry) => entry.action === 'email_changed'));
  });

  it('lässt sich nicht durch Raten des Passworts ändern', async () => {
    let status = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      status = (await mia.json('PATCH', '/api/account', { email: 'geraten@example.com', password: `falsch-${attempt}-falsch` })).statusCode;
    }
    assert.equal(status, 429);
    const right = await mia.json('PATCH', '/api/account', { email: 'geraten@example.com', password: 'mias-passwort-123' });
    assert.equal(right.statusCode, 429, 'während der Sperre hilft auch das richtige Passwort nicht');
    assert.equal(one<{ email: string }>('SELECT email FROM users WHERE username = ?', 'mia')!.email, 'neu@example.com');
  });

  it('und Namen nehmen keine Steuerzeichen an', async () => {
    for (const name of ['Mia\r\nBcc: fremd@example.com', 'Mia\u0000', 'Mia\u202Egpj.exe', 'Mia\tM']) {
      const response = await mia.json('PATCH', '/api/account', { name });
      assert.equal(response.statusCode, 400, JSON.stringify(name));
    }
    for (const email of [
      'mia@example.com\r\nBcc: fremd@example.com',
      'mia @example.com',
      'mia@example.com, fremd@example.com',
      '<mia@example.com>',
    ]) {
      const response = await mia.json('PATCH', '/api/account', { email, password: 'mias-passwort-123' });
      assert.ok([400, 429].includes(response.statusCode), JSON.stringify(email));
    }
    assert.equal(leaId > 0, true);
  });
});
