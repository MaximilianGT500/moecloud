import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden } from '../lib/errors.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { appAllowed } from '../services/apps.ts';
import {
  bookmarkCounts,
  bookmarkTags,
  checkingLinks,
  checkLinks,
  cleanUrl,
  createBookmark,
  exportBookmarks,
  fetchMeta,
  importBookmarks,
  listBookmarks,
  refreshBookmark,
  removeBookmarks,
  renameTag,
  tagBookmarks,
  updateBookmark,
  visitBookmark,
} from './store.ts';

const IMPORT_LIMIT = 20 * 1024 * 1024;
const tag = z.string().trim().min(1).max(60);
const ids = z.array(z.string().min(1).max(40)).min(1).max(500);
const fields = {
  url: z.string().trim().min(1, 'Gib eine Adresse an').max(4000, 'Die Adresse ist zu lang'),
  title: z.string().max(300, 'Höchstens 300 Zeichen'),
  description: z.string().max(2000, 'Höchstens 2000 Zeichen'),
  tags: z.array(tag).max(20, 'Höchstens 20 Schlagwörter'),
  later: z.boolean(),
};

export async function bookmarkRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const user = request.auth?.user;
    if (user && !appAllowed('bookmarks', user)) throw forbidden('Gastkonten haben keine Lesezeichen');
  });

  app.get('/api/bookmarks', async (request) => {
    const query = parse(
      z.object({
        q: z.string().max(200).optional(),
        tag: z.string().max(60).optional(),
        filter: z.enum(['all', 'later', 'dead', 'untagged']).default('all'),
        sort: z.enum(['new', 'old', 'name', 'visits']).default('new'),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(60),
      }),
      request.query
    );
    const user = me(request);
    return { ...listBookmarks(user, query), counts: bookmarkCounts(user), checking: checkingLinks(user) };
  });

  app.get('/api/bookmarks/tags', async (request) => ({ tags: bookmarkTags(me(request)) }));

  app.post('/api/bookmarks/preview', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parse(z.object({ url: fields.url }), request.body);
    const meta = await fetchMeta(cleanUrl(input.url));
    return { url: meta.url, status: meta.status, title: meta.title, description: meta.description, feeds: meta.feeds };
  });

  app.post('/api/bookmarks', { config: { rateLimit: { max: 200, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parse(
      z.object({
        url: fields.url,
        title: fields.title.optional(),
        description: fields.description.optional(),
        tags: fields.tags.optional(),
        later: fields.later.optional(),
      }),
      request.body
    );
    return createBookmark(me(request), input);
  });

  app.patch<{ Params: { id: string } }>('/api/bookmarks/:id', async (request) => {
    const input = parse(z.object(fields).partial(), request.body);
    return { bookmark: updateBookmark(me(request), request.params.id, input) };
  });

  app.delete<{ Params: { id: string } }>('/api/bookmarks/:id', async (request) => ({
    removed: removeBookmarks(me(request), [request.params.id]),
  }));

  app.post('/api/bookmarks/remove', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { removed: removeBookmarks(me(request), input.ids) };
  });

  app.post('/api/bookmarks/tag', async (request) => {
    const input = parse(z.object({ ids, add: z.array(tag).max(20).default([]), remove: z.array(tag).max(20).default([]) }), request.body);
    tagBookmarks(me(request), input.ids, input.add, input.remove);
    return { ok: true };
  });

  app.post('/api/bookmarks/tags/rename', async (request) => {
    const input = parse(z.object({ from: tag, to: z.string().trim().max(60) }), request.body);
    return { changed: renameTag(me(request), input.from, input.to) };
  });

  app.post<{ Params: { id: string } }>('/api/bookmarks/:id/visit', async (request) => {
    visitBookmark(me(request), request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/bookmarks/:id/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request) => ({
      bookmark: await refreshBookmark(me(request), request.params.id),
    })
  );

  app.post('/api/bookmarks/check', { config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (request) =>
    checkLinks(me(request))
  );

  app.post('/api/bookmarks/import', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    if (!request.isMultipart()) throw badRequest('Wähl eine Datei mit Lesezeichen aus');
    let html = '';
    for await (const part of request.parts({ limits: { files: 1, fileSize: IMPORT_LIMIT, fields: 2, parts: 4 } })) {
      if (part.type !== 'file') continue;
      const data = await part.toBuffer();
      if (part.file.truncated) throw badRequest('Die Datei ist zu groß');
      html = data.toString('utf8');
    }
    return importBookmarks(me(request), html);
  });

  app.get('/api/bookmarks/export', async (request, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="lesezeichen.html"');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(exportBookmarks(me(request)));
  });
}
