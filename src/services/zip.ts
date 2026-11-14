import { createReadStream, existsSync, readFile } from 'node:fs';
import { Readable } from 'node:stream';
import yazl from 'yazl';
import { all } from '../lib/db.ts';
import { applyBlanks, blanker, locationBlanks, stripsLocation } from './location.ts';
import { isTextual } from '../lib/mime.ts';
import { nameKey, numbered } from '../lib/names.ts';
import { blobPath } from './blobs.ts';
import { subtree, type NodeRow } from './nodes.ts';

const BUFFERED = 256 * 1024;
const PACKED = 1024;

export function zipName(roots: NodeRow[], fallback: string) {
  if (roots.length === 1) return `${roots[0].name || fallback}.zip`;
  return `${fallback}.zip`;
}

function source(file: string, size: number, fail: (error: Error) => void, location: { sha: string; type: string } | null) {
  return (callback: (error: Error | null, stream: Readable) => void) => {
    const blanks = location ? locationBlanks(file, location.sha, location.type) : Promise.resolve([]);
    void blanks.then((found) => {
      if (size <= BUFFERED) {
        readFile(file, (error, data) =>
          error ? fail(error) : callback(null, Readable.from([found.length ? applyBlanks(data, 0, found) : data], { objectMode: false }))
        );
        return;
      }
      const stream = createReadStream(file);
      stream.once('error', fail);
      callback(null, found.length ? stream.pipe(blanker(found)) : stream);
    });
  };
}

export interface ZipOptions {
  prefix?: string;
  extras?: { name: string; data: Buffer }[];
  strip?: boolean;
}

export function zipStream(roots: NodeRow[], options: ZipOptions = {}): Readable {
  const zip = new yazl.ZipFile();
  const output = zip.outputStream as Readable;
  const fail = (error: Error) => output.destroy(error);
  zip.on('error', fail);
  const infected = new Set(all<{ sha256: string }>("SELECT sha256 FROM blobs WHERE scan_status = 'infected'").map((row) => row.sha256));
  const used = new Set<string>();
  const prefix = options.prefix ? `${options.prefix}/` : '';
  if (options.prefix) zip.addEmptyDirectory(options.prefix, { mtime: new Date() });
  for (const root of roots) {
    let base = root.name || 'Dateien';
    for (let n = 2; used.has(nameKey(base)); n++) base = numbered(root.name || 'Dateien', n, root.type === 'folder');
    used.add(nameKey(base));
    const paths = new Map<string, string>();
    for (const node of subtree(root.id)) {
      const path = node.id === root.id ? `${prefix}${base}` : `${paths.get(node.parent_id!)}/${node.name}`;
      if (!path || path.startsWith('undefined')) continue;
      paths.set(node.id, path);
      const mtime = new Date(node.modified_at);
      if (node.type === 'folder') {
        zip.addEmptyDirectory(path, { mtime });
      } else if (node.sha256 && !infected.has(node.sha256) && existsSync(blobPath(node.sha256))) {
        const compress = node.size >= PACKED && isTextual(node.name, node.mime);
        const location = options.strip && node.mime && stripsLocation(node.mime) ? { sha: node.sha256, type: node.mime } : null;
        zip.addReadStreamLazy(path, { mtime, size: node.size, compress }, source(blobPath(node.sha256), node.size, fail, location));
      }
    }
  }
  for (const extra of options.extras ?? []) zip.addBuffer(extra.data, extra.name, { mtime: new Date(), compress: true });
  zip.end();
  return output;
}
