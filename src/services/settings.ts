import { all, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import type { Lang } from '../lib/i18n.ts';
import defaultPalette from '../lib/default-palette.json' with { type: 'json' };

export type Palette = { dark: Record<string, string>; light: Record<string, string> };
export type Registration = 'closed' | 'open' | 'invite';
export type MailSecurity = 'tls' | 'starttls' | 'none';
export type SecondFactorPolicy = 'off' | 'admins' | 'all';

export interface ThemeSpec {
  seed: string;
  style: 'content' | 'tonal' | 'vibrant' | 'expressive' | 'fidelity' | 'neutral' | 'mono';
  secondary: string | null;
  tertiary: string | null;
  font: 'rounded' | 'system' | 'serif' | 'mono';
  corners: 1 | 0.5 | 0.1;
}

export interface SiteTheme extends ThemeSpec {
  id: string;
  name: string;
  css: string;
}

export interface CustomTheme extends SiteTheme {
  palette: Palette;
  updatedAt: number;
}

export interface UpdateInfo {
  version: string;
  date: string;
  url: string;
  security: boolean;
  notes: { de: string[]; en: string[] };
  checkedAt: number;
}

const env = process.env;
const envPort = Number(env.CLAMAV_PORT);
const smtpPort = Number(env.SMTP_PORT);
const smtpSecurity = (['tls', 'starttls', 'none'] as const).find((value) => value === env.SMTP_SECURITY);

const DEFAULTS = {
  'site.name': 'MoeCloud',
  'site.url': '',
  'site.seed': '#8b5cf6',
  'site.palette': defaultPalette as Palette,
  'theme.site': null as SiteTheme | null,
  'theme.custom': [] as CustomTheme[],
  'themes.personal': true,
  'plugins.state': {} as Record<string, { enabled: boolean; hash: string; at: number; stopped?: string }>,
  'plugins.settings': {} as Record<string, Record<string, string | number | boolean | null>>,
  'site.language': 'de' as Lang,
  'site.imprint': '',
  'site.privacy': '',
  'auth.registration': 'closed' as Registration,
  'auth.passkeys': true,
  'auth.require2fa': 'off' as SecondFactorPolicy,
  'auth.passwordMin': 10,
  'auth.passwordBreach': false,
  'report.weekly': false,
  'report.sent': '',
  'storage.defaultQuota': 0,
  'storage.maxUpload': 0,
  'storage.trashDays': 30,
  'storage.versions': 10,
  'storage.versionDays': 0,
  'share.links': true,
  'share.users': true,
  'share.requirePassword': false,
  'share.maxDays': 0,
  'share.stripLocation': true,
  'share.slugs': true,
  'share.reports': true,
  'users.directory': true,
  'users.selfDelete': false,
  'notice.text': '',
  'notice.level': 'info' as 'info' | 'warning',
  'notice.until': 0,
  'maintenance.enabled': false,
  'maintenance.message': '',
  'mail.enabled': Boolean(env.SMTP_HOST && env.SMTP_FROM),
  'mail.host': env.SMTP_HOST || '',
  'mail.port': Number.isInteger(smtpPort) && smtpPort > 0 ? smtpPort : smtpSecurity === 'tls' ? 465 : 587,
  'mail.security': (smtpSecurity ?? 'starttls') as MailSecurity,
  'mail.user': env.SMTP_USER || '',
  'mail.password': env.SMTP_PASSWORD || '',
  'mail.from': env.SMTP_FROM || '',
  'mail.fromName': env.SMTP_FROM_NAME || '',
  'oidc.enabled': Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID),
  'oidc.issuer': env.OIDC_ISSUER || '',
  'oidc.clientId': env.OIDC_CLIENT_ID || '',
  'oidc.clientSecret': env.OIDC_CLIENT_SECRET || '',
  'oidc.label': env.OIDC_LABEL || '',
  'oidc.autoCreate': env.OIDC_AUTO_CREATE === 'true',
  'oidc.adminGroup': env.OIDC_ADMIN_GROUP || '',
  'scan.enabled': Boolean(env.CLAMAV_HOST || env.CLAMAV_SOCKET),
  'scan.host': env.CLAMAV_HOST || '127.0.0.1',
  'scan.port': Number.isInteger(envPort) && envPort > 0 ? envPort : 3310,
  'scan.socket': env.CLAMAV_SOCKET || '',
  'scan.maxBytes': 100 * 1024 * 1024,
  'scan.onError': 'allow' as 'allow' | 'reject',
  'scan.rescanDays': 0,
  'backup.enabled': true,
  'backup.hour': 3,
  'backup.keep': 7,
  'backup.last': 0,
  'backup.copied': 0,
  'backup.copyError': '',
  'updates.check': true,
  'updates.latest': null as UpdateInfo | null,
  'updates.notified': '',
  'audit.days': 180,
  'activity.days': 90,
  'search.content': true,
  'import.enabled': true,
  'import.private': false,
  'push.enabled': true,
  'push.private': false,
  'push.vapid': null as { publicKey: string; privateKey: string } | null,
  'preview.revision': 1,
  'metrics.token': '',
  'setup.done': false,
  'setup.code': '',
  'secret.key': '',
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

const RELOAD_AFTER = 3000;
let cache: Partial<Settings> | null = null;
let loadedAt = 0;

function load(): Partial<Settings> {
  const now = Date.now();
  if (!cache || now - loadedAt > RELOAD_AFTER) {
    const next: Partial<Settings> = {};
    for (const row of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
      if (!(row.key in DEFAULTS)) continue;
      try {
        (next as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {}
    }
    cache = next;
    loadedAt = now;
  }
  return cache;
}

export function get<K extends SettingKey>(key: K): Settings[K] {
  const stored = load()[key];
  return (stored === undefined ? DEFAULTS[key] : stored) as Settings[K];
}

export function set<K extends SettingKey>(key: K, value: Settings[K]) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  load()[key] = value;
}

export function setMany(values: Partial<Settings>) {
  for (const [key, value] of Object.entries(values)) set(key as SettingKey, value as never);
}

export function reset() {
  cache = null;
}

export function secret(): string {
  let key = get('secret.key');
  if (!key) {
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', 'secret.key', JSON.stringify(randomId(48)));
    cache = null;
    key = get('secret.key');
  }
  return key;
}

export const PUBLIC_KEYS = [
  'themes.personal',
  'site.name',
  'site.url',
  'site.seed',
  'site.language',
  'site.imprint',
  'site.privacy',
  'auth.registration',
  'auth.passkeys',
  'auth.require2fa',
  'auth.passwordMin',
  'auth.passwordBreach',
  'report.weekly',
  'storage.defaultQuota',
  'storage.maxUpload',
  'storage.trashDays',
  'storage.versions',
  'storage.versionDays',
  'share.links',
  'share.users',
  'share.requirePassword',
  'share.maxDays',
  'share.stripLocation',
  'share.slugs',
  'share.reports',
  'users.directory',
  'users.selfDelete',
  'notice.text',
  'notice.level',
  'notice.until',
  'maintenance.enabled',
  'maintenance.message',
  'backup.enabled',
  'backup.hour',
  'backup.keep',
  'updates.check',
  'audit.days',
  'activity.days',
  'search.content',
  'import.enabled',
  'import.private',
  'push.enabled',
  'push.private',
] as const satisfies readonly SettingKey[];

export function adminView() {
  return Object.fromEntries(PUBLIC_KEYS.map((key) => [key, get(key)]));
}

export function activeNotice() {
  const text = get('notice.text').trim();
  const until = get('notice.until');
  if (!text || (until > 0 && until < Date.now())) return null;
  return { text, level: get('notice.level'), until: until || null };
}
