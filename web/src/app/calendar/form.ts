import { utcOf, wallOf } from '../../../../shared/time';
import { addDays, getZone } from './dates';
import type { AlarmSpec, Attendee, CalendarInfo, CalendarPrefs, EventDetail, EventPayload, ItemKind, Occurrence } from './model';

export interface AlarmRow {
  minutes: number;
  email: boolean;
}

export interface Form {
  component: 'VEVENT' | 'VTODO';
  kind: ItemKind;
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: number;
  endDate: string;
  endTime: number;
  hasDue: boolean;
  zone: string;
  rrule: string | null;
  location: string;
  conference: string;
  description: string;
  url: string;
  attendees: { email: string; name: string | null; role: Attendee['role']; status: Attendee['status'] }[];
  alarms: AlarmRow[];
  transparency: 'OPAQUE' | 'TRANSPARENT';
  privacy: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
  status: string | null;
  color: string | null;
  categories: string[];
  birthYear: number | null;
  assignee: number | null;
  priority: number;
  percent: number;
  completed: boolean;
}

const MINUTE = 60_000;

function split(utc: number, zone: string) {
  const wall = wallOf(utc, zone);
  const date = `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  return { date, time: wall.hour * 60 + wall.minute };
}

export function join(date: string, minutes: number, zone: string) {
  const [year, month, day] = date.split('-').map(Number);
  return utcOf({ year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 }, zone);
}

const utcDate = (utc: number) => new Date(utc).toISOString().slice(0, 10);

export function alarmRows(specs: AlarmSpec[]): AlarmRow[] {
  return specs.map((spec) => ({ minutes: spec.minutes, email: Boolean(spec.email) }));
}

export function newForm(options: {
  component: 'VEVENT' | 'VTODO';
  kind?: ItemKind;
  calendar: CalendarInfo | null;
  prefs: CalendarPrefs;
  start?: number;
  end?: number;
  allDay?: boolean;
  title?: string;
}): Form {
  const zone = getZone();
  const allDay = options.allDay ?? (options.kind === 'birthday' || options.kind === 'ooo');
  const now = Date.now();
  const roundedNow = Math.ceil(now / (30 * MINUTE)) * 30 * MINUTE;
  const start = options.start ?? roundedNow;
  const end = options.end ?? start + (options.kind === 'focus' ? 120 : options.prefs.duration) * MINUTE;
  let startDate: string;
  let endDate: string;
  let startTime: number;
  let endTime: number;
  if (allDay) {
    startDate = options.start !== undefined && options.allDay ? utcDate(start) : split(start, zone).date;
    endDate = options.end !== undefined && options.allDay ? addDays(utcDate(end), -1) : startDate;
    if (endDate < startDate) endDate = startDate;
    startTime = options.prefs.workStart;
    endTime = Math.min(1439, startTime + options.prefs.duration);
  } else {
    ({ date: startDate, time: startTime } = split(start, zone));
    ({ date: endDate, time: endTime } = split(end, zone));
  }
  const calendarAlarms = options.calendar ? (allDay ? options.calendar.alldayAlarms : options.calendar.alarms) : null;
  return {
    component: options.component,
    kind: options.kind ?? 'event',
    calendarId: options.calendar?.id ?? '',
    title: options.title ?? '',
    allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    hasDue: options.component === 'VTODO' ? options.start !== undefined : true,
    zone,
    rrule: options.kind === 'birthday' ? 'FREQ=YEARLY' : null,
    location: '',
    conference: '',
    description: '',
    url: '',
    attendees: [],
    alarms: options.component === 'VTODO' ? [] : alarmRows(calendarAlarms ?? (allDay ? options.prefs.alldayAlarms : options.prefs.alarms)),
    transparency: options.kind === 'birthday' ? 'TRANSPARENT' : 'OPAQUE',
    privacy: 'PUBLIC',
    status: null,
    color: null,
    categories: [],
    birthYear: null,
    assignee: null,
    priority: 0,
    percent: 0,
    completed: false,
  };
}

export function formFromDetail(detail: EventDetail, occurrence?: Pick<Occurrence, 'start' | 'end'> | null): Form {
  const data = detail.data;
  const base = detail.instance ?? data;
  const todo = data.component === 'VTODO';
  const zone = base.floating ? getZone() : base.zone || getZone();
  const allDay = base.allDay;
  const startUtc = todo ? (base.due ?? base.start) : (base.start ?? occurrence?.start ?? Date.now());
  const endUtc = todo ? startUtc : (base.end ?? occurrence?.end ?? (startUtc ?? Date.now()) + 3_600_000);
  let startDate: string;
  let startTime: number;
  let endDate: string;
  let endTime: number;
  if (startUtc === null) {
    startDate = split(Date.now(), zone).date;
    startTime = 9 * 60;
    endDate = startDate;
    endTime = 10 * 60;
  } else if (allDay) {
    startDate = utcDate(startUtc);
    endDate = todo ? startDate : addDays(utcDate(endUtc ?? startUtc + 86_400_000), -1);
    if (endDate < startDate) endDate = startDate;
    startTime = 9 * 60;
    endTime = 10 * 60;
  } else {
    ({ date: startDate, time: startTime } = split(startUtc, zone));
    ({ date: endDate, time: endTime } = split(endUtc ?? startUtc, zone));
  }
  return {
    component: data.component,
    kind: data.kind,
    calendarId: detail.calendarId,
    title: base.title,
    allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    hasDue: !todo || startUtc !== null,
    zone,
    rrule: data.rrule,
    location: base.location,
    conference: base.conference ?? '',
    description: base.description,
    url: base.url,
    attendees: base.attendees.map((attendee) => ({
      email: attendee.email,
      name: attendee.name,
      role: attendee.role,
      status: attendee.status,
    })),
    alarms: base.alarms
      .filter((alarm) => alarm.absolute === null && alarm.related === 'START')
      .map((alarm) => ({ minutes: Math.round(-alarm.offset / MINUTE), email: alarm.action === 'EMAIL' })),
    transparency: base.transparency,
    privacy: base.privacy,
    status: base.status,
    color: base.color,
    categories: base.categories,
    birthYear: data.birthYear,
    assignee: data.assignee ?? null,
    priority: base.priority,
    percent: base.percent,
    completed: base.completed !== null || base.status === 'COMPLETED',
  };
}

export function timesOf(form: Form) {
  if (form.component === 'VTODO') {
    if (!form.hasDue) return { start: null, end: null, due: null };
    const due = form.allDay ? form.startDate : join(form.startDate, form.startTime, form.zone);
    return { start: null, end: null, due };
  }
  if (form.allDay) return { start: form.startDate, end: addDays(form.endDate, 1), due: null };
  return { start: join(form.startDate, form.startTime, form.zone), end: join(form.endDate, form.endTime, form.zone), due: null };
}

export function payloadOf(form: Form): EventPayload {
  const times = timesOf(form);
  const payload: EventPayload = {
    component: form.component,
    title: form.title.trim(),
    description: form.description,
    location: form.location.trim(),
    url: form.url.trim(),
    conference: form.conference.trim() || null,
    allDay: form.allDay,
    zone: form.zone,
    rrule: form.rrule,
    transparency: form.transparency,
    privacy: form.privacy,
    color: form.color,
    categories: form.categories,
    alarms: form.alarms.map((alarm) => ({ offset: -alarm.minutes * MINUTE, related: 'START', action: alarm.email ? 'EMAIL' : 'DISPLAY' })),
    attendees: form.attendees.map((attendee) => ({ email: attendee.email, name: attendee.name, role: attendee.role })),
  };
  if (form.component === 'VTODO') {
    payload.due = times.due;
    payload.priority = form.priority;
    payload.percent = form.percent;
    payload.assignee = form.assignee;
    payload.completed = form.completed;
    payload.status = form.completed ? 'COMPLETED' : form.status === 'COMPLETED' ? 'NEEDS-ACTION' : form.status;
    delete payload.attendees;
  } else {
    payload.start = times.start;
    payload.end = times.end;
    payload.status = form.status;
    payload.kind = form.kind;
    payload.birthYear = form.kind === 'birthday' ? form.birthYear : null;
  }
  return payload;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changesOf(initial: Form, current: Form): EventPayload {
  const before = payloadOf(initial);
  const after = payloadOf(current);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof EventPayload)[]) {
    if (!same(before[key], after[key])) out[key] = after[key];
  }
  if ('start' in out || 'end' in out || 'allDay' in out || 'zone' in out) {
    out.start = after.start;
    out.end = after.end;
    out.allDay = after.allDay;
  }
  if ('due' in out || ('allDay' in out && current.component === 'VTODO')) {
    out.due = after.due;
    out.allDay = after.allDay;
  }
  return out as EventPayload;
}

export function validate(form: Form) {
  if (form.component === 'VEVENT') {
    const times = timesOf(form);
    if (form.allDay) {
      if (form.endDate < form.startDate) return 'Das Ende liegt vor dem Beginn';
    } else if ((times.end as number) <= (times.start as number)) return 'Das Ende liegt vor dem Beginn';
  }
  if (form.conference.trim() && !/^https?:\/\//i.test(form.conference.trim()))
    return 'Der Link zur Videokonferenz muss mit http:// oder https:// beginnen';
  if (form.attendees.some((attendee) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.email))) return 'Eine der E-Mail-Adressen ist ungültig';
  return null;
}

export function jitsiLink() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const id = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `https://meet.jit.si/MoeCloud-${id}`;
}
