import { devicePaused } from './services/ransomware.ts';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomBytes } from 'node:crypto';
import { config } from './config.ts';
import { randomId, safeEqual } from './lib/crypto.ts';
import { badRequest, forbidden, HttpError, unauthorized } from './lib/errors.ts';
import { isSecure, sameOrigin } from './lib/http.ts';
import { fromAcceptLanguage, isLang, t, type Lang } from './lib/i18n.ts';
import { renderDocument } from './lib/html.ts';
import { remember, setLogger } from './lib/log.ts';
import { maintenancePage, messagePage } from './views/pages.ts';
import { basicAuth } from './services/apppasswords.ts';
import { secondFactorPending } from './services/auth.ts';
import { termsPending } from './services/terms.ts';
import { officeOrigin } from './services/wopi.ts';
import { readSession } from './services/sessions.ts';
import { adminBlocked, adminReachable } from './services/adminnet.ts';
import { CSRF_COOKIE, LANG_COOKIE, sessionRequired, type RequestAuth } from './lib/request.ts';
import * as settings from './services/settings.ts';
import { touchSeen, type UserRow } from './services/users.ts';
import { systemRoutes } from './routes/system.ts';
import { pageRoutes } from './routes/pages.ts';
import { authRoutes } from './routes/auth.ts';
import { setupRoutes } from './routes/setup.ts';
import { fileRoutes } from './routes/files.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { shareRoutes } from './routes/shares.ts';
import { publicRoutes } from './routes/public.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { eventRoutes } from './routes/events.ts';
import { davRoutes } from './routes/dav.ts';
import { calendarRoutes } from './calendar/api.ts';
import { caldavRoutes } from './calendar/caldav.ts';
import { contactRoutes } from './contacts/api.ts';
import { carddavRoutes } from './contacts/carddav.ts';
import { calendarPublicRoutes } from './calendar/public.ts';
import { schedulingRoutes } from './calendar/scheduling.ts';
import { systemAdminRoutes } from './routes/system-admin.ts';
import { metricsRoutes } from './routes/metrics.ts';
import { groupRoutes } from './routes/groups.ts';
import { teamRoutes } from './routes/teams.ts';
import { automationRoutes } from './routes/automations.ts';
import { officeRoutes } from './routes/office.ts';
import { collaboraRoutes } from './routes/collabora.ts';
import { noteRoutes } from './routes/notes.ts';
import { musicRoutes } from './routes/music.ts';
import { tagRoutes } from './routes/tags.ts';
import { albumRoutes } from './routes/albums.ts';
import { formRoutes } from './routes/forms.ts';
import { rewindRoutes } from './routes/rewind.ts';
import { pulseRoutes } from './routes/pulse.ts';
import { pulse } from './services/pulse.ts';
import { toolRoutes } from './routes/tools.ts';
import { themeRoutes } from './routes/themes.ts';
import { pluginRoutes } from './routes/plugins.ts';
import { securityRoutes } from './routes/security.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MODE_SWITCH_STYLE = "'sha256-GNF74DLkXb0fH3ILHgILFjk1ozCF3SNXQ5mQb7WLu/Y='";

const logHooks = {
  logMethod(this: unknown, args: unknown[], method: (...values: unknown[]) => void, level: number) {
    remember(level, args);
    method.apply(this, args);
  },
};

function loggerOptions() {
  if (config.test) return false;
  if (config.logFormat === 'json') return { level: config.logLevel, hooks: logHooks };
  return {
    level: config.logLevel,
    hooks: logHooks,
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,reqId', singleLine: true } },
  };
}

const isDav = (url: string) =>
  url === '/dav' ||
  url.startsWith('/dav/') ||
  url.startsWith('/dav?') ||
  url === '/caldav' ||
  url.startsWith('/caldav/') ||
  url.startsWith('/.well-known/caldav') ||
  url === '/carddav' ||
  url.startsWith('/carddav/') ||
  url.startsWith('/.well-known/carddav');

