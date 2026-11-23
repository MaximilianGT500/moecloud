import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PDFDocument, StandardFonts, rgb } from '@pdfme/pdf-lib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import yazl from 'yazl';
import { fakeCollabora } from './collabora.ts';
import { proRaw } from './images.ts';
import { smtpSink } from './smtp.ts';

const root = resolve(import.meta.dirname, '..');
const shots = resolve(process.env.SCREENSHOTS ?? join(root, 'docs/screenshots'));
const failureShots = join(tmpdir(), 'moecloud-browser-fehler');
const port = Number(process.env.BROWSER_PORT ?? 3900 + Math.floor(Math.random() * 90));
const base = `http://localhost:${port}`;
const password = 'moecloud-demo';

if (!existsSync(join(root, 'dist/web/.vite/manifest.json'))) {
  process.stderr.write('Die Oberfläche fehlt. Baue sie zuerst mit „npm run build“.\n');
  process.exit(1);
}

const dataDir = await mkdtemp(join(tmpdir(), 'moecloud-browser-'));
await mkdir(shots, { recursive: true });
const smtp = await smtpSink();

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '',
    DATA_DIR: dataDir,
    LOG_FORMAT: 'json',
    LOG_LEVEL: 'info',
    PUBLIC_URL: '',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const logs: string[] = [];
process.once('exit', () => server.kill('SIGTERM'));

const code = await new Promise<string>((done, fail) => {
  const timer = setTimeout(() => fail(new Error('Der Server meldet keinen Einrichtungscode')), 30_000);
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk: string) => {
    logs.push(chunk);
    const match = /setup\?code=([\w-]+)/.exec(logs.join(''));
    if (match) {
      clearTimeout(timer);
      done(match[1]);
    }
  });
  server.once('exit', (status) => fail(new Error(`Der Server hat sich beendet (${status})`)));
});

const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
const browser = await chromium
  .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: FAKE_MEDIA } : { channel: 'chrome', args: FAKE_MEDIA })
  .catch(async (error: Error) => {
    server.kill('SIGTERM');
    await smtp.close();
    await rm(dataDir, { recursive: true, force: true });
    process.stderr.write(
      `Der Browser startet nicht: ${error.message.split('\n')[0]}\nSetze CHROME_PATH auf ein installiertes Chrome oder Chromium.\n`
    );
    process.exit(1);
  });
const problems: string[] = [];
const statuses: string[] = [];
const failures: string[] = [];
let photosUrl = '';
let current = '';

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const ALWAYS = /^(Einrichtung im Browser|Beispieldaten anlegen|Anmelden mit Passwort)$/;

async function step(name: string, run: () => Promise<void>) {
  if (only && !ALWAYS.test(name) && !only.test(name)) return;
  const started = Date.now();
  current = name;
  try {
    await run();
    process.stdout.write(`ok      ${name} (${Date.now() - started} ms)\n`);
  } catch (error) {
    failures.push(name);
    const lines = (error as Error).message.split('\n').filter((line) => line.trim() && !line.includes('Call log'));
    process.stdout.write(
      `FEHLER  ${name}\n${lines
        .slice(0, 3)
        .map((line) => `        ${line.trim()}\n`)
        .join('')}`
    );
    await mkdir(failureShots, { recursive: true });
    for (const [index, page] of browser
      .contexts()
      .flatMap((entry) => entry.pages())
      .entries()) {
      await page.screenshot({ path: join(failureShots, `${failures.length}-${index}.png`) }).catch(() => undefined);
    }
  }
}

async function context(scheme: 'dark' | 'light', mobile = false) {
  const created = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: scheme,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  await created.addInitScript((mode) => {
    try {
      localStorage.setItem('mui-mode', mode);
    } catch {}
  }, scheme);
  return created;
}

async function open(owner: BrowserContext, label: string) {
  const page = await owner.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const where = message.location();
    problems.push(`${label} bei „${current}“: ${message.type()} ${message.text()} (${where.url.replace(base, '')}:${where.lineNumber})`);
  });
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/api/session/check'))
      statuses.push(`${label} bei „${current}“: ${response.status()} ${response.request().method()} ${response.url().replace(base, '')}`);
  });
  return page;
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function login(page: Page, username: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name=login]', username);
  await page.fill('input[name=password]', password);
  await Promise.all([page.waitForURL('**/files**'), page.click('button[type=submit]')]);
}

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const session = (await (await fetch('/api/session')).json()) as { csrf: string };
      const response = await fetch(path, {
        method,
        headers:
          body === undefined ? { 'x-csrf-token': session.csrf } : { 'content-type': 'application/json', 'x-csrf-token': session.csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
      return response.status === 204 ? null : response.json();
    },
    { method, path, body }
  ) as Promise<T>;
}

function seedHistory(now: { logical: number; physical: number; files: number; users: number }) {
  const database = new DatabaseSync(join(dataDir, 'moecloud.db'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    const insert = database.prepare('INSERT OR REPLACE INTO usage_days (day, users, files, bytes, stored) VALUES (?, ?, ?, ?, ?)');
    for (let back = 75; back >= 1; back--) {
      const progress = 1 - back / 75;
      const share = Math.min(0.97, 0.38 + 0.42 * progress + (back <= 30 ? 0.12 : 0) - (back <= 12 && back > 8 ? 0.05 : 0));
      insert.run(
        new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10),
        Math.max(1, now.users - (back > 40 ? 1 : 0)),
        Math.round(now.files * share),
        Math.round(now.logical * share),
        Math.round(now.physical * share)
      );
    }
  } finally {
    database.close();
  }
}

async function inNavigation(page: Page, name: string, wanted: boolean, click = false) {
  const rail = page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
  const direct = rail.getByRole('link', { name, exact: true });
  const more = rail.getByRole('button', { name: 'Mehr Bereiche' });
  const entry = page.getByRole('menuitem', { name, exact: true });
  for (let tries = 0; tries < 60; tries++) {
    if ((await direct.count()) > 0) {
      if (wanted) return click ? direct.click() : undefined;
    } else if ((await more.count()) > 0) {
      await more.click();
      await page.getByRole('menu').waitFor();
      const found = (await entry.count()) > 0;
      if (found && wanted && click) return entry.click();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
      if (found === wanted) return;
    } else if (!wanted) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`„${name}“ ${wanted ? 'fehlt in der Navigation' : 'steht noch in der Navigation'}`);
}

const visible = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor();
const item = (page: Page, name: string) => page.getByRole('grid').getByText(name, { exact: true }).first();
const images = (page: Page, scope: string) =>
  page.waitForFunction((selector) => {
    const list = [...document.querySelectorAll<HTMLImageElement>(`${selector} img`)];
    return list.length > 0 && list.every((image) => image.complete && image.naturalWidth > 0);
  }, scope);

