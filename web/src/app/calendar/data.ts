import { useEffect, useMemo, useState } from 'react';
import { holidayId, holidaysBetween } from '../../../../shared/holidays';
import { api } from '../../lib/api';
import { boot } from '../../lib/boot';
import { useFeatures } from '../../lib/features';
import { language } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { usePrefs } from '../../lib/prefs';
import { BIRTHDAY_COLOR } from './colors';
import { addDays } from './dates';
import type { Occurrence } from './model';
import { useCalendarState, useOccurrences } from './store';

interface Birthday {
  contactId: string;
  name: string;
  date: string;
  year: number | null;
}

const birthdayCache = new Map<string, Occurrence[]>();

function birthdayItem(entry: Birthday): Occurrence {
  const start = Date.parse(`${entry.date}T00:00:00Z`);
  return {
    key: `birthday-${entry.contactId}-${entry.date}`,
    eventId: '',
    calendarId: 'birthdays',
    recurrenceId: null,
    component: 'VEVENT',
    title: entry.name,
    location: '',
    start,
    end: start + 86_400_000,
    allDay: true,
    startDate: entry.date,
    endDate: addDays(entry.date, 1),
    color: BIRTHDAY_COLOR,
    status: null,
    transparency: 'TRANSPARENT',
    privacy: 'PUBLIC',
    kind: 'birthday',
    birthYear: entry.year,
    categories: [],
    conference: null,
    recurring: false,
    override: false,
    completed: false,
    priority: 0,
    attendees: 0,
    invitation: null,
    organizer: null,
    readOnly: true,
    busyOnly: false,
    hasAlarms: false,
    zone: 'UTC',
    contactId: entry.contactId,
  };
}

export const birthdaysAvailable = () => Boolean(boot().contactsOn);

export function useBirthdays(from: string, to: string, wanted: boolean) {
  const on = useFeatures();
  const enabled = wanted && birthdaysAvailable() && on('contacts');
  const key = `${from}|${to}`;
  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<Occurrence[]>(() => birthdayCache.get(key) ?? []);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    let alive = true;
    const cached = birthdayCache.get(key);
    if (cached) setItems(cached);
    api
      .get<{ items: Birthday[] }>(`/api/contacts/birthdays?from=${from}&to=${to}`)
      .then((result) => {
        const list = result.items.map(birthdayItem);
        birthdayCache.set(key, list);
        if (alive) setItems(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, enabled, version, from, to]);
  useLive((event) => {
    if (event !== 'contacts' && event !== 'reconnect') return;
    birthdayCache.clear();
    setVersion((value) => value + 1);
  });
  return enabled ? items : [];
}

export function holidayItems(from: string, to: string, regions: string[], observances: boolean): Occurrence[] {
  if (!regions.length) return [];
  const seen = new Set<string>();
  const out: Occurrence[] = [];
  for (const holiday of holidaysBetween(from, to, regions, observances)) {
    const title = holiday.name[language];
    const unique = `${holiday.date}|${title}`;
    if (seen.has(unique)) continue;
    seen.add(unique);
    const start = Date.parse(`${holiday.date}T00:00:00Z`);
    out.push({
      key: holidayId(holiday),
      eventId: '',
      calendarId: 'holidays',
      recurrenceId: null,
      component: 'VEVENT',
      title,
      location: '',
      start,
      end: start + 86_400_000,
      allDay: true,
      startDate: holiday.date,
      endDate: addDays(holiday.date, 1),
      color: null,
      status: null,
      transparency: 'TRANSPARENT',
      privacy: 'PUBLIC',
      kind: 'event',
      birthYear: null,
      categories: [],
      conference: null,
      recurring: false,
      override: false,
      completed: false,
      priority: 0,
      attendees: 0,
      invitation: null,
      organizer: null,
      readOnly: true,
      busyOnly: false,
      hasAlarms: false,
      zone: 'UTC',
      holiday: holiday.kind,
    });
  }
  return out;
}

export function useVisibleItems(fromKey: string, toKey: string, from: number, to: number) {
  const { calendars, prefs } = useCalendarState();
  const local = usePrefs();
  const { items, error } = useOccurrences(from, to);
  const birthdays = useBirthdays(fromKey, toKey, !local.hidden.includes('birthdays'));
  const visible = useMemo(() => {
    if (!items) return null;
    const known = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const invitations = !local.hidden.includes('invitations');
    const list = items.filter((item) => {
      const calendar = known.get(item.calendarId);
      return calendar ? !calendar.hidden : invitations;
    });
    const holidays = prefs && !local.hidden.includes('holidays') ? holidayItems(fromKey, toKey, prefs.holidays, prefs.observances) : [];
    return [...holidays, ...birthdays, ...list];
  }, [items, calendars, prefs?.holidays, prefs?.observances, local.hidden, fromKey, toKey, birthdays]);
  return { items: visible, error, loading: items === null };
}
