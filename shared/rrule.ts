import {
  DAY,
  dateKey,
  dayNumber,
  dayOfKey,
  daysInMonth,
  daysInYear,
  keyOfDay,
  parseKey,
  partsOfDay,
  utcKey,
  utcOf,
  wallOf,
  weekdayOfDay,
  compactKey,
} from './time.ts';

export type Freq = 'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export const FREQS: Freq[] = ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface WeekdayNum {
  day: number;
  nth: number;
}

export interface Rule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: string | null;
  byDay: WeekdayNum[];
  byMonthDay: number[];
  byMonth: number[];
  byYearDay: number[];
  byWeekNo: number[];
  bySetPos: number[];
  byHour: number[];
  byMinute: number[];
  bySecond: number[];
  wkst: number;
}

export interface SeriesStart {
  date: string;
  seconds: number;
  allDay: boolean;
  zone: string;
}

export interface Series {
  start: SeriesStart;
  rule: Rule | null;
  rdates: number[];
  exdates: Set<string>;
}

export interface Occurrence {
  key: string;
  start: number;
  date: string;
}

export const emptyRule = (freq: Freq): Rule => ({
  freq,
  interval: 1,
  count: null,
  until: null,
  byDay: [],
  byMonthDay: [],
  byMonth: [],
  byYearDay: [],
  byWeekNo: [],
  bySetPos: [],
  byHour: [],
  byMinute: [],
  bySecond: [],
  wkst: 1,
});

function numbers(value: string, min: number, max: number, allowNegative: boolean) {
  const out: number[] = [];
  for (const part of value.split(',')) {
    const number = Number(part.trim());
    if (!Number.isInteger(number)) return null;
    if (number === 0 && min > 0) return null;
    if (Math.abs(number) > max || (!allowNegative && number < min)) return null;
    out.push(number);
  }
  return out;
}

export function parseWeekday(value: string): WeekdayNum | null {
  const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(value.trim());
  if (!match) return null;
  const nth = match[1] ? Number(match[1]) : 0;
  if (Math.abs(nth) > 53) return null;
  return { day: WEEKDAYS.indexOf(match[2].toUpperCase() as (typeof WEEKDAYS)[number]), nth };
}

export function parseRule(text: string | null | undefined): Rule | null {
  if (!text) return null;
  const rule = emptyRule('DAILY');
  let freq: Freq | null = null;
  for (const part of text
    .replace(/^RRULE:/i, '')
    .trim()
    .split(';')) {
    if (!part) continue;
    const index = part.indexOf('=');
    if (index < 1) return null;
    const key = part.slice(0, index).trim().toUpperCase();
    const value = part.slice(index + 1).trim();
    switch (key) {
      case 'FREQ': {
        const upper = value.toUpperCase() as Freq;
        if (!FREQS.includes(upper)) return null;
        freq = upper;
        break;
      }
      case 'INTERVAL': {
        const interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1 || interval > 10_000) return null;
        rule.interval = interval;
        break;
      }
      case 'COUNT': {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) return null;
        rule.count = Math.min(count, 100_000);
        break;
      }
      case 'UNTIL':
        if (!/^\d{8}(T\d{6}Z?)?$/i.test(value)) return null;
        rule.until = value.toUpperCase();
        break;
      case 'BYDAY': {
        const days = value.split(',').map(parseWeekday);
        if (days.some((day) => !day)) return null;
        rule.byDay = days as WeekdayNum[];
        break;
      }
      case 'BYMONTHDAY': {
        const list = numbers(value, 1, 31, true);
        if (!list) return null;
        rule.byMonthDay = list;
        break;
      }
      case 'BYMONTH': {
        const list = numbers(value, 1, 12, false);
        if (!list) return null;
        rule.byMonth = list;
        break;
      }
      case 'BYYEARDAY': {
        const list = numbers(value, 1, 366, true);
        if (!list) return null;
        rule.byYearDay = list;
        break;
      }
      case 'BYWEEKNO': {
        const list = numbers(value, 1, 53, true);
        if (!list) return null;
        rule.byWeekNo = list;
        break;
      }
      case 'BYSETPOS': {
        const list = numbers(value, 1, 366, true);
        if (!list) return null;
        rule.bySetPos = list;
        break;
      }
      case 'BYHOUR': {
        const list = numbers(value, 0, 23, false);
        if (!list) return null;
        rule.byHour = list;
        break;
      }
      case 'BYMINUTE': {
        const list = numbers(value, 0, 59, false);
        if (!list) return null;
        rule.byMinute = list;
        break;
      }
      case 'BYSECOND': {
        const list = numbers(value, 0, 60, false);
        if (!list) return null;
        rule.bySecond = list;
        break;
      }
      case 'WKST': {
        const index = WEEKDAYS.indexOf(value.toUpperCase() as (typeof WEEKDAYS)[number]);
        if (index < 0) return null;
        rule.wkst = index;
        break;
      }
      default:
        break;
    }
  }
  if (!freq) return null;
  rule.freq = freq;
  return rule;
}

