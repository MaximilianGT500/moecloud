import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { blankItem, writeObject } from './model.ts';
import { formatWhen } from './when.ts';
import { getProp, parseICS, serialize, setProp } from './ical.ts';
import { DAY, addDays, atMinute, isZone, localKey, todayKey, weekdayOf } from '../../shared/time.ts';
import { getCalendar, ownCalendars, requireCalendar, type CalendarRow } from './calendars.ts';
import { busyIntervals, dataOf, getEvent, storeItem, trashItem } from './events.ts';
import { absoluteUrl } from './links.ts';
import { deliver, mailReady } from '../services/mail.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { getUser, preferredLanguage, prefsOf, pseudoMail, zoneOf, type UserRow } from '../services/users.ts';

export type Interval = [number, number];

export interface Availability {
  weekly: Record<string, Interval[]>;
  dates: Record<string, Interval[]>;
}

export interface Question {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'phone' | 'select' | 'checkbox';
  required: boolean;
  options: string[];
}

export interface PageRow {
  id: string;
  owner_id: number;
  slug: string;
  title: string;
  description: string | null;
  calendar_id: string | null;
  durations: string;
  availability: string;
  zone: string;
  buffer_before: number;
  buffer_after: number;
  notice_minutes: number;
  window_days: number;
  max_per_day: number;
  step_minutes: number;
  conflicts: string | null;
  location_kind: 'none' | 'place' | 'phone' | 'video' | 'link';
  location: string | null;
  questions: string | null;
  color: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface BookingRow {
  id: string;
  page_id: string;
  event_id: string | null;
  name: string;
  email: string;
  notes: string | null;
  answers: string | null;
  start_at: number;
  end_at: number;
  zone: string | null;
  token_hash: string;
  status: 'confirmed' | 'cancelled';
  created_at: number;
  cancelled_at: number | null;
}

const parse = <T>(text: string | null, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

export const defaultAvailability = (): Availability => ({
  weekly: { '1': [[540, 1020]], '2': [[540, 1020]], '3': [[540, 1020]], '4': [[540, 1020]], '5': [[540, 1020]] },
  dates: {},
});

export function presentPage(row: PageRow, withPrivate = true) {
  const owner = getUser(row.owner_id);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? '',
    calendarId: withPrivate ? row.calendar_id : null,
    durations: parse<number[]>(row.durations, [30]),
    availability: withPrivate ? parse<Availability>(row.availability, defaultAvailability()) : null,
    zone: row.zone,
    bufferBefore: row.buffer_before,
    bufferAfter: row.buffer_after,
    notice: row.notice_minutes,
    window: row.window_days,
    maxPerDay: row.max_per_day,
    step: row.step_minutes,
    conflicts: withPrivate ? parse<string[]>(row.conflicts, []) : [],
    locationKind: row.location_kind,
    location: row.location_kind === 'video' && !withPrivate ? '' : (row.location ?? ''),
    questions: parse<Question[]>(row.questions, []),
    color: row.color,
    enabled: Boolean(row.enabled),
    owner: { name: owner?.name ?? '', initials: (owner?.name ?? '?').slice(0, 1).toUpperCase() },
    bookings: withPrivate
      ? (value<number>("SELECT COUNT(*) FROM bookings WHERE page_id = ? AND status = 'confirmed' AND start_at > ?", row.id, Date.now()) ??
        0)
      : undefined,
    createdAt: row.created_at,
  };
}

export const listPages = (user: UserRow) =>
  all<PageRow>('SELECT * FROM booking_pages WHERE owner_id = ? ORDER BY created_at', user.id).map((row) => presentPage(row));

const getPage = (id: string) => one<PageRow>('SELECT * FROM booking_pages WHERE id = ?', id);

function requirePage(user: UserRow, id: string) {
  const page = getPage(id);
  if (!page || page.owner_id !== user.id) throw notFound('Diese Buchungsseite gibt es nicht');
  return page;
}

export interface PageInput {
  slug?: string;
  title?: string;
  description?: string;
  calendarId?: string | null;
  durations?: number[];
  availability?: Availability;
  zone?: string;
  bufferBefore?: number;
  bufferAfter?: number;
  notice?: number;
  window?: number;
  maxPerDay?: number;
  step?: number;
  conflicts?: string[];
  locationKind?: PageRow['location_kind'];
  location?: string;
  questions?: Question[];
  color?: string | null;
  enabled?: boolean;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

export function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/ß/g, 'ss')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'termin'
  );
}

