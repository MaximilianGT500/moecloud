import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.ts';
import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, tooLarge } from '../lib/errors.ts';
import { resolveType } from '../lib/mime.ts';

export interface BlobRow {
  sha256: string;
  size: number;
  refs: number;
  width: number | null;
  height: number | null;
  thumb: number;
  created_at: number;
  processed: number;
  meta: string | null;
  taken_at: number | null;
  scan_status: 'clean' | 'infected' | 'skipped' | 'error' | 'released' | null;
  scan_signature: string | null;
  scanned_at: number | null;
}

export function metaOf(blob: Pick<BlobRow, 'meta'> | undefined | null): Record<string, unknown> {
  if (!blob?.meta) return {};
  try {
    return JSON.parse(blob.meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const typeOf = (node: { name: string; mime: string | null }, blob?: Pick<BlobRow, 'meta'> | null) =>
  resolveType(node.name, node.mime, blob?.meta ? metaOf(blob).type : undefined);

export const blobPath = (sha: string) => join(config.paths.blobs, sha.slice(0, 2), sha.slice(2, 4), sha);
export const thumbPath = (sha: string) => join(config.paths.thumbs, sha.slice(0, 2), `${sha}.webp`);
export const previewPath = (sha: string) => join(config.paths.previews, sha.slice(0, 2), `${sha}.webp`);
export const tmpPath = (name = randomId(24)) => join(config.paths.tmp, name);

export async function ensureDirs() {
  for (const dir of Object.values(config.paths)) {
    if (dir.endsWith('.db')) continue;
    await mkdir(dir, { recursive: true });
  }
}

export const getBlob = (sha: string) => one<BlobRow>('SELECT * FROM blobs WHERE sha256 = ?', sha);

function limiter(limit: number, onLimit: () => HttpError) {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) callback(onLimit());
      else callback(null, chunk);
    },
  });
}

export interface Received {
  path: string;
  size: number;
  sha256: string;
}

export async function receive(
  stream: Readable,
  limit = Number.MAX_SAFE_INTEGER,
  onLimit: () => HttpError = () => tooLarge()
): Promise<Received> {
  const path = tmpPath();
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, limiter(limit, onLimit), counter, createWriteStream(path, { flags: 'wx' }));
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return { path, size, sha256: hash.digest('hex') };
}

export async function append(path: string, stream: Readable, limit: number, onLimit: () => HttpError = () => tooLarge()) {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(stream, limiter(limit, onLimit), counter, createWriteStream(path, { flags: 'a' }));
  return size;
}

export async function hashFile(path: string) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function fileSize(path: string) {
  return (await stat(path)).size;
}

const locks = new Map<string, Promise<void>>();

async function locked<T>(sha: string, fn: () => Promise<T>): Promise<T> {
  while (locks.has(sha)) await locks.get(sha);
  let release = () => {};
  locks.set(
    sha,
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    return await fn();
  } finally {
    locks.delete(sha);
    release();
  }
}

export function store(received: Received) {
  return locked(received.sha256, async () => {
    const existing = getBlob(received.sha256);
    if (existing) {
      await rm(received.path, { force: true });
      run('UPDATE blobs SET created_at = ? WHERE sha256 = ? AND refs <= 0', Date.now(), received.sha256);
      return received.sha256;
    }
    const target = blobPath(received.sha256);
    await mkdir(dirname(target), { recursive: true });
    await rename(received.path, target);
    run(
      'INSERT INTO blobs (sha256, size, refs, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(sha256) DO NOTHING',
      received.sha256,
      received.size,
      Date.now()
    );
    return received.sha256;
  });
}

export async function storeBuffer(buffer: Buffer) {
  const path = tmpPath();
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
  return store({ path, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
}

export async function collectGarbage(graceMs = 60 * 60 * 1000) {
  const cutoff = Date.now() - graceMs;
  const rows = all<BlobRow>('SELECT * FROM blobs WHERE refs <= 0 AND created_at < ?', cutoff);
  let removed = 0;
  for (const row of rows) {
    await locked(row.sha256, async () => {
      if (run('DELETE FROM blobs WHERE sha256 = ? AND refs <= 0 AND created_at < ?', row.sha256, cutoff).changes === 0) return;
      await rm(blobPath(row.sha256), { force: true });
      await rm(thumbPath(row.sha256), { force: true });
      await rm(previewPath(row.sha256), { force: true });
      removed++;
    });
  }
  return removed;
}

export async function cleanTmp(maxAgeMs = 24 * 60 * 60 * 1000) {
  let removed = 0;
  for (const entry of await readdir(config.paths.tmp).catch(() => [] as string[])) {
    const path = join(config.paths.tmp, entry);
    const info = await stat(path).catch(() => null);
    if (info && info.isFile() && Date.now() - info.mtimeMs > maxAgeMs) {
      await rm(path, { force: true });
      removed++;
    }
  }
  return removed;
}
