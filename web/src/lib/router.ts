import { useSyncExternalStore } from 'react';

const EVENT = 'moe:navigate';
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', emit);
window.addEventListener(EVENT, emit);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => location.pathname + location.search;

export function useLocation() {
  const value = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(value, location.origin);
  return { path: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams };
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (options.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVENT));
}

export function setQuery(key: string, value: string | null, replace = true) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  navigate(url.pathname + url.search, { replace });
}
