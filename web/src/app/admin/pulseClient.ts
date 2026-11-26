import { useEffect, useState } from 'react';
import { api, csrfToken } from '../../lib/api';
import { createSupportClient, type PulseChoice, type PulseTexts } from '../../moepulse';

export interface PulseInfo {
  texts: PulseTexts;
  value: PulseChoice;
  status: { installId: string | null; lastHeartbeat: number | null; lastError: string | null; running: boolean };
  locked: boolean;
  unread: number;
  updates: boolean;
  install: string;
}

export const supportClient = createSupportClient('/api/admin/moepulse/support', {
  headers: () => ({ 'X-CSRF-Token': csrfToken() }),
});

export const loadPulse = () => api.get<PulseInfo>('/api/admin/pulse');

const unreadListeners = new Set<(count: number) => void>();

export function announceUnread(count: number) {
  queueMicrotask(() => {
    for (const listener of unreadListeners) listener(count);
  });
}

export function usePulseUnread() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    unreadListeners.add(setUnread);
    loadPulse()
      .then((info) => setUnread(info.unread))
      .catch(() => {});
    return () => {
      unreadListeners.delete(setUnread);
    };
  }, []);
  return unread;
}
