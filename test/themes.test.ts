import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import builtin from '../src/lib/themes.json' with { type: 'json' };
import fallback from '../src/lib/default-palette.json' with { type: 'json' };
import * as settings from '../src/services/settings.ts';
import { cleanCss, refreshSiteTheme } from '../src/services/themes.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;

const ozean = builtin.find((theme) => theme.id === 'ozean')!;
const wald = builtin.find((theme) => theme.id === 'wald')!;
const own = { seed: '#AA3366', style: 'vibrant', secondary: '', tertiary: '#0088aa', font: 'serif', corners: 0.5 };

const variable = (html: string, name: string) => new RegExp(`--mui-palette-m3-${name}:(#[0-9a-f]{6})`).exec(html)?.[1];
const boot = (html: string) => JSON.parse(/<script type="application\/json" id="moe-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null');

before(async () => {
  emi = await setUp(app);
  await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  mia = await login(app, 'mia', 'mias-passwort-123');
  await emi.json('PATCH', '/api/admin/settings', { 'site.imprint': 'Emi Sato, Musterweg 1' });
});

after(() => app.close());

describe('Themes', () => {
  it('bringt fertige Themes mit und startet mit der alten Grundfarbe', async () => {
    assert.deepEqual(builtin[0].palette, fallback);
    const list = (await mia.get('/api/themes')).json();
    assert.deepEqual(
      list.themes.map((theme: { id: string }) => theme.id),
      builtin.map((theme) => theme.id)
    );
    assert.equal(list.themes.length, 20);
    assert.equal(list.themes[1].name, 'Ozean');
    assert.equal(list.themes[1].source, 'builtin');
    assert.equal(list.themes[1].preview.light.primary, ozean.palette.light.primary);
    assert.equal(list.themes[1].preview.dark.surface, ozean.palette.dark.surface);
    assert.equal(Object.keys(list.themes[1].preview.dark).length, 14);
    assert.deepEqual(
      {
        id: list.site.id,
        source: list.site.source,
        seed: list.site.seed,
        style: list.site.style,
        font: list.site.font,
        corners: list.site.corners,
      },
      { id: '', source: 'site', seed: '#8b5cf6', style: 'content', font: 'rounded', corners: 1 }
    );
    assert.equal(list.personal, true);
    assert.equal(list.choice, null);
    assert.equal(list.own, null);
    const english = new Client(app);
    english.cookies = new Map(mia.cookies);
    const translated = (await english.get('/api/themes', { 'accept-language': 'en' })).json();
    assert.ok(['Ozean', 'Ocean'].includes(translated.themes[1].name));
    assert.equal((await new Client(app).get('/api/themes')).statusCode, 401);
  });

  it('lässt jede Person ein fertiges Theme oder eine eigene Farbe wählen', async () => {
    const picked = await mia.json('PUT', '/api/account/theme', { id: 'ozean' });
    assert.equal(picked.statusCode, 200, picked.body);
    assert.deepEqual(picked.json().theme, {
      id: 'ozean',
      name: 'Ozean',
      source: 'builtin',
      personal: true,
      seed: '#0284c7',
      style: 'tonal',
      secondary: null,
      tertiary: null,
      font: 'rounded',
      corners: 1,
    });
    assert.deepEqual(picked.json().palette, ozean.palette);
    assert.equal(picked.json().choice, 'ozean');

    const page = await mia.get('/impressum', { accept: 'text/html' });
    assert.equal(page.statusCode, 200);
    assert.equal(variable(page.body, 'primary'), ozean.palette.dark.primary);
    assert.match(page.body, /--moe-font:"M PLUS Rounded 1c"/);
    assert.match(page.body, /--moe-corners:1[;}]/);
    assert.equal(variable((await emi.get('/impressum', { accept: 'text/html' })).body, 'primary'), fallback.dark.primary);
    assert.equal(variable((await new Client(app).get('/login', { accept: 'text/html' })).body, 'primary'), fallback.dark.primary);

    const files = await mia.get('/files', { accept: 'text/html' });
    if (files.statusCode === 200) {
      const data = boot(files.body);
      assert.equal(data.theme.id, 'ozean');
      assert.equal(data.site.seed, '#0284c7');
      assert.deepEqual(data.site.palette, ozean.palette);
      assert.equal(boot((await emi.get('/files', { accept: 'text/html' })).body).theme.source, 'site');
    }

    const personal = await mia.json('PUT', '/api/account/theme', { own, palette: wald.palette });
    assert.equal(personal.statusCode, 200, personal.body);
    assert.deepEqual(personal.json().theme, {
      id: '',
      name: '',
      source: 'own',
      personal: true,
      seed: '#aa3366',
      style: 'vibrant',
      secondary: null,
      tertiary: '#0088aa',
      font: 'serif',
      corners: 0.5,
    });
    assert.equal(personal.json().choice, null);
    assert.equal(personal.json().own.seed, '#aa3366');
    const serif = await mia.get('/impressum', { accept: 'text/html' });
    assert.equal(variable(serif.body, 'primary'), wald.palette.dark.primary);
    assert.match(serif.body, /--moe-font:"Iowan Old Style"/);
    assert.match(serif.body, /--moe-corners:0\.5/);

    assert.equal((await mia.json('PUT', '/api/account/theme', { id: 'gibt-es-nicht' })).statusCode, 404);
    assert.equal((await mia.json('PUT', '/api/account/theme', { own: { ...own, seed: 'rot' }, palette: wald.palette })).statusCode, 400);
    assert.equal((await mia.json('PUT', '/api/account/theme', { own, palette: { dark: { primary: '#fff' }, light: {} } })).statusCode, 400);
    assert.equal((await mia.json('PUT', '/api/account/theme', { own: { ...own, style: 'bunt' }, palette: wald.palette })).statusCode, 400);

    const back = await mia.json('PUT', '/api/account/theme', { id: null });
    assert.equal(back.json().theme.source, 'site');
    assert.equal(variable((await mia.get('/impressum', { accept: 'text/html' })).body, 'primary'), fallback.dark.primary);
  });

  it('verwaltet eigene Themes mit CSS, Export und Standard für alle', async () => {
    const input = {
      name: 'Abendrot',
      seed: '#c2410c',
      style: 'fidelity',
      secondary: null,
      tertiary: '#7c3aed',
      font: 'system',
      corners: 0.5,
      css: '.moe-test { letter-spacing: 0.01em; }',
      palette: wald.palette,
    };
    assert.equal((await mia.json('POST', '/api/admin/themes', input)).statusCode, 403);
    const created = await emi.json('POST', '/api/admin/themes', input);
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id as string;
    assert.match(id, /^abendrot-[a-z0-9]{4}$/);
    assert.equal(created.json().themes.length, 21);
    assert.equal(created.json().themes[20].source, 'custom');
    assert.equal(created.json().themes[20].css, true);
    assert.deepEqual(created.json().items[0].css, '.moe-test { letter-spacing: 0.01em; }');
    assert.equal((await emi.json('POST', '/api/admin/themes', input)).json().error.message, 'Ein Theme mit diesem Namen gibt es schon');
    assert.equal((await mia.get('/api/admin/themes')).statusCode, 403);

    for (const [css, message] of [
      ['a { color: red } </style><script>alert(1)</script>', 'Im eigenen CSS darf kein HTML stehen'],
      ['@import url("https://example.com/a.css");', 'Im eigenen CSS ist @import nicht erlaubt'],
      ['a { background: url(https://example.com/pixel.png) }', 'Im eigenen CSS darf url() nur auf eingebettete Daten zeigen'],
      ['a { background: url( "//example.com/x" ) }', 'Im eigenen CSS darf url() nur auf eingebettete Daten zeigen'],
      ['a::after { content: "\\2014" }', 'Im eigenen CSS sind keine Rückstriche erlaubt'],
      ['a { width: expression(alert(1)) }', 'Im eigenen CSS steht etwas, das Skripte ausführen könnte'],
    ] as const) {
      const response = await emi.json('POST', '/api/admin/themes', { ...input, name: 'Kaputt', css });
      assert.equal(response.statusCode, 400, css);
      assert.equal(response.json().error.message, message);
    }
    assert.equal(cleanCss('  a { background: url(data:image/png;base64,AAAA) }\r\n'), 'a { background: url(data:image/png;base64,AAAA) }');
    assert.equal((await emi.json('POST', '/api/admin/themes', { ...input, name: 'Lang', css: 'a{}'.repeat(7000) })).statusCode, 400);

    await mia.json('PUT', '/api/account/theme', { id });
    const chosen = await mia.get('/impressum', { accept: 'text/html' });
    assert.match(chosen.body, /<style nonce="[^"]+" id="moe-theme-css">\.moe-test \{ letter-spacing: 0\.01em; \}<\/style>/);
    assert.match(chosen.body, /--moe-font:system-ui/);
    assert.match((await emi.get('/impressum', { accept: 'text/html' })).body, /id="moe-theme-css"><\/style>/);

    const site = await emi.json('PUT', '/api/admin/site-theme', { id });
    assert.equal(site.statusCode, 200, site.body);
    assert.equal(site.json().site.id, id);
    assert.equal(settings.get('site.seed'), '#c2410c');
    assert.deepEqual(settings.get('site.palette'), wald.palette);
    const guest = await new Client(app).get('/login', { accept: 'text/html' });
    assert.equal(variable(guest.body, 'primary'), wald.palette.dark.primary);
    assert.match(guest.body, /id="moe-theme-css">\.moe-test/);
    assert.equal(
      (await emi.json('DELETE', `/api/admin/themes/${id}`)).json().error.message,
      'Dieses Theme ist gerade der Standard für alle. Wähl erst ein anderes'
    );

    const updated = await emi.json('PUT', `/api/admin/themes/${id}`, {
      ...input,
      name: 'Abendrot 2',
      css: '',
      palette: ozean.palette,
      font: 'mono',
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.deepEqual(settings.get('site.palette'), ozean.palette);
    assert.equal(settings.get('theme.site')?.name, 'Abendrot 2');
    assert.match((await new Client(app).get('/login', { accept: 'text/html' })).body, /--moe-font:"Geist Mono"/);

    const exported = await emi.get(`/api/admin/themes/${id}/export`);
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers['content-disposition']), /Abendrot%202\.moetheme\.json/);
    assert.deepEqual(JSON.parse(exported.body), {
      moecloudTheme: 1,
      name: 'Abendrot 2',
      seed: '#c2410c',
      style: 'fidelity',
      secondary: null,
      tertiary: '#7c3aed',
      font: 'mono',
      corners: 0.5,
      css: '',
    });
    assert.equal(JSON.parse((await emi.get('/api/admin/themes/terminal/export')).body).font, 'mono');

    const builtinSite = await emi.json('PUT', '/api/admin/site-theme', { id: 'wald' });
    assert.equal(builtinSite.json().site.name, 'Wald');
    assert.deepEqual(settings.get('site.palette'), wald.palette);
    assert.equal((await emi.json('DELETE', `/api/admin/themes/${id}`)).statusCode, 200);
    assert.equal((await emi.get('/api/themes')).json().themes.length, 20);
    assert.equal(variable((await mia.get('/impressum', { accept: 'text/html' })).body, 'primary'), wald.palette.dark.primary);
    assert.equal((await mia.get('/api/themes')).json().choice, null);

    settings.set('site.palette', ozean.palette);
    refreshSiteTheme();
    assert.deepEqual(settings.get('site.palette'), wald.palette);
  });

  it('erlaubt dem Wechsel zwischen hell und dunkel genau sein eigenes Stylesheet', async () => {
    const source = await readFile(new URL('../node_modules/@mui/system/cssVars/createCssVarsProvider.mjs', import.meta.url), 'utf8');
    const injected = /DISABLE_CSS_TRANSITION = '([^']+)'/.exec(source)?.[1];
    assert.ok(injected, 'MUI setzt das Stylesheet nicht mehr so wie bisher');
    const hash = `'sha256-${createHash('sha256').update(injected).digest('base64')}'`;
    const policy = String((await emi.get('/files', { accept: 'text/html' })).headers['content-security-policy']);
    const styles = policy.split('; ').find((part) => part.startsWith('style-src ')) ?? '';
    assert.match(styles, /^style-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'sha256-[A-Za-z0-9+/=]+'$/);
    assert.ok(styles.endsWith(hash), `${styles} passt nicht zu ${hash}`);
    assert.ok(!styles.includes('unsafe-inline'));
  });

  it('lässt sich für alle festlegen und kennt die alte Grundfarbe weiter', async () => {
    await mia.json('PUT', '/api/account/theme', { id: 'tinte' });
    await emi.json('PATCH', '/api/admin/settings', { 'themes.personal': false });
    assert.equal(variable((await mia.get('/impressum', { accept: 'text/html' })).body, 'primary'), wald.palette.dark.primary);
    assert.equal(
      (await mia.json('PUT', '/api/account/theme', { id: 'ozean' })).json().error.message,
      'Eigene Themes sind auf diesem Server ausgeschaltet'
    );
    assert.equal((await mia.get('/api/themes')).json().personal, false);
    await emi.json('PATCH', '/api/admin/settings', { 'themes.personal': true });
    assert.notEqual(variable((await mia.get('/impressum', { accept: 'text/html' })).body, 'primary'), wald.palette.dark.primary);

    const ownSite = await emi.json('PUT', '/api/admin/site-theme', { own, palette: ozean.palette });
    assert.equal(ownSite.statusCode, 200, ownSite.body);
    assert.equal(ownSite.json().site.source, 'site');
    assert.equal(ownSite.json().site.font, 'serif');
    assert.equal(settings.get('site.seed'), '#aa3366');

    const legacy = await emi.json('PATCH', '/api/admin/settings', { 'site.seed': '#3b82f6', 'site.palette': fallback });
    assert.equal(legacy.statusCode, 200, legacy.body);
    assert.equal(settings.get('theme.site'), null);
    const list = (await emi.get('/api/themes')).json();
    assert.deepEqual(
      { seed: list.site.seed, style: list.site.style, font: list.site.font },
      { seed: '#3b82f6', style: 'content', font: 'rounded' }
    );
  });
});
