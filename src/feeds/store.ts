import { randomId } from '../lib/crypto.ts';
import { all, one, run, tx, value } from '../lib/db.ts';
import { defuse } from '../lib/defuse.ts';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { escapeHtml } from '../lib/http.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { oneLine, pageMeta } from '../lib/page.ts';
import { cleanName } from '../lib/names.ts';
import { decodeBody, fetchRemote, streamRemote, webUrl } from '../lib/remote.ts';
import { appAllowed } from '../services/apps.ts';
import { countBadge, pushBadge } from '../services/badges.ts';
import { proxied, rewriteRemoteImages } from '../services/imageproxy.ts';
import { ensurePath } from '../services/nodes.ts';
import * as settings from '../services/settings.ts';
import { uploadStream } from '../services/uploads.ts';
import { getUser, inactive, prefsOf, type UserRow } from '../services/users.ts';
import { buildOpml, looksLikeFeed, parseFeed, parseOpml, type ParsedFeed } from './parse.ts';

export interface FeedRow {
  id: string;
  user_id: number;
  url: string;
  title: string;
  site: string;
  icon: string | null;
  folder: string;
  kind: 'news' | 'podcast';
  etag: string | null;
  modified: string | null;
  error: string | null;
  errors: number;
  fetched_at: number | null;
  next_at: number;
  created_at: number;
  updated_at: number;
}

export interface ItemRow {
  id: number;
  feed_id: string;
  guid: string;
  url: string;
  title: string;
  author: string;
  summary: string;
  content: string;
  image: string | null;
  audio: string | null;
  audio_type: string | null;
  duration: number | null;
  position: number;
  published_at: number;
  read: number;
  starred: number;
  created_at: number;
}

