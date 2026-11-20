import { useSyncExternalStore } from 'react';

export interface Prefs {
  contrast: 0 | 0.5 | 1;
  trueBlack: boolean;
  shape: 1 | 0.5 | 0.1 | null;
  view: 'list' | 'grid';
  details: boolean;
  sort: 'name' | 'modified' | 'size';
  order: 'asc' | 'desc';
  scale: 0.9 | 1 | 1.1 | 1.25;
  density: 'comfortable' | 'compact';
  tile: 0.75 | 1 | 1.35;
  motion: 'system' | 'reduced';
  backdrop: 'plain' | 'glow';
}

const KEY = 'moecloud-prefs';
const DEFAULTS: Prefs = {
  contrast: 0,
  trueBlack: false,
  shape: null,
  view: 'list',
  details: true,
  sort: 'name',
  order: 'asc',
  scale: 1,
  density: 'comfortable',
  tile: 1,
  motion: 'system',
  backdrop: 'plain',
};
const SCALES: Prefs['scale'][] = [0.9, 1, 1.1, 1.25];
const TILES: Prefs['tile'][] = [0.75, 1, 1.35];
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs> & { corners?: number };
    const { corners, ...rest } = stored;
    const shape = rest.shape === undefined && (corners === 0.5 || corners === 0.1) ? corners : (rest.shape ?? null);
    return {
      ...DEFAULTS,
      ...rest,
      shape,
      scale: SCALES.find((value) => value === rest.scale) ?? 1,
      tile: TILES.find((value) => value === rest.tile) ?? 1,
      density: rest.density === 'compact' ? 'compact' : 'comfortable',
      motion: rest.motion === 'reduced' ? 'reduced' : 'system',
      backdrop: rest.backdrop === 'glow' ? 'glow' : 'plain',
    };
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

export function applyDisplay(prefs: Prefs = current) {
  const root = document.documentElement;
  root.style.fontSize = prefs.scale === 1 ? '' : `${prefs.scale * 100}%`;
  root.style.setProperty('--moe-row', prefs.density === 'compact' ? '44px' : '56px');
  root.style.setProperty('--moe-tile', String(prefs.tile));
  root.dataset.motion = prefs.motion;
  root.dataset.backdrop = prefs.backdrop;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
