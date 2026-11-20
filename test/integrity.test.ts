import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { all, one } from '../src/lib/db.ts';
import { blobPath } from '../src/services/blobs.ts';
import { cancelIntegrity, integrityDue, integrityRunning, startIntegrity, type IntegrityResult } from '../src/services/integrity.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let root = '';
const sha: Record<string, string> = {};

interface State {
  running: { total: number; checked: number } | null;
  last: IntegrityResult | null;
  schedule: string;
  cancelled?: boolean;
}

const state = async () => (await emi.get('/api/admin/integrity')).json() as State;

async function finished() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const current = await state();
    if (!current.running) return current;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Die Prüfung wird nicht fertig');
}

async function check() {
  const started = await emi.json('POST', '/api/admin/integrity');
  assert.equal(started.statusCode, 200, started.body);
  return (await finished()).last!;
}

const level = async () =>
  ((await emi.get('/api/admin/security')).json().items as { id: string; level: string }[]).find((item) => item.id === 'integrity')?.level;

async function put(client: Client, parent: string, name: string, content: string) {
  const done = await client.upload(parent, name, Buffer.from(content), 1024);
  assert.equal(done.statusCode, 200, done.body);
  const id = done.json().node.id as string;
  sha[name] = one<{ sha256: string }>('SELECT sha256 FROM nodes WHERE id = ?', id)!.sha256;
  return id;
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
  const miaRoot = (await mia.get('/api/session')).json().user.rootId;
  await put(emi, root, 'Vertrag.txt', 'Der Vertrag gilt ab dem ersten Januar.');
  await put(emi, root, 'Rezept.txt', 'Zwei Eier, etwas Mehl und eine Prise Salz.');
  await put(emi, root, 'Liste.txt', 'Brot, Butter, Tee');
  await put(mia, miaRoot, 'Brief.txt', 'Liebe Lea, danke für die Karte.');
  await put(mia, miaRoot, 'Kopie von Brief.txt', 'Liebe Lea, danke für die Karte.');
});

after(async () => {
  await app.close();
});

