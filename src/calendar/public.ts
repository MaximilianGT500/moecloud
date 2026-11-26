import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, badRequest, notFound } from '../lib/errors.ts';
import { renderApp, renderDocument } from '../lib/html.ts';
import { contentDisposition } from '../lib/http.ts';
import { t } from '../lib/i18n.ts';
import { body, checkFormCsrf } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { escapeText, serialize, type Component, type Property } from './ical.ts';
import { formatWhen } from './when.ts';
import { DAY, isKey, isZone, todayKey } from '../../shared/time.ts';
import { holidayId, holidaysBetween, isRegion, REGIONS } from '../../shared/holidays.ts';
import { rsvpPage } from '../views/pages.ts';
import { book, bookingByToken, cancelBooking, presentBooking, presentPage, publicPage, slots } from './booking.ts';
import { calendarByToken } from './calendars.ts';
import { publicDetail, publicOccurrences } from './events.ts';
import { findByToken, rsvpByToken } from './invitations.ts';
import { editVote, pollByToken, presentPoll, vote, voteByToken, type Answer } from './polls.ts';
import * as settings from '../services/settings.ts';
import { exportIcs } from './transfer.ts';
import { getUser, zoneOf } from '../services/users.ts';
import { guardCalendar } from './guard.ts';

const feed = (reply: FastifyReply, name: string, ics: string) =>
  reply
    .type('text/calendar; charset=utf-8')
    .header('Content-Disposition', contentDisposition(`${name}.ics`, 'inline'))
    .header('Cache-Control', 'public, max-age=300')
    .header('Access-Control-Allow-Origin', '*')
    .send(ics);

function holidayFeed(region: string, lang: 'de' | 'en') {
  const year = new Date().getUTCFullYear();
  const list = holidaysBetween(`${year - 1}-01-01`, `${year + 4}-01-01`, [region], false);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const name = REGIONS.find((entry) => entry.id === region)?.name[lang] ?? region;
  const calendar: Component = {
    name: 'VCALENDAR',
    props: [
      { name: 'VERSION', params: {}, value: '2.0' },
      { name: 'PRODID', params: {}, value: '-//MoeStudio//MoeCloud Feiertage//DE' },
      { name: 'CALSCALE', params: {}, value: 'GREGORIAN' },
      { name: 'METHOD', params: {}, value: 'PUBLISH' },
      { name: 'X-WR-CALNAME', params: {}, value: escapeText(`${lang === 'en' ? 'Holidays' : 'Feiertage'} ${name}`) },
      { name: 'REFRESH-INTERVAL', params: { VALUE: ['DURATION'] }, value: 'P7D' },
      { name: 'X-PUBLISHED-TTL', params: {}, value: 'P7D' },
    ],
    children: list.map((holiday): Component => {
      const next = new Date(Date.parse(`${holiday.date}T00:00:00Z`) + DAY).toISOString().slice(0, 10).replace(/-/g, '');
      return {
        name: 'VEVENT',
        props: [
          { name: 'UID', params: {}, value: `${holidayId(holiday)}@moecloud` },
          { name: 'DTSTAMP', params: {}, value: stamp },
          { name: 'DTSTART', params: { VALUE: ['DATE'] }, value: holiday.date.replace(/-/g, '') },
          { name: 'DTEND', params: { VALUE: ['DATE'] }, value: next },
          { name: 'SUMMARY', params: {}, value: escapeText(holiday.name[lang]) },
          { name: 'TRANSP', params: {}, value: 'TRANSPARENT' },
          { name: 'CATEGORIES', params: {}, value: lang === 'en' ? 'Holiday' : 'Feiertag' },
        ] as Property[],
        children: [],
      };
    }),
  };
  return serialize(calendar);
}

function rsvpView(request: FastifyRequest, token: string, notice?: string | null, error?: string | null, preset?: string | null) {
  const found = findByToken(token);
  if (!found) throw notFound('Diese Einladung ist abgelaufen oder wurde zurückgezogen');
  const organizerName = found.data.organizer?.name ?? found.data.organizer?.email ?? '';
  return rsvpPage(request, {
    csrf: request.csrf,
    token,
    title: found.data.title || t(request.lang, 'Termin'),
    when: formatWhen(request.lang, found.data.start ?? 0, found.data.end, found.data.allDay, found.data.zone),
    location: found.data.location,
    conference: found.data.conference,
    organizer: organizerName,
    name: found.attendee.name ?? found.attendee.email,
    status: found.attendee.status,
    preset: preset ?? null,
    notice,
    error,
  });
}

