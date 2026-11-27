import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useColorScheme } from '@mui/material/styles';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import BookmarkAddOutlined from '@mui/icons-material/BookmarkAddOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditRounded from '@mui/icons-material/EditRounded';
import Forward30Rounded from '@mui/icons-material/Forward30Rounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import HeadphonesRounded from '@mui/icons-material/HeadphonesRounded';
import MarkEmailUnreadOutlined from '@mui/icons-material/MarkEmailUnreadOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import NewspaperRounded from '@mui/icons-material/NewspaperRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import Replay10Rounded from '@mui/icons-material/Replay10Rounded';
import RssFeedRounded from '@mui/icons-material/RssFeedRounded';
import SaveAltRounded from '@mui/icons-material/SaveAltRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import TextFieldsRounded from '@mui/icons-material/TextFieldsRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { api, ApiError, errorText } from '../../lib/api';
import { featureOn } from '../../lib/features';
import { formatNumber, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { c, elevation, mix, radius } from '../../theme/tokens';
import { copyText, EmptyState } from '../common/bits';
import { choose, confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { PullToRefresh, SwipeRow } from '../common/touch';
import { AppShell } from '../shell/AppShell';
import { bodyUrl, clock, feedsApi, importOpml, mediaUrl, type Feed, type Item, type ItemFilter, type Scope } from './model';

type Size = 's' | 'm' | 'l' | 'xl';

const stored = <T extends string>(key: string, fallback: T, allowed: readonly T[]): T => {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

function FeedIcon({ src, title, size = 20 }: { src: string | null; title: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <Box
        aria-hidden
        sx={{
          width: size,
          height: size,
          flex: 'none',
          borderRadius: '6px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: c.tertiaryContainer,
          color: c.onTertiaryContainer,
          fontSize: size * 0.55,
          fontWeight: 700,
        }}
      >
        {(title || '?').slice(0, 1).toUpperCase()}
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      sx={{ width: size, height: size, flex: 'none', borderRadius: '6px', objectFit: 'cover' }}
    />
  );
}

function AddFeedDialog({
  open,
  folders,
  onClose,
  onAdded,
}: {
  open: boolean;
  folders: string[];
  onClose: () => void;
  onAdded: (feed: Feed) => void;
}) {
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setUrl('');
      setFolder('');
    }
  }, [open]);
  const add = async (target = url.trim()) => {
    setBusy(true);
    try {
      const result = await feedsApi.add(target, folder.trim() || undefined);
      if (result.existing) toast(t('Diesen Feed hast du schon'));
      onAdded(result.feed);
    } catch (error) {
      const found = error instanceof ApiError ? (error.data.feeds as { url: string; title: string }[] | undefined) : undefined;
      if (found?.length) {
        const picked = await choose({
          title: t('Welchen Feed möchtest du?'),
          text: t('Die Seite bietet mehrere an.'),
          options: found.map((entry, index) => ({ value: entry.url, label: entry.title || entry.url, primary: index === 0 })),
        });
        if (picked) {
          setBusy(false);
          await add(picked);
          return;
        }
      } else toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-feed-dialog>
      <DialogTitle>{t('Feed abonnieren')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Gib die Adresse einer Webseite, eines Blogs oder Podcasts ein. Den Feed sucht MoeCloud selbst.')}
        </Typography>
        <TextField
          label={t('Adresse')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus
          placeholder="https://"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && url.trim()) void add();
          }}
          slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'off', spellCheck: false, 'data-feed-url': '' } }}
        />
        <Autocomplete
          freeSolo
          options={folders}
          inputValue={folder}
          onInputChange={(_event, next) => setFolder(next)}
          renderInput={(params) => <TextField {...params} label={t('Ordner')} placeholder={t('Ohne Ordner')} />}
        />
        {busy && <LinearProgress />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={!url.trim() || busy} onClick={() => void add()} data-feed-add>
          {t('Abonnieren')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface Nav {
  key: string;
  icon: ReactNode;
  label: string;
  count?: number;
  href: string;
  warn?: string | null;
  feed?: Feed;
  folder?: string;
}

function FeedNav({
  feeds,
  starred,
  episodes,
  current,
  onPick,
  onFeedMenu,
  onFolderMenu,
}: {
  feeds: Feed[];
  starred: number;
  episodes: number;
  current: string;
  onPick: (href: string) => void;
  onFeedMenu: (feed: Feed, anchor: HTMLElement) => void;
  onFolderMenu: (folder: string, anchor: HTMLElement) => void;
}) {
  const unread = feeds.reduce((sum, feed) => sum + feed.unread, 0);
  const folders = new Map<string, Feed[]>();
  for (const feed of feeds) folders.set(feed.folder, [...(folders.get(feed.folder) ?? []), feed]);
  const entry = (nav: Nav, depth = 0) => {
    const active = current === nav.href;
    return (
      <ButtonBase
        key={nav.key}
        onClick={() => onPick(nav.href)}
        onContextMenu={(event) => {
          if (!nav.feed && nav.folder === undefined) return;
          event.preventDefault();
          if (nav.feed) onFeedMenu(nav.feed, event.currentTarget);
          else onFolderMenu(nav.folder!, event.currentTarget);
        }}
        aria-current={active ? 'page' : undefined}
        data-feed-nav={nav.label}
        sx={{
          width: '100%',
          justifyContent: 'flex-start',
          gap: 1.5,
          pl: 2 + depth * 2,
          pr: 1.5,
          height: 42,
          borderRadius: `${radius.full}px`,
          bgcolor: active ? c.secondaryContainer : 'transparent',
          color: active ? c.onSecondaryContainer : c.onSurfaceVariant,
          '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
          '&:hover .feed-more': { opacity: 1 },
        }}
      >
        {nav.icon}
        <Typography
          variant="body2"
          noWrap
          sx={{ flex: 1, textAlign: 'left', fontWeight: (nav.count ?? 0) > 0 ? 700 : 500, color: active ? 'inherit' : c.onSurface }}
        >
          {nav.label}
        </Typography>
        {nav.warn && (
          <Tooltip title={nav.warn}>
            <WarningAmberRounded sx={{ fontSize: 16, color: c.error }} />
          </Tooltip>
        )}
        {(nav.count ?? 0) > 0 && <Typography variant="caption">{formatNumber(nav.count!)}</Typography>}
      </ButtonBase>
    );
  };
  return (
    <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }} data-feed-list>
      {entry({ key: 'all', icon: <NewspaperRounded fontSize="small" />, label: t('Alle Beiträge'), count: unread, href: '/feeds' })}
      {entry({
        key: 'starred',
        icon: <StarRounded fontSize="small" />,
        label: t('Favoriten'),
        count: starred,
        href: '/feeds?view=starred',
      })}
      {episodes > 0 &&
        entry({
          key: 'media',
          icon: <HeadphonesRounded fontSize="small" />,
          label: t('Folgen'),
          count: episodes,
          href: '/feeds?view=media',
        })}
      <Divider sx={{ my: 1 }} />
      {[...folders].map(([folder, entries]) =>
        folder ? (
          <Box key={`folder-${folder}`}>
            {entry({
              key: `folder-${folder}`,
              icon: <FolderOutlined fontSize="small" />,
              label: folder,
              count: entries.reduce((sum, feed) => sum + feed.unread, 0),
              href: `/feeds?folder=${encodeURIComponent(folder)}`,
              folder,
            })}
            {entries.map((feed) =>
              entry(
                {
                  key: feed.id,
                  icon: <FeedIcon src={feed.icon} title={feed.title} size={18} />,
                  label: feed.title,
                  count: feed.unread,
                  href: `/feeds?feed=${feed.id}`,
                  warn: feed.error,
                  feed,
                },
                1
              )
            )}
          </Box>
        ) : (
          entries.map((feed) =>
            entry({
              key: feed.id,
              icon: <FeedIcon src={feed.icon} title={feed.title} size={18} />,
              label: feed.title,
              count: feed.unread,
              href: `/feeds?feed=${feed.id}`,
              warn: feed.error,
              feed,
            })
          )
        )
      )}
    </Box>
  );
}

