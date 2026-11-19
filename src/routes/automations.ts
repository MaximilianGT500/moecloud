import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { id, parse } from '../lib/validate.ts';
import {
  actionsSchema,
  conditionsSchema,
  createAutomation,
  deleteAutomation,
  listAutomations,
  runAutomation,
  updateAutomation,
} from '../services/automations.ts';

const name = z.string().max(200);

export async function automationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { folder?: string } }>('/api/automations', async (request) => ({
    items: listAutomations(me(request), request.query.folder ? parse(id, request.query.folder) : undefined),
  }));

  app.post('/api/automations', async (request) => {
    const input = parse(
      z.object({
        name,
        folderId: id,
        deep: z.boolean().default(false),
        conditions: conditionsSchema.default({ kinds: [], extensions: [], nameContains: '', minSize: null, maxSize: null }),
        actions: actionsSchema,
        enabled: z.boolean().default(true),
      }),
      request.body
    );
    return { automation: createAutomation(me(request), input) };
  });

  app.patch<{ Params: { id: string } }>('/api/automations/:id', async (request) => {
    const input = parse(
      z.object({
        name: name.optional(),
        deep: z.boolean().optional(),
        conditions: conditionsSchema.optional(),
        actions: actionsSchema.optional(),
        enabled: z.boolean().optional(),
      }),
      request.body
    );
    return { automation: updateAutomation(me(request), parse(id, request.params.id), input) };
  });

  app.delete<{ Params: { id: string } }>('/api/automations/:id', async (request) => {
    deleteAutomation(me(request), parse(id, request.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/automations/:id/run',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => runAutomation(me(request), parse(id, request.params.id))
  );
}
