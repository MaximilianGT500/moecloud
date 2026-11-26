import { all, one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { getProp, parseICS, serialize, setProp, type Component } from './ical.ts';
import { cloneData, recurrenceStart, writeObject, type Instance, type ItemData, type PartStat } from './model.ts';
import { formatWhen } from './when.ts';
import { announce, getCalendar } from './calendars.ts';
import { dataOf, getEvent, storeItem, type EventRow } from './events.ts';
import { absoluteUrl } from './links.ts';
import { deliver, mailReady } from '../services/mail.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { findByEmail, getUser, preferredLanguage, prefsOf, zoneOf, type UserRow } from '../services/users.ts';

interface AttendeeRow {
  event_id: string;
  email: string;
  user_id: number | null;
  name: string | null;
  status: PartStat;
  role: string | null;
  token_hash: string | null;
  calendar_id: string | null;
  hidden: number;
  notified_at: number | null;
  responded_at: number | null;
  comment: string | null;
}

export function syncAttendees(row: EventRow, data: ItemData) {
  const existing = new Map(all<AttendeeRow>('SELECT * FROM attendees WHERE event_id = ?', row.id).map((entry) => [entry.email, entry]));
  const wanted = new Set<string>();
  for (const attendee of data.attendees) {
    wanted.add(attendee.email);
    const userId = findByEmail(attendee.email)?.id ?? null;
    const before = existing.get(attendee.email);
    if (before) {
      run(
        'UPDATE attendees SET user_id = ?, name = ?, status = ?, role = ? WHERE event_id = ? AND email = ?',
        userId,
        attendee.name,
        attendee.status,
        attendee.role,
        row.id,
        attendee.email
      );
    } else {
      run(
        'INSERT INTO attendees (event_id, email, user_id, name, status, role) VALUES (?, ?, ?, ?, ?, ?)',
        row.id,
        attendee.email,
        userId,
        attendee.name,
        attendee.status,
        attendee.role
      );
    }
  }
  for (const email of existing.keys()) if (!wanted.has(email)) run('DELETE FROM attendees WHERE event_id = ? AND email = ?', row.id, email);
}

function organizerUser(row: EventRow, data: ItemData) {
  if (!data.organizer) return null;
  const calendar = getCalendar(row.calendar_id);
  const owner = calendar ? getUser(calendar.owner_id) : null;
  if (owner && (owner.email?.toLowerCase() === data.organizer.email || findByEmail(data.organizer.email)?.id === owner.id)) return owner;
  return null;
}

function methodIcs(ics: string, method: 'REQUEST' | 'CANCEL', recurrenceId?: string) {
  const roots = parseICS(ics);
  const calendar = roots.find((root) => root.name === 'VCALENDAR');
  if (!calendar) return ics;
  setProp(calendar, 'METHOD', method);
  if (method === 'CANCEL') {
    const items = calendar.children.filter((child) => child.name === 'VEVENT' || child.name === 'VTODO');
    let keep: Component[] = items;
    if (recurrenceId) {
      const master = items.find((item) => !getProp(item, 'RECURRENCE-ID'));
      if (master) {
        const copy: Component = structuredClone(master);
        copy.props = copy.props.filter((prop) => !['RRULE', 'EXDATE', 'RDATE', 'RECURRENCE-ID'].includes(prop.name));
        const date = /^\d{8}$/.test(recurrenceId);
        copy.props.push({ name: 'RECURRENCE-ID', params: date ? { VALUE: ['DATE'] } : {}, value: recurrenceId });
        keep = [copy];
      }
    }
    for (const item of keep) setProp(item, 'STATUS', 'CANCELLED');
    calendar.children = [...calendar.children.filter((child) => child.name === 'VTIMEZONE'), ...keep];
  }
  return serialize(calendar);
}

function rsvpLinks(lang: Lang, token: string) {
  const base = (status: string) => absoluteUrl(`/rsvp/${token}?status=${status}`);
  return [
    { label: t(lang, 'Zusagen'), url: base('accepted'), tone: 'primary' as const },
    { label: t(lang, 'Vielleicht'), url: base('tentative'), tone: 'tonal' as const },
    { label: t(lang, 'Absagen'), url: base('declined'), tone: 'tonal' as const },
  ];
}

function details(lang: Lang, data: Instance, zone: string, organizer: string) {
  const out = [{ label: t(lang, 'Wann'), value: formatWhen(lang, data.start ?? 0, data.end, data.allDay, zone) }];
  if (data.location) out.push({ label: t(lang, 'Wo'), value: data.location });
  if (data.conference) out.push({ label: t(lang, 'Video'), value: data.conference });
  out.push({ label: t(lang, 'Von'), value: organizer });
  return out;
}

async function mailExternal(
  row: EventRow,
  data: ItemData,
  attendee: { email: string; name: string | null },
  kind: 'invite' | 'update' | 'cancel',
  organizer: UserRow,
  recurrenceId?: string
) {
  if (!mailReady() || !settings.get('calendar.externalInvites') || !settings.get('site.url')) return;
  const lang = preferredLanguage(organizer);
  const zone = data.zone || zoneOf(organizer);
  let token: string | null = null;
  if (kind !== 'cancel') {
    token = randomId(32);
    run(
      'UPDATE attendees SET token_hash = ?, notified_at = ? WHERE event_id = ? AND email = ?',
      sha256(token),
      Date.now(),
      row.id,
      attendee.email
    );
  }
  const title =
    kind === 'invite'
      ? t(lang, 'Einladung: {title}', { title: data.title || t(lang, 'Termin') })
      : kind === 'update'
        ? t(lang, 'Geändert: {title}', { title: data.title || t(lang, 'Termin') })
        : t(lang, 'Abgesagt: {title}', { title: data.title || t(lang, 'Termin') });
  const lines: string[] = [];
  if (kind === 'invite') lines.push(t(lang, '{name} lädt dich zu diesem Termin ein.', { name: organizer.name }));
  if (kind === 'update') lines.push(t(lang, '{name} hat den Termin geändert.', { name: organizer.name }));
  if (kind === 'cancel')
    lines.push(
      recurrenceId
        ? t(lang, '{name} hat einen Termin dieser Reihe abgesagt.', { name: organizer.name })
        : t(lang, '{name} hat den Termin abgesagt.', { name: organizer.name })
    );
  if (data.description && kind !== 'cancel') lines.push(data.description.slice(0, 1500));
  const instance = recurrenceId ? { ...data, start: recurrenceStart(recurrenceId), end: null } : data;
  try {
    await deliver(
      attendee.email,
      {
        lang,
        title,
        details: details(lang, instance, zone, organizer.email ? `${organizer.name} <${organizer.email}>` : organizer.name),
        lines,
        actions: token ? rsvpLinks(lang, token) : undefined,
        note:
          kind === 'cancel'
            ? undefined
            : t(lang, 'Die Antwort geht direkt an {name}. Die angehängte Datei kannst du in jeden Kalender übernehmen.', {
                name: organizer.name,
              }),
      },
      {
        ical: {
          method: kind === 'cancel' ? 'CANCEL' : 'REQUEST',
          content: methodIcs(row.ics, kind === 'cancel' ? 'CANCEL' : 'REQUEST', recurrenceId),
        },
        replyTo: organizer.email ?? undefined,
      }
    );
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Einladung konnte nicht verschickt werden');
  }
}

const significant = (before: Instance, after: Instance) =>
  before.start !== after.start ||
  before.end !== after.end ||
  before.allDay !== after.allDay ||
  before.location !== after.location ||
  before.title !== after.title;

export function afterChange(
  actor: UserRow,
  row: EventRow,
  before: ItemData | null,
  after: ItemData | null,
  extra: { cancelled?: string } = {}
) {
  if (after) syncAttendees(row, after);
  const current = after ?? before;
  if (!current) return;
  const organizer = organizerUser(row, current);
  if (!organizer || organizer.id !== actor.id) return;
  const previous = new Map((before?.attendees ?? []).map((attendee) => [attendee.email, attendee]));
  const next = new Map((after?.attendees ?? []).map((attendee) => [attendee.email, attendee]));
  const url = `/calendar?event=${row.id}`;
  const lang = preferredLanguage(organizer);
  const when = formatWhen(lang, current.start ?? 0, current.end, current.allDay, current.zone);
  const audience: number[] = [];
  const handle = (email: string, name: string | null, kind: 'invite' | 'update' | 'cancel') => {
    const user = findByEmail(email);
    if (user && user.id !== actor.id) {
      audience.push(user.id);
      const kindName = kind === 'invite' ? 'invitation' : kind === 'update' ? 'invitation_updated' : 'invitation_cancelled';
      notify(user.id, kindName, { by: actor.name, title: current.title, when }, kind === 'cancel' ? null : url);
    } else if (!user)
      void mailExternal(row, after ?? current, { email, name }, kind, organizer, kind === 'cancel' ? extra.cancelled : undefined);
  };
  if (!after) {
    for (const attendee of previous.values()) handle(attendee.email, attendee.name, 'cancel');
  } else {
    for (const attendee of next.values()) {
      if (!previous.has(attendee.email)) handle(attendee.email, attendee.name, 'invite');
      else if (extra.cancelled) handle(attendee.email, attendee.name, 'cancel');
      else if (before && (significant(before, after) || before.rrule !== after.rrule)) handle(attendee.email, attendee.name, 'update');
    }
    for (const attendee of previous.values()) if (!next.has(attendee.email)) handle(attendee.email, attendee.name, 'cancel');
  }
  if (audience.length) announce([], audience);
}

export interface RsvpInput {
  status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
  comment?: string | null;
}

function respond(row: EventRow, email: string, input: RsvpInput, responder: string) {
  const data = dataOf(row);
  const attendee = data.attendees.find((entry) => entry.email === email);
  if (!attendee) throw notFound('Du stehst nicht auf der Gästeliste');
  const before = cloneData(data);
  attendee.status = input.status;
  attendee.rsvp = false;
  const ics = writeObject(row.ics, before, data);
  const calendar = getCalendar(row.calendar_id)!;
  const stored = storeItem(calendar, data, ics, { actor: null, previous: row });
  run(
    'UPDATE attendees SET status = ?, responded_at = ?, comment = ? WHERE event_id = ? AND email = ?',
    input.status,
    Date.now(),
    input.comment?.trim().slice(0, 500) || null,
    row.id,
    email
  );
  const organizer = organizerUser(row, data);
  if (organizer) {
    const lang = preferredLanguage(organizer);
    notify(
      organizer.id,
      'invitation_reply',
      {
        name: responder,
        title: data.title,
        status:
          input.status === 'ACCEPTED'
            ? t(lang, 'zugesagt')
            : input.status === 'DECLINED'
              ? t(lang, 'abgesagt')
              : t(lang, 'vielleicht zugesagt'),
        comment: input.comment?.trim() ?? '',
      },
      `/calendar?event=${row.id}`
    );
  }
  announce(
    [row.calendar_id],
    all<{ user_id: number }>('SELECT user_id FROM attendees WHERE event_id = ? AND user_id IS NOT NULL', row.id).map(
      (entry) => entry.user_id
    )
  );
  return stored;
}

export function rsvpAsUser(user: UserRow, eventId: string, input: RsvpInput) {
  const row = getEvent(eventId);
  if (!row || row.trashed_at) throw notFound('Diesen Termin gibt es nicht');
  const attendee = one<AttendeeRow>('SELECT * FROM attendees WHERE event_id = ? AND user_id = ?', eventId, user.id);
  if (!attendee) throw badRequest('Du bist zu diesem Termin nicht eingeladen');
  if (input.status === 'DECLINED') run('UPDATE attendees SET hidden = 0 WHERE event_id = ? AND user_id = ?', eventId, user.id);
  return respond(row, attendee.email, input, user.name);
}

export function findByToken(token: string) {
  if (!token || token.length > 64) return null;
  const attendee = one<AttendeeRow>('SELECT * FROM attendees WHERE token_hash = ?', sha256(token));
  if (!attendee) return null;
  const row = getEvent(attendee.event_id);
  if (!row || row.trashed_at) return null;
  return { attendee, row, data: dataOf(row) };
}

export function rsvpByToken(token: string, input: RsvpInput) {
  const found = findByToken(token);
  if (!found) throw notFound('Diese Einladung ist abgelaufen oder wurde zurückgezogen');
  return respond(found.row, found.attendee.email, input, found.attendee.name ?? found.attendee.email);
}

export function hideInvitation(user: UserRow, eventId: string, hidden: boolean) {
  if (run('UPDATE attendees SET hidden = ? WHERE event_id = ? AND user_id = ?', hidden ? 1 : 0, eventId, user.id).changes === 0) {
    throw notFound('Diese Einladung gibt es nicht');
  }
  announce([], [user.id]);
}

export function pendingInvitations(user: UserRow) {
  const rows = all<{ event_id: string; status: PartStat }>(
    "SELECT a.event_id, a.status FROM attendees a JOIN events e ON e.id = a.event_id WHERE a.user_id = ? AND a.hidden = 0 AND a.status = 'NEEDS-ACTION' AND e.trashed_at IS NULL AND (e.range_end IS NULL OR e.range_end > ?)",
    user.id,
    Date.now()
  );
  return rows
    .map((entry) => {
      const row = getEvent(entry.event_id);
      if (!row) return null;
      const data = dataOf(row);
      return {
        eventId: row.id,
        title: data.title,
        start: data.start,
        end: data.end,
        allDay: data.allDay,
        organizer: data.organizer?.name ?? data.organizer?.email ?? '',
        location: data.location,
        recurring: Boolean(data.rrule),
      };
    })
    .filter(Boolean);
}

export function prefersInviteMail(user: UserRow) {
  return prefsOf(user).mailInvites;
}
