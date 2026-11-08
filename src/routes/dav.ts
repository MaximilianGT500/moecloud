import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { HttpError, badRequest, forbidden, notFound, tooLarge } from '../lib/errors.ts';
import { sendFile } from '../lib/http.ts';
import { cleanName } from '../lib/names.ts';
import { basicAuth } from '../services/apppasswords.ts';
import { record } from '../services/activity.ts';
import { blobPath, receive, store } from '../services/blobs.ts';
import { ingest } from '../services/ingest.ts';
import { assertNotInfected } from '../services/scan.ts';
import {
  children,
  copyTo,
  createFolder,
  findChild,
  getNode,
  insertNode,
  moveTo,
  remaining,
  requireAccess,
  trash,
  changed,
  type NodeRow,
} from '../services/nodes.ts';
import * as settings from '../services/settings.ts';
import { formatBytes } from '../services/uploads.ts';
import { quotaOf, usageOf, type UserRow } from '../services/users.ts';
import { writeContent } from '../services/versions.ts';

const PREFIX = '/dav';
const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function segmentsOf(url: string): string[] {
  const path = url.split('?')[0].slice(PREFIX.length);
  try {
    return path
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).normalize('NFC'));
  } catch {
    throw badRequest('Ungültige Adresse');
  }
}

const hrefOf = (segments: string[], folder: boolean) =>
  `${PREFIX}/${segments.map((part) => encodeURIComponent(part)).join('/')}${folder && segments.length ? '/' : ''}`;

interface Resolved {
  node: NodeRow | null;
  parent: NodeRow | null;
  name: string;
  segments: string[];
}

function resolve(user: UserRow, segments: string[]): Resolved {
  let current = getNode(user.root_id)!;
  let parent: NodeRow | null = null;
  for (let index = 0; index < segments.length; index++) {
    const child = current.type === 'folder' ? findChild(current.id, segments[index]) : undefined;
    if (!child) {
      return {
        node: null,
        parent: index === segments.length - 1 && current.type === 'folder' ? current : null,
        name: segments[index],
        segments,
      };
    }
    parent = current;
    current = child;
  }
  return { node: current, parent, name: current.name, segments };
}

function authenticate(request: FastifyRequest, reply: FastifyReply): UserRow | null {
  const result = basicAuth(request.headers.authorization, request.ip);
  if (result && result !== 'blocked') return result;
  reply
    .code(result === 'blocked' ? 429 : 401)
    .header('WWW-Authenticate', `Basic realm="${settings.get('site.name').replace(/"/g, '')}", charset="UTF-8"`)
    .type('text/plain; charset=utf-8')
    .send(result === 'blocked' ? 'Zu viele Versuche' : 'Melde dich mit deinem Benutzernamen und einem App-Passwort an');
  return null;
}

function props(user: UserRow, node: NodeRow, segments: string[]) {
  const folder = node.type === 'folder';
  const modified = new Date(node.type === 'file' ? node.modified_at : node.updated_at).toUTCString();
  const created = new Date(node.created_at).toISOString();
  const parts = [
    `<d:displayname>${xml(node.parent_id ? node.name : settings.get('site.name'))}</d:displayname>`,
    `<d:getlastmodified>${modified}</d:getlastmodified>`,
    `<d:creationdate>${created}</d:creationdate>`,
    folder ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>',
    `<d:getetag>"${folder ? `d${node.etag}-${node.updated_at}` : node.sha256}"</d:getetag>`,
    '<d:supportedlock><d:lockentry><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockentry></d:supportedlock>',
    '<d:lockdiscovery/>',
  ];
  if (folder) {
    const used = usageOf(node.owner_id);
    const quota = node.owner_id === user.id ? quotaOf(user) : null;
    parts.push(`<d:quota-used-bytes>${used}</d:quota-used-bytes>`);
    if (quota !== null) parts.push(`<d:quota-available-bytes>${Math.max(0, quota - used)}</d:quota-available-bytes>`);
  } else {
    parts.push(`<d:getcontentlength>${node.size}</d:getcontentlength>`);
    parts.push(`<d:getcontenttype>${xml(node.mime ?? 'application/octet-stream')}</d:getcontenttype>`);
  }
  return `<d:response><d:href>${xml(hrefOf(segments, folder))}</d:href><d:propstat><d:prop>${parts.join('')}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

const multistatus = (body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`;

async function readText(request: FastifyRequest, limit = 256 * 1024): Promise<string> {
  const stream = request.body as Readable | undefined;
  if (!stream || typeof stream.on !== 'function') return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > limit) throw badRequest('Die Anfrage ist zu groß');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function propNames(body: string) {
  const namespaces = new Map<string, string>();
  for (const match of body.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*"([^"]*)"/g)) namespaces.set(match[1] ?? '', match[2]);
  const names: { prefix: string; local: string; uri: string }[] = [];
  for (const block of body.matchAll(/<(?:[\w.-]+:)?prop\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?prop>/g)) {
    let depth = 0;
    for (const tag of block[1].matchAll(/<(\/?)([\w.-]+:)?([\w.-]+)[^>]*?(\/?)>/g)) {
      const closing = tag[1] === '/';
      const selfClosing = tag[4] === '/';
      if (closing) {
        depth--;
        continue;
      }
      if (depth === 0) {
        const prefix = (tag[2] ?? '').replace(':', '');
        names.push({ prefix, local: tag[3], uri: namespaces.get(prefix) ?? 'DAV:' });
      }
      if (!selfClosing) depth++;
    }
  }
  return names;
}

