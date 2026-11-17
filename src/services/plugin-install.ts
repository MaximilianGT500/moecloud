import { createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import type { Lang } from '../lib/i18n.ts';
import { each, entryStream, openZip, safePath } from './archive.ts';
import { forgetPlugin, parseManifest, pick, PLUGIN_LIMITS, unlocked, withPluginLock } from './plugins.ts';

const SYMLINK = 0o120000;

export const installPlugin = (zipPath: string) => withPluginLock(() => install(zipPath));

async function install(zipPath: string) {
  if (!config.plugins.enabled) throw badRequest('Plugins sind auf diesem Server abgeschaltet');
  const names: string[] = [];
  let bytes = 0;
  const listing = await openZip(zipPath).catch(() => {
    throw badRequest('Das ist kein ZIP-Archiv mit einem Plugin');
  });
  await each(listing, (entry) => {
    if (entry.fileName.endsWith('/')) return;
    if (!safePath(entry.fileName)) throw badRequest('Im Archiv steht ein unzulässiger Pfad');
    if (((entry.externalFileAttributes >>> 16) & 0o170000) === SYMLINK) throw badRequest('Verknüpfungen sind in Plugins nicht erlaubt');
    names.push(entry.fileName);
    bytes += entry.uncompressedSize;
    if (names.length > PLUGIN_LIMITS.files || bytes > PLUGIN_LIMITS.bytes) throw badRequest('Das Plugin ist zu groß');
  });
  let prefix = '';
  if (!names.includes('plugin.json')) {
    const tops = new Set(names.map((name) => name.split('/')[0]));
    const top = tops.size === 1 ? [...tops][0] : null;
    if (!top || !names.includes(`${top}/plugin.json`)) throw badRequest('Im Archiv fehlt die Datei plugin.json');
    prefix = `${top}/`;
  }
  await mkdir(config.paths.plugins, { recursive: true });
  const temp = join(config.paths.plugins, `.install-${randomId(10)}`);
  try {
    const archive = await openZip(zipPath);
    await each(archive, async (entry) => {
      if (entry.fileName.endsWith('/') || !entry.fileName.startsWith(prefix)) return;
      const target = join(temp, entry.fileName.slice(prefix.length));
      await mkdir(dirname(target), { recursive: true });
      await pipeline(await entryStream(archive, entry), createWriteStream(target, { flags: 'wx', mode: 0o644 }));
    });
    const manifest = parseManifest(await readFile(join(temp, 'plugin.json'), 'utf8'));
    const final = join(config.paths.plugins, manifest.id);
    const replaced = Boolean(await stat(final).catch(() => null));
    if (replaced) {
      await unlocked.stop(manifest.id);
      await rm(final, { recursive: true, force: true });
    }
    await rename(temp, final);
    await unlocked.scan();
    return { id: manifest.id, version: manifest.version, replaced };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function removePlugin(id: string) {
  return withPluginLock(async () => {
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(id)) throw notFound('Dieses Plugin gibt es nicht mehr');
    const dir = join(config.paths.plugins, id);
    if (!(await stat(dir).catch(() => null))) throw notFound('Dieses Plugin gibt es nicht mehr');
    await unlocked.stop(id);
    await rm(dir, { recursive: true, force: true });
    forgetPlugin(id);
    await unlocked.scan();
  });
}

export async function listExamples(lang: Lang) {
  const names = await readdir(config.paths.examples).catch(() => [] as string[]);
  const examples: { id: string; name: string; description: string; version: string; installed: boolean }[] = [];
  for (const name of names.sort()) {
    const raw = await readFile(join(config.paths.examples, name, 'plugin.json'), 'utf8').catch(() => null);
    if (raw === null) continue;
    try {
      const manifest = parseManifest(raw);
      if (manifest.id !== name) continue;
      examples.push({
        id: manifest.id,
        name: pick(lang, manifest.name),
        description: pick(lang, manifest.description),
        version: manifest.version,
        installed: Boolean(await stat(join(config.paths.plugins, manifest.id)).catch(() => null)),
      });
    } catch {}
  }
  return examples;
}

export function addExample(id: string) {
  return withPluginLock(async () => {
    if (!config.plugins.enabled) throw badRequest('Plugins sind auf diesem Server abgeschaltet');
    const example = (await listExamples('de')).find((entry) => entry.id === id);
    if (!example) throw notFound('Dieses Beispiel gibt es nicht');
    if (example.installed) throw conflict('Ein Plugin mit dieser Kennung liegt schon im Ordner');
    await mkdir(config.paths.plugins, { recursive: true });
    const temp = join(config.paths.plugins, `.install-${randomId(10)}`);
    try {
      await cp(join(config.paths.examples, id), temp, { recursive: true, dereference: false, errorOnExist: true });
      await rename(temp, join(config.paths.plugins, id));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    await unlocked.scan();
    return { id: example.id, version: example.version, replaced: false };
  });
}
