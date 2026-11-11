import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
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
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import FolderRounded from '@mui/icons-material/FolderRounded';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
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
import { BrandMark, SkipLink, StorageMeter, UserAvatar } from '../common/bits';
import { ShortcutsDialog } from '../common/Shortcuts';
import { ThemeModeSelector, ThemeToggleButton } from '../common/ThemeToggle';
import { api, logout } from '../../lib/api';
import { boot, type SessionUser, type Storage } from '../../lib/boot';
import { language, t } from '../../lib/i18n';
import { c, curve, mix, radius } from '../../theme/tokens';
import { NotificationBell } from './Notifications';
import { SiteNotice } from './SiteNotice';

export const RAIL = 88;

export type Destination = 'files' | 'photos' | 'recent' | 'starred' | 'tags' | 'shared' | 'trash' | 'storage' | 'admin' | 'account';

interface NavItem {
  key: Destination;
  href: string;
  label: string;
  icon: ReactNode;
  activeIcon: ReactNode;
}

function railItems(user: SessionUser): NavItem[] {
  if (boot().setup2fa) return [];
  return [
    { key: 'files', href: '/files', label: t('Dateien'), icon: <FolderOutlined />, activeIcon: <FolderRounded /> },
    { key: 'photos', href: '/files/photos', label: t('Fotos'), icon: <PhotoLibraryOutlined />, activeIcon: <PhotoLibraryRounded /> },
    { key: 'recent', href: '/files/recent', label: t('Zuletzt'), icon: <ScheduleOutlined />, activeIcon: <ScheduleRounded /> },
    { key: 'starred', href: '/files/starred', label: t('Favoriten'), icon: <StarOutlineRounded />, activeIcon: <StarRounded /> },
    { key: 'tags', href: '/files/tags', label: t('Schlagwörter'), icon: <SellOutlined />, activeIcon: <SellRounded /> },
    { key: 'shared', href: '/files/shared', label: t('Geteilt'), icon: <PeopleOutlined />, activeIcon: <PeopleRounded /> },
    { key: 'trash', href: '/files/trash', label: t('Papierkorb'), icon: <DeleteOutlined />, activeIcon: <DeleteRounded /> },
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
}

function bottomItems(): NavItem[] {
  if (boot().setup2fa) {
    return [{ key: 'account', href: '/account', label: t('Ich'), icon: <AccountCircleOutlined />, activeIcon: <AccountCircleRounded /> }];
  }
  return [
    { key: 'files', href: '/files', label: t('Dateien'), icon: <FolderOutlined />, activeIcon: <FolderRounded /> },
    { key: 'photos', href: '/files/photos', label: t('Fotos'), icon: <PhotoLibraryOutlined />, activeIcon: <PhotoLibraryRounded /> },
    { key: 'recent', href: '/files/recent', label: t('Zuletzt'), icon: <ScheduleOutlined />, activeIcon: <ScheduleRounded /> },
    { key: 'shared', href: '/files/shared', label: t('Geteilt'), icon: <PeopleOutlined />, activeIcon: <PeopleRounded /> },
    { key: 'account', href: '/account', label: t('Ich'), icon: <AccountCircleOutlined />, activeIcon: <AccountCircleRounded /> },
  ];
}

function NavButton({
  item,
  active,
  compact,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
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
        {active ? item.activeIcon : item.icon}
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
  return (
    <Menu
      anchorEl={anchor}
      open={Boolean(anchor)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 320 } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, pt: 1, pb: 1.5 }}>
        <UserAvatar initials={user.initials} size={44} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {user.name}
          </Typography>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap component="p">
            @{user.username} · {user.role === 'admin' ? t('Admin') : t('Mitglied')}
          </Typography>
        </Box>
      </Box>
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
          <UserAvatar initials={user.initials} size={size} />
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

export function AppShell({ active, topBar, railAction, mobileAction, aside, storage, onNavigate, framed = true, children }: ShellProps) {
  const user = boot().user!;
  const site = boot().site;
  const [shortcuts, setShortcuts] = useShortcuts();
  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <SkipLink />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
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
          bgcolor: c.surface,
          overflowY: 'auto',
          scrollbarWidth: 'none',
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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25, mt: 1 }}>
          {railItems(user).map((item) => (
            <NavButton key={item.key} item={item} active={item.key === active} onNavigate={onNavigate} />
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
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

      <Box sx={{ ml: { md: `${RAIL}px` }, display: 'flex', flexDirection: 'column', minHeight: '100dvh', height: { md: '100dvh' } }}>
        <Box
          component="header"
          sx={{
            position: { xs: 'sticky', md: 'static' },
            top: 0,
            zIndex: 1100,
            minHeight: { xs: 64, md: 72 },
            px: { xs: 1, sm: 2 },
            pr: { md: 3 },
            pl: { md: 1 },
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: c.surface,
          }}
        >
          {topBar}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, flex: 'none' }}>
            {!boot().setup2fa && <NotificationBell onNavigate={onNavigate} />}
            <Box sx={{ display: { md: 'none' } }}>
              <AccountButton size={36} storage={storage} />
            </Box>
          </Box>
        </Box>
        <Box sx={{ px: { xs: 0, md: 2 }, pl: { md: 0 } }}>
          <SiteNotice />
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: 2,
            px: { md: 2 },
            pl: { md: 0 },
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
            bottom: 'calc(96px + env(safe-area-inset-bottom) + var(--moe-player, 0px))',
            zIndex: 1150,
            display: { xs: 'block', md: 'none' },
          }}
        >
          {mobileAction}
        </Box>
      )}

      <Box
        component="nav"
        aria-label={t('Hauptnavigation')}
        sx={{
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          zIndex: 1200,
          display: { xs: 'flex', md: 'none' },
          bgcolor: c.surfaceContainer,
          pb: 'env(safe-area-inset-bottom)',
          px: 0.5,
        }}
      >
        {bottomItems().map((item) => (
          <NavButton key={item.key} item={item} active={item.key === active} compact onNavigate={onNavigate} />
        ))}
      </Box>
    </Box>
  );
}
