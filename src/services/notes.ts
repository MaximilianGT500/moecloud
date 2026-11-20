import { open } from 'node:fs/promises';
import { HttpError, badRequest, forbidden, tooLarge } from '../lib/errors.ts';
import { t } from '../lib/i18n.ts';
import { cleanName, splitName, uniqueName } from '../lib/names.ts';
import { record } from './activity.ts';
import { blobPath } from './blobs.ts';
import { ingestBuffer } from './ingest.ts';
import {
  assertSpace,
  createFolder,
  findChild,
  getNode,
  present,
  requireAccess,
  resolveAccess,
  subtree,
  taken,
  type NodeRow,
  type Presented,
} from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import { createTextFile, formatBytes } from './uploads.ts';
import { preferredLanguage, prefsOf, updatePrefs, type UserRow } from './users.ts';
import { lastVersionAt, SESSION_GAP, writeContent } from './versions.ts';

export const MAX_NOTES = 2000;
export const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_DEPTH = 3;
const HEAD = 1024;
const EXCERPT = 180;
const EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const FOLDER_NAMES = ['Notizen', 'Notes'];

export interface NoteView extends Presented {
  title: string;
  excerpt: string;
  category: string;
}

const isNote = (node: Pick<NodeRow, 'type' | 'name'>) => node.type === 'file' && EXTENSIONS.has(splitName(node.name)[1].toLowerCase());

const excerpts = new Map<string, string>();

