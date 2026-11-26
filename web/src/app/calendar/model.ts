import { api } from '../../lib/api';
import { t } from '../../lib/i18n';

export type Access = 'owner' | 'write' | 'read' | 'freebusy';
export type View = 'day' | 'week' | 'workweek' | 'days3' | 'month' | 'year' | 'agenda' | 'tasks';
export type PartStat = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'DELEGATED';
export type ItemKind = 'event' | 'birthday' | 'focus' | 'ooo';

export interface AlarmSpec {
  minutes: number;
  email?: boolean;
}

export interface CalendarInfo {
  id: string;
  name: string;
  description: string;
  color: string;
  kind: 'local' | 'subscription';
  components: string[];
  zone: string | null;
  position: number;
  hidden: boolean;
  access: Access;
  owner: { id: number; name: string; username: string; initials: string };
  alarms: AlarmSpec[] | null;
  alldayAlarms: AlarmSpec[] | null;
  publicToken: string | null;
  publicMode: 'details' | 'busy' | null;
  sourceUrl: string | null;
  refreshMinutes: number | null;
  syncedAt: number | null;
  syncError: string | null;
  shares: number;
  notify: boolean;
  count: number;
  slug: string;
}

export interface CalendarPrefs {
  view: View;
  weekStart: 0 | 1 | 6;
  slot: 15 | 30 | 60;
  scrollTo: number;
  workStart: number;
  workEnd: number;
  workDays: number[];
  weekends: boolean;
  weekNumbers: boolean;
  declined: boolean;
  dimPast: boolean;
  zone2: string | null;
  duration: number;
  alarms: AlarmSpec[];
  alldayAlarms: AlarmSpec[];
  holidays: string[];
  observances: boolean;
  moon: boolean;
  emoji: boolean;
  tasksInCalendar: boolean;
  completedTasks: boolean;
  density: 'comfortable' | 'compact';
  defaultCalendar: string | null;
  freebusy: boolean;
  agenda: 'off' | 'daily' | 'weekly';
  agendaTime: number;
  colorBy: 'calendar' | 'category';
  hideTitle: boolean;
}

export interface Occurrence {
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
  holiday?: 'holiday' | 'observance';
  contactId?: string;
}

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
  role: 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'CHAIR' | 'NON-PARTICIPANT';
  rsvp: boolean;
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
  organizer: { email: string; name: string | null } | null;
  attendees: Attendee[];
  conference: string | null;
  due: number | null;
  priority: number;
  percent: number;
  completed: number | null;
}

export interface ItemData extends Instance {
  component: 'VEVENT' | 'VTODO';
  uid: string;
  kind: ItemKind;
  birthYear: number | null;
  assignee?: number | null;
  rrule: string | null;
  exdates: string[];
  rdates: number[];
  parent: string | null;
  sequence: number;
  created: number | null;
  modified: number | null;
  overrides: (Instance & { recurrenceId: string })[];
}

