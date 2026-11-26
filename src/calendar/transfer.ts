import { PassThrough } from 'node:stream';
import yazl from 'yazl';
import { all, run, tx } from '../lib/db.ts';
import { badRequest, forbidden, tooLarge } from '../lib/errors.ts';
import { ICalError } from './ical.ts';
import { exportCalendar, readObjects, writeObject, type ItemData } from './model.ts';
import { fetchText, RemoteError } from './remote.ts';
import { log } from '../lib/log.ts';
import { t } from '../lib/i18n.ts';
import { DAY } from '../../shared/time.ts';
import {
  announce,
  announceCalendars,
  getCalendar,
  insertCalendar,
  ownCalendars,
  requireCalendar,
  touchCalendar,
  type CalendarRow,
} from './calendars.ts';
import { dataOf, eventByUid, storeItem, type EventRow } from './events.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { getUser, zoneOf, type UserRow } from '../services/users.ts';

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}

export type ImportMode = 'merge' | 'skip' | 'copy';

const MAX_IMPORT = 20_000;

export function importInto(user: UserRow | null, calendar: CalendarRow, text: string, mode: ImportMode = 'merge'): ImportResult {
  const zone = calendar.zone ?? (user ? zoneOf(user) : settings.get('calendar.zone'));
  let objects;
  try {
    objects = readObjects(text.replace(/^X-MOE-ASSIGNEE[;:][^\r\n]*\r?\n/gim, ''), zone, MAX_IMPORT);
  } catch (error) {
    if (error instanceof ICalError) throw badRequest(error.message);
    throw badRequest('Die Datei ist kein gültiger Kalender');
  }
  const allowed = calendar.components.split(',');
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: objects.length };
  tx(() => {
    for (const object of objects) {
      try {
        if (!allowed.includes(object.data.component)) {
          result.skipped++;
          continue;
        }
        const existing = eventByUid(calendar.id, object.uid);
        if (existing) {
          if (mode === 'skip') {
            result.skipped++;
            continue;
          }
          if (mode === 'copy') {
            const data: ItemData = { ...object.data, uid: crypto.randomUUID(), overrides: object.data.overrides };
            storeItem(calendar, data, writeObject(object.ics, object.data, data), { actor: user?.id ?? null, quiet: true });
            result.created++;
            continue;
          }
          if (existing.etag && existing.ics === object.ics) {
            result.skipped++;
            continue;
          }
          storeItem(calendar, object.data, object.ics, { actor: user?.id ?? null, previous: existing, quiet: true });
          result.updated++;
        } else {
          run('DELETE FROM events WHERE calendar_id = ? AND uid = ? AND trashed_at IS NOT NULL', calendar.id, object.uid);
          storeItem(calendar, object.data, object.ics, { actor: user?.id ?? null, quiet: true });
          result.created++;
        }
      } catch (error) {
        result.failed++;
        log.debug({ error: (error as Error).message, uid: object.uid }, 'Eintrag ließ sich nicht importieren');
      }
    }
  });
  announce([calendar.id]);
  return result;
}

export function importForUser(user: UserRow, calendarId: string, text: string, mode: ImportMode) {
  const { calendar } = requireCalendar(user, calendarId, 'write');
  if (Buffer.byteLength(text) > 30 * 1024 * 1024) throw tooLarge('Die Datei ist zu groß');
  return importInto(user, calendar, text, mode);
}

