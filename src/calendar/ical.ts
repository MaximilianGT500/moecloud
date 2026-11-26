import { DAY, dateKey, isZone, offsetOf, pad, parseKey, utcOf, wallOf, weekdayOfDay, dayNumber, daysInMonth } from '../../shared/time.ts';

export interface Property {
  name: string;
  params: Record<string, string[]>;
  value: string;
}

export interface Component {
  name: string;
  props: Property[];
  children: Component[];
}

export class ICalError extends Error {}

function unfold(text: string) {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseLine(line: string): Property | null {
  let index = 0;
  const nameMatch = /^[A-Za-z0-9-]+/.exec(line);
  if (!nameMatch) return null;
  const name = nameMatch[0].toUpperCase();
  index = name.length;
  const params: Record<string, string[]> = {};
  while (line[index] === ';') {
    index++;
    const keyMatch = /^[A-Za-z0-9-]+/.exec(line.slice(index));
    if (!keyMatch) return null;
    const key = keyMatch[0].toUpperCase();
    index += key.length;
    if (line[index] !== '=') return null;
    index++;
    const values: string[] = [];
    for (;;) {
      if (line[index] === '"') {
        const end = line.indexOf('"', index + 1);
        if (end < 0) return null;
        values.push(line.slice(index + 1, end));
        index = end + 1;
      } else {
        let end = index;
        while (end < line.length && line[end] !== ',' && line[end] !== ';' && line[end] !== ':') end++;
        values.push(line.slice(index, end));
        index = end;
      }
      if (line[index] === ',') {
        index++;
        continue;
      }
      break;
    }
    params[key] = values;
  }
  if (line[index] !== ':') return null;
  return { name, params, value: line.slice(index + 1) };
}

export function parseICS(text: string): Component[] {
  const roots: Component[] = [];
  const stack: Component[] = [];
  for (const raw of unfold(text.replace(/^\uFEFF/, ''))) {
    if (!raw.trim()) continue;
    const prop = parseLine(raw);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const component: Component = { name: prop.value.trim().toUpperCase(), props: [], children: [] };
      if (stack.length) stack[stack.length - 1].children.push(component);
      else roots.push(component);
      stack.push(component);
      if (stack.length > 20) throw new ICalError('Die Datei ist zu tief verschachtelt');
    } else if (prop.name === 'END') {
      const name = prop.value.trim().toUpperCase();
      while (stack.length && stack[stack.length - 1].name !== name) stack.pop();
      stack.pop();
    } else if (stack.length) {
      stack[stack.length - 1].props.push(prop);
    }
  }
  return roots;
}

