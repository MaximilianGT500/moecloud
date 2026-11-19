import { badRequest, notFound } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { getNode, measureChildren, seedFrom, STARTER_LIMIT, type NodeRow } from './nodes.ts';
import * as settings from './settings.ts';
import { getUser, onAccount, type UserRow } from './users.ts';

export function starterFolder(): NodeRow | null {
  const id = settings.get('accounts.starter');
  if (!id) return null;
  const node = getNode(id);
  if (!node || node.type !== 'folder' || node.trashed_at || !node.parent_id) return null;
  return getUser(node.owner_id)?.role === 'admin' ? node : null;
}

export function starterState() {
  const folder = starterFolder();
  if (!folder) return { folder: null };
  const { items, bytes } = measureChildren(folder.id);
  return { folder: { id: folder.id, name: folder.name, owner: getUser(folder.owner_id)?.name ?? '', items, bytes } };
}

export function setStarter(admin: UserRow, folderId: string | null) {
  if (!folderId) {
    settings.set('accounts.starter', '');
    return starterState();
  }
  const node = getNode(folderId);
  if (!node || node.owner_id !== admin.id || node.trashed_at) throw notFound('Diesen Ordner gibt es nicht');
  if (node.type !== 'folder' || !node.parent_id) throw badRequest('Such dafür einen Ordner in deinen eigenen Dateien aus');
  const { items } = measureChildren(node.id);
  if (items === 0) throw badRequest('Der Ordner ist leer');
  if (items > STARTER_LIMIT) throw badRequest('Für Startdateien gehen höchstens {count} Dateien und Ordner', { count: STARTER_LIMIT });
  settings.set('accounts.starter', node.id);
  return starterState();
}

export function seedStarter(user: UserRow) {
  if (user.role !== 'user' && user.role !== 'admin') return 0;
  const folder = starterFolder();
  if (!folder || folder.owner_id === user.id) return 0;
  try {
    return seedFrom(folder.id, user);
  } catch (error) {
    log.warn({ error: (error as Error).message, user: user.id }, 'Die Startdateien passen nicht in das neue Konto');
    return 0;
  }
}

onAccount(seedStarter);
