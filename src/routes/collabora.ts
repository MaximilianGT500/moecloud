import http, { type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sessionUser } from '../services/sessions.ts';
import * as settings from '../services/settings.ts';
import { termsPending } from '../services/terms.ts';
import { secondFactorPending } from '../services/auth.ts';
import { officeProxy } from '../services/wopi.ts';

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const PRIVATE = new Set(['cookie', 'authorization', 'x-csrf-token', 'host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']);
const BLOCKED =
  /^\/(browser\/[^/]+\/admin|browser\/dist\/admin|cool\/adminws|cool\/convert-to|cool\/getMetrics|cool\/render-search-result)(\/|\?|$)/i;
const PROXIED = /^\/(browser|cool)\//;

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 64 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 64 }),
};

export const proxiedPath = (url: string) =>
  PROXIED.test(url) && !BLOCKED.test(url) && !/(^|\/)\.\.(\/|$)/.test(decodeSafe(url.split('?')[0]));

function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '..';
  }
}

function outgoing(headers: IncomingHttpHeaders, host: string, protocol: string, ip: string) {
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP.has(name) || PRIVATE.has(name)) continue;
    result[name] = value;
  }
  result.host = host;
  result['x-forwarded-host'] = host;
  result['x-forwarded-proto'] = protocol;
  if (ip) result['x-forwarded-for'] = ip;
  return result;
}

function incoming(headers: IncomingHttpHeaders) {
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP.has(name) || name === 'set-cookie') continue;
    result[name] = value;
  }
  return result;
}

function transport(target: URL) {
  return target.protocol === 'https:' ? { client: https, agent: agents['https:'] } : { client: http, agent: agents['http:'] };
}

function forward(request: FastifyRequest, reply: FastifyReply, base: string) {
  const target = new URL(request.raw.url ?? '/', base);
  const { client, agent } = transport(target);
  reply.hijack();
  const response = reply.raw;
  const upstream = client.request(
    target,
    { method: request.method, headers: outgoing(request.headers, request.host, request.protocol, request.ip), agent },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, incoming(answer.headers));
      answer.pipe(response);
      answer.on('error', () => response.destroy());
    }
  );
  upstream.setTimeout(120_000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', (error) => {
    request.log.warn({ url: request.url.split('?')[0], error: error.message }, 'office proxy failed');
    if (response.headersSent) return response.destroy();
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('Office ist gerade nicht erreichbar');
  });
  response.on('close', () => {
    if (!response.writableFinished) upstream.destroy();
  });
  request.raw.pipe(upstream);
}

const open = new Set<Duplex>();

function refuse(socket: Duplex, status: number, text: string) {
  if (!socket.writable) return socket.destroy();
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.resume();
  setTimeout(() => socket.destroy(), 2000).unref();
}

const firstOf = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? '')).split(',')[0].trim();

function publicAddress(request: IncomingMessage) {
  const site = settings.get('site.url').trim();
  if (/^https?:\/\//.test(site)) {
    const url = new URL(site);
    return { host: url.host, protocol: url.protocol.slice(0, -1) };
  }
  const local =
    /^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.|f[cd])/.test(
      request.socket.remoteAddress ?? ''
    );
  const forwardedHost = local ? firstOf(request.headers['x-forwarded-host']) : '';
  const forwardedProto = local ? firstOf(request.headers['x-forwarded-proto']) : '';
  return {
    host: forwardedHost || request.headers.host || 'localhost',
    protocol: forwardedProto === 'https' ? 'https' : 'http',
  };
}

function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = request.url ?? '';
  if (!PROXIED.test(url)) return;
  socket.on('error', () => socket.destroy());
  const base = officeProxy();
  if (!base || !proxiedPath(url)) return refuse(socket, 404, 'Not Found');
  const session = sessionUser(request.headers.cookie);
  if (
    !session ||
    (settings.get('maintenance.enabled') && session.user.role !== 'admin') ||
    termsPending(session.user) ||
    secondFactorPending(session.user, session.method)
  ) {
    return refuse(socket, 401, 'Unauthorized');
  }
  const target = new URL(url, base);
  const { client } = transport(target);
  const address = publicAddress(request);
  const headers = outgoing(request.headers, address.host, address.protocol, request.socket.remoteAddress ?? '');
  headers.connection = 'Upgrade';
  headers.upgrade = request.headers.upgrade ?? 'websocket';
  const upstream = client.request(target, { method: 'GET', headers, agent: false });
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => refuse(socket, 502, 'Bad Gateway'));
  upstream.on('response', (answer) => {
    answer.resume();
    refuse(socket, answer.statusCode ?? 502, answer.statusMessage ?? 'Error');
  });
  upstream.on('upgrade', (answer, remote, rest) => {
    upstream.setTimeout(0);
    const lines = [`HTTP/1.1 101 ${answer.statusMessage || 'Switching Protocols'}`];
    for (let index = 0; index < answer.rawHeaders.length; index += 2) {
      if (answer.rawHeaders[index].toLowerCase() === 'set-cookie') continue;
      lines.push(`${answer.rawHeaders[index]}: ${answer.rawHeaders[index + 1]}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (rest.length) socket.write(rest);
    if (head.length) remote.write(head);
    open.add(socket).add(remote);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    remote.on('close', () => {
      open.delete(remote);
      socket.destroy();
    });
    socket.on('close', () => {
      open.delete(socket);
      remote.destroy();
    });
    remote.pipe(socket);
    socket.pipe(remote);
  });
  upstream.end();
}

export async function collaboraRoutes(app: FastifyInstance) {
  app.server.on('upgrade', upgrade);
  app.addHook('preClose', async () => {
    for (const socket of open) socket.destroy();
    open.clear();
    agents['http:'].destroy();
    agents['https:'].destroy();
  });

  await app.register(async (proxy) => {
    proxy.removeAllContentTypeParsers();
    proxy.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    const handle = async (request: FastifyRequest, reply: FastifyReply) => {
      const base = officeProxy();
      if (!base || !proxiedPath(request.url)) return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
      const auth = request.auth;
      if (!auth?.session || termsPending(auth.user) || secondFactorPending(auth.user, auth.session.method)) {
        return reply.code(401).header('cache-control', 'no-store').type('text/plain; charset=utf-8').send('Unauthorized');
      }
      forward(request, reply, base);
      return reply;
    };

    proxy.route({
      method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      url: '/browser/*',
      compress: false,
      handler: handle,
    });
    proxy.route({
      method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      url: '/cool/*',
      compress: false,
      handler: handle,
    });
  });
}
