import { all, one, run, tx } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { record } from './activity.ts';
import { audit } from './audit.ts';
import { getNode, requireAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import * as settings from './settings.ts';
import { getUser, initials, type UserRow } from './users.ts';

export interface GroupRow {
  id: number;
  name: string;
  name_key: string;
  created_at: number;
}

export interface GroupGrantRow {
  id: string;
  node_id: string;
  owner_id: number;
  group_id: number;
  permission: 'view' | 'edit';
  created_by: number;
  created_at: number;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase('de');

export const getGroup = (id: number) => one<GroupRow>('SELECT * FROM groups WHERE id = ?', id);
export const getGroupGrant = (id: string) => one<GroupGrantRow>('SELECT * FROM group_grants WHERE id = ?', id);
export const memberIds = (groupId: number) =>
  all<{ user_id: number }>('SELECT user_id FROM group_members WHERE group_id = ?', groupId).map((row) => row.user_id);
export const isMember = (groupId: number, userId: number) =>
  Boolean(one('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId));
const memberCount = (groupId: number) => memberIds(groupId).length;

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw badRequest('Gib der Gruppe einen Namen');
  if (trimmed.length > 60) throw badRequest('Der Name ist zu lang');
  return trimmed;
}

export function presentGroup(group: GroupRow) {
  const members = all<UserRow>(
    'SELECT u.* FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.name COLLATE NOCASE',
    group.id
  );
  return {
    id: group.id,
    name: group.name,
    createdAt: group.created_at,
    members: members.map((user) => ({ id: user.id, name: user.name, username: user.username, initials: initials(user.name) })),
    shares: (one<{ count: number }>('SELECT COUNT(*) AS count FROM group_grants WHERE group_id = ?', group.id) ?? { count: 0 }).count,
  };
}

export const listGroups = () => all<GroupRow>('SELECT * FROM groups ORDER BY name COLLATE NOCASE').map(presentGroup);

export function createGroup(admin: UserRow, name: string, members: number[] = []) {
  const clean = cleanName(name);
  if (one('SELECT 1 FROM groups WHERE name_key = ?', nameKey(clean))) throw conflict('Eine Gruppe mit diesem Namen gibt es schon');
  const id = tx(() => {
    const result = run('INSERT INTO groups (name, name_key, created_at) VALUES (?, ?, ?)', clean, nameKey(clean), Date.now());
    const groupId = result.lastId;
    for (const userId of new Set(members)) addMemberRow(groupId, userId);
    return groupId;
  });
  audit('group_created', { actor: admin.id, details: { name: clean } });
  return presentGroup(getGroup(id)!);
}

export function renameGroup(admin: UserRow, id: number, name: string) {
  const group = getGroup(id);
  if (!group) throw notFound('Diese Gruppe gibt es nicht mehr');
  const clean = cleanName(name);
  const other = one<{ id: number }>('SELECT id FROM groups WHERE name_key = ?', nameKey(clean));
  if (other && other.id !== id) throw conflict('Eine Gruppe mit diesem Namen gibt es schon');
  run('UPDATE groups SET name = ?, name_key = ? WHERE id = ?', clean, nameKey(clean), id);
  audit('group_updated', { actor: admin.id, details: { name: clean, before: group.name } });
  publish(memberIds(id), 'change', { shared: true });
  return presentGroup(getGroup(id)!);
}

export function deleteGroup(admin: UserRow, id: number) {
  const group = getGroup(id);
  if (!group) throw notFound('Diese Gruppe gibt es nicht mehr');
  const members = memberIds(id);
  const owners = all<{ owner_id: number }>('SELECT DISTINCT owner_id FROM group_grants WHERE group_id = ?', id).map((row) => row.owner_id);
  run('DELETE FROM groups WHERE id = ?', id);
  audit('group_deleted', { actor: admin.id, details: { name: group.name } });
  publish([...members, ...owners], 'change', { shared: true });
}

function addMemberRow(groupId: number, userId: number) {
  const user = getUser(userId);
  if (!user) throw notFound('Diese Person gibt es nicht');
  run('INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)', groupId, userId, Date.now());
}

export function setMembers(admin: UserRow, id: number, members: number[]) {
  const group = getGroup(id);
  if (!group) throw notFound('Diese Gruppe gibt es nicht mehr');
  const before = new Set(memberIds(id));
  const after = new Set(members);
  tx(() => {
    for (const userId of before) if (!after.has(userId)) run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', id, userId);
    for (const userId of after) if (!before.has(userId)) addMemberRow(id, userId);
  });
  const added = [...after].filter((userId) => !before.has(userId));
  const removed = [...before].filter((userId) => !after.has(userId));
  if (added.length || removed.length) {
    audit('group_updated', {
      actor: admin.id,
      details: {
        name: group.name,
        added: added.map((userId) => getUser(userId)?.name ?? ''),
        removed: removed.map((userId) => getUser(userId)?.name ?? ''),
      },
    });
    publish([...added, ...removed], 'change', { shared: true });
  }
  return presentGroup(getGroup(id)!);
}

export function groupsOf(userId: number) {
  return all<GroupRow>(
    'SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name COLLATE NOCASE',
    userId
  );
}

export function searchGroups(user: UserRow, query: string) {
  const q = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const rows =
    user.role === 'admin'
      ? all<GroupRow>(`SELECT * FROM groups WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 6`, q)
      : all<GroupRow>(
          `SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id
           WHERE m.user_id = ? AND g.name LIKE ? ESCAPE '\\' ORDER BY g.name COLLATE NOCASE LIMIT 6`,
          user.id,
          q
        );
  return rows.map((group) => ({ id: group.id, name: group.name, members: memberCount(group.id) }));
}

export function shareWithGroup(user: UserRow, nodeId: string, groupId: number, permission: 'view' | 'edit') {
  if (!settings.get('share.users')) throw forbidden('Teilen mit anderen Personen ist auf diesem Server ausgeschaltet');
  const { node } = requireAccess(user, nodeId, 'owner');
  if (!node.parent_id) throw badRequest('Den Hauptordner kannst du nicht teilen');
  const group = getGroup(groupId);
  if (!group || (user.role !== 'admin' && !isMember(groupId, user.id))) throw notFound('Diese Gruppe gibt es nicht');
  if (one('SELECT 1 FROM group_grants WHERE node_id = ? AND group_id = ?', nodeId, groupId)) {
    throw conflict('Mit {name} ist das schon geteilt', { name: group.name });
  }
  const id = randomId();
  run(
    'INSERT INTO group_grants (id, node_id, owner_id, group_id, permission, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    nodeId,
    node.owner_id,
    groupId,
    permission,
    user.id,
    Date.now()
  );
  const recipients = memberIds(groupId).filter((memberId) => memberId !== node.owner_id);
  publish(recipients, 'shared', { nodeId, by: user.name, name: node.name });
  record({
    owner: node.owner_id,
    actor: user.id,
    node: node.id,
    parent: node.parent_id,
    action: 'share_group',
    name: node.name,
    details: { with: group.name, permission },
  });
  for (const memberId of recipients) {
    notify(
      memberId,
      'shared',
      { by: user.name, name: node.name, permission, group: group.name },
      node.type === 'folder' ? `/files/folder/${node.id}` : '/files/shared'
    );
  }
  return getGroupGrant(id)!;
}

export function updateGroupGrant(user: UserRow, id: string, permission: 'view' | 'edit') {
  const grant = getGroupGrant(id);
  if (!grant || grant.owner_id !== user.id) throw notFound('Diese Freigabe gibt es nicht mehr');
  run('UPDATE group_grants SET permission = ? WHERE id = ?', permission, id);
  publish(memberIds(grant.group_id), 'change', { folders: [grant.node_id] });
  return getGroupGrant(id)!;
}

export function removeGroupGrant(user: UserRow, id: string) {
  const grant = getGroupGrant(id);
  if (!grant || grant.owner_id !== user.id) throw notFound('Diese Freigabe gibt es nicht mehr');
  run('DELETE FROM group_grants WHERE id = ?', id);
  const node = getNode(grant.node_id);
  const group = getGroup(grant.group_id);
  if (node) {
    record({
      owner: grant.owner_id,
      actor: user.id,
      node: node.id,
      parent: node.parent_id,
      action: 'unshare_group',
      name: node.name,
      details: { with: group?.name ?? '' },
    });
  }
  publish([...memberIds(grant.group_id), grant.owner_id], 'change', { folders: [grant.node_id], shared: true });
}

export const groupGrantsForNode = (nodeId: string) =>
  all<GroupGrantRow>('SELECT * FROM group_grants WHERE node_id = ? ORDER BY created_at', nodeId);

export function presentGroupGrant(grant: GroupGrantRow) {
  const group = getGroup(grant.group_id);
  return {
    id: grant.id,
    nodeId: grant.node_id,
    permission: grant.permission,
    createdAt: grant.created_at,
    user: null,
    group: group ? { id: group.id, name: group.name, members: memberCount(group.id) } : null,
  };
}

export function sharedWithMeViaGroups(user: UserRow) {
  return all<GroupGrantRow & { group_name: string }>(
    `SELECT gg.*, g.name AS group_name FROM group_grants gg
     JOIN group_members m ON m.group_id = gg.group_id
     JOIN groups g ON g.id = gg.group_id
     WHERE m.user_id = ? AND gg.owner_id != ? ORDER BY gg.created_at DESC`,
    user.id,
    user.id
  )
    .map((grant) => ({ grant, node: getNode(grant.node_id) }))
    .filter((entry): entry is { grant: GroupGrantRow & { group_name: string }; node: NodeRow } =>
      Boolean(entry.node && !entry.node.trashed_at)
    );
}

export const groupSharesBy = (user: UserRow) =>
  all<GroupGrantRow>('SELECT * FROM group_grants WHERE owner_id = ? ORDER BY created_at DESC', user.id);