const MINUTE = 60_000;
const FETCH_LIMIT = 8 * 1024 * 1024;
const KEEP_DAYS = 120;
const KEEP_ITEMS = 1000;
const FRESH_UNREAD = 15;
const ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, text/html;q=0.7, */*;q=0.5';

const changed = (userId: number, data: Record<string, unknown>) => publish([userId], 'feeds', data);

export function unreadTotal(user: Pick<UserRow, 'id'>) {
  return (
    value<number>(
      'SELECT COUNT(*) FROM feed_items i JOIN feed_sources f ON f.id = i.feed_id WHERE f.user_id = ? AND i.read = 0',
      user.id
    ) ?? 0
  );
}

countBadge('feeds', unreadTotal);

const badge = (userId: number) => pushBadge([userId], { feeds: unreadTotal({ id: userId }) });

export function presentFeed(row: FeedRow & { unread?: number; total?: number }, lang: Lang) {
  return {
    id: row.id,
    url: row.url,
    title: row.title || new URL(row.url).hostname,
    site: row.site,
    icon: row.icon ? proxied(row.icon, 30) : null,
    folder: row.folder,
    kind: row.kind,
    error: row.error ? t(lang, row.error) : null,
    errors: row.errors,
    fetchedAt: row.fetched_at,
    unread: Number(row.unread ?? 0),
    total: Number(row.total ?? 0),
  };
}

export function presentItem(row: ItemRow & { feed_title?: string; feed_icon?: string | null; feed_kind?: string }) {
  return {
    id: row.id,
    feed: row.feed_id,
    feedTitle: row.feed_title ?? '',
    feedIcon: row.feed_icon ? proxied(row.feed_icon, 30) : null,
    url: row.url,
    title: row.title,
    author: row.author,
    summary: row.summary,
    image: row.image ? proxied(row.image, 30) : null,
    media: row.audio ? { type: row.audio_type ?? 'audio/mpeg', duration: row.duration, position: row.position } : null,
    publishedAt: row.published_at,
    read: Boolean(row.read),
    starred: Boolean(row.starred),
  };
}

export type FeedItem = ReturnType<typeof presentItem>;

function requireFeed(user: Pick<UserRow, 'id'>, id: string) {
  const row = one<FeedRow>('SELECT * FROM feed_sources WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) throw notFound('Diesen Feed gibt es nicht');
  return row;
}

export function requireItem(user: Pick<UserRow, 'id'>, id: number) {
  const row = one<ItemRow & { feed_title: string; feed_icon: string | null; feed_site: string; feed_url: string }>(
    `SELECT i.*, f.title AS feed_title, f.icon AS feed_icon, f.site AS feed_site, f.url AS feed_url
     FROM feed_items i JOIN feed_sources f ON f.id = i.feed_id WHERE i.id = ? AND f.user_id = ?`,
    id,
    user.id
  );
  if (!row) throw notFound('Diesen Beitrag gibt es nicht mehr');
  return row;
}

const allowPrivate = () => settings.get('feeds.private');

async function load(url: string, row?: Pick<FeedRow, 'etag' | 'modified'>) {
  return fetchRemote(url, {
    allowPrivate: allowPrivate(),
    limit: FETCH_LIMIT,
    accept: ACCEPT,
    timeout: 20_000,
    etag: row?.etag,
    modified: row?.modified,
  });
}

export async function discover(input: string): Promise<{ url: string; feed: ParsedFeed; etag: string | null; modified: string | null }> {
  const first = await load(webUrl(input).href);
  if (first.status < 200 || first.status >= 300)
    throw new HttpError(424, 'Die Seite antwortet mit Fehler {status}', 'feed_status', { status: first.status });
  const body = decodeBody(first.body, first.charset);
  const html = /html/.test(first.type) || /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype html|html|head)[\s>]/i.test(body);
  if (looksLikeFeed(body) || (!html && /xml|json/.test(first.type))) {
    try {
      return { url: first.url, feed: parseFeed(body, first.url), etag: first.etag, modified: first.modified };
    } catch {
      throw new HttpError(422, 'Das ist kein Feed, den MoeCloud lesen kann', 'feed_invalid');
    }
  }
  if (!html) throw new HttpError(422, 'Das ist kein Feed, den MoeCloud lesen kann', 'feed_invalid');
  const found = pageMeta(body, first.url).feeds;
  if (!found.length) throw new HttpError(422, 'Auf dieser Seite gibt es keinen Feed', 'feed_none');
  if (found.length > 1 && !found.every((entry) => entry.url === found[0].url)) {
    const preferred = found.filter((entry) => !/comments|kommentare/i.test(`${entry.title} ${entry.url}`));
    if (preferred.length !== 1) throw conflict('Diese Seite hat mehrere Feeds, such dir einen aus', undefined, { feeds: found });
    return discover(preferred[0].url);
  }
  const second = await load(found[0].url);
  if (second.status < 200 || second.status >= 300)
    throw new HttpError(424, 'Die Seite antwortet mit Fehler {status}', 'feed_status', { status: second.status });
  try {
    return {
      url: second.url,
      feed: parseFeed(decodeBody(second.body, second.charset), second.url),
      etag: second.etag,
      modified: second.modified,
    };
  } catch {
    throw new HttpError(422, 'Das ist kein Feed, den MoeCloud lesen kann', 'feed_invalid');
  }
}

function interval(row: Pick<FeedRow, 'kind'>, errors: number) {
  if (errors > 0) return Math.min(24 * 60, 30 * 2 ** Math.min(errors - 1, 6)) * MINUTE;
  return (row.kind === 'podcast' ? 60 : 30) * MINUTE;
}

function store(row: FeedRow, feed: ParsedFeed, initial: boolean) {
  const now = Date.now();
  let added = 0;
  const fresh = new Set(
    [...feed.items]
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, FRESH_UNREAD)
      .map((item) => item.guid)
  );
  tx(() => {
    for (const [index, item] of feed.items.entries()) {
      const published = Math.min(item.publishedAt ?? now - index, now);
      const existing = one<Pick<ItemRow, 'id' | 'title' | 'content' | 'audio'>>(
        'SELECT id, title, content, audio FROM feed_items WHERE feed_id = ? AND guid = ?',
        row.id,
        item.guid
      );
      if (existing) {
        if (existing.title !== item.title || existing.content !== item.content || existing.audio !== item.media) {
          run(
            'UPDATE feed_items SET url = ?, title = ?, author = ?, summary = ?, content = ?, image = ?, audio = ?, audio_type = ?, duration = COALESCE(?, duration) WHERE id = ?',
            item.url,
            item.title,
            item.author,
            item.summary,
            item.content,
            item.image,
            item.media,
            item.mediaType,
            item.duration,
            existing.id
          );
        }
        continue;
      }
      run(
        `INSERT INTO feed_items (feed_id, guid, url, title, author, summary, content, image, audio, audio_type, duration, position, published_at, read, starred, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?) ON CONFLICT DO NOTHING`,
        row.id,
        item.guid,
        item.url,
        item.title,
        item.author,
        item.summary,
        item.content,
        item.image,
        item.media,
        item.mediaType,
        item.duration,
        published,
        initial && !fresh.has(item.guid) ? 1 : 0,
        now
      );
      added++;
    }
    run(
      `DELETE FROM feed_items WHERE feed_id = ? AND starred = 0 AND read = 1 AND published_at < ?`,
      row.id,
      now - KEEP_DAYS * 24 * 60 * MINUTE
    );
    const overflow = (value<number>('SELECT COUNT(*) FROM feed_items WHERE feed_id = ?', row.id) ?? 0) - KEEP_ITEMS;
    if (overflow > 0) {
      run(
        'DELETE FROM feed_items WHERE id IN (SELECT id FROM feed_items WHERE feed_id = ? AND starred = 0 ORDER BY published_at ASC, id ASC LIMIT ?)',
        row.id,
        overflow
      );
    }
  });
  return added;
}

export async function refreshFeed(row: FeedRow) {
  try {
    const fetched = await load(row.url, row);
    if (fetched.status === 304) {
      run(
        'UPDATE feed_sources SET error = NULL, errors = 0, fetched_at = ?, next_at = ? WHERE id = ?',
        Date.now(),
        Date.now() + interval(row, 0),
        row.id
      );
      return 0;
    }
    if (fetched.status === 404 || fetched.status === 410) throw new HttpError(424, 'Den Feed gibt es nicht mehr', 'feed_gone');
    if (fetched.status < 200 || fetched.status >= 300)
      throw new HttpError(424, 'Die Seite antwortet mit Fehler {status}', 'feed_status', { status: fetched.status });
    let feed: ParsedFeed;
    try {
      feed = parseFeed(decodeBody(fetched.body, fetched.charset), fetched.url);
    } catch {
      throw new HttpError(422, 'Das ist kein Feed, den MoeCloud lesen kann', 'feed_invalid');
    }
    const added = store(row, feed, false);
    run(
      `UPDATE feed_sources SET title = CASE WHEN title = '' THEN ? ELSE title END, site = ?, icon = COALESCE(?, icon), kind = ?, etag = ?, modified = ?,
         error = NULL, errors = 0, fetched_at = ?, next_at = ?, updated_at = ? WHERE id = ?`,
      feed.title,
      feed.site,
      feed.icon,
      feed.podcast ? 'podcast' : row.kind,
      fetched.etag,
      fetched.modified,
      Date.now(),
      Date.now() + interval({ kind: feed.podcast ? 'podcast' : row.kind }, 0),
      Date.now(),
      row.id
    );
    if (added) {
      changed(row.user_id, { type: 'items', feed: row.id, added });
      badge(row.user_id);
    }
    return added;
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Die Seite ist nicht erreichbar';
    const errors = row.errors + 1;
    run(
      'UPDATE feed_sources SET error = ?, errors = ?, fetched_at = ?, next_at = ? WHERE id = ?',
      message,
      errors,
      Date.now(),
      Date.now() + interval(row, errors),
      row.id
    );
    return 0;
  }
}

export interface FeedInput {
  url: string;
  folder?: string;
  title?: string;
}

const cleanFolder = (folder: string | undefined) => oneLine(folder ?? '', 60);

export async function addFeed(user: Pick<UserRow, 'id'>, input: FeedInput) {
  const max = settings.get('feeds.maxFeeds');
  if ((value<number>('SELECT COUNT(*) FROM feed_sources WHERE user_id = ?', user.id) ?? 0) >= max) {
    throw badRequest('Du kannst höchstens {count} Feeds abonnieren', { count: max });
  }
  const found = await discover(input.url);
  const existing = one<FeedRow>('SELECT * FROM feed_sources WHERE user_id = ? AND url = ?', user.id, found.url);
  if (existing) return { feed: existing, existing: true };
  const now = Date.now();
  const id = randomId();
  const kind = found.feed.podcast ? 'podcast' : 'news';
  run(
    `INSERT INTO feed_sources (id, user_id, url, title, site, icon, folder, kind, etag, modified, errors, fetched_at, next_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    user.id,
    found.url,
    oneLine(input.title?.trim() || found.feed.title, 200),
    found.feed.site,
    found.feed.icon,
    cleanFolder(input.folder),
    kind,
    found.etag,
    found.modified,
    now,
    now + interval({ kind }, 0),
    now,
    now
  );
  const row = requireFeed(user, id);
  store(row, found.feed, true);
  changed(user.id, { type: 'feeds' });
  badge(user.id);
  return { feed: row, existing: false };
}

export function updateFeed(user: Pick<UserRow, 'id'>, id: string, patch: { title?: string; folder?: string; kind?: 'news' | 'podcast' }) {
  const row = requireFeed(user, id);
  run(
    'UPDATE feed_sources SET title = ?, folder = ?, kind = ?, updated_at = ? WHERE id = ?',
    patch.title !== undefined ? oneLine(patch.title, 200) : row.title,
    patch.folder !== undefined ? cleanFolder(patch.folder) : row.folder,
    patch.kind ?? row.kind,
    Date.now(),
    id
  );
  changed(user.id, { type: 'feeds' });
  return requireFeed(user, id);
}

export function removeFeed(user: Pick<UserRow, 'id'>, id: string) {
  requireFeed(user, id);
  tx(() => {
    run('DELETE FROM feed_items WHERE feed_id = ?', id);
    run('DELETE FROM feed_sources WHERE id = ?', id);
  });
  changed(user.id, { type: 'feeds' });
  badge(user.id);
}

export function renameFolder(user: Pick<UserRow, 'id'>, from: string, to: string) {
  const count = run(
    'UPDATE feed_sources SET folder = ?, updated_at = ? WHERE user_id = ? AND folder = ?',
    cleanFolder(to),
    Date.now(),
    user.id,
    from
  ).changes;
  if (count) changed(user.id, { type: 'feeds' });
  return count;
}

export function listFeeds(user: Pick<UserRow, 'id'>, lang: Lang) {
  const rows = all<FeedRow & { unread: number; total: number }>(
    `SELECT f.*, COALESCE(c.unread, 0) AS unread, COALESCE(c.total, 0) AS total FROM feed_sources f
     LEFT JOIN (SELECT feed_id, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread, COUNT(*) AS total FROM feed_items GROUP BY feed_id) c ON c.feed_id = f.id
     WHERE f.user_id = ? ORDER BY lower(f.folder), lower(f.title)`,
    user.id
  );
  const starred =
    value<number>(
      'SELECT COUNT(*) FROM feed_items i JOIN feed_sources f ON f.id = i.feed_id WHERE f.user_id = ? AND i.starred = 1',
      user.id
    ) ?? 0;
  const episodes =
    value<number>(
      'SELECT COUNT(*) FROM feed_items i JOIN feed_sources f ON f.id = i.feed_id WHERE f.user_id = ? AND i.audio IS NOT NULL AND i.read = 0',
      user.id
    ) ?? 0;
  return { feeds: rows.map((row) => presentFeed(row, lang)), starred, episodes };
}

export interface ItemQuery {
  feed?: string;
  folder?: string;
  filter: 'unread' | 'all' | 'starred' | 'media';
  q?: string;
  before?: string;
  limit?: number;
}

const cursorOf = (row: Pick<ItemRow, 'published_at' | 'id'>) => `${row.published_at}_${row.id}`;

export function listItems(user: Pick<UserRow, 'id'>, query: ItemQuery) {
  const where = ['f.user_id = ?'];
  const params: (string | number)[] = [user.id];
  if (query.feed) {
    where.push('f.id = ?');
    params.push(query.feed);
  }
  if (query.folder !== undefined) {
    where.push('f.folder = ?');
    params.push(query.folder);
  }
  if (query.filter === 'unread') where.push('i.read = 0');
  if (query.filter === 'starred') where.push('i.starred = 1');
  if (query.filter === 'media') where.push('i.audio IS NOT NULL');
  const q = query.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    where.push("(i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const cursor = /^(\d+)_(\d+)$/.exec(query.before ?? '');
  if (cursor) {
    where.push('(i.published_at < ? OR (i.published_at = ? AND i.id < ?))');
    params.push(Number(cursor[1]), Number(cursor[1]), Number(cursor[2]));
  }
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);
  const rows = all<ItemRow & { feed_title: string; feed_icon: string | null }>(
    `SELECT i.id, i.feed_id, i.guid, i.url, i.title, i.author, i.summary, '' AS content, i.image, i.audio, i.audio_type, i.duration, i.position,
       i.published_at, i.read, i.starred, i.created_at, f.title AS feed_title, f.icon AS feed_icon
     FROM feed_items i JOIN feed_sources f ON f.id = i.feed_id WHERE ${where.join(' AND ')} ORDER BY i.published_at DESC, i.id DESC LIMIT ?`,
    ...params,
    limit + 1
  );
  const page = rows.slice(0, limit);
  return { items: page.map(presentItem), next: rows.length > limit ? cursorOf(page.at(-1)!) : null };
}

export function markItems(
  user: Pick<UserRow, 'id'>,
  input: { ids?: number[]; feed?: string; folder?: string; all?: boolean; before?: number },
  read: boolean
) {
  let count = 0;
  tx(() => {
    if (input.ids?.length) {
      for (const id of input.ids) {
        count += run(
          'UPDATE feed_items SET read = ? WHERE id = ? AND read <> ? AND feed_id IN (SELECT id FROM feed_sources WHERE user_id = ?)',
          read ? 1 : 0,
          id,
          read ? 1 : 0,
          user.id
        ).changes;
      }
      return;
    }
    const where = ['user_id = ?'];
    const params: (string | number)[] = [user.id];
    if (input.feed) {
      where.push('id = ?');
      params.push(input.feed);
    } else if (input.folder !== undefined) {
      where.push('folder = ?');
      params.push(input.folder);
    } else if (!input.all) return;
    count = run(
      `UPDATE feed_items SET read = ? WHERE read <> ? AND published_at <= ? AND feed_id IN (SELECT id FROM feed_sources WHERE ${where.join(' AND ')})`,
      read ? 1 : 0,
      read ? 1 : 0,
      input.before ?? Date.now(),
      ...params
    ).changes;
  });
  if (count) {
    changed(user.id, { type: 'read' });
    badge(user.id);
  }
  return count;
}

export function starItem(user: Pick<UserRow, 'id'>, id: number, starred: boolean) {
  requireItem(user, id);
  run('UPDATE feed_items SET starred = ? WHERE id = ?', starred ? 1 : 0, id);
  changed(user.id, { type: 'star', id, starred });
}

export function savePosition(user: Pick<UserRow, 'id'>, id: number, position: number, duration: number | null) {
  const row = requireItem(user, id);
  if (!row.audio) throw badRequest('Dieser Beitrag hat nichts zum Abspielen');
  const total = duration && duration > 0 ? Math.round(duration) : row.duration;
  const done = Boolean(total && position >= total - 20);
  run(
    'UPDATE feed_items SET position = ?, duration = COALESCE(?, duration), read = CASE WHEN ? = 1 THEN 1 ELSE read END WHERE id = ?',
    done ? 0 : Math.max(0, Math.round(position)),
    total ?? null,
    done ? 1 : 0,
    id
  );
  if (done && !row.read) badge(user.id);
  return { position: done ? 0 : Math.round(position), done };
}

function absolutize(html: string, base: string) {
  return html.replace(/(\s(?:src|href|poster)=")([^"]*)"/gi, (match, prefix: string, raw: string) => {
    const value = raw.replace(/&amp;/g, '&');
    if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('#')) return match;
    try {
      return `${prefix}${new URL(value, base).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
    } catch {
      return match;
    }
  });
}

const THEMES = {
  light: { bg: '#fffbff', fg: '#1d1b20', muted: '#49454f', link: '#6750a4', code: '#f3edf7', border: '#cac4d0' },
  dark: { bg: '#141218', fg: '#e6e0e9', muted: '#cac4d0', link: '#d0bcff', code: '#211f26', border: '#49454f' },
};

const SIZES = { s: 15, m: 17, l: 20, xl: 23 };

export function itemDocument(
  row: ReturnType<typeof requireItem>,
  options: { origin: string; dark: boolean; size: keyof typeof SIZES; lang: Lang }
) {
  const theme = THEMES[options.dark ? 'dark' : 'light'];
  const base = row.url || row.feed_site || row.feed_url;
  const date = new Intl.DateTimeFormat(options.lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'long', timeStyle: 'short' }).format(
    row.published_at
  );
  const body = rewriteRemoteImages(absolutize(defuse(row.content || escapeHtml(row.summary)), base), options.origin);
  const heading = row.url
    ? `<h1><a href="${escapeHtml(row.url)}" rel="noopener noreferrer">${escapeHtml(row.title)}</a></h1>`
    : `<h1>${escapeHtml(row.title)}</h1>`;
  const meta = [row.feed_title, row.author, date].filter(Boolean).map(escapeHtml).join(' · ');
  return (
    `<!doctype html><html lang="${options.lang}"><meta charset="utf-8"><meta name="color-scheme" content="${options.dark ? 'dark' : 'light'}"><base target="_blank">` +
    `<style>html{background:${theme.bg};color:${theme.fg}}body{margin:0 auto;max-width:44rem;padding:20px 20px 64px;font:${SIZES[options.size]}px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}` +
    `h1{font-size:1.6em;line-height:1.25;margin:.2em 0 .3em}h1 a{color:inherit;text-decoration:none}h2,h3,h4{line-height:1.3}.moe-meta{color:${theme.muted};font-size:.85em;margin-bottom:1.6em}` +
    `img,video{max-width:100%;height:auto;border-radius:12px}figure{margin:1.2em 0}figcaption{color:${theme.muted};font-size:.85em}a{color:${theme.link}}` +
    `pre{overflow:auto;padding:12px;border-radius:10px;background:${theme.code};font-size:.85em}code{font-size:.9em}blockquote{margin:1em 0;padding:0 1em;border-left:3px solid ${theme.link};color:${theme.muted}}` +
    `table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}td,th{border:1px solid ${theme.border};padding:4px 8px}hr{border:0;border-top:1px solid ${theme.border}}</style>` +
    `<article>${heading}<div class="moe-meta">${meta}</div>${body}</article></html>`
  );
}

export function feedCsp(origin: string) {
  return `sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data: ${origin}; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'`;
}

function active(row: UserRow | undefined) {
  if (!row || inactive(row) || !appAllowed('feeds', row)) return false;
  return !prefsOf(row).features.includes('feeds');
}

let running = false;

export async function refreshDue(limit = 60) {
  if (running || !settings.get('feeds.enabled')) return 0;
  running = true;
  try {
    const rows = all<FeedRow>('SELECT * FROM feed_sources WHERE next_at <= ? ORDER BY next_at ASC LIMIT ?', Date.now(), limit);
    const users = new Map<number, boolean>();
    const due = rows.filter((row) => {
      if (!users.has(row.user_id)) users.set(row.user_id, active(getUser(row.user_id)));
      if (users.get(row.user_id)) return true;
      run('UPDATE feed_sources SET next_at = ? WHERE id = ?', Date.now() + 6 * 60 * MINUTE, row.id);
      return false;
    });
    let index = 0;
    let added = 0;
    const worker = async () => {
      while (index < due.length) added += await refreshFeed(due[index++]);
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return added;
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Feeds ließen sich nicht abrufen');
    return 0;
  } finally {
    running = false;
  }
}

const refreshing = new Map<number, Promise<number>>();

export async function refreshUser(user: Pick<UserRow, 'id'>, feed?: string, wait = 20_000) {
  const key = user.id;
  let job = feed ? undefined : refreshing.get(key);
  if (!job) {
    const rows = feed
      ? [requireFeed(user, feed)]
      : all<FeedRow>(
          'SELECT * FROM feed_sources WHERE user_id = ? AND (fetched_at IS NULL OR fetched_at < ?)',
          user.id,
          Date.now() - MINUTE
        );
    job = (async () => {
      let index = 0;
      let added = 0;
      const worker = async () => {
        while (index < rows.length) added += await refreshFeed(rows[index++]);
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      changed(user.id, { type: 'refreshed', added });
      return added;
    })();
    if (!feed) {
      refreshing.set(key, job);
      void job.finally(() => refreshing.delete(key));
    }
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), wait).unref());
  const added = await Promise.race([job, timeout]);
  return { done: added !== null, added: added ?? 0 };
}

export async function importOpml(user: Pick<UserRow, 'id'>, text: string) {
  let outlines;
  try {
    outlines = parseOpml(text);
  } catch {
    throw badRequest('Die Datei ist keine OPML-Datei');
  }
  if (!outlines.length) throw badRequest('In der Datei stehen keine Feeds');
  const max = settings.get('feeds.maxFeeds');
  let count = value<number>('SELECT COUNT(*) FROM feed_sources WHERE user_id = ?', user.id) ?? 0;
  let added = 0;
  let skipped = 0;
  const now = Date.now();
  tx(() => {
    for (const outline of outlines) {
      let url: string;
      try {
        url = webUrl(outline.url).href;
      } catch {
        skipped++;
        continue;
      }
      if (count >= max || one('SELECT id FROM feed_sources WHERE user_id = ? AND url = ?', user.id, url)) {
        skipped++;
        continue;
      }
      run(
        `INSERT INTO feed_sources (id, user_id, url, title, site, folder, kind, errors, next_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, 'news', 0, 0, ?, ?)`,
        randomId(),
        user.id,
        url,
        outline.title,
        cleanFolder(outline.folder),
        now,
        now
      );
      count++;
      added++;
    }
  });
  if (added) {
    changed(user.id, { type: 'feeds' });
    void refreshUser(user, undefined, 0);
  }
  return { added, skipped };
}

export function exportOpml(user: Pick<UserRow, 'id'>, title: string) {
  const rows = all<FeedRow>('SELECT * FROM feed_sources WHERE user_id = ? ORDER BY lower(folder), lower(title)', user.id);
  return buildOpml(
    rows.map((row) => ({ url: row.url, title: row.title, site: row.site, folder: row.folder })),
    title
  );
}

export function searchFeedItems(user: Pick<UserRow, 'id'>, query: string, limit = 6) {
  return listItems(user, { filter: 'all', q: query, limit }).items;
}

const MEDIA_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function mediaType(row: Pick<ItemRow, 'audio_type'>, remote: string) {
  if (/^(audio|video)\/[\w.+-]+$/.test(remote)) return remote;
  if (row.audio_type && /^(audio|video)\/[\w.+-]+$/.test(row.audio_type)) return row.audio_type;
  return 'audio/mpeg';
}

export async function openMedia(row: Pick<ItemRow, 'audio'>, range?: string) {
  if (!row.audio) throw notFound('Dieser Beitrag hat nichts zum Abspielen');
  const remote = await streamRemote(row.audio, {
    allowPrivate: allowPrivate(),
    accept: 'audio/*, video/*;q=0.9, */*;q=0.5',
    timeout: 20_000,
    range,
  });
  if (remote.status !== 200 && remote.status !== 206) {
    remote.response.resume();
    throw new HttpError(424, 'Die Folge lässt sich gerade nicht laden', 'feed_media');
  }
  return remote;
}

