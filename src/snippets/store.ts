import { hashPassword, randomId, verifyPassword } from '../lib/crypto.ts';
import { all, one, run } from '../lib/db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { appEnabled } from '../services/apps.ts';
import * as settings from '../services/settings.ts';
import { getUser, inactive, type UserRow } from '../services/users.ts';

export interface SnippetRow {
  id: string;
  user_id: number;
  token: string;
  title: string;
  language: string;
  content: string;
  password_hash: string | null;
  shared: number;
  burn: number;
  expires_at: number | null;
  views: number;
  viewed_at: number | null;
  created_at: number;
  updated_at: number;
}

export const MAX_SNIPPET = 512 * 1024;
export const MAX_SNIPPETS = 5000;

export const LANGUAGES = [
  'auto',
  'text',
  'markdown',
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'scss',
  'python',
  'bash',
  'powershell',
  'sql',
  'yaml',
  'ini',
  'dockerfile',
  'nginx',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'lua',
  'diff',
  'xml',
] as const;

export type Language = (typeof LANGUAGES)[number];

const changed = (userId: number, data: Record<string, unknown>) => publish([userId], 'snippets', data);

const lineCount = (text: string) => (text ? text.replace(/\n$/, '').split('\n').length : 0);

function linkActive(row: SnippetRow) {
  return Boolean(row.shared) && (!row.expires_at || row.expires_at > Date.now());
}

export function presentSnippet(row: SnippetRow, base: string, full = false) {
  const preview = row.content.split('\n').slice(0, 6).join('\n').slice(0, 400);
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    ...(full ? { content: row.content } : { preview }),
    size: Buffer.byteLength(row.content),
    lines: lineCount(row.content),
    shared: linkActive(row),
    link: linkActive(row) ? `${base}/t/${row.token}` : null,
    protected: Boolean(row.password_hash),
    burn: Boolean(row.burn),
    expiresAt: row.expires_at,
    views: row.views,
    viewedAt: row.viewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function requireSnippet(user: Pick<UserRow, 'id'>, id: string) {
  const row = one<SnippetRow>('SELECT * FROM snippets WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) throw notFound('Diesen Schnipsel gibt es nicht');
  return row;
}

const like = (text: string) => `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;

export function listSnippets(user: Pick<UserRow, 'id'>, query: { q?: string; shared?: boolean } = {}) {
  const where = ['user_id = ?'];
  const params: (string | number)[] = [user.id];
  if (query.q?.trim()) {
    where.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
    params.push(like(query.q.trim()), like(query.q.trim()));
  }
  if (query.shared) {
    where.push('shared = 1 AND (expires_at IS NULL OR expires_at > ?)');
    params.push(Date.now());
  }
  return all<SnippetRow>(`SELECT * FROM snippets WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, ...params);
}

export interface SnippetInput {
  title: string;
  language: Language;
  content: string;
}

function checkContent(content: string) {
  if (!content.trim()) throw badRequest('Der Schnipsel ist leer');
  if (Buffer.byteLength(content) > MAX_SNIPPET) throw badRequest('Ein Schnipsel darf höchstens 512 KB groß sein');
}

