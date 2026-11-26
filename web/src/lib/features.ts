import { useSyncExternalStore } from 'react';
import { FEATURES, type Feature } from '../../../shared/features';
import { boot } from './boot';

let off: ReadonlySet<string> = new Set(boot().featuresOff ?? []);
const listeners = new Set<() => void>();

export const featureOn = (key: Feature) => !off.has(key);

export const featuresOff = () => FEATURES.filter((key) => off.has(key));

export function setFeaturesOff(keys: readonly string[]) {
  off = new Set(keys);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeatures() {
  useSyncExternalStore(subscribe, () => off);
  return featureOn;
}

const NAV: Record<string, Feature> = {
  photos: 'photos',
  music: 'music',
  notes: 'notes',
  forms: 'forms',
  tags: 'tags',
  calendar: 'calendar',
  tasks: 'tasks',
  booking: 'booking',
  polls: 'polls',
  contacts: 'contacts',
  albums: 'photos',
  memories: 'photos',
  events: 'calendar',
};

export const shownByFeature = (key: string) => !NAV[key] || featureOn(NAV[key]);