const STATUS: Record<string, 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'> = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
};

export async function calendarPublicRoutes(app: FastifyInstance) {
  guardCalendar(app, true);
  app.get<{ Params: { token: string } }>('/p/:token', async (request, reply) => {
    const raw = request.params.token;
    if (raw.endsWith('.ics')) {
      const calendar = calendarByToken(raw.slice(0, -4));
      if (!calendar || !settings.get('calendar.publicLinks')) throw notFound();
      return feed(reply, calendar.name, exportIcs(calendar, { busyOnly: calendar.public_mode === 'busy', from: Date.now() - 365 * DAY }));
    }
    const calendar = calendarByToken(raw);
    if (!calendar || !settings.get('calendar.publicLinks'))
      throw notFound('Diesen Kalender gibt es nicht oder er ist nicht mehr öffentlich');
    const owner = getUser(calendar.owner_id);
    request.embeddable = true;
    return renderApp(request, reply, {
      entry: 'public',
      title: calendar.name,
      data: {
        calendar: {
          token: raw,
          name: calendar.name,
          description: calendar.description ?? '',
          color: calendar.color,
          mode: calendar.public_mode ?? 'details',
          zone: calendar.zone ?? (owner ? zoneOf(owner) : settings.get('calendar.zone')),
          owner: owner?.name ?? '',
        },
      },
    });
  });

  app.get<{ Params: { token: string }; Querystring: { from?: string; to?: string } }>(
    '/api/calendar/public/calendars/:token/occurrences',
    async (request) => {
      const calendar = calendarByToken(request.params.token);
      if (!calendar || !settings.get('calendar.publicLinks')) throw notFound();
      const from = Math.floor(Number(request.query.from));
      const to = Math.floor(Number(request.query.to));
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        to <= from ||
        to - from > 100 * DAY ||
        Math.abs(from) > 8.64e15 ||
        Math.abs(to) > 8.64e15
      )
        throw badRequest('Der Zeitraum ist ungültig');
      return { items: publicOccurrences(calendar, from, to, calendar.public_mode === 'busy') };
    }
  );

  app.get<{ Params: { token: string; id: string } }>('/api/calendar/public/calendars/:token/events/:id', async (request) => {
    const calendar = calendarByToken(request.params.token);
    if (!calendar || !settings.get('calendar.publicLinks')) throw notFound();
    const found = publicDetail(calendar, request.params.id, calendar.public_mode === 'busy');
    if (!found) throw notFound();
    return found;
  });

  app.get<{ Params: { region: string }; Querystring: { lang?: string } }>('/holidays/:region', async (request, reply) => {
    const region = request.params.region.replace(/\.ics$/, '');
    if (!isRegion(region)) throw notFound();
    const lang = request.query.lang === 'en' ? 'en' : request.query.lang === 'de' ? 'de' : request.lang;
    return feed(reply, `holidays-${region}`, holidayFeed(region, lang));
  });

  app.get<{ Params: { token: string }; Querystring: { status?: string } }>('/rsvp/:token', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const preset = request.query.status && STATUS[request.query.status] ? request.query.status : null;
    return renderDocument(request, reply, {
      title: t(request.lang, 'Einladung'),
      body: rsvpView(request, request.params.token, null, null, preset),
    });
  });

  app.post<{ Params: { token: string } }>(
    '/rsvp/:token',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      reply.header('Referrer-Policy', 'no-referrer');
      const form = body<{ _csrf?: string; status?: string; comment?: string }>(request);
      try {
        checkFormCsrf(request, form._csrf);
        const status = STATUS[String(form.status ?? '')];
        if (!status) throw badRequest('Wähl eine Antwort aus');
        rsvpByToken(request.params.token, { status, comment: form.comment });
        const notice =
          status === 'ACCEPTED'
            ? t(request.lang, 'Danke! Du hast zugesagt.')
            : status === 'DECLINED'
              ? t(request.lang, 'Danke! Du hast abgesagt.')
              : t(request.lang, 'Danke! Du hast mit Vielleicht geantwortet.');
        return renderDocument(request, reply, {
          title: t(request.lang, 'Einladung'),
          body: rsvpView(request, request.params.token, notice),
        });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (error.status === 404) throw error;
        return renderDocument(request, reply, {
          title: t(request.lang, 'Einladung'),
          status: error.status,
          body: rsvpView(request, request.params.token, null, t(request.lang, error.message, error.params)),
        });
      }
    }
  );

  app.get<{ Params: { slug: string } }>('/b/:slug', async (request, reply) => {
    const page = publicPage(request.params.slug);
    if (!page) throw notFound('Diese Buchungsseite gibt es nicht');
    return renderApp(request, reply, {
      entry: 'book',
      title: page.title,
      data: { booking: { mode: 'book', page: presentPage(page, false) } },
    });
  });

  app.get<{ Params: { token: string } }>('/b/manage/:token', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const found = bookingByToken(request.params.token);
    if (!found) throw notFound('Diese Buchung gibt es nicht');
    return renderApp(request, reply, {
      entry: 'book',
      title: found.page.title,
      data: {
        booking: { mode: 'manage', token: request.params.token, booking: presentBooking(found), page: presentPage(found.page, false) },
      },
    });
  });

  app.get<{ Params: { slug: string }; Querystring: { from?: string; days?: string; duration?: string } }>(
    '/api/calendar/public/book/:slug/slots',
    async (request) => {
      const page = publicPage(request.params.slug);
      if (!page) throw notFound('Diese Buchungsseite gibt es nicht');
      const from = request.query.from && isKey(request.query.from) ? request.query.from : todayKey(page.zone);
      const days = Math.max(1, Math.min(42, Math.floor(Number(request.query.days)) || 35));
      const duration = Math.floor(Number(request.query.duration)) || JSON.parse(page.durations)[0];
      return { zone: page.zone, days: slots(page, from, days, duration) };
    }
  );

  app.post<{ Params: { slug: string } }>(
    '/api/calendar/public/book/:slug',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      const page = publicPage(request.params.slug);
      if (!page) throw notFound('Diese Buchungsseite gibt es nicht');
      const input = parse(
        z.object({
          start: z.number().int().min(-8.64e15).max(8.64e15),
          duration: z.number().int().min(5).max(720),
          name: z.string().trim().min(1, 'Gib deinen Namen ein').max(120),
          email: z.string().trim().max(254),
          notes: z.string().max(2000).optional(),
          answers: z.record(z.string(), z.string().max(2000)).optional(),
          zone: z.string().max(64).optional(),
        }),
        request.body
      );
      if (input.zone && !isZone(input.zone)) input.zone = undefined;
      return book(page, input, request.lang);
    }
  );

  app.post<{ Params: { token: string } }>(
    '/api/calendar/public/booking/:token/cancel',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      const input = parse(z.object({ reason: z.string().max(500).optional() }), request.body);
      return { booking: cancelBooking(request.params.token, request.lang, input.reason) };
    }
  );

  app.get<{ Params: { token: string } }>('/u/:token', async (request, reply) => {
    const poll = pollByToken(request.params.token);
    if (!poll || !settings.get('calendar.polls')) throw notFound('Diese Umfrage gibt es nicht');
    return renderApp(request, reply, {
      entry: 'poll',
      title: poll.title,
      data: { poll: presentPoll(poll, request.auth?.user.id === poll.owner_id) },
    });
  });

  app.get<{ Params: { token: string } }>('/api/calendar/public/polls/:token', async (request) => {
    const poll = pollByToken(request.params.token);
    if (!poll) throw notFound('Diese Umfrage gibt es nicht');
    return { poll: presentPoll(poll, request.auth?.user.id === poll.owner_id) };
  });

  const voteSchema = z.object({
    name: z.string().trim().min(1, 'Gib deinen Namen ein').max(80),
    email: z.string().trim().max(254).nullable().optional(),
    answers: z.record(z.string(), z.enum(['yes', 'maybe', 'no'])),
    comment: z.string().max(1000).nullable().optional(),
  });

  app.post<{ Params: { token: string } }>(
    '/api/calendar/public/polls/:token/votes',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => {
      const input = parse(voteSchema, request.body);
      return vote(request.params.token, { ...input, answers: input.answers as Record<string, Answer> }, request.auth?.user ?? null);
    }
  );

  app.get<{ Params: { token: string; edit: string } }>('/api/calendar/public/polls/:token/votes/:edit', async (request) => {
    const found = voteByToken(request.params.token, request.params.edit);
    if (!found) throw notFound('Diese Stimme gibt es nicht mehr');
    return { vote: found };
  });

  app.put<{ Params: { token: string; edit: string } }>(
    '/api/calendar/public/polls/:token/votes/:edit',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request) => {
      const input = parse(voteSchema, request.body);
      return editVote(request.params.token, request.params.edit, { ...input, answers: input.answers as Record<string, Answer> });
    }
  );
}
