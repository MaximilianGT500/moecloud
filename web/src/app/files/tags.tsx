import { useEffect, useMemo, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import AddRounded from '@mui/icons-material/AddRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { folderColor } from '../../theme/tokens';
import { FOLDER_COLOR_OPTIONS } from './kinds';

export interface Tag {
  id: string;
  name: string;
  color: string;
  count: number;
}

let cache: Tag[] | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadTags() {
  pending ??= api
    .get<{ items: Tag[] }>('/api/tags')
    .then((data) => {
      cache = data.items;
      for (const listener of listeners) listener();
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

export function useTags() {
  return useSyncExternalStore(subscribe, () => cache) ?? [];
}

export function useTagSync() {
  useEffect(() => {
    if (!cache) void loadTags();
  }, []);
  useLive((event) => {
    if (event === 'tags' || event === 'reconnect') void loadTags();
  });
}

export const colorOptions = () =>
  FOLDER_COLOR_OPTIONS.map((option) => ({ key: option.key, label: t(option.label), color: folderColor(option.key) }));

function useTagMap() {
  const tags = useTags();
  return useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
}

export function TagDots({ ids, size = 8 }: { ids?: string[]; size?: number }) {
  const map = useTagMap();
  const tags = (ids ?? []).map((id) => map.get(id)).filter((tag): tag is Tag => Boolean(tag));
  if (tags.length === 0) return null;
  const names = tags.map((tag) => tag.name).join(', ');
  return (
    <Box
      component="span"
      role="img"
      aria-label={t('Schlagwörter: {names}', { names })}
      title={names}
      sx={{ display: 'inline-flex', alignItems: 'center', flex: 'none', pl: 0.75 }}
    >
      {tags.slice(0, 4).map((tag) => (
        <Box
          key={tag.id}
          component="span"
          sx={{ width: size, height: size, borderRadius: '50%', bgcolor: folderColor(tag.color), ml: '3px' }}
        />
      ))}
    </Box>
  );
}

export function TagChips({ ids, onEdit }: { ids?: string[]; onEdit?: () => void }) {
  const map = useTagMap();
  const tags = (ids ?? []).map((id) => map.get(id)).filter((tag): tag is Tag => Boolean(tag));
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
      {tags.map((tag) => (
        <Chip
          key={tag.id}
          size="small"
          label={tag.name}
          onClick={() => navigate(`/files/tags/${tag.id}`)}
          icon={
            <Box
              component="span"
              sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: folderColor(tag.color), ml: '8px !important' }}
            />
          }
          variant="outlined"
        />
      ))}
      {onEdit && (
        <Chip
          size="small"
          variant="outlined"
          icon={tags.length ? <SellRounded /> : <AddRounded />}
          label={tags.length ? t('Ändern') : t('Schlagwort hinzufügen')}
          onClick={onEdit}
        />
      )}
    </Box>
  );
}