const weekdayText = (value: WeekdayNum) => `${value.nth ? value.nth : ''}${WEEKDAYS[value.day]}`;

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${rule.until}`);
  if (rule.bySecond.length) parts.push(`BYSECOND=${rule.bySecond.join(',')}`);
  if (rule.byMinute.length) parts.push(`BYMINUTE=${rule.byMinute.join(',')}`);
  if (rule.byHour.length) parts.push(`BYHOUR=${rule.byHour.join(',')}`);
  if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.map(weekdayText).join(',')}`);
  if (rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byYearDay.length) parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`);
  if (rule.byWeekNo.length) parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`);
  if (rule.byMonth.length) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.bySetPos.length) parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
  if (rule.wkst !== 1) parts.push(`WKST=${WEEKDAYS[rule.wkst]}`);
  return parts.join(';');
}

type Candidate = [number, number];

const compare = (a: Candidate, b: Candidate) => a[0] - b[0] || a[1] - b[1];

interface Limit {
  day: number;
  seconds: number;
  utc: number | null;
}

function untilLimit(until: string, start: SeriesStart): Limit {
  const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const day = dayOfKey(date);
  if (until.length === 8) return { day, seconds: 86_399, utc: null };
  const seconds = Number(until.slice(9, 11)) * 3600 + Number(until.slice(11, 13)) * 60 + Number(until.slice(13, 15));
  if (!until.endsWith('Z')) return { day, seconds, utc: null };
  const utc = Date.UTC(Number(until.slice(0, 4)), Number(until.slice(4, 6)) - 1, Number(until.slice(6, 8))) + seconds * 1000;
  if (start.allDay) return { day, seconds: 86_399, utc: null };
  const wall = wallOf(utc, start.zone);
  return { day: dayNumber(wall.year, wall.month, wall.day), seconds: wall.hour * 3600 + wall.minute * 60 + wall.second, utc };
}

function times(rule: Rule, base: number): number[] {
  const hours = rule.byHour.length ? rule.byHour : [Math.floor(base / 3600)];
  const minutes = rule.byMinute.length ? rule.byMinute : [Math.floor((base % 3600) / 60)];
  const seconds = rule.bySecond.length ? rule.bySecond : [base % 60];
  const out: number[] = [];
  for (const hour of hours)
    for (const minute of minutes) for (const second of seconds) out.push(hour * 3600 + minute * 60 + Math.min(59, second));
  return out.sort((a, b) => a - b);
}

const monthDaysOf = (year: number, month: number, list: number[]) => {
  const total = daysInMonth(year, month);
  const out: number[] = [];
  for (const value of list) {
    const day = value > 0 ? value : total + value + 1;
    if (day >= 1 && day <= total) out.push(dayNumber(year, month, day));
  }
  return out;
};

