import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { record } from './activity.ts';
import { getNode, requireAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import * as settings from './settings.ts';
import { getUser, initials, type UserRow } from './users.ts';

export interface GrantRow {
  id: string;
  node_id: string;
  owner_id: number;
  user_id: number;
  permission: 'view' | 'edit';
  created_by: number;
  created_at: number;
}

export const getGrant = (id: string) => one<GrantRow>('SELECT * FROM grants WHERE id = ?', id);

export function shareWith(user: UserRow, nodeId: string, targetId: number, permission: 'view' | 'edit') {
  if (!settings.get('share.users')) throw forbidden('Teilen mit anderen Personen ist auf diesem Server ausgeschaltet');
  const { node } = requireAccess(user, nodeId, 'owner');
  if (!node.parent_id) throw badRequest('Den Hauptordner kannst du nicht teilen');
  const target = getUser(targetId);
  if (!target || target.disabled) throw notFound('Diese Person gibt es nicht');
  if (target.id === user.id) throw badRequest('Mit dir selbst musst du nichts teilen');
  if (one('SELECT 1 FROM grants WHERE node_id = ? AND user_id = ?', nodeId, target.id)) {
    throw conflict('Mit {name} ist das schon geteilt', { name: target.name });
  }
  const id = randomId();
  run(
    'INSERT INTO grants (id, node_id, owner_id, user_id, permission, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    nodeId,
    node.owner_id,
    target.id,
    permission,
    user.id,
    Date.now()
  );
  publish([target.id], 'shared', { nodeId, by: user.name, name: node.name });
  record({
    owner: node.owner_id,
    actor: user.id,
    node: node.id,
    parent: node.parent_id,
    action: 'share_user',
    name: node.name,
    details: { with: target.name, permission },
  });
  notify(
    target.id,
    'shared',
    { by: user.name, name: node.name, permission },
    node.type === 'folder' ? `/files/folder/${node.id}` : '/files/shared'
  );
  return getGrant(id)!;
}

export function updateGrant(user: UserRow, id: string, permission: 'view' | 'edit') {
  const grant = getGrant(id);
  if (!grant || grant.owner_id !== user.id) throw notFound('Diese Freigabe gibt es nicht mehr');
  run('UPDATE grants SET permission = ? WHERE id = ?', permission, id);
  publish([grant.user_id], 'change', { folders: [grant.node_id] });
  return getGrant(id)!;
}

export function removeGrant(user: UserRow, id: string) {
  const grant = getGrant(id);
  if (!grant || (grant.owner_id !== user.id && grant.user_id !== user.id)) throw notFound('Diese Freigabe gibt es nicht mehr');
  run('DELETE FROM grants WHERE id = ?', id);
  const node = getNode(grant.node_id);
  const target = getUser(grant.user_id);
  if (node) {
    record({
      owner: grant.owner_id,
      actor: user.id,
      node: node.id,
      parent: node.parent_id,
      action: 'unshare_user',
      name: node.name,
      details: { with: target?.name ?? '' },
    });
  }
  publish([grant.user_id, grant.owner_id], 'change', { folders: [grant.node_id], shared: true });
}

export const grantsForNode = (nodeId: string) => all<GrantRow>('SELECT * FROM grants WHERE node_id = ? ORDER BY created_at', nodeId);

export function presentGrant(grant: GrantRow) {
  const target = getUser(grant.user_id);
  return {
    id: grant.id,
    nodeId: grant.node_id,
    permission: grant.permission,
    createdAt: grant.created_at,
    user: target ? { id: target.id, name: target.name, username: target.username, initials: initials(target.name) } : null,
    group: null,
  };
}

export function sharedWithMe(user: UserRow) {
  return all<GrantRow & { node: string }>('SELECT * FROM grants WHERE user_id = ? ORDER BY created_at DESC', user.id)
    .map((grant) => ({ grant, node: getNode(grant.node_id) }))
    .filter((entry): entry is { grant: GrantRow & { node: string }; node: NodeRow } => Boolean(entry.node && !entry.node.trashed_at));
}

export function sharedByMe(user: UserRow) {
  return all<GrantRow>('SELECT * FROM grants WHERE owner_id = ? ORDER BY created_at DESC', user.id);
}
