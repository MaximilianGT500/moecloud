import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { handleSupport } from '../lib/moepulse.ts';
import { admin } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { audit } from '../services/audit.ts';
import { pulse, pulseLocked, pulseTexts } from '../services/pulse.ts';
import * as settings from '../services/settings.ts';
import { customFeed, rememberPulseUpdate, updatesEnabled } from '../services/updates.ts';

const consentSchema = z.object({ stats: z.boolean(), errors: z.boolean() });
const NOTICE_CACHE = 5 * 60_000;
let noticeCache: { at: number; notices: unknown[] } | null = null;

export function clearNoticeCache() {
  noticeCache = null;
}

async function notices() {
  const instance = pulse();
  if (instance.status().running) return instance.notices();
  if (!updatesEnabled()) return [];
  if (!noticeCache || Date.now() - noticeCache.at > NOTICE_CACHE) noticeCache = { at: Date.now(), notices: await instance.fetchNotices() };
  return noticeCache.notices;
}

function supportText(lang: Lang, code: string, fallback: string) {
  switch (code) {
    case 'network':
      return t(lang, 'MoeStudio ist gerade nicht erreichbar. Versuch es später noch einmal.');
    case 'disabled':
      return t(lang, 'Der Kontakt zu MoeStudio ist auf diesem Server abgeschaltet.');
    case 'limited':
    case 'work':
      return t(lang, 'Gerade kommen zu viele Nachrichten an. Versuch es etwas später noch einmal.');
    case 'blocked':
      return t(lang, 'Diese Installation kann MoeStudio keine Nachrichten mehr schicken.');
    case 'invalid':
      return t(lang, 'Bitte prüf Betreff und Nachricht.');
    case 'missing':
      return t(lang, 'Dieses Ticket gibt es nicht (mehr).');
    case 'closed':
      return t(lang, 'Dieses Ticket ist geschlossen.');
    case 'paused':
      return t(lang, 'Der Support nimmt gerade keine neuen Tickets an. Versuch es später noch einmal.');
    case 'app':
      return t(lang, 'Diese App ist bei MoeStudio nicht angemeldet.');
    case 'server':
      return t(lang, 'Da ist etwas schiefgelaufen, versuch es noch einmal');
    default:
      return fallback;
  }
}

function state(request: FastifyRequest) {
  const instance = pulse();
  return {
    texts: pulseTexts(request.lang),
    value: { stats: settings.get('pulse.stats'), errors: settings.get('pulse.errors') },
    status: instance.status(),
    locked: pulseLocked(),
    unread: instance.support.unread(),
    updates: updatesEnabled() && !customFeed(),
    install: config.install,
  };
}

export async function pulseRoutes(app: FastifyInstance) {
  app.get('/api/admin/pulse', async (request) => {
    admin(request);
    return state(request);
  });

  app.put('/api/admin/pulse', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const actor = admin(request);
    const next = parse(consentSchema, request.body);
    const before = { stats: settings.get('pulse.stats'), errors: settings.get('pulse.errors') };
    settings.set('pulse.stats', next.stats);
    settings.set('pulse.errors', next.errors);
    await pulse().refresh();
    if (before.stats !== next.stats || before.errors !== next.errors) {
      audit('pulse_changed', { actor: actor.id, request, details: { stats: next.stats, errors: next.errors } });
    }
    return state(request);
  });

  app.get('/api/admin/pulse/preview', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    admin(request);
    return pulse().preview({ stats: true, errors: true });
  });

  app.post('/api/admin/pulse/forget', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    const actor = admin(request);
    const done = await pulse().forget();
    if (done) {
      settings.set('pulse.stats', false);
      settings.set('pulse.errors', false);
      await pulse().refresh();
      audit('pulse_forgotten', { actor: actor.id, request });
    }
    return { ok: done };
  });

  app.post('/api/admin/moepulse/support', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = admin(request);
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    if (body.action === 'update') {
      if (!updatesEnabled() || customFeed()) return { update: null };
      const info = await pulse()
        .checkUpdate({ force: body.force === true })
        .catch(() => null);
      if (info) rememberPulseUpdate(info);
      return { update: info };
    }
    if (body.action === 'notices') return { notices: await notices() };
    const result = await handleSupport(pulse(), body);
    if (result.status >= 400) {
      const code = typeof result.body.error === 'string' ? result.body.error : 'server';
      const message = typeof result.body.message === 'string' ? result.body.message : '';
      return reply.code(result.status).send({ ...result.body, message: supportText(request.lang, code, message) });
    }
    if (body.action === 'create') {
      audit('support_ticket', { actor: actor.id, request, details: { number: result.body.number } });
    }
    return result.body;
  });
}