export function createSnippet(user: Pick<UserRow, 'id'>, input: SnippetInput) {
  checkContent(input.content);
  if ((one<{ count: number }>('SELECT COUNT(*) AS count FROM snippets WHERE user_id = ?', user.id)?.count ?? 0) >= MAX_SNIPPETS) {
    throw badRequest('Du hast schon {count} Schnipsel, mehr gehen nicht', { count: MAX_SNIPPETS });
  }
  const now = Date.now();
  const id = randomId();
  run(
    `INSERT INTO snippets (id, user_id, token, title, language, content, shared, burn, views, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
    id,
    user.id,
    randomId(22),
    input.title.trim().slice(0, 200),
    input.language,
    input.content,
    now,
    now
  );
  changed(user.id, { type: 'created', id });
  return requireSnippet(user, id);
}

export function updateSnippet(user: Pick<UserRow, 'id'>, id: string, patch: Partial<SnippetInput>) {
  const row = requireSnippet(user, id);
  if (patch.content !== undefined) checkContent(patch.content);
  run(
    'UPDATE snippets SET title = ?, language = ?, content = ?, updated_at = ? WHERE id = ?',
    patch.title !== undefined ? patch.title.trim().slice(0, 200) : row.title,
    patch.language ?? row.language,
    patch.content ?? row.content,
    Date.now(),
    id
  );
  changed(user.id, { type: 'updated', id });
  return requireSnippet(user, id);
}

export function removeSnippet(user: Pick<UserRow, 'id'>, id: string) {
  requireSnippet(user, id);
  run('DELETE FROM snippets WHERE id = ?', id);
  changed(user.id, { type: 'removed', id });
}

export interface ShareInput {
  shared: boolean;
  password?: string | null;
  expiresAt?: number | null;
  burn?: boolean;
  renew?: boolean;
}

function expiry(input: number | null | undefined, current: number | null) {
  const maxDays = settings.get('share.maxDays');
  const limit = maxDays > 0 ? Date.now() + maxDays * 86_400_000 : null;
  const wanted = input === undefined ? current : input;
  if (wanted === null || wanted === undefined) return limit;
  if (wanted <= Date.now()) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
  return limit ? Math.min(wanted, limit) : wanted;
}

export async function shareSnippet(user: Pick<UserRow, 'id'>, id: string, input: ShareInput) {
  const row = requireSnippet(user, id);
  if (!input.shared) {
    run('UPDATE snippets SET shared = 0, updated_at = ? WHERE id = ?', Date.now(), id);
    changed(user.id, { type: 'updated', id });
    return requireSnippet(user, id);
  }
  let passwordHash = row.password_hash;
  if (input.password === null || input.password === '') passwordHash = null;
  else if (input.password !== undefined) {
    if (input.password.length < 4) throw badRequest('Das Passwort braucht mindestens 4 Zeichen');
    passwordHash = await hashPassword(input.password);
  }
  if (settings.get('share.requirePassword') && !passwordHash) throw badRequest('Links brauchen auf diesem Server ein Passwort');
  run(
    'UPDATE snippets SET shared = 1, token = ?, password_hash = ?, burn = ?, expires_at = ?, updated_at = ? WHERE id = ?',
    input.renew ? randomId(22) : row.token,
    passwordHash,
    input.burn === undefined ? row.burn : input.burn ? 1 : 0,
    expiry(input.expiresAt, row.shared ? row.expires_at : null),
    Date.now(),
    id
  );
  changed(user.id, { type: 'updated', id });
  return requireSnippet(user, id);
}

function liveRow(token: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const row = one<SnippetRow>('SELECT * FROM snippets WHERE token = ?', token);
  if (!row || !linkActive(row) || !appEnabled('snippets')) return null;
  const owner = getUser(row.user_id);
  if (!owner || inactive(owner)) return null;
  return { row, owner };
}

export function publicSnippet(token: string) {
  const found = liveRow(token);
  if (!found) throw notFound('Diesen Schnipsel gibt es nicht oder nicht mehr');
  const { row, owner } = found;
  const hidden = Boolean(row.password_hash) || Boolean(row.burn);
  if (!hidden) run('UPDATE snippets SET views = views + 1, viewed_at = ? WHERE id = ?', Date.now(), row.id);
  return {
    snippet: {
      title: row.title,
      language: row.language,
      size: Buffer.byteLength(row.content),
      lines: lineCount(row.content),
      protected: Boolean(row.password_hash),
      burn: Boolean(row.burn),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      by: owner.name || owner.username,
      ...(hidden ? {} : { content: row.content }),
    },
  };
}

export async function revealSnippet(token: string, password: string | undefined) {
  const found = liveRow(token);
  if (!found) throw notFound('Diesen Schnipsel gibt es nicht oder nicht mehr');
  const { row } = found;
  if (row.password_hash && !(await verifyPassword(row.password_hash, password ?? ''))) {
    throw new HttpError(403, 'Das Passwort stimmt nicht', 'wrong_password');
  }
  if (row.burn) {
    const removed = run('DELETE FROM snippets WHERE id = ? AND burn = 1', row.id).changes;
    if (!removed) throw notFound('Diesen Schnipsel gibt es nicht oder nicht mehr');
    changed(row.user_id, { type: 'burned', id: row.id, title: row.title });
  } else {
    run('UPDATE snippets SET views = views + 1, viewed_at = ? WHERE id = ?', Date.now(), row.id);
  }
  return { content: row.content, burned: Boolean(row.burn) };
}

export function rawSnippet(token: string) {
  const found = liveRow(token);
  if (!found || found.row.password_hash || found.row.burn) return null;
  run('UPDATE snippets SET views = views + 1, viewed_at = ? WHERE id = ?', Date.now(), found.row.id);
  return found.row;
}

export function snippetPageInfo(token: string) {
  const found = liveRow(token);
  return found ? { title: found.row.title } : null;
}

export function expireSnippets() {
  return run('UPDATE snippets SET shared = 0 WHERE shared = 1 AND expires_at IS NOT NULL AND expires_at <= ?', Date.now()).changes;
}

export function searchSnippets(user: Pick<UserRow, 'id'>, query: string, limit = 6) {
  return listSnippets(user, { q: query }).slice(0, limit);
}

const EXTENSIONS: Record<string, string> = {
  text: 'txt',
  auto: 'txt',
  markdown: 'md',
  javascript: 'js',
  typescript: 'ts',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  python: 'py',
  bash: 'sh',
  powershell: 'ps1',
  sql: 'sql',
  yaml: 'yaml',
  ini: 'ini',
  dockerfile: 'Dockerfile',
  nginx: 'conf',
  go: 'go',
  rust: 'rs',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  php: 'php',
  ruby: 'rb',
  lua: 'lua',
  diff: 'diff',
  xml: 'xml',
};

export function snippetFileName(row: Pick<SnippetRow, 'title' | 'language'>, fallback: string) {
  const extension = EXTENSIONS[row.language] ?? 'txt';
  const base =
    row.title
      .replace(/[\\/\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120) || fallback;
  if (extension === 'Dockerfile') return base.toLowerCase() === 'dockerfile' ? 'Dockerfile' : `${base}.Dockerfile`;
  return new RegExp(`\\.${extension}$`, 'i').test(base) ? base : `${base}.${extension}`;
}
