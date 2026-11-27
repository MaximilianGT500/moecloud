import type { FastifyInstance } from 'fastify';
import { me } from '../lib/request.ts';
import { badgesFor } from '../services/badges.ts';

export async function badgeRoutes(app: FastifyInstance) {
  app.get('/api/badges', { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } }, async (request) => badgesFor(me(request)));
}
