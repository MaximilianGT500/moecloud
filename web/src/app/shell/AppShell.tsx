import { Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BookmarksOutlined from '@mui/icons-material/BookmarksOutlined';
import BookmarksRounded from '@mui/icons-material/BookmarksRounded';
import CodeOutlined from '@mui/icons-material/CodeOutlined';
import CodeRounded from '@mui/icons-material/CodeRounded';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import ForumRounded from '@mui/icons-material/ForumRounded';
import MailOutlined from '@mui/icons-material/MailOutlined';
import MailRounded from '@mui/icons-material/MailRounded';
import RssFeedOutlined from '@mui/icons-material/RssFeedOutlined';
import RssFeedRounded from '@mui/icons-material/RssFeedRounded';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import ContactsOutlined from '@mui/icons-material/ContactsOutlined';
import ContactsRounded from '@mui/icons-material/ContactsRounded';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import FolderRounded from '@mui/icons-material/FolderRounded';
import FolderSharedOutlined from '@mui/icons-material/FolderSharedOutlined';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import HowToVoteOutlined from '@mui/icons-material/HowToVoteOutlined';
import HowToVoteRounded from '@mui/icons-material/HowToVoteRounded';
import HomeRounded from '@mui/icons-material/HomeRounded';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import StickyNote2Outlined from '@mui/icons-material/StickyNote2Outlined';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import AssignmentRounded from '@mui/icons-material/AssignmentRounded';
import LibraryMusicOutlined from '@mui/icons-material/LibraryMusicOutlined';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import SellRounded from '@mui/icons-material/SellRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import PeopleOutlined from '@mui/icons-material/PeopleOutlined';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import AccountCircleRounded from '@mui/icons-material/AccountCircleRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import KeyboardRounded from '@mui/icons-material/KeyboardRounded';
import ManageSearchRounded from '@mui/icons-material/ManageSearchRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { BrandMark, SkipLink, StorageMeter, UserAvatar } from '../common/bits';
import { lazyNamed } from '../common/lazy';
import { pluginIcon, pluginPageHref, pluginPageKey, usePlugins } from '../common/plugins';
import { ShortcutsDialog } from '../common/Shortcuts';
import { ThemeModeSelector, ThemeToggleButton } from '../common/ThemeToggle';
import { api, logout } from '../../lib/api';
import { boot, type PluginPage, type SessionUser, type Storage } from '../../lib/boot';
import { arrange, BAR_SLOTS } from '../common/Arrange';
import { language, t } from '../../lib/i18n';
import { c, curve, mix, radius } from '../../theme/tokens';
import { NotificationBell } from './Notifications';
import { SiteNotice } from './SiteNotice';
import { featureOn, shownByFeature, useFeatures } from '../../lib/features';
import { setBadges, useBadges, type Badges } from '../../lib/badges';
import { useLive } from '../../lib/live';
import { usePrefs } from '../../lib/prefs';
import { STATUS_COLORS, StatusDialog, statusLine, type Status } from '../common/status';

export const RAIL = 88;

const CommandPalette = lazyNamed(() => import('./CommandPalette'), 'CommandPalette');
const WelcomeDialog = lazyNamed(() => import('./Welcome'), 'WelcomeDialog');

let welcomed = false;

function useWelcome() {
  const [open, setOpen] = useState(() => Boolean(boot().welcome) && !welcomed && !boot().setup2fa);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('moe:welcome', show);
    return () => window.removeEventListener('moe:welcome', show);
  }, []);
  return {
    open,
    close: () => {
      welcomed = true;
      setOpen(false);
    },
  };
}

export type Destination =
  | 'home'
  | 'teams'
  | 'files'
  | 'photos'
  | 'recent'
  | 'notes'
  | 'forms'
  | 'music'
  | 'starred'
  | 'tags'
  | 'shared'
  | 'trash'
  | 'storage'
  | 'admin'
  | 'account'
  | 'calendar'
  | 'tasks'
  | 'booking'
  | 'polls'
  | 'contacts'
  | 'mail'
  | 'chat'
  | 'bookmarks'
  | 'feeds'
  | 'snippets'
  | `plugin:${string}`;

interface NavItem {
  key: Destination;
  href: string;
  label: string;
  icon: ReactNode;
  activeIcon: ReactNode;
  badge?: keyof Badges;
}

