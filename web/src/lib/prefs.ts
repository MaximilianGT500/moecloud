import { useSyncExternalStore } from 'react';

export interface Prefs {
  contrast: 0 | 0.5 | 1;
  trueBlack: boolean;
  shape: 1 | 0.5 | 0.1 | null;
  view: 'list' | 'grid';
  details: boolean;
  sort: 'name' | 'modified' | 'size';
  order: 'asc' | 'desc';
}

const KEY = 'moecloud-prefs';
const DEFAULTS: Prefs = { contrast: 0, trueBlack: false, shape: null, view: 'list', details: true, sort: 'name', order: 'asc' };
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs> & { corners?: number };
    const { corners, ...rest } = stored;
    const shape = rest.shape === undefined && (corners === 0.5 || corners === 0.1) ? corners : (rest.shape ?? null);
    return { ...DEFAULTS, ...rest, shape };
  } catch {
    return DEFAULTS;
  }
}

let current = read();

window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  current = read();
  listeners.forEach((listener) => listener());
});

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((listener) => listener());
}

export const currentPrefs = () => current;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
