import { z } from 'zod';
import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { splitName, uniqueName } from '../lib/names.ts';
import { onArrival } from './activity.ts';
import { CONVERT_FORMATS, convertNode, convertOptions } from './convert.ts';
import { addToAlbum, getAlbum, ownAlbum } from './albums.ts';
import {
  chain,
  copy,
  ensurePath,
  findChild,
  getNode,
  move,
  rename,
  requireFolder,
  resolveAccess,
  setStar,
  subtree,
  taken,
  type NodeRow,
} from './nodes.ts';
import { notify } from './notify.ts';
import { applyTags, ownTag } from './tags.ts';
import { getUser, inactive, type UserRow } from './users.ts';

export const KINDS = ['image', 'video', 'audio', 'pdf', 'document', 'archive', 'other'] as const;
type Kind = (typeof KINDS)[number];

const id = z.string().regex(/^[0-9A-Za-z]{8,40}$/);

export const conditionsSchema = z.object({
  kinds: z.array(z.enum(KINDS)).max(KINDS.length).default([]),
  extensions: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]{1,12}$/, 'Dateiendungen bestehen aus Buchstaben und Ziffern, etwa pdf')
    )
    .max(20)
    .default([]),
  nameContains: z.string().trim().max(80).default(''),
  minSize: z.number().int().min(0).nullable().default(null),
  maxSize: z.number().int().min(0).nullable().default(null),
});

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag'), tagId: id }),
  z.object({ type: z.literal('move'), folderId: id, by: z.enum(['none', 'year', 'month']).default('none') }),
  z.object({
    type: z.literal('rename'),
    pattern: z
      .string()
      .trim()
      .min(1, 'Gib ein Muster für den Namen an')
      .max(120)
      .refine((value) => value.includes('{name}') || value.includes('{nummer}'), 'Das Muster braucht {name} oder {nummer}'),
  }),
  z.object({ type: z.literal('star') }),
  z.object({ type: z.literal('notify') }),
  z.object({ type: z.literal('convert'), format: z.enum(CONVERT_FORMATS) }),
  z.object({ type: z.literal('copy'), folderId: id }),
  z.object({ type: z.literal('album'), albumId: id }),
]);

export const actionsSchema = z.array(actionSchema).min(1, 'Wähle mindestens eine Aktion').max(8);

export type Conditions = z.infer<typeof conditionsSchema>;
export type Action = z.infer<typeof actionSchema>;

export interface AutomationRow {
  id: string;
  user_id: number;
  node_id: string;
  name: string;
  deep: number;
  conditions: string;
  actions: string;
  enabled: number;
  runs: number;
  run_at: number | null;
  error: string | null;
  created_at: number;
}

const MAX_PER_USER = 50;
const MAX_BATCH = 500;

const DOCUMENTS = /\.(docx?|odt|rtf|txt|md|xlsx?|ods|csv|pptx?|odp|pages|numbers|key)$/i;
const ARCHIVES = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i;

function kindOf(node: Pick<NodeRow, 'mime' | 'name'>): Kind {
  const mime = node.mime ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (ARCHIVES.test(node.name)) return 'archive';
  if (DOCUMENTS.test(node.name) || mime.startsWith('text/')) return 'document';
  return 'other';
}

