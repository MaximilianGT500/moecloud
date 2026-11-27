import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from '../config.ts';
import { run, value } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { safeRedirect, sendFile } from '../lib/http.ts';
import { isLang, t } from '../lib/i18n.ts';
import { setLanguageCookie } from '../lib/request.ts';
import { BRANDING, brandingFile } from '../services/branding.ts';
import * as settings from '../services/settings.ts';
import { appEnabled } from '../services/apps.ts';
import { SERVICE_WORKER } from '../services/webpush.ts';

const SHARE_FALLBACK_LIMIT = 256 * 1024 * 1024;
const SHARE_ANONYMOUS_LIMIT = 1024 * 1024;

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
      preCompressed: true,
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

  app.get<{ Params: { kind: string } }>('/branding/:kind', { compress: false }, async (request, reply) => {
    const kind = BRANDING.find((entry) => entry === request.params.kind);
    const file = kind ? await brandingFile(kind) : null;
    if (!file) throw notFound();
    return sendFile(request, reply, {
      path: file.path,
      size: file.size,
      type: 'image/webp',
      etag: `b-${file.stamp}`,
      modified: file.modified,
      name: `${kind}.webp`,
      disposition: 'inline',
      cache: 'public, max-age=31536000, immutable',
    });
  });

  app.get('/manifest.webmanifest', async (_request, reply) => {
    const palette = settings.get('site.palette');
    const name = settings.get('site.name');
    const lang = settings.get('site.language');
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
      shortcuts: [
        { name: t(lang, 'E-Mail'), url: '/mail', on: appEnabled('mail') },
        { name: t(lang, 'Chat'), url: '/chat', on: appEnabled('chat') },
        { name: t(lang, 'Kalender'), url: '/calendar', on: appEnabled('calendar') },
        { name: t(lang, 'Notizen'), url: '/files/notes', on: appEnabled('notes') },
        { name: t(lang, 'Fotos'), url: '/files/photos', on: appEnabled('photos') },
        { name: t(lang, 'Zuletzt'), url: '/files/recent', on: true },
        { name: t(lang, 'Favoriten'), url: '/files/starred', on: true },
      ]
        .filter((entry) => entry.on)
        .slice(0, 6)
        .map(({ on: _on, ...entry }) => entry)
        .map((entry) => ({ ...entry, icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] })),
      share_target: {
        action: '/share-target',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['*/*'] }] },
      },
    });
  });

  await app.register(async (plain) => {
    plain.removeAllContentTypeParsers();
    plain.addContentTypeParser('*', (request, payload, done) => {
      const limit = request.auth?.session ? SHARE_FALLBACK_LIMIT : SHARE_ANONYMOUS_LIMIT;
      let received = 0;
      payload.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) payload.destroy(new Error('too-large'));
      });
      payload.on('end', () => done(null, undefined));
      payload.on('error', (error) => done(error));
    });
    plain.post('/share-target', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (_request, reply) =>
      reply.redirect('/files?geteilt=0', 303)
    );
  });

  app.get<{ Params: { lang: string }; Querystring: { next?: string } }>('/lang/:lang', async (request, reply) => {
    const lang = request.params.lang;
    if (isLang(lang)) {
      setLanguageCookie(request, reply, lang);
      if (request.auth) run('UPDATE users SET language = ? WHERE id = ?', lang, request.auth.user.id);
    }
    return reply.redirect(safeRedirect(request.query.next, '/'));
  });

  app.get('/sw.js', async (_request, reply) =>
    reply
      .type('text/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .header('Service-Worker-Allowed', '/')
      .send(SERVICE_WORKER)
  );

  app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
}
