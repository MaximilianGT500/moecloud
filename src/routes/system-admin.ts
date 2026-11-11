import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { t } from '../lib/i18n.ts';
import { admin } from '../lib/request.ts';
import { sharedFileSystem } from '../lib/storage.ts';
import { email, parse } from '../lib/validate.ts';
import { audit } from '../services/audit.ts';
import { backupPath, createBackup, deleteBackup, listBackups } from '../services/backups.ts';
import { deliver, mailReady, verifyMail } from '../services/mail.ts';
import { tools } from '../services/media.ts';
import { pendingCount, progress, reindexText } from '../services/processing.ts';
import { job, purgeInfected, quarantine, releaseBlob, rescan, scanStats, testScanner } from '../services/scan.ts';
import * as settings from '../services/settings.ts';
import { checkForUpdates, updateStatus } from '../services/updates.ts';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_KINDS,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  presentWebhook,
  testWebhook,
  updateWebhook,
} from '../services/webhooks.ts';

const mailSchema = z
  .object({
    'mail.enabled': z.boolean(),
    'mail.host': z.string().trim().max(255),
    'mail.port': z.number().int().min(1).max(65535),
    'mail.security': z.enum(['tls', 'starttls', 'none']),
    'mail.user': z.string().trim().max(255),
    'mail.password': z.string().max(512),
    'mail.from': email,
    'mail.fromName': z.string().trim().max(80),
  })
  .partial();

const scanSchema = z
  .object({
    'scan.enabled': z.boolean(),
    'scan.host': z.string().trim().max(255),
    'scan.port': z.number().int().min(1).max(65535),
    'scan.socket': z.string().trim().max(500),
    'scan.maxBytes': z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    'scan.onError': z.enum(['allow', 'reject']),
    'scan.rescanDays': z.number().int().min(0).max(365),
  })
  .partial();

const webhookSchema = z.object({
  name: z.string().trim().max(60).default(''),
  kind: z.enum(WEBHOOK_KINDS),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length).default([]),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.string().max(2000)).default({}),
});

function mailView() {
  return {
    settings: {
      'mail.enabled': settings.get('mail.enabled'),
      'mail.host': settings.get('mail.host'),
      'mail.port': settings.get('mail.port'),
      'mail.security': settings.get('mail.security'),
      'mail.user': settings.get('mail.user'),
      'mail.from': settings.get('mail.from'),
      'mail.fromName': settings.get('mail.fromName'),
    },
    hasPassword: Boolean(settings.get('mail.password')),
    ready: mailReady(),
  };
}

function scanView() {
  return {
    settings: {
      'scan.enabled': settings.get('scan.enabled'),
      'scan.host': settings.get('scan.host'),
      'scan.port': settings.get('scan.port'),
      'scan.socket': settings.get('scan.socket'),
      'scan.maxBytes': settings.get('scan.maxBytes'),
      'scan.onError': settings.get('scan.onError'),
      'scan.rescanDays': settings.get('scan.rescanDays'),
    },
    stats: scanStats(),
    job: { ...job },
  };
}

