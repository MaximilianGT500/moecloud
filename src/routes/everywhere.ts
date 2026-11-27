import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { searchBookmarks } from '../bookmarks/store.ts';
import { searchEvents } from '../calendar/events.ts';
import { searchChat } from '../chat/store.ts';
import { visibleBooks } from '../contacts/books.ts';
import { dataOf, type ContactRow } from '../contacts/store.ts';
import { all, IN_LIST, value } from '../lib/db.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { searchFeedItems } from '../feeds/store.ts';
import { searchSnippets } from '../snippets/store.ts';
import { appAllowed } from '../services/apps.ts';
import { prefsOf, type UserRow } from '../services/users.ts';
import type { Feature } from '../../shared/features.ts';

export interface Hit {
  id: string;
  title: string;
  hint: string;
  href: string;
  at?: number | null;
  external?: boolean;
}

const LIMIT = 5;

const like = (text: string) => `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;

function contacts(user: UserRow, query: string): Hit[] {
  const books = visibleBooks(user);
  if (!books.length) return [];
  const rows = all<ContactRow>(
    `SELECT * FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL AND search LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`,
    JSON.stringify(books.map((entry) => entry.book.id)),
    like(query.toLowerCase()),
    LIMIT
  );
  return rows.map((row) => {
    const data = dataOf(row);
    return {
      id: row.id,
      title: data.name || data.emails[0]?.value || data.organization || '?',
      hint: [data.organization, data.emails[0]?.value, data.phones[0]?.value].filter(Boolean).join(' · '),
      href: `/contacts?c=${row.id}`,
    };
  });
}

export async function everywhereRoutes(app: FastifyInstance) {
  app.get('/api/search/everywhere', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (request) => {
    const user = me(request);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(200) }), request.query);
    const hidden = new Set(prefsOf(user).features);
    const on = (feature: Feature) => appAllowed(feature, user) && !hidden.has(feature);
    const groups: { key: string; items: Hit[] }[] = [];
    const add = (key: string, items: Hit[]) => {
      if (items.length) groups.push({ key, items });
    };
    if (on('contacts')) add('contacts', contacts(user, q));
    if (on('calendar')) {
      const found = searchEvents(user, q, { limit: 20 });
      const toHit = (entry: (typeof found)[number]): Hit => ({
        id: entry.eventId,
        title: entry.title || '?',
        hint: entry.location,
        at: entry.start,
        href: `/calendar?event=${entry.eventId}`,
      });
      add(
        'events',
        found
          .filter((entry) => entry.component !== 'VTODO')
          .slice(0, LIMIT)
          .map(toHit)
      );
      if (on('tasks'))
        add(
          'tasks',
          found
            .filter((entry) => entry.component === 'VTODO')
            .slice(0, LIMIT)
            .map(toHit)
        );
    }
    if (on('chat')) {
      add(
        'chat',
        searchChat(user, q, LIMIT).map((entry) => ({
          id: String(entry.id),
          title: entry.preview,
          hint: [entry.roomName, entry.by].filter(Boolean).join(' · '),
          at: entry.at,
          href: `/chat?room=${entry.room}`,
        }))
      );
    }
    if (on('bookmarks'))
      add(
        'bookmarks',
        searchBookmarks(user, q, LIMIT).map((entry) => ({
          id: entry.id,
          title: entry.title,
          hint: entry.host,
          href: entry.url,
          external: true,
        }))
      );
    if (on('feeds'))
      add(
        'feeds',
        searchFeedItems(user, q, LIMIT).map((entry) => ({
          id: String(entry.id),
          title: entry.title,
          hint: entry.feedTitle,
          at: entry.publishedAt,
          href: `/feeds?item=${entry.id}`,
        }))
      );
    if (on('snippets'))
      add(
        'snippets',
        searchSnippets(user, q, LIMIT).map((entry) => ({
          id: entry.id,
          title: entry.title || entry.content.split('\n')[0].slice(0, 80),
          hint: entry.language,
          href: `/snippets?id=${entry.id}`,
        }))
      );
    return { groups, mail: on('mail') && Boolean(value('SELECT 1 FROM mail_accounts WHERE user_id = ? LIMIT 1', user.id)) };
  });
}
