import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { me } from '../lib/request.ts';
import { hexColor, parse } from '../lib/validate.ts';
import { createPage, deletePage, listPages, pageBookings, updatePage } from './booking.ts';
import { closePoll, createPoll, deletePoll, finalizePoll, listPolls, removeVote, updatePoll } from './polls.ts';
import * as settings from '../services/settings.ts';
import { guardCalendar } from './guard.ts';

const interval = z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]);

const pageSchema = z
  .object({
    slug: z.string().trim().max(50),
    title: z.string().trim().min(1, 'Gib der Seite einen Titel').max(120),
    description: z.string().max(4000),
    calendarId: z.string().max(40).nullable(),
    durations: z.array(z.number().int().min(5).max(720)).min(1, 'Wähl mindestens eine Dauer').max(6),
    availability: z.object({
      weekly: z.record(z.string(), z.array(interval).max(12)),
      dates: z.record(z.string(), z.array(interval).max(12)),
    }),
    zone: z.string().max(64),
    bufferBefore: z.number().int().min(0).max(240),
    bufferAfter: z.number().int().min(0).max(240),
    notice: z.number().int().min(0).max(43_200),
    window: z.number().int().min(1).max(365),
    maxPerDay: z.number().int().min(0).max(50),
    step: z.number().int().min(5).max(60),
    conflicts: z.array(z.string().max(40)).max(50),
    locationKind: z.enum(['none', 'place', 'phone', 'video', 'link']),
    location: z.string().max(500),
    questions: z
      .array(
        z.object({
          id: z.string().max(20),
          label: z.string().trim().min(1).max(200),
          type: z.enum(['text', 'textarea', 'phone', 'select', 'checkbox']),
          required: z.boolean(),
          options: z.array(z.string().max(100)).max(20),
        })
      )
      .max(10),
    color: hexColor.nullable(),
    enabled: z.boolean(),
  })
  .partial();

const pollSchema = z
  .object({
    title: z.string().trim().min(1, 'Gib der Umfrage einen Titel').max(150),
    description: z.string().max(4000),
    location: z.string().max(500),
    zone: z.string().max(64),
    options: z
      .array(
        z.object({
          id: z.string().max(20).optional(),
          start: z.number().int().min(-8.64e15).max(8.64e15),
          end: z.number().int(),
          allDay: z.boolean().optional(),
        })
      )
      .max(60),
    settings: z.object({ maybe: z.boolean(), hidden: z.boolean(), email: z.boolean(), limit: z.number().int().min(0).max(1000) }).partial(),
    deadline: z.number().int().min(-8.64e15).max(8.64e15).nullable(),
  })
  .partial();

export async function schedulingRoutes(app: FastifyInstance) {
  guardCalendar(app);
  app.get('/api/calendar/booking-pages', async (request) => ({ items: listPages(me(request)), enabled: settings.get('calendar.booking') }));

  app.post('/api/calendar/booking-pages', async (request) => ({ page: createPage(me(request), parse(pageSchema, request.body)) }));

  app.patch<{ Params: { id: string } }>('/api/calendar/booking-pages/:id', async (request) => ({
    page: updatePage(me(request), request.params.id, parse(pageSchema, request.body)),
  }));

  app.delete<{ Params: { id: string } }>('/api/calendar/booking-pages/:id', async (request) => {
    deletePage(me(request), request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/booking-pages/:id/bookings', async (request) => ({
    items: pageBookings(me(request), request.params.id),
  }));

  app.get('/api/calendar/polls', async (request) => ({ items: listPolls(me(request)), enabled: settings.get('calendar.polls') }));

  app.post('/api/calendar/polls', async (request) => ({ poll: createPoll(me(request), parse(pollSchema, request.body)) }));

  app.patch<{ Params: { id: string } }>('/api/calendar/polls/:id', async (request) => ({
    poll: updatePoll(me(request), request.params.id, parse(pollSchema, request.body)),
  }));

  app.delete<{ Params: { id: string } }>('/api/calendar/polls/:id', async (request) => {
    deletePoll(me(request), request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/polls/:id/close', async (request) => {
    const { closed } = parse(z.object({ closed: z.boolean() }), request.body);
    return { poll: closePoll(me(request), request.params.id, closed) };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/polls/:id/finalize', async (request) => {
    const input = parse(z.object({ option: z.string().max(20), calendarId: z.string().max(40), invite: z.boolean() }), request.body);
    return finalizePoll(me(request), request.params.id, input);
  });

  app.delete<{ Params: { id: string; vote: string } }>('/api/calendar/polls/:id/votes/:vote', async (request) => ({
    poll: removeVote(me(request), request.params.id, request.params.vote),
  }));
}
