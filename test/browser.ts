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

const browser = await chromium
  .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
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
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrf },
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
    await editor.getByRole('button', { name: 'Serifen' }).click();
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
    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
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
    await rail.getByRole('link', { name: 'Statistik' }).waitFor();
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

    await rail.getByRole('link', { name: 'Statistik' }).click();
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
    await rail.getByRole('link', { name: 'Statistik' }).waitFor({ state: 'detached' });
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
    await page.waitForURL(/\/files\/folder\/\w+\?select=\w+/);
    await item(page, 'Strand.jpg').waitFor();

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
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await visible(page, 'Passkey hinzugefügt');
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
