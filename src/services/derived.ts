import { rm } from 'node:fs/promises';
import { uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import type { Received } from './blobs.ts';
import { ingest, ingestBuffer } from './ingest.ts';
import { assertSpace, changed, getNode, insertNode, requireFolder, resolveAccess, taken, type NodeRow } from './nodes.ts';
import { checkQuota } from './uploads.ts';
import type { ScanContext } from './scan.ts';
import type { UserRow } from './users.ts';

export function writableFolder(user: UserRow, preferred: string | null) {
  const access = preferred ? resolveAccess(user, preferred) : null;
  if (access && access.node.type === 'folder' && !access.node.trashed_at && (access.role === 'owner' || access.role === 'edit')) {
    return access.node;
  }
  return requireFolder(user, user.root_id, 'edit').node;
}

export async function createDerived(
  user: UserRow,
  folder: NodeRow,
  wanted: string,
  content: Buffer | Received,
  via: ScanContext['via'] = 'editor'
) {
  const size = Buffer.isBuffer(content) ? content.length : content.size;
  const context = { userId: user.id, name: wanted, via };
  let sha256: string;
  try {
    assertSpace(folder.owner_id, size, user.id);
    sha256 = Buffer.isBuffer(content) ? await ingestBuffer(content, context) : await ingest(content, context);
  } catch (error) {
    if (!Buffer.isBuffer(content)) await rm(content.path, { force: true });
    throw error;
  }
  const name = uniqueName(wanted, false, taken(folder.id));
  const node = insertNode({
    ownerId: folder.owner_id,
    parentId: folder.id,
    type: 'file',
    name,
    actorId: user.id,
    size,
    sha256,
  });
  record({ owner: folder.owner_id, actor: user.id, node: node.id, parent: folder.id, action: 'text', name });
  changed([folder.id]);
  checkQuota(folder.owner_id);
  return getNode(node.id)!;
}
