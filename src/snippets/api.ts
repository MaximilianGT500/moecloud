import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { forbidden } from '../lib/errors.ts';
import { contentDisposition, escapeHtml } from '../lib/http.ts';
import { renderApp, renderDocument } from '../lib/html.ts';
import { t } from '../lib/i18n.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { appAllowed } from '../services/apps.ts';
import { createDerived, writableFolder } from '../services/derived.ts';
import { baseUrl } from '../services/links.ts';
import * as settings from '../services/settings.ts';
import { messagePage } from '../views/pages.ts';
import {
  createSnippet,
  LANGUAGES,
  listSnippets,
  MAX_SNIPPET,
  presentSnippet,
  publicSnippet,
  rawSnippet,
  removeSnippet,
  requireSnippet,
  revealSnippet,
  shareSnippet,
  snippetFileName,
  snippetPageInfo,
  updateSnippet,
} from './store.ts';

const fields = {
  title: z.string().max(200, 'Höchstens 200 Zeichen'),
  language: z.enum(LANGUAGES),
  content: z.string().max(MAX_SNIPPET, 'Ein Schnipsel darf höchstens 512 KB groß sein'),
};

const SNIPPET_BODY = MAX_SNIPPET * 2 + 64 * 1024;

function gone(request: FastifyRequest, reply: FastifyReply) {
  reply.header('Referrer-Policy', 'no-referrer');
  return renderDocument(request, reply, {
    title: t(request.lang, 'Schnipsel nicht gefunden'),
    status: 404,
    body: messagePage(request, {
      icon: 'info',
      title: t(request.lang, 'Schnipsel nicht gefunden'),
      text: t(request.lang, 'Den Schnipsel gibt es nicht oder nicht mehr. Vielleicht ist der Link abgelaufen oder wurde schon gelesen.'),
      action: null,
    }),
  });
}

export async function snippetRoutes(app: FastifyInstance) {
  await app.register(async (owner) => {
    owner.addHook('onRequest', async (request) => {
      const user = request.auth?.user;
      if (user && !appAllowed('snippets', user)) throw forbidden('Gastkonten haben keine Schnipsel');
    });

    owner.get('/api/snippets', async (request) => {
      const query = parse(z.object({ q: z.string().max(200).optional(), shared: z.enum(['0', '1']).optional() }), request.query);
      const base = baseUrl(request);
      return { snippets: listSnippets(me(request), { q: query.q, shared: query.shared === '1' }).map((row) => presentSnippet(row, base)) };
    });

    owner.get<{ Params: { id: string } }>('/api/snippets/:id', async (request) => ({
      snippet: presentSnippet(requireSnippet(me(request), request.params.id), baseUrl(request), true),
    }));

    owner.post(
      '/api/snippets',
      { bodyLimit: SNIPPET_BODY, config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
      async (request) => {
        const input = parse(z.object(fields), request.body);
        return { snippet: presentSnippet(createSnippet(me(request), input), baseUrl(request), true) };
      }
    );

    owner.patch<{ Params: { id: string } }>('/api/snippets/:id', { bodyLimit: SNIPPET_BODY }, async (request) => {
      const input = parse(z.object(fields).partial(), request.body);
      return { snippet: presentSnippet(updateSnippet(me(request), request.params.id, input), baseUrl(request), true) };
    });

    owner.delete<{ Params: { id: string } }>('/api/snippets/:id', async (request) => {
      removeSnippet(me(request), request.params.id);
      return { ok: true };
    });

    owner.put<{ Params: { id: string } }>(
      '/api/snippets/:id/share',
      { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
      async (request) => {
        const input = parse(
          z.object({
            shared: z.boolean(),
            password: z.string().max(200).nullable().optional(),
            expiresAt: z.number().int().positive().nullable().optional(),
            burn: z.boolean().optional(),
            renew: z.boolean().optional(),
          }),
          request.body
        );
        return { snippet: presentSnippet(await shareSnippet(me(request), request.params.id, input), baseUrl(request), true) };
      }
    );

    owner.post<{ Params: { id: string } }>('/api/snippets/:id/save', async (request) => {
      const user = me(request);
      const input = parse(z.object({ parent: z.string().max(40).nullable().default(null) }), request.body ?? {});
      const row = requireSnippet(user, request.params.id);
      const folder = writableFolder(user, input.parent);
      const node = await createDerived(
        user,
        folder,
        snippetFileName(row, t(request.lang, 'Schnipsel')),
        Buffer.from(row.content, 'utf8'),
        'api'
      );
      return { node: { id: node.id, name: node.name }, folder: { id: folder.id, name: folder.name } };
    });

    owner.get<{ Params: { id: string } }>('/api/snippets/:id/raw', async (request, reply) => {
      const row = requireSnippet(me(request), request.params.id);
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', contentDisposition(snippetFileName(row, t(request.lang, 'Schnipsel')), 'inline'));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(row.content);
    });
  });

  app.get<{ Params: { token: string } }>(
    '/api/public/snippets/:token',
    { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      return publicSnippet(request.params.token);
    }
  );

  app.post<{ Params: { token: string } }>(
    '/api/public/snippets/:token/view',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const input = parse(z.object({ password: z.string().max(200).optional() }), request.body ?? {});
      reply.header('Cache-Control', 'no-store');
      return revealSnippet(request.params.token, input.password);
    }
  );

  app.get<{ Params: { token: string } }>(
    '/t/:token/raw',
    { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const row = rawSnippet(request.params.token);
      if (!row) return gone(request, reply);
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', contentDisposition(snippetFileName(row, t(request.lang, 'Schnipsel')), 'inline'));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Robots-Tag', 'noindex');
      reply.header('Cache-Control', 'no-store');
      return reply.send(row.content);
    }
  );

  app.get<{ Params: { token: string } }>(
    '/t/:token',
    { config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const info = snippetPageInfo(request.params.token);
      if (!info) return gone(request, reply);
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Robots-Tag', 'noindex');
      const site = settings.get('site.name');
      const title = info.title || t(request.lang, 'Schnipsel');
      return renderApp(request, reply, {
        entry: 'snippet',
        title,
        extraHead: [
          '<meta name="robots" content="noindex">',
          '<meta name="referrer" content="no-referrer">',
          '<meta property="og:type" content="website">',
          `<meta property="og:site_name" content="${escapeHtml(site)}">`,
          `<meta property="og:title" content="${escapeHtml(title)}">`,
          `<meta property="og:description" content="${escapeHtml(t(request.lang, 'Ein Schnipsel auf {site}', { site }))}">`,
        ].join('\n'),
        data: {
          user: request.auth?.session ? { name: request.auth.user.name } : null,
          token: request.params.token,
        },
      });
    }
  );
}