function ItemRow({
  item,
  active,
  playing,
  onOpen,
  onPlay,
}: {
  item: Item;
  active: boolean;
  playing: boolean;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const progress = item.media?.duration ? Math.min(100, (item.media.position / item.media.duration) * 100) : 0;
  return (
    <ButtonBase
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      data-feed-item={item.title}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 1.5,
        px: 2,
        py: 1.5,
        textAlign: 'left',
        borderRadius: { md: `${radius.md}px` },
        bgcolor: active ? c.secondaryContainer : 'transparent',
        '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 5) },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: c.onSurfaceVariant }}>
          <FeedIcon src={item.feedIcon} title={item.feedTitle} size={16} />
          <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
            {item.feedTitle}
          </Typography>
          <Typography variant="caption" sx={{ flex: 'none' }}>
            · {formatRelative(item.publishedAt)}
          </Typography>
          {item.starred && <StarRounded sx={{ fontSize: 15, color: c.tertiary }} aria-label={t('Favorit')} />}
        </Box>
        <Typography
          variant="body1"
          sx={{ mt: 0.5, fontWeight: item.read ? 500 : 800, color: item.read ? c.onSurfaceVariant : c.onSurface, lineHeight: 1.35 }}
        >
          {!item.read && (
            <Box
              component="span"
              aria-label={t('Ungelesen')}
              sx={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: c.primary,
                mr: 0.75,
                verticalAlign: 'middle',
              }}
            />
          )}
          {item.title}
        </Typography>
        {item.summary && (
          <Typography
            variant="body2"
            sx={{
              color: c.onSurfaceVariant,
              mt: 0.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.summary}
          </Typography>
        )}
        {item.media && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Chip
              size="small"
              color={playing ? 'primary' : 'default'}
              icon={playing ? <PauseRounded /> : <PlayArrowRounded />}
              label={
                item.media.position > 0 && item.media.duration
                  ? t('Noch {time}', { time: clock(item.media.duration - item.media.position) })
                  : clock(item.media.duration)
              }
              onClick={(event) => {
                event.stopPropagation();
                onPlay();
              }}
              data-feed-play
            />
            {progress > 0 && (
              <Box sx={{ flex: 1, maxWidth: 120, height: 4, borderRadius: 2, bgcolor: mix(c.onSurface, 12), overflow: 'hidden' }}>
                <Box sx={{ width: `${progress}%`, height: '100%', bgcolor: c.primary }} />
              </Box>
            )}
          </Box>
        )}
      </Box>
      {item.image && (
        <Box
          component="img"
          src={item.image}
          alt=""
          loading="lazy"
          onError={(event) => ((event.target as HTMLImageElement).style.display = 'none')}
          sx={{
            width: { xs: 72, sm: 88 },
            height: { xs: 72, sm: 88 },
            objectFit: 'cover',
            borderRadius: `${radius.md}px`,
            flex: 'none',
            bgcolor: c.surfaceContainerHigh,
          }}
        />
      )}
    </ButtonBase>
  );
}

const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];

interface PlayerState {
  item: Item;
  playing: boolean;
  time: number;
  duration: number;
}

