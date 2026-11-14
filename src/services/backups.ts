import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { snapshotDatabaseAsync, stamp } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { audit } from './audit.ts';
import { notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';

const NAME = /^moecloud-[\w-]{1,80}\.db$/;
const LEFTOVER = /^(moecloud-[\w-]{1,80}\.db)(\.partial|-journal)$/;
const STALE = 10 * 60 * 1000;

export type BackupKind = 'auto' | 'manual' | 'update';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
  kind: BackupKind;
}

const kindOf = (name: string): BackupKind =>
  name.startsWith('moecloud-auto-') ? 'auto' : name.startsWith('moecloud-update-') ? 'update' : 'manual';

export async function listBackups(): Promise<BackupInfo[]> {
  const entries = new Set(await readdir(config.paths.backups).catch(() => [] as string[]));
  const out: BackupInfo[] = [];
  for (const name of entries) {
    if (!NAME.test(name) || entries.has(`${name}-journal`)) continue;
    const info = await stat(join(config.paths.backups, name)).catch(() => null);
    if (info?.isFile() && info.size > 0) out.push({ name, size: info.size, createdAt: info.mtimeMs, kind: kindOf(name) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function tidyBackups(now = Date.now()) {
  const entries = await readdir(config.paths.backups).catch(() => [] as string[]);
  const stale = new Map<string, number>();
  for (const name of entries) {
    if (!NAME.test(name) && !LEFTOVER.test(name)) continue;
    const info = await stat(join(config.paths.backups, name)).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs >= STALE) stale.set(name, info.size);
  }
  const doomed = new Set<string>();
  for (const [name, size] of stale) {
    const leftover = LEFTOVER.exec(name);
    if (!leftover) {
      if (size === 0) doomed.add(name);
      continue;
    }
    const [, base, suffix] = leftover;
    if (suffix === '.partial') doomed.add(name);
    else if (stale.has(base) || !entries.includes(base)) doomed.add(name).add(base);
  }
  let removed = 0;
  for (const name of doomed) {
    if (!entries.includes(name)) continue;
    const gone = await rm(join(config.paths.backups, name), { force: true }).then(
      () => true,
      () => false
    );
    if (gone) removed++;
  }
  return removed;
}

export async function createBackup(kind: 'auto' | 'manual', actor: number | null = null) {
  await mkdir(config.paths.backups, { recursive: true });
  const name = `moecloud-${kind}-${stamp()}.db`;
  const path = join(config.paths.backups, name);
  await snapshotDatabaseAsync(path);
  const info = await stat(path);
  audit('backup_created', { actor, details: { name, size: info.size, kind } });
  if (kind === 'auto') settings.set('backup.last', Date.now());
  await copyBackup(path, name, info.size);
  return { name, size: info.size, createdAt: info.mtimeMs, kind } satisfies BackupInfo;
}

export async function copyBackup(path: string, name: string, size: number) {
  const target = config.backupCopy;
  if (!target) return false;
  const partial = join(target, `${name}.partial`);
  try {
    await mkdir(target, { recursive: true });
    await copyFile(path, partial);
    if ((await stat(partial)).size !== size) throw new Error('Die Kopie ist unvollständig');
    await rename(partial, join(target, name));
    settings.setMany({ 'backup.copied': Date.now(), 'backup.copyError': '' });
    return true;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    const message = (error as Error).message.slice(0, 300);
    settings.set('backup.copyError', message);
    audit('backup_failed', { details: { error: message, copy: target } });
    notifyAdmins('admin_backup', { error: message }, '/admin/backups');
    log.error({ error: message, target }, 'Kopie der Sicherung fehlgeschlagen');
    return false;
  }
}

async function pruneCopies(keep: number) {
  const target = config.backupCopy;
  if (!target) return 0;
  const names = (await readdir(target).catch(() => [] as string[])).filter((name) => NAME.test(name));
  const dated = await Promise.all(
    names.map(async (name) => ({ name, at: (await stat(join(target, name)).catch(() => null))?.mtimeMs ?? 0, kind: kindOf(name) }))
  );
  dated.sort((a, b) => b.at - a.at);
  const auto = dated.filter((entry) => entry.kind === 'auto');
  const updates = dated.filter((entry) => entry.kind === 'update');
  let removed = 0;
  for (const entry of [...auto.slice(Math.max(1, keep)), ...updates.slice(3)]) {
    await rm(join(target, entry.name), { force: true });
    removed++;
  }
  return removed;
}

export async function backupPath(name: string) {
  if (!NAME.test(name)) throw notFound('Diese Sicherung gibt es nicht');
  const path = join(config.paths.backups, name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound('Diese Sicherung gibt es nicht');
  return { path, size: info.size, modified: info.mtimeMs };
}

export async function deleteBackup(name: string, actor: number | null) {
  const { path } = await backupPath(name);
  await rm(path, { force: true });
  audit('backup_deleted', { actor, details: { name } });
}

export async function pruneBackups(keep = settings.get('backup.keep')) {
  let removed = await tidyBackups();
  const backups = await listBackups();
  const auto = backups.filter((backup) => backup.kind === 'auto');
  const updates = backups.filter((backup) => backup.kind === 'update');
  for (const backup of [...auto.slice(Math.max(1, keep)), ...updates.slice(3)]) {
    await rm(join(config.paths.backups, backup.name), { force: true });
    removed++;
  }
  return removed + (await pruneCopies(keep));
}

export function backupDue(now = new Date()) {
  if (!settings.get('backup.enabled')) return false;
  const due = new Date(now);
  due.setHours(settings.get('backup.hour'), 0, 0, 0);
  if (due.getTime() > now.getTime()) due.setDate(due.getDate() - 1);
  return settings.get('backup.last') < due.getTime();
}

export async function autoBackup() {
  if (!backupDue()) return null;
  try {
    const backup = await createBackup('auto');
    await pruneBackups();
    log.info({ name: backup.name, size: backup.size }, 'Automatische Sicherung erstellt');
    return backup;
  } catch (error) {
    settings.set('backup.last', Date.now());
    const message = (error as Error).message.slice(0, 300);
    audit('backup_failed', { details: { error: message } });
    notifyAdmins('admin_backup', { error: message }, '/admin/backups');
    log.error({ error: message }, 'Automatische Sicherung fehlgeschlagen');
    return null;
  }
}