const HOME: NavItem = { key: 'home', href: '/files/home', label: t('Start'), icon: <HomeOutlined />, activeIcon: <HomeRounded /> };
const TEAMS: NavItem = {
  key: 'teams',
  href: '/files/teams',
  label: t('Teamordner'),
  icon: <FolderSharedOutlined />,
  activeIcon: <FolderSharedRounded />,
};

export const NAV_LOCKED = ['files', 'admin'];
export const DEFAULT_BAR = ['home', 'files', 'photos', 'shared'];

export const navEntries = (user: SessionUser, pages: PluginPage[]) =>
  allItems(user, pages).map((item) => ({
    key: item.key as string,
    label: item.label,
    icon: item.icon,
    locked: NAV_LOCKED.includes(item.key),
    bar: item.key !== 'admin',
  }));

const railItems = (user: SessionUser, pages: PluginPage[]) => arrange(allItems(user, pages), boot().nav, NAV_LOCKED);

function allItems(user: SessionUser, pages: PluginPage[]): NavItem[] {
  if (boot().setup2fa) return [];
  const guest = user.role === 'guest';
  const teams = guest || (boot().teams ?? 0) > 0;
  const own: NavItem[] = guest
    ? []
    : [
        { key: 'files', href: '/files', label: t('Dateien'), icon: <FolderOutlined />, activeIcon: <FolderRounded /> },
        { key: 'photos', href: '/files/photos', label: t('Fotos'), icon: <PhotoLibraryOutlined />, activeIcon: <PhotoLibraryRounded /> },
        { key: 'recent', href: '/files/recent', label: t('Zuletzt'), icon: <ScheduleOutlined />, activeIcon: <ScheduleRounded /> },
      ];
  const calendar = boot().calendarOn;
  const planning: NavItem[] = calendar
    ? [
        { key: 'calendar', href: '/calendar', label: t('Kalender'), icon: <CalendarMonthOutlined />, activeIcon: <CalendarMonthRounded /> },
        { key: 'tasks', href: '/calendar/tasks', label: t('Aufgaben'), icon: <TaskAltOutlined />, activeIcon: <TaskAltRounded /> },
      ]
    : [];
  const people: NavItem[] = guest
    ? []
    : [
        ...(boot().contactsOn
          ? [
              {
                key: 'contacts' as const,
                href: '/contacts',
                label: t('Kontakte'),
                icon: <ContactsOutlined />,
                activeIcon: <ContactsRounded />,
              },
            ]
          : []),
        { key: 'mail', href: '/mail', label: t('E-Mail'), icon: <MailOutlined />, activeIcon: <MailRounded />, badge: 'mail' },
        { key: 'chat', href: '/chat', label: t('Chat'), icon: <ForumOutlined />, activeIcon: <ForumRounded />, badge: 'chat' },
      ];
  const scheduling: NavItem[] = [
    ...(calendar?.booking
      ? [
          {
            key: 'booking' as const,
            href: '/calendar/booking',
            label: t('Buchungsseiten'),
            icon: <EventAvailableOutlined />,
            activeIcon: <EventAvailableRounded />,
          },
        ]
      : []),
    ...(calendar?.polls
      ? [
          {
            key: 'polls' as const,
            href: '/calendar/polls',
            label: t('Umfragen'),
            icon: <HowToVoteOutlined />,
            activeIcon: <HowToVoteRounded />,
          },
        ]
      : []),
  ];
  const extra: NavItem[] = guest
    ? []
    : [
        {
          key: 'notes',
          href: '/files/notes',
          label: t('Notizen'),
          icon: <StickyNote2Outlined />,
          activeIcon: <StickyNote2Rounded />,
        },
        {
          key: 'music',
          href: '/files/music',
          label: t('Musik'),
          icon: <LibraryMusicOutlined />,
          activeIcon: <LibraryMusicRounded />,
        },
        ...scheduling,
        ...(boot().forms
          ? [
              {
                key: 'forms' as const,
                href: '/files/forms',
                label: t('Formulare'),
                icon: <AssignmentOutlined />,
                activeIcon: <AssignmentRounded />,
              },
            ]
          : []),
        { key: 'bookmarks', href: '/bookmarks', label: t('Lesezeichen'), icon: <BookmarksOutlined />, activeIcon: <BookmarksRounded /> },
        { key: 'feeds', href: '/feeds', label: t('Feeds'), icon: <RssFeedOutlined />, activeIcon: <RssFeedRounded />, badge: 'feeds' },
        { key: 'snippets', href: '/snippets', label: t('Schnipsel'), icon: <CodeOutlined />, activeIcon: <CodeRounded /> },
      ];
  const items: NavItem[] = [
    HOME,
    ...own,
    ...planning,
    ...people,
    ...(teams ? [TEAMS] : []),
    { key: 'starred', href: '/files/starred', label: t('Favoriten'), icon: <StarOutlineRounded />, activeIcon: <StarRounded /> },
    { key: 'tags', href: '/files/tags', label: t('Schlagwörter'), icon: <SellOutlined />, activeIcon: <SellRounded /> },
    { key: 'shared', href: '/files/shared', label: t('Geteilt'), icon: <PeopleOutlined />, activeIcon: <PeopleRounded /> },
    ...extra,
    ...(guest
      ? []
      : [{ key: 'trash' as const, href: '/files/trash', label: t('Papierkorb'), icon: <DeleteOutlined />, activeIcon: <DeleteRounded /> }]),
    ...pages.map((page) => ({
      key: pluginPageKey(page),
      href: pluginPageHref(page),
      label: page.label,
      icon: pluginIcon(page.icon, true),
      activeIcon: pluginIcon(page.icon),
    })),
    ...(user.role === 'admin'
      ? [
          {
            key: 'admin' as const,
            href: '/admin',
            label: t('Admin'),
            icon: <AdminPanelSettingsOutlined />,
            activeIcon: <AdminPanelSettingsRounded />,
          },
        ]
      : []),
  ];
  return items.filter((item) => shownByFeature(item.key));
}

