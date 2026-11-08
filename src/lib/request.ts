import type { FastifyReply, FastifyRequest } from 'fastify';
import { safeEqual } from './crypto.ts';
import { forbidden, unauthorized } from './errors.ts';
import { isSecure, sameOrigin } from './http.ts';
import type { Lang } from './i18n.ts';
import type { SessionRow } from '../services/sessions.ts';
import type { UserRow } from '../services/users.ts';

export interface RequestAuth {
  user: UserRow;
  session: SessionRow | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null;
    lang: Lang;
    nonce: string;
    csrf: string;
  }
}

export const CSRF_COOKIE = 'moe_csrf';
export const LANG_COOKIE = 'moe_lang';

export function setLanguageCookie(request: FastifyRequest, reply: FastifyReply, lang: Lang) {
  reply.setCookie(LANG_COOKIE, lang, { path: '/', sameSite: 'lax', secure: isSecure(request), maxAge: 365 * 86_400 });
}

export function checkFormCsrf(request: FastifyRequest, token: unknown) {
  if (!sameOrigin(request)) throw forbidden('Die Anfrage kam von einer fremden Seite');
  const expected = request.auth?.session?.csrf ?? request.csrf;
  if (typeof token !== 'string' || !safeEqual(token, expected)) {
    throw forbidden('Die Seite ist abgelaufen, lade sie neu und versuch es noch einmal');
  }
}

export function me(request: FastifyRequest): UserRow {
  if (!request.auth) throw unauthorized();
  return request.auth.user;
}

export function admin(request: FastifyRequest): UserRow {
  const user = me(request);
  if (user.role !== 'admin') throw forbidden('Das dürfen nur Admins');
  return user;
}

export const body = <T = Record<string, unknown>>(request: FastifyRequest) => (request.body ?? {}) as T;
