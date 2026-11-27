import { useSyncExternalStore } from 'react';
import { FEATURE_PARENT, FEATURES, type Feature } from '../../../shared/features';
import { boot } from './boot';

let off: ReadonlySet<string> = new Set(boot().featuresOff ?? []);
const disabled: ReadonlySet<string> = new Set(boot().featuresDisabled ?? []);
let version = 0;
const listeners = new Set<() => void>();

export const featureAvailable = (key: Feature) => !disabled.has(key) && !(FEATURE_PARENT[key] && disabled.has(FEATURE_PARENT[key]!));

export const featureOn = (key: Feature) => featureAvailable(key) && !off.has(key);

export const featuresOff = () => FEATURES.filter((key) => off.has(key));

export function setFeaturesOff(keys: readonly string[]) {
  off = new Set(keys);
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeatures() {
  useSyncExternalStore(subscribe, () => version);
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
  mail: 'mail',
  chat: 'chat',
  bookmarks: 'bookmarks',
  feeds: 'feeds',
  snippets: 'snippets',
  albums: 'photos',
  memories: 'photos',
  events: 'calendar',
};

export const shownByFeature = (key: string) => !NAV[key] || featureOn(NAV[key]);
