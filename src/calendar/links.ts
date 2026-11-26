import type { FastifyRequest } from 'fastify';
import * as settings from '../services/settings.ts';

export function baseUrl(request?: FastifyRequest | null) {
  const configured = settings.get('site.url').replace(/\/+$/, '');
  if (configured || !request) return configured;
  return `${request.protocol}://${request.host}`;
}

export function absoluteUrl(path: string, request?: FastifyRequest | null) {
  const base = baseUrl(request);
  return base && path.startsWith('/') ? `${base}${path}` : path;
}
