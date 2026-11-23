import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { all } from '../src/lib/db.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let root = '';

interface Item {
  name: string;
  data?: string | Buffer;
  type?: string;
  link?: string;
  pax?: Record<string, string>;
  gnu?: boolean;
}

function header(name: string, size: number, type: string, link = '', magic = 'ustar\u000000') {
  const block = Buffer.alloc(512);
  Buffer.from(name).copy(block, 0, 0, 100);
  block.write('0000644\u0000', 100);
  block.write('0001750\u0000', 108);
  block.write('0001750\u0000', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\u0000`, 124);
  block.write(`${(1_700_000_000).toString(8).padStart(11, '0')}\u0000`, 136);
  block.write('        ', 148);
  block.write(type, 156);
  Buffer.from(link).copy(block, 157, 0, 100);
  block.write(magic, 257, 'latin1');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148);
  return block;
}

const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);

function record(key: string, value: string) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return `${length}${body}`;
}

function tarball(items: Item[], end = true) {
  const parts: Buffer[] = [];
  for (const item of items) {
    const data = Buffer.from(item.data ?? '');
    const type = item.type ?? (item.name.endsWith('/') ? '5' : '0');
    if (item.pax) {
      const content = Buffer.from(
        Object.entries(item.pax)
          .map(([key, value]) => record(key, value))
          .join('')
      );
      parts.push(header('PaxHeader', content.length, 'x'), pad(content));
    }
    if (item.gnu) {
      const content = Buffer.from(`${item.name}\u0000`);
      parts.push(header('././@LongLink', content.length, 'L', '', 'ustar  \u0000'), pad(content));
    }
    parts.push(
      header(item.name, type === '0' || type === '7' ? data.length : 0, type, item.link ?? ''),
      pad(type === '0' ? data : Buffer.alloc(0))
    );
  }
  if (end) parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function tree(folderId: string, prefix = ''): Record<string, { type: string; size: number; sha256: string | null }> {
  const out: Record<string, { type: string; size: number; sha256: string | null }> = {};
  for (const node of all<{ id: string; name: string; type: string; size: number; sha256: string | null }>(
    'SELECT id, name, type, size, sha256 FROM nodes WHERE parent_id = ? AND trashed_at IS NULL',
    folderId
  )) {
    const path = `${prefix}${node.name}`;
    if (node.type === 'folder') {
      out[`${path}/`] = { type: 'folder', size: 0, sha256: null };
      Object.assign(out, tree(node.id, `${path}/`));
    } else out[path] = { type: 'file', size: Number(node.size), sha256: node.sha256 };
  }
  return out;
}

async function upload(name: string, data: Buffer) {
  const response = await emi.upload(root, name, data, 64 * 1024);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().node.id as string;
}

const longPath = `Mia/${'Sehr langer Ordnername mit vielen Wörtern/'.repeat(3)}Bericht über das Jahr.txt`;

const sample = () =>
  tarball([
    { name: './' },
    { name: './Rezepte/' },
    { name: './Rezepte/Kuchen.txt', data: 'Zucker, Mehl, Eier' },
    { name: './Rezepte/Suppen/Tomate.txt', data: 'Tomaten' },
    { name: '/etc/hosts', data: '127.0.0.1 localhost' },
    { name: '../ausbruch.txt', data: 'nein' },
    { name: 'Rezepte/../../ausbruch.txt', data: 'nein' },
    { name: 'Verknüpfung', type: '2', link: '/etc/passwd' },
    { name: 'Rezepte/Kuchen-Kopie.txt', type: '1', link: './Rezepte/Kuchen.txt' },
    { name: 'Rezepte/Ins-Leere.txt', type: '1', link: 'gibt-es-nicht.txt' },
    { name: 'Gerät', type: '3' },
    { name: '.DS_Store', data: 'Müll' },
    { name: 'Werkzeug.exe', data: 'MZ' },
    { name: 'Rechnung.pdf.locky', data: 'verschlüsselt' },
    { name: 'kurz', data: 'Lea – Grüße', pax: { path: 'Lea – Fotos/Grüße.txt', mtime: '1600000000.5' } },
    { name: longPath, data: 'Langer Name', gnu: true },
    { name: 'leer.txt', data: '' },
  ]);

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  settings.set('storage.blockedTypes', 'exe');
});

after(async () => {
  settings.set('storage.blockedTypes', '');
  await app.close();
});

describe('TAR-Archive', () => {
  it('zeigt den Inhalt und lädt einzelne Dateien', async () => {
    const id = await upload('Sammlung.tar', sample());
    const listing = await emi.get(`/api/nodes/${id}/archive`);
    assert.equal(listing.statusCode, 200, listing.body);
    const paths = (listing.json().entries as { path: string; folder: boolean; size: number }[]).map((entry) => entry.path);
    assert.ok(paths.includes('Rezepte/'));
    assert.ok(paths.includes('Rezepte/Kuchen.txt'));
    assert.ok(paths.includes('etc/hosts'));
    assert.ok(paths.includes('Lea – Fotos/Grüße.txt'));
    assert.ok(paths.includes(longPath));
    assert.ok(!paths.some((path) => path.includes('..') || path === 'Verknüpfung' || path === 'Gerät' || path.startsWith('/')));
    const entry = await emi.get(`/api/nodes/${id}/archive/entry?path=${encodeURIComponent('Lea – Fotos/Grüße.txt')}`);
    assert.equal(entry.statusCode, 200);
    assert.equal(entry.body, 'Lea – Grüße');
    assert.equal(entry.headers['content-length'], String(Buffer.byteLength('Lea – Grüße')));
    assert.match(String(entry.headers['content-disposition']), /attachment/);
    assert.equal((await emi.get(`/api/nodes/${id}/archive/entry?path=${encodeURIComponent('../ausbruch.txt')}`)).statusCode, 404);
    assert.equal((await emi.get(`/api/nodes/${id}/archive/entry?path=Verkn%C3%BCpfung`)).statusCode, 404);
  });

  it('entpackt sicher in einen neuen Ordner', async () => {
    const id = await upload('Kochbuch.tar', sample());
    const result = await emi.json('POST', `/api/nodes/${id}/extract`, {});
    assert.equal(result.statusCode, 200, result.body);
    const body = result.json();
    assert.equal(body.folder.name, 'Kochbuch');
    assert.equal(body.files, 7);
    assert.deepEqual(body.skipped, { infected: 0, encrypted: 0, unsafe: 5, tooLarge: 0, blocked: 2 });
    const files = tree(body.folderId);
    assert.deepEqual(
      Object.keys(files).sort(),
      [
        'Lea – Fotos/',
        'Lea – Fotos/Grüße.txt',
        'Mia/',
        'Mia/Sehr langer Ordnername mit vielen Wörtern/',
        'Mia/Sehr langer Ordnername mit vielen Wörtern/Sehr langer Ordnername mit vielen Wörtern/',
        'Mia/Sehr langer Ordnername mit vielen Wörtern/Sehr langer Ordnername mit vielen Wörtern/Sehr langer Ordnername mit vielen Wörtern/',
        `${longPath}`,
        'Rezepte/',
        'Rezepte/Kuchen-Kopie.txt',
        'Rezepte/Kuchen.txt',
        'Rezepte/Suppen/',
        'Rezepte/Suppen/Tomate.txt',
        'etc/',
        'etc/hosts',
        'leer.txt',
      ].sort()
    );
    assert.equal(files['Rezepte/Kuchen.txt'].sha256, sha('Zucker, Mehl, Eier'));
    assert.equal(files['Rezepte/Kuchen-Kopie.txt'].sha256, sha('Zucker, Mehl, Eier'));
    assert.equal(files['Lea – Fotos/Grüße.txt'].sha256, sha('Lea – Grüße'));
    assert.equal(files['leer.txt'].size, 0);
    const modified = all<{ modified_at: number }>("SELECT modified_at FROM nodes WHERE name = 'Grüße.txt'")[0].modified_at;
    assert.equal(Number(modified), 1_600_000_000_500);
    assert.equal(all("SELECT id FROM nodes WHERE name IN ('ausbruch.txt', 'passwd', 'Werkzeug.exe', 'Rechnung.pdf.locky')").length, 0);
    const activity = (await emi.get(`/api/nodes/${root}/activity`)).json().items as { action: string; name: string }[];
    assert.ok(activity.some((item) => item.action === 'extract' && item.name === 'Kochbuch.tar'));
  });

  it('entpackt TAR.GZ und TGZ', async () => {
    for (const name of ['Paket.tar.gz', 'Paket.tgz']) {
      const id = await upload(name, gzipSync(sample()));
      assert.equal((await emi.get(`/api/nodes/${id}/archive`)).json().entries.length > 5, true);
      const result = await emi.json('POST', `/api/nodes/${id}/extract`, {});
      assert.equal(result.statusCode, 200, result.body);
      assert.match(result.json().folder.name, /^Paket( \(\d\))?$/);
      assert.equal(result.json().files, 7);
      const entry = await emi.get(`/api/nodes/${id}/archive/entry?path=Rezepte%2FSuppen%2FTomate.txt`);
      assert.equal(entry.body, 'Tomaten');
    }
  });

  it('entpackt eine einzelne GZ-Datei neben das Archiv', async () => {
    const text = 'Datum;Name\n2026-11-22;Emi\n'.repeat(200);
    const id = await upload('Bericht.csv.gz', gzipSync(text));
    const listing = (await emi.get(`/api/nodes/${id}/archive`)).json();
    assert.deepEqual(
      listing.entries.map((entry: { path: string; size: number }) => [entry.path, entry.size]),
      [['Bericht.csv', Buffer.byteLength(text)]]
    );
    const entry = await emi.get(`/api/nodes/${id}/archive/entry?path=Bericht.csv`);
    assert.equal(entry.statusCode, 200);
    assert.equal(entry.body, text);
    const first = await emi.json('POST', `/api/nodes/${id}/extract`, {});
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().files, 1);
    assert.equal(first.json().folderId, root);
    const second = await emi.json('POST', `/api/nodes/${id}/extract`, {});
    assert.equal(second.statusCode, 200);
    const made = all<{ name: string; sha256: string }>(
      "SELECT name, sha256 FROM nodes WHERE parent_id = ? AND name LIKE 'Bericht%.csv'",
      root
    );
    assert.equal(made.length, 2);
    assert.ok(made.every((node) => node.sha256 === sha(text)));
    assert.ok(made.some((node) => node.name === 'Bericht.csv'));
  });

  it('achtet auf Grenzen und kaputte Archive', async () => {
    const big = await upload('Gross.gz', gzipSync(Buffer.alloc(400_000, 7)));
    const mixed = await upload(
      'Gemischt.tar',
      tarball([
        { name: 'klein.txt', data: 'klein' },
        { name: 'gross.bin', data: Buffer.alloc(5000, 1) },
      ])
    );
    settings.set('storage.maxUpload', 1000);
    try {
      const tooBig = await emi.json('POST', `/api/nodes/${big}/extract`, {});
      assert.equal(tooBig.statusCode, 413);
      assert.equal(tooBig.json().error.message, 'Entpackt ist die Datei größer als erlaubt');
      const result = await emi.json('POST', `/api/nodes/${mixed}/extract`, {});
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().files, 1);
      assert.equal(result.json().skipped.tooLarge, 1);
    } finally {
      settings.set('storage.maxUpload', 0);
    }
    const cut = sample().subarray(0, 1700);
    for (const [name, data] of [
      ['Abgeschnitten.tar', cut],
      ['Abgeschnitten.tar.gz', gzipSync(cut)],
      ['Unsinn.tar', Buffer.from('Das ist kein Archiv, nur Text von Lea.'.repeat(40))],
      ['Kaputt.gz', Buffer.concat([gzipSync('Hallo Mia').subarray(0, 12), Buffer.from('xxxxxxxxxxxxxxxx')])],
    ] as const) {
      const id = await upload(name, data);
      const response = await emi.json('POST', `/api/nodes/${id}/extract`, {});
      assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
      assert.equal(response.json().error.message, 'Das Archiv lässt sich nicht lesen');
    }
    const empty = await upload('Leer.tar', tarball([{ name: 'nur/' }, { name: 'link', type: '2', link: 'nur' }]).subarray(0, 512 * 3));
    const nothing = await emi.json('POST', `/api/nodes/${empty}/extract`, {});
    assert.equal(nothing.statusCode, 200, nothing.body);
    assert.equal(nothing.json().files, 0);
    const junk = await upload(
      'Muell.tar',
      tarball([
        { name: '.DS_Store', data: 'x' },
        { name: 'boese', type: '2', link: '/' },
      ])
    );
    assert.equal((await emi.json('POST', `/api/nodes/${junk}/extract`, {})).statusCode, 400);
  });

  it('versteht Archive vom echten tar', { skip: !existsSync('/usr/bin/tar') && !existsSync('/bin/tar') }, async () => {
    const work = await mkdtemp(join(tmpdir(), 'moecloud-tar-'));
    try {
      const source = join(work, 'Fotos von Emi');
      const deep = join(
        source,
        'Urlaub 2026',
        'Sehr lange Ordnernamen kommen in echten Archiven öfter vor als man denkt',
        'Und noch einer'
      );
      await mkdir(deep, { recursive: true });
      await writeFile(join(deep, 'Strand mit Mia und Lea am letzten Tag des Urlaubs.txt'), 'Sonne');
      await writeFile(join(source, 'Liste.txt'), 'Emi, Mia, Lea');
      await link(join(source, 'Liste.txt'), join(source, 'Liste-Kopie.txt'));
      await symlink('/etc/passwd', join(source, 'passwd'));
      for (const format of ['gnu', 'pax', 'ustar']) {
        const archive = join(work, `${format}.tar.gz`);
        execFileSync('tar', [`--format=${format}`, '-czf', archive, '-C', work, 'Fotos von Emi'], { stdio: 'ignore' });
        const id = await upload(`Fotos-${format}.tar.gz`, await readFile(archive));
        const result = await emi.json('POST', `/api/nodes/${id}/extract`, {});
        assert.equal(result.statusCode, 200, `${format}: ${result.body}`);
        assert.equal(result.json().files, 3, format);
        assert.equal(result.json().skipped.unsafe, 1, format);
        const files = tree(result.json().folderId);
        const strand = Object.keys(files).find((path) => path.endsWith('Strand mit Mia und Lea am letzten Tag des Urlaubs.txt'));
        assert.ok(strand, `${format}: ${Object.keys(files).join(', ')}`);
        assert.equal(files[strand].sha256, sha('Sonne'));
        assert.equal(files['Fotos von Emi/Liste.txt'].sha256, sha('Emi, Mia, Lea'), format);
        assert.equal(files['Fotos von Emi/Liste-Kopie.txt'].sha256, sha('Emi, Mia, Lea'), format);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
