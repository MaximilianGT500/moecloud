import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = join(root, 'src/i18n/en.json');

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const STRING = String.raw`'((?:[^'\\]|\\.)*)'`;
const PATTERNS = [
  new RegExp(String.raw`\btp?\(\s*(?:[\w.]+\s*,\s*)?${STRING}`, 'g'),
  new RegExp(String.raw`\btn\(\s*[^,]+,\s*${STRING}\s*,\s*${STRING}`, 'g'),
  new RegExp(String.raw`\brich\(\s*${STRING}`, 'g'),
  new RegExp(String.raw`\b(?:badRequest|unauthorized|forbidden|notFound|conflict|tooLarge|insufficientStorage|tooMany)\(\s*${STRING}`, 'g'),
  new RegExp(String.raw`new HttpError\(\s*\d+\s*,\s*${STRING}`, 'g'),
  new RegExp(String.raw`\.(?:min|max|regex|refine)\([^'()]*(?:\([^()]*\)[^'()]*)*,\s*${STRING}\s*\)`, 'g'),
  new RegExp(String.raw`\b(?:label|name|title):\s*${STRING}`, 'g'),
  new RegExp(
    String.raw`^\s+(?:folder|image|video|audio|pdf|text|code|document|spreadsheet|presentation|archive|other):\s*${STRING},?$`,
    'gm'
  ),
];

const KEY_FILES = /(kinds\.tsx|scheme\.ts|FilesApp\.tsx|Storage\.tsx|pages\.ts|setup\.ts|admin\.ts|validate\.ts)$/;

const keys = new Set<string>();
const sources = [...(await files(join(root, 'src'))), ...(await files(join(root, 'web/src')))];
for (const file of sources) {
  const code = await readFile(file, 'utf8');
  PATTERNS.forEach((pattern, index) => {
    if (index === PATTERNS.length - 2 && !KEY_FILES.test(file)) return;
    if (index === PATTERNS.length - 1 && !file.endsWith('kinds.tsx')) return;
    for (const match of code.matchAll(pattern)) {
      for (const value of match.slice(1)) {
        if (value === undefined) continue;
        const text = value.replace(/\\'/g, "'");
        if (/[A-Za-zÄÖÜäöüß]/.test(text) && !/^[a-z][\w.-]*$/.test(text)) keys.add(text);
      }
    }
  });
}

const existing = JSON.parse(await readFile(target, 'utf8')) as Record<string, string>;
const missing = [...keys].filter((key) => !(key in existing)).sort();
const unused = Object.keys(existing).filter((key) => !keys.has(key));
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
const mismatched = Object.entries(existing).filter(
  ([key, value]) => keys.has(key) && value.split('|').some((form) => placeholders(form) !== placeholders(key))
);

if (process.argv.includes('--prune') && unused.length) {
  for (const key of unused) delete existing[key];
  await writeFile(
    target,
    `${JSON.stringify(Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b, 'de'))), null, 2)}\n`
  );
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(missing, null, 2)}\n`);
} else {
  process.stdout.write(
    `${keys.size} Texte, ${missing.length} ohne Übersetzung, ${unused.length} ungenutzt, ${mismatched.length} mit falschen Platzhaltern\n`
  );
  for (const key of missing) process.stdout.write(`fehlt: ${key}\n`);
  for (const key of unused) process.stdout.write(`ungenutzt: ${key}\n`);
  for (const [key] of mismatched) process.stdout.write(`Platzhalter: ${key}\n`);
}
if ((missing.length || mismatched.length) && process.argv.includes('--strict')) process.exitCode = 1;
