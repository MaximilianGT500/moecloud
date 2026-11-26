import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { me } from '../lib/request.ts';
import { hexColor, intOf, parse } from '../lib/validate.ts';
import { isZone, DAY } from '../../shared/time.ts';
import { isRegion } from '../../shared/holidays.ts';
import { describeRule, parseRule } from '../../shared/rrule.ts';
import { t } from '../lib/i18n.ts';
import { audit } from '../services/audit.ts';
import {
  deleteCalendarForever,
  getCalendar,
  insertCalendar,
  listCalendars,
  listShares,
  removeShare,
  reorderCalendars,
  requireCalendar,
  restoreCalendar,
  setPublic,
  setShare,
  trashCalendar,
  updateCalendar,
} from './calendars.ts';
import {
  calendarMembers,
  completeTask,
  createItem,
  deleteItem,
  deleteItemForever,
  detail,
  duplicateItem,
  getEvent,
  listOccurrences,
  listTasks,
  listTrash,
  requireEvent,
  restoreItem,
  searchEvents,
  updateItem,
  upcomingFor,
  type EventInput,
} from './events.ts';
import { hideInvitation, pendingInvitations, rsvpAsUser } from './invitations.ts';
import { contactsAllowed } from '../contacts/books.ts';
import { suggestContacts } from '../contacts/store.ts';
import { deleteTemplate, freebusyFor, listTemplates, saveTemplate, sendAgendaNow, statistics, suggestTimes } from './insights.ts';
import { notify } from '../services/notify.ts';
import { rescheduleUser } from './alarms.ts';
import * as settings from '../services/settings.ts';
import { detachSubscription, exportCsv, exportForUser, exportZip, importForUser, refreshNow, subscribe } from './transfer.ts';
import {
  discardImport,
  getImport,
  presentImport,
  runImport,
  startCaldavImport,
  startFileImport,
  startNodeImport,
  startUrlImport,
} from './importer.ts';
import { SOURCE_LIMITS } from './sources.ts';
import { getUser, prefsOf, updateCalendarPrefs, zoneOf } from '../services/users.ts';
import { calendarAllowed, guardCalendar, searchPeople } from './guard.ts';

const alarm = z.object({
  offset: z
    .number()
    .int()
    .min(-366 * DAY)
    .max(366 * DAY),
  related: z.enum(['START', 'END']).optional(),
  absolute: z.number().int().min(-8.64e15).max(8.64e15).nullable().optional(),
  action: z.enum(['DISPLAY', 'EMAIL']).optional(),
});

const timeValue = z.union([z.number(), z.string().max(40)]).nullable();

const eventSchema = z
  .object({
    calendarId: z.string().max(40),
    component: z.enum(['VEVENT', 'VTODO']),
    title: z.string().max(500),
    description: z.string().max(20_000),
    location: z.string().max(500),
    url: z.string().max(2000),
    conference: z.string().max(2000).nullable(),
    allDay: z.boolean(),
    start: timeValue,
    end: timeValue,
    due: timeValue,
    zone: z.string().max(64),
    rrule: z.string().max(500).nullable(),
    status: z.string().max(20).nullable(),
    transparency: z.enum(['OPAQUE', 'TRANSPARENT']),
    privacy: z.enum(['PUBLIC', 'PRIVATE', 'CONFIDENTIAL']),
    color: z.string().max(20).nullable(),
    categories: z.array(z.string().max(60)).max(20),
    alarms: z.array(alarm).max(10),
    attendees: z
      .array(
        z.object({
          email: z.string().max(254),
          name: z.string().max(120).nullable().optional(),
          role: z.enum(['REQ-PARTICIPANT', 'OPT-PARTICIPANT', 'CHAIR', 'NON-PARTICIPANT']).optional(),
        })
      )
      .max(200),
    kind: z.enum(['event', 'birthday', 'focus', 'ooo']),
    birthYear: z.number().int().min(1800).max(2200).nullable(),
    assignee: z.number().int().positive().nullable(),
    priority: z.number().int().min(0).max(9),
    percent: z.number().int().min(0).max(100),
    completed: z.boolean(),
    parent: z.string().max(255).nullable(),
    exdates: z.array(z.string().max(20)).max(5000),
  })
  .partial();

