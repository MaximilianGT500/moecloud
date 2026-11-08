import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { store, tmpPath, type Received } from './blobs.ts';
import { wake } from './processing.ts';
import { checkUpload, markBlob, type ScanContext } from './scan.ts';

export async function ingest(received: Received, context: ScanContext) {
  const verdict = await checkUpload(received.path, received.size, received.sha256, context);
  const sha = await store(received);
  markBlob(sha, verdict);
  wake();
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
