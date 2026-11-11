import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const RELEASES = 'https://github.com/MaximilianGT500/moecloud/releases/tag/v';
const SEMVER = /^\d+\.\d+\.\d+$/;

interface Release {
  version: string;
  date: string;
}

interface Spot {
  file: string;
  what: string;
  pattern: RegExp;
  expect: (release: Release) => string;
}

const full = (release: Release) => release.version;
const minor = (release: Release) => release.version.split('.').slice(0, 2).join('.');
const major = (release: Release) => release.version.split('.')[0];
const day = (release: Release) => release.date;

const SPOTS: Spot[] = [
  { file: 'package.json', what: 'version', pattern: /^ {2}"version": "([^"]+)"/dm, expect: full },
  { file: 'package-lock.json', what: 'version', pattern: /^ {2}"version": "([^"]+)"/dm, expect: full },
  {
    file: 'package-lock.json',
    what: 'version im Paket ""',
    pattern: /^ {4}"": \{\n {6}"name": "[^"]+",\n {6}"version": "([^"]+)"/dm,
    expect: full,
  },
  { file: 'README.md', what: 'Beispiel für MOECLOUD_VERSION', pattern: /Mit `MOECLOUD_VERSION=([\d.]+)` in der `\.env`/d, expect: full },
  {
    file: 'README.md',
    what: 'Beispiel für den Tag mit ganzer Version',
    pattern: /eigene Tags wie `([\d.]+)`, `[\d.]+` und `\d+`/d,
    expect: full,
  },
  { file: 'README.md', what: 'Beispiel für den Tag ohne Patch', pattern: /eigene Tags wie `[\d.]+`, `([\d.]+)` und `\d+`/d, expect: minor },
  {
    file: 'README.md',
    what: 'Beispiel für den Tag der Hauptversion',
    pattern: /eigene Tags wie `[\d.]+`, `[\d.]+` und `(\d+)`/d,
    expect: major,
  },
  { file: 'README.md', what: 'Beispiel in der Tabelle der Variablen', pattern: /Tag des Images, etwa `([\d.]+)`/d, expect: full },
  { file: 'README.md', what: 'version im Beispiel der version.json', pattern: /^ {2}"version": "([\d.]+)",$/dm, expect: full },
  { file: 'README.md', what: 'date im Beispiel der version.json', pattern: /^ {2}"date": "([\d-]+)",$/dm, expect: day },
  { file: 'README.md', what: 'changelog im Beispiel der version.json', pattern: /changelog\.html#v([\d.]+)"/d, expect: full },
  { file: 'SECURITY.md', what: 'unterstützte Version', pattern: /^\| ([\d.]+)\.x +\| Ja/dm, expect: minor },
  {
    file: '.github/ISSUE_TEMPLATE/fehler.yml',
    what: 'Platzhalter für die Version',
    pattern: /placeholder: (\d+\.\d+\.\d+)/d,
    expect: full,
  },
];

const texts = new Map<string, string>();

async function text(file: string) {
  if (!texts.has(file)) texts.set(file, await readFile(join(root, file), 'utf8'));
  return texts.get(file)!;
}

const lineOf = (content: string, index: number) => content.slice(0, index).split('\n').length;

function find(spot: Spot, content: string) {
  const match = spot.pattern.exec(content);
  const range = match?.indices?.[1];
  return match && range ? { value: match[1], start: range[0], end: range[1] } : null;
}

const parts = (version: string) => version.split('.').map(Number);

function newer(a: string, b: string) {
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

async function releases() {
  const changelog = await text('CHANGELOG.md');
  return [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] · (\d{4}-\d{2}-\d{2})$/gm)].map((match) => ({
    version: match[1],
    date: match[2],
  }));
}

async function set(version: string) {
  const known = (await releases()).find((entry) => entry.version === version);
  const release = { version, date: known?.date ?? today() };
  for (const spot of SPOTS) {
    const content = await text(spot.file);
    const found = find(spot, content);
    if (found) texts.set(spot.file, content.slice(0, found.start) + spot.expect(release) + content.slice(found.end));
  }
  for (const [file, content] of texts) await writeFile(join(root, file), content);
  process.stdout.write(`Version ${version} eingetragen\n`);
}

async function check() {
  const problems: string[] = [];
  const pkg = JSON.parse(await text('package.json')) as { version: string };
  const changelog = await text('CHANGELOG.md');
  const list = await releases();
  const headings = [...changelog.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

  if (!SEMVER.test(pkg.version)) problems.push(`package.json: ${pkg.version} ist keine Version der Form x.y.z`);
  if (headings.length !== list.length)
    problems.push('CHANGELOG.md: Jede Überschrift der zweiten Ebene braucht die Form „## [x.y.z] · JJJJ-MM-TT“');
  if (list[0]?.version !== pkg.version) {
    problems.push(`CHANGELOG.md: Der oberste Eintrag ist ${list[0]?.version ?? 'leer'}, package.json nennt ${pkg.version}`);
  }
  list.forEach((entry, index) => {
    if (list.findIndex((other) => other.version === entry.version) !== index)
      problems.push(`CHANGELOG.md: ${entry.version} steht doppelt drin`);
    const older = list[index + 1];
    if (!older) return;
    if (!newer(entry.version, older.version))
      problems.push(`CHANGELOG.md: ${entry.version} steht über ${older.version}, ist aber nicht neuer`);
    if (entry.date < older.date) problems.push(`CHANGELOG.md: ${entry.version} ist auf ${entry.date} datiert, also vor ${older.version}`);
  });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (list[0] && list[0].date > tomorrow)
    problems.push(`CHANGELOG.md: ${list[0].version} ist auf ${list[0].date} datiert, das liegt in der Zukunft`);

  const links = [...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]: (\S+)$/gm)].map((match) => ({ version: match[1], url: match[2] }));
  for (const entry of list) {
    const found = links.filter((link) => link.version === entry.version);
    if (found.length !== 1)
      problems.push(`CHANGELOG.md: Für ${entry.version} gibt es ${found.length} Verweise am Ende, es muss genau einer sein`);
    else if (found[0].url !== `${RELEASES}${entry.version}`)
      problems.push(`CHANGELOG.md: Der Verweis für ${entry.version} zeigt auf ${found[0].url}`);
  }
  for (const link of links) {
    if (!list.some((entry) => entry.version === link.version))
      problems.push(`CHANGELOG.md: Der Verweis [${link.version}] hat keinen Eintrag`);
  }
  if (links.map((link) => link.version).join() !== list.map((entry) => entry.version).join()) {
    problems.push('CHANGELOG.md: Die Verweise am Ende stehen in einer anderen Reihenfolge als die Einträge');
  }

  const release = { version: pkg.version, date: list.find((entry) => entry.version === pkg.version)?.date ?? '' };
  for (const spot of SPOTS) {
    const content = await text(spot.file);
    const found = find(spot, content);
    if (!found) {
      problems.push(`${spot.file}: ${spot.what} nicht gefunden`);
      continue;
    }
    const expected = spot.expect(release);
    if (expected && found.value !== expected) {
      problems.push(`${spot.file}:${lineOf(content, found.start)}: ${spot.what} nennt ${found.value} statt ${expected}`);
    }
  }

  for (const problem of problems) process.stdout.write(`${problem}\n`);
  process.stdout.write(
    `Version ${pkg.version}, ${list.length} Einträge im Changelog, ${SPOTS.length} Stellen geprüft, ${problems.length === 1 ? '1 Problem' : `${problems.length} Probleme`}\n`
  );
  if (problems.length) process.exitCode = 1;
}

const wanted = process.argv[2]?.replace(/^v/, '');
if (wanted) {
  if (!SEMVER.test(wanted)) {
    process.stderr.write('Gib die Version als x.y.z an, zum Beispiel: node tools/version.ts 1.2.3\n');
    process.exit(1);
  }
  await set(wanted);
  texts.clear();
}
await check();
