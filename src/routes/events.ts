import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { me } from '../lib/request.ts';
import { subscribe } from '../lib/events.ts';

const streams = new Set<ServerResponse>();

export async function eventRoutes(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    for (const stream of streams) stream.end();
    streams.clear();
  });

  app.get('/api/events', { compress: false }, async (request, reply) => {
    const user = me(request);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    raw.write('retry: 4000\n\n');
    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('hello', { at: Date.now() });
    streams.add(raw);
    const unsubscribe = subscribe(user.id, { send });
    const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      streams.delete(raw);
    });
  });
}
