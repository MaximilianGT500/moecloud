import { Suspense, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AutoDeleteRounded from '@mui/icons-material/AutoDeleteRounded';
import AutoModeRounded from '@mui/icons-material/AutoModeRounded';
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded';
import TransformRounded from '@mui/icons-material/TransformRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import EmojiSymbolsRounded from '@mui/icons-material/EmojiSymbolsRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import UnarchiveRounded from '@mui/icons-material/UnarchiveRounded';
import DriveFileMoveRounded from '@mui/icons-material/DriveFileMoveRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import FolderZipRounded from '@mui/icons-material/FolderZipRounded';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import NotificationsOffRounded from '@mui/icons-material/NotificationsOffRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import QueueMusicRounded from '@mui/icons-material/QueueMusicRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import InfoRounded from '@mui/icons-material/InfoRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import AlarmRounded from '@mui/icons-material/AlarmRounded';
import PostAddRounded from '@mui/icons-material/PostAddRounded';
import LockOpenRounded from '@mui/icons-material/LockOpenRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import AutoStoriesRounded from '@mui/icons-material/AutoStoriesRounded';
import MergeRounded from '@mui/icons-material/MergeRounded';
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import SortRounded from '@mui/icons-material/SortRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import HourglassBottomRounded from '@mui/icons-material/HourglassBottomRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import ContactsRounded from '@mui/icons-material/ContactsRounded';
import { api, errorText } from '../../lib/api';
import { boot, type Boot, type Storage } from '../../lib/boot';
import { featureOn } from '../../lib/features';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { setPrefs, usePrefs, type Prefs } from '../../lib/prefs';
import { navigate, useLocation } from '../../lib/router';
import { registerWorker, takeShared } from '../../lib/shared';
import { weblinkFile } from './preview/weblink';
import { Uploader, entriesFromDrop, entriesFromInput, entriesFromPaste, hasFiles, type UploadEntry } from '../../lib/upload';
import { c, folderColor, radius } from '../../theme/tokens';
import { AppShell, type Destination } from '../shell/AppShell';
import { EmptyState } from '../common/bits';
import { choose, confirm, pickColor } from '../common/dialogs';
import { lazyNamed, whenIdle } from '../common/lazy';
import { pluginActionsFor, pluginIcon, pluginPageHref, pluginPageKey, pluginPages, runPluginAction } from '../common/plugins';
import { toast } from '../common/toast';
import { ActionMenu, type Action, type Anchor } from './ActionMenu';
import {
  attempt,
  createFolder,
  createTextFile,
  createWeblink,
  deleteForever,
  download,
  emptyTrash,
  extract,
  importFromUrl,
  leaveShare,
  renameItem,
  restoreItems,
  starItems,
  trashItems,
} from './actions';
import type { ActivityEntry } from './activity';
import { albumHref, newAlbum } from './album';
import { Details, type DetailsTab } from './Details';
import { enqueue, forget, playItems, usePlayer } from './player';
import { FolderReadme, readmeOf } from './Readme';
import { FormsView } from './Forms';
import { DRAG_TYPE, Items } from './Items';
import {
  canEditImage,
  canMakePdf,
  canMergePdfs,
  canOrganizePdf,
  FOLDER_COLOR_OPTIONS,
  FOLDER_ICON_OPTIONS,
  previewType,
  type Item,
} from './kinds';
import { canEdit, folderHref, parseView, searchQuery, sortItems, useListing, viewKey, type View } from './model';
import type { RecordMode } from './record';
import { MoveDialog, type MoveRequest } from './MoveDialog';
import { loadOfficeExtensions, OfficeEditor, officeEditable, officeExtensions } from './OfficeEditor';
import { Breadcrumbs, DropOverlay, PageTitle, SelectionBar, UploadPanel, useNewMenu } from './Panels';
import { SearchBar } from './SearchBar';
import { useTagSync } from './tags';

const CALENDAR_FILE = /\.(ics|ical|ifb|vcs)$/i;
const CONTACT_FILE = /\.(vcf|vcard)$/i;
const ActivityView = lazyNamed(() => import('./ActivityView'), 'ActivityView');
const HomeView = lazyNamed(() => import('./Home'), 'HomeView');
const TeamsView = lazyNamed(() => import('./Teams'), 'TeamsView');
const TeamBar = lazyNamed(() => import('./Teams'), 'TeamBar');
const AlbumContent = lazyNamed(() => import('./Albums'), 'AlbumContent');
const AlbumList = lazyNamed(() => import('./Albums'), 'AlbumList');
const AlbumMenu = lazyNamed(() => import('./Albums'), 'AlbumMenu');
const AlbumPicker = lazyNamed(() => import('./Albums'), 'AlbumPicker');
const AutomationsDialog = lazyNamed(() => import('./Automations'), 'AutomationsDialog');
const CleanupDialog = lazyNamed(() => import('./Bulk'), 'CleanupDialog');
const RewindDialog = lazyNamed(() => import('./Rewind'), 'RewindDialog');
const RecordDialog = lazyNamed(() => import('./Recorder'), 'RecordDialog');
const ScanDialog = lazyNamed(() => import('./Scanner'), 'ScanDialog');
const LockDialog = lazyNamed(() => import('./Bulk'), 'LockDialog');
const DavImportDialog = lazyNamed(() => import('./DavImport'), 'DavImportDialog');
const ReminderDialog = lazyNamed(() => import('./Bulk'), 'ReminderDialog');
const ExpiryDialog = lazyNamed(() => import('./Bulk'), 'ExpiryDialog');
const TemplateDialog = lazyNamed(() => import('./Templates'), 'TemplateDialog');
const ImageEditor = lazyNamed(() => import('./ImageEditor'), 'ImageEditor');
const MiniPlayer = lazyNamed(() => import('./MiniPlayer'), 'MiniPlayer');
const PackDialog = lazyNamed(() => import('./Bulk'), 'PackDialog');
const PdfMergeDialog = lazyNamed(() => import('./PdfTools'), 'PdfMergeDialog');
const PdfPagesDialog = lazyNamed(() => import('./PdfTools'), 'PdfPagesDialog');
const Photos = lazyNamed(() => import('./Photos'), 'Photos');
const PluginPageView = lazyNamed(() => import('./PluginPage'), 'PluginPageView');
const RenameManyDialog = lazyNamed(() => import('./Bulk'), 'RenameManyDialog');
const SearchFilters = lazyNamed(() => import('./SearchFilters'), 'SearchFilters');
const ShareDialog = lazyNamed(() => import('./ShareDialog'), 'ShareDialog');
const SharedByMe = lazyNamed(() => import('./SharedView'), 'SharedByMe');
const StorageView = lazyNamed(() => import('./Storage'), 'StorageView');
const TagDialog = lazyNamed(() => import('./TagViews'), 'TagDialog');
const TagMenu = lazyNamed(() => import('./TagViews'), 'TagMenu');
const TagsView = lazyNamed(() => import('./TagViews'), 'TagsView');
const NotesView = lazyNamed(() => import('./Notes'), 'NotesView');
const MusicView = lazyNamed(() => import('./Music'), 'MusicView');
const PlaylistPicker = lazyNamed(() => import('./Music'), 'PlaylistPicker');
const Viewer = lazyNamed(() => import('./Viewer'), 'Viewer');

function Later({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

function useOnce(active: boolean) {
  const [seen, setSeen] = useState(active);
  if (active && !seen) setSeen(true);
  return seen || active;
}

interface FilesBoot extends Boot {
  import: boolean;
  share: { links: boolean; users: boolean; requirePassword: boolean; maxDays: number };
  upload: { chunkSize: number; maxUpload: number };
  trashDays: number;
  versions: number;
  starter?: string | null;
  office?: string[] | null;
}

function destinationOf(view: View, team = false): Destination {
  if (view.kind === 'folder' && team) return 'teams';
  if (view.kind === 'folder' || view.kind === 'search') return 'files';
  if (view.kind === 'plugin') return pluginPageKey({ plugin: view.plugin, id: view.page });
  if (view.kind === 'activity') return 'recent';
  if (view.kind === 'tag') return 'tags';
  if (view.kind === 'albums' || view.kind === 'album') return 'photos';
  return view.kind;
}

const SPECIAL = new Set<View['kind']>([
  'home',
  'teams',
  'photos',
  'activity',
  'storage',
  'tags',
  'albums',
  'notes',
  'forms',
  'music',
  'plugin',
]);

function titleOf(view: View) {
  switch (view.kind) {
    case 'home':
      return t('Start');
    case 'teams':
      return t('Teamordner');
    case 'photos':
    case 'albums':
      return t('Fotos');
    case 'album':
      return t('Album');
    case 'recent':
    case 'activity':
      return t('Zuletzt');
    case 'storage':
      return t('Speicher');
    case 'notes':
      return t('Notizen');
    case 'forms':
      return t('Formulare');
    case 'music':
      return t('Musik');
    case 'starred':
      return t('Favoriten');
    case 'shared':
      return t('Geteilt');
    case 'trash':
      return t('Papierkorb');
    case 'tags':
    case 'tag':
      return t('Schlagwörter');
    case 'search':
      return view.q ? t('Suche nach „{query}“', { query: view.q }) : t('Suche');
    case 'plugin':
      return pluginPages().find((page) => page.plugin === view.plugin && page.id === view.page)?.label ?? t('Plugin');
    default:
      return t('Meine Dateien');
  }
}

function LoadingRows() {
  return (
    <Box sx={{ px: 2, py: 1, display: 'flex', flexDirection: 'column', gap: 1 }} aria-busy="true" aria-label={t('Lädt')}>
      {Array.from({ length: 8 }, (_, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 2, height: 56 }}>
          <Skeleton variant="rounded" width={36} height={36} />
          <Skeleton variant="text" sx={{ flex: 1, maxWidth: `${60 - index * 4}%` }} />
          <Skeleton variant="text" width={90} sx={{ display: { xs: 'none', md: 'block' } }} />
        </Box>
      ))}
    </Box>
  );
}

export function FilesApp() {
  const data = boot<FilesBoot>();
  const rootId = data.user!.rootId;
  const { path, query } = useLocation();
  const view = parseView(path, query, rootId);
  const key = viewKey(view);
  const listing = useListing(view);
  const prefs = usePrefs();
  const player = usePlayer();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key, ids: new Set() });
  const [menu, setMenu] = useState<{ items: Item[]; anchor: Anchor } | null>(null);
  const [viewer, setViewer] = useState<{ id: string; editing: boolean } | null>(null);
  const [share, setShare] = useState<Item | null>(null);
  const [tagging, setTagging] = useState<Item[] | null>(null);
  const [albumPick, setAlbumPick] = useState<Item[] | null>(null);
  const [playlistPick, setPlaylistPick] = useState<Item[] | null>(null);
  const [imageEdit, setImageEdit] = useState<Item | null>(null);
  const [officeEdit, setOfficeEdit] = useState<Item | null>(null);
  const [office, setOffice] = useState<string[]>(() => officeExtensions(data.office));

  useEffect(() => {
    if (!data.office || office.length > 0) return;
    let active = true;
    void loadOfficeExtensions().then((extensions) => active && extensions.length > 0 && setOffice(extensions));
    return () => {
      active = false;
    };
  }, []);
  const [pdfPages, setPdfPages] = useState<Item | null>(null);
  const [pdfMerge, setPdfMerge] = useState<Item[] | null>(null);
  const [pdfImages, setPdfImages] = useState<Item[] | null>(null);
  const [renaming, setRenaming] = useState<Item[] | null>(null);
  const [packing, setPacking] = useState<Item[] | null>(null);
  const [cleanupFor, setCleanupFor] = useState<Item | null>(null);
  const [recordMode, setRecordMode] = useState<RecordMode | null>(null);
  const [expiring, setExpiring] = useState<Item | null>(null);
  const [scanning, setScanning] = useState(false);
  const [rewindFor, setRewindFor] = useState<{ folder: { id: string; name: string; root: boolean }; at: number | null } | null>(null);
  const [starter, setStarter] = useState<string | null>(data.starter ?? null);
  const [automationsFor, setAutomationsFor] = useState<Item | null>(null);
  const [locking, setLocking] = useState<Item | null>(null);
  const [davImport, setDavImport] = useState<string | null>(null);
  const [reminding, setReminding] = useState<Item | null>(null);
  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>('info');
  const [storage, setStorage] = useState<Storage>(data.storage ?? { used: 0, quota: null });
  const [dragging, setDragging] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [uploader] = useState(() => new Uploader('/api'));
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<Item | null>(null);
  const dragDepth = useRef(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const special = SPECIAL.has(view.kind);
  const selected = selection.key === key ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ key, ids });
  const sortable = view.kind === 'folder' || view.kind === 'starred' || view.kind === 'search' || view.kind === 'tag';
  const rawItems = listing.data?.items ?? [];
  const items = sortable ? sortItems(rawItems, prefs.sort, prefs.order) : rawItems;
  const chosen = items.filter((item) => selected.has(item.id));
  const folder = listing.data?.folder;
  const role = listing.data?.role ?? 'view';
  const guestOutside = data.user?.role === 'guest' && (view.kind !== 'folder' || role === 'view');
  const readOnly = view.kind === 'folder' && Boolean(folder) && role === 'view';
  const uploadTarget = view.kind !== 'folder' || readOnly ? rootId : (folder?.id ?? view.id);
  const files = items.filter((item) => item.type === 'file');
  const viewerIndex = viewer ? files.findIndex((item) => item.id === viewer.id) : -1;
  const viewing = useOnce(viewerIndex >= 0);
  const sharing = useOnce(Boolean(share));
  const playing = useOnce(player.queue.length > 0);

  const refreshStorage = () => {
    void api
      .get<Storage>('/api/storage')
      .then(setStorage)
      .catch(() => {});
  };

  const refresh = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      listing.reload();
      refreshStorage();
    }, 250);
  };

  useEffect(() => {
    uploader.onDone = () => refresh();
  });

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('moe:position', handler);
    return () => window.removeEventListener('moe:position', handler);
  });

  useEffect(() => {
    const crumbs = listing.data?.breadcrumbs;
    const name = view.kind === 'folder' && crumbs?.length ? crumbs[crumbs.length - 1].name || t('Meine Dateien') : titleOf(view);
    document.title = `${name} » ${data.site.name}`;
  });

  const pendingSelect = query.get('select');
  const pendingTab = query.get('tab');
  useEffect(() => {
    if (!pendingSelect || !listing.data) return;
    const index = items.findIndex((item) => item.id === pendingSelect);
    if (index >= 0) {
      setSelection({ key, ids: new Set([pendingSelect]) });
      if (pendingTab === 'info' || pendingTab === 'activity' || pendingTab === 'comments') setDetailsTab(pendingTab);
      if (wide) setPrefs({ details: true });
      else setDrawer(true);
      setTimeout(
        () => document.querySelector(`[role=grid] [data-index="${index}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        80
      );
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('select');
    url.searchParams.delete('tab');
    navigate(url.pathname + url.search, { replace: true });
  }, [pendingSelect, pendingTab, listing.data, items, key, wide]);

  const reveal = (item: Pick<Item, 'id' | 'parentId'>, tab?: DetailsTab) => {
    if (!item.parentId) return;
    navigate(`${folderHref(item.parentId, rootId)}?select=${item.id}${tab ? `&tab=${tab}` : ''}`);
  };

  const openActivity = (entry: ActivityEntry) => {
    if (!entry.nodeId || !entry.parentId) return;
    reveal({ id: entry.nodeId, parentId: entry.parentId }, entry.action === 'comment' ? 'comments' : undefined);
  };

  useTagSync();

  useEffect(() => {
    try {
      const first = !sessionStorage.getItem('moe-start');
      sessionStorage.setItem('moe-start', '1');
      if (first && data.start === 'home' && window.location.pathname === '/files') navigate('/files/home', { replace: true });
    } catch {}
  }, []);

  useEffect(
    () =>
      whenIdle(() => {
        void Viewer.preload();
        void ShareDialog.preload();
      }),
    []
  );

  useLive((event, payload) => {
    if (event === 'shared') {
      toast(t('{name} hat „{item}“ mit dir geteilt', { name: String(payload.by ?? ''), item: String(payload.name ?? '') }), {
        action: { label: t('Ansehen'), onClick: () => navigate('/files/shared') },
      });
      if (view.kind === 'shared') refresh();
      return;
    }
    if (event === 'reconnect' || (event === 'albums' && view.kind === 'album')) {
      refresh();
      return;
    }
    if (event !== 'change') return;
    const folders = (payload.folders as string[] | undefined) ?? [];
    if (special) refreshStorage();
    else if (view.kind !== 'folder' || folders.includes(view.id) || payload.trash || payload.shared) refresh();
    else refreshStorage();
  });

  const toggleStarter = async (item: Item) => {
    const active = starter === item.id;
    if (!active) {
      const ok = await confirm({
        title: t('„{name}“ als Startdateien nutzen?', { name: item.name }),
        text: t('Jedes neue Konto bekommt eine Kopie von allem, was in diesem Ordner liegt. Bestehende Konten ändern sich nicht.'),
        confirm: t('Nutzen'),
      });
      if (!ok) return;
    }
    try {
      const result = await api.put<{ folder: { id: string } | null }>('/api/admin/starter', { folderId: active ? null : item.id });
      setStarter(result.folder?.id ?? null);
      toast(active ? t('Neue Konten starten wieder leer') : t('Neue Konten bekommen jetzt diese Dateien'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const convert = async (item: Item) => {
    try {
      const { formats } = await api.get<{ formats: string[] }>(`/api/nodes/${item.id}/convert`);
      if (formats.length === 0) {
        toast(t('Diese Datei lässt sich nicht umwandeln'));
        return;
      }
      const format = await choose({
        title: t('„{name}“ umwandeln', { name: item.name }),
        text: t('MoeCloud legt die neue Datei neben das Original. Das Original bleibt, wie es ist.'),
        options: formats.map((entry) => ({
          value: entry,
          label: entry === 'jpeg' ? 'JPEG' : entry.toUpperCase(),
          primary: formats.length === 1,
        })),
      });
      if (!format) return;
      toast(t('Wird umgewandelt …'));
      const result = await api.post<{ node: Item }>(`/api/nodes/${item.id}/convert`, { format });
      toast(t('„{name}“ gespeichert', { name: result.node.name }));
      refresh();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const convertMany = async (list: Item[]) => {
    try {
      const options = await Promise.all(
        list.map((item) =>
          api
            .get<{ formats: string[] }>(`/api/nodes/${item.id}/convert`)
            .then((result) => result.formats)
            .catch(() => [] as string[])
        )
      );
      const formats = ['pdf', 'jpeg', 'png', 'webp', 'avif'].filter((format) => options.some((entry) => entry.includes(format)));
      if (formats.length === 0) {
        toast(t('Diese Dateien lassen sich nicht umwandeln'));
        return;
      }
      const format = await choose({
        title: t('{count} Dateien umwandeln', { count: list.length }),
        text: t('MoeCloud legt jede neue Datei neben ihr Original. Dateien, zu denen das Format nicht passt, bleiben aus.'),
        options: formats.map((entry) => ({
          value: entry,
          label: entry === 'jpeg' ? 'JPEG' : entry.toUpperCase(),
          primary: formats.length === 1,
        })),
      });
      if (!format) return;
      toast(t('Wird umgewandelt …'));
      let done = 0;
      for (const [index, item] of list.entries()) {
        if (!options[index].includes(format)) continue;
        await api.post(`/api/nodes/${item.id}/convert`, { format });
        done++;
      }
      toast(tn(done, 'Eine Datei umgewandelt', '{count} Dateien umgewandelt'));
    } catch (error) {
      toast(errorText(error));
    }
    refresh();
  };

  const playable = (item: Item) => item.type === 'file' && item.kind === 'audio' && !item.infected && !item.trashedAt;

  const open = (item: Item) => {
    if (item.trashedAt) return;
    if (item.type === 'folder') {
      navigate(folderHref(item.id, rootId));
      return;
    }
    if (playable(item)) {
      playItems(items, item);
      return;
    }
    if (officeEditable(item, office) && canEdit(item)) {
      setOfficeEdit(item);
      return;
    }
    setViewer({ id: item.id, editing: false });
  };

  const upload = async (entries: UploadEntry[], parentId = uploadTarget) => {
    if (entries.length === 0) return;
    let conflict: 'rename' | 'replace' = 'rename';
    if (parentId === folder?.id) {
      const taken = new Set(items.map((item) => item.name.toLowerCase()));
      const clashes = entries.filter((entry) => !entry.relativePath && taken.has((entry.name ?? entry.file.name).toLowerCase()));
      if (clashes.length > 0) {
        const answer = await choose({
          title: tn(clashes.length, '„{name}“ gibt es hier schon', '{count} Dateien gibt es hier schon', { name: clashes[0].file.name }),
          text: t('Ersetzt du sie, bleibt die alte Fassung als Version erhalten.'),
          options: [
            { value: 'rename', label: t('Beide behalten') },
            { value: 'replace', label: t('Ersetzen'), primary: true },
          ],
        });
        if (!answer) return;
        conflict = answer as 'rename' | 'replace';
      }
    }
    uploader.add(entries, parentId, conflict);
  };

  const moveInto = async (target: Item | string, transfer: DataTransfer) => {
    const targetId = typeof target === 'string' ? target : target.id;
    if (hasFiles(transfer)) {
      const entries = await entriesFromDrop(transfer);
      void upload(entries, targetId);
      return;
    }
    let ids: string[] = [];
    try {
      ids = JSON.parse(transfer.getData(DRAG_TYPE) || '[]') as string[];
    } catch {
      return;
    }
    ids = ids.filter((id) => id !== targetId);
    if (ids.length === 0) return;
    const done = await attempt(() => api.post('/api/nodes/move', { ids, target: targetId }));
    if (done !== undefined) {
      toast(tn(ids.length, 'Verschoben', '{count} Elemente verschoben'));
      setSelected(new Set());
      refresh();
    }
  };

  const toggleWatch = async (target: Item) => {
    const result = await attempt(() => api.put<{ watching: boolean }>(`/api/nodes/${target.id}/watch`, { watching: !target.watching }));
    if (!result) return;
    toast(
      result.watching
        ? t('Du bekommst eine Nachricht, wenn andere in „{name}“ etwas ändern', { name: target.name })
        : t('Du beobachtest „{name}“ nicht mehr', { name: target.name })
    );
    refresh();
  };

  const actionsFor = (targets: Item[]): Action[] => {
    if (targets.length === 0) return [];
    const single = targets.length === 1 ? targets[0] : null;
    if (view.kind === 'trash') {
      return [
        {
          key: 'restore',
          label: t('Wiederherstellen'),
          icon: <RestoreFromTrashRounded />,
          onClick: () => void restoreItems(targets).then(refresh),
          primary: true,
        },
        {
          key: 'delete',
          label: t('Endgültig löschen'),
          icon: <DeleteForeverRounded />,
          onClick: () => void deleteForever(targets).then(refresh),
          danger: true,
          primary: true,
        },
      ];
    }
    const editable = targets.every((item) => canEdit(item) && !item.grantId && !item.viaGroup && item.parentId);
    const list: Action[] = [];
    if (single) {
      list.push({
        key: 'open',
        label:
          single.type === 'folder'
            ? t('Öffnen')
            : playable(single)
              ? t('Abspielen')
              : officeEditable(single, office) && canEdit(single)
                ? t('In Office bearbeiten')
                : t('Vorschau'),
        icon:
          single.type === 'folder' ? (
            <FolderOpenRounded />
          ) : playable(single) ? (
            <PlayArrowRounded />
          ) : officeEditable(single, office) && canEdit(single) ? (
            <EditNoteRounded />
          ) : (
            <VisibilityRounded />
          ),
        onClick: () => open(single),
      });
    } else if (targets.every(playable)) {
      list.push({ key: 'play', label: t('Abspielen'), icon: <PlayArrowRounded />, onClick: () => playItems(targets) });
    }
    if (targets.every(playable) && player.queue.length > 0) {
      list.push({
        key: 'enqueue',
        label: t('Zur Warteschlange hinzufügen'),
        icon: <QueueMusicRounded />,
        onClick: () => {
          const added = enqueue(targets);
          toast(
            added
              ? tn(added, 'Ein Titel kommt in die Warteschlange', '{count} Titel kommen in die Warteschlange')
              : t('Schon in der Warteschlange')
          );
        },
      });
    }
    list.push({ key: 'download', label: t('Herunterladen'), icon: <DownloadRounded />, onClick: () => download(targets), primary: true });
    if (
      single &&
      single.type === 'file' &&
      !single.infected &&
      previewType(single) === 'zip' &&
      canEdit(single) &&
      !single.grantId &&
      !single.viaGroup
    ) {
      list.push({
        key: 'extract',
        label: t('Entpacken'),
        icon: <UnarchiveRounded />,
        onClick: () =>
          void extract(single).then((done) => {
            if (!done) return;
            refresh();
            toast(done.message, { action: { label: t('Öffnen'), onClick: () => navigate(folderHref(done.result.folderId, rootId)) } });
          }),
      });
    }
    if (targets.every((item) => !item.infected)) {
      list.push({ key: 'zip', label: t('Als ZIP packen'), icon: <FolderZipRounded />, onClick: () => setPacking(targets) });
    }
    if (single && canEditImage(single)) {
      list.push({ key: 'edit-image', label: t('Bild bearbeiten'), icon: <TuneRounded />, onClick: () => setImageEdit(single) });
    }
    if (single && officeEditable(single, office)) {
      list.push(
        canEdit(single)
          ? {
              key: 'preview',
              label: t('Vorschau'),
              icon: <VisibilityRounded />,
              onClick: () => setViewer({ id: single.id, editing: false }),
            }
          : { key: 'office', label: t('In Office öffnen'), icon: <EditNoteRounded />, onClick: () => setOfficeEdit(single) }
      );
    }
    if (single && single.type === 'file' && !single.infected && (canEditImage(single) || single.office)) {
      list.push({ key: 'convert', label: t('Umwandeln'), icon: <TransformRounded />, onClick: () => void convert(single) });
    }
    if (
      !single &&
      targets.length > 1 &&
      targets.length <= 50 &&
      targets.every((item) => item.type === 'file' && !item.infected && (canEditImage(item) || item.office))
    ) {
      list.push({ key: 'convert', label: t('Umwandeln'), icon: <TransformRounded />, onClick: () => void convertMany(targets) });
    }
    if (single && canOrganizePdf(single)) {
      list.push({ key: 'pdf-pages', label: t('Seiten bearbeiten'), icon: <AutoStoriesRounded />, onClick: () => setPdfPages(single) });
    }
    if (canMakePdf(targets)) {
      list.push({ key: 'pdf-images', label: t('Als PDF speichern'), icon: <PictureAsPdfRounded />, onClick: () => setPdfImages(targets) });
    }
    if (canMergePdfs(targets)) {
      list.push({ key: 'pdf-merge', label: t('PDFs zusammenfügen'), icon: <MergeRounded />, onClick: () => setPdfMerge(targets) });
    }
    if (single && (single.role === 'owner' || single.role === 'edit') && data.share && (data.share.links || data.share.users)) {
      list.push({ key: 'share', label: t('Teilen'), icon: <ShareRounded />, onClick: () => setShare(single), primary: true });
    }
    if (single && editable) {
      list.push({
        key: 'rename',
        label: t('Umbenennen'),
        icon: <DriveFileRenameOutlineRounded />,
        onClick: () => void renameItem(single).then((done) => done && refresh()),
        divider: true,
      });
    } else if (editable) {
      list.push({
        key: 'rename',
        label: t('Umbenennen'),
        icon: <DriveFileRenameOutlineRounded />,
        onClick: () => setRenaming(targets),
        divider: true,
      });
    }
    if (editable) {
      list.push({
        key: 'move',
        label: t('Verschieben'),
        icon: <DriveFileMoveRounded />,
        onClick: () => setMove({ items: targets, mode: 'move' }),
        primary: true,
        divider: !single,
      });
    }
    list.push({
      key: 'copy',
      label: t('Kopieren'),
      icon: <ContentCopyRounded />,
      onClick: () => setMove({ items: targets, mode: 'copy' }),
      divider: !editable,
    });
    const starred = targets.every((item) => item.starred);
    list.push({
      key: 'star',
      label: starred ? t('Aus Favoriten entfernen') : t('Zu Favoriten hinzufügen'),
      icon: starred ? <StarRounded /> : <StarOutlineRounded />,
      onClick: () => void starItems(targets, !starred).then(refresh),
    });
    if (targets.every((item) => item.parentId)) {
      list.push({ key: 'tags', label: t('Schlagwörter'), icon: <SellRounded />, onClick: () => setTagging(targets) });
    }
    if (single && single.parentId) {
      list.push({
        key: 'remind',
        label: single.reminder ? t('Erinnerung ändern') : t('Erinnern'),
        icon: <AlarmRounded />,
        onClick: () => setReminding(single),
      });
    }
    if (single && single.type === 'file' && CALENDAR_FILE.test(single.name) && boot().calendarOn && featureOn('calendar')) {
      list.push({
        key: 'calendar-import',
        label: t('In Kalender importieren'),
        icon: <EventAvailableRounded />,
        onClick: () => window.location.assign(`/calendar?import=${encodeURIComponent(single.id)}`),
      });
    }
    if (single && single.type === 'file' && CONTACT_FILE.test(single.name) && boot().contactsOn && featureOn('contacts')) {
      list.push({
        key: 'contacts-import',
        label: t('In Kontakte importieren'),
        icon: <ContactsRounded />,
        onClick: () => window.location.assign(`/contacts?import=${encodeURIComponent(single.id)}`),
      });
    }
    if (single && single.parentId && canEdit(single)) {
      list.push({
        key: 'expiry',
        label: single.expiresAt ? t('Ablaufdatum ändern') : t('Ablaufdatum'),
        icon: <HourglassBottomRounded />,
        onClick: () => setExpiring(single),
      });
    }
    if (single && single.type === 'folder' && single.parentId && single.role === 'owner') {
      list.push({
        key: 'templates',
        label: t('Als Vorlagenordner verwenden'),
        icon: <PostAddRounded />,
        onClick: async () => {
          const done = await attempt(() => api.put('/api/templates', { folderId: single.id }));
          if (done) toast(t('„{name}“ ist jetzt dein Vorlagenordner. Du findest die Vorlagen unter Neu.', { name: single.name }));
        },
      });
    }
    if (single && single.type === 'file' && !single.lock && canEdit(single)) {
      list.push({ key: 'lock', label: t('Sperren'), icon: <LockRounded />, onClick: () => setLocking(single) });
    }
    if (single?.lock && (single.lock.mine || single.role === 'owner' || data.user?.role === 'admin')) {
      const lock = single.lock;
      list.push({
        key: 'unlock',
        label: t('Entsperren'),
        icon: <LockOpenRounded />,
        onClick: async () => {
          if (
            !lock.mine &&
            !(await confirm({
              title: t('Sperre von {name} lösen?', { name: lock.name }),
              text: t('{name} bekommt eine Nachricht. Danach können alle mit Bearbeitungsrechten die Datei wieder ändern.', {
                name: lock.name,
              }),
              confirm: t('Entsperren'),
            }))
          )
            return;
          const done = await attempt(() => api.delete(`/api/nodes/${single.id}/lock`));
          if (done === undefined) return;
          toast(t('„{name}“ ist entsperrt', { name: single.name }));
          refresh();
        },
      });
    }
    if (single && single.type === 'folder' && single.parentId) {
      list.push({
        key: 'watch',
        label: single.watching ? t('Nicht mehr beobachten') : t('Beobachten'),
        icon: single.watching ? <NotificationsOffRounded /> : <NotificationsActiveRounded />,
        onClick: () => void toggleWatch(single),
      });
    }
    if (single && single.type === 'folder' && single.parentId && single.role === 'owner') {
      list.push({ key: 'cleanup', label: t('Aufräumregel'), icon: <AutoDeleteRounded />, onClick: () => setCleanupFor(single) });
    }
    if (single && single.type === 'folder' && single.role === 'owner' && !single.team && !listing.data?.team && view.kind === 'folder') {
      list.push({
        key: 'rewind',
        label: t('Auf früheren Stand zurücksetzen'),
        icon: <HistoryRounded />,
        onClick: () => setRewindFor({ folder: { id: single.id, name: single.name, root: !single.parentId }, at: null }),
      });
    }
    if (single && single.type === 'folder' && (single.role === 'owner' || single.role === 'edit')) {
      list.push({ key: 'automations', label: t('Abläufe'), icon: <AutoModeRounded />, onClick: () => setAutomationsFor(single) });
    }
    if (single && single.type === 'folder' && single.parentId && single.role === 'owner' && data.user?.role === 'admin') {
      list.push({
        key: 'starter',
        label: starter === single.id ? t('Nicht mehr als Startdateien nutzen') : t('Als Startdateien für neue Konten'),
        icon: <RocketLaunchRounded />,
        onClick: () => void toggleStarter(single),
      });
    }
    if (view.kind !== 'album' && targets.every((item) => item.type === 'file' && (item.kind === 'image' || item.kind === 'video'))) {
      list.push({
        key: 'album',
        label: t('Zum Album hinzufügen'),
        icon: <AddPhotoAlternateRounded />,
        onClick: () => setAlbumPick(targets),
      });
    }
    if (targets.every((item) => playable(item) || (item.type === 'folder' && !item.trashedAt))) {
      list.push({
        key: 'playlist',
        label: t('Zur Wiedergabeliste hinzufügen'),
        icon: <PlaylistAddRounded />,
        onClick: () => setPlaylistPick(targets),
      });
    }
    if (single && single.type === 'file' && !single.trashedAt && !single.infected && /\.m3u8?$/i.test(single.name)) {
      list.push({
        key: 'm3u',
        label: t('Als Wiedergabeliste übernehmen'),
        icon: <QueueMusicRounded />,
        onClick: async () => {
          try {
            const result = await api.post<{ playlist: { id: string; name: string }; added: number; missing: number }>(
              `/api/nodes/${single.id}/playlist`
            );
            toast(
              result.missing > 0
                ? t('„{name}“ angelegt, {missing} Einträge ließen sich nicht finden', {
                    name: result.playlist.name,
                    missing: result.missing,
                  })
                : t('Wiedergabeliste „{name}“ angelegt', { name: result.playlist.name }),
              { action: { label: t('Öffnen'), onClick: () => navigate(`/files/music/playlists/${result.playlist.id}`) } }
            );
          } catch (error) {
            toast(errorText(error));
          }
        },
      });
    }
    if (editable && targets.every((item) => item.type === 'folder')) {
      list.push({
        key: 'color',
        label: t('Farbe'),
        icon: <PaletteRounded />,
        onClick: async () => {
          const value = await pickColor({
            title: single ? t('Farbe für „{name}“', { name: single.name }) : t('Farbe für {count} Ordner', { count: targets.length }),
            value: single?.color ?? null,
            options: FOLDER_COLOR_OPTIONS.map((option) => ({ key: option.key, label: t(option.label), color: folderColor(option.key) })),
          });
          if (value === undefined) return;
          const done = await attempt(() => api.put('/api/nodes/color', { ids: targets.map((item) => item.id), color: value }));
          if (done !== undefined) refresh();
        },
      });
      list.push({
        key: 'icon',
        label: t('Symbol'),
        icon: <EmojiSymbolsRounded />,
        onClick: async () => {
          const value = await pickColor({
            title: single ? t('Symbol für „{name}“', { name: single.name }) : t('Symbol für {count} Ordner', { count: targets.length }),
            value: single?.icon ?? null,
            group: t('Symbol'),
            none: { label: t('Kein Symbol'), icon: <FolderRounded /> },
            options: FOLDER_ICON_OPTIONS.map((option) => ({ key: option.key, label: t(option.label), color: '', icon: <option.Icon /> })),
          });
          if (value === undefined) return;
          const done = await attempt(() => api.put('/api/nodes/icon', { ids: targets.map((item) => item.id), icon: value }));
          if (done !== undefined) refresh();
        },
      });
    }
    list.push({
      key: 'details',
      label: t('Details'),
      icon: <InfoOutlined />,
      onClick: () => {
        setSelected(new Set(targets.map((item) => item.id)));
        if (wide) setPrefs({ details: true });
        else setDrawer(true);
      },
    });
    pluginActionsFor(targets).forEach((action, index) => {
      list.push({
        key: `plugin:${action.plugin}:${action.id}`,
        label: action.label,
        icon: pluginIcon(action.icon),
        onClick: () => void runPluginAction(action, targets).then((changed) => changed && refresh()),
        divider: index === 0,
      });
    });
    if (single?.grantId) {
      list.push({
        key: 'leave',
        label: t('Freigabe verlassen'),
        icon: <LogoutRounded />,
        onClick: () => void leaveShare(single).then((done) => done && refresh()),
        divider: true,
      });
    }
    if (editable) {
      list.push({
        key: 'trash',
        label: t('In den Papierkorb'),
        icon: <DeleteOutlineRounded />,
        onClick: () =>
          void trashItems(targets, refresh).then((done) => {
            if (!done) return;
            forget(targets.map((item) => item.id));
            setSelected(new Set());
            refresh();
          }),
        danger: true,
        divider: true,
        primary: true,
      });
    }
    return list;
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('.MuiDialog-root, .MuiMenu-root')) return;
      if (event.key === 'Escape' && selected.size) {
        setSelected(new Set());
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && items.length) {
        event.preventDefault();
        setSelected(new Set(items.map((item) => item.id)));
      } else if (event.key === 'Delete' && chosen.length) {
        const trash = actionsFor(chosen).find((action) => action.key === 'trash' || action.key === 'delete');
        trash?.onClick();
      } else if (event.key === 'F2' && chosen.length) {
        actionsFor(chosen)
          .find((action) => action.key === 'rename')
          ?.onClick();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (viewer || document.querySelector('.MuiDialog-root, .MuiMenu-root')) return;
      const entries = entriesFromPaste(event.clipboardData);
      if (entries.length === 0) return;
      event.preventDefault();
      if (readOnly) {
        toast(t('In diesem Ordner darfst du nichts hochladen'));
        return;
      }
      void upload(entries);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  });

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('zuruecksetzen');
    if (param === null || view.kind !== 'folder' || !folder || folder.id !== view.id) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('zuruecksetzen');
    navigate(url.pathname + url.search, { replace: true });
    if (role !== 'owner' || listing.data?.team) return;
    const at = Number(param);
    setRewindFor({
      folder: { id: folder.id, name: folder.name, root: !folder.parentId },
      at: Number.isSafeInteger(at) && at > 0 ? at : null,
    });
  }, [folder?.id, view.kind]);

  const sharedDone = useRef(false);
  useEffect(() => {
    registerWorker();
  }, []);
  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get('geteilt');
    if (state === null || sharedDone.current || !rootId) return;
    sharedDone.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('geteilt');
    navigate(url.pathname + url.search, { replace: true });
    if (state !== '1') {
      toast(t('Das Teilen hat nicht geklappt. Öffne MoeCloud einmal und versuch es dann noch mal.'));
      return;
    }
    void takeShared().then(async (shared) => {
      if (!shared) return;
      if (readOnly || !uploadTarget) {
        toast(t('In diesem Ordner darfst du nichts hochladen'));
        return;
      }
      if (shared.files.length > 0) {
        void upload(shared.files.map((file) => ({ file })));
        return;
      }
      const address = [shared.url, shared.text].map((value) => value.trim()).find((value) => /^https?:\/\/\S+$/i.test(value));
      try {
        if (address) {
          const file = weblinkFile(address);
          const name = shared.title.trim()
            ? `${shared.title
                .trim()
                .replace(/[\\/:*?"<>|]+/g, ' ')
                .slice(0, 80)}.url`
            : file.name;
          await api.post(`/api/nodes/${uploadTarget}/text`, { name, content: file.content });
          toast(t('Weblink gespeichert'));
          refresh();
        } else if (shared.text.trim()) {
          const created = await api.post<{ note: { id: string } }>('/api/notes', {
            title: shared.title.trim().slice(0, 200) || undefined,
            content: shared.text,
          });
          navigate(`/files/notes/${created.note.id}`);
        }
      } catch (error) {
        toast(errorText(error));
      }
    });
  }, [rootId]);

  const newMenu = useNewMenu({
    onUploadFiles: () => fileInput.current?.click(),
    onUploadFolder: () => folderInput.current?.click(),
    onNewFolder: async () => {
      const created = await createFolder(uploadTarget);
      if (created) refresh();
    },
    onNewText: async () => {
      const created = await createTextFile(uploadTarget);
      if (!created) return;
      if (uploadTarget !== folder?.id) navigate(folderHref(uploadTarget, rootId));
      refresh();
      setTimeout(() => setViewer({ id: created.id, editing: true }), 350);
    },
    onNewLink: async () => {
      const created = await createWeblink(uploadTarget);
      if (!created) return;
      if (uploadTarget !== folder?.id) navigate(folderHref(uploadTarget, rootId));
      refresh();
    },
    onTemplate: () => setTemplateFor(uploadTarget),
    onOffice:
      office.length > 0
        ? async (kind) => {
            const created = await attempt(() => api.post<{ node: Item }>(`/api/nodes/${uploadTarget}/office/new`, { kind }));
            if (!created) return;
            if (uploadTarget !== folder?.id) navigate(folderHref(uploadTarget, rootId));
            refresh();
            setOfficeEdit(created.node);
          }
        : undefined,
    onImport: data.import ? () => void importFromUrl(uploadTarget) : undefined,
    onDavImport: data.import ? () => setDavImport(uploadTarget) : undefined,
    onRecord: (mode) => setRecordMode(mode),
    onScan: typeof HTMLCanvasElement !== 'undefined' ? () => setScanning(true) : undefined,
  });

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (readOnly) {
        toast(t('In diesem Ordner darfst du nichts hochladen'));
        return;
      }
      void entriesFromDrop(event.dataTransfer).then((entries) => upload(entries));
    },
  };

  const header = (): ReactNode => {
    if (chosen.length > 0) {
      const actions = actionsFor(chosen);
      return (
        <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
          {actions
            .filter((action) => action.primary)
            .map((action) => (
              <Tooltip key={action.key} title={action.label}>
                <IconButton aria-label={action.label} onClick={action.onClick}>
                  {action.icon}
                </IconButton>
              </Tooltip>
            ))}
          <Tooltip title={t('Weitere Aktionen')}>
            <IconButton aria-label={t('Weitere Aktionen')} onClick={(event) => setMenu({ items: chosen, anchor: event.currentTarget })}>
              <MoreVertRounded />
            </IconButton>
          </Tooltip>
        </SelectionBar>
      );
    }
    const tools = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 'none' }}>
        {(view.kind === 'photos' || view.kind === 'albums') && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view.kind}
            aria-label={t('Ansicht')}
            onChange={(_event, value: string | null) => value && navigate(value === 'photos' ? '/files/photos' : '/files/photos/albums')}
          >
            <ToggleButton value="photos">{t('Zeitleiste')}</ToggleButton>
            <ToggleButton value="albums">{t('Alben')}</ToggleButton>
          </ToggleButtonGroup>
        )}
        {view.kind === 'albums' && (
          <Tooltip title={t('Neues Album')}>
            <IconButton
              aria-label={t('Neues Album')}
              onClick={() =>
                void newAlbum().then((album) => {
                  if (album) navigate(albumHref(album.id));
                })
              }
            >
              <AddRounded />
            </IconButton>
          </Tooltip>
        )}
        {(view.kind === 'recent' || view.kind === 'activity') && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view.kind}
            aria-label={t('Ansicht')}
            onChange={(_event, value: string | null) => value && navigate(value === 'recent' ? '/files/recent' : '/files/activity')}
          >
            <ToggleButton value="recent">{t('Dateien')}</ToggleButton>
            <ToggleButton value="activity">{t('Aktivität')}</ToggleButton>
          </ToggleButtonGroup>
        )}
        {view.kind === 'trash' && items.length > 0 && (
          <Button
            variant="tonal"
            color="error"
            startIcon={<DeleteForeverRounded />}
            onClick={() => void emptyTrash().then((done) => done && refresh())}
          >
            {t('Papierkorb leeren')}
          </Button>
        )}
        {view.kind === 'folder' && folder?.cleanup ? (
          <Tooltip title={tn(folder.cleanup, 'Räumt Dateien nach einem Tag auf', 'Räumt Dateien nach {count} Tagen auf')}>
            {folder.role === 'owner' ? (
              <IconButton aria-label={t('Aufräumregel')} onClick={() => setCleanupFor(folder)} sx={{ color: c.primary }}>
                <AutoDeleteRounded />
              </IconButton>
            ) : (
              <Box
                component="span"
                role="img"
                tabIndex={0}
                aria-label={tn(folder.cleanup, 'Räumt Dateien nach einem Tag auf', 'Räumt Dateien nach {count} Tagen auf')}
                sx={{ display: 'inline-flex', p: 1, color: c.primary }}
              >
                <AutoDeleteRounded />
              </Box>
            )}
          </Tooltip>
        ) : null}
        {view.kind === 'folder' && folder && role === 'owner' && !listing.data?.team && (
          <Tooltip title={t('Auf früheren Stand zurücksetzen')}>
            <IconButton
              aria-label={t('Auf früheren Stand zurücksetzen')}
              onClick={() => setRewindFor({ folder: { id: folder.id, name: folder.name, root: !folder.parentId }, at: null })}
            >
              <HistoryRounded />
            </IconButton>
          </Tooltip>
        )}
        {view.kind === 'folder' && folder?.parentId && (
          <Tooltip title={folder.watching ? t('Du beobachtest diesen Ordner') : t('Ordner beobachten')}>
            <IconButton
              aria-label={t('Ordner beobachten')}
              aria-pressed={Boolean(folder.watching)}
              onClick={() => void toggleWatch(folder)}
              sx={{ color: folder.watching ? c.primary : undefined }}
            >
              {folder.watching ? <NotificationsActiveRounded /> : <NotificationsNoneRounded />}
            </IconButton>
          </Tooltip>
        )}
        {sortable && items.filter(playable).length > 1 && (
          <Tooltip title={t('Alle abspielen')}>
            <IconButton aria-label={t('Alle abspielen')} onClick={() => playItems(items)}>
              <PlayCircleRounded />
            </IconButton>
          </Tooltip>
        )}
        {sortable && (
          <>
            <Tooltip title={t('Sortieren')}>
              <IconButton aria-label={t('Sortieren')} aria-haspopup="menu" onClick={(event) => setSortAnchor(event.currentTarget)}>
                <SortRounded />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
              {(
                [
                  ['name', t('Name')],
                  ['modified', t('Geändert')],
                  ['size', t('Größe')],
                ] as [Prefs['sort'], string][]
              ).map(([value, label]) => (
                <MenuItem
                  key={value}
                  selected={prefs.sort === value}
                  onClick={() => {
                    setPrefs({
                      sort: value,
                      order:
                        prefs.sort === value && prefs.order === 'asc'
                          ? 'desc'
                          : prefs.sort === value
                            ? 'asc'
                            : value === 'name'
                              ? 'asc'
                              : 'desc',
                    });
                    setSortAnchor(null);
                  }}
                >
                  <ListItemIcon>{prefs.sort === value ? <CheckRounded /> : null}</ListItemIcon>
                  <ListItemText>{label}</ListItemText>
                  {prefs.sort === value && (
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant, ml: 2 }}>
                      {prefs.order === 'asc' ? t('aufsteigend') : t('absteigend')}
                    </Typography>
                  )}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
        {view.kind !== 'shared' && view.kind !== 'album' && !special && (
          <Tooltip title={prefs.view === 'list' ? t('Kacheln') : t('Liste')}>
            <IconButton
              aria-label={prefs.view === 'list' ? t('Als Kacheln zeigen') : t('Als Liste zeigen')}
              onClick={() => setPrefs({ view: prefs.view === 'list' ? 'grid' : 'list' })}
            >
              {prefs.view === 'list' ? <GridViewRounded /> : <ViewListRounded />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={prefs.details && wide ? t('Details ausblenden') : t('Details zeigen')}>
          <IconButton
            aria-label={prefs.details && wide ? t('Details ausblenden') : t('Details zeigen')}
            aria-pressed={prefs.details && wide}
            onClick={() => (wide ? setPrefs({ details: !prefs.details }) : setDrawer(true))}
            sx={{ display: view.kind === 'shared' || view.kind === 'album' || special ? 'none' : 'inline-flex' }}
          >
            {prefs.details && wide ? <InfoRounded /> : <InfoOutlined />}
          </IconButton>
        </Tooltip>
      </Box>
    );
    if (view.kind === 'folder' && listing.data?.breadcrumbs) {
      return (
        <Breadcrumbs
          crumbs={listing.data.breadcrumbs}
          rootLabel={t('Meine Dateien')}
          hrefOf={(id) => folderHref(id, rootId)}
          onNavigate={(id) => navigate(folderHref(id, rootId))}
          onDrop={role !== 'view' ? (id, transfer) => void moveInto(id, transfer) : undefined}
          actions={tools}
        />
      );
    }
    if (view.kind === 'album' && listing.data?.album) {
      const album = listing.data.album;
      return (
        <PageTitle
          actions={
            <Later>
              <AlbumMenu album={album} onChanged={refresh} />
            </Later>
          }
        >
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Tooltip title={t('Alle Alben')}>
              <IconButton
                aria-label={t('Alle Alben')}
                href="/files/photos/albums"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/files/photos/albums');
                }}
                sx={{ ml: -1 }}
              >
                <ArrowBackRounded />
              </IconButton>
            </Tooltip>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {album.name}
            </Box>
          </Box>
        </PageTitle>
      );
    }
    if (view.kind === 'tag' && listing.data?.tag) {
      const tag = listing.data.tag;
      return (
        <PageTitle
          actions={
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {tools}
              <Later>
                <TagMenu tag={{ ...tag, count: items.length }} onDeleted={() => navigate('/files/tags')} />
              </Later>
            </Box>
          }
        >
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box component="span" sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: folderColor(tag.color), flex: 'none' }} />
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tag.name}
            </Box>
          </Box>
        </PageTitle>
      );
    }
    return <PageTitle actions={tools}>{view.kind === 'folder' ? t('Meine Dateien') : titleOf(view)}</PageTitle>;
  };

  const empty = (): ReactNode => {
    switch (view.kind) {
      case 'recent':
        return (
          <EmptyState
            icon={<ScheduleRounded />}
            title={t('Noch keine Dateien')}
            text={t('Was du hochlädst oder änderst, erscheint hier.')}
          />
        );
      case 'starred':
        return (
          <EmptyState
            icon={<StarRounded />}
            title={t('Noch keine Favoriten')}
            text={t('Markiere Dateien mit dem Stern, dann findest du sie hier schnell wieder.')}
          />
        );
      case 'tag':
        return (
          <EmptyState
            icon={<SellRounded />}
            title={t('Nichts mit diesem Schlagwort')}
            text={t('Gib Dateien und Ordnern dieses Schlagwort über das Menü oder die Details.')}
          />
        );
      case 'trash':
        return (
          <EmptyState
            icon={<DeleteOutlineRounded />}
            title={t('Der Papierkorb ist leer')}
            text={t('Was du löschst, landet zuerst hier.')}
          />
        );
      case 'search':
        return searchQuery(view) ? (
          <EmptyState
            icon={<SearchRounded />}
            title={t('Nichts gefunden')}
            text={t('Probier einen anderen Suchbegriff oder einen anderen Filter.')}
          />
        ) : (
          <EmptyState
            icon={<SearchRounded />}
            title={t('Wonach suchst du?')}
            text={t('Tipp oben einen Namen ein oder wähl einen Filter.')}
          />
        );
      default:
        return role === 'view' ? (
          <EmptyState icon={<FolderOpenRounded />} title={t('Dieser Ordner ist leer')} />
        ) : (
          <EmptyState
            icon={<CloudUploadRounded />}
            title={t('Hier ist noch nichts')}
            text={t('Zieh Dateien hierher oder lade sie über „Neu“ hoch.')}
            action={
              <Button variant="contained" startIcon={<UploadRounded />} onClick={() => fileInput.current?.click()}>
                {t('Dateien hochladen')}
              </Button>
            }
          />
        );
    }
  };

  const itemsView = (list: Item[], label: string, column?: 'modified' | 'location' | 'owner' | 'trashed') => (
    <Items
      items={list}
      layout={prefs.view}
      selected={selected}
      onSelect={setSelected}
      onOpen={open}
      onMenu={(item, anchor) => setMenu({ items: selected.has(item.id) ? chosen : [item], anchor })}
      onStar={view.kind !== 'trash' ? (item) => void starItems([item], !item.starred).then(refresh) : undefined}
      onDropOnFolder={(target, transfer) => void moveInto(target, transfer)}
      draggable={view.kind === 'folder' && role !== 'view'}
      column={column}
      sort={sortable ? prefs.sort : undefined}
      order={prefs.order}
      onSort={
        sortable
          ? (value) =>
              setPrefs({
                sort: value,
                order: prefs.sort === value ? (prefs.order === 'asc' ? 'desc' : 'asc') : value === 'name' ? 'asc' : 'desc',
              })
          : undefined
      }
      label={label}
    />
  );

  const readme = view.kind === 'folder' ? readmeOf(items) : null;

  const content = (): ReactNode => {
    if (view.kind === 'photos') {
      return (
        <Photos
          actions={(item) => actionsFor([item]).filter((action) => ['share', 'trash', 'edit-image'].includes(action.key))}
          onChanged={refresh}
        />
      );
    }
    if (view.kind === 'home') return <HomeView onOpen={open} onReveal={(item) => reveal(item)} />;
    if (view.kind === 'teams') return <TeamsView />;
    if (view.kind === 'activity') return <ActivityView onOpen={openActivity} />;
    if (view.kind === 'tags') return <TagsView />;
    if (view.kind === 'albums') return <AlbumList />;
    if (view.kind === 'storage') return <StorageView onReveal={(item) => reveal(item)} />;
    if (view.kind === 'notes') return <NotesView id={view.id} />;
    if (view.kind === 'forms') return <FormsView id={view.id} />;
    if (view.kind === 'music') return <MusicView tab={view.tab} id={view.id} name={view.name} />;
    if (view.kind === 'plugin') return <PluginPageView plugin={view.plugin} page={view.page} />;
    if (listing.error) {
      return (
        <EmptyState
          icon={<ErrorOutlineRounded />}
          title={t('Das hat nicht geklappt')}
          text={listing.error}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="tonal" onClick={() => listing.reload()}>
                {t('Nochmal versuchen')}
              </Button>
              <Button onClick={() => navigate('/files')}>{t('Zu meinen Dateien')}</Button>
            </Box>
          }
        />
      );
    }
    if (listing.loading || !listing.data) return <LoadingRows />;
    if (view.kind === 'album' && listing.data.album) return <AlbumContent album={listing.data.album} items={items} onChanged={refresh} />;
    if (view.kind === 'shared') {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, px: { xs: 1.5, md: 3 }, pb: 4 }}>
          <Box component="section" aria-labelledby="shared-with-me">
            <Typography id="shared-with-me" variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1, px: { md: 1 } }}>
              {t('Mit dir geteilt')}
            </Typography>
            {items.length ? (
              itemsView(items, t('Mit dir geteilt'), 'owner')
            ) : (
              <EmptyState
                compact
                icon={<PeopleRounded />}
                title={t('Noch nichts mit dir geteilt')}
                text={t('Teilt jemand etwas mit dir, erscheint es hier.')}
              />
            )}
          </Box>
          <Box component="section" aria-labelledby="shared-by-me">
            <Typography id="shared-by-me" variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 1.5, px: { md: 1 } }}>
              {t('Von dir geteilt')}
            </Typography>
            <SharedByMe
              links={listing.data.links ?? []}
              grants={listing.data.grants ?? []}
              onManage={setShare}
              onOpen={(item) => (item.type === 'folder' ? navigate(folderHref(item.id, rootId)) : setShare(item))}
            />
          </Box>
        </Box>
      );
    }
    return (
      <>
        {view.kind === 'search' && (
          <Later>
            <SearchFilters view={view} />
          </Later>
        )}
        {view.kind === 'folder' && view.id === rootId && (
          <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, px: 1.5, pb: 1.5, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {[
              { href: '/files/recent', label: t('Zuletzt'), icon: <ScheduleRounded /> },
              ...((data.teams ?? 0) > 0 ? [{ href: '/files/teams', label: t('Teamordner'), icon: <FolderSharedRounded /> }] : []),
              { href: '/files/notes', label: t('Notizen'), icon: <StickyNote2Rounded /> },
              { href: '/files/music', label: t('Musik'), icon: <LibraryMusicRounded /> },
              { href: '/files/starred', label: t('Favoriten'), icon: <StarRounded /> },
              { href: '/files/tags', label: t('Schlagwörter'), icon: <SellRounded /> },
              { href: '/files/activity', label: t('Aktivität'), icon: <HistoryRounded /> },
              { href: '/files/storage', label: t('Speicher'), icon: <DataUsageRounded /> },
              { href: '/files/trash', label: t('Papierkorb'), icon: <DeleteOutlineRounded /> },
              ...pluginPages().map((page) => ({ href: pluginPageHref(page), label: page.label, icon: pluginIcon(page.icon) })),
            ].map((chip) => (
              <Chip
                key={chip.href}
                icon={chip.icon}
                label={chip.label}
                variant="outlined"
                onClick={() => navigate(chip.href)}
                sx={{ flex: 'none' }}
              />
            ))}
          </Box>
        )}
        {view.kind === 'folder' && listing.data.team && (
          <Later>
            <TeamBar info={listing.data.team} />
          </Later>
        )}
        {readme && <FolderReadme item={readme} onOpen={() => open(readme)} />}
        {view.kind === 'trash' && items.length > 0 && (
          <Alert severity="info" sx={{ mx: { xs: 1.5, md: 2 }, mb: 1.5 }}>
            {tn(
              listing.data.trashDays ?? data.trashDays,
              'Elemente im Papierkorb werden nach {count} Tag endgültig gelöscht.',
              'Elemente im Papierkorb werden nach {count} Tagen endgültig gelöscht.'
            )}
          </Alert>
        )}
        {items.length === 0
          ? empty()
          : itemsView(
              items,
              view.kind === 'folder' ? t('Dateien und Ordner') : titleOf(view),
              view.kind === 'trash'
                ? 'trashed'
                : view.kind === 'recent' || view.kind === 'search' || view.kind === 'tag'
                  ? 'location'
                  : 'modified'
            )}
      </>
    );
  };

  const showAside = wide && prefs.details && view.kind !== 'shared' && view.kind !== 'album' && !special;
  const location =
    view.kind === 'folder' ? (listing.data?.breadcrumbs?.map((crumb) => crumb.name || t('Meine Dateien')).join(' › ') ?? '') : undefined;
  const details = (
    <Details
      items={chosen}
      location={location}
      tab={detailsTab}
      onTab={setDetailsTab}
      onShare={setShare}
      onTags={(item) => setTagging([item])}
      onChanged={refresh}
      onUploadVersion={(item) => {
        versionTarget.current = item;
        versionInput.current?.click();
      }}
      onClose={showAside ? () => setPrefs({ details: false }) : () => setDrawer(false)}
    />
  );

  return (
    <>
      <AppShell
        active={destinationOf(view, Boolean(listing.data?.team))}
        storage={storage}
        onNavigate={(href) => {
          if (!href.startsWith('/files')) return false;
          navigate(href);
          return true;
        }}
        railAction={guestOutside ? undefined : newMenu.rail}
        mobileAction={guestOutside ? undefined : newMenu.mobile}
        topBar={
          <>
            <SearchBar
              key={view.kind === 'search' ? 'search' : 'browse'}
              initial={view.kind === 'search' ? view.q : ''}
              active={view.kind === 'search'}
            />
          </>
        }
        aside={
          showAside ? (
            <Box
              component="aside"
              aria-label={t('Details')}
              sx={{ width: 340, flex: 'none', bgcolor: c.surfaceContainerLow, borderRadius: `${radius.lg}px`, overflow: 'hidden' }}
            >
              {details}
            </Box>
          ) : null
        }
      >
        <Box {...dropHandlers} sx={{ minHeight: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <Box
            sx={{
              position: 'sticky',
              top: { xs: 64, md: 0 },
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 64,
              px: { xs: 1, md: 2 },
              py: 1,
              bgcolor: { xs: c.surface, md: c.surfaceContainerLow },
            }}
          >
            {header()}
          </Box>
          <Box
            sx={{
              flex: 1,
              ...(view.kind === 'plugin' || view.kind === 'notes' ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : {}),
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget && selected.size) setSelected(new Set());
            }}
          >
            <Suspense fallback={<LoadingRows />}>{content()}</Suspense>
          </Box>
          <DropOverlay
            active={dragging}
            label={
              folder && view.kind === 'folder'
                ? t('Loslassen, um in „{name}“ hochzuladen', { name: folder.name || t('Meine Dateien') })
                : t('Loslassen, um hochzuladen')
            }
          />
        </Box>
      </AppShell>
      {playing && (
        <Later>
          <MiniPlayer />
        </Later>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const list = event.target.files;
          if (list?.length) void upload(entriesFromInput(list));
          event.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(event) => {
          const list = event.target.files;
          if (list?.length) void upload(entriesFromInput(list));
          event.target.value = '';
        }}
      />
      <input
        ref={versionInput}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          const target = versionTarget.current;
          if (file && target?.parentId) uploader.add([{ file, name: target.name }], target.parentId, 'replace');
          event.target.value = '';
        }}
      />

      <UploadPanel uploader={uploader} />
      <ActionMenu anchor={menu?.anchor ?? null} actions={menu ? actionsFor(menu.items) : []} onClose={() => setMenu(null)} />
      {viewing && (
        <Later>
          <Viewer
            items={files}
            index={viewerIndex >= 0 ? viewerIndex : null}
            editing={viewer?.editing ?? false}
            onIndex={(index) => setViewer(index === null ? null : { id: files[index].id, editing: false })}
            actions={(item) => actionsFor([item]).filter((action) => action.key === 'share' || action.key === 'trash')}
            onSaved={() => refresh()}
          />
        </Later>
      )}
      {sharing && (
        <Later>
          <ShareDialog item={share} onClose={() => setShare(null)} onChanged={refresh} />
        </Later>
      )}
      {tagging && (
        <Later>
          <TagDialog items={tagging} onClose={() => setTagging(null)} onDone={refresh} />
        </Later>
      )}
      {pdfPages && (
        <Later>
          <PdfPagesDialog item={pdfPages} onClose={() => setPdfPages(null)} onDone={() => refresh()} />
        </Later>
      )}
      {pdfMerge && (
        <Later>
          <PdfMergeDialog items={pdfMerge} onClose={() => setPdfMerge(null)} onDone={() => refresh()} />
        </Later>
      )}
      {pdfImages && (
        <Later>
          <PdfMergeDialog images items={pdfImages} onClose={() => setPdfImages(null)} onDone={() => refresh()} />
        </Later>
      )}
      {renaming && (
        <Later>
          <RenameManyDialog
            items={renaming}
            siblings={view.kind === 'folder' ? items : []}
            suggestion={view.kind === 'folder' && folder?.parentId ? folder.name : ''}
            onClose={() => setRenaming(null)}
            onDone={() => {
              setSelected(new Set());
              refresh();
            }}
          />
        </Later>
      )}
      {packing && (
        <Later>
          <PackDialog items={packing} onClose={() => setPacking(null)} onDone={() => refresh()} />
        </Later>
      )}
      {automationsFor && (
        <Later>
          <AutomationsDialog folder={automationsFor} onClose={() => setAutomationsFor(null)} />
        </Later>
      )}
      {recordMode && (
        <Later>
          <RecordDialog mode={recordMode} onClose={() => setRecordMode(null)} onSave={(file) => void upload([{ file }], uploadTarget)} />
        </Later>
      )}
      {scanning && (
        <Later>
          <ScanDialog onClose={() => setScanning(false)} onSave={(file) => void upload([{ file }], uploadTarget)} />
        </Later>
      )}
      {rewindFor && (
        <Later>
          <RewindDialog folder={rewindFor.folder} initial={rewindFor.at} onClose={() => setRewindFor(null)} onDone={() => refresh()} />
        </Later>
      )}
      {cleanupFor && (
        <Later>
          <CleanupDialog item={cleanupFor} trashDays={data.trashDays} onClose={() => setCleanupFor(null)} onDone={() => refresh()} />
        </Later>
      )}
      {locking && (
        <Later>
          <LockDialog item={locking} onClose={() => setLocking(null)} onDone={() => refresh()} />
        </Later>
      )}
      {reminding && (
        <Later>
          <ReminderDialog item={reminding} onClose={() => setReminding(null)} onDone={() => refresh()} />
        </Later>
      )}
      {expiring && (
        <Later>
          <ExpiryDialog item={expiring} onClose={() => setExpiring(null)} onDone={() => refresh()} />
        </Later>
      )}
      {templateFor && (
        <Later>
          <TemplateDialog
            parentId={templateFor}
            onClose={() => setTemplateFor(null)}
            onDone={(node) => {
              if (templateFor !== folder?.id) navigate(folderHref(templateFor, rootId));
              refresh();
              if (previewType(node) === 'text') setTimeout(() => setViewer({ id: node.id, editing: true }), 350);
            }}
          />
        </Later>
      )}
      {davImport && (
        <Later>
          <DavImportDialog
            parentId={davImport}
            onClose={() => setDavImport(null)}
            onOpenFolder={(id) => navigate(folderHref(id, rootId))}
            onChanged={() => refresh()}
          />
        </Later>
      )}
      {imageEdit && (
        <Later>
          <ImageEditor item={imageEdit} onClose={() => setImageEdit(null)} onSaved={() => refresh()} />
        </Later>
      )}
      {officeEdit && (
        <OfficeEditor
          item={officeEdit}
          onClose={(changed) => {
            setOfficeEdit(null);
            if (changed) refresh();
          }}
        />
      )}
      {albumPick && (
        <Later>
          <AlbumPicker items={albumPick} onClose={() => setAlbumPick(null)} onDone={() => setSelected(new Set())} />
        </Later>
      )}
      {playlistPick && (
        <Later>
          <PlaylistPicker items={playlistPick} onClose={() => setPlaylistPick(null)} onDone={() => setSelected(new Set())} />
        </Later>
      )}
      <MoveDialog
        request={move}
        startId={view.kind === 'folder' ? view.id : undefined}
        onClose={() => setMove(null)}
        onDone={() => {
          setSelected(new Set());
          refresh();
        }}
      />
      <Drawer
        anchor={theme.breakpoints.values.md <= window.innerWidth ? 'right' : 'bottom'}
        open={drawer && !showAside}
        onClose={() => setDrawer(false)}
        slotProps={{
          paper: {
            sx: {
              width: { md: 380 },
              maxHeight: { xs: '85dvh', md: '100%' },
              borderTopLeftRadius: { xs: radius.xl, md: radius.lg },
              borderTopRightRadius: { xs: radius.xl, md: 0 },
              borderBottomLeftRadius: { md: radius.lg },
            },
          },
        }}
      >
        {details}
      </Drawer>
    </>
  );
}
