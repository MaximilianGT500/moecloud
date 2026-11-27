import { randomId } from '../lib/crypto.ts';
import { all, one, run, tx, value } from '../lib/db.ts';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { escapeHtml } from '../lib/http.ts';
import { log } from '../lib/log.ts';
import { decodeEntities, oneLine, pageMeta } from '../lib/page.ts';
import { decodeBody, fetchRemote, streamRemote, webUrl } from '../lib/remote.ts';
import { proxied } from '../services/imageproxy.ts';
import * as settings from '../services/settings.ts';
import type { UserRow } from '../services/users.ts';

export interface BookmarkRow {
  id: string;
  user_id: number;
  url: string;
  url_key: string;
  title: string;
  description: string;
  tags: string;
  icon: string | null;
  image: string | null;
  later: number;
  visits: number;
  visited_at: number | null;
  status: number | null;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export const MAX_BOOKMARKS = 20_000;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|si)$/i;

export function cleanUrl(input: string) {
  const url = webUrl(input);
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  if (url.href.length > 4000) throw badRequest('Die Adresse ist zu lang');
  return url;
}

export function urlKey(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '';
  const params = new URLSearchParams(url.searchParams);
  params.sort();
  const query = params.toString();
  return `${host}${url.port ? `:${url.port}` : ''}${path}${query ? `?${query}` : ''}`;
}