const scopeSchema = z.object({
  scope: z.enum(['all', 'this', 'following']).optional().default('all'),
  recurrenceId: z
    .string()
    .regex(/^\d{8}(T\d{6}Z)?$/)
    .nullable()
    .optional()
    .default(null),
});

const alarmSpec = z.object({ minutes: z.number().int().min(-10_000).max(527_040), email: z.boolean().optional() });

const prefsSchema = z
  .object({
    view: z.enum(['day', 'week', 'workweek', 'days3', 'month', 'year', 'agenda', 'tasks']),
    weekStart: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    slot: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    scrollTo: z.number().int().min(0).max(1440),
    workStart: z.number().int().min(0).max(1440),
    workEnd: z.number().int().min(0).max(1440),
    workDays: z.array(z.number().int().min(0).max(6)).max(7),
    weekends: z.boolean(),
    weekNumbers: z.boolean(),
    declined: z.boolean(),
    dimPast: z.boolean(),
    zone2: z.string().max(64).nullable(),
    duration: z.number().int().min(5).max(1440),
    alarms: z.array(alarmSpec).max(5),
    alldayAlarms: z.array(alarmSpec).max(5),
    holidays: z.array(z.string().max(10)).max(10),
    observances: z.boolean(),
    moon: z.boolean(),
    emoji: z.boolean(),
    tasksInCalendar: z.boolean(),
    completedTasks: z.boolean(),
    density: z.enum(['comfortable', 'compact']),
    defaultCalendar: z.string().max(40).nullable(),
    freebusy: z.boolean(),
    agenda: z.enum(['off', 'daily', 'weekly']),
    agendaTime: z.number().int().min(0).max(1439),
    colorBy: z.enum(['calendar', 'category']),
    hideTitle: z.boolean(),
  })
  .partial();

const range = z.object({
  from: z.coerce.number().int().min(-8.64e15).max(8.64e15),
  to: z.coerce.number().int().min(-8.64e15).max(8.64e15),
  calendars: z.string().max(4000).optional(),
});

const instant = (value: unknown) => {
  const parsed = intOf(value);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) <= 8.64e15 ? parsed : null;
};

