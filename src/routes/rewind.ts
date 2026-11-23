import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { intOf, parse } from '../lib/validate.ts';
import { applyRewind, planRewind } from '../services/rewind.ts';

type Params = { Params: { id: string } };

export async function rewindRoutes(app: FastifyInstance) {
  app.get<Params & { Querystring: { at?: string } }>('/api/nodes/:id/rewind', async (request) => {
    const { plan: _plan, ...preview } = planRewind(me(request), request.params.id, intOf(request.query.at ?? ''));
    return preview;
  });

  app.post<Params>('/api/nodes/:id/rewind', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const input = parse(z.object({ at: z.number().int() }), request.body);
    return applyRewind(me(request), request.params.id, input.at);
  });
}
