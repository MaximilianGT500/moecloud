import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { notFound } from '../lib/errors.ts';
import { t } from '../lib/i18n.ts';
import { me } from '../lib/request.ts';
import { toVtt } from '../lib/subtitles.ts';
import { ids, parse } from '../lib/validate.ts';
import { pdfPage, tools } from '../services/media.ts';
import { blobPath } from '../services/blobs.ts';
import { getPosition, savePosition, subtitleNode, subtitlesOf } from '../services/media-state.ts';
import { setWatch } from '../services/watches.ts';
import { children, present, requireAccess, resolveAccess, type NodeRow } from '../services/nodes.ts';
import { packZip } from '../services/pack.ts';
import { merge, pdfInfo, pdfPath, rearrange } from '../services/pdf.ts';
import type { UserRow } from '../services/users.ts';

type IdParams = { Params: { id: string } };

const name = z.string().max(1000);

export const sendVtt = (reply: FastifyReply, text: string) =>
  reply
    .header('Content-Type', 'text/vtt; charset=utf-8')
    .header('Cache-Control', 'private, max-age=300')
    .header('X-Content-Type-Options', 'nosniff')
    .send(text);
const shown = (user: UserRow, node: NodeRow) => present([node], user, (entry) => resolveAccess(user, entry.id)?.role ?? 'view')[0];

export async function toolRoutes(app: FastifyInstance) {
  app.get<IdParams>('/api/nodes/:id/pdf', async (request) => ({ pages: await pdfInfo(me(request), request.params.id) }));

  app.get<{ Params: { id: string; page: string }; Querystring: { size?: string } }>(
    '/api/nodes/:id/pdf/:page',
    { compress: false },
    async (request, reply) => {
      const path = pdfPath(me(request), request.params.id);
      const page = Number(request.params.page);
      if (!tools.pdftoppm || !Number.isInteger(page) || page < 1 || page > 2000) throw notFound();
      const size = Math.min(1200, Math.max(120, Number(request.query.size) || 360));
      const image = await pdfPage(path, page, size).catch(() => null);
      if (!image?.length) throw notFound();
      return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=3600').send(image);
    }
  );

  app.post<IdParams>('/api/nodes/:id/pdf', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        pages: z
          .array(
            z.object({
              page: z.number().int().min(1).max(2000),
              rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
            })
          )
          .min(1, 'Wähle mindestens eine Seite aus')
          .max(4000),
        save: z.enum(['copy', 'version']).default('copy'),
        name: name.default(''),
      }),
      request.body
    );
    const node = await rearrange(user, request.params.id, input.pages, input.save, input.name, t(request.lang, '{name} (bearbeitet)'));
    return { node: shown(user, node) };
  });

  app.post('/api/pdf/merge', async (request) => {
    const user = me(request);
    const input = parse(z.object({ ids, name }), request.body);
    return { node: shown(user, await merge(user, input.ids, input.name)) };
  });

  app.get<IdParams>('/api/nodes/:id/subtitles', async (request) => {
    const user = me(request);
    const { node } = requireAccess(user, request.params.id);
    if (node.type !== 'file' || !node.parent_id || !resolveAccess(user, node.parent_id)) return { items: [] };
    return { items: subtitlesOf(node, children(node.parent_id)) };
  });

  app.get<IdParams>('/api/nodes/:id/vtt', async (request, reply) => {
    const node = subtitleNode(requireAccess(me(request), request.params.id).node);
    return sendVtt(reply, toVtt(await readFile(blobPath(node.sha256!)), node.name));
  });

  app.get<IdParams>('/api/nodes/:id/position', async (request) => {
    const row = getPosition(me(request), request.params.id);
    return { position: row ? { seconds: row.seconds, duration: row.duration, updatedAt: row.updated_at } : null };
  });

  app.put<IdParams>('/api/nodes/:id/position', async (request) => {
    const input = parse(z.object({ seconds: z.number().min(0).max(1e7), duration: z.number().min(0).max(1e7) }), request.body);
    const row = savePosition(me(request), request.params.id, input.seconds, input.duration);
    return { position: row ? { seconds: row.seconds, duration: row.duration, updatedAt: row.updated_at } : null };
  });

  app.put<IdParams>('/api/nodes/:id/watch', async (request) => {
    const input = parse(z.object({ watching: z.boolean() }), request.body);
    return { watching: setWatch(me(request), request.params.id, input.watching) };
  });

  app.post('/api/nodes/zip', async (request) => {
    const user = me(request);
    const input = parse(z.object({ ids, name }), request.body);
    return { node: shown(user, await packZip(user, input.ids, input.name)) };
  });
}
