import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { attempt } from './actions';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: number;
}

let cache: SavedSearch[] | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function loadSearches() {
  pending ??= api
    .get<{ items: SavedSearch[] }>('/api/searches')
    .then((result) => {
      cache = result.items;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSavedSearches(enabled = true) {
  const value = useSyncExternalStore(subscribe, () => cache);
  useEffect(() => {
    if (enabled && !cache) void loadSearches();
  }, [enabled]);
  return value ?? [];
}

export const searchHref = (search: Pick<SavedSearch, 'query'>) => `/files/search?${search.query}`;

const KEYS = ['q', 'type', 'date', 'size', 'tag'];

export function currentQuery() {
  const params = new URLSearchParams(location.search);
  const clean = new URLSearchParams();
  for (const key of KEYS) {
    const value = params.get(key)?.trim();
    if (value) clean.set(key, value);
  }
  return clean.toString();
}

export async function saveSearch(suggestion: string) {
  const query = currentQuery();
  if (!query) return;
  const name = await prompt({ title: t('Suche speichern'), label: t('Name'), value: suggestion, confirm: t('Speichern') });
  if (!name?.trim()) return;
  if (await attempt(() => api.post('/api/searches', { name: name.trim(), query }))) {
    await loadSearches();
    toast(t('Suche gespeichert'));
  }
}

export async function removeSearch(search: SavedSearch) {
  const ok = await confirm({
    title: t('„{name}“ entfernen?', { name: search.name }),
    text: t('Nur die gespeicherte Suche verschwindet, deine Dateien bleiben.'),
    confirm: t('Entfernen'),
    danger: true,
  });
  if (!ok) return;
  if ((await attempt(() => api.delete(`/api/searches/${search.id}`))) !== undefined) await loadSearches();
}