function weekdaysIn(first: number, last: number, weekday: WeekdayNum): number[] {
  const offset = (weekday.day - weekdayOfDay(first) + 7) % 7;
  const all: number[] = [];
  for (let day = first + offset; day <= last; day += 7) all.push(day);
  if (!weekday.nth) return all;
  const index = weekday.nth > 0 ? weekday.nth - 1 : all.length + weekday.nth;
  return index >= 0 && index < all.length ? [all[index]] : [];
}

function weekNumberStart(year: number, week: number, wkst: number) {
  const jan4 = dayNumber(year, 1, 4);
  const firstWeek = jan4 - ((weekdayOfDay(jan4) - wkst + 7) % 7);
  const weeks = Math.round((weekNumberEnd(year, wkst) - firstWeek) / 7);
  const index = week > 0 ? week - 1 : weeks + week;
  return firstWeek + index * 7;
}

function weekNumberEnd(year: number, wkst: number) {
  const next = dayNumber(year + 1, 1, 4);
  return next - ((weekdayOfDay(next) - wkst + 7) % 7);
}

function filterDays(days: number[], rule: Rule, checkDay: boolean, checkMonthDay: boolean) {
  return days.filter((day) => {
    const parts = partsOfDay(day);
    if (rule.byMonth.length && !rule.byMonth.includes(parts.month)) return false;
    if (checkMonthDay && rule.byMonthDay.length) {
      const total = daysInMonth(parts.year, parts.month);
      if (!rule.byMonthDay.some((value) => (value > 0 ? value : total + value + 1) === parts.day)) return false;
    }
    if (checkDay && rule.byDay.length && !rule.byDay.some((weekday) => weekday.day === weekdayOfDay(day))) return false;
    if (rule.byYearDay.length) {
      const first = dayNumber(parts.year, 1, 1);
      const total = daysInYear(parts.year);
      if (!rule.byYearDay.some((value) => first + (value > 0 ? value - 1 : total + value) === day)) return false;
    }
    return true;
  });
}

function periodDays(rule: Rule, startDay: number, index: number): number[] {
  const start = partsOfDay(startDay);
  switch (rule.freq) {
    case 'DAILY': {
      const day = startDay + index * rule.interval;
      return filterDays([day], rule, true, true);
    }
    case 'WEEKLY': {
      const weekStart = startDay - ((weekdayOfDay(startDay) - rule.wkst + 7) % 7) + index * 7 * rule.interval;
      const weekdays = rule.byDay.length ? [...new Set(rule.byDay.map((value) => value.day))] : [weekdayOfDay(startDay)];
      const days = weekdays.map((weekday) => weekStart + ((weekday - rule.wkst + 7) % 7)).sort((a, b) => a - b);
      return filterDays(days, rule, false, true);
    }
    case 'MONTHLY': {
      const total = start.year * 12 + start.month - 1 + index * rule.interval;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      if (rule.byMonth.length && !rule.byMonth.includes(month)) return [];
      const first = dayNumber(year, month, 1);
      const last = first + daysInMonth(year, month) - 1;
      let days: number[];
      if (rule.byMonthDay.length) {
        days = monthDaysOf(year, month, rule.byMonthDay);
        if (rule.byDay.length) days = days.filter((day) => rule.byDay.some((weekday) => weekday.day === weekdayOfDay(day)));
      } else if (rule.byDay.length) {
        days = rule.byDay.flatMap((weekday) => weekdaysIn(first, last, weekday));
      } else {
        days = start.day <= daysInMonth(year, month) ? [dayNumber(year, month, start.day)] : [];
      }
      return filterDays(
        [...new Set(days)].sort((a, b) => a - b),
        rule,
        false,
        false
      );
    }
    case 'YEARLY': {
      const year = start.year + index * rule.interval;
      const first = dayNumber(year, 1, 1);
      const last = first + daysInYear(year) - 1;
      let days: number[] = [];
      if (rule.byYearDay.length) {
        const total = daysInYear(year);
        days = rule.byYearDay.map((value) => first + (value > 0 ? value - 1 : total + value)).filter((day) => day >= first && day <= last);
        days = filterDays(days, { ...rule, byYearDay: [] }, true, true);
      } else if (rule.byWeekNo.length) {
        const weekdays = rule.byDay.length ? rule.byDay.map((value) => value.day) : [weekdayOfDay(startDay)];
        for (const week of rule.byWeekNo) {
          const begin = weekNumberStart(year, week, rule.wkst);
          for (const weekday of weekdays) days.push(begin + ((weekday - rule.wkst + 7) % 7));
        }
        days = filterDays(days, { ...rule, byDay: [] }, false, true);
      } else {
        const months = rule.byMonth.length ? rule.byMonth : null;
        if (rule.byMonthDay.length) {
          for (const month of months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
            let list = monthDaysOf(year, month, rule.byMonthDay);
            if (rule.byDay.length) list = list.filter((day) => rule.byDay.some((weekday) => weekday.day === weekdayOfDay(day)));
            days.push(...list);
          }
        } else if (rule.byDay.length) {
          if (months) {
            for (const month of months) {
              const monthFirst = dayNumber(year, month, 1);
              const monthLast = monthFirst + daysInMonth(year, month) - 1;
              for (const weekday of rule.byDay) days.push(...weekdaysIn(monthFirst, monthLast, weekday));
            }
          } else {
            for (const weekday of rule.byDay) days.push(...weekdaysIn(first, last, weekday));
          }
        } else {
          for (const month of months ?? [start.month]) {
            if (start.day <= daysInMonth(year, month)) days.push(dayNumber(year, month, start.day));
          }
        }
      }
      return [...new Set(days)].sort((a, b) => a - b);
    }
    default:
      return [];
  }
}

