import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { value } from '../lib/db.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { t } from '../lib/i18n.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { appAllowed } from '../services/apps.ts';
import { baseUrl } from '../services/links.ts';
import {
  addFeed,
  exportOpml,
  feedCsp,
  importOpml,
  itemDocument,
  listFeeds,
  listItems,
  markItems,
  mediaType,
  openMedia,
  presentFeed,
  presentItem,
  refreshUser,
  removeFeed,
  renameFolder,
  requireItem,
  saveMedia,
  savePosition,
  starItem,
  updateFeed,
} from './store.ts';

const IMPORT_LIMIT = 5 * 1024 * 1024;
const folder = z.string().trim().max(60, 'Höchstens 60 Zeichen');
const itemId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Diesen Beitrag gibt es nicht mehr');
  return id;
};

export async function feedRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const user = request.auth?.user;
    if (user && !appAllowed('feeds', user)) throw forbidden('Gastkonten haben keine Feeds');
  });

  app.get('/api/feeds', async (request) => listFeeds(me(request), request.lang));

  app.post('/api/feeds', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parse(
      z.object({
        url: z.string().trim().min(1, 'Gib eine Adresse an').max(4000, 'Die Adresse ist zu lang'),
        folder: folder.optional(),
        title: z.string().trim().max(200).optional(),
      }),
      request.body
    );
    const user = me(request);
    const { feed, existing } = await addFeed(user, input);
    const unread = value<number>('SELECT COUNT(*) FROM feed_items WHERE feed_id = ? AND read = 0', feed.id) ?? 0;
    return { feed: presentFeed({ ...feed, unread }, request.lang), existing };
  });

  app.patch<{ Params: { id: string } }>('/api/feeds/:id', async (request) => {
    const input = parse(z.object({ title: z.string().trim().max(200), folder, kind: z.enum(['news', 'podcast']) }).partial(), request.body);
    return { feed: presentFeed(updateFeed(me(request), request.params.id, input), request.lang) };
  });

  app.delete<{ Params: { id: string } }>('/api/feeds/:id', async (request) => {
    removeFeed(me(request), request.params.id);
    return { ok: true };
  });

  app.post('/api/feeds/folders/rename', async (request) => {
    const input = parse(z.object({ from: z.string().max(60), to: folder }), request.body);
    return { changed: renameFolder(me(request), input.from, input.to) };
  });

  app.post('/api/feeds/refresh', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parse(z.object({ feed: z.string().min(1).max(40).optional() }), request.body ?? {});
    return refreshUser(me(request), input.feed);
  });

  app.get('/api/feeds/items', async (request) => {
    const query = parse(
      z.object({
        feed: z.string().max(40).optional(),
        folder: z.string().max(60).optional(),
        filter: z.enum(['unread', 'all', 'starred', 'media']).default('unread'),
        q: z.string().max(200).optional(),
        before: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      }),
      request.query
    );
    return listItems(me(request), query);
  });

  app.post('/api/feeds/items/read', async (request) => {
    const input = parse(
      z.object({
        ids: z.array(z.number().int().positive()).max(500).optional(),
        feed: z.string().max(40).optional(),
        folder: z.string().max(60).optional(),
        all: z.boolean().optional(),
        before: z.number().int().positive().optional(),
        read: z.boolean().default(true),
      }),
      request.body
    );
    if (!input.ids?.length && !input.feed && input.folder === undefined && !input.all) throw badRequest('Sag, was gelesen ist');
    return { changed: markItems(me(request), input, input.read) };
  });

  app.get<{ Params: { id: string } }>('/api/feeds/items/:id', async (request) => ({
    item: presentItem(requireItem(me(request), itemId(request.params.id))),
  }));

  app.get<{ Params: { id: string } }>('/api/feeds/items/:id/body', async (request, reply) => {
    const query = parse(
      z.object({ dark: z.enum(['0', '1']).default('0'), size: z.enum(['s', 'm', 'l', 'xl']).default('m') }),
      request.query
    );
    const row = requireItem(me(request), itemId(request.params.id));
    const origin = baseUrl(request);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Security-Policy', feedCsp(origin));
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'private, no-cache');
    return reply.send(itemDocument(row, { origin, dark: query.dark === '1', size: query.size, lang: request.lang }));
  });

  app.post<{ Params: { id: string } }>('/api/feeds/items/:id/star', async (request) => {
    const input = parse(z.object({ starred: z.boolean() }), request.body);
    starItem(me(request), itemId(request.params.id), input.starred);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/feeds/items/:id/position', async (request) => {
    const input = parse(
      z.object({ position: z.number().min(0).max(1e7), duration: z.number().min(0).max(1e7).nullable().optional() }),
      request.body
    );
    return savePosition(me(request), itemId(request.params.id), input.position, input.duration ?? null);
  });

  app.get<{ Params: { id: string } }>(
    '/api/feeds/items/:id/media',
    { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const row = requireItem(me(request), itemId(request.params.id));
      const header = request.headers.range;
      const range = typeof header === 'string' && /^bytes=\d*-\d*$/.test(header.trim()) ? header.trim() : undefined;
      const remote = await openMedia(row, range);
      request.raw.on('close', () => remote.response.destroy());
      reply.code(remote.status);
      reply.header('Content-Type', mediaType(row, remote.type));
      if (remote.length !== null) reply.header('Content-Length', remote.length);
      if (remote.range) reply.header('Content-Range', remote.range);
      reply.header('Accept-Ranges', remote.ranges || remote.status === 206 ? 'bytes' : 'none');
      reply.header('Cache-Control', 'private, max-age=3600');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      return reply.send(remote.response);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/feeds/items/:id/save',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => saveMedia(me(request), itemId(request.params.id), request.lang)
  );

  app.post('/api/feeds/import', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    if (!request.isMultipart()) throw badRequest('Wähl eine OPML-Datei aus');
    let text = '';
    for await (const part of request.parts({ limits: { files: 1, fileSize: IMPORT_LIMIT, fields: 2, parts: 4 } })) {
      if (part.type !== 'file') continue;
      const data = await part.toBuffer();
      if (part.file.truncated) throw badRequest('Die Datei ist zu groß');
      text = data.toString('utf8');
    }
    return importOpml(me(request), text);
  });

  app.get('/api/feeds/export', async (request, reply) => {
    reply.header('Content-Type', 'text/x-opml; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="feeds.opml"');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(exportOpml(me(request), t(request.lang, 'Feeds aus MoeCloud')));
  });
}
