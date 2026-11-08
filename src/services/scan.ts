import { rm } from 'node:fs/promises';
import { all, run, value } from '../lib/db.ts';
import { ClamError, EICAR, clamVersion, scanBuffer, scanFile, type ClamTarget } from '../lib/clamav.ts';
import { HttpError } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { log } from '../lib/log.ts';
import { audit } from './audit.ts';
import { blobPath, getBlob } from './blobs.ts';
import { notify, notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';
import { getUser } from './users.ts';

export type ScanStatus = 'clean' | 'infected' | 'skipped' | 'error' | 'released';

export interface Verdict {
  status: ScanStatus;
  signature: string | null;
}

export interface ScanContext {
  userId: number | null;
  name: string;
  via: 'upload' | 'link' | 'dav' | 'editor' | 'api';
}

const TIMEOUT = 120_000;

export const scanEnabled = () => settings.get('scan.enabled');

export function scanTarget(overrides: Partial<ClamTarget> = {}): ClamTarget {
  const socket = overrides.socket !== undefined ? overrides.socket : settings.get('scan.socket');
  return {
    host: overrides.host || settings.get('scan.host'),
    port: overrides.port || settings.get('scan.port'),
    socket: socket || null,
    timeoutMs: overrides.timeoutMs ?? TIMEOUT,
  };
}

let lastAlert = 0;

function alertUnreachable(error: Error) {
  if (Date.now() - lastAlert < 60 * 60 * 1000) return;
  lastAlert = Date.now();
  notifyAdmins('admin_scan', { error: error.message.slice(0, 200) }, '/admin/scan');
}

async function runScan(path: string, size: number): Promise<Verdict> {
  const limit = settings.get('scan.maxBytes');
  if (limit > 0 && size > limit) return { status: 'skipped', signature: null };
  try {
    const result = await scanFile(path, scanTarget());
    return result.infected ? { status: 'infected', signature: result.signature } : { status: 'clean', signature: null };
  } catch (error) {
    if (error instanceof ClamError && error.code === 'too_large') return { status: 'skipped', signature: null };
    log.warn({ error: (error as Error).message }, 'Virenscan fehlgeschlagen');
    alertUnreachable(error as Error);
    return { status: 'error', signature: null };
  }
}

export const infectedError = (signature: string) =>
  new HttpError(422, 'Die Datei enthält Schadsoftware ({signature}) und wurde nicht gespeichert', 'infected', { signature }, { signature });

export async function checkUpload(path: string, size: number, sha256: string, context: ScanContext): Promise<Verdict | null> {
  const existing = getBlob(sha256);
  if (existing?.scan_status === 'infected') {
    await rm(path, { force: true });
    throw infectedError(existing.scan_signature ?? 'Malware');
  }
  if (!scanEnabled() || size === 0) return null;
  if (existing && (existing.scan_status === 'clean' || existing.scan_status === 'released')) return null;
  const verdict = await runScan(path, size);
  if (verdict.status === 'infected') {
    await rm(path, { force: true });
    const user = context.userId ? getUser(context.userId) : null;
    audit('virus_found', {
      actor: context.userId,
      details: { name: context.name.slice(0, 200), signature: verdict.signature, via: context.via },
    });
    notifyAdmins('admin_virus', { name: context.name, user: user?.name ?? '?', signature: verdict.signature ?? '' }, '/admin/scan');
    throw infectedError(verdict.signature ?? 'Malware');
  }
  if (verdict.status === 'error' && settings.get('scan.onError') === 'reject') {
    await rm(path, { force: true });
    throw new HttpError(503, 'Der Virenscan ist gerade nicht erreichbar, versuch es gleich noch einmal', 'scan_unavailable');
  }
  return verdict;
}

export function assertNotInfected(sha256: string | null) {
  if (!sha256) return;
  const blob = getBlob(sha256);
  if (blob?.scan_status === 'infected') {
    throw new HttpError(403, 'Diese Datei enthält Schadsoftware und ist gesperrt', 'infected', undefined, {
      signature: blob.scan_signature,
    });
  }
}

export function markBlob(sha256: string, verdict: Verdict | null) {
  if (!verdict) return;
  run(
    'UPDATE blobs SET scan_status = ?, scan_signature = ?, scanned_at = ? WHERE sha256 = ?',
    verdict.status,
    verdict.signature,
    Date.now(),
    sha256
  );
}

function owners(sha256: string) {
  return all<{ owner_id: number; id: string; name: string; parent_id: string | null }>(
    'SELECT owner_id, id, name, parent_id FROM nodes WHERE sha256 = ? AND trashed_at IS NULL',
    sha256
  );
}

export async function scanBlob(sha256: string): Promise<Verdict | null> {
  const blob = getBlob(sha256);
  if (!blob || blob.refs <= 0) return null;
  if (blob.scan_status === 'released' || blob.scan_status === 'infected') return null;
  const verdict = await runScan(blobPath(sha256), blob.size);
  if (verdict.status === 'error') return verdict;
  markBlob(sha256, verdict);
  if (verdict.status === 'infected') quarantined(sha256, verdict.signature ?? 'Malware');
  return verdict;
}

function quarantined(sha256: string, signature: string) {
  const nodes = owners(sha256);
  audit('virus_found', { details: { sha256: sha256.slice(0, 16), signature, files: nodes.length, via: 'rescan' } });
  const seen = new Set<number>();
  for (const node of nodes) {
    if (seen.has(node.owner_id)) continue;
    seen.add(node.owner_id);
    notify(node.owner_id, 'virus', { name: node.name, signature }, node.parent_id ? `/files/folder/${node.parent_id}` : '/files');
  }
  if (nodes[0])
    notifyAdmins('admin_virus', { name: nodes[0].name, user: getUser(nodes[0].owner_id)?.name ?? '?', signature }, '/admin/scan');
  publish(seen, 'change', { folders: nodes.map((node) => node.parent_id).filter(Boolean) });
}

export function releaseBlob(sha256: string, actorId: number) {
  const blob = getBlob(sha256);
  if (!blob || blob.scan_status !== 'infected') return false;
  run("UPDATE blobs SET scan_status = 'released', scanned_at = ? WHERE sha256 = ?", Date.now(), sha256);
  audit('virus_released', { actor: actorId, details: { sha256: sha256.slice(0, 16), signature: blob.scan_signature } });
  const nodes = owners(sha256);
  publish(new Set(nodes.map((node) => node.owner_id)), 'change', { folders: nodes.map((node) => node.parent_id).filter(Boolean) });
  return true;
}

export function purgeInfected(sha256: string, actorId: number) {
  const blob = getBlob(sha256);
  if (!blob || blob.scan_status !== 'infected') return 0;
  const nodes = owners(sha256);
  const removed =
    run('DELETE FROM versions WHERE sha256 = ?', sha256).changes +
    run("DELETE FROM nodes WHERE sha256 = ? AND type = 'file'", sha256).changes;
  audit('virus_deleted', { actor: actorId, details: { sha256: sha256.slice(0, 16), deleted: removed, signature: blob.scan_signature } });
  publish(new Set(nodes.map((node) => node.owner_id)), 'change', {
    folders: nodes.map((node) => node.parent_id).filter(Boolean),
    trash: true,
  });
  return removed;
}

export function quarantine() {
  return all<{ sha256: string; size: number; scan_signature: string | null; scanned_at: number | null }>(
    "SELECT sha256, size, scan_signature, scanned_at FROM blobs WHERE scan_status = 'infected' AND refs > 0 ORDER BY scanned_at DESC LIMIT 200"
  ).map((blob) => ({
    sha256: blob.sha256,
    size: blob.size,
    signature: blob.scan_signature,
    scannedAt: blob.scanned_at,
    files: owners(blob.sha256).map((node) => ({ id: node.id, name: node.name, owner: getUser(node.owner_id)?.name ?? '?' })),
  }));
}

export function scanStats() {
  const count = (status: string | null) =>
    status === null
      ? (value<number>('SELECT COUNT(*) FROM blobs WHERE refs > 0 AND scan_status IS NULL') ?? 0)
      : (value<number>('SELECT COUNT(*) FROM blobs WHERE refs > 0 AND scan_status = ?', status) ?? 0);
  return {
    clean: count('clean'),
    infected: count('infected'),
    skipped: count('skipped'),
    error: count('error'),
    released: count('released'),
    unscanned: count(null),
    lastScan: value<number>('SELECT MAX(scanned_at) FROM blobs') ?? null,
  };
}

export const job = { running: false, done: 0, total: 0, found: 0, startedAt: 0 };

export function rescan(everything = false) {
  if (job.running || !scanEnabled()) return job;
  const days = settings.get('scan.rescanDays');
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const candidates = (
    everything
      ? all<{ sha256: string }>(
          "SELECT sha256 FROM blobs WHERE refs > 0 AND (scan_status IS NULL OR scan_status NOT IN ('infected', 'released'))"
        )
      : all<{ sha256: string }>(
          "SELECT sha256 FROM blobs WHERE refs > 0 AND (scan_status IS NULL OR scan_status = 'error' OR (scan_status IN ('clean', 'skipped') AND scanned_at < ?))",
          cutoff
        )
  ).map((row) => row.sha256);
  Object.assign(job, { running: true, done: 0, total: candidates.length, found: 0, startedAt: Date.now() });
  void (async () => {
    try {
      for (const sha of candidates) {
        if (!scanEnabled()) break;
        const verdict = await scanBlob(sha);
        if (verdict?.status === 'infected') job.found++;
        if (verdict?.status === 'error') break;
        job.done++;
      }
    } finally {
      job.running = false;
    }
  })();
  return job;
}

export async function testScanner(overrides: Partial<ClamTarget> = {}) {
  const target = scanTarget({ ...overrides, timeoutMs: 15_000 });
  const started = Date.now();
  const version = await clamVersion(target);
  const probe = await scanBuffer(Buffer.from(EICAR), target);
  return { ok: true, version, detects: probe.infected, signature: probe.signature, ms: Date.now() - started };
}
