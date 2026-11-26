import { config } from '../config.ts';
import { dialect, value } from '../lib/db.ts';
import { createPulse, describe, type Facts, type Pulse, type PulseOptions } from '../lib/moepulse.ts';
import * as settings from './settings.ts';

type Logger = { warn(message: string): void; debug(message: string): void };

let current: Pulse | null = null;
let logger: Logger | null = null;

const hostOf = (url: string) => {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
};

const count = (sql: string) => Number(value<number>(sql) ?? 0);

function features(): Facts {
  return {
    database: dialect(),
    scan: Boolean(settings.get('scan.enabled')),
    language: settings.get('site.language'),
    office: Boolean(config.officeUrl),
    sso: Boolean(settings.get('oidc.enabled')),
    plugins: config.plugins.enabled,
    mail: Boolean(settings.get('mail.enabled')),
    calendar: Boolean(settings.get('calendar.enabled')),
    caldav: Boolean(settings.get('calendar.enabled') && settings.get('calendar.caldav')),
  };
}

function metrics() {
  return {
    users: count("SELECT COUNT(*) FROM users WHERE role <> 'team'"),
    teams: count("SELECT COUNT(*) FROM users WHERE role = 'team'"),
    files: count("SELECT COUNT(*) FROM nodes WHERE type = 'file' AND trashed_at IS NULL"),
    folders: count("SELECT COUNT(*) FROM nodes WHERE type = 'folder' AND trashed_at IS NULL"),
    bytes: count('SELECT COALESCE(SUM(size), 0) FROM blobs'),
    links: count('SELECT COUNT(*) FROM links'),
    calendars: count('SELECT COUNT(*) FROM calendars WHERE trashed_at IS NULL'),
    events: count('SELECT COUNT(*) FROM events WHERE trashed_at IS NULL'),
  };
}

export function pulseOptions(extra: Partial<PulseOptions> = {}): PulseOptions {
  return {
    app: 'moecloud',
    version: config.version,
    dataDir: config.dataDir,
    install: config.install,
    root: config.root,
    paths: {
      blobs: config.paths.blobs,
      thumbs: config.paths.thumbs,
      previews: config.paths.previews,
      tmp: config.paths.tmp,
      backups: config.paths.backups,
      avatars: config.paths.avatars,
      site: config.paths.site,
      plugins: config.paths.plugins,
    },
    redact: () => {
      const urls = [settings.get('site.url'), config.publicUrl, config.officeUrl].filter(Boolean);
      return [...urls, ...urls.map(hostOf)].filter((entry) => entry.length > 3);
    },
    consent: () => ({ stats: settings.get('pulse.stats') === true, errors: settings.get('pulse.errors') === true }),
    features,
    metrics,
    log: (level, message) => (level === 'warn' ? logger?.warn(message) : logger?.debug(message)),
    ...extra,
  };
}

export const pulse = (): Pulse => (current ??= createPulse(pulseOptions()));

export function setPulse(next: Pulse | null) {
  current = next;
}

export function setPulseLogger(next: Logger | null) {
  logger = next;
}

export const pulseLocked = () => process.env.MOEPULSE_DISABLED === '1' || process.env.MOEPULSE_ENDPOINT === 'off';

export const pulseTexts = (lang: string) => describe(lang === 'en' ? 'en' : 'de', 'MoeCloud');

export function countPulse(name: 'upload' | 'share' | 'webdav' | 'form' | 'scan', by = 1) {
  try {
    pulse().count(name, by);
  } catch {}
}