const RAIL_GAP = 10;
const RAIL_TIGHT = 4;

const countOf = (item: NavItem, badges: Badges) => (item.badge ? badges[item.badge] : 0);

function MenuCount({ value }: { value: number }) {
  if (!value) return null;
  return (
    <Box
      component="span"
      sx={{
        ml: 'auto',
        pl: 2,
        fontSize: '0.75rem',
        fontWeight: 700,
        color: c.primary,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value > 99 ? '99+' : value}
    </Box>
  );
}

function RailItems({
  items,
  active,
  badges,
  onNavigate,
}: {
  items: NavItem[];
  active: Destination;
  badges: Badges;
  onNavigate?: (href: string) => boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ room: items.length, gap: RAIL_GAP });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const count = items.length;

  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => {
      const first = box.firstElementChild?.getBoundingClientRect().height ?? 0;
      if (first <= 0) return;
      const space = box.clientHeight - 8;
      const gap = count * (first + RAIL_GAP) - RAIL_GAP <= space ? RAIL_GAP : RAIL_TIGHT;
      const room = Math.max(2, Math.floor((space + gap) / (first + gap)));
      setLayout((old) => (old.room === room && old.gap === gap ? old : { room, gap }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, count]);

  const { room, gap } = layout;
  const fits = items.length <= room;
  const shown = fits ? items : items.slice(0, room - 1);
  const rest = fits ? [] : items.slice(room - 1);
  const current = rest.find((item) => item.key === active);
  if (current && shown.length > 0) {
    rest.splice(rest.indexOf(current), 1, shown[shown.length - 1]);
    shown[shown.length - 1] = current;
  }
  const go = (event: MouseEvent, href: string) => {
    setAnchor(null);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (onNavigate?.(href)) event.preventDefault();
  };

  return (
    <Box
      ref={setBox}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: `${gap}px`,
        py: 0.5,
        width: '100%',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {shown.map((item) => (
        <NavButton key={item.key} item={item} active={item.key === active} count={countOf(item, badges)} onNavigate={onNavigate} />
      ))}
      {rest.length > 0 && (
        <>
          <ButtonBase
            aria-label={t('Mehr Bereiche')}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
            sx={{
              flexDirection: 'column',
              gap: 0.5,
              width: 84,
              flex: 'none',
              py: 0.5,
              borderRadius: `${radius.md}px`,
              color: c.onSurfaceVariant,
              '&:hover .nav-pill': { bgcolor: mix(c.onSurface, 8) },
              '& .MuiTouchRipple-root': { display: 'none' },
              '&.Mui-focusVisible .nav-pill': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
            }}
          >
            <Box
              className="nav-pill"
              sx={{
                width: 56,
                height: 32,
                borderRadius: `${radius.full}px`,
                display: 'grid',
                placeItems: 'center',
                '& svg': { fontSize: 24 },
              }}
            >
              <MoreHorizRounded />
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 500 }}>
              {t('Mehr')}
            </Typography>
          </ButtonBase>
          <Menu
            anchorEl={anchor}
            open={Boolean(anchor)}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
            transformOrigin={{ vertical: 'center', horizontal: 'left' }}
          >
            {rest.map((item) => (
              <MenuItem key={item.key} component="a" href={item.href} onClick={(event: MouseEvent) => go(event, item.href)}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                {item.label}
                <MenuCount value={countOf(item, badges)} />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
}

const TOP_GAP = 4;

function TopItem({
  item,
  active,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  onNavigate?: (href: string) => boolean;
}) {
  return (
    <ButtonBase
      component="a"
      href={item.href}
      nativeButton={false}
      aria-current={active ? 'page' : undefined}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (onNavigate?.(item.href)) event.preventDefault();
      }}
      sx={{
        flex: 'none',
        height: 40,
        px: 1.75,
        gap: 1,
        borderRadius: `${radius.full}px`,
        fontSize: '0.875rem',
        fontWeight: active ? 700 : 500,
        whiteSpace: 'nowrap',
        color: active ? c.onSecondaryContainer : c.onSurfaceVariant,
        bgcolor: active ? c.secondaryContainer : 'transparent',
        transition: `background-color 160ms ${curve.standard}`,
        '&:hover': {
          bgcolor: active ? `color-mix(in srgb, ${c.onSecondaryContainer} 8%, ${c.secondaryContainer})` : mix(c.onSurface, 8),
        },
        '& svg': { fontSize: 20 },
        '& .MuiTouchRipple-root': { display: 'none' },
        '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
      }}
    >
      <Badge
        badgeContent={count}
        color="error"
        max={99}
        overlap="circular"
        sx={{ '& .MuiBadge-badge': { fontSize: '0.625rem', height: 16, minWidth: 16 } }}
      >
        {active ? item.activeIcon : item.icon}
      </Badge>
      {item.label}
    </ButtonBase>
  );
}

function TopItems({
  items,
  active,
  badges,
  onNavigate,
}: {
  items: NavItem[];
  active: Destination;
  badges: Badges;
  onNavigate?: (href: string) => boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(items.length);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const signature = items.map((item) => item.key).join(' ');

  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => {
      const children = [...(ghost.current?.children ?? [])] as HTMLElement[];
      if (!children.length) return;
      const sizes = children.map((child) => child.offsetWidth);
      const more = sizes.pop() ?? 96;
      const space = box.clientWidth;
      const total = sizes.reduce((sum, size) => sum + size, 0) + TOP_GAP * Math.max(0, sizes.length - 1);
      let next = sizes.length;
      if (total > space) {
        let used = more;
        next = 0;
        for (const size of sizes) {
          if (used + size + TOP_GAP > space) break;
          used += size + TOP_GAP;
          next++;
        }
      }
      setRoom((old) => (old === next ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, signature]);

  const shown = items.slice(0, room);
  const rest = items.slice(room);
  const current = rest.find((item) => item.key === active);
  if (current && shown.length > 0) {
    rest.splice(rest.indexOf(current), 1, shown[shown.length - 1]);
    shown[shown.length - 1] = current;
  }
  const restCount = rest.reduce((sum, item) => sum + countOf(item, badges), 0);

  return (
    <Box ref={setBox} sx={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: `${TOP_GAP}px` }}>
      <Box
        ref={ghost}
        aria-hidden
        sx={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: `${TOP_GAP}px`, top: 0, left: 0 }}
      >
        {items.map((item) => (
          <TopItem key={item.key} item={item} active={item.key === active} count={0} />
        ))}
        <Box
          sx={{
            height: 40,
            px: 1.75,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            fontSize: '0.875rem',
            '& svg': { fontSize: 20 },
          }}
        >
          <MoreHorizRounded />
          {t('Mehr')}
        </Box>
      </Box>
      {shown.map((item) => (
        <TopItem key={item.key} item={item} active={item.key === active} count={countOf(item, badges)} onNavigate={onNavigate} />
      ))}
      {rest.length > 0 && (
        <>
          <ButtonBase
            aria-label={t('Mehr Bereiche')}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
            sx={{
              flex: 'none',
              height: 40,
              px: 1.75,
              gap: 1,
              borderRadius: `${radius.full}px`,
              fontSize: '0.875rem',
              fontWeight: 500,
              color: c.onSurfaceVariant,
              '&:hover': { bgcolor: mix(c.onSurface, 8) },
              '& svg': { fontSize: 20 },
              '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
            }}
          >
            <Badge variant="dot" color="error" invisible={restCount === 0}>
              <MoreHorizRounded />
            </Badge>
            {t('Mehr')}
          </ButtonBase>
          <Menu
            anchorEl={anchor}
            open={Boolean(anchor)}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          >
            {rest.map((item) => (
              <MenuItem
                key={item.key}
                component="a"
                href={item.href}
                onClick={(event: MouseEvent) => {
                  setAnchor(null);
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  if (onNavigate?.(item.href)) event.preventDefault();
                }}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                {item.label}
                <MenuCount value={countOf(item, badges)} />
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
}

function bottomItems(user: SessionUser, pages: PluginPage[]): NavItem[] {
  if (boot().setup2fa) {
    return [{ key: 'account', href: '/account', label: t('Ich'), icon: <AccountCircleOutlined />, activeIcon: <AccountCircleRounded /> }];
  }
  const account: NavItem = {
    key: 'account',
    href: '/account',
    label: t('Ich'),
    icon: <AccountCircleOutlined />,
    activeIcon: <AccountCircleRounded />,
  };
  const chosen = boot().nav?.bar ?? [];
  if (chosen.length) {
    const visible = new Map(railItems(user, pages).map((item) => [item.key as string, item]));
    const picked = chosen
      .map((key) => visible.get(key))
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, BAR_SLOTS);
    if (picked.length) return [...picked, account];
  }
  const shared: NavItem = {
    key: 'shared',
    href: '/files/shared',
    label: t('Geteilt'),
    icon: <PeopleOutlined />,
    activeIcon: <PeopleRounded />,
  };
  if (boot().user?.role === 'guest') return [HOME, TEAMS, shared, account];
  const third: NavItem | null = featureOn('photos')
    ? { key: 'photos', href: '/files/photos', label: t('Fotos'), icon: <PhotoLibraryOutlined />, activeIcon: <PhotoLibraryRounded /> }
    : boot().calendarOn && featureOn('calendar')
      ? { key: 'calendar', href: '/calendar', label: t('Kalender'), icon: <CalendarMonthOutlined />, activeIcon: <CalendarMonthRounded /> }
      : null;
  return [
    HOME,
    { key: 'files', href: '/files', label: t('Dateien'), icon: <FolderOutlined />, activeIcon: <FolderRounded /> },
    ...(third ? [third] : []),
    shared,
    account,
  ];
}

function NavButton({
  item,
  active,
  compact,
  count = 0,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
  count?: number;
  onNavigate?: (href: string) => boolean;
}) {
  return (
    <ButtonBase
      component="a"
      href={item.href}
      nativeButton={false}
      aria-current={active ? 'page' : undefined}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (onNavigate?.(item.href)) event.preventDefault();
      }}
      sx={{
        flexDirection: 'column',
        gap: 0.5,
        width: compact ? 'auto' : 84,
        flex: compact ? 1 : 'none',
        minWidth: 0,
        py: compact ? 1.5 : 0.5,
        borderRadius: `${radius.md}px`,
        color: active ? c.onSurface : c.onSurfaceVariant,
        '&:hover .nav-pill': {
          bgcolor: active ? `color-mix(in srgb, ${c.onSecondaryContainer} 8%, ${c.secondaryContainer})` : mix(c.onSurface, 8),
        },
        '& .MuiTouchRipple-root': { display: 'none' },
        '&.Mui-focusVisible .nav-pill': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
      }}
    >
      <Box
        className="nav-pill"
        sx={{
          width: 56,
          height: 32,
          borderRadius: `${radius.full}px`,
          display: 'grid',
          placeItems: 'center',
          bgcolor: active ? c.secondaryContainer : 'transparent',
          color: active ? c.onSecondaryContainer : 'inherit',
          transition: `background-color 200ms ${curve.standard}`,
          '& svg': { fontSize: 24 },
        }}
      >
        <Badge badgeContent={count} color="error" max={99} sx={{ '& .MuiBadge-badge': { fontSize: '0.625rem', height: 16, minWidth: 16 } }}>
          {active ? item.activeIcon : item.icon}
        </Badge>
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontWeight: active ? 700 : 500,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          px: compact ? 0.5 : 0,
        }}
      >
        {item.label}
      </Typography>
    </ButtonBase>
  );
}

export function LanguageSelector() {
  const switchTo = async (next: 'de' | 'en') => {
    try {
      await api.post('/api/language', { language: next });
    } finally {
      location.reload();
    }
  };
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={language}
      onChange={(_event, value) => value && switchTo(value)}
      aria-label={t('Sprache')}
      fullWidth
    >
      <ToggleButton value="de" lang="de">
        Deutsch
      </ToggleButton>
      <ToggleButton value="en" lang="en">
        English
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

function AccountMenu({
  user,
  storage,
  anchor,
  onClose,
}: {
  user: SessionUser;
  storage?: Storage;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const { pages } = usePlugins();
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!anchor || user.role === 'guest') return;
    api
      .get<{ status: Status | null }>('/api/account/status')
      .then((result) => setStatus(result.status))
      .catch(() => undefined);
  }, [anchor]);
  return (
    <>
      <StatusDialog open={editing} onClose={() => setEditing(false)} onSaved={setStatus} />
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 320 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, pt: 1, pb: 1.5 }}>
          <UserAvatar initials={user.initials} size={44} avatar={user.avatar} userId={user.id} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {user.name}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap component="p">
              @{user.username} · {user.role === 'admin' ? t('Admin') : t('Mitglied')}
            </Typography>
          </Box>
        </Box>
        {user.role !== 'guest' && (
          <MenuItem
            onClick={() => {
              onClose();
              setEditing(true);
            }}
            data-status-open
          >
            <ListItemIcon>
              <Box
                sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: status ? STATUS_COLORS[status.state] : c.outline, ml: 0.75 }}
              />
            </ListItemIcon>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {status ? statusLine(status) : t('Status setzen')}
            </Typography>
          </MenuItem>
        )}
        {storage && (
          <Box sx={{ px: 1.5, pb: 1 }}>
            <StorageMeter storage={storage} />
          </Box>
        )}
        {storage && (
          <MenuItem component="a" href="/files/storage">
            <ListItemIcon>
              <DataUsageRounded />
            </ListItemIcon>
            {t('Speicher ansehen')}
          </MenuItem>
        )}
        {pages.map((page) => (
          <MenuItem key={pluginPageKey(page)} component="a" href={pluginPageHref(page)}>
            <ListItemIcon>{pluginIcon(page.icon)}</ListItemIcon>
            {page.label}
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.5 }} />
        <Box sx={{ px: 1.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Darstellung')}
          </Typography>
          <ThemeModeSelector />
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, mt: 0.5 }}>
            {t('Sprache')}
          </Typography>
          <LanguageSelector />
        </Box>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem component="a" href="/account">
          <ListItemIcon>
            <ManageAccountsRounded />
          </ListItemIcon>
          {t('Konto und Sicherheit')}
        </MenuItem>
        {!boot().setup2fa && (
          <MenuItem
            onClick={() => {
              onClose();
              window.dispatchEvent(new Event('moe:palette'));
            }}
          >
            <ListItemIcon>
              <ManageSearchRounded />
            </ListItemIcon>
            {t('Schnellzugriff')}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            onClose();
            window.dispatchEvent(new Event('moe:shortcuts'));
          }}
        >
          <ListItemIcon>
            <KeyboardRounded />
          </ListItemIcon>
          {t('Tastenkürzel')}
        </MenuItem>
        <MenuItem onClick={() => void logout()}>
          <ListItemIcon>
            <LogoutRounded />
          </ListItemIcon>
          {t('Abmelden')}
        </MenuItem>
      </Menu>
    </>
  );
}

