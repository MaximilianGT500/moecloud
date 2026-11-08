import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forbidden } from '../lib/errors.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { getNode, present, requireAccess } from '../services/nodes.ts';
import { createLink, deleteLink, linksBy, linksForNode, presentLink, updateLink } from '../services/links.ts';
import { grantsForNode, presentGrant, removeGrant, sharedByMe, sharedWithMe, shareWith, updateGrant } from '../services/grants.ts';
import * as settings from '../services/settings.ts';
import { searchUsers } from '../services/users.ts';

const linkSchema = z.object({
  label: z.string().max(80).nullable().optional(),
  password: z.string().max(512).nullable().optional(),
  removePassword: z.boolean().optional(),
  expiresAt: z.number().int().nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowUpload: z.boolean().optional(),
  uploadOnly: z.boolean().optional(),
  notify: z.boolean().optional(),
});

const permission = z.enum(['view', 'edit']);

export async function shareRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/nodes/:id/shares', async (request) => {
    const user = me(request);
    const access = requireAccess(user, request.params.id);
    const canLink = access.role !== 'view' && settings.get('share.links') && Boolean(access.node.parent_id);
    const canGrant = access.role === 'owner' && settings.get('share.users') && Boolean(access.node.parent_id);
    return {
      role: access.role,
      canLink,
      canGrant,
      links: access.role === 'view' ? [] : linksForNode(access.node.id).map((link) => presentLink(link, request)),
      grants: access.role === 'owner' ? grantsForNode(access.node.id).map(presentGrant) : [],
    };
  });

  app.post<{ Params: { id: string } }>('/api/nodes/:id/links', async (request) => {
    const link = await createLink(me(request), request.params.id, parse(linkSchema, request.body));
    return { link: presentLink(link, request) };
  });

  app.patch<{ Params: { id: string } }>('/api/links/:id', async (request) => {
    const link = await updateLink(me(request), request.params.id, parse(linkSchema, request.body));
    return { link: presentLink(link, request) };
  });

  app.delete<{ Params: { id: string } }>('/api/links/:id', async (request) => {
    deleteLink(me(request), request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/nodes/:id/grants', async (request) => {
    const input = parse(z.object({ userId: z.number().int().positive(), permission }), request.body);
    return { grant: presentGrant(shareWith(me(request), request.params.id, input.userId, input.permission)) };
  });

  app.patch<{ Params: { id: string } }>('/api/grants/:id', async (request) => {
    const input = parse(z.object({ permission }), request.body);
    return { grant: presentGrant(updateGrant(me(request), request.params.id, input.permission)) };
  });

  app.delete<{ Params: { id: string } }>('/api/grants/:id', async (request) => {
    removeGrant(me(request), request.params.id);
    return { ok: true };
  });

  app.get('/api/shared', async (request) => {
    const user = me(request);
    const withMe = sharedWithMe(user);
    const nodes = present(
      withMe.map((entry) => entry.node),
      user,
      (node) => withMe.find((entry) => entry.node.id === node.id)?.grant.permission ?? 'view'
    ).map((node) => ({ ...node, grantId: withMe.find((entry) => entry.node.id === node.id)?.grant.id }));
    const links = linksBy(user)
      .map((link) => ({ link, node: getNode(link.node_id) }))
      .filter((entry) => entry.node && !entry.node.trashed_at);
    const grants = sharedByMe(user)
      .map((grant) => ({ grant, node: getNode(grant.node_id) }))
      .filter((entry) => entry.node && !entry.node.trashed_at);
    const byMeNodes = new Map(
      present(
        [...links.map((entry) => entry.node!), ...grants.map((entry) => entry.node!)].filter(
          (node, index, list) => list.findIndex((other) => other.id === node.id) === index
        ),
        user
      ).map((node) => [node.id, node])
    );
    return {
      withMe: nodes,
      links: links.map((entry) => ({ ...presentLink(entry.link, request), node: byMeNodes.get(entry.node!.id) })),
      grants: grants.map((entry) => ({ ...presentGrant(entry.grant), node: byMeNodes.get(entry.node!.id) })),
    };
  });

  app.get<{ Querystring: { q?: string } }>('/api/users/search', async (request) => {
    const user = me(request);
    if (!settings.get('share.users')) throw forbidden('Teilen mit anderen Personen ist auf diesem Server ausgeschaltet');
    const query = String(request.query.q ?? '').trim();
    if (!settings.get('users.directory') && user.role !== 'admin') {
      return {
        items: query.length >= 3 ? searchUsers(query, user.id).filter((entry) => entry.username.toLowerCase() === query.toLowerCase()) : [],
      };
    }
    return { items: query ? searchUsers(query, user.id) : [] };
  });
}
