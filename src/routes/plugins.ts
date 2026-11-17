import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { Lang } from '../lib/i18n.ts';
import { mimeOf } from '../lib/mime.ts';
import { admin, me } from '../lib/request.ts';
import { ids, parse } from '../lib/validate.ts';
import { audit } from '../services/audit.ts';
import { receive } from '../services/blobs.ts';
import { addExample, installPlugin, listExamples, removePlugin } from '../services/plugin-install.ts';
import {
  callRoute,
  disablePlugin,
  enablePlugin,
  listPlugins,
  pageFile,
  pluginBoot,
  pluginThemes,
  rescanPlugins,
  runAction,
  savePluginSettings,
} from '../services/plugins.ts';
import { PLUGIN_SDK_CSS, PLUGIN_SDK_JS } from '../views/plugin-sdk.ts';

type IdParams = { Params: { id: string } };
type ActionParams = { Params: { id: string; action: string } };
type WildParams = { Params: { id: string; '*'?: string } };

const BODY_LIMIT = 5 * 1024 * 1024;
const PAGE_POLICY =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
const ROUTE_POLICY = "default-src 'none'; sandbox";
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const enableSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) });
const settingsSchema = z.object({
  values: z.record(z.string().max(40), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])),
});
const actionSchema = z.object({ ids });

function bodyOf(request: FastifyRequest) {
  const raw = Buffer.isBuffer(request.body) ? request.body : null;
  const type = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!raw || raw.length === 0) return { raw, body: null as unknown };
  if (type.includes('json')) {
    try {
      return { raw, body: JSON.parse(raw.toString('utf8')) as unknown };
    } catch {
      throw badRequest('Die Anfrage enthält kein gültiges JSON');
    }
  }
  if (type.startsWith('application/x-www-form-urlencoded'))
    return { raw, body: Object.fromEntries(new URLSearchParams(raw.toString('utf8'))) };
  if (type.startsWith('text/')) return { raw, body: raw.toString('utf8') };
  return { raw, body: raw };
}

async function forward(scope: 'api' | 'public', request: FastifyRequest<WildParams>, reply: FastifyReply) {
  const { raw, body } = bodyOf(request);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (key === 'cookie' || key === 'authorization' || key === 'x-csrf-token') continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries((request.query ?? {}) as Record<string, unknown>)) {
    query[key] = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  }
  const outcome = await callRoute({
    plugin: request.params.id,
    method: request.method,
    path: request.params['*'] ?? '',
    scope,
    user: scope === 'api' ? (request.auth?.user ?? null) : null,
    query,
    body,
    rawBody: raw,
    headers,
    ip: request.ip,
    lang: request.lang,
  });
  for (const [key, value] of Object.entries(outcome.headers)) reply.header(key, value);
  reply.header('Content-Security-Policy', ROUTE_POLICY).header('Cache-Control', outcome.headers['cache-control'] ?? 'no-store');
  const result = outcome.result;
  if (result === undefined || result === null) return reply.code(outcome.status === 200 ? 204 : outcome.status).send();
  reply.code(outcome.status);
  if (Buffer.isBuffer(result)) return reply.type(outcome.type ?? 'application/octet-stream').send(result);
  if (typeof result === 'string') return reply.type(outcome.type ?? 'text/plain; charset=utf-8').send(result);
  if (typeof (result as { pipe?: unknown }).pipe === 'function') return reply.type(outcome.type ?? 'application/octet-stream').send(result);
  return reply.type(outcome.type ?? 'application/json; charset=utf-8').send(JSON.stringify(result));
}