function cleanAvailability(input: Availability): Availability {
  const clean = (list: Interval[]) =>
    list
      .filter((entry) => Array.isArray(entry) && entry.length === 2 && entry[0] >= 0 && entry[1] <= 1440 && entry[0] < entry[1])
      .map((entry) => [Math.round(entry[0]), Math.round(entry[1])] as Interval)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 12);
  const weekly: Record<string, Interval[]> = {};
  for (const [day, list] of Object.entries(input.weekly ?? {})) if (/^[0-6]$/.test(day)) weekly[day] = clean(list);
  const dates: Record<string, Interval[]> = {};
  for (const [date, list] of Object.entries(input.dates ?? {}).slice(0, 400))
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates[date] = clean(list);
  return { weekly, dates };
}

function validate(user: UserRow, input: PageInput, current: PageRow | null) {
  if (input.slug !== undefined) {
    if (!SLUG.test(input.slug)) throw badRequest('Die Adresse darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten');
    const taken = one<{ id: string }>('SELECT id FROM booking_pages WHERE slug = ?', input.slug);
    if (taken && taken.id !== current?.id) throw conflict('Diese Adresse ist schon vergeben');
  }
  if (input.calendarId) requireCalendar(user, input.calendarId, 'write');
  if (input.conflicts) for (const id of input.conflicts) requireCalendar(user, id, 'read');
  if (input.zone !== undefined && !isZone(input.zone)) throw badRequest('Diese Zeitzone kennt MoeCloud nicht');
  if (input.durations && (!input.durations.length || input.durations.some((value) => value < 5 || value > 720))) {
    throw badRequest('Die Dauer muss zwischen 5 Minuten und 12 Stunden liegen');
  }
}

