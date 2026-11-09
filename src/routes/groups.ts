import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { admin } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { createGroup, deleteGroup, getGroup, listGroups, presentGroup, renameGroup, setMembers } from '../services/groups.ts';
import { notFound } from '../lib/errors.ts';

const members = z.array(z.number().int().positive()).max(1000);
const id = z.coerce.number().int().positive();

export async function groupRoutes(app: FastifyInstance) {
  app.get('/api/admin/groups', async (request) => {
    admin(request);
    return { items: listGroups() };
  });

  app.post('/api/admin/groups', async (request) => {
    const user = admin(request);
    const input = parse(z.object({ name: z.string().max(200), members: members.optional() }), request.body);
    return { group: createGroup(user, input.name, input.members ?? []) };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/groups/:id', async (request) => {
    const user = admin(request);
    const groupId = parse(id, request.params.id);
    const input = parse(z.object({ name: z.string().max(200).optional(), members: members.optional() }), request.body);
    if (!getGroup(groupId)) throw notFound('Diese Gruppe gibt es nicht mehr');
    if (input.name !== undefined) renameGroup(user, groupId, input.name);
    if (input.members) setMembers(user, groupId, input.members);
    return { group: presentGroup(getGroup(groupId)!) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/groups/:id', async (request) => {
    deleteGroup(admin(request), parse(id, request.params.id));
    return { ok: true };
  });
}
