import { badRequest, insufficientStorage, notFound, tooLarge } from '../lib/errors.ts';
import { cleanName } from '../lib/names.ts';
import { receive } from './blobs.ts';
import { createDerived, writableFolder } from './derived.ts';
import { remaining, requireAccess, subtree } from './nodes.ts';
import * as settings from './settings.ts';
import { formatBytes } from './uploads.ts';
import type { UserRow } from './users.ts';
import { zipStream } from './zip.ts';

const MAX_FILES = 50_000;

const zipFileName = (raw: string) => {
  const name = cleanName(raw);
  return /\.zip$/i.test(name) ? name : `${name}.zip`;
};

export async function packZip(user: UserRow, ids: string[], rawName: string) {
  if (ids.length === 0) throw badRequest('Wähle mindestens ein Element aus');
  const name = zipFileName(rawName);
  const roots = [...new Set(ids)].map((id) => requireAccess(user, id).node);
  if (roots.some((root) => root.trashed_at)) throw notFound();
  const files = roots.reduce((sum, root) => sum + subtree(root.id).filter((node) => node.type === 'file').length, 0);
  if (files > MAX_FILES) throw badRequest('Ein Archiv fasst höchstens {count} Dateien', { count: MAX_FILES });
  const folder = writableFolder(user, roots[0].parent_id);
  const space = remaining(folder.owner_id);
  const max = settings.get('storage.maxUpload');
  const limited = max > 0 && max < space;
  const received = await receive(zipStream(roots), limited ? max : space, () =>
    limited
      ? tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) })
      : insufficientStorage(
          folder.owner_id === user.id ? 'Dein Speicher ist voll' : 'Der Speicher der Person, der dieser Ordner gehört, ist voll'
        )
  );
  return createDerived(user, folder, name, received);
}
