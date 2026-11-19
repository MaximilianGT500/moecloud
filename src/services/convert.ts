import { createReadStream } from 'node:fs';
import { badRequest } from '../lib/errors.ts';
import { splitName } from '../lib/names.ts';
import { getBlob, receive, typeOf } from './blobs.ts';
import { createDerived, writableFolder } from './derived.ts';
import { editable, editImage, formatOf, OUTPUTS } from './editor.ts';
import { requireAccess, type NodeRow } from './nodes.ts';
import { canConvert, officePdf, officeReady } from './office.ts';
import { assertNotInfected } from './scan.ts';
import type { UserRow } from './users.ts';

export const CONVERT_FORMATS = ['pdf', ...OUTPUTS] as const;
export type ConvertFormat = (typeof CONVERT_FORMATS)[number];

export function convertOptions(node: Pick<NodeRow, 'type' | 'sha256' | 'name' | 'size' | 'mime'>): ConvertFormat[] {
  if (node.type !== 'file' || !node.sha256) return [];
  const type = typeOf(node, getBlob(node.sha256));
  if (editable(type)) return OUTPUTS.filter((format) => format !== formatOf(type));
  if (officeReady() && canConvert(node) && !/\.pdf$/i.test(node.name)) return ['pdf'];
  return [];
}

export async function convertNode(user: UserRow, nodeId: string, format: ConvertFormat) {
  const { node } = requireAccess(user, nodeId);
  if (!convertOptions(node).includes(format)) throw badRequest('In dieses Format lässt sich die Datei nicht umwandeln');
  assertNotInfected(node.sha256);
  if (format !== 'pdf') {
    return editImage(
      user,
      node.id,
      { rotate: 0, flipH: false, flipV: false, crop: null, maxEdge: null, format, quality: 90, save: 'copy' },
      '{name}'
    );
  }
  const folder = writableFolder(user, node.parent_id);
  const path = await officePdf(node);
  const received = await receive(createReadStream(path));
  return createDerived(user, folder, `${splitName(node.name)[0]}.pdf`, received, 'editor');
}
