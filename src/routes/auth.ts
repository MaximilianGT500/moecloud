import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.ts';
import { renderDocument } from '../lib/html.ts';
import { isSecure, safeRedirect } from '../lib/http.ts';
import { t } from '../lib/i18n.ts';
import { body, checkFormCsrf } from '../lib/request.ts';
import { parse, displayName, email, password, username } from '../lib/validate.ts';
import { randomId } from '../lib/crypto.ts';
import { forgotPage, loginPage, registerPage, resetPage, secondFactorPage } from '../views/pages.ts';
import { audit } from '../services/audit.ts';
import { finishSecondFactor, passwordLogin, pendingUser, startSecondFactor, verifySecondFactor } from '../services/auth.ts';
import { mailReady } from '../services/mail.ts';
import { notifyAdmins } from '../services/notify.ts';
import { completeReset, findReset, requestReset } from '../services/resets.ts';
import { findInvite, useInvite } from '../services/invites.ts';
import { authenticate, authenticationOptions } from '../services/passkeys.ts';
import { clearSessionCookie, createSession, destroySession } from '../services/sessions.ts';
import * as settings from '../services/settings.ts';
import { isSetUp } from '../services/setup.ts';
import { createUser } from '../services/users.ts';

const PENDING_COOKIE = 'moe_2fa';
const PASSKEY_COOKIE = 'moe_wa';

const message = (request: FastifyRequest, error: unknown) => {
  if (error instanceof HttpError) return t(request.lang, error.message, error.params);
  throw error;
};

function showLogin(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { next: string; login?: string; error?: string | null; notice?: string | null; status?: number }
) {
  const registration = settings.get('auth.registration') === 'open';
  return renderDocument(request, reply, {
    title: t(request.lang, 'Anmelden'),
    status: options.status,
    body: loginPage(request, {
      csrf: request.csrf,
      next: options.next,
      login: options.login,
      error: options.error,
      notice: options.notice,
      registration,
      passkeys: settings.get('auth.passkeys'),
      forgot: mailReady(),
      announcement: settings.activeNotice(),
    }),
  });
}

