import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import { api, errorText } from '../../lib/api';
import { formatMonth } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { c, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import type { Action } from './ActionMenu';
import { download } from './actions';
import { AlbumPicker, PhotoGrid } from './Albums';
import type { Item } from './kinds';
import { Memories } from './Memories';
import { SelectionBar } from './Panels';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<Item[] | null>(null);
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
  const chosen = items.filter((item) => selected.has(item.id));
  const toggle = (item: Item) => {
    const next = new Set(selected);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setSelected(next);
  };

  return (
    <Box sx={{ px: { xs: 1, md: 2 }, pb: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {chosen.length > 0 && (
        <Box sx={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2, mb: -1.5 }}>
          <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
            <Tooltip title={t('Zum Album hinzufügen')}>
              <IconButton aria-label={t('Zum Album hinzufügen')} onClick={() => setPicking(chosen)}>
                <AddPhotoAlternateRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Herunterladen')}>
              <IconButton aria-label={t('Herunterladen')} onClick={() => download(chosen)}>
                <DownloadRounded />
              </IconButton>
            </Tooltip>
          </SelectionBar>
        </Box>
      )}
      <Memories actions={actions} revision={revision} />
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
          <PhotoGrid
            items={group.items}
            selected={selected}
            onToggle={toggle}
            onOpen={(item) => setViewer(item.id)}
            label={formatMonth(group.time)}
          />
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
        actions={(item) => [
          ...actions(item),
          { key: 'album', label: t('Zum Album hinzufügen'), icon: <AddPhotoAlternateRounded />, onClick: () => setPicking([item]) },
        ]}
        onSaved={onChanged}
      />
      {picking && <AlbumPicker items={picking} onClose={() => setPicking(null)} onDone={() => setSelected(new Set())} />}
    </Box>
  );
}
