import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { runFilter } from '../lib/hooks.ts';
import { store, tmpPath, type Received } from './blobs.ts';
import { wake } from './processing.ts';
import { countPulse } from './pulse.ts';
import { checkUpload, markBlob, type ScanContext } from './scan.ts';

export async function ingest(received: Received, context: ScanContext) {
  try {
    await runFilter('upload', () => ({
      name: context.name,
      size: received.size,
      sha256: received.sha256,
      via: context.via,
      userId: context.userId,
      path: received.path,
    }));
  } catch (error) {
    await rm(received.path, { force: true });
    throw error;
  }
  const verdict = await checkUpload(received.path, received.size, received.sha256, context);
  const sha = await store(received);
  markBlob(sha, verdict);
  wake();
  if (context.via === 'dav') countPulse('webdav');
  else if (context.via === 'upload' || context.via === 'link' || context.via === 'api') countPulse('upload');
  return sha;
}

export async function ingestBuffer(buffer: Buffer, context: ScanContext) {
  const path = tmpPath();
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
  return ingest({ path, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }, context);
}
