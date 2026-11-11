import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PhotoAlbumRounded from '@mui/icons-material/PhotoAlbumRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import RemoveCircleOutlineRounded from '@mui/icons-material/RemoveCircleOutlineRounded';
import SlideshowRounded from '@mui/icons-material/SlideshowRounded';
import WallpaperRounded from '@mui/icons-material/WallpaperRounded';
import { api } from '../../lib/api';
import { formatDateTime, formatMonth } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, curve, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import type { Action } from './ActionMenu';
import { attempt, triggerDownload } from './actions';
import { Thumb, type Item } from './kinds';
import { SelectionBar } from './Panels';
import { Viewer } from './Viewer';

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

async function renameAlbum(album: Album) {
  const name = await prompt({ title: t('Album umbenennen'), label: t('Name'), value: album.name, confirm: t('Umbenennen') });
  if (!name || name === album.name) return false;
  return (await attempt(() => api.patch(`/api/albums/${album.id}`, { name }))) !== undefined;
}

async function deleteAlbum(album: Album) {
  const ok = await confirm({
    title: t('„{name}“ löschen?', { name: album.name }),
    text: t('Nur das Album verschwindet. Die Fotos bleiben in ihren Ordnern.'),
    confirm: t('Löschen'),
    danger: true,
  });
  if (!ok) return false;
  return (await attempt(() => api.delete(`/api/albums/${album.id}`))) !== undefined;
}

export function AlbumMenu({ album, onChanged }: { album: Album; onChanged: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entries: { label: string; icon: ReactNode; run: () => Promise<void>; danger?: boolean }[] = [
    {
      label: t('Umbenennen'),
      icon: <DriveFileRenameOutlineRounded />,
      run: async () => {
        if (await renameAlbum(album)) onChanged();
      },
    },
    {
      label: t('Album löschen'),
      icon: <DeleteOutlineRounded />,
      danger: true,
      run: async () => {
        if (!(await deleteAlbum(album))) return;
        toast(t('Album gelöscht'));
        navigate('/files/photos/albums');
      },
    },
  ];
  return (
    <>
      <Tooltip title={t('Weitere Aktionen')}>
        <IconButton aria-label={t('Weitere Aktionen')} onClick={(event) => setAnchor(event.currentTarget)}>
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {entries.map((entry) => (
          <MenuItem
            key={entry.label}
            onClick={() => {
              setAnchor(null);
              void entry.run();
            }}
            sx={entry.danger ? { color: c.error } : undefined}
          >
            <ListItemIcon sx={entry.danger ? { color: c.error } : undefined}>{entry.icon}</ListItemIcon>
            <ListItemText>{entry.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function useAlbums(open = true) {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    api
      .get<{ items: Album[] }>('/api/albums', abort.signal)
      .then((data) => setAlbums(data.items))
      .catch(() => setAlbums((current) => current ?? []));
    return () => abort.abort();
  }, [open, revision]);
  useLive((event) => {
    if (event === 'albums' || event === 'change' || event === 'reconnect') setRevision((value) => value + 1);
  });
  return albums;
}

function Cover({ album, size = '100%' }: { album: Album; size?: number | string }) {
  return album.cover ? (
    <Thumb item={album.cover} size={size} />
  ) : (
    <Box sx={{ width: size, height: size, display: 'grid', placeItems: 'center', color: c.onSurfaceVariant }}>
      <PhotoAlbumRounded sx={{ fontSize: typeof size === 'number' ? size * 0.5 : 48 }} />
    </Box>
  );
}

export function AlbumList() {
  const albums = useAlbums();
  const create = async () => {
    const album = await newAlbum();
    if (album) navigate(albumHref(album.id));
  };
  if (!albums) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 2 }, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} variant="rounded" sx={{ aspectRatio: '1', height: 'auto' }} />
        ))}
      </Box>
    );
  }
  if (albums.length === 0) {
    return (
      <EmptyState
        icon={<PhotoAlbumRounded />}
        title={t('Noch keine Alben')}
        text={t('Sammle Fotos und Videos aus all deinen Ordnern in Alben, ohne sie zu verschieben.')}
        action={
          <Button variant="tonal" startIcon={<AddRounded />} onClick={() => void create()}>
            {t('Neues Album')}
          </Button>
        }
      />
    );
  }
  return (
    <Box
      component="ul"
      aria-label={t('Alben')}
      sx={{
        listStyle: 'none',
        m: 0,
        px: { xs: 1.5, md: 2 },
        pb: 4,
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(auto-fill, minmax(180px, 1fr))' },
      }}
    >
      <Box component="li">
        <ButtonBase
          onClick={() => void create()}
          sx={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: `${radius.lg}px`,
            border: `2px dashed ${c.outlineVariant}`,
            flexDirection: 'column',
            gap: 1,
            color: c.onSurfaceVariant,
          }}
        >
          <AddRounded sx={{ fontSize: 40 }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('Neues Album')}
          </Typography>
        </ButtonBase>
      </Box>
      {albums.map((album) => (
        <Box component="li" key={album.id}>
          <ButtonBase
            onClick={() => navigate(albumHref(album.id))}
            aria-label={t('Album {name}, {count}', { name: album.name, count: tn(album.count, '{count} Element', '{count} Elemente') })}
            sx={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              textAlign: 'left',
              gap: 1,
              borderRadius: `${radius.lg}px`,
              '& img': { transition: `transform 280ms ${curve.standard}` },
              '&:hover img': { transform: 'scale(1.03)' },
            }}
          >
            <Box sx={{ aspectRatio: '1', borderRadius: `${radius.lg}px`, overflow: 'hidden', bgcolor: c.surfaceContainerHighest }}>
              <Cover album={album} />
            </Box>
            <Box sx={{ px: 0.5, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                {album.name}
              </Typography>
              <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                {[tn(album.count, '{count} Element', '{count} Elemente'), albumRange(album)].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          </ButtonBase>
        </Box>
      ))}
    </Box>
  );
}

