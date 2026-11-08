import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import { isTextual } from '../lib/mime.ts';
import { nameKey, numbered } from '../lib/names.ts';
import { blobPath, getBlob } from './blobs.ts';
import { subtree, type NodeRow } from './nodes.ts';

export function zipName(roots: NodeRow[], fallback: string) {
  if (roots.length === 1) return `${roots[0].name || fallback}.zip`;
  return `${fallback}.zip`;
}

export function zipStream(roots: NodeRow[]): Readable {
  const zip = new yazl.ZipFile();
  const used = new Set<string>();
  for (const root of roots) {
    let base = root.name || 'Dateien';
    for (let n = 2; used.has(nameKey(base)); n++) base = numbered(root.name || 'Dateien', n, root.type === 'folder');
    used.add(nameKey(base));
    const paths = new Map<string, string>();
    for (const node of subtree(root.id)) {
      const path = node.id === root.id ? base : `${paths.get(node.parent_id!)}/${node.name}`;
      if (!path || path.startsWith('undefined')) continue;
      paths.set(node.id, path);
      const mtime = new Date(node.modified_at);
      if (node.type === 'folder') {
        zip.addEmptyDirectory(path, { mtime });
      } else if (node.sha256 && getBlob(node.sha256)?.scan_status !== 'infected') {
        const sha = node.sha256;
        zip.addReadStreamLazy(path, { mtime, size: node.size, compress: isTextual(node.name, node.mime) }, (callback) =>
          callback(null, createReadStream(blobPath(sha)))
        );
      }
    }
  }
  zip.end();
  return zip.outputStream as Readable;
}