export function AccountButton({ size = 40, storage }: { size?: number; storage?: Storage }) {
  const user = boot().user!;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={t('Konto')} placement="right">
        <IconButton
          aria-label={t('Konto von {name}', { name: user.name })}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ p: 0.5 }}
        >
          <UserAvatar initials={user.initials} size={size} avatar={user.avatar} userId={user.id} />
        </IconButton>
      </Tooltip>
      <AccountMenu user={user} storage={storage} anchor={anchor} onClose={() => setAnchor(null)} />
    </>
  );
}

interface ShellProps {
  active: Destination;
  topBar: ReactNode;
  railAction?: ReactNode;
  mobileAction?: ReactNode;
  aside?: ReactNode;
  storage?: Storage;
  onNavigate?: (href: string) => boolean;
  framed?: boolean;
  children: ReactNode;
}

function usePalette() {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  useEffect(() => {
    if (boot().setup2fa) return;
    const show = () => {
      setUsed(true);
      setOpen(true);
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      const palette = document.getElementById('moe-palette-list');
      if (!palette && document.querySelector('.MuiDialog-root, .MuiMenu-root')) return;
      event.preventDefault();
      setUsed(true);
      setOpen((current) => !current);
    };
    window.addEventListener('moe:palette', show);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('moe:palette', show);
      window.removeEventListener('keydown', key);
    };
  }, []);
  return { open, used, close: () => setOpen(false) };
}

function useShortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('.MuiDialog-root, .MuiMenu-root')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('moe:shortcuts', show);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('moe:shortcuts', show);
      window.removeEventListener('keydown', key);
    };
  }, []);
  return [open, setOpen] as const;
}

function useBarHidden(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last;
        if (y < 64) {
          setHidden(false);
          last = y;
        } else if (delta > 12) {
          setHidden(true);
          last = y;
        } else if (delta < -12) {
          setHidden(false);
          last = y;
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return hidden;
}

const editable = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === 'TEXTAREA') return true;
  return (
    element.tagName === 'INPUT' &&
    !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes((element as HTMLInputElement).type)
  );
};

function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const focus = (event: FocusEvent) => setTyping(editable(event.target));
    const blur = () => setTimeout(() => setTyping(editable(document.activeElement)), 50);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
    };
  }, []);
  return typing;
}

export function AppShell({ active, topBar, railAction, mobileAction, aside, storage, onNavigate, framed = true, children }: ShellProps) {
  useFeatures();
  const user = boot().user!;
  const site = boot().site;
  const prefs = usePrefs();
  const top = prefs.navPosition === 'top';
  const [shortcuts, setShortcuts] = useShortcuts();
  const palette = usePalette();
  const { pages } = usePlugins();
  const badges = useBadges();
  const welcome = useWelcome();
  const typing = useTyping();
  const hiddenByScroll = useBarHidden(prefs.barHide);
  const barHidden = hiddenByScroll || typing;
  useLive((event, data) => {
    if (event === 'badges') setBadges(data as Partial<Badges>);
  });
  const items = railItems(user, pages);

  return (
    <Box sx={{ minHeight: '100dvh' }} data-nav={top ? 'top' : 'side'}>
      <SkipLink />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      {palette.used && (
        <Suspense fallback={null}>
          <CommandPalette open={palette.open} onClose={palette.close} onNavigate={onNavigate} />
        </Suspense>
      )}
      {welcome.open && (
        <Suspense fallback={null}>
          <WelcomeDialog open onClose={welcome.close} />
        </Suspense>
      )}
      {!top && (
        <Box
          component="nav"
          aria-label={t('Hauptnavigation')}
          sx={{
            position: 'fixed',
            insetBlock: 0,
            left: 0,
            width: RAIL,
            zIndex: 1200,
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            py: 2,
            bgcolor: `var(--moe-chrome, ${c.surface})`,
            overflow: 'hidden',
          }}
        >
          <ButtonBase
            component="a"
            href="/files"
            nativeButton={false}
            aria-label={t('{name}, zu deinen Dateien', { name: site.name })}
            onClick={(event: MouseEvent) => {
              if (onNavigate?.('/files')) event.preventDefault();
            }}
            sx={{ borderRadius: `${radius.tile}px`, mb: 1 }}
          >
            <BrandMark size={44} />
          </ButtonBase>
          {railAction && <Box sx={{ my: 1 }}>{railAction}</Box>}
          <Box sx={{ display: 'flex', flexDirection: 'column', mt: 1, width: '100%', flex: '1 1 auto', minHeight: 0 }}>
            <RailItems items={items} active={active} badges={badges} onNavigate={onNavigate} />
          </Box>
          <ThemeToggleButton />
          <AccountButton storage={storage} />
          {site.version && (
            <Typography
              variant="caption"
              sx={{ color: c.onSurfaceVariant, opacity: 0.7, fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}
            >
              v{site.version}
            </Typography>
          )}
        </Box>
      )}

      <Box
        sx={{
          ml: { md: top ? 0 : `${RAIL}px` },
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100dvh',
          height: { md: '100dvh' },
        }}
      >
        {top && (
          <Box
            component="nav"
            aria-label={t('Hauptnavigation')}
            data-top-nav
            sx={{
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: 1.5,
              minHeight: 64,
              px: 2,
              flex: 'none',
              bgcolor: `var(--moe-chrome, ${c.surface})`,
            }}
          >
            <ButtonBase
              component="a"
              href="/files"
              nativeButton={false}
              aria-label={t('{name}, zu deinen Dateien', { name: site.name })}
              onClick={(event: MouseEvent) => {
                if (onNavigate?.('/files')) event.preventDefault();
              }}
              sx={{ borderRadius: `${radius.tile}px`, flex: 'none' }}
            >
              <BrandMark size={40} />
            </ButtonBase>
            <TopItems items={items} active={active} badges={badges} onNavigate={onNavigate} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 'none' }}>
              <ThemeToggleButton />
              <AccountButton storage={storage} size={36} />
            </Box>
          </Box>
        )}
        <Box
          component="header"
          sx={{
            position: { xs: 'sticky', md: 'static' },
            top: 0,
            zIndex: 1100,
            minHeight: { xs: 'var(--moe-header, 64px)', md: top ? 64 : 72 },
            pt: { xs: 'env(safe-area-inset-top)', md: 0 },
            px: { xs: 'max(8px, env(safe-area-inset-left))', sm: 2 },
            pr: { md: 3 },
            pl: { md: top ? 2 : 1 },
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: { xs: c.surface, md: `var(--moe-chrome, ${c.surface})` },
          }}
        >
          {top && railAction && <Box sx={{ display: { xs: 'none', md: 'block' }, flex: 'none', mr: 1 }}>{railAction}</Box>}
          {topBar}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, flex: 'none' }}>
            {!boot().setup2fa && <NotificationBell onNavigate={onNavigate} />}
            <Box sx={{ display: { md: 'none' } }}>
              <AccountButton size={36} storage={storage} />
            </Box>
          </Box>
        </Box>
        <Box sx={{ px: { xs: 0, md: 2 }, pl: { md: top ? 2 : 0 } }}>
          <SiteNotice />
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: 2,
            px: { md: 2 },
            pl: { md: top ? 2 : 0 },
            pb: { xs: 'calc(80px + env(safe-area-inset-bottom) + var(--moe-player, 0px))', md: 'calc(16px + var(--moe-player, 0px))' },
          }}
        >
          <Box
            component="main"
            id="inhalt"
            tabIndex={-1}
            sx={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              overflowY: { md: 'auto' },
              bgcolor: framed ? { md: c.surfaceContainerLow } : undefined,
              borderRadius: framed ? { md: `${radius.lg}px` } : undefined,
              outline: 'none',
            }}
          >
            {children}
          </Box>
          {aside}
        </Box>
      </Box>

      {mobileAction && (
        <Box
          sx={{
            position: 'fixed',
            right: 16,
            bottom: barHidden
              ? 'calc(16px + env(safe-area-inset-bottom) + var(--moe-player, 0px))'
              : 'calc(96px + env(safe-area-inset-bottom) + var(--moe-player, 0px))',
            transition: `bottom 200ms ${curve.standard}`,
            zIndex: 1150,
            display: { xs: typing ? 'none' : 'block', md: 'none' },
          }}
        >
          {mobileAction}
        </Box>
      )}

      <Box
        component="nav"
        aria-label={t('Hauptnavigation')}
        data-bottom-nav
        data-hidden={barHidden ? '' : undefined}
        sx={{
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          zIndex: 1200,
          display: { xs: 'flex', md: 'none' },
          bgcolor: c.surfaceContainer,
          pb: 'env(safe-area-inset-bottom)',
          px: 'max(4px, env(safe-area-inset-left))',
          transform: barHidden ? 'translateY(110%)' : 'none',
          transition: `transform 200ms ${curve.standard}`,
        }}
      >
        {bottomItems(user, pages).map((item) => (
          <NavButton
            key={item.key}
            item={item}
            active={item.key === active}
            compact
            count={countOf(item, badges)}
            onNavigate={onNavigate}
          />
        ))}
      </Box>
    </Box>
  );
}
