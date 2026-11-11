import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.ts';
import * as store from '../src/lib/db.ts';
import { migrate, schemaVersion } from '../src/lib/schema.ts';
import { listBackups, tidyBackups } from '../src/services/backups.ts';

const dir = join(config.dataDir, 'snapshots');
mkdirSync(dir, { recursive: true });

function peek(file: string) {
  const copy = new DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
  try {
    return {
      version: (copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      probe: (copy.prepare("SELECT value FROM settings WHERE key = 'probe'").get() as { value: string } | undefined)?.value,
      check: (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
      format: readFileSync(file)[18],
    };
  } finally {
    copy.close();
  }
}

function oldDatabase(name: string, probe: string) {
  const file = join(dir, name);
  const old = new DatabaseSync(file);
  old.exec('PRAGMA journal_mode = WAL');
  migrate(old, schemaVersion() - 1);
  old.prepare("INSERT INTO settings (key, value) VALUES ('probe', ?)").run(JSON.stringify(probe));
  old.close();
  return file;
}

after(() => store.closeDatabase());

describe('Sicherungen der Datenbank', () => {
  it('sichert mit VACUUM INTO und prüft die Sicherung', () => {
    store.openDatabase(join(dir, 'emi.db'));
    store.run("INSERT INTO settings (key, value) VALUES ('probe', ?)", JSON.stringify('Emi'));
    const target = store.snapshotDatabase(join(dir, 'moecloud-manual-emi.db'));
    assert.deepEqual(peek(target), { version: schemaVersion(), probe: '"Emi"', check: 'ok', format: 1 });
    assert.throws(() => store.snapshotDatabase(target), /gibt es schon/);
  });

  it('weicht auf eine geprüfte Kopie aus, wenn VACUUM INTO scheitert', () => {
    store.run("UPDATE settings SET value = ? WHERE key = 'probe'", JSON.stringify('Mia'));
    const target = join(dir, 'moecloud-manual-mia.db');
    mkdirSync(`${target}-journal`);
    assert.equal(store.snapshotDatabase(target), target);
    assert.deepEqual(peek(target), { version: schemaVersion(), probe: '"Mia"', check: 'ok', format: 2 });
    assert.ok(!existsSync(`${target}.partial`));
    assert.ok(statSync(`${target}-journal`).isDirectory());
    assert.equal(store.value("SELECT value FROM settings WHERE key = 'probe'"), '"Mia"');
  });

  it('meldet beide Ursachen und lässt nichts liegen, wenn keine Sicherung geht', () => {
    const target = join(dir, 'fehlt', 'moecloud-manual-lea.db');
    assert.throws(() => store.snapshotDatabase(target), /auch die Kopie ging nicht/);
    assert.ok(!existsSync(join(dir, 'fehlt')));
  });

  it('legt vor einem Update eine Sicherung mit dem alten Stand an', () => {
    const file = oldDatabase('mia-alt.db', 'Mia');
    const backups = join(dir, 'updates');
    store.openDatabase(file, backups);
    assert.ok(store.updateBackup);
    assert.match(basename(store.updateBackup), new RegExp(`^moecloud-update-v${schemaVersion() - 1}-\\d{8}-\\d{6}\\.db$`));
    assert.deepEqual(peek(store.updateBackup), { version: schemaVersion() - 1, probe: '"Mia"', check: 'ok', format: 1 });
    assert.equal(store.value('PRAGMA user_version'), schemaVersion());
    assert.deepEqual(readdirSync(backups), [basename(store.updateBackup)]);
    store.openDatabase(file, backups);
    assert.equal(store.updateBackup, null);
    assert.equal(readdirSync(backups).length, 1);
  });

  it('lässt die Datenbank unverändert, wenn die Sicherung vor dem Update scheitert', () => {
    const file = oldDatabase('lea-alt.db', 'Lea');
    const blocker = join(dir, 'kein-ordner');
    writeFileSync(blocker, 'Lea');
    assert.throws(
      () => store.openDatabase(file, blocker),
      (error: Error) => {
        assert.match(error.message, /keine Sicherung in .*kein-ordner anlegen, darum bleibt die Datenbank unverändert/);
        return true;
      }
    );
    assert.throws(() => store.db(), /nicht geöffnet/);
    assert.equal(peek(file).version, schemaVersion() - 1);
  });
});

describe('Aufräumen im Sicherungsordner', () => {
  it('blendet leere und unfertige Sicherungen aus und entfernt alte Reste', async () => {
    const folder = config.paths.backups;
    mkdirSync(folder, { recursive: true });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const put = (name: string, content: string, stale = true) => {
      const path = join(folder, name);
      writeFileSync(path, content);
      if (stale) utimesSync(path, old, old);
    };
    put('moecloud-update-v3-20261111-204201.db', '');
    put('moecloud-update-v3-20261111-204202.db', '', false);
    put('moecloud-auto-20261110-030000.db', 'SQLite format 3');
    put('moecloud-manual-20261110-120000.db', 'Emi');
    put('moecloud-manual-20261110-120000.db-journal', 'Emi');
    put('moecloud-manual-20261111-090000.db.partial', 'Mia');
    put('moecloud-manual-20261111-100000.db', 'Lea', false);
    put('moecloud-manual-20261111-100000.db-journal', 'Lea');
    put('notizen-von-emi.txt', 'Emi');

    assert.deepEqual(
      (await listBackups()).map((backup) => backup.name),
      ['moecloud-auto-20261110-030000.db']
    );
    assert.equal(await tidyBackups(), 4);
    assert.deepEqual(readdirSync(folder).sort(), [
      'moecloud-auto-20261110-030000.db',
      'moecloud-manual-20261111-100000.db',
      'moecloud-manual-20261111-100000.db-journal',
      'moecloud-update-v3-20261111-204202.db',
      'notizen-von-emi.txt',
    ]);
    assert.equal(await tidyBackups(), 0);
  });
});
