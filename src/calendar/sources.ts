import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { parseCsv } from '../services/userimport.ts';
import { isZone, pad, utcOf } from '../../shared/time.ts';
import { escapeText, getProp, getText, parseICS, serialize, type Component } from './ical.ts';
import { readObjects } from './model.ts';

export interface Source {
  key: string;
  name: string;
  color: string | null;
  description: string | null;
  zone: string | null;
  origin: string;
  text: string;
  events: number;
  tasks: number;
  first: number | null;
  last: number | null;
}

export class SourceError extends Error {
  params: Record<string, string | number>;
  constructor(message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.params = params;
  }
}

export const SOURCE_LIMITS = {
  files: 50,
  calendars: 100,
  bytes: 60 * 1024 * 1024,
  file: 30 * 1024 * 1024,
  objects: 50_000,
  zipEntries: 400,
};

const CALENDAR_FILE = /\.(ics|ical|icalendar|ifb|vcs)$/i;
const CSV_FILE = /\.(csv|tsv|txt)$/i;

const COLOR_NAMES: Record<string, string> = {
  red: '#ef4444',
  crimson: '#dc2626',
  tomato: '#f97316',
  orange: '#f97316',
  coral: '#fb7185',
  salmon: '#fb7185',
  gold: '#eab308',
  yellow: '#eab308',
  khaki: '#ca8a04',
  olive: '#65a30d',
  lime: '#84cc16',
  green: '#22c55e',
  teal: '#14b8a6',
  turquoise: '#06b6d4',
  aqua: '#06b6d4',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  navy: '#1e40af',
  indigo: '#6366f1',
  purple: '#8b5cf6',
  violet: '#8b5cf6',
  orchid: '#d946ef',
  fuchsia: '#d946ef',
  magenta: '#d946ef',
  plum: '#c084fc',
  pink: '#ec4899',
  maroon: '#9f1239',
  brown: '#a16207',
  gray: '#64748b',
  grey: '#64748b',
  silver: '#94a3b8',
  black: '#334155',
};

export function colorOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex.slice(0, 6);
    return `#${full}`;
  }
  return COLOR_NAMES[value] ?? null;
}

export function decodeText(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const baseName = (origin: string) =>
  origin
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[a-z0-9]{1,10}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

const calendarText = (component: Component, ...names: string[]) => {
  for (const name of names) {
    const value = getText(component, name);
    if (value?.trim()) return value.trim();
  }
  return null;
};

export function mergeRoots(roots: Component[]) {
  const calendars = roots.filter((root) => root.name === 'VCALENDAR');
  const loose = roots.filter((root) => root.name === 'VEVENT' || root.name === 'VTODO' || root.name === 'VTIMEZONE');
  const all = loose.length ? [...calendars, { name: 'VCALENDAR', props: [], children: loose } as Component] : calendars;
  const merged: Component = {
    name: 'VCALENDAR',
    props: [
      { name: 'VERSION', params: {}, value: '2.0' },
      { name: 'PRODID', params: {}, value: '-//MoeStudio//MoeCloud Import//DE' },
    ],
    children: [],
  };
  const zones = new Set<string>();
  let name: string | null = null;
  let color: string | null = null;
  let description: string | null = null;
  let zone: string | null = null;
  for (const calendar of all) {
    name ??= calendarText(calendar, 'X-WR-CALNAME', 'NAME');
    color ??= colorOf(getProp(calendar, 'X-APPLE-CALENDAR-COLOR')?.value ?? getProp(calendar, 'COLOR')?.value);
    description ??= calendarText(calendar, 'X-WR-CALDESC', 'DESCRIPTION');
    const wanted = getProp(calendar, 'X-WR-TIMEZONE')?.value?.trim();
    if (!zone && wanted && isZone(wanted)) zone = wanted;
    for (const item of calendar.children) {
      if (item.name === 'VTIMEZONE') {
        const tzid = getText(item, 'TZID') ?? '';
        if (zones.has(tzid)) continue;
        zones.add(tzid);
        merged.children.unshift(item);
      } else if (item.name === 'VEVENT' || item.name === 'VTODO') merged.children.push(item);
    }
  }
  return { calendar: merged, name, color, description, zone };
}

interface Meta {
  name?: string | null;
  color?: string | null;
  description?: string | null;
  zone?: string | null;
}

function summarize(key: string, origin: string, text: string, zone: string, meta: Meta = {}): Source | null {
  const objects = readObjects(text, zone, SOURCE_LIMITS.objects);
  if (!objects.length) return null;
  let events = 0;
  let tasks = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const object of objects) {
    if (object.data.component === 'VTODO') tasks++;
    else events++;
    const when = object.data.start ?? object.data.due;
    if (when === null) continue;
    if (first === null || when < first) first = when;
    if (last === null || when > last) last = when;
  }
  return {
    key,
    origin,
    text,
    events,
    tasks,
    first,
    last,
    name: meta.name?.trim() || baseName(origin) || 'Kalender',
    color: meta.color ?? null,
    description: meta.description ?? null,
    zone: meta.zone ?? null,
  };
}

