import { api, ApiError, csrfToken } from '../../lib/api';
import { t } from '../../lib/i18n';

export interface Feed {
  id: string;
  url: string;
  title: string;
  site: string;
  icon: string | null;
  folder: string;
  kind: 'news' | 'podcast';
  error: string | null;
  errors: number;
  fetchedAt: number | null;
  unread: number;
  total: number;
}

export interface Media {
  type: string;
  duration: number | null;
  position: number;
}

export interface Item {
  id: number;
  feed: string;
  feedTitle: string;
  feedIcon: string | null;
  url: string;
  title: string;
  author: string;
  summary: string;
  image: string | null;
  media: Media | null;
  publishedAt: number;
  read: boolean;
  starred: boolean;
}

export type ItemFilter = 'unread' | 'all' | 'starred' | 'media';

export interface Scope {
  feed?: string;
  folder?: string;
  filter: ItemFilter;
  q?: string;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
};

export const feedsApi = {
  feeds: () => api.get<{ feeds: Feed[]; starred: number; episodes: number }>('/api/feeds'),
  add: (url: string, folder?: string) => api.post<{ feed: Feed; existing: boolean }>('/api/feeds', { url, folder }),
  update: (id: string, patch: { title?: string; folder?: string; kind?: Feed['kind'] }) =>
    api.patch<{ feed: Feed }>(`/api/feeds/${id}`, patch),
  remove: (id: string) => api.delete(`/api/feeds/${id}`),
  renameFolder: (from: string, to: string) => api.post('/api/feeds/folders/rename', { from, to }),
  refresh: (feed?: string) => api.post<{ done: boolean; added: number }>('/api/feeds/refresh', feed ? { feed } : {}),
  items: (scope: Scope, before?: string) =>
    api.get<{ items: Item[]; next: string | null }>(
      `/api/feeds/items?${query({ feed: scope.feed, folder: scope.folder, filter: scope.filter, q: scope.q || undefined, before })}`
    ),
  item: (id: number) => api.get<{ item: Item }>(`/api/feeds/items/${id}`),
  read: (input: { ids?: number[]; feed?: string; folder?: string; all?: boolean; before?: number }, read = true) =>
    api.post<{ changed: number }>('/api/feeds/items/read', { ...input, read }),
  star: (id: number, starred: boolean) => api.post(`/api/feeds/items/${id}/star`, { starred }),
  position: (id: number, position: number, duration: number | null) =>
    api.put<{ position: number; done: boolean }>(`/api/feeds/items/${id}/position`, { position, duration }),
  save: (id: number) => api.post<{ started: boolean }>(`/api/feeds/items/${id}/save`),
};

export const bodyUrl = (id: number, dark: boolean, size: string) => `/api/feeds/items/${id}/body?dark=${dark ? 1 : 0}&size=${size}`;
export const mediaUrl = (id: number) => `/api/feeds/items/${id}/media`;

export async function importOpml(file: File) {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch('/api/feeds/import', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      String(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal')),
      data.error ?? {}
    );
  return data as { added: number; skipped: number };
}

export function clock(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–:–';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