export function cleanTags(input: string[] | undefined) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input ?? []) {
    const tag = raw
      .replace(/["\\,#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}

const tagsOf = (row: Pick<BookmarkRow, 'tags'>) => {
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function presentBookmark(row: BookmarkRow) {
  return {
    id: row.id,
    url: row.url,
    host: hostOf(row.url),
    title: row.title || hostOf(row.url),
    description: row.description,
    tags: tagsOf(row),
    icon: row.icon ? proxied(row.icon, 30) : null,
    image: row.image ? proxied(row.image, 30) : null,
    later: Boolean(row.later),
    visits: row.visits,
    visitedAt: row.visited_at,
    status: row.status,
    dead: row.status !== null && (row.status === 0 || row.status === 404 || row.status === 410 || row.status >= 500),
    checkedAt: row.checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type Bookmark = ReturnType<typeof presentBookmark>;

const changed = (user: Pick<UserRow, 'id'>, data: Record<string, unknown>) => publish([user.id], 'bookmarks', data);

function requireBookmark(user: Pick<UserRow, 'id'>, id: string) {
  const row = one<BookmarkRow>('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) throw notFound('Dieses Lesezeichen gibt es nicht');
  return row;
}

const like = (text: string) => `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;

export interface ListQuery {
  q?: string;
  tag?: string;
  filter?: 'all' | 'later' | 'dead' | 'untagged';
  sort?: 'new' | 'old' | 'name' | 'visits';
  offset?: number;
  limit?: number;
}

export function listBookmarks(user: Pick<UserRow, 'id'>, query: ListQuery = {}) {
  const where = ['user_id = ?'];
  const params: (string | number)[] = [user.id];
  const q = query.q?.trim();
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(q), like(q));
  }
  if (query.tag) {
    where.push("tags LIKE ? ESCAPE '\\'");
    params.push(like(`"${query.tag}"`));
  }
  if (query.filter === 'later') where.push('later = 1');
  if (query.filter === 'dead') where.push('status IS NOT NULL AND (status = 0 OR status = 404 OR status = 410 OR status >= 500)');
  if (query.filter === 'untagged') where.push("tags = '[]'");
  const order =
    query.sort === 'old'
      ? 'created_at ASC'
      : query.sort === 'name'
        ? "lower(CASE WHEN title = '' THEN url ELSE title END) ASC"
        : query.sort === 'visits'
          ? 'visits DESC, COALESCE(visited_at, 0) DESC'
          : 'created_at DESC';
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const rows = all<BookmarkRow>(
    `SELECT * FROM bookmarks WHERE ${where.join(' AND ')} ORDER BY ${order}, id LIMIT ? OFFSET ?`,
    ...params,
    limit + 1,
    offset
  );
  const total = value<number>(`SELECT COUNT(*) FROM bookmarks WHERE ${where.join(' AND ')}`, ...params) ?? 0;
  return { items: rows.slice(0, limit).map(presentBookmark), more: rows.length > limit, total };
}

export function bookmarkTags(user: Pick<UserRow, 'id'>) {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const row of all<Pick<BookmarkRow, 'tags'>>("SELECT tags FROM bookmarks WHERE user_id = ? AND tags <> '[]'", user.id)) {
    for (const tag of tagsOf(row)) {
      const key = tag.toLowerCase();
      const entry = counts.get(key) ?? { tag, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function bookmarkCounts(user: Pick<UserRow, 'id'>) {
  const row = one<{ total: number; later: number; dead: number; untagged: number }>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN later = 1 THEN 1 ELSE 0 END), 0) AS later,
       COALESCE(SUM(CASE WHEN status IS NOT NULL AND (status = 0 OR status = 404 OR status = 410 OR status >= 500) THEN 1 ELSE 0 END), 0) AS dead,
       COALESCE(SUM(CASE WHEN tags = '[]' THEN 1 ELSE 0 END), 0) AS untagged
     FROM bookmarks WHERE user_id = ?`,
    user.id
  );
  return {
    total: Number(row?.total ?? 0),
    later: Number(row?.later ?? 0),
    dead: Number(row?.dead ?? 0),
    untagged: Number(row?.untagged ?? 0),
  };
}

export interface Meta {
  url: string;
  status: number;
  title: string;
  description: string;
  icon: string | null;
  image: string | null;
  feeds: { url: string; title: string; type: string }[];
}

export async function fetchMeta(url: URL): Promise<Meta> {
  const fetched = await fetchRemote(url, {
    allowPrivate: settings.get('feeds.private'),
    limit: 3 * 1024 * 1024,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    timeout: 8000,
  });
  const base = { url: fetched.url, status: fetched.status, title: '', description: '', icon: null, image: null, feeds: [] };
  if (fetched.status < 200 || fetched.status >= 300) return base;
  if (!/html|xml/.test(fetched.type)) {
    const name = decodeURIComponent(new URL(fetched.url).pathname.split('/').pop() ?? '');
    return { ...base, title: oneLine(name, 300) };
  }
  const { iconGuessed, ...meta } = pageMeta(decodeBody(fetched.body, fetched.charset), fetched.url);
  if (meta.icon && iconGuessed && !(await reachableImage(meta.icon))) meta.icon = null;
  return { ...base, ...meta };
}

async function reachableImage(url: string) {
  try {
    const found = await fetchRemote(url, {
      allowPrivate: settings.get('feeds.private'),
      limit: 256 * 1024,
      accept: 'image/*',
      timeout: 4000,
    });
    if (found.status !== 200 || !found.body.length) return false;
    const head = found.body.subarray(0, 4);
    return found.type.startsWith('image/') || head.equals(Buffer.from([0, 0, 1, 0])) || head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  } catch {
    return false;
  }
}

async function quietMeta(url: URL) {
  try {
    return await fetchMeta(url);
  } catch (error) {
    const status = error instanceof HttpError && (error.code === 'remote_private' || error.code === 'bad_url') ? null : 0;
    return { url: url.href, status, title: '', description: '', icon: null, image: null, feeds: [] };
  }
}

export interface BookmarkInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  later?: boolean;
}

export async function createBookmark(user: Pick<UserRow, 'id'>, input: BookmarkInput, options: { fetch?: boolean } = {}) {
  const url = cleanUrl(input.url);
  const key = urlKey(url);
  const existing = one<BookmarkRow>('SELECT * FROM bookmarks WHERE user_id = ? AND url_key = ?', user.id, key);
  if (existing) return { bookmark: presentBookmark(existing), existing: true };
  if ((value<number>('SELECT COUNT(*) FROM bookmarks WHERE user_id = ?', user.id) ?? 0) >= MAX_BOOKMARKS) {
    throw badRequest('Du hast schon {count} Lesezeichen, mehr gehen nicht', { count: MAX_BOOKMARKS });
  }
  const meta = options.fetch === false ? null : await quietMeta(url);
  const now = Date.now();
  const id = randomId();
  const title = oneLine(input.title?.trim() || meta?.title || hostOf(url.href), 300);
  run(
    `INSERT INTO bookmarks (id, user_id, url, url_key, title, description, tags, icon, image, later, visits, status, checked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    user.id,
    url.href,
    key,
    title,
    (input.description?.trim() || meta?.description || '').slice(0, 2000),
    JSON.stringify(cleanTags(input.tags)),
    meta?.icon ?? null,
    meta?.image ?? null,
    input.later ? 1 : 0,
    meta ? meta.status : null,
    meta ? now : null,
    now,
    now
  );
  changed(user, { type: 'created', id });
  return { bookmark: presentBookmark(requireBookmark(user, id)), existing: false };
}

export function updateBookmark(user: Pick<UserRow, 'id'>, id: string, patch: Partial<BookmarkInput>) {
  const row = requireBookmark(user, id);
  let url = row.url;
  let key = row.url_key;
  if (patch.url !== undefined) {
    const cleaned = cleanUrl(patch.url);
    url = cleaned.href;
    key = urlKey(cleaned);
    if (key !== row.url_key && one('SELECT id FROM bookmarks WHERE user_id = ? AND url_key = ? AND id <> ?', user.id, key, id)) {
      throw conflict('Diese Adresse hast du schon gespeichert');
    }
  }
  run(
    'UPDATE bookmarks SET url = ?, url_key = ?, title = ?, description = ?, tags = ?, later = ?, status = ?, updated_at = ? WHERE id = ?',
    url,
    key,
    patch.title !== undefined ? oneLine(patch.title, 300) : row.title,
    patch.description !== undefined ? patch.description.trim().slice(0, 2000) : row.description,
    patch.tags !== undefined ? JSON.stringify(cleanTags(patch.tags)) : row.tags,
    patch.later !== undefined ? (patch.later ? 1 : 0) : row.later,
    url === row.url ? row.status : null,
    Date.now(),
    id
  );
  changed(user, { type: 'updated', id });
  return presentBookmark(requireBookmark(user, id));
}

export function removeBookmarks(user: Pick<UserRow, 'id'>, ids: string[]) {
  let removed = 0;
  tx(() => {
    for (const id of ids) removed += run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', id, user.id).changes;
  });
  if (removed) changed(user, { type: 'removed', ids });
  return removed;
}

export function tagBookmarks(user: Pick<UserRow, 'id'>, ids: string[], add: string[], remove: string[]) {
  const drop = new Set(remove.map((tag) => tag.toLowerCase()));
  tx(() => {
    for (const id of ids) {
      const row = one<BookmarkRow>('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?', id, user.id);
      if (!row) continue;
      const tags = cleanTags([...tagsOf(row).filter((tag) => !drop.has(tag.toLowerCase())), ...add]);
      run('UPDATE bookmarks SET tags = ?, updated_at = ? WHERE id = ?', JSON.stringify(tags), Date.now(), id);
    }
  });
  changed(user, { type: 'updated', ids });
}

export function renameTag(user: Pick<UserRow, 'id'>, from: string, to: string) {
  const target = cleanTags([to])[0];
  let count = 0;
  tx(() => {
    for (const row of all<BookmarkRow>(
      "SELECT * FROM bookmarks WHERE user_id = ? AND tags LIKE ? ESCAPE '\\'",
      user.id,
      like(`"${from}"`)
    )) {
      const tags = tagsOf(row);
      if (!tags.some((tag) => tag.toLowerCase() === from.toLowerCase())) continue;
      const next = cleanTags(tags.flatMap((tag) => (tag.toLowerCase() === from.toLowerCase() ? (target ? [target] : []) : [tag])));
      run('UPDATE bookmarks SET tags = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), Date.now(), row.id);
      count++;
    }
  });
  if (count) changed(user, { type: 'tags' });
  return count;
}

export function visitBookmark(user: Pick<UserRow, 'id'>, id: string) {
  requireBookmark(user, id);
  run('UPDATE bookmarks SET visits = visits + 1, visited_at = ? WHERE id = ?', Date.now(), id);
}

export async function refreshBookmark(user: Pick<UserRow, 'id'>, id: string) {
  const row = requireBookmark(user, id);
  const meta = await quietMeta(new URL(row.url));
  const host = hostOf(row.url);
  run(
    'UPDATE bookmarks SET title = ?, description = ?, icon = ?, image = ?, status = ?, checked_at = ?, updated_at = ? WHERE id = ?',
    !row.title || row.title === host ? oneLine(meta.title || row.title, 300) : row.title,
    row.description || meta.description.slice(0, 2000),
    meta.icon ?? row.icon,
    meta.image ?? row.image,
    meta.status,
    Date.now(),
    Date.now(),
    id
  );
  changed(user, { type: 'updated', id });
  return presentBookmark(requireBookmark(user, id));
}

async function probe(url: string) {
  try {
    const result = await streamRemote(url, { allowPrivate: settings.get('feeds.private'), accept: 'text/html,*/*;q=0.5', timeout: 10_000 });
    result.response.destroy();
    return result.status;
  } catch (error) {
    if (error instanceof HttpError && error.code === 'remote_private') return null;
    return 0;
  }
}

const checking = new Set<number>();

export function checkingLinks(user: Pick<UserRow, 'id'>) {
  return checking.has(user.id);
}

export async function checkLinks(user: Pick<UserRow, 'id'>, limit = 500) {
  if (checking.has(user.id)) return { started: false };
  checking.add(user.id);
  const rows = all<Pick<BookmarkRow, 'id' | 'url'>>(
    'SELECT id, url FROM bookmarks WHERE user_id = ? AND (checked_at IS NULL OR checked_at < ?) ORDER BY COALESCE(checked_at, 0) ASC LIMIT ?',
    user.id,
    Date.now() - 6 * 60 * 60 * 1000,
    limit
  );
  const work = async () => {
    let index = 0;
    let dead = 0;
    const worker = async () => {
      while (index < rows.length) {
        const row = rows[index++];
        const status = await probe(row.url);
        if (status === 0 || status === 404 || status === 410 || (status ?? 0) >= 500) dead++;
        run('UPDATE bookmarks SET status = ?, checked_at = ? WHERE id = ? AND user_id = ?', status, Date.now(), row.id, user.id);
      }
    };
    try {
      await Promise.all(Array.from({ length: 4 }, worker));
    } catch (error) {
      log.warn({ error: (error as Error).message }, 'Die Linkprüfung ist abgebrochen');
    } finally {
      checking.delete(user.id);
      changed(user, { type: 'checked', count: rows.length, dead });
    }
  };
  void work();
  return { started: true, count: rows.length };
}

interface Imported {
  url: string;
  title: string;
  description: string;
  tags: string[];
  later: boolean;
  createdAt: number | null;
}

export function parseNetscape(html: string) {
  const found: Imported[] = [];
  const folders: string[] = [];
  const pattern = /<h3[^>]*>([\s\S]*?)<\/h3>|<\/dl>|<a\s([^>]*)>([\s\S]*?)<\/a>(?:\s*<dd>([^<]*))?/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      folders.push(oneLine(decodeEntities(match[1].replace(/<[^>]*>/g, '')), 40));
      continue;
    }
    if (match[0].toLowerCase() === '</dl>') {
      folders.pop();
      continue;
    }
    const attributes = match[2];
    const read = (name: string) =>
      decodeEntities(
        new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)?.[1] ??
          new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(attributes)?.[1] ??
          ''
      );
    const href = read('href');
    if (!/^https?:\/\//i.test(href)) continue;
    const added = Number(read('add_date'));
    const tags = read('tags')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const folderTags = folders.filter(
      (name) =>
        name &&
        !/^(bookmarks?|lesezeichen|lesezeichenleiste|bookmarks bar|bookmarks toolbar|lesezeichen-symbolleiste|favoriten|favorites|other bookmarks|weitere lesezeichen|mobile bookmarks)$/i.test(
          name
        )
    );
    found.push({
      url: href,
      title: oneLine(decodeEntities(match[3].replace(/<[^>]*>/g, '')), 300),
      description: oneLine(decodeEntities(match[4] ?? ''), 2000),
      tags: cleanTags([...tags, ...folderTags]),
      later: read('toread') === '1',
      createdAt: Number.isFinite(added) && added > 0 ? (added > 1e12 ? Math.floor(added / 1000) : added * 1000) : null,
    });
    if (found.length >= MAX_BOOKMARKS) break;
  }
  return found;
}

export function importBookmarks(user: Pick<UserRow, 'id'>, html: string) {
  const entries = parseNetscape(html);
  if (!entries.length) throw badRequest('In der Datei stehen keine Lesezeichen');
  let added = 0;
  let skipped = 0;
  const room = MAX_BOOKMARKS - (value<number>('SELECT COUNT(*) FROM bookmarks WHERE user_id = ?', user.id) ?? 0);
  tx(() => {
    for (const entry of entries) {
      let url: URL;
      try {
        url = cleanUrl(entry.url);
      } catch {
        skipped++;
        continue;
      }
      const key = urlKey(url);
      if (added >= room || one('SELECT id FROM bookmarks WHERE user_id = ? AND url_key = ?', user.id, key)) {
        skipped++;
        continue;
      }
      const created = entry.createdAt && entry.createdAt < Date.now() ? entry.createdAt : Date.now();
      run(
        `INSERT INTO bookmarks (id, user_id, url, url_key, title, description, tags, later, visits, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        randomId(),
        user.id,
        url.href,
        key,
        entry.title,
        entry.description,
        JSON.stringify(entry.tags),
        entry.later ? 1 : 0,
        created,
        Date.now()
      );
      added++;
    }
  });
  if (added) changed(user, { type: 'imported', added });
  return { added, skipped };
}

export function exportBookmarks(user: Pick<UserRow, 'id'>) {
  const rows = all<BookmarkRow>('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at ASC', user.id);
  const lines = rows.map((row) => {
    const tags = tagsOf(row);
    const attributes = [
      `HREF="${escapeHtml(row.url)}"`,
      `ADD_DATE="${Math.floor(row.created_at / 1000)}"`,
      `LAST_MODIFIED="${Math.floor(row.updated_at / 1000)}"`,
    ];
    if (tags.length) attributes.push(`TAGS="${escapeHtml(tags.join(','))}"`);
    if (row.later) attributes.push('TOREAD="1"');
    const description = row.description ? `\n<DD>${escapeHtml(row.description)}` : '';
    return `    <DT><A ${attributes.join(' ')}>${escapeHtml(row.title || row.url)}</A>${description}`;
  });
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `  <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">MoeCloud</H3>`,
    '  <DL><p>',
    ...lines,
    '  </DL><p>',
    '</DL><p>',
    '',
  ].join('\n');
}

export function searchBookmarks(user: Pick<UserRow, 'id'>, query: string, limit = 6) {
  return listBookmarks(user, { q: query, limit }).items;
}
