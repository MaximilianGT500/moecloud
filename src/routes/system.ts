import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from '../config.ts';
import { run, value } from '../lib/db.ts';
import { safeRedirect } from '../lib/http.ts';
import { isLang } from '../lib/i18n.ts';
import { setLanguageCookie } from '../lib/request.ts';
import * as settings from '../services/settings.ts';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/healthz', { compress: false }, async (_request, reply) => {
    value('SELECT 1');
    return reply.header('Cache-Control', 'no-store').send({ ok: true, version: config.version });
  });

  if (existsSync(config.web)) {
    await app.register(fastifyStatic, {
      root: config.web,
      prefix: '/assets/',
      decorateReply: false,
      index: false,
      immutable: true,
      maxAge: '365d',
      allowedPath: (path) => !path.includes('.vite'),
    });
  }

  if (existsSync(config.public)) {
    await app.register(fastifyStatic, {
      root: config.public,
      prefix: '/',
      decorateReply: false,
      index: false,
      wildcard: false,
      maxAge: '7d',
    });
  }

  app.get('/manifest.webmanifest', async (_request, reply) => {
    const palette = settings.get('site.palette');
    const name = settings.get('site.name');
    return reply.type('application/manifest+json').send({
      name,
      short_name: name,
      start_url: '/files',
      scope: '/',
      display: 'standalone',
      background_color: palette.dark.surface,
      theme_color: palette.dark.surface,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });

  app.get<{ Params: { lang: string }; Querystring: { next?: string } }>('/lang/:lang', async (request, reply) => {
    const lang = request.params.lang;
    if (isLang(lang)) {
      setLanguageCookie(request, reply, lang);
      if (request.auth) run('UPDATE users SET language = ? WHERE id = ?', lang, request.auth.user.id);
    }
    return reply.redirect(safeRedirect(request.query.next, '/'));
  });

  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
}
