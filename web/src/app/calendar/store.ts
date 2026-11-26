import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorText } from '../../lib/api';
import { toast } from '../common/toast';
import { calendarApi, type CalendarInfo, type CalendarPrefs, type Occurrence } from './model';
import { setZone } from './dates';

interface State {
  calendars: CalendarInfo[];
  prefs: CalendarPrefs | null;
  zone: string;
  loaded: boolean;
  version: number;
  tick: number;
}

let state: State = { calendars: [], prefs: null, zone: '', loaded: false, version: 0, tick: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const getState = () => state;

export function useCalendarState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );
}

let loading: Promise<void> | null = null;

export function loadCalendars() {
  loading ??= calendarApi
    .list()
    .then((data) => {
      if (data.zone) setZone(data.zone);
      emit({ calendars: data.calendars, prefs: data.prefs, zone: data.zone, loaded: true });
    })
    .catch((error) => toast(errorText(error)))
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function invalidate() {
  for (const entry of cache.values()) entry.stale = true;
  emit({ version: state.version + 1 });
}

export async function savePrefs(patch: Partial<CalendarPrefs>) {
  const before = state.prefs;
  if (before) emit({ prefs: { ...before, ...patch } });
  try {
    const result = await calendarApi.prefs(patch);
    emit({ prefs: result.prefs });
    if ('holidays' in patch || 'tasksInCalendar' in patch || 'completedTasks' in patch || 'declined' in patch) invalidate();
  } catch (error) {
    if (before) emit({ prefs: before });
    toast(errorText(error));
  }
}

export async function patchCalendar(id: string, patch: Partial<CalendarInfo> & Record<string, unknown>) {
  const before = state.calendars;
  emit({ calendars: before.map((calendar) => (calendar.id === id ? { ...calendar, ...patch } : calendar)) });
  try {
    const result = await calendarApi.updateCalendar(id, patch);
    if (result.calendar) emit({ calendars: state.calendars.map((calendar) => (calendar.id === id ? result.calendar! : calendar)) });
  } catch (error) {
    emit({ calendars: before });
    toast(errorText(error));
  }
}

export const calendarById = (id: string) => state.calendars.find((calendar) => calendar.id === id);

export function visibleCalendarIds() {
  return new Set(state.calendars.filter((calendar) => !calendar.hidden).map((calendar) => calendar.id));
}

export function writableCalendars() {
  return state.calendars.filter((calendar) => (calendar.access === 'owner' || calendar.access === 'write') && calendar.kind === 'local');
}

export function defaultCalendar(component: 'VEVENT' | 'VTODO' = 'VEVENT') {
  const list = writableCalendars().filter((calendar) => calendar.components.includes(component));
  const wanted = state.prefs?.defaultCalendar;
  return (
    list.find((calendar) => calendar.id === wanted && !calendar.hidden) ?? list.find((calendar) => !calendar.hidden) ?? list[0] ?? null
  );
}

interface Entry {
  items: Occurrence[];
  stale: boolean;
  promise: Promise<Occurrence[]> | null;
}

const cache = new Map<string, Entry>();

function fetchRange(from: number, to: number, force = false) {
  const key = `${from}:${to}`;
  let entry = cache.get(key);
  if (entry && !entry.stale && !force) return Promise.resolve(entry.items);
  if (entry?.promise) return entry.promise;
  if (!entry) {
    entry = { items: [], stale: true, promise: null };
    cache.set(key, entry);
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
  }
  const current = entry;
  current.promise = calendarApi
    .occurrences(from, to)
    .then((data) => {
      current.items = data.items;
      current.stale = false;
      return data.items;
    })
    .finally(() => {
      current.promise = null;
    });
  return current.promise;
}

export function prefetch(from: number, to: number) {
  void fetchRange(from, to).catch(() => undefined);
}

export function useOccurrences(from: number, to: number) {
  const { version, tick } = useCalendarState();
  const key = `${from}:${to}`;
  const [items, setItems] = useState<Occurrence[] | null>(() => {
    const entry = cache.get(key);
    return entry && entry.items.length ? entry.items : entry && !entry.stale ? entry.items : null;
  });
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    const entry = cache.get(key);
    if (entry && (!entry.stale || entry.items.length)) setItems(entry.items);
    else setItems(null);
    fetchRange(from, to)
      .then((list) => {
        if (latest.current === key) {
          setItems(list);
          setError(null);
        }
      })
      .catch((failure) => {
        if (latest.current === key) setError(errorText(failure));
      });
  }, [key, version, tick]);
  return { items, error };
}

export function patchLocal(match: (item: Occurrence) => boolean, change: (item: Occurrence) => Occurrence | null) {
  for (const entry of cache.values()) {
    entry.items = entry.items.flatMap((item) => {
      if (!match(item)) return [item];
      const next = change(item);
      return next ? [next] : [];
    });
  }
  emit({ tick: state.tick + 1 });
}

export function forgetCache() {
  cache.clear();
}
