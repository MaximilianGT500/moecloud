import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { createNote, listNotes, listTasks, readNote, saveNote, toggleNoteTask } from '../services/notes.ts';

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

  app.get('/api/notes/tasks', async (request) => listTasks(me(request)));

  app.post<IdParams>('/api/notes/:id/tasks', async (request) => {
    const input = parse(z.object({ line: z.number().int().min(0).max(200_000), text: z.string().max(300) }), request.body);
    return toggleNoteTask(me(request), request.params.id, input.line, input.text);
  });

  app.get<IdParams>('/api/notes/:id', async (request) => readNote(me(request), request.params.id));

  app.put<IdParams>('/api/notes/:id', async (request) => {
    const input = parse(z.object({ content, base: z.string().max(64).optional() }), request.body);
    return saveNote(me(request), request.params.id, input.content, input.base);
  });
}
