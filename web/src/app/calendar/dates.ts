import {
  DAY,
  addDays,
  addMonths,
  atMinute,
  dateKey,
  dayOfKey,
  isoWeek,
  localKey,
  minuteOfDay,
  parseKey,
  startOfMonth,
  startOfWeek,
  todayKey,
  weekdayOf,
  wallOf,
} from '../../../../shared/time';
import { boot } from '../../lib/boot';
import { locale, t } from '../../lib/i18n';
import type { View } from './model';

const browserZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

let displayZone = boot().user?.zone || browserZone;

export const getZone = () => displayZone;
export const deviceZone = () => browserZone;
export const setZone = (zone: string) => {
  displayZone = zone;
};

export const today = () => todayKey(displayZone);
export const keyOf = (utc: number) => localKey(utc, displayZone);
export const minuteOf = (utc: number) => minuteOfDay(utc, displayZone);
export const at = (key: string, minutes: number) => atMinute(key, minutes, displayZone);
export const dayStart = (key: string) => atMinute(key, 0, displayZone);

const cache = new Map<string, Intl.DateTimeFormat>();

function format(options: Intl.DateTimeFormatOptions, zone = displayZone) {
  const key = `${zone}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
    cache.set(key, found);
  }
  return found;
}

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);

export const formatTime = (utc: number, zone = displayZone) => format({ hour: '2-digit', minute: '2-digit' }, zone).format(utc);

export function formatTimeShort(utc: number) {
  const wall = wallOf(utc, displayZone);
  if (locale.startsWith('de')) return wall.minute ? `${wall.hour}:${String(wall.minute).padStart(2, '0')}` : `${wall.hour}`;
  return format({ hour: 'numeric', minute: wall.minute ? '2-digit' : undefined })
    .format(utc)
    .replace(/\s/g, '')
    .toLowerCase();
}

export const formatClock = (minutes: number) => {
  const date = Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return format({ hour: '2-digit', minute: '2-digit' }, 'UTC').format(date);
};

export const formatHour = (hour: number) => {
  if (locale.startsWith('de')) return `${String(hour).padStart(2, '0')}:00`;
  return format({ hour: 'numeric' }, 'UTC').format(Date.UTC(2026, 0, 1, hour));
};

export const weekdayShort = (key: string) => format({ weekday: 'short' }, 'UTC').format(noon(key));
export const weekdayLong = (key: string) => format({ weekday: 'long' }, 'UTC').format(noon(key));
export const weekdayNarrow = (weekday: number) => format({ weekday: 'narrow' }, 'UTC').format(Date.UTC(2023, 0, 1 + weekday, 12));
export const weekdayName = (weekday: number, style: 'short' | 'long' = 'short') =>
  format({ weekday: style }, 'UTC').format(Date.UTC(2023, 0, 1 + weekday, 12));
export const dayNumber = (key: string) => parseKey(key).day;
export const monthName = (month: number, style: 'long' | 'short' = 'long') =>
  format({ month: style }, 'UTC').format(Date.UTC(2026, month - 1, 1, 12));
export const formatMonth = (key: string) => format({ month: 'long', year: 'numeric' }, 'UTC').format(noon(key));
export const formatDayLong = (key: string) =>
  format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, 'UTC').format(noon(key));
export const formatDayMedium = (key: string) => format({ weekday: 'short', day: 'numeric', month: 'short' }, 'UTC').format(noon(key));
export const formatDate = (key: string) => format({ day: 'numeric', month: 'long', year: 'numeric' }, 'UTC').format(noon(key));
export const formatDateShort = (key: string) => format({ day: 'numeric', month: 'short' }, 'UTC').format(noon(key));
export const formatDateTime = (utc: number) =>
  format({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(utc);

export function formatRangeTitle(from: string, to: string) {
  const last = addDays(to, -1);
  const a = parseKey(from);
  const b = parseKey(last);
  const german = locale.startsWith('de');
  if (from === last) return formatDayLong(from);
  if (a.year === b.year && a.month === b.month)
    return german ? `${a.day}.–${b.day}. ${monthName(a.month)} ${a.year}` : `${a.day}–${b.day} ${monthName(a.month)} ${a.year}`;
  if (a.year === b.year) return `${formatDateShort(from)} – ${formatDateShort(last)} ${a.year}`;
  return `${formatDate(from)} – ${formatDate(last)}`;
}

export function relativeDay(key: string) {
  const now = today();
  if (key === now) return t('Heute');
  if (key === addDays(now, 1)) return t('Morgen');
  if (key === addDays(now, -1)) return t('Gestern');
  return null;
}

export function formatSpan(start: number, end: number, allDay: boolean) {
  if (allDay) {
    const first = localKey(start, 'UTC');
    const last = addDays(localKey(end, 'UTC'), -1);
    if (last <= first) return formatDayLong(first);
    return `${formatDayMedium(first)} – ${formatDayMedium(last)}`;
  }
  const first = keyOf(start);
  const last = keyOf(Math.max(start, end - 1));
  if (first === last) return `${formatDayLong(first)} · ${formatTime(start)}–${formatTime(end)}`;
  return `${formatDayMedium(first)}, ${formatTime(start)} – ${formatDayMedium(last)}, ${formatTime(end)}`;
}

export function durationText(minutes: number) {
  if (minutes < 60) return t('{count} Min.', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return hours === 1 ? t('1 Std.') : t('{count} Std.', { count: hours });
  return t('{hours} Std. {minutes} Min.', { hours, minutes: rest });
}

export function alarmText(minutes: number, allDay: boolean) {
  if (allDay) {
    if (minutes <= 0) {
      const time = formatClock(-minutes);
      return t('Am selben Tag um {time}', { time });
    }
    const days = Math.ceil(minutes / 1440);
    const time = formatClock((days * 1440 - minutes) % 1440);
    return days === 1 ? t('Am Vortag um {time}', { time }) : t('{days} Tage vorher um {time}', { days, time });
  }
  if (minutes === 0) return t('Zu Beginn');
  if (minutes < 0) return t('{count} Min. danach', { count: -minutes });
  if (minutes < 60) return minutes === 1 ? t('1 Minute vorher') : t('{count} Minuten vorher', { count: minutes });
  if (minutes < 1440 && minutes % 60 === 0)
    return minutes === 60 ? t('1 Stunde vorher') : t('{count} Stunden vorher', { count: minutes / 60 });
  if (minutes % 10080 === 0) return minutes === 10080 ? t('1 Woche vorher') : t('{count} Wochen vorher', { count: minutes / 10080 });
  if (minutes % 1440 === 0) return minutes === 1440 ? t('1 Tag vorher') : t('{count} Tage vorher', { count: minutes / 1440 });
  return t('{count} Minuten vorher', { count: minutes });
}

export interface Range {
  from: string;
  to: string;
  days: string[];
}

export function visibleDays(view: View, date: string, weekStart: number, weekends: boolean, workDays: number[]): Range {
  if (view === 'day') return { from: date, to: addDays(date, 1), days: [date] };
  if (view === 'days3') return { from: date, to: addDays(date, 3), days: [date, addDays(date, 1), addDays(date, 2)] };
  if (view === 'week' || view === 'workweek') {
    const first = startOfWeek(date, weekStart);
    const all = Array.from({ length: 7 }, (_, index) => addDays(first, index));
    const work = workDays.length ? workDays : [1, 2, 3, 4, 5];
    const days =
      view === 'workweek'
        ? all.filter((day) => work.includes(weekdayOf(day)))
        : weekends
          ? all
          : all.filter((day) => ![0, 6].includes(weekdayOf(day)));
    return { from: first, to: addDays(first, 7), days: days.length ? days : all };
  }
  if (view === 'month') {
    const first = startOfWeek(startOfMonth(date), weekStart);
    const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
    return { from: first, to: addDays(first, 42), days };
  }
  if (view === 'year') {
    const year = parseKey(date).year;
    return { from: dateKey(year, 1, 1), to: dateKey(year + 1, 1, 1), days: [] };
  }
  return { from: date, to: addDays(date, 30), days: [] };
}

export function step(view: View, date: string, direction: number) {
  switch (view) {
    case 'day':
      return addDays(date, direction);
    case 'days3':
      return addDays(date, direction * 3);
    case 'week':
    case 'workweek':
      return addDays(date, direction * 7);
    case 'month':
      return addMonths(startOfMonth(date), direction);
    case 'year':
      return addMonths(date, direction * 12);
    case 'agenda':
      return addDays(date, direction * 14);
    default:
      return addDays(date, direction * 7);
  }
}

export function viewTitle(view: View, date: string, range: Range) {
  if (view === 'month') return formatMonth(date);
  if (view === 'year') return String(parseKey(date).year);
  if (view === 'day') return formatDayLong(date);
  if (view === 'agenda' || view === 'tasks') return formatMonth(date);
  return formatRangeTitle(range.days[0] ?? range.from, addDays(range.days[range.days.length - 1] ?? range.to, 1));
}

export const weekOf = (key: string) => isoWeek(key).week;

export { DAY, addDays, addMonths, dateKey, dayOfKey, parseKey, startOfMonth, startOfWeek, weekdayOf };
