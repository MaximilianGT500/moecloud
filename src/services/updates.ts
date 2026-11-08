import { config } from '../config.ts';
import { requestJson } from '../lib/fetch.ts';
import { notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';

interface Feed {
  version?: unknown;
  date?: unknown;
  changelog?: unknown;
  security?: unknown;
  notes?: { de?: unknown; en?: unknown };
}

const parts = (version: string) =>
  version
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

export function newer(candidate: string, current: string) {
  const a = parts(candidate);
  const b = parts(current);
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

export const updatesEnabled = () => Boolean(config.updateUrl) && config.updateUrl !== 'off' && settings.get('updates.check');

const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 10) : [];

export async function checkForUpdates(force = false) {
  if (!config.updateUrl || config.updateUrl === 'off') return updateStatus();
  if (!force && !settings.get('updates.check')) return updateStatus();
  const feed = await requestJson<Feed>(config.updateUrl, { timeout: 10_000, maxBytes: 64 * 1024, headers: { 'User-Agent': 'MoeCloud' } });
  if (typeof feed.version !== 'string' || !/^v?\d+\.\d+\.\d+/.test(feed.version)) throw new Error('Die Versionsangabe ist ungültig');
  const version = feed.version.replace(/^v/, '');
  settings.set('updates.latest', {
    version,
    date: typeof feed.date === 'string' ? feed.date : '',
    url: typeof feed.changelog === 'string' && /^https:\/\//.test(feed.changelog) ? feed.changelog : '',
    security: feed.security === true,
    notes: { de: list(feed.notes?.de), en: list(feed.notes?.en) },
    checkedAt: Date.now(),
  });
  if (newer(version, config.version) && settings.get('updates.notified') !== version) {
    settings.set('updates.notified', version);
    notifyAdmins('admin_update', { version, security: feed.security === true ? 1 : 0 }, '/admin');
  }
  return updateStatus();
}

export function updateStatus() {
  const latest = settings.get('updates.latest');
  return {
    current: config.version,
    enabled: updatesEnabled(),
    locked: !config.updateUrl || config.updateUrl === 'off',
    latest,
    available: Boolean(latest && newer(latest.version, config.version)),
    install: config.install,
  };
}
