import type { FastifyInstance } from 'fastify';
import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../config.ts';
import { clearLog, recentLog } from '../lib/log.ts';
import { all, one, run, value } from '../lib/db.ts';
import { hashPassword } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { liveCount } from '../lib/events.ts';
import { t } from '../lib/i18n.ts';
import { contentDisposition } from '../lib/http.ts';
import { admin } from '../lib/request.ts';
import { displayName, email, hexColor, intOf, palette, parse, password, quota, username } from '../lib/validate.ts';
import { AUDIT_ACTIONS, audit, auditCsv, listAudit, type AuditAction } from '../services/audit.ts';
import { hasSecondFactor, needsSecondFactor, resetTotp, secondFactorRequired } from '../services/auth.ts';
import { listBackups } from '../services/backups.ts';
import { createInvite, deleteInvite, listInvites, presentInvite } from '../services/invites.ts';
import { requireTeam } from '../services/teams.ts';
import { cleanTypes, validTypes } from '../services/filetypes.ts';
import { forgetDiscovery } from '../services/wopi.ts';
import { setStarter, starterState } from '../services/starter.ts';
import { ensureTermsVersion, renewTerms, termsState } from '../services/terms.ts';
import { serverGroups } from '../services/library.ts';
import { adminDeleteLink, allLinks, baseUrl, presentLink } from '../services/links.ts';
import { checkPassword, passwordMin } from '../services/passwords.ts';
import { sendReportTo } from '../services/report.ts';
import { listReports, resolveReport } from '../services/reports.ts';
import { deliver, mailReady } from '../services/mail.ts';
import { tools } from '../services/media.ts';
import { forgetOwners, getNode } from '../services/nodes.ts';
import { officeReady } from '../services/office.ts';
import type { Readable } from 'node:stream';
import { FEATURES } from '../../shared/features.ts';
import { isRegion } from '../../shared/holidays.ts';
import { rescheduleUser } from '../calendar/alarms.ts';
import { transferCalendars } from '../calendar/calendars.ts';
import { transferBooks } from '../contacts/books.ts';
import { isZone } from '../../shared/time.ts';
import { readLimited } from '../services/avatars.ts';
import { BRANDING, removeBranding, setBranding } from '../services/branding.ts';
import { cleanDomains, validDomains } from '../services/confirmations.ts';
import { pendingCount } from '../services/processing.ts';
import { sendResetByAdmin } from '../services/resets.ts';
import { scanEnabled, scanStats } from '../services/scan.ts';
import { destroyUserSessions, listSessions } from '../services/sessions.ts';
import * as settings from '../services/settings.ts';
import { transferFiles } from '../services/transfer.ts';
import { recordUsage, usageHistory } from '../services/usage.ts';
import { planImport, runImport } from '../services/userimport.ts';
import { updateStatus } from '../services/updates.ts';
import {
  adminCount,
  adminUser,
  approveUser,
  createUser,
  deleteUser,
  getUser,
  initials,
  isPerson,
  keyOf,
  listUsers,
  preferredLanguage,
  usageOf,
  updatePrefs,
  userCount,
} from '../services/users.ts';
import { runMaintenance } from '../services/jobs.ts';

const expiry = z.number().int().positive().max(253402300799000).nullable().optional();

const createSchema = z.object({
  username,
  name: displayName,
  email: email.optional().default(''),
  password: password.optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  quota: quota.nullable().optional(),
  sendLink: z.boolean().optional(),
  mustChange: z.boolean().optional(),
  expiresAt: expiry,
});

const updateSchema = z.object({
  name: displayName.optional(),
  email: email.optional(),
  role: z.enum(['admin', 'user', 'guest']).optional(),
  disabled: z.boolean().optional(),
  quota: quota.nullable().optional(),
  password: password.optional(),
  mustChange: z.boolean().optional(),
  expiresAt: expiry,
});

const webAddress = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value === '' || /^https?:\/\/[^/\s]+/.test(value), 'Die Adresse muss mit http:// oder https:// beginnen')
  .transform((value) => value.replace(/\/+$/, ''));

const mailHost = z
  .string()
  .trim()
  .min(1, 'Gib den Server an')
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$|^\[[0-9a-fA-F:.]+\]$/, 'Der Servername sieht nicht richtig aus');

