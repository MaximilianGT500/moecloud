import { all, run, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { UserRow } from './users.ts';

interface SearchRow {
  id: string;
  user_id: number;
  name: string;
  query: string;
  created_at: number;
}

const KEYS = ['q', 'type', 'date', 'size', 'tag'];
const LIMIT = 50;

export function cleanQuery(input: string) {
  const params = new URLSearchParams(input.replace(/^\?/, ''));
  const clean = new URLSearchParams();
  for (const key of KEYS) {
    const entry = params.get(key)?.trim();
    if (entry) clean.set(key, entry.slice(0, 200));
  }
  return clean.toString();
}

const present = (row: SearchRow) => ({ id: row.id, name: row.name, query: row.query, createdAt: row.created_at });

export const listSearches = (user: UserRow) =>
  all<SearchRow>('SELECT * FROM searches WHERE user_id = ? ORDER BY name COLLATE NOCASE, created_at', user.id).map(present);

export function saveSearch(user: UserRow, name: string, query: string) {
  const clean = cleanQuery(query);
  if (!clean) throw badRequest('Gib einen Suchbegriff ein oder wähl einen Filter');
  if ((value<number>('SELECT COUNT(*) FROM searches WHERE user_id = ?', user.id) ?? 0) >= LIMIT) {
    throw badRequest('Du kannst höchstens {count} Suchen speichern', { count: LIMIT });
  }
  const row: SearchRow = { id: randomId(16), user_id: user.id, name: name.trim(), query: clean, created_at: Date.now() };
  run(
    'INSERT INTO searches (id, user_id, name, query, created_at) VALUES (?, ?, ?, ?, ?)',
    row.id,
    row.user_id,
    row.name,
    row.query,
    row.created_at
  );
  return present(row);
}

export function renameSearch(user: UserRow, id: string, name: string) {
  if (!run('UPDATE searches SET name = ? WHERE id = ? AND user_id = ?', name.trim(), id, user.id).changes) throw notFound();
}

export function deleteSearch(user: UserRow, id: string) {
  if (!run('DELETE FROM searches WHERE id = ? AND user_id = ?', id, user.id).changes) throw notFound();
}
