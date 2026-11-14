import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { compareNames } from '../../lib/format';
import { t } from '../../lib/i18n';
import type { Prefs } from '../../lib/prefs';
import type { Album } from './album';
import type { Item } from './kinds';

export type View =
  | { kind: 'folder'; id: string }
  | { kind: 'photos' }
  | { kind: 'recent' }
  | { kind: 'activity' }
  | { kind: 'storage' }
  | { kind: 'starred' }
  | { kind: 'shared' }
  | { kind: 'trash' }
  | { kind: 'tags' }
  | { kind: 'tag'; id: string }
  | { kind: 'albums' }
  | { kind: 'album'; id: string }
  | { kind: 'search'; q: string; filter: string; date: string; size: string; tag: string };

export interface Crumb {
  id: string;
  name: string;
}

export interface SharedLink {
  id: string;
  token: string;
  url: string;
  nodeId: string;
  label: string | null;
  hasPassword: boolean;
  expiresAt: number | null;
  expired: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  uploadOnly: boolean;
  notify?: boolean;
  views: number;
  downloads: number;
  maxDownloads?: number | null;
  paused?: boolean;
  exhausted?: boolean;
  createdAt: number;
  node?: Item;
}

export interface SharedGrant {
  id: string;
  nodeId: string;
  permission: 'view' | 'edit';
  createdAt: number;
  expiresAt?: number | null;
  user: { id: number; name: string; username: string; initials: string } | null;
  group?: { id: number; name: string; members: number } | null;
  node?: Item;
}

export interface Listing {
  items: Item[];
  folder?: Item;
  breadcrumbs?: Crumb[];
  role: 'owner' | 'edit' | 'view';
  sharedRoot?: string | null;
  links?: SharedLink[];
  grants?: SharedGrant[];
  trashDays?: number;
  tag?: { id: string; name: string; color: string };
  album?: Album;
}

export function parseView(path: string, query: URLSearchParams, rootId: string): View {
  const folder = /^\/files\/folder\/([0-9A-Za-z]+)$/.exec(path);
  if (folder) return { kind: 'folder', id: folder[1] };
  if (path === '/files/photos') return { kind: 'photos' };
  if (path === '/files/photos/albums') return { kind: 'albums' };
  const album = /^\/files\/photos\/albums\/([0-9A-Za-z]+)$/.exec(path);
  if (album) return { kind: 'album', id: album[1] };
  if (path === '/files/recent') return { kind: 'recent' };
  if (path === '/files/activity') return { kind: 'activity' };
  if (path === '/files/storage') return { kind: 'storage' };
  if (path === '/files/starred') return { kind: 'starred' };
  if (path === '/files/shared') return { kind: 'shared' };
  if (path === '/files/trash') return { kind: 'trash' };
  if (path === '/files/tags') return { kind: 'tags' };
  const tag = /^\/files\/tags\/([0-9A-Za-z]+)$/.exec(path);
  if (tag) return { kind: 'tag', id: tag[1] };
  if (path === '/files/search') {
    return {
      kind: 'search',
      q: query.get('q') ?? '',
      filter: query.get('type') ?? '',
      date: query.get('date') ?? '',
      size: query.get('size') ?? '',
      tag: query.get('tag') ?? '',
    };
  }
  return { kind: 'folder', id: rootId };
}

export const viewKey = (view: View) =>
  view.kind === 'folder' || view.kind === 'tag' || view.kind === 'album'
    ? `${view.kind}:${view.id}`
    : view.kind === 'search'
      ? `search:${view.q}:${view.filter}:${view.date}:${view.size}:${view.tag}`
      : view.kind;

export const folderHref = (id: string, rootId: string) => (id === rootId ? '/files' : `/files/folder/${id}`);

const DAY = 86_400_000;
const MB = 1024 * 1024;

export const DATE_FILTERS: { value: string; label: string; range: () => { after?: number; before?: number } }[] = [
  { value: 'today', label: t('Heute'), range: () => ({ after: new Date().setHours(0, 0, 0, 0) }) },
  { value: 'week', label: t('Letzte 7 Tage'), range: () => ({ after: Date.now() - 7 * DAY }) },
  { value: 'month', label: t('Letzte 30 Tage'), range: () => ({ after: Date.now() - 30 * DAY }) },
  { value: 'year', label: t('Dieses Jahr'), range: () => ({ after: new Date(new Date().getFullYear(), 0, 1).getTime() }) },
  { value: 'older', label: t('Älter als ein Jahr'), range: () => ({ before: Date.now() - 365 * DAY }) },
];