function usePodcast(onChange: (item: Item, position: number, done: boolean) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [speed, setSpeedState] = useState(() => Number(stored('moe-podcast-speed', '1', SPEEDS.map(String))));
  const current = useRef<Item | null>(null);
  const saved = useRef(0);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  });

  const save = useCallback((force = false) => {
    const element = audio.current;
    const item = current.current;
    if (!element || !item || !Number.isFinite(element.currentTime)) return;
    if (!force && Math.abs(element.currentTime - saved.current) < 10) return;
    saved.current = element.currentTime;
    const duration = Number.isFinite(element.duration) ? element.duration : null;
    void feedsApi
      .position(item.id, element.currentTime, duration)
      .then((result) => change.current(item, result.position, result.done))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const element = new Audio();
    element.preload = 'metadata';
    audio.current = element;
    const update = () => {
      const item = current.current;
      if (!item) return;
      setState({
        item,
        playing: !element.paused,
        time: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : (item.media?.duration ?? 0),
      });
    };
    const events = ['timeupdate', 'play', 'pause', 'loadedmetadata', 'durationchange'] as const;
    for (const name of events) element.addEventListener(name, update);
    const pause = () => save(true);
    element.addEventListener('pause', pause);
    element.addEventListener('timeupdate', () => save());
    element.addEventListener('ended', () => {
      save(true);
      update();
    });
    element.addEventListener('error', () => {
      if (current.current) toast(t('Die Folge lässt sich gerade nicht laden'));
    });
    const hide = () => {
      if (document.visibilityState === 'hidden') save(true);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      element.pause();
      element.removeAttribute('src');
    };
  }, [save]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, state?.item.id]);

  const play = useCallback(
    (item: Item) => {
      const element = audio.current;
      if (!element || !item.media) return;
      if (current.current?.id === item.id) {
        if (element.paused) void element.play().catch(() => undefined);
        else element.pause();
        return;
      }
      if (current.current) save(true);
      current.current = item;
      saved.current = item.media.position;
      element.src = mediaUrl(item.id);
      element.playbackRate = speed;
      const start = item.media.position;
      const resume = () => {
        if (start > 5 && (!Number.isFinite(element.duration) || start < element.duration - 20)) element.currentTime = start;
        element.removeEventListener('loadedmetadata', resume);
      };
      element.addEventListener('loadedmetadata', resume);
      setState({ item, playing: true, time: start, duration: item.media.duration ?? 0 });
      void element.play().catch(() => undefined);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.title,
          artist: item.feedTitle,
          artwork: item.feedIcon ? [{ src: item.feedIcon, sizes: '512x512' }] : item.image ? [{ src: item.image, sizes: '512x512' }] : [],
        });
        const skip = (seconds: number) => () => {
          element.currentTime = Math.max(0, Math.min(element.duration || Infinity, element.currentTime + seconds));
        };
        navigator.mediaSession.setActionHandler('play', () => void element.play());
        navigator.mediaSession.setActionHandler('pause', () => element.pause());
        navigator.mediaSession.setActionHandler('seekbackward', skip(-10));
        navigator.mediaSession.setActionHandler('seekforward', skip(30));
        try {
          navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) element.currentTime = details.seekTime;
          });
        } catch {}
      }
    },
    [save, speed]
  );

  const close = () => {
    save(true);
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    current.current = null;
    setState(null);
  };

  const seek = (time: number) => {
    if (audio.current) audio.current.currentTime = time;
  };

  const skip = (seconds: number) => {
    const element = audio.current;
    if (element)
      element.currentTime = Math.max(
        0,
        Math.min(Number.isFinite(element.duration) ? element.duration : Infinity, element.currentTime + seconds)
      );
  };

  const setSpeed = (value: number) => {
    setSpeedState(value);
    store('moe-podcast-speed', String(value));
  };

  return { state, play, close, seek, skip, speed, setSpeed };
}

function PodcastBar({ player, onOpen }: { player: ReturnType<typeof usePodcast>; onOpen: (item: Item) => void }) {
  const small = useMediaQuery('(max-width: 899px)');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const state = player.state;
  useEffect(() => {
    document.documentElement.style.setProperty('--moe-player', state ? (small ? '72px' : '88px') : '0px');
    return () => document.documentElement.style.setProperty('--moe-player', '0px');
  }, [Boolean(state), small]);
  if (!state) return null;
  const { item } = state;
  return (
    <Box
      role="region"
      aria-label={t('Podcast')}
      data-podcast-bar
      sx={{
        position: 'fixed',
        zIndex: 1150,
        left: { xs: 8, md: 'var(--moe-rail, 88px)' },
        right: { xs: 8, md: 16 },
        bottom: { xs: 'calc(84px + env(safe-area-inset-bottom))', md: 16 },
        height: { xs: 64, md: 72 },
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1, md: 2 },
        pl: { xs: 1, md: 1.5 },
        pr: { xs: 0.5, md: 1.5 },
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainerHigh,
        boxShadow: elevation[2],
        overflow: 'hidden',
      }}
    >
      <ButtonBase
        onClick={() => onOpen(item)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flex: { xs: 1, md: '0 1 320px' },
          minWidth: 0,
          justifyContent: 'flex-start',
          textAlign: 'left',
          borderRadius: `${radius.md}px`,
        }}
      >
        <FeedIcon src={item.feedIcon ?? item.image} title={item.feedTitle} size={small ? 44 : 52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
            {item.title}
          </Typography>
          <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
            {small ? `${clock(state.time)} / ${clock(state.duration)}` : item.feedTitle}
          </Typography>
        </Box>
      </ButtonBase>
      {!small && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Typography variant="caption" sx={{ width: 52, textAlign: 'right', color: c.onSurfaceVariant }}>
            {clock(state.time)}
          </Typography>
          <Slider
            size="small"
            min={0}
            max={Math.max(1, state.duration)}
            value={Math.min(state.time, state.duration || state.time)}
            onChange={(_event, value) => player.seek(value as number)}
            aria-label={t('Stelle')}
          />
          <Typography variant="caption" sx={{ width: 52, color: c.onSurfaceVariant }}>
            {clock(state.duration)}
          </Typography>
        </Box>
      )}
      {!small && (
        <IconButton onClick={() => player.skip(-10)} aria-label={t('10 Sekunden zurück')}>
          <Replay10Rounded />
        </IconButton>
      )}
      <IconButton
        onClick={() => player.play(item)}
        aria-label={state.playing ? t('Pause') : t('Abspielen')}
        sx={{ bgcolor: c.primary, color: `${c.onPrimary} !important`, '&:hover': { bgcolor: c.primary } }}
      >
        {state.playing ? <PauseRounded /> : <PlayArrowRounded />}
      </IconButton>
      <IconButton onClick={() => player.skip(30)} aria-label={t('30 Sekunden vor')}>
        <Forward30Rounded />
      </IconButton>
      <Button size="small" onClick={(event) => setMenu(event.currentTarget)} sx={{ minWidth: 48 }} aria-label={t('Tempo')}>
        {`${player.speed}×`}
      </Button>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {SPEEDS.map((value) => (
          <MenuItem
            key={value}
            selected={value === player.speed}
            onClick={() => {
              player.setSpeed(value);
              setMenu(null);
            }}
          >
            {`${value}×`}
          </MenuItem>
        ))}
      </Menu>
      {!small && (
        <IconButton onClick={player.close} aria-label={t('Schließen')}>
          <CloseRounded />
        </IconButton>
      )}
      {small && (
        <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, bgcolor: mix(c.onSurface, 10) }}>
          <Box
            sx={{
              width: `${state.duration ? Math.min(100, (state.time / state.duration) * 100) : 0}%`,
              height: '100%',
              bgcolor: c.primary,
            }}
          />
        </Box>
      )}
    </Box>
  );
}

