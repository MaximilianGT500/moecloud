import { all, one, placeholders, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { isZone } from '../../shared/time.ts';
import * as settings from '../services/settings.ts';
import { getUser, initials, preferredLanguage, prefsOf, updatePrefs, type AlarmSpec, type UserRow } from '../services/users.ts';

export type Access = 'owner' | 'write' | 'read' | 'freebusy';
export type CalendarKind = 'local' | 'subscription';

export interface CalendarRow {
  id: string;
  owner_id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  kind: CalendarKind;
  components: string;
  zone: string | null;
  position: number;
  hidden: number;
  alarms: string | null;
  allday_alarms: string | null;
  public_token: string | null;
  public_mode: 'details' | 'busy' | null;
  source_url: string | null;
  refresh_minutes: number | null;
  synced_at: number | null;
  sync_error: string | null;
  sync_etag: string | null;
  sync_failures: number;
  revision: number;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

export interface ShareRow {
  calendar_id: string;
  user_id: number;
  permission: 'freebusy' | 'read' | 'write';
  color: string | null;
  hidden: number;
  position: number;
  notify: number;
  created_by: number | null;
  created_at: number;
}

export const CALENDAR_COLORS = [
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f97316',
  '#ec4899',
  '#06b6d4',
  '#eab308',
  '#ef4444',
  '#14b8a6',
  '#a855f7',
  '#84cc16',
  '#64748b',
];

const RANK: Record<Access, number> = { freebusy: 1, read: 2, write: 3, owner: 4 };

export const atLeast = (access: Access, need: Access) => RANK[access] >= RANK[need];

export const getCalendar = (id: string) => one<CalendarRow>('SELECT * FROM calendars WHERE id = ?', id);

export function accessOf(user: Pick<UserRow, 'id'>, calendar: CalendarRow): Access | null {
  if (calendar.owner_id === user.id) return 'owner';
  if (calendar.trashed_at) return null;
  const share = one<ShareRow>('SELECT * FROM calendar_shares WHERE calendar_id = ? AND user_id = ?', calendar.id, user.id);
  if (!share) return null;
  if (calendar.kind === 'subscription' && share.permission === 'write') return 'read';
  return share.permission;
}

export function requireCalendar(user: Pick<UserRow, 'id'>, id: string, need: Access = 'read') {
  const calendar = getCalendar(id);
  const access = calendar ? accessOf(user, calendar) : null;
  if (!calendar || !access) throw notFound('Diesen Kalender gibt es nicht');
  if (!atLeast(access, need)) throw forbidden('Dafür fehlen dir in diesem Kalender die Rechte');
  if (need !== 'owner' && calendar.trashed_at) throw notFound('Dieser Kalender liegt im Papierkorb');
  if (need === 'write' && calendar.kind === 'subscription') throw forbidden('Abonnierte Kalender lassen sich nur lesen');
  return { calendar, access };
}

export function writable(user: Pick<UserRow, 'id'>, calendar: CalendarRow) {
  const access = accessOf(user, calendar);
  return Boolean(access && atLeast(access, 'write') && calendar.kind === 'local' && !calendar.trashed_at);
}

export function audienceOf(calendarId: string): number[] {
  const calendar = getCalendar(calendarId);
  if (!calendar) return [];
  return [
    calendar.owner_id,
    ...all<{ user_id: number }>('SELECT user_id FROM calendar_shares WHERE calendar_id = ?', calendarId).map((row) => row.user_id),
  ];
}

export function touchCalendar(calendarId: string, href: string | null, deleted = false) {
  run('UPDATE calendars SET revision = revision + 1, updated_at = ? WHERE id = ?', Date.now(), calendarId);
  if (href) {
    const revision = value<number>('SELECT revision FROM calendars WHERE id = ?', calendarId) ?? 1;
    run(
      `INSERT INTO changes (calendar_id, href, revision, deleted) VALUES (?, ?, ?, ?)
       ON CONFLICT (calendar_id, href) DO UPDATE SET revision = excluded.revision, deleted = excluded.deleted`,
      calendarId,
      href,
      revision,
      deleted
    );
  }
}

let pending = new Map<number, Set<string>>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function announce(calendarIds: string[], extra: number[] = []) {
  for (const id of calendarIds) {
    for (const userId of [...audienceOf(id), ...extra]) {
      let set = pending.get(userId);
      if (!set) {
        set = new Set();
        pending.set(userId, set);
      }
      set.add(id);
    }
  }
  if (!calendarIds.length) for (const userId of extra) pending.set(userId, pending.get(userId) ?? new Set());
  if (timer) return;
  timer = setTimeout(() => {
    const batch = pending;
    pending = new Map();
    timer = null;
    for (const [userId, ids] of batch) publish([userId], 'events', { calendars: [...ids] });
  }, 60);
  timer.unref?.();
}

export function announceCalendars(userIds: number[]) {
  publish(userIds, 'calendars', { at: Date.now() });
}

function alarmsOf(text: string | null, fallback: AlarmSpec[]): AlarmSpec[] {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as AlarmSpec[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function calendarAlarms(calendar: CalendarRow, user: UserRow) {
  const prefs = prefsOf(user).calendar;
  return { timed: alarmsOf(calendar.alarms, prefs.alarms), allDay: alarmsOf(calendar.allday_alarms, prefs.alldayAlarms) };
}

function nextColor(ownerId: number) {
  const count = value<number>('SELECT COUNT(*) FROM calendars WHERE owner_id = ?', ownerId) ?? 0;
  return CALENDAR_COLORS[count % CALENDAR_COLORS.length];
}

export const validColor = (color: unknown): color is string => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);

export interface CalendarInput {
  name: string;
  color?: string;
  description?: string | null;
  components?: string;
  zone?: string | null;
  slug?: string;
  kind?: CalendarKind;
  sourceUrl?: string | null;
  refreshMinutes?: number | null;
  alarms?: AlarmSpec[] | null;
  alldayAlarms?: AlarmSpec[] | null;
}

export function insertCalendar(owner: Pick<UserRow, 'id'>, input: CalendarInput): CalendarRow {
  const id = randomId(16);
  const slug = input.slug ?? id;
  if (one('SELECT 1 FROM calendars WHERE owner_id = ? AND slug = ?', owner.id, slug)) throw conflict('Diesen Kalender gibt es schon');
  const now = Date.now();
  const position = (value<number>('SELECT MAX(position) FROM calendars WHERE owner_id = ?', owner.id) ?? -1) + 1;
  run(
    `INSERT INTO calendars (id, owner_id, slug, name, description, color, kind, components, zone, position, alarms, allday_alarms, source_url, refresh_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    owner.id,
    slug,
    input.name.trim().slice(0, 100) || 'Kalender',
    input.description?.trim().slice(0, 2000) || null,
    validColor(input.color) ? input.color.toLowerCase() : nextColor(owner.id),
    input.kind ?? 'local',
    input.components ?? 'VEVENT,VTODO',
    input.zone && isZone(input.zone) ? input.zone : null,
    position,
    input.alarms ? JSON.stringify(input.alarms) : null,
    input.alldayAlarms ? JSON.stringify(input.alldayAlarms) : null,
    input.sourceUrl ?? null,
    input.refreshMinutes ?? null,
    now,
    now
  );
  announceCalendars([owner.id]);
  return getCalendar(id)!;
}

export function createDefaultCalendar(user: UserRow) {
  const lang = preferredLanguage(user);
  return insertCalendar(user, { name: lang === 'en' ? 'Personal' : 'Persönlich', color: CALENDAR_COLORS[0] });
}

export function ownCalendars(userId: number, includeTrashed = false) {
  return all<CalendarRow>(
    `SELECT * FROM calendars WHERE owner_id = ? ${includeTrashed ? '' : 'AND trashed_at IS NULL'} ORDER BY position, created_at`,
    userId
  );
}

export function sharedCalendars(userId: number) {
  return all<
    CalendarRow & {
      share_permission: ShareRow['permission'];
      share_color: string | null;
      share_hidden: number;
      share_position: number;
      share_notify: number;
    }
  >(
    `SELECT c.*, s.permission AS share_permission, s.color AS share_color, s.hidden AS share_hidden, s.position AS share_position, s.notify AS share_notify
     FROM calendar_shares s JOIN calendars c ON c.id = s.calendar_id
     WHERE s.user_id = ? AND c.trashed_at IS NULL ORDER BY s.position, c.name`,
    userId
  );
}

export function accessibleCalendarIds(userId: number, need: Access = 'freebusy') {
  const own = ownCalendars(userId).map((calendar) => calendar.id);
  const shared = sharedCalendars(userId)
    .filter((calendar) => atLeast(calendar.share_permission, need))
    .map((calendar) => calendar.id);
  return [...own, ...shared];
}

export interface CalendarView {
  id: string;
  name: string;
  description: string;
  color: string;
  kind: CalendarKind;
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
  trashedAt: number | null;
}

function parseAlarmList(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text) as AlarmSpec[];
  } catch {
    return null;
  }
}

const owners = new Map<number, CalendarView['owner']>();

function ownerOf(id: number) {
  let found = owners.get(id);
  if (!found) {
    const user = getUser(id);
    found = { id, name: user?.name ?? '?', username: user?.username ?? '', initials: initials(user?.name ?? '?') };
    owners.set(id, found);
    setTimeout(() => owners.delete(id), 60_000).unref?.();
  }
  return found;
}

export function presentCalendar(
  calendar: CalendarRow,
  access: Access,
  overrides: { color?: string | null; hidden?: number; position?: number; notify?: number } = {}
): CalendarView {
  const owner = access === 'owner';
  return {
    id: calendar.id,
    name: calendar.name,
    description: calendar.description ?? '',
    color: overrides.color ?? calendar.color,
    kind: calendar.kind,
    components: calendar.components.split(',').filter(Boolean),
    zone: calendar.zone,
    position: overrides.position ?? calendar.position,
    hidden: Boolean(overrides.hidden ?? calendar.hidden),
    access,
    owner: ownerOf(calendar.owner_id),
    alarms: owner ? parseAlarmList(calendar.alarms) : null,
    alldayAlarms: owner ? parseAlarmList(calendar.allday_alarms) : null,
    publicToken: owner ? calendar.public_token : null,
    publicMode: owner ? calendar.public_mode : null,
    sourceUrl: owner || access !== 'freebusy' ? calendar.source_url : null,
    refreshMinutes: calendar.refresh_minutes,
    syncedAt: calendar.synced_at,
    syncError: owner ? calendar.sync_error : null,
    shares: owner ? (value<number>('SELECT COUNT(*) FROM calendar_shares WHERE calendar_id = ?', calendar.id) ?? 0) : 0,
    notify: owner ? true : Boolean(overrides.notify),
    count: value<number>('SELECT COUNT(*) FROM events WHERE calendar_id = ? AND trashed_at IS NULL', calendar.id) ?? 0,
    slug: calendar.slug,
    trashedAt: calendar.trashed_at,
  };
}

export function ensureCalendars(user: UserRow) {
  if (prefsOf(user).calendarSeeded) return;
  if (!value<number>('SELECT 1 FROM calendars WHERE owner_id = ? LIMIT 1', user.id)) createDefaultCalendar(user);
  updatePrefs(user.id, { calendarSeeded: true });
}

export function listCalendars(user: UserRow) {
  ensureCalendars(user);
  const own = ownCalendars(user.id).map((calendar) => presentCalendar(calendar, 'owner'));
  const shared = sharedCalendars(user.id).map((calendar) =>
    presentCalendar(
      calendar,
      calendar.kind === 'subscription' && calendar.share_permission === 'write' ? 'read' : calendar.share_permission,
      {
        color: calendar.share_color,
        hidden: calendar.share_hidden,
        position: calendar.share_position,
        notify: calendar.share_notify,
      }
    )
  );
  return [...own, ...shared];
}

export interface CalendarPatch {
  name?: string;
  color?: string;
  description?: string | null;
  hidden?: boolean;
  zone?: string | null;
  alarms?: AlarmSpec[] | null;
  alldayAlarms?: AlarmSpec[] | null;
  refreshMinutes?: number | null;
  sourceUrl?: string;
  notify?: boolean;
}

export function updateCalendar(user: UserRow, id: string, patch: CalendarPatch) {
  const { calendar, access } = requireCalendar(user, id, 'freebusy');
  if (access !== 'owner') {
    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.color !== undefined) {
      if (!validColor(patch.color)) throw badRequest('Die Farbe muss als Hex-Wert wie #8b5cf6 angegeben werden');
      updates.push('color = ?');
      params.push(patch.color.toLowerCase());
    }
    if (patch.hidden !== undefined) {
      updates.push('hidden = ?');
      params.push(patch.hidden ? 1 : 0);
    }
    if (patch.notify !== undefined) {
      updates.push('notify = ?');
      params.push(patch.notify ? 1 : 0);
    }
    if (updates.length)
      run(`UPDATE calendar_shares SET ${updates.join(', ')} WHERE calendar_id = ? AND user_id = ?`, ...params, id, user.id);
    announceCalendars([user.id]);
    return;
  }
  const now = Date.now();
  if (patch.name !== undefined) run('UPDATE calendars SET name = ? WHERE id = ?', patch.name.trim().slice(0, 100) || calendar.name, id);
  if (patch.color !== undefined) {
    if (!validColor(patch.color)) throw badRequest('Die Farbe muss als Hex-Wert wie #8b5cf6 angegeben werden');
    run('UPDATE calendars SET color = ? WHERE id = ?', patch.color.toLowerCase(), id);
  }
  if (patch.description !== undefined)
    run('UPDATE calendars SET description = ? WHERE id = ?', patch.description?.trim().slice(0, 2000) || null, id);
  if (patch.hidden !== undefined) run('UPDATE calendars SET hidden = ? WHERE id = ?', patch.hidden ? 1 : 0, id);
  if (patch.zone !== undefined) run('UPDATE calendars SET zone = ? WHERE id = ?', patch.zone && isZone(patch.zone) ? patch.zone : null, id);
  if (patch.alarms !== undefined)
    run('UPDATE calendars SET alarms = ? WHERE id = ?', patch.alarms ? JSON.stringify(patch.alarms) : null, id);
  if (patch.alldayAlarms !== undefined) {
    run('UPDATE calendars SET allday_alarms = ? WHERE id = ?', patch.alldayAlarms ? JSON.stringify(patch.alldayAlarms) : null, id);
  }
  if (patch.refreshMinutes !== undefined && calendar.kind === 'subscription') {
    const minimum = Math.max(5, settings.get('calendar.minRefresh'));
    run('UPDATE calendars SET refresh_minutes = ? WHERE id = ?', Math.max(minimum, patch.refreshMinutes ?? 60), id);
  }
  run('UPDATE calendars SET updated_at = ?, revision = revision + 1 WHERE id = ?', now, id);
  announceCalendars(audienceOf(id));
  announce([id]);
}

export function reorderCalendars(user: UserRow, ids: string[]) {
  tx(() => {
    ids.forEach((id, index) => {
      if (run('UPDATE calendars SET position = ? WHERE id = ? AND owner_id = ?', index, id, user.id).changes === 0) {
        run('UPDATE calendar_shares SET position = ? WHERE calendar_id = ? AND user_id = ?', index, id, user.id);
      }
    });
  });
  announceCalendars([user.id]);
}

export function trashCalendar(user: UserRow, id: string) {
  const { calendar } = requireCalendar(user, id, 'owner');
  const active =
    value<number>('SELECT COUNT(*) FROM calendars WHERE owner_id = ? AND trashed_at IS NULL AND kind = ?', user.id, 'local') ?? 0;
  if (calendar.kind === 'local' && active <= 1) throw badRequest('Du brauchst mindestens einen eigenen Kalender');
  const audience = audienceOf(id);
  run('UPDATE calendars SET trashed_at = ?, revision = revision + 1 WHERE id = ?', Date.now(), id);
  run('DELETE FROM alarms WHERE event_id IN (SELECT id FROM events WHERE calendar_id = ?)', id);
  announceCalendars(audience);
  return calendar;
}

export function restoreCalendar(user: UserRow, id: string) {
  const { calendar } = requireCalendar(user, id, 'owner');
  if (!calendar.trashed_at) return calendar;
  run('UPDATE calendars SET trashed_at = NULL, revision = revision + 1 WHERE id = ?', id);
  announceCalendars(audienceOf(id));
  return getCalendar(id)!;
}

export function deleteCalendarForever(user: UserRow, id: string) {
  requireCalendar(user, id, 'owner');
  const audience = audienceOf(id);
  run('DELETE FROM calendars WHERE id = ?', id);
  announceCalendars(audience);
}

export function purgeCalendars(days: number) {
  if (days <= 0) return 0;
  return run('DELETE FROM calendars WHERE trashed_at IS NOT NULL AND trashed_at < ?', Date.now() - days * 86_400_000).changes;
}

export function listShares(user: UserRow, id: string) {
  requireCalendar(user, id, 'owner');
  return all<ShareRow & { name: string; username: string; email: string | null }>(
    `SELECT s.*, u.name, u.username, u.email FROM calendar_shares s JOIN users u ON u.id = s.user_id WHERE s.calendar_id = ? ORDER BY u.name`,
    id
  ).map((row) => ({
    userId: row.user_id,
    name: row.name,
    username: row.username,
    email: row.email,
    initials: initials(row.name),
    permission: row.permission,
    createdAt: row.created_at,
  }));
}

export function setShare(user: UserRow, id: string, targetId: number, permission: ShareRow['permission']) {
  const { calendar } = requireCalendar(user, id, 'owner');
  if (targetId === user.id) throw badRequest('Mit dir selbst musst du nichts teilen');
  const target = getUser(targetId);
  if (!target || target.disabled || target.role === 'guest' || target.role === 'team') throw notFound('Diese Person gibt es nicht');
  const existing = one<ShareRow>('SELECT * FROM calendar_shares WHERE calendar_id = ? AND user_id = ?', id, targetId);
  if (existing) run('UPDATE calendar_shares SET permission = ? WHERE calendar_id = ? AND user_id = ?', permission, id, targetId);
  else {
    const position = (value<number>('SELECT MAX(position) FROM calendar_shares WHERE user_id = ?', targetId) ?? 100) + 1;
    run(
      'INSERT INTO calendar_shares (calendar_id, user_id, permission, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      targetId,
      permission,
      position,
      user.id,
      Date.now()
    );
  }
  run('UPDATE calendars SET revision = revision + 1 WHERE id = ?', id);
  announceCalendars([user.id, targetId]);
  return { calendar, target, created: !existing };
}

export function removeShare(user: UserRow, id: string, targetId: number) {
  const calendar = getCalendar(id);
  if (!calendar) throw notFound('Diesen Kalender gibt es nicht');
  if (calendar.owner_id !== user.id && targetId !== user.id) throw forbidden();
  run('DELETE FROM calendar_shares WHERE calendar_id = ? AND user_id = ?', id, targetId);
  announceCalendars([calendar.owner_id, targetId]);
}

export function setPublic(user: UserRow, id: string, mode: 'details' | 'busy' | null, renew = false) {
  const { calendar } = requireCalendar(user, id, 'owner');
  if (mode && !settings.get('calendar.publicLinks')) throw forbidden('Öffentliche Links sind auf diesem Server ausgeschaltet');
  if (!mode) run('UPDATE calendars SET public_token = NULL, public_mode = NULL WHERE id = ?', id);
  else {
    const token = calendar.public_token && !renew ? calendar.public_token : randomId(32);
    run('UPDATE calendars SET public_token = ?, public_mode = ? WHERE id = ?', token, mode, id);
  }
  announceCalendars([user.id]);
  return getCalendar(id)!;
}

export const calendarByToken = (token: string) =>
  token && token.length <= 64
    ? one<CalendarRow>('SELECT * FROM calendars WHERE public_token = ? AND trashed_at IS NULL', token)
    : undefined;

export function calendarsByIds(ids: string[]) {
  if (!ids.length) return [];
  return all<CalendarRow>(`SELECT * FROM calendars WHERE id IN (${placeholders(ids.length)})`, ...ids);
}

export function calendarStats() {
  return {
    calendars: value<number>('SELECT COUNT(*) FROM calendars WHERE trashed_at IS NULL') ?? 0,
    subscriptions: value<number>("SELECT COUNT(*) FROM calendars WHERE trashed_at IS NULL AND kind = 'subscription'") ?? 0,
    events: value<number>("SELECT COUNT(*) FROM events WHERE trashed_at IS NULL AND component = 'VEVENT'") ?? 0,
    tasks: value<number>("SELECT COUNT(*) FROM events WHERE trashed_at IS NULL AND component = 'VTODO'") ?? 0,
    shares: value<number>('SELECT COUNT(*) FROM calendar_shares') ?? 0,
    publicLinks: value<number>('SELECT COUNT(*) FROM calendars WHERE public_token IS NOT NULL AND trashed_at IS NULL') ?? 0,
  };
}

export function transferCalendars(fromId: number, toId: number, label: string) {
  const list = all<CalendarRow>('SELECT * FROM calendars WHERE owner_id = ?', fromId);
  let position = (value<number>('SELECT MAX(position) FROM calendars WHERE owner_id = ?', toId) ?? -1) + 1;
  const now = Date.now();
  for (const calendar of list) {
    let slug = calendar.slug;
    for (let index = 2; one('SELECT 1 FROM calendars WHERE owner_id = ? AND slug = ?', toId, slug); index++)
      slug = `${calendar.slug}-${index}`;
    run(
      'UPDATE calendars SET owner_id = ?, slug = ?, name = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
      toId,
      slug,
      `${calendar.name} (${label})`.slice(0, 100),
      position++,
      now,
      calendar.id
    );
    run('DELETE FROM calendar_shares WHERE calendar_id = ? AND user_id = ?', calendar.id, toId);
  }
  return list.length;
}
