import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const FILES = [
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'README.md',
  'SECURITY.md',
  '.github/ISSUE_TEMPLATE/fehler.yml',
  'tools/version.ts',
];
const copies: string[] = [];

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'moecloud-version-'));
  copies.push(dir);
  for (const file of FILES) cpSync(join(root, file), join(dir, file), { recursive: true });
  return dir;
}

function run(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/version.ts', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

function change(dir: string, file: string, edit: (text: string) => string) {
  const path = join(dir, file);
  writeFileSync(path, edit(readFileSync(path, 'utf8')));
}

const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

describe('Versionsangaben', () => {
  it('passen im Repository überall zusammen', () => {
    const result = run(root);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /0 Probleme/);
  });

  it('meldet eine doppelte Version im Changelog', () => {
    const dir = copy();
    change(dir, 'CHANGELOG.md', (text) => text.replace('## [1.0.0] ·', `## [${version}] ·`));
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(`${version.replaceAll('.', '\\.')} steht doppelt drin`));
  });

  it('meldet eine falsche Reihenfolge und einen fehlenden Verweis', () => {
    const dir = copy();
    change(dir, 'CHANGELOG.md', (text) => text.replace('## [1.0.0] ·', '## [9.0.0] ·'));
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /steht über 9\.0\.0, ist aber nicht neuer/);
    assert.match(result.output, /Für 9\.0\.0 gibt es 0 Verweise/);
    assert.match(result.output, /Der Verweis \[1\.0\.0\] hat keinen Eintrag/);
  });

  it('meldet veraltete Angaben mit Datei und Zeile', () => {
    const dir = copy();
    change(dir, 'SECURITY.md', (text) => text.replace(/^\| [\d.]+\.x /m, '| 0.9.x '));
    change(dir, 'README.md', (text) => text.replace(/MOECLOUD_VERSION=[\d.]+/, 'MOECLOUD_VERSION=0.9.0'));
    change(dir, 'package-lock.json', (text) => text.replace(`"version": "${version}"`, '"version": "0.9.0"'));
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /SECURITY\.md:\d+: unterstützte Version nennt 0\.9 statt/);
    assert.match(result.output, /README\.md:\d+: Beispiel für MOECLOUD_VERSION nennt 0\.9\.0 statt/);
    assert.match(result.output, /package-lock\.json:\d+: version nennt 0\.9\.0 statt/);
    assert.match(result.output, /3 Probleme/);
  });

  it('trägt eine neue Version überall ein und verlangt dann den Eintrag im Changelog', () => {
    const dir = copy();
    const first = run(dir, '9.8.7');
    assert.equal(first.status, 1);
    assert.match(first.output, /Version 9\.8\.7 eingetragen/);
    assert.match(first.output, /Der oberste Eintrag ist .+, package\.json nennt 9\.8\.7/);
    assert.match(first.output, /1 Problem\n/);
    assert.equal((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version, '9.8.7');
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    assert.equal(lock.version, '9.8.7');
    assert.equal(lock.packages[''].version, '9.8.7');
    assert.match(readFileSync(join(dir, 'SECURITY.md'), 'utf8'), /^\| 9\.8\.x +\| Ja/m);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /eigene Tags wie `9\.8\.7`, `9\.8` und `9`/);
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    change(dir, 'CHANGELOG.md', (text) =>
      text
        .replace(/^## \[/m, `## [9.8.7] · ${date}\n\nNeu.\n\n## [`)
        .replace(/^\[(\d+\.\d+\.\d+)\]: /m, '[9.8.7]: https://github.com/MaximilianGT500/moecloud/releases/tag/v9.8.7\n[$1]: ')
    );
    const second = run(dir);
    assert.equal(second.status, 0, second.output);
  });

  it('lehnt Angaben ab, die keine Version sind', () => {
    const result = run(copy(), 'neu');
    assert.equal(result.status, 1);
    assert.match(result.output, /Gib die Version als x\.y\.z an/);
  });
});
