import { api } from '../../lib/api';
import { formatMonth } from '../../lib/format';
import { t } from '../../lib/i18n';
import { prompt } from '../common/dialogs';
import { attempt } from './actions';
import type { Item } from './kinds';

export interface Album {
  id: string;
  name: string;
  count: number;
  coverId: string | null;
  cover: Item | null;
  from: number | null;
  to: number | null;
  createdAt: number;
  updatedAt: number;
}

export const albumHref = (id: string) => `/files/photos/albums/${id}`;

export function albumRange(album: Pick<Album, 'from' | 'to'>) {
  if (!album.from || !album.to) return '';
  const from = formatMonth(album.from);
  const to = formatMonth(album.to);
  return from === to ? from : t('{from} bis {to}', { from, to });
}

export async function newAlbum(ids: string[] = []) {
  const name = await prompt({ title: t('Neues Album'), label: t('Name'), value: '', confirm: t('Anlegen') });
  if (!name) return null;
  const done = await attempt(() => api.post<{ album: Album }>('/api/albums', { name, ids }));
  return done?.album ?? null;
}
