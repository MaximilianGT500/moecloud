import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forbidden } from '../lib/errors.ts';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { sendNode, sendThumb } from '../routes/files.ts';
import { appAllowed } from '../services/apps.ts';
import { changed, findChild, insertNode, requireFolder } from '../services/nodes.ts';
import * as settings from '../services/settings.ts';
import { searchUsers } from '../services/users.ts';
import { statusMap } from '../services/status.ts';
import {
  addMembers,
  chatFile,
  createGroup,
  deleteMessage,
  editMessage,
  ensureSelf,
  listMessages,
  listRooms,
  markRead,
  memberSettings,
  membership,
  openDirect,
  presentRoom,
  removeMember,
  roomDetails,
  searchChat,
  sendMessage,
  toggleReaction,
  unreadTotal,
  updateRoom,
} from './store.ts';

const roomName = z.string().trim().min(1, 'Gib der Gruppe einen Namen').max(80, 'Höchstens 80 Zeichen');
const ids = z.array(z.number().int().positive()).max(200);

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const user = request.auth?.user;
    if (user && !appAllowed('chat', user)) throw forbidden('Gastkonten haben keinen Chat');
  });

  app.get('/api/chat/rooms', async (request) => ({ rooms: listRooms(me(request)) }));

  app.post('/api/chat/rooms', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const input = parse(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('direct'), user: z.number().int().positive() }),
        z.object({ kind: z.literal('group'), name: roomName, members: ids.min(1, 'Wähl mindestens eine Person aus') }),
        z.object({ kind: z.literal('self') }),
      ]),
      request.body
    );
    const room =
      input.kind === 'self'
        ? ensureSelf(user)
        : input.kind === 'direct'
          ? openDirect(user, input.user)
          : createGroup(user, input.name, input.members);
    const { member } = membership(user, room.id);
    return { room: presentRoom(room, user, member) };
  });

  app.get<{ Params: { id: string } }>('/api/chat/rooms/:id', async (request) => roomDetails(me(request), request.params.id));

  app.patch<{ Params: { id: string } }>('/api/chat/rooms/:id', async (request) => {
    const input = parse(z.object({ name: roomName, topic: z.string().trim().max(300) }).partial(), request.body);
    updateRoom(me(request), request.params.id, input);
    return roomDetails(me(request), request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/chat/rooms/:id/members', async (request) => {
    const input = parse(z.object({ users: ids.min(1) }), request.body);
    addMembers(me(request), request.params.id, input.users);
    return roomDetails(me(request), request.params.id);
  });

  app.delete<{ Params: { id: string; user: string } }>('/api/chat/rooms/:id/members/:user', async (request) => {
    removeMember(me(request), request.params.id, Number(request.params.user));
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/chat/rooms/:id/settings', async (request) => {
    const input = parse(z.object({ muted: z.boolean(), pinned: z.boolean() }).partial(), request.body);
    memberSettings(me(request), request.params.id, input);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/chat/rooms/:id/read', async (request) => {
    const input = parse(z.object({ upTo: z.number().int().min(0).optional() }), request.body ?? {});
    markRead(me(request), request.params.id, input.upTo);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>('/api/chat/rooms/:id/messages', async (request) => {
    const before = Number(request.query.before);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 50));
    return listMessages(me(request), request.params.id, Number.isInteger(before) && before > 0 ? before : null, limit);
  });

  app.post<{ Params: { id: string } }>(
    '/api/chat/rooms/:id/messages',
    { config: { rateLimit: { max: 300, timeWindow: '5 minutes' } } },
    async (request) => {
      const input = parse(
        z.object({
          body: z.string().max(20_000).default(''),
          replyTo: z.number().int().positive().nullable().optional(),
          files: z.array(z.string().min(1).max(40)).max(20).optional(),
        }),
        request.body
      );
      return { message: sendMessage(me(request), request.params.id, input) };
    }
  );

  app.patch<{ Params: { id: string } }>('/api/chat/messages/:id', async (request) => {
    const input = parse(z.object({ body: z.string().max(20_000) }), request.body);
    return { message: editMessage(me(request), Number(request.params.id), input.body) };
  });

  app.delete<{ Params: { id: string } }>('/api/chat/messages/:id', async (request) => {
    deleteMessage(me(request), Number(request.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/chat/messages/:id/reactions', async (request) => {
    const input = parse(z.object({ emoji: z.string().min(1).max(16) }), request.body);
    return { reactions: toggleReaction(me(request), Number(request.params.id), input.emoji) };
  });

  app.get<{ Params: { id: string; node: string }; Querystring: { download?: string } }>(
    '/api/chat/rooms/:id/files/:node',
    async (request, reply) => {
      const user = me(request);
      const node = chatFile(user, request.params.id, request.params.node);
      return sendNode(request, reply, node, request.query.download === '1', {
        strip: node.owner_id !== user.id && settings.get('share.stripLocation'),
      });
    }
  );

  app.get<{ Params: { id: string; node: string } }>('/api/chat/rooms/:id/files/:node/thumb', async (request, reply) => {
    const node = chatFile(me(request), request.params.id, request.params.node);
    return sendThumb(request, reply, node);
  });

  app.post('/api/chat/folder', async (request) => {
    const user = me(request);
    const root = requireFolder(user, user.root_id, 'edit').node;
    const existing = findChild(root.id, 'Chat');
    if (existing && existing.type === 'folder' && !existing.trashed_at) return { id: existing.id };
    const created = insertNode({
      ownerId: user.id,
      parentId: root.id,
      type: 'folder',
      name: existing ? `Chat ${Date.now().toString(36)}` : 'Chat',
      actorId: user.id,
    });
    changed([root.id]);
    return { id: created.id };
  });

  app.get<{ Querystring: { q?: string } }>('/api/chat/people', async (request) => {
    const user = me(request);
    const query = String(request.query.q ?? '')
      .trim()
      .slice(0, 100);
    if (!query) return { people: [] };
    const found = searchUsers(query, user.id).filter((entry) => !entry.guest);
    const visible =
      settings.get('users.directory') || user.role === 'admin'
        ? found
        : found.filter((entry) => entry.username.toLowerCase() === query.toLowerCase());
    const statuses = statusMap(visible.map((entry) => entry.id));
    return { people: visible.map((entry) => ({ ...entry, status: statuses.get(entry.id) ?? null })) };
  });

  app.get('/api/chat/unread', async (request) => ({ unread: unreadTotal(me(request)) }));

  app.get<{ Querystring: { q?: string } }>('/api/chat/search', async (request) => {
    const query = String(request.query.q ?? '')
      .trim()
      .slice(0, 100);
    return { results: query.length >= 2 ? searchChat(me(request), query, 20) : [] };
  });
}
