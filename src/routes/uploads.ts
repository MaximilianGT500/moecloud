import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { badRequest } from '../lib/errors.ts';
import { me } from '../lib/request.ts';
import { id, parse } from '../lib/validate.ts';
import { present, requireAccess } from '../services/nodes.ts';
import { abortUpload, appendChunk, completeUpload, getUpload, initUpload, uploadStream, type Actor } from '../services/uploads.ts';

const initSchema = z.object({
  parentId: id,
  name: z.string().max(1000),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  modifiedAt: z.number().int().nullable().optional(),
  relativePath: z.string().max(4096).nullable().optional(),
  conflict: z.enum(['rename', 'replace']).optional(),
});

type UploadParams = { Params: { upload: string; token?: string } };

export function uploadEndpoints(
  app: FastifyInstance,
  prefix: string,
  actorOf: (request: FastifyRequest) => Actor,
  view: (request: FastifyRequest, nodeId: string) => unknown
) {
  app.post(`${prefix}/uploads`, async (request) => initUpload(actorOf(request), parse(initSchema, request.body)));

  app.get<UploadParams>(`${prefix}/uploads/:upload`, async (request) => {
    const upload = getUpload(actorOf(request), request.params.upload);
    return { id: upload.id, size: upload.size, received: upload.received };
  });

  app.put<UploadParams & { Querystring: { offset?: string } }>(`${prefix}/uploads/:upload`, async (request) => {
    const stream = request.body as Readable | undefined;
    if (!stream || typeof stream.pipe !== 'function') throw badRequest('Sende die Daten als application/octet-stream');
    const offset = Number(request.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw badRequest('Ungültige Position');
    return appendChunk(actorOf(request), request.params.upload, offset, stream);
  });

  app.post<UploadParams>(`${prefix}/uploads/:upload/complete`, async (request) => {
    const node = await completeUpload(actorOf(request), request.params.upload);
    return { node: view(request, node.id) };
  });

  app.delete<UploadParams>(`${prefix}/uploads/:upload`, async (request) => {
    await abortUpload(actorOf(request), request.params.upload);
    return { ok: true };
  });
}

export async function uploadRoutes(app: FastifyInstance) {
  const view = (request: FastifyRequest, nodeId: string) => {
    const user = me(request);
    return present([requireAccess(user, nodeId).node], user, requireAccess(user, nodeId).role)[0];
  };

  uploadEndpoints(app, '/api', (request) => ({ user: me(request), link: null }), view);

  app.post<{ Params: { id: string }; Querystring: { conflict?: string } }>('/api/nodes/:id/upload', async (request) => {
    const user = me(request);
    if (!request.isMultipart()) throw badRequest('Sende die Dateien als multipart/form-data');
    const nodes = [];
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      const node = await uploadStream(
        { user, link: null },
        { parentId: request.params.id, name: part.filename, conflict: request.query.conflict === 'replace' ? 'replace' : 'rename' },
        part.file
      );
      nodes.push(view(request, node.id));
    }
    if (nodes.length === 0) throw badRequest('Es kam keine Datei an');
    return { items: nodes };
  });
}