const mailServer = z.object({
  host: mailHost,
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
});

const mailPreset = z.object({
  name: z.string().trim().min(1, 'Gib einen Namen ein').max(60),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .refine((value) => value === '' || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value), 'Schreib die Domain wie example.com'),
  login: z.enum(['email', 'local']),
  imap: mailServer,
  smtp: mailServer,
});

const settingsSchema = z
  .object({
    'site.name': z.string().trim().min(1, 'Gib deiner Cloud einen Namen').max(60),
    'site.url': z
      .string()
      .trim()
      .max(300)
      .refine((value) => value === '' || /^https?:\/\/[^/\s]+/.test(value), 'Die Adresse muss mit http:// oder https:// beginnen'),
    'site.seed': hexColor,
    'site.palette': palette,
    'themes.personal': z.boolean(),
    'site.language': z.enum(['de', 'en']),
    'site.imprint': z.string().max(20_000),
    'site.privacy': z.string().max(50_000),
    'site.terms': z.string().max(50_000),
    'terms.required': z.boolean(),
    'auth.registration': z.enum(['closed', 'open', 'invite', 'approval']),
    'auth.passkeys': z.boolean(),
    'auth.require2fa': z.enum(['off', 'admins', 'all']),
    'auth.passwordMin': z
      .number()
      .int()
      .min(10, 'Mindestens 10 Zeichen müssen es sein')
      .max(64, 'Mehr als 64 Zeichen kann niemand verlangen'),
    'auth.sessionDays': z.number().int().min(1, 'Mindestens ein Tag muss es sein').max(365, 'Mehr als 365 Tage gehen nicht'),
    'auth.sessionMaxDays': z.number().int().min(0).max(365, 'Mehr als 365 Tage gehen nicht'),
    'auth.passwordBreach': z.boolean(),
    'auth.confirmEmail': z.boolean(),
    'auth.domains': z
      .string()
      .max(1500)
      .refine(validDomains, 'Schreib Domains wie example.com, getrennt durch Kommas. Mehr als 50 gehen nicht')
      .transform(cleanDomains),
    'login.title': z.string().trim().max(60, 'Die Überschrift darf höchstens 60 Zeichen haben'),
    'login.text': z.string().trim().max(400, 'Der Text darf höchstens 400 Zeichen haben'),
    'login.layout': z.enum(['center', 'left', 'right']),
    'report.weekly': z.boolean(),
    'storage.defaultQuota': quota,
    'storage.maxUpload': quota,
    'accounts.inactiveDays': z
      .number()
      .int()
      .refine((value) => value === 0 || (value >= 30 && value <= 3650), 'Nimm 0 für nie oder 30 bis 3650 Tage'),
    'collabora.url': webAddress,
    'collabora.internal': webAddress,
    'collabora.host': webAddress,
    'storage.blockedTypes': z
      .string()
      .max(1500)
      .refine(validTypes, 'Eine Endung besteht aus Buchstaben und Ziffern, zum Beispiel exe. Mehr als 100 gehen nicht')
      .transform(cleanTypes),
    'storage.trashDays': z.number().int().min(0).max(3650),
    'storage.versions': z.number().int().min(0).max(100),
    'storage.versionDays': z.number().int().min(0).max(3650),
    'share.links': z.boolean(),
    'forms.enabled': z.boolean(),
    'calendar.enabled': z.boolean(),
    'accounts.features': z.array(z.enum(FEATURES)).max(FEATURES.length),
    'calendar.zone': z.string().max(64).refine(isZone, 'Diese Zeitzone kennt MoeCloud nicht'),
    'calendar.holidays': z
      .string()
      .max(10)
      .refine((value) => value === '' || isRegion(value), 'Diese Region kennt MoeCloud nicht'),
    'calendar.caldav': z.boolean(),
    'calendar.publicLinks': z.boolean(),
    'calendar.subscriptions': z.boolean(),
    'calendar.subscriptionsPrivate': z.boolean(),
    'calendar.imports': z.boolean(),
    'contacts.enabled': z.boolean(),
    'photos.enabled': z.boolean(),
    'music.enabled': z.boolean(),
    'notes.enabled': z.boolean(),
    'tags.enabled': z.boolean(),
    'tasks.enabled': z.boolean(),
    'webmail.enabled': z.boolean(),
    'webmail.custom': z.boolean(),
    'webmail.private': z.boolean(),
    'webmail.preset': mailPreset.nullable(),
    'webmail.maxAccounts': z.number().int().min(1).max(20),
    'chat.enabled': z.boolean(),
    'bookmarks.enabled': z.boolean(),
    'feeds.enabled': z.boolean(),
    'feeds.private': z.boolean(),
    'feeds.maxFeeds': z.number().int().min(1).max(2000),
    'snippets.enabled': z.boolean(),
    'accounts.welcome': z.boolean(),
    'calendar.maxSubscriptions': z.number().int().min(0).max(500),
    'calendar.minRefresh': z.number().int().min(5).max(1440),
    'calendar.booking': z.boolean(),
    'calendar.polls': z.boolean(),
    'calendar.externalInvites': z.boolean(),
    'calendar.freebusy': z.boolean(),
    'calendar.trashDays': z.number().int().min(0).max(3650),
    'share.users': z.boolean(),
    'share.requirePassword': z.boolean(),
    'share.maxDays': z.number().int().min(0).max(3650),
    'share.stripLocation': z.boolean(),
    'share.slugs': z.boolean(),
    'share.reports': z.boolean(),
    'users.directory': z.boolean(),
    'users.selfDelete': z.boolean(),
    'notice.text': z.string().max(500),
    'notice.level': z.enum(['info', 'warning']),
    'notice.until': z.number().int().min(0),
    'maintenance.enabled': z.boolean(),
    'maintenance.message': z.string().max(500),
    'backup.enabled': z.boolean(),
    'backup.hour': z.number().int().min(0).max(23),
    'backup.keep': z.number().int().min(1).max(90),
    'updates.check': z.boolean(),
    'audit.days': z.number().int().min(0).max(3650),
    'activity.days': z.number().int().min(0).max(3650),
    'search.content': z.boolean(),
    'import.enabled': z.boolean(),
    'import.private': z.boolean(),
    'push.enabled': z.boolean(),
    'push.private': z.boolean(),
    'integrity.schedule': z.enum(['off', 'weekly', 'monthly']),
    'security.ransomware': z.boolean(),
    'security.burst': z.boolean(),
    'security.burstPause': z.boolean(),
    'security.burstLimit': z.number().int().min(20, 'Mindestens 20').max(10_000, 'Höchstens 10.000'),
    'security.contact': z
      .string()
      .trim()
      .max(200)
      .refine(
        (value) =>
          value === '' ||
          /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~:/?#@%&=+,;-]*)?$/.test(value) ||
          /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value),
        'Trag eine E-Mail-Adresse oder eine Adresse mit https:// ein'
      ),
  })
  .partial();

