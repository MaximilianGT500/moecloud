import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { run, one } from '../lib/db.ts';
import { verifyPassword } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.ts';
import { Limiter } from '../lib/limiter.ts';
import { publish } from '../lib/events.ts';
import { t } from '../lib/i18n.ts';
import { contentDisposition, sendFile } from '../lib/http.ts';
import { me, sessionRequired, setLanguageCookie } from '../lib/request.ts';
import { displayName, email, intOf, parse, password } from '../lib/validate.ts';
import { audit, listAudit, SECURITY_ACTIONS } from '../services/audit.ts';
import { avatarFile, readLimited, removeAvatar, setAvatar } from '../services/avatars.ts';
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
import { deliver, mailReady } from '../services/mail.ts';
import { oidcEnabled, unlink } from '../services/oidc.ts';
import { clearNotifications, listNotifications, markRead, notify, unreadCount } from '../services/notify.ts';
import { createAppPassword, deleteAppPassword, listAppPasswords, presentAppPassword } from '../services/apppasswords.ts';
import { deletePasskey, listPasskeys, presentPasskey, register, registrationOptions, renamePasskey } from '../services/passkeys.ts';
import { deleteOwnAccount, selfDeleteAllowed } from '../services/accounts.ts';
import { forgetOtherDevices } from '../services/devices.ts';
import { exportName, exportStream } from '../services/export.ts';
import { changeOwnPassword } from '../services/ownpassword.ts';
import { clearSessionCookie, describeSession, destroySession, destroyUserSessions, listSessions } from '../services/sessions.ts';
import * as settings from '../services/settings.ts';
import { validZone } from '../services/notify.ts';
import { passwordMin } from '../services/passwords.ts';
import { pushUrl, sendPush } from '../services/push.ts';
import { listSubscriptions, removeSubscription, saveSubscription, sendWebPush, vapidKeys } from '../services/webpush.ts';
import {
  getUser,
  keyOf,
  preferredLanguage,
  prefsOf,
  publicUser,
  storageOf,
  updatePrefs,
  type PushTarget,
  type UserPrefs,
} from '../services/users.ts';
import { activePlugins } from '../services/plugins.ts';

const shownPrefs = ({ push, ...prefs }: UserPrefs) => prefs;
const keyList = z.array(z.string().min(1).max(80)).max(60);
const shownPush = (target: PushTarget | null) => (target ? { kind: target.kind, url: target.url, hasToken: Boolean(target.token) } : null);

function session(request: FastifyRequest) {
  const current = request.auth?.session;
  if (!current) throw unauthorized('Dafür musst du im Browser angemeldet sein');
  return current;
}

const profileSchema = z.object({
  name: displayName.optional(),
  email: email.optional(),
  language: z.enum(['de', 'en']).optional(),
  password: z.string().max(512).optional(),
});

