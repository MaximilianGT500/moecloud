export interface SiteInfo {
  name: string;
  url: string;
  seed: string;
  version: string;
  registration: 'closed' | 'open' | 'invite';
  passkeys: boolean;
  legal: { label: string; href: string }[];
  notice?: { text: string; level: 'info' | 'warning'; until: number | null } | null;
  maintenance?: boolean;
  mail?: boolean;
}

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'user';
  language: 'de' | 'en' | null;
  rootId: string;
  initials: string;
}

export interface Storage {
  used: number;
  quota: number | null;
}

export interface Boot {
  page: string;
  lang: 'de' | 'en';
  site: SiteInfo;
  csrf: string;
  user?: SessionUser;
  storage?: Storage;
  webdav?: string;
  unread?: number;
  setup2fa?: boolean;
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
