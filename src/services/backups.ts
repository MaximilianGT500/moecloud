import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { stamp, vacuumInto } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { audit } from './audit.ts';
import { notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';

const NAME = /^moecloud-[\w-]{1,80}\.db$/;

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
  const entries = await readdir(config.paths.backups).catch(() => [] as string[]);
  const out: BackupInfo[] = [];
  for (const name of entries) {
    if (!NAME.test(name)) continue;
    const info = await stat(join(config.paths.backups, name)).catch(() => null);
    if (info?.isFile()) out.push({ name, size: info.size, createdAt: info.mtimeMs, kind: kindOf(name) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createBackup(kind: 'auto' | 'manual', actor: number | null = null) {
  await mkdir(config.paths.backups, { recursive: true });
  const name = `moecloud-${kind}-${stamp()}.db`;
  const path = join(config.paths.backups, name);
  vacuumInto(path);
  const info = await stat(path);
  audit('backup_created', { actor, details: { name, size: info.size, kind } });
  if (kind === 'auto') settings.set('backup.last', Date.now());
  return { name, size: info.size, createdAt: info.mtimeMs, kind } satisfies BackupInfo;
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
  const auto = (await listBackups()).filter((backup) => backup.kind === 'auto');
  const updates = (await listBackups()).filter((backup) => backup.kind === 'update');
  let removed = 0;
  for (const backup of [...auto.slice(Math.max(1, keep)), ...updates.slice(3)]) {
    await rm(join(config.paths.backups, backup.name), { force: true });
    removed++;
  }
  return removed;
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
