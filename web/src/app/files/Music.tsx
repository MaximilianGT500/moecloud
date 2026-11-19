import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AlbumRounded from '@mui/icons-material/AlbumRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import PlaylistPlayRounded from '@mui/icons-material/PlaylistPlayRounded';
import PlaylistRemoveRounded from '@mui/icons-material/PlaylistRemoveRounded';
import QueueMusicRounded from '@mui/icons-material/QueueMusicRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { api, errorText } from '../../lib/api';
import { compareNames, formatDuration } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, mix, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { thumbUrl, type Item } from './kinds';
import { enqueue, playItems, usePlayer } from './player';

export type MusicTab = 'tracks' | 'albums' | 'artists' | 'playlists';

export interface Track extends Item {
  track: { title: string; artist: string; album: string; year: number | null; number: number | null; duration: number | null };
}

interface Playlist {
  id: string;
  name: string;
  count: number;
  cover: Item | null;
  updatedAt: number;
}

interface Group {
  key: string;
  name: string;
  detail: string;
  tracks: Track[];
  cover: Track | null;
}

const PAGE = 400;

export const musicHref = (tab: MusicTab, id?: string | null) =>
  tab === 'tracks' ? '/files/music' : `/files/music/${tab}${id ? `/${id}` : ''}`;

const groupHref = (tab: 'albums' | 'artists', key: string) => `/files/music/${tab}?name=${encodeURIComponent(key)}`;

const byNumber = (a: Track, b: Track) => (a.track.number ?? 9999) - (b.track.number ?? 9999) || compareNames(a.name, b.name);

const byArtist = (a: Track, b: Track) =>
  compareNames(a.track.artist, b.track.artist) || compareNames(a.track.album, b.track.album) || byNumber(a, b);

const totalTime = (tracks: Track[]) => tracks.reduce((sum, track) => sum + (track.track.duration ?? 0), 0);

function countLine(tracks: Track[]) {
  const seconds = totalTime(tracks);
  return [tn(tracks.length, '{count} Titel', '{count} Titel'), seconds > 0 ? formatDuration(seconds) : null].filter(Boolean).join(' · ');
}

function albumsOf(tracks: Track[]): Group[] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = track.track.album.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), track]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(byNumber);
      const artists = [...new Set(sorted.map((track) => track.track.artist).filter(Boolean))];
      return {
        key,
        name: sorted[0].track.album || t('Ohne Album'),
        detail: artists.length === 1 ? artists[0] : artists.length > 1 ? t('Verschiedene Interpreten') : '',
        tracks: sorted,
        cover: sorted.find((track) => track.thumb) ?? null,
      };
    })
    .sort((a, b) => Number(a.key === '') - Number(b.key === '') || compareNames(a.name, b.name));
}

function artistsOf(tracks: Track[]): Group[] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = track.track.artist.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), track]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => compareNames(a.track.album, b.track.album) || byNumber(a, b));
      const albums = new Set(sorted.map((track) => track.track.album).filter(Boolean)).size;
      return {
        key,
        name: sorted[0].track.artist || t('Unbekannt'),
        detail: [albums > 0 ? tn(albums, '{count} Album', '{count} Alben') : null, tn(sorted.length, '{count} Titel', '{count} Titel')]
          .filter(Boolean)
          .join(' · '),
        tracks: sorted,
        cover: sorted.find((track) => track.thumb) ?? null,
      };
    })
    .sort((a, b) => Number(a.key === '') - Number(b.key === '') || compareNames(a.name, b.name));
}

