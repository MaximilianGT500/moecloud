import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import AccountCircleRounded from '@mui/icons-material/AccountCircleRounded';
import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import CollectionsRounded from '@mui/icons-material/CollectionsRounded';
import ContrastRounded from '@mui/icons-material/ContrastRounded';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import HomeRounded from '@mui/icons-material/HomeRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded';
import KeyboardRounded from '@mui/icons-material/KeyboardRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import AssignmentRounded from '@mui/icons-material/AssignmentRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import LibraryMusicRounded from '@mui/icons-material/LibraryMusicRounded';
import { api, errorText, logout } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { pluginIcon, pluginPageHref, pluginPageKey, usePlugins } from '../common/plugins';
import type { ThemeList, ThemeResult } from '../common/themes';
import { useModeSwitch } from '../common/ThemeToggle';
import { toast } from '../common/toast';
import { useThemeControl } from '../mount';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  words?: string;
  icon: ReactElement;
  run: () => void;
}

interface Found {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  location?: string | null;
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function rank(command: Command, tokens: string[]) {
  const label = fold(command.label);
  const all = `${label} ${fold(command.words ?? '')} ${fold(command.group)}`;
  if (!tokens.every((token) => all.includes(token))) return -1;
  if (label.startsWith(tokens[0])) return 0;
  if (tokens.every((token) => label.includes(token))) return 1;
  return 2;
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate?: (href: string) => boolean;
}) {
  const user = boot().user!;
  const { pages } = usePlugins();
  const control = useThemeControl();
  const mode = useModeSwitch();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<{ query: string; items: Found[] }>({ query: '', items: [] });
  const [themes, setThemes] = useState<ThemeList | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }

  useEffect(() => {
    if (!open || themes) return;
    void api
      .get<ThemeList>('/api/themes')
      .then(setThemes)
      .catch(() => undefined);
  }, [open, themes]);

  const term = query.trim();
  useEffect(() => {
    if (!open || term.length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<{ items: Found[] }>(`/api/search?q=${encodeURIComponent(term)}`, abort.signal)
        .then((result) => setFound({ query: term, items: result.items.slice(0, 8) }))
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, term]);

  const go = (href: string) => {
    if (!onNavigate?.(href)) location.assign(href);
  };

  const pickTheme = async (id: string | null, name: string) => {
    try {
      const result = await api.put<ThemeResult>('/api/account/theme', { id });
      setThemes(result);
      control.adopt(result.theme, result.palette, result.css);
      toast(t('Dein Theme ist jetzt „{name}“', { name }));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const places = t('Gehe zu');
  const admin = t('Verwaltung');
  const looks = t('Aussehen');
  const more = t('Mehr');
  const commands: Command[] = [
    { id: 'home', group: places, label: t('Start'), icon: <HomeRounded />, run: () => go('/files/home') },
    { id: 'files', group: places, label: t('Dateien'), icon: <FolderRounded />, run: () => go('/files') },
    { id: 'teams', group: places, label: t('Teamordner'), icon: <FolderSharedRounded />, run: () => go('/files/teams') },
    { id: 'photos', group: places, label: t('Fotos'), icon: <PhotoLibraryRounded />, run: () => go('/files/photos') },
    { id: 'albums', group: places, label: t('Alben'), icon: <CollectionsRounded />, run: () => go('/files/photos/albums') },
    { id: 'recent', group: places, label: t('Zuletzt'), icon: <ScheduleRounded />, run: () => go('/files/recent') },
    { id: 'notes', group: places, label: t('Notizen'), icon: <StickyNote2Rounded />, run: () => go('/files/notes') },
    ...(boot().forms
      ? [{ id: 'forms', group: places, label: t('Formulare'), icon: <AssignmentRounded />, run: () => go('/files/forms') }]
      : []),
    { id: 'music', group: places, label: t('Musik'), icon: <LibraryMusicRounded />, run: () => go('/files/music') },
    { id: 'activity', group: places, label: t('Aktivität'), icon: <HistoryRounded />, run: () => go('/files/activity') },
    { id: 'starred', group: places, label: t('Favoriten'), icon: <StarRounded />, run: () => go('/files/starred') },
    { id: 'tags', group: places, label: t('Schlagwörter'), icon: <SellRounded />, run: () => go('/files/tags') },
    { id: 'shared', group: places, label: t('Geteilt'), icon: <PeopleRounded />, run: () => go('/files/shared') },
    { id: 'trash', group: places, label: t('Papierkorb'), icon: <DeleteRounded />, run: () => go('/files/trash') },
    { id: 'storage', group: places, label: t('Speicher'), icon: <DataUsageRounded />, run: () => go('/files/storage') },
    ...pages.map((page) => ({
      id: pluginPageKey(page),
      group: places,
      label: page.label,
      words: 'plugin',
      icon: pluginIcon(page.icon),
      run: () => go(pluginPageHref(page)),
    })),
    { id: 'account', group: places, label: t('Konto und Sicherheit'), icon: <AccountCircleRounded />, run: () => go('/account') },
    ...(user.role === 'admin'
      ? (
          [
            ['', t('Übersicht')],
            ['people', t('Personen')],
            ['groups', t('Gruppen')],
            ['teams', t('Teamordner verwalten')],
            ['invites', t('Einladungen')],
            ['links', t('Links')],
            ['audit', t('Protokoll')],
            ['scan', t('Virenscan')],
            ['mail', t('E-Mail')],
            ['sso', t('Single Sign-on')],
            ['webhooks', t('Webhooks')],
            ['plugins', t('Plugins')],
            ['backups', t('Sicherungen')],
            ['settings', t('Einstellungen')],
            ['system', t('System')],
          ] as [string, string][]
        ).map(([slug, label]): Command => ({
          id: `admin-${slug}`,
          group: admin,
          label,
          words: 'admin',
          icon: <AdminPanelSettingsRounded />,
          run: () => go(slug ? `/admin/${slug}` : '/admin'),
        }))
      : []),
    {
      id: 'mode',
      group: looks,
      label: mode.resolved === 'dark' ? t('Helles Design') : t('Dunkles Design'),
      words: 'hell dunkel light dark',
      icon: <ContrastRounded />,
      run: () => mode.apply(mode.resolved === 'dark' ? 'light' : 'dark'),
    },
    ...(themes?.personal
      ? [
          {
            id: 'theme-site',
            group: looks,
            label: t('Theme: {name}', { name: t('Wie alle') }),
            words: 'theme farbe',
            icon: <PaletteRounded />,
            run: () => void pickTheme(null, t('Wie alle')),
          },
          ...themes.themes.map((theme): Command => ({
            id: `theme-${theme.id}`,
            group: looks,
            label: t('Theme: {name}', { name: theme.name }),
            words: 'theme farbe',
            icon: (
              <Box
                component="span"
                sx={{ width: 20, height: 20, m: '2px', borderRadius: '50%', bgcolor: theme.seed, border: `1px solid ${c.outlineVariant}` }}
              />
            ),
            run: () => void pickTheme(theme.id, theme.name),
          })),
        ]
      : []),
    {
      id: 'shortcuts',
      group: more,
      label: t('Tastenkürzel'),
      icon: <KeyboardRounded />,
      run: () => window.dispatchEvent(new Event('moe:shortcuts')),
    },
    { id: 'logout', group: more, label: t('Abmelden'), icon: <LogoutRounded />, run: () => void logout() },
  ];

  const tokens = fold(term).split(/\s+/).filter(Boolean);
  const matches =
    tokens.length === 0
      ? commands.filter((command) => !command.id.startsWith('theme-'))
      : commands
          .map((command, position) => ({ command, score: rank(command, tokens), position }))
          .filter((entry) => entry.score >= 0)
          .sort((a, b) => a.score - b.score || a.position - b.position)
          .map((entry) => entry.command);
  const rootId = user.rootId;
  const files: Command[] =
    term.length >= 2 && found.query === term
      ? found.items.map((entry) => ({
          id: `node-${entry.id}`,
          group: t('Dateien und Ordner'),
          label: entry.name,
          hint: entry.location || undefined,
          icon: entry.type === 'folder' ? <FolderRounded /> : <InsertDriveFileRounded />,
          run: () => {
            if (entry.type === 'folder') go(`/files/folder/${entry.id}`);
            else {
              const parent = !entry.parentId || entry.parentId === rootId ? '/files' : `/files/folder/${entry.parentId}`;
              go(`${parent}?select=${entry.id}`);
            }
          },
        }))
      : [];
  const shown = [...files, ...(tokens.length === 0 ? matches : matches.slice(0, 12))];
  const active = Math.min(index, Math.max(0, shown.length - 1));
  const groups: { name: string; items: { command: Command; position: number }[] }[] = [];
  shown.forEach((command, position) => {
    const last = groups[groups.length - 1];
    if (last && last.name === command.group) last.items.push({ command, position });
    else groups.push({ name: command.group, items: [{ command, position }] });
  });

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-position="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(shown.length ? (active + 1) % shown.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(shown.length ? (active - 1 + shown.length) % shown.length : 0);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setIndex(Math.max(0, shown.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[active]);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          'aria-label': t('Schnellzugriff'),
          sx: { position: 'fixed', top: { xs: 16, sm: '12vh' }, m: 0, width: 'calc(100% - 32px)', overflow: 'hidden' },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, height: 64, borderBottom: `1px solid ${c.outlineVariant}` }}>
        <SearchRounded sx={{ color: c.onSurfaceVariant }} />
        <InputBase
          autoFocus
          fullWidth
          value={query}
          placeholder={t('Wohin, oder was suchst du?')}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
          inputProps={{
            role: 'combobox',
            'aria-label': t('Schnellzugriff'),
            'aria-expanded': true,
            'aria-controls': 'moe-palette-list',
            'aria-autocomplete': 'list',
            'aria-activedescendant': shown[active] ? `moe-palette-${active}` : undefined,
            autoComplete: 'off',
            spellCheck: false,
          }}
          sx={{ fontSize: '1.0625rem' }}
        />
      </Box>
      <Box
        ref={list}
        id="moe-palette-list"
        role="listbox"
        aria-label={t('Schnellzugriff')}
        sx={{ maxHeight: 'min(60vh, 440px)', overflowY: 'auto', p: 1 }}
      >
        {shown.length === 0 && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 1.5, py: 2 }}>
            {term.length >= 2 && found.query !== term ? t('Sucht …') : t('Dazu gibt es nichts.')}
          </Typography>
        )}
        {groups.map((group) => (
          <Box key={`${group.name}-${group.items[0].position}`} role="group" aria-label={group.name}>
            <Typography
              variant="caption"
              component="div"
              aria-hidden
              sx={{ color: c.onSurfaceVariant, px: 1.5, pt: 1, pb: 0.5, fontWeight: 600 }}
            >
              {group.name}
            </Typography>
            {group.items.map(({ command, position }) => (
              <Box
                key={command.id}
                id={`moe-palette-${position}`}
                role="option"
                aria-selected={position === active}
                data-position={position}
                onMouseMove={() => position !== active && setIndex(position)}
                onClick={() => run(command)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  minHeight: 44,
                  px: 1.5,
                  borderRadius: `${radius.sm}px`,
                  cursor: 'pointer',
                  bgcolor: position === active ? mix(c.onSurface, 10) : 'transparent',
                  '& svg': { fontSize: 22, color: c.onSurfaceVariant, flex: 'none' },
                }}
              >
                {command.icon}
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
                  {command.label}
                </Typography>
                {command.hint && (
                  <Typography variant="caption" noWrap sx={{ color: c.onSurfaceVariant, maxWidth: '40%' }}>
                    {command.hint}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
