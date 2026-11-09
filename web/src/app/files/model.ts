import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { compareNames } from '../../lib/format';
import type { Prefs } from '../../lib/prefs';
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
  | { kind: 'search'; q: string; filter: string };

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
}

export function parseView(path: string, query: URLSearchParams, rootId: string): View {
  const folder = /^\/files\/folder\/([0-9A-Za-z]+)$/.exec(path);
  if (folder) return { kind: 'folder', id: folder[1] };
  if (path === '/files/photos') return { kind: 'photos' };
  if (path === '/files/recent') return { kind: 'recent' };
  if (path === '/files/activity') return { kind: 'activity' };
  if (path === '/files/storage') return { kind: 'storage' };
  if (path === '/files/starred') return { kind: 'starred' };
  if (path === '/files/shared') return { kind: 'shared' };
  if (path === '/files/trash') return { kind: 'trash' };
  if (path === '/files/search') return { kind: 'search', q: query.get('q') ?? '', filter: query.get('type') ?? '' };
  return { kind: 'folder', id: rootId };
}

export const viewKey = (view: View) =>
  view.kind === 'folder' ? `folder:${view.id}` : view.kind === 'search' ? `search:${view.q}:${view.filter}` : view.kind;

export const folderHref = (id: string, rootId: string) => (id === rootId ? '/files' : `/files/folder/${id}`);

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
      return { items: [], role: 'owner' };
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
      if (!view.q.trim()) return { items: [], role: 'owner' };
      const query = new URLSearchParams({ q: view.q });
      if (view.filter) query.set('kind', view.filter);
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
