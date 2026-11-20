import { stat } from 'node:fs/promises';
import { all, one, value } from '../lib/db.ts';
import { audit } from './audit.ts';
import { blobPath, hashFile } from './blobs.ts';
import { notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';

export type IntegrityKind = 'missing' | 'damaged';
export type IntegritySource = 'admin' | 'schedule' | 'cli';
export type IntegritySchedule = 'off' | 'weekly' | 'monthly';

export interface IntegrityProblem {
  sha256: string;
  kind: IntegrityKind;
  size: number;
  files: number;
  versions: number;
  examples: { name: string; owner: string }[];
}

export interface IntegrityResult {
  at: number;
  by: IntegritySource;
  durationMs: number;
  checked: number;
  bytes: number;
  missing: number;
  damaged: number;
  cancelled: boolean;
  problems: IntegrityProblem[];
}

export interface IntegrityProgress {
  startedAt: number;
  total: number;
  totalBytes: number;
  checked: number;
  bytes: number;
  missing: number;
  damaged: number;
  cancel: boolean;
}

const PROBLEM_LIMIT = 100;
const DAY = 86_400_000;

async function verdict(sha: string, size: number): Promise<IntegrityKind | null> {
  const path = blobPath(sha);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return 'missing';
  if (info.size !== Number(size)) return 'damaged';
  try {
    return (await hashFile(path)) === sha ? null : 'damaged';
  } catch {
    return 'damaged';
  }
}

function describe(sha: string, kind: IntegrityKind, size: number): IntegrityProblem {
  return {
    sha256: sha,
    kind,
    size: Number(size),
    files: Number(value<number>('SELECT COUNT(*) FROM nodes WHERE sha256 = ?', sha) ?? 0),
    versions: Number(value<number>('SELECT COUNT(*) FROM versions WHERE sha256 = ?', sha) ?? 0),
    examples: all<{ name: string; owner: string }>(
      'SELECT n.name AS name, u.name AS owner FROM nodes n JOIN users u ON u.id = n.owner_id WHERE n.sha256 = ? ORDER BY n.created_at, n.id LIMIT 3',
      sha
    ),
  };
}

export function newProgress(): IntegrityProgress {
  const totals = one<{ total: number; bytes: number | null }>('SELECT COUNT(*) AS total, SUM(size) AS bytes FROM blobs WHERE refs > 0');
  return {
    startedAt: Date.now(),
    total: Number(totals?.total ?? 0),
    totalBytes: Number(totals?.bytes ?? 0),
    checked: 0,
    bytes: 0,
    missing: 0,
    damaged: 0,
    cancel: false,
  };
}

export async function verifyBlobs(by: IntegritySource, progress = newProgress()): Promise<IntegrityResult> {
  const problems: IntegrityProblem[] = [];
  let after = '';
  scan: for (;;) {
    const rows = all<{ sha256: string; size: number }>(
      'SELECT sha256, size FROM blobs WHERE refs > 0 AND sha256 > ? ORDER BY sha256 LIMIT 200',
      after
    );
    if (!rows.length) break;
    for (const row of rows) {
      if (progress.cancel) break scan;
      const kind = await verdict(row.sha256, row.size);
      progress.checked++;
      progress.bytes += Number(row.size);
      if (!kind) continue;
      const still = one<{ refs: number }>('SELECT refs FROM blobs WHERE sha256 = ?', row.sha256);
      if (!still || Number(still.refs) <= 0) continue;
      progress[kind]++;
      if (problems.length < PROBLEM_LIMIT) problems.push(describe(row.sha256, kind, row.size));
    }
    after = rows[rows.length - 1].sha256;
  }
  return {
    at: Date.now(),
    by,
    durationMs: Date.now() - progress.startedAt,
    checked: progress.checked,
    bytes: progress.bytes,
    missing: progress.missing,
    damaged: progress.damaged,
    cancelled: progress.cancel,
    problems,
  };
}

export function recordIntegrity(result: IntegrityResult) {
  if (result.cancelled) return;
  settings.set('integrity.last', result);
  audit('integrity_checked', { details: { checked: result.checked, missing: result.missing, damaged: result.damaged, via: result.by } });
  if (result.by === 'schedule' && result.missing + result.damaged > 0) {
    notifyAdmins('admin_integrity', { missing: result.missing, damaged: result.damaged }, '/admin/security');
  }
}

let current: { progress: IntegrityProgress; done: Promise<IntegrityResult> } | null = null;

export function startIntegrity(by: IntegritySource = 'admin') {
  if (current) return current.done;
  const progress = newProgress();
  const done = verifyBlobs(by, progress)
    .then((result) => {
      recordIntegrity(result);
      return result;
    })
    .finally(() => {
      current = null;
    });
  current = { progress, done };
  done.catch(() => undefined);
  return done;
}

export function cancelIntegrity() {
  if (!current) return false;
  current.progress.cancel = true;
  return true;
}

export const integrityRunning = () => Boolean(current);

export function integrityState() {
  const progress = current?.progress;
  return {
    running: progress
      ? {
          startedAt: progress.startedAt,
          total: progress.total,
          totalBytes: progress.totalBytes,
          checked: progress.checked,
          bytes: progress.bytes,
          missing: progress.missing,
          damaged: progress.damaged,
        }
      : null,
    last: settings.get('integrity.last'),
    schedule: settings.get('integrity.schedule'),
  };
}

export function integrityDue(now = new Date()) {
  const schedule = settings.get('integrity.schedule');
  if (schedule === 'off' || current) return false;
  if (now.getHours() !== (settings.get('backup.hour') + 1) % 24) return false;
  const last = settings.get('integrity.last');
  const every = (schedule === 'weekly' ? 7 : 30) * DAY;
  return !last || now.getTime() - last.at >= every - DAY / 2;
}
