import { useMemo, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import CakeRounded from '@mui/icons-material/CakeRounded';
import CenterFocusStrongRounded from '@mui/icons-material/CenterFocusStrongRounded';
import BeachAccessRounded from '@mui/icons-material/BeachAccessRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { c, curve, mix, radius } from '../../theme/tokens';
import { confirm, pickColor } from '../common/dialogs';
import { toast } from '../common/toast';
import { BIRTHDAY_COLOR, HOLIDAY_COLOR } from './colors';
import { birthdaysAvailable } from './data';
import { useFeatures } from '../../lib/features';
import { MiniMonth } from './MiniMonth';
import { colorName, PALETTE, type CalendarInfo, type ItemKind } from './model';
import { invalidate, loadCalendars, patchCalendar, useCalendarState } from './store';

export interface SidebarActions {
  onCreate: (kind: ItemKind | 'task') => void;
  onPick: (day: string) => void;
  onEditCalendar: (id: string, tab?: 'general' | 'share' | 'publish' | 'transfer') => void;
  onNewCalendar: () => void;
  onSubscribe: () => void;
  onImport: () => void;
  onFindTime: () => void;
  onNavigate: (href: string) => void;
}

interface Props extends SidebarActions {
  date: string;
  range: { from: string; to: string } | null;
  marks?: Map<string, number>;
}

export function CreateButton({ onCreate, extended = true }: { onCreate: SidebarActions['onCreate']; extended?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const kinds: [ItemKind | 'task', string, ReactElement][] = [
    ['event', t('Termin'), <EventRounded key="event" />],
    ['task', t('Aufgabe'), <TaskAltRounded key="task" />],
    ['birthday', t('Geburtstag'), <CakeRounded key="birthday" />],
    ['focus', t('Fokuszeit'), <CenterFocusStrongRounded key="focus" />],
    ['ooo', t('Abwesenheit'), <BeachAccessRounded key="ooo" />],
  ];
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
      <Button
        variant="contained"
        color="primary"
        size="large"
        startIcon={<AddRounded />}
        onClick={() => onCreate('event')}
        sx={{
          height: 56,
          borderRadius: `${radius.md}px 0 0 ${radius.md}px`,
          px: extended ? 2.5 : 1.5,
          bgcolor: c.primaryContainer,
          color: c.onPrimaryContainer,
          boxShadow: 'none',
          fontWeight: 700,
          '&:hover': { bgcolor: `color-mix(in srgb, ${c.onPrimaryContainer} 8%, ${c.primaryContainer})`, boxShadow: 'none' },
        }}
      >
        {t('Neu')}
      </Button>
      <Tooltip title={t('Was möchtest du anlegen?')}>
        <Button
          variant="contained"
          aria-label={t('Weitere Arten')}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{
            minWidth: 0,
            height: 56,
            px: 1,
            ml: '2px',
            borderRadius: `0 ${radius.md}px ${radius.md}px 0`,
            bgcolor: c.primaryContainer,
            color: c.onPrimaryContainer,
            boxShadow: 'none',
            '&:hover': { bgcolor: `color-mix(in srgb, ${c.onPrimaryContainer} 8%, ${c.primaryContainer})`, boxShadow: 'none' },
          }}
        >
          <ExpandMoreRounded />
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {kinds.map(([kind, label, icon]) => (
          <MenuItem
            key={kind}
            onClick={() => {
              setAnchor(null);
              onCreate(kind);
            }}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

function CalendarRow({ calendar, actions, others }: { calendar: CalendarInfo; actions: SidebarActions; others: CalendarInfo[] }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const owner = calendar.access === 'owner';
  const subscription = calendar.kind === 'subscription';
  const close = () => setMenu(null);

  const recolor = async () => {
    close();
    const color = await pickColor({
      title: t('Farbe für „{name}“', { name: calendar.name }),
      value: calendar.color,
      required: true,
      options: PALETTE.map((hex) => ({ key: hex, label: colorName(hex), color: hex })),
    });
    if (color) await patchCalendar(calendar.id, { color });
  };

  const only = async () => {
    close();
    await Promise.all(
      others.map((other) =>
        other.id === calendar.id
          ? other.hidden
            ? patchCalendar(other.id, { hidden: false })
            : null
          : !other.hidden
            ? patchCalendar(other.id, { hidden: true })
            : null
      )
    );
  };

  const remove = async () => {
    close();
    const ok = await confirm({
      title: owner ? t('„{name}“ löschen?', { name: calendar.name }) : t('„{name}“ entfernen?', { name: calendar.name }),
      text: owner
        ? subscription
          ? t('Das Abo und alle geladenen Termine verschwinden aus MoeCloud.')
          : t('Der Kalender kommt mit allen Terminen in den Papierkorb. Du kannst ihn dort wiederherstellen.')
        : t('Du siehst diesen Kalender danach nicht mehr. Die Person, die ihn geteilt hat, kann ihn dir erneut freigeben.'),
      confirm: owner ? t('Löschen') : t('Entfernen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/calendar/calendars/${calendar.id}`);
      await loadCalendars();
      invalidate();
      toast(owner ? t('Kalender gelöscht') : t('Kalender entfernt'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const refresh = async () => {
    close();
    try {
      const { result } = await api.post<{ result: { created: number; updated: number } | null }>(
        `/api/calendar/calendars/${calendar.id}/refresh`
      );
      await loadCalendars();
      invalidate();
      toast(
        result && result.created + result.updated > 0
          ? t('{created} neu, {updated} geändert', { created: result.created, updated: result.updated })
          : t('Keine Änderungen')
      );
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        borderRadius: `${radius.full}px`,
        pr: 0.25,
        '&:hover': { bgcolor: mix(c.onSurface, 6) },
        '&:hover .row-more, & .row-more:focus-visible, & .row-more[aria-expanded="true"]': { opacity: 1 },
      }}
    >
      <ButtonBase
        role="checkbox"
        aria-checked={!calendar.hidden}
        onClick={() => void patchCalendar(calendar.id, { hidden: !calendar.hidden })}
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          gap: 1.25,
          py: 0.75,
          pl: 1.25,
          borderRadius: `${radius.full}px`,
          textAlign: 'left',
        }}
      >
        <Box
          sx={{
            width: 18,
            height: 18,
            flex: 'none',
            borderRadius: '5px',
            border: `2px solid ${calendar.color}`,
            bgcolor: calendar.hidden ? 'transparent' : calendar.color,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            transition: `background-color 160ms ${curve.standard}`,
            '& svg': { fontSize: 14 },
          }}
        >
          {!calendar.hidden && <CheckRounded />}
        </Box>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
          {calendar.name}
        </Typography>
        {calendar.syncError && (
          <Tooltip title={calendar.syncError}>
            <ErrorOutlineRounded sx={{ fontSize: 16, color: c.error }} />
          </Tooltip>
        )}
        {calendar.publicToken && (
          <Tooltip title={t('Öffentlich')}>
            <LinkRounded sx={{ fontSize: 16, color: c.onSurfaceVariant }} />
          </Tooltip>
        )}
        {calendar.shares > 0 && owner && (
          <Tooltip title={t('Geteilt')}>
            <GroupsRounded sx={{ fontSize: 16, color: c.onSurfaceVariant }} />
          </Tooltip>
        )}
      </ButtonBase>
      <IconButton
        className="row-more"
        size="small"
        aria-label={t('Optionen für {name}', { name: calendar.name })}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onClick={(event: MouseEvent<HTMLElement>) => setMenu(event.currentTarget)}
        sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms' }}
      >
        <MoreVertRounded fontSize="small" />
      </IconButton>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={close}>
        <MenuItem onClick={() => void only()}>
          <ListItemIcon>
            <VisibilityRounded />
          </ListItemIcon>
          {t('Nur diesen anzeigen')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            actions.onEditCalendar(calendar.id, 'general');
          }}
        >
          <ListItemIcon>
            <EditRounded />
          </ListItemIcon>
          {owner ? t('Einstellungen') : t('Details')}
        </MenuItem>
        <MenuItem onClick={() => void recolor()}>
          <ListItemIcon>
            <PaletteRounded />
          </ListItemIcon>
          {t('Farbe ändern')}
        </MenuItem>
        {owner && !subscription && (
          <MenuItem
            onClick={() => {
              close();
              actions.onEditCalendar(calendar.id, 'share');
            }}
          >
            <ListItemIcon>
              <ShareRounded />
            </ListItemIcon>
            {t('Teilen und veröffentlichen')}
          </MenuItem>
        )}
        {subscription && owner && (
          <MenuItem onClick={() => void refresh()}>
            <ListItemIcon>
              <SyncRounded />
            </ListItemIcon>
            {t('Jetzt aktualisieren')}
          </MenuItem>
        )}
        {calendar.access !== 'freebusy' && (
          <MenuItem component="a" href={`/api/calendar/calendars/${calendar.id}/export.ics`} download onClick={close}>
            <ListItemIcon>
              <DownloadRounded />
            </ListItemIcon>
            {t('Als ICS exportieren')}
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => void remove()} sx={{ color: c.error }}>
          <ListItemIcon sx={{ color: 'inherit' }}>{owner ? <DeleteOutlineRounded /> : <LogoutRounded />}</ListItemIcon>
          {owner ? (subscription ? t('Abo beenden') : t('Löschen')) : t('Entfernen')}
        </MenuItem>
      </Menu>
    </Box>
  );
}

function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Box component="section" aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'center', pr: 0.25 }}>
        <ButtonBase
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          sx={{ flex: 1, justifyContent: 'flex-start', gap: 0.5, py: 0.75, px: 1.25, borderRadius: `${radius.full}px` }}
        >
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {title}
          </Typography>
          <ExpandMoreRounded
            sx={{
              fontSize: 18,
              color: c.onSurfaceVariant,
              transform: open ? 'none' : 'rotate(-90deg)',
              transition: `transform 160ms ${curve.standard}`,
            }}
          />
        </ButtonBase>
        {action}
      </Box>
      {open && <Box sx={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>}
    </Box>
  );
}

function ToggleRow({ label, color, checked, onToggle }: { label: string; color: string; checked: boolean; onToggle: () => void }) {
  return (
    <ButtonBase
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      sx={{
        justifyContent: 'flex-start',
        gap: 1.25,
        py: 0.75,
        pl: 1.25,
        borderRadius: `${radius.full}px`,
        '&:hover': { bgcolor: mix(c.onSurface, 6) },
      }}
    >
      <Box
        sx={{
          width: 18,
          height: 18,
          borderRadius: '5px',
          border: `2px solid ${color}`,
          bgcolor: checked ? color : 'transparent',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          '& svg': { fontSize: 14 },
        }}
      >
        {checked && <CheckRounded />}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {label}
      </Typography>
    </ButtonBase>
  );
}

export function Sidebar({ date, range, marks, ...actions }: Props) {
  const { calendars, prefs } = useCalendarState();
  const local = usePrefs();
  const on = useFeatures();
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const groups = useMemo(() => {
    const own = calendars.filter((calendar) => calendar.access === 'owner' && calendar.kind === 'local');
    const shared = calendars.filter((calendar) => calendar.access !== 'owner');
    const subscribed = calendars.filter((calendar) => calendar.access === 'owner' && calendar.kind === 'subscription');
    return { own, shared, subscribed };
  }, [calendars]);
  const toggleLocal = (key: string) =>
    setPrefs({ hidden: local.hidden.includes(key) ? local.hidden.filter((entry) => entry !== key) : [...local.hidden, key] });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 1 }}>
        <CreateButton onCreate={actions.onCreate} />
      </Box>
      <Box sx={{ px: 0.5 }}>
        <MiniMonth
          value={date}
          weekStart={prefs?.weekStart ?? 1}
          range={range}
          marks={marks}
          weekNumbers={prefs?.weekNumbers}
          onPick={actions.onPick}
        />
      </Box>
      <Button variant="outlined" startIcon={<GroupsRounded />} onClick={actions.onFindTime} sx={{ mx: 1, justifyContent: 'flex-start' }}>
        {t('Gemeinsame Zeit finden')}
      </Button>
      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, pb: 2, scrollbarWidth: 'thin' }}
      >
        <Group
          title={t('Meine Kalender')}
          action={
            <>
              <Tooltip title={t('Kalender hinzufügen')}>
                <IconButton
                  size="small"
                  aria-label={t('Kalender hinzufügen')}
                  aria-haspopup="menu"
                  onClick={(event) => setAddMenu(event.currentTarget)}
                >
                  <AddRounded fontSize="small" />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={addMenu} open={Boolean(addMenu)} onClose={() => setAddMenu(null)}>
                <MenuItem
                  onClick={() => {
                    setAddMenu(null);
                    actions.onNewCalendar();
                  }}
                >
                  <ListItemIcon>
                    <CalendarMonthRounded />
                  </ListItemIcon>
                  <ListItemText primary={t('Neuer Kalender')} secondary={t('Für Arbeit, Familie, Sport …')} />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setAddMenu(null);
                    actions.onSubscribe();
                  }}
                >
                  <ListItemIcon>
                    <LinkRounded />
                  </ListItemIcon>
                  <ListItemText primary={t('Kalender abonnieren')} secondary={t('Per iCal- oder webcal-Adresse')} />
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setAddMenu(null);
                    actions.onImport();
                  }}
                >
                  <ListItemIcon>
                    <UploadFileRounded />
                  </ListItemIcon>
                  <ListItemText primary={t('Importieren')} secondary={t('Aus Dateien, Adressen und CalDAV-Konten')} />
                </MenuItem>
              </Menu>
            </>
          }
        >
          {groups.own.map((calendar) => (
            <CalendarRow key={calendar.id} calendar={calendar} actions={actions} others={calendars} />
          ))}
        </Group>
        {groups.shared.length > 0 && (
          <Group title={t('Mit mir geteilt')}>
            {groups.shared.map((calendar) => (
              <CalendarRow key={calendar.id} calendar={calendar} actions={actions} others={calendars} />
            ))}
          </Group>
        )}
        {groups.subscribed.length > 0 && (
          <Group title={t('Abonniert')}>
            {groups.subscribed.map((calendar) => (
              <CalendarRow key={calendar.id} calendar={calendar} actions={actions} others={calendars} />
            ))}
          </Group>
        )}
        <Group title={t('Weitere')}>
          <ToggleRow
            label={t('Einladungen')}
            color={c.tertiary}
            checked={!local.hidden.includes('invitations')}
            onToggle={() => toggleLocal('invitations')}
          />
          {prefs && prefs.holidays.length > 0 && (
            <ToggleRow
              label={t('Feiertage')}
              color={HOLIDAY_COLOR}
              checked={!local.hidden.includes('holidays')}
              onToggle={() => toggleLocal('holidays')}
            />
          )}
          {birthdaysAvailable() && on('contacts') && (
            <ToggleRow
              label={t('Geburtstage')}
              color={BIRTHDAY_COLOR}
              checked={!local.hidden.includes('birthdays')}
              onToggle={() => toggleLocal('birthdays')}
            />
          )}
        </Group>
        <Divider sx={{ mx: 1.25, my: 0.5 }} />
        {[
          ['/calendar/stats', t('Statistik'), <InsightsRounded key="stats" />],
          ['/calendar/settings', t('Einstellungen'), <SettingsRounded key="settings" />],
          ['/calendar/trash', t('Papierkorb'), <DeleteOutlineRounded key="trash" />],
        ].map(([href, label, icon]) => (
          <ButtonBase
            key={href as string}
            component="a"
            href={href as string}
            nativeButton={false}
            onClick={(event: MouseEvent) => {
              if (event.metaKey || event.ctrlKey) return;
              event.preventDefault();
              actions.onNavigate(href as string);
            }}
            sx={{
              justifyContent: 'flex-start',
              gap: 1.5,
              py: 0.9,
              px: 1.25,
              borderRadius: `${radius.full}px`,
              color: c.onSurfaceVariant,
              '&:hover': { bgcolor: mix(c.onSurface, 6) },
              '& svg': { fontSize: 20 },
            }}
          >
            {icon}
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {label as string}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
