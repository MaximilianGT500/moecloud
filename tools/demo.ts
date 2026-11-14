import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import defaultPalette from '../src/lib/default-palette.json' with { type: 'json' };

const [base = 'http://localhost:3000', code = ''] = process.argv.slice(2);

class Session {
  cookies = new Map<string, string>();
  csrf = '';

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    headers.set('origin', base);
    if (init.method && init.method !== 'GET') headers.set('x-csrf-token', this.csrf || this.cookies.get('moe_csrf') || '');
    const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async login(login: string, password: string) {
    await this.fetch('/login');
    const csrf = this.cookies.get('moe_csrf') ?? '';
    await this.fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, login, password, next: '/files' }).toString(),
    });
    this.csrf = (await this.json<{ csrf: string }>('GET', '/api/session')).csrf;
  }

  async upload(parentId: string, name: string, data: Buffer, modifiedAt?: number, conflict?: 'replace') {
    const init = await this.json<{ id: string }>('POST', '/api/uploads', { parentId, name, size: data.length, modifiedAt, conflict });
    if (data.length) {
      await this.fetch(`/api/uploads/${init.id}?offset=0`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(data),
      });
    }
    return (await this.json<{ node: { id: string } }>('POST', `/api/uploads/${init.id}/complete`)).node.id;
  }

  folder(parentId: string, name: string) {
    return this.json<{ node: { id: string } }>('POST', `/api/nodes/${parentId}/folders`, { name }).then((result) => result.node.id);
  }
}

