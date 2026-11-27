import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Fab from '@mui/material/Fab';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import BookmarkAddRounded from '@mui/icons-material/BookmarkAddRounded';
import BookmarksRounded from '@mui/icons-material/BookmarksRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import LabelOffOutlined from '@mui/icons-material/LabelOffOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import RssFeedRounded from '@mui/icons-material/RssFeedRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import { api, errorText } from '../../lib/api';
import { featureOn } from '../../lib/features';
import { formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { c, mix, radius } from '../../theme/tokens';
import { copyText, EmptyState } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { PullToRefresh, SwipeRow } from '../common/touch';
import { AppShell } from '../shell/AppShell';
import {
  bookmarklet,
  bookmarksApi,
  importBookmarks,
  type Bookmark,
  type BookmarkInput,
  type Counts,
  type Filter,
  type Sort,
} from './model';

type View = 'list' | 'cards';

const readView = (): View => {
  try {
    return localStorage.getItem('moe-bookmarks-view') === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
};

function Favicon({ bookmark, size = 20 }: { bookmark: Pick<Bookmark, 'icon' | 'host'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!bookmark.icon || broken) {
    return (
      <Box
        aria-hidden
        sx={{
          width: size,
          height: size,
          borderRadius: '6px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: c.secondaryContainer,
          color: c.onSecondaryContainer,
          fontSize: size * 0.55,
          fontWeight: 700,
          flex: 'none',
        }}
      >
        {bookmark.host.slice(0, 1).toUpperCase()}
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={bookmark.icon}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      sx={{ width: size, height: size, borderRadius: '6px', objectFit: 'contain', flex: 'none' }}
    />
  );
}

function BookmarkDialog({
  open,
  initial,
  knownTags,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: (Partial<Bookmark> & { url: string }) | null;
  knownTags: string[];
  onClose: () => void;
  onSaved: (bookmark: Bookmark, existing: boolean) => void;
}) {
  const editing = Boolean(initial?.id);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ loading: boolean; feeds: { url: string; title: string }[]; title: string }>({
    loading: false,
    feeds: [],
    title: '',
  });
  const touched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initial?.url ?? '');
    setTitle(initial?.title ?? '');
    setDescription(initial?.description ?? '');
    setTags(initial?.tags ?? []);
    setLater(initial?.later ?? false);
    setPreview({ loading: false, feeds: [], title: '' });
    touched.current = Boolean(initial?.title);
  }, [open, initial]);

  useEffect(() => {
    if (!open || editing || !/^https?:\/\/\S+\.\S+/i.test(url.trim())) return;
    const timer = setTimeout(() => {
      setPreview((current) => ({ ...current, loading: true }));
      bookmarksApi
        .preview(url.trim())
        .then((result) => {
          setPreview({ loading: false, feeds: result.feeds, title: result.title });
          if (!touched.current && result.title) setTitle(result.title);
          if (result.description) setDescription((current) => current || result.description);
        })
        .catch(() => setPreview({ loading: false, feeds: [], title: '' }));
    }, 450);
    return () => clearTimeout(timer);
  }, [url, open, editing]);

  const save = async () => {
    setBusy(true);
    const input: BookmarkInput = { url: url.trim(), title: title.trim() || undefined, description: description.trim(), tags, later };
    try {
      if (editing && initial?.id) {
        const result = await bookmarksApi.update(initial.id, { ...input, title: title.trim() });
        onSaved(result.bookmark, false);
      } else {
        const result = await bookmarksApi.create(input);
        onSaved(result.bookmark, result.existing);
      }
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async (feed: string) => {
    try {
      const result = await api.post<{ feed: { title: string }; existing: boolean }>('/api/feeds', { url: feed });
      toast(result.existing ? t('Diesen Feed hast du schon') : t('„{title}“ abonniert', { title: result.feed.title }), {
        action: { label: t('Öffnen'), onClick: () => (location.href = '/feeds') },
      });
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-bookmark-dialog>
      <DialogTitle>{editing ? t('Lesezeichen bearbeiten') : t('Neues Lesezeichen')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField
          label={t('Adresse')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus={!editing}
          placeholder="https://"
          slotProps={{
            htmlInput: { inputMode: 'url', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, 'data-bookmark-url': '' },
          }}
        />
        {preview.loading && <LinearProgress sx={{ mt: -1.5 }} />}
        <TextField
          label={t('Titel')}
          value={title}
          onChange={(event) => {
            touched.current = true;
            setTitle(event.target.value);
          }}
          placeholder={t('Wird von der Seite übernommen')}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
        <TextField
          label={t('Notiz')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={2}
          maxRows={6}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
        <Autocomplete
          multiple
          freeSolo
          options={knownTags}
          value={tags}
          onChange={(_event, next) =>
            setTags(
              next
                .map((entry) => String(entry).trim())
                .filter(Boolean)
                .slice(0, 20)
            )
          }
          renderValue={(items, getItemProps) =>
            items.map((item, index) => {
              const { key, ...rest } = getItemProps({ index });
              return <Chip key={key} {...rest} label={item} size="small" />;
            })
          }
          renderInput={(params) => (
            <TextField {...params} label={t('Schlagwörter')} placeholder={tags.length ? '' : t('Tippen und Enter drücken')} />
          )}
        />
        <FormControlLabel
          control={<Switch checked={later} onChange={(event) => setLater(event.target.checked)} />}
          label={t('Später lesen')}
        />
        {!editing && featureOn('feeds') && preview.feeds.length > 0 && (
          <Alert
            severity="info"
            icon={<RssFeedRounded />}
            action={
              <Button color="inherit" size="small" onClick={() => void subscribe(preview.feeds[0].url)}>
                {t('Abonnieren')}
              </Button>
            }
          >
            {t('Diese Seite hat einen Feed. Neue Beiträge kannst du unter Feeds lesen.')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={!url.trim() || busy} onClick={() => void save()} data-bookmark-save>
          {t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BookmarkMenu({
  bookmark,
  anchor,
  onClose,
  onEdit,
  onChanged,
  onRemove,
}: {
  bookmark: Bookmark;
  anchor: HTMLElement | null;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (bookmark: Bookmark) => void;
  onRemove: () => void;
}) {
  const run = (action: () => unknown) => () => {
    onClose();
    void action();
  };
  return (
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={onClose}>
      <MenuItem onClick={run(onEdit)}>
        <ListItemIcon>
          <EditRounded />
        </ListItemIcon>
        {t('Bearbeiten')}
      </MenuItem>
      <MenuItem
        onClick={run(async () => {
          const result = await bookmarksApi.update(bookmark.id, { later: !bookmark.later }).catch((error) => toast(errorText(error)));
          if (result) onChanged(result.bookmark);
        })}
      >
        <ListItemIcon>{bookmark.later ? <TaskAltRounded /> : <ScheduleRounded />}</ListItemIcon>
        {bookmark.later ? t('Gelesen') : t('Später lesen')}
      </MenuItem>
      <MenuItem onClick={run(() => copyText(bookmark.url, t('Link kopiert')))}>
        <ListItemIcon>
          <ContentCopyRounded />
        </ListItemIcon>
        {t('Link kopieren')}
      </MenuItem>
      <MenuItem
        onClick={run(async () => {
          const result = await bookmarksApi.refresh(bookmark.id).catch((error) => toast(errorText(error)));
          if (result) {
            onChanged(result.bookmark);
            toast(result.bookmark.dead ? t('Die Seite ist nicht erreichbar') : t('Aktualisiert'));
          }
        })}
      >
        <ListItemIcon>
          <RefreshRounded />
        </ListItemIcon>
        {t('Neu von der Seite laden')}
      </MenuItem>
      <Divider />
      <MenuItem onClick={run(onRemove)} sx={{ color: c.error }}>
        <ListItemIcon sx={{ color: 'inherit' }}>
          <DeleteOutlineRounded />
        </ListItemIcon>
        {t('Löschen')}
      </MenuItem>
    </Menu>
  );
}

function BookmarkRow({
  bookmark,
  selecting,
  selected,
  onSelect,
  onOpen,
  onMenu,
  onTag,
  view,
}: {
  bookmark: Bookmark;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onTag: (tag: string) => void;
  view: View;
}) {
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => press.current && clearTimeout(press.current);
  const body = (
    <>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {view === 'list' && <Favicon bookmark={bookmark} />}
          <Typography variant="body1" noWrap sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
            {bookmark.title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, color: c.onSurfaceVariant }}>
          {view === 'cards' && <Favicon bookmark={bookmark} size={16} />}
          <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
            {bookmark.host}
          </Typography>
          {bookmark.later && (
            <Chip
              size="small"
              icon={<ScheduleRounded />}
              label={t('Später')}
              sx={{ height: 20, '& .MuiChip-label': { px: 0.75 }, '& .MuiChip-icon': { fontSize: 14 } }}
            />
          )}
          {bookmark.dead && (
            <Tooltip title={bookmark.status ? t('Antwortet mit Fehler {status}', { status: bookmark.status }) : t('Nicht erreichbar')}>
              <LinkOffRounded sx={{ fontSize: 16, color: c.error }} aria-label={t('Toter Link')} />
            </Tooltip>
          )}
        </Box>
        {bookmark.description && (
          <Typography
            variant="body2"
            sx={{
              color: c.onSurfaceVariant,
              mt: 0.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {bookmark.description}
          </Typography>
        )}
        {bookmark.tags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
            {bookmark.tags.map((tag) => (
              <Chip
                key={tag}
                size="small"
                label={tag}
                variant="outlined"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTag(tag);
                }}
                sx={{ height: 22 }}
              />
            ))}
          </Box>
        )}
      </Box>
    </>
  );
  return (
    <Box
      data-bookmark={bookmark.title}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: view === 'cards' ? 'column' : 'row',
        borderRadius: view === 'cards' ? `${radius.lg}px` : { md: `${radius.md}px` },
        bgcolor: selected ? c.secondaryContainer : view === 'cards' ? c.surfaceContainerLow : 'transparent',
        overflow: 'hidden',
        height: view === 'cards' ? '100%' : undefined,
        '&:hover': { bgcolor: selected ? c.secondaryContainer : view === 'cards' ? c.surfaceContainer : mix(c.onSurface, 5) },
        '&:hover .bookmark-more, &:focus-within .bookmark-more': { opacity: 1 },
      }}
    >
      {view === 'cards' && (
        <Box
          component="a"
          href={bookmark.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          tabIndex={-1}
          aria-hidden
          sx={{ display: 'block', aspectRatio: '1.91 / 1', bgcolor: c.surfaceContainerHigh }}
        >
          {bookmark.image ? (
            <Box
              component="img"
              src={bookmark.image}
              alt=""
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={(event) => ((event.target as HTMLImageElement).style.visibility = 'hidden')}
            />
          ) : (
            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              <Favicon bookmark={bookmark} size={40} />
            </Box>
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: view === 'cards' ? 1.5 : 0, flex: 1, minWidth: 0 }}>
        {selecting && (
          <Checkbox
            checked={selected}
            onChange={onSelect}
            sx={{ mt: view === 'cards' ? -0.5 : 0.75, ml: view === 'list' ? 0.5 : -0.5 }}
            slotProps={{ input: { 'aria-label': t('Auswählen') } }}
          />
        )}
        <Box
          component={selecting ? ButtonBase : 'a'}
          {...(selecting ? { onClick: onSelect } : { href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', onClick: onOpen })}
          onPointerDown={(event: ReactPointerEvent) => {
            if (event.pointerType !== 'touch' || selecting) return;
            press.current = setTimeout(onSelect, 500);
          }}
          onPointerUp={stop}
          onPointerMove={stop}
          onPointerCancel={stop}
          onContextMenu={(event: ReactMouseEvent) => {
            if (selecting) return;
            event.preventDefault();
            onMenu(event.currentTarget as HTMLElement);
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            textAlign: 'left',
            color: 'inherit',
            textDecoration: 'none',
            px: view === 'list' ? 1.5 : 0,
            py: view === 'list' ? 1.25 : 0,
            borderRadius: 'inherit',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
          }}
        >
          {body}
        </Box>
        <IconButton
          className="bookmark-more"
          size="small"
          onClick={(event) => onMenu(event.currentTarget)}
          aria-label={t('Mehr zu {name}', { name: bookmark.title })}
          sx={{ mt: view === 'list' ? 1 : 0, mr: view === 'list' ? 0.5 : 0, opacity: { xs: 1, md: 0 } }}
        >
          <MoreVertRounded fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

function SideNav({
  counts,
  tags,
  filter,
  tag,
  onFilter,
  onTag,
  onRenameTag,
}: {
  counts: Counts | null;
  tags: { tag: string; count: number }[];
  filter: Filter;
  tag: string | null;
  onFilter: (filter: Filter) => void;
  onTag: (tag: string | null) => void;
  onRenameTag: (tag: string) => void;
}) {
  const entry = (key: string, icon: ReactNode, label: string, count: number | undefined, active: boolean, click: () => void) => (
    <ButtonBase
      key={key}
      onClick={click}
      aria-current={active ? 'page' : undefined}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        gap: 1.5,
        px: 2,
        height: 44,
        borderRadius: `${radius.full}px`,
        bgcolor: active ? c.secondaryContainer : 'transparent',
        color: active ? c.onSecondaryContainer : c.onSurfaceVariant,
        '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
      }}
    >
      {icon}
      <Typography variant="body2" noWrap sx={{ flex: 1, textAlign: 'left', fontWeight: active ? 700 : 500 }}>
        {label}
      </Typography>
      {count !== undefined && count > 0 && <Typography variant="caption">{formatNumber(count)}</Typography>}
    </ButtonBase>
  );
  return (
    <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }} data-bookmark-nav>
      {entry('all', <BookmarksRounded fontSize="small" />, t('Alle'), counts?.total, filter === 'all' && !tag, () => {
        onTag(null);
        onFilter('all');
      })}
      {entry('later', <ScheduleRounded fontSize="small" />, t('Später lesen'), counts?.later, filter === 'later' && !tag, () => {
        onTag(null);
        onFilter('later');
      })}
      {entry(
        'untagged',
        <LabelOffOutlined fontSize="small" />,
        t('Ohne Schlagwort'),
        counts?.untagged,
        filter === 'untagged' && !tag,
        () => {
          onTag(null);
          onFilter('untagged');
        }
      )}
      {(counts?.dead ?? 0) > 0 &&
        entry('dead', <LinkOffRounded fontSize="small" />, t('Tote Links'), counts?.dead, filter === 'dead' && !tag, () => {
          onTag(null);
          onFilter('dead');
        })}
      {tags.length > 0 && (
        <Typography variant="overline" sx={{ px: 2, pt: 1.5, color: c.onSurfaceVariant }}>
          {t('Schlagwörter')}
        </Typography>
      )}
      {tags.map((entryTag) => (
        <Box
          key={entryTag.tag}
          onContextMenu={(event) => {
            event.preventDefault();
            onRenameTag(entryTag.tag);
          }}
        >
          {entry(`tag-${entryTag.tag}`, <SellOutlined fontSize="small" />, entryTag.tag, entryTag.count, tag === entryTag.tag, () => {
            onFilter('all');
            onTag(entryTag.tag);
          })}
        </Box>
      ))}
    </Box>
  );
}

export function BookmarksApp() {
  const { query } = useLocation();
  const wide = useMediaQuery('(min-width: 1100px)');
  const [view, setView] = useState<View>(readView);
  const [search, setSearch] = useState(query.get('q') ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('new');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [dialog, setDialog] = useState<(Partial<Bookmark> & { url: string }) | null>(null);
  const [menu, setMenu] = useState<{ bookmark: Bookmark; anchor: HTMLElement } | null>(null);
  const [toolMenu, setToolMenu] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [helper, setHelper] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const q = query.get('q') ?? '';

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      try {
        const page = await bookmarksApi.list({ q: q || undefined, tag: tag ?? undefined, filter, sort, offset });
        setItems((current) =>
          offset ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items
        );
        setMore(page.more);
        setTotal(page.total);
        setCounts(page.counts);
        setChecking(page.checking);
      } catch (error) {
        toast(errorText(error));
      } finally {
        setLoading(false);
      }
    },
    [q, tag, filter, sort]
  );

  const loadTags = useCallback(() => {
    bookmarksApi
      .tags()
      .then((result) => setTags(result.tags))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);
  useEffect(() => loadTags(), [loadTags]);

  useEffect(() => {
    const add = query.get('add');
    if (!add) return;
    setDialog({ url: add, title: query.get('title') ?? undefined });
    navigate('/bookmarks', { replace: true });
  }, [query]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive((event, data) => {
    if (event !== 'bookmarks' && event !== 'reconnect') return;
    if (data.type === 'checked')
      toast(
        Number(data.dead) ? tn(Number(data.dead), 'Ein toter Link gefunden', '{count} tote Links gefunden') : t('Alle Links funktionieren')
      );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void load(0);
      loadTags();
    }, 300);
  });

  const knownTags = useMemo(() => tags.map((entry) => entry.tag), [tags]);

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem('moe-bookmarks-view', next);
    } catch {}
  };

  const removeOne = async (bookmark: Bookmark) => {
    try {
      await bookmarksApi.remove([bookmark.id]);
      setItems((current) => current.filter((item) => item.id !== bookmark.id));
      toast(t('Lesezeichen gelöscht'), {
        action: {
          label: t('Rückgängig'),
          onClick: () =>
            void bookmarksApi
              .create({
                url: bookmark.url,
                title: bookmark.title,
                description: bookmark.description,
                tags: bookmark.tags,
                later: bookmark.later,
              })
              .then(() => load(0)),
        },
      });
      loadTags();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const replace = (bookmark: Bookmark) => setItems((current) => current.map((item) => (item.id === bookmark.id ? bookmark : item)));

  const toggle = (id: string) =>
    setSelection((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selected = [...(selection ?? [])];

  const bulkTag = async () => {
    const value = await prompt({
      title: tn(selected.length, 'Schlagwort für ein Lesezeichen', 'Schlagwort für {count} Lesezeichen'),
      label: t('Schlagwort'),
      value: '',
      confirm: t('Hinzufügen'),
    });
    if (!value?.trim()) return;
    await bookmarksApi.tag(selected, [value.trim()]).catch((error) => toast(errorText(error)));
    setSelection(null);
    void load(0);
    loadTags();
  };

  const bulkRemove = async () => {
    if (
      !(await confirm({
        title: tn(selected.length, 'Ein Lesezeichen löschen?', '{count} Lesezeichen löschen?'),
        confirm: t('Löschen'),
        danger: true,
      }))
    )
      return;
    await bookmarksApi.remove(selected).catch((error) => toast(errorText(error)));
    setSelection(null);
    void load(0);
    loadTags();
  };

  const renameTag = async (from: string) => {
    const to = await prompt({
      title: t('Schlagwort umbenennen'),
      label: t('Neuer Name'),
      value: from,
      confirm: t('Umbenennen'),
      text: t('Leer lassen, um das Schlagwort überall zu entfernen.'),
    });
    if (to === null) return;
    await bookmarksApi.renameTag(from, to).catch((error) => toast(errorText(error)));
    if (tag === from) setTag(to.trim() || null);
    loadTags();
    void load(0);
  };

  const heading =
    tag ??
    (filter === 'later'
      ? t('Später lesen')
      : filter === 'dead'
        ? t('Tote Links')
        : filter === 'untagged'
          ? t('Ohne Schlagwort')
          : t('Alle Lesezeichen'));

  const chips = (
    <Box
      sx={{
        display: { xs: 'flex', lg: 'none' },
        gap: 1,
        overflowX: 'auto',
        px: 2,
        pb: 1,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {(
        [
          ['all', t('Alle')],
          ['later', t('Später lesen')],
          ['untagged', t('Ohne Schlagwort')],
          ...((counts?.dead ?? 0) > 0 ? [['dead', t('Tote Links')]] : []),
        ] as [Filter, string][]
      ).map(([key, label]) => (
        <Chip
          key={key}
          label={label}
          color={filter === key && !tag ? 'primary' : 'default'}
          variant={filter === key && !tag ? 'filled' : 'outlined'}
          onClick={() => {
            setTag(null);
            setFilter(key);
          }}
        />
      ))}
      {tags.map((entry) => (
        <Chip
          key={entry.tag}
          icon={<LabelOutlined />}
          label={entry.tag}
          color={tag === entry.tag ? 'primary' : 'default'}
          variant={tag === entry.tag ? 'filled' : 'outlined'}
          onClick={() => setTag(tag === entry.tag ? null : entry.tag)}
          {...(tag === entry.tag
            ? { onDelete: () => void renameTag(entry.tag), deleteIcon: <EditRounded aria-label={t('Schlagwort umbenennen')} /> }
            : {})}
        />
      ))}
    </Box>
  );

  const list = (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 56 }}>
        {selection ? (
          <>
            <IconButton onClick={() => setSelection(null)} aria-label={t('Auswahl beenden')}>
              <CloseRounded />
            </IconButton>
            <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
              {tn(selected.length, 'Eins ausgewählt', '{count} ausgewählt')}
            </Typography>
            <Button startIcon={<SellOutlined />} disabled={!selected.length} onClick={() => void bulkTag()}>
              {t('Schlagwort')}
            </Button>
            <Button color="error" startIcon={<DeleteOutlineRounded />} disabled={!selected.length} onClick={() => void bulkRemove()}>
              {t('Löschen')}
            </Button>
          </>
        ) : (
          <>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" component="h1" noWrap sx={{ fontWeight: 700 }}>
                {heading}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {q
                  ? tn(total, 'Ein Treffer für „{q}“', '{count} Treffer für „{q}“', { q })
                  : tn(total, 'Ein Lesezeichen', '{count} Lesezeichen')}
              </Typography>
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_event, next: View | null) => next && changeView(next)}
              aria-label={t('Ansicht')}
            >
              <ToggleButton value="list" aria-label={t('Liste')}>
                <ViewAgendaOutlined fontSize="small" />
              </ToggleButton>
              <ToggleButton value="cards" aria-label={t('Kacheln')}>
                <GridViewRounded fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              size="small"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              sx={{ display: { xs: 'none', sm: 'inline-flex' }, minWidth: 150 }}
              slotProps={{ htmlInput: { 'aria-label': t('Sortieren') } }}
            >
              <MenuItem value="new">{t('Neueste zuerst')}</MenuItem>
              <MenuItem value="old">{t('Älteste zuerst')}</MenuItem>
              <MenuItem value="name">{t('Nach Name')}</MenuItem>
              <MenuItem value="visits">{t('Oft besucht')}</MenuItem>
            </TextField>
            <IconButton
              onClick={(event) => setToolMenu(event.currentTarget)}
              aria-label={t('Mehr')}
              aria-haspopup="menu"
              data-bookmark-tools
            >
              <MoreVertRounded />
            </IconButton>
          </>
        )}
      </Box>
      {chips}
      {checking && <LinearProgress sx={{ mx: 2 }} />}
      <Box sx={{ flex: 1, overflowY: { lg: 'auto' }, px: { xs: 0, md: 1 }, pb: 12 }}>
        <PullToRefresh onRefresh={() => load(0)}>
          {loading && !items.length && <LinearProgress sx={{ mx: 2 }} />}
          {!loading && !items.length && (
            <EmptyState
              icon={<BookmarksRounded />}
              title={q || tag || filter !== 'all' ? t('Nichts gefunden') : t('Noch keine Lesezeichen')}
              text={
                q || tag || filter !== 'all'
                  ? undefined
                  : t('Speichere Links an einem Ort, mit Schlagwörtern und Notizen. Auf dem Handy geht das auch über „Teilen“.')
              }
              action={
                !q && !tag && filter === 'all' ? (
                  <Button variant="contained" startIcon={<AddRounded />} onClick={() => setDialog({ url: '' })}>
                    {t('Lesezeichen hinzufügen')}
                  </Button>
                ) : undefined
              }
            />
          )}
          {view === 'cards' ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 1.5, px: { xs: 2, md: 1 } }}>
              {items.map((bookmark) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  view="cards"
                  selecting={Boolean(selection)}
                  selected={Boolean(selection?.has(bookmark.id))}
                  onSelect={() => toggle(bookmark.id)}
                  onOpen={() => void bookmarksApi.visit(bookmark.id).catch(() => undefined)}
                  onMenu={(anchor) => setMenu({ bookmark, anchor })}
                  onTag={(value) => setTag(value)}
                />
              ))}
            </Box>
          ) : (
            items.map((bookmark) => (
              <SwipeRow
                key={bookmark.id}
                start={{
                  icon: bookmark.later ? <TaskAltRounded /> : <ScheduleRounded />,
                  label: bookmark.later ? t('Gelesen') : t('Später'),
                  color: c.onPrimaryContainer,
                  background: c.primaryContainer,
                  run: () =>
                    void bookmarksApi
                      .update(bookmark.id, { later: !bookmark.later })
                      .then((result) => replace(result.bookmark))
                      .catch((error) => toast(errorText(error))),
                }}
                end={{
                  icon: <DeleteOutlineRounded />,
                  label: t('Löschen'),
                  color: c.onErrorContainer,
                  background: c.errorContainer,
                  run: () => void removeOne(bookmark),
                }}
              >
                <BookmarkRow
                  bookmark={bookmark}
                  view="list"
                  selecting={Boolean(selection)}
                  selected={Boolean(selection?.has(bookmark.id))}
                  onSelect={() => toggle(bookmark.id)}
                  onOpen={() => void bookmarksApi.visit(bookmark.id).catch(() => undefined)}
                  onMenu={(anchor) => setMenu({ bookmark, anchor })}
                  onTag={(value) => setTag(value)}
                />
              </SwipeRow>
            ))
          )}
          {more && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <Button onClick={() => void load(items.length)} disabled={loading}>
                {t('Mehr laden')}
              </Button>
            </Box>
          )}
        </PullToRefresh>
      </Box>
    </Box>
  );

  return (
    <AppShell
      active="bookmarks"
      railAction={
        <Tooltip title={t('Neues Lesezeichen')} placement="right">
          <Fab color="primary" aria-label={t('Neues Lesezeichen')} onClick={() => setDialog({ url: '' })} data-bookmark-add="rail">
            <BookmarkAddRounded />
          </Fab>
        </Tooltip>
      }
      mobileAction={
        <Fab
          variant="extended"
          color="primary"
          aria-label={t('Neues Lesezeichen')}
          onClick={() => setDialog({ url: '' })}
          data-bookmark-add="mobile"
        >
          <BookmarkAddRounded />
          {t('Speichern')}
        </Fab>
      }
      topBar={
        <Box
          component="form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(search.trim() ? `/bookmarks?q=${encodeURIComponent(search.trim())}` : '/bookmarks', { replace: true });
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
            placeholder={t('Lesezeichen durchsuchen')}
            sx={{ flex: 1 }}
            inputProps={{ 'aria-label': t('Lesezeichen durchsuchen'), enterKeyHint: 'search' }}
          />
          {search && (
            <IconButton
              size="small"
              onClick={() => {
                setSearch('');
                navigate('/bookmarks', { replace: true });
              }}
              aria-label={t('Suche leeren')}
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      }
    >
      <Box sx={{ display: 'flex', height: { lg: '100%' }, minHeight: 0 }}>
        {wide && (
          <Box sx={{ width: 260, flex: 'none', overflowY: 'auto', borderRight: `1px solid ${c.outlineVariant}` }}>
            <SideNav
              counts={counts}
              tags={tags}
              filter={filter}
              tag={tag}
              onFilter={setFilter}
              onTag={setTag}
              onRenameTag={(value) => void renameTag(value)}
            />
          </Box>
        )}
        {list}
      </Box>
      <BookmarkDialog
        open={Boolean(dialog)}
        initial={dialog}
        knownTags={knownTags}
        onClose={() => setDialog(null)}
        onSaved={(_bookmark, existing) => {
          setDialog(null);
          toast(existing ? t('Das hattest du schon gespeichert') : t('Gespeichert'));
          void load(0);
          loadTags();
          if (window.name === 'moe-bookmark') setTimeout(() => window.close(), 900);
        }}
      />
      {menu && (
        <BookmarkMenu
          bookmark={menu.bookmark}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onEdit={() => setDialog(menu.bookmark)}
          onChanged={replace}
          onRemove={() => void removeOne(menu.bookmark)}
        />
      )}
      <Menu anchorEl={toolMenu} open={Boolean(toolMenu)} onClose={() => setToolMenu(null)} onClick={() => setToolMenu(null)}>
        <MenuItem onClick={() => setSelection(new Set())}>
          <ListItemIcon>
            <TaskAltRounded />
          </ListItemIcon>
          {t('Auswählen')}
        </MenuItem>
        <MenuItem
          onClick={async () => {
            const result = await bookmarksApi.check().catch((error) => toast(errorText(error)));
            if (result?.started) {
              setChecking(true);
              toast(tn(result.count ?? 0, 'Ein Link wird geprüft', '{count} Links werden geprüft'));
            } else if (result) toast(t('Die Prüfung läuft schon'));
          }}
        >
          <ListItemIcon>
            <LinkOffRounded />
          </ListItemIcon>
          <ListItemText primary={t('Tote Links finden')} secondary={t('Prüft, ob die Seiten noch da sind')} />
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => fileInput.current?.click()}>
          <ListItemIcon>
            <UploadFileRounded />
          </ListItemIcon>
          <ListItemText primary={t('Aus dem Browser importieren')} secondary={t('HTML-Datei aus Chrome, Firefox, Safari oder Edge')} />
        </MenuItem>
        <MenuItem component="a" href="/api/bookmarks/export" download>
          <ListItemIcon>
            <DownloadRounded />
          </ListItemIcon>
          {t('Exportieren')}
        </MenuItem>
        <MenuItem onClick={() => setHelper(true)}>
          <ListItemIcon>
            <LinkRounded />
          </ListItemIcon>
          {t('Lesezeichen-Knopf für den Browser')}
        </MenuItem>
      </Menu>
      <input
        ref={fileInput}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            const result = await importBookmarks(file);
            toast(t('{added} übernommen, {skipped} übersprungen', { added: result.added, skipped: result.skipped }));
            void load(0);
            loadTags();
          } catch (error) {
            toast(errorText(error));
          }
        }}
      />
      <Dialog open={helper} onClose={() => setHelper(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('Lesezeichen-Knopf')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2">
            {t('Zieh den Knopf in die Lesezeichenleiste deines Browsers. Ein Klick darauf speichert die gerade offene Seite in MoeCloud.')}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box
              component="a"
              ref={(node: HTMLAnchorElement | null) => node?.setAttribute('href', bookmarklet(location.origin))}
              onClick={(event: ReactMouseEvent) => event.preventDefault()}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                borderRadius: `${radius.full}px`,
                bgcolor: c.primary,
                color: c.onPrimary,
                textDecoration: 'none',
                fontWeight: 700,
                cursor: 'grab',
              }}
            >
              <BookmarkAddRounded fontSize="small" />
              {t('In MoeCloud merken')}
            </Box>
          </Box>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Auf dem Handy installierst du MoeCloud als App und speicherst Links über „Teilen“.')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelper(false)}>{t('Fertig')}</Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
