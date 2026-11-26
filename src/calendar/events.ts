import { createHash, randomUUID } from 'node:crypto';
import { all, one, placeholders, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import {
  blankItem,
  cloneData,
  durationOf,
  instanceAt,
  isRecurringItem,
  normalizeColor,
  occurrences,
  pickInstance,
  rangeEndOf,
  recurrenceStart,
  writeObject,
  type Alarm,
  type AttendeeRole,
  type ItemData,
  type ItemKind,
  type Instance,
  type Override,
  type PartStat,
} from './model.ts';
import { DAY, compactKey, isKey, isZone, keyOfDay, utcKey, wallOf, weekdayOfDay, dayNumber } from '../../shared/time.ts';
import { formatRule, parseRule, untilFromBefore } from '../../shared/rrule.ts';
import {
  accessOf,
  accessibleCalendarIds,
  announce,
  atLeast,
  calendarAlarms,
  getCalendar,
  requireCalendar,
  touchCalendar,
  writable,
  type Access,
  type CalendarRow,
} from './calendars.ts';
import {
  findByEmail,
  getUser,
  inactive,
  initials,
  keyOf,
  preferredLanguage,
  prefsOf,
  pseudoMail,
  zoneOf,
  type UserRow,
} from '../services/users.ts';
import { notify } from '../services/notify.ts';
import { scheduleAlarms } from './alarms.ts';
import { afterChange } from './invitations.ts';

export interface EventRow {
  id: string;
  calendar_id: string;
  uid: string;
  href: string;
  component: 'VEVENT' | 'VTODO';
  title: string;
  location: string | null;
  description: string | null;
  categories: string | null;
  start_at: number | null;
  end_at: number | null;
  all_day: number;
  recurring: number;
  range_end: number | null;
  status: string | null;
  due_at: number | null;
  completed_at: number | null;
  has_alarms: number;
  organizer_id: number | null;
  data: string;
  ics: string;
  etag: string;
  sequence: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

const parsed = new Map<string, ItemData>();

export function dataOf(row: Pick<EventRow, 'id' | 'etag' | 'data'>): ItemData {
  const key = `${row.id}:${row.etag}`;
  let found = parsed.get(key);
  if (!found) {
    found = JSON.parse(row.data) as ItemData;
    if (parsed.size > 5000) parsed.clear();
    parsed.set(key, found);
  }
  return cloneData(found);
}

export const getEvent = (id: string) => one<EventRow>('SELECT * FROM events WHERE id = ?', id);

export const eventByHref = (calendarId: string, href: string) =>
  one<EventRow>('SELECT * FROM events WHERE calendar_id = ? AND href = ? AND trashed_at IS NULL', calendarId, href);

export const eventByUid = (calendarId: string, uid: string) =>
  one<EventRow>('SELECT * FROM events WHERE calendar_id = ? AND uid = ? AND trashed_at IS NULL', calendarId, uid);

export interface EventAccess {
  row: EventRow;
  calendar: CalendarRow;
  access: Access;
  invited: boolean;
}

export function attendeeRowFor(eventId: string, userId: number) {
  return one<{ status: PartStat; email: string; calendar_id: string | null; hidden: number }>(
    'SELECT status, email, calendar_id, hidden FROM attendees WHERE event_id = ? AND user_id = ?',
    eventId,
    userId
  );
}

export function eventAccess(user: Pick<UserRow, 'id'>, id: string): EventAccess | null {
  const row = getEvent(id);
  if (!row) return null;
  const calendar = getCalendar(row.calendar_id);
  if (!calendar) return null;
  const access = accessOf(user, calendar);
  if (access && (!calendar.trashed_at || access === 'owner')) return { row, calendar, access, invited: false };
  if (attendeeRowFor(id, user.id) && !row.trashed_at) return { row, calendar, access: 'read', invited: true };
  return null;
}

export function requireEvent(user: Pick<UserRow, 'id'>, id: string, need: Access = 'read'): EventAccess {
  const found = eventAccess(user, id);
  if (!found) throw notFound('Diesen Termin gibt es nicht');
  if (!atLeast(found.access, need)) throw forbidden('Dafür fehlen dir die Rechte');
  if (need === 'write' && (found.calendar.kind !== 'local' || found.calendar.trashed_at)) {
    throw forbidden('Diesen Kalender kannst du nicht bearbeiten');
  }
  return found;
}

const hrefFor = (uid: string) => `${uid.replace(/[^A-Za-z0-9._@-]/g, '_').slice(0, 200)}.ics`;

const etagOf = (ics: string) => createHash('sha256').update(ics).digest('base64url').slice(0, 27);

function indexOf(data: ItemData) {
  const todo = data.component === 'VTODO';
  const anchor = todo ? (data.due ?? data.start) : data.start;
  const categories = data.categories.length ? `|${data.categories.map((value) => value.toLowerCase()).join('|')}|` : null;
  return {
    title: data.title.slice(0, 500),
    location: data.location || null,
    description: data.description ? data.description.slice(0, 5000) : null,
    categories,
    start_at: anchor,
    end_at: todo ? anchor : data.end,
    all_day: data.allDay ? 1 : 0,
    recurring: isRecurringItem(data) ? 1 : 0,
    range_end: anchor === null ? null : rangeEndOf(data),
    status: data.status,
    due_at: todo ? data.due : null,
    completed_at: todo ? (data.completed ?? (data.status === 'COMPLETED' ? (data.modified ?? Date.now()) : null)) : null,
    has_alarms: data.alarms.length || data.overrides.some((entry) => entry.alarms.length) ? 1 : 0,
  };
}

export interface StoreOptions {
  actor: number | null;
  href?: string;
  previous?: EventRow | null;
  quiet?: boolean;
  skipInvites?: boolean;
}

export function storeItem(calendar: CalendarRow, data: ItemData, ics: string, options: StoreOptions): EventRow {
  const now = Date.now();
  const previous = options.previous ?? null;
  const index = indexOf(data);
  const owner = getUser(calendar.owner_id);
  const organizerId =
    data.organizer && owner?.email && keyOf(owner.email) === data.organizer.email
      ? owner.id
      : data.organizer
        ? (findByEmail(data.organizer.email)?.id ?? null)
        : null;
  const etag = etagOf(ics);
  let id: string;
  if (previous) {
    id = previous.id;
    run(
      `UPDATE events SET calendar_id = ?, uid = ?, href = ?, component = ?, title = ?, location = ?, description = ?, categories = ?, start_at = ?, end_at = ?,
         all_day = ?, recurring = ?, range_end = ?, status = ?, due_at = ?, completed_at = ?, has_alarms = ?, organizer_id = ?, data = ?, ics = ?, etag = ?,
         sequence = ?, updated_by = ?, updated_at = ?, trashed_at = NULL WHERE id = ?`,
      calendar.id,
      data.uid,
      options.href ?? previous.href,
      data.component,
      index.title,
      index.location,
      index.description,
      index.categories,
      index.start_at,
      index.end_at,
      index.all_day,
      index.recurring,
      index.range_end,
      index.status,
      index.due_at,
      index.completed_at,
      index.has_alarms,
      organizerId,
      JSON.stringify(data),
      ics,
      etag,
      data.sequence,
      options.actor,
      now,
      id
    );
  } else {
    id = randomId(20);
    run(
      `INSERT INTO events (id, calendar_id, uid, href, component, title, location, description, categories, start_at, end_at, all_day, recurring, range_end,
         status, due_at, completed_at, has_alarms, organizer_id, data, ics, etag, sequence, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      calendar.id,
      data.uid,
      options.href ?? hrefFor(data.uid),
      data.component,
      index.title,
      index.location,
      index.description,
      index.categories,
      index.start_at,
      index.end_at,
      index.all_day,
      index.recurring,
      index.range_end,
      index.status,
      index.due_at,
      index.completed_at,
      index.has_alarms,
      organizerId,
      JSON.stringify(data),
      ics,
      etag,
      data.sequence,
      options.actor,
      options.actor,
      now,
      now
    );
  }
  const row = getEvent(id)!;
  if (previous && previous.calendar_id !== calendar.id) {
    touchCalendar(previous.calendar_id, previous.href, true);
    announce([previous.calendar_id]);
  }
  touchCalendar(calendar.id, row.href);
  scheduleAlarms(row, data);
  if (!options.quiet) announce([calendar.id]);
  return row;
}

export function trashItem(row: EventRow, actor: number | null) {
  run('UPDATE events SET trashed_at = ?, updated_by = ? WHERE id = ?', Date.now(), actor, row.id);
  run('DELETE FROM alarms WHERE event_id = ?', row.id);
  touchCalendar(row.calendar_id, row.href, true);
  announce([row.calendar_id], attendeeUsers(row.id));
}

export function deleteItemForever(row: EventRow) {
  run('DELETE FROM events WHERE id = ?', row.id);
  if (!row.trashed_at) touchCalendar(row.calendar_id, row.href, true);
  announce([row.calendar_id]);
}

export const attendeeUsers = (eventId: string) =>
  all<{ user_id: number }>('SELECT user_id FROM attendees WHERE event_id = ? AND user_id IS NOT NULL', eventId).map((row) => row.user_id);

export interface AlarmInput {
  offset: number;
  related?: 'START' | 'END';
  absolute?: number | null;
  action?: 'DISPLAY' | 'EMAIL';
}

export interface AttendeeInput {
  email: string;
  name?: string | null;
  role?: AttendeeRole;
}

export interface EventInput {
  calendarId?: string;
  component?: 'VEVENT' | 'VTODO';
  title?: string;
  description?: string;
  location?: string;
  url?: string;
  conference?: string | null;
  allDay?: boolean;
  start?: number | string | null;
  end?: number | string | null;
  due?: number | string | null;
  zone?: string;
  rrule?: string | null;
  status?: string | null;
  transparency?: 'OPAQUE' | 'TRANSPARENT';
  privacy?: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
  color?: string | null;
  categories?: string[];
  alarms?: AlarmInput[];
  attendees?: AttendeeInput[];
  kind?: ItemKind;
  birthYear?: number | null;
  assignee?: number | null;
  priority?: number;
  percent?: number;
  completed?: boolean;
  parent?: string | null;
  exdates?: string[];
}

function timeOf(value: number | string | null | undefined, allDay: boolean): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) throw badRequest('Die Zeitangabe ist ungültig');
    return allDay ? Math.floor(value / DAY) * DAY : Math.round(value / 1000) * 1000;
  }
  if (isKey(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }
  const parsedValue = Date.parse(value);
  if (!Number.isFinite(parsedValue)) throw badRequest('Die Zeitangabe ist ungültig');
  return allDay ? Math.floor(parsedValue / DAY) * DAY : parsedValue;
}

const STATUSES_EVENT = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'];
const STATUSES_TODO = ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'];

function applyInstance(target: Instance, input: EventInput, todo: boolean, defaults: { duration: number }) {
  if (input.title !== undefined) target.title = input.title.trim().slice(0, 500);
  if (input.description !== undefined) target.description = input.description.slice(0, 20_000);
  if (input.location !== undefined) target.location = input.location.trim().slice(0, 500);
  if (input.url !== undefined) target.url = input.url.trim().slice(0, 2000);
  if (input.conference !== undefined) {
    const link = input.conference?.trim() || null;
    if (link && !/^https?:\/\//i.test(link)) throw badRequest('Der Link zur Videokonferenz muss mit http:// oder https:// beginnen');
    target.conference = link;
  }
  if (input.zone !== undefined) {
    if (!isZone(input.zone)) throw badRequest('Diese Zeitzone kennt MoeCloud nicht');
    target.zone = input.zone;
    target.floating = false;
  }
  const allDayChanged = input.allDay !== undefined && input.allDay !== target.allDay;
  if (input.allDay !== undefined) target.allDay = input.allDay;
  if (input.start !== undefined) target.start = timeOf(input.start, target.allDay);
  else if (allDayChanged && target.start !== null) target.start = target.allDay ? Math.floor(target.start / DAY) * DAY : target.start;
  if (!todo) {
    if (input.end !== undefined) target.end = timeOf(input.end, target.allDay);
    else if (allDayChanged && target.start !== null) target.end = target.allDay ? target.start + DAY : target.start + defaults.duration;
    if (target.start !== null) {
      if (target.end === null || target.end <= target.start)
        target.end = target.allDay ? target.start + DAY : target.start + (target.end === null ? defaults.duration : 0);
      if (target.allDay && target.end - target.start < DAY) target.end = target.start + DAY;
      if (target.end - target.start > 5 * 366 * DAY) throw badRequest('Ein Termin darf höchstens fünf Jahre dauern');
    }
  } else {
    if (input.due !== undefined) target.due = timeOf(input.due, target.allDay);
    else if (allDayChanged && target.due !== null) target.due = target.allDay ? Math.floor(target.due / DAY) * DAY : target.due;
    target.end = null;
  }
  if (input.status !== undefined) {
    const status = input.status?.toUpperCase() ?? null;
    if (status && !(todo ? STATUSES_TODO : STATUSES_EVENT).includes(status)) throw badRequest('Diesen Status gibt es nicht');
    target.status = status;
  }
  if (input.transparency !== undefined) target.transparency = input.transparency;
  if (input.privacy !== undefined) target.privacy = input.privacy;
  if (input.color !== undefined) target.color = normalizeColor(input.color);
  if (input.categories !== undefined) {
    target.categories = [...new Set(input.categories.map((value) => value.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
  }
  if (input.alarms !== undefined) {
    target.alarms = input.alarms.slice(0, 10).map((alarm): Alarm => ({
      offset: Math.max(-366 * DAY, Math.min(366 * DAY, Math.round(alarm.offset))),
      related: alarm.related === 'END' ? 'END' : 'START',
      absolute: alarm.absolute ?? null,
      action: alarm.action === 'EMAIL' ? 'EMAIL' : 'DISPLAY',
    }));
  }
  if (todo) {
    if (input.priority !== undefined) target.priority = Math.max(0, Math.min(9, Math.round(input.priority)));
    if (input.percent !== undefined) target.percent = Math.max(0, Math.min(100, Math.round(input.percent)));
    if (input.completed !== undefined) {
      target.completed = input.completed ? (target.completed ?? Date.now()) : null;
      target.status = input.completed ? 'COMPLETED' : target.status === 'COMPLETED' ? 'NEEDS-ACTION' : target.status;
      if (input.completed) target.percent = 100;
      else if (target.percent === 100) target.percent = 0;
    }
  }
}

function organizerFor(user: UserRow) {
  return { email: pseudoMail(user), name: user.name };
}

function applyAttendees(target: Instance, input: EventInput, user: UserRow) {
  if (input.attendees === undefined) return;
  const organizer = target.organizer ?? organizerFor(user);
  const previous = new Map(target.attendees.map((attendee) => [attendee.email, attendee]));
  const seen = new Set<string>();
  const list = [];
  for (const entry of input.attendees.slice(0, 200)) {
    const email = entry.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === organizer.email || seen.has(email)) continue;
    seen.add(email);
    const before = previous.get(email);
    list.push({
      email,
      name: entry.name?.trim() || before?.name || findByEmail(email)?.name || null,
      status: before?.status ?? ('NEEDS-ACTION' as PartStat),
      role: entry.role ?? before?.role ?? 'REQ-PARTICIPANT',
      rsvp: before?.rsvp ?? true,
    });
  }
  target.attendees = list;
  target.organizer = list.length ? organizer : null;
}

export interface Defaults {
  duration: number;
}

function defaultsFor(user: UserRow): Defaults {
  return { duration: Math.max(5, prefsOf(user).calendar.duration) * 60_000 };
}

function alarmsFromSpec(specs: { minutes: number; email?: boolean }[]): Alarm[] {
  return specs.map((spec) => ({
    offset: -spec.minutes * 60_000,
    related: 'START',
    absolute: null,
    action: spec.email ? 'EMAIL' : 'DISPLAY',
  }));
}

function validateRule(rrule: string | null | undefined) {
  if (rrule === undefined || rrule === null || rrule === '') return rrule === '' ? null : rrule;
  const rule = parseRule(rrule);
  if (!rule) throw badRequest('Die Wiederholung ist ungültig');
  if (['SECONDLY', 'MINUTELY'].includes(rule.freq)) throw badRequest('So oft kann sich ein Termin nicht wiederholen');
  return formatRule(rule);
}

export function createItem(
  user: UserRow,
  input: EventInput & { calendarId: string },
  options: { uid?: string; skipInvites?: boolean } = {}
) {
  const { calendar } = requireCalendar(user, input.calendarId, 'write');
  const component = input.component ?? 'VEVENT';
  if (!calendar.components.split(',').includes(component)) {
    throw badRequest(component === 'VTODO' ? 'Dieser Kalender nimmt keine Aufgaben auf' : 'Dieser Kalender nimmt keine Termine auf');
  }
  const zone = input.zone && isZone(input.zone) ? input.zone : (calendar.zone ?? zoneOf(user));
  const data = blankItem(component, zone, options.uid ?? randomUUID());
  if (input.kind) data.kind = input.kind;
  if (input.birthYear !== undefined) data.birthYear = input.birthYear;
  if (input.parent !== undefined) data.parent = input.parent;
  if (input.assignee !== undefined && component === 'VTODO') data.assignee = assigneeFor(calendar, input.assignee);
  applyInstance(data, input, component === 'VTODO', defaultsFor(user));
  if (component === 'VEVENT' && data.start === null) throw badRequest('Gib an, wann der Termin beginnt');
  if (!data.title) data.title = '';
  data.rrule = validateRule(input.rrule) ?? null;
  if (data.kind === 'birthday' && !data.rrule) data.rrule = 'FREQ=YEARLY';
  if (data.rrule && data.start === null && data.due === null) throw badRequest('Für eine Wiederholung braucht es ein Datum');
  if (input.alarms === undefined) {
    const defaults = calendarAlarms(calendar, user);
    if (component === 'VEVENT') data.alarms = alarmsFromSpec(data.allDay ? defaults.allDay : defaults.timed);
  }
  if (data.kind === 'birthday' || data.kind === 'focus' || data.kind === 'ooo') {
    data.transparency = data.kind === 'birthday' ? 'TRANSPARENT' : 'OPAQUE';
  }
  applyAttendees(data, input, user);
  const now = Date.now();
  data.created = now;
  data.modified = now;
  if (eventByUid(calendar.id, data.uid)) throw conflict('Diesen Termin gibt es in diesem Kalender schon');
  const ics = writeObject(null, null, data, now);
  const created = tx(() => {
    const row = storeItem(calendar, data, ics, { actor: user.id });
    if (!options.skipInvites) afterChange(user, row, null, data);
    return row;
  });
  announceAssignment(user, created, null, data);
  return created;
}

export function calendarMembers(calendar: CalendarRow) {
  const ids = [
    calendar.owner_id,
    ...all<{ user_id: number }>("SELECT user_id FROM calendar_shares WHERE calendar_id = ? AND permission = 'write'", calendar.id).map(
      (row) => row.user_id
    ),
  ];
  return ids
    .map((id) => getUser(id))
    .filter((user): user is UserRow => Boolean(user) && !inactive(user!))
    .map((user) => ({ id: user.id, name: user.name, initials: initials(user.name), avatar: user.avatar ?? null }));
}

function assigneeFor(calendar: CalendarRow, value: number | null) {
  if (value === null) return null;
  if (!calendarMembers(calendar).some((member) => member.id === value)) throw badRequest('Diese Person kann die Aufgabe nicht bearbeiten');
  return value;
}

function announceAssignment(user: UserRow, row: EventRow, before: ItemData | null, after: ItemData) {
  if (!after.assignee || after.assignee === user.id || before?.assignee === after.assignee) return;
  const due = after.due !== null ? formatDue(after, getUser(after.assignee)) : null;
  notify(
    after.assignee,
    'task_assigned',
    { by: user.name, title: after.title || '…', ...(due ? { due } : {}) },
    `/calendar/tasks?task=${row.id}`
  );
}

function formatDue(data: ItemData, person: UserRow | undefined) {
  if (data.due === null) return null;
  const lang = person ? preferredLanguage(person) : 'de';
  const zone = person ? zoneOf(person) : data.zone;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    dateStyle: 'medium',
    ...(data.allDay ? { timeZone: 'UTC' } : { timeStyle: 'short', timeZone: zone }),
  }).format(new Date(data.due));
}

function significant(before: Instance, after: Instance) {
  return (
    before.start !== after.start ||
    before.end !== after.end ||
    before.allDay !== after.allDay ||
    before.location !== after.location ||
    before.status !== after.status ||
    before.title !== after.title
  );
}

function shiftKey(key: string, delta: number, allDay: boolean) {
  const start = recurrenceStart(key);
  if (start === null) return key;
  return allDay ? compactKey(keyOfDay(Math.floor((start + delta) / DAY))) : utcKey(start + delta);
}

function shiftRule(rrule: string | null, data: ItemData, delta: number) {
  if (!rrule || !delta || data.start === null) return rrule;
  const rule = parseRule(rrule);
  if (!rule) return rrule;
  const zone = data.allDay ? 'UTC' : data.zone;
  const before = wallOf(data.start, zone);
  const after = wallOf(data.start + delta, zone);
  const oldWeekday = weekdayOfDay(dayNumber(before.year, before.month, before.day));
  const newWeekday = weekdayOfDay(dayNumber(after.year, after.month, after.day));
  if (oldWeekday !== newWeekday && rule.byDay.length) {
    const shiftDays = (newWeekday - oldWeekday + 7) % 7;
    rule.byDay = rule.byDay.map((entry) => ({ ...entry, day: (entry.day + shiftDays) % 7 }));
  }
  if (before.day !== after.day && rule.byMonthDay.length === 1 && rule.byMonthDay[0] === before.day) rule.byMonthDay = [after.day];
  if (before.month !== after.month && rule.byMonth.length === 1 && rule.byMonth[0] === before.month) rule.byMonth = [after.month];
  if (rule.until && rule.until.endsWith('Z')) {
    const until = recurrenceStart(rule.until);
    if (until !== null) rule.until = utcKey(until + delta);
  }
  return formatRule(rule);
}

function shiftSeries(data: ItemData, delta: number) {
  if (!delta) return;
  data.rrule = shiftRule(data.rrule, data, delta);
  if (data.start !== null) data.start += delta;
  if (data.end !== null) data.end += delta;
  if (data.due !== null) data.due += delta;
  data.exdates = data.exdates.map((key) => shiftKey(key, delta, data.allDay));
  data.rdates = data.rdates.map((value) => value + delta);
  data.overrides = data.overrides.map((override) => ({
    ...override,
    recurrenceId: shiftKey(override.recurrenceId, delta, data.allDay),
    start: override.start === null ? null : override.start + delta,
    end: override.end === null ? null : override.end + delta,
    due: override.due === null ? null : override.due + delta,
  }));
}

export type Scope = 'all' | 'this' | 'following';

function occurrenceOf(recurrenceId: string) {
  const start = recurrenceStart(recurrenceId);
  if (start === null) throw badRequest('Diesen Einzeltermin gibt es nicht');
  return start;
}

function countBefore(data: ItemData, before: number) {
  if (!data.rrule || data.start === null) return 0;
  const rule = parseRule(data.rrule);
  if (!rule?.count) return 0;
  return occurrences({ ...data, exdates: [], overrides: [] }, -Infinity, before, 200_000).length;
}

function splitSeries(data: ItemData, recurrenceId: string): { head: ItemData; tail: ItemData } {
  const split = occurrenceOf(recurrenceId);
  const head = cloneData(data);
  const tail = cloneData(data);
  const rule = data.rrule ? parseRule(data.rrule) : null;
  if (rule) {
    const headRule = { ...rule };
    if (rule.count) {
      const before = countBefore(data, split);
      headRule.count = Math.max(1, before);
      const tailRule = { ...rule, count: Math.max(1, rule.count - before) };
      tail.rrule = formatRule(tailRule);
    } else tail.rrule = formatRule(rule);
    headRule.count = rule.count ? headRule.count : null;
    if (!rule.count) headRule.until = untilFromBefore({ date: '', seconds: 0, allDay: data.allDay, zone: data.zone }, split);
    head.rrule = formatRule(headRule);
  }
  head.exdates = data.exdates.filter((key) => (recurrenceStart(key) ?? 0) < split);
  head.rdates = data.rdates.filter((value) => value < split);
  head.overrides = data.overrides.filter((entry) => (recurrenceStart(entry.recurrenceId) ?? 0) < split);
  const delta = split - (data.start ?? data.due ?? split);
  tail.uid = randomUUID();
  tail.start = data.start !== null ? data.start + delta : null;
  tail.end = data.end !== null ? data.end + delta : null;
  tail.due = data.due !== null ? data.due + delta : null;
  tail.exdates = data.exdates.filter((key) => (recurrenceStart(key) ?? 0) >= split);
  tail.rdates = data.rdates.filter((value) => value >= split);
  tail.overrides = data.overrides.filter((entry) => (recurrenceStart(entry.recurrenceId) ?? 0) >= split);
  tail.sequence = 0;
  tail.created = Date.now();
  return { head, tail };
}

export interface UpdateResult {
  row: EventRow;
  created?: EventRow;
}

export function updateItem(
  user: UserRow,
  id: string,
  input: EventInput,
  scope: Scope = 'all',
  recurrenceId: string | null = null
): UpdateResult {
  const found = requireEvent(user, id, 'write');
  const before = dataOf(found.row);
  let target = found.calendar;
  if (input.calendarId && input.calendarId !== found.calendar.id) {
    target = requireCalendar(user, input.calendarId, 'write').calendar;
    if (!target.components.split(',').includes(before.component)) throw badRequest('Dieser Kalender nimmt so etwas nicht auf');
    if (eventByUid(target.id, before.uid)) throw conflict('Diesen Termin gibt es im Zielkalender schon');
  }
  const defaults = defaultsFor(user);
  const recurring = isRecurringItem(before);
  const next = cloneData(before);
  const todo = before.component === 'VTODO';
  let created: EventRow | undefined;

  if (recurring && recurrenceId && scope === 'this') {
    const base = instanceAt(before, recurrenceId);
    if (!base) throw notFound('Diesen Einzeltermin gibt es nicht');
    const instance = pickInstance(base);
    applyInstance(instance, input, todo, defaults);
    applyAttendees(instance, input, user);
    const override: Override = { ...instance, recurrenceId };
    next.overrides = [...next.overrides.filter((entry) => entry.recurrenceId !== recurrenceId), override];
  } else if (recurring && recurrenceId && scope === 'following' && recurrenceStart(recurrenceId) !== (before.start ?? before.due)) {
    const { head, tail } = splitSeries(before, recurrenceId);
    const occurrenceStart = occurrenceOf(recurrenceId);
    applyInstance(tail, { ...input }, todo, defaults);
    if (input.start !== undefined && tail.start !== null) {
      const delta = tail.start - occurrenceStart;
      tail.overrides = tail.overrides.map((override) => ({
        ...override,
        recurrenceId: shiftKey(override.recurrenceId, delta, tail.allDay),
      }));
      tail.exdates = tail.exdates.map((key) => shiftKey(key, delta, tail.allDay));
      if (delta) tail.rrule = shiftRule(tail.rrule, { ...tail, start: occurrenceStart }, delta);
    }
    if (input.rrule !== undefined) tail.rrule = validateRule(input.rrule) ?? null;
    applyAttendees(tail, input, user);
    tail.sequence = 0;
    head.sequence = before.sequence + 1;
    const headIcs = writeObject(found.row.ics, before, head);
    const tailIcs = writeObject(null, null, tail);
    return tx(() => {
      const row = storeItem(found.calendar, head, headIcs, { actor: user.id, previous: found.row });
      created = storeItem(target, tail, tailIcs, { actor: user.id });
      afterChange(user, row, before, head);
      afterChange(user, created, null, tail);
      return { row, created };
    });
  } else {
    if (recurring && recurrenceId && input.start !== undefined) {
      const occurrenceStart = occurrenceOf(recurrenceId);
      const allDay = input.allDay ?? before.allDay;
      const newStart = timeOf(input.start, allDay);
      const newEnd = input.end !== undefined ? timeOf(input.end, allDay) : null;
      if (newStart !== null) {
        const delta = newStart - occurrenceStart;
        const duration = newEnd !== null ? newEnd - newStart : durationOf(before);
        shiftSeries(next, delta);
        const rest = { ...input };
        delete rest.start;
        delete rest.end;
        applyInstance(next, rest, todo, defaults);
        if (!todo && next.start !== null) next.end = next.start + Math.max(next.allDay ? DAY : 0, duration);
      }
    } else applyInstance(next, input, todo, defaults);
    if (input.rrule !== undefined) next.rrule = validateRule(input.rrule) ?? null;
    if (input.kind !== undefined) next.kind = input.kind;
    if (input.birthYear !== undefined) next.birthYear = input.birthYear;
    if (input.parent !== undefined) next.parent = input.parent;
    if (input.assignee !== undefined && todo) next.assignee = assigneeFor(target, input.assignee);
    if (input.exdates !== undefined) next.exdates = input.exdates.filter((key) => /^\d{8}(T\d{6}Z)?$/.test(key));
    applyAttendees(next, input, user);
    if (next.component === 'VEVENT' && next.start === null) throw badRequest('Gib an, wann der Termin beginnt');
  }
  if (next.attendees.length && significant(before, next)) next.sequence = before.sequence + 1;
  next.modified = Date.now();
  if (target.id !== found.calendar.id && next.assignee && !calendarMembers(target).some((member) => member.id === next.assignee))
    next.assignee = null;
  if (target.id !== found.calendar.id) {
    const ics = writeObject(found.row.ics, before, next);
    return tx(() => {
      const row = storeItem(target, next, ics, { actor: user.id, previous: found.row, href: found.row.href });
      afterChange(user, row, before, next);
      return { row };
    });
  }
  const ics = writeObject(found.row.ics, before, next);
  const result = tx(() => {
    const row = storeItem(found.calendar, next, ics, { actor: user.id, previous: found.row });
    afterChange(user, row, before, next);
    return { row, created };
  });
  announceAssignment(user, result.row, before, next);
  return result;
}

export function deleteItem(user: UserRow, id: string, scope: Scope = 'all', recurrenceId: string | null = null) {
  const found = requireEvent(user, id, 'write');
  const before = dataOf(found.row);
  const recurring = isRecurringItem(before);
  const isFirst = recurrenceId !== null && recurrenceStart(recurrenceId) === (before.start ?? before.due);
  if (!recurring || !recurrenceId || scope === 'all' || (scope === 'following' && isFirst)) {
    tx(() => trashItem(found.row, user.id));
    afterChange(user, found.row, before, null);
    return { row: found.row, trashed: true };
  }
  const next = cloneData(before);
  if (scope === 'this') {
    next.exdates = [...new Set([...next.exdates, recurrenceId])];
    next.overrides = next.overrides.filter((entry) => entry.recurrenceId !== recurrenceId);
  } else {
    const { head } = splitSeries(before, recurrenceId);
    Object.assign(next, head, { uid: before.uid });
  }
  next.sequence = before.sequence + (before.attendees.length ? 1 : 0);
  const ics = writeObject(found.row.ics, before, next);
  return tx(() => {
    const row = storeItem(found.calendar, next, ics, { actor: user.id, previous: found.row });
    afterChange(user, row, before, next, scope === 'this' ? { cancelled: recurrenceId } : {});
    return { row, trashed: false };
  });
}

export function restoreItem(user: UserRow, id: string) {
  const row = getEvent(id);
  if (!row || !row.trashed_at) throw notFound('Diesen Termin gibt es im Papierkorb nicht');
  const calendar = getCalendar(row.calendar_id);
  if (!calendar || !writable(user, calendar)) throw forbidden('Diesen Kalender kannst du nicht bearbeiten');
  const clash = one<{ id: string }>(
    'SELECT id FROM events WHERE calendar_id = ? AND href = ? AND trashed_at IS NULL AND id != ?',
    row.calendar_id,
    row.href,
    row.id
  );
  if (clash) throw conflict('Im Kalender gibt es diesen Termin schon wieder');
  run('UPDATE events SET trashed_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?', user.id, Date.now(), id);
  touchCalendar(row.calendar_id, row.href);
  const restored = getEvent(id)!;
  scheduleAlarms(restored, dataOf(restored));
  announce([row.calendar_id]);
  return restored;
}

export function duplicateItem(user: UserRow, id: string, recurrenceId: string | null, calendarId?: string) {
  const found = requireEvent(user, id, 'read');
  const data = dataOf(found.row);
  const source = recurrenceId ? (instanceAt(data, recurrenceId) ?? data) : data;
  const targetId = calendarId ?? (writable(user, found.calendar) ? found.calendar.id : (prefsOf(user).calendar.defaultCalendar ?? ''));
  const { calendar } = requireCalendar(user, targetId, 'write');
  const copy = blankItem(data.component, source.zone);
  Object.assign(copy, pickInstance(source));
  copy.kind = data.kind;
  copy.birthYear = data.birthYear;
  copy.assignee = data.assignee && calendarMembers(calendar).some((member) => member.id === data.assignee) ? data.assignee : null;
  copy.rrule = recurrenceId ? null : data.rrule;
  copy.exdates = recurrenceId ? [] : [...data.exdates];
  copy.attendees = [];
  copy.organizer = null;
  copy.created = Date.now();
  copy.completed = null;
  if (copy.component === 'VTODO' && copy.status === 'COMPLETED') copy.status = 'NEEDS-ACTION';
  const ics = writeObject(null, null, copy);
  return tx(() => storeItem(calendar, copy, ics, { actor: user.id }));
}

export function purgeTrashedEvents(days: number) {
  if (days <= 0) return 0;
  return run('DELETE FROM events WHERE trashed_at IS NOT NULL AND trashed_at < ?', Date.now() - days * DAY).changes;
}

export function listTrash(user: UserRow) {
  const ids = accessibleCalendarIds(user.id, 'write');
  const own = all<{ id: string; name: string; color: string; trashed_at: number }>(
    'SELECT id, name, color, trashed_at FROM calendars WHERE owner_id = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC',
    user.id
  );
  const events = ids.length
    ? all<EventRow>(
        `SELECT * FROM events WHERE trashed_at IS NOT NULL AND calendar_id IN (${placeholders(ids.length)}) ORDER BY trashed_at DESC LIMIT 300`,
        ...ids
      )
    : [];
  return {
    calendars: own.map((row) => ({ id: row.id, name: row.name, color: row.color, trashedAt: row.trashed_at })),
    events: events.map((row) => ({
      id: row.id,
      calendarId: row.calendar_id,
      title: row.title,
      component: row.component,
      start: row.start_at,
      allDay: Boolean(row.all_day),
      recurring: Boolean(row.recurring),
      trashedAt: row.trashed_at,
    })),
  };
}

export interface OccurrenceView {
  key: string;
  eventId: string;
  calendarId: string;
  recurrenceId: string | null;
  component: 'VEVENT' | 'VTODO';
  title: string;
  location: string;
  start: number;
  end: number;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  status: string | null;
  transparency: 'OPAQUE' | 'TRANSPARENT';
  privacy: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
  kind: ItemKind;
  birthYear: number | null;
  categories: string[];
  conference: string | null;
  recurring: boolean;
  override: boolean;
  completed: boolean;
  priority: number;
  attendees: number;
  invitation: PartStat | null;
  organizer: string | null;
  readOnly: boolean;
  busyOnly: boolean;
  hasAlarms: boolean;
  zone: string;
}

function dateKeysOf(start: number, end: number) {
  const first = keyOfDay(Math.floor(start / DAY));
  const last = keyOfDay(Math.max(Math.floor(start / DAY) + 1, Math.ceil(end / DAY)));
  return { first, last };
}

function view(
  row: EventRow,
  data: ItemData,
  expanded: ReturnType<typeof occurrences>[number],
  access: Access,
  invitation: PartStat | null,
  viewer: number
): OccurrenceView {
  const instance = expanded.instance;
  const hidden = access === 'freebusy' || (instance.privacy !== 'PUBLIC' && !atLeast(access, 'write') && row.created_by !== viewer);
  const allDay = data.allDay;
  const dates = allDay ? dateKeysOf(expanded.start, expanded.end) : null;
  return {
    key: `${row.id}:${expanded.recurrenceId ?? ''}`,
    eventId: row.id,
    calendarId: row.calendar_id,
    recurrenceId: expanded.recurrenceId,
    component: data.component,
    title: hidden ? '' : instance.title,
    location: hidden ? '' : instance.location,
    start: expanded.start,
    end: expanded.end,
    allDay,
    startDate: dates?.first ?? null,
    endDate: dates?.last ?? null,
    color: hidden ? null : instance.color,
    status: instance.status,
    transparency: instance.transparency,
    privacy: instance.privacy,
    kind: hidden ? 'event' : data.kind,
    birthYear: hidden ? null : data.birthYear,
    categories: hidden ? [] : instance.categories,
    conference: hidden ? null : instance.conference,
    recurring: Boolean(row.recurring),
    override: expanded.override,
    completed: data.component === 'VTODO' && (instance.status === 'COMPLETED' || instance.completed !== null),
    priority: instance.priority,
    attendees: hidden ? 0 : instance.attendees.length,
    invitation,
    organizer: hidden ? null : (instance.organizer?.name ?? instance.organizer?.email ?? null),
    readOnly: !atLeast(access, 'write') || invitation !== null,
    busyOnly: hidden,
    hasAlarms: Boolean(row.has_alarms),
    zone: instance.zone,
  };
}

export interface RangeQuery {
  from: number;
  to: number;
  calendars?: string[];
  tasks?: boolean;
  completed?: boolean;
  declined?: boolean;
  invitations?: boolean;
}

export function listOccurrences(user: UserRow, query: RangeQuery): OccurrenceView[] {
  const accessible = new Map<string, Access>();
  for (const id of accessibleCalendarIds(user.id)) {
    const calendar = getCalendar(id);
    if (calendar) {
      const access = accessOf(user, calendar);
      if (access) accessible.set(id, access);
    }
  }
  const wanted = (query.calendars?.length ? query.calendars : [...accessible.keys()]).filter((id) => accessible.has(id));
  const from = query.from - DAY;
  const to = query.to + DAY;
  const out: OccurrenceView[] = [];
  const limit = 5000;
  if (wanted.length) {
    const rows = all<EventRow>(
      `SELECT * FROM events WHERE calendar_id IN (${placeholders(wanted.length)}) AND trashed_at IS NULL
         AND start_at IS NOT NULL AND start_at < ? AND (range_end IS NULL OR range_end > ?) ${query.tasks === false ? "AND component = 'VEVENT'" : ''}
       ORDER BY start_at LIMIT 20000`,
      ...wanted,
      to,
      from
    );
    const myEmail = user.email?.toLowerCase();
    for (const row of rows) {
      const data = dataOf(row);
      if (data.component === 'VTODO' && !query.completed && (data.status === 'COMPLETED' || data.completed) && !isRecurringItem(data))
        continue;
      const access = accessible.get(row.calendar_id)!;
      const me = myEmail ? data.attendees.find((attendee) => attendee.email === myEmail) : undefined;
      for (const expanded of occurrences(data, from, to, 2000)) {
        if (expanded.instance.status === 'CANCELLED' && data.component === 'VEVENT' && !query.declined) continue;
        if (data.component === 'VTODO' && !query.completed && (expanded.instance.status === 'COMPLETED' || expanded.instance.completed))
          continue;
        out.push(view(row, data, expanded, access, me && data.organizer?.email !== myEmail ? me.status : null, user.id));
        if (out.length >= limit) return out;
      }
    }
  }
  if (query.invitations !== false) {
    const invited = all<EventRow & { my_status: PartStat; my_hidden: number }>(
      `SELECT e.*, a.status AS my_status, a.hidden AS my_hidden FROM attendees a JOIN events e ON e.id = a.event_id
       WHERE a.user_id = ? AND e.trashed_at IS NULL AND e.start_at IS NOT NULL AND e.start_at < ? AND (e.range_end IS NULL OR e.range_end > ?)`,
      user.id,
      to,
      from
    );
    for (const row of invited) {
      if (accessible.has(row.calendar_id) && wanted.includes(row.calendar_id)) continue;
      if (accessible.has(row.calendar_id) && !wanted.includes(row.calendar_id) && query.calendars?.length) continue;
      if (row.my_hidden) continue;
      if (row.my_status === 'DECLINED' && !query.declined) continue;
      const data = dataOf(row);
      for (const expanded of occurrences(data, from, to, 2000)) {
        if (expanded.instance.status === 'CANCELLED') continue;
        out.push(view(row, data, expanded, 'read', row.my_status, user.id));
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
}

export function busyIntervals(userId: number, from: number, to: number, calendarIds?: string[]) {
  const ids =
    calendarIds ??
    all<{ id: string }>("SELECT id FROM calendars WHERE owner_id = ? AND trashed_at IS NULL AND kind = 'local'", userId).map(
      (row) => row.id
    );
  const out: { start: number; end: number; allDay: boolean }[] = [];
  if (!ids.length) return out;
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE calendar_id IN (${placeholders(ids.length)}) AND trashed_at IS NULL AND component = 'VEVENT'
       AND start_at IS NOT NULL AND start_at < ? AND (range_end IS NULL OR range_end > ?)`,
    ...ids,
    to + DAY,
    from - DAY
  );
  for (const row of rows) {
    const data = dataOf(row);
    for (const expanded of occurrences(data, from, to, 2000)) {
      const instance = expanded.instance;
      if (instance.transparency === 'TRANSPARENT' || instance.status === 'CANCELLED' || data.kind === 'birthday') continue;
      out.push({ start: expanded.start, end: expanded.end, allDay: data.allDay });
    }
  }
  const invited = all<EventRow>(
    `SELECT e.* FROM attendees a JOIN events e ON e.id = a.event_id WHERE a.user_id = ? AND a.status IN ('ACCEPTED', 'TENTATIVE')
       AND e.trashed_at IS NULL AND e.start_at < ? AND (e.range_end IS NULL OR e.range_end > ?)`,
    userId,
    to,
    from
  );
  for (const row of invited) {
    for (const expanded of occurrences(dataOf(row), from, to, 2000))
      out.push({ start: expanded.start, end: expanded.end, allDay: Boolean(row.all_day) });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detail(user: UserRow, id: string, recurrenceId: string | null) {
  const found = requireEvent(user, id, 'freebusy');
  const data = dataOf(found.row);
  const calendar = found.calendar;
  const owner = getUser(calendar.owner_id);
  const instance = recurrenceId ? instanceAt(data, recurrenceId) : null;
  const hidden =
    found.access === 'freebusy' ||
    (data.privacy !== 'PUBLIC' && !atLeast(found.access, 'write') && found.row.created_by !== user.id && !found.invited);
  const myEmail = user.email?.toLowerCase() ?? null;
  const me = myEmail ? data.attendees.find((attendee) => attendee.email === myEmail) : undefined;
  const attendees = all<{ email: string; user_id: number | null; status: PartStat; responded_at: number | null; comment: string | null }>(
    'SELECT email, user_id, status, responded_at, comment FROM attendees WHERE event_id = ?',
    id
  );
  const createdBy = found.row.created_by ? getUser(found.row.created_by) : null;
  const updatedBy = found.row.updated_by ? getUser(found.row.updated_by) : null;
  const strip = (value: Instance) =>
    hidden
      ? {
          ...value,
          title: '',
          description: '',
          location: '',
          url: '',
          attendees: [],
          organizer: null,
          conference: null,
          categories: [],
          alarms: [],
        }
      : value;
  return {
    id: found.row.id,
    etag: found.row.etag,
    calendarId: calendar.id,
    calendar: { id: calendar.id, name: calendar.name, color: calendar.color, owner: owner?.name ?? '', kind: calendar.kind },
    access: found.access,
    invited: found.invited || Boolean(me && data.organizer?.email !== myEmail),
    myStatus: me?.status ?? null,
    isOrganizer:
      Boolean(data.organizer && myEmail && data.organizer.email === myEmail) ||
      (data.attendees.length > 0 && calendar.owner_id === user.id),
    readOnly: !atLeast(found.access, 'write') || calendar.kind !== 'local',
    busyOnly: hidden,
    data: { ...strip(data), assignee: hidden ? null : (data.assignee ?? null), overrides: hidden ? [] : data.overrides } as ItemData,
    instance: instance ? strip(pickInstance(instance)) : null,
    recurrenceId,
    attendeeInfo: hidden
      ? []
      : attendees.map((row) => ({ email: row.email, internal: Boolean(row.user_id), respondedAt: row.responded_at, comment: row.comment })),
    createdBy: createdBy?.name ?? null,
    updatedBy: updatedBy?.name ?? null,
    createdAt: found.row.created_at,
    updatedAt: found.row.updated_at,
    trashedAt: found.row.trashed_at,
  };
}

export function searchEvents(
  user: UserRow,
  query: string,
  options: { calendars?: string[]; from?: number | null; to?: number | null; limit?: number } = {}
) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const ids = (options.calendars?.length ? options.calendars : accessibleCalendarIds(user.id, 'read')).filter((id) => {
    const calendar = getCalendar(id);
    const access = calendar ? accessOf(user, calendar) : null;
    return access && atLeast(access, 'read');
  });
  if (!ids.length) return [];
  const words = term.split(/\s+/).filter(Boolean).slice(0, 6);
  const where = words.map(
    () => "(title LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR categories LIKE ? ESCAPE '\\')"
  );
  const params: (string | number)[] = [];
  for (const word of words) {
    const like = `%${word.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    params.push(like, like, like, like);
  }
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE calendar_id IN (${placeholders(ids.length)}) AND trashed_at IS NULL AND ${where.join(' AND ')}
       ${options.from ? 'AND (range_end IS NULL OR range_end > ?)' : ''} ${options.to ? 'AND start_at < ?' : ''}
     ORDER BY start_at DESC LIMIT ?`,
    ...ids,
    ...params,
    ...(options.from ? [options.from] : []),
    ...(options.to ? [options.to] : []),
    Math.min(200, options.limit ?? 100)
  );
  const now = Date.now();
  return rows.map((row) => {
    const data = dataOf(row);
    let next: number | null = row.start_at;
    if (row.recurring) {
      const upcoming = occurrences(data, now, now + 400 * DAY, 1)[0];
      next = upcoming?.start ?? row.start_at;
    }
    return {
      eventId: row.id,
      calendarId: row.calendar_id,
      component: row.component,
      title: row.title,
      location: row.location ?? '',
      description: (row.description ?? '').slice(0, 200),
      start: next,
      allDay: Boolean(row.all_day),
      recurring: Boolean(row.recurring),
      completed: Boolean(row.completed_at),
      color: data.color,
    };
  });
}

export interface TaskView {
  id: string;
  calendarId: string;
  uid: string;
  title: string;
  description: string;
  due: number | null;
  start: number | null;
  allDay: boolean;
  priority: number;
  percent: number;
  status: string | null;
  completed: number | null;
  parent: string | null;
  recurring: boolean;
  categories: string[];
  color: string | null;
  readOnly: boolean;
  assignee: { id: number; name: string; initials: string } | null;
  createdAt: number;
}

export function listTasks(user: UserRow, options: { calendars?: string[]; completed?: boolean } = {}): TaskView[] {
  const ids = (options.calendars?.length ? options.calendars : accessibleCalendarIds(user.id, 'read')).filter((id) => {
    const calendar = getCalendar(id);
    const access = calendar ? accessOf(user, calendar) : null;
    return access && atLeast(access, 'read');
  });
  if (!ids.length) return [];
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE calendar_id IN (${placeholders(ids.length)}) AND trashed_at IS NULL AND component = 'VTODO'
       ${options.completed ? '' : 'AND (completed_at IS NULL OR completed_at > ?)'} ORDER BY completed_at IS NOT NULL, due_at IS NULL, due_at, created_at LIMIT 2000`,
    ...ids,
    ...(options.completed ? [] : [Date.now() - DAY])
  );
  const people = new Map<number, { id: number; name: string; initials: string } | null>();
  const personOf = (id: number | null) => {
    if (!id) return null;
    if (!people.has(id)) {
      const person = getUser(id);
      people.set(id, person ? { id: person.id, name: person.name, initials: initials(person.name) } : null);
    }
    return people.get(id) ?? null;
  };
  return rows.map((row) => {
    const data = dataOf(row);
    const calendar = getCalendar(row.calendar_id)!;
    let due = data.due;
    if (isRecurringItem(data)) {
      const next = occurrences(data, Date.now() - 30 * DAY, Date.now() + 400 * DAY, 50).find(
        (entry) => entry.instance.status !== 'COMPLETED' && !entry.instance.completed
      );
      due = next?.start ?? due;
    }
    return {
      id: row.id,
      calendarId: row.calendar_id,
      uid: data.uid,
      title: data.title,
      description: data.description,
      due,
      start: data.start,
      allDay: data.allDay,
      priority: data.priority,
      percent: data.percent,
      status: data.status,
      completed: data.completed ?? (data.status === 'COMPLETED' ? row.updated_at : null),
      parent: data.parent,
      recurring: isRecurringItem(data),
      categories: data.categories,
      color: data.color,
      readOnly: !writable(user, calendar),
      assignee: personOf(data.assignee ?? null),
      createdAt: row.created_at,
    };
  });
}

export function completeTask(user: UserRow, id: string, completed: boolean, recurrenceId: string | null) {
  const found = requireEvent(user, id, 'write');
  const data = dataOf(found.row);
  if (data.component !== 'VTODO') throw badRequest('Das ist keine Aufgabe');
  if (isRecurringItem(data)) {
    let key = recurrenceId;
    if (!key) {
      const next = occurrences(data, Date.now() - 365 * DAY, Date.now() + 400 * DAY, 500).find(
        (entry) => entry.instance.status !== 'COMPLETED' && !entry.instance.completed
      );
      key = next?.recurrenceId ?? null;
    }
    if (!key) return updateItem(user, id, { completed }, 'all');
    return updateItem(user, id, { completed }, 'this', key);
  }
  return updateItem(user, id, { completed }, 'all');
}

export function upcomingFor(user: UserRow, limit = 5) {
  const now = Date.now();
  return listOccurrences(user, { from: now, to: now + 14 * DAY, tasks: false })
    .filter((entry) => entry.end > now && !entry.busyOnly && entry.invitation !== 'DECLINED')
    .slice(0, limit);
}

export const eventCount = (calendarId: string) =>
  value<number>('SELECT COUNT(*) FROM events WHERE calendar_id = ? AND trashed_at IS NULL', calendarId) ?? 0;

export function publicOccurrences(calendar: CalendarRow, from: number, to: number, busyOnly: boolean): OccurrenceView[] {
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE calendar_id = ? AND trashed_at IS NULL AND component = 'VEVENT' AND start_at IS NOT NULL AND start_at < ? AND (range_end IS NULL OR range_end > ?)
     ORDER BY start_at LIMIT 10000`,
    calendar.id,
    to + DAY,
    from - DAY
  );
  const out: OccurrenceView[] = [];
  for (const row of rows) {
    const data = dataOf(row);
    for (const expanded of occurrences(data, from - DAY, to + DAY, 2000)) {
      if (expanded.instance.status === 'CANCELLED') continue;
      const hidden = busyOnly || expanded.instance.privacy !== 'PUBLIC';
      const entry = view(row, data, expanded, hidden ? 'freebusy' : 'read', null, -1);
      out.push({ ...entry, attendees: 0, organizer: null, readOnly: true });
      if (out.length > 5000) return out;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function publicDetail(calendar: CalendarRow, eventId: string, busyOnly: boolean) {
  const row = getEvent(eventId);
  if (!row || row.calendar_id !== calendar.id || row.trashed_at) return null;
  const data = dataOf(row);
  if (busyOnly || data.privacy !== 'PUBLIC') return { title: '', description: '', location: '', url: '', conference: null };
  return { title: data.title, description: data.description, location: data.location, url: data.url, conference: data.conference };
}
