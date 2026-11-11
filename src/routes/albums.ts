import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { id, ids, parse } from '../lib/validate.ts';
import {
  addToAlbum,
  albumContent,
  createAlbum,
  deleteAlbum,
  listAlbums,
  removeFromAlbum,
  showAlbum,
  updateAlbum,
} from '../services/albums.ts';
import { sendZip } from './files.ts';

type IdParams = { Params: { id: string } };

const name = z.string().max(500);

export async function albumRoutes(app: FastifyInstance) {
  app.get('/api/albums', async (request) => ({ items: listAlbums(me(request)) }));

  app.post('/api/albums', async (request) => {
    const user = me(request);
    const input = parse(z.object({ name, ids: z.array(id).max(1000).default([]) }), request.body);
    return { album: showAlbum(user, createAlbum(user, input.name, input.ids)) };
  });

  app.get<IdParams>('/api/albums/:id', async (request) => {
    const { album, items } = albumContent(me(request), request.params.id);
    return { album, items };
  });

  app.patch<IdParams>('/api/albums/:id', async (request) => {
    const user = me(request);
    const input = parse(z.object({ name: name.optional(), coverId: id.nullable().optional() }), request.body);
    return { album: showAlbum(user, updateAlbum(user, request.params.id, input)) };
  });

  app.delete<IdParams>('/api/albums/:id', async (request) => {
    deleteAlbum(me(request), request.params.id);
    return { ok: true };
  });

  app.post<IdParams>('/api/albums/:id/items', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { added: addToAlbum(me(request), request.params.id, input.ids) };
  });

  app.post<IdParams>('/api/albums/:id/remove', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { removed: removeFromAlbum(me(request), request.params.id, input.ids) };
  });

  app.get<IdParams>('/api/albums/:id/zip', { compress: false }, async (request, reply) => {
    const { album, nodes } = albumContent(me(request), request.params.id);
    return sendZip(request, reply, nodes, `${album.name}.zip`);
  });
}
