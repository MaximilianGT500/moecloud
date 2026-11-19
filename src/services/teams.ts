import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { nameKey as nodeKey } from '../lib/names.ts';
import { audit } from './audit.ts';
import { getGroup, memberIds } from './groups.ts';
import { destroy, emptyTrash, FOLDER_COLORS, getNode, present, restore, trashed } from './nodes.ts';
import { notify } from './notify.ts';
import { createUser, deleteUser, getUser, initials, isPerson, searchUsers, usageOf, type UserRow } from './users.ts';

export interface TeamRow {
  id: number;
  user_id: number;
  name: string;
  name_key: string;
  description: string | null;
  color: string | null;
  created_by: number | null;
  created_at: number;
}

export type TeamRole = 'view' | 'edit' | 'manage';
type Permission = 'view' | 'edit';

const nameKey = (name: string) => name.trim().toLocaleLowerCase('de');

export const getTeam = (id: number) => one<TeamRow>('SELECT * FROM teams WHERE id = ?', id);
export const teamOfAccount = (userId: number) => one<TeamRow>('SELECT * FROM teams WHERE user_id = ?', userId);
export const listTeams = () => all<TeamRow>('SELECT * FROM teams ORDER BY name COLLATE NOCASE');
export const teamAccounts = () => all<{ user_id: number }>('SELECT user_id FROM teams').map((row) => row.user_id);

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw badRequest('Gib dem Teamordner einen Namen');
  if (trimmed.length > 60) throw badRequest('Der Name ist zu lang');
  if (/[\\/]/.test(trimmed)) throw badRequest('Schrägstriche gehen im Namen nicht');
  return trimmed;
}

function cleanDescription(text: string | null | undefined) {
  const trimmed = (text ?? '').trim();
  if (trimmed.length > 500) throw badRequest('Die Beschreibung ist zu lang');
  return trimmed || null;
}

function cleanColor(color: string | null | undefined) {
  if (!color) return null;
  if (!(FOLDER_COLORS as readonly string[]).includes(color)) throw badRequest('Diese Farbe gibt es nicht');
  return color;
}

function cleanQuota(quota: number | null | undefined) {
  if (quota === null || quota === undefined) return 0;
  if (!Number.isFinite(quota) || quota < 0) throw badRequest('Der Speicher muss null oder größer sein');
  return Math.round(quota);
}

function account(team: TeamRow) {
  const user = getUser(team.user_id);
  if (!user) throw notFound('Diesen Teamordner gibt es nicht mehr');
  return user;
}

export function requireTeam(id: number) {
  const team = getTeam(id);
  if (!team) throw notFound('Diesen Teamordner gibt es nicht mehr');
  return team;
}

const isManager = (teamId: number, userId: number) =>
  Boolean(one('SELECT 1 FROM team_managers WHERE team_id = ? AND user_id = ?', teamId, userId));

export function roleIn(team: TeamRow, user: UserRow): TeamRole | null {
  const root = account(team).root_id;
  const now = Date.now();
  const rows = all<{ permission: Permission }>(
    `SELECT permission FROM grants WHERE node_id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)
     UNION ALL
     SELECT gg.permission FROM group_grants gg JOIN group_members m ON m.group_id = gg.group_id
     WHERE gg.node_id = ? AND m.user_id = ? AND (gg.expires_at IS NULL OR gg.expires_at > ?)`,
    root,
    user.id,
    now,
    root,
    user.id,
    now
  );
  if (rows.length === 0) return null;
  if (isManager(team.id, user.id)) return 'manage';
  return rows.some((row) => row.permission === 'edit') ? 'edit' : 'view';
}

export function requireManager(user: UserRow, id: number) {
  const team = requireTeam(id);
  if (user.role === 'admin') return team;
  const role = roleIn(team, user);
  if (role === null) throw notFound('Diesen Teamordner gibt es nicht mehr');
  if (role !== 'manage') throw forbidden('Das dürfen nur Admins und die Leitung dieses Teamordners');
  return team;
}