function Cover({ item, size, round = false, icon }: { item: Item | null; size: number | string; round?: boolean; icon?: ReactNode }) {
  return (
    <Box
      sx={{
        width: size,
        aspectRatio: '1',
        flex: 'none',
        borderRadius: round ? '50%' : `${radius.sm}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        bgcolor: c.surfaceContainerHighest,
        color: c.onSurfaceVariant,
        '& img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      }}
    >
      {item?.thumb ? <img src={thumbUrl(item)} alt="" loading="lazy" /> : (icon ?? <MusicNoteRounded />)}
    </Box>
  );
}

function usePlaylists() {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const load = () =>
    api
      .get<{ items: Playlist[] }>('/api/playlists')
      .then((result) => setLists(result.items))
      .catch((error) => {
        setLists((current) => current ?? []);
        toast(errorText(error));
      });
  useEffect(() => {
    void load();
  }, []);
  useLive((event) => {
    if (event === 'reconnect' || event === 'playlists') void load();
  });
  return { lists, reload: load };
}

async function newPlaylist(ids: string[] = []) {
  const name = await prompt({
    title: t('Neue Wiedergabeliste'),
    label: t('Name'),
    value: '',
    confirm: t('Anlegen'),
    maxLength: 100,
  });
  if (!name?.trim()) return null;
  try {
    return (await api.post<{ playlist: Playlist }>('/api/playlists', { name, ids })).playlist;
  } catch (error) {
    toast(errorText(error));
    return null;
  }
}

export function PlaylistPicker({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone?: () => void }) {
  const { lists } = usePlaylists();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = items.map((item) => item.id);

  const done = (list: { id: string; name: string }, added: number | null) => {
    toast(added === 0 ? t('Alles davon steht schon in „{name}“', { name: list.name }) : t('Zu „{name}“ hinzugefügt', { name: list.name }), {
      action: { label: t('Öffnen'), onClick: () => navigate(musicHref('playlists', list.id)) },
    });
    onDone?.();
    onClose();
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (!name.trim()) return;
      const result = await api.post<{ playlist: Playlist }>('/api/playlists', { name, ids });
      done(result.playlist, null);
    });

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('Zur Wiedergabeliste hinzufügen')}</DialogTitle>
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
            label={t('Neue Wiedergabeliste')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <Button type="submit" variant="tonal" disabled={!name.trim() || busy} startIcon={<PlaylistAddRounded />}>
            {t('Anlegen')}
          </Button>
        </form>
        {!lists ? (
          <CircularProgress size={24} aria-label={t('Lädt')} sx={{ alignSelf: 'center', my: 2 }} />
        ) : (
          <Box
            role="list"
            aria-label={t('Wiedergabelisten')}
            sx={{ display: 'flex', flexDirection: 'column', mx: -1, maxHeight: 360, overflowY: 'auto' }}
          >
            {lists.map((list) => (
              <ButtonBase
                key={list.id}
                role="listitem"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.post<{ added: number }>(`/api/playlists/${list.id}/items`, { ids });
                    done(list, result.added);
                  })
                }
                sx={{ justifyContent: 'flex-start', gap: 1.5, px: 1, py: 0.75, borderRadius: `${radius.sm}px`, textAlign: 'left' }}
              >
                <Cover item={list.cover} size={40} icon={<QueueMusicRounded />} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {list.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {tn(list.count, '{count} Titel', '{count} Titel')}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RowAction {
  key: string;
  label: string;
  icon: ReactNode;
  run: (track: Track) => void;
}

function TrackList({
  tracks,
  label,
  numbered = false,
  extra,
  onPick,
}: {
  tracks: Track[];
  label: string;
  numbered?: boolean;
  extra?: (track: Track, index: number) => RowAction[];
  onPick: (tracks: Track[]) => void;
}) {
  const player = usePlayer();
  const [shown, setShown] = useState(PAGE);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; track: Track; index: number } | null>(null);
  const current = player.queue[player.index]?.id;
  const actions = (track: Track, index: number): RowAction[] => [
    { key: 'play', label: t('Abspielen'), icon: <PlayArrowRounded />, run: () => playItems(tracks, track) },
    {
      key: 'queue',
      label: t('In die Warteschlange'),
      icon: <QueueMusicRounded />,
      run: () => {
        if (player.queue.length === 0) playItems([track]);
        else enqueue([track]);
        toast(t('„{name}“ steht in der Warteschlange', { name: track.track.title }));
      },
    },
    { key: 'playlist', label: t('Zur Wiedergabeliste hinzufügen'), icon: <PlaylistAddRounded />, run: () => onPick([track]) },
    ...(extra ? extra(track, index) : []),
    ...(track.parentId
      ? [
          {
            key: 'folder',
            label: t('Im Ordner zeigen'),
            icon: <FolderOpenRounded />,
            run: () => navigate(`/files/folder/${track.parentId}`),
          },
        ]
      : []),
  ];

  return (
    <Box role="list" aria-label={label} sx={{ display: 'flex', flexDirection: 'column' }}>
      {tracks.slice(0, shown).map((track, index) => {
        const active = track.id === current;
        return (
          <Box
            key={track.id}
            role="listitem"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              pl: 1,
              pr: 0.5,
              borderRadius: `${radius.sm}px`,
              color: active ? c.primary : c.onSurface,
              '&:hover': { bgcolor: mix(c.onSurface, 6) },
            }}
          >
            <ButtonBase
              onClick={() => playItems(tracks, track)}
              aria-label={t('„{name}“ abspielen', { name: track.track.title })}
              sx={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'flex-start',
                gap: 1.5,
                py: 0.75,
                textAlign: 'left',
                borderRadius: `${radius.sm}px`,
              }}
            >
              {numbered ? (
                <Typography
                  variant="body2"
                  sx={{ width: 28, textAlign: 'right', flex: 'none', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}
                >
                  {track.track.number ?? index + 1}
                </Typography>
              ) : (
                <Cover item={track} size={40} />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500 }}>
                  {track.track.title}
                </Typography>
                <Typography variant="caption" component="p" noWrap sx={{ color: active ? 'inherit' : c.onSurfaceVariant }}>
                  {[track.track.artist, numbered ? null : track.track.album].filter(Boolean).join(' · ') || track.name}
                </Typography>
              </Box>
              {track.track.duration !== null && (
                <Typography variant="caption" sx={{ flex: 'none', opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(track.track.duration)}
                </Typography>
              )}
            </ButtonBase>
            <IconButton
              size="small"
              aria-label={t('Aktionen für „{name}“', { name: track.track.title })}
              onClick={(event: MouseEvent<HTMLElement>) => setMenu({ anchor: event.currentTarget, track, index })}
            >
              <MoreVertRounded fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      {tracks.length > shown && (
        <Button sx={{ alignSelf: 'center', mt: 1 }} onClick={() => setShown(shown + PAGE)}>
          {tn(tracks.length - shown, 'Noch {count} Titel zeigen', 'Noch {count} Titel zeigen')}
        </Button>
      )}
      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu &&
          actions(menu.track, menu.index).map((action) => (
            <MenuItem
              key={action.key}
              onClick={() => {
                setMenu(null);
                action.run(menu.track);
              }}
            >
              <ListItemIcon>{action.icon}</ListItemIcon>
              {action.label}
            </MenuItem>
          ))}
      </Menu>
    </Box>
  );
}

function Heading({
  cover,
  title,
  line,
  back,
  children,
}: {
  cover: ReactNode;
  title: string;
  line: string;
  back: string;
  children?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
      <Tooltip title={t('Zurück')}>
        <IconButton aria-label={t('Zurück')} onClick={() => navigate(back)}>
          <ArrowBackRounded />
        </IconButton>
      </Tooltip>
      {cover}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {line}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{children}</Box>
    </Box>
  );
}

function PlaylistDetail({ id, onPick }: { id: string; onPick: (tracks: Track[]) => void }) {
  const [data, setData] = useState<{ playlist: Playlist; items: Track[] } | null>(null);
  const [gone, setGone] = useState(false);

  const load = () =>
    api
      .get<{ playlist: Playlist; items: Track[] }>(`/api/playlists/${id}`)
      .then(setData)
      .catch(() => setGone(true));

  useEffect(() => {
    void load();
  }, [id]);

  useLive((event, payload) => {
    if (event === 'reconnect' || (event === 'playlists' && (payload as { id?: string }).id === id)) void load();
  });

  if (gone) {
    return (
      <EmptyState
        icon={<QueueMusicRounded />}
        title={t('Diese Wiedergabeliste gibt es nicht mehr')}
        action={
          <Button variant="tonal" onClick={() => navigate(musicHref('playlists'))}>
            {t('Zu den Wiedergabelisten')}
          </Button>
        }
      />
    );
  }
  if (!data) return null;
  const { playlist, items } = data;

  const change = async (task: () => Promise<unknown>) => {
    try {
      await task();
      await load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const shift = (index: number, by: number) => {
    const order = items.map((item) => item.id);
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setData({ playlist, items: order.map((nodeId) => items.find((item) => item.id === nodeId)!) });
    void change(() => api.patch(`/api/playlists/${id}`, { order }));
  };

  const rename = async () => {
    const name = await prompt({
      title: t('Wiedergabeliste umbenennen'),
      label: t('Name'),
      value: playlist.name,
      confirm: t('Umbenennen'),
      maxLength: 100,
    });
    if (name?.trim() && name.trim() !== playlist.name) await change(() => api.patch(`/api/playlists/${id}`, { name }));
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('„{name}“ löschen?', { name: playlist.name }),
      text: t('Nur die Liste verschwindet. Die Musik bleibt in deinen Dateien.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/playlists/${id}`);
      toast(t('„{name}“ gelöscht', { name: playlist.name }));
      navigate(musicHref('playlists'), { replace: true });
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <>
      <Heading
        cover={<Cover item={playlist.cover} size={72} icon={<QueueMusicRounded />} />}
        title={playlist.name}
        line={countLine(items)}
        back={musicHref('playlists')}
      >
        <Button variant="contained" startIcon={<PlayArrowRounded />} disabled={items.length === 0} onClick={() => playItems(items)}>
          {t('Abspielen')}
        </Button>
        <Tooltip title={t('Umbenennen')}>
          <IconButton aria-label={t('Wiedergabeliste umbenennen')} onClick={() => void rename()}>
            <DriveFileRenameOutlineRounded />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Als M3U herunterladen')}>
          <IconButton component="a" href={`/api/playlists/${id}/m3u`} aria-label={t('Als M3U herunterladen')} disabled={items.length === 0}>
            <DownloadRounded />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Löschen')}>
          <IconButton aria-label={t('Wiedergabeliste löschen')} onClick={() => void remove()}>
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
      </Heading>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<PlaylistAddRounded />}
          title={t('Noch nichts in dieser Liste')}
          text={t('Wähl bei einem Titel, einem Album oder einem Ordner „Zur Wiedergabeliste hinzufügen“.')}
        />
      ) : (
        <TrackList
          tracks={items}
          label={playlist.name}
          onPick={onPick}
          extra={(track, index) => [
            ...(index > 0 ? [{ key: 'up', label: t('Nach oben'), icon: <ArrowUpwardRounded />, run: () => shift(index, -1) }] : []),
            ...(index < items.length - 1
              ? [{ key: 'down', label: t('Nach unten'), icon: <ArrowDownwardRounded />, run: () => shift(index, 1) }]
              : []),
            {
              key: 'remove',
              label: t('Aus der Liste nehmen'),
              icon: <PlaylistRemoveRounded />,
              run: () => void change(() => api.post(`/api/playlists/${id}/remove`, { ids: [track.id] })),
            },
          ]}
        />
      )}
    </>
  );
}

