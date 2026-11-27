import type { FastifyInstance } from 'fastify';
import { loadProxied } from '../services/imageproxy.ts';

export async function proxyRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { u?: string; e?: string; s?: string } }>(
    '/api/proxy/image',
    { config: { rateLimit: { max: 900, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const image = await loadProxied(request.query);
      reply.header('Content-Type', image.type);
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(image.body);
    }
  );
}