export function fromIcs(text: string, origin: string, zone: string, key: string): Source | null {
  let roots: Component[];
  try {
    roots = parseICS(text);
  } catch {
    throw new SourceError('„{name}“ ist keine gültige Kalenderdatei', { name: origin });
  }
  const merged = mergeRoots(roots);
  if (!merged.calendar.children.some((item) => item.name !== 'VTIMEZONE')) return null;
  return summarize(key, origin, serialize(merged.calendar), merged.zone ?? zone, merged);
}

export function fromCalendarTexts(
  texts: string[],
  origin: string,
  zone: string,
  key: string,
  meta: Pick<Source, 'name' | 'color' | 'description' | 'zone'>
): Source | null {
  const roots: Component[] = [];
  for (const text of texts) {
    try {
      roots.push(...parseICS(text));
    } catch {
      continue;
    }
  }
  const merged = mergeRoots(roots);
  if (!merged.calendar.children.some((item) => item.name !== 'VTIMEZONE')) return null;
  return summarize(key, origin, serialize(merged.calendar), meta.zone ?? merged.zone ?? zone, {
    name: meta.name || merged.name,
    color: meta.color ?? merged.color,
    description: meta.description ?? merged.description,
    zone: meta.zone ?? merged.zone,
  });
}

const HEADERS: Record<string, string[]> = {
  title: ['subject', 'betreff', 'titel', 'title', 'summary', 'termin', 'name'],
  startDate: ['start date', 'beginnt am', 'startdatum', 'beginn datum', 'start', 'beginn', 'datum', 'date', 'start_date', 'dtstart'],
  startTime: ['start time', 'beginnt um', 'startzeit', 'beginn uhrzeit', 'uhrzeit', 'time', 'start_time'],
  endDate: ['end date', 'endet am', 'enddatum', 'ende datum', 'end', 'ende', 'end_date', 'dtend'],
  endTime: ['end time', 'endet um', 'endzeit', 'ende uhrzeit', 'end_time'],
  allDay: ['all day event', 'all day', 'all-day', 'allday', 'ganztägiges ereignis', 'ganztägig', 'ganztaegig'],
  description: ['description', 'beschreibung', 'notes', 'notizen', 'notiz', 'details'],
  location: ['location', 'ort', 'where', 'adresse'],
  categories: ['categories', 'kategorien', 'kategorie', 'category'],
  private: ['private', 'privat'],
  calendar: ['calendar', 'kalender'],
};

const TRUE = /^(true|wahr|yes|ja|y|j|1|x|ein|on)$/i;

interface DateValue {
  year: number;
  month: number;
  day: number;
  minutes: number | null;
}

export function parseClockText(raw: string): number | null {
  const match =
    /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(raw.trim()) ??
    /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

export function parseDateText(raw: string, order: 'dmy' | 'mdy'): DateValue | null {
  const value = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  let rest: string | undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ,]+(.+))?$/.exec(value);
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:,?\s+(.+))?$/.exec(value);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(.+))?$/.exec(value);
  if (iso) [year, month, day, rest] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4]];
  else if (dotted) [day, month, year, rest] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3]), dotted[4]];
  else if (slashed) {
    const [a, b] = [Number(slashed[1]), Number(slashed[2])];
    [day, month] = order === 'dmy' ? [a, b] : [b, a];
    year = Number(slashed[3]);
    rest = slashed[4];
  } else return null;
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
  const minutes = rest ? parseClockText(rest.replace(/(:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i, '$1')) : null;
  if (rest && minutes === null) return null;
  return { year, month, day, minutes };
}

