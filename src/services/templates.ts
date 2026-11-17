import { all } from '../lib/db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { cleanName, splitName } from '../lib/names.ts';
import { copyTo, getNode, requireFolder, resolveAccess, type NodeRow } from './nodes.ts';
import { prefsOf, updatePrefs, type UserRow } from './users.ts';

function folderOf(user: UserRow) {
  const id = prefsOf(user).templates;
  const node = id ? getNode(id) : undefined;
  if (!node || node.type !== 'folder' || node.trashed_at || !resolveAccess(user, node.id)) return null;
  return node;
}

export function templatesOf(user: UserRow) {
  const folder = folderOf(user);
  const items = folder
    ? all<NodeRow>(
        `SELECT * FROM nodes WHERE parent_id = ? AND type = 'file' AND trashed_at IS NULL ORDER BY name_key LIMIT 200`,
        folder.id
      )
    : [];
  return { folder, items };
}

export function setTemplates(user: UserRow, folderId: string | null) {
  if (folderId) {
    const { node } = requireFolder(user, folderId, 'view');
    if (!node.parent_id) throw badRequest('Nimm einen eigenen Ordner für Vorlagen, nicht den Hauptordner');
  }
  updatePrefs(user.id, { templates: folderId });
}

export function fromTemplate(user: UserRow, targetId: string, templateId: string, rawName: string) {
  const folder = folderOf(user);
  const template = getNode(templateId);
  if (!folder || !template || template.parent_id !== folder.id || template.type !== 'file' || template.trashed_at) {
    throw notFound('Diese Vorlage gibt es nicht mehr');
  }
  let name = cleanName(rawName);
  const [, extension] = splitName(template.name);
  if (extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name = cleanName(`${name}${extension}`);
  return copyTo(user, template.id, targetId, name);
}
