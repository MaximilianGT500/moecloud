import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { createNote, listNotes, readNote, saveNote } from '../services/notes.ts';

type IdParams = { Params: { id: string } };

const content = z.string().max(2_000_000);

export async function noteRoutes(app: FastifyInstance) {
  app.get('/api/notes', async (request) => listNotes(me(request)));

  app.post('/api/notes', async (request) => {
    const input = parse(
      z.object({ title: z.string().max(200).optional(), content: content.optional(), category: z.string().max(300).optional() }),
      request.body
    );
    return { note: await createNote(me(request), input) };
  });

  app.get<IdParams>('/api/notes/:id', async (request) => readNote(me(request), request.params.id));

  app.put<IdParams>('/api/notes/:id', async (request) => {
    const input = parse(z.object({ content, base: z.string().max(64).optional() }), request.body);
    return saveNote(me(request), request.params.id, input.content, input.base);
  });
}