const registerSchema = z.object({
  name: displayName,
  username,
  email: email.optional().default(''),
  password,
});

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { next?: string; registered?: string; logout?: string; expired?: string; reset?: string } }>(
    '/login',
    async (request, reply) => {
      if (!isSetUp()) return reply.redirect('/setup');
      const next = safeRedirect(request.query.next);
      if (request.auth?.session) return reply.redirect(next);
      const notice = request.query.logout
        ? t(request.lang, 'Du bist abgemeldet')
        : request.query.reset
          ? t(request.lang, 'Dein Passwort ist geändert, melde dich jetzt damit an')
          : null;
      const error = request.query.expired ? t(request.lang, 'Die Anmeldung ist abgelaufen, melde dich noch einmal an') : null;
      return showLogin(request, reply, { next, notice, error });
    }
  );

  app.post('/login', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const form = body<{ _csrf?: string; login?: string; password?: string; next?: string }>(request);
    const next = safeRedirect(form.next);
    const login = String(form.login ?? '').trim();
    try {
      checkFormCsrf(request, form._csrf);
      let user;
      try {
        user = await passwordLogin(request, login, String(form.password ?? ''));
      } catch (error) {
        if (error instanceof HttpError && error.status === 401)
          audit('login_failed', { request, details: { login: login.slice(0, 64), method: 'password' } });
        throw error;
      }
      if (user.totp_enabled) {
        const token = startSecondFactor(user, 'password');
        reply.setCookie(PENDING_COOKIE, token, { path: '/login', httpOnly: true, sameSite: 'lax', secure: isSecure(request), maxAge: 300 });
        return reply.redirect(`/login/2fa?next=${encodeURIComponent(next)}`, 303);
      }
      createSession(request, reply, user, 'password');
      audit('login', { actor: user.id, request, details: { method: 'password' } });
      return reply.redirect(next, 303);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      return showLogin(request, reply, { next, login, error: message(request, error), status });
    }
  });

  app.get<{ Querystring: { next?: string } }>('/login/2fa', async (request, reply) => {
    const next = safeRedirect(request.query.next);
    if (!pendingUser(request.cookies[PENDING_COOKIE])) return reply.redirect(`/login?expired=1&next=${encodeURIComponent(next)}`);
    return renderDocument(request, reply, {
      title: t(request.lang, 'Bestätigen'),
      body: secondFactorPage(request, { csrf: request.csrf, next }),
    });
  });

  app.post('/login/2fa', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const form = body<{ _csrf?: string; code?: string; next?: string }>(request);
    const next = safeRedirect(form.next);
    const token = request.cookies[PENDING_COOKIE];
    const pending = pendingUser(token);
    if (!pending || !token) return reply.redirect(`/login?expired=1&next=${encodeURIComponent(next)}`, 303);
    try {
      checkFormCsrf(request, form._csrf);
      if (!verifySecondFactor(request, pending.user, String(form.code ?? ''))) {
        audit('login_failed', { subject: pending.user.id, request, details: { login: pending.user.username, method: '2fa' } });
        throw badRequest('Der Code stimmt nicht');
      }
      finishSecondFactor(token);
      reply.clearCookie(PENDING_COOKIE, { path: '/login' });
      createSession(request, reply, pending.user, `${pending.method}+2fa`);
      audit('login', { actor: pending.user.id, request, details: { method: `${pending.method}+2fa` } });
      return reply.redirect(next, 303);
    } catch (error) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Bestätigen'),
        status: error instanceof HttpError ? error.status : 400,
        body: secondFactorPage(request, { csrf: request.csrf, next, error: message(request, error) }),
      });
    }
  });

  const registration = (token: string | undefined) => {
    const mode = settings.get('auth.registration');
    const invite = token ? findInvite(token) : null;
    if (token && !invite) throw notFound('Diese Einladung ist abgelaufen oder wurde schon genutzt');
    if (!invite && mode !== 'open') throw notFound('Neue Konten kann hier nur die Verwaltung anlegen');
    return { invite, token };
  };

  app.get<{ Querystring: { invite?: string } }>('/register', async (request, reply) => {
    if (!isSetUp()) return reply.redirect('/setup');
    if (request.auth?.session) return reply.redirect('/files');
    const { token } = registration(request.query.invite);
    return renderDocument(request, reply, {
      title: t(request.lang, 'Konto erstellen'),
      body: registerPage(request, { csrf: request.csrf, invite: token }),
    });
  });

  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const form = body<Record<string, string>>(request);
    const { invite, token } = registration(form.invite || undefined);
    try {
      checkFormCsrf(request, form._csrf);
      const input = parse(registerSchema, form);
      const user = await createUser({
        username: input.username,
        name: input.name,
        email: input.email || null,
        password: input.password,
        quota: invite?.quota_bytes ?? null,
        language: request.lang,
      });
      if (invite) useInvite(invite.id, user.id);
      createSession(request, reply, user, 'register');
      audit('registered', { actor: user.id, request, details: { invite: Boolean(invite) } });
      notifyAdmins('admin_user', { name: user.name, username: user.username }, '/admin/users');
      return reply.redirect('/files', 303);
    } catch (error) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Konto erstellen'),
        status: error instanceof HttpError ? error.status : 400,
        body: registerPage(request, {
          csrf: request.csrf,
          invite: token,
          error: message(request, error),
          values: { name: form.name ?? '', username: form.username ?? '', email: form.email ?? '' },
        }),
      });
    }
  });

  app.post('/logout', async (request, reply) => {
    const form = body<{ _csrf?: string }>(request);
    checkFormCsrf(request, form._csrf ?? request.headers['x-csrf-token']);
    if (request.auth?.session) destroySession(request.auth.session.id);
    clearSessionCookie(request, reply);
    if ((request.headers.accept ?? '').includes('application/json')) return { redirect: '/login?logout=1' };
    return reply.redirect('/login?logout=1', 303);
  });

  app.post('/api/auth/passkey/options', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!settings.get('auth.passkeys')) throw forbidden('Passkeys sind auf diesem Server ausgeschaltet');
    const key = randomId(24);
    reply.setCookie(PASSKEY_COOKIE, key, {
      path: '/api/auth/passkey',
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecure(request),
      maxAge: 300,
    });
    return authenticationOptions(request, key);
  });

  app.post('/api/auth/passkey/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const key = request.cookies[PASSKEY_COOKIE];
    if (!key) throw badRequest('Die Anfrage ist abgelaufen, versuch es noch einmal');
    const input = body<{ response?: unknown; next?: string }>(request);
    if (!input.response || typeof input.response !== 'object') throw badRequest('Die Antwort des Passkeys fehlt');
    const user = await authenticate(request, key, input.response as Parameters<typeof authenticate>[2]);
    reply.clearCookie(PASSKEY_COOKIE, { path: '/api/auth/passkey' });
    createSession(request, reply, user, 'passkey');
    audit('login', { actor: user.id, request, details: { method: 'passkey' } });
    return { redirect: safeRedirect(input.next) };
  });

  app.get<{ Querystring: { sent?: string } }>('/forgot', async (request, reply) => {
    if (!isSetUp()) return reply.redirect('/setup');
    if (!mailReady()) throw notFound('Ohne E-Mail-Versand kann dir nur die Verwaltung ein neues Passwort geben');
    return renderDocument(request, reply, {
      title: t(request.lang, 'Passwort vergessen'),
      body: forgotPage(request, { csrf: request.csrf, sent: request.query.sent === '1' }),
    });
  });

  app.post('/forgot', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    if (!mailReady()) throw notFound('Ohne E-Mail-Versand kann dir nur die Verwaltung ein neues Passwort geben');
    const form = body<{ _csrf?: string; login?: string }>(request);
    const login = String(form.login ?? '').trim();
    try {
      checkFormCsrf(request, form._csrf);
      if (!login) throw badRequest('Gib deinen Benutzernamen oder deine E-Mail-Adresse ein');
      await requestReset(request, login).catch((error: Error) =>
        request.log.warn({ error: error.message }, 'Mail für neues Passwort fehlgeschlagen')
      );
      return reply.redirect('/forgot?sent=1', 303);
    } catch (error) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Passwort vergessen'),
        status: error instanceof HttpError ? error.status : 400,
        body: forgotPage(request, { csrf: request.csrf, login, error: message(request, error) }),
      });
    }
  });

  app.get<{ Querystring: { token?: string } }>('/reset', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const token = String(request.query.token ?? '');
    const found = findReset(token);
    if (!found) throw notFound('Der Link ist abgelaufen oder wurde schon benutzt, fordere einen neuen an');
    return renderDocument(request, reply, {
      title: t(request.lang, 'Neues Passwort'),
      body: resetPage(request, { csrf: request.csrf, token, name: found.user.name }),
    });
  });

  app.post('/reset', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const form = body<{ _csrf?: string; token?: string; password?: string }>(request);
    const token = String(form.token ?? '');
    const found = findReset(token);
    try {
      checkFormCsrf(request, form._csrf);
      const { password: next } = parse(z.object({ password }), { password: String(form.password ?? '') });
      await completeReset(request, token, next);
      clearSessionCookie(request, reply);
      return reply.redirect('/login?reset=1', 303);
    } catch (error) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Neues Passwort'),
        status: error instanceof HttpError ? error.status : 400,
        body: resetPage(request, { csrf: request.csrf, token, name: found?.user.name, error: message(request, error) }),
      });
    }
  });
}