function applySetPos(candidates: Candidate[], positions: number[]) {
  if (!positions.length) return candidates;
  const out: Candidate[] = [];
  for (const position of positions) {
    const index = position > 0 ? position - 1 : candidates.length + position;
    if (index >= 0 && index < candidates.length) out.push(candidates[index]);
  }
  return out.sort(compare);
}

const MAX_PERIODS = 120_000;

function firstUsefulIndex(rule: Rule, startDay: number, fromDay: number) {
  if (rule.count || fromDay <= startDay) return 0;
  const span = fromDay - startDay;
  switch (rule.freq) {
    case 'DAILY':
      return Math.max(0, Math.floor(span / rule.interval) - 1);
    case 'WEEKLY':
      return Math.max(0, Math.floor(span / (7 * rule.interval)) - 1);
    case 'MONTHLY':
      return Math.max(0, Math.floor(span / (31 * rule.interval)) - 1);
    case 'YEARLY':
      return Math.max(0, Math.floor(span / (366 * rule.interval)) - 1);
    default:
      return 0;
  }
}

function utcFor(start: SeriesStart, day: number, seconds: number) {
  if (start.allDay) return day * DAY;
  const parts = partsOfDay(day);
  return utcOf(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(seconds / 3600),
      minute: Math.floor((seconds % 3600) / 60),
      second: seconds % 60,
    },
    start.zone
  );
}

export function occurrenceKey(start: SeriesStart, utc: number) {
  return start.allDay ? compactKey(keyOfDay(Math.floor(utc / DAY))) : utcKey(utc);
}

function makeOccurrence(start: SeriesStart, day: number, seconds: number): Occurrence {
  const utc = utcFor(start, day, seconds);
  return { key: start.allDay ? compactKey(keyOfDay(day)) : utcKey(utc), start: utc, date: keyOfDay(day) };
}

