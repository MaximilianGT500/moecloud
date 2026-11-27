import { FEATURE_PARENT, FEATURE_SETTING, FEATURES, type Feature } from '../../shared/features.ts';
import type { UserRow } from './users.ts';
import * as settings from './settings.ts';

export const APP_SETTING = FEATURE_SETTING satisfies Record<Feature, settings.SettingKey>;

export function appEnabled(feature: Feature): boolean {
  const parent = FEATURE_PARENT[feature];
  if (parent && !appEnabled(parent)) return false;
  return Boolean(settings.get(APP_SETTING[feature]));
}

export const disabledApps = (): Feature[] => FEATURES.filter((feature) => !appEnabled(feature));

export const personal = (user: Pick<UserRow, 'role'> | null | undefined) =>
  Boolean(user) && user!.role !== 'guest' && user!.role !== 'team';

export const appAllowed = (feature: Feature, user: Pick<UserRow, 'role'> | null | undefined) => appEnabled(feature) && personal(user);

const under = (url: string, prefix: string) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`);

const ROUTES: [string, Feature][] = [
  ['/api/photos', 'photos'],
  ['/api/albums', 'photos'],
  ['/files/photos', 'photos'],
  ['/api/music', 'music'],
  ['/files/music', 'music'],
  ['/api/notes', 'notes'],
  ['/files/notes', 'notes'],
  ['/api/tags', 'tags'],
  ['/files/tags', 'tags'],
  ['/files/forms', 'forms'],
  ['/api/calendar/tasks', 'tasks'],
  ['/calendar/tasks', 'tasks'],
  ['/calendar/booking', 'booking'],
  ['/calendar/polls', 'polls'],
  ['/api/mail', 'mail'],
  ['/mail', 'mail'],
  ['/api/chat', 'chat'],
  ['/chat', 'chat'],
  ['/api/bookmarks', 'bookmarks'],
  ['/bookmarks', 'bookmarks'],
  ['/api/feeds', 'feeds'],
  ['/feeds', 'feeds'],
  ['/api/snippets', 'snippets'],
  ['/api/public/snippets', 'snippets'],
  ['/snippets', 'snippets'],
  ['/t', 'snippets'],
];

export function appForUrl(url: string): Feature | null {
  for (const [prefix, feature] of ROUTES) if (under(url, prefix)) return feature;
  return null;
}

export function pageFallback(url: string) {
  if (url.startsWith('/calendar')) return '/calendar';
  return '/files';
}