function userView(user: Parameters<typeof adminUser>[0]) {
  return {
    ...adminUser(user),
    needs2fa: needsSecondFactor(user),
    sessions: listSessions(user.id).length,
    links: value<number>('SELECT COUNT(*) FROM links WHERE owner_id = ?', user.id) ?? 0,
    files: value<number>("SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND type = 'file' AND trashed_at IS NULL", user.id) ?? 0,
  };
}

function person(id: number) {
  const user = getUser(id);
  return user && isPerson(user) ? user : undefined;
}

const started = Date.now();

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (request) => {
    admin(request);
    recordUsage();
    const disk = await statfs(config.dataDir).catch(() => null);
    const top = all<{ owner_id: number; size: number; files: number }>(
      "SELECT owner_id, COALESCE(SUM(size), 0) AS size, COUNT(*) AS files FROM nodes WHERE type = 'file' GROUP BY owner_id ORDER BY size DESC LIMIT 6"
    ).map((row) => {
      const user = getUser(row.owner_id);
      return {
        id: row.owner_id,
        name: user?.name ?? '?',
        initials: initials(user?.name ?? '?'),
        avatar: user?.avatar ?? null,
        team: user?.role === 'team',
        size: row.size,
        files: row.files,
      };
    });
    const backups = await listBackups();
    const lastBackup = backups.find((backup) => backup.kind !== 'update') ?? null;
    return {
      version: config.version,
      node: process.version,
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage().rss,
      users: userCount(),
      active: value<number>('SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at > ?', Date.now() - 7 * 86_400_000) ?? 0,
      live: liveCount(),
      files: value<number>("SELECT COUNT(*) FROM nodes WHERE type = 'file'") ?? 0,
      folders: value<number>("SELECT COUNT(*) FROM nodes WHERE type = 'folder' AND parent_id IS NOT NULL") ?? 0,
      links: value<number>('SELECT COUNT(*) FROM links') ?? 0,
      logical: value<number>("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE type = 'file'") ?? 0,
      physical: value<number>('SELECT COALESCE(SUM(size), 0) FROM blobs') ?? 0,
      versions: value<number>('SELECT COUNT(*) FROM versions') ?? 0,
      disk: disk ? { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize } : null,
      groups: serverGroups(),
      top,
      health: {
        mail: mailReady(),
        scan: scanEnabled() ? scanStats() : null,
        backup: settings.get('backup.enabled') ? (lastBackup ? lastBackup.createdAt : 0) : null,
        processing: pendingCount(),
        tools: { ...tools, soffice: officeReady() },
        maintenance: settings.get('maintenance.enabled'),
        notice: settings.activeNotice(),
        failedLogins:
          value<number>("SELECT COUNT(*) FROM audit WHERE action = 'login_failed' AND created_at > ?", Date.now() - 86_400_000) ?? 0,
      },
      updates: updateStatus(),
      history: usageHistory(),
    };
  });

  app.get('/api/admin/users', async (request) => {
    admin(request);
    return { items: listUsers().map(userView), mail: mailReady(), passwordMin: passwordMin() };
  });

  app.post('/api/admin/users', async (request) => {
    const actor = admin(request);
    const input = parse(createSchema, request.body);
    if (!input.password && !(input.sendLink && input.email)) throw badRequest('Gib ein Passwort ein oder schick einen Link per E-Mail');
    if (input.password) await checkPassword(input.password);
    if (input.expiresAt && input.expiresAt <= Date.now()) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
    if (input.expiresAt && input.role === 'admin') throw badRequest('Admins bekommen kein Ablaufdatum');
    if (input.mustChange && !input.password)
      throw badRequest('Einen Passwortwechsel kannst du nur verlangen, wenn das Konto ein Passwort hat');
    const user = await createUser({
      username: input.username,
      name: input.name,
      email: input.email || null,
      password: input.password ?? null,
      role: input.role,
      quota: input.quota ?? null,
      expiresAt: input.expiresAt ?? null,
      mustChange: Boolean(input.mustChange),
    });
    audit('user_created', { actor: actor.id, subject: user.id, request, details: { role: user.role } });
    let sent = false;
    if (input.sendLink && user.email) {
      await sendResetByAdmin(request, actor, user);
      sent = true;
    }
    return { user: userView(user), sent };
  });

  app.post('/api/admin/users/import', { bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const actor = admin(request);
    const input = parse(
      z.object({
        csv: z.string().max(1_000_000, 'Die Datei ist zu groß'),
        sendLinks: z.boolean().default(false),
        mustChange: z.boolean().default(false),
        apply: z.boolean().default(false),
      }),
      request.body
    );
    if (!input.apply) return { lines: planImport(input.csv, input.sendLinks, request.lang).map((entry) => entry.shown), created: 0 };
    return runImport(request, actor, input.csv, input.sendLinks, input.mustChange);
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    const actor = admin(request);
    const user = person(intOf(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    const input = parse(updateSchema, request.body);
    const losesAdmin =
      ((input.role !== undefined && input.role !== 'admin') || input.disabled === true) && user.role === 'admin' && !user.disabled;
    if (losesAdmin && adminCount() <= 1) throw badRequest('Es muss immer mindestens einen Admin geben');
    if (user.id === actor.id && (input.disabled || (input.role !== undefined && input.role !== 'admin')))
      throw badRequest('Dich selbst kannst du nicht sperren oder herabstufen');
    if (input.role === 'guest' && user.role !== 'guest') {
      if (value<number>('SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND parent_id IS NOT NULL', user.id))
        throw badRequest('Diese Person hat noch eigene Dateien. Übertrage oder lösche sie, bevor du ein Gastkonto daraus machst');
      run('DELETE FROM team_managers WHERE user_id = ?', user.id);
    }
    const nextExpiry = input.expiresAt !== undefined ? input.expiresAt : (user.expires_at ?? null);
    if (nextExpiry && (input.role ?? user.role) === 'admin') throw badRequest('Admins bekommen kein Ablaufdatum');
    if (input.expiresAt && input.expiresAt <= Date.now()) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
    if (input.mustChange) {
      if (user.id === actor.id) throw badRequest('Dein eigenes Passwort änderst du im Konto');
      if (!user.password_hash && !input.password)
        throw badRequest('Einen Passwortwechsel kannst du nur verlangen, wenn das Konto ein Passwort hat');
    }
    const fields: string[] = [];
    if (input.email !== undefined && input.email !== (user.email ?? '')) {
      const key = input.email ? keyOf(input.email) : null;
      if (key && one('SELECT 1 FROM users WHERE email_key = ? AND id != ?', key, user.id))
        throw conflict('Die E-Mail-Adresse wird schon genutzt');
      run('UPDATE users SET email = ?, email_key = ? WHERE id = ?', input.email || null, key, user.id);
      fields.push('email');
    }
    if (input.name && input.name !== user.name) {
      run('UPDATE users SET name = ? WHERE id = ?', input.name, user.id);
      fields.push('name');
    }
    if (input.role && input.role !== user.role) {
      run('UPDATE users SET role = ? WHERE id = ?', input.role, user.id);
      forgetOwners();
      audit('role_changed', { actor: actor.id, subject: user.id, request, details: { role: input.role } });
    }
    if (input.quota !== undefined && input.quota !== user.quota_bytes) {
      run('UPDATE users SET quota_bytes = ? WHERE id = ?', input.quota, user.id);
      fields.push('quota');
    }
    if (input.expiresAt !== undefined && input.expiresAt !== (user.expires_at ?? null)) {
      run('UPDATE users SET expires_at = ? WHERE id = ?', input.expiresAt, user.id);
      updatePrefs(user.id, { expiryWarned: 0 });
      fields.push('expiresAt');
    }
    if (input.disabled !== undefined && input.disabled !== Boolean(user.disabled)) {
      run('UPDATE users SET disabled = ?, seen_at = ? WHERE id = ?', input.disabled, input.disabled ? user.seen_at : Date.now(), user.id);
      if (input.disabled) destroyUserSessions(user.id);
      audit(input.disabled ? 'user_disabled' : 'user_enabled', { actor: actor.id, subject: user.id, request });
    }
    if (input.password) {
      await checkPassword(input.password);
      run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(input.password), user.id);
      destroyUserSessions(user.id);
      audit('admin_password_set', { actor: actor.id, subject: user.id, request });
    }
    if (input.mustChange !== undefined && input.mustChange !== Boolean(user.must_change)) {
      run('UPDATE users SET must_change = ? WHERE id = ?', input.mustChange, user.id);
      fields.push('mustChange');
    }
    if (fields.length) audit('user_updated', { actor: actor.id, subject: user.id, request, details: { fields } });
    return { user: userView(getUser(user.id)!) };
  });

  app.delete<{ Params: { id: string }; Querystring: { transfer?: string } }>('/api/admin/users/:id', async (request) => {
    const actor = admin(request);
    const user = person(intOf(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    if (user.id === actor.id) throw badRequest('Dein eigenes Konto kannst du hier nicht löschen');
    if (user.role === 'admin' && adminCount() <= 1) throw badRequest('Es muss immer mindestens einen Admin geben');
    const transferTo = request.query.transfer ? person(intOf(request.query.transfer)) : null;
    if (request.query.transfer && (!transferTo || transferTo.id === user.id)) throw badRequest('Wähle eine andere Person für die Dateien');
    if (transferTo) {
      const folder = transferFiles(user, transferTo, t(preferredLanguage(transferTo), 'Von {name}', { name: user.name }));
      audit('files_transferred', {
        actor: actor.id,
        subject: transferTo.id,
        request,
        details: { from: user.username, folder: folder.name },
      });
    }
    const calendars = transferTo && transferTo.role !== 'guest' ? transferCalendars(user.id, transferTo.id, user.name) : 0;
    if (transferTo && transferTo.role !== 'guest') transferBooks(user.id, transferTo.id, user.name);
    deleteUser(user.id);
    if (transferTo && calendars) rescheduleUser(transferTo.id);
    audit('user_deleted', {
      actor: actor.id,
      request,
      details: { username: user.username, name: user.name, transfer: transferTo?.username ?? null },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/approve', async (request) => {
    const actor = admin(request);
    const target = person(intOf(request.params.id));
    if (!target) throw notFound('Diese Person gibt es nicht');
    if (!approveUser(target.id)) throw badRequest('Dieses Konto wartet nicht auf eine Freigabe');
    audit('user_approved', { actor: actor.id, subject: target.id, request, details: { username: target.username } });
    if (target.email && mailReady()) {
      const lang = target.language ?? settings.get('site.language');
      const url = settings.get('site.url').replace(/\/+$/, '');
      void deliver(target.email, {
        lang,
        title: t(lang, 'Dein Konto bei {site} ist freigegeben', { site: settings.get('site.name') }),
        lines: [
          t(lang, 'Hallo {name}, du kannst dich jetzt mit deinem Benutzernamen {username} und deinem Passwort anmelden.', {
            name: target.name,
            username: target.username,
          }),
        ],
        action: url ? { label: t(lang, 'Anmelden'), url: `${url}/login` } : undefined,
      }).catch((error: Error) => request.log.warn({ error: error.message }, 'Mail zur Freigabe fehlgeschlagen'));
    }
    return { user: userView(getUser(target.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-2fa', async (request) => {
    const actor = admin(request);
    const user = person(intOf(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    resetTotp(user.id);
    audit('admin_2fa_reset', { actor: actor.id, subject: user.id, request });
    return { user: userView(getUser(user.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-passkeys', async (request) => {
    const actor = admin(request);
    const user = person(intOf(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    const removed = run('DELETE FROM passkeys WHERE user_id = ?', user.id).changes;
    audit('admin_2fa_reset', { actor: actor.id, subject: user.id, request, details: { passkeys: removed } });
    return { user: userView(getUser(user.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/logout', async (request) => {
    const actor = admin(request);
    const user = person(intOf(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    destroyUserSessions(user.id);
    audit('admin_logout', { actor: actor.id, subject: user.id, request });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/send-reset',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      const actor = admin(request);
      const user = person(intOf(request.params.id));
      if (!user) throw notFound('Diese Person gibt es nicht');
      await sendResetByAdmin(request, actor, user).catch((error: Error) => {
        if (error.message === 'mail-not-configured') throw badRequest('Richte zuerst den E-Mail-Versand ein');
        throw error;
      });
      return { ok: true };
    }
  );

  app.get('/api/admin/settings', async (request) => {
    admin(request);
    return { settings: settings.adminView() };
  });

  app.patch('/api/admin/settings', async (request) => {
    const actor = admin(request);
    const input = parse(settingsSchema, request.body);
    if (input['site.seed'] && input['site.seed'] !== settings.get('site.seed') && !input['site.palette']) {
      throw badRequest('Zur neuen Grundfarbe fehlt die Farbpalette');
    }
    const changed = Object.keys(input).filter(
      (key) => JSON.stringify(input[key as keyof typeof input]) !== JSON.stringify(settings.get(key as settings.SettingKey))
    );
    const maintenance = input['maintenance.enabled'];
    const policy = input['auth.require2fa'];
    if (policy && changed.includes('auth.require2fa') && secondFactorRequired(actor, policy) && !hasSecondFactor(actor)) {
      throw badRequest('Richte zuerst für dein eigenes Konto eine Authenticator-App oder einen Passkey ein');
    }
    if (
      changed.includes('auth.passkeys') &&
      input['auth.passkeys'] === false &&
      secondFactorRequired(actor, policy) &&
      !actor.totp_enabled
    ) {
      throw badRequest('Ohne Passkeys fehlt dir der zweite Faktor. Richte zuerst die Authenticator-App ein.');
    }
    const wantsMail =
      (input['auth.confirmEmail'] ?? settings.get('auth.confirmEmail')) || Boolean(input['auth.domains'] ?? settings.get('auth.domains'));
    if (wantsMail && (changed.includes('auth.confirmEmail') || changed.includes('auth.domains')) && !mailReady()) {
      throw badRequest('Richte zuerst den E-Mail-Versand ein. Ohne ihn kommt die Bestätigung nicht an');
    }
    settings.setMany(input as Partial<settings.Settings>);
    if (settings.get('terms.required') && (changed.includes('terms.required') || changed.includes('site.terms'))) ensureTermsVersion(actor);
    if (changed.includes('collabora.url') || changed.includes('collabora.internal')) forgetDiscovery();
    if (changed.includes('site.seed')) settings.set('theme.site', null);
    if (maintenance !== undefined && changed.includes('maintenance.enabled')) {
      audit('maintenance', { actor: actor.id, request, details: { enabled: maintenance } });
    }
    const rest = changed.filter((key) => key !== 'site.palette' && key !== 'maintenance.enabled');
    if (rest.length) audit('settings_changed', { actor: actor.id, request, details: { keys: rest } });
    return { settings: settings.adminView() };
  });

  app.put<{ Params: { kind: string } }>(
    '/api/admin/branding/:kind',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request) => {
      const actor = admin(request);
      const kind = BRANDING.find((entry) => entry === request.params.kind);
      if (!kind) throw notFound();
      const body = request.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw badRequest('Schick das Bild als application/octet-stream');
      await setBranding(kind, await readLimited(body));
      audit('settings_changed', { actor: actor.id, request, details: { keys: [kind === 'logo' ? 'site.logo' : 'login.background'] } });
      return { settings: settings.adminView() };
    }
  );

  app.delete<{ Params: { kind: string } }>('/api/admin/branding/:kind', async (request) => {
    const actor = admin(request);
    const kind = BRANDING.find((entry) => entry === request.params.kind);
    if (!kind) throw notFound();
    await removeBranding(kind);
    audit('settings_changed', { actor: actor.id, request, details: { keys: [kind === 'logo' ? 'site.logo' : 'login.background'] } });
    return { settings: settings.adminView() };
  });

  app.get<{ Querystring: { level?: string } }>('/api/admin/log', async (request) => {
    admin(request);
    const level = request.query.level === 'error' ? 'error' : request.query.level === 'warn' ? 'warn' : 'info';
    return { items: recentLog(level), since: started, format: config.logFormat, level: config.logLevel };
  });

  app.delete('/api/admin/log', async (request) => {
    admin(request);
    clearLog();
    return { ok: true };
  });

  app.get('/api/admin/starter', async (request) => {
    admin(request);
    return starterState();
  });

  app.put('/api/admin/starter', async (request) => {
    const actor = admin(request);
    const input = parse(z.object({ folderId: z.string().min(1).max(64).nullable() }), request.body);
    const state = setStarter(actor, input.folderId);
    audit('settings_changed', { actor: actor.id, request, details: { keys: ['accounts.starter'] } });
    return state;
  });

  app.get('/api/admin/terms', async (request) => {
    admin(request);
    return termsState();
  });

  app.post('/api/admin/terms/renew', async (request) => {
    const actor = admin(request);
    const state = renewTerms(actor);
    audit('settings_changed', { actor: actor.id, request, details: { keys: ['terms.version'] } });
    return state;
  });

  app.get('/api/admin/invites', async (request) => {
    admin(request);
    return { items: listInvites().map(presentInvite), mail: mailReady() };
  });

  app.post('/api/admin/invites', async (request) => {
    const actor = admin(request);
    const input = parse(
      z.object({
        note: z.string().max(120).nullable().optional(),
        days: z.number().int().min(1).max(90).default(7),
        quota: quota.nullable().optional(),
        email: email.optional(),
        role: z.enum(['user', 'guest']).default('user'),
        teamId: z.number().int().positive().nullable().optional(),
        teamRole: z.enum(['view', 'edit']).optional(),
      }),
      request.body
    );
    const address = input.email?.trim() || null;
    if (address && !mailReady()) throw badRequest('Richte zuerst den E-Mail-Versand ein');
    const team = input.teamId ? requireTeam(input.teamId) : null;
    const { token, invite } = createInvite(
      actor,
      input.note ?? null,
      input.days,
      input.role === 'guest' ? null : (input.quota ?? null),
      address,
      {
        role: input.role,
        teamId: team?.id ?? null,
        teamRole: input.teamRole ?? 'view',
      }
    );
    const url = `${baseUrl(request)}/register?invite=${token}`;
    audit('invite_created', { actor: actor.id, request, details: { days: input.days, email: Boolean(address) } });
    if (address) {
      const lang = settings.get('site.language');
      const site = settings.get('site.name');
      await deliver(address, {
        lang,
        title: t(lang, '{name} lädt dich zu {site} ein', { name: actor.name, site }),
        lines: [
          t(lang, 'Mit dieser Einladung legst du dir ein Konto an und kannst Dateien speichern und teilen.'),
          input.days === 1
            ? t(lang, 'Der Link gilt einen Tag und funktioniert einmal.')
            : t(lang, 'Der Link gilt {days} Tage und funktioniert einmal.', { days: input.days }),
        ],
        action: { label: t(lang, 'Konto erstellen'), url },
      });
    }
    return { invite: presentInvite(invite), url, sent: Boolean(address) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/invites/:id', async (request) => {
    const actor = admin(request);
    deleteInvite(request.params.id);
    audit('invite_deleted', { actor: actor.id, request });
    return { ok: true };
  });

  app.get('/api/admin/links', async (request) => {
    admin(request);
    return {
      items: allLinks().map((link) => {
        const node = getNode(link.node_id);
        const owner = getUser(link.owner_id);
        const creator = link.created_by === link.owner_id ? owner : getUser(link.created_by);
        return {
          ...presentLink(link, request),
          node: node ? { id: node.id, name: node.name, type: node.type, trashed: Boolean(node.trashed_at) } : null,
          owner: owner ? { id: owner.id, name: owner.name, username: owner.username } : null,
          creator: creator ? { id: creator.id, name: creator.name } : null,
        };
      }),
    };
  });

  app.post('/api/admin/report/send', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    const actor = admin(request);
    if (!mailReady()) throw badRequest('Der E-Mail-Versand ist auf diesem Server nicht eingerichtet');
    if (!actor.email) throw badRequest('Hinterleg unter Konto eine E-Mail-Adresse, dann kommt der Bericht an');
    await sendReportTo(actor);
    return { ok: true };
  });

  app.get('/api/admin/reports', async (request) => {
    admin(request);
    return { items: listReports() };
  });

  app.post<{ Params: { id: string } }>('/api/admin/reports/:id/resolve', async (request) => {
    const actor = admin(request);
    const input = parse(z.object({ pause: z.boolean().default(false) }), request.body ?? {});
    const report = resolveReport(request.params.id, input.pause);
    audit('report_resolved', {
      actor: actor.id,
      subject: report.owner_id ?? undefined,
      request,
      details: { label: report.label, reason: report.reason, paused: input.pause },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/links/:id', async (request) => {
    const actor = admin(request);
    const link = adminDeleteLink(request.params.id);
    audit('link_removed', { actor: actor.id, subject: link.owner_id, request, details: { label: link.label } });
    return { ok: true };
  });

  app.get<{ Querystring: { before?: string; user?: string; action?: string } }>('/api/admin/audit', async (request) => {
    admin(request);
    const before = intOf(request.query.before);
    const user = intOf(request.query.user);
    const actions = String(request.query.action ?? '')
      .split(',')
      .filter((action): action is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(action));
    return {
      ...listAudit({ before: before > 0 ? before : undefined, user: user > 0 ? user : undefined, actions, limit: 50 }),
      actions: AUDIT_ACTIONS,
    };
  });

  app.get<{ Querystring: { user?: string; action?: string } }>('/api/admin/audit/export', async (request, reply) => {
    const actor = admin(request);
    const user = intOf(request.query.user);
    const actions = String(request.query.action ?? '')
      .split(',')
      .filter((action): action is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(action));
    const csv = auditCsv({ user: user > 0 ? user : undefined, actions }, [
      t(request.lang, 'Zeit'),
      t(request.lang, 'Ereignis'),
      t(request.lang, 'Benutzername'),
      t(request.lang, 'Name'),
      t(request.lang, 'Betrifft'),
      t(request.lang, 'Adresse'),
      t(request.lang, 'Details'),
    ]);
    audit('audit_exported', { actor: actor.id, request, details: { rows: csv.rows } });
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition(`moecloud-protokoll-${new Date().toISOString().slice(0, 10)}.csv`, 'attachment'))
      .send(csv.text);
  });

  app.post('/api/admin/maintenance', async (request) => {
    admin(request);
    return runMaintenance();
  });

  app.get('/api/admin/people', async (request) => {
    admin(request);
    return { items: listUsers().map((user) => ({ id: user.id, name: user.name, username: user.username, used: usageOf(user.id) })) };
  });
}