const confirmations = new Limiter(10, 10 * 60 * 1000);

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/session', async (request) => {
    const user = me(request);
    return { user: publicUser(user), csrf: request.auth?.session?.csrf ?? request.csrf, mustChangePassword: Boolean(user.must_change) };
  });

  app.put('/api/account/avatar', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const body = request.body as Readable | undefined;
    if (!body || typeof body.pipe !== 'function') throw badRequest('Schick das Bild als application/octet-stream');
    const avatar = await setAvatar(user, await readLimited(body));
    publish([user.id], 'account', { avatar });
    return { avatar };
  });

  app.delete('/api/account/avatar', async (request) => {
    const user = me(request);
    await removeAvatar(user.id);
    publish([user.id], 'account', { avatar: null });
    return { avatar: null };
  });

  app.get<{ Params: { id: string } }>('/api/avatars/:id', { compress: false }, async (request, reply) => {
    me(request);
    const owner = getUser(intOf(request.params.id));
    const file = owner ? await avatarFile(owner) : null;
    if (!file) throw notFound();
    return sendFile(request, reply, {
      path: file.path,
      size: file.size,
      type: 'image/webp',
      etag: `a-${file.stamp}`,
      modified: file.modified,
      name: 'avatar.webp',
      disposition: 'inline',
      cache: 'private, max-age=31536000, immutable',
    });
  });

  app.get('/api/account', async (request) => {
    const user = me(request);
    const current = request.auth?.session?.id ?? '';
    return {
      user: publicUser(user),
      storage: storageOf(user),
      passkeysEnabled: settings.get('auth.passkeys'),
      mail: mailReady(),
      prefs: shownPrefs(prefsOf(user)),
      push: settings.get('push.enabled') ? shownPush(prefsOf(user).push) : null,
      pushEnabled: settings.get('push.enabled'),
      passwordMin: passwordMin(),
      webPush: settings.get('push.enabled') ? listSubscriptions(user, request.lang).length : 0,
      expiresAt: user.expires_at ?? null,
      selfDelete: selfDeleteAllowed(user),
      plugins: activePlugins().length > 0,
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
      if (!request.auth?.session) throw sessionRequired();
      if (user.password_hash) {
        const attempt = String(user.id);
        confirmations.check(attempt);
        if (!input.password) {
          throw new HttpError(400, 'Gib dein aktuelles Passwort ein, um die E-Mail-Adresse zu ändern', 'password_required');
        }
        if (!(await verifyPassword(user.password_hash, input.password))) {
          confirmations.hit(attempt);
          throw new HttpError(400, 'Das aktuelle Passwort stimmt nicht', 'password_required');
        }
      }
      const key = input.email ? keyOf(input.email) : null;
      if (key && one('SELECT 1 FROM users WHERE email_key = ? AND id != ?', key, user.id))
        throw conflict('Die E-Mail-Adresse wird schon genutzt');
      run('UPDATE users SET email = ?, email_key = ? WHERE id = ?', input.email || null, key, user.id);
      audit('email_changed', { actor: user.id, request });
      notify(user.id, 'account_change', { change: 'email' }, '/account', { email: false });
      if (user.email && mailReady()) {
        const lang = preferredLanguage(user);
        const site = settings.get('site.name');
        await deliver(user.email, {
          lang,
          title: t(lang, 'Die E-Mail-Adresse deines Kontos wurde geändert'),
          lines: [
            input.email
              ? t(lang, 'Für dein Konto „{name}“ bei {site} gilt jetzt die Adresse {email}.', {
                  name: user.username,
                  site,
                  email: input.email,
                })
              : t(lang, 'Bei deinem Konto „{name}“ bei {site} ist jetzt keine E-Mail-Adresse mehr hinterlegt.', {
                  name: user.username,
                  site,
                }),
            t(lang, 'An diese alte Adresse schickt MoeCloud ab jetzt nichts mehr.'),
          ],
          note: t(lang, 'Warst du das nicht, dann melde dich sofort bei der Verwaltung.'),
        }).catch((error: Error) => request.log.warn({ error: error.message }, 'Hinweis zur geänderten Adresse nicht zugestellt'));
      }
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
    await changeOwnPassword(request, reply, user, input.current, input.next);
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
          mailReminders: z.boolean(),
          mailPlugins: z.boolean(),
          digest: z.enum(['off', 'daily', 'weekly']),
          quiet: z
            .object({ from: z.number().int().min(0).max(1439), to: z.number().int().min(0).max(1439) })
            .refine((value) => value.from !== value.to, 'Beginn und Ende der Ruhezeit dürfen nicht gleich sein')
            .nullable(),
          zone: z.string().max(64).refine(validZone, 'Diese Zeitzone kennt MoeCloud nicht'),
          start: z.enum(['files', 'home']),
          nav: z
            .object({ order: keyList, hidden: keyList, bar: keyList.max(4, 'In die untere Leiste passen höchstens vier Einträge') })
            .nullable(),
          home: z.object({ order: keyList, hidden: keyList }).nullable(),
        })
        .partial(),
      request.body
    );
    const next = updatePrefs(me(request).id, input);
    return { prefs: next ? shownPrefs(next) : null };
  });

  app.put('/api/account/push', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    if (!settings.get('push.enabled')) throw forbidden('Push ist auf diesem Server ausgeschaltet');
    const input = parse(
      z.object({
        kind: z.enum(['ntfy', 'gotify']),
        url: z.string().min(1, 'Gib eine Adresse ein').max(500, 'Die Adresse ist zu lang'),
        token: z.string().max(500, 'Der Token ist zu lang').nullable().optional(),
      }),
      request.body
    );
    const current = prefsOf(user).push;
    const url = pushUrl(input.kind, input.url).href;
    const token = input.token === undefined ? (current?.kind === input.kind ? current.token : null) : input.token?.trim() || null;
    if (input.kind === 'gotify' && !token) throw badRequest('Gotify braucht einen App-Token');
    const next = updatePrefs(user.id, { push: { kind: input.kind, url, token } });
    return { push: shownPush(next?.push ?? null) };
  });

  app.get<{ Querystring: { endpoint?: string } }>('/api/account/webpush', async (request) => {
    const user = me(request);
    const enabled = settings.get('push.enabled');
    return {
      enabled,
      publicKey: enabled ? vapidKeys().publicKey : null,
      items: listSubscriptions(user, request.lang, request.query.endpoint),
    };
  });

  app.post('/api/account/webpush', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        endpoint: z.string().min(1).max(2000),
        keys: z.object({ p256dh: z.string().min(20).max(300), auth: z.string().min(8).max(100) }),
      }),
      request.body
    );
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
    const id = saveSubscription(user, input, { agent: request.headers['user-agent'], origin });
    return { id, items: listSubscriptions(user, request.lang, input.endpoint) };
  });

  app.delete<{ Params: { id: string } }>('/api/account/webpush/:id', async (request) => {
    removeSubscription(me(request), request.params.id);
    return { ok: true };
  });

  app.post('/api/account/webpush/test', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    if (!settings.get('push.enabled')) throw forbidden('Push ist auf diesem Server ausgeschaltet');
    const sent = await sendWebPush(user.id, {
      title: t(request.lang, 'Test von MoeCloud'),
      text: t(request.lang, 'Wenn du das liest, kommen Benachrichtigungen bei dir an.'),
      url: '/account#push',
    });
    if (!sent) throw badRequest('Die Testnachricht kam bei keinem Browser an');
    return { sent };
  });

  app.delete('/api/account/push', async (request) => {
    updatePrefs(me(request).id, { push: null });
    return { push: null };
  });

  app.post('/api/account/push/test', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    if (!settings.get('push.enabled')) throw forbidden('Push ist auf diesem Server ausgeschaltet');
    const target = prefsOf(user).push;
    if (!target) throw badRequest('Richte zuerst einen Push-Dienst ein');
    await sendPush(target, {
      title: t(request.lang, 'Test von MoeCloud'),
      text: t(request.lang, 'Wenn du das liest, kommen Benachrichtigungen bei dir an.'),
    });
    return { ok: true };
  });

  app.get<{ Querystring: { before?: string } }>('/api/account/security', async (request) => {
    const before = intOf(request.query.before);
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
    notify(me(request).id, 'account_change', { change: 'totp_on' }, '/account#sicherheit');
    return { recoveryCodes: codes };
  });

  app.post('/api/account/totp/disable', async (request) => {
    const { code } = parse(z.object({ code: z.string().max(20) }), request.body);
    disableTotp(request, me(request), code);
    audit('totp_disabled', { actor: me(request).id, request });
    notify(me(request).id, 'account_change', { change: 'totp_off' }, '/account#sicherheit');
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
    notify(me(request).id, 'account_change', { change: 'passkey_added' }, '/account#sicherheit');
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
    notify(user.id, 'account_change', { change: 'passkey_removed' }, '/account#sicherheit');
    return { ok: true };
  });

  app.post('/api/account/app-passwords', async (request) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(1, 'Gib dem App-Passwort einen Namen').max(60),
        readOnly: z.boolean().optional(),
        shared: z.boolean().optional(),
        admin: z.boolean().optional(),
        expiresAt: z.number().int().positive().nullable().optional(),
      }),
      request.body
    );
    const { token, row } = createAppPassword(me(request), input.name, input);
    audit('app_password_created', {
      actor: me(request).id,
      request,
      details: { name: row.name, readOnly: row.scope === 'read', ...(row.scope === 'admin' ? { admin: true } : {}) },
    });
    notify(
      me(request).id,
      'account_change',
      { change: row.scope === 'admin' ? 'app_password_admin' : 'app_password', name: row.name },
      '/account#sicherheit'
    );
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

  app.post('/api/account/delete', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = me(request);
    const input = parse(z.object({ password: z.string().max(1024).optional(), confirm: z.string().max(200) }), request.body);
    await deleteOwnAccount(request, user, input);
    clearSessionCookie(request, reply);
    return { ok: true };
  });

  app.post('/api/account/secure', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = me(request);
    const current = session(request);
    const input = parse(
      z.object({
        password: z.string().max(512).optional(),
        sessions: z.boolean().default(true),
        appPasswords: z.boolean().default(true),
        links: z.boolean().default(false),
      }),
      request.body
    );
    if (user.password_hash) {
      const attempt = String(user.id);
      confirmations.check(attempt);
      if (!(await verifyPassword(user.password_hash, input.password ?? ''))) {
        confirmations.hit(attempt);
        throw new HttpError(400, 'Das aktuelle Passwort stimmt nicht', 'password_required');
      }
    }
    const done = { sessions: 0, appPasswords: 0, links: 0 };
    if (input.sessions) {
      done.sessions = Number(destroyUserSessions(user.id, current.id).changes);
      forgetOtherDevices(request, reply, user);
      run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', user.id);
    }
    if (input.appPasswords) done.appPasswords = Number(run('DELETE FROM app_passwords WHERE user_id = ?', user.id).changes);
    if (input.links) done.links = Number(run('UPDATE links SET paused = 1 WHERE created_by = ? AND paused = 0', user.id).changes);
    audit('account_secured', { actor: user.id, request, details: done });
    notify(user.id, 'account_change', { change: 'secured' }, '/account#sitzungen');
    return done;
  });

  app.delete('/api/account/session', async (request) => {
    destroySession(session(request).id);
    return { ok: true };
  });
}
