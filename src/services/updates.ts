import { config } from '../config.ts';
import { requestJson } from '../lib/fetch.ts';
import type { UpdateInfo as PulseUpdate } from '../lib/moepulse.ts';
import { notifyAdmins } from './notify.ts';
import { pulse } from './pulse.ts';
import * as settings from './settings.ts';
import type { UpdateInfo } from './settings.ts';

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

const day = (time: number | null) => (time ? new Date(time).toISOString().slice(0, 10) : '');
const httpsOnly = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : '');

export function bullets(markdown: string | null | undefined) {
  if (!markdown) return [];
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]+/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 10);
}

export const customFeed = () => Boolean(process.env.UPDATE_CHECK_URL) && process.env.UPDATE_CHECK_URL !== 'off';

function remember(latest: UpdateInfo) {
  settings.set('updates.latest', latest);
  const urgent = latest.security || latest.yanked === true;
  if ((newer(latest.version, config.version) || latest.yanked) && settings.get('updates.notified') !== latest.version) {
    settings.set('updates.notified', latest.version);
    notifyAdmins('admin_update', { version: latest.version, security: urgent ? 1 : 0 }, '/admin');
  }
}

export function rememberPulseUpdate(info: PulseUpdate) {
  if (!info.latest) return null;
  const latest: UpdateInfo = {
    version: info.latest.version.replace(/^v/, ''),
    date: day(info.latest.date),
    url: httpsOnly(info.latest.url),
    security: info.security,
    notes: { de: bullets(info.latest.notes), en: [] },
    checkedAt: Date.now(),
    source: 'pulse',
    yanked: info.yanked,
    title: info.latest.title,
    markdown: info.latest.notes ? info.latest.notes.slice(0, 20_000) : null,
    releases: info.releases.slice(0, 10).map((release) => ({
      version: release.version.replace(/^v/, ''),
      date: day(release.date),
      security: release.security,
      url: httpsOnly(release.url),
    })),
  };
  remember(latest);
  return latest;
}

async function fromFeed(): Promise<UpdateInfo> {
  const feed = await requestJson<Feed>(config.updateUrl, { timeout: 10_000, maxBytes: 64 * 1024, headers: { 'User-Agent': 'MoeCloud' } });
  if (typeof feed.version !== 'string' || !/^v?\d+\.\d+\.\d+/.test(feed.version)) throw new Error('Die Versionsangabe ist ungültig');
  return {
    version: feed.version.replace(/^v/, ''),
    date: typeof feed.date === 'string' ? feed.date : '',
    url: typeof feed.changelog === 'string' ? httpsOnly(feed.changelog) : '',
    security: feed.security === true,
    notes: { de: list(feed.notes?.de), en: list(feed.notes?.en) },
    checkedAt: Date.now(),
    source: 'feed',
  };
}

export async function checkForUpdates(force = false) {
  if (!config.updateUrl || config.updateUrl === 'off') return updateStatus();
  if (!force && !settings.get('updates.check')) return updateStatus();
  if (!customFeed()) {
    const info = await pulse()
      .checkUpdate({ force })
      .catch(() => null);
    if (info?.latest) {
      rememberPulseUpdate(info);
      return updateStatus();
    }
  }
  remember(await fromFeed());
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