function GroupGrid({ groups, tab, round }: { groups: Group[]; tab: 'albums' | 'artists'; round: boolean }) {
  return (
    <Box
      role="list"
      aria-label={tab === 'albums' ? t('Alben') : t('Interpreten')}
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 2 }}
    >
      {groups.map((group) => (
        <ButtonBase
          key={group.key}
          role="listitem"
          component="a"
          href={groupHref(tab, group.key)}
          onClick={(event: MouseEvent) => {
            event.preventDefault();
            navigate(groupHref(tab, group.key));
          }}
          sx={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 1,
            p: 1,
            borderRadius: `${radius.md}px`,
            textAlign: round ? 'center' : 'left',
            '&:hover': { bgcolor: mix(c.onSurface, 6) },
          }}
        >
          <Cover
            item={group.cover}
            size="100%"
            round={round}
            icon={round ? <PersonRounded fontSize="large" /> : <AlbumRounded fontSize="large" />}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {group.name}
            </Typography>
            <Typography variant="caption" component="p" noWrap sx={{ color: c.onSurfaceVariant }}>
              {tab === 'albums'
                ? [group.detail, tn(group.tracks.length, '{count} Titel', '{count} Titel')].filter(Boolean).join(' · ')
                : group.detail}
            </Typography>
          </Box>
        </ButtonBase>
      ))}
    </Box>
  );
}

