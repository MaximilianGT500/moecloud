export interface SiteInfo {
  name: string;
  logo?: string | null;
  url: string;
  seed: string;
  palette?: unknown;
  version: string;
  registration: 'closed' | 'open' | 'invite';
  passkeys: boolean;
  legal: { label: string; href: string }[];
  notice?: { text: string; level: 'info' | 'warning'; until: number | null } | null;
  maintenance?: boolean;
  mail?: boolean;
}

export interface ThemeBoot {
  id: string;
  name: string;
  source: 'site' | 'builtin' | 'custom' | 'own';
  personal: boolean;
  seed: string;
  style: 'content' | 'tonal' | 'vibrant' | 'expressive' | 'fidelity' | 'neutral' | 'mono';
  secondary: string | null;
  tertiary: string | null;
  font: 'rounded' | 'system' | 'serif' | 'mono' | 'geist' | 'legible' | 'fraunces';
  corners: 1 | 0.5 | 0.1;
}

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'user' | 'guest';
  language: 'de' | 'en' | null;
  rootId: string;
  initials: string;
  avatar?: string | null;
  zone: string;
}

export interface CalendarFeatures {
  caldav: boolean;
  publicLinks: boolean;
  subscriptions: boolean;
  imports?: boolean;
  booking: boolean;
  polls: boolean;
  externalInvites: boolean;
  freebusy: boolean;
  directory: boolean;
  trashDays: number;
  minRefresh: number;
}

export interface Storage {
  used: number;
  quota: number | null;
}

export type PluginIcon =
  | 'extension'
  | 'bolt'
  | 'chart'
  | 'send'
  | 'label'
  | 'print'
  | 'cloud'
  | 'star'
  | 'build'
  | 'image'
  | 'document'
  | 'lock'
  | 'download'
  | 'share'
  | 'schedule'
  | 'code';

export interface PluginAction {
  plugin: string;
  id: string;
  label: string;
  icon: PluginIcon;
  kinds: ('file' | 'folder')[];
  extensions: string[] | null;
  multiple: boolean;
  confirm: string;
}

export interface PluginPage {
  plugin: string;
  id: string;
  label: string;
  icon: PluginIcon;
  src: string;
}

export interface PluginBoot {
  actions: PluginAction[];
  pages: PluginPage[];
}

export interface Boot {
  page: string;
  lang: 'de' | 'en';
  site: SiteInfo;
  theme?: ThemeBoot;
  csrf: string;
  user?: SessionUser;
  teams?: number;
  start?: 'files' | 'home';
  nav?: { order: string[]; hidden: string[]; bar?: string[] } | null;
  storage?: Storage;
  webdav?: string;
  unread?: number;
  setup2fa?: boolean;
  plugins?: PluginBoot;
  forms?: boolean;
  calendarOn?: { booking: boolean; polls: boolean; caldav?: string | null } | null;
  contactsOn?: { carddav: string } | null;
  directory?: boolean;
  featuresOff?: string[];
  featuresDisabled?: string[];
  welcome?: boolean;
  caldav?: string;
  calendarFeatures?: CalendarFeatures;
}

let cached: Boot | null = null;

export function boot<T extends Boot = Boot>(): T {
  if (!cached) {
    try {
      cached = JSON.parse(document.getElementById('moe-boot')?.textContent || '{}') as Boot;
    } catch {
      cached = {} as Boot;
    }
    cached.site ??= {
      name: 'MoeCloud',
      url: location.origin,
      seed: '#8b5cf6',
      version: '',
      registration: 'closed',
      passkeys: true,
      legal: [],
    };
    cached.lang ??= 'de';
  }
  return cached as T;
}