function pagePolicy(nonce: string, frames = "'none'") {
  const dev = config.devServer ? new URL(config.devServer).origin : '';
  const office = officeOrigin();
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? [dev] : [])],
    ['style-src', "'self'", ...(dev ? ["'unsafe-inline'", dev] : [`'nonce-${nonce}'`, MODE_SWITCH_STYLE])],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['media-src', "'self'", 'blob:'],
    ['font-src', "'self'", ...(dev ? [dev] : [])],
    ['connect-src', "'self'", ...(dev ? [dev, dev.replace(/^http/, 'ws')] : [])],
    ['frame-src', "'self'", ...(office ? [office] : [])],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'", ...(office ? [office] : [])],
    ['frame-ancestors', frames],
  ];
  return directives.map((parts) => parts.join(' ')).join('; ');
}

function languageOf(request: FastifyRequest, user: UserRow | null): Lang {
  if (user?.language && isLang(user.language)) return user.language;
  const cookieLang = request.cookies?.[LANG_COOKIE];
  if (isLang(cookieLang)) return cookieLang;
  return fromAcceptLanguage(request.headers['accept-language']) ?? settings.get('site.language');
}

const isAsset = (url: string) =>
  url.startsWith('/assets/') || url === '/healthz' || url === '/sw.js' || url.startsWith('/icons/') || url.startsWith('/favicon');

const OPEN_DURING_MAINTENANCE =
  /^\/(login|logout|lang\/|api\/auth\/passkey|api\/session|manifest\.webmanifest|sw\.js|robots\.txt|metrics|apple-touch-icon|setup|api\/setup)/;

function inMaintenance(request: FastifyRequest) {
  if (!settings.get('maintenance.enabled')) return false;
  if (request.auth?.user.role === 'admin') return false;
  return !OPEN_DURING_MAINTENANCE.test(request.url);
}

const OPEN_API = /^\/api\/(public\/|calendar\/public\/|setup(\/|$)|auth\/passkey\/|language$)/;

const SESSION_ONLY = new Set([
  'PUT /api/admin/pulse',
  'POST /api/admin/pulse/forget',
  'POST /api/admin/moepulse/support',
  'POST /api/account/app-passwords',
  'DELETE /api/account/app-passwords/:id',
  'POST /api/account/app-passwords/:id/resume',
  'POST /api/account/delete',
  'POST /api/account/password',
  'POST /api/account/secure',
  'POST /api/account/passkeys',
  'POST /api/account/passkeys/options',
  'PATCH /api/account/passkeys/:id',
  'DELETE /api/account/passkeys/:id',
  'DELETE /api/account/session',
  'DELETE /api/account/sessions/:id',
  'POST /api/account/sessions/revoke-others',
  'DELETE /api/account/sso',
  'POST /api/account/totp/setup',
  'POST /api/account/totp/enable',
  'POST /api/account/totp/disable',
  'POST /api/account/totp/recovery',
]);

function hasNul(body: unknown) {
  if (typeof body === 'string') return body.includes('\0');
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body) || typeof (body as { pipe?: unknown }).pipe === 'function') return false;
  const pending: unknown[] = [body];
  for (let seen = 0; pending.length > 0 && seen < 500_000; seen++) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (current.includes('\0')) return true;
    } else if (current && typeof current === 'object') {
      for (const [key, entry] of Object.entries(current)) {
        if (key.includes('\0')) return true;
        if (typeof entry === 'string' || (entry && typeof entry === 'object')) pending.push(entry);
      }
    }
  }
  return false;
}

const isLocalHost = (host: string) => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host);

const ROUTES = new WeakMap<FastifyInstance, { method: string; url: string }[]>();