function plain(text: string) {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}|>+)\s*/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
        .replace(/[*_`~]/g, '')
        .trim()
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

async function excerptOf(node: NodeRow) {
  if (!node.sha256 || node.size === 0) return '';
  const known = excerpts.get(node.sha256);
  if (known !== undefined) return known;
  let text = '';
  try {
    const handle = await open(blobPath(node.sha256), 'r');
    try {
      const buffer = Buffer.alloc(Math.min(HEAD, node.size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      text = plain(buffer.subarray(0, bytesRead).toString('utf8').replace(/�+$/, ''));
    } finally {
      await handle.close();
    }
  } catch {
    text = '';
  }
  const excerpt = [...text].slice(0, EXCERPT).join('');
  if (excerpts.size > 5000) excerpts.clear();
  excerpts.set(node.sha256, excerpt);
  return excerpt;
}

function assertOwnSpace(user: UserRow) {
  if (user.role === 'guest') throw forbidden('Gastkonten haben keine eigenen Notizen');
}

export function notesFolder(user: UserRow, create: boolean): NodeRow | null {
  if (user.role === 'guest') return null;
  const saved = prefsOf(user).notes;
  const known = saved ? getNode(saved) : undefined;
  if (known && known.owner_id === user.id && known.type === 'folder' && known.trashed_at === null) return known;
  const lang = preferredLanguage(user);
  const wanted = t(lang, 'Notizen');
  for (const name of [wanted, ...FOLDER_NAMES]) {
    const found = findChild(user.root_id, name);
    if (found && found.type === 'folder') {
      updatePrefs(user.id, { notes: found.id });
      return found;
    }
  }
  if (!create) return null;
  const folder = createFolder(user, user.root_id, uniqueName(wanted, true, taken(user.root_id)));
  updatePrefs(user.id, { notes: folder.id });
  return folder;
}

async function show(user: UserRow, node: NodeRow, category: string): Promise<NoteView> {
  const [item] = present([node], user, resolveAccess(user, node.id)?.role ?? 'view');
  return { ...item, title: splitName(node.name)[0], excerpt: await excerptOf(node), category };
}

export async function listNotes(user: UserRow) {
  const folder = notesFolder(user, false);
  if (!folder) return { folderId: null, items: [] as NoteView[], more: false };
  const paths = new Map<string, { path: string; depth: number }>([[folder.id, { path: '', depth: 0 }]]);
  const files: { node: NodeRow; category: string }[] = [];
  for (const node of subtree(folder.id)) {
    if (node.id === folder.id || !node.parent_id) continue;
    const parent = paths.get(node.parent_id);
    if (!parent) continue;
    if (node.type === 'folder') {
      if (parent.depth < MAX_DEPTH)
        paths.set(node.id, { path: parent.path ? `${parent.path}/${node.name}` : node.name, depth: parent.depth + 1 });
    } else if (isNote(node) && node.size <= MAX_NOTE_BYTES) {
      files.push({ node, category: parent.path });
    }
  }
  files.sort((a, b) => b.node.modified_at - a.node.modified_at || b.node.seq - a.node.seq);
  const page = files.slice(0, MAX_NOTES);
  const role = () => 'owner' as const;
  const shown = present(
    page.map((entry) => entry.node),
    user,
    role
  );
  const items: NoteView[] = [];
  for (const [index, entry] of page.entries()) {
    items.push({ ...shown[index], title: splitName(entry.node.name)[0], excerpt: await excerptOf(entry.node), category: entry.category });
  }
  return { folderId: folder.id, items, more: files.length > page.length };
}

function categoryFolder(user: UserRow, base: NodeRow, raw: string | undefined) {
  const parts = (raw ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > MAX_DEPTH) throw badRequest('Kategorien gehen höchstens {count} Ebenen tief', { count: MAX_DEPTH });
  let current = base;
  for (const part of parts) {
    const name = cleanName(part);
    const found = findChild(current.id, name);
    if (found && found.type !== 'folder') throw badRequest('„{name}“ ist eine Datei und kann keine Kategorie sein', { name });
    current = found ?? createFolder(user, current.id, name);
  }
  return { folder: current, category: parts.join('/') };
}

export async function createNote(user: UserRow, input: { title?: string; content?: string; category?: string }) {
  assertOwnSpace(user);
  const base = notesFolder(user, true)!;
  const { folder, category } = categoryFolder(user, base, input.category);
  const content = input.content ?? '';
  if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) throw tooBig();
  const title = cleanName(input.title?.trim() || t(preferredLanguage(user), 'Neue Notiz'));
  const node = await createTextFile(user, folder.id, uniqueName(`${title}.md`, false, taken(folder.id)), content);
  return show(user, node, category);
}

const tooBig = () => tooLarge('Notizen dürfen höchstens {size} groß sein', { size: formatBytes(MAX_NOTE_BYTES) });

function noteNode(user: UserRow, id: string, permission: 'view' | 'edit') {
  const access = requireAccess(user, id, permission);
  if (!isNote(access.node)) throw badRequest('Das ist keine Notiz. Notizen sind Textdateien mit der Endung .md oder .txt');
  if (access.node.size > MAX_NOTE_BYTES) throw tooBig();
  return access;
}

function categoryOf(user: UserRow, node: NodeRow) {
  const folder = notesFolder(user, false);
  if (!folder) return '';
  const parts: string[] = [];
  let current = node.parent_id ? getNode(node.parent_id) : undefined;
  for (let depth = 0; current && depth <= MAX_DEPTH; depth++) {
    if (current.id === folder.id) return parts.reverse().join('/');
    parts.push(current.name);
    current = current.parent_id ? getNode(current.parent_id) : undefined;
  }
  return '';
}

export async function readNote(user: UserRow, id: string) {
  const { node } = noteNode(user, id, 'view');
  if (node.sha256) assertNotInfected(node.sha256);
  let content = '';
  if (node.sha256 && node.size > 0) {
    const handle = await open(blobPath(node.sha256), 'r');
    try {
      content = (await handle.readFile()).toString('utf8').replace(/^﻿/, '');
    } finally {
      await handle.close();
    }
  }
  return { note: await show(user, node, categoryOf(user, node)), content, base: node.sha256 ?? '' };
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/;
const MAX_TASK_NOTES = 400;

async function textOf(node: NodeRow) {
  if (!node.sha256 || node.size === 0) return '';
  const handle = await open(blobPath(node.sha256), 'r');
  try {
    return (await handle.readFile()).toString('utf8').replace(/^\uFEFF/, '');
  } finally {
    await handle.close();
  }
}

export interface NoteTask {
  line: number;
  text: string;
  done: boolean;
}

export async function listTasks(user: UserRow) {
  const { items } = await listNotes(user);
  const notes: { id: string; title: string; category: string; modifiedAt: number; base: string; tasks: NoteTask[] }[] = [];
  let open = 0;
  let done = 0;
  for (const item of items.slice(0, MAX_TASK_NOTES)) {
    const node = getNode(item.id);
    if (!node || node.trashed_at !== null) continue;
    let text = '';
    try {
      if (node.sha256) assertNotInfected(node.sha256);
      text = await textOf(node);
    } catch {
      continue;
    }
    if (!text.includes('[')) continue;
    const tasks: NoteTask[] = [];
    let fenced = false;
    for (const [line, raw] of text.split('\n').entries()) {
      if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
      if (fenced) continue;
      const match = TASK.exec(raw.replace(/\r$/, ''));
      if (!match) continue;
      const isDone = match[2] !== ' ';
      tasks.push({ line, text: match[3].trim().slice(0, 300), done: isDone });
      if (isDone) done++;
      else open++;
    }
    if (tasks.length) {
      notes.push({ id: item.id, title: item.title, category: item.category, modifiedAt: item.modifiedAt, base: node.sha256 ?? '', tasks });
    }
  }
  return { notes, open, done, more: items.length > MAX_TASK_NOTES };
}

export async function toggleNoteTask(user: UserRow, id: string, line: number, expected: string) {
  const { node } = noteNode(user, id, 'edit');
  if (node.sha256) assertNotInfected(node.sha256);
  const lines = (await textOf(node)).split('\n');
  const current = lines[line];
  const match = current === undefined ? null : TASK.exec(current.replace(/\r$/, ''));
  if (!match || match[3].trim().slice(0, 300) !== expected) {
    throw new HttpError(409, 'Die Notiz hat sich geändert. Die Aufgaben wurden neu geladen', 'note_conflict');
  }
  const ending = current.endsWith('\r') ? '\r' : '';
  lines[line] = `${match[1]}[${match[2] === ' ' ? 'x' : ' '}] ${match[3]}${ending}`;
  const saved = await saveNote(user, id, lines.join('\n'), node.sha256 ?? '');
  return { note: saved.note, base: saved.base, done: match[2] === ' ' };
}

export async function saveNote(user: UserRow, id: string, content: string, base: string | undefined) {
  const { node } = noteNode(user, id, 'edit');
  if (base !== undefined && base !== (node.sha256 ?? '')) {
    throw new HttpError(409, 'Die Notiz wurde inzwischen an anderer Stelle geändert', 'note_conflict');
  }
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.length > MAX_NOTE_BYTES) throw tooBig();
  assertSpace(node.owner_id, buffer.length - node.size, user.id);
  const sha256 = await ingestBuffer(buffer, { userId: user.id, name: node.name, via: 'editor' });
  if (sha256 === node.sha256) return { note: await show(user, node, categoryOf(user, node)), base: sha256 };
  const now = Date.now();
  const settled =
    node.updated_by !== user.id || now - node.updated_at >= SESSION_GAP || now - (lastVersionAt(node.id) ?? node.created_at) >= SESSION_GAP;
  const updated = writeContent(node, { sha256, size: buffer.length }, user.id, { version: settled });
  if (settled) record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'edit', name: node.name });
  return { note: await show(user, updated, categoryOf(user, updated)), base: sha256 };
}