const personId = (value: unknown) => {
  const parsed = intOf(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw notFound('Diese Person gibt es nicht');
  return parsed;
};

const ids = (value?: string) => (value ? value.split(',').filter((id) => /^[0-9A-Za-z]{8,40}$/.test(id)) : undefined);

export async function calendarRoutes(app: FastifyInstance) {
  guardCalendar(app);
  app.get('/api/calendar/calendars', async (request) => {
    const user = me(request);
    return { calendars: listCalendars(user), prefs: prefsOf(user).calendar, zone: zoneOf(user) };
  });

  app.post('/api/calendar/calendars', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        name: z.string().trim().min(1, 'Gib dem Kalender einen Namen').max(100),
        color: hexColor.optional(),
        description: z.string().max(2000).optional(),
        components: z.enum(['VEVENT,VTODO', 'VEVENT', 'VTODO']).optional(),
        zone: z.string().max(64).nullable().optional(),
      }),
      request.body
    );
    const calendar = insertCalendar(user, input);
    return { calendar: listCalendars(user).find((entry) => entry.id === calendar.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/calendar/calendars/:id', async (request) => {
    const user = me(request);
    const input = parse(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          color: hexColor,
          description: z.string().max(2000).nullable(),
          hidden: z.boolean(),
          zone: z.string().max(64).nullable(),
          alarms: z.array(alarmSpec).max(5).nullable(),
          alldayAlarms: z.array(alarmSpec).max(5).nullable(),
          refreshMinutes: z.number().int().min(5).max(10_080).nullable(),
          notify: z.boolean(),
        })
        .partial(),
      request.body
    );
    updateCalendar(user, request.params.id, input);
    if (input.notify !== undefined) rescheduleUser(user.id);
    return { calendar: listCalendars(user).find((entry) => entry.id === request.params.id) ?? null };
  });

  app.put('/api/calendar/calendars/order', async (request) => {
    const user = me(request);
    const { order } = parse(z.object({ order: z.array(z.string().max(40)).max(500) }), request.body);
    reorderCalendars(user, order);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar/calendars/:id', async (request) => {
    const user = me(request);
    const calendar = getCalendar(request.params.id);
    if (calendar && calendar.owner_id !== user.id) {
      removeShare(user, request.params.id, user.id);
      return { left: true };
    }
    trashCalendar(user, request.params.id);
    return { trashed: true, days: settings.get('calendar.trashDays') };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/calendars/:id/restore', async (request) => {
    restoreCalendar(me(request), request.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar/calendars/:id/forever', async (request) => {
    deleteCalendarForever(me(request), request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/calendars/:id/members', async (request) => {
    const { calendar } = requireCalendar(me(request), request.params.id, 'read');
    return { members: calendarMembers(calendar) };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/calendars/:id/shares', async (request) => ({
    shares: listShares(me(request), request.params.id),
  }));

  app.put<{ Params: { id: string; userId: string } }>('/api/calendar/calendars/:id/shares/:userId', async (request) => {
    const user = me(request);
    const { permission } = parse(z.object({ permission: z.enum(['freebusy', 'read', 'write']) }), request.body);
    const result = setShare(user, request.params.id, personId(request.params.userId), permission);
    if (result.created) notify(result.target.id, 'calendar_shared', { by: user.name, name: result.calendar.name, permission }, '/calendar');
    return { shares: listShares(user, request.params.id) };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/calendar/calendars/:id/shares/:userId', async (request) => {
    const user = me(request);
    removeShare(user, request.params.id, personId(request.params.userId));
    return { shares: getCalendar(request.params.id)?.owner_id === user.id ? listShares(user, request.params.id) : [] };
  });

  app.put<{ Params: { id: string } }>('/api/calendar/calendars/:id/public', async (request) => {
    const user = me(request);
    const { mode, renew } = parse(z.object({ mode: z.enum(['details', 'busy']).nullable(), renew: z.boolean().optional() }), request.body);
    const calendar = setPublic(user, request.params.id, mode, renew);
    return { token: calendar.public_token, mode: calendar.public_mode };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/calendars/:id/refresh', async (request) => ({
    result: await refreshNow(me(request), request.params.id),
  }));

  app.post('/api/calendar/subscriptions', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        url: z.string().trim().min(1, 'Gib die Adresse des Kalenders ein').max(2000),
        name: z.string().max(100).optional(),
        color: hexColor.optional(),
        refreshMinutes: z.number().int().min(5).max(10_080).optional(),
      }),
      request.body
    );
    const calendar = subscribe(user, input);
    const result = await refreshNow(user, calendar.id).catch((error: Error) => ({ error: error.message }));
    return { calendar: listCalendars(user).find((entry) => entry.id === calendar.id), result };
  });

  app.post<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/calendar/calendars/:id/import',
    { bodyLimit: 32 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request) => {
      const user = me(request);
      const mode = request.query.mode === 'skip' || request.query.mode === 'copy' ? request.query.mode : 'merge';
      let text = '';
      if (request.isMultipart()) {
        const file = await request.file({ limits: { fileSize: 30 * 1024 * 1024 } });
        if (!file) throw badRequest('Wähl eine Datei aus');
        text = (await file.toBuffer()).toString('utf8');
      } else {
        const input = parse(z.object({ text: z.string().max(30 * 1024 * 1024) }), request.body);
        text = input.text;
      }
      const result = importForUser(user, request.params.id, text, mode);
      if (result.created + result.updated > 50) {
        notify(
          user.id,
          'calendar_import',
          { name: getCalendar(request.params.id)?.name ?? '', created: result.created, updated: result.updated, skipped: result.skipped },
          '/calendar',
          { mail: false, push: false }
        );
      }
      return result;
    }
  );

  app.post('/api/calendar/import', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    if (request.isMultipart()) {
      const files: { name: string; data: Buffer }[] = [];
      const parts = request.parts({ limits: { files: SOURCE_LIMITS.files, fileSize: SOURCE_LIMITS.bytes, fields: 5, parts: 60 } });
      for await (const part of parts) {
        if (part.type !== 'file') continue;
        files.push({ name: (part.filename || 'kalender.ics').slice(0, 255), data: await part.toBuffer() });
      }
      return { job: presentImport(await startFileImport(user, files), request.lang) };
    }
    const input = parse(
      z.union([
        z.object({ node: z.string().min(1).max(40) }),
        z.object({ url: z.string().trim().min(1).max(2000) }),
        z.object({
          caldav: z.object({
            url: z.string().trim().min(1).max(2000),
            username: z.string().max(200),
            password: z.string().max(1000),
          }),
        }),
      ]),
      request.body
    );
    const job =
      'node' in input
        ? await startNodeImport(user, input.node)
        : 'url' in input
          ? startUrlImport(user, input.url)
          : startCaldavImport(user, input.caldav);
    return { job: presentImport(job, request.lang) };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/import/:id', async (request) => ({
    job: presentImport(getImport(me(request), request.params.id), request.lang),
  }));

  app.post<{ Params: { id: string } }>('/api/calendar/import/:id/run', async (request) => {
    const input = parse(
      z.object({
        calendars: z
          .array(
            z.object({
              key: z.string().max(40),
              target: z.string().max(40),
              name: z.string().max(100).optional(),
              color: hexColor.optional(),
            })
          )
          .max(SOURCE_LIMITS.calendars),
        mode: z.enum(['merge', 'skip', 'copy']).default('merge'),
      }),
      request.body
    );
    const job = await runImport(me(request), request.params.id, input.calendars, input.mode);
    return { job: presentImport(job, request.lang) };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar/import/:id', async (request) => {
    discardImport(me(request), request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/calendars/:id/detach', async (request) => {
    const calendar = detachSubscription(me(request), request.params.id);
    return { ok: true, id: calendar.id };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/calendars/:id/export.ics', async (request, reply) => {
    const { name, ics } = exportForUser(me(request), request.params.id);
    return reply
      .type('text/calendar; charset=utf-8')
      .header('Content-Disposition', contentDisposition(`${name}.ics`, 'attachment'))
      .header('Cache-Control', 'no-store')
      .send(ics);
  });

  app.get(
    '/api/calendar/export.zip',
    { compress: false, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = me(request);
      audit('account_exported', { actor: user.id, request });
      return reply
        .type('application/zip')
        .header('Content-Disposition', contentDisposition(`Kalender-${user.username}.zip`, 'attachment'))
        .header('Cache-Control', 'no-store')
        .send(exportZip(user));
    }
  );

  app.get<{ Querystring: z.infer<typeof range> }>('/api/calendar/export.csv', async (request, reply) => {
    const user = me(request);
    const query = parse(range, request.query);
    if (query.to - query.from > 3 * 366 * DAY) throw badRequest('Der Zeitraum ist zu lang');
    const list = listOccurrences(user, { from: query.from, to: query.to, calendars: ids(query.calendars), tasks: false }).filter(
      (entry) => !entry.busyOnly
    );
    const rows = list.map((entry) => ({
      title: entry.title,
      start: entry.start,
      end: entry.end,
      allDay: entry.allDay,
      location: entry.location,
      calendar: getCalendar(entry.calendarId)?.name ?? '',
      description: '',
    }));
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition('Kalender.csv', 'attachment'))
      .send(exportCsv(rows, zoneOf(user), request.lang));
  });

  app.get<{ Querystring: z.infer<typeof range> & { tasks?: string; completed?: string } }>('/api/calendar/occurrences', async (request) => {
    const user = me(request);
    const query = parse(range.extend({ tasks: z.string().optional(), completed: z.string().optional() }), request.query);
    if (query.to <= query.from) throw badRequest('Der Zeitraum ist ungültig');
    if (query.to - query.from > 400 * DAY) throw badRequest('Der Zeitraum ist zu lang');
    const prefs = prefsOf(user).calendar;
    return {
      items: listOccurrences(user, {
        from: query.from,
        to: query.to,
        calendars: ids(query.calendars),
        tasks: query.tasks === '0' ? false : prefs.tasksInCalendar,
        completed: query.completed === '1' || prefs.completedTasks,
        declined: prefs.declined,
      }),
    };
  });

  app.get('/api/calendar/upcoming', async (request) => ({
    items: upcomingFor(me(request), 8),
    invitations: pendingInvitations(me(request)),
  }));

  app.get<{ Params: { id: string }; Querystring: { rid?: string } }>('/api/calendar/events/:id', async (request) => {
    const user = me(request);
    const rid = request.query.rid && /^\d{8}(T\d{6}Z)?$/.test(request.query.rid) ? request.query.rid : null;
    const result = detail(user, request.params.id, rid);
    const rule = result.data.rrule ? parseRule(result.data.rrule) : null;
    const start = result.data.start ?? result.data.due;
    return {
      ...result,
      recurrence:
        rule && start !== null
          ? describeRule(
              rule,
              new Date(start).toISOString().slice(0, 10),
              (text, params) => t(request.lang, text, params),
              request.lang === 'en' ? 'en-GB' : 'de-DE'
            )
          : null,
    };
  });

  app.post('/api/calendar/events', { config: { rateLimit: { max: 600, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    const input = parse(eventSchema.extend({ calendarId: z.string().max(40) }), request.body) as EventInput & { calendarId: string };
    const row = createItem(user, input);
    return { id: row.id, etag: row.etag };
  });

  app.patch<{ Params: { id: string } }>('/api/calendar/events/:id', async (request) => {
    const user = me(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { scope, recurrenceId } = parse(scopeSchema, { scope: body.scope, recurrenceId: body.recurrenceId });
    const input = parse(eventSchema, body.changes ?? {}) as EventInput;
    const result = updateItem(user, request.params.id, input, scope, recurrenceId);
    return { id: result.row.id, etag: result.row.etag, created: result.created?.id ?? null };
  });

  app.delete<{ Params: { id: string }; Querystring: { scope?: string; rid?: string } }>('/api/calendar/events/:id', async (request) => {
    const user = me(request);
    const { scope, recurrenceId } = parse(scopeSchema, { scope: request.query.scope, recurrenceId: request.query.rid ?? null });
    const result = deleteItem(user, request.params.id, scope, recurrenceId);
    return { trashed: result.trashed, days: settings.get('calendar.trashDays') };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/events/:id/restore', async (request) => {
    const row = restoreItem(me(request), request.params.id);
    return { id: row.id };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar/events/:id/forever', async (request) => {
    const user = me(request);
    const row = getEvent(request.params.id);
    if (!row || !row.trashed_at) throw notFound('Diesen Termin gibt es im Papierkorb nicht');
    requireCalendar(user, row.calendar_id, 'write');
    deleteItemForever(row);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/events/:id/duplicate', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({ recurrenceId: z.string().max(20).nullable().optional(), calendarId: z.string().max(40).optional() }),
      request.body
    );
    const row = duplicateItem(user, request.params.id, input.recurrenceId ?? null, input.calendarId);
    return { id: row.id };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/events/:id/rsvp', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({ status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']), comment: z.string().max(500).nullable().optional() }),
      request.body
    );
    rsvpAsUser(user, request.params.id, input);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/events/:id/hide', async (request) => {
    const { hidden } = parse(z.object({ hidden: z.boolean() }), request.body);
    hideInvitation(me(request), request.params.id, hidden);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/calendar/events/:id/complete', async (request) => {
    const user = me(request);
    const input = parse(z.object({ completed: z.boolean(), recurrenceId: z.string().max(20).nullable().optional() }), request.body);
    const result = completeTask(user, request.params.id, input.completed, input.recurrenceId ?? null);
    return { id: result.row.id };
  });

  app.get<{ Params: { id: string } }>('/api/calendar/events/:id/ics', async (request, reply) => {
    const found = requireEvent(me(request), request.params.id, 'read');
    return reply
      .type('text/calendar; charset=utf-8')
      .header('Content-Disposition', contentDisposition(`${found.row.title || 'termin'}.ics`, 'attachment'))
      .send(found.row.ics);
  });

  app.get<{ Querystring: { q?: string; calendars?: string; from?: string; to?: string } }>('/api/calendar/search', async (request) => {
    const user = me(request);
    const q = String(request.query.q ?? '').slice(0, 200);
    return {
      items: searchEvents(user, q, {
        calendars: ids(request.query.calendars),
        from: instant(request.query.from),
        to: instant(request.query.to),
      }),
    };
  });

  app.get<{ Querystring: { calendars?: string; completed?: string } }>('/api/calendar/tasks', async (request) => {
    const user = me(request);
    return { items: listTasks(user, { calendars: ids(request.query.calendars), completed: request.query.completed === '1' }) };
  });

  app.get('/api/calendar/trash', async (request) => ({ ...listTrash(me(request)), days: settings.get('calendar.trashDays') }));

  app.get('/api/calendar/templates', async (request) => ({ items: listTemplates(me(request)) }));

  app.post('/api/calendar/templates', async (request) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(1, 'Gib der Vorlage einen Namen').max(80),
        data: z.record(z.string(), z.unknown()),
        id: z.string().max(40).optional(),
      }),
      request.body
    );
    return { id: saveTemplate(me(request), input.name, input.data, input.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar/templates/:id', async (request) => {
    deleteTemplate(me(request), request.params.id);
    return { ok: true };
  });

  app.get('/api/calendar/prefs', async (request) => ({ prefs: prefsOf(me(request)).calendar }));

  app.patch('/api/calendar/prefs', async (request) => {
    const user = me(request);
    const input = parse(prefsSchema, request.body);
    if (input.zone2 && !isZone(input.zone2)) throw badRequest('Diese Zeitzone kennt MoeCloud nicht');
    if (input.holidays) input.holidays = input.holidays.filter(isRegion);
    if (input.defaultCalendar) requireCalendar(user, input.defaultCalendar, 'write');
    if (input.workDays) input.workDays = [...new Set(input.workDays)].sort();
    const prefs = updateCalendarPrefs(user.id, input);
    return { prefs };
  });

  app.post('/api/calendar/agenda-test', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request) => {
    const { weekly } = parse(z.object({ weekly: z.boolean().optional().default(false) }), request.body);
    await sendAgendaNow(me(request), weekly);
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string; contacts?: string } }>('/api/calendar/people', async (request) => {
    const user = me(request);
    const q = String(request.query.q ?? '').trim();
    const contacts =
      request.query.contacts === '1' && q.length >= 1 && contactsAllowed(user) ? suggestContacts(user, q.slice(0, 80), 6) : undefined;
    if (!settings.get('users.directory') && user.role !== 'admin') return { items: [], contacts };
    if (q.length < 1) return { items: [], contacts };
    return { items: searchPeople(q.slice(0, 80), user.id), contacts };
  });

  app.get<{ Querystring: { users?: string; from?: string; to?: string } }>('/api/calendar/freebusy', async (request) => {
    const user = me(request);
    const list = String(request.query.users ?? '')
      .split(',')
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    const from = instant(request.query.from) ?? Number.NaN;
    const to = instant(request.query.to) ?? Number.NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw badRequest('Der Zeitraum ist ungültig');
    return { people: freebusyFor(user, list.length ? list : [user.id], from, to) };
  });

  app.post('/api/calendar/freebusy/suggest', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        users: z.array(z.number().int().positive()).max(20),
        from: z.number().int().min(-8.64e15).max(8.64e15),
        to: z.number().int().min(-8.64e15).max(8.64e15),
        duration: z.number().int().min(5).max(720),
        dayStart: z.number().int().min(0).max(1440).optional(),
        dayEnd: z.number().int().min(0).max(1440).optional(),
        workdays: z.boolean().optional(),
      }),
      request.body
    );
    const prefs = prefsOf(user).calendar;
    return suggestTimes(user, input.users, {
      from: input.from,
      to: Math.min(input.to, input.from + 31 * DAY),
      duration: input.duration,
      dayStart: input.dayStart ?? prefs.workStart,
      dayEnd: input.dayEnd ?? prefs.workEnd,
      workdays: input.workdays ?? true,
    });
  });

  app.get<{ Querystring: z.infer<typeof range> }>('/api/calendar/stats', async (request) => {
    const user = me(request);
    const query = parse(range, request.query);
    if (query.to - query.from > 400 * DAY || query.to <= query.from) throw badRequest('Der Zeitraum ist ungültig');
    return statistics(user, query.from, query.to, ids(query.calendars));
  });

  app.get<{ Params: { id: string } }>('/api/calendar/people/:id', async (request) => {
    me(request);
    const user = getUser(personId(request.params.id));
    if (!user || !calendarAllowed(user)) throw notFound();
    return { id: user.id, name: user.name, username: user.username };
  });
}
