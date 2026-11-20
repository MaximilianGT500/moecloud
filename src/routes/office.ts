import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { run } from '../lib/db.ts';
import { badRequest, tooLarge } from '../lib/errors.ts';
import { originOf } from '../lib/http.ts';
import { cleanName, uniqueName } from '../lib/names.ts';
import { admin, me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { record } from '../services/activity.ts';
import { blobPath, receive } from '../services/blobs.ts';
import { createDerived } from '../services/derived.ts';
import { ingest } from '../services/ingest.ts';
import { baseUrl } from '../services/links.ts';
import { assertSpace, present, requireAccess, requireFolder, taken } from '../services/nodes.ts';
import { assertNotInfected } from '../services/scan.ts';
import * as settings from '../services/settings.ts';
import { thumbnail } from '../services/thumbs.ts';
import { lastVersionAt, SESSION_GAP, writeContent } from '../services/versions.ts';
import { formatBytes } from '../services/uploads.ts';
import { markSaved, officeState, openEditor, resolveToken, stamp } from '../services/wopi.ts';

type IdParams = { Params: { id: string } };
type TokenQuery = { Querystring: { access_token?: string } };

const KINDS = {
  document: { extension: 'docx', localized: true, name: { de: 'Dokument', en: 'Document' } },
  spreadsheet: { extension: 'xlsx', localized: false, name: { de: 'Tabelle', en: 'Spreadsheet' } },
  presentation: { extension: 'pptx', localized: true, name: { de: 'Präsentation', en: 'Presentation' } },
} as const;

const template = (kind: keyof typeof KINDS, lang: 'de' | 'en') => {
  const spec = KINDS[kind];
  return readFile(new URL(`../assets/office/${kind}${spec.localized ? `.${lang}` : ''}.${spec.extension}`, import.meta.url));
};

function sessionOf(request: FastifyRequest<IdParams & TokenQuery>, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = request.query.access_token ?? (typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined);
  const session = resolveToken(token, request.params.id);
  reply.header('cache-control', 'no-store');
  if (!session) void reply.code(401).send({ error: 'unauthorized' });
  return session;
}

export async function officeRoutes(app: FastifyInstance) {
  app.get('/api/office', async (request) => {
    me(request);
    const state = await officeState();
    return { enabled: state.enabled && state.ok, extensions: state.ok ? state.extensions : [] };
  });

  app.get<{ Querystring: { refresh?: string } }>('/api/admin/office', async (request) => {
    admin(request);
    return officeState(request.query.refresh === '1');
  });

  app.post<IdParams>('/api/nodes/:id/office/edit', async (request) => {
    const user = me(request);
    const origin = request.headers.origin;
    const page = typeof origin === 'string' && /^https?:\/\/[^/\s]+$/.test(origin) ? origin : originOf(request);
    return openEditor(user, request.params.id, request.lang, baseUrl(request), page);
  });

  app.post<IdParams>('/api/nodes/:id/office/new', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({ kind: z.enum(['document', 'spreadsheet', 'presentation']), name: z.string().trim().max(200).optional() }),
      request.body
    );
    const state = await officeState();
    if (!state.enabled || !state.ok) throw badRequest('Office ist auf diesem Server nicht eingerichtet');
    const { node: folder } = requireFolder(user, request.params.id, 'edit');
    const spec = KINDS[input.kind];
    const lang = request.lang === 'de' ? 'de' : 'en';
    const wanted = cleanName(input.name || spec.name[lang]);
    const name = wanted.toLowerCase().endsWith(`.${spec.extension}`) ? wanted : cleanName(`${wanted}.${spec.extension}`);
    const created = await createDerived(user, folder, uniqueName(name, false, taken(folder.id)), await template(input.kind, lang));
    run('UPDATE blobs SET thumb = -1 WHERE sha256 = ? AND thumb = 0', created.sha256);
    return { node: present([created], user, requireAccess(user, created.id).role)[0] };
  });

  await app.register(async (wopi) => {
    wopi.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    wopi.get<IdParams & TokenQuery>('/wopi/files/:id', async (request, reply) => {
      const session = sessionOf(request, reply);
      if (!session) return reply;
      const { node, user } = session;
      return {
        BaseFileName: node.name,
        OwnerId: String(node.owner_id),
        Size: Number(node.size),
        UserId: String(user.id),
        UserFriendlyName: user.name,
        UserCanWrite: session.write,
        UserCanNotWriteRelative: true,
        SupportsRename: false,
        PostMessageOrigin: session.origin || settings.get('site.url').replace(/\/+$/, '') || originOf(request),
        LastModifiedTime: stamp(node),
      };
    });

    wopi.get<IdParams & TokenQuery>('/wopi/files/:id/contents', { compress: false }, async (request, reply) => {
      const session = sessionOf(request, reply);
      if (!session) return reply;
      const { node } = session;
      reply.header('content-type', 'application/octet-stream').header('x-content-type-options', 'nosniff');
      if (!node.sha256 || Number(node.size) === 0) return reply.send(Buffer.alloc(0));
      assertNotInfected(node.sha256);
      reply.header('content-length', Number(node.size));
      return reply.send(createReadStream(blobPath(node.sha256)));
    });

    wopi.post<IdParams & TokenQuery>('/wopi/files/:id/contents', async (request, reply) => {
      const session = sessionOf(request, reply);
      if (!session) return reply;
      const { node, user } = session;
      if (!session.write) return reply.code(401).send({ error: 'read_only' });
      const known = request.headers['x-cool-wopi-timestamp'] ?? request.headers['x-lool-wopi-timestamp'];
      if (typeof known === 'string' && known && Date.parse(known) !== Number(node.modified_at)) {
        return reply.code(409).send({ COOLStatusCode: 1010, LOOLStatusCode: 1010 });
      }
      const stream = request.body as Readable | undefined;
      if (!stream || typeof stream.pipe !== 'function') throw badRequest('Der Inhalt fehlt');
      const max = settings.get('storage.maxUpload');
      const received = await receive(stream, max > 0 ? max : Number.MAX_SAFE_INTEGER, () =>
        tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) })
      );
      try {
        assertSpace(node.owner_id, received.size - Number(node.size), user.id);
      } catch (error) {
        await rm(received.path, { force: true });
        throw error;
      }
      await ingest(received, { userId: user.id, name: node.name, via: 'editor' });
      const now = Date.now();
      const fresh = session.savedAt === null || now - (lastVersionAt(node.id) ?? 0) >= SESSION_GAP;
      const updated = writeContent(node, { sha256: received.sha256, size: received.size }, user.id, { version: fresh });
      markSaved(session.hash, now);
      if (updated.sha256 !== node.sha256) {
        if (fresh) record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'edit', name: node.name });
        void thumbnail(updated).catch(() => null);
      }
      return { LastModifiedTime: stamp(updated) };
    });

    wopi.post<IdParams & TokenQuery>('/wopi/files/:id', async (request, reply) => {
      if (!sessionOf(request, reply)) return reply;
      return reply.code(501).send({ error: 'not_implemented' });
    });
  });
}
