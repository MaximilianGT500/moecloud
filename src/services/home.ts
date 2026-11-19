import { all } from '../lib/db.ts';
import { sharedWithMe } from './grants.ts';
import { sharedWithMeViaGroups } from './groups.ts';
import { memories } from './library.ts';
import { present, recent, resolveAccess, starred, teamOwners, type NodeRow } from './nodes.ts';
import { listReminders } from './reminders.ts';
import { presentTeam, teamsFor } from './teams.ts';
import { storageOf, type UserRow } from './users.ts';

const RECENT = 10;

export function homeFor(user: UserRow, date: string, offset: number) {
  const guest = user.role === 'guest';
  const owners = teamOwners(user);
  const fromTeams = owners.length
    ? all<NodeRow>(
        `SELECT * FROM nodes WHERE owner_id IN (${owners.map(() => '?').join(', ')}) AND type = 'file' AND trashed_at IS NULL
         ORDER BY updated_at DESC LIMIT ${RECENT}`,
        ...owners
      )
    : [];
  const latest = [...(guest ? [] : recent(user).slice(0, RECENT)), ...fromTeams]
    .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
    .slice(0, RECENT);
  const roleOf = (node: NodeRow) => (node.owner_id === user.id ? 'owner' : (resolveAccess(user, node.id)?.role ?? 'view'));
  const direct = sharedWithMe(user);
  const viaGroups = sharedWithMeViaGroups(user).filter((entry) => !direct.some((other) => other.node.id === entry.node.id));
  const shares = [...direct, ...viaGroups]
    .filter((entry, index, list) => entry.node.parent_id !== null && list.findIndex((other) => other.node.id === entry.node.id) === index)
    .sort((a, b) => Number(b.grant.created_at) - Number(a.grant.created_at))
    .slice(0, 6)
    .map((entry) => entry.node);
  const groups = guest ? [] : memories(user, date, offset);
  return {
    name: user.name,
    guest,
    recent: present(latest, user, roleOf),
    starred: present(starred(user).slice(0, 8), user, roleOf),
    shared: present(shares, user, roleOf),
    teams: teamsFor(user).map((team) => presentTeam(team, user)),
    reminders: listReminders(user).slice(0, 5),
    memories: groups.slice(0, 2).map((group) => ({ year: group.year, items: present(group.nodes.slice(0, 6), user) })),
    storage: storageOf(user),
  };
}
