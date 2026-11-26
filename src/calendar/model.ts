import { randomUUID } from 'node:crypto';
import { DAY, compactKey, keyOfDay, utcKey } from '../../shared/time.ts';
import { expand, lastOccurrence, parseRule, type Occurrence, type Series } from '../../shared/rrule.ts';
import {
  ICalError,
  formatDuration,
  formatLocal,
  formatUtc,
  formatDateValue,
  getProp,
  getProps,
  getText,
  parseDuration,
  parseICS,
  parseTime,
  parseTimeList,
  removeProps,
  serialize,
  setProp,
  setText,
  splitText,
  timeProp,
  unescapeText,
  escapeText,
  vtimezone,
  zoneMap,
  type Component,
  type Property,
  type ZoneMap,
} from './ical.ts';

export type ItemKind = 'event' | 'birthday' | 'focus' | 'ooo';
export type PartStat = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'DELEGATED';
export type AttendeeRole = 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'CHAIR' | 'NON-PARTICIPANT';

export interface Alarm {
  offset: number;
  related: 'START' | 'END';
  absolute: number | null;
  action: 'DISPLAY' | 'EMAIL' | 'AUDIO';
}

export interface Attendee {
  email: string;
  name: string | null;
  status: PartStat;
  role: AttendeeRole;
  rsvp: boolean;
}

export interface Person {
  email: string;
  name: string | null;
}

export interface Instance {
  title: string;
  description: string;
  location: string;
  url: string;
  start: number | null;
  end: number | null;
  allDay: boolean;
  zone: string;
  floating: boolean;
  status: string | null;
  transparency: 'OPAQUE' | 'TRANSPARENT';
  privacy: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
  color: string | null;
  categories: string[];
  alarms: Alarm[];
  organizer: Person | null;
  attendees: Attendee[];
  conference: string | null;
  due: number | null;
  priority: number;
  percent: number;
  completed: number | null;
}

export interface Override extends Instance {
  recurrenceId: string;
}

export interface ItemData extends Instance {
  component: 'VEVENT' | 'VTODO';
  uid: string;
  kind: ItemKind;
  birthYear: number | null;
  assignee: number | null;
  rrule: string | null;
  exdates: string[];
  rdates: number[];
  parent: string | null;
  sequence: number;
  created: number | null;
  modified: number | null;
  overrides: Override[];
}

export interface ParsedObject {
  uid: string;
  data: ItemData;
  ics: string;
}

const PRODID = '-//MoeStudio//MoeCloud//DE';

const CSS_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  gold: '#d4a017',
  green: '#22c55e',
  teal: '#14b8a6',
  turquoise: '#06b6d4',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  navy: '#1e3a8a',
  indigo: '#6366f1',
  purple: '#8b5cf6',
  violet: '#8b5cf6',
  magenta: '#d946ef',
  pink: '#ec4899',
  brown: '#92400e',
  gray: '#6b7280',
  grey: '#6b7280',
  black: '#111827',
  white: '#f9fafb',
};