export function createPage(user: UserRow, input: PageInput) {
  if (!settings.get('calendar.booking')) throw forbidden('Buchungsseiten sind auf diesem Server ausgeschaltet');
  let slug = input.slug ?? slugify(`${user.username}-${input.title ?? 'termin'}`);
  for (let index = 2; one('SELECT 1 FROM booking_pages WHERE slug = ?', slug); index++)
    slug = `${slugify(`${user.username}-${input.title ?? 'termin'}`)}-${index}`;
  validate(user, { ...input, slug }, null);
  const id = randomId(16);
  const now = Date.now();
  const calendarId =
    input.calendarId ??
    prefsOf(user).calendar.defaultCalendar ??
    ownCalendars(user.id).find((calendar) => calendar.kind === 'local')?.id ??
    null;
  run(
    `INSERT INTO booking_pages (id, owner_id, slug, title, description, calendar_id, durations, availability, zone, buffer_before, buffer_after, notice_minutes,
       window_days, max_per_day, step_minutes, conflicts, location_kind, location, questions, color, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    slug,
    input.title?.trim().slice(0, 120) || 'Termin',
    input.description?.slice(0, 4000) ?? null,
    calendarId,
    JSON.stringify(input.durations ?? [30]),
    JSON.stringify(cleanAvailability(input.availability ?? defaultAvailability())),
    input.zone ?? zoneOf(user),
    Math.max(0, Math.min(240, input.bufferBefore ?? 0)),
    Math.max(0, Math.min(240, input.bufferAfter ?? 0)),
    Math.max(0, Math.min(60 * 24 * 30, input.notice ?? 240)),
    Math.max(1, Math.min(365, input.window ?? 60)),
    Math.max(0, Math.min(50, input.maxPerDay ?? 0)),
    [5, 10, 15, 20, 30, 60].includes(input.step ?? 30) ? (input.step ?? 30) : 30,
    JSON.stringify(input.conflicts ?? (calendarId ? [calendarId] : [])),
    input.locationKind ?? 'none',
    input.location?.slice(0, 500) ?? null,
    JSON.stringify(input.questions ?? []),
    input.color ?? null,
    input.enabled === false ? 0 : 1,
    now,
    now
  );
  return presentPage(getPage(id)!);
}

export function updatePage(user: UserRow, id: string, input: PageInput) {
  const page = requirePage(user, id);
  validate(user, input, page);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (input.slug !== undefined) set('slug', input.slug);
  if (input.title !== undefined) set('title', input.title.trim().slice(0, 120) || page.title);
  if (input.description !== undefined) set('description', input.description.slice(0, 4000));
  if (input.calendarId !== undefined) set('calendar_id', input.calendarId);
  if (input.durations !== undefined) set('durations', JSON.stringify(input.durations.slice(0, 6)));
  if (input.availability !== undefined) set('availability', JSON.stringify(cleanAvailability(input.availability)));
  if (input.zone !== undefined) set('zone', input.zone);
  if (input.bufferBefore !== undefined) set('buffer_before', Math.max(0, Math.min(240, input.bufferBefore)));
  if (input.bufferAfter !== undefined) set('buffer_after', Math.max(0, Math.min(240, input.bufferAfter)));
  if (input.notice !== undefined) set('notice_minutes', Math.max(0, Math.min(60 * 24 * 30, input.notice)));
  if (input.window !== undefined) set('window_days', Math.max(1, Math.min(365, input.window)));
  if (input.maxPerDay !== undefined) set('max_per_day', Math.max(0, Math.min(50, input.maxPerDay)));
  if (input.step !== undefined) set('step_minutes', [5, 10, 15, 20, 30, 60].includes(input.step) ? input.step : 30);
  if (input.conflicts !== undefined) set('conflicts', JSON.stringify(input.conflicts));
  if (input.locationKind !== undefined) set('location_kind', input.locationKind);
  if (input.location !== undefined) set('location', input.location.slice(0, 500));
  if (input.questions !== undefined) set('questions', JSON.stringify(input.questions.slice(0, 10)));
  if (input.color !== undefined) set('color', input.color);
  if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0);
  set('updated_at', Date.now());
  run(`UPDATE booking_pages SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return presentPage(getPage(id)!);
}

export function deletePage(user: UserRow, id: string) {
  requirePage(user, id);
  run('DELETE FROM booking_pages WHERE id = ?', id);
}

export function pageBookings(user: UserRow, id: string) {
  requirePage(user, id);
  return all<BookingRow>('SELECT * FROM bookings WHERE page_id = ? ORDER BY start_at DESC LIMIT 300', id).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    email: row.email,
    notes: row.notes ?? '',
    answers: parse<Record<string, string>>(row.answers, {}),
    start: row.start_at,
    end: row.end_at,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function publicPage(slug: string) {
  if (!settings.get('calendar.booking')) return null;
  const page = one<PageRow>('SELECT * FROM booking_pages WHERE slug = ? AND enabled = 1', slug);
  if (!page) return null;
  const owner = getUser(page.owner_id);
  if (!owner || owner.disabled) return null;
  return page;
}

function busyFor(page: PageRow, from: number, to: number) {
  const conflicts = parse<string[]>(page.conflicts, []).filter((id) => {
    const calendar = getCalendar(id);
    return calendar && !calendar.trashed_at;
  });
  const busy = busyIntervals(page.owner_id, from, to, conflicts.length ? conflicts : undefined).map((entry) => ({
    start: entry.allDay ? entry.start : entry.start - page.buffer_before * 60_000,
    end: entry.allDay ? entry.end : entry.end + page.buffer_after * 60_000,
    allDay: entry.allDay,
  }));
  for (const row of all<BookingRow>(
    "SELECT * FROM bookings WHERE page_id = ? AND status = 'confirmed' AND start_at < ? AND end_at > ?",
    page.id,
    to,
    from
  )) {
    busy.push({ start: row.start_at - page.buffer_before * 60_000, end: row.end_at + page.buffer_after * 60_000, allDay: false });
  }
  return busy;
}

export function slots(page: PageRow, fromKey: string, days: number, duration: number, now = Date.now()) {
  const durations = parse<number[]>(page.durations, [30]);
  if (!durations.includes(duration)) throw badRequest('Diese Dauer gibt es hier nicht');
  const availability = parse<Availability>(page.availability, defaultAvailability());
  const zone = page.zone;
  const earliest = now + page.notice_minutes * 60_000;
  const today = todayKey(zone, now);
  const last = addDays(today, page.window_days);
  const span = Math.max(1, Math.min(62, days));
  const start = fromKey < today ? today : fromKey;
  const rangeFrom = atMinute(start, 0, zone);
  const rangeTo = atMinute(addDays(start, span), 0, zone);
  const busy = busyFor(page, rangeFrom - DAY, rangeTo + DAY);
  const perDay = new Map<string, number>();
  if (page.max_per_day) {
    for (const row of all<BookingRow>(
      "SELECT * FROM bookings WHERE page_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?",
      page.id,
      rangeFrom - DAY,
      rangeTo + DAY
    )) {
      const key = localKey(row.start_at, zone);
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
  }
  const out: { date: string; slots: number[] }[] = [];
  for (let offset = 0; offset < span; offset++) {
    const date = addDays(start, offset);
    if (date > last) break;
    const intervals = availability.dates[date] ?? availability.weekly[String(weekdayOf(date))] ?? [];
    const list: number[] = [];
    if (!page.max_per_day || (perDay.get(date) ?? 0) < page.max_per_day) {
      for (const [from, to] of intervals) {
        for (let minute = from; minute + duration <= to; minute += page.step_minutes) {
          const begin = atMinute(date, minute, zone);
          const end = begin + duration * 60_000;
          if (begin < earliest) continue;
          const clash = busy.some((entry) => entry.start < end && entry.end > begin);
          if (!clash) list.push(begin);
        }
      }
    }
    out.push({ date, slots: [...new Set(list)].sort((a, b) => a - b) });
  }
  return out;
}

export interface BookingInput {
  start: number;
  duration: number;
  name: string;
  email: string;
  notes?: string;
  answers?: Record<string, string>;
  zone?: string;
}

function bookingIcs(eventIcs: string) {
  const roots = parseICS(eventIcs);
  const calendar = roots.find((root) => root.name === 'VCALENDAR');
  if (!calendar) return eventIcs;
  setProp(calendar, 'METHOD', 'REQUEST');
  for (const child of calendar.children)
    if (child.name === 'VEVENT') child.children = child.children.filter((entry) => entry.name !== 'VALARM');
  return serialize(calendar);
}

async function mailBooker(
  lang: Lang,
  page: PageRow,
  owner: UserRow,
  booking: { name: string; email: string; start: number; end: number; zone: string },
  token: string,
  ics: string | null,
  cancelled = false
) {
  if (!mailReady()) return;
  const when = formatWhen(lang, booking.start, booking.end, false, booking.zone);
  try {
    await deliver(
      booking.email,
      {
        lang,
        title: cancelled ? t(lang, 'Storniert: {title}', { title: page.title }) : t(lang, 'Bestätigt: {title}', { title: page.title }),
        details: [
          { label: t(lang, 'Wann'), value: when },
          { label: t(lang, 'Mit'), value: owner.name },
          ...(page.location && !cancelled ? [{ label: t(lang, 'Wo'), value: page.location }] : []),
        ],
        lines: cancelled
          ? [t(lang, 'Dein Termin ist storniert. Du kannst jederzeit einen neuen buchen.')]
          : [
              t(lang, 'Hallo {name}, dein Termin ist gebucht. Die angehängte Datei kannst du in deinen Kalender übernehmen.', {
                name: booking.name,
              }),
            ],
        action: cancelled
          ? { label: t(lang, 'Neuen Termin buchen'), url: absoluteUrl(`/b/${page.slug}`) }
          : { label: t(lang, 'Termin ändern oder stornieren'), url: absoluteUrl(`/b/manage/${token}`) },
      },
      ics ? { ical: { method: cancelled ? 'CANCEL' : 'REQUEST', content: ics }, replyTo: owner.email ?? undefined } : {}
    );
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Buchungsbestätigung konnte nicht verschickt werden');
  }
}

export function book(page: PageRow, input: BookingInput, lang: Lang) {
  const owner = getUser(page.owner_id);
  if (!owner) throw notFound('Diese Buchungsseite gibt es nicht');
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Die E-Mail-Adresse sieht nicht richtig aus');
  const name = input.name.trim().slice(0, 120);
  if (!name) throw badRequest('Gib deinen Namen ein');
  const questions = parse<Question[]>(page.questions, []);
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = String(input.answers?.[question.id] ?? '')
      .trim()
      .slice(0, 2000);
    if (question.required && !answer) throw badRequest('„{label}“ fehlt', { label: question.label });
    if (answer) answers[question.label] = answer;
  }
  const zone = page.zone;
  const date = localKey(input.start, zone);
  const available = slots(page, date, 1, input.duration)[0]?.slots ?? [];
  if (!available.includes(input.start)) throw conflict('Dieser Termin ist leider nicht mehr frei, such dir bitte einen anderen aus');
  let calendar: CalendarRow | undefined = page.calendar_id ? getCalendar(page.calendar_id) : undefined;
  if (!calendar || calendar.trashed_at || calendar.kind !== 'local')
    calendar = ownCalendars(owner.id).find((entry) => entry.kind === 'local');
  if (!calendar) throw notFound('Für diese Buchungsseite gibt es keinen Kalender');
  const end = input.start + input.duration * 60_000;
  const token = randomId(32);
  const bookingId = randomId(16);
  const data = blankItem('VEVENT', zone);
  data.title = `${page.title}: ${name}`;
  data.start = input.start;
  data.end = end;
  data.location = page.location_kind === 'video' ? '' : (page.location ?? '');
  data.conference = page.location_kind === 'video' && page.location ? page.location : null;
  const lines = [t(lang, 'Gebucht über „{title}“ von {name} <{email}>', { title: page.title, name, email })];
  if (input.notes?.trim()) lines.push('', input.notes.trim().slice(0, 2000));
  for (const [label, answer] of Object.entries(answers)) lines.push('', `${label}: ${answer}`);
  data.description = lines.join('\n');
  data.organizer = { email: pseudoMail(owner), name: owner.name };
  data.attendees = [{ email, name, status: 'ACCEPTED', role: 'REQ-PARTICIPANT', rsvp: false }];
  data.alarms = prefsOf(owner).calendar.alarms.map((alarm) => ({
    offset: -alarm.minutes * 60_000,
    related: 'START',
    absolute: null,
    action: alarm.email ? 'EMAIL' : 'DISPLAY',
  }));
  data.categories = [t(lang, 'Buchung')];
  data.color = page.color;
  data.created = Date.now();
  const ics = writeObject(null, null, data);
  const row = tx(() => {
    const stored = storeItem(calendar!, data, ics, { actor: null });
    run(
      `INSERT INTO bookings (id, page_id, event_id, name, email, notes, answers, start_at, end_at, zone, token_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      bookingId,
      page.id,
      stored.id,
      name,
      email,
      input.notes?.trim().slice(0, 2000) || null,
      JSON.stringify(answers),
      input.start,
      end,
      input.zone && isZone(input.zone) ? input.zone : zone,
      sha256(token),
      Date.now()
    );
    run(
      'INSERT INTO attendees (event_id, email, user_id, name, status, role) VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT (event_id, email) DO NOTHING',
      stored.id,
      email,
      name,
      'ACCEPTED',
      'REQ-PARTICIPANT'
    );
    return stored;
  });
  const ownerLang = preferredLanguage(owner);
  notify(
    owner.id,
    'booking_new',
    { name, page: page.title, when: formatWhen(ownerLang, input.start, end, false, zoneOf(owner)) },
    `/calendar?event=${row.id}`
  );
  void mailBooker(
    lang,
    page,
    owner,
    { name, email, start: input.start, end, zone: input.zone && isZone(input.zone) ? input.zone : zone },
    token,
    bookingIcs(row.ics)
  );
  return { id: bookingId, token, start: input.start, end, title: page.title, owner: owner.name };
}

export function bookingByToken(token: string) {
  if (!token || token.length > 64) return null;
  const booking = one<BookingRow>('SELECT * FROM bookings WHERE token_hash = ?', sha256(token));
  if (!booking) return null;
  const page = getPage(booking.page_id);
  if (!page) return null;
  return { booking, page };
}

export function presentBooking(found: { booking: BookingRow; page: PageRow }) {
  const owner = getUser(found.page.owner_id);
  return {
    name: found.booking.name,
    email: found.booking.email,
    start: found.booking.start_at,
    end: found.booking.end_at,
    zone: found.booking.zone ?? found.page.zone,
    status: found.booking.status,
    page: {
      slug: found.page.slug,
      title: found.page.title,
      owner: owner?.name ?? '',
      location: found.page.location_kind === 'video' ? '' : (found.page.location ?? ''),
    },
    past: found.booking.start_at < Date.now(),
  };
}

export function cancelBooking(token: string, lang: Lang, reason?: string) {
  const found = bookingByToken(token);
  if (!found) throw notFound('Diese Buchung gibt es nicht');
  if (found.booking.status === 'cancelled') return presentBooking(found);
  if (found.booking.start_at < Date.now()) throw badRequest('Vergangene Termine lassen sich nicht mehr stornieren');
  const owner = getUser(found.page.owner_id);
  let ics: string | null = null;
  tx(() => {
    run("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?", Date.now(), found.booking.id);
    if (found.booking.event_id) {
      const event = getEvent(found.booking.event_id);
      if (event && !event.trashed_at) {
        const data = dataOf(event);
        ics = event.ics;
        if (reason?.trim())
          data.description = `${data.description}\n\n${t(lang, 'Storniert: {reason}', { reason: reason.trim().slice(0, 500) })}`;
        trashItem(event, null);
      }
    }
  });
  if (owner) {
    const ownerLang = preferredLanguage(owner);
    notify(
      owner.id,
      'booking_cancelled',
      {
        name: found.booking.name,
        page: found.page.title,
        when: formatWhen(ownerLang, found.booking.start_at, found.booking.end_at, false, zoneOf(owner)),
      },
      null
    );
    let cancelIcs: string | null = null;
    if (ics) {
      const roots = parseICS(ics);
      const calendar = roots.find((root) => root.name === 'VCALENDAR');
      if (calendar) {
        setProp(calendar, 'METHOD', 'CANCEL');
        for (const child of calendar.children) {
          if (child.name !== 'VEVENT') continue;
          setProp(child, 'STATUS', 'CANCELLED');
          const sequence = Number(getProp(child, 'SEQUENCE')?.value ?? 0) + 1;
          setProp(child, 'SEQUENCE', String(sequence));
          child.children = [];
        }
        cancelIcs = serialize(calendar);
      }
    }
    void mailBooker(
      lang,
      found.page,
      owner,
      {
        name: found.booking.name,
        email: found.booking.email,
        start: found.booking.start_at,
        end: found.booking.end_at,
        zone: found.booking.zone ?? found.page.zone,
      },
      token,
      cancelIcs,
      true
    );
  }
  return presentBooking(bookingByToken(token)!);
}

export function purgeBookings() {
  return run("DELETE FROM bookings WHERE end_at < ? AND (status = 'cancelled' OR event_id IS NULL)", Date.now() - 365 * DAY).changes;
}