export const routesOf = (app: FastifyInstance) => ROUTES.get(app) ?? [];

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(),
    return503OnClosing: true,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomId(12),
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 500 },
  });

  for (const method of ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'MKCALENDAR', 'REPORT']) {
    app.addHttpMethod(method, { hasBody: true });
  }

  setLogger(app.log);

  const routes: { method: string; url: string }[] = [];
  ROUTES.set(app, routes);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' || !routes.some((entry) => entry.method === 'GET' && entry.url === route.url))
        routes.push({ method, url: route.url });
    }
  });

  app.decorateRequest('auth', null);
  app.decorateRequest('lang', 'de');
  app.decorateRequest('nonce', '');
  app.decorateRequest('csrf', '');
  app.decorateRequest('embeddable', false);

  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  await app.register(multipart, { limits: { files: 200, fileSize: Number.MAX_SAFE_INTEGER, fields: 20 } });
  await app.register(rateLimit, { global: false });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

  const termsRoutes = new Set(['GET /api/session', 'DELETE /api/account/session', 'POST /api/language']);
  const changeRoutes = new Set(['GET /api/session', 'POST /api/account/password', 'DELETE /api/account/session', 'POST /api/language']);
  const secondFactorRoutes = new Set([
    'GET /api/session',
    'GET /api/account',
    'GET /api/account/security',
    'PATCH /api/account',
    'PATCH /api/account/prefs',
    'POST /api/account/password',
    'POST /api/account/totp/setup',
    'POST /api/account/totp/enable',
    'POST /api/account/passkeys/options',
    'POST /api/account/passkeys',
    'PATCH /api/account/passkeys/:id',
    'DELETE /api/account/app-passwords/:id',
    'DELETE /api/account/sessions/:id',
    'POST /api/account/sessions/revoke-others',
    'DELETE /api/account/session',
    'POST /api/language',
  ]);

  app.addHook('onRequest', async (request, reply) => {
    request.nonce = randomBytes(16).toString('base64');
    if (isAsset(request.url)) return;
    if (isDav(request.url)) {
      request.lang = languageOf(request, null);
      if (settings.get('maintenance.enabled')) {
        return reply
          .code(503)
          .header('Retry-After', '300')
          .type('text/plain; charset=utf-8')
          .send(t(request.lang, 'MoeCloud wird gerade gewartet, versuch es gleich noch einmal'));
      }
      return;
    }
    let auth: RequestAuth | null = readSession(request, reply);
    if (!auth && request.url.startsWith('/api/') && request.headers.authorization?.startsWith('Basic ')) {
      const found = basicAuth(request.headers.authorization, request.ip);
      if (found && found !== 'blocked') {
        auth = {
          user: found.user,
          session: null,
          readOnly: found.readOnly,
          app: { id: found.id, admin: found.admin, paused: found.paused },
        };
      }
    }
    request.auth = auth;
    if (auth) touchSeen(auth.user.id);
    request.lang = languageOf(request, auth?.user ?? null);
    let csrf = request.cookies?.[CSRF_COOKIE];
    if (!csrf || csrf.length !== 32) {
      csrf = randomId(32);
      reply.setCookie(CSRF_COOKIE, csrf, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure(request) });
    }
    request.csrf = csrf;
    if (inMaintenance(request)) {
      reply.header('Retry-After', '300');
      if (request.url.startsWith('/api/')) {
        return reply.code(503).send({
          error: { code: 'maintenance', message: t(request.lang, 'MoeCloud wird gerade gewartet, versuch es gleich noch einmal') },
        });
      }
      return renderDocument(request, reply, {
        title: t(request.lang, 'Wartung'),
        status: 503,
        body: maintenancePage(request, settings.get('maintenance.message')),
      });
    }
    if (auth && secondFactorPending(auth.user, auth.session?.method)) {
      if (!auth.session) request.auth = null;
      else if (request.url.startsWith('/api/')) {
        if (!secondFactorRoutes.has(`${request.method} ${request.routeOptions.url ?? ''}`)) {
          return reply.code(403).send({
            error: {
              code: 'second_factor_required',
              message: t(request.lang, 'Richte zuerst die Zwei-Faktor-Anmeldung ein, die Verwaltung verlangt sie'),
            },
          });
        }
      } else if (request.method === 'GET' && /^\/(files|admin)(\/|\?|$)/.test(request.url)) {
        return reply.redirect('/account');
      }
    }
    if (auth?.session && termsPending(auth.user)) {
      if (request.url.startsWith('/api/')) {
        if (!termsRoutes.has(`${request.method} ${request.routeOptions.url ?? ''}`)) {
          return reply.code(403).send({
            error: { code: 'terms_required', message: t(request.lang, 'Stimm zuerst den Nutzungsbedingungen zu') },
          });
        }
      } else if (request.method === 'GET' && /^\/(files|admin|account)(\/|\?|$)/.test(request.url)) {
        return reply.redirect('/nutzungsbedingungen');
      }
    }
    if (auth?.session && auth.user.must_change) {
      if (request.url.startsWith('/api/')) {
        if (!changeRoutes.has(`${request.method} ${request.routeOptions.url ?? ''}`)) {
          return reply.code(403).send({
            error: { code: 'password_change_required', message: t(request.lang, 'Leg zuerst im Browser ein neues Passwort fest') },
          });
        }
      } else if (
        request.method === 'GET' ? /^\/(files|admin|account)(\/|\?|$)/.test(request.url) : request.url.startsWith('/share-target')
      ) {
        return reply.redirect('/passwort', request.method === 'GET' ? 302 : 303);
      }
    }
    const route = request.routeOptions.url;
    if (route?.startsWith('/api/') && !OPEN_API.test(route)) {
      if (!request.auth) throw unauthorized();
      const app = request.auth.app;
      if (route.startsWith('/api/admin/')) {
        if (request.auth.user.role !== 'admin') throw forbidden('Das dürfen nur Admins');
        if (app && !app.admin) throw new HttpError(403, 'Dieses App-Passwort darf die Verwaltung nicht bedienen', 'app_password_scope');
        if (!adminReachable(request.ip)) throw adminBlocked();
      }
      if (app && SESSION_ONLY.has(`${request.method} ${route}`)) {
        const own = route === '/api/account/app-passwords/:id' && (request.params as { id?: string }).id === app.id;
        if (!own) throw sessionRequired();
      }
    }
  });

  app.addHook('preValidation', async (request) => {
    if (request.url.includes('%00') || hasNul(request.body)) throw badRequest('Die Anfrage enthält ein ungültiges Zeichen');
  });

  app.addHook('preHandler', async (request) => {
    if (!UNSAFE.has(request.method) || !(request.routeOptions.url ?? request.url).startsWith('/api/')) return;
    if (request.auth?.readOnly) throw new HttpError(403, 'Dieses App-Passwort darf nur lesen', 'read_only');
    if (request.auth?.app?.paused) throw devicePaused();
    if (request.auth && !request.auth.session) return;
    if (!sameOrigin(request)) throw forbidden('Die Anfrage kam von einer fremden Seite');
    const expected = request.auth?.session?.csrf ?? request.csrf;
    if (!safeEqual(String(request.headers['x-csrf-token'] ?? ''), expected)) {
      throw forbidden('Die Seite ist abgelaufen, lade sie neu und versuch es noch einmal');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    const media = request.auth?.session ? '(self)' : '()';
    reply.header(
      'Permissions-Policy',
      `camera=${media}, microphone=${media}, display-capture=${media}, geolocation=(), payment=(), usb=()`
    );
    if ((request.routeOptions.url ?? request.url).startsWith('/api/') && !reply.hasHeader('Cache-Control'))
      reply.header('Cache-Control', 'no-store');
    if (request.protocol === 'https' && !isLocalHost(request.host)) reply.header('Strict-Transport-Security', 'max-age=15552000');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) {
      if (!reply.hasHeader('Content-Security-Policy'))
        reply.header('Content-Security-Policy', pagePolicy(request.nonce, request.embeddable ? '*' : "'none'"));
      reply.header('Cross-Origin-Opener-Policy', 'same-origin');
      if (!reply.hasHeader('X-Frame-Options') && !request.embeddable) reply.header('X-Frame-Options', 'DENY');
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) {
      const url = request.url.startsWith('/wopi/') ? request.url.split('?')[0] : request.url;
      request.log.warn({ url, method: request.method, status: reply.statusCode }, 'request failed');
    } else request.log.debug({ url: request.url, method: request.method, status: reply.statusCode, ms: Math.round(reply.elapsedTime) });
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    const known = error instanceof HttpError;
    const status = known ? error.status : error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
      if (!known || status === 500) pulse().capture(error, { route: `${request.method} ${request.routeOptions.url ?? '?'}` });
    }
    const message = known
      ? t(request.lang, error.message, error.params)
      : status === 413
        ? t(request.lang, 'Die Anfrage ist zu groß')
        : status === 429
          ? t(request.lang, 'Zu viele Versuche, warte kurz und versuch es dann noch mal')
          : status < 500
            ? t(request.lang, 'Die Anfrage ist ungültig')
            : t(request.lang, 'Da ist etwas schiefgelaufen, versuch es noch einmal');
    if (isDav(request.url)) return reply.code(status).type('text/plain; charset=utf-8').send(message);
    const wantsHtml = request.method === 'GET' && !request.url.startsWith('/api/') && (request.headers.accept ?? '').includes('text/html');
    if (wantsHtml) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Fehler'),
        status,
        body: messagePage(request, {
          icon: status === 404 ? 'searchOff' : 'error',
          title: status === 404 ? t(request.lang, 'Hier ist nichts') : t(request.lang, 'Das hat nicht geklappt'),
          text: message,
          action: { label: t(request.lang, 'Zur Startseite'), href: '/' },
        }),
      });
    }
    return reply.code(status).send({ error: { code: known ? error.code : 'error', message, ...(known ? error.extra : {}) } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.method !== 'GET') {
      return reply.code(404).send({ error: { code: 'not_found', message: t(request.lang, 'Nicht gefunden') } });
    }
    return renderDocument(request, reply, {
      title: t(request.lang, 'Nicht gefunden'),
      status: 404,
      body: messagePage(request, {
        icon: 'searchOff',
        title: t(request.lang, 'Hier ist nichts'),
        text: t(request.lang, 'Diese Seite gibt es nicht oder nicht mehr.'),
        action: { label: t(request.lang, 'Zur Startseite'), href: '/' },
      }),
    });
  });

  await app.register(systemRoutes);
  await app.register(pageRoutes);
  await app.register(authRoutes);
  await app.register(setupRoutes);
  await app.register(fileRoutes);
  await app.register(tagRoutes);
  await app.register(albumRoutes);
  await app.register(formRoutes);
  await app.register(rewindRoutes);
  await app.register(pulseRoutes);
  await app.register(toolRoutes);
  await app.register(themeRoutes);
  await app.register(pluginRoutes);
  await app.register(uploadRoutes);
  await app.register(shareRoutes);
  await app.register(publicRoutes);
  await app.register(accountRoutes);
  await app.register(adminRoutes);
  await app.register(groupRoutes);
  await app.register(teamRoutes);
  await app.register(automationRoutes);
  await app.register(officeRoutes);
  await app.register(collaboraRoutes);
  await app.register(noteRoutes);
  await app.register(musicRoutes);
  await app.register(systemAdminRoutes);
  await app.register(eventRoutes);
  await app.register(securityRoutes);
  await app.register(davRoutes);
  await app.register(calendarRoutes);
  await app.register(schedulingRoutes);
  await app.register(calendarPublicRoutes);
  await app.register(caldavRoutes);
  await app.register(contactRoutes);
  await app.register(carddavRoutes);
  await app.register(metricsRoutes);

  return app;
}