export async function systemAdminRoutes(app: FastifyInstance) {
  app.get('/api/admin/mail', async (request) => {
    admin(request);
    return mailView();
  });

  app.patch('/api/admin/mail', async (request) => {
    const actor = admin(request);
    const input = parse(mailSchema, request.body);
    const next = { ...input };
    if (next['mail.password'] === '') delete next['mail.password'];
    if ((request.body as { clearPassword?: boolean })?.clearPassword) next['mail.password'] = '';
    settings.setMany(next as Partial<settings.Settings>);
    audit('mail_changed', { actor: actor.id, request, details: { keys: Object.keys(next).filter((key) => key !== 'mail.password') } });
    return mailView();
  });

  app.post('/api/admin/mail/test', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const actor = admin(request);
    const input = parse(z.object({ to: email.optional() }), request.body);
    const to = input.to || actor.email;
    if (!to) throw badRequest('Trag in deinem Konto eine E-Mail-Adresse ein oder gib eine Adresse an');
    if (!mailReady()) throw badRequest('Schalte den E-Mail-Versand ein und trag Server und Absender ein');
    try {
      await verifyMail();
      const lang = request.lang;
      await deliver(to, {
        lang,
        title: t(lang, 'Test von {site}', { site: settings.get('site.name') }),
        lines: [t(lang, 'Diese E-Mail zeigt, dass der Versand funktioniert.')],
      });
    } catch (error) {
      throw badRequest('Der Versand hat nicht geklappt: {error}', { error: t(request.lang, (error as Error).message.slice(0, 200)) });
    }
    return { ok: true, to };
  });

  app.get('/api/admin/scan', async (request) => {
    admin(request);
    return scanView();
  });

  app.patch('/api/admin/scan', async (request) => {
    const actor = admin(request);
    const input = parse(scanSchema, request.body);
    settings.setMany(input as Partial<settings.Settings>);
    audit('scan_changed', { actor: actor.id, request, details: { keys: Object.keys(input) } });
    return scanView();
  });

  app.post('/api/admin/scan/test', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    admin(request);
    const input = parse(
      z.object({
        host: z.string().trim().max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        socket: z.string().max(500).optional(),
      }),
      request.body
    );
    try {
      return await testScanner(input);
    } catch (error) {
      throw badRequest('ClamAV ist nicht erreichbar: {error}', { error: t(request.lang, (error as Error).message.slice(0, 200)) });
    }
  });

  app.post('/api/admin/scan/run', async (request) => {
    admin(request);
    const input = parse(z.object({ all: z.boolean().optional() }), request.body);
    if (!settings.get('scan.enabled')) throw badRequest('Schalte den Virenscan zuerst ein');
    return { job: { ...rescan(Boolean(input.all)) } };
  });

  app.get('/api/admin/scan/quarantine', async (request) => {
    admin(request);
    return { items: quarantine() };
  });

  app.post('/api/admin/scan/release', async (request) => {
    const actor = admin(request);
    const { sha256 } = parse(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }), request.body);
    return { ok: releaseBlob(sha256, actor.id) };
  });

  app.post('/api/admin/scan/delete', async (request) => {
    const actor = admin(request);
    const { sha256 } = parse(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }), request.body);
    return { removed: purgeInfected(sha256, actor.id) };
  });

  app.get('/api/admin/webhooks', async (request) => {
    admin(request);
    return { items: listWebhooks().map(presentWebhook), kinds: WEBHOOK_KINDS, events: WEBHOOK_EVENTS };
  });

  app.post('/api/admin/webhooks', async (request) => {
    const actor = admin(request);
    const input = parse(webhookSchema, request.body);
    const row = createWebhook(input);
    audit('webhook_changed', { actor: actor.id, request, details: { name: row.name, kind: row.kind, action: 'created' } });
    return { item: presentWebhook(row) };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/webhooks/:id', async (request) => {
    const actor = admin(request);
    const input = parse(webhookSchema, request.body);
    const row = updateWebhook(request.params.id, input);
    audit('webhook_changed', { actor: actor.id, request, details: { name: row.name, kind: row.kind, action: 'updated' } });
    return { item: presentWebhook(row) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/webhooks/:id', async (request) => {
    const actor = admin(request);
    deleteWebhook(request.params.id);
    audit('webhook_changed', { actor: actor.id, request, details: { action: 'deleted' } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/webhooks/:id/test',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      admin(request);
      const lang = settings.get('site.language');
      return testWebhook(request.params.id, {
        event: 'test',
        title: t(lang, 'Test von {site}', { site: settings.get('site.name') }),
        text: t(lang, 'Diese Nachricht zeigt, dass die Benachrichtigung funktioniert.'),
        level: 'info',
      });
    }
  );

  app.get('/api/admin/backups', async (request) => {
    admin(request);
    return {
      items: await listBackups(),
      settings: {
        'backup.enabled': settings.get('backup.enabled'),
        'backup.hour': settings.get('backup.hour'),
        'backup.keep': settings.get('backup.keep'),
      },
      last: settings.get('backup.last') || null,
      dir: config.paths.backups,
    };
  });

  app.post('/api/admin/backups', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const actor = admin(request);
    return { item: await createBackup('manual', actor.id) };
  });

  app.get<{ Params: { name: string } }>('/api/admin/backups/:name', { compress: false }, async (request, reply) => {
    admin(request);
    const backup = await backupPath(request.params.name);
    reply.header('Content-Type', 'application/vnd.sqlite3');
    reply.header('Content-Length', backup.size);
    reply.header('Content-Disposition', contentDisposition(request.params.name, 'attachment'));
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(backup.path));
  });

  app.delete<{ Params: { name: string } }>('/api/admin/backups/:name', async (request) => {
    const actor = admin(request);
    await deleteBackup(request.params.name, actor.id);
    return { ok: true };
  });

  app.get('/api/admin/updates', async (request) => {
    admin(request);
    return updateStatus();
  });

  app.post('/api/admin/updates/check', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    admin(request);
    try {
      return await checkForUpdates(true);
    } catch (error) {
      throw badRequest('Die Versionsprüfung hat nicht geklappt: {error}', {
        error: t(request.lang, (error as Error).message.slice(0, 200)),
      });
    }
  });

  app.get('/api/admin/system', async (request) => {
    admin(request);
    const db = await stat(config.paths.db).catch(() => null);
    const wal = await stat(`${config.paths.db}-wal`).catch(() => null);
    return {
      version: config.version,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      install: config.install,
      dataDir: config.dataDir,
      storage: sharedFileSystem(config.dataDir),
      database: (db?.size ?? 0) + (wal?.size ?? 0),
      tools: { ...tools },
      processing: { pending: pendingCount(), ...progress },
      metrics: Boolean(settings.get('metrics.token') || config.metricsToken),
      metricsEnv: Boolean(config.metricsToken),
    };
  });

  app.post('/api/admin/processing/reindex', async (request) => {
    admin(request);
    reindexText();
    return { pending: pendingCount() };
  });

  app.post('/api/admin/metrics', async (request) => {
    admin(request);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), request.body);
    const token = enabled ? randomId(40) : '';
    settings.set('metrics.token', token);
    return { token: token || null };
  });
}