const SAFE_PARAM = /^[^";:,]*$/;

function paramValue(value: string) {
  const clean = value.replace(/"/g, "'").replace(/[\r\n]/g, ' ');
  return SAFE_PARAM.test(clean) ? clean : `"${clean}"`;
}

function fold(line: string) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const length = Buffer.byteLength(char, 'utf8');
    if (size + length > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function propertyLine(prop: Property) {
  let line = prop.name;
  for (const [key, values] of Object.entries(prop.params)) line += `;${key}=${values.map(paramValue).join(',')}`;
  return fold(`${line}:${prop.value.replace(/[\r\n]+/g, ' ')}`);
}

export function serialize(component: Component): string {
  const lines: string[] = [];
  const write = (current: Component) => {
    lines.push(`BEGIN:${current.name}`);
    for (const prop of current.props) lines.push(propertyLine(prop));
    for (const child of current.children) write(child);
    lines.push(`END:${current.name}`);
  };
  write(component);
  return `${lines.join('\r\n')}\r\n`;
}

export const escapeText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

export function unescapeText(value: string) {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

export function splitText(value: string) {
  const out: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      current += char + value[index + 1];
      index++;
    } else if (char === ',') {
      out.push(unescapeText(current));
      current = '';
    } else current += char;
  }
  out.push(unescapeText(current));
  return out.map((item) => item.trim()).filter(Boolean);
}

export const getProp = (component: Component, name: string) => component.props.find((prop) => prop.name === name);
export const getProps = (component: Component, name: string) => component.props.filter((prop) => prop.name === name);
export const getText = (component: Component, name: string) => {
  const prop = getProp(component, name);
  return prop ? unescapeText(prop.value) : null;
};

export function removeProps(component: Component, ...names: string[]) {
  component.props = component.props.filter((prop) => !names.includes(prop.name));
}

export function setProp(component: Component, name: string, value: string | null, params: Record<string, string[]> = {}) {
  const index = component.props.findIndex((prop) => prop.name === name);
  const rest = component.props.filter((prop) => prop.name !== name);
  if (value === null || value === '') {
    component.props = rest;
    return;
  }
  const prop = { name, params, value };
  if (index < 0) rest.push(prop);
  else rest.splice(index, 0, prop);
  component.props = rest;
}

export const setText = (component: Component, name: string, value: string | null) =>
  setProp(component, name, value === null || value === '' ? null : escapeText(value));

const WINDOWS_ZONES: Record<string, string> = {
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'e. europe standard time': 'Europe/Chisinau',
  'fle standard time': 'Europe/Kyiv',
  'gtb standard time': 'Europe/Bucharest',
  'russian standard time': 'Europe/Moscow',
  'turkey standard time': 'Europe/Istanbul',
  'israel standard time': 'Asia/Jerusalem',
  'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg',
  'w. central africa standard time': 'Africa/Lagos',
  'morocco standard time': 'Africa/Casablanca',
  'arabian standard time': 'Asia/Dubai',
  'arab standard time': 'Asia/Riyadh',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'aus eastern standard time': 'Australia/Sydney',
  'e. australia standard time': 'Australia/Brisbane',
  'w. australia standard time': 'Australia/Perth',
  'new zealand standard time': 'Pacific/Auckland',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'atlantic standard time': 'America/Halifax',
  'canada central standard time': 'America/Regina',
  'sa pacific standard time': 'America/Bogota',
  'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Buenos_Aires',
  'central america standard time': 'America/Guatemala',
  'mexico standard time': 'America/Mexico_City',
  'central standard time (mexico)': 'America/Mexico_City',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
};

export interface ZoneMap {
  resolve(tzid: string | undefined): string | null;
}

export function zoneMap(calendar: Component | null, fallback: string): ZoneMap {
  const known = new Map<string, string>();
  const zones = calendar?.children.filter((child) => child.name === 'VTIMEZONE') ?? [];
  for (const zone of zones) {
    const id = getText(zone, 'TZID');
    if (!id) continue;
    const location = getText(zone, 'X-LIC-LOCATION');
    if (location && isZone(location)) known.set(id, location);
    else {
      const guess = guessZone(id);
      if (guess) known.set(id, guess);
      else {
        const standard = zone.children.find((child) => child.name === 'STANDARD');
        const daylight = zone.children.find((child) => child.name === 'DAYLIGHT');
        const offset = standard ? getText(standard, 'TZOFFSETTO') : null;
        if (offset && !daylight) {
          const match = /^([+-])(\d{2})(\d{2})$/.exec(offset);
          if (match && match[3] === '00') {
            const hours = Number(match[2]);
            known.set(id, hours === 0 ? 'UTC' : `Etc/GMT${match[1] === '+' ? '-' : '+'}${hours}`);
          }
        }
      }
    }
  }
  return {
    resolve(tzid) {
      if (!tzid) return null;
      const clean = tzid.trim();
      return known.get(clean) ?? guessZone(clean) ?? fallback;
    },
  };
}

export function guessZone(tzid: string): string | null {
  const clean = tzid.replace(/^"|"$/g, '').trim();
  if (isZone(clean)) return clean === 'Europe/Kiev' ? 'Europe/Kyiv' : clean;
  const windows = WINDOWS_ZONES[clean.toLowerCase()];
  if (windows && isZone(windows)) return windows;
  const segments = clean.split('/').filter(Boolean);
  for (let count = 3; count >= 2; count--) {
    if (segments.length >= count) {
      const candidate = segments.slice(-count).join('/');
      if (isZone(candidate)) return candidate;
    }
  }
  const match = /\(UTC([+-]\d{2}):?(\d{2})\)/i.exec(clean);
  if (match && match[2] === '00') {
    const hours = Number(match[1]);
    return hours === 0 ? 'UTC' : `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
  }
  return null;
}

export interface TimeValue {
  allDay: boolean;
  utc: number;
  zone: string;
  floating: boolean;
}

export function parseTimeValue(raw: string, params: Record<string, string[]>, zones: ZoneMap, fallback: string): TimeValue | null {
  const value = raw.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || params.VALUE?.[0]?.toUpperCase() === 'DATE') {
    const match = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!match) return null;
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { allDay: true, utc: Date.UTC(Number(match[1]), month - 1, day), zone: 'UTC', floating: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(value);
  if (!match) return null;
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 24 || wall.minute > 59) return null;
  if (match[7])
    return {
      allDay: false,
      utc: Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
      zone: 'UTC',
      floating: false,
    };
  const tzid = params.TZID?.[0];
  if (tzid) {
    const zone = zones.resolve(tzid) ?? fallback;
    return { allDay: false, utc: utcOf(wall, zone), zone, floating: false };
  }
  return { allDay: false, utc: utcOf(wall, fallback), zone: fallback, floating: true };
}

export function parseTime(prop: Property | undefined, zones: ZoneMap, fallback: string): TimeValue | null {
  if (!prop) return null;
  return parseTimeValue(prop.value, prop.params, zones, fallback);
}

export function parseTimeList(props: Property[], zones: ZoneMap, fallback: string): TimeValue[] {
  const out: TimeValue[] = [];
  for (const prop of props) {
    if (prop.params.VALUE?.[0]?.toUpperCase() === 'PERIOD') {
      for (const part of prop.value.split(',')) {
        const parsed = parseTimeValue(part.split('/')[0], { ...prop.params, VALUE: ['DATE-TIME'] }, zones, fallback);
        if (parsed) out.push(parsed);
      }
      continue;
    }
    for (const part of prop.value.split(',')) {
      const parsed = parseTimeValue(part, prop.params, zones, fallback);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export function formatDateValue(utc: number) {
  const date = new Date(utc);
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

export function formatUtc(utc: number) {
  const date = new Date(utc);
  return `${formatDateValue(utc)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function formatLocal(utc: number, zone: string) {
  const wall = wallOf(utc, zone);
  return `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`;
}

export function timeProp(name: string, utc: number, allDay: boolean, zone: string, floating = false): Property {
  if (allDay) return { name, params: { VALUE: ['DATE'] }, value: formatDateValue(utc) };
  if (floating) return { name, params: {}, value: formatLocal(utc, zone) };
  if (zone === 'UTC') return { name, params: {}, value: formatUtc(utc) };
  return { name, params: { TZID: [zone] }, value: formatLocal(utc, zone) };
}

export function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match || value.trim().toUpperCase() === 'P' || value.trim().toUpperCase().endsWith('T')) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * 7 * DAY +
    Number(days ?? 0) * DAY +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000;
  return sign === '-' ? -total : total;
}

export function formatDuration(ms: number) {
  const negative = ms < 0;
  let rest = Math.abs(Math.round(ms / 1000));
  if (rest === 0) return 'PT0S';
  const days = Math.floor(rest / 86_400);
  rest -= days * 86_400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = rest - minutes * 60;
  let out = `${negative ? '-' : ''}P`;
  if (days && days % 7 === 0 && !hours && !minutes && !seconds) return `${out}${days / 7}W`;
  if (days) out += `${days}D`;
  if (hours || minutes || seconds) {
    out += 'T';
    if (hours) out += `${hours}H`;
    if (minutes) out += `${minutes}M`;
    if (seconds) out += `${seconds}S`;
  }
  return out;
}

function transitions(zone: string, year: number) {
  const out: { utc: number; from: number; to: number }[] = [];
  let previous = offsetOf(Date.UTC(year, 0, 1), zone);
  for (let day = 0; day < 366; day++) {
    const utc = Date.UTC(year, 0, 1) + (day + 1) * DAY;
    const current = offsetOf(utc, zone);
    if (current !== previous) {
      let low = utc - DAY;
      let high = utc;
      while (high - low > 60_000) {
        const middle = Math.floor((low + high) / 2 / 60_000) * 60_000;
        if (offsetOf(middle, zone) === previous) low = middle;
        else high = middle;
      }
      out.push({ utc: high, from: previous, to: current });
      previous = current;
    }
  }
  return out;
}

const offsetText = (minutes: number) => {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
};

function zoneName(zone: string, utc: number) {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(new Date(utc))
        .find((part) => part.type === 'timeZoneName')?.value ?? null
    );
  } catch {
    return null;
  }
}

const zoneCache = new Map<string, Component>();

export function vtimezone(zone: string, year: number): Component {
  const key = `${zone}|${year}`;
  const cached = zoneCache.get(key);
  if (cached) return structuredClone(cached);
  const component: Component = { name: 'VTIMEZONE', props: [{ name: 'TZID', params: {}, value: zone }], children: [] };
  const found = transitions(zone, year);
  if (!found.length) {
    const offset = offsetOf(Date.UTC(year, 0, 1), zone);
    const name = zoneName(zone, Date.UTC(year, 0, 1));
    component.children.push({
      name: 'STANDARD',
      props: [
        { name: 'DTSTART', params: {}, value: '19700101T000000' },
        { name: 'TZOFFSETFROM', params: {}, value: offsetText(offset) },
        { name: 'TZOFFSETTO', params: {}, value: offsetText(offset) },
        ...(name ? [{ name: 'TZNAME', params: {}, value: escapeText(name) }] : []),
      ],
      children: [],
    });
  } else {
    const smallest = Math.min(...found.map((entry) => entry.to));
    for (const entry of found) {
      const local = new Date(entry.utc + entry.from * 60_000);
      const year4 = local.getUTCFullYear();
      const month = local.getUTCMonth() + 1;
      const day = local.getUTCDate();
      const dayNo = dayNumber(year4, month, day);
      const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekdayOfDay(dayNo)];
      const nth = day > daysInMonth(year4, month) - 7 ? -1 : Math.ceil(day / 7);
      const name = zoneName(zone, entry.utc + 60_000);
      component.children.push({
        name: entry.to === smallest && found.length > 1 ? 'STANDARD' : entry.to > entry.from ? 'DAYLIGHT' : 'STANDARD',
        props: [
          {
            name: 'DTSTART',
            params: {},
            value: `${pad(year4, 4)}${pad(month)}${pad(day)}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}00`,
          },
          { name: 'TZOFFSETFROM', params: {}, value: offsetText(entry.from) },
          { name: 'TZOFFSETTO', params: {}, value: offsetText(entry.to) },
          { name: 'RRULE', params: {}, value: `FREQ=YEARLY;BYMONTH=${month};BYDAY=${nth}${weekday}` },
          ...(name ? [{ name: 'TZNAME', params: {}, value: escapeText(name) }] : []),
        ],
        children: [],
      });
    }
  }
  if (zoneCache.size > 500) zoneCache.clear();
  zoneCache.set(key, component);
  return structuredClone(component);
}

export function dateOnly(utc: number) {
  return parseKey(new Date(utc).toISOString().slice(0, 10));
}

export const keyOfUtcDate = (utc: number) => {
  const parts = dateOnly(utc);
  return dateKey(parts.year, parts.month, parts.day);
};