try {
  const dark = await context('dark');

  await step('Einrichtung im Browser', async () => {
    const page = await open(dark, 'setup');
    await page.goto(`${base}/setup?code=${code}`);
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await page.getByLabel('Adresse').waitFor();
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Grundfarbe' }).waitFor();
    await shot(page, 'setup');
    await page.close();
  });

  await step('Beispieldaten anlegen', async () => {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/demo.ts', base, code], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  });

  const page = await open(dark, 'emi');

  await step('Anmelden mit Passwort', async () => {
    await login(page, 'emi');
    await item(page, 'Urlaub 2026').waitFor();
  });

  await step('E-Mail einrichten und testen', async () => {
    await api(page, 'PATCH', '/api/admin/mail', {
      'mail.enabled': true,
      'mail.host': '127.0.0.1',
      'mail.port': smtp.port,
      'mail.security': 'none',
      'mail.from': 'cloud@example.com',
    });
    await page.goto(`${base}/admin/mail`);
    await page.getByRole('button', { name: 'Test senden', exact: true }).click();
    const mail = await smtp.mailTo('emi@example.com');
    if (!mail.includes('Diese E-Mail zeigt, dass der Versand funktioniert.')) throw new Error('Die Test-E-Mail hat den falschen Inhalt');
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').waitFor();
  });

  await step('Liste mit Details', async () => {
    await item(page, 'Urlaub 2026').click();
    await page.getByRole('button', { name: 'Verwalten', exact: true }).waitFor();
    await shot(page, 'files');
  });

  await step('Hochladen über die Dateiauswahl', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (await chooser).setFiles({ name: 'Lea.txt', mimeType: 'text/plain', buffer: Buffer.from('Hallo Lea\n') });
    await item(page, 'Lea.txt').waitFor();
  });

  await step('Umbenennen mit F2', async () => {
    await item(page, 'Lea.txt').click();
    await page.keyboard.press('F2');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Lea-Notizen.txt');
    await page.keyboard.press('Enter');
    await item(page, 'Lea-Notizen.txt').waitFor();
    await item(page, 'Urlaub 2026').waitFor();
  });

  await step('Verschieben in einen Ordner', async () => {
    await item(page, 'Lea-Notizen.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Verschieben', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Dokumente', exact: true }).click();
    await dialog.getByRole('button', { name: 'Hierher verschieben' }).click();
    await visible(page, 'Nach „Dokumente“ verschoben');
    await page.getByRole('grid').getByText('Lea-Notizen.txt', { exact: true }).waitFor({ state: 'detached' });
  });

  await step('Suchen', async () => {
    await page.goto(`${base}/files/search?q=Notizen`);
    await item(page, 'Lea-Notizen.txt').waitFor();
    await item(page, 'Notizen.txt').waitFor();
  });

  await step('Papierkorb und Wiederherstellen', async () => {
    await item(page, 'Lea-Notizen.txt').click();
    await page.keyboard.press('Delete');
    await visible(page, '„Lea-Notizen.txt“ liegt im Papierkorb');
    await page.goto(`${base}/files/trash`);
    await item(page, 'Lea-Notizen.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Wiederherstellen', exact: true }).click();
    await visible(page, '„Lea-Notizen.txt“ ist wieder da');
  });

  await step('Geteilte Inhalte', async () => {
    await page.goto(`${base}/files/shared`);
    await item(page, 'Rezepte').waitFor();
    await page.getByRole('button', { name: 'Urlaub 2026', exact: true }).waitFor();
  });

  await step('Kacheln mit Vorschaubildern', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').dblclick();
    await page.waitForURL('**/files/folder/**');
    photosUrl = page.url();
    await page.getByRole('button', { name: 'Als Kacheln zeigen' }).click();
    await images(page, '[role=grid]');
    await shot(page, 'grid');
  });

  await step('Bildansicht', async () => {
    await item(page, 'Bergwanderung.jpg').dblclick();
    await images(page, '[role=dialog]');
    await shot(page, 'viewer');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Als Liste zeigen' }).click();
  });

  await step('Teilen-Dialog', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    await visible(page, 'Lea Hoffmann');
    await visible(page, 'Fotos für die Familie');
    await shot(page, 'share');
    await page.keyboard.press('Escape');
  });

  await step('Link per E-Mail senden', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Per E-Mail senden' }).first().click();
    await dialog.getByRole('textbox', { name: 'E-Mail' }).fill('emily@example.com');
    await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
    await visible(page, 'Link an emily@example.com gesendet');
    const mail = await smtp.mailTo('emily@example.com');
    if (!mail.includes('Emi Sato teilt „Fotos“ mit dir')) throw new Error('Der Betreff der E-Mail stimmt nicht');
    if (!/http:\/\/localhost:\d+\/s\/[0-9A-Za-z]+/.test(mail)) throw new Error('Der Link fehlt in der E-Mail');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('Fotos nach Monaten', async () => {
    await page.goto(`${base}/files/photos`);
    await page.getByRole('heading', { level: 2 }).first().waitFor();
    await page.getByRole('heading', { name: 'An diesem Tag' }).waitFor();
    await images(page, 'main [role=list]');
    await shot(page, 'photos');
    await page.getByRole('button', { name: /^Vor 2 Jahren/ }).click();
    await images(page, '[role=dialog]');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: /^Sonnenuntergang am See\.jpg/ }).click();
    await images(page, '[role=dialog]');
    await page.getByRole('button', { name: 'Informationen', exact: true }).click();
    await visible(page, 'Kamera');
    await visible(page, 'Belichtung');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });

  await step('Speicher und doppelte Dateien', async () => {
    await page.goto(`${base}/files/storage`);
    await visible(page, 'Doppelte Dateien');
    await visible(page, 'Strand Kopie.jpg');
    await shot(page, 'storage');
    await page.getByRole('button', { name: 'Nur eine behalten' }).first().click();
    const confirm = page.getByRole('dialog');
    await confirm.getByText(/„Strand\.jpg“ in „.+“ bleibt/).waitFor();
    await confirm.getByRole('button', { name: 'Aufräumen' }).click();
    await visible(page, 'Keine doppelten Dateien gefunden.');
  });

  await step('Aktivität', async () => {
    await page.goto(`${base}/files/activity`);
    await visible(page, 'Mia Weber hat Zugtickets.pdf hochgeladen');
  });

  await step('Benachrichtigungen', async () => {
    await page.goto(`${base}/files`);
    await page.getByRole('button', { name: /neue Benachrichtigung/ }).click();
    await visible(page, 'Mia Weber hat „Packliste.md“ kommentiert');
    await visible(page, 'Mia Weber hat „Rezepte“ mit dir geteilt');
    await shot(page, 'notifications');
    await page.getByText('Mia Weber hat „Packliste.md“ kommentiert', { exact: true }).click();
    await page.waitForURL('**/files/folder/**');
    await page.getByRole('tab', { name: 'Kommentare' }).waitFor();
    await visible(page, 'Denk an den Adapter, in Japan gibt es Typ A.');
    const field = page.getByLabel('Kommentar schreiben');
    await field.fill('@mi');
    await page
      .getByRole('listbox', { name: 'Personen zum Erwähnen' })
      .getByRole('option', { name: /Mia Weber/ })
      .click();
    if ((await field.inputValue()) !== '@mia ') throw new Error(`Die Erwähnung fehlt im Feld: „${await field.inputValue()}“`);
    await field.pressSequentially('danke, ist eingepackt.');
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    await page.getByText('danke, ist eingepackt.').first().waitFor();
    const adapter = page.locator('li', { hasText: 'Denk an den Adapter, in Japan gibt es Typ A.' });
    await adapter.getByRole('button', { name: 'Reagieren' }).click();
    await page.getByRole('group', { name: 'Reaktion wählen' }).getByRole('button', { name: 'Daumen hoch' }).click();
    await adapter.locator('[data-reaction="👍"][aria-pressed="true"]').waitFor();
    await shot(page, 'comments');
  });

  await step('Markdown und Code', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').dblclick();
    await item(page, 'Ideen.md').dblclick();
    await page.getByRole('dialog').locator('.markdown table').waitFor();
    await shot(page, 'markdown');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await item(page, 'Skripte').dblclick();
    await item(page, 'sicherung.sh').dblclick();
    await page.getByRole('dialog').locator('code .hljs-built_in, code .hljs-string').first().waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });

  await step('E-Mail ansehen', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    const logo = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#8b5cf6' } })
      .png()
      .toBuffer();
    const message = [
      'From: Mia Weber <mia@example.com>',
      'To: Emi Sato <emi@example.com>',
      'Cc: Lea Hoffmann <lea@example.com>',
      'Subject: Grillabend am Samstag',
      'Date: Fri, 13 Nov 2026 18:05:00 +0100',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="aussen"',
      '',
      '--aussen',
      'Content-Type: multipart/related; boundary="innen"',
      '',
      '--innen',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<div style="font-family:sans-serif"><img src="cid:sonne" width="48" height="48" alt=""><h2 style="color:#6b38d4">Grillabend am Samstag</h2><p>Hallo Emi,</p><p>wir grillen ab 18 Uhr im Garten. Bring gern Salat mit.</p><p>Liebe Grüße<br>Mia</p></div>',
      '--innen',
      'Content-Type: image/png',
      'Content-ID: <sonne>',
      'Content-Transfer-Encoding: base64',
      '',
      logo.toString('base64'),
      '--innen--',
      '--aussen',
      'Content-Type: text/plain; name="Einkaufsliste.txt"',
      'Content-Disposition: attachment; filename="Einkaufsliste.txt"',
      '',
      'Brot, Tomaten, Zitronen',
      '--aussen--',
      '',
    ].join('\r\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (await chooser).setFiles({ name: 'Grillabend.eml', mimeType: 'message/rfc822', buffer: Buffer.from(message) });
    await item(page, 'Grillabend.eml').dblclick();
    const viewer = page.getByRole('dialog');
    await viewer.getByRole('heading', { name: 'Grillabend am Samstag' }).waitFor();
    await viewer.getByRole('button', { name: /Einkaufsliste\.txt/ }).waitFor();
    await page.frameLocator('iframe[title="Grillabend am Samstag"]').getByText('Bring gern Salat mit.').waitFor();
    await shot(page, 'email');
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
  });

  await step('Termine und Kontakte', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    const calendar = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Grillabend bei Mia',
      'DTSTART;TZID=Europe/Berlin:20261121T180000',
      'DTEND;TZID=Europe/Berlin:20261121T220000',
      'LOCATION:Garten',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const contacts = ['BEGIN:VCARD', 'FN:Lea Hoffmann', 'TEL;TYPE=CELL:+49 151 2345678', 'EMAIL:lea@example.com', 'END:VCARD'].join('\r\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (
      await chooser
    ).setFiles([
      { name: 'Termine.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar) },
      { name: 'Lea.vcf', mimeType: 'text/vcard', buffer: Buffer.from(contacts) },
    ]);
    await item(page, 'Termine.ics').dblclick();
    const viewer = page.getByRole('dialog');
    await viewer.getByRole('heading', { name: 'Grillabend bei Mia' }).waitFor();
    await viewer.getByText(/18:00–22:00/).waitFor();
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    await item(page, 'Lea.vcf').dblclick();
    await viewer.getByRole('heading', { name: 'Lea Hoffmann' }).waitFor();
    await viewer.getByRole('link', { name: 'lea@example.com' }).waitFor();
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
  });

  await step('Inhalt eines ZIP-Archivs', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').dblclick();
    await item(page, 'Website.zip').dblclick();
    await page.getByRole('dialog').getByText('style.css', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });

  await step('Archiv entpacken', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').dblclick();
    await item(page, 'Website.zip').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Entpacken', exact: true }).click();
    await visible(page, '4 Dateien entpackt.');
    await item(page, 'Website').dblclick();
    await item(page, 'README.md').waitFor();
    await item(page, 'website').waitFor();
  });

  await step('Tastenkürzel', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').waitFor();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Tastenkürzel', { exact: true }).waitFor();
    await dialog.getByText('Alles auswählen', { exact: true }).waitFor();
    await dialog.getByText('Aus der Zwischenablage hochladen', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('Einfügen aus der Zwischenablage', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#8b5cf6' } })
      .png()
      .toBuffer();
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').waitFor();
    let slow = true;
    await page.route(
      (url) => /^\/api\/nodes\/[^/]+\/children$/.test(url.pathname),
      async (route) => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 700));
        await route.continue().catch(() => undefined);
      }
    );
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    await page.evaluate((encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      transfer.items.add(new File(['Aus der Zwischenablage\n'], 'Liste von Lea.txt', { type: 'text/plain' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer }));
    }, png.toString('base64'));
    slow = false;
    await page
      .getByRole('grid')
      .getByText(/^Eingefügtes Bild \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/)
      .first()
      .waitFor();
    await item(page, 'Liste von Lea.txt').waitFor();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  await step('Vorschau für Rohformate, HEIC und Dokumente', async () => {
    const cover = await sharp({ create: { width: 240, height: 320, channels: 3, background: '#8b5cf6' } })
      .png()
      .toBuffer();
    const archive = new yazl.ZipFile();
    archive.addBuffer(cover, 'Thumbnails/thumbnail.png');
    archive.end();
    const parts: Buffer[] = [];
    for await (const part of archive.outputStream) parts.push(part as Buffer);
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    const folder = page.url();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (
      await chooser
    ).setFiles([
      { name: 'IMG_4711.DNG', mimeType: 'application/octet-stream', buffer: await proRaw() },
      { name: 'IMG_4712.HEIC', mimeType: 'application/octet-stream', buffer: await readFile(join(root, 'test/fixtures/hochkant-p3.heic')) },
      { name: 'Einladung.odt', mimeType: 'application/octet-stream', buffer: Buffer.concat(parts) },
      { name: 'LIESMICH', mimeType: 'application/octet-stream', buffer: Buffer.from('Hallo Mia, das ist ein Text ohne Endung.\n') },
    ]);
    const upright = (name: string) =>
      page.waitForFunction((alt) => {
        const image = [...document.querySelectorAll<HTMLImageElement>('[role=dialog] img')].find((entry) => entry.alt === alt);
        return Boolean(image && image.complete && image.naturalHeight > image.naturalWidth && image.src.includes('/preview'));
      }, name);
    const close = async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    };
    await item(page, 'IMG_4711.DNG').dblclick();
    await upright('IMG_4711.DNG');
    await page
      .getByRole('dialog')
      .getByText(/· Vorschaubild/)
      .waitFor();
    await close();
    await item(page, 'IMG_4712.HEIC').dblclick();
    await upright('IMG_4712.HEIC');
    await close();
    await item(page, 'Einladung.odt').dblclick();
    await upright('Vorschaubild von „Einladung.odt“');
    await page.getByRole('dialog').getByText('MoeCloud zeigt hier das Vorschaubild aus der Datei.', { exact: true }).waitFor();
    await close();
    const kind = async () => {
      const id = folder.split('/').pop();
      const listing = await api<{ items: { name: string; kind: string }[] }>(page, 'GET', `/api/nodes/${id}/children`);
      return listing.items.find((entry) => entry.name === 'LIESMICH')?.kind;
    };
    for (let attempt = 0; (await kind()) !== 'text'; attempt++) {
      if (attempt > 40) throw new Error('LIESMICH wurde nicht als Text erkannt');
      await page.waitForTimeout(250);
    }
    await page.reload();
    await item(page, 'LIESMICH').dblclick();
    await page.getByRole('dialog').getByText('Hallo Mia, das ist ein Text ohne Endung.').first().waitFor();
    await close();
  });

  await step('Ordnerfarbe', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Farbe', exact: true }).click();
    await page.getByRole('radio', { name: 'Grün' }).click();
    await page.waitForFunction(async () => {
      const session = (await (await fetch('/api/session')).json()) as { user: { rootId: string } };
      const listing = (await (await fetch(`/api/nodes/${session.user.rootId}/children`)).json()) as {
        items: { name: string; color: string | null }[];
      };
      return listing.items.find((entry) => entry.name === 'Dokumente')?.color === 'green';
    });
  });

  await step('Schlagwörter vergeben', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Schlagwörter', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Suchen oder neu anlegen').fill('Wichtig');
    await dialog.getByRole('radio', { name: 'Rot' }).click();
    await dialog.getByRole('button', { name: '„Wichtig“ anlegen' }).click();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('grid').getByRole('img', { name: 'Schlagwörter: Wichtig' }).waitFor();
    await page.goto(`${base}/files/tags`);
    await page.getByRole('button', { name: /^Wichtig/ }).click();
    await page.waitForURL('**/files/tags/**');
    await item(page, 'Projekte').waitFor();
  });

  await step('Album aus Fotos anlegen', async () => {
    await page.goto(`${base}/files/photos`);
    await images(page, '[role=list]');
    const tiles = page.locator('[role=listitem]').filter({ has: page.getByRole('button', { name: /\.jpg,/ }) });
    await tiles.nth(0).hover();
    await tiles.nth(0).getByRole('checkbox').check();
    await tiles.nth(1).locator('button').first().click();
    await page.getByRole('toolbar', { name: 'Auswahl' }).getByRole('button', { name: 'Zum Album hinzufügen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Neues Album').fill('Sommer am See');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.goto(`${base}/files/photos/albums`);
    await page.getByRole('button', { name: /^Album Sommer am See, 2 Elemente/ }).click();
    await page.waitForURL('**/files/photos/albums/**');
    await images(page, '[role=list]');
    await page.getByRole('button', { name: 'Diashow' }).click();
    await page.getByRole('button', { name: 'Diashow anhalten' }).waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
  });

  await step('Bild bearbeiten', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Sonnenuntergang am See.jpg').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Bild bearbeiten' }).click();
    await page.locator('canvas').waitFor();
    await page.getByRole('button', { name: 'Nach rechts drehen' }).click();
    await page.getByRole('button', { name: '16:9' }).click();
    await shot(page, 'editor');
    await page.getByLabel('Format').click();
    await page.getByRole('option', { name: 'PNG' }).click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await item(page, 'Sonnenuntergang am See (bearbeitet).png').waitFor();
  });

  await step('PDF-Seiten ordnen und zusammenfügen', async () => {
    const chapters = await PDFDocument.create();
    const font = await chapters.embedFont(StandardFonts.HelveticaBold);
    for (const [index, width] of [420, 595, 500].entries()) {
      const sheet = chapters.addPage([width, 595]);
      sheet.drawRectangle({ x: 0, y: 515, width, height: 80, color: rgb(0.55, 0.36, 0.96) });
      sheet.drawText(`Kapitel ${index + 1}`, { x: 32, y: 300, size: 48, font, color: rgb(0.2, 0.2, 0.2) });
    }
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    const folder = page.url().split('/').pop();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (await chooser).setFiles({ name: 'Kapitel.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await chapters.save()) });
    await item(page, 'Kapitel.pdf').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Seiten bearbeiten' }).click();
    await images(page, '[role=dialog] [role=list]');
    await page.getByRole('button', { name: 'Seite 1 auswählen' }).first().click();
    await page.getByRole('toolbar', { name: 'Auswahl' }).getByRole('button', { name: 'Nach hinten schieben' }).click();
    await page.getByRole('button', { name: 'Seite 3 drehen' }).click();
    await shot(page, 'pdf');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await item(page, 'Kapitel (bearbeitet).pdf').waitFor();
    const listing = await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/nodes/${folder}/children`);
    const edited = listing.items.find((entry) => entry.name === 'Kapitel (bearbeitet).pdf');
    const info = await api<{ pages: { width: number; rotation: number }[] }>(page, 'GET', `/api/nodes/${edited?.id}/pdf`);
    const order = info.pages.map((entry) => `${entry.width}:${entry.rotation}`).join(' ');
    if (order !== '595:0 420:0 500:90') throw new Error(`Falsche Seiten: ${order}`);
    await item(page, 'Mietvertrag.pdf').click();
    await item(page, 'Kapitel.pdf').click({ modifiers: ['Control'] });
    await item(page, 'Kapitel.pdf').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'PDFs zusammenfügen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Kapitel.pdf nach unten' }).click();
    await dialog.getByLabel('Name der neuen PDF').fill('Mappe für Lea');
    await dialog.getByRole('button', { name: 'Zusammenfügen' }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Mappe für Lea.pdf').waitFor();
    const after = await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/nodes/${folder}/children`);
    const merged = after.items.find((entry) => entry.name === 'Mappe für Lea.pdf');
    const pages = await api<{ pages: { width: number }[] }>(page, 'GET', `/api/nodes/${merged?.id}/pdf`);
    const widths = pages.pages.map((entry) => entry.width).join(' ');
    if (widths !== '595 420 595 500') throw new Error(`Falsche Reihenfolge: ${widths}`);
  });

  await step('Mehrere umbenennen und als ZIP packen', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Bergwanderung.jpg').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('F2');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Nummerieren' }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Urlaub mit Mia');
    await dialog.getByLabel('Reihenfolge').click();
    await page.getByRole('option', { name: 'Nach Aufnahmedatum' }).click();
    await dialog.getByText('Urlaub mit Mia 1.jpg', { exact: true }).waitFor();
    await shot(page, 'rename');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Kapitel.pdf').click();
    await item(page, 'Kapitel (bearbeitet).pdf').click({ modifiers: ['Control'] });
    await page.keyboard.press('F2');
    await dialog.getByRole('tab', { name: 'Ersetzen' }).click();
    await dialog.getByLabel('Suchen').fill('Kapitel');
    await dialog.getByLabel('Ersetzen durch').fill('Teil');
    await dialog.getByRole('button', { name: 'Umbenennen' }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Teil.pdf').waitFor();
    await item(page, 'Teil (bearbeitet).pdf').click();
    await item(page, 'Teil.pdf').click({ modifiers: ['Control'] });
    await item(page, 'Teil.pdf').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Als ZIP packen' }).click();
    await dialog.getByLabel('Name des Archivs').fill('Teile für Lea');
    await dialog.getByRole('button', { name: 'Packen' }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Teile für Lea.zip').waitFor();
  });

  await step('Ordnerbeschreibung und Versionen vergleichen', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').dblclick();
    await page.waitForURL('**/files/folder/**');
    const readme = page.getByRole('region', { name: 'Beschreibung des Ordners' });
    await readme.getByRole('heading', { name: 'Projekte' }).waitFor();
    await item(page, 'Ideen.md').click();
    await page.getByRole('tab', { name: 'Info' }).click();
    await page.getByRole('button', { name: 'Version vergleichen' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Änderungen an „Ideen.md“').waitFor();
    await dialog.getByText('| Hokkaido | Februar | Lea |').waitFor();
    await dialog.getByRole('cell', { name: 'Entfernt' }).first().waitFor();
    await shot(page, 'diff');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('Musik und Untertitel', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Musik').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Melodie.mp3').dblclick();
    const player = page.getByRole('region', { name: 'Musik' });
    await player.getByRole('button', { name: 'Pause' }).waitFor();
    await player.getByRole('button', { name: 'Warteschlange' }).click();
    await page.getByText('Ein Titel in der Warteschlange').waitFor();
    await page.keyboard.press('Escape');
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').dblclick();
    await page.waitForURL('**/files/folder/**');
    await player.waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'Zeitraffer.de.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from('1\n00:00:00,200 --> 00:00:03,800\nAbendlicht über dem See\n'),
    });
    await item(page, 'Zeitraffer.de.srt').waitFor();
    await item(page, 'Zeitraffer.mp4').dblclick();
    await page.waitForFunction(() => {
      const track = document.querySelector<HTMLTrackElement>('video track');
      return track?.label === 'Deutsch' && track.track.mode === 'showing';
    });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await player.getByRole('button', { name: 'Abspielen' }).waitFor();
    await player.getByRole('button', { name: 'Player schließen' }).click();
    await player.waitFor({ state: 'detached' });
  });

  await step('Suchfilter, Ablauf und Beobachten', async () => {
    await page.goto(`${base}/files`);
    await page.getByRole('button', { name: 'Suchen mit Filtern' }).click();
    await page.waitForURL('**/files/search**');
    const filters = page.getByRole('group', { name: 'Filter' });
    await filters.getByRole('button', { name: 'Geändert' }).click();
    await page.getByRole('menuitem', { name: 'Letzte 30 Tage' }).click();
    await filters.getByRole('button', { name: 'Bilder' }).click();
    await item(page, 'Fuji am Morgen.jpg').waitFor();
    await filters.getByRole('button', { name: 'Suche speichern' }).click();
    const naming = page.getByRole('dialog');
    await naming.getByLabel('Name').fill('Neue Bilder');
    await naming.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('list', { name: 'Gespeicherte Suchen' }).getByRole('button', { name: 'Neue Bilder' }).waitFor();
    await page.goto(`${base}/files`);
    await page.getByRole('textbox', { name: 'In deinen Dateien suchen' }).click();
    await page.getByRole('menuitem', { name: 'Neue Bilder' }).click();
    await page.waitForURL(/\/files\/search\?.*type=image/);
    await item(page, 'Fuji am Morgen.jpg').waitFor();
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: /^Ablauf der Freigabe für/ })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Eine Woche' }).click();
    await dialog
      .getByText(/· bis /)
      .first()
      .waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Projekte').dblclick();
    await page.waitForURL('**/files/folder/**');
    await page.getByRole('button', { name: 'Ordner beobachten' }).click();
    await page.locator('button[aria-label="Ordner beobachten"][aria-pressed="true"]').waitFor();
  });

  await step('Aufräumregel für einen Ordner', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Aufräumregel' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Aufräumen' }).click();
    await page.getByRole('option', { name: 'Nach 90 Tagen' }).click();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Projekte').dblclick();
    await page.waitForURL('**/files/folder/**');
    await page.getByRole('button', { name: 'Aufräumregel' }).click();
    const again = page.getByRole('dialog');
    await again.getByRole('button', { name: 'Ausschalten' }).click();
    await again.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Aufräumregel' }).waitFor({ state: 'detached' });
  });

  await step('Datei sperren und entsperren', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Notizen.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Sperren', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Dauer' }).click();
    await page.getByRole('option', { name: 'Für einen Tag' }).click();
    await shot(page, 'lock');
    await dialog.getByRole('button', { name: 'Sperren' }).click();
    await dialog.waitFor({ state: 'detached' });
    const badge = page.getByRole('grid').getByRole('img', { name: /^Von dir gesperrt · bis / });
    await badge.first().waitFor();
    await item(page, 'Notizen.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Entsperren', exact: true }).click();
    await badge.first().waitFor({ state: 'detached' });
  });

  await step('Push und Ablaufdatum', async () => {
    await page.goto(`${base}/account`);
    await visible(page, 'Push');
    await visible(page, 'In diesem Browser');
    await visible(page, 'Über ntfy oder Gotify');
    await visible(page, 'Ruhezeiten');
    await page.getByLabel(/^Ruhezeiten/).click();
    await page.getByLabel('Von', { exact: true }).waitFor();
    await page.getByLabel('Adresse mit Thema').fill('https://ntfy.sh/emi-moecloud');
    await page.getByText('Ruhezeiten', { exact: true }).first().scrollIntoViewIfNeeded();
    await shot(page, 'push');
    await page.getByLabel(/^Ruhezeiten/).click();
    await page.getByLabel('Von', { exact: true }).waitFor({ state: 'detached' });
    await dark.grantPermissions(['notifications'], { origin: base });
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return { scope: new URL(registration.scope).pathname, permission: Notification.permission };
    });
    if (worker.scope !== '/') throw new Error(`Der Service Worker hat den falschen Bereich: ${worker.scope}`);
    if (worker.permission !== 'granted') throw new Error(`Benachrichtigungen sind im Testbrowser nicht erlaubt: ${worker.permission}`);
    const cdp = await dark.newCDPSession(page);
    const registrationId = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Der Service Worker taucht nicht auf')), 10_000);
      cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
        const found = event.registrations.find((entry) => entry.scopeURL === `${base}/` && !entry.isDeleted);
        if (!found) return;
        clearTimeout(timer);
        done(found.registrationId);
      });
      void cdp.send('ServiceWorker.enable');
    });
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: base,
      registrationId,
      data: JSON.stringify({ title: 'Mia Weber hat „Packliste.md“ kommentiert', text: 'Denk an den Adapter', url: '/files?bell=1' }),
    });
    const shown = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      for (let attempt = 0; attempt < 50; attempt++) {
        const list = await registration.getNotifications();
        if (list.length) {
          const first = list[0];
          const result = { title: first.title, body: first.body, url: (first.data as { url?: string } | null)?.url ?? null };
          for (const entry of list) entry.close();
          return result;
        }
        await new Promise((wait) => setTimeout(wait, 100));
      }
      return null;
    });
    await cdp.detach();
    if (!shown) throw new Error('Die Push-Nachricht hat keine Benachrichtigung ausgelöst');
    if (
      shown.title !== 'Mia Weber hat „Packliste.md“ kommentiert' ||
      shown.body !== 'Denk an den Adapter' ||
      shown.url !== '/files?bell=1'
    ) {
      throw new Error(`Unerwartete Benachrichtigung: ${JSON.stringify(shown)}`);
    }
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      await registration?.unregister();
    });
    await page.goto(`${base}/admin/people`);
    await page.getByRole('button', { name: /Lea Hoffmann/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Konto gültig bis').fill('2099-12-31');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await dialog.waitFor({ state: 'detached' });
    await visible(page, 'Bis 31. Dezember 2099');
    await page.getByRole('button', { name: /Lea Hoffmann/ }).click();
    await dialog.getByLabel('Konto gültig bis').fill('');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('Bis 31. Dezember 2099', { exact: true }).waitFor({ state: 'detached' });
  });

  await step('Erinnern, Beschreibung und Vorlage', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Als Vorlagenordner verwenden', exact: true }).click();
    await visible(page, '„Dokumente“ ist jetzt dein Vorlagenordner. Du findest die Vorlagen unter Neu.');
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Notizen.txt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Erinnern', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Wann' }).click();
    await page.getByRole('option', { name: 'Morgen um 8 Uhr' }).click();
    await dialog.getByLabel('Notiz (freiwillig)').fill('Mit Mia durchgehen');
    await dialog.getByRole('button', { name: 'Erinnern', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page
      .getByRole('grid')
      .getByRole('img', { name: /^Erinnerung am / })
      .first()
      .waitFor();
    await item(page, 'Notizen.txt').click();
    await page.getByRole('button', { name: 'Beschreibung hinzufügen', exact: true }).click();
    await dialog.getByLabel('Beschreibung').fill('Gedanken zur Reise, noch unsortiert');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await visible(page, 'Gedanken zur Reise, noch unsortiert');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Neu aus Vorlage' }).click();
    await dialog.getByRole('listbox', { name: 'Vorlagen' }).getByRole('option', { name: 'Notizen.txt', exact: true }).click();
    await dialog.getByLabel('Name der neuen Datei').fill('Protokoll für Mia');
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await visible(page, '„Protokoll für Mia.txt“ ist angelegt');
    await dialog.getByText('Ideen für das Wochenende:').waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Protokoll für Mia.txt').waitFor();
  });

  await step('E-Book lesen und Office-Vorschau', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').dblclick();
    await page.waitForURL('**/files/folder/**');
    const chapter = (title: string, text: string) =>
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="buch.css"/></head><body><h1>${title}</h1>${text
        .split('|')
        .map((line) => `<p>${line}</p>`)
        .join('')}</body></html>`;
    const book = new yazl.ZipFile();
    const add = (name: string, content: string) => book.addBuffer(Buffer.from(content), name);
    book.addBuffer(Buffer.from('application/epub+zip'), 'mimetype', { compress: false });
    add(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="buch/inhalt.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    );
    add(
      'buch/inhalt.opf',
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Reise nach Japan</dc:title><dc:creator>Emi Sato</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="a" href="aufbruch.xhtml" media-type="application/xhtml+xml"/><item id="b" href="tokio.xhtml" media-type="application/xhtml+xml"/><item id="c" href="kyoto.xhtml" media-type="application/xhtml+xml"/><item id="css" href="buch.css" media-type="text/css"/><item id="titel" href="titel.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>'
    );
    add(
      'buch/nav.xhtml',
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="aufbruch.xhtml">Aufbruch</a></li><li><a href="tokio.xhtml">Tokio</a></li><li><a href="kyoto.xhtml">Kyoto</a></li></ol></nav></body></html>'
    );
    add(
      'buch/buch.css',
      'body { font-family: Georgia, serif; max-width: 34em; margin: 2.5em auto; padding: 0 1.5em; line-height: 1.6; color: #1d1b20; } h1 { font-weight: 500; margin-bottom: 1.2em; }'
    );
    add(
      'buch/aufbruch.xhtml',
      chapter(
        'Aufbruch',
        'Der Koffer stand seit Tagen im Flur, und trotzdem fehlte am Morgen der Adapter.|Mia hatte die Packliste geschrieben, Lea die Zugverbindungen herausgesucht. Für mich blieb, die Fotos von unterwegs gleich in die Cloud zu laden.|Um kurz nach sechs fuhr der Zug zum Flughafen, und mit ihm begann die Reise.'
      )
    );
    add(
      'buch/tokio.xhtml',
      chapter('Tokio', 'Vom Hotelzimmer aus sah die Stadt nachts aus wie ein Schaltplan.|Am ersten Tag liefen wir zwanzig Kilometer.')
    );
    add('buch/kyoto.xhtml', chapter('Kyoto', 'In Kyoto war es ruhiger, und der Regen passte zu den Gärten.'));
    book.addBuffer(
      await sharp({ create: { width: 600, height: 900, channels: 3, background: '#2f5d50' } })
        .png()
        .toBuffer(),
      'buch/titel.png'
    );
    book.end();
    const chunks: Buffer[] = [];
    for await (const chunk of book.outputStream) chunks.push(chunk as Buffer);
    const upload = async (name: string, mimeType: string, buffer: Buffer) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Neu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
      await (await chooser).setFiles({ name, mimeType, buffer });
      await item(page, name).waitFor();
    };
    await upload('Reise nach Japan.epub', 'application/epub+zip', Buffer.concat(chunks));
    await item(page, 'Reise nach Japan.epub').dblclick();
    const preview = page.getByRole('dialog');
    await preview.frameLocator('iframe[title="Reise nach Japan · Aufbruch"]').getByRole('heading', { name: 'Aufbruch' }).waitFor();
    await visible(page, 'Emi Sato · Abschnitt 1 von 3');
    await shot(page, 'epub');
    await preview.getByRole('button', { name: 'Nächster Abschnitt' }).click();
    await preview.frameLocator('iframe[title="Reise nach Japan · Tokio"]').getByRole('heading', { name: 'Tokio' }).waitFor();
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'detached' });
    if (spawnSync(process.env.SOFFICE_PATH || 'soffice', ['--version'], { stdio: 'ignore' }).status === 0) {
      await upload(
        'Brief an Lea.rtf',
        'application/rtf',
        Buffer.from(
          '{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}}\\f0\\fs28 Hallo Lea, die Fotos liegen jetzt alle in der Cloud.\\par Bis bald, Emi\\par}'
        )
      );
      await item(page, 'Brief an Lea.rtf').dblclick();
      await preview.locator('iframe[title="Brief an Lea.rtf"]').waitFor({ timeout: 90_000 });
      await page.keyboard.press('Escape');
      await preview.waitFor({ state: 'detached' });
    }
  });

  const anonymous = await context('dark');

  await step('Wunschadresse, Meldung und Verlauf eines Links', async () => {
    const shared = await api<{ links: { id: string; label: string | null }[] }>(page, 'GET', '/api/shared');
    const link = shared.links.find((entry) => entry.label === 'Fotos für die Familie');
    if (!link) throw new Error('Der Link aus den Beispieldaten fehlt');
    const changed = await api<{ link: { url: string; slug: string | null } }>(page, 'PATCH', `/api/links/${link.id}`, {
      slug: 'fotos-familie',
    });
    if (changed.link.url !== `${base}/s/fotos-familie`) throw new Error(`Unerwartete Adresse: ${changed.link.url}`);
    const guest = await open(anonymous, 'meldung');
    await guest.goto(changed.link.url);
    await visible(guest, 'Fotos für die Familie');
    await guest.getByRole('button', { name: 'Inhalt melden' }).click();
    const report = guest.getByRole('dialog');
    await report.getByRole('combobox', { name: 'Grund' }).click();
    await guest.getByRole('option', { name: 'Urheberrecht' }).click();
    await report.getByLabel('Was ist das Problem? (freiwillig)').fill('Das dritte Foto stammt von meiner Seite.');
    await report.getByRole('button', { name: 'Melden', exact: true }).click();
    await visible(guest, 'Danke, die Meldung ist bei der Verwaltung');
    await guest.close();
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    await visible(page, 'Fotos für die Familie');
    await page.getByRole('button', { name: 'Verlauf', exact: true }).first().click();
    await page.getByRole('list', { name: 'Verlauf des Links' }).getByText('Link geöffnet').first().waitFor();
    await shot(page, 'link-history');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/admin/links`);
    await visible(page, 'Meldungen');
    await page.getByText('Das dritte Foto stammt von meiner Seite.').first().waitFor();
    await page.getByRole('button', { name: 'Erledigt', exact: true }).click();
    await visible(page, 'Meldung erledigt');
  });

  await step('Themes für alle und pro Person', async () => {
    const variable = (name: string) =>
      page.evaluate((key) => getComputedStyle(document.documentElement).getPropertyValue(key).trim(), name);
    const waitFor = (name: string, part: string) =>
      page.waitForFunction(([key, text]) => getComputedStyle(document.documentElement).getPropertyValue(key).includes(text), [
        name,
        part,
      ] as const);
    await page.goto(`${base}/admin/settings`);
    const gallery = page.getByRole('radiogroup', { name: 'Theme für alle' });
    await gallery.getByRole('radio', { name: 'Wald' }).click();
    await visible(page, '„Wald“ gilt jetzt für alle');
    await waitFor('--mui-palette-m3-primary', '#92d5ab');
    await page.getByRole('button', { name: 'Neues Theme' }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Name', { exact: true }).fill('Abendrot');
    await editor.getByRole('textbox', { name: 'Grundfarbe', exact: true }).fill('#c2410c');
    await editor.getByRole('combobox', { name: 'Stil' }).click();
    await page.getByRole('option', { name: /Farbtreu/ }).click();
    await editor.getByRole('textbox', { name: 'Dritte Farbe', exact: true }).fill('#7c3aed');
    await editor.getByRole('combobox', { name: 'Schrift' }).click();
    await page.getByRole('option', { name: 'Serifen' }).click();
    await waitFor('--moe-font', 'Iowan');
    await editor.getByLabel('Eigenes CSS (freiwillig)').fill('.MuiDialogTitle-root { letter-spacing: 0.02em; }');
    await page.waitForFunction(() => document.getElementById('moe-theme-css')?.textContent?.includes('letter-spacing'));
    await shot(page, 'theme-editor');
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await visible(page, 'Theme gespeichert');
    await editor.waitFor({ state: 'detached' });
    await waitFor('--moe-font', 'M PLUS');
    await page.waitForFunction(() => document.getElementById('moe-theme-css')?.textContent === '');
    await gallery.getByRole('radio', { name: 'Abendrot' }).waitFor();
    await gallery.getByRole('radio', { name: 'Abendrot' }).click();
    await visible(page, '„Abendrot“ gilt jetzt für alle');
    await waitFor('--moe-font', 'Iowan');
    await page.waitForFunction(() => document.getElementById('moe-theme-css')?.textContent?.includes('letter-spacing'));
    await shot(page, 'themes');
    const guest = await open(await context('dark'), 'theme-gast');
    await guest.goto(`${base}/login`);
    const font = await guest.evaluate(() => getComputedStyle(document.documentElement).fontFamily);
    if (!font.includes('Iowan')) throw new Error(`Die Anmeldeseite nutzt die Schrift des Themes nicht: ${font}`);
    await guest.close();

    await page.goto(`${base}/account`);
    const mine = page.getByRole('radiogroup', { name: 'Theme', exact: true });
    await mine.getByRole('radio', { name: 'Ozean' }).click();
    await waitFor('--mui-palette-m3-primary', '#99ccfa');
    await waitFor('--moe-font', 'M PLUS');
    await page.reload();
    await mine.getByRole('radio', { name: 'Ozean', checked: true }).waitFor();
    if ((await variable('--mui-palette-m3-primary')) !== '#99ccfa') throw new Error('Das gewählte Theme hält nach dem Neuladen nicht');
    await mine.getByRole('radio', { name: 'Eigene Farbe' }).click();
    const own = page.getByRole('dialog');
    await own.getByRole('textbox', { name: 'Grundfarbe', exact: true }).fill('#0f766e');
    await own.getByRole('button', { name: 'Kantig' }).click();
    await own.getByRole('button', { name: 'Speichern', exact: true }).click();
    await own.waitFor({ state: 'detached' });
    await mine.getByRole('radio', { name: 'Eigene Farbe', checked: true }).waitFor();
    await waitFor('--moe-corners', '0.1');
    await mine.getByRole('radio', { name: 'Wie alle' }).click();
    await waitFor('--moe-font', 'Iowan');
    await mine.getByRole('radio', { name: 'Wie alle', checked: true }).waitFor();

    await page.goto(`${base}/admin/settings`);
    await gallery.getByRole('radio', { name: 'Moe', exact: true }).click();
    await visible(page, '„Moe“ gilt jetzt für alle');
    await waitFor('--mui-palette-m3-primary', '#d0bcff');
    await waitFor('--moe-font', 'M PLUS');
  });

  await step('Plugins freigeben, nutzen und abschalten', async () => {
    await page.goto(`${base}/admin/plugins`);
    await visible(page, 'Mitgelieferte Beispiele');
    const card = (name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
    const quiet = async () => {
      const close = page.locator('.MuiSnackbar-root').getByRole('button', { name: 'Schließen' });
      if (await close.isVisible()) await close.click();
      await page.locator('.MuiSnackbar-root').waitFor({ state: 'detached' });
    };
    for (const name of ['Statistik', 'Inhaltsliste', 'Farbpaket']) {
      await page.getByRole('button', { name: `„${name}“ hinzufügen` }).click();
      await card(name).getByText('Aus', { exact: true }).waitFor();
    }
    await card('Statistik').getByRole('button', { name: 'Einschalten' }).click();
    const trust = page.getByRole('dialog');
    await trust.getByText(/^Ein Plugin läuft mit allen Rechten von MoeCloud/).waitFor();
    await trust.getByText('eine Seite').waitFor();
    await quiet();
    await shot(page, 'plugin-trust');
    await trust.getByRole('button', { name: 'Einschalten' }).click();
    await trust.waitFor({ state: 'detached' });
    await card('Statistik').getByText('Läuft', { exact: true }).waitFor();
    await inNavigation(page, 'Statistik', true);
    for (const name of ['Inhaltsliste', 'Farbpaket']) {
      await card(name).getByRole('button', { name: 'Einschalten' }).click();
      await trust.getByRole('button', { name: 'Einschalten' }).click();
      await trust.waitFor({ state: 'detached' });
      await card(name).getByText('Läuft', { exact: true }).waitFor();
    }
    await card('Inhaltsliste').getByRole('button', { name: 'Einstellungen von „Inhaltsliste“' }).click();
    const settings = page.getByRole('dialog');
    await settings.getByLabel('Name der Datei').fill('Übersicht.md');
    await settings.getByRole('button', { name: 'Speichern', exact: true }).click();
    await settings.waitFor({ state: 'detached' });
    await quiet();
    await shot(page, 'plugins');

    await page.goto(`${base}/admin/settings`);
    await page.getByRole('button', { name: 'Lavendel aus Farbpaket' }).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('textbox', { name: 'Grundfarbe', exact: true }).waitFor();
    if ((await editor.getByRole('textbox', { name: 'Grundfarbe', exact: true }).inputValue()).toLowerCase() !== '#9d8df1')
      throw new Error('Das Theme aus dem Plugin kommt nicht im Editor an');
    await editor.getByRole('button', { name: 'Abbrechen' }).click();
    await editor.waitFor({ state: 'detached' });
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mui-palette-m3-primary').includes('#d0bcff')
    );

    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Inhaltsliste schreiben', exact: true }).click();
    await visible(page, '„Übersicht.md“ liegt im Ordner');
    await item(page, 'Urlaub 2026').dblclick();
    await item(page, 'Übersicht.md').waitFor();
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').waitFor();

    await inNavigation(page, 'Statistik', true, true);
    await page.waitForURL('**/files/plugins/statistik/uebersicht');
    await page.getByRole('heading', { name: 'Statistik', level: 1 }).waitFor();
    const frame = page.frameLocator('iframe[title="Statistik"]');
    await frame.getByRole('heading', { name: 'Deine Aktionen pro Tag' }).waitFor();
    await frame.locator('.saeule:not([hidden])').first().waitFor();
    const inside = () =>
      page
        .frames()
        .find((entry) => entry.url().includes('/plugin-pages/statistik/'))!
        .evaluate(() => ({
          mode: document.documentElement.dataset.mode,
          primary: getComputedStyle(document.documentElement).getPropertyValue('--moe-primary').trim(),
          origin: window.origin,
          cookie: (() => {
            try {
              return document.cookie;
            } catch {
              return 'gesperrt';
            }
          })(),
        }));
    const outside = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mui-palette-m3-primary').trim());
    const first = await inside();
    if (first.primary !== (await outside()) || first.mode !== 'dark')
      throw new Error(`Die Seite des Plugins trägt das Theme nicht: ${JSON.stringify(first)}`);
    if (first.origin !== 'null' || first.cookie !== 'gesperrt')
      throw new Error(`Die Seite des Plugins läuft nicht abgeschottet: ${JSON.stringify(first)}`);
    const uploads = Number(await frame.locator('.moe-stat').first().textContent());
    if (!(uploads > 0)) throw new Error('Die Statistik hat keine Uploads gezählt');
    await frame.getByLabel('Zeitraum').selectOption('30');
    await page.waitForFunction(
      () => (document.querySelector<HTMLIFrameElement>('iframe[title="Statistik"]')?.getBoundingClientRect().height ?? 0) > 400
    );
    await frame.locator('.spalte').last().hover();
    await frame
      .locator('.tipp')
      .getByText(/Aktion/)
      .waitFor();
    await shot(page, 'plugin-page');
    await page.getByRole('button', { name: 'Helles Design' }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-mui-color-scheme') === 'light');
    const lightPrimary = await outside();
    for (let round = 0; round < 40; round += 1) {
      if ((await inside()).primary === lightPrimary) break;
      await page.waitForTimeout(100);
    }
    const second = await inside();
    if (second.primary !== lightPrimary || second.mode !== 'light')
      throw new Error(`Die Seite des Plugins folgt dem hellen Design nicht: ${JSON.stringify(second)}`);
    await page.getByRole('button', { name: 'Dunkles Design' }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-mui-color-scheme') === 'dark');

    const phone = await open(await context('dark', true), 'plugin-handy');
    await login(phone, 'emi');
    await phone.getByRole('button', { name: 'Statistik', exact: true }).click();
    await phone.waitForURL('**/files/plugins/statistik/uebersicht');
    await phone.frameLocator('iframe[title="Statistik"]').getByRole('heading', { name: 'Deine Aktionen pro Tag' }).waitFor();
    const box = await phone.locator('iframe[title="Statistik"]').boundingBox();
    if (!box || box.width < 380 || box.height < 400)
      throw new Error(`Die Seite des Plugins ist auf dem Handy zu klein: ${JSON.stringify(box)}`);
    await phone.getByRole('button', { name: 'Konto von Emi' }).click();
    await phone.getByRole('menuitem', { name: 'Statistik' }).waitFor();
    await phone.close();

    await page.goto(`${base}/admin/plugins`);
    for (const name of ['Statistik', 'Inhaltsliste', 'Farbpaket']) {
      await card(name).getByRole('button', { name: 'Ausschalten' }).click();
      await card(name).getByText('Aus', { exact: true }).waitFor();
    }
    await inNavigation(page, 'Statistik', false);
    await page.goto(`${base}/files/plugins/statistik/uebersicht`);
    await visible(page, 'Diese Seite gibt es nicht mehr');
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Details', exact: true }).waitFor();
    if (await page.getByRole('menuitem', { name: 'Inhaltsliste schreiben' }).count())
      throw new Error('Die Aktion eines abgeschalteten Plugins steht noch im Menü');
    await page.keyboard.press('Escape');
  });

  await step('Schnellzugriff mit Strg+K', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').waitFor();
    const box = page.getByRole('combobox', { name: 'Schnellzugriff' });
    const options = page.getByRole('listbox', { name: 'Schnellzugriff' }).getByRole('option');
    await page.keyboard.press('Control+k');
    await box.waitFor();
    await options.filter({ hasText: 'Papierkorb' }).waitFor();
    await shot(page, 'palette');
    await box.fill('pap');
    await page.getByRole('option', { name: 'Papierkorb', selected: true }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/files/trash');
    await box.waitFor({ state: 'detached' });

    await page.keyboard.press('Control+k');
    await box.fill('Strand');
    await options.filter({ hasText: 'Strand.jpg' }).first().waitFor();
    if ((await options.first().textContent())?.includes('Strand') !== true) throw new Error('Gefundene Dateien stehen nicht oben');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/files\/folder\/\w+/);
    await item(page, 'Strand.jpg').waitFor();
    await page.getByRole('row', { selected: true }).filter({ hasText: 'Strand.jpg' }).waitFor();

    await page.keyboard.press('Control+k');
    await box.fill('theme oz');
    await page.getByRole('option', { name: 'Theme: Ozean', selected: true }).waitFor();
    await page.keyboard.press('Enter');
    await visible(page, 'Dein Theme ist jetzt „Ozean“');
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mui-palette-m3-primary').includes('#99ccfa')
    );
    await page.keyboard.press('Control+k');
    await box.fill('wie alle');
    await page.getByRole('option', { name: 'Theme: Wie alle', selected: true }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mui-palette-m3-primary').includes('#d0bcff')
    );

    await page.keyboard.press('Control+k');
    await box.fill('gibtesnicht');
    await visible(page, 'Dazu gibt es nichts.');
    await box.fill('protok');
    await page.getByRole('option', { name: 'Protokoll', selected: true }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await Promise.all([page.waitForURL('**/admin/audit'), page.keyboard.press('Enter')]);
    await visible(page, 'Protokoll');
    await page.getByRole('button', { name: 'Konto von Emi' }).first().click();
    await page.getByRole('menuitem', { name: 'Schnellzugriff' }).click();
    await box.waitFor();
    await page.keyboard.press('Escape');
    await box.waitFor({ state: 'detached' });
  });

  await step('Verwaltung', async () => {
    seedHistory(await api(page, 'GET', '/api/admin/overview'));
    await page.goto(`${base}/admin`);
    await visible(page, 'Zustand');
    await visible(page, 'Speicher nach Art');
    await shot(page, 'admin');
    const chart = page.getByRole('group', { name: /^Speicherverlauf über/ });
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height / 2);
    await page.getByRole('status').filter({ hasText: 'auf der Platte' }).waitFor();
    await shot(page, 'admin-usage');
    await page.getByRole('button', { name: 'Als Tabelle' }).click();
    await page.getByRole('columnheader', { name: 'Auf der Platte' }).waitFor();
    for (const [path, text] of [
      ['/admin/people', 'Mia Weber'],
      ['/admin/invites', 'Noch keine Einladungen.'],
      ['/admin/links', 'Fotos für die Familie'],
      ['/admin/audit', 'Anmeldung'],
      ['/admin/mail', 'SMTP-Server'],
      ['/admin/sso', 'Weiterleitungsadresse'],
      ['/admin/webhooks', 'Noch kein Ziel eingerichtet.'],
      ['/admin/backups', 'Vorhandene Sicherungen'],
      ['/admin/settings', 'Wartungsmodus einschalten'],
      ['/admin/system', 'Programme für Vorschauen'],
    ]) {
      await page.goto(`${base}${path}`);
      await visible(page, text);
    }
    await page.goto(`${base}/admin/scan`);
    await visible(page, 'Dateien beim Hochladen prüfen');
    await shot(page, 'admin-scan');
    await page.goto(`${base}/admin/sso`);
    await page.getByLabel('Adresse des Anbieters').fill('https://auth.example.com/application/o/moecloud/');
    await page.getByLabel('Client-ID').fill('moecloud');
    await page.getByLabel('Text auf dem Knopf').fill('Mit Authentik anmelden');
    await shot(page, 'admin-sso');
  });

  await step('Personen aus CSV importieren', async () => {
    await page.goto(`${base}/admin/people`);
    await page.getByRole('button', { name: 'Importieren' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'CSV' })
      .fill('username;name;email\nemily;Emily Sato;emily@example.com\nmia;Mia Weber;mia@example.com');
    await dialog.getByRole('button', { name: 'Prüfen' }).click();
    await dialog.getByText('Den Benutzernamen gibt es schon').waitFor();
    await dialog.getByRole('button', { name: 'Eine Person anlegen' }).click();
    await dialog.getByText('Fertig. So ist es gelaufen:').waitFor();
    await dialog.getByRole('button', { name: 'Schließen' }).click();
    await visible(page, 'Emily Sato');
    const mail = await smtp.mailTo('emily@example.com');
    if (!mail.includes('Passwort')) throw new Error('Der Link für Emily fehlt');
  });

  await step('Aus dem Internet laden', async () => {
    await api(page, 'PATCH', '/api/admin/settings', { 'import.private': true });
    await page.goto(`${base}/files`);
    await page.getByRole('button', { name: 'Neu', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Aus dem Internet laden' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Adresse').fill(`${base}/icons/icon-192.png`);
    await dialog.getByRole('button', { name: 'Laden' }).click();
    await item(page, 'icon-192.png').waitFor({ timeout: 20_000 });
    await api(page, 'PATCH', '/api/admin/settings', { 'import.private': false });
  });

  await step('Gruppe anlegen und damit teilen', async () => {
    await page.goto(`${base}/admin/groups`);
    await page.getByRole('button', { name: 'Gruppe anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Familie');
    await dialog.getByLabel('Mitglieder').click();
    await page.getByRole('option', { name: /Mia Weber/ }).click();
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await visible(page, 'Gruppe „Familie“ angelegt');
    await visible(page, '1 Mitglied');
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    const share = page.getByRole('dialog');
    await share.getByLabel('Person oder Gruppe', { exact: true }).fill('Fam');
    await page.getByRole('option', { name: /Familie/ }).click();
    await share.getByRole('button', { name: 'Teilen', exact: true }).click();
    await share.getByText('Familie', { exact: true }).first().waitFor();
    await share.getByRole('button', { name: 'Fertig', exact: true }).click();
    await share.waitFor({ state: 'detached' });
  });

  await step('Teamordner mit Mitgliedern und Startseite', async () => {
    await page.goto(`${base}/admin/teams`);
    await page.getByRole('button', { name: 'Teamordner anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Marketing');
    await dialog.getByLabel('Beschreibung (freiwillig)').fill('Kampagnen, Vorlagen und Bilder');
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await visible(page, 'Teamordner „Marketing“ angelegt');
    const members = page.getByRole('dialog');
    await members.getByText('Mitglieder von „Marketing“').waitFor();
    for (const name of ['Mia', 'Emi']) {
      await members.getByLabel('Person oder Gruppe hinzufügen').fill(name);
      await page
        .getByRole('option', { name: new RegExp(name) })
        .first()
        .click();
      await members.getByRole('listitem').filter({ hasText: name }).first().waitFor();
    }
    await members.getByLabel('Person oder Gruppe hinzufügen').fill('Fam');
    await page.getByRole('option', { name: /Familie/ }).click();
    await members.getByText('Gruppe · 1 Mitglied').waitFor();
    await members.getByLabel(/^Recht für Emi/).click();
    await page.getByRole('option', { name: 'Leitung', exact: true }).click();
    await page.waitForTimeout(300);
    await shot(page, 'teamordner-mitglieder');
    await members.getByRole('button', { name: 'Fertig', exact: true }).click();
    await members.waitFor({ state: 'detached' });
    await page.getByText(/2 Personen · 1 Gruppe · Kampagnen, Vorlagen und Bilder/).waitFor();
    const teams = await api<{ items: { rootId: string; name: string }[] }>(page, 'GET', '/api/teams');
    const rootId = teams.items.find((team) => team.name === 'Marketing')!.rootId;
    const folder = await api<{ node: { id: string } }>(page, 'POST', `/api/nodes/${rootId}/folders`, { name: 'Kampagne Herbst' });
    await api(page, 'POST', `/api/nodes/${folder.node.id}/text`, { name: 'Zeitplan.md', content: '# Zeitplan\n\n- Entwurf bis Freitag' });
    await api(page, 'POST', `/api/nodes/${rootId}/text`, { name: 'Leitfaden.md', content: '# Leitfaden\n\nSo arbeiten wir zusammen.' });
    await page.goto(`${base}/files/teams`);
    await page.getByRole('heading', { name: 'Marketing', exact: true }).waitFor();
    await visible(page, 'Leitung');
    await shot(page, 'teamordner');
    await page.getByRole('link', { name: /Marketing/ }).click();
    await item(page, 'Kampagne Herbst').waitFor();
    await item(page, 'Leitfaden.md').waitFor();
    await visible(page, 'Teamordner · Leitung');
    await item(page, 'Leitfaden.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'In den Papierkorb', exact: true }).click();
    await item(page, 'Leitfaden.md').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Papierkorb', exact: true }).click();
    const trash = page.getByRole('dialog');
    await trash.getByText('Leitfaden.md', { exact: true }).waitFor();
    await trash.getByRole('button', { name: 'Leitfaden.md wiederherstellen' }).click();
    await visible(page, 'Wiederhergestellt');
    await trash.getByRole('button', { name: 'Schließen', exact: true }).click();
    await item(page, 'Leitfaden.md').waitFor();
    await page.goto(`${base}/files/home`);
    await page.getByText(/^(Guten Morgen|Hallo|Guten Abend|Gute Nacht), Emi$/).waitFor();
    await page.getByRole('heading', { name: 'Zuletzt bearbeitet' }).waitFor();
    await page.getByRole('heading', { name: 'Teamordner' }).waitFor();
    await visible(page, 'Leitfaden.md');
    await page.waitForTimeout(400);
    await shot(page, 'start');
  });

  await step('Abläufe, Umwandeln und benannte Versionen', async () => {
    const session = await api<{ user: { rootId: string } }>(page, 'GET', '/api/session');
    const inbox = await api<{ node: { id: string } }>(page, 'POST', `/api/nodes/${session.user.rootId}/folders`, { name: 'Eingang' });
    await api(page, 'POST', '/api/tags', { name: 'Rechnung', color: 'green' });
    await page.goto(`${base}/files`);
    await item(page, 'Eingang').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Abläufe', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Abläufe für „Eingang“').waitFor();
    await dialog.getByText('Für diesen Ordner gibt es noch keinen Ablauf.').waitFor();
    await dialog.getByRole('button', { name: 'Neuer Ablauf' }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Rechnungen ablegen');
    await dialog.getByRole('button', { name: 'PDFs', exact: true }).click();
    await dialog.getByLabel('Name enthält').fill('Rechnung');
    await dialog.getByLabel('Schlagwort vergeben').click();
    await page.getByRole('option', { name: 'Rechnung', exact: true }).click();
    await dialog.getByLabel('Umbenennen nach Muster').fill('{datum} {name}');
    await dialog.getByLabel('Dort einsortieren').click();
    await page.getByRole('option', { name: 'In Ordner pro Jahr', exact: true }).click();
    await dialog.getByLabel('Mir Bescheid geben').check();
    await dialog.locator('.MuiDialogContent-root').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    await shot(page, 'automations');
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await visible(page, 'Ablauf angelegt');
    await dialog.getByText('Rechnungen ablegen', { exact: true }).waitFor();
    await dialog
      .getByText(/PDFs · Name enthält „Rechnung“ → Schlagwort „Rechnung“, umbenennen, nach Jahr einsortieren, Bescheid geben/)
      .waitFor();
    await dialog.getByRole('button', { name: 'Fertig', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Eingang').dblclick();
    await page.waitForURL('**/files/folder/**');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dateien hochladen' }).click();
    await (await chooser).setFiles({ name: 'Rechnung Strom.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
    const year = String(new Date().getFullYear());
    await item(page, year).waitFor();
    await item(page, year).dblclick();
    await page
      .getByRole('grid')
      .getByText(/^\d{4}-\d{2}-\d{2} Rechnung Strom\.pdf$/)
      .waitFor();
    await page.getByRole('grid').getByRole('img', { name: 'Schlagwörter: Rechnung' }).waitFor();
    const rules = await api<{ items: { runs: number; error: string | null }[] }>(page, 'GET', `/api/automations?folder=${inbox.node.id}`);
    if (rules.items[0].runs !== 1 || rules.items[0].error) throw new Error(`Ablauf: ${JSON.stringify(rules.items[0])}`);

    await page.goto(`${base}/files`);
    await item(page, 'Fotos').dblclick();
    await page.waitForURL('**/files/folder/**');
    const photo = page
      .getByRole('grid')
      .getByText(/\.jpg$/)
      .first();
    const photoName = (await photo.textContent())!.trim();
    await photo.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Umwandeln', exact: true }).click();
    const convert = page.getByRole('dialog');
    await convert.getByText(`„${photoName}“ umwandeln`).waitFor();
    await convert.getByRole('button', { name: 'WEBP', exact: true }).click();
    await visible(page, `„${photoName.replace(/\.jpg$/, '.webp')}“ gespeichert`);
    await item(page, photoName.replace(/\.jpg$/, '.webp')).waitFor();

    await page.goto(`${base}/files`);
    await item(page, 'Projekte').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Ideen.md').click();
    await page.getByRole('tab', { name: 'Info' }).click();
    await page.getByRole('button', { name: 'SHA-256 kopieren' }).waitFor();
    await page.getByRole('button', { name: 'Version benennen' }).first().click();
    const naming = page.getByRole('dialog');
    await naming.getByLabel('Name').fill('Erster Entwurf');
    await naming.getByRole('button', { name: 'Speichern', exact: true }).click();
    await naming.waitFor({ state: 'detached' });
    await visible(page, 'Erster Entwurf');
  });

  await step('Nutzungsbedingungen, Startdateien und Serverprotokoll', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Projekte').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Als Startdateien für neue Konten', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Nutzen', exact: true }).click();
    await visible(page, 'Neue Konten bekommen jetzt diese Dateien');
    await page.goto(`${base}/admin/settings`);
    await page.getByText(/Jedes neue Konto bekommt eine Kopie aus „Projekte“ von Emi/).waitFor();
    await page.getByRole('button', { name: 'Nicht mehr nutzen' }).click();
    await visible(page, 'Neue Konten starten wieder leer');
    await page.getByLabel('Gesperrte Dateiendungen').fill('exe, bat');
    await page.getByLabel('Nutzungsbedingungen', { exact: true }).fill('## Miteinander\n\nBitte geht sorgsam mit dem Speicher um.');
    await page.getByLabel('Zustimmung zu den Nutzungsbedingungen verlangen').check();
    await page.getByRole('button', { name: /Änderung(en)? speichern$/ }).click();
    await page.getByText(/1 von \d+ Personen haben der aktuellen Fassung zugestimmt\./).waitFor();
    const mia = await context('dark');
    const miaPage = await open(mia, 'Mia');
    await miaPage.goto(`${base}/login`);
    await miaPage.fill('input[name=login]', 'mia');
    await miaPage.fill('input[name=password]', password);
    await Promise.all([miaPage.waitForURL('**/nutzungsbedingungen'), miaPage.click('button[type=submit]')]);
    await miaPage.getByRole('heading', { name: 'Miteinander' }).waitFor();
    await shot(miaPage, 'terms');
    await miaPage.getByRole('button', { name: 'Ich stimme zu' }).click();
    await miaPage.waitForURL('**/files**');
    await mia.close();
    await page.reload();
    await page.getByText(/2 von \d+ Personen haben der aktuellen Fassung zugestimmt\./).waitFor();
    await page.getByLabel('Zustimmung zu den Nutzungsbedingungen verlangen').uncheck();
    await page.getByLabel('Gesperrte Dateiendungen').fill('');
    await page.getByRole('button', { name: /Änderung(en)? speichern$/ }).click();
    await page.getByLabel('Gesperrte Dateiendungen').waitFor();
    await page.waitForTimeout(400);
    await page.goto(`${base}/admin/system`);
    await page.getByRole('heading', { name: 'Serverprotokoll' }).waitFor();
    await page.getByRole('button', { name: 'Alles', exact: true }).click();
    await page
      .getByRole('list', { name: 'Serverprotokoll' })
      .getByText(/MoeCloud .* läuft auf Port/)
      .waitFor();
  });

  await step('Office-Dokument anlegen, bearbeiten und speichern', async () => {
    const edited = await readFile(join(root, 'src/assets/office/document.en.docx'));
    const office = await fakeCollabora(edited);
    try {
      await page.goto(`${base}/admin/settings`);
      await page.getByLabel('Eigene Adresse von Collabora').fill(office.url);
      await page.getByRole('button', { name: /Änderung(en)? speichern$/ }).click();
      await page.getByText(/Collabora antwortet\. 4 Dateiformate lassen sich bearbeiten, darunter docx, xlsx, pptx, odt\./).waitFor();
      await page.goto(`${base}/files`);
      await page.getByRole('button', { name: 'Neu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Neues Dokument' }).click();
      const editor = page.getByRole('dialog');
      await editor.getByRole('heading', { name: 'Dokument.docx' }).waitFor();
      const frame = page.frameLocator('iframe[name^="office-"]');
      await frame.locator('#state', { hasText: 'bereit' }).waitFor();
      const shown = {
        name: await frame.locator('#name').textContent(),
        user: await frame.locator('#user').textContent(),
        write: await frame.locator('#write').textContent(),
        size: Number(await frame.locator('#size').textContent()),
        ttl: Number(await frame.locator('#ttl').textContent()),
        mode: await frame.locator('#mode').textContent(),
      };
      if (shown.name !== 'Dokument.docx' || shown.user !== 'Emi Sato' || shown.write !== 'schreiben' || shown.size < 3000) {
        throw new Error(`CheckFileInfo: ${JSON.stringify(shown)}`);
      }
      if (shown.mode !== 'edit de true' || shown.ttl < Date.now() + 9 * 60 * 60 * 1000) throw new Error(`Aufruf: ${JSON.stringify(shown)}`);
      await frame.locator('#save').click();
      await frame.locator('#state', { hasText: 'gespeichert' }).waitFor();
      await frame.locator('#save').click();
      await page.waitForTimeout(300);
      await frame.locator('#state', { hasText: 'gespeichert' }).waitFor();
      if (office.saves.length !== 2 || office.saves.some((save) => save.status !== 200))
        throw new Error(`Speichern: ${JSON.stringify(office.saves)}`);
      await frame.locator('#close').click();
      await editor.waitFor({ state: 'detached' });
      await item(page, 'Dokument.docx').waitFor();
      const session = await api<{ user: { rootId: string } }>(page, 'GET', '/api/session');
      const list = await api<{ items: { id: string; name: string; size: number }[] }>(
        page,
        'GET',
        `/api/nodes/${session.user.rootId}/children`
      );
      const document = list.items.find((entry) => entry.name === 'Dokument.docx')!;
      if (document.size !== edited.length) throw new Error(`Größe nach dem Speichern: ${document.size}`);
      const versions = await api<{ items: unknown[] }>(page, 'GET', `/api/nodes/${document.id}/versions`);
      if (versions.items.length !== 1) throw new Error(`Versionen: ${versions.items.length}`);
      await item(page, 'Dokument.docx').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'In Office bearbeiten', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: 'Vorschau', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.goto(`${base}/files`);
      await item(page, 'Dokument.docx').waitFor();
      await api(page, 'POST', '/api/nodes/trash', { ids: [document.id] });
    } finally {
      await api(page, 'PATCH', '/api/admin/settings', { 'collabora.url': '' });
      await office.close();
    }
  });

  await step('Musik nach Alben und Wiedergabelisten', async () => {
    await page.goto(`${base}/files/music`);
    await visible(page, 'Morgens am Steg');
    await visible(page, 'Melodie');
    await page.getByRole('button', { name: 'Alben', exact: true }).click();
    await page.waitForURL('**/files/music/albums');
    const albums = page.getByRole('list', { name: 'Alben' });
    await albums.getByText('Nachtfahrt', { exact: true }).waitFor();
    await albums.getByText('Ohne Album', { exact: true }).waitFor();
    await images(page, '[role=list][aria-label="Alben"]');
    await shot(page, 'musik');
    await albums.getByText('Sommer am See', { exact: true }).click();
    await page.getByRole('heading', { name: 'Sommer am See' }).waitFor();
    await visible(page, 'Lea Hoffmann · 2025 · 3 Titel · 0:10');
    await page.getByRole('button', { name: 'Zur Wiedergabeliste', exact: true }).click();
    const picker = page.getByRole('dialog');
    await picker.getByLabel('Neue Wiedergabeliste').fill('Zum Kochen');
    await picker.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await visible(page, 'Zu „Zum Kochen“ hinzugefügt');
    await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
    await page.waitForURL('**/files/music/playlists/*');
    await page.getByRole('heading', { name: 'Zum Kochen' }).waitFor();
    await visible(page, '3 Titel · 0:10');
    await page.getByRole('button', { name: 'Aktionen für „Abendlicht“' }).click();
    await page.getByRole('menuitem', { name: 'Nach oben' }).click();
    const id = page.url().split('/').pop()!;
    const order = async () =>
      (await api<{ items: { track: { title: string } }[] }>(page, 'GET', `/api/playlists/${id}`)).items
        .map((entry) => entry.track.title)
        .join(', ');
    for (let tries = 0; (await order()) !== 'Morgens am Steg, Abendlicht, Mittagshitze'; tries++) {
      if (tries > 20) throw new Error(`Unerwartete Reihenfolge: ${await order()}`);
      await page.waitForTimeout(100);
    }
    await page.getByRole('button', { name: 'Aktionen für „Mittagshitze“' }).click();
    await page.getByRole('menuitem', { name: 'Aus der Liste nehmen' }).click();
    await visible(page, '2 Titel · 0:06');

    await page.goto(`${base}/files`);
    await item(page, 'Musik').dblclick();
    await page.waitForURL('**/files/folder/**');
    await item(page, 'Nachtfahrt').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Zur Wiedergabeliste hinzufügen' }).click();
    await page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Zum Kochen' }).click();
    await visible(page, 'Zu „Zum Kochen“ hinzugefügt');
    if ((await order()) !== 'Morgens am Steg, Abendlicht, Auffahrt, Raststätte')
      throw new Error(`Unerwartete Reihenfolge: ${await order()}`);

    await page.goto(`${base}/files/music/playlists`);
    await page.getByRole('list', { name: 'Wiedergabelisten' }).getByText('Zum Kochen', { exact: true }).click();
    await page.getByRole('button', { name: 'Abspielen', exact: true }).click();
    const player = page.getByRole('region', { name: 'Musik' });
    await player.getByRole('button', { name: 'Pause' }).waitFor();
    await player.getByRole('button', { name: 'Warteschlange' }).click();
    await page.getByText('4 Titel in der Warteschlange').waitFor();
    await page.keyboard.press('Escape');
    await player.getByRole('button', { name: 'Player schließen' }).click();
    await player.waitFor({ state: 'detached' });
  });

  await step('Notizen schreiben, abhaken und wiederfinden', async () => {
    await page.goto(`${base}/files/notes`);
    await visible(page, 'Noch keine Notizen');
    await page.getByRole('button', { name: 'Erste Notiz schreiben' }).click();
    await page.waitForURL('**/files/notes/*');
    const title = page.getByLabel('Titel der Notiz');
    await title.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Titel der Notiz');
    await page.keyboard.type('Wochenende');
    await page.keyboard.press('Enter');
    const text = page.getByLabel('Text der Notiz');
    await text.fill('## Einkauf\n\n- [ ] Brot\n- [ ] Äpfel\n\nAbends kommt **Lea** vorbei.\n');
    await page.getByRole('status').filter({ hasText: 'Gespeichert' }).waitFor();
    await page.getByRole('navigation', { name: 'Notizen' }).getByText('Wochenende', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Lesen', exact: true }).click();
    await page.getByRole('heading', { name: 'Einkauf' }).waitFor();
    const boxes = page.locator('.markdown li.task input[type=checkbox]');
    if ((await boxes.count()) !== 2) throw new Error(`Erwartet waren 2 Aufgaben, gefunden ${await boxes.count()}`);
    await boxes.nth(1).click();
    await page.locator('.markdown li.task input[type=checkbox]:checked').waitFor();
    await page.getByRole('status').filter({ hasText: 'Gespeichert' }).waitFor();
    await page.getByRole('button', { name: 'Schreiben', exact: true }).click();
    const written = await text.inputValue();
    if (written !== '## Einkauf\n\n- [ ] Brot\n- [x] Äpfel\n\nAbends kommt **Lea** vorbei.\n')
      throw new Error(`Unerwarteter Text: ${JSON.stringify(written)}`);
    await text.focus();
    await page.keyboard.press('Control+End');
    await page.getByRole('button', { name: 'Aufgabe zum Abhaken' }).click();
    await page.keyboard.type('Kuchen backen');
    await page.getByRole('status').filter({ hasText: 'Gespeichert' }).waitFor();

    await page.getByRole('button', { name: 'Neue Notiz', exact: true }).click();
    await page.waitForFunction(() => {
      const field = document.activeElement as HTMLInputElement | null;
      return field?.getAttribute('aria-label') === 'Titel der Notiz' && field.value === 'Neue Notiz';
    });
    await page.keyboard.type('Ideen fürs Fotobuch');
    await page.keyboard.press('Enter');
    await page.getByLabel('Text der Notiz').fill('Die Bilder aus Lissabon nach Tagen ordnen.');
    await page.getByRole('status').filter({ hasText: 'Gespeichert' }).waitFor();
    const list = page.getByRole('navigation', { name: 'Notizen' });
    await list.getByText('Ideen fürs Fotobuch', { exact: true }).waitFor();
    await list.getByText('Die Bilder aus Lissabon nach Tagen ordnen.', { exact: true }).waitFor();
    await list.getByText('Wochenende', { exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[aria-label="Titel der Notiz"]')?.value === 'Wochenende'
    );
    await page.getByRole('button', { name: 'Lesen', exact: true }).click();
    await page.locator('.markdown li.task input[type=checkbox]:checked').waitFor();
    await shot(page, 'notizen');

    const saved = await api<{ folderId: string; items: { id: string; name: string; title: string; excerpt: string }[] }>(
      page,
      'GET',
      '/api/notes'
    );
    const names = saved.items.map((entry) => entry.name).sort();
    if (names.join() !== 'Ideen fürs Fotobuch.md,Wochenende.md') throw new Error(`Unerwartete Notizen: ${names.join()}`);
    const weekend = saved.items.find((entry) => entry.title === 'Wochenende')!;
    const content = await api<{ content: string }>(page, 'GET', `/api/notes/${weekend.id}`);
    if (content.content !== '## Einkauf\n\n- [ ] Brot\n- [x] Äpfel\n\nAbends kommt **Lea** vorbei.\n- [ ] Kuchen backen') {
      throw new Error(`Unerwarteter Inhalt: ${JSON.stringify(content.content)}`);
    }

    await page.getByPlaceholder('Notizen durchsuchen').fill('lissabon');
    await list.getByText('Wochenende', { exact: true }).waitFor({ state: 'detached' });
    await page.getByPlaceholder('Notizen durchsuchen').fill('');
    await list.getByText('Wochenende', { exact: true }).click();
    await page.getByRole('button', { name: 'Zu den Favoriten' }).click();
    await page.getByRole('button', { name: 'Aus den Favoriten nehmen' }).waitFor();
    await page.goto(`${base}/files`);
    await item(page, 'Notizen').dblclick();
    await item(page, 'Wochenende.md').waitFor();
    await item(page, 'Ideen fürs Fotobuch.md').waitFor();

    const phoneContext = await context('light', true);
    const phone = await open(phoneContext, 'Handy');
    await login(phone, 'emi');
    await phone.goto(`${base}/files/notes`);
    const phoneList = phone.getByRole('navigation', { name: 'Notizen' });
    await phoneList.getByText('Wochenende', { exact: true }).waitFor();
    if (await phone.getByLabel('Titel der Notiz').count()) throw new Error('Auf dem Handy soll zuerst nur die Liste erscheinen');
    await phoneList.getByText('Wochenende', { exact: true }).click();
    await phone.getByLabel('Titel der Notiz').waitFor();
    await phone.getByRole('button', { name: 'Lesen', exact: true }).click();
    await phone.locator('.markdown li.task input[type=checkbox]').first().waitFor();
    await phone.getByRole('button', { name: 'Zu den Notizen' }).click();
    await phoneList.getByText('Ideen fürs Fotobuch', { exact: true }).waitFor();
    await phone.goto(`${base}/files/music/albums`);
    await phone.getByRole('list', { name: 'Alben' }).getByText('Sommer am See', { exact: true }).click();
    await phone.getByRole('heading', { name: 'Sommer am See' }).waitFor();
    await phoneContext.close();
  });

  await step('Notiz zur Freigabe, App-Passwort mit Rechten und Konten mit Freigabe', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Urlaub 2026').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    const share = page.getByRole('dialog');
    await share.getByLabel('Person oder Gruppe', { exact: true }).fill('Lea');
    await page.getByRole('option', { name: /Lea/ }).first().click();
    await share.getByLabel('Notiz dazu (freiwillig)').fill('Such dir die schönsten aus');
    await share.getByRole('button', { name: 'Teilen', exact: true }).click();
    await share.getByText(/„Such dir die schönsten aus“/).waitFor();
    await share.getByRole('button', { name: 'Fertig', exact: true }).click();
    await share.waitFor({ state: 'detached' });
    const leaContext = await context('light');
    const lea = await open(leaContext, 'Lea');
    await login(lea, 'lea');
    await lea.goto(`${base}/files/shared`);
    await lea
      .getByText(/„Such dir die schönsten aus“/)
      .first()
      .waitFor();
    await leaContext.close();

    await page.goto(`${base}/account`);
    await page.getByRole('button', { name: 'App-Passwort erstellen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Bilderrahmen');
    await dialog.getByLabel(/^Nur lesen/).check();
    await dialog.getByLabel(/^Im Laufwerk auch Teamordner und Geteiltes zeigen/).check();
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await dialog.getByText('Kopiere das Passwort jetzt. Danach zeigt MoeCloud es nicht mehr an.').waitFor();
    await dialog.getByRole('button', { name: 'Fertig', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(/nur lesen · mit Teamordnern und Geteiltem · noch nie genutzt/).waitFor();

    await api(page, 'PATCH', '/api/admin/settings', { 'auth.registration': 'approval' });
    const guest = await context('light');
    const signup = await open(guest, 'Neu');
    await signup.goto(`${base}/register`);
    await signup.fill('input[name=name]', 'Emily Neu');
    await signup.fill('input[name=username]', 'emily-neu');
    await signup.fill('input[name=password]', password);
    await signup.click('button[type=submit]');
    await signup.getByText(/Dein Konto ist angelegt und wartet auf die Freigabe durch die Verwaltung/).waitFor();
    await page.goto(`${base}/admin/people`);
    await page.getByText('Ein Konto wartet auf deine Freigabe').waitFor();
    await page.getByRole('button', { name: 'Emily Neu freigeben' }).click();
    await visible(page, 'Emily Neu kann sich jetzt anmelden');
    await page.getByText('Ein Konto wartet auf deine Freigabe').waitFor({ state: 'detached' });
    await signup.fill('input[name=login]', 'emily-neu');
    await signup.fill('input[name=password]', password);
    await Promise.all([signup.waitForURL('**/files**'), signup.click('button[type=submit]')]);
    await guest.close();
    await api(page, 'PATCH', '/api/admin/settings', { 'auth.registration': 'closed' });
  });

  await step('Ordnersymbol und Weblink', async () => {
    await page.goto(`${base}/files`);
    await item(page, 'Dokumente').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Symbol', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Symbol' }).getByRole('radio', { name: 'Arbeit' }).click();
    await page.locator('[data-folder-icon=work]').first().waitFor({ state: 'attached' });
    await item(page, 'Fotos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Symbol', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Symbol' }).getByRole('radio', { name: 'Fotos' }).click();
    await page.locator('[data-folder-icon=photo]').first().waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Als Kacheln zeigen' }).click();
    await page.locator('[data-folder-icon=photo]').first().waitFor();
    await shot(page, 'ordner-symbole');
    await page.getByRole('button', { name: 'Als Liste zeigen' }).click();
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Neuer Weblink' }).click();
    const prompt = page.getByRole('dialog');
    await prompt.getByLabel('Adresse').fill('https://moestudio.net/apps');
    await prompt.getByRole('button', { name: 'Erstellen' }).click();
    await item(page, 'moestudio.net apps.url').dblclick();
    const card = page.locator('[data-weblink]');
    await card.getByText('moestudio.net', { exact: true }).waitFor();
    const href = await card.getByRole('link', { name: 'Link öffnen' }).getAttribute('href');
    if (href !== 'https://moestudio.net/apps') throw new Error(`Unerwartetes Ziel: ${href}`);
    const rel = await card.getByRole('link', { name: 'Link öffnen' }).getAttribute('rel');
    if (!rel?.includes('noopener')) throw new Error('Der Weblink öffnet sich ohne noopener');
    await shot(page, 'weblink');
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'detached' });
  });

  await step('Darstellung, Navigation und Startseite anpassen', async () => {
    await page.goto(`${base}/account`);
    await page.getByRole('group', { name: 'Schriftgröße' }).getByRole('button', { name: 'Groß', exact: true }).click();
    await page.getByRole('group', { name: 'Zeilen in Listen' }).getByRole('button', { name: 'Kompakt' }).click();
    await page.getByRole('group', { name: 'Kacheln in der Rasteransicht' }).getByRole('button', { name: 'Klein' }).click();
    await page.getByRole('switch', { name: /Farbschimmer im Hintergrund/ }).check();
    await page.getByRole('switch', { name: /Weniger Bewegung/ }).check();
    const look = await page.evaluate(() => {
      const root = document.documentElement;
      return [
        root.style.fontSize,
        root.style.getPropertyValue('--moe-row'),
        root.style.getPropertyValue('--moe-tile'),
        root.dataset.backdrop,
        root.dataset.motion,
        getComputedStyle(document.body).backgroundImage.includes('radial-gradient'),
      ].join('|');
    });
    if (look !== '110%|44px|0.75|glow|reduced|true') throw new Error(`Unerwartete Darstellung: ${look}`);
    await page.getByText('Nur in diesem Browser', { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, 'darstellung');
    await page.goto(`${base}/files`);
    const row = await item(page, 'Dokumente').evaluate((node) => node.closest('[role=row]')!.getBoundingClientRect().height);
    if (Math.round(row) !== 44) throw new Error(`Kompakte Zeilen sollen 44 px hoch sein, sind aber ${row}`);
    await page.goto(`${base}/account`);
    await page.getByRole('group', { name: 'Schriftgröße' }).getByRole('button', { name: 'Normal', exact: true }).click();
    await page.getByRole('group', { name: 'Zeilen in Listen' }).getByRole('button', { name: 'Luftig' }).click();
    await page.getByRole('group', { name: 'Kacheln in der Rasteransicht' }).getByRole('button', { name: 'Mittel' }).click();
    await page.getByRole('switch', { name: /Farbschimmer im Hintergrund/ }).uncheck();
    await page.getByRole('switch', { name: /Weniger Bewegung/ }).uncheck();

    await page.getByRole('button', { name: 'Navigation anpassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('switch', { name: '„Schlagwörter“ anzeigen' }).uncheck();
    const up = dialog.getByRole('button', { name: '„Notizen“ nach oben' });
    while (await up.isEnabled()) await up.click();
    await dialog.getByRole('button', { name: '„Fotos“ auf dem Handy in der unteren Leiste' }).click();
    await dialog.getByRole('button', { name: '„Notizen“ auf dem Handy in der unteren Leiste' }).click();
    await shot(page, 'navigation');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await visible(page, 'Navigation gespeichert');
    await inNavigation(page, 'Schlagwörter', false);
    await inNavigation(page, 'Notizen', true);
    const order = await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .first()
      .evaluate((nav) =>
        [...nav.querySelectorAll('a')]
          .map((link) => link.getAttribute('href'))
          .slice(0, 3)
          .join(' ')
      );
    if (order !== '/files /files/notes /files/home') throw new Error(`Unerwartete Reihenfolge in der Navigation: ${order}`);
    const phoneContext = await context('dark', true);
    const phone = await open(phoneContext, 'Handy');
    await login(phone, 'emi');
    const bar = await phone
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .last()
      .evaluate((nav) => [...nav.querySelectorAll('a')].map((link) => link.getAttribute('href')).join(' '));
    if (bar !== '/files/notes /files/home /files /files/shared /account') throw new Error(`Unerwartete untere Leiste: ${bar}`);
    await phoneContext.close();
    await page.getByRole('button', { name: 'Navigation anpassen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zurücksetzen' }).click();
    await visible(page, 'Navigation zurückgesetzt');
    await inNavigation(page, 'Schlagwörter', true);

    await page.goto(`${base}/files/home`);
    await page.getByRole('heading', { name: 'Speicher', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Startseite anpassen' }).click();
    const home = page.getByRole('dialog');
    await home.getByRole('switch', { name: '„Speicher“ anzeigen' }).uncheck();
    const first = home.getByRole('button', { name: '„Favoriten“ nach oben' });
    while (await first.isEnabled()) await first.click();
    await home.getByRole('button', { name: 'Speichern' }).click();
    await home.waitFor({ state: 'detached' });
    await page.getByRole('heading', { name: 'Speicher', exact: true }).waitFor({ state: 'detached' });
    const top = await page.locator('#inhalt h2').first().textContent();
    if (top !== 'Favoriten') throw new Error(`Oben soll „Favoriten“ stehen, dort steht „${top}“`);
    await page.reload();
    await page.getByRole('heading', { name: 'Favoriten', exact: true }).waitFor();
    if (await page.getByRole('heading', { name: 'Speicher', exact: true }).count())
      throw new Error('„Speicher“ ist nach dem Neuladen wieder da');
    await page.getByRole('button', { name: 'Startseite anpassen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zurücksetzen' }).click();
    await page.getByRole('heading', { name: 'Speicher', exact: true }).waitFor();
  });

  await step('Aufgaben aus Notizen und Vorschau daneben', async () => {
    await page.goto(`${base}/files/notes`);
    const list = page.getByRole('navigation', { name: 'Notizen' });
    await list.getByRole('link', { name: 'Aufgaben' }).click();
    await page.waitForURL('**/files/notes/tasks');
    const tasks = page.locator('[data-note-tasks]');
    await tasks.getByText('2 offen · eine erledigt', { exact: true }).waitFor();
    await tasks.getByRole('checkbox', { name: 'Brot' }).click();
    await tasks.getByText('Eine offen · 2 erledigt', { exact: true }).waitFor();
    if (await tasks.getByRole('checkbox', { name: 'Brot' }).count()) throw new Error('Erledigtes soll aus der Liste verschwinden');
    await tasks.getByRole('switch', { name: 'Erledigte zeigen' }).check();
    await tasks.getByRole('checkbox', { name: 'Äpfel' }).waitFor();
    await shot(page, 'aufgaben');
    await tasks.getByRole('link', { name: /Wochenende/ }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[aria-label="Titel der Notiz"]')?.value === 'Wochenende'
    );
    await page.getByRole('button', { name: 'Beides', exact: true }).click();
    const preview = page.locator('[data-note-preview]');
    await preview.getByRole('heading', { name: 'Einkauf' }).waitFor();
    const text = page.getByLabel('Text der Notiz');
    if (!(await text.inputValue()).includes('- [x] Brot')) throw new Error('Die abgehakte Aufgabe steht nicht in der Notiz');
    await text.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n### Später');
    await preview.getByRole('heading', { name: 'Später' }).waitFor();
    await page
      .getByRole('status')
      .filter({ hasText: /^Gespeichert/ })
      .waitFor();
    await shot(page, 'notiz-beides');
    await page.getByRole('button', { name: 'Schreiben', exact: true }).click();
    await preview.waitFor({ state: 'detached' });
  });

  await step('Tempo, Schlummern und oft Gehörtes', async () => {
    await page.goto(`${base}/files/music`);
    await visible(page, 'Morgens am Steg');
    await page.getByRole('button', { name: 'Alle abspielen' }).click();
    const player = page.getByRole('region', { name: 'Musik' });
    await player.getByRole('button', { name: 'Warteschlange' }).click();
    const panel = page.getByRole('presentation').filter({ hasText: 'Wiedergabe' }).last();
    await panel.getByRole('button', { name: /^Tempo/ }).click();
    await page.getByRole('menuitem', { name: '1,5×' }).click();
    await panel.getByRole('button', { name: 'Tempo: 1,5×' }).waitFor();
    const rate = await page.evaluate(() => JSON.parse(localStorage.getItem('moe-player') ?? '{}').rate);
    if (rate !== 1.5) throw new Error(`Das Tempo wurde nicht gemerkt: ${rate}`);
    await panel.getByRole('button', { name: 'Schlummern' }).click();
    await page.getByRole('menuitem', { name: 'In 30 Minuten anhalten' }).click();
    await panel.getByRole('button', { name: 'Noch 30 Minuten' }).waitFor();
    await shot(page, 'musik-player');
    await panel.getByRole('button', { name: 'Noch 30 Minuten' }).click();
    await page.getByRole('menuitem', { name: 'Schlummern ausschalten' }).click();
    await panel.getByRole('button', { name: 'Schlummern' }).waitFor();
    await panel.getByRole('button', { name: 'Tempo: 1,5×' }).click();
    await page.getByRole('menuitem', { name: 'Normal' }).click();
    await page.keyboard.press('Escape');
    const tracks = await api<{ items: { id: string; track: { title: string } }[] }>(page, 'GET', '/api/music');
    const steg = tracks.items.find((entry) => entry.track.title === 'Morgens am Steg')!;
    await api(page, 'POST', '/api/music/played', { id: steg.id });
    await api(page, 'POST', '/api/music/played', { id: steg.id });
    await page.getByLabel('Titel sortieren').click();
    await page.getByRole('option', { name: 'Oft gehört' }).click();
    await page
      .getByText(/^\d+-mal gehört$/)
      .first()
      .waitFor();
    const top = await page.getByRole('list', { name: 'Oft gehört' }).getByRole('listitem').first().textContent();
    if (!top?.includes('Morgens am Steg')) throw new Error(`Oben soll „Morgens am Steg“ stehen: ${top}`);
    await page.getByLabel('Titel sortieren').click();
    await page.getByRole('option', { name: 'Nach Interpret' }).click();
    await player.getByRole('button', { name: 'Player schließen' }).click();
    await player.waitFor({ state: 'detached' });
  });

  await step('Link mit Beginn, Nachricht und eigenem Aussehen', async () => {
    const root = (await api<{ user: { rootId: string } }>(page, 'GET', '/api/session')).user.rootId;
    const listing = await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/nodes/${root}/children`);
    const photos = listing.items.find((entry) => entry.name === 'Fotos')!;
    const created = await api<{ link: { id: string } }>(page, 'POST', `/api/nodes/${photos.id}/links`, { label: 'Für Mia' });
    await page.goto(`${base}/files`);
    await item(page, 'Fotos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Teilen', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const row = dialog.locator(`[data-link="${created.link.id}"]`);
    await row.getByText('Für Mia', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Einstellungen' }).click();
    await row.getByLabel('Nachricht für Besucher (freiwillig)').fill('Hallo Mia, hier sind die Bilder vom Wochenende.');
    await row.getByLabel('Aussehen der Seite').click();
    await page.getByRole('option', { name: 'Ozean' }).click();
    await row.getByLabel('Aussehen der Seite').scrollIntoViewIfNeeded();
    await shot(page, 'link-gestalten');
    await row.getByRole('button', { name: 'Speichern', exact: true }).click();
    let link: { id: string; url: string; theme: string | null; message: string | null } | undefined;
    for (let tries = 0; tries < 30; tries++) {
      const shares = await api<{ links: { id: string; url: string; theme: string | null; message: string | null }[] }>(
        page,
        'GET',
        `/api/nodes/${photos.id}/shares`
      );
      link = shares.links.find((entry) => entry.id === created.link.id);
      if (link?.theme === 'ozean') break;
      await page.waitForTimeout(200);
    }
    if (!link) throw new Error('Der Link „Für Mia“ fehlt');
    if (link.theme !== 'ozean' || !link.message?.startsWith('Hallo Mia')) throw new Error(`Unerwarteter Link: ${JSON.stringify(link)}`);
    await page.keyboard.press('Escape');

    const guests = await context('light');
    const guest = await open(guests, 'Gast');
    await guest.goto(link.url);
    await guest.locator('[data-share-message]').getByText('Hallo Mia, hier sind die Bilder vom Wochenende.').waitFor();
    await guest.locator('[data-share-message]').getByText('Nachricht von Emi', { exact: false }).waitFor();
    const theme = await guest.evaluate(() => JSON.parse(document.getElementById('moe-boot')!.textContent!).theme.id);
    if (theme !== 'ozean') throw new Error(`Die Seite des Links nutzt das Theme „${theme}“`);
    await shot(guest, 'link-nachricht');
    await api(page, 'PATCH', `/api/links/${link.id}`, { startsAt: Date.now() + 3 * 86_400_000 });
    const early = await guests.request.get(link.url, { headers: { accept: 'text/html' } });
    if (early.status() !== 404) throw new Error(`Vor dem Beginn soll der Link 404 liefern, es kam ${early.status()}`);
    if (!(await early.text()).includes('Dieser Link ist noch nicht freigeschaltet')) throw new Error('Die Seite nennt den Beginn nicht');
    await guests.close();
    await api(page, 'DELETE', `/api/links/${link.id}`);
  });

  await step('Logo, Anmeldeseite und Registrierung mit Bestätigung', async () => {
    const logo = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 14, g: 165, b: 233, alpha: 1 } } })
      .png()
      .toBuffer();
    const backdrop = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#1e293b' },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1250" cy="240" r="320" fill="#ffffff" fill-opacity="0.12"/><circle cx="300" cy="760" r="420" fill="#000000" fill-opacity="0.18"/></svg>'
          ),
        },
      ])
      .jpeg()
      .toBuffer();
    await page.goto(`${base}/admin/settings`);
    await page.locator('[data-branding=logo] input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
    await visible(page, 'Bild gespeichert');
    await page.locator('[data-branding=logo] img').waitFor();
    await page
      .locator('[data-branding=background] input[type=file]')
      .setInputFiles({ name: 'hintergrund.jpg', mimeType: 'image/jpeg', buffer: backdrop });
    await page.locator('[data-branding=background] img').waitFor();
    await page.getByLabel('Überschrift der Anmeldung').fill('Willkommen bei Emi');
    await page.getByLabel('Begrüßung auf der Anmeldeseite').fill('Schön, dass du da bist. Deine Dateien warten schon.');
    await page.getByRole('group', { name: 'Platz der Anmeldung' }).getByRole('button', { name: 'Rechts' }).click();
    await page.getByRole('button', { name: /Änderung(en)? speichern$/ }).click();
    await visible(page, 'Gespeichert');
    await page.locator('[data-branding=logo]').scrollIntoViewIfNeeded();
    await shot(page, 'anmeldeseite-einstellen');
    const railLogo = await page.getByRole('navigation', { name: 'Hauptnavigation' }).first().locator('img').first().getAttribute('src');
    if (!railLogo?.startsWith('/branding/logo?v=')) throw new Error(`In der Seitenleiste steht noch das alte Logo: ${railLogo}`);

    const guests = await context('dark');
    const guest = await open(guests, 'Gast');
    await guest.goto(`${base}/login`);
    await guest.getByRole('heading', { name: 'Willkommen bei Emi' }).waitFor();
    await guest.getByText('Schön, dass du da bist. Deine Dateien warten schon.').waitFor();
    const design = await guest.evaluate(() => {
      const main = document.querySelector('main')!;
      const card = document.querySelector('.auth__card')!.getBoundingClientRect();
      return [
        main.className,
        getComputedStyle(main).backgroundImage.includes('/branding/background'),
        card.left > window.innerWidth / 2,
        document.querySelector<HTMLImageElement>('.auth__logo')?.naturalWidth ?? 0,
      ].join('|');
    });
    if (design !== 'auth auth--image auth--right|true|true|256') throw new Error(`Unerwartete Anmeldeseite: ${design}`);
    await shot(guest, 'anmeldung-gestaltet');

    await api(page, 'PATCH', '/api/admin/settings', {
      'auth.registration': 'open',
      'auth.confirmEmail': true,
      'auth.domains': 'example.com',
    });
    const quiet = await guests.newPage();
    quiet.setDefaultTimeout(15_000);
    await quiet.goto(`${base}/register`);
    await quiet.fill('input[name=name]', 'Nora Winter');
    await quiet.fill('input[name=username]', 'nora');
    await quiet.fill('input[name=email]', 'nora@anderswo.test');
    await quiet.fill('input[name=password]', password);
    await quiet.click('button[type=submit]');
    await quiet.getByText(/Erlaubt sind Adressen von example\.com/).waitFor();
    await quiet.fill('input[name=email]', 'nora@example.com');
    await quiet.fill('input[name=password]', password);
    await quiet.click('button[type=submit]');
    await quiet.getByText(/Wir haben dir eine E-Mail geschickt/).waitFor();
    const mail = await smtp.mailTo('nora@example.com');
    const confirm = /\/register\/confirm\?token=[0-9A-Za-z_-]+/.exec(mail)?.[0];
    if (!confirm) throw new Error('In der E-Mail steht kein Link zum Bestätigen');
    await quiet.fill('input[name=login]', 'nora');
    await quiet.fill('input[name=password]', password);
    await quiet.click('button[type=submit]');
    await quiet.getByText(/Bestätige zuerst deine E-Mail-Adresse/).waitFor();
    await quiet.close();
    await page.goto(`${base}/admin/people`);
    await visible(page, 'E-Mail nicht bestätigt');
    await guest.goto(`${base}${confirm}`);
    await guest.getByText('Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.').waitFor();
    await guest.fill('input[name=password]', password);
    await Promise.all([guest.waitForURL('**/files**'), guest.click('button[type=submit]')]);
    await guests.close();

    await api(page, 'PATCH', '/api/admin/settings', {
      'auth.registration': 'closed',
      'auth.confirmEmail': false,
      'auth.domains': '',
      'login.title': '',
      'login.text': '',
      'login.layout': 'center',
    });
    await api(page, 'DELETE', '/api/admin/branding/logo');
    await api(page, 'DELETE', '/api/admin/branding/background');
    const people = await api<{ items: { id: number; username: string }[] }>(page, 'GET', '/api/admin/users');
    const nora = people.items.find((entry) => entry.username === 'nora');
    if (nora) await api(page, 'DELETE', `/api/admin/users/${nora.id}`);
  });

  await step('Teilen aus anderen Apps in die Cloud', async () => {
    await page.goto(`${base}/files`);
    const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
    if (manifest.share_target?.action !== '/share-target' || manifest.shortcuts?.length !== 4)
      throw new Error(`Im Manifest fehlen Teilen-Ziel oder Kurzbefehle: ${JSON.stringify(manifest).slice(0, 200)}`);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/files' && !url.searchParams.has('geteilt')),
      page.evaluate(() => {
        const form = document.createElement('form');
        form.method = 'post';
        form.enctype = 'multipart/form-data';
        form.action = '/share-target';
        const input = document.createElement('input');
        input.type = 'file';
        input.name = 'files';
        const transfer = new DataTransfer();
        transfer.items.add(new File(['Aus einer anderen App geteilt'], 'geteilt aus der App.txt', { type: 'text/plain' }));
        input.files = transfer.files;
        form.append(input);
        document.body.append(form);
        form.submit();
      }),
    ]);
    await item(page, 'geteilt aus der App.txt').waitFor();
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/files' && !url.searchParams.has('geteilt')),
      page.evaluate(() => {
        const form = document.createElement('form');
        form.method = 'post';
        form.enctype = 'multipart/form-data';
        form.action = '/share-target';
        for (const [name, value] of [
          ['title', 'MoeStudio'],
          ['text', 'https://moestudio.net'],
        ]) {
          const field = document.createElement('input');
          field.type = 'hidden';
          field.name = name;
          field.value = value;
          form.append(field);
        }
        document.body.append(form);
        form.submit();
      }),
    ]);
    await visible(page, 'Weblink gespeichert');
    await item(page, 'MoeStudio.url').waitFor();
  });

  await step('Sicherheitsprüfung, gesperrte Anmeldung und Konto absichern', async () => {
    await page.goto(`${base}/admin/security`);
    await page.getByRole('heading', { name: 'Sicherheit', exact: true }).waitFor();
    await page.locator('[data-check="https"][data-level="hint"]').waitFor();
    await page.locator('[data-check="admins"]').waitFor();
    await page.getByLabel('Adresse für Meldungen').fill('sicherheit@example.com');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await visible(page, 'Gespeichert');
    const contact = await page.evaluate(async () => (await fetch('/.well-known/security.txt')).text());
    if (!contact.startsWith('Contact: mailto:sicherheit@example.com\n'))
      throw new Error(`security.txt stimmt nicht: ${contact.slice(0, 120)}`);

    const stranger = await context('light');
    await stranger.request.get(`${base}/login`);
    const csrf = (await stranger.cookies()).find((cookie) => cookie.name === 'moe_csrf')?.value ?? '';
    for (let attempt = 0; attempt < 11; attempt++) {
      await stranger.request.post(`${base}/login`, {
        form: { _csrf: csrf, login: 'lea', password: `falsch-${attempt}-falsch`, next: '/files' },
        maxRedirects: 0,
      });
    }
    await stranger.close();
    await page.getByRole('button', { name: 'Neu prüfen' }).click();
    await page.getByText(/^Konto, gesperrt bis/).waitFor();
    await shot(page, 'admin-security');
    await page.getByRole('button', { name: 'Sperre für lea aufheben' }).click();
    await visible(page, 'Sperre aufgehoben');
    await page.getByText(/^Konto, gesperrt bis/).waitFor({ state: 'detached' });

    const miaContext = await context('light');
    const mia = await open(miaContext, 'Mia');
    await login(mia, 'mia');
    const elsewhere = await context('light');
    await elsewhere.request.get(`${base}/login`);
    const token2 = (await elsewhere.cookies()).find((cookie) => cookie.name === 'moe_csrf')?.value ?? '';
    await elsewhere.request.post(`${base}/login`, { form: { _csrf: token2, login: 'mia', password, next: '/files' }, maxRedirects: 0 });
    if ((await elsewhere.request.get(`${base}/api/session`)).status() !== 200) throw new Error('Das zweite Gerät ist nicht angemeldet');
    await mia.goto(`${base}/account`);
    await mia.getByLabel('E-Mail', { exact: true }).fill('mia.neu@example.com');
    await mia.getByRole('button', { name: 'Speichern', exact: true }).first().click();
    const confirm = mia.getByRole('dialog');
    await confirm.getByRole('heading', { name: 'E-Mail-Adresse ändern' }).waitFor();
    await confirm.getByLabel('Aktuelles Passwort').fill(password);
    await confirm.getByRole('button', { name: 'Adresse ändern' }).click();
    await confirm.waitFor({ state: 'detached' });
    await mia.waitForFunction(async () => {
      const session = (await (await fetch('/api/session')).json()) as { user: { email: string } };
      return session.user.email === 'mia.neu@example.com';
    });

    await mia.getByRole('button', { name: 'App-Passwort erstellen' }).click();
    const token = mia.getByRole('dialog');
    await token.getByLabel('Name').fill('Altes Handy');
    await token.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await token.getByRole('button', { name: 'Fertig', exact: true }).click();
    await token.waitFor({ state: 'detached' });
    await mia
      .getByText(/Altes Handy/)
      .first()
      .waitFor();

    await mia.getByRole('button', { name: 'Absichern', exact: true }).click();
    const secure = mia.getByRole('dialog');
    await secure.getByRole('heading', { name: 'Konto absichern' }).waitFor();
    await secure.getByLabel('Aktuelles Passwort').fill(password);
    await shot(mia, 'account-secure');
    await secure.getByRole('button', { name: 'Jetzt absichern' }).click();
    await secure.getByText(/^Erledigt: \d+ Sitzungen beendet, 1 App-Passwörter widerrufen, 0 Links pausiert/).waitFor();
    await secure.getByRole('button', { name: 'Fertig', exact: true }).click();
    await secure.waitFor({ state: 'detached' });
    await mia
      .getByText(/Altes Handy/)
      .first()
      .waitFor({ state: 'detached' });
    const kicked = await elsewhere.request.get(`${base}/api/session`);
    if (kicked.status() !== 401) throw new Error(`Das zweite Gerät ist noch angemeldet (${kicked.status()})`);
    await elsewhere.close();
    await miaContext.close();
  });

  await step('Dateien prüfen, Verwaltung nur aus eigenen Netzen und Protokoll als CSV', async () => {
    await page.goto(`${base}/admin/security`);
    await page.getByRole('heading', { name: 'Dateien prüfen' }).waitFor();
    await page.locator('[data-integrity="never"]').waitFor();
    await page.locator('[data-check="integrity"][data-level="hint"]').waitFor();
    await page.getByRole('button', { name: 'Jetzt prüfen' }).click();
    await page.locator('[data-integrity="ok"]').waitFor({ timeout: 60_000 });
    await page.getByText(/^Zuletzt geprüft am .+ gelesen, alles in Ordnung\.$/).waitFor();
    await page.locator('[data-check="integrity"][data-level="ok"]').waitFor();
    await page.getByLabel('Von selbst prüfen').click();
    await page.getByRole('option', { name: 'Jeden Monat, nachts' }).click();
    await visible(page, 'Gespeichert');

    const { address } = await api<{ address: string }>(page, 'GET', '/api/admin/security');
    const networks = page.getByLabel('Adressen und Netze');
    const { csrf } = (await (await page.context().request.get(`${base}/api/session`)).json()) as { csrf: string };
    const refused = await page.context().request.put(`${base}/api/admin/security/networks`, {
      data: { networks: '192.0.2.0/24' },
      headers: { 'x-csrf-token': csrf, origin: base },
    });
    const reason = refused.status() === 400 ? ((await refused.json()) as { error: { message: string } }).error.message : '';
    if (!/steht nicht in der Liste, du würdest dich aussperren/.test(reason))
      throw new Error(`Eine Liste ohne die eigene Adresse wurde nicht abgelehnt (${refused.status()} ${reason})`);
    await networks.fill(`${address}\n192.0.2.0/24`);
    await page.getByRole('button', { name: 'Netze speichern' }).click();
    await visible(page, 'Die Verwaltung ist jetzt beschränkt');
    await page.locator('[data-check="networks"][data-level="ok"]').waitFor();
    await page.getByRole('heading', { name: 'Dateien prüfen' }).scrollIntoViewIfNeeded();
    await shot(page, 'admin-integrity');
    await networks.fill('');
    await page.getByRole('button', { name: 'Netze speichern' }).click();
    await visible(page, 'Die Verwaltung ist wieder von überall erreichbar');
    await page.locator('[data-check="networks"]').waitFor({ state: 'detached' });
    await api(page, 'PATCH', '/api/admin/settings', { 'integrity.schedule': 'off' });

    await page.goto(`${base}/admin/audit`);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Als CSV laden' }).click();
    const file = await download;
    if (!/^moecloud-protokoll-\d{4}-\d{2}-\d{2}\.csv$/.test(file.suggestedFilename()))
      throw new Error(`Die Datei heißt ${file.suggestedFilename()}`);
    const csv = (await readFile(await file.path())).toString('utf8');
    if (!csv.includes('"Zeit","Ereignis","Benutzername"') || !csv.includes('"integrity_checked"'))
      throw new Error(`Im Protokoll fehlt etwas: ${csv.slice(0, 200)}`);
  });

  await step('Eigenes Passwort bei der ersten Anmeldung', async () => {
    await page.goto(`${base}/admin/people`);
    await page.getByRole('button', { name: 'Person anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Name/).fill('Emily Start');
    await dialog.getByLabel('Benutzername').fill('emily-start');
    const link = dialog.getByLabel('Link per E-Mail schicken, damit die Person ihr Passwort selbst wählt');
    if ((await link.count()) > 0 && (await link.isChecked())) await link.uncheck();
    await dialog.getByLabel(/^Passwort/).fill(password);
    const wanted = dialog.getByLabel('Bei der nächsten Anmeldung ein eigenes Passwort verlangen');
    if (!(await wanted.isChecked())) throw new Error('Der Passwortwechsel ist für neue Konten nicht vorgewählt');
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await visible(page, 'Emily Start ist angelegt');
    await visible(page, 'Neues Passwort fällig');

    const fresh = await context('light');
    const start = await fresh.newPage();
    start.setDefaultTimeout(15_000);
    await start.goto(`${base}/login`);
    await start.fill('input[name=login]', 'emily-start');
    await start.fill('input[name=password]', password);
    await Promise.all([start.waitForURL('**/passwort'), start.click('button[type=submit]')]);
    await start.getByRole('heading', { name: 'Neues Passwort festlegen' }).waitFor();
    await shot(start, 'password-change');
    await start.goto(`${base}/files`);
    await start.waitForURL('**/passwort');
    await start.fill('input[name=current]', password);
    await start.fill('input[name=password]', password);
    await start.getByRole('button', { name: 'Passwort speichern' }).click();
    await start.getByText('Das neue Passwort muss sich vom alten unterscheiden').waitFor();
    await start.fill('input[name=current]', password);
    await start.fill('input[name=password]', 'ein-ganz-eigenes-passwort');
    await Promise.all([start.waitForURL('**/files**'), start.getByRole('button', { name: 'Passwort speichern' }).click()]);
    await fresh.close();

    await page.reload();
    await visible(page, 'Emily Start');
    await page.getByText('Neues Passwort fällig', { exact: true }).waitFor({ state: 'detached' });
    const people = await api<{ items: { id: number; username: string }[] }>(page, 'GET', '/api/admin/users');
    const emily = people.items.find((entry) => entry.username === 'emily-start');
    if (emily) await api(page, 'DELETE', `/api/admin/users/${emily.id}`);
  });

  await step('Formular anlegen, ausfüllen und auswerten', async () => {
    await page.goto(`${base}/files/forms`);
    await page.getByRole('button', { name: 'Neues Formular' }).first().click();
    const ask = page.getByRole('dialog');
    await ask.getByLabel('Titel').fill('Sommerfest bei Lea');
    await ask.getByRole('button', { name: 'Anlegen' }).click();
    await page.waitForURL(/\/files\/forms\/[A-Za-z0-9_-]+$/);
    await page.getByLabel('Beschreibung').fill('Sag uns bis Freitag, ob du kommst und was du essen möchtest.');
    await page.getByRole('button', { name: 'Frage hinzufügen' }).click();
    await page.getByRole('menuitem', { name: /^Eine Auswahl/ }).click();
    const choice = page.locator('[data-question-card]').nth(1);
    await choice.getByLabel('Frage 2').fill('Was möchtest du essen?');
    await choice.getByLabel('Antwort 1').fill('Pizza');
    await choice.getByLabel('Antwort 2').fill('Salat');
    await choice.getByLabel('Antwort 2').press('Enter');
    await choice.getByLabel('Antwort 3').fill('Suppe');
    await choice.getByLabel('Pflichtfrage').check();
    await page.getByRole('button', { name: 'Frage hinzufügen' }).click();
    await page.getByRole('menuitem', { name: /^Skala/ }).click();
    const scale = page.locator('[data-question-card]').nth(2);
    await scale.getByLabel('Frage 3').fill('Wie sehr freust du dich?');
    await scale.getByLabel('Text am Anfang').fill('Kaum');
    await scale.getByLabel('Text am Ende').fill('Riesig');
    await page.getByText('Gespeichert', { exact: true }).first().waitFor();
    await page.waitForFunction(async () => {
      const data = (await (await fetch('/api/forms')).json()) as { items: { questions: { title: string }[] }[] };
      return data.items.some((form) => form.questions.some((question) => question.title === 'Wie sehr freust du dich?'));
    });
    await page.getByRole('heading', { name: 'Sommerfest bei Lea' }).first().scrollIntoViewIfNeeded();
    await shot(page, 'forms-editor');

    const { items } = await api<{ items: { id: string; url: string; title: string }[] }>(page, 'GET', '/api/forms');
    const form = items.find((entry) => entry.title === 'Sommerfest bei Lea');
    if (!form) throw new Error('Das Formular fehlt in der Liste');
    const guest = await context('light');
    const visitor = await guest.newPage();
    await visitor.goto(`${base}${form.url}`);
    await visitor.getByRole('heading', { name: 'Sommerfest bei Lea' }).waitFor();
    await visitor.getByLabel('Wie heißt du?').fill('Mia');
    await visitor.getByLabel('Pizza').check();
    await visitor.locator('.scale__step', { hasText: '4' }).click();
    await shot(visitor, 'form-public');
    await Promise.all([visitor.waitForURL(/gesendet/), visitor.getByRole('button', { name: 'Absenden' }).click()]);
    await visitor.getByRole('heading', { name: 'Danke für deine Antwort' }).waitFor();
    await visitor.getByRole('link', { name: 'Noch eine Antwort senden' }).click();
    await visitor.getByLabel('Wie heißt du?').fill('Lea');
    await visitor.getByLabel('Salat').check();
    await visitor.locator('.scale__step', { hasText: '5' }).click();
    await Promise.all([visitor.waitForURL(/gesendet/), visitor.getByRole('button', { name: 'Absenden' }).click()]);
    await guest.close();

    await page.getByRole('tab', { name: /Antworten/ }).click();
    await page.locator('[data-total="2"]').waitFor();
    await page.locator('[data-bar="Pizza"]').waitFor();
    await page.getByText('Durchschnitt 4,5').waitFor();
    await shot(page, 'forms-results');
    await page.getByRole('tab', { name: 'Einstellungen' }).click();
    await page.getByLabel('Nur eine Antwort pro Person').check();
    await visible(page, 'Gespeichert');
    await page.goto(`${base}/files/forms`);
    await page.locator('[data-form]').first().waitFor();
  });

  await step('Sprachnotiz, Foto und Video aufnehmen', async () => {
    const ready = () =>
      page.waitForFunction(() => {
        const video = document.querySelector<HTMLVideoElement>('video[data-record-preview]');
        return Boolean(video && video.videoWidth > 0);
      });
    await page.goto(`${base}/files`);
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sprachnotiz aufnehmen' }).click();
    const voice = page.getByRole('dialog', { name: 'Sprachnotiz aufnehmen' });
    await voice.getByRole('button', { name: 'Aufnahme starten' }).click();
    await voice.getByRole('button', { name: 'Pause' }).waitFor();
    await page.waitForTimeout(1500);
    await shot(page, 'recorder');
    await voice.getByRole('button', { name: 'Aufnahme beenden' }).click();
    await voice.locator('audio[data-record-result]').waitFor();
    await voice.getByLabel('Name').fill('Sprachnotiz für Mia');
    await voice.getByRole('button', { name: 'Speichern' }).click();
    await page
      .getByRole('grid')
      .getByText(/^Sprachnotiz für Mia\.(m4a|weba|ogg)$/)
      .first()
      .waitFor();

    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Foto oder Video aufnehmen' }).click();
    const camera = page.getByRole('dialog', { name: 'Foto oder Video aufnehmen' });
    await ready();
    await camera.getByRole('button', { name: 'Foto aufnehmen' }).click();
    await camera.locator('img[data-record-result]').waitFor();
    await camera.getByLabel('Name').fill('Foto von Lea');
    await camera.getByRole('button', { name: 'Speichern' }).click();
    await item(page, 'Foto von Lea.jpg').waitFor();

    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Foto oder Video aufnehmen' }).click();
    await ready();
    await camera.getByRole('button', { name: 'Video', exact: true }).click();
    await camera.getByRole('button', { name: 'Aufnahme starten' }).click();
    await camera.getByRole('button', { name: 'Pause' }).waitFor();
    await page.waitForTimeout(1500);
    await camera.getByRole('button', { name: 'Aufnahme beenden' }).click();
    await camera.locator('video[data-record-result]').waitFor();
    await camera.getByLabel('Name').fill('Video von Emi');
    await camera.getByRole('button', { name: 'Speichern' }).click();
    await page
      .getByRole('grid')
      .getByText(/^Video von Emi\.(mp4|webm)$/)
      .first()
      .waitFor();
  });

  await step('Ordner auf einen früheren Stand zurücksetzen', async () => {
    await page.goto(`${base}/files`);
    const session = await api<{ user: { rootId: string } }>(page, 'GET', '/api/session');
    const folder = (await api<{ node: { id: string } }>(page, 'POST', `/api/nodes/${session.user.rootId}/folders`, { name: 'Steuer 2026' }))
      .node.id;
    const file = (
      await api<{ node: { id: string } }>(page, 'POST', `/api/nodes/${folder}/text`, { name: 'Belege.txt', content: 'Quittungen von Emi' })
    ).node.id;
    await page.waitForTimeout(1200);
    const at = await page.evaluate(() => Date.now());
    await page.waitForTimeout(1200);
    await api(page, 'PATCH', `/api/nodes/${file}`, { name: 'Belege.txt.verschluesselt' });
    await api(page, 'POST', `/api/nodes/${folder}/text`, { name: 'LIES MICH.txt', content: 'Zahl uns' });
    await page.goto(`${base}/files/folder/${folder}?zuruecksetzen=${at}`);
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-rewind-total="2"]').waitFor();
    await shot(page, 'rewind');
    await dialog.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await item(page, 'Belege.txt').waitFor();
    await page.waitForFunction(async (id) => {
      const data = (await (await fetch(`/api/nodes/${id}/children`)).json()) as { items: { name: string }[] };
      return data.items.map((entry) => entry.name).join('|') === 'Belege.txt';
    }, folder);
  });

  await step('Gerät mit auffällig vielen Änderungen anhalten und freigeben', async () => {
    await page.goto(`${base}/files`);
    await api(page, 'PATCH', '/api/admin/settings', { 'security.burstLimit': 20 });
    const made = await api<{ token: string }>(page, 'POST', '/api/account/app-passwords', { name: 'Laptop im Büro' });
    const auth = `Basic ${Buffer.from(`emi:${made.token}`).toString('base64')}`;
    const put = (body: string) =>
      fetch(`${base}/dav/Wachhund.txt`, { method: 'PUT', headers: { authorization: auth, 'content-type': 'text/plain' }, body });
    if ((await put('Anfang')).status !== 201) throw new Error('WebDAV legt die Datei nicht an');
    for (let index = 0; index < 20; index++) await put(`Verschlüsselt ${index}`);
    const blocked = await put('Noch mehr');
    if (blocked.status !== 403) throw new Error(`Das Gerät wurde nicht angehalten (${blocked.status})`);
    await page.goto(`${base}/account#app-passwoerter`);
    const entry = page.locator('[data-app-password="Laptop im Büro"][data-paused]');
    await entry.waitFor();
    await entry.scrollIntoViewIfNeeded();
    await shot(page, 'device-paused');
    await entry.getByRole('button', { name: 'Freigeben' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Freigeben' }).click();
    await page.locator('[data-app-password="Laptop im Büro"]:not([data-paused])').waitFor();
    if ((await put('Wieder erlaubt')).status !== 204) throw new Error('Das Gerät schreibt nach dem Freigeben nicht');
    await api(page, 'PATCH', '/api/admin/settings', { 'security.burstLimit': 300 });
  });

  await step('Ankündigung für alle', async () => {
    await api(page, 'PATCH', '/api/admin/settings', {
      'notice.text': 'Am Samstag ab 20 Uhr gibt es ein kurzes Update.',
      'notice.level': 'info',
    });
    await page.goto(`${base}/files`);
    await visible(page, 'Am Samstag ab 20 Uhr gibt es ein kurzes Update.');
    await page.getByRole('button', { name: 'Hinweis ausblenden' }).click();
    await page.getByText('Am Samstag ab 20 Uhr gibt es ein kurzes Update.', { exact: true }).waitFor({ state: 'detached' });
    await api(page, 'PATCH', '/api/admin/settings', { 'notice.text': '' });
  });

  await step('Englische Oberfläche', async () => {
    try {
      await page.goto(`${base}/lang/en?next=/files`);
      await page.getByRole('heading', { name: 'My files' }).waitFor({ state: 'attached' });
      await visible(page, 'Recent');
      await item(page, 'Fotos').waitFor();
      await visible(page, 'Modified');
    } finally {
      await page.goto(`${base}/lang/de?next=/files`);
    }
    await page.getByRole('heading', { name: 'Meine Dateien' }).waitFor({ state: 'attached' });
  });

  await step('Öffentlicher Link', async () => {
    const shared = await api<{ links: { label: string | null; url: string }[] }>(page, 'GET', '/api/shared');
    const link = shared.links.find((entry) => entry.label === 'Fotos für die Familie');
    if (!link) throw new Error('Der Link aus den Beispieldaten fehlt');
    const guest = await open(anonymous, 'gast');
    await guest.goto(link.url);
    await visible(guest, 'Fotos für die Familie');
    await images(guest, 'main');
    await shot(guest, 'public');
    await guest.close();
  });

  await step('Link nur zum Hochladen', async () => {
    const session = await api<{ user: { rootId: string } }>(page, 'GET', '/api/session');
    const listing = await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/nodes/${session.user.rootId}/children`);
    const projects = listing.items.find((item) => item.name === 'Projekte');
    if (!projects) throw new Error('Der Ordner Projekte fehlt');
    const created = await api<{ link: { url: string } }>(page, 'POST', `/api/nodes/${projects.id}/links`, {
      label: 'Fotos von Mia',
      uploadOnly: true,
      allowUpload: true,
    });
    const guest = await open(anonymous, 'gast-upload');
    await guest.goto(created.link.url);
    const chooser = guest.waitForEvent('filechooser');
    await guest.getByText('oder klicken, um sie auszuwählen', { exact: true }).click();
    await (await chooser).setFiles({ name: 'Grüße von Mia.txt', mimeType: 'text/plain', buffer: Buffer.from('Liebe Grüße\n') });
    await visible(guest, '„Grüße von Mia.txt“ ist angekommen.');
    const inside = await api<{ items: { name: string }[] }>(page, 'GET', `/api/nodes/${projects.id}/children`);
    if (!inside.items.some((item) => item.name === 'Grüße von Mia.txt')) throw new Error('Die Datei ist nicht im Ordner angekommen');
    await guest.close();
  });

  await step('Passkey anlegen und damit anmelden', async () => {
    const cdp = await dark.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(`${base}/account`);
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).waitFor();
    const before = await page.getByRole('button', { name: 'Passkey entfernen' }).count();
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await page.getByRole('button', { name: 'Passkey entfernen' }).nth(before).waitFor();
    await dark.clearCookies();
    await page.goto(`${base}/login`);
    await Promise.all([page.waitForURL('**/files**'), page.getByRole('button', { name: 'Mit Passkey anmelden' }).click()]);
    await item(page, 'Urlaub 2026').waitFor();
  });

  await step('Zwei-Faktor-Pflicht mit Passkey', async () => {
    await api(page, 'PATCH', '/api/admin/settings', { 'auth.require2fa': 'all' });
    try {
      const other = await context('dark');
      const mia = await open(other, 'mia');
      await mia.goto(`${base}/login`);
      await mia.fill('input[name=login]', 'mia');
      await mia.fill('input[name=password]', password);
      await Promise.all([mia.waitForURL('**/account'), mia.click('button[type=submit]')]);
      await visible(mia, 'Richte die Zwei-Faktor-Anmeldung ein');
      await other.close();
      await dark.clearCookies();
      await page.goto(`${base}/login`);
      await page.fill('input[name=login]', 'emi');
      await page.fill('input[name=password]', password);
      await Promise.all([page.waitForURL('**/login/2fa**'), page.click('button[type=submit]')]);
      await Promise.all([page.waitForURL('**/files**'), page.getByRole('button', { name: 'Mit Passkey bestätigen' }).click()]);
      await item(page, 'Urlaub 2026').waitFor();
    } finally {
      await api(page, 'PATCH', '/api/admin/settings', { 'auth.require2fa': 'off' });
    }
  });

  const phone = await context('light', true);
  const mobile = await open(phone, 'handy');

  await step('Anmeldung auf dem Handy', async () => {
    await mobile.goto(`${base}/login`);
    await shot(mobile, 'login');
    await login(mobile, 'emi');
    await item(mobile, 'Urlaub 2026').waitFor();
    await shot(mobile, 'mobile');
  });

  await step('Bildansicht auf dem Handy', async () => {
    if (!photosUrl) throw new Error('Der Ordner Fotos fehlt');
    await mobile.goto(photosUrl);
    await item(mobile, 'Strand.jpg').click();
    await images(mobile, '[role=dialog]');
    await mobile.getByRole('button', { name: 'Schließen' }).click();
  });

  const light = await context('light');

  await step('Konto im hellen Design', async () => {
    const account = await open(light, 'konto');
    await login(account, 'emi');
    await account.goto(`${base}/account`);
    await visible(account, 'Sicherheit');
    await shot(account, 'account');
    const download = account.waitForEvent('download');
    await account.getByRole('link', { name: 'Daten exportieren' }).click();
    const file = await (await download).path();
    const head = (await readFile(file)).subarray(0, 2).toString();
    if (head !== 'PK') throw new Error('Der Export ist kein ZIP');
  });
} finally {
  await browser.close();
  await smtp.close();
  server.kill('SIGTERM');
  await new Promise((done) => server.once('exit', done));
  await rm(dataDir, { recursive: true, force: true });
}

for (const problem of problems) process.stdout.write(`Konsole: ${problem}\n`);
if (problems.length) for (const status of statuses) process.stdout.write(`Antwort: ${status}\n`);
process.stdout.write(`${failures.length} Schritte fehlgeschlagen, ${problems.length} Meldungen in der Konsole, Bilder in ${shots}\n`);
if (failures.length) process.stdout.write(`Bilder zu den Fehlern liegen in ${failureShots}\n`);
if (failures.length || problems.length) process.exitCode = 1;