function parseJson<T>(schema: z.ZodType<T>, text: string, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

const conditionsOf = (row: AutomationRow) =>
  parseJson(conditionsSchema, row.conditions, { kinds: [], extensions: [], nameContains: '', minSize: null, maxSize: null });
const actionsOf = (row: AutomationRow) => parseJson(z.array(actionSchema), row.actions, []);

export function matches(conditions: Conditions, node: Pick<NodeRow, 'name' | 'mime' | 'size' | 'type'>) {
  if (node.type !== 'file') return false;
  if (conditions.kinds.length && !conditions.kinds.includes(kindOf(node))) return false;
  if (conditions.extensions.length) {
    const extension = splitName(node.name)[1].slice(1).toLowerCase();
    if (!conditions.extensions.includes(extension)) return false;
  }
  if (conditions.nameContains && !node.name.toLowerCase().includes(conditions.nameContains.toLowerCase())) return false;
  if (conditions.minSize !== null && node.size < conditions.minSize) return false;
  if (conditions.maxSize !== null && node.size > conditions.maxSize) return false;
  return true;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function renamed(pattern: string, name: string, at: number, counter: number) {
  const [base, extension] = splitName(name);
  const date = new Date(at);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const filled = pattern
    .replaceAll('{name}', base)
    .replaceAll('{datum}', day)
    .replaceAll('{date}', day)
    .replaceAll('{jahr}', String(date.getFullYear()))
    .replaceAll('{monat}', pad(date.getMonth() + 1))
    .replaceAll('{tag}', pad(date.getDate()))
    .replaceAll('{zeit}', `${pad(date.getHours())}-${pad(date.getMinutes())}`)
    .replaceAll('{nummer}', String(counter).padStart(3, '0'));
  return `${filled}${extension}`;
}

function checkTargets(user: UserRow, folder: NodeRow, actions: Action[], deep: boolean) {
  for (const action of actions) {
    if (action.type === 'tag') ownTag(user, action.tagId);
    if (action.type === 'move') {
      const target = requireFolder(user, action.folderId, 'edit').node;
      if (target.owner_id !== folder.owner_id) throw badRequest('Der Zielordner muss im selben Bereich liegen wie der Ordner des Ablaufs');
      if (target.id === folder.id && action.by === 'none')
        throw badRequest('Der Zielordner ist der Ordner selbst. Wähl einen anderen oder sortier nach Datum');
    }
    if (action.type === 'copy') {
      const target = requireFolder(user, action.folderId, 'edit').node;
      if (target.id === folder.id) throw badRequest('Die Kopie braucht einen anderen Ordner als den des Ablaufs');
      if (deep && chain(target.id).some((entry) => entry.id === folder.id)) {
        throw badRequest('Die Kopie darf nicht in einem Unterordner landen, wenn der Ablauf auch Unterordner beachtet');
      }
    }
    if (action.type === 'album') ownAlbum(user, action.albumId);
  }
}

export function present(row: AutomationRow) {
  const folder = getNode(row.node_id);
  const actions = actionsOf(row);
  return {
    id: row.id,
    name: row.name,
    folderId: row.node_id,
    folderName: folder?.name ?? '',
    deep: Boolean(row.deep),
    conditions: conditionsOf(row),
    actions: actions.map((action) =>
      action.type === 'move' || action.type === 'copy'
        ? { ...action, folderName: getNode(action.folderId)?.name ?? '' }
        : action.type === 'album'
          ? { ...action, albumName: getAlbum(action.albumId)?.name ?? '' }
          : action
    ),
    enabled: Boolean(row.enabled),
    runs: Number(row.runs),
    runAt: row.run_at === null ? null : Number(row.run_at),
    error: row.error,
    createdAt: Number(row.created_at),
  };
}

export const listAutomations = (user: UserRow, folderId?: string) =>
  all<AutomationRow>(
    `SELECT * FROM automations WHERE user_id = ? ${folderId ? 'AND node_id = ?' : ''} ORDER BY created_at`,
    ...(folderId ? [user.id, folderId] : [user.id])
  )
    .filter((row) => {
      const folder = getNode(row.node_id);
      return folder && !folder.trashed_at;
    })
    .map(present);

function own(user: UserRow, automationId: string) {
  const row = one<AutomationRow>('SELECT * FROM automations WHERE id = ? AND user_id = ?', automationId, user.id);
  if (!row) throw notFound('Diesen Ablauf gibt es nicht mehr');
  return row;
}

export interface AutomationInput {
  name: string;
  folderId: string;
  deep: boolean;
  conditions: Conditions;
  actions: Action[];
  enabled: boolean;
}

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw badRequest('Gib dem Ablauf einen Namen');
  if (trimmed.length > 80) throw badRequest('Der Name ist zu lang');
  return trimmed;
}

export function createAutomation(user: UserRow, input: AutomationInput) {
  const folder = requireFolder(user, input.folderId, 'edit').node;
  checkTargets(user, folder, input.actions, Boolean(input.deep));
  const count = one<{ count: number }>('SELECT COUNT(*) AS count FROM automations WHERE user_id = ?', user.id)?.count ?? 0;
  if (Number(count) >= MAX_PER_USER) throw badRequest('Mehr als {count} Abläufe gehen nicht', { count: MAX_PER_USER });
  const automationId = randomId();
  run(
    `INSERT INTO automations (id, user_id, node_id, name, deep, conditions, actions, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    automationId,
    user.id,
    folder.id,
    cleanName(input.name),
    input.deep,
    JSON.stringify(input.conditions),
    JSON.stringify(input.actions),
    input.enabled,
    Date.now()
  );
  return present(own(user, automationId));
}

export function updateAutomation(user: UserRow, automationId: string, input: Partial<Omit<AutomationInput, 'folderId'>>) {
  const row = own(user, automationId);
  const folder = requireFolder(user, row.node_id, 'edit').node;
  if (input.actions || input.deep !== undefined) {
    checkTargets(user, folder, input.actions ?? actionsOf(row), input.deep === undefined ? Boolean(row.deep) : Boolean(input.deep));
  }
  run(
    'UPDATE automations SET name = ?, deep = ?, conditions = ?, actions = ?, enabled = ?, error = NULL WHERE id = ?',
    input.name === undefined ? row.name : cleanName(input.name),
    input.deep === undefined ? row.deep : input.deep,
    input.conditions === undefined ? row.conditions : JSON.stringify(input.conditions),
    input.actions === undefined ? row.actions : JSON.stringify(input.actions),
    input.enabled === undefined ? row.enabled : input.enabled,
    row.id
  );
  return present(own(user, automationId));
}

export function deleteAutomation(user: UserRow, automationId: string) {
  run('DELETE FROM automations WHERE id = ?', own(user, automationId).id);
}

async function apply(row: AutomationRow, user: UserRow, nodeId: string, counter: number) {
  let node = getNode(nodeId);
  if (!node || node.trashed_at || !matches(conditionsOf(row), node)) return false;
  const done: string[] = [];
  for (const action of actionsOf(row)) {
    node = getNode(node.id)!;
    if (action.type === 'tag') {
      applyTags(user, [node.id], [action.tagId], []);
    } else if (action.type === 'star') {
      setStar(user, node.id, true);
    } else if (action.type === 'rename') {
      const wanted = renamed(action.pattern, node.name, Number(node.modified_at) || Date.now(), counter);
      if (wanted !== node.name) {
        const other = findChild(node.parent_id!, wanted);
        node = rename(user, node.id, other && other.id !== node.id ? uniqueName(wanted, false, taken(node.parent_id!)) : wanted);
      }
    } else if (action.type === 'move') {
      const target = requireFolder(user, action.folderId, 'edit').node;
      const date = new Date(Number(node.modified_at) || Date.now());
      const segments =
        action.by === 'year'
          ? [String(date.getFullYear())]
          : action.by === 'month'
            ? [String(date.getFullYear()), `${date.getFullYear()}-${pad(date.getMonth() + 1)}`]
            : [];
      const targetId = segments.length ? ensurePath(target.owner_id, user.id, target.id, segments) : target.id;
      if (node.parent_id !== targetId) move(user, [node.id], targetId);
    } else if (action.type === 'convert') {
      if (convertOptions(node).includes(action.format)) await convertNode(user, node.id, action.format);
    } else if (action.type === 'copy') {
      copy(user, [node.id], requireFolder(user, action.folderId, 'edit').node.id);
    } else if (action.type === 'album') {
      const kind = kindOf(node);
      if (kind === 'image' || kind === 'video') addToAlbum(user, action.albumId, [node.id]);
    } else if (action.type === 'notify') {
      done.push('notify');
    }
  }
  if (done.includes('notify')) {
    const current = getNode(node.id)!;
    notify(
      user.id,
      'automation',
      { rule: row.name, name: current.name },
      current.parent_id ? `/files/folder/${current.parent_id}?select=${current.id}` : '/files'
    );
  }
  return true;
}

function failed(row: AutomationRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  run('UPDATE automations SET error = ?, run_at = ? WHERE id = ?', message.slice(0, 300), Date.now(), row.id);
  log.info({ automation: row.id, error: message }, 'Ein Ablauf ist fehlgeschlagen');
}

function runner(row: AutomationRow) {
  const user = getUser(row.user_id);
  if (!user || inactive(user)) return null;
  const access = resolveAccess(user, row.node_id);
  if (!access || access.node.trashed_at || access.role === 'view') return null;
  return user;
}

let queue: Promise<void> = Promise.resolve();
const pending = new Set<string>();

export const settled = () => queue;

export function queueAutomations(nodeId: string | null | undefined, parentId: string | null | undefined) {
  if (!nodeId || !parentId || pending.has(nodeId)) return;
  const lineage = chain(parentId).map((entry) => entry.id);
  if (lineage.length === 0) return;
  const rows = all<AutomationRow>(
    `SELECT * FROM automations WHERE enabled = 1 AND node_id IN (${lineage.map(() => '?').join(', ')}) ORDER BY created_at`,
    ...lineage
  ).filter((row) => row.node_id === parentId || Boolean(row.deep));
  if (rows.length === 0) return;
  pending.add(nodeId);
  queue = queue.then(async () => {
    try {
      for (const row of rows) {
        const user = runner(row);
        if (!user) continue;
        try {
          const counter = Number(row.runs) + 1;
          if (await apply(row, user, nodeId, counter)) {
            run('UPDATE automations SET runs = runs + 1, run_at = ?, error = NULL WHERE id = ?', Date.now(), row.id);
            row.runs = counter;
          }
        } catch (error) {
          failed(row, error);
        }
      }
    } finally {
      pending.delete(nodeId);
    }
  });
}

export async function runAutomation(user: UserRow, automationId: string) {
  const row = own(user, automationId);
  if (!runner(row)) throw badRequest('Auf diesen Ordner hast du keinen Schreibzugriff mehr');
  const files = (
    row.deep
      ? subtree(row.node_id)
      : all<NodeRow>("SELECT * FROM nodes WHERE parent_id = ? AND trashed_at IS NULL AND type = 'file'", row.node_id)
  )
    .filter((node) => node.type === 'file')
    .slice(0, MAX_BATCH);
  let applied = 0;
  let counter = Number(row.runs);
  try {
    for (const file of files) {
      if (await apply(row, user, file.id, counter + 1)) {
        applied++;
        counter++;
      }
    }
    run('UPDATE automations SET runs = ?, run_at = ?, error = NULL WHERE id = ?', counter, Date.now(), row.id);
  } catch (error) {
    run('UPDATE automations SET runs = ? WHERE id = ?', counter, row.id);
    failed(row, error);
    throw error;
  }
  return { applied, checked: files.length, automation: present(own(user, automationId)) };
}

onArrival(queueAutomations);
