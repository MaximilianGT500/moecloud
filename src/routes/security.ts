import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors.ts';
import { admin } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { audit } from '../services/audit.ts';
import { lockouts, releaseLockout } from '../services/auth.ts';
import { saveAdminNetworks } from '../services/adminnet.ts';
import { cancelIntegrity, integrityState, startIntegrity } from '../services/integrity.ts';
import { securityReport, securityTxt } from '../services/securitycheck.ts';

export async function securityRoutes(app: FastifyInstance) {
  app.get('/api/admin/security', async (request) => {
    admin(request);
    return securityReport(request);
  });

  app.post('/api/admin/security/unlock', async (request) => {
    const actor = admin(request);
    const { id } = parse(z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }), request.body);
    if (!releaseLockout(id)) throw notFound('Diese Sperre gibt es nicht mehr');
    audit('lockout_released', { actor: actor.id, request });
    return { lockouts: lockouts() };
  });

  app.put('/api/admin/security/networks', async (request) => {
    const actor = admin(request);
    const { networks } = parse(z.object({ networks: z.string().max(4000) }), request.body);
    const entries = saveAdminNetworks(networks, request.ip);
    audit('settings_changed', { actor: actor.id, request, details: { keys: ['security.adminNetworks'] } });
    return { networks: entries.join('\n') };
  });

  app.get('/api/admin/integrity', async (request) => {
    admin(request);
    return integrityState();
  });

  app.post('/api/admin/integrity', async (request) => {
    admin(request);
    void startIntegrity('admin').catch((error) => request.log.error(error, 'Prüfung der Dateien fehlgeschlagen'));
    return integrityState();
  });

  app.delete('/api/admin/integrity', async (request) => {
    admin(request);
    const cancelled = cancelIntegrity();
    return { ...integrityState(), cancelled };
  });

  app.get('/.well-known/security.txt', async (request, reply) => {
    const text = securityTxt(request);
    if (!text) throw notFound();
    return reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(text);
  });

  app.get('/.well-known/change-password', async (_request, reply) => reply.redirect('/account#sicherheit'));
}