function Reader({
  item,
  dark,
  size,
  showBack,
  playing,
  onBack,
  onSize,
  onStar,
  onRead,
  onPlay,
}: {
  item: Item;
  dark: boolean;
  size: Size;
  showBack: boolean;
  playing: boolean;
  onBack: () => void;
  onSize: (size: Size) => void;
  onStar: () => void;
  onRead: () => void;
  onPlay: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [sizes, setSizes] = useState<HTMLElement | null>(null);
  const canShare = typeof navigator.share === 'function';
  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: item.title, url: item.url });
        return;
      } catch {}
    }
    void copyText(item.url, t('Link kopiert'));
  };
  const bookmark = async () => {
    try {
      const result = await api.post<{ existing: boolean }>('/api/bookmarks', {
        url: item.url,
        title: item.title,
        description: item.summary.slice(0, 500),
        later: true,
      });
      toast(result.existing ? t('Das hattest du schon gespeichert') : t('Für später gemerkt'), {
        action: { label: t('Öffnen'), onClick: () => (location.href = '/bookmarks') },
      });
    } catch (error) {
      toast(errorText(error));
    }
  };
  const save = async () => {
    try {
      await feedsApi.save(item.id);
      toast(t('Die Folge wird in deine Dateien geladen'));
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <Box
      data-feed-reader
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        height: { xs: 'calc(100dvh - var(--moe-header, 64px) - 80px - env(safe-area-inset-bottom) - var(--moe-player, 0px))', md: '100%' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75, borderBottom: `1px solid ${c.outlineVariant}` }}>
        {showBack && (
          <IconButton onClick={onBack} aria-label={t('Zurück')}>
            <ArrowBackRounded />
          </IconButton>
        )}
        <Box sx={{ flex: 1 }} />
        {item.media && (
          <Button
            variant="contained"
            startIcon={playing ? <PauseRounded /> : <PlayArrowRounded />}
            onClick={onPlay}
            sx={{ mr: 0.5 }}
            data-feed-reader-play
          >
            {playing ? t('Pause') : clock(item.media.duration)}
          </Button>
        )}
        <Tooltip title={item.starred ? t('Kein Favorit mehr') : t('Als Favorit merken')}>
          <IconButton
            onClick={onStar}
            aria-label={item.starred ? t('Kein Favorit mehr') : t('Als Favorit merken')}
            aria-pressed={item.starred}
          >
            {item.starred ? <StarRounded sx={{ color: c.tertiary }} /> : <StarOutlineRounded />}
          </IconButton>
        </Tooltip>
        <Tooltip title={item.read ? t('Als ungelesen markieren') : t('Als gelesen markieren')}>
          <IconButton onClick={onRead} aria-label={item.read ? t('Als ungelesen markieren') : t('Als gelesen markieren')}>
            {item.read ? <MarkEmailUnreadOutlined /> : <DoneAllRounded />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Schriftgröße')}>
          <IconButton onClick={(event) => setSizes(event.currentTarget)} aria-label={t('Schriftgröße')}>
            <TextFieldsRounded />
          </IconButton>
        </Tooltip>
        {item.url && (
          <Tooltip title={t('Original öffnen')}>
            <IconButton component="a" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={t('Original öffnen')}>
              <OpenInNewRounded />
            </IconButton>
          </Tooltip>
        )}
        <IconButton onClick={(event) => setMenu(event.currentTarget)} aria-label={t('Mehr')} aria-haspopup="menu">
          <MoreVertRounded />
        </IconButton>
        <Menu anchorEl={sizes} open={Boolean(sizes)} onClose={() => setSizes(null)}>
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={size}
              onChange={(_event, next: Size | null) => {
                if (next) onSize(next);
              }}
            >
              <ToggleButton value="s" aria-label={t('Klein')} sx={{ fontSize: 13 }}>
                A
              </ToggleButton>
              <ToggleButton value="m" aria-label={t('Normal')} sx={{ fontSize: 16 }}>
                A
              </ToggleButton>
              <ToggleButton value="l" aria-label={t('Groß')} sx={{ fontSize: 19 }}>
                A
              </ToggleButton>
              <ToggleButton value="xl" aria-label={t('Sehr groß')} sx={{ fontSize: 22 }}>
                A
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Menu>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} onClick={() => setMenu(null)}>
          {item.url && (
            <MenuItem onClick={() => void share()}>
              <ListItemIcon>{canShare ? <ShareRounded /> : <ContentCopyRounded />}</ListItemIcon>
              {canShare ? t('Teilen') : t('Link kopieren')}
            </MenuItem>
          )}
          {item.url && featureOn('bookmarks') && (
            <MenuItem onClick={() => void bookmark()}>
              <ListItemIcon>
                <BookmarkAddOutlined />
              </ListItemIcon>
              {t('Für später merken')}
            </MenuItem>
          )}
          {item.media && (
            <MenuItem onClick={() => void save()}>
              <ListItemIcon>
                <SaveAltRounded />
              </ListItemIcon>
              {t('In Dateien speichern')}
            </MenuItem>
          )}
        </Menu>
      </Box>
      <Box
        component="iframe"
        key={`${item.id}-${dark}-${size}`}
        src={bodyUrl(item.id, dark, size)}
        title={item.title}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        data-feed-body
        sx={{
          flex: 1,
          width: '100%',
          border: 0,
          bgcolor: dark ? '#141218' : '#fffbff',
          borderRadius: { md: `0 0 ${radius.lg}px ${radius.lg}px` },
        }}
      />
    </Box>
  );
}

