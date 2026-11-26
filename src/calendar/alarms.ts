import { all, run } from '../lib/db.ts';
import { log } from '../lib/log.ts';
import { DAY } from '../../shared/time.ts';
import { occurrences, type ItemData } from './model.ts';
import { formatWhen, leadText } from './when.ts';
import { getCalendar } from './calendars.ts';
import { dataOf, getEvent, type EventRow } from './events.ts';
import { notify } from '../services/notify.ts';
import { getUser, inactive, preferredLanguage, zoneOf } from '../services/users.ts';

interface AlarmRow {
  event_id: string;
  user_id: number;
  next_at: number;
  occurrence: number;
  action: string;
  fired_until: number;
}

interface Trigger {
  at: number;
  occurrence: number;
  end: number;
  recurrenceId: string | null;
  action: 'DISPLAY' | 'EMAIL' | 'AUDIO';
  title: string;
  location: string;
}

export function nextTrigger(data: ItemData, after: number): Trigger | null {
  const lists = [data.alarms, ...data.overrides.map((entry) => entry.alarms)];
  if (!lists.some((list) => list.length)) return null;
  let lead = 0;
  for (const list of lists) for (const alarm of list) if (alarm.absolute === null) lead = Math.max(lead, -alarm.offset);
  let best: Trigger | null = null;
  const found = occurrences(data, after - 7 * DAY, after + lead + 400 * DAY, 800);
  for (const occurrence of found) {
    if (best && occurrence.start - lead > best.at) break;
    for (const alarm of occurrence.instance.alarms) {
      const base = alarm.related === 'END' && data.component === 'VEVENT' ? occurrence.end : occurrence.start;
      const at = alarm.absolute ?? base + alarm.offset;
      if (at <= after) continue;
      if (!best || at < best.at) {
        best = {
          at,
          occurrence: occurrence.start,
          end: occurrence.end,
          recurrenceId: occurrence.recurrenceId,
          action: alarm.action,
          title: occurrence.instance.title,
          location: occurrence.instance.location,
        };
      }
    }
  }
  return best;
}

function recipients(row: EventRow): number[] {
  const calendar = getCalendar(row.calendar_id);
  if (!calendar || calendar.trashed_at || calendar.kind !== 'local') return [];
  const shared = all<{ user_id: number }>(
    "SELECT user_id FROM calendar_shares WHERE calendar_id = ? AND notify = 1 AND permission IN ('read', 'write')",
    calendar.id
  ).map((entry) => entry.user_id);
  const invited = all<{ user_id: number }>(
    "SELECT user_id FROM attendees WHERE event_id = ? AND user_id IS NOT NULL AND hidden = 0 AND status != 'DECLINED'",
    row.id
  ).map((entry) => entry.user_id);
  return [...new Set([calendar.owner_id, ...shared, ...invited])];
}

export function scheduleAlarms(row: EventRow, data: ItemData, now = Date.now()) {
  run('DELETE FROM alarms WHERE event_id = ?', row.id);
  if (row.trashed_at || !row.has_alarms) return;
  if (data.component === 'VTODO' && (data.status === 'COMPLETED' || data.completed) && !data.rrule) return;
  const next = nextTrigger(data, now - 60_000);
  if (!next) return;
  for (const userId of recipients(row)) {
    run(
      `INSERT INTO alarms (event_id, user_id, next_at, occurrence, action, fired_until) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET next_at = excluded.next_at, occurrence = excluded.occurrence, action = excluded.action`,
      row.id,
      userId,
      next.at,
      next.occurrence,
      next.action,
      now - 60_000
    );
  }
}

export function rescheduleUser(userId: number) {
  for (const row of all<{ event_id: string }>('SELECT event_id FROM alarms WHERE user_id = ?', userId)) {
    const event = getEvent(row.event_id);
    if (event) scheduleAlarms(event, dataOf(event));
  }
}

const STALE = 30 * 60_000;

export function fireAlarms(now = Date.now()) {
  const due = all<AlarmRow>('SELECT * FROM alarms WHERE next_at <= ? ORDER BY next_at LIMIT 500', now);
  let fired = 0;
  for (const alarm of due) {
    try {
      const event = getEvent(alarm.event_id);
      if (!event || event.trashed_at) {
        run('DELETE FROM alarms WHERE event_id = ?', alarm.event_id);
        continue;
      }
      const data = dataOf(event);
      const trigger = nextTrigger(data, alarm.next_at - 1);
      const user = getUser(alarm.user_id);
      if (trigger && user && !inactive(user) && now - alarm.next_at < STALE) {
        const lang = preferredLanguage(user);
        const zone = zoneOf(user);
        const minutes = Math.round((trigger.occurrence - now) / 60_000);
        const todo = data.component === 'VTODO';
        notify(
          user.id,
          todo ? 'task_due' : 'event_reminder',
          {
            title: trigger.title || data.title,
            when: formatWhen(lang, trigger.occurrence, todo ? null : trigger.end, data.allDay, zone),
            lead: data.allDay && minutes > 0 ? '' : leadText(lang, Math.max(0, minutes)),
            location: trigger.location,
          },
          `/calendar?event=${event.id}${trigger.recurrenceId ? `&rid=${trigger.recurrenceId}` : ''}`,
          { mail: trigger.action === 'EMAIL', urgent: true }
        );
        fired++;
      }
      const next = nextTrigger(data, Math.max(alarm.next_at, now - 60_000));
      if (next) {
        run(
          'UPDATE alarms SET next_at = ?, occurrence = ?, action = ?, fired_until = ? WHERE event_id = ? AND user_id = ?',
          next.at,
          next.occurrence,
          next.action,
          alarm.next_at,
          alarm.event_id,
          alarm.user_id
        );
      } else run('DELETE FROM alarms WHERE event_id = ? AND user_id = ?', alarm.event_id, alarm.user_id);
    } catch (error) {
      log.warn({ error: (error as Error).message, event: alarm.event_id }, 'Erinnerung konnte nicht verschickt werden');
      run('UPDATE alarms SET next_at = ? WHERE event_id = ? AND user_id = ?', now + 5 * 60_000, alarm.event_id, alarm.user_id);
    }
  }
  return fired;
}

export function upcomingAlarms(userId: number) {
  return all<AlarmRow>('SELECT * FROM alarms WHERE user_id = ? ORDER BY next_at LIMIT 20', userId);
}