export async function pluginRoutes(app: FastifyInstance) {
  app.get('/api/plugins', async (request) => pluginBoot(me(request), request.lang));

  app.post<ActionParams>('/api/plugins/:id/actions/:action', async (request) => {
    const user = me(request);
    const input = parse(actionSchema, request.body);
    return runAction(user, request.params.id, request.params.action, input.ids, request.lang);
  });

  const view = async (lang: Lang) => ({ ...listPlugins(lang), themes: pluginThemes(), examples: await listExamples(lang) });

  app.get('/api/admin/plugins', async (request) => {
    admin(request);
    return view(request.lang);
  });

  app.post('/api/admin/plugins/rescan', async (request) => {
    admin(request);
    await rescanPlugins(request.lang);
    return view(request.lang);
  });

  app.post<IdParams>('/api/admin/plugins/examples/:id', async (request) => {
    const actor = admin(request);
    const installed = await addExample(request.params.id);
    audit('plugin_installed', { actor: actor.id, request, details: { name: installed.id, version: installed.version, example: true } });
    return { installed, ...(await view(request.lang)) };
  });

  app.post<IdParams>('/api/admin/plugins/:id/enable', async (request) => {
    const actor = admin(request);
    const plugin = await enablePlugin(request.params.id, parse(enableSchema, request.body).hash, request.lang);
    audit('plugin_enabled', { actor: actor.id, request, details: { name: plugin.name, id: plugin.id, version: plugin.version } });
    return { plugin, ...(await view(request.lang)) };
  });

  app.post<IdParams>('/api/admin/plugins/:id/disable', async (request) => {
    const actor = admin(request);
    const plugin = await disablePlugin(request.params.id, request.lang);
    audit('plugin_disabled', { actor: actor.id, request, details: { name: plugin.name, id: plugin.id } });
    return { plugin, ...(await view(request.lang)) };
  });

  app.put<IdParams>('/api/admin/plugins/:id/settings', async (request) => {
    const actor = admin(request);
    const plugin = await savePluginSettings(request.params.id, parse(settingsSchema, request.body).values, request.lang);
    audit('plugin_settings', { actor: actor.id, request, details: { name: plugin.name, id: plugin.id } });
    return { plugin, ...(await view(request.lang)) };
  });

  app.delete<IdParams>('/api/admin/plugins/:id', async (request) => {
    const actor = admin(request);
    if (!config.plugins.upload) throw badRequest('Entfern den Ordner des Plugins auf dem Server, im Browser ist das abgeschaltet');
    await removePlugin(request.params.id);
    audit('plugin_removed', { actor: actor.id, request, details: { name: request.params.id } });
    return view(request.lang);
  });

  app.post('/api/admin/plugins/upload', async (request) => {
    const actor = admin(request);
    if (!config.plugins.upload) throw badRequest('Plugins im Browser hochzuladen ist auf diesem Server abgeschaltet');
    const stream = request.body as Readable | undefined;
    if (!stream || typeof stream.pipe !== 'function') throw badRequest('Schick das ZIP-Archiv als application/octet-stream');
    const received = await receive(stream, 64 * 1024 * 1024);
    try {
      const installed = await installPlugin(received.path);
      audit('plugin_installed', { actor: actor.id, request, details: { name: installed.id, version: installed.version } });
      await rescanPlugins(request.lang);
      return { installed, ...(await view(request.lang)) };
    } finally {
      await rm(received.path, { force: true });
    }
  });

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_request, body, done) => done(null, body));
    for (const url of ['/api/ext/:id', '/api/ext/:id/*']) {
      scope.route<WildParams>({ method: [...METHODS], url, handler: (request, reply) => forward('api', request, reply) });
    }
    for (const url of ['/ext/:id', '/ext/:id/*']) {
      scope.route<WildParams>({
        method: [...METHODS],
        url,
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        handler: (request, reply) => forward('public', request, reply),
      });
    }
  });

  app.get('/plugin-pages/sdk.js', async (_request, reply) =>
    reply
      .type('text/javascript; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(PLUGIN_SDK_JS)
  );

  app.get('/plugin-pages/sdk.css', async (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(PLUGIN_SDK_CSS)
  );

  app.get<WildParams>('/plugin-pages/:id/*', async (request, reply) => {
    const file = await pageFile(request.params.id, request.params['*'] ?? '');
    if (!file) throw notFound('Diese Seite gibt es nicht');
    const type = mimeOf(file.path);
    return reply
      .type(/^text\/|javascript|json|xml/.test(type) ? `${type}; charset=utf-8` : type)
      .header('Content-Length', file.size)
      .header('Cache-Control', 'no-cache')
      .header('Content-Security-Policy', PAGE_POLICY)
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(createReadStream(file.path));
  });
}