function subDaily(series: Series, fromUtc: number, toUtc: number, visit: (occurrence: Occurrence) => boolean) {
  const rule = series.rule!;
  const start = series.start;
  const first = utcFor(start, dayOfKey(start.date), start.seconds);
  const step = (rule.freq === 'HOURLY' ? 3_600_000 : rule.freq === 'MINUTELY' ? 60_000 : 1000) * rule.interval;
  const limit = rule.until ? untilLimit(rule.until, start) : null;
  const limitUtc = limit ? (limit.utc ?? utcFor(start, limit.day, limit.seconds)) : Infinity;
  let count = 0;
  let index = rule.count ? 0 : Math.max(0, Math.floor((fromUtc - first) / step) - 1);
  for (let guard = 0; guard < MAX_PERIODS * 10; guard++, index++) {
    const utc = first + index * step;
    if (utc > limitUtc || (!rule.count && utc >= toUtc)) return;
    const wall = wallOf(utc, start.zone);
    const day = dayNumber(wall.year, wall.month, wall.day);
    if (rule.byMonth.length && !rule.byMonth.includes(wall.month)) continue;
    if (rule.byDay.length && !rule.byDay.some((weekday) => weekday.day === weekdayOfDay(day))) continue;
    if (rule.byMonthDay.length && !filterDays([day], { ...rule, byDay: [], byMonth: [] }, false, true).length) continue;
    if (rule.byHour.length && !rule.byHour.includes(wall.hour)) continue;
    if (rule.byMinute.length && !rule.byMinute.includes(wall.minute)) continue;
    count++;
    if (rule.count && count > rule.count) return;
    if (utc >= toUtc) return;
    const occurrence = { key: utcKey(utc), start: utc, date: keyOfDay(day) };
    if (!visit(occurrence)) return;
  }
}

export function iterate(series: Series, fromUtc: number, toUtc: number, visit: (occurrence: Occurrence) => boolean) {
  const start = series.start;
  const startDay = dayOfKey(start.date);
  const extras = [...series.rdates].sort((a, b) => a - b);
  let extraIndex = 0;
  const seen = new Set<string>();
  const emit = (occurrence: Occurrence) => {
    while (extraIndex < extras.length && extras[extraIndex] < occurrence.start) {
      const value = extras[extraIndex++];
      const extra = rdateOccurrence(start, value);
      if (!seen.has(extra.key)) {
        seen.add(extra.key);
        if (!series.exdates.has(extra.key) && !visit(extra)) return false;
      }
    }
    if (seen.has(occurrence.key)) return true;
    seen.add(occurrence.key);
    if (series.exdates.has(occurrence.key)) return true;
    return visit(occurrence);
  };
  const flush = () => {
    while (extraIndex < extras.length && extras[extraIndex] < toUtc) {
      const extra = rdateOccurrence(start, extras[extraIndex++]);
      if (seen.has(extra.key)) continue;
      seen.add(extra.key);
      if (!series.exdates.has(extra.key) && !visit(extra)) return;
    }
  };
  const rule = series.rule;
  const first = makeOccurrence(start, startDay, start.seconds);
  if (!rule) {
    if (emit(first)) flush();
    return;
  }
  if (rule.freq === 'HOURLY' || rule.freq === 'MINUTELY' || rule.freq === 'SECONDLY') {
    let stopped = false;
    subDaily(series, fromUtc, toUtc, (occurrence) => {
      if (!emit(occurrence)) {
        stopped = true;
        return false;
      }
      return true;
    });
    if (!stopped) flush();
    return;
  }
  const limit = rule.until ? untilLimit(rule.until, start) : null;
  const fromDay = Math.floor(fromUtc / DAY) - 2;
  const toDay = Math.ceil(toUtc / DAY) + 2;
  const startCandidate: Candidate = [startDay, start.seconds];
  let count = 1;
  if (!emit(first)) return;
  const dayTimes = start.allDay ? [0] : times(rule, start.seconds);
  for (let index = firstUsefulIndex(rule, startDay, fromDay), periods = 0; periods < MAX_PERIODS; index++, periods++) {
    const days = periodDays(rule, startDay, index);
    if (!days.length) {
      if (periodStart(rule, startDay, index) > toDay + 400 && !rule.count) break;
      if (periodStart(rule, startDay, index) > dayNumber(2400, 1, 1)) break;
      continue;
    }
    let candidates: Candidate[] = [];
    for (const day of days) for (const seconds of dayTimes) candidates.push([day, seconds]);
    candidates = applySetPos(candidates, rule.bySetPos);
    for (const candidate of candidates) {
      if (compare(candidate, startCandidate) <= 0) continue;
      if (limit && (candidate[0] > limit.day || (candidate[0] === limit.day && candidate[1] > limit.seconds))) {
        flush();
        return;
      }
      count++;
      if (rule.count && count > rule.count) {
        flush();
        return;
      }
      if (candidate[0] > toDay) {
        flush();
        return;
      }
      if (candidate[0] < fromDay) continue;
      if (!emit(makeOccurrence(start, candidate[0], candidate[1]))) return;
    }
    if (days[0] > dayNumber(2400, 1, 1)) break;
  }
  flush();
}

