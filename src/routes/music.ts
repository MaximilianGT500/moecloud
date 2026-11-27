import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contentDisposition } from '../lib/http.ts';
import { me } from '../lib/request.ts';
import { id, ids, parse } from '../lib/validate.ts';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  exportM3u,
  importM3u,
  clearPlays,
  listPlaylists,
  listTracks,
  playlistContent,
  recordPlay,
  removeFromPlaylist,
  showPlaylist,
  updatePlaylist,
} from '../services/music.ts';
import { lyricsFor } from '../services/lyrics.ts';

type IdParams = { Params: { id: string } };

const name = z.string().max(500);

export async function musicRoutes(app: FastifyInstance) {
  app.get('/api/music', async (request) => listTracks(me(request)));

  app.get<IdParams>('/api/nodes/:id/lyrics', async (request) => lyricsFor(me(request), request.params.id));

  app.post('/api/music/played', { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } }, async (request) => {
    const input = parse(z.object({ id }), request.body);
    recordPlay(me(request), input.id);
    return { ok: true };
  });

  app.delete('/api/music/played', async (request) => {
    clearPlays(me(request));
    return { ok: true };
  });

  app.get('/api/playlists', async (request) => ({ items: listPlaylists(me(request)) }));

  app.post('/api/playlists', async (request) => {
    const user = me(request);
    const input = parse(z.object({ name, ids: z.array(id).max(1000).default([]) }), request.body);
    return { playlist: showPlaylist(user, createPlaylist(user, input.name, input.ids)) };
  });

  app.get<IdParams>('/api/playlists/:id', async (request) => {
    const { playlist, items } = playlistContent(me(request), request.params.id);
    return { playlist, items };
  });

  app.patch<IdParams>('/api/playlists/:id', async (request) => {
    const user = me(request);
    const input = parse(z.object({ name: name.optional(), order: z.array(id).max(5000).optional() }), request.body);
    return { playlist: showPlaylist(user, updatePlaylist(user, request.params.id, input)) };
  });

  app.delete<IdParams>('/api/playlists/:id', async (request) => {
    deletePlaylist(me(request), request.params.id);
    return { ok: true };
  });

  app.post<IdParams>('/api/playlists/:id/items', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { added: addToPlaylist(me(request), request.params.id, input.ids) };
  });

  app.post<IdParams>('/api/playlists/:id/remove', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { removed: removeFromPlaylist(me(request), request.params.id, input.ids) };
  });

  app.get<IdParams>('/api/playlists/:id/m3u', async (request, reply) => {
    const list = exportM3u(me(request), request.params.id);
    reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    reply.header('Content-Disposition', contentDisposition(`${list.name}.m3u8`, 'attachment'));
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(list.text);
  });

  app.post<IdParams>('/api/nodes/:id/playlist', async (request) => importM3u(me(request), request.params.id));
}
