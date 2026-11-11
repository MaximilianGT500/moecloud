import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, tooMany } from '../lib/errors.ts';
import { longDate, t } from '../lib/i18n.ts';
import { Limiter } from '../lib/limiter.ts';
import { me } from '../lib/request.ts';
import { email, parse } from '../lib/validate.ts';
import { getNode, present, requireAccess } from '../services/nodes.ts';
import { activeLink, createLink, deleteLink, linksBy, linksForNode, presentLink, updateLink } from '../services/links.ts';
import { deliver, mailReady } from '../services/mail.ts';
import {
  getGrant,
  grantsForNode,
  presentGrant,
  removeGrant,
  sharedByMe,
  sharedWithMe,
  shareWith,
  updateGrant,
} from '../services/grants.ts';
import {
  getGroupGrant,
  groupGrantsForNode,
  groupSharesBy,
  presentGroupGrant,
  removeGroupGrant,
  searchGroups,
  sharedWithMeViaGroups,
  shareWithGroup,
  updateGroupGrant,
} from '../services/groups.ts';
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
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  paused: z.boolean().optional(),
});

const permission = z.enum(['view', 'edit']);
const recipient = z.object({
  email: email
    .refine((value) => value !== '', 'Gib eine E-Mail-Adresse ein')
    .refine((value) => !/[,;<>()"\\]/.test(value), 'Die E-Mail-Adresse sieht nicht richtig aus'),
});
const linkMails = new Limiter(30, 60 * 60 * 1000);

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
      grants:
        access.role === 'owner'
          ? [...grantsForNode(access.node.id).map(presentGrant), ...groupGrantsForNode(access.node.id).map(presentGroupGrant)]
          : [],
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

  app.post<{ Params: { id: string } }>('/api/links/:id/send', async (request) => {
    const user = me(request);
    const input = parse(recipient, request.body);
    if (!mailReady()) throw badRequest('Der E-Mail-Versand ist auf diesem Server nicht eingerichtet');
    const { link, node } = activeLink(user, request.params.id);
    const key = String(user.id);
    if (linkMails.blocked(key)) throw tooMany('Du hast gerade viele E-Mails verschickt, versuch es später noch einmal');
    linkMails.hit(key);
    const lang = settings.get('site.language');
    const names = { name: user.name, item: node.name };
    try {
      await deliver(input.email, {
        lang,
        title: t(lang, '{name} teilt „{item}“ mit dir', names),
        lines: [
          link.upload_only
            ? t(lang, 'Über den Link lädst du Dateien für {name} hoch.', names)
            : t(lang, 'Über den Link kommst du ohne Konto an den Inhalt.'),
          ...(link.password_hash
            ? [t(lang, 'Der Link ist mit einem Passwort geschützt, das dir {name} auf einem anderen Weg gibt.', names)]
            : []),
          ...(link.expires_at ? [t(lang, 'Der Link gilt bis zum {date}.', { date: longDate(lang, link.expires_at) })] : []),
        ],
        action: { label: t(lang, 'Link öffnen'), url: presentLink(link, request).url },
        note: t(lang, 'Du bekommst diese E-Mail, weil {name} deine Adresse eingegeben hat.', names),
      });
    } catch (error) {
      request.log.warn({ error: (error as Error).message }, 'Link konnte nicht per E-Mail gesendet werden');
      throw badRequest('Die E-Mail konnte nicht verschickt werden, versuch es später noch einmal');
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/nodes/:id/grants', async (request) => {
    const input = parse(
      z.union([
        z.object({ userId: z.number().int().positive(), permission }),
        z.object({ groupId: z.number().int().positive(), permission }),
      ]),
      request.body
    );
    if ('groupId' in input) {
      return { grant: presentGroupGrant(shareWithGroup(me(request), request.params.id, input.groupId, input.permission)) };
    }
    return { grant: presentGrant(shareWith(me(request), request.params.id, input.userId, input.permission)) };
  });

  app.patch<{ Params: { id: string } }>('/api/grants/:id', async (request) => {
    const input = parse(z.object({ permission }), request.body);
    if (!getGrant(request.params.id) && getGroupGrant(request.params.id)) {
      return { grant: presentGroupGrant(updateGroupGrant(me(request), request.params.id, input.permission)) };
    }
    return { grant: presentGrant(updateGrant(me(request), request.params.id, input.permission)) };
  });

  app.delete<{ Params: { id: string } }>('/api/grants/:id', async (request) => {
    if (!getGrant(request.params.id) && getGroupGrant(request.params.id)) removeGroupGrant(me(request), request.params.id);
    else removeGrant(me(request), request.params.id);
    return { ok: true };
  });

  app.get('/api/shared', async (request) => {
    const user = me(request);
    const withMe = sharedWithMe(user);
    const groupShares = sharedWithMeViaGroups(user);
    const viaGroups = groupShares.filter(
      (entry, index, list) =>
        !withMe.some((direct) => direct.node.id === entry.node.id) && list.findIndex((other) => other.node.id === entry.node.id) === index
    );
    const permissionOf = (nodeId: string) => {
      const permissions = [
        ...withMe.filter((entry) => entry.node.id === nodeId).map((entry) => entry.grant.permission),
        ...groupShares.filter((entry) => entry.node.id === nodeId).map((entry) => entry.grant.permission),
      ];
      return permissions.includes('edit') ? 'edit' : 'view';
    };
    const nodes = present([...withMe.map((entry) => entry.node), ...viaGroups.map((entry) => entry.node)], user, (node) =>
      permissionOf(node.id)
    ).map((node) => ({
      ...node,
      grantId: withMe.find((entry) => entry.node.id === node.id)?.grant.id,
      viaGroup: viaGroups.find((entry) => entry.node.id === node.id)?.grant.group_name,
    }));
    const links = linksBy(user)
      .map((link) => ({ link, node: getNode(link.node_id) }))
      .filter((entry) => entry.node && !entry.node.trashed_at);
    const grants = [
      ...sharedByMe(user).map((grant) => ({ grant: presentGrant(grant), node: getNode(grant.node_id) })),
      ...groupSharesBy(user).map((grant) => ({ grant: presentGroupGrant(grant), node: getNode(grant.node_id) })),
    ].filter((entry) => entry.node && !entry.node.trashed_at);
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
      grants: grants.map((entry) => ({ ...entry.grant, node: byMeNodes.get(entry.node!.id) })),
    };
  });

  app.get<{ Querystring: { q?: string } }>('/api/users/search', async (request) => {
    const user = me(request);
    if (!settings.get('share.users')) throw forbidden('Teilen mit anderen Personen ist auf diesem Server ausgeschaltet');
    const query = String(request.query.q ?? '').trim();
    const groups = query ? searchGroups(user, query) : [];
    if (!settings.get('users.directory') && user.role !== 'admin') {
      return {
        items: query.length >= 3 ? searchUsers(query, user.id).filter((entry) => entry.username.toLowerCase() === query.toLowerCase()) : [],
        groups,
      };
    }
    return { items: query ? searchUsers(query, user.id) : [], groups };
  });
}
