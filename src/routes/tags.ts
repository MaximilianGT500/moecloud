import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { id, ids, parse } from '../lib/validate.ts';
import { present, resolveAccess } from '../services/nodes.ts';
import { applyTags, createTag, deleteTag, listTags, taggedNodes, TAG_COLORS, updateTag } from '../services/tags.ts';

type IdParams = { Params: { id: string } };

const tagSchema = z.object({ name: z.string().max(200), color: z.enum(TAG_COLORS) });
const applySchema = z.object({
  ids,
  add: z.array(id).max(50).default([]),
  remove: z.array(id).max(50).default([]),
});

export async function tagRoutes(app: FastifyInstance) {
  app.get('/api/tags', async (request) => ({ items: listTags(me(request)) }));

  app.post('/api/tags', async (request) => {
    const input = parse(tagSchema, request.body);
    return { tag: createTag(me(request), input.name, input.color) };
  });

  app.patch<IdParams>('/api/tags/:id', async (request) => {
    const input = parse(tagSchema.partial(), request.body);
    return { tag: updateTag(me(request), request.params.id, input) };
  });

  app.delete<IdParams>('/api/tags/:id', async (request) => {
    deleteTag(me(request), request.params.id);
    return { ok: true };
  });

  app.put('/api/nodes/tags', async (request) => {
    const input = parse(applySchema, request.body);
    return { count: applyTags(me(request), input.ids, input.add, input.remove) };
  });

  app.get<IdParams>('/api/tags/:id/nodes', async (request) => {
    const user = me(request);
    const { tag, nodes } = taggedNodes(user, request.params.id);
    return { tag, items: present(nodes, user, (node) => resolveAccess(user, node.id)?.role ?? 'view') };
  });
}
