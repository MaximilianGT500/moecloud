import { config } from '../config.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderApp, renderDocument } from '../lib/html.ts';
import { t } from '../lib/i18n.ts';
import { legalPage } from '../views/pages.ts';
import { notFound } from '../lib/errors.ts';
import { baseUrl } from '../services/links.ts';
import * as settings from '../services/settings.ts';
import { isSetUp } from '../services/setup.ts';
import { CHUNK_SIZE } from '../services/uploads.ts';
import { tools } from '../services/media.ts';
import { scanEnabled } from '../services/scan.ts';
import { secondFactorPending } from '../services/auth.ts';
import { publicUser, storageOf } from '../services/users.ts';

function requirePageUser(request: FastifyRequest, reply: FastifyReply) {
  if (!isSetUp()) {
    reply.redirect('/setup');
    return null;
  }
  if (!request.auth?.session) {
    reply.redirect(`/login?next=${encodeURIComponent(request.url)}`);
    return null;
  }
  return request.auth.user;
}

export function userBoot(request: FastifyRequest) {
  const user = request.auth!.user;
  return {
    user: publicUser(user),
    storage: storageOf(user),
    webdav: `${baseUrl(request)}/dav/`,
    setup2fa: secondFactorPending(user, request.auth?.session?.method),
  };
}

export async function pageRoutes(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    if (!isSetUp()) return reply.redirect('/setup');
    return reply.redirect(request.auth?.session ? '/files' : '/login');
  });

  app.get('/setup', async (request, reply) => {
    if (isSetUp()) return reply.redirect('/');
    return renderApp(request, reply, {
      entry: 'setup',
      title: t(request.lang, 'Einrichtung'),
      data: { defaults: { url: config.publicUrl.replace(/\/+$/, '') || `${request.protocol}://${request.host}`, language: request.lang } },
    });
  });

  const files = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    return renderApp(request, reply, {
      entry: 'files',
      title: t(request.lang, 'Dateien'),
      data: {
        ...userBoot(request),
        share: {
          links: settings.get('share.links'),
          users: settings.get('share.users'),
          requirePassword: settings.get('share.requirePassword'),
          maxDays: settings.get('share.maxDays'),
        },
        upload: { chunkSize: CHUNK_SIZE, maxUpload: settings.get('storage.maxUpload') },
        trashDays: settings.get('storage.trashDays'),
        versions: settings.get('storage.versions'),
        previews: { video: tools.ffmpeg, pdf: tools.pdftoppm, pdfText: tools.pdftotext },
        scan: scanEnabled(),
        contentSearch: settings.get('search.content'),
        import: settings.get('import.enabled'),
      },
    });
  };
  app.get('/files', files);
  app.get('/files/*', files);

  const adminPage = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    if (user.role !== 'admin') throw notFound();
    return renderApp(request, reply, { entry: 'admin', title: t(request.lang, 'Verwaltung'), data: userBoot(request) });
  };
  app.get('/admin', adminPage);
  app.get('/admin/*', adminPage);

  app.get('/account', async (request, reply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    return renderApp(request, reply, { entry: 'account', title: t(request.lang, 'Konto'), data: userBoot(request) });
  });

  for (const [path, key, title] of [
    ['/impressum', 'site.imprint', 'Impressum'],
    ['/datenschutz', 'site.privacy', 'Datenschutz'],
  ] as const) {
    app.get(path, async (request, reply) => {
      const text = settings.get(key).trim();
      if (!text) throw notFound();
      if (/^https?:\/\//.test(text)) return reply.redirect(text);
      return renderDocument(request, reply, { title: t(request.lang, title), body: legalPage(request, t(request.lang, title), text) });
    });
  }
}
