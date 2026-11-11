import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

async function step(name: string, run: () => Promise<void>) {
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
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${label}: ${message.type()} ${message.text()}`);
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
    await images(page, 'main [role=list]');
    await shot(page, 'photos');
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
    await page.getByLabel('Kommentar schreiben').fill('Danke, ist eingepackt.');
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    await visible(page, 'Danke, ist eingepackt.');
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

  await step('Verwaltung', async () => {
    await page.goto(`${base}/admin`);
    await visible(page, 'Zustand');
    await visible(page, 'Speicher nach Art');
    await shot(page, 'admin');
    for (const [path, text] of [
      ['/admin/people', 'Mia Weber'],
      ['/admin/invites', 'Noch keine Einladungen.'],
      ['/admin/links', 'Fotos für die Familie'],
      ['/admin/audit', 'Anmeldung'],
      ['/admin/mail', 'SMTP-Server'],
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

  const anonymous = await context('dark');

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