export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(clean);
  if (hex) return `#${hex[1]}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(clean);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return CSS_COLORS[clean] ?? null;
}

function colorName(hex: string) {
  let best = 'blue';
  let distance = Infinity;
  const parse = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  const [r, g, b] = parse(hex);
  for (const [name, value] of Object.entries(CSS_COLORS)) {
    const [r2, g2, b2] = parse(value);
    const current = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (current < distance) {
      distance = current;
      best = name;
    }
  }
  return best;
}

const mailOf = (value: string) =>
  value
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();

function personOf(prop: Property | undefined): Person | null {
  if (!prop) return null;
  const email = mailOf(prop.value);
  if (!email) return null;
  return { email, name: prop.params.CN?.[0] ? unescapeText(prop.params.CN[0]) : null };
}

const PARTSTATS: PartStat[] = ['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'DELEGATED'];
const ROLES: AttendeeRole[] = ['REQ-PARTICIPANT', 'OPT-PARTICIPANT', 'CHAIR', 'NON-PARTICIPANT'];

function attendeesOf(component: Component): Attendee[] {
  const out: Attendee[] = [];
  for (const prop of getProps(component, 'ATTENDEE')) {
    const email = mailOf(prop.value);
    if (!email || out.some((entry) => entry.email === email)) continue;
    const status = (prop.params.PARTSTAT?.[0]?.toUpperCase() ?? 'NEEDS-ACTION') as PartStat;
    const role = (prop.params.ROLE?.[0]?.toUpperCase() ?? 'REQ-PARTICIPANT') as AttendeeRole;
    out.push({
      email,
      name: prop.params.CN?.[0] ? unescapeText(prop.params.CN[0]) : null,
      status: PARTSTATS.includes(status) ? status : 'NEEDS-ACTION',
      role: ROLES.includes(role) ? role : 'REQ-PARTICIPANT',
      rsvp: prop.params.RSVP?.[0]?.toUpperCase() === 'TRUE',
    });
  }
  return out;
}

function alarmsOf(component: Component, zones: ZoneMap, fallback: string): Alarm[] {
  const out: Alarm[] = [];
  for (const child of component.children) {
    if (child.name !== 'VALARM') continue;
    const trigger = getProp(child, 'TRIGGER');
    if (!trigger) continue;
    const actionText = (getText(child, 'ACTION') ?? 'DISPLAY').toUpperCase();
    const action = actionText === 'EMAIL' ? 'EMAIL' : actionText === 'AUDIO' ? 'AUDIO' : 'DISPLAY';
    if (trigger.params.VALUE?.[0]?.toUpperCase() === 'DATE-TIME' || /^\d{8}T/.test(trigger.value)) {
      const time = parseTime(trigger, zones, fallback);
      if (time) out.push({ offset: 0, related: 'START', absolute: time.utc, action });
      continue;
    }
    const offset = parseDuration(trigger.value);
    if (offset === null) continue;
    out.push({ offset, related: trigger.params.RELATED?.[0]?.toUpperCase() === 'END' ? 'END' : 'START', absolute: null, action });
  }
  return out;
}

function conferenceOf(component: Component): string | null {
  for (const name of ['X-MOE-CONFERENCE', 'X-GOOGLE-CONFERENCE', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'CONFERENCE']) {
    const value = getText(component, name);
    if (value && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return null;
}

function categoriesOf(component: Component) {
  const out: string[] = [];
  for (const prop of getProps(component, 'CATEGORIES')) for (const item of splitText(prop.value)) if (!out.includes(item)) out.push(item);
  return out.slice(0, 30);
}

function instanceOf(component: Component, todo: boolean, zones: ZoneMap, fallback: string): Instance {
  const start = parseTime(getProp(component, 'DTSTART'), zones, fallback);
  let end: number | null = null;
  const endTime = parseTime(getProp(component, todo ? 'DUE' : 'DTEND'), zones, fallback);
  const durationText = getText(component, 'DURATION');
  if (!todo) {
    if (start && endTime) end = endTime.utc;
    else if (start && durationText) end = start.utc + Math.max(0, parseDuration(durationText) ?? 0);
    else if (start) end = start.allDay ? start.utc + DAY : start.utc;
    if (start && end !== null && end < start.utc) end = start.utc;
    if (start?.allDay && end !== null && end <= start.utc) end = start.utc + DAY;
  }
  const due = todo ? (endTime?.utc ?? (start && durationText ? start.utc + (parseDuration(durationText) ?? 0) : null)) : null;
  const classText = (getText(component, 'CLASS') ?? 'PUBLIC').toUpperCase();
  const statusText = getText(component, 'STATUS')?.toUpperCase() ?? null;
  const priority = Number(getText(component, 'PRIORITY') ?? 0);
  const percent = Number(getText(component, 'PERCENT-COMPLETE') ?? 0);
  const completed = parseTime(getProp(component, 'COMPLETED'), zones, fallback);
  const allDay = start ? start.allDay : todo ? Boolean(endTime?.allDay) : false;
  return {
    title: (getText(component, 'SUMMARY') ?? '').slice(0, 500),
    description: (getText(component, 'DESCRIPTION') ?? '').slice(0, 20_000),
    location: (getText(component, 'LOCATION') ?? '').slice(0, 500),
    url: (getText(component, 'URL') ?? '').slice(0, 2000),
    start: start?.utc ?? null,
    end,
    allDay,
    zone: start?.zone ?? endTime?.zone ?? fallback,
    floating: start ? start.floating && !start.allDay : false,
    status: statusText,
    transparency: (getText(component, 'TRANSP') ?? '').toUpperCase() === 'TRANSPARENT' ? 'TRANSPARENT' : 'OPAQUE',
    privacy: classText === 'PRIVATE' ? 'PRIVATE' : classText === 'CONFIDENTIAL' ? 'CONFIDENTIAL' : 'PUBLIC',
    color: normalizeColor(getText(component, 'X-MOE-COLOR') ?? getText(component, 'COLOR') ?? getText(component, 'X-APPLE-CALENDAR-COLOR')),
    categories: categoriesOf(component),
    alarms: alarmsOf(component, zones, fallback),
    organizer: personOf(getProp(component, 'ORGANIZER')),
    attendees: attendeesOf(component),
    conference: conferenceOf(component),
    due,
    priority: Number.isInteger(priority) && priority >= 0 && priority <= 9 ? priority : 0,
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
    completed: completed?.utc ?? null,
  };
}

function recurrenceKeyOf(component: Component, masterAllDay: boolean, zones: ZoneMap, fallback: string): string | null {
  const time = parseTime(getProp(component, 'RECURRENCE-ID'), zones, fallback);
  if (!time) return null;
  if (masterAllDay || time.allDay) return compactKey(keyOfDay(Math.floor(time.utc / DAY)));
  return utcKey(time.utc);
}

function dataOf(components: Component[], zones: ZoneMap, fallback: string): ItemData {
  const master = components.find((component) => !getProp(component, 'RECURRENCE-ID')) ?? components[0];
  const todo = master.name === 'VTODO';
  const base = instanceOf(master, todo, zones, fallback);
  const uid = getText(master, 'UID') ?? randomUUID();
  const rruleText = getProp(master, 'RRULE')?.value ?? null;
  const rule = rruleText ? parseRule(rruleText) : null;
  const isMaster = !getProp(master, 'RECURRENCE-ID');
  const exdates = isMaster
    ? parseTimeList(getProps(master, 'EXDATE'), zones, fallback).map((time) =>
        base.allDay || time.allDay ? compactKey(keyOfDay(Math.floor(time.utc / DAY))) : utcKey(time.utc)
      )
    : [];
  const rdates = isMaster ? parseTimeList(getProps(master, 'RDATE'), zones, fallback).map((time) => time.utc) : [];
  const overrides: Override[] = [];
  for (const component of components) {
    if (component === master) continue;
    const key = recurrenceKeyOf(component, base.allDay, zones, fallback);
    if (!key || overrides.some((entry) => entry.recurrenceId === key)) continue;
    overrides.push({ ...instanceOf(component, todo, zones, fallback), recurrenceId: key });
  }
  const kindText = (getText(master, 'X-MOE-KIND') ?? '').toLowerCase();
  const birthYear = Number(getText(master, 'X-MOE-BIRTHYEAR') ?? getText(master, 'X-APPLE-BIRTHDAY-YEAR') ?? NaN);
  const assignee = Number(getText(master, 'X-MOE-ASSIGNEE') ?? NaN);
  const created = parseTime(getProp(master, 'CREATED'), zones, fallback);
  const modified = parseTime(getProp(master, 'LAST-MODIFIED'), zones, fallback);
  const sequence = Number(getText(master, 'SEQUENCE') ?? 0);
  return {
    ...base,
    component: todo ? 'VTODO' : 'VEVENT',
    uid: uid.slice(0, 255),
    kind: (['birthday', 'focus', 'ooo'].includes(kindText) ? kindText : 'event') as ItemKind,
    birthYear: Number.isInteger(birthYear) && birthYear > 1800 && birthYear < 2200 ? birthYear : null,
    assignee: todo && Number.isInteger(assignee) && assignee > 0 ? assignee : null,
    rrule: rule && base.start !== null ? rruleText!.replace(/^RRULE:/i, '') : null,
    exdates: [...new Set(exdates)],
    rdates: [...new Set(rdates)],
    parent: getText(master, 'RELATED-TO'),
    sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : 0,
    created: created?.utc ?? null,
    modified: modified?.utc ?? null,
    overrides,
  };
}

function calendarOf(roots: Component[]) {
  const calendar = roots.find((root) => root.name === 'VCALENDAR');
  if (calendar) return calendar;
  const items = roots.filter((root) => root.name === 'VEVENT' || root.name === 'VTODO');
  if (!items.length) return null;
  return { name: 'VCALENDAR', props: [], children: roots } as Component;
}

function groupByUid(calendar: Component) {
  const groups = new Map<string, Component[]>();
  for (const child of calendar.children) {
    if (child.name !== 'VEVENT' && child.name !== 'VTODO') continue;
    const uid = getText(child, 'UID') ?? `missing-${randomUUID()}`;
    if (!getText(child, 'UID')) setText(child, 'UID', uid);
    const list = groups.get(uid) ?? [];
    list.push(child);
    groups.set(uid, list);
  }
  return groups;
}

function usedZones(components: Component[]) {
  const zones = new Set<string>();
  const visit = (component: Component) => {
    for (const prop of component.props) for (const tzid of prop.params.TZID ?? []) zones.add(tzid);
    for (const child of component.children) if (child.name !== 'VTIMEZONE') visit(child);
  };
  for (const component of components) visit(component);
  return zones;
}

function wrap(source: Component | null, components: Component[], year: number) {
  const calendar: Component = {
    name: 'VCALENDAR',
    props: [
      { name: 'VERSION', params: {}, value: '2.0' },
      { name: 'PRODID', params: {}, value: source ? (getProp(source, 'PRODID')?.value ?? PRODID) : PRODID },
      { name: 'CALSCALE', params: {}, value: 'GREGORIAN' },
    ],
    children: [],
  };
  const known = new Map<string, Component>();
  for (const zone of source?.children.filter((child) => child.name === 'VTIMEZONE') ?? []) {
    const id = getText(zone, 'TZID');
    if (id) known.set(id, zone);
  }
  for (const tzid of usedZones(components)) {
    const existing = known.get(tzid);
    if (existing) calendar.children.push(existing);
    else if (tzid !== 'UTC') {
      try {
        calendar.children.push(vtimezone(tzid, year));
      } catch {}
    }
  }
  calendar.children.push(...components);
  return calendar;
}

export function readObjects(text: string, fallback: string, limit = 50_000): ParsedObject[] {
  let roots: Component[];
  try {
    roots = parseICS(text);
  } catch (error) {
    throw new ICalError((error as Error).message);
  }
  const calendar = calendarOf(roots);
  if (!calendar) throw new ICalError('Die Datei enthält keinen Kalender');
  const zones = zoneMap(calendar, fallback);
  const out: ParsedObject[] = [];
  for (const [uid, components] of groupByUid(calendar)) {
    if (out.length >= limit) break;
    const data = dataOf(components, zones, fallback);
    if (data.component === 'VEVENT' && data.start === null) continue;
    const year = new Date(data.start ?? data.due ?? Date.now()).getUTCFullYear();
    out.push({ uid, data, ics: serialize(wrap(calendar, components, year)) });
  }
  return out;
}

export function readObject(text: string, fallback: string): ParsedObject {
  const roots = parseICS(text);
  const calendar = calendarOf(roots);
  if (!calendar) throw new ICalError('Die Datei enthält keinen Kalender');
  const groups = groupByUid(calendar);
  if (groups.size !== 1) throw new ICalError('Ein Kalendereintrag darf genau eine UID haben');
  const [[uid, components]] = [...groups];
  const zones = zoneMap(calendar, fallback);
  const data = dataOf(components, zones, fallback);
  if (data.component === 'VEVENT' && data.start === null) throw new ICalError('Dem Termin fehlt der Beginn');
  return { uid, data, ics: serialize(calendar) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function attendeeProp(attendee: Attendee, previous: Property | undefined): Property {
  const params: Record<string, string[]> = { ...(previous?.params ?? {}) };
  if (attendee.name) params.CN = [attendee.name];
  else delete params.CN;
  params.PARTSTAT = [attendee.status];
  params.ROLE = [attendee.role];
  if (attendee.rsvp) params.RSVP = ['TRUE'];
  else delete params.RSVP;
  params.CUTYPE ??= ['INDIVIDUAL'];
  return { name: 'ATTENDEE', params, value: `mailto:${attendee.email}` };
}

function alarmComponent(alarm: Alarm, title: string): Component {
  const trigger: Property =
    alarm.absolute !== null
      ? { name: 'TRIGGER', params: { VALUE: ['DATE-TIME'] }, value: formatUtc(alarm.absolute) }
      : { name: 'TRIGGER', params: alarm.related === 'END' ? { RELATED: ['END'] } : {}, value: formatDuration(alarm.offset) };
  const props: Property[] = [{ name: 'ACTION', params: {}, value: alarm.action === 'EMAIL' ? 'EMAIL' : 'DISPLAY' }, trigger];
  props.push({ name: 'DESCRIPTION', params: {}, value: escapeText(title || 'Erinnerung') });
  if (alarm.action === 'EMAIL') props.push({ name: 'SUMMARY', params: {}, value: escapeText(title || 'Erinnerung') });
  return { name: 'VALARM', props, children: [] };
}

function writeTimes(component: Component, next: Instance, todo: boolean) {
  removeProps(component, 'DURATION');
  if (next.start === null) removeProps(component, 'DTSTART');
  else {
    const prop = timeProp('DTSTART', next.start, next.allDay, next.zone, next.floating);
    setProp(component, 'DTSTART', prop.value, prop.params);
  }
  if (todo) {
    if (next.due === null) removeProps(component, 'DUE');
    else {
      const prop = timeProp('DUE', next.due, next.allDay, next.zone, next.floating);
      setProp(component, 'DUE', prop.value, prop.params);
    }
    removeProps(component, 'DTEND');
    return;
  }
  if (next.start !== null && next.end !== null) {
    const prop = timeProp('DTEND', next.end, next.allDay, next.zone, next.floating);
    setProp(component, 'DTEND', prop.value, prop.params);
  } else removeProps(component, 'DTEND');
}

function writeInstance(component: Component, previous: Instance | null, next: Instance, todo: boolean) {
  const changed = (key: keyof Instance) => !previous || !same(previous[key], next[key]);
  if (changed('start') || changed('end') || changed('allDay') || changed('zone') || changed('floating') || changed('due')) {
    writeTimes(component, next, todo);
  }
  if (changed('title')) setText(component, 'SUMMARY', next.title);
  if (changed('description')) setText(component, 'DESCRIPTION', next.description);
  if (changed('location')) setText(component, 'LOCATION', next.location);
  if (changed('url')) setProp(component, 'URL', next.url || null, next.url ? { VALUE: ['URI'] } : {});
  if (changed('status')) setProp(component, 'STATUS', next.status);
  if (changed('transparency') && !todo) setProp(component, 'TRANSP', next.transparency);
  if (changed('privacy')) setProp(component, 'CLASS', next.privacy === 'PUBLIC' && !getProp(component, 'CLASS') ? null : next.privacy);
  if (changed('color')) {
    setProp(component, 'X-MOE-COLOR', next.color);
    setProp(component, 'COLOR', next.color ? colorName(next.color) : null);
  }
  if (changed('categories')) setProp(component, 'CATEGORIES', next.categories.length ? next.categories.map(escapeText).join(',') : null);
  if (changed('conference')) setText(component, 'X-MOE-CONFERENCE', next.conference);
  if (changed('organizer')) {
    setProp(
      component,
      'ORGANIZER',
      next.organizer ? `mailto:${next.organizer.email}` : null,
      next.organizer?.name ? { CN: [next.organizer.name] } : {}
    );
  }
  if (changed('attendees')) {
    const existing = new Map(getProps(component, 'ATTENDEE').map((prop) => [mailOf(prop.value), prop]));
    removeProps(component, 'ATTENDEE');
    for (const attendee of next.attendees) component.props.push(attendeeProp(attendee, existing.get(attendee.email)));
  }
  if (changed('alarms')) {
    component.children = component.children.filter((child) => child.name !== 'VALARM');
    for (const alarm of next.alarms) component.children.push(alarmComponent(alarm, next.title));
  } else if (changed('title')) {
    for (const child of component.children) {
      if (child.name !== 'VALARM') continue;
      setText(child, 'DESCRIPTION', next.title || 'Erinnerung');
      if (getProp(child, 'SUMMARY')) setText(child, 'SUMMARY', next.title || 'Erinnerung');
    }
  }
  if (todo) {
    if (changed('priority')) setProp(component, 'PRIORITY', next.priority ? String(next.priority) : null);
    if (changed('percent')) setProp(component, 'PERCENT-COMPLETE', next.percent ? String(next.percent) : null);
    if (changed('completed')) setProp(component, 'COMPLETED', next.completed ? formatUtc(next.completed) : null);
  }
}

function recurrenceProp(key: string, master: ItemData): Property {
  if (/^\d{8}$/.test(key)) return { name: 'RECURRENCE-ID', params: { VALUE: ['DATE'] }, value: key };
  const utc = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
    Number(key.slice(9, 11)),
    Number(key.slice(11, 13)),
    Number(key.slice(13, 15))
  );
  if (master.floating) return { name: 'RECURRENCE-ID', params: {}, value: formatLocal(utc, master.zone) };
  if (master.zone === 'UTC') return { name: 'RECURRENCE-ID', params: {}, value: formatUtc(utc) };
  return { name: 'RECURRENCE-ID', params: { TZID: [master.zone] }, value: formatLocal(utc, master.zone) };
}

function exdateProps(keys: string[], master: ItemData): Property[] {
  if (!keys.length) return [];
  if (master.allDay) return [{ name: 'EXDATE', params: { VALUE: ['DATE'] }, value: keys.map((key) => key.slice(0, 8)).join(',') }];
  const values = keys.map((key) => recurrenceProp(key, master));
  const params = values[0].params;
  return [{ name: 'EXDATE', params, value: values.map((value) => value.value).join(',') }];
}

function writeMaster(component: Component, previous: ItemData | null, next: ItemData, now: number) {
  writeInstance(component, previous, next, next.component === 'VTODO');
  const changed = (key: keyof ItemData) => !previous || !same(previous[key], next[key]);
  setText(component, 'UID', next.uid);
  if (changed('rrule')) setProp(component, 'RRULE', next.rrule);
  if (changed('exdates') || changed('zone') || changed('allDay') || changed('floating')) {
    removeProps(component, 'EXDATE');
    component.props.push(...exdateProps(next.exdates, next));
  }
  if (changed('rdates') || changed('zone') || changed('allDay')) {
    removeProps(component, 'RDATE');
    if (next.rdates.length) {
      const props = next.rdates.map((utc) => timeProp('RDATE', utc, next.allDay, next.zone, next.floating));
      component.props.push({ name: 'RDATE', params: props[0].params, value: props.map((prop) => prop.value).join(',') });
    }
  }
  if (changed('kind')) setProp(component, 'X-MOE-KIND', next.kind === 'event' ? null : next.kind.toUpperCase());
  if (changed('birthYear')) setProp(component, 'X-MOE-BIRTHYEAR', next.birthYear ? String(next.birthYear) : null);
  if (changed('assignee')) setProp(component, 'X-MOE-ASSIGNEE', next.assignee ? String(next.assignee) : null);
  if (changed('parent')) setText(component, 'RELATED-TO', next.parent);
  setProp(component, 'SEQUENCE', next.sequence ? String(next.sequence) : null);
  setProp(component, 'DTSTAMP', formatUtc(now));
  setProp(component, 'LAST-MODIFIED', formatUtc(now));
  if (!getProp(component, 'CREATED')) setProp(component, 'CREATED', formatUtc(next.created ?? now));
}

export function writeObject(previousText: string | null, previous: ItemData | null, next: ItemData, now = Date.now()): string {
  let source: Component | null = null;
  let components: Component[] = [];
  if (previousText) {
    const roots = parseICS(previousText);
    source = calendarOf(roots);
    if (source) components = groupByUid(source).get(previous?.uid ?? next.uid) ?? [];
  }
  const fallback = next.zone;
  const zones = zoneMap(source, fallback);
  let master = components.find((component) => !getProp(component, 'RECURRENCE-ID'));
  if (master && master.name !== next.component) master = undefined;
  const fresh = !master;
  if (!master) master = { name: next.component, props: [{ name: 'UID', params: {}, value: escapeText(next.uid) }], children: [] };
  writeMaster(master, fresh ? null : previous, next, now);
  const overrides: Component[] = [];
  for (const override of next.overrides) {
    const existing = components.find(
      (component) => component !== master && recurrenceKeyOf(component, next.allDay, zones, fallback) === override.recurrenceId
    );
    const before = previous?.overrides.find((entry) => entry.recurrenceId === override.recurrenceId) ?? null;
    const component: Component = existing ?? {
      name: next.component,
      props: [{ name: 'UID', params: {}, value: escapeText(next.uid) }, recurrenceProp(override.recurrenceId, next)],
      children: [],
    };
    if (!existing || !before || previous?.zone !== next.zone || previous?.allDay !== next.allDay) {
      const recurrence = recurrenceProp(override.recurrenceId, next);
      setProp(component, 'RECURRENCE-ID', recurrence.value, recurrence.params);
    }
    writeInstance(component, existing ? before : null, override, next.component === 'VTODO');
    setProp(component, 'SEQUENCE', next.sequence ? String(next.sequence) : null);
    setProp(component, 'DTSTAMP', formatUtc(now));
    overrides.push(component);
  }
  const year = new Date(next.start ?? next.due ?? now).getUTCFullYear();
  return serialize(wrap(source, [master, ...overrides], year));
}

export function blankInstance(zone: string): Instance {
  return {
    title: '',
    description: '',
    location: '',
    url: '',
    start: null,
    end: null,
    allDay: false,
    zone,
    floating: false,
    status: null,
    transparency: 'OPAQUE',
    privacy: 'PUBLIC',
    color: null,
    categories: [],
    alarms: [],
    organizer: null,
    attendees: [],
    conference: null,
    due: null,
    priority: 0,
    percent: 0,
    completed: null,
  };
}

export function blankItem(component: 'VEVENT' | 'VTODO', zone: string, uid: string = randomUUID()): ItemData {
  return {
    ...blankInstance(zone),
    component,
    uid,
    kind: 'event',
    birthYear: null,
    assignee: null,
    rrule: null,
    exdates: [],
    rdates: [],
    parent: null,
    sequence: 0,
    created: null,
    modified: null,
    overrides: [],
  };
}

export function seriesOf(data: ItemData): Series | null {
  const anchor = data.start ?? (data.component === 'VTODO' ? data.due : null);
  if (anchor === null) return null;
  const allDay = data.allDay;
  let date: string;
  let seconds = 0;
  if (allDay) date = keyOfDay(Math.floor(anchor / DAY));
  else {
    const local = formatLocal(anchor, data.zone);
    date = `${local.slice(0, 4)}-${local.slice(4, 6)}-${local.slice(6, 8)}`;
    seconds = Number(local.slice(9, 11)) * 3600 + Number(local.slice(11, 13)) * 60 + Number(local.slice(13, 15));
  }
  const rule = data.rrule ? parseRule(data.rrule) : null;
  return {
    start: { date, seconds, allDay, zone: allDay ? 'UTC' : data.zone },
    rule,
    rdates: data.rdates,
    exdates: new Set(data.exdates),
  };
}

export const durationOf = (data: Instance) => {
  if (data.start === null) return 0;
  if (data.end === null) return data.allDay ? DAY : 0;
  return Math.max(0, data.end - data.start);
};

export interface Expanded {
  recurrenceId: string | null;
  start: number;
  end: number;
  instance: Instance;
  override: boolean;
}

export function occurrences(data: ItemData, from: number, to: number, limit = 3000): Expanded[] {
  const series = seriesOf(data);
  if (!series) return [];
  const anchor = data.start ?? data.due!;
  const todo = data.component === 'VTODO';
  const shift = todo && data.start !== null && data.due !== null ? data.due - data.start : 0;
  const duration = todo ? (data.allDay ? DAY : 0) : durationOf(data);
  const recurring = Boolean(series.rule) || series.rdates.length > 0 || data.overrides.length > 0;
  if (!recurring) {
    const begin = anchor + shift;
    const end = begin + duration;
    if (begin < to && (end > from || (duration === 0 && begin >= from)))
      return [{ recurrenceId: null, start: begin, end, instance: data, override: false }];
    return [];
  }
  const out: Expanded[] = [];
  const overrides = new Map(data.overrides.map((entry) => [entry.recurrenceId, entry]));
  const padding = data.allDay ? 2 * DAY : 0;
  const list: Occurrence[] = expand(series, from - duration - padding, to + padding, limit);
  for (const occurrence of list) {
    if (overrides.has(occurrence.key)) continue;
    const start = occurrence.start + shift;
    const end = start + duration;
    if (start < to && (end > from || (duration === 0 && start >= from))) {
      out.push({ recurrenceId: occurrence.key, start, end, instance: data, override: false });
    }
  }
  for (const override of data.overrides) {
    if (override.status === 'CANCELLED') continue;
    const start = todo ? (override.due ?? override.start) : override.start;
    if (start === null) continue;
    const end = todo ? start + duration : (override.end ?? start + duration);
    if (start < to && (end > from || (end === start && start >= from))) {
      out.push({ recurrenceId: override.recurrenceId, start, end, instance: override, override: true });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function rangeEndOf(data: ItemData): number | null {
  const series = seriesOf(data);
  if (!series) return null;
  const duration = data.component === 'VTODO' ? DAY : durationOf(data);
  let max: number | null;
  if (!series.rule && !series.rdates.length) max = (data.start ?? data.due ?? 0) + duration;
  else {
    const last = lastOccurrence(series);
    if (!last && series.rule && !series.rule.count && !series.rule.until) return null;
    max = (last?.start ?? data.start ?? 0) + duration;
    for (const value of series.rdates) max = Math.max(max, value + duration);
  }
  for (const override of data.overrides) {
    const end = override.end ?? (override.start !== null ? override.start + duration : null);
    if (end !== null) max = Math.max(max, end);
  }
  return max;
}

export const isRecurringItem = (data: ItemData) => Boolean(data.rrule) || data.rdates.length > 0;

export function cloneData(data: ItemData): ItemData {
  return structuredClone(data);
}

export function instanceAt(data: ItemData, recurrenceId: string): Instance | null {
  const override = data.overrides.find((entry) => entry.recurrenceId === recurrenceId);
  if (override) return override;
  const series = seriesOf(data);
  if (!series) return null;
  const start = recurrenceStart(recurrenceId);
  if (start === null) return null;
  const duration = durationOf(data);
  return {
    ...pickInstance(data),
    start,
    end: data.component === 'VTODO' ? null : start + duration,
    due: data.component === 'VTODO' ? start : data.due,
  };
}

export function recurrenceStart(key: string): number | null {
  if (/^\d{8}$/.test(key)) return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(key);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

export function pickInstance(data: Instance): Instance {
  return {
    title: data.title,
    description: data.description,
    location: data.location,
    url: data.url,
    start: data.start,
    end: data.end,
    allDay: data.allDay,
    zone: data.zone,
    floating: data.floating,
    status: data.status,
    transparency: data.transparency,
    privacy: data.privacy,
    color: data.color,
    categories: [...data.categories],
    alarms: data.alarms.map((alarm) => ({ ...alarm })),
    organizer: data.organizer ? { ...data.organizer } : null,
    attendees: data.attendees.map((attendee) => ({ ...attendee })),
    conference: data.conference,
    due: data.due,
    priority: data.priority,
    percent: data.percent,
    completed: data.completed,
  };
}

export function exportCalendar(items: { ics: string }[], name: string, color: string | null, zone: string): string {
  const calendar: Component = {
    name: 'VCALENDAR',
    props: [
      { name: 'VERSION', params: {}, value: '2.0' },
      { name: 'PRODID', params: {}, value: PRODID },
      { name: 'CALSCALE', params: {}, value: 'GREGORIAN' },
      { name: 'METHOD', params: {}, value: 'PUBLISH' },
      { name: 'X-WR-CALNAME', params: {}, value: escapeText(name) },
      { name: 'X-WR-TIMEZONE', params: {}, value: zone },
      ...(color ? [{ name: 'X-APPLE-CALENDAR-COLOR', params: {}, value: color }] : []),
    ],
    children: [],
  };
  const zones = new Map<string, Component>();
  for (const item of items) {
    const roots = parseICS(item.ics);
    const source = calendarOf(roots);
    if (!source) continue;
    for (const child of source.children) {
      if (child.name === 'VTIMEZONE') {
        const id = getText(child, 'TZID');
        if (id && !zones.has(id)) zones.set(id, child);
      } else if (child.name === 'VEVENT' || child.name === 'VTODO') {
        removeProps(child, 'X-MOE-ASSIGNEE');
        calendar.children.push(child);
      }
    }
  }
  calendar.children.unshift(...zones.values());
  return serialize(calendar);
}

export const formatDate = formatDateValue;
