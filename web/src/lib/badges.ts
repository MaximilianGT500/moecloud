import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { boot } from './boot';
import { featureOn } from './features';

export interface Badges {
  mail: number;
  chat: number;
  feeds: number;
}

let current: Badges = { mail: 0, chat: 0, feeds: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;
let pending: Promise<void> | null = null;

export function setBadges(patch: Partial<Badges>) {
  const next = { ...current, ...patch };
  if (next.mail === current.mail && next.chat === current.chat && next.feeds === current.feeds) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function refreshBadges() {
  if (!boot().user || boot().setup2fa || boot().user?.role === 'guest') return Promise.resolve();
  if (!featureOn('mail') && !featureOn('chat') && !featureOn('feeds')) return Promise.resolve();
  pending ??= api
    .get<Badges>('/api/badges')
    .then(setBadges)
    .catch(() => {})
    .finally(() => {
      pending = null;
    });
  return pending;
}

const visible = () => {
  if (document.visibilityState === 'visible') void refreshBadges();
};

export function useBadges(): Badges {
  useEffect(() => {
    users++;
    if (users === 1) {
      void refreshBadges();
      timer = setInterval(visible, 90_000);
      document.addEventListener('visibilitychange', visible);
    }
    return () => {
      users--;
      if (users === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        document.removeEventListener('visibilitychange', visible);
      }
    };
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
