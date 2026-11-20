import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { Client, createApp, setUp } from './helpers.ts';
import { one, run } from '../src/lib/db.ts';
import { purgeUnconfirmed } from '../src/services/confirmations.ts';
import { outbox } from '../src/services/mail.ts';

const app = await createApp();
let emi: Client;

const smtp = {
  async mailTo(address: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const index = outbox.findIndex((mail) => mail.to === address);
      if (index >= 0) return outbox.splice(index, 1)[0].text;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Keine E-Mail an ${address} angekommen`);
  },
};

const register = async (username: string, email: string) => {
  const page = new Client(app);
  await page.get('/register', { accept: 'text/html' });
  const response = await page.form('/register', {
    _csrf: page.cookies.get('moe_csrf')!,
    name: username[0].toUpperCase() + username.slice(1),
    username,
    email,
    password: `${username}-passwort-123`,
  });
  return { page, response };
};

const signIn = async (username: string) => {
  const page = new Client(app);
  await page.get('/login', { accept: 'text/html' });
  const response = await page.form('/login', {
    _csrf: page.cookies.get('moe_csrf')!,
    login: username,
    password: `${username}-passwort-123`,
    next: '/files',
  });
  return { page, response };
};

const linkIn = (mail: string) => /\/register\/confirm\?token=[0-9A-Za-z_-]+/.exec(mail)![0];
const settings = (values: Record<string, unknown>) => emi.json('PATCH', '/api/admin/settings', values);
const pendingOf = (username: string) =>
  Number(one<{ pending: number }>('SELECT pending FROM users WHERE username = ?', username)?.pending ?? -1);

before(async () => {
  emi = await setUp(app);
});

after(() => app.close());

describe('Registrierung mit bestätigter E-Mail-Adresse', () => {
  it('lässt sich erst einschalten, wenn der E-Mail-Versand steht', async () => {
    const early = await settings({ 'auth.registration': 'open', 'auth.confirmEmail': true });
    assert.equal(early.statusCode, 400);
    assert.match(early.json().error.message, /E-Mail-Versand/);
    assert.equal((await settings({ 'auth.domains': 'example.com' })).statusCode, 400);
    const mail = await emi.json('PATCH', '/api/admin/mail', {
      'mail.enabled': true,
      'mail.host': 'smtp.example.com',
      'mail.port': 587,
      'mail.from': 'cloud@example.com',
    });
    assert.equal(mail.statusCode, 200, mail.body);
    const done = await settings({ 'auth.registration': 'open', 'auth.confirmEmail': true });
    assert.equal(done.statusCode, 200, done.body);
  });

  it('schickt einen Link und lässt erst nach der Bestätigung hinein', async () => {
    const missing = await register('mia', '');
    assert.equal(missing.response.statusCode, 400);
    assert.match(missing.response.body, /Gib deine E-Mail-Adresse an/);
    const { page, response } = await register('mia', 'mia@example.com');
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /Wir haben dir eine E-Mail geschickt/);
    assert.equal(page.cookies.has('moe_session'), false);
    assert.equal(pendingOf('mia'), 2);
    const mail = await smtp.mailTo('mia@example.com');
    assert.match(mail, /Bestätige deine E-Mail-Adresse/);
    const early = await signIn('mia');
    assert.equal(early.response.statusCode, 401);
    assert.match(early.response.body, /Bestätige zuerst deine E-Mail-Adresse/);
    const people = (await emi.get('/api/admin/users')).json().items as { username: string; pending: boolean; unconfirmed: boolean }[];
    assert.deepEqual(
      people.filter((user) => user.username === 'mia').map((user) => [user.pending, user.unconfirmed]),
      [[true, true]]
    );

    const confirmed = await new Client(app).get(linkIn(mail), { accept: 'text/html' });
    assert.equal(confirmed.statusCode, 200);
    assert.match(confirmed.body, /Deine E-Mail-Adresse ist bestätigt\. Du kannst dich jetzt anmelden/);
    assert.equal(pendingOf('mia'), 0);
    const again = await new Client(app).get(linkIn(mail), { accept: 'text/html' });
    assert.equal(again.statusCode, 404);
    assert.match(again.body, /funktioniert nicht mehr/);
    const late = await signIn('mia');
    assert.equal(late.response.statusCode, 303);
    assert.equal(late.page.cookies.has('moe_session'), true);
  });

  it('schickt bei einer Anmeldung vor der Bestätigung einen neuen Link, aber nicht im Minutentakt', async () => {
    await register('lea', 'lea@example.com');
    const first = linkIn(await smtp.mailTo('lea@example.com'));
    assert.equal((await signIn('lea')).response.statusCode, 401);
    assert.equal(one<{ count: number }>('SELECT COUNT(*) AS count FROM email_confirmations')?.count, 1);
    run('UPDATE email_confirmations SET created_at = created_at - 600000');
    assert.equal((await signIn('lea')).response.statusCode, 401);
    const second = linkIn(await smtp.mailTo('lea@example.com'));
    assert.notEqual(second, first);
    assert.equal((await new Client(app).get(first, { accept: 'text/html' })).statusCode, 404);
    assert.equal((await new Client(app).get(second, { accept: 'text/html' })).statusCode, 200);
  });

  it('nimmt mit einer Liste nur Adressen dieser Domains und bestätigt sie immer', async () => {
    assert.equal((await settings({ 'auth.domains': 'kein punkt' })).statusCode, 400);
    const saved = await settings({ 'auth.confirmEmail': false, 'auth.domains': ' @Firma.DE ;example.org' });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().settings['auth.domains'], 'firma.de, example.org');
    const wrong = await register('nora', 'nora@example.com');
    assert.equal(wrong.response.statusCode, 400);
    assert.match(wrong.response.body, /Erlaubt sind Adressen von firma\.de, example\.org/);
    assert.equal(pendingOf('nora'), -1);
    const trick = await register('nora', 'nora@firma.de.example.com');
    assert.equal(trick.response.statusCode, 400);
    const right = await register('nora', 'Nora@Firma.de');
    assert.equal(right.response.statusCode, 200, right.response.body);
    assert.equal(pendingOf('nora'), 2);
    await smtp.mailTo('Nora@Firma.de');
  });

  it('verlangt mit Freigabe erst die Bestätigung und dann die Verwaltung', async () => {
    await settings({ 'auth.registration': 'approval', 'auth.domains': '', 'auth.confirmEmail': true });
    await register('emily', 'emily@example.com');
    assert.equal(pendingOf('emily'), 3);
    const link = linkIn(await smtp.mailTo('emily@example.com'));
    const confirmed = await new Client(app).get(link, { accept: 'text/html' });
    assert.match(confirmed.body, /wartet jetzt auf die Freigabe durch die Verwaltung/);
    assert.equal(pendingOf('emily'), 1);
    const waiting = await signIn('emily');
    assert.match(waiting.response.body, /wartet noch auf die Freigabe/);
    const id = one<{ id: number }>('SELECT id FROM users WHERE username = ?', 'emily')!.id;
    assert.equal((await emi.json('POST', `/api/admin/users/${id}/approve`)).statusCode, 200);
    await smtp.mailTo('emily@example.com');
    assert.equal((await signIn('emily')).response.statusCode, 303);
  });

  it('lässt die Verwaltung auch ohne Bestätigung freigeben und räumt Unbestätigtes nach zwei Tagen weg', async () => {
    await settings({ 'auth.registration': 'open' });
    await register('greta', 'greta@example.com');
    await register('hanna', 'hanna@example.com');
    await smtp.mailTo('greta@example.com');
    await smtp.mailTo('hanna@example.com');
    const greta = one<{ id: number }>('SELECT id FROM users WHERE username = ?', 'greta')!.id;
    assert.equal((await emi.json('POST', `/api/admin/users/${greta}/approve`)).statusCode, 200);
    await smtp.mailTo('greta@example.com');
    assert.equal(pendingOf('greta'), 0);
    assert.equal(purgeUnconfirmed(), 0);
    assert.equal(purgeUnconfirmed(Date.now() + 49 * 60 * 60 * 1000), 2);
    assert.equal(pendingOf('hanna'), -1);
    assert.equal(pendingOf('nora'), -1);
    assert.equal(pendingOf('greta'), 0);
    assert.equal(pendingOf('mia'), 0);
  });

  it('lässt Einladungen ohne Bestätigung und ohne Domainregel durch', async () => {
    await settings({ 'auth.registration': 'invite', 'auth.domains': 'firma.de' });
    const invite = await emi.json('POST', '/api/admin/invites', {});
    assert.equal(invite.statusCode, 200, invite.body);
    const token = new URL(invite.json().url).searchParams.get('invite')!;
    const page = new Client(app);
    await page.get(`/register?invite=${token}`, { accept: 'text/html' });
    const done = await page.form('/register', {
      _csrf: page.cookies.get('moe_csrf')!,
      invite: token,
      name: 'Ida',
      username: 'ida',
      email: 'ida@example.com',
      password: 'ida-passwort-123',
    });
    assert.equal(done.statusCode, 303, done.body);
    assert.equal(pendingOf('ida'), 0);
  });
});

describe('Logo und Anmeldeseite', () => {
  const image = (width: number, height: number, alpha = false) =>
    sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 20, g: 120, b: 200, alpha: 0.5 } : '#225588' } })
      .png()
      .toBuffer();

  const put = (kind: string, payload: Buffer) =>
    emi.send({ method: 'PUT', url: `/api/admin/branding/${kind}`, headers: { 'content-type': 'application/octet-stream' }, payload });

  it('speichert Logo und Hintergrund verkleinert als WebP und zeigt sie ohne Anmeldung', async () => {
    const logo = await put('logo', await image(1200, 600, true));
    assert.equal(logo.statusCode, 200, logo.body);
    const stamp = logo.json().settings['site.logo'] as string;
    assert.match(stamp, /^[0-9A-Za-z_-]{6,}$/);
    const background = await put('background', await image(4000, 2000));
    assert.equal(background.statusCode, 200, background.body);
    const guest = new Client(app);
    const served = await guest.get(`/branding/logo?v=${stamp}`);
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers['content-type'], 'image/webp');
    assert.match(String(served.headers['cache-control']), /immutable/);
    const info = await sharp(served.rawPayload).metadata();
    assert.deepEqual([info.format, info.width, info.height, info.hasAlpha], ['webp', 512, 256, true]);
    const wide = await sharp((await guest.get('/branding/background')).rawPayload).metadata();
    assert.deepEqual([wide.format, wide.width, wide.height], ['webp', 2560, 1280]);

    const page = await guest.get('/login', { accept: 'text/html' });
    assert.match(page.body, new RegExp(`<img class="auth__logo" src="/branding/logo\\?v=${stamp}"`));
    assert.match(page.body, /class="auth auth--image"/);
    assert.match(page.body, /\.auth--image\{--auth-image:url\("\/branding\/background\?v=/);
    const boot = JSON.parse(/<script type="application\/json" id="moe-boot">(.*?)<\/script>/s.exec((await emi.get('/files')).body)![1]);
    assert.equal(boot.site.logo, `/branding/logo?v=${stamp}`);
  });

  it('nimmt Überschrift, Begrüßung und Platz der Anmeldung und entschärft HTML darin', async () => {
    const saved = await settings({
      'login.title': 'Willkommen bei Emi',
      'login.text': 'Schön, dass du da bist.\n<b>Fett</b>',
      'login.layout': 'right',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const page = await new Client(app).get('/login', { accept: 'text/html' });
    assert.match(page.body, /<h1>Willkommen bei Emi<\/h1>/);
    assert.match(page.body, /class="auth__lead auth__lead--own"/);
    assert.match(page.body, /&lt;b>Fett&lt;\/b>/);
    assert.doesNotMatch(page.body, /<b>Fett<\/b>/);
    assert.match(page.body, /class="auth auth--image auth--right"/);
    assert.equal((await settings({ 'login.layout': 'oben' })).statusCode, 400);
    assert.equal((await settings({ 'login.title': 'x'.repeat(61) })).statusCode, 400);
    assert.equal((await settings({ 'site.logo': 'abc' })).statusCode, 200);
    assert.notEqual((await emi.get('/api/admin/settings')).json().settings['site.logo'], 'abc');
  });

  it('weist Fremdes ab und räumt beim Entfernen auf', async () => {
    assert.equal(
      (await put('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).statusCode,
      400
    );
    assert.equal((await put('logo', Buffer.alloc(0))).statusCode, 400);
    assert.equal((await put('banner', await image(10, 10))).statusCode, 404);
    const guest = new Client(app);
    const foreign = await guest.send({
      method: 'PUT',
      url: '/api/admin/branding/logo',
      headers: { 'content-type': 'application/octet-stream' },
      payload: await image(10, 10),
    });
    assert.ok([401, 403].includes(foreign.statusCode), String(foreign.statusCode));
    assert.equal((await emi.json('DELETE', '/api/admin/branding/logo')).statusCode, 200);
    assert.equal((await emi.json('DELETE', '/api/admin/branding/background')).statusCode, 200);
    assert.equal((await guest.get('/branding/logo')).statusCode, 404);
    const page = await guest.get('/login', { accept: 'text/html' });
    assert.match(page.body, /src="\/favicon\.svg"/);
    assert.doesNotMatch(page.body, /auth--image/);
  });
});
