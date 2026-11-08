import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime, formatMonth } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { c, curve, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import type { Action } from './ActionMenu';
import { Thumb, type Item } from './kinds';
import { Viewer } from './Viewer';

interface Cursor {
  at: number;
  seq: number;
}

interface Page {
  items: Item[];
  next: Cursor | null;
}

const timeOf = (item: Item) => item.takenAt ?? item.modifiedAt;
const monthKey = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}`;
};

export function Photos({ actions, onChanged }: { actions: (item: Item) => Action[]; onChanged: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Page>('/api/photos', abort.signal)
      .then((page) => {
        setItems(page.items);
        setNext(page.next);
        setError(null);
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [revision]);

  useLive((event) => {
    if (event !== 'change' && event !== 'reconnect') return;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setRevision((value) => value + 1), 600);
  });

  const more = async () => {
    if (!next || loading) return;
    setLoading(true);
    try {
      const page = await api.get<Page>(`/api/photos?at=${next.at}&seq=${next.seq}`);
      setItems((current) => {
        const seen = new Set((current ?? []).map((item) => item.id));
        return [...(current ?? []), ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNext(page.next);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !next) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void more();
      },
      { rootMargin: '600px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  if (error && !items) {
    return (
      <EmptyState
        icon={<ErrorOutlineRounded />}
        title={t('Das hat nicht geklappt')}
        text={error}
        action={
          <Button variant="tonal" onClick={() => setRevision((value) => value + 1)}>
            {t('Nochmal versuchen')}
          </Button>
        }
      />
    );
  }

  if (!items) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 2 }, py: 1 }} aria-busy="true" aria-label={t('Lädt')}>
        <Skeleton variant="text" width={180} sx={{ mb: 1.5 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 0.5 }}>
          {Array.from({ length: 18 }, (_, index) => (
            <Skeleton key={index} variant="rectangular" sx={{ aspectRatio: '1', height: 'auto', borderRadius: `${radius.sm}px` }} />
          ))}
        </Box>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<PhotoLibraryRounded />}
        title={t('Noch keine Fotos')}
        text={t('Bilder und Videos aus all deinen Ordnern erscheinen hier, sortiert nach Aufnahmedatum.')}
      />
    );
  }

  const groups: { key: string; time: number; items: Item[] }[] = [];
  for (const item of items) {
    const key = monthKey(timeOf(item));
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, time: timeOf(item), items: [item] });
  }
  const index = viewer ? items.findIndex((item) => item.id === viewer) : -1;

  return (
    <Box sx={{ px: { xs: 1, md: 2 }, pb: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {groups.map((group) => (
        <Box component="section" key={group.key} aria-labelledby={`month-${group.key}`}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, px: 0.5, mb: 1.25 }}>
            <Typography id={`month-${group.key}`} variant="subtitle1" component="h2" sx={{ fontWeight: 800 }}>
              {formatMonth(group.time)}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {tn(group.items.length, '{count} Element', '{count} Elemente')}
            </Typography>
          </Box>
          <Box
            role="list"
            sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(auto-fill, minmax(150px, 1fr))' }, gap: 0.5 }}
          >
            {group.items.map((item) => (
              <ButtonBase
                key={item.id}
                role="listitem"
                aria-label={t('{name}, aufgenommen {date}', { name: item.name, date: formatDateTime(timeOf(item)) })}
                onClick={() => setViewer(item.id)}
                sx={{
                  position: 'relative',
                  aspectRatio: '1',
                  overflow: 'hidden',
                  borderRadius: `${radius.sm}px`,
                  bgcolor: c.surfaceContainerHighest,
                  '& img': { transition: `transform 280ms ${curve.standard}` },
                  '&:hover img': { transform: 'scale(1.04)' },
                  '&.Mui-focusVisible': { outline: `3px solid ${c.primary}`, outlineOffset: 2 },
                }}
              >
                <Thumb item={item} size="100%" />
                {item.kind === 'video' && (
                  <PlayCircleRounded
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      right: 6,
                      bottom: 6,
                      fontSize: 26,
                      color: '#fff',
                      filter: 'drop-shadow(0 1px 3px rgb(0 0 0 / 0.6))',
                    }}
                  />
                )}
              </ButtonBase>
            ))}
          </Box>
        </Box>
      ))}
      <Box ref={sentinel} sx={{ display: 'grid', placeItems: 'center', minHeight: 48 }}>
        {next &&
          (loading ? (
            <CircularProgress size={28} aria-label={t('Lädt')} />
          ) : (
            <Button variant="tonal" onClick={() => void more()}>
              {t('Mehr laden')}
            </Button>
          ))}
      </Box>
      <Viewer
        items={items}
        index={index >= 0 ? index : null}
        onIndex={(position) => setViewer(position === null ? null : items[position].id)}
        actions={actions}
        onSaved={onChanged}
      />
    </Box>
  );
}