export function MusicView({ tab, id, name }: { tab: MusicTab; id: string | null; name: string | null }) {
  const [data, setData] = useState<{ items: Track[]; more: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<Track[] | null>(null);
  const { lists } = usePlaylists();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () =>
    api
      .get<{ items: Track[]; more: boolean }>('/api/music')
      .then(setData)
      .catch((error) => {
        setData((current) => current ?? { items: [], more: false });
        toast(errorText(error));
      });

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useLive((event) => {
    if (event !== 'reconnect' && event !== 'change') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 3000);
  });

  const all = data?.items ?? [];
  const needle = query.trim().toLowerCase();
  const tracks = useMemo(() => {
    const matching = needle
      ? all.filter((track) =>
          [track.track.title, track.track.artist, track.track.album, track.name].some((value) => value.toLowerCase().includes(needle))
        )
      : all;
    return [...matching].sort(byArtist);
  }, [all, needle]);
  const albums = useMemo(() => albumsOf(tracks), [tracks]);
  const artists = useMemo(() => artistsOf(tracks), [tracks]);

  if (!data) return null;

  const picker = pick && <PlaylistPicker items={pick} onClose={() => setPick(null)} />;

  if (all.length === 0 && (lists?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={<LibraryMusicRounded />}
        title={t('Noch keine Musik')}
        text={t('Lade MP3, FLAC, Ogg oder M4A in deine Dateien hoch. MoeCloud sortiert sie hier nach Album und Interpret.')}
        action={
          <Button variant="tonal" onClick={() => navigate('/files')}>
            {t('Zu den Dateien')}
          </Button>
        }
      />
    );
  }

  const group =
    name !== null && (tab === 'albums' || tab === 'artists')
      ? (tab === 'albums' ? albumsOf(all) : artistsOf(all)).find((entry) => entry.key === name)
      : null;

  const body = () => {
    if (tab === 'playlists' && id) return <PlaylistDetail key={id} id={id} onPick={setPick} />;
    if (group && (tab === 'albums' || tab === 'artists')) {
      const year = group.tracks.find((track) => track.track.year)?.track.year;
      return (
        <>
          <Heading
            cover={
              <Cover
                item={group.cover}
                size={96}
                round={tab === 'artists'}
                icon={tab === 'artists' ? <PersonRounded fontSize="large" /> : <AlbumRounded fontSize="large" />}
              />
            }
            title={group.name}
            line={[tab === 'albums' ? group.detail : null, tab === 'albums' && year ? String(year) : null, countLine(group.tracks)]
              .filter(Boolean)
              .join(' · ')}
            back={musicHref(tab)}
          >
            <Button variant="contained" startIcon={<PlayArrowRounded />} onClick={() => playItems(group.tracks)}>
              {t('Abspielen')}
            </Button>
            <Button variant="tonal" startIcon={<PlaylistAddRounded />} onClick={() => setPick(group.tracks)}>
              {t('Zur Wiedergabeliste')}
            </Button>
          </Heading>
          <TrackList tracks={group.tracks} label={group.name} numbered={tab === 'albums'} onPick={setPick} />
        </>
      );
    }
    if (tab === 'albums') return <GroupGrid groups={albums} tab="albums" round={false} />;
    if (tab === 'artists') return <GroupGrid groups={artists} tab="artists" round />;
    if (tab === 'playlists') {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button
            variant="tonal"
            startIcon={<PlaylistAddRounded />}
            sx={{ alignSelf: 'flex-start', mb: 1 }}
            onClick={async () => {
              const created = await newPlaylist();
              if (created) navigate(musicHref('playlists', created.id));
            }}
          >
            {t('Neue Wiedergabeliste')}
          </Button>
          {lists && lists.length === 0 && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Noch keine Wiedergabelisten. Eine Datei mit der Endung .m3u übernimmst du über ihr Menü unter Dateien.')}
            </Typography>
          )}
          <Box role="list" aria-label={t('Wiedergabelisten')} sx={{ display: 'flex', flexDirection: 'column' }}>
            {(lists ?? []).map((list) => (
              <ButtonBase
                key={list.id}
                role="listitem"
                component="a"
                href={musicHref('playlists', list.id)}
                onClick={(event: MouseEvent) => {
                  event.preventDefault();
                  navigate(musicHref('playlists', list.id));
                }}
                sx={{
                  justifyContent: 'flex-start',
                  gap: 1.5,
                  px: 1,
                  py: 1,
                  borderRadius: `${radius.sm}px`,
                  textAlign: 'left',
                  '&:hover': { bgcolor: mix(c.onSurface, 6) },
                }}
              >
                <Cover item={list.cover} size={48} icon={<PlaylistPlayRounded />} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {list.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {tn(list.count, '{count} Titel', '{count} Titel')}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Box>
        </Box>
      );
    }
    return (
      <>
        {tracks.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<PlayArrowRounded />} onClick={() => playItems(tracks)}>
              {t('Alle abspielen')}
            </Button>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {countLine(tracks)}
            </Typography>
          </Box>
        )}
        <TrackList tracks={tracks} label={t('Alle Titel')} onPick={setPick} />
        {data.more && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'block', mt: 2 }}>
            {t('Hier stehen die 10.000 neuesten Titel.')}
          </Typography>
        )}
      </>
    );
  };

  const detail = (tab === 'playlists' && id) || group;

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, pb: 4 }}>
      {!detail && (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={tab}
            aria-label={t('Ansicht der Musik')}
            onChange={(_event, value: MusicTab | null) => value && navigate(musicHref(value))}
          >
            <ToggleButton value="tracks">{t('Alle Titel')}</ToggleButton>
            <ToggleButton value="albums">{t('Alben')}</ToggleButton>
            <ToggleButton value="artists">{t('Interpreten')}</ToggleButton>
            <ToggleButton value="playlists">{t('Wiedergabelisten')}</ToggleButton>
          </ToggleButtonGroup>
          {tab !== 'playlists' && (
            <TextField
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Musik durchsuchen')}
              sx={{ flex: 1, minWidth: 180, maxWidth: 360 }}
              slotProps={{
                htmlInput: { 'aria-label': t('Musik durchsuchen') },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
        </Box>
      )}
      {!detail && tab !== 'playlists' && tracks.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {needle ? t('Kein Titel passt dazu.') : t('Noch keine eigene Musik. Deine Wiedergabelisten findest du nebenan.')}
        </Typography>
      ) : (
        body()
      )}
      {picker}
    </Box>
  );
}
