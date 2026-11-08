import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, displayName, email, hexColor, palette, password, quota, username } from '../lib/validate.ts';
import { checkCode, completeSetup } from '../services/setup.ts';
import { createSession } from '../services/sessions.ts';

const setupSchema = z.object({
  code: z.string().min(1, 'Gib den Einrichtungscode ein'),
  siteName: z.string().trim().min(1, 'Gib deiner Cloud einen Namen').max(60, 'Der Name darf höchstens 60 Zeichen haben'),
  siteUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'Die Adresse muss mit http:// oder https:// beginnen'),
  language: z.enum(['de', 'en']),
  seed: hexColor,
  palette,
  registration: z.enum(['closed', 'open', 'invite']),
  defaultQuota: quota,
  admin: z.object({ username, name: displayName, email: email.optional().default(''), password }),
});

export async function setupRoutes(app: FastifyInstance) {
  app.post('/api/setup/check', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    checkCode(request.ip, (request.body as { code?: unknown })?.code);
    return { ok: true };
  });

  app.post('/api/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parse(setupSchema, request.body);
    const user = await completeSetup(request.ip, input);
    createSession(request, reply, user, 'setup');
    return { redirect: '/files' };
  });
}
