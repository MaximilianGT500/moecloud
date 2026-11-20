import type { FastifyRequest } from 'fastify';
import * as settings from './settings.ts';

const KEEP = 8;
const SHAPE = /^https?:\/\/[a-z0-9.\-_:[\]]{1,255}$/i;

const originOf = (request: FastifyRequest) => `${request.protocol}://${request.host}`;

export function rememberOrigin(request: FastifyRequest) {
  const origin = originOf(request);
  if (!SHAPE.test(origin)) return;
  const known = settings.get('site.origins');
  if (known[0] === origin) return;
  settings.set('site.origins', [origin, ...known.filter((entry) => entry !== origin)].slice(0, KEEP));
}

export function mailBase(request: FastifyRequest) {
  const configured = settings.get('site.url').replace(/\/+$/, '');
  if (configured) return configured;
  const origin = originOf(request);
  const known = settings.get('site.origins');
  return known.includes(origin) ? origin : (known[0] ?? origin);
}
