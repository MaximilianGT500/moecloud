import { run, tx } from '../lib/db.ts';
import { uniqueName } from '../lib/names.ts';
import { insertNode, taken } from './nodes.ts';
import type { UserRow } from './users.ts';

const SUBTREE = `WITH RECURSIVE tree(id) AS (
  SELECT CAST(? AS TEXT) COLLATE BINARY
  UNION ALL
  SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id
)`;

export function transferFiles(from: UserRow, to: UserRow, folderName: string) {
  return tx(() => {
    const name = uniqueName(folderName, true, taken(to.root_id));
    const folder = insertNode({ ownerId: to.id, parentId: to.root_id, type: 'folder', name, actorId: to.id });
    run('UPDATE nodes SET parent_id = ? WHERE parent_id = ? AND trashed_at IS NULL', folder.id, from.root_id);
    run(`${SUBTREE} UPDATE nodes SET owner_id = ? WHERE id IN (SELECT id FROM tree)`, folder.id, to.id);
    run(`${SUBTREE} DELETE FROM grants WHERE user_id = ? AND node_id IN (SELECT id FROM tree)`, folder.id, to.id);
    run(`${SUBTREE} UPDATE grants SET owner_id = ?, created_by = ? WHERE node_id IN (SELECT id FROM tree)`, folder.id, to.id, to.id);
    run(`${SUBTREE} UPDATE group_grants SET owner_id = ?, created_by = ? WHERE node_id IN (SELECT id FROM tree)`, folder.id, to.id, to.id);
    run(`${SUBTREE} UPDATE links SET owner_id = ?, created_by = ? WHERE node_id IN (SELECT id FROM tree)`, folder.id, to.id, to.id);
    return folder;
  });
}