export const SIZE_FILTERS: { value: string; label: string; minSize?: number; maxSize?: number }[] = [
  { value: 'small', label: t('Unter 1 MB'), maxSize: MB },
  { value: 'medium', label: t('1 bis 100 MB'), minSize: MB, maxSize: 100 * MB },
  { value: 'large', label: t('Über 100 MB'), minSize: 100 * MB },
  { value: 'huge', label: t('Über 1 GB'), minSize: 1024 * MB },
];

export function searchQuery(view: Extract<View, { kind: 'search' }>) {
  const query = new URLSearchParams();
  if (view.q.trim()) query.set('q', view.q.trim());
  if (view.filter) query.set('kind', view.filter);
  const date = DATE_FILTERS.find((entry) => entry.value === view.date)?.range();
  if (date?.after !== undefined) query.set('after', String(date.after));
  if (date?.before !== undefined) query.set('before', String(date.before));
  const size = SIZE_FILTERS.find((entry) => entry.value === view.size);
  if (size?.minSize !== undefined) query.set('minSize', String(size.minSize));
  if (size?.maxSize !== undefined) query.set('maxSize', String(size.maxSize));
  if (view.tag) query.set('tag', view.tag);
  if (!query.has('q') && !view.filter && !date && !size && !view.tag) return null;
  return query;
}

async function fetchListing(view: View, signal: AbortSignal): Promise<Listing> {
  switch (view.kind) {
    case 'folder': {
      const data = await api.get<{
        folder: Item;
        breadcrumbs: Crumb[];
        role: Listing['role'];
        shared: { rootId: string } | null;
        items: Item[];
      }>(`/api/nodes/${view.id}/children`, signal);
      return {
        items: data.items,
        folder: data.folder,
        breadcrumbs: data.breadcrumbs,
        role: data.role,
        sharedRoot: data.shared?.rootId ?? null,
      };
    }
    case 'photos':
    case 'activity':
    case 'storage':
    case 'tags':
    case 'albums':
      return { items: [], role: 'owner' };
    case 'album': {
      const data = await api.get<{ album: Album; items: Item[] }>(`/api/albums/${view.id}`, signal);
      return { items: data.items, role: 'owner', album: data.album };
    }
    case 'tag': {
      const data = await api.get<{ tag: Listing['tag']; items: Item[] }>(`/api/tags/${view.id}/nodes`, signal);
      return { items: data.items, role: 'owner', tag: data.tag };
    }
    case 'recent':
      return { items: (await api.get<{ items: Item[] }>('/api/recent', signal)).items, role: 'owner' };
    case 'starred':
      return { items: (await api.get<{ items: Item[] }>('/api/starred', signal)).items, role: 'owner' };
    case 'trash': {
      const data = await api.get<{ items: Item[]; days: number }>('/api/trash', signal);
      return { items: data.items, role: 'owner', trashDays: data.days };
    }
    case 'shared': {
      const data = await api.get<{ withMe: Item[]; links: SharedLink[]; grants: SharedGrant[] }>('/api/shared', signal);
      return { items: data.withMe, links: data.links, grants: data.grants, role: 'view' };
    }
    case 'search': {
      const query = searchQuery(view);
      if (!query) return { items: [], role: 'owner' };
      return { items: (await api.get<{ items: Item[] }>(`/api/search?${query}`, signal)).items, role: 'owner' };
    }
  }
}

export function useListing(view: View) {
  const key = viewKey(view);
  const viewRef = useRef(view);
  const [state, setState] = useState<{ key: string; data: Listing | null; error: string | null }>({ key: '', data: null, error: null });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    viewRef.current = view;
  });

  useEffect(() => {
    const abort = new AbortController();
    fetchListing(viewRef.current, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setState({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError' || abort.signal.aborted) return;
        setState((previous) => ({ key, data: previous.key === key ? previous.data : null, error: errorText(error) }));
      });
    return () => abort.abort();
  }, [key, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: !fresh, reload };
}

export function sortItems(items: Item[], sort: Prefs['sort'], order: Prefs['order']) {
  const direction = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    let result = 0;
    if (sort === 'modified') result = a.modifiedAt - b.modifiedAt;
    else if (sort === 'size') result = (a.type === 'folder' ? (a.items ?? 0) : a.size) - (b.type === 'folder' ? (b.items ?? 0) : b.size);
    if (result === 0) result = compareNames(a.name, b.name);
    return result * direction;
  });
}

export const canEdit = (item: Item) => item.role === 'owner' || item.role === 'edit';