function scopeOf(query: URLSearchParams, unreadOnly: boolean): Scope {
  const view = query.get('view');
  const filter: ItemFilter = view === 'starred' ? 'starred' : view === 'media' ? 'media' : unreadOnly ? 'unread' : 'all';
  return { feed: query.get('feed') ?? undefined, folder: query.get('folder') ?? undefined, filter, q: query.get('q') ?? undefined };
}

export function FeedsApp() {
  const { query } = useLocation();
  const medium = useMediaQuery('(min-width: 900px)');
  const wide = useMediaQuery('(min-width: 1200px)');
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [extra, setExtra] = useState({ starred: 0, episodes: 0 });
  const [unreadOnly, setUnreadOnly] = useState(() => stored('moe-feeds-unread', '1', ['0', '1']) === '1');
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [size, setSize] = useState<Size>(() => stored('moe-feeds-size', 'm', ['s', 'm', 'l', 'xl'] as const));
  const [search, setSearch] = useState(query.get('q') ?? '');
  const [feedMenu, setFeedMenu] = useState<{ feed?: Feed; folder?: string; anchor: HTMLElement } | null>(null);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const scope = useMemo(() => scopeOf(query, unreadOnly), [query, unreadOnly]);
  const scopeKey = JSON.stringify(scope);
  const itemId = Number(query.get('item')) || null;
  const [opened, setOpened] = useState<Item | null>(null);

  const current = useMemo(() => {
    const params = new URLSearchParams(query);
    params.delete('item');
    params.delete('q');
    const rest = params.toString();
    return rest ? `/feeds?${rest}` : '/feeds';
  }, [query]);

  const go = (patch: Record<string, string | null>, replace = false) => {
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const rest = params.toString();
    navigate(rest ? `/feeds?${rest}` : '/feeds', { replace });
  };

  const loadFeeds = useCallback(async () => {
    try {
      const result = await feedsApi.feeds();
      setFeeds(result.feeds);
      setExtra({ starred: result.starred, episodes: result.episodes });
    } catch (error) {
      toast(errorText(error));
    }
  }, []);

  const loadItems = useCallback(
    async (before?: string) => {
      setLoading(true);
      try {
        const result = await feedsApi.items(JSON.parse(scopeKey) as Scope, before);
        setItems((list) =>
          before ? [...list, ...result.items.filter((item) => !list.some((known) => known.id === item.id))] : result.items
        );
        setNext(result.next);
        if (!before) setFresh(false);
      } catch (error) {
        toast(errorText(error));
      } finally {
        setLoading(false);
      }
    },
    [scopeKey]
  );

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!itemId) {
      setOpened(null);
      return;
    }
    const known = items.find((item) => item.id === itemId);
    if (known) setOpened(known);
    else
      feedsApi
        .item(itemId)
        .then((result) => setOpened(result.item))
        .catch(() => go({ item: null }, true));
  }, [itemId]);

  const patchItem = (id: number, patch: Partial<Item>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setOpened((item) => (item && item.id === id ? { ...item, ...patch } : item));
  };

  const adjustUnread = (feedId: string, delta: number) =>
    setFeeds((list) => list?.map((feed) => (feed.id === feedId ? { ...feed, unread: Math.max(0, feed.unread + delta) } : feed)) ?? list);

  const open = (item: Item) => {
    setOpened(item);
    go({ item: String(item.id) });
    if (!item.read) {
      patchItem(item.id, { read: true });
      adjustUnread(item.feed, -1);
      void feedsApi.read({ ids: [item.id] }).catch(() => undefined);
    }
  };

  const toggleRead = (item: Item) => {
    patchItem(item.id, { read: !item.read });
    adjustUnread(item.feed, item.read ? 1 : -1);
    void feedsApi.read({ ids: [item.id] }, !item.read).catch((error) => toast(errorText(error)));
  };

  const toggleStar = (item: Item) => {
    patchItem(item.id, { starred: !item.starred });
    setExtra((value) => ({ ...value, starred: value.starred + (item.starred ? -1 : 1) }));
    void feedsApi.star(item.id, !item.starred).catch((error) => toast(errorText(error)));
  };

  const player = usePodcast((item, position, done) => {
    patchItem(item.id, { media: item.media ? { ...item.media, position } : null, ...(done ? { read: true } : {}) });
  });

  const markAll = async () => {
    const target = scope.feed ? { feed: scope.feed } : scope.folder !== undefined ? { folder: scope.folder } : { all: true };
    const result = await feedsApi.read({ ...target, before: Date.now() }).catch((error) => toast(errorText(error)));
    if (!result) return;
    toast(tn(result.changed, 'Ein Beitrag als gelesen markiert', '{count} Beiträge als gelesen markiert'));
    setItems((list) => list.map((item) => ({ ...item, read: true })));
    void loadFeeds();
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await feedsApi.refresh(scope.feed);
      if (result.added) toast(tn(result.added, 'Ein neuer Beitrag', '{count} neue Beiträge'));
      else if (result.done) toast(t('Nichts Neues'));
      await Promise.all([loadFeeds(), loadItems()]);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setRefreshing(false);
    }
  };

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive((event, data) => {
    if (event === 'reconnect') {
      void loadFeeds();
      return;
    }
    if (event !== 'feeds') return;
    if (data.type === 'saved') {
      toast(t('„{name}“ liegt jetzt in deinen Dateien', { name: String(data.name ?? '') }), {
        action: { label: t('Öffnen'), onClick: () => (location.href = `/files/folder/${String(data.folder)}`) },
      });
      return;
    }
    if (data.type === 'save_failed') {
      toast(String(data.error ?? t('Die Folge lässt sich gerade nicht laden')));
      return;
    }
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      void loadFeeds();
      if (data.type === 'items') setFresh(true);
      if (data.type === 'feeds' || data.type === 'refreshed') void loadItems();
    }, 400);
  });

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, [contenteditable="true"], .MuiDialog-root, .MuiMenu-root')
      )
        return;
      const index = opened ? items.findIndex((item) => item.id === opened.id) : -1;
      if (event.key === 'j' || event.key === 'k') {
        const target = items[event.key === 'j' ? index + 1 : Math.max(0, index - 1)];
        if (target) {
          event.preventDefault();
          open(target);
          document.querySelector(`[data-feed-item="${CSS.escape(target.title)}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (event.key === 's' && opened) toggleStar(opened);
      else if (event.key === 'm' && opened) toggleRead(opened);
      else if (event.key === 'o' && opened?.url) window.open(opened.url, '_blank', 'noopener,noreferrer');
      else if (event.key === 'r') void refresh();
      else if (event.key === ' ' && opened?.media) {
        event.preventDefault();
        player.play(opened);
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  const folders = useMemo(
    () => [...new Set((feeds ?? []).map((feed) => feed.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [feeds]
  );
  const scopeFeed = scope.feed ? feeds?.find((feed) => feed.id === scope.feed) : undefined;
  const heading =
    scopeFeed?.title ??
    scope.folder ??
    (scope.filter === 'starred' ? t('Favoriten') : scope.filter === 'media' ? t('Folgen') : t('Alle Beiträge'));

  const nav = feeds && (
    <FeedNav
      feeds={feeds}
      starred={extra.starred}
      episodes={extra.episodes}
      current={current}
      onPick={(href) => {
        setDrawer(false);
        navigate(href);
      }}
      onFeedMenu={(feed, anchor) => setFeedMenu({ feed, anchor })}
      onFolderMenu={(folder, anchor) => setFeedMenu({ folder, anchor })}
    />
  );

  const listPane = (
    <Box
      sx={{
        width: { md: 400 },
        flex: { xs: 1, md: 'none' },
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: { md: `1px solid ${c.outlineVariant}` },
      }}
      data-feed-items
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: { xs: 1, md: 2 }, pr: 1, py: 1, minHeight: 56 }}>
        {!wide && (
          <IconButton onClick={() => setDrawer(true)} aria-label={t('Feeds zeigen')}>
            <MenuRounded />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h1" noWrap sx={{ fontWeight: 700 }}>
            {heading}
          </Typography>
          {scopeFeed?.error && (
            <Typography variant="caption" sx={{ color: c.error }} noWrap component="p">
              {scopeFeed.error}
            </Typography>
          )}
        </Box>
        <Tooltip title={t('Aktualisieren')}>
          <span>
            <IconButton onClick={() => void refresh()} disabled={refreshing} aria-label={t('Aktualisieren')}>
              <RefreshRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('Alles als gelesen markieren')}>
          <IconButton onClick={() => void markAll()} aria-label={t('Alles als gelesen markieren')} data-feed-read-all>
            <DoneAllRounded />
          </IconButton>
        </Tooltip>
        <IconButton onClick={(event) => setTools(event.currentTarget)} aria-label={t('Mehr')} aria-haspopup="menu">
          <MoreVertRounded />
        </IconButton>
      </Box>
      {scope.filter !== 'starred' && scope.filter !== 'media' && (
        <Box sx={{ px: 2, pb: 1 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={unreadOnly}
                onChange={(event) => {
                  setUnreadOnly(event.target.checked);
                  store('moe-feeds-unread', event.target.checked ? '1' : '0');
                }}
              />
            }
            label={<Typography variant="body2">{t('Nur ungelesene')}</Typography>}
          />
        </Box>
      )}
      {(refreshing || (loading && items.length > 0)) && <LinearProgress sx={{ mx: 2 }} />}
      {fresh && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pb: 1 }}>
          <Chip color="primary" icon={<RefreshRounded />} label={t('Neue Beiträge zeigen')} onClick={() => void loadItems()} />
        </Box>
      )}
      <Box sx={{ flex: 1, overflowY: { md: 'auto' }, px: { md: 1 }, pb: 12 }}>
        <PullToRefresh onRefresh={refresh}>
          {loading && !items.length && <LinearProgress sx={{ mx: 2 }} />}
          {!loading && !items.length && (
            <EmptyState
              compact
              icon={scope.filter === 'starred' ? <StarRounded /> : <DoneAllRounded />}
              title={
                scope.filter === 'starred'
                  ? t('Noch keine Favoriten')
                  : scope.filter === 'unread'
                    ? t('Alles gelesen')
                    : t('Keine Beiträge')
              }
              text={scope.filter === 'unread' ? t('Neue Beiträge holt MoeCloud alle halbe Stunde von selbst.') : undefined}
            />
          )}
          {items.map((item) => (
            <SwipeRow
              key={item.id}
              surface={medium ? c.surfaceContainerLow : c.surface}
              start={{
                icon: item.read ? <MarkEmailUnreadOutlined /> : <DoneAllRounded />,
                label: item.read ? t('Ungelesen') : t('Gelesen'),
                color: c.onPrimaryContainer,
                background: c.primaryContainer,
                run: () => toggleRead(item),
              }}
              end={{
                icon: item.starred ? <StarOutlineRounded /> : <StarRounded />,
                label: item.starred ? t('Kein Favorit') : t('Favorit'),
                color: c.onTertiaryContainer,
                background: c.tertiaryContainer,
                run: () => toggleStar(item),
              }}
            >
              <ItemRow
                item={item}
                active={opened?.id === item.id}
                playing={player.state?.item.id === item.id && player.state.playing}
                onOpen={() => open(item)}
                onPlay={() => player.play(item)}
              />
            </SwipeRow>
          ))}
          {next && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <Button onClick={() => void loadItems(next)} disabled={loading}>
                {t('Ältere Beiträge')}
              </Button>
            </Box>
          )}
        </PullToRefresh>
      </Box>
    </Box>
  );

  const readerPane = opened ? (
    <Reader
      item={opened}
      dark={dark}
      size={size}
      showBack={!medium}
      playing={player.state?.item.id === opened.id && player.state.playing}
      onBack={() => go({ item: null })}
      onSize={(value) => {
        setSize(value);
        store('moe-feeds-size', value);
      }}
      onStar={() => toggleStar(opened)}
      onRead={() => toggleRead(opened)}
      onPlay={() => player.play(opened)}
    />
  ) : (
    <Box sx={{ flex: 1, display: { xs: 'none', md: 'grid' }, placeItems: 'center' }}>
      <EmptyState
        compact
        icon={<NewspaperRounded />}
        title={t('Wähl einen Beitrag aus')}
        text={t('Mit J und K springst du zum nächsten und vorigen Beitrag.')}
      />
    </Box>
  );

  let content: ReactNode;
  if (!feeds) content = <LinearProgress sx={{ m: 2 }} />;
  else if (!feeds.length) {
    content = (
      <EmptyState
        icon={<RssFeedRounded />}
        title={t('Noch keine Feeds')}
        text={t(
          'Abonniere Blogs, Nachrichten und Podcasts. Neue Beiträge landen hier, ohne Werbung und ohne dass die Seiten dich verfolgen.'
        )}
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="contained" startIcon={<AddRounded />} onClick={() => setAdding(true)} data-feed-start>
              {t('Feed abonnieren')}
            </Button>
            <Button startIcon={<UploadFileRounded />} onClick={() => file.current?.click()}>
              {t('OPML importieren')}
            </Button>
          </Box>
        }
      />
    );
  } else if (medium) {
    content = (
      <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
        {wide && <Box sx={{ width: 270, flex: 'none', overflowY: 'auto', borderRight: `1px solid ${c.outlineVariant}` }}>{nav}</Box>}
        {listPane}
        {readerPane}
      </Box>
    );
  } else content = opened ? readerPane : listPane;

  const menuFeed = feedMenu?.feed;
  const menuFolder = feedMenu?.folder;

  return (
    <AppShell
      active="feeds"
      railAction={
        <Tooltip title={t('Feed abonnieren')} placement="right">
          <Fab color="primary" aria-label={t('Feed abonnieren')} onClick={() => setAdding(true)} data-feed-open="rail">
            <AddRounded />
          </Fab>
        </Tooltip>
      }
      mobileAction={
        !opened ? (
          <Fab color="primary" aria-label={t('Feed abonnieren')} onClick={() => setAdding(true)} data-feed-open="mobile">
            <AddRounded />
          </Fab>
        ) : undefined
      }
      topBar={
        <Box
          component="form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: search.trim() || null, item: null });
          }}
          sx={{
            flex: 1,
            maxWidth: 720,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            height: 48,
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          <SearchRounded sx={{ color: c.onSurfaceVariant }} />
          <InputBase
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Beiträge durchsuchen')}
            sx={{ flex: 1 }}
            inputProps={{ 'aria-label': t('Beiträge durchsuchen'), enterKeyHint: 'search' }}
          />
          {search && (
            <IconButton
              size="small"
              onClick={() => {
                setSearch('');
                go({ q: null });
              }}
              aria-label={t('Suche leeren')}
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      }
    >
      {content}
      <Drawer open={drawer} onClose={() => setDrawer(false)} slotProps={{ paper: { sx: { width: 300, bgcolor: c.surfaceContainerLow } } }}>
        {nav}
      </Drawer>
      <PodcastBar
        player={player}
        onOpen={(item) => {
          setOpened(item);
          go({ item: String(item.id) });
        }}
      />
      <AddFeedDialog
        open={adding}
        folders={folders}
        onClose={() => setAdding(false)}
        onAdded={(feed) => {
          setAdding(false);
          void loadFeeds();
          navigate(`/feeds?feed=${feed.id}`);
        }}
      />
      <Menu
        anchorEl={feedMenu?.anchor ?? null}
        open={Boolean(feedMenu)}
        onClose={() => setFeedMenu(null)}
        onClick={() => setFeedMenu(null)}
      >
        {menuFeed && [
          <MenuItem
            key="rename"
            onClick={async () => {
              const title = await prompt({ title: t('Feed umbenennen'), label: t('Name'), value: menuFeed.title, confirm: t('Speichern') });
              if (title?.trim()) await feedsApi.update(menuFeed.id, { title }).catch((error) => toast(errorText(error)));
              void loadFeeds();
            }}
          >
            <ListItemIcon>
              <EditRounded />
            </ListItemIcon>
            {t('Umbenennen')}
          </MenuItem>,
          <MenuItem
            key="move"
            onClick={async () => {
              const folder = await prompt({
                title: t('In Ordner verschieben'),
                label: t('Ordner'),
                value: menuFeed.folder,
                confirm: t('Verschieben'),
                text: t('Leer lassen für keinen Ordner.'),
              });
              if (folder !== null) await feedsApi.update(menuFeed.id, { folder }).catch((error) => toast(errorText(error)));
              void loadFeeds();
            }}
          >
            <ListItemIcon>
              <DriveFileMoveOutlined />
            </ListItemIcon>
            {t('In Ordner verschieben')}
          </MenuItem>,
          <MenuItem
            key="read"
            onClick={async () => {
              await feedsApi.read({ feed: menuFeed.id }).catch((error) => toast(errorText(error)));
              void loadFeeds();
              void loadItems();
            }}
          >
            <ListItemIcon>
              <DoneAllRounded />
            </ListItemIcon>
            {t('Alles als gelesen markieren')}
          </MenuItem>,
          <MenuItem key="copy" onClick={() => void copyText(menuFeed.url, t('Adresse kopiert'))}>
            <ListItemIcon>
              <ContentCopyRounded />
            </ListItemIcon>
            {t('Feed-Adresse kopieren')}
          </MenuItem>,
          <Divider key="divider" />,
          <MenuItem
            key="remove"
            sx={{ color: c.error }}
            onClick={async () => {
              if (
                !(await confirm({
                  title: t('„{name}“ abbestellen?', { name: menuFeed.title }),
                  text: t('Gespeicherte Beiträge dieses Feeds verschwinden, auch Favoriten.'),
                  confirm: t('Abbestellen'),
                  danger: true,
                }))
              )
                return;
              await feedsApi.remove(menuFeed.id).catch((error) => toast(errorText(error)));
              if (scope.feed === menuFeed.id) navigate('/feeds');
              void loadFeeds();
              void loadItems();
            }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineRounded />
            </ListItemIcon>
            {t('Abbestellen')}
          </MenuItem>,
        ]}
        {menuFolder !== undefined && [
          <MenuItem
            key="rename-folder"
            onClick={async () => {
              const to = await prompt({ title: t('Ordner umbenennen'), label: t('Name'), value: menuFolder, confirm: t('Umbenennen') });
              if (to === null) return;
              await feedsApi.renameFolder(menuFolder, to).catch((error) => toast(errorText(error)));
              if (scope.folder === menuFolder) navigate(to.trim() ? `/feeds?folder=${encodeURIComponent(to.trim())}` : '/feeds');
              void loadFeeds();
            }}
          >
            <ListItemIcon>
              <EditRounded />
            </ListItemIcon>
            {t('Umbenennen')}
          </MenuItem>,
          <MenuItem
            key="read-folder"
            onClick={async () => {
              await feedsApi.read({ folder: menuFolder }).catch((error) => toast(errorText(error)));
              void loadFeeds();
              void loadItems();
            }}
          >
            <ListItemIcon>
              <DoneAllRounded />
            </ListItemIcon>
            {t('Alles als gelesen markieren')}
          </MenuItem>,
        ]}
      </Menu>
      <Menu anchorEl={tools} open={Boolean(tools)} onClose={() => setTools(null)} onClick={() => setTools(null)}>
        {scopeFeed && (
          <MenuItem onClick={(event) => setFeedMenu({ feed: scopeFeed, anchor: event.currentTarget })}>
            <ListItemIcon>
              <RssFeedRounded />
            </ListItemIcon>
            {t('Feed bearbeiten')}
          </MenuItem>
        )}
        <MenuItem onClick={() => file.current?.click()}>
          <ListItemIcon>
            <UploadFileRounded />
          </ListItemIcon>
          <ListItemText primary={t('OPML importieren')} secondary={t('Feeds aus einem anderen Reader übernehmen')} />
        </MenuItem>
        <MenuItem component="a" href="/api/feeds/export" download>
          <ListItemIcon>
            <DownloadRounded />
          </ListItemIcon>
          {t('Als OPML exportieren')}
        </MenuItem>
      </Menu>
      <input
        ref={file}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml,application/xml"
        hidden
        onChange={async (event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (!picked) return;
          try {
            const result = await importOpml(picked);
            toast(t('{added} übernommen, {skipped} übersprungen', { added: result.added, skipped: result.skipped }));
            void loadFeeds();
          } catch (error) {
            toast(errorText(error));
          }
        }}
      />
      {feeds && feeds.some((feed) => feed.errors >= 5) && !opened && medium && (
        <Alert
          severity="warning"
          sx={{ position: 'fixed', bottom: 'calc(24px + var(--moe-player, 0px))', right: 24, maxWidth: 360, zIndex: 1100 }}
        >
          {t('Einige Feeds lassen sich seit Längerem nicht abrufen. Sie sind mit einem Warnzeichen markiert.')}
        </Alert>
      )}
    </AppShell>
  );
}