export function exportIcs(calendar: CalendarRow, options: { from?: number | null; busyOnly?: boolean } = {}) {
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE calendar_id = ? AND trashed_at IS NULL ${options.from ? 'AND (range_end IS NULL OR range_end > ?)' : ''} ORDER BY start_at`,
    calendar.id,
    ...(options.from ? [options.from] : [])
  );
  const owner = getUser(calendar.owner_id);
  const zone = calendar.zone ?? (owner ? zoneOf(owner) : settings.get('calendar.zone'));
  if (!options.busyOnly) return exportCalendar(rows, calendar.name, calendar.color, zone);
  const busy = rows
    .filter((row) => row.component === 'VEVENT')
    .map((row) => {
      const data = dataOf(row);
      if (data.transparency === 'TRANSPARENT') return null;
      const copy: ItemData = {
        ...data,
        title: 'Beschäftigt',
        description: '',
        location: '',
        url: '',
        attendees: [],
        organizer: null,
        conference: null,
        categories: [],
        alarms: [],
        overrides: data.overrides.map((entry) => ({
          ...entry,
          title: 'Beschäftigt',
          description: '',
          location: '',
          url: '',
          attendees: [],
          organizer: null,
          conference: null,
          categories: [],
          alarms: [],
        })),
      };
      return { ics: writeObject(null, null, copy) };
    })
    .filter((entry): entry is { ics: string } => Boolean(entry));
  return exportCalendar(busy, calendar.name, calendar.color, zone);
}

export function exportForUser(user: UserRow, calendarId: string) {
  const { calendar } = requireCalendar(user, calendarId, 'read');
  return { name: calendar.name, ics: exportIcs(calendar) };
}

export function exportZip(user: UserRow) {
  const zip = new yazl.ZipFile();
  const used = new Set<string>();
  for (const calendar of ownCalendars(user.id)) {
    let name = calendar.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Kalender';
    let candidate = `${name}.ics`;
    for (let index = 2; used.has(candidate.toLowerCase()); index++) candidate = `${name} (${index}).ics`;
    used.add(candidate.toLowerCase());
    name = candidate;
    zip.addBuffer(Buffer.from(exportIcs(calendar), 'utf8'), name, { mtime: new Date(calendar.updated_at) });
  }
  zip.end();
  const out = new PassThrough();
  zip.outputStream.pipe(out);
  return out;
}

const csvCell = (value: string) => (/[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function exportCsv(
  rows: { title: string; start: number; end: number; allDay: boolean; location: string; calendar: string; description: string }[],
  zone: string,
  lang: 'de' | 'en'
) {
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: zone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: zone });
  const header =
    lang === 'en'
      ? ['Title', 'Start date', 'Start time', 'End date', 'End time', 'All day', 'Location', 'Calendar', 'Notes']
      : ['Titel', 'Beginn Datum', 'Beginn Uhrzeit', 'Ende Datum', 'Ende Uhrzeit', 'Ganztägig', 'Ort', 'Kalender', 'Notizen'];
  const lines = [header.join(';')];
  for (const row of rows) {
    const end = row.allDay ? row.end - DAY : row.end;
    lines.push(
      [
        row.title,
        row.allDay ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(row.start) : date.format(row.start),
        row.allDay ? '' : time.format(row.start),
        row.allDay ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(end) : date.format(end),
        row.allDay ? '' : time.format(end),
        row.allDay ? (lang === 'en' ? 'yes' : 'ja') : lang === 'en' ? 'no' : 'nein',
        row.location,
        row.calendar,
        row.description.replace(/\s+/g, ' ').slice(0, 1000),
      ]
        .map((cell) => csvCell(String(cell)))
        .join(';')
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function subscribe(user: UserRow, input: { url: string; name?: string; color?: string; refreshMinutes?: number }) {
  if (!settings.get('calendar.subscriptions')) throw forbidden('Abos sind auf diesem Server ausgeschaltet');
  const count = ownCalendars(user.id).filter((calendar) => calendar.kind === 'subscription').length;
  if (count >= settings.get('calendar.maxSubscriptions')) throw badRequest('Du hast schon so viele Abos, wie erlaubt sind');
  let url: string;
  try {
    url = new URL(input.url.trim().replace(/^webcals?:\/\//i, 'https://')).href;
  } catch {
    throw badRequest('Die Adresse sieht nicht richtig aus');
  }
  const minimum = Math.max(5, settings.get('calendar.minRefresh'));
  const calendar = insertCalendar(user, {
    name: input.name?.trim() || new URL(url).hostname,
    color: input.color,
    kind: 'subscription',
    sourceUrl: url,
    refreshMinutes: Math.max(minimum, input.refreshMinutes ?? 360),
  });
  return calendar;
}

export function detachSubscription(user: UserRow, id: string) {
  const { calendar } = requireCalendar(user, id, 'owner');
  if (calendar.kind !== 'subscription') throw badRequest('Das ist kein Abo');
  run(
    "UPDATE calendars SET kind = 'local', source_url = NULL, refresh_minutes = NULL, sync_etag = NULL, sync_error = NULL, sync_failures = 0, synced_at = NULL, updated_at = ? WHERE id = ?",
    Date.now(),
    calendar.id
  );
  announce([calendar.id]);
  announceCalendars([calendar.owner_id]);
  return getCalendar(calendar.id)!;
}

function nameFromFeed(text: string) {
  const match = /^X-WR-CALNAME:(.+)$/im.exec(text);
  return match ? match[1].replace(/\\,/g, ',').replace(/\\;/g, ';').trim().slice(0, 100) : null;
}

const running = new Set<string>();

export async function refreshSubscription(calendar: CalendarRow, force = false): Promise<ImportResult | null> {
  if (calendar.kind !== 'subscription' || !calendar.source_url || running.has(calendar.id)) return null;
  running.add(calendar.id);
  const now = Date.now();
  try {
    const remote = await fetchText(calendar.source_url, {
      allowPrivate: settings.get('calendar.subscriptionsPrivate'),
      etag: force ? null : calendar.sync_etag,
      limit: 25 * 1024 * 1024,
    });
    if (remote.status === 304) {
      run('UPDATE calendars SET synced_at = ?, sync_error = NULL, sync_failures = 0 WHERE id = ?', now, calendar.id);
      return { created: 0, updated: 0, skipped: 0, failed: 0, total: 0 };
    }
    const owner = getUser(calendar.owner_id);
    const zone = calendar.zone ?? (owner ? zoneOf(owner) : settings.get('calendar.zone'));
    const objects = readObjects(remote.text, zone, MAX_IMPORT);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: objects.length };
    tx(() => {
      const seen = new Set<string>();
      for (const object of objects) {
        seen.add(object.uid);
        const existing = eventByUid(calendar.id, object.uid);
        if (existing && existing.ics === object.ics) {
          result.skipped++;
          continue;
        }
        storeItem(calendar, object.data, object.ics, { actor: null, previous: existing ?? null, quiet: true });
        if (existing) result.updated++;
        else result.created++;
      }
      for (const row of all<{ id: string; uid: string; href: string }>(
        'SELECT id, uid, href FROM events WHERE calendar_id = ?',
        calendar.id
      )) {
        if (seen.has(row.uid)) continue;
        run('DELETE FROM events WHERE id = ?', row.id);
        touchCalendar(calendar.id, row.href, true);
      }
      const name = calendar.name === new URL(calendar.source_url!).hostname ? nameFromFeed(remote.text) : null;
      run(
        'UPDATE calendars SET synced_at = ?, sync_error = NULL, sync_failures = 0, sync_etag = ?, name = COALESCE(?, name) WHERE id = ?',
        now,
        remote.etag,
        name,
        calendar.id
      );
    });
    announce([calendar.id]);
    announceCalendars([calendar.owner_id]);
    return result;
  } catch (error) {
    const message =
      error instanceof RemoteError
        ? t('de', error.message, error.params)
        : error instanceof ICalError
          ? error.message
          : 'Der Kalender ließ sich nicht lesen';
    const failures = calendar.sync_failures + 1;
    run('UPDATE calendars SET synced_at = ?, sync_error = ?, sync_failures = ? WHERE id = ?', now, message, failures, calendar.id);
    if (failures === 3)
      notify(calendar.owner_id, 'subscription_failed', { name: calendar.name, error: message }, `/calendar?calendar=${calendar.id}`);
    announceCalendars([calendar.owner_id]);
    if (force) throw error instanceof RemoteError ? badRequest(error.message, error.params) : badRequest(message);
    return null;
  } finally {
    running.delete(calendar.id);
  }
}

export async function refreshDue(now = Date.now()) {
  const due = all<CalendarRow>(
    "SELECT * FROM calendars WHERE kind = 'subscription' AND trashed_at IS NULL AND (synced_at IS NULL OR synced_at + COALESCE(refresh_minutes, 360) * 60000 * (CASE WHEN sync_failures > 3 THEN 4 ELSE 1 END) <= ?) ORDER BY synced_at LIMIT 10",
    now
  );
  let count = 0;
  for (const calendar of due) {
    await refreshSubscription(calendar);
    count++;
  }
  return count;
}

export async function refreshNow(user: UserRow, id: string) {
  const { calendar } = requireCalendar(user, id, 'owner');
  if (calendar.kind !== 'subscription') throw badRequest('Das ist kein Abo');
  return refreshSubscription(getCalendar(calendar.id)!, true);
}