const locks = new Map<string, { path: string; expires: number }>();

function lockResponse(token: string, path: string, timeout: number) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock><d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope><d:depth>infinity</d:depth><d:timeout>Second-${timeout}</d:timeout><d:locktoken><d:href>${token}</d:href></d:locktoken><d:lockroot><d:href>${xml(path)}</d:href></d:lockroot></d:activelock></d:lockdiscovery></d:prop>`;
}

function destinationOf(request: FastifyRequest): string[] {
  const header = request.headers.destination;
  if (typeof header !== 'string' || !header) throw badRequest('Das Ziel fehlt');
  const self = new URL(`${request.protocol}://${request.host}`);
  let url: URL;
  try {
    url = new URL(header, self);
  } catch {
    throw badRequest('Das Ziel ist ungültig');
  }
  if (url.host !== self.host) throw new HttpError(502, 'Kopieren auf andere Server geht nicht', 'bad_gateway');
  if (!url.pathname.startsWith(`${PREFIX}/`) && url.pathname !== PREFIX) throw forbidden('Das Ziel liegt außerhalb von WebDAV');
  return segmentsOf(url.pathname);
}

async function handle(request: FastifyRequest, reply: FastifyReply) {
  reply.header('DAV', '1, 2');
  reply.header('MS-Author-Via', 'DAV');
  if (request.method === 'OPTIONS') return reply.header('Allow', ALLOW).header('Content-Length', '0').code(200).send();
  const user = authenticate(request, reply);
  if (!user) return reply;
  const segments = segmentsOf(request.url);
  const target = resolve(user, segments);

  switch (request.method) {
    case 'PROPFIND': {
      if (!target.node) throw notFound();
      const depth = request.headers.depth === '0' ? 0 : 1;
      const parts = [props(user, target.node, segments)];
      if (depth === 1 && target.node.type === 'folder') {
        for (const child of children(target.node.id)) parts.push(props(user, child, [...segments, child.name]));
      }
      return reply
        .code(207)
        .type('application/xml; charset=utf-8')
        .send(multistatus(parts.join('')));
    }

    case 'GET':
    case 'HEAD': {
      if (!target.node) throw notFound();
      if (target.node.type === 'folder') {
        const list = children(target.node.id)
          .map((child) => `${child.name}${child.type === 'folder' ? '/' : ''}`)
          .join('\n');
        return reply.type('text/plain; charset=utf-8').send(list);
      }
      const node = target.node;
      assertNotInfected(node.sha256);
      return sendFile(request, reply, {
        path: blobPath(node.sha256!),
        size: node.size,
        type: node.mime ?? 'application/octet-stream',
        etag: node.sha256!,
        modified: node.modified_at,
        name: node.name,
        disposition: 'attachment',
      });
    }

    case 'PUT': {
      if (!target.parent) throw new HttpError(409, 'Der Ordner dafür fehlt', 'conflict');
      if (target.node?.type === 'folder') return reply.code(405).header('Allow', ALLOW).send();
      requireAccess(user, target.parent.id, 'edit');
      const name = cleanName(target.name);
      const max = settings.get('storage.maxUpload');
      const limit = Math.min(max > 0 ? max : Number.MAX_SAFE_INTEGER, remaining(target.parent.owner_id) + (target.node?.size ?? 0));
      const stream = request.body as Readable | undefined;
      const received = await receive(stream && typeof stream.pipe === 'function' ? stream : Readable.from([]), limit, () =>
        max > 0 && limit === max
          ? tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) })
          : new HttpError(507, 'Dein Speicher ist voll', 'quota')
      );
      await ingest(received, { userId: user.id, name, via: 'dav' });
      const mtimeHeader = Number(request.headers['x-oc-mtime']);
      const modifiedAt = Number.isFinite(mtimeHeader) && mtimeHeader > 0 ? mtimeHeader * 1000 : null;
      if (modifiedAt) reply.header('X-OC-MTime', 'accepted');
      if (target.node) {
        const updated = writeContent(target.node, { sha256: received.sha256, size: received.size, modifiedAt }, user.id);
        record({
          owner: updated.owner_id,
          actor: user.id,
          node: updated.id,
          parent: updated.parent_id,
          action: 'edit',
          name: updated.name,
        });
        return reply.code(204).header('ETag', `"${updated.sha256}"`).send();
      }
      const created = insertNode({
        ownerId: target.parent.owner_id,
        parentId: target.parent.id,
        type: 'file',
        name,
        actorId: user.id,
        size: received.size,
        sha256: received.sha256,
        modifiedAt,
      });
      record({ owner: created.owner_id, actor: user.id, node: created.id, parent: target.parent.id, action: 'upload', name });
      changed([target.parent.id]);
      return reply.code(201).header('ETag', `"${created.sha256}"`).send();
    }

    case 'MKCOL': {
      if (target.node) return reply.code(405).header('Allow', ALLOW).send();
      if (!target.parent) throw new HttpError(409, 'Der Ordner dafür fehlt', 'conflict');
      const text = await readText(request);
      if (text.trim()) return reply.code(415).send();
      createFolder(user, target.parent.id, target.name);
      return reply.code(201).send();
    }

    case 'DELETE': {
      if (!target.node) throw notFound();
      if (!target.node.parent_id) throw forbidden('Den Hauptordner kannst du nicht löschen');
      trash(user, [target.node.id]);
      return reply.code(204).send();
    }

    case 'COPY':
    case 'MOVE': {
      if (!target.node) throw notFound();
      const destination = resolve(user, destinationOf(request));
      if (!destination.parent) throw new HttpError(409, 'Der Zielordner fehlt', 'conflict');
      const overwrite = String(request.headers.overwrite ?? 'T').toUpperCase() !== 'F';
      if (destination.node?.id === target.node.id) return reply.code(204).send();
      if (destination.node && !overwrite) return reply.code(412).send();
      if (destination.node) trash(user, [destination.node.id]);
      if (request.method === 'MOVE') moveTo(user, target.node.id, destination.parent.id, destination.name);
      else copyTo(user, target.node.id, destination.parent.id, destination.name);
      return reply.code(destination.node ? 204 : 201).send();
    }

    case 'PROPPATCH': {
      if (!target.node) throw notFound();
      const names = propNames(await readText(request));
      const body = names.map((prop, index) => `<ns${index}:${prop.local} xmlns:ns${index}="${xml(prop.uri)}"/>`).join('');
      const response = `<d:response><d:href>${xml(hrefOf(segments, target.node.type === 'folder'))}</d:href><d:propstat><d:prop>${body}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      return reply.code(207).type('application/xml; charset=utf-8').send(multistatus(response));
    }

    case 'LOCK': {
      await readText(request);
      const timeout = 3600;
      const now = Date.now();
      for (const [key, lock] of locks) if (lock.expires < now) locks.delete(key);
      const existing = typeof request.headers.if === 'string' ? /<(opaquelocktoken:[^>]+)>/.exec(request.headers.if)?.[1] : undefined;
      const token = existing && locks.has(existing) ? existing : `opaquelocktoken:${randomUUID()}`;
      locks.set(token, { path: request.url, expires: now + timeout * 1000 });
      let status = 200;
      if (!target.node) {
        if (!target.parent) throw new HttpError(409, 'Der Ordner dafür fehlt', 'conflict');
        requireAccess(user, target.parent.id, 'edit');
        const received = await receive(Readable.from([]));
        await store(received);
        insertNode({
          ownerId: target.parent.owner_id,
          parentId: target.parent.id,
          type: 'file',
          name: cleanName(target.name),
          actorId: user.id,
          size: 0,
          sha256: received.sha256,
        });
        changed([target.parent.id]);
        status = 201;
      }
      return reply
        .code(status)
        .header('Lock-Token', `<${token}>`)
        .type('application/xml; charset=utf-8')
        .send(lockResponse(token, hrefOf(segments, target.node?.type === 'folder'), timeout));
    }

    case 'UNLOCK': {
      const token = /<([^>]+)>/.exec(String(request.headers['lock-token'] ?? ''))?.[1];
      if (token) locks.delete(token);
      return reply.code(204).send();
    }

    default:
      return reply.code(405).header('Allow', ALLOW).send();
  }
}

export async function davRoutes(app: FastifyInstance) {
  await app.register(async (dav) => {
    dav.removeAllContentTypeParsers();
    dav.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    const methods = ['OPTIONS', 'GET', 'HEAD', 'PUT', 'DELETE', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'];
    dav.route({ method: methods, url: PREFIX, handler: handle, compress: false, exposeHeadRoute: false });
    dav.route({ method: methods, url: `${PREFIX}/*`, handler: handle, compress: false, exposeHeadRoute: false });
  });
}
