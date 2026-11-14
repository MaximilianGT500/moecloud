import type { FastifyInstance } from 'fastify';
import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../config.ts';
import { all, one, run, value } from '../lib/db.ts';
import { hashPassword } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { liveCount } from '../lib/events.ts';
import { t } from '../lib/i18n.ts';
import { admin } from '../lib/request.ts';
import { displayName, email, hexColor, palette, parse, password, quota, username } from '../lib/validate.ts';
import { AUDIT_ACTIONS, audit, listAudit, type AuditAction } from '../services/audit.ts';
import { hasSecondFactor, needsSecondFactor, resetTotp, secondFactorRequired } from '../services/auth.ts';
import { listBackups } from '../services/backups.ts';
import { createInvite, deleteInvite, listInvites, presentInvite } from '../services/invites.ts';
import { serverGroups } from '../services/library.ts';
import { adminDeleteLink, allLinks, baseUrl, presentLink } from '../services/links.ts';
import { deliver, mailReady } from '../services/mail.ts';
import { tools } from '../services/media.ts';
import { getNode } from '../services/nodes.ts';
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
  createUser,
  deleteUser,
  getUser,
  initials,
  keyOf,
  listUsers,
  preferredLanguage,
  usageOf,
} from '../services/users.ts';
import { runMaintenance } from '../services/jobs.ts';

const createSchema = z.object({
  username,
  name: displayName,
  email: email.optional().default(''),
  password: password.optional(),
  role: z.enum(['admin', 'user']).default('user'),
  quota: quota.nullable().optional(),
  sendLink: z.boolean().optional(),
});

