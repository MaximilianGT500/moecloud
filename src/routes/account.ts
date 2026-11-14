import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { run, one } from '../lib/db.ts';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import { badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { me, setLanguageCookie } from '../lib/request.ts';
import { displayName, email, parse, password } from '../lib/validate.ts';
import { audit, listAudit, SECURITY_ACTIONS } from '../services/audit.ts';
import {
  beginTotp,
  disableTotp,
  enableTotp,
  secondFactorPending,
  newRecoveryCodes,
  passkeyCount,
  remainingRecoveryCodes,
  secondFactorRequired,
  verifySecondFactor,
} from '../services/auth.ts';
import { mailReady } from '../services/mail.ts';
import { oidcEnabled, unlink } from '../services/oidc.ts';
import { clearNotifications, listNotifications, markRead, unreadCount } from '../services/notify.ts';
import { createAppPassword, deleteAppPassword, listAppPasswords, presentAppPassword } from '../services/apppasswords.ts';
import { deletePasskey, listPasskeys, presentPasskey, register, registrationOptions, renamePasskey } from '../services/passkeys.ts';
import { forgetOtherDevices } from '../services/devices.ts';
import { exportName, exportStream } from '../services/export.ts';
import { describeSession, destroySession, destroyUserSessions, listSessions } from '../services/sessions.ts';
import * as settings from '../services/settings.ts';
import { getUser, keyOf, prefsOf, publicUser, storageOf, updatePrefs } from '../services/users.ts';

function session(request: FastifyRequest) {
  const current = request.auth?.session;
  if (!current) throw unauthorized('Dafür musst du im Browser angemeldet sein');
  return current;
}

const profileSchema = z.object({
  name: displayName.optional(),
  email: email.optional(),
  language: z.enum(['de', 'en']).optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/session', async (request) => {
    const user = me(request);
    return { user: publicUser(user), csrf: request.auth?.session?.csrf ?? request.csrf };
  });

  app.get('/api/account', async (request) => {
    const user = me(request);
    const current = request.auth?.session?.id ?? '';
    return {
      user: publicUser(user),
      storage: storageOf(user),
      passkeysEnabled: settings.get('auth.passkeys'),
      mail: mailReady(),
      prefs: prefsOf(user),
      security: {
        required: secondFactorRequired(user),
        setupRequired: secondFactorPending(user, request.auth?.session?.method),
        hasPassword: Boolean(user.password_hash),
        sso: user.oidc_sub ? { enabled: oidcEnabled() } : null,
        totp: Boolean(user.totp_enabled),
        recoveryCodes: user.totp_enabled ? remainingRecoveryCodes(user.id) : 0,
        passkeys: listPasskeys(user.id).map(presentPasskey),
        appPasswords: listAppPasswords(user.id).map(presentAppPassword),
        sessions: listSessions(user.id).map((entry) => describeSession(entry, current)),
      },
    };
  });

  app.patch('/api/account', async (request, reply) => {
    const user = me(request);
    const input = parse(profileSchema, request.body);
    if (input.email !== undefined && input.email !== (user.email ?? '')) {
      const key = input.email ? keyOf(input.email) : null;
      if (key && one('SELECT 1 FROM users WHERE email_key = ? AND id != ?', key, user.id))
        throw conflict('Die E-Mail-Adresse wird schon genutzt');
      run('UPDATE users SET email = ?, email_key = ? WHERE id = ?', input.email || null, key, user.id);
    }
    if (input.name) run('UPDATE users SET name = ? WHERE id = ?', input.name, user.id);
    if (input.language) {
      run('UPDATE users SET language = ? WHERE id = ?', input.language, user.id);
      setLanguageCookie(request, reply, input.language);
    }
    return { user: publicUser(getUser(user.id)!) };
  });

  app.delete('/api/account/sso', async (request) => {
    const user = me(request);
    unlink(user);
    audit('sso_unlinked', { actor: user.id, request });
    return { ok: true };
  });

  app.post('/api/account/password', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = me(request);
    const input = parse(z.object({ current: z.string().max(512).optional().default(''), next: password }), request.body);
    if (user.password_hash && !(await verifyPassword(user.password_hash, input.current)))
      throw badRequest('Das aktuelle Passwort stimmt nicht');
    run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(input.next), user.id);
    destroyUserSessions(user.id, request.auth?.session?.id);
    forgetOtherDevices(request, reply, user);
    audit('password_changed', { actor: user.id, request });
    return { ok: true };
  });

  app.patch('/api/account/prefs', async (request) => {
    const input = parse(
      z
        .object({
          mailShares: z.boolean(),
          mailUploads: z.boolean(),
          mailComments: z.boolean(),
          mailWatch: z.boolean(),
          mailAdmin: z.boolean(),
          mailLogins: z.boolean(),
        })
        .partial(),
      request.body
    );
    return { prefs: updatePrefs(me(request).id, input) };
  });

  app.get<{ Querystring: { before?: string } }>('/api/account/security', async (request) => {
    const before = Number(request.query.before);
    return listAudit({ user: me(request).id, actions: SECURITY_ACTIONS, before: before > 0 ? before : undefined, limit: 30 });
  });

  app.get('/api/notifications', async (request) => {
    const user = me(request);
    return { items: listNotifications(user.id, request.lang), unread: unreadCount(user.id) };
  });

  app.post('/api/notifications/read', async (request) => {
    const input = parse(z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }), request.body);
    markRead(me(request).id, input.ids);
    return { ok: true };
  });

  app.delete('/api/notifications', async (request) => {
    clearNotifications(me(request).id);
    return { ok: true };
  });

  app.post('/api/account/totp/setup', async (request) => beginTotp(me(request)));

  app.post('/api/account/totp/enable', async (request) => {
    const { code } = parse(z.object({ code: z.string().max(20) }), request.body);
    const codes = enableTotp(getUser(me(request).id)!, code);
    audit('totp_enabled', { actor: me(request).id, request });
    return { recoveryCodes: codes };
  });

  app.post('/api/account/totp/disable', async (request) => {
    const { code } = parse(z.object({ code: z.string().max(20) }), request.body);
    disableTotp(request, me(request), code);
    audit('totp_disabled', { actor: me(request).id, request });
    return { ok: true };
  });

  app.post('/api/account/totp/recovery', async (request) => {
    const user = me(request);
    const { code } = parse(z.object({ code: z.string().max(20) }), request.body);
    if (!user.totp_enabled) throw badRequest('Richte zuerst die Authenticator-App ein');
    if (!verifySecondFactor(request, user, code)) throw badRequest('Der Code stimmt nicht');
    audit('recovery_codes', { actor: user.id, request });
    return { recoveryCodes: newRecoveryCodes(user.id) };
  });

  app.post('/api/account/passkeys/options', async (request) => registrationOptions(request, me(request), session(request).id));

  app.post('/api/account/passkeys', async (request) => {
    const input = parse(
      z.object({ response: z.record(z.string(), z.unknown()), name: z.string().max(60).optional().default('') }),
      request.body
    );
    const passkey = await register(request, me(request), session(request).id, input.response as never, input.name);
    audit('passkey_added', { actor: me(request).id, request, details: { name: passkey.name } });
    return { passkey: presentPasskey(passkey) };
  });

  app.patch<{ Params: { id: string } }>('/api/account/passkeys/:id', async (request) => {
    const { name } = parse(z.object({ name: z.string().max(60) }), request.body);
    renamePasskey(me(request), request.params.id, name);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/account/passkeys/:id', async (request) => {
    const user = me(request);
    if (secondFactorRequired(user) && !user.totp_enabled && settings.get('auth.passkeys') && passkeyCount(user.id) <= 1) {
      throw badRequest(
        'Die Verwaltung verlangt einen zweiten Faktor. Richte zuerst die Authenticator-App ein, bevor du deinen letzten Passkey entfernst.'
      );
    }
    deletePasskey(user, request.params.id);
    audit('passkey_removed', { actor: me(request).id, request });
    return { ok: true };
  });

  app.post('/api/account/app-passwords', async (request) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, 'Gib dem App-Passwort einen Namen').max(60) }), request.body);
    const { token, row } = createAppPassword(me(request), name);
    audit('app_password_created', { actor: me(request).id, request, details: { name: row.name } });
    return { token, item: presentAppPassword(row) };
  });

  app.delete<{ Params: { id: string } }>('/api/account/app-passwords/:id', async (request) => {
    deleteAppPassword(me(request), request.params.id);
    audit('app_password_removed', { actor: me(request).id, request });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/account/sessions/:id', async (request) => {
    const user = me(request);
    if (run('DELETE FROM sessions WHERE id = ? AND user_id = ?', request.params.id, user.id).changes === 0) return { ok: false };
    return { ok: true };
  });

  app.get('/api/account/export', { compress: false, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const user = me(request);
    audit('account_exported', { actor: user.id, request });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', contentDisposition(exportName(user), 'attachment'));
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(exportStream(user));
  });

  app.post('/api/account/sessions/revoke-others', async (request, reply) => {
    destroyUserSessions(me(request).id, session(request).id);
    forgetOtherDevices(request, reply, me(request));
    audit('sessions_revoked', { actor: me(request).id, request });
    return { ok: true };
  });

  app.post('/api/language', async (request, reply) => {
    const { language } = parse(z.object({ language: z.enum(['de', 'en']) }), request.body);
    setLanguageCookie(request, reply, language);
    if (request.auth) run('UPDATE users SET language = ? WHERE id = ?', language, request.auth.user.id);
    return { ok: true };
  });

  app.delete('/api/account/session', async (request) => {
    destroySession(session(request).id);
    return { ok: true };
  });
}