const timeOf = (item: Item) => item.takenAt ?? item.modifiedAt;

export function PhotoGrid({
  items,
  selected,
  onToggle,
  onOpen,
  label,
}: {
  items: Item[];
  selected: Set<string>;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  label?: string;
}) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; id: string; fired: boolean } | null>(null);
  const selecting = selected.size > 0;
  return (
    <Box
      role="list"
      aria-label={label}
      sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(auto-fill, minmax(150px, 1fr))' }, gap: 0.5 }}
    >
      {items.map((item) => {
        const active = selected.has(item.id);
        return (
          <Box
            key={item.id}
            role="listitem"
            sx={{
              position: 'relative',
              aspectRatio: '1',
              borderRadius: `${radius.sm}px`,
              overflow: 'hidden',
              bgcolor: c.surfaceContainerHighest,
              '&:hover .moe-pick, &:focus-within .moe-pick': { opacity: 1 },
            }}
          >
            <ButtonBase
              aria-label={t('{name}, aufgenommen {date}', { name: item.name, date: formatDateTime(timeOf(item)) })}
              onPointerDown={(event) => {
                if (event.pointerType !== 'touch') return;
                const timer = setTimeout(() => {
                  if (press.current) press.current.fired = true;
                  onToggle(item);
                }, 450);
                press.current = { timer, id: item.id, fired: false };
              }}
              onPointerUp={() => press.current && clearTimeout(press.current.timer)}
              onPointerLeave={() => press.current && clearTimeout(press.current.timer)}
              onContextMenu={(event) => {
                if (press.current?.id === item.id) event.preventDefault();
              }}
              onClick={() => {
                if (press.current?.fired && press.current.id === item.id) {
                  press.current = null;
                  return;
                }
                if (selecting) onToggle(item);
                else onOpen(item);
              }}
              sx={{
                width: '100%',
                height: '100%',
                '& img': { transition: `transform 280ms ${curve.standard}` },
                '&:hover img': { transform: active ? 'scale(0.9)' : 'scale(1.04)' },
                '&.Mui-focusVisible': { outline: `3px solid ${c.primary}`, outlineOffset: -3 },
                transform: active ? 'scale(0.9)' : 'none',
                borderRadius: active ? `${radius.md}px` : 0,
                overflow: 'hidden',
                transition: `transform 180ms ${curve.standard}`,
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
            <Checkbox
              className="moe-pick"
              size="small"
              checked={active}
              onChange={() => onToggle(item)}
              slotProps={{ input: { 'aria-label': t('{name} auswählen', { name: item.name }) } }}
              sx={{
                position: 'absolute',
                top: 2,
                left: 2,
                opacity: selecting ? 1 : 0,
                color: '#fff',
                filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.6))',
                '&.Mui-checked': { color: c.primary, filter: 'none' },
                '@media (hover: none)': { display: selecting ? 'inline-flex' : 'none' },
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
}

export function AlbumContent({ album, items, onChanged }: { album: Album; items: Item[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ index: number; autoplay: boolean; key: number } | null>(null);
  const chosen = items.filter((item) => selected.has(item.id));
  const firstImage = items.filter((item) => item.kind === 'image').length > 1 ? items.findIndex((item) => item.kind === 'image') : -1;
  const toggle = (item: Item) => {
    const next = new Set(selected);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setSelected(next);
  };

  const remove = async (targets: Item[]) => {
    const done = await attempt(() => api.post(`/api/albums/${album.id}/remove`, { ids: targets.map((item) => item.id) }));
    if (done === undefined) return;
    toast(tn(targets.length, 'Aus dem Album entfernt', '{count} Elemente aus dem Album entfernt'));
    setSelected(new Set());
    onChanged();
  };

  const cover = async (item: Item) => {
    if ((await attempt(() => api.patch(`/api/albums/${album.id}`, { coverId: item.id }))) === undefined) return;
    toast(t('Titelbild geändert'));
    setSelected(new Set());
    onChanged();
  };

  const actions = (item: Item): Action[] => [
    { key: 'cover', label: t('Als Titelbild festlegen'), icon: <WallpaperRounded />, onClick: () => void cover(item) },
    {
      key: 'remove',
      label: t('Aus dem Album entfernen'),
      icon: <RemoveCircleOutlineRounded />,
      onClick: () => {
        setViewer(null);
        void remove([item]);
      },
      danger: true,
    },
  ];

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<PhotoAlbumRounded />}
        title={t('Das Album ist leer')}
        text={t('Wähle unter Fotos oder in deinen Ordnern Bilder aus und füge sie über „Zum Album hinzufügen“ hinzu.')}
        action={
          <Button variant="tonal" onClick={() => navigate('/files/photos')}>
            {t('Zu den Fotos')}
          </Button>
        }
      />
    );
  }

  return (
    <Box sx={{ px: { xs: 1, md: 2 }, pb: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {chosen.length > 0 ? (
        <Box sx={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2 }}>
          <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
            {chosen.length === 1 && (
              <Tooltip title={t('Als Titelbild festlegen')}>
                <IconButton aria-label={t('Als Titelbild festlegen')} onClick={() => void cover(chosen[0])}>
                  <WallpaperRounded />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('Aus dem Album entfernen')}>
              <IconButton aria-label={t('Aus dem Album entfernen')} onClick={() => void remove(chosen)}>
                <RemoveCircleOutlineRounded />
              </IconButton>
            </Tooltip>
          </SelectionBar>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 0.5 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, flex: 1, minWidth: 160 }}>
            {[tn(album.count, '{count} Element', '{count} Elemente'), albumRange(album)].filter(Boolean).join(' · ')}
          </Typography>
          <Button
            variant="tonal"
            startIcon={<SlideshowRounded />}
            disabled={firstImage < 0}
            onClick={() => setViewer({ index: firstImage, autoplay: true, key: Date.now() })}
          >
            {t('Diashow')}
          </Button>
          <Button startIcon={<DownloadRounded />} onClick={() => triggerDownload(`/api/albums/${album.id}/zip`)}>
            {t('Herunterladen')}
          </Button>
        </Box>
      )}
      <PhotoGrid
        items={items}
        selected={selected}
        onToggle={toggle}
        onOpen={(item) => setViewer({ index: items.indexOf(item), autoplay: false, key: Date.now() })}
        label={album.name}
      />
      <Viewer
        key={viewer?.key ?? 'closed'}
        items={items}
        index={viewer ? viewer.index : null}
        autoplay={viewer?.autoplay}
        onIndex={(position) =>
          setViewer((current) => (position === null ? null : { index: position, autoplay: false, key: current?.key ?? Date.now() }))
        }
        actions={actions}
      />
    </Box>
  );
}

export function AlbumPicker({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone?: () => void }) {
  const albums = useAlbums();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = items.map((item) => item.id);

  const done = (album: { id: string; name: string }) => {
    toast(t('Zu „{name}“ hinzugefügt', { name: album.name }), {
      action: { label: t('Öffnen'), onClick: () => navigate(albumHref(album.id)) },
    });
    onDone?.();
    onClose();
  };

  const add = async (album: Album) => {
    setBusy(true);
    const result = await attempt(() => api.post(`/api/albums/${album.id}/items`, { ids }));
    setBusy(false);
    if (result !== undefined) done(album);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const result = await attempt(() => api.post<{ album: Album }>('/api/albums', { name, ids }));
    setBusy(false);
    if (result) done(result.album);
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{tn(items.length, 'Zum Album hinzufügen', '{count} Elemente zum Album hinzufügen')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 6 }}
        >
          <TextField
            size="small"
            fullWidth
            label={t('Neues Album')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <Button type="submit" variant="tonal" disabled={!name.trim() || busy} startIcon={<AddPhotoAlternateRounded />}>
            {t('Anlegen')}
          </Button>
        </form>
        {!albums ? (
          <CircularProgress size={24} aria-label={t('Lädt')} sx={{ alignSelf: 'center', my: 2 }} />
        ) : (
          <Box
            role="list"
            aria-label={t('Alben')}
            sx={{ display: 'flex', flexDirection: 'column', mx: -1, maxHeight: 360, overflowY: 'auto' }}
          >
            {albums.map((album) => (
              <ButtonBase
                key={album.id}
                role="listitem"
                disabled={busy}
                onClick={() => void add(album)}
                sx={{
                  justifyContent: 'flex-start',
                  gap: 1.5,
                  px: 1,
                  py: 0.75,
                  borderRadius: `${radius.md}px`,
                  textAlign: 'left',
                  '&:hover': { bgcolor: c.surfaceContainerHigh },
                }}
              >
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: `${radius.sm}px`,
                    overflow: 'hidden',
                    flex: 'none',
                    bgcolor: c.surfaceContainerHighest,
                  }}
                >
                  <Cover album={album} size={48} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {album.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {tn(album.count, '{count} Element', '{count} Elemente')}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
