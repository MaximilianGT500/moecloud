import { all, one, run, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { t } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { formatClock, formatWhen } from './when.ts';
import { DAY, addDays, atMinute, localKey, minuteOfDay, startOfWeek, todayKey, weekdayOf } from '../../shared/time.ts';
import { holidaysBetween } from '../../shared/holidays.ts';
import { accessOf, getCalendar } from './calendars.ts';
import { busyIntervals, listOccurrences, listTasks } from './events.ts';
import { absoluteUrl } from './links.ts';
import { deliver, mailReady } from '../services/mail.ts';
import { inQuiet, localClock } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { ACTIVE, getUser, initials, preferredLanguage, prefsOf, updateCalendarPrefs, zoneOf, type UserRow } from '../services/users.ts';

export function statistics(user: UserRow, from: number, to: number, calendars?: string[]) {
  const zone = zoneOf(user);
  const list = listOccurrences(user, { from, to, calendars, tasks: false, invitations: true }).filter(
    (entry) => !entry.busyOnly && entry.invitation !== 'DECLINED' && entry.status !== 'CANCELLED'
  );
  const byCalendar = new Map<string, { id: string; name: string; color: string; minutes: number; events: number }>();
  const byCategory = new Map<string, { name: string; minutes: number; events: number }>();
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byDay = new Map<string, number>();
  let minutes = 0;
  let timed = 0;
  let allDay = 0;
  let meetings = 0;
  let meetingMinutes = 0;
  let longest: { title: string; minutes: number } | null = null;
  for (const entry of list) {
    if (entry.allDay) {
      allDay++;
      continue;
    }
    const start = Math.max(entry.start, from);
    const end = Math.min(entry.end, to);
    const length = Math.max(0, Math.round((end - start) / 60_000));
    if (!length) continue;
    timed++;
    minutes += length;
    if (entry.attendees > 0) {
      meetings++;
      meetingMinutes += length;
    }
    if (!longest || length > longest.minutes) longest = { title: entry.title, minutes: length };
    const calendar =
      byCalendar.get(entry.calendarId) ??
      (() => {
        const row = getCalendar(entry.calendarId);
        const created = { id: entry.calendarId, name: row?.name ?? '?', color: row?.color ?? '#888888', minutes: 0, events: 0 };
        byCalendar.set(entry.calendarId, created);
        return created;
      })();
    calendar.minutes += length;
    calendar.events++;
    for (const category of entry.categories.length ? entry.categories : ['']) {
      const key = category.toLowerCase();
      const found = byCategory.get(key) ?? { name: category, minutes: 0, events: 0 };
      found.minutes += length;
      found.events++;
      byCategory.set(key, found);
    }
    for (let cursor = start; cursor < end;) {
      const day = localKey(cursor, zone);
      const nextDay = atMinute(addDays(day, 1), 0, zone);
      const until = Math.min(end, nextDay);
      const share = Math.round((until - cursor) / 60_000);
      byDay.set(day, (byDay.get(day) ?? 0) + share);
      byWeekday[weekdayOf(day)] += share;
      for (let minute = cursor; minute < until; minute += 15 * 60_000)
        byHour[Math.floor(minuteOfDay(minute, zone) / 60) % 24] += Math.min(15, (until - minute) / 60_000);
      cursor = until;
    }
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const busiest = days.reduce<{ date: string; minutes: number } | null>(
    (best, [date, value]) => (!best || value > best.minutes ? { date, minutes: value } : best),
    null
  );
  const span = Math.max(1, Math.round((to - from) / DAY));
  return {
    from,
    to,
    zone,
    total: { minutes, events: timed, allDay, meetings, meetingMinutes, average: Math.round(minutes / span) },
    byCalendar: [...byCalendar.values()].sort((a, b) => b.minutes - a.minutes),
    byCategory: [...byCategory.values()]
      .filter((entry) => entry.name)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 12),
    byWeekday,
    byHour: byHour.map((value) => Math.round(value)),
    byDay: days.map(([date, value]) => ({ date, minutes: value })),
    busiest,
    longest,
  };
}

export function freebusyFor(viewer: UserRow, userIds: number[], from: number, to: number) {
  if (to - from > 62 * DAY) throw badRequest('Der Zeitraum ist zu lang');
  return userIds.slice(0, 20).map((id) => {
    const target = getUser(id);
    if (!target || target.disabled || target.role === 'guest' || target.role === 'team')
      return { userId: id, name: '', initials: '?', visible: false, busy: [] };
    const shared = all<{ calendar_id: string }>('SELECT calendar_id FROM calendar_shares WHERE user_id = ?', viewer.id).some((row) => {
      const calendar = getCalendar(row.calendar_id);
      return calendar?.owner_id === target.id && accessOf(viewer, calendar);
    });
    const visible = target.id === viewer.id || shared || (settings.get('calendar.freebusy') && prefsOf(target).calendar.freebusy);
    return {
      userId: target.id,
      name: target.name,
      initials: initials(target.name),
      visible,
      workStart: prefsOf(target).calendar.workStart,
      workEnd: prefsOf(target).calendar.workEnd,
      zone: zoneOf(target),
      busy: visible
        ? busyIntervals(target.id, from, to).map((entry) => ({ start: entry.start, end: entry.end, allDay: entry.allDay }))
        : [],
    };
  });
}

export function suggestTimes(
  viewer: UserRow,
  userIds: number[],
  options: { from: number; to: number; duration: number; dayStart: number; dayEnd: number; workdays: boolean }
) {
  const zone = zoneOf(viewer);
  const people = freebusyFor(viewer, [...new Set([viewer.id, ...userIds])], options.from, options.to);
  const busy = people.flatMap((person) => person.busy.filter((entry) => !entry.allDay));
  const out: { start: number; end: number }[] = [];
  const step = 15 * 60_000;
  const duration = Math.max(15, Math.min(8 * 60, options.duration)) * 60_000;
  let day = localKey(Math.max(options.from, Date.now()), zone);
  const last = localKey(options.to, zone);
  for (let guard = 0; guard < 62 && day <= last && out.length < 12; guard++, day = addDays(day, 1)) {
    const weekday = weekdayOf(day);
    if (options.workdays && (weekday === 0 || weekday === 6)) continue;
    for (let start = atMinute(day, options.dayStart, zone); start + duration <= atMinute(day, options.dayEnd, zone); start += step) {
      if (start < Date.now()) continue;
      const end = start + duration;
      if (busy.some((entry) => entry.start < end && entry.end > start)) continue;
      out.push({ start, end });
      start += duration - step;
      if (out.length >= 12) break;
    }
  }
  return { people, suggestions: out };
}

export interface TemplateRow {
  id: string;
  user_id: number;
  name: string;
  data: string;
  position: number;
  created_at: number;
}

export const listTemplates = (user: UserRow) =>
  all<TemplateRow>('SELECT * FROM event_templates WHERE user_id = ? ORDER BY position, created_at', user.id).map((row) => ({
    id: row.id,
    name: row.name,
    data: JSON.parse(row.data) as Record<string, unknown>,
  }));

export function saveTemplate(user: UserRow, name: string, data: Record<string, unknown>, id?: string) {
  const json = JSON.stringify(data);
  if (json.length > 50_000) throw badRequest('Die Vorlage ist zu groß');
  if (id) {
    if (
      run('UPDATE event_templates SET name = ?, data = ? WHERE id = ? AND user_id = ?', name.trim().slice(0, 80), json, id, user.id)
        .changes === 0
    ) {
      throw notFound('Diese Vorlage gibt es nicht');
    }
    return id;
  }
  if ((value<number>('SELECT COUNT(*) FROM event_templates WHERE user_id = ?', user.id) ?? 0) >= 100)
    throw badRequest('Du hast schon 100 Vorlagen');
  const created = randomId(16);
  const position = (value<number>('SELECT MAX(position) FROM event_templates WHERE user_id = ?', user.id) ?? -1) + 1;
  run(
    'INSERT INTO event_templates (id, user_id, name, data, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    created,
    user.id,
    name.trim().slice(0, 80) || 'Vorlage',
    json,
    position,
    Date.now()
  );
  return created;
}

export function deleteTemplate(user: UserRow, id: string) {
  if (run('DELETE FROM event_templates WHERE id = ? AND user_id = ?', id, user.id).changes === 0)
    throw notFound('Diese Vorlage gibt es nicht');
}

export const templateById = (user: UserRow, id: string) =>
  one<TemplateRow>('SELECT * FROM event_templates WHERE id = ? AND user_id = ?', id, user.id);

async function sendAgenda(user: UserRow, weekly: boolean, today: string) {
  const lang = preferredLanguage(user);
  const zone = zoneOf(user);
  const prefs = prefsOf(user).calendar;
  const firstDay = weekly ? startOfWeek(today, prefs.weekStart) : today;
  const days = weekly ? 7 : 1;
  const from = atMinute(firstDay, 0, zone);
  const to = atMinute(addDays(firstDay, days), 0, zone);
  const events = listOccurrences(user, { from, to, tasks: false }).filter(
    (entry) =>
      !entry.busyOnly &&
      entry.invitation !== 'DECLINED' &&
      entry.status !== 'CANCELLED' &&
      (entry.allDay ? entry.endDate! > firstDay && entry.startDate! < addDays(firstDay, days) : true)
  );
  const tasks = listTasks(user).filter((task) => !task.completed && task.due !== null && task.due < to);
  const holidays = holidaysBetween(firstDay, addDays(firstDay, days), prefs.holidays, false);
  if (!events.length && !tasks.length && !holidays.length && weekly === false) return false;
  const lines: string[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(firstDay, offset);
    const dayStart = atMinute(day, 0, zone);
    const dayEnd = atMinute(addDays(day, 1), 0, zone);
    const items = events.filter((entry) =>
      entry.allDay ? entry.startDate! <= day && entry.endDate! > day : entry.start < dayEnd && entry.end > dayStart
    );
    const free = holidays.filter((holiday) => holiday.date === day);
    if (weekly)
      lines.push(
        `${new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}`
      );
    for (const holiday of free) lines.push(`🎉 ${holiday.name[lang]}`);
    if (!items.length && !free.length) lines.push(weekly ? `  ${t(lang, 'Nichts geplant')}` : t(lang, 'Nichts geplant'));
    for (const entry of items) {
      const time = entry.allDay ? t(lang, 'Ganztägig') : `${formatClock(lang, entry.start, zone)}–${formatClock(lang, entry.end, zone)}`;
      lines.push(`${weekly ? '  ' : ''}${time}  ${entry.title || t(lang, '(Ohne Titel)')}${entry.location ? ` · ${entry.location}` : ''}`);
    }
  }
  if (tasks.length) {
    lines.push('', t(lang, 'Offene Aufgaben'));
    for (const task of tasks.slice(0, 15)) lines.push(`☐ ${task.title}${task.due && task.due < from ? ` (${t(lang, 'überfällig')})` : ''}`);
  }
  const title = weekly
    ? t(lang, 'Deine Woche ab {date}', {
        date: formatWhen(lang, Date.parse(`${firstDay}T00:00:00Z`), null, true, 'UTC').replace(/ \(.*\)$/, ''),
      })
    : t(lang, 'Dein Tag: {count} Termine', { count: events.length });
  await deliver(user.email!, {
    lang,
    title,
    lines,
    action: settings.get('site.url') ? { label: t(lang, 'Kalender öffnen'), url: absoluteUrl('/calendar') } : undefined,
    note: t(lang, 'Die Tagesübersicht stellst du in den Kalendereinstellungen ab.'),
  });
  return true;
}

export async function sendAgendas(now = Date.now()) {
  if (!mailReady()) return 0;
  let sent = 0;
  const users = all<UserRow>(`SELECT * FROM users WHERE email IS NOT NULL AND ${ACTIVE}`, now);
  for (const user of users) {
    const prefs = prefsOf(user);
    const calendar = prefs.calendar;
    if (calendar.agenda === 'off') continue;
    const zone = zoneOf(user);
    const today = todayKey(zone, now);
    if (calendar.agendaSent === today) continue;
    const clock = localClock(zone, now);
    if (clock.minutes < calendar.agendaTime || clock.minutes > calendar.agendaTime + 180) continue;
    if (calendar.agenda === 'weekly' && clock.weekday !== calendar.weekStart) continue;
    if (inQuiet(prefs, now)) continue;
    updateCalendarPrefs(user.id, { agendaSent: today });
    try {
      if (await sendAgenda(user, calendar.agenda === 'weekly', today)) sent++;
    } catch (error) {
      log.warn({ error: (error as Error).message, user: user.id }, 'Tagesübersicht konnte nicht verschickt werden');
    }
  }
  return sent;
}

export async function sendAgendaNow(user: UserRow, weekly: boolean) {
  if (!user.email) throw badRequest('Hinterlege zuerst eine E-Mail-Adresse in deinem Konto');
  if (!mailReady()) throw badRequest('Der Server kann keine E-Mails verschicken');
  await sendAgenda(user, weekly, todayKey(zoneOf(user)));
}
