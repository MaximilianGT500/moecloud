import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const site = resolve(import.meta.dirname, '../website');
const pages = (await readdir(site)).filter((name) => name.endsWith('.html'));
const problems: string[] = [];
const ids = new Map<string, Set<string>>();

for (const page of pages) {
  const html = await readFile(join(site, page), 'utf8');
  ids.set(page, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])));
}

for (const page of pages) {
  const html = await readFile(join(site, page), 'utf8');
  const targets = [
    ...[...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((match) => match[1].split(',').map((entry) => entry.trim().split(/\s+/)[0])),
  ];
  for (const target of targets) {
    if (/^(https?:|mailto:|data:)/.test(target)) continue;
    const [path, hash] = target.split('#');
    const clean = path.split('?')[0];
    const file = clean === '' ? page : clean === './' || clean === '/' ? 'index.html' : clean.replace(/^\.?\//, '');
    const absolute = clean.startsWith('/') ? join(site, file) : join(dirname(join(site, page)), file);
    if (!existsSync(absolute)) {
      problems.push(`${page}: ${target} fehlt`);
      continue;
    }
    if (hash && file.endsWith('.html') && !ids.get(file.replace(/^.*\//, ''))?.has(hash))
      problems.push(`${page}: Anker #${hash} fehlt in ${file}`);
  }
  for (const [, id] of html.matchAll(/aria-(?:controls|labelledby|describedby)="([^"]+)"/g)) {
    for (const part of id.split(/\s+/)) if (!ids.get(page)?.has(part)) problems.push(`${page}: Verweis auf #${part} ohne Element`);
  }
}

const feed = JSON.parse(await readFile(join(site, 'version.json'), 'utf8')) as { version: string; changelog: string };
const pkg = JSON.parse(await readFile(resolve(site, '../package.json'), 'utf8')) as { version: string };
if (feed.version !== pkg.version) problems.push(`version.json nennt ${feed.version}, package.json ${pkg.version}`);
const anchor = feed.changelog.split('#')[1];
if (!ids.get('changelog.html')?.has(anchor)) problems.push(`version.json verweist auf #${anchor}, das im Changelog fehlt`);
const changelog = await readFile(resolve(site, '../CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${pkg.version}]`)) problems.push(`CHANGELOG.md hat keinen Eintrag für ${pkg.version}`);

for (const problem of problems) process.stdout.write(`${problem}\n`);
process.stdout.write(`${pages.length} Seiten geprüft, ${problems.length} Probleme\n`);
if (problems.length) process.exitCode = 1;
