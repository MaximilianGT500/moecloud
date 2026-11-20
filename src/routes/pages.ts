import { config } from '../config.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderApp, renderDocument } from '../lib/html.ts';
import { t } from '../lib/i18n.ts';
import { changePasswordPage, legalPage, messagePage } from '../views/pages.ts';
import { plainAddress } from '../lib/networks.ts';
import { adminReachable } from '../services/adminnet.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { parse, password } from '../lib/validate.ts';
import { z } from 'zod';
import { changeOwnPassword } from '../services/ownpassword.ts';
import { baseUrl } from '../services/links.ts';
import * as settings from '../services/settings.ts';
import { isSetUp } from '../services/setup.ts';
import { CHUNK_SIZE } from '../services/uploads.ts';
import { tools } from '../services/media.ts';
import { scanEnabled } from '../services/scan.ts';
import { audit } from '../services/audit.ts';
import { secondFactorPending } from '../services/auth.ts';
import { acceptTerms, termsPending, termsText } from '../services/terms.ts';
import { knownExtensions, officeEnabled } from '../services/wopi.ts';
import { checkFormCsrf } from '../lib/request.ts';
import { pluginBoot } from '../services/plugins.ts';
import { teamsFor } from '../services/teams.ts';
import { prefsOf, publicUser, storageOf } from '../services/users.ts';

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
  const pending = secondFactorPending(user, request.auth?.session?.method);
  return {
    user: publicUser(user),
    teams: pending ? 0 : teamsFor(user).length,
    start: prefsOf(user).start,
    nav: prefsOf(user).nav,
    storage: storageOf(user),
    webdav: `${baseUrl(request)}/dav/`,
    setup2fa: pending,
    plugins: pluginBoot(pending ? null : user, request.lang),
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
          slugs: settings.get('share.slugs'),
        },
        upload: { chunkSize: CHUNK_SIZE, maxUpload: settings.get('storage.maxUpload') },
        trashDays: settings.get('storage.trashDays'),
        versions: settings.get('storage.versions'),
        previews: { video: tools.ffmpeg, pdf: tools.pdftoppm, pdfText: tools.pdftotext },
        scan: scanEnabled(),
        contentSearch: settings.get('search.content'),
        import: settings.get('import.enabled'),
        starter: user.role === 'admin' ? settings.get('accounts.starter') || null : null,
        office: officeEnabled() ? knownExtensions() : null,
      },
    });
  };
  app.get('/files', files);
  app.get('/files/*', files);

  const adminPage = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    if (user.role !== 'admin') throw notFound();
    if (!adminReachable(request.ip)) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Verwaltung'),
        status: 403,
        body: messagePage(request, {
          icon: 'lock',
          title: t(request.lang, 'Von hier aus nicht erreichbar'),
          text: t(request.lang, 'Die Verwaltung ist auf bestimmte Netze beschränkt, und deine Adresse {address} gehört nicht dazu.', {
            address: plainAddress(request.ip),
          }),
          action: { label: t(request.lang, 'Zu den Dateien'), href: '/files' },
        }),
      });
    }
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

  const termsPage = (request: FastifyRequest, reply: FastifyReply, error: string | null = null, status = 200) => {
    const text = termsText();
    if (!text) throw notFound();
    if (/^https?:\/\//.test(text)) return reply.redirect(text);
    const session = request.auth?.session;
    const pending = Boolean(session && termsPending(request.auth!.user));
    return renderDocument(request, reply, {
      title: t(request.lang, 'Nutzungsbedingungen'),
      status,
      body: legalPage(request, t(request.lang, 'Nutzungsbedingungen'), text, pending ? { csrf: session!.csrf, error } : undefined),
    });
  };

  app.get('/nutzungsbedingungen', async (request, reply) => termsPage(request, reply));

  app.post('/nutzungsbedingungen', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    try {
      checkFormCsrf(request, (request.body as Record<string, string> | undefined)?._csrf);
    } catch (error) {
      return termsPage(request, reply, t(request.lang, (error as Error).message), 403);
    }
    if (termsPending(user)) {
      acceptTerms(user);
      audit('terms_accepted', { actor: user.id, request, details: { version: settings.get('terms.version') } });
    }
    return reply.redirect('/files', 303);
  });

  const changePage = (request: FastifyRequest, reply: FastifyReply, error: string | null = null, status = 200) =>
    renderDocument(request, reply, {
      title: t(request.lang, 'Neues Passwort festlegen'),
      status,
      body: changePasswordPage(request, { csrf: request.auth!.session!.csrf, name: request.auth!.user.name, error }),
    });

  app.get('/passwort', async (request, reply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    if (!user.must_change) return reply.redirect('/account#sicherheit');
    return changePage(request, reply);
  });

  app.post('/passwort', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = requirePageUser(request, reply);
    if (!user) return reply;
    if (!user.must_change) return reply.redirect('/account#sicherheit', 303);
    const form = (request.body ?? {}) as Record<string, string | undefined>;
    try {
      checkFormCsrf(request, form._csrf);
      const input = parse(z.object({ current: z.string().max(512), next: password }), {
        current: String(form.current ?? ''),
        next: String(form.password ?? ''),
      });
      await changeOwnPassword(request, reply, user, input.current, input.next);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return changePage(request, reply, t(request.lang, error.message, error.params), error.status);
    }
    return reply.redirect('/files', 303);
  });
}