describe('Dateien prüfen', () => {
  it('meldet ohne Prüfung einen Hinweis und liest dann alle Dateien', async () => {
    assert.equal((await state()).last, null);
    assert.equal(await level(), 'hint');
    const total = Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM blobs WHERE refs > 0')!.n);
    assert.ok(total >= 4);
    const result = await check();
    assert.equal(result.checked, total);
    assert.equal(result.missing + result.damaged, 0);
    assert.deepEqual(result.problems, []);
    assert.equal(result.by, 'admin');
    assert.ok(result.bytes > 100);
    assert.equal(await level(), 'ok');
    const logged = all<{ details: string }>("SELECT details FROM audit WHERE action = 'integrity_checked'");
    assert.equal(logged.length, 1);
    assert.deepEqual(JSON.parse(logged[0].details), { checked: total, missing: 0, damaged: 0, via: 'admin' });
  });

  it('findet fehlende, veränderte und abgeschnittene Dateien und nennt, wem sie gehören', async () => {
    const changed = blobPath(sha['Vertrag.txt']);
    const original = await readFile(changed);
    await chmod(changed, 0o644).catch(() => undefined);
    await writeFile(changed, Buffer.from(original.toString('utf8').replace('Januar', 'Februa')));
    const cut = blobPath(sha['Rezept.txt']);
    await chmod(cut, 0o644).catch(() => undefined);
    await writeFile(cut, 'Zwei Eier');
    const gone = blobPath(sha['Brief.txt']);
    await rename(gone, `${gone}.weg`);

    const result = await check();
    assert.equal(result.missing, 1);
    assert.equal(result.damaged, 2);
    const byKind = (name: string) => result.problems.find((problem) => problem.sha256 === sha[name]);
    assert.equal(byKind('Vertrag.txt')?.kind, 'damaged');
    assert.equal(byKind('Rezept.txt')?.kind, 'damaged');
    assert.equal(byKind('Liste.txt'), undefined);
    const letter = byKind('Brief.txt')!;
    assert.equal(letter.kind, 'missing');
    assert.equal(letter.files, 2);
    assert.deepEqual(letter.examples.map((example) => `${example.name} von ${example.owner}`).sort(), [
      'Brief.txt von Mia',
      'Kopie von Brief.txt von Mia',
    ]);
    assert.deepEqual(byKind('Vertrag.txt')!.examples, [{ name: 'Vertrag.txt', owner: 'Emi' }]);
    assert.equal(await level(), 'warn');

    await writeFile(changed, original);
    await writeFile(cut, 'Zwei Eier, etwas Mehl und eine Prise Salz.');
    await rename(`${gone}.weg`, gone);
    const healed = await check();
    assert.equal(healed.missing + healed.damaged, 0);
    assert.equal(await level(), 'ok');
  });

  it('übergeht Dateien, die inzwischen endgültig gelöscht sind', async () => {
    const id = await put(emi, root, 'Kurz da.txt', 'Diese Datei verschwindet gleich wieder.');
    const path = blobPath(sha['Kurz da.txt']);
    assert.equal((await emi.json('POST', '/api/nodes/trash', { ids: [id] })).statusCode, 200);
    assert.equal((await emi.json('POST', '/api/nodes/delete', { ids: [id] })).statusCode, 200);
    await rm(path, { force: true });
    const result = await check();
    assert.equal(result.missing + result.damaged, 0, JSON.stringify(result.problems));
  });

  it('lässt sich abbrechen und behält dann das letzte vollständige Ergebnis', async () => {
    const before = (await state()).last!;
    const run = startIntegrity('admin');
    assert.equal(integrityRunning(), true);
    assert.ok((await state()).running);
    const stopped = await emi.json('DELETE', '/api/admin/integrity');
    assert.equal(stopped.statusCode, 200);
    assert.equal(stopped.json().cancelled, true);
    const result = await run;
    assert.equal(result.cancelled, true);
    assert.ok(result.checked < before.checked);
    assert.equal(integrityRunning(), false);
    assert.equal((await state()).last!.at, before.at);
    assert.equal(cancelIntegrity(), false);
    assert.equal((await emi.json('DELETE', '/api/admin/integrity')).json().cancelled, false);
  });

  it('läuft auf Wunsch von selbst, eine Stunde nach der Sicherung', async () => {
    const at = (hour: number) => {
      const date = new Date();
      date.setHours(hour, 10, 0, 0);
      return date;
    };
    const hour = (settings.get('backup.hour') + 1) % 24;
    assert.equal(integrityDue(at(hour)), false);
    for (const wrong of ['daily', '', 5]) {
      assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'integrity.schedule': wrong })).statusCode, 400);
    }
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'integrity.schedule': 'weekly' })).statusCode, 200);
    assert.equal((await state()).schedule, 'weekly');
    assert.equal(integrityDue(at(hour)), false, 'gerade erst geprüft');
    const last = settings.get('integrity.last')!;
    settings.set('integrity.last', { ...last, at: Date.now() - 8 * 86_400_000 });
    assert.equal(integrityDue(at(hour)), true);
    assert.equal(integrityDue(at((hour + 5) % 24)), false, 'falsche Stunde');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'integrity.schedule': 'monthly' })).statusCode, 200);
    assert.equal(integrityDue(at(hour)), false, 'monatlich ist noch nicht dran');
    settings.set('integrity.last', { ...last, at: Date.now() - 31 * 86_400_000 });
    assert.equal(integrityDue(at(hour)), true);
    settings.set('integrity.last', null);
    assert.equal(integrityDue(at(hour)), true, 'noch nie geprüft');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'integrity.schedule': 'off' })).statusCode, 200);
    assert.equal(integrityDue(at(hour)), false);
  });

  it('gibt Admins Bescheid, wenn die Prüfung von selbst etwas findet', async () => {
    const path = blobPath(sha['Liste.txt']);
    await rename(path, `${path}.weg`);
    try {
      const result = await startIntegrity('schedule');
      assert.equal(result.missing, 1);
    } finally {
      await rename(`${path}.weg`, path);
    }
    const notes = (await emi.get('/api/notifications')).json().items as { kind: string; title: string; text: string; url: string }[];
    const note = notes.find((entry) => entry.kind === 'admin_integrity');
    assert.ok(note, JSON.stringify(notes.map((entry) => entry.kind)));
    assert.match(note.text, /Fehlende Dateien: 1, beschädigte Dateien: 0/);
    assert.equal(note.url, '/admin/security');
    assert.ok(
      !((await mia.get('/api/notifications')).json().items as { kind: string }[]).some((entry) => entry.kind === 'admin_integrity')
    );
  });

  it('gehört nur Admins', async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/integrity'],
      ['POST', '/api/admin/integrity'],
      ['DELETE', '/api/admin/integrity'],
    ] as const) {
      assert.equal((await mia.json(method, url)).statusCode, 403, `${method} ${url}`);
      assert.equal((await new Client(app).json(method, url)).statusCode, 401, `${method} ${url}`);
    }
    assert.equal(integrityRunning(), false);
  });

  it('prüft mit check --deep auch von der Kommandozeile aus', async () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'cli.ts', ...args], {
        cwd: resolve(import.meta.dirname, '..'),
        env: process.env,
        encoding: 'utf8',
        timeout: 60_000,
      });
    const fine = cli('check', '--deep');
    assert.equal(fine.status, 0, fine.stderr);
    assert.match(fine.stdout, /Alle \d+ Dateien sind da und unversehrt/);
    const path = blobPath(sha['Vertrag.txt']);
    const original = await readFile(path);
    await writeFile(path, Buffer.from(original.toString('utf8').replace('Vertrag', 'Vortrag')));
    const bad = cli('check', '--deep');
    assert.equal(bad.status, 2, bad.stdout);
    assert.match(bad.stdout, new RegExp(`Beschädigt: ${sha['Vertrag.txt']} \\(„Vertrag\\.txt“ von Emi\\)`));
    assert.match(bad.stdout, /0 von \d+ Dateien fehlen, 1 sind beschädigt/);
    settings.reset();
    const last = settings.get('integrity.last')!;
    assert.equal(last.by, 'cli');
    assert.equal(last.damaged, 1);
    assert.equal(cli('check').status, 0);
    await writeFile(path, original);
  });
});
