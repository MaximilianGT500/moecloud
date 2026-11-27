import { api, csrfToken, ApiError } from '../../lib/api';
import { t } from '../../lib/i18n';

export interface Bookmark {
  id: string;
  url: string;
  host: string;
  title: string;
  description: string;
  tags: string[];
  icon: string | null;
  image: string | null;
  later: boolean;
  visits: number;
  visitedAt: number | null;
  status: number | null;
  dead: boolean;
  checkedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Counts {
  total: number;
  later: number;
  dead: number;
  untagged: number;
}

export type Filter = 'all' | 'later' | 'dead' | 'untagged';
export type Sort = 'new' | 'old' | 'name' | 'visits';

export interface Page {
  items: Bookmark[];
  more: boolean;
  total: number;
  counts: Counts;
  checking: boolean;
}

export interface BookmarkInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  later?: boolean;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
};

export const bookmarksApi = {
  list: (params: { q?: string; tag?: string; filter?: Filter; sort?: Sort; offset?: number; limit?: number }) =>
    api.get<Page>(`/api/bookmarks?${query(params)}`),
  tags: () => api.get<{ tags: { tag: string; count: number }[] }>('/api/bookmarks/tags'),
  preview: (url: string) =>
    api.post<{ url: string; status: number; title: string; description: string; feeds: { url: string; title: string }[] }>(
      '/api/bookmarks/preview',
      { url }
    ),
  create: (input: BookmarkInput) => api.post<{ bookmark: Bookmark; existing: boolean }>('/api/bookmarks', input),
  update: (id: string, patch: Partial<BookmarkInput>) => api.patch<{ bookmark: Bookmark }>(`/api/bookmarks/${id}`, patch),
  remove: (ids: string[]) => api.post<{ removed: number }>('/api/bookmarks/remove', { ids }),
  tag: (ids: string[], add: string[], remove: string[] = []) => api.post('/api/bookmarks/tag', { ids, add, remove }),
  renameTag: (from: string, to: string) => api.post<{ changed: number }>('/api/bookmarks/tags/rename', { from, to }),
  visit: (id: string) => api.post(`/api/bookmarks/${id}/visit`),
  refresh: (id: string) => api.post<{ bookmark: Bookmark }>(`/api/bookmarks/${id}/refresh`),
  check: () => api.post<{ started: boolean; count?: number }>('/api/bookmarks/check'),
};

export async function importBookmarks(file: File) {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch('/api/bookmarks/import', {
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

export const bookmarklet = (origin: string) =>
  `javascript:(()=>{window.open('${origin}/bookmarks?add='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'moe-bookmark','width=560,height=720')})()`;