function periodStart(rule: Rule, startDay: number, index: number) {
  const span = rule.freq === 'DAILY' ? 1 : rule.freq === 'WEEKLY' ? 7 : rule.freq === 'MONTHLY' ? 30 : 365;
  return startDay + index * rule.interval * span;
}

function rdateOccurrence(start: SeriesStart, value: number): Occurrence {
  if (start.allDay) {
    const day = Math.floor(value / DAY);
    return { key: compactKey(keyOfDay(day)), start: day * DAY, date: keyOfDay(day) };
  }
  const wall = wallOf(value, start.zone);
  return { key: utcKey(value), start: value, date: dateKey(wall.year, wall.month, wall.day) };
}

export function expand(series: Series, fromUtc: number, toUtc: number, limit = 5000): Occurrence[] {
  const out: Occurrence[] = [];
  iterate(series, fromUtc, toUtc, (occurrence) => {
    if (occurrence.start >= toUtc) return false;
    if (occurrence.start >= fromUtc) out.push(occurrence);
    return out.length < limit;
  });
  return out;
}

export function nextOccurrence(series: Series, afterUtc: number, horizon = 400 * DAY): Occurrence | null {
  let found: Occurrence | null = null;
  iterate(series, afterUtc, afterUtc + horizon, (occurrence) => {
    if (occurrence.start > afterUtc) {
      found = occurrence;
      return false;
    }
    return true;
  });
  return found;
}

export function lastOccurrence(series: Series): Occurrence | null {
  const rule = series.rule;
  if (rule && !rule.count && !rule.until) return null;
  let last: Occurrence | null = null;
  let seen = 0;
  iterate(series, -Infinity, dayNumber(2400, 1, 1) * DAY, (occurrence) => {
    last = occurrence;
    seen++;
    return seen < 200_000;
  });
  return last;
}

export function isRecurring(series: Series) {
  return Boolean(series.rule) || series.rdates.length > 0;
}

export function untilFromBefore(start: SeriesStart, occurrenceStart: number) {
  if (start.allDay) {
    const day = Math.floor(occurrenceStart / DAY) - 1;
    return compactKey(keyOfDay(day));
  }
  return utcKey(occurrenceStart - 1000);
}

export function startOfSeries(start: SeriesStart) {
  return utcFor(start, dayOfKey(start.date), start.seconds);
}

export function seriesStartFromUtc(utc: number, zone: string, allDay: boolean): SeriesStart {
  if (allDay) return { date: keyOfDay(Math.floor(utc / DAY)), seconds: 0, allDay: true, zone: 'UTC' };
  const wall = wallOf(utc, zone);
  return {
    date: dateKey(wall.year, wall.month, wall.day),
    seconds: wall.hour * 3600 + wall.minute * 60 + wall.second,
    allDay: false,
    zone,
  };
}

export function parseDateValue(value: string) {
  const { year, month, day } = parseKey(value);
  return dayNumber(year, month, day);
}

type Translate = (text: string, params?: Record<string, string | number>) => string;