function landscape(sky: [string, string], ground: string, sun: string, extra = '') {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#s)"/>
    <circle cx="1120" cy="430" r="150" fill="${sun}" opacity="0.92"/>
    ${extra}
    <path d="M0 760 L260 520 L470 700 L700 420 L980 720 L1200 560 L1600 800 L1600 1067 L0 1067 Z" fill="${ground}" opacity="0.85"/>
    <path d="M0 880 C300 820 600 940 900 880 C1150 830 1400 900 1600 860 L1600 1067 L0 1067 Z" fill="${ground}"/>
  </svg>`);
}

interface Shot {
  taken: Date;
  camera: [string, string];
  lens?: string;
  aperture: string;
  exposure: string;
  iso: number;
  focal: string;
}

const exifDate = (date: Date) =>
  `${date.getFullYear()}:${String(date.getMonth() + 1).padStart(2, '0')}:${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;

async function jpeg(svg: Buffer, shot?: Shot) {
  const image = sharp(svg).jpeg({ quality: 82 });
  if (!shot) return image.toBuffer();
  return image
    .withExif({
      IFD0: { Make: shot.camera[0], Model: shot.camera[1] },
      IFD2: {
        DateTimeOriginal: exifDate(shot.taken),
        FNumber: shot.aperture,
        ExposureTime: shot.exposure,
        ISOSpeedRatings: String(shot.iso),
        FocalLength: shot.focal,
        ...(shot.lens ? { LensModel: shot.lens } : {}),
      },
    })
    .toBuffer();
}

async function archive(entries: Record<string, string>) {
  const file = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) file.addBuffer(Buffer.from(content), name, { mtime: new Date(now - 20 * day) });
  file.end();
  const chunks: Buffer[] = [];
  for await (const chunk of file.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const monthsAgo = (months: number, dayOfMonth: number, hour: number) => {
  const date = new Date(now);
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  date.setDate(dayOfMonth);
  date.setHours(hour, 12, 0, 0);
  return date.getTime() > now ? new Date(now - day) : date;
};

function pdf(title: string, lines: string[]) {
  const text = [
    `BT /F1 26 Tf 72 760 Td (${title}) Tj ET`,
    ...lines.map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${line}) Tj ET`),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

function media(args: string[], extension: string) {
  const dir = mkdtempSync(join(tmpdir(), 'moecloud-demo-'));
  const file = join(dir, `out.${extension}`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, file]);
    return readFileSync(file);
  } catch {
    return null;
  }
}

const day = 86_400_000;
const now = Date.now();

const emi = new Session();
if (code) {
  await emi.fetch('/setup');
  await emi.json('POST', '/api/setup', {
    code,
    siteName: 'MoeCloud',
    siteUrl: base,
    language: 'de',
    seed: '#8b5cf6',
    palette: defaultPalette,
    registration: 'invite',
    defaultQuota: 50 * 1024 ** 3,
    admin: { username: 'emi', name: 'Emi Sato', email: 'emi@example.com', password: 'moecloud-demo' },
  });
}
await emi.login('emi', 'moecloud-demo');
const me = await emi.json<{ user: { rootId: string } }>('GET', '/api/session');
const root = me.user.rootId;

const users: Record<string, number> = {};
for (const [username, name] of [
  ['mia', 'Mia Weber'],
  ['lea', 'Lea Hoffmann'],
]) {
  const created = await emi.json<{ user: { id: number } }>('POST', '/api/admin/users', {
    username,
    name,
    email: `${username}@example.com`,
    password: 'moecloud-demo',
  });
  users[username] = created.user.id;
}

const photos = await emi.folder(root, 'Fotos');
const documents = await emi.folder(root, 'Dokumente');
const trip = await emi.folder(root, 'Urlaub 2026');
const music = await emi.folder(root, 'Musik');
const projects = await emi.folder(root, 'Projekte');

const scenes: [string, Buffer][] = [
  ['Sonnenuntergang am See.jpg', landscape(['#ff9a62', '#7b4ab8'], '#2c1b4a', '#ffd27a')],
  ['Bergwanderung.jpg', landscape(['#7ec8ff', '#d8f1ff'], '#2f6b4f', '#fff3b0')],
  [
    'Kirschblüten im Park.jpg',
    landscape(
      ['#ffd1e6', '#fff2f7'],
      '#b0577d',
      '#ffffff',
      '<circle cx="300" cy="300" r="90" fill="#ff9cc2"/><circle cx="420" cy="250" r="70" fill="#ffb7d3"/>'
    ),
  ],
  ['Hafen bei Nacht.jpg', landscape(['#0d1b3d', '#3a2a6b'], '#0b1026', '#f1e7c6')],
  ['Herbstwald.jpg', landscape(['#ffcf8a', '#ffefd2'], '#8a3b12', '#fff6d8')],
  ['Strand.jpg', landscape(['#5fd4f4', '#e8fbff'], '#d9b77a', '#fff9c4')],
];
const fuji: [string, string] = ['FUJIFILM', 'X-T5'];
const phone: [string, string] = ['Google', 'Pixel 9'];
const shots: Shot[] = [
  { taken: monthsAgo(0, 2, 19), camera: fuji, lens: 'XF23mmF1.4 R LM WR', aperture: '56/10', exposure: '1/250', iso: 200, focal: '23/1' },
  { taken: monthsAgo(0, 1, 11), camera: fuji, lens: 'XF10-24mmF4 R OIS WR', aperture: '8/1', exposure: '1/500', iso: 160, focal: '12/1' },
  { taken: monthsAgo(1, 18, 15), camera: phone, aperture: '17/10', exposure: '1/120', iso: 50, focal: '69/10' },
  { taken: monthsAgo(1, 4, 21), camera: fuji, lens: 'XF35mmF1.4 R', aperture: '14/10', exposure: '1/30', iso: 3200, focal: '35/1' },
  { taken: monthsAgo(2, 27, 16), camera: phone, aperture: '17/10', exposure: '1/250', iso: 64, focal: '69/10' },
  { taken: monthsAgo(4, 9, 12), camera: fuji, lens: 'XF23mmF1.4 R LM WR', aperture: '11/1', exposure: '1/1000', iso: 125, focal: '23/1' },
];
const yearsAgo = (years: number, hour: number) => {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() - years);
  date.setHours(hour, 5, 0, 0);
  return date;
};
const memories: [string, Buffer, Date][] = [
  ['Lichterfest.jpg', landscape(['#1b1f4b', '#5b2a86'], '#120d2a', '#ffcf6b'), yearsAgo(2, 18)],
  ['Schnee am Pass.jpg', landscape(['#c9e6ff', '#f4fbff'], '#e9f1f7', '#fffbe6'), yearsAgo(3, 10)],
];
const strand = await jpeg(scenes[5][1], shots[5]);
for (const [index, [name, svg]] of scenes.entries()) {
  await emi.upload(photos, name, index === 5 ? strand : await jpeg(svg, shots[index]), shots[index].taken.getTime());
}
for (const [name, svg, taken] of memories) {
  await emi.upload(
    photos,
    name,
    await jpeg(svg, { taken, camera: phone, aperture: '17/10', exposure: '1/60', iso: 400, focal: '69/10' }),
    taken.getTime()
  );
}

await emi.upload(
  documents,
  'Einkaufsliste.md',
  Buffer.from('# Einkaufsliste\n\n- Hafermilch\n- Äpfel\n- Brot vom Bäcker\n- Kaffee für Lea\n- Blumen für Mia\n'),
  now - 2 * 3600_000
);
await emi.upload(
  documents,
  'Notizen.txt',
  Buffer.from('Ideen für das Wochenende:\nFlohmarkt am Samstag, danach Kino.\nSonntag: Fahrrad reparieren.\n'),
  now - 5 * day
);
await emi.upload(
  documents,
  'Mietvertrag.pdf',
  pdf('Mietvertrag', ['Wohnung: Musterstraße 12, 10115 Berlin', 'Mieterin: Emi Sato', 'Beginn: 1. Februar 2026']),
  now - 40 * day
);
await emi.upload(
  documents,
  'Haushaltsbuch 2026.csv',
  Buffer.from('Monat;Einnahmen;Ausgaben\nJanuar;2800;2140\nFebruar;2800;1985\nMärz;2950;2210\n'),
  now - 9 * day
);
await emi.upload(
  trip,
  'Packliste.md',
  Buffer.from('# Packliste Japan\n\n- Reisepass\n- Adapter Typ A\n- Regenjacke\n- Kamera und Akkus\n'),
  now - 1 * day
);
await emi.upload(trip, 'Route.txt', Buffer.from('Tag 1: Tokio\nTag 4: Kyoto\nTag 7: Osaka\nTag 10: Rückflug\n'), now - 3 * day);
await emi.upload(
  trip,
  'Fuji am Morgen.jpg',
  await jpeg(landscape(['#ffb88c', '#de6262'], '#3b2e5a', '#ffe8d6'), {
    taken: monthsAgo(6, 14, 6),
    camera: fuji,
    lens: 'XF70-300mmF4-5.6 R LM OIS WR',
    aperture: '8/1',
    exposure: '1/640',
    iso: 200,
    focal: '200/1',
  }),
  now - 6 * day
);
await emi.upload(trip, 'Strand Kopie.jpg', strand, now - 4 * day);
await emi.upload(
  root,
  'Willkommen.md',
  Buffer.from('# Willkommen in MoeCloud\n\nZieh Dateien in dieses Fenster, um sie hochzuladen.\n'),
  now - 30 * day
);

const song = media(['-f', 'lavfi', '-i', 'sine=frequency=523:duration=4', '-q:a', '6'], 'mp3');
if (song) await emi.upload(music, 'Melodie.mp3', song, now - 12 * day);
const clip = media(
  ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast'],
  'mp4'
);
if (clip) await emi.upload(trip, 'Zeitraffer.mp4', clip, now - 2 * day);

const scripts = await emi.folder(projects, 'Skripte');
await emi.upload(
  scripts,
  'sicherung.sh',
  Buffer.from(
    '#!/usr/bin/env bash\nset -euo pipefail\n\nZIEL="/mnt/backup/$(date +%F)"\nmkdir -p "$ZIEL"\n\n# Datenordner sichern\nrsync -a --delete /srv/moecloud/data/ "$ZIEL/"\necho "Fertig: $ZIEL"\n'
  ),
  now - 8 * day
);
await emi.upload(
  scripts,
  'einstellungen.json',
  Buffer.from(
    JSON.stringify({ name: 'Wohnzimmer', helligkeit: 70, zeitplan: { start: '07:00', ende: '22:30' }, geraete: ['Lampe', 'Lautsprecher'] })
  ),
  now - 8 * day
);
await emi.upload(
  projects,
  'Website.zip',
  await archive({
    'website/index.html': '<!doctype html>\n<title>Hallo</title>\n<h1>Hallo Welt</h1>\n',
    'website/style.css': 'body { font-family: sans-serif; }\n',
    'website/bilder/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n',
    'README.md': '# Website\n\nEinfach index.html öffnen.\n',
  }),
  now - 20 * day
);
await emi.upload(
  projects,
  'README.md',
  Buffer.from(
    '# Projekte\n\nHier liegt alles, woran Emi, Mia und Lea gerade gemeinsam arbeiten.\n\n- **Ideen.md** sammelt Pläne für das nächste Jahr\n- **Skripte** enthält kleine Helfer für zu Hause\n- **Website.zip** ist der Entwurf für die Familienseite\n\nNeue Ideen gern direkt in Ideen.md eintragen.\n'
  ),
  now - 6 * day
);
await emi.upload(
  projects,
  'Ideen.md',
  Buffer.from(
    '# Ideen für 2027\n\n## Wohnung\n\n- [ ] Regal im Flur\n- [ ] Neue Lampe fürs Bad\n\n## Reisen\n\n| Ziel | Wann | Mit |\n| --- | --- | --- |\n| Lissabon | Mai | Mia |\n\n> Weniger planen, mehr machen.\n\n```bash\nnpm run build\n```\n'
  ),
  now - 2 * day
);
await emi.upload(
  projects,
  'Ideen.md',
  Buffer.from(
    '# Ideen für 2027\n\n## Wohnung\n\n- [x] Regal im Flur\n- [ ] Pflanzen für den Balkon\n\n## Reisen\n\n| Ziel | Wann | Mit |\n| --- | --- | --- |\n| Lissabon | Mai | Mia |\n| Hokkaido | Februar | Lea |\n\n> Weniger planen, mehr machen.\n\n```bash\nnpm run build\n```\n'
  ),
  now - 3 * 3600_000,
  'replace'
);

await emi.json('PUT', '/api/nodes/color', { ids: [photos], color: 'pink' });
await emi.json('PUT', '/api/nodes/color', { ids: [trip], color: 'teal' });
await emi.json('PUT', '/api/nodes/color', { ids: [projects], color: 'orange' });
await emi.json('PUT', `/api/nodes/${photos}/star`, { starred: true });
await emi.json('POST', `/api/nodes/${photos}/links`, { label: 'Fotos für die Familie', expiresAt: now + 30 * day });
await emi.json('POST', `/api/nodes/${trip}/grants`, { userId: users.mia, permission: 'edit' });
await emi.json('POST', `/api/nodes/${photos}/grants`, { userId: users.lea, permission: 'view' });

const mia = new Session();
await mia.login('mia', 'moecloud-demo');
const miaRoot = (await mia.json<{ user: { rootId: string } }>('GET', '/api/session')).user.rootId;
const recipes = await mia.folder(miaRoot, 'Rezepte');
await mia.upload(recipes, 'Ramen.md', Buffer.from('# Ramen\n\n1. Brühe ansetzen\n2. Nudeln kochen\n3. Toppings vorbereiten\n'));
await mia.upload(recipes, 'Matcha-Kekse.md', Buffer.from('# Matcha-Kekse\n\n200 g Mehl, 2 TL Matcha, 120 g Butter\n'));
await mia.json('POST', `/api/nodes/${recipes}/grants`, {
  userId: (await emi.json<{ user: { id: number } }>('GET', '/api/session')).user.id,
  permission: 'view',
});

const tripFiles = await mia.json<{ items: { id: string; name: string }[] }>('GET', `/api/nodes/${trip}/children`);
const packing = tripFiles.items.find((item) => item.name === 'Packliste.md');
if (packing) await mia.json('POST', `/api/nodes/${packing.id}/comments`, { text: 'Denk an den Adapter, in Japan gibt es Typ A.' });
await mia.upload(
  trip,
  'Zugtickets.pdf',
  pdf('Zugtickets', ['Tokio nach Kyoto, Shinkansen Nozomi', 'Wagen 7, Plätze 12 A und 12 B']),
  now - 5 * 3600_000
);

const lea = new Session();
await lea.login('lea', 'moecloud-demo');
const photoFiles = await lea.json<{ items: { id: string; name: string }[] }>('GET', `/api/nodes/${photos}/children`);
const sunset = photoFiles.items.find((item) => item.name === 'Sonnenuntergang am See.jpg');
if (sunset)
  await lea.json('POST', `/api/nodes/${sunset.id}/comments`, {
    text: 'Das Licht ist wunderschön. Kannst du mir das Bild in groß schicken?',
  });

process.stdout.write(`Demo bereit: ${base} (emi / moecloud-demo)\n`);