export interface EventDetail {
  id: string;
  etag: string;
  calendarId: string;
  calendar: { id: string; name: string; color: string; owner: string; kind: string };
  access: Access;
  invited: boolean;
  myStatus: PartStat | null;
  isOrganizer: boolean;
  readOnly: boolean;
  busyOnly: boolean;
  data: ItemData;
  instance: Instance | null;
  recurrenceId: string | null;
  attendeeInfo: { email: string; internal: boolean; respondedAt: number | null; comment: string | null }[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  recurrence: string | null;
}

export interface Task {
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
  assignee?: { id: number; name: string; initials: string } | null;
  createdAt: number;
}

export interface Member {
  id: number;
  name: string;
  initials: string;
  avatar: string | null;
}

export interface EventPayload {
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
  alarms?: { offset: number; related?: 'START' | 'END'; absolute?: number | null; action?: 'DISPLAY' | 'EMAIL' }[];
  attendees?: { email: string; name?: string | null; role?: Attendee['role'] }[];
  kind?: ItemKind;
  birthYear?: number | null;
  assignee?: number | null;
  priority?: number;
  percent?: number;
  completed?: boolean;
  parent?: string | null;
}

export type Scope = 'all' | 'this' | 'following';

export const calendarApi = {
  list: () => api.get<{ calendars: CalendarInfo[]; prefs: CalendarPrefs; zone: string }>('/api/calendar/calendars'),
  occurrences: (from: number, to: number, signal?: AbortSignal) =>
    api.get<{ items: Occurrence[] }>(`/api/calendar/occurrences?from=${from}&to=${to}`, signal),
  detail: (id: string, rid?: string | null) => api.get<EventDetail>(`/api/calendar/events/${id}${rid ? `?rid=${rid}` : ''}`),
  create: (payload: EventPayload & { calendarId: string }) => api.post<{ id: string; etag: string }>('/api/calendar/events', payload),
  update: (id: string, changes: EventPayload, scope: Scope = 'all', recurrenceId: string | null = null) =>
    api.patch<{ id: string; etag: string; created: string | null }>(`/api/calendar/events/${id}`, { changes, scope, recurrenceId }),
  remove: (id: string, scope: Scope = 'all', recurrenceId: string | null = null) =>
    api.delete<{ trashed: boolean; days: number }>(
      `/api/calendar/events/${id}?scope=${scope}${recurrenceId ? `&rid=${recurrenceId}` : ''}`
    ),
  restore: (id: string) => api.post(`/api/calendar/events/${id}/restore`, {}),
  duplicate: (id: string, recurrenceId: string | null, calendarId?: string) =>
    api.post<{ id: string }>(`/api/calendar/events/${id}/duplicate`, { recurrenceId, calendarId }),
  rsvp: (id: string, status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE', comment?: string) =>
    api.post(`/api/calendar/events/${id}/rsvp`, { status, comment }),
  hide: (id: string, hidden: boolean) => api.post(`/api/calendar/events/${id}/hide`, { hidden }),
  complete: (id: string, completed: boolean, recurrenceId: string | null) =>
    api.post(`/api/calendar/events/${id}/complete`, { completed, recurrenceId }),
  members: (id: string) => api.get<{ members: Member[] }>(`/api/calendar/calendars/${id}/members`).then((result) => result.members),
  prefs: (patch: Partial<CalendarPrefs>) => api.patch<{ prefs: CalendarPrefs }>('/api/calendar/prefs', patch),
  updateCalendar: (id: string, patch: Record<string, unknown>) =>
    api.patch<{ calendar: CalendarInfo | null }>(`/api/calendar/calendars/${id}`, patch),
};

export const PALETTE = [
  '#8b5cf6',
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#06b6d4',
  '#14b8a6',
  '#10b981',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#f43f5e',
  '#ec4899',
  '#d946ef',
  '#a855f7',
  '#78716c',
  '#64748b',
];

export function colorName(hex: string) {
  const names: Record<string, string> = {
    '#8b5cf6': t('Violett'),
    '#6366f1': t('Indigo'),
    '#3b82f6': t('Blau'),
    '#0ea5e9': t('Himmelblau'),
    '#06b6d4': t('Cyan'),
    '#14b8a6': t('Türkis'),
    '#10b981': t('Smaragd'),
    '#22c55e': t('Grün'),
    '#84cc16': t('Limette'),
    '#eab308': t('Gelb'),
    '#f59e0b': t('Bernstein'),
    '#f97316': t('Orange'),
    '#ef4444': t('Rot'),
    '#f43f5e': t('Rose'),
    '#ec4899': t('Pink'),
    '#d946ef': t('Fuchsia'),
    '#a855f7': t('Lila'),
    '#78716c': t('Stein'),
    '#64748b': t('Schiefer'),
  };
  return names[hex.toLowerCase()] ?? hex;
}

export const VIDEO_PROVIDERS: [RegExp, string][] = [
  [/meet\.jit\.si|jitsi/i, 'Jitsi'],
  [/zoom\.us/i, 'Zoom'],
  [/meet\.google\.com/i, 'Google Meet'],
  [/teams\.microsoft\.com|teams\.live\.com/i, 'Microsoft Teams'],
  [/webex\.com/i, 'Webex'],
  [/whereby\.com/i, 'Whereby'],
  [/bigbluebutton|bbb\./i, 'BigBlueButton'],
  [/discord\.(gg|com)/i, 'Discord'],
];

export function videoProvider(url: string | null | undefined) {
  if (!url) return null;
  return VIDEO_PROVIDERS.find(([pattern]) => pattern.test(url))?.[1] ?? null;
}

export function findVideoLink(text: string) {
  const match = /https?:\/\/[^\s<>"]+/g;
  for (const found of text.match(match) ?? []) if (videoProvider(found)) return found;
  return null;
}