export function audienceOf(team: TeamRow): number[] {
  const root = account(team).root_id;
  const users = new Set<number>();
  for (const row of all<{ user_id: number }>('SELECT user_id FROM grants WHERE node_id = ?', root)) users.add(row.user_id);
  for (const row of all<{ group_id: number }>('SELECT group_id FROM group_grants WHERE node_id = ?', root)) {
    for (const userId of memberIds(row.group_id)) users.add(userId);
  }
  return [...users];
}

function memberRows(team: TeamRow) {
  const root = account(team).root_id;
  const people = all<{ user_id: number; permission: Permission; created_at: number }>(
    'SELECT user_id, permission, created_at FROM grants WHERE node_id = ? ORDER BY created_at',
    root
  );
  const groups = all<{ group_id: number; permission: Permission; created_at: number }>(
    'SELECT group_id, permission, created_at FROM group_grants WHERE node_id = ? ORDER BY created_at',
    root
  );
  return { people, groups };
}

export function presentMembers(team: TeamRow) {
  const { people, groups } = memberRows(team);
  return {
    people: people
      .map((row) => ({ row, user: getUser(row.user_id) }))
      .filter((entry): entry is { row: (typeof people)[number]; user: UserRow } => Boolean(entry.user))
      .map(({ row, user }) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        initials: initials(user.name),
        avatar: user.avatar,
        guest: user.role === 'guest',
        role: (isManager(team.id, user.id) ? 'manage' : row.permission) as TeamRole,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    groups: groups
      .map((row) => ({ row, group: getGroup(row.group_id) }))
      .filter((entry) => Boolean(entry.group))
      .map(({ row, group }) => ({ id: group!.id, name: group!.name, members: memberIds(group!.id).length, role: row.permission }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  };
}

export function presentTeam(team: TeamRow, viewer: UserRow, detailed = false) {
  const owner = account(team);
  const role = roleIn(team, viewer);
  const quota = Number(owner.quota_bytes ?? 0);
  const { people, groups } = memberRows(team);
  const canManage = viewer.role === 'admin' || role === 'manage';
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    color: team.color,
    rootId: owner.root_id,
    role,
    canManage,
    used: usageOf(owner.id),
    quota: quota > 0 ? quota : null,
    people: people.length,
    groups: groups.length,
    trash: canManage
      ? (value<number>('SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND trash_root = 1 AND trashed_at IS NOT NULL', owner.id) ?? 0)
      : undefined,
    createdAt: team.created_at,
    members: detailed && canManage ? presentMembers(team) : undefined,
  };
}

export const teamsFor = (user: UserRow) => listTeams().filter((team) => roleIn(team, user) !== null);

export function candidates(actor: UserRow, id: number, query: string) {
  const team = requireManager(actor, id);
  const { people, groups } = memberRows(team);
  const text = query.trim();
  const takenPeople = new Set(people.map((row) => Number(row.user_id)));
  const takenGroups = new Set(groups.map((row) => Number(row.group_id)));
  const like = `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return {
    people: text ? searchUsers(text, 0).filter((user) => !takenPeople.has(user.id)) : [],
    groups: all<{ id: number; name: string }>(
      "SELECT id, name FROM groups WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 20",
      like
    )
      .filter((group) => !takenGroups.has(Number(group.id)))
      .map((group) => ({ id: Number(group.id), name: group.name, members: memberIds(group.id).length })),
  };
}

export async function createTeam(
  admin: UserRow,
  input: { name: string; quota?: number | null; description?: string | null; color?: string | null }
) {
  const name = cleanName(input.name);
  if (one('SELECT 1 FROM teams WHERE name_key = ?', nameKey(name))) throw conflict('Einen Teamordner mit diesem Namen gibt es schon');
  const description = cleanDescription(input.description);
  const color = cleanColor(input.color);
  const owner = await createUser({ username: `~team-${randomId(10)}`, name, role: 'team', quota: cleanQuota(input.quota) });
  const id = tx(() => {
    run(
      'UPDATE nodes SET name = ?, name_key = ?, color = ?, description = ? WHERE id = ?',
      name,
      nodeKey(name),
      color,
      description,
      owner.root_id
    );
    return run(
      'INSERT INTO teams (user_id, name, name_key, description, color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      owner.id,
      name,
      nameKey(name),
      description,
      color,
      admin.id,
      Date.now()
    ).lastId;
  });
  audit('team_created', { actor: admin.id, details: { name } });
  return getTeam(id)!;
}

export function updateTeam(
  actor: UserRow,
  id: number,
  change: { name?: string; quota?: number | null; description?: string | null; color?: string | null }
) {
  const team = requireManager(actor, id);
  const owner = account(team);
  const adminOnly = change.name !== undefined || change.quota !== undefined;
  if (adminOnly && actor.role !== 'admin') throw forbidden('Namen und Speicher legen nur Admins fest');
  const name = change.name === undefined ? team.name : cleanName(change.name);
  if (name !== team.name) {
    const other = one<{ id: number }>('SELECT id FROM teams WHERE name_key = ?', nameKey(name));
    if (other && other.id !== team.id) throw conflict('Einen Teamordner mit diesem Namen gibt es schon');
  }
  const description = change.description === undefined ? team.description : cleanDescription(change.description);
  const color = change.color === undefined ? team.color : cleanColor(change.color);
  tx(() => {
    run(
      'UPDATE teams SET name = ?, name_key = ?, description = ?, color = ? WHERE id = ?',
      name,
      nameKey(name),
      description,
      color,
      team.id
    );
    run(
      'UPDATE nodes SET name = ?, name_key = ?, color = ?, description = ?, etag = etag + 1 WHERE id = ?',
      name,
      nodeKey(name),
      color,
      description,
      owner.root_id
    );
    run('UPDATE users SET name = ? WHERE id = ?', name, owner.id);
    if (change.quota !== undefined) run('UPDATE users SET quota_bytes = ? WHERE id = ?', cleanQuota(change.quota), owner.id);
  });
  audit('team_updated', {
    actor: actor.id,
    details: {
      name,
      before: name !== team.name ? team.name : undefined,
      quota: change.quota !== undefined ? cleanQuota(change.quota) : undefined,
    },
  });
  publish(audienceOf(team), 'change', { folders: [owner.root_id], shared: true, teams: true });
  return getTeam(team.id)!;
}

export function deleteTeam(admin: UserRow, id: number, confirm: string) {
  const team = requireTeam(id);
  if (nameKey(confirm) !== team.name_key) throw badRequest('Gib zur Bestätigung den Namen des Teamordners ein');
  const members = audienceOf(team);
  const files = value<number>("SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND type = 'file'", team.user_id) ?? 0;
  deleteUser(team.user_id);
  audit('team_deleted', { actor: admin.id, details: { name: team.name, files } });
  publish(members, 'change', { folders: [], shared: true, teams: true });
}

function setManager(teamId: number, userId: number, manager: boolean) {
  if (manager) run('INSERT OR IGNORE INTO team_managers (team_id, user_id, created_at) VALUES (?, ?, ?)', teamId, userId, Date.now());
  else run('DELETE FROM team_managers WHERE team_id = ? AND user_id = ?', teamId, userId);
}

export function setPerson(actor: UserRow, id: number, userId: number, role: TeamRole) {
  const team = requireManager(actor, id);
  const owner = account(team);
  const target = getUser(userId);
  if (!target || !isPerson(target)) throw notFound('Diese Person gibt es nicht');
  if (target.role === 'guest' && role === 'manage') throw badRequest('Gäste können einen Teamordner nicht leiten');
  const permission: Permission = role === 'view' ? 'view' : 'edit';
  const existing = one<{ id: string }>('SELECT id FROM grants WHERE node_id = ? AND user_id = ?', owner.root_id, target.id);
  tx(() => {
    if (existing) run('UPDATE grants SET permission = ?, expires_at = NULL WHERE id = ?', permission, existing.id);
    else {
      run(
        'INSERT INTO grants (id, node_id, owner_id, user_id, permission, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
        randomId(),
        owner.root_id,
        owner.id,
        target.id,
        permission,
        actor.id,
        Date.now()
      );
    }
    setManager(team.id, target.id, role === 'manage');
  });
  if (!existing) {
    audit('team_updated', { actor: actor.id, details: { name: team.name, added: [target.name] } });
    notify(target.id, 'team_added', { by: actor.name, name: team.name }, `/files/folder/${owner.root_id}`);
  }
  publish([target.id], 'change', { folders: [owner.root_id], shared: true, teams: true });
}

export function joinByInvite(teamId: number, user: UserRow, role: Permission, invitedBy: number | null) {
  const team = getTeam(teamId);
  const owner = team ? getUser(team.user_id) : undefined;
  if (!team || !owner) return;
  run(
    'INSERT INTO grants (id, node_id, owner_id, user_id, permission, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    randomId(),
    owner.root_id,
    owner.id,
    user.id,
    role,
    invitedBy ?? owner.id,
    Date.now()
  );
  audit('team_updated', { actor: invitedBy, subject: user.id, details: { name: team.name, added: [user.name] } });
}

export function removePerson(actor: UserRow, id: number, userId: number) {
  const team = requireManager(actor, id);
  const owner = account(team);
  const target = getUser(userId);
  const removed = run('DELETE FROM grants WHERE node_id = ? AND user_id = ?', owner.root_id, userId).changes;
  setManager(team.id, userId, false);
  if (removed && target) audit('team_updated', { actor: actor.id, details: { name: team.name, removed: [target.name] } });
  publish([userId], 'change', { folders: [owner.root_id], shared: true, teams: true });
}

export function setGroup(actor: UserRow, id: number, groupId: number, role: Permission) {
  const team = requireManager(actor, id);
  const owner = account(team);
  const group = getGroup(groupId);
  if (!group) throw notFound('Diese Gruppe gibt es nicht mehr');
  const existing = one<{ id: string }>('SELECT id FROM group_grants WHERE node_id = ? AND group_id = ?', owner.root_id, group.id);
  if (existing) run('UPDATE group_grants SET permission = ?, expires_at = NULL WHERE id = ?', role, existing.id);
  else {
    run(
      'INSERT INTO group_grants (id, node_id, owner_id, group_id, permission, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      randomId(),
      owner.root_id,
      owner.id,
      group.id,
      role,
      actor.id,
      Date.now()
    );
    audit('team_updated', { actor: actor.id, details: { name: team.name, added: [group.name] } });
  }
  publish(memberIds(group.id), 'change', { folders: [owner.root_id], shared: true, teams: true });
}

export function removeGroup(actor: UserRow, id: number, groupId: number) {
  const team = requireManager(actor, id);
  const owner = account(team);
  const group = getGroup(groupId);
  const removed = run('DELETE FROM group_grants WHERE node_id = ? AND group_id = ?', owner.root_id, groupId).changes;
  if (removed && group) audit('team_updated', { actor: actor.id, details: { name: team.name, removed: [group.name] } });
  publish(group ? memberIds(group.id) : [], 'change', { folders: [owner.root_id], shared: true, teams: true });
}

export function leaveTeam(user: UserRow, id: number) {
  const team = requireTeam(id);
  const owner = account(team);
  const removed = run('DELETE FROM grants WHERE node_id = ? AND user_id = ?', owner.root_id, user.id).changes;
  setManager(team.id, user.id, false);
  if (!removed) throw badRequest('Du bist über eine Gruppe in diesem Teamordner, daraus nimmt dich die Verwaltung');
  publish([user.id], 'change', { folders: [owner.root_id], shared: true, teams: true });
}

export function teamTrash(actor: UserRow, id: number) {
  const team = requireManager(actor, id);
  const owner = account(team);
  return present(trashed(owner), owner, 'owner');
}

export function restoreInTeam(actor: UserRow, id: number, ids: string[]) {
  const team = requireManager(actor, id);
  const restored = restore(account(team), ids, actor.id);
  publish([actor.id, ...audienceOf(team)], 'change', { folders: restored.map((node) => node.parent_id), teams: true });
  return restored.length;
}

export function destroyInTeam(actor: UserRow, id: number, ids: string[]) {
  const team = requireManager(actor, id);
  destroy(account(team), ids, actor.id);
  return ids.length;
}

export function emptyTeamTrash(actor: UserRow, id: number) {
  const team = requireManager(actor, id);
  return emptyTrash(account(team));
}

export function teamOfNode(nodeId: string) {
  const node = getNode(nodeId);
  return node ? teamOfAccount(node.owner_id) : undefined;
}