const saving = new Set<number>();

const safeName = (value: string, fallback: string) => {
  const name = oneLine(value.replace(/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, ' '), 150)
    .replace(/^\.+/, '')
    .trim();
  return cleanName(name || fallback);
};

export function saveMedia(user: UserRow, id: number, lang: Lang) {
  const row = requireItem(user, id);
  if (!row.audio) throw badRequest('Dieser Beitrag hat nichts zum Abspielen');
  if (saving.has(id)) return { started: false };
  saving.add(id);
  void (async () => {
    try {
      const remote = await openMedia(row);
      const type = mediaType(row, remote.type);
      const folder = ensurePath(user.id, user.id, user.root_id, [
        safeName(t(lang, 'Podcasts'), 'Podcasts'),
        safeName(row.feed_title, t(lang, 'Feed')),
      ]);
      const extension = MEDIA_EXTENSIONS[type] ?? /\.(\w{2,4})(\?|$)/.exec(new URL(row.audio!).pathname)?.[1] ?? 'mp3';
      const name = `${safeName(row.title, t(lang, 'Folge'))}.${extension}`;
      const node = await uploadStream(
        { user, link: null },
        { parentId: folder, name, conflict: 'rename' },
        remote.response,
        remote.length ?? undefined
      );
      changed(user.id, { type: 'saved', item: id, node: node.id, name: node.name, folder });
    } catch (error) {
      const message =
        error instanceof HttpError ? t(lang, error.message, error.params) : t(lang, 'Die Folge lässt sich gerade nicht laden');
      changed(user.id, { type: 'save_failed', item: id, error: message });
    } finally {
      saving.delete(id);
    }
  })();
  return { started: true };
}