const updateSchema = z.object({
  name: displayName.optional(),
  email: email.optional(),
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  quota: quota.nullable().optional(),
  password: password.optional(),
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
    'site.language': z.enum(['de', 'en']),
    'site.imprint': z.string().max(20_000),
    'site.privacy': z.string().max(50_000),
    'auth.registration': z.enum(['closed', 'open', 'invite']),
    'auth.passkeys': z.boolean(),
    'auth.require2fa': z.enum(['off', 'admins', 'all']),
    'storage.defaultQuota': quota,
    'storage.maxUpload': quota,
    'storage.trashDays': z.number().int().min(0).max(3650),
    'storage.versions': z.number().int().min(0).max(100),
    'storage.versionDays': z.number().int().min(0).max(3650),
    'share.links': z.boolean(),
    'share.users': z.boolean(),
    'share.requirePassword': z.boolean(),
    'share.maxDays': z.number().int().min(0).max(3650),
    'share.stripLocation': z.boolean(),
    'users.directory': z.boolean(),
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

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (request) => {
    admin(request);
    recordUsage();
    const disk = await statfs(config.dataDir).catch(() => null);
    const top = all<{ owner_id: number; size: number; files: number }>(
      "SELECT owner_id, COALESCE(SUM(size), 0) AS size, COUNT(*) AS files FROM nodes WHERE type = 'file' GROUP BY owner_id ORDER BY size DESC LIMIT 6"
    ).map((row) => {
      const user = getUser(row.owner_id);
      return { id: row.owner_id, name: user?.name ?? '?', initials: initials(user?.name ?? '?'), size: row.size, files: row.files };
    });
    const backups = await listBackups();
    const lastBackup = backups.find((backup) => backup.kind !== 'update') ?? null;
    return {
      version: config.version,
      node: process.version,
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage().rss,
      users: value<number>('SELECT COUNT(*) FROM users') ?? 0,
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
        tools: { ...tools },
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
    return { items: listUsers().map(userView), mail: mailReady() };
  });

  app.post('/api/admin/users', async (request) => {
    const actor = admin(request);
    const input = parse(createSchema, request.body);
    if (!input.password && !(input.sendLink && input.email)) throw badRequest('Gib ein Passwort ein oder schick einen Link per E-Mail');
    const user = await createUser({
      username: input.username,
      name: input.name,
      email: input.email || null,
      password: input.password ?? null,
      role: input.role,
      quota: input.quota ?? null,
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
        apply: z.boolean().default(false),
      }),
      request.body
    );
    if (!input.apply) return { lines: planImport(input.csv, input.sendLinks, request.lang).map((entry) => entry.shown), created: 0 };
    return runImport(request, actor, input.csv, input.sendLinks);
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    const actor = admin(request);
    const user = getUser(Number(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    const input = parse(updateSchema, request.body);
    const losesAdmin = (input.role === 'user' || input.disabled === true) && user.role === 'admin' && !user.disabled;
    if (losesAdmin && adminCount() <= 1) throw badRequest('Es muss immer mindestens einen Admin geben');
    if (user.id === actor.id && (input.disabled || input.role === 'user'))
      throw badRequest('Dich selbst kannst du nicht sperren oder herabstufen');
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
      audit('role_changed', { actor: actor.id, subject: user.id, request, details: { role: input.role } });
    }
    if (input.quota !== undefined && input.quota !== user.quota_bytes) {
      run('UPDATE users SET quota_bytes = ? WHERE id = ?', input.quota, user.id);
      fields.push('quota');
    }
    if (input.disabled !== undefined && input.disabled !== Boolean(user.disabled)) {
      run('UPDATE users SET disabled = ? WHERE id = ?', input.disabled, user.id);
      if (input.disabled) destroyUserSessions(user.id);
      audit(input.disabled ? 'user_disabled' : 'user_enabled', { actor: actor.id, subject: user.id, request });
    }
    if (input.password) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(input.password), user.id);
      destroyUserSessions(user.id);
      audit('admin_password_set', { actor: actor.id, subject: user.id, request });
    }
    if (fields.length) audit('user_updated', { actor: actor.id, subject: user.id, request, details: { fields } });
    return { user: userView(getUser(user.id)!) };
  });

  app.delete<{ Params: { id: string }; Querystring: { transfer?: string } }>('/api/admin/users/:id', async (request) => {
    const actor = admin(request);
    const user = getUser(Number(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    if (user.id === actor.id) throw badRequest('Dein eigenes Konto kannst du hier nicht löschen');
    if (user.role === 'admin' && adminCount() <= 1) throw badRequest('Es muss immer mindestens einen Admin geben');
    const transferTo = request.query.transfer ? getUser(Number(request.query.transfer)) : null;
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
    deleteUser(user.id);
    audit('user_deleted', {
      actor: actor.id,
      request,
      details: { username: user.username, name: user.name, transfer: transferTo?.username ?? null },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-2fa', async (request) => {
    const actor = admin(request);
    const user = getUser(Number(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    resetTotp(user.id);
    audit('admin_2fa_reset', { actor: actor.id, subject: user.id, request });
    return { user: userView(getUser(user.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-passkeys', async (request) => {
    const actor = admin(request);
    const user = getUser(Number(request.params.id));
    if (!user) throw notFound('Diese Person gibt es nicht');
    const removed = run('DELETE FROM passkeys WHERE user_id = ?', user.id).changes;
    audit('admin_2fa_reset', { actor: actor.id, subject: user.id, request, details: { passkeys: removed } });
    return { user: userView(getUser(user.id)!) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/logout', async (request) => {
    const actor = admin(request);
    const user = getUser(Number(request.params.id));
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
      const user = getUser(Number(request.params.id));
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
    settings.setMany(input as Partial<settings.Settings>);
    if (maintenance !== undefined && changed.includes('maintenance.enabled')) {
      audit('maintenance', { actor: actor.id, request, details: { enabled: maintenance } });
    }
    const rest = changed.filter((key) => key !== 'site.palette' && key !== 'maintenance.enabled');
    if (rest.length) audit('settings_changed', { actor: actor.id, request, details: { keys: rest } });
    return { settings: settings.adminView() };
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
      }),
      request.body
    );
    const address = input.email?.trim() || null;
    if (address && !mailReady()) throw badRequest('Richte zuerst den E-Mail-Versand ein');
    const { token, invite } = createInvite(actor, input.note ?? null, input.days, input.quota ?? null, address);
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

  app.delete<{ Params: { id: string } }>('/api/admin/links/:id', async (request) => {
    const actor = admin(request);
    const link = adminDeleteLink(request.params.id);
    audit('link_removed', { actor: actor.id, subject: link.owner_id, request, details: { label: link.label } });
    return { ok: true };
  });

  app.get<{ Querystring: { before?: string; user?: string; action?: string } }>('/api/admin/audit', async (request) => {
    admin(request);
    const before = Number(request.query.before);
    const user = Number(request.query.user);
    const actions = String(request.query.action ?? '')
      .split(',')
      .filter((action): action is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(action));
    return {
      ...listAudit({ before: before > 0 ? before : undefined, user: user > 0 ? user : undefined, actions, limit: 50 }),
      actions: AUDIT_ACTIONS,
    };
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
