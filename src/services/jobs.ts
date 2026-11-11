import type { FastifyBaseLogger } from 'fastify';
import { statfs } from 'node:fs/promises';
import { config } from '../config.ts';
import { db } from '../lib/db.ts';
import { purgeActivity } from './activity.ts';
import { purgeAudit, recentFailures } from './audit.ts';
import { autoBackup } from './backups.ts';
import { cleanTmp, collectGarbage } from './blobs.ts';
import { purgeInvites } from './invites.ts';
import { purgeTrash } from './nodes.ts';
import { notifyAdmins, purgeNotifications } from './notify.ts';
import { purgeResets } from './resets.ts';
import { rescan, scanEnabled } from './scan.ts';
import { purgeExpiredSessions } from './sessions.ts';
import { expireGrants } from './grants.ts';
import { expireGroupGrants } from './groups.ts';
import * as settings from './settings.ts';
import { checkForUpdates, updatesEnabled } from './updates.ts';
import { cleanupUploads, formatBytes } from './uploads.ts';

export async function runMaintenance() {
  const trash = purgeTrash(settings.get('storage.trashDays'));
  const uploads = await cleanupUploads();
  const blobs = await collectGarbage();
  const tmp = await cleanTmp();
  const sessions = purgeExpiredSessions().changes;
  purgeInvites();
  purgeResets();
  purgeNotifications();
  const audit = purgeAudit(settings.get('audit.days'));
  const activity = purgeActivity(settings.get('activity.days'));
  try {
    db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
  return { trash, uploads, blobs, tmp, sessions, audit, activity };
}

let diskAlert = 0;
let loginAlert = 0;

export async function checkDisk() {
  const disk = await statfs(config.dataDir).catch(() => null);
  if (!disk) return null;
  const total = disk.blocks * disk.bsize;
  const free = disk.bavail * disk.bsize;
  const low = free < Math.min(2 * 1024 ** 3, total * 0.05) || free < total * 0.02;
  if (low && Date.now() - diskAlert > 24 * 60 * 60 * 1000) {
    diskAlert = Date.now();
    notifyAdmins('admin_disk', { free: formatBytes(free) }, '/admin');
  }
  return { total, free, low };
}

function checkLogins() {
  const count = recentFailures(15);
  if (count >= 25 && Date.now() - loginAlert > 60 * 60 * 1000) {
    loginAlert = Date.now();
    notifyAdmins('admin_logins', { count }, '/admin/audit');
  }
}

export function startJobs(log: FastifyBaseLogger) {
  let maintaining = false;
  const maintenance = async () => {
    if (maintaining) return;
    maintaining = true;
    try {
      const result = await runMaintenance();
      if (result.trash || result.blobs || result.uploads) log.info(result, 'Aufräumen erledigt');
    } catch (error) {
      log.error(error, 'Aufräumen fehlgeschlagen');
    } finally {
      maintaining = false;
    }
  };
  const frequent = async () => {
    try {
      expireGrants();
      expireGroupGrants();
      await autoBackup();
      await checkDisk();
      checkLogins();
    } catch (error) {
      log.error(error, 'Prüfung fehlgeschlagen');
    }
  };
  const daily = async () => {
    if (updatesEnabled()) {
      try {
        const status = await checkForUpdates();
        if (status.available) log.info({ version: status.latest?.version }, 'Eine neue Version von MoeCloud ist verfügbar');
      } catch (error) {
        log.debug({ error: (error as Error).message }, 'Versionsprüfung fehlgeschlagen');
      }
    }
    if (scanEnabled() && settings.get('scan.rescanDays') > 0) rescan();
  };
  const timers = [
    setTimeout(maintenance, 30_000),
    setTimeout(frequent, 45_000),
    setTimeout(daily, 90_000),
    setInterval(maintenance, 15 * 60_000),
    setInterval(frequent, 5 * 60_000),
    setInterval(daily, 24 * 60 * 60_000),
  ];
  for (const timer of timers) timer.unref();
  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  };
}
