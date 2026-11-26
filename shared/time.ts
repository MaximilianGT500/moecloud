export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const BUCKET = 15 * MINUTE;

function formatter(zone: string) {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    });
    formatters.set(zone, found);
  }
  return found;
}

const valid = new Map<string, boolean>();

export function isZone(zone: unknown): boolean {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  let known = valid.get(zone);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      known = true;
    } catch {
      known = false;
    }
    valid.set(zone, known);
  }
  return known;
}

export function zoneOr(zone: string | null | undefined, fallback: string) {
  return zone && isZone(zone) ? zone : fallback;
}

function computeOffset(utc: number, zone: string) {
  const parts = formatter(zone).formatToParts(new Date(utc));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let bc = false;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
    else if (part.type === 'era') bc = /^B/i.test(part.value);
  }
  if (bc) year = 1 - year;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const exact = Math.floor(utc / 1000) * 1000;
  return Math.round((local - exact) / MINUTE);
}

export function offsetOf(utc: number, zone: string): number {
  if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return 0;
  const key = `${zone}|${Math.floor(utc / BUCKET)}`;
  let found = offsets.get(key);
  if (found === undefined) {
    found = computeOffset(utc, zone);
    if (offsets.size > 200_000) offsets.clear();
    offsets.set(key, found);
  }
  return found;
}

export function wallOf(utc: number, zone: string): Wall {
  const shifted = new Date(utc + offsetOf(utc, zone) * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

const sameWall = (a: Wall, b: Wall) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;

export function utcOf(wall: Wall, zone: string): number {
  const local = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return local;
  const before = offsetOf(local - DAY, zone);
  const after = offsetOf(local + DAY, zone);
  const first = local - before * MINUTE;
  if (before === after) return first;
  const second = local - after * MINUTE;
  const firstFits = sameWall(wallOf(first, zone), wall);
  const secondFits = sameWall(wallOf(second, zone), wall);
  if (firstFits && secondFits) return Math.min(first, second);
  if (firstFits) return first;
  if (secondFits) return second;
  return first;
}

export const pad = (value: number, size = 2) => String(value).padStart(size, '0');

export const dateKey = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export function parseKey(key: string): DateParts {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(key);
  if (!match) throw new Error(`Ungültiges Datum: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseKey(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export const dayNumber = (year: number, month: number, day: number) => Math.round(Date.UTC(year, month - 1, day) / DAY);

export const dayOfKey = (key: string) => {
  const { year, month, day } = parseKey(key);
  return dayNumber(year, month, day);
};

export function keyOfDay(day: number) {
  const date = new Date(day * DAY);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function partsOfDay(day: number): DateParts {
  const date = new Date(day * DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export const weekdayOfDay = (day: number) => (((day + 4) % 7) + 7) % 7;

export const weekdayOf = (key: string) => weekdayOfDay(dayOfKey(key));

export const addDays = (key: string, days: number) => keyOfDay(dayOfKey(key) + days);

export const diffDays = (a: string, b: string) => dayOfKey(b) - dayOfKey(a);

export function addMonths(key: string, months: number) {
  const { year, month, day } = parseKey(key);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return dateKey(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

export const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export const daysInYear = (year: number) => (isLeap(year) ? 366 : 365);

export function startOfWeek(key: string, weekStart: number) {
  const weekday = weekdayOf(key);
  return addDays(key, -((weekday - weekStart + 7) % 7));
}

export const startOfMonth = (key: string) => key.slice(0, 8) + '01';

export function isoWeek(key: string) {
  const day = dayOfKey(key);
  const weekday = (weekdayOfDay(day) + 6) % 7;
  const thursday = day - weekday + 3;
  const year = partsOfDay(thursday).year;
  const firstThursday = dayNumber(year, 1, 4) - ((weekdayOfDay(dayNumber(year, 1, 4)) + 6) % 7) + 3;
  return { year, week: 1 + Math.round((thursday - firstThursday) / 7) };
}

export const localKey = (utc: number, zone: string) => {
  const wall = wallOf(utc, zone);
  return dateKey(wall.year, wall.month, wall.day);
};

export function minuteOfDay(utc: number, zone: string) {
  const wall = wallOf(utc, zone);
  return wall.hour * 60 + wall.minute + wall.second / 60;
}

export function startOfDay(key: string, zone: string) {
  const { year, month, day } = parseKey(key);
  return utcOf({ year, month, day, hour: 0, minute: 0, second: 0 }, zone);
}

export function atMinute(key: string, minutes: number, zone: string) {
  const { year, month, day } = parseKey(key);
  const whole = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  if (whole === 24 * 60) return startOfDay(addDays(key, 1), zone);
  return utcOf({ year, month, day, hour: Math.floor(whole / 60), minute: whole % 60, second: 0 }, zone);
}

export const todayKey = (zone: string, now = Date.now()) => localKey(now, zone);

export function utcKey(utc: number) {
  const date = new Date(utc);
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(
    date.getUTCMinutes()
  )}${pad(date.getUTCSeconds())}Z`;
}

export const compactKey = (key: string) => key.replace(/-/g, '');

export function expandKey(compact: string) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function parseUtcKey(value: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

export const clockText = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.round(minutes % 60))}`;

export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

export function zoneOffsetLabel(zone: string, utc = Date.now()) {
  const offset = offsetOf(utc, zone);
  const sign = offset < 0 ? '−' : '+';
  const absolute = Math.abs(offset);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function zoneLabel(zone: string, utc = Date.now()) {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  return `${zone.replace(/_/g, ' ')} (${zoneOffsetLabel(zone, utc)})`;
}

export function supportedZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.('timeZone') ?? [];
    if (list.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {}
  return [
    'UTC',
    'Europe/Berlin',
    'Europe/Vienna',
    'Europe/Zurich',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
  ];
}