const columnOf = (header: string[], names: string[]) => {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
};

const compact = (date: DateValue) => `${pad(date.year, 4)}${pad(date.month)}${pad(date.day)}`;

function shiftDays(date: DateValue, days: number): DateValue {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), minutes: date.minutes };
}

const dayIndex = (date: DateValue) => Date.UTC(date.year, date.month - 1, date.day);

function localStamp(date: DateValue, minutes: number, zone: string) {
  const utc = utcOf(
    { year: date.year, month: date.month, day: date.day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 },
    zone
  );
  const stamp = new Date(utc);
  return `${pad(stamp.getUTCFullYear(), 4)}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}00Z`;
}

export function fromCsv(text: string, origin: string, zone: string, keyPrefix: string): Source[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.replace(/^﻿/, '').replace(/^"|"$/g, '').trim().toLowerCase().replace(/\s+/g, ' '));
  const column = Object.fromEntries(Object.entries(HEADERS).map(([key, names]) => [key, columnOf(header, names)])) as Record<
    keyof typeof HEADERS,
    number
  >;
  if (column.title < 0 || column.startDate < 0) throw new SourceError('In „{name}“ fehlen Spalten für Titel und Beginn', { name: origin });
  let order: 'dmy' | 'mdy' | null = null;
  for (const row of rows.slice(1, 2000)) {
    for (const cell of [row[column.startDate], column.endDate >= 0 ? row[column.endDate] : undefined]) {
      const match = /^(\d{1,2})\/(\d{1,2})\//.exec(cell?.trim() ?? '');
      if (!match) continue;
      if (Number(match[1]) > 12) order ??= 'dmy';
      else if (Number(match[2]) > 12) order ??= 'mdy';
    }
  }
  order ??= column.calendar >= 0 && header.includes('notes') ? 'dmy' : 'mdy';
  const groups = new Map<string, string[]>();
  let skipped = 0;
  const now = new Date();
  const stamp = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  for (const row of rows.slice(1, SOURCE_LIMITS.objects + 1)) {
    const cell = (index: number) => (index >= 0 ? (row[index] ?? '').trim() : '');
    const start = parseDateText(cell(column.startDate), order);
    if (!start) {
      skipped++;
      continue;
    }
    const startMinutes = parseClockText(cell(column.startTime)) ?? start.minutes;
    const endDate = parseDateText(cell(column.endDate), order);
    const endMinutes = parseClockText(cell(column.endTime)) ?? endDate?.minutes ?? null;
    const allDay = TRUE.test(cell(column.allDay)) || startMinutes === null;
    const title = cell(column.title) || 'Ohne Titel';
    const lines = ['BEGIN:VEVENT'];
    if (allDay) {
      let last = endDate && dayIndex(endDate) >= dayIndex(start) ? endDate : start;
      const exclusive = endDate && endMinutes === 0 && dayIndex(endDate) > dayIndex(start);
      if (!exclusive) last = shiftDays(last, 1);
      lines.push(`DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(last)}`);
    } else {
      const startAt = localStamp(start, startMinutes!, zone);
      let endAt = localStamp(start, startMinutes! + 60, zone);
      if (endMinutes !== null) {
        const candidate = localStamp(endDate ?? start, endMinutes, zone);
        if (candidate > startAt) endAt = candidate;
      }
      lines.push(`DTSTART:${startAt}`, `DTEND:${endAt}`);
    }
    const location = cell(column.location);
    const description = cell(column.description);
    const categories = cell(column.categories)
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const group = cell(column.calendar);
    const uid = createHash('sha1').update([group, title, lines[1], lines[2], location].join('\u0000')).digest('hex').slice(0, 32);
    lines.push(`UID:csv-${uid}@moecloud`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(title)}`);
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (categories.length) lines.push(`CATEGORIES:${categories.map(escapeText).join(',')}`);
    if (TRUE.test(cell(column.private))) lines.push('CLASS:PRIVATE');
    lines.push('END:VEVENT');
    const list = groups.get(group) ?? [];
    list.push(lines.join('\r\n'));
    groups.set(group, list);
  }
  const sources: Source[] = [];
  let index = 0;
  for (const [group, events] of groups) {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MoeStudio//MoeCloud Import//DE', ...events, 'END:VCALENDAR'].join('\r\n');
    const source = summarize(`${keyPrefix}-${index++}`, origin, ics, zone, { name: group || null });
    if (source) sources.push(source);
  }
  if (!sources.length && skipped) throw new SourceError('In „{name}“ fand MoeCloud keine lesbaren Termine', { name: origin });
  return sources;
}

function openZip(buffer: Buffer) {
  return new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: false, validateEntrySizes: true }, (error, zip) =>
      error || !zip ? reject(error ?? new Error('ZIP')) : resolve(zip)
    )
  );
}

export async function zipEntries(
  buffer: Buffer,
  origin: string,
  accept: (name: string) => boolean = (name) => CALENDAR_FILE.test(name) || /\.csv$/i.test(name)
) {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(buffer);
  } catch {
    throw new SourceError('„{name}“ ist kein lesbares ZIP-Archiv', { name: origin });
  }
  const found: { name: string; data: Buffer }[] = [];
  let total = 0;
  let seen = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      seen++;
      const name = entry.fileName;
      const wanted =
        !name.endsWith('/') &&
        !name.startsWith('__MACOSX/') &&
        !/(^|\/)\./.test(name) &&
        accept(name) &&
        found.length < SOURCE_LIMITS.files &&
        seen <= SOURCE_LIMITS.zipEntries;
      if (!wanted) {
        if (seen > SOURCE_LIMITS.zipEntries) {
          zip.close();
          resolve();
          return;
        }
        zip.readEntry();
        return;
      }
      if (entry.uncompressedSize > SOURCE_LIMITS.file || total + entry.uncompressedSize > SOURCE_LIMITS.bytes) {
        zip.close();
        reject(new SourceError('„{name}“ ist zu groß zum Importieren', { name: origin }));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error('ZIP'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > SOURCE_LIMITS.file) {
            stream.destroy(new SourceError('„{name}“ ist zu groß zum Importieren', { name: origin }));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          total += size;
          found.push({ name, data: Buffer.concat(chunks) });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  }).catch((error: unknown) => {
    if (error instanceof SourceError) throw error;
    throw new SourceError('„{name}“ ist kein lesbares ZIP-Archiv', { name: origin });
  });
  return found;
}

export async function fromFile(name: string, buffer: Buffer, zone: string, key: string): Promise<Source[]> {
  if (buffer.length > SOURCE_LIMITS.file && !/\.zip$/i.test(name)) throw new SourceError('„{name}“ ist zu groß zum Importieren', { name });
  if (buffer.subarray(0, 4).equals(Buffer.from('PK\u0003\u0004', 'latin1')) || /\.zip$/i.test(name)) {
    const sources: Source[] = [];
    let index = 0;
    for (const entry of await zipEntries(buffer, name)) {
      const inner = await fromFile(entry.name, entry.data, zone, `${key}-${index++}`).catch((error: unknown) => {
        if (error instanceof SourceError) return [];
        throw error;
      });
      sources.push(...inner);
    }
    if (!sources.length) throw new SourceError('In „{name}“ liegen keine Kalender', { name });
    return sources;
  }
  const text = decodeText(buffer);
  if (/^\s*BEGIN:VCALENDAR/i.test(text) || /^\s*BEGIN:(VEVENT|VTODO)/i.test(text) || CALENDAR_FILE.test(name)) {
    const source = fromIcs(text, name, zone, key);
    if (!source) throw new SourceError('In „{name}“ stehen keine Termine oder Aufgaben', { name });
    return [source];
  }
  if (CSV_FILE.test(name)) return fromCsv(text, name, zone, key);
  throw new SourceError('„{name}“ ist weder eine ICS-, CSV- noch ZIP-Datei', { name });
}
