import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import yazl from 'yazl';

const { config } = await import('../src/config.ts');
const { openDatabase } = await import('../src/lib/db.ts');
const { ensureDirs } = await import('../src/services/blobs.ts');
const { buildApp } = await import('../src/app.ts');
const { setupCode } = await import('../src/services/setup.ts');
const defaultPalette = (await import('../src/lib/default-palette.json', { with: { type: 'json' } })).default;

export async function createApp() {
  await ensureDirs();
  openDatabase(config.paths.db);
  const app = await buildApp();
  await app.ready();
  return app;
}

export class Client {
  app: FastifyInstance;
  cookies = new Map<string, string>();
  csrf = '';
  basic: string | null = null;

  constructor(app: FastifyInstance) {
    this.app = app;
  }

  async send(options: InjectOptions & { url: string }): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    if (this.basic) headers.authorization = this.basic;
    const method = String(options.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers['x-csrf-token']) {
      headers['x-csrf-token'] = this.csrf || this.cookies.get('moe_csrf') || '';
    }
    const response = await this.app.inject({ ...options, headers });
    for (const cookie of response.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (cookie.value === '' || cookie.maxAge === 0 || (cookie.expires && cookie.expires.getTime() < Date.now()))
        this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    return response;
  }

  get(url: string, headers: Record<string, string> = {}) {
    return this.send({ method: 'GET', url, headers });
  }

  json(method: string, url: string, payload?: unknown) {
    return this.send({ method: method as InjectOptions['method'], url, payload: payload as InjectOptions['payload'] });
  }

  form(url: string, fields: Record<string, string>) {
    return this.send({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': 'unused' },
      payload: new URLSearchParams(fields).toString(),
    });
  }

  async refreshCsrf() {
    const response = await this.get('/api/session');
    this.csrf = response.json().csrf;
    return this.csrf;
  }

  async upload(parentId: string, name: string, content: Buffer, chunk = 4, extra: Record<string, unknown> = {}) {
    const init = await this.json('POST', '/api/uploads', { parentId, name, size: content.length, ...extra });
    if (init.statusCode !== 200) return init;
    const { id } = init.json();
    for (let offset = 0; offset < content.length; offset += chunk) {
      const part = await this.send({
        method: 'PUT',
        url: `/api/uploads/${id}?offset=${offset}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: content.subarray(offset, offset + chunk),
      });
      if (part.statusCode !== 200) return part;
    }
    return this.json('POST', `/api/uploads/${id}/complete`);
  }
}

export async function setUp(app: FastifyInstance) {
  const client = new Client(app);
  await client.get('/');
  const response = await client.json('POST', '/api/setup', {
    code: setupCode(),
    siteName: 'MoeCloud Test',
    siteUrl: 'http://localhost:3000',
    language: 'de',
    seed: '#8b5cf6',
    palette: defaultPalette,
    registration: 'closed',
    defaultQuota: 0,
    admin: { username: 'emi', name: 'Emi', email: 'emi@example.com', password: 'sehr-sicheres-passwort' },
  });
  if (response.statusCode !== 200) throw new Error(`Setup failed: ${response.body}`);
  await client.refreshCsrf();
  return client;
}

export { setupCode };

export async function login(app: FastifyInstance, username: string, password: string) {
  const client = new Client(app);
  await client.get('/login', { accept: 'text/html' });
  const response = await client.form('/login', { _csrf: client.cookies.get('moe_csrf')!, login: username, password, next: '/files' });
  if (response.statusCode !== 303) throw new Error(`Login failed: ${response.statusCode}`);
  await client.refreshCsrf();
  return client;
}

export async function zip(entries: Record<string, string | Buffer>) {
  const file = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith('/')) file.addEmptyDirectory(name);
    else file.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name);
  }
  file.end();
  const chunks: Buffer[] = [];
  for await (const chunk of file.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function fakeClamd(verdict: (data: Buffer) => string | null) {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let mode: 'command' | 'stream' | 'done' = 'command';
    const chunks: Buffer[] = [];
    socket.on('error', () => undefined);
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (mode === 'command') {
        const end = buffer.indexOf(0);
        if (end === -1) return;
        const command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === 'zVERSION') {
          mode = 'done';
          socket.end('ClamAV 1.4.3/27800/Test\0');
          return;
        }
        mode = command === 'zINSTREAM' ? 'stream' : 'done';
        if (mode === 'done') socket.end('UNKNOWN COMMAND\0');
      }
      while (mode === 'stream' && buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          mode = 'done';
          const signature = verdict(Buffer.concat(chunks));
          socket.end(signature ? `stream: ${signature} FOUND\0` : 'stream: OK\0');
          return;
        }
        if (buffer.length < 4 + length) return;
        chunks.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export async function httpSink(port = 0, respond: (request: Captured) => { status?: number; body?: string; type?: string } = () => ({})) {
  const received: Captured[] = [];
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const captured = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      received.push(captured);
      const answer = respond(captured);
      response.writeHead(answer.status ?? 200, { 'content-type': answer.type ?? 'application/json' });
      response.end(answer.body ?? '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