export function describeRule(rule: Rule, startDate: string, tr: Translate, locale: string): string {
  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day)));
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, month - 1, 1)));
  const english = locale.toLowerCase().startsWith('en');
  const number = (value: number) => {
    if (!english) return tr('{n}.', { n: value });
    const rule = new Intl.PluralRules('en', { type: 'ordinal' }).select(value);
    return `${value}${rule === 'one' ? 'st' : rule === 'two' ? 'nd' : rule === 'few' ? 'rd' : 'th'}`;
  };
  const dayMonth = (day: number, month: number) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, month - 1, day)));
  const ordinal = (nth: number) => (nth === -1 ? tr('letzten') : nth === -2 ? tr('vorletzten') : number(nth));
  const list = (items: string[]) => {
    if (items.length <= 1) return items.join('');
    return tr('{list} und {last}', { list: items.slice(0, -1).join(', '), last: items[items.length - 1] });
  };
  const start = parseKey(startDate);
  const n = rule.interval;
  let text = '';
  const weekdays = rule.byDay.filter((value) => !value.nth).map((value) => value.day);
  const workdays = weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => weekdays.includes(day));
  switch (rule.freq) {
    case 'DAILY':
      text = n === 1 ? tr('Täglich') : tr('Alle {n} Tage', { n });
      if (weekdays.length) text = workdays ? tr('Jeden Werktag') : tr('Täglich am {days}', { days: list(weekdays.map(weekdayName)) });
      break;
    case 'WEEKLY': {
      const days = weekdays.length ? weekdays : [weekdayOfDay(dayNumber(start.year, start.month, start.day))];
      if (workdays && n === 1) text = tr('Jeden Werktag');
      else if (days.length === 7 && n === 1) text = tr('Täglich');
      else
        text =
          n === 1
            ? tr('Jede Woche am {days}', { days: list(days.map(weekdayName)) })
            : tr('Alle {n} Wochen am {days}', { n, days: list(days.map(weekdayName)) });
      break;
    }
    case 'MONTHLY': {
      const prefix = n === 1 ? tr('Jeden Monat') : tr('Alle {n} Monate', { n });
      if (rule.byDay.length && rule.byDay[0].nth) {
        text = tr('{prefix} am {nth} {day}', { prefix, nth: ordinal(rule.byDay[0].nth), day: weekdayName(rule.byDay[0].day) });
      } else if (rule.byDay.length && rule.bySetPos.length) {
        text = tr('{prefix} am {nth} {day}', {
          prefix,
          nth: ordinal(rule.bySetPos[0]),
          day: workdays ? tr('Werktag') : list(rule.byDay.map((value) => weekdayName(value.day))),
        });
      } else if (rule.byMonthDay.length) {
        const days = rule.byMonthDay.map((day) => (day === -1 ? tr('letzten Tag') : number(day)));
        text = tr('{prefix} am {days}', { prefix, days: list(days) });
      } else {
        text = tr('{prefix} am {days}', { prefix, days: number(start.day) });
      }
      break;
    }
    case 'YEARLY': {
      const prefix = n === 1 ? tr('Jedes Jahr') : tr('Alle {n} Jahre', { n });
      const month = rule.byMonth[0] ?? start.month;
      if (rule.byDay.length && rule.byDay[0].nth) {
        text = tr('{prefix} am {nth} {day} im {month}', {
          prefix,
          nth: ordinal(rule.byDay[0].nth),
          day: weekdayName(rule.byDay[0].day),
          month: monthName(month),
        });
      } else {
        const day = rule.byMonthDay[0] ?? start.day;
        text = tr('{prefix} am {date}', { prefix, date: dayMonth(day, month) });
      }
      break;
    }
    case 'HOURLY':
      text = n === 1 ? tr('Stündlich') : tr('Alle {n} Stunden', { n });
      break;
    case 'MINUTELY':
      text = n === 1 ? tr('Jede Minute') : tr('Alle {n} Minuten', { n });
      break;
    default:
      text = tr('Regelmäßig');
  }
  if (rule.count) text += `, ${rule.count === 1 ? tr('einmal') : tr('{n}-mal', { n: rule.count })}`;
  else if (rule.until) {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(rule.until.slice(0, 4)), Number(rule.until.slice(4, 6)) - 1, Number(rule.until.slice(6, 8))))
    );
    text += `, ${tr('bis {date}', { date })}`;
  }
  return text;
}
