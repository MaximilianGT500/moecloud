import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type TouchEvent,
} from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import TodayRounded from '@mui/icons-material/TodayRounded';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import KeyboardRounded from '@mui/icons-material/KeyboardRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CalendarViewMonthRounded from '@mui/icons-material/CalendarViewMonthRounded';
import ViewAgendaRounded from '@mui/icons-material/ViewAgendaRounded';
import ViewDayRounded from '@mui/icons-material/ViewDayRounded';
import ViewWeekRounded from '@mui/icons-material/ViewWeekRounded';
import { parseQuick } from '../../../../shared/quickadd';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { c, radius } from '../../theme/tokens';
import { lazyNamed, whenIdle } from '../common/lazy';
import { choose, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { AppShell, type Destination } from '../shell/AppShell';
import { AgendaView } from './views/AgendaView';
import { MonthView } from './views/MonthView';
import { TimeGrid, type MoveChange } from './views/TimeGrid';
import { YearView } from './views/YearView';
import { TasksView } from './views/TasksView';
import { useVisibleItems } from './data';
import {
  addDays,
  dayStart,
  deviceZone,
  formatMonth,
  getZone,
  keyOf,
  monthName,
  parseKey,
  step,
  today,
  viewTitle,
  visibleDays,
} from './dates';
import { EventPopover } from './EventPopover';
import { EventEditor, type EditorRequest } from './EventEditor';
import { formFromDetail, newForm, type Form } from './form';
import {
  calendarApi,
  type CalendarInfo,
  type EventDetail,
  type ItemKind,
  type Occurrence,
  type Scope,
  type Task,
  type View,
} from './model';
import type { Picked } from './PeopleInput';
import { QuickCreate } from './QuickCreate';
import { Sidebar } from './Sidebar';
import { defaultCalendar, getState, invalidate, loadCalendars, patchLocal, prefetch, useCalendarState } from './store';

const SettingsView = lazyNamed(() => import('./SettingsView'), 'SettingsView');
const StatsView = lazyNamed(() => import('./StatsView'), 'StatsView');
const BookingView = lazyNamed(() => import('./BookingView'), 'BookingView');
const PollsView = lazyNamed(() => import('./PollsView'), 'PollsView');
const SearchView = lazyNamed(() => import('./SearchView'), 'SearchView');
const TrashView = lazyNamed(() => import('./TrashView'), 'TrashView');
const FindTime = lazyNamed(() => import('./FindTime'), 'FindTime');
const CalendarDialog = lazyNamed(() => import('./CalendarDialogs'), 'CalendarDialog');
const NewCalendarDialog = lazyNamed(() => import('./CalendarDialogs'), 'NewCalendarDialog');
const SubscribeDialog = lazyNamed(() => import('./CalendarDialogs'), 'SubscribeDialog');
const ImportWizard = lazyNamed(() => import('./ImportWizard'), 'ImportWizard');

type Page = 'calendar' | 'tasks' | 'booking' | 'polls' | 'stats' | 'settings' | 'search' | 'trash';

const VIEWS: View[] = ['day', 'days3', 'workweek', 'week', 'month', 'year', 'agenda'];
const PAGES: Page[] = ['tasks', 'booking', 'polls', 'stats', 'settings', 'search', 'trash'];
const SIDEBAR = 296;

function parse(path: string) {
  const parts = path.split('/').filter(Boolean);
  const second = parts[1];
  if (second && VIEWS.includes(second as View)) {
    const raw = parts[2];
    return { page: 'calendar' as Page, view: second as View, date: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today(), explicit: true };
  }
  if (second && PAGES.includes(second as Page)) return { page: second as Page, view: null, date: today(), explicit: false };
  return { page: 'calendar' as Page, view: null, date: today(), explicit: false };
}

function occurrenceOf(detail: EventDetail): Occurrence {
  const base = detail.instance ?? detail.data;
  const start = base.start ?? base.due ?? Date.now();
  const end = base.end ?? start;
  const allDay = base.allDay;
  const startDate = allDay ? new Date(start).toISOString().slice(0, 10) : null;
  return {
    key: `${detail.id}:${detail.recurrenceId ?? ''}`,
    eventId: detail.id,
    calendarId: detail.calendarId,
    recurrenceId: detail.recurrenceId,
    component: detail.data.component,
    title: base.title,
    location: base.location,
    start,
    end,
    allDay,
    startDate,
    endDate: allDay ? new Date(Math.max(end, start + 86_400_000)).toISOString().slice(0, 10) : null,
    color: base.color,
    status: base.status,
    transparency: base.transparency,
    privacy: base.privacy,
    kind: detail.data.kind,
    birthYear: detail.data.birthYear,
    categories: base.categories,
    conference: base.conference,
    recurring: Boolean(detail.data.rrule),
    override: false,
    completed: base.completed !== null || base.status === 'COMPLETED',
    priority: base.priority,
    attendees: base.attendees.length,
    invitation: detail.invited ? detail.myStatus : null,
    organizer: base.organizer?.name ?? null,
    readOnly: detail.readOnly,
    busyOnly: detail.busyOnly,
    hasAlarms: base.alarms.length > 0,
    zone: base.zone,
  };
}

const typing = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable));
};

export function CalendarApp() {
  const { path, query } = useLocation();
  const state = useCalendarState();
  const { calendars, prefs, loaded, zone } = state;
  const local = usePrefs();
  const desktop = useMediaQuery('(min-width:900px)');
  const narrow = useMediaQuery('(max-width:600px)');
  const parsed = parse(path);
  const page = parsed.page;
  const fallback: View = prefs?.view && prefs.view !== 'tasks' ? prefs.view : 'week';
  let view: View = parsed.view ?? fallback;
  if (!parsed.explicit && narrow && (view === 'week' || view === 'workweek')) view = 'days3';
  const date = parsed.date;
  const [selected, setSelected] = useState<{ item: Occurrence; anchor: HTMLElement | null } | null>(null);
  const [quick, setQuick] = useState<{ range: MoveChange | null; anchor: HTMLElement | null; text?: string } | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [finder, setFinder] = useState<{
    emails: string[];
    duration?: number;
    day?: string;
    apply?: (start: number, end: number, people: Picked[]) => void;
  } | null>(null);
  const [calendarDialog, setCalendarDialog] = useState<{ id: string; tab: 'general' | 'share' | 'publish' | 'transfer' } | null>(null);
  const [dialog, setDialog] = useState<'new' | 'subscribe' | 'import' | null>(null);
  const [importNode, setImportNode] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState(query.get('q') ?? '');
  const [searching, setSearching] = useState(false);
  const [travelDismissed, setTravelDismissed] = useState(() => {
    try {
      return localStorage.getItem('moecloud-calendar-travel') === deviceZone();
    } catch {
      return false;
    }
  });
  const searchInput = useRef<HTMLInputElement>(null);
  const touch = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    void loadCalendars();
  }, []);

  useLive((event) => {
    if (event === 'events') invalidate();
    else if (event === 'calendars' || event === 'reconnect') {
      void loadCalendars();
      invalidate();
    }
  });

  const calendarMap = useMemo(() => new Map<string, CalendarInfo>(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const range = useMemo(
    () =>
      prefs ? visibleDays(view, date, prefs.weekStart, prefs.weekends, prefs.workDays) : visibleDays(view, date, 1, true, [1, 2, 3, 4, 5]),
    [view, date, prefs?.weekStart, prefs?.weekends, prefs?.workDays.join(',')]
  );
  const from = view === 'agenda' ? date : range.from;
  const to = view === 'agenda' ? addDays(date, local.agendaDays) : range.to;
  const fromUtc = dayStart(from);
  const toUtc = dayStart(to);
  const { items, loading } = useVisibleItems(from, to, fromUtc, toUtc);

  useEffect(() => {
    if (!loaded || page !== 'calendar' || view === 'agenda') return;
    return whenIdle(() => {
      for (const direction of [1, -1]) {
        const next = step(view, date, direction);
        const nextRange = prefs ? visibleDays(view, next, prefs.weekStart, prefs.weekends, prefs.workDays) : null;
        if (nextRange) prefetch(dayStart(nextRange.from), dayStart(nextRange.to));
      }
    });
  }, [loaded, view, date, page, zone]);

  const marks = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items ?? []) {
      if (item.holiday) continue;
      const key = item.allDay && item.startDate ? item.startDate : keyOf(item.start);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const go = useCallback((nextView: View, nextDate: string) => {
    navigate(`/calendar/${nextView}/${nextDate}`);
    setSelected(null);
  }, []);

  const onNavigate = useCallback((href: string) => {
    if (!href.startsWith('/calendar')) return false;
    navigate(href);
    setDrawer(false);
    return true;
  }, []);

  useEffect(() => {
    const id = query.get('event');
    if (!id) return;
    const rid = query.get('rid');
    calendarApi
      .detail(id, rid)
      .then((detail) => setSelected({ item: occurrenceOf(detail), anchor: null }))
      .catch((error) => toast(errorText(error)));
  }, [query.get('event'), query.get('rid')]);

  useEffect(() => {
    const kind = query.get('new');
    if (!kind || !prefs) return;
    openEditor(kind === 'task' ? 'task' : 'event');
    const url = new URL(location.href);
    url.searchParams.delete('new');
    navigate(url.pathname + url.search, { replace: true });
  }, [query.get('new'), Boolean(prefs)]);

  useEffect(() => {
    const node = query.get('import');
    if (!node) return;
    setImportNode(node);
    setDialog('import');
    const url = new URL(location.href);
    url.searchParams.delete('import');
    navigate(url.pathname + url.search, { replace: true });
  }, [query.get('import')]);

  const closeSelected = () => {
    setSelected(null);
    if (query.get('event')) {
      const url = new URL(location.href);
      url.searchParams.delete('event');
      url.searchParams.delete('rid');
      navigate(url.pathname + url.search, { replace: true });
    }
  };

  function openEditor(kind: ItemKind | 'task', range?: MoveChange | null, form?: Form) {
    if (!prefs) return;
    if (form) {
      setEditor({ form });
      return;
    }
    const component = kind === 'task' ? 'VTODO' : 'VEVENT';
    const calendar = defaultCalendar(component);
    if (!calendar) {
      toast(t('Lege zuerst einen Kalender an'));
      setDialog('new');
      return;
    }
    const otherDay = !range && view !== 'agenda' && date !== today() && page === 'calendar';
    setEditor({
      form: newForm({
        component,
        kind: kind === 'task' ? 'event' : kind,
        calendar,
        prefs,
        start: range?.start ?? (otherDay ? dayStart(date) + prefs.workStart * 60_000 : undefined),
        end: range?.end,
        allDay: range?.allDay ?? (kind === 'birthday' || kind === 'ooo' ? true : undefined),
      }),
    });
  }

  const editExisting = (detail: EventDetail, item: Occurrence) => {
    setSelected(null);
    setEditor({ form: formFromDetail(detail, item), detail, occurrence: item });
  };

  const openTask = async (task: Task) => {
    try {
      const detail = await calendarApi.detail(task.id, null);
      if (detail.readOnly) setSelected({ item: occurrenceOf(detail), anchor: null });
      else setEditor({ form: formFromDetail(detail), detail });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const move = async (item: Occurrence, change: MoveChange) => {
    let scope: Scope = 'all';
    if (item.recurring && item.recurrenceId) {
      const picked = await choose({
        title: t('Wiederkehrenden Termin verschieben'),
        options: [
          { value: 'this', label: t('Nur diesen Termin'), primary: true },
          { value: 'following', label: t('Diesen und alle folgenden') },
          { value: 'all', label: t('Alle Termine der Serie') },
        ],
      });
      if (!picked) return;
      scope = picked as Scope;
    }
    const before = { start: item.start, end: item.end, allDay: item.allDay };
    patchLocal(
      (entry) => entry.key === item.key,
      (entry) => ({
        ...entry,
        start: change.start,
        end: change.end,
        startDate: change.allDay ? new Date(change.start).toISOString().slice(0, 10) : entry.startDate,
        endDate: change.allDay ? new Date(change.end).toISOString().slice(0, 10) : entry.endDate,
      })
    );
    const payload = change.allDay
      ? { start: new Date(change.start).toISOString().slice(0, 10), end: new Date(change.end).toISOString().slice(0, 10), allDay: true }
      : item.component === 'VTODO'
        ? { due: change.start, allDay: false }
        : { start: change.start, end: change.end, allDay: false };
    try {
      await calendarApi.update(item.eventId, payload, scope, item.recurrenceId);
      invalidate();
      if (scope === 'all' && !item.recurring) {
        toast(t('Verschoben'), {
          action: {
            label: t('Rückgängig'),
            onClick: () => {
              const undo = before.allDay
                ? {
                    start: new Date(before.start).toISOString().slice(0, 10),
                    end: new Date(before.end).toISOString().slice(0, 10),
                    allDay: true,
                  }
                : item.component === 'VTODO'
                  ? { due: before.start, allDay: false }
                  : { start: before.start, end: before.end, allDay: false };
              void calendarApi
                .update(item.eventId, undo, 'all', null)
                .then(invalidate)
                .catch((error) => toast(errorText(error)));
            },
          },
        });
      }
    } catch (error) {
      toast(errorText(error));
      invalidate();
    }
  };

  const toggleTask = async (item: Occurrence) => {
    patchLocal(
      (entry) => entry.key === item.key,
      (entry) => ({ ...entry, completed: !entry.completed })
    );
    try {
      await calendarApi.complete(item.eventId, !item.completed, item.recurrenceId);
      invalidate();
    } catch (error) {
      toast(errorText(error));
      invalidate();
    }
  };

  const jump = async () => {
    const text = await prompt({
      title: t('Zu Datum springen'),
      label: t('Datum'),
      value: '',
      confirm: t('Springen'),
      helper: t('z. B. 24.12., nächsten Freitag, in 3 Wochen'),
    });
    if (!text) return;
    const result = parseQuick(text, today(), { weekStart: prefs?.weekStart });
    if (result.date) go(view, result.date);
    else toast(t('Das Datum habe ich nicht verstanden'));
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (document.querySelector('.MuiDialog-root, .MuiPopover-root, .MuiMenu-root, .MuiDrawer-modal')) return;
      const key = event.key;
      if (key === '/') {
        event.preventDefault();
        setSearching(true);
        requestAnimationFrame(() => searchInput.current?.focus());
        return;
      }
      if (page !== 'calendar') {
        if (key === 'c') openEditor('event');
        return;
      }
      const map: Record<string, View> = { d: 'day', x: 'days3', w: 'week', m: 'month', y: 'year', a: 'agenda' };
      if (map[key]) go(map[key], date);
      else if (key === 't') go(view, today());
      else if (key === 'ArrowRight' || key === 'j' || key === 'n') go(view, step(view, date, 1));
      else if (key === 'ArrowLeft' || key === 'k' || key === 'p') go(view, step(view, date, -1));
      else if (key === 'c') openEditor('event');
      else if (key === 'q' || key === 'N') setQuick({ range: null, anchor: null });
      else if (key === 'g') void jump();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0];
    touch.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY, time: Date.now() } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || page !== 'calendar' || view === 'agenda' || view === 'year') return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Date.now() - start.time < 600) go(view, step(view, date, dx < 0 ? 1 : -1));
  };

  const viewLabels: Record<View, string> = {
    day: t('Tag'),
    days3: t('3 Tage'),
    workweek: t('Arbeitswoche'),
    week: t('Woche'),
    month: t('Monat'),
    year: t('Jahr'),
    agenda: t('Terminliste'),
    tasks: t('Aufgaben'),
  };
  const shortcuts: Record<View, string> = { day: 'D', days3: 'X', workweek: '', week: 'W', month: 'M', year: 'Y', agenda: 'A', tasks: '' };
  const pageTitles: Record<Page, string> = {
    calendar: viewTitle(view, date, range),
    tasks: t('Aufgaben'),
    booking: t('Buchungsseiten'),
    polls: t('Terminumfragen'),
    stats: t('Statistik'),
    settings: t('Einstellungen'),
    search: t('Suche'),
    trash: t('Papierkorb'),
  };
  const active: Destination = page === 'tasks' ? 'tasks' : page === 'booking' ? 'booking' : page === 'polls' ? 'polls' : 'calendar';
  const showSidebar = desktop && local.sidebar && page === 'calendar';
  const userZone = zone || getZone();
  const travelling = loaded && !travelDismissed && deviceZone() !== userZone && deviceZone() !== 'UTC';

  const submitSearch = () => {
    const term = search.trim();
    if (term) navigate(`/calendar/search?q=${encodeURIComponent(term)}`);
  };

  const topBar = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 1 }, flex: 1, minWidth: 0 }} className="no-print">
      {page === 'calendar' ? (
        <Tooltip title={desktop ? (local.sidebar ? t('Seitenleiste ausblenden') : t('Seitenleiste einblenden')) : t('Kalender')}>
          <IconButton aria-label={t('Seitenleiste')} onClick={() => (desktop ? setPrefs({ sidebar: !local.sidebar }) : setDrawer(true))}>
            <MenuRounded />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title={t('Zum Kalender')}>
          <IconButton aria-label={t('Zum Kalender')} onClick={() => navigate('/calendar')}>
            <ArrowBackRounded />
          </IconButton>
        </Tooltip>
      )}
      {page === 'calendar' && desktop && (
        <>
          <Button variant="outlined" size="small" onClick={() => go(view, today())} sx={{ borderRadius: `${radius.full}px`, px: 2 }}>
            {t('Heute')}
          </Button>
          <Box sx={{ display: 'flex' }}>
            <Tooltip title={t('Zurück')}>
              <IconButton aria-label={t('Zurück')} onClick={() => go(view, step(view, date, -1))}>
                <ChevronLeftRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Weiter')}>
              <IconButton aria-label={t('Weiter')} onClick={() => go(view, step(view, date, 1))}>
                <ChevronRightRounded />
              </IconButton>
            </Tooltip>
          </Box>
        </>
      )}
      {!(searching && !desktop) && (
        <Typography
          component="h1"
          variant="h6"
          noWrap
          sx={{ fontWeight: 700, fontSize: { xs: 18, sm: 20 }, minWidth: 0, flexShrink: 1, ml: 0.5 }}
        >
          {page === 'calendar' && !desktop
            ? view === 'year'
              ? String(parseKey(date).year)
              : parseKey(date).year === parseKey(today()).year
                ? monthName(parseKey(date).month)
                : formatMonth(date)
            : pageTitles[page]}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {(desktop || searching) && (
        <Box
          component="form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            height: 44,
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
            width: { xs: '100%', md: 280, lg: 340 },
            flexShrink: 1,
          }}
        >
          <SearchRounded sx={{ color: c.onSurfaceVariant }} />
          <InputBase
            inputRef={searchInput}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (page === 'search') navigate(`/calendar/search?q=${encodeURIComponent(event.target.value)}`, { replace: true });
            }}
            onKeyDown={(event: ReactKeyboardEvent) => {
              if (event.key === 'Escape') {
                setSearch('');
                setSearching(false);
                (event.target as HTMLElement).blur();
              }
            }}
            placeholder={t('Termine durchsuchen')}
            inputProps={{ 'aria-label': t('Termine durchsuchen') }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          {search && (
            <IconButton size="small" aria-label={t('Suche leeren')} onClick={() => setSearch('')}>
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      )}
      {!desktop && !searching && (
        <>
          {page === 'calendar' && (
            <IconButton aria-label={t('Heute')} onClick={() => go(view, today())}>
              <TodayRounded />
            </IconButton>
          )}
          <IconButton aria-label={t('Suchen')} onClick={() => setSearching(true)}>
            <SearchRounded />
          </IconButton>
        </>
      )}
      {!desktop && searching && (
        <IconButton
          aria-label={t('Suche schließen')}
          onClick={() => {
            setSearching(false);
            setSearch('');
          }}
        >
          <CloseRounded />
        </IconButton>
      )}
      {page === 'calendar' && !(searching && !desktop) && (
        <>
          {desktop ? (
            <Button
              variant="tonal"
              size="small"
              endIcon={<ArrowDropDownRounded />}
              onClick={(event) => setViewMenu(event.currentTarget)}
              aria-haspopup="menu"
              sx={{ borderRadius: `${radius.full}px`, pl: 2, flex: 'none' }}
            >
              {viewLabels[view]}
            </Button>
          ) : (
            <IconButton
              aria-label={t('Ansicht: {view}', { view: viewLabels[view] })}
              aria-haspopup="menu"
              onClick={(event) => setViewMenu(event.currentTarget)}
            >
              {view === 'month' || view === 'year' ? (
                <CalendarViewMonthRounded />
              ) : view === 'agenda' ? (
                <ViewAgendaRounded />
              ) : view === 'day' ? (
                <ViewDayRounded />
              ) : (
                <ViewWeekRounded />
              )}
            </IconButton>
          )}
          <Menu anchorEl={viewMenu} open={Boolean(viewMenu)} onClose={() => setViewMenu(null)}>
            {VIEWS.map((entry) => (
              <MenuItem
                key={entry}
                selected={entry === view}
                onClick={() => {
                  setViewMenu(null);
                  go(entry, date);
                }}
              >
                <ListItemIcon>{entry === view && <CheckRounded />}</ListItemIcon>
                <ListItemText>{viewLabels[entry]}</ListItemText>
                {shortcuts[entry] && (
                  <Typography variant="caption" sx={{ ml: 3, color: c.onSurfaceVariant }}>
                    {shortcuts[entry]}
                  </Typography>
                )}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {desktop && (
        <IconButton aria-label={t('Mehr')} onClick={(event) => setMoreMenu(event.currentTarget)}>
          <MoreVertRounded />
        </IconButton>
      )}
      <Menu anchorEl={moreMenu} open={Boolean(moreMenu)} onClose={() => setMoreMenu(null)}>
        {page === 'calendar' && (
          <MenuItem
            onClick={() => {
              setMoreMenu(null);
              setTimeout(() => window.print(), 120);
            }}
          >
            <ListItemIcon>
              <PrintRounded />
            </ListItemIcon>
            {t('Drucken')}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            navigate('/calendar/stats');
          }}
        >
          <ListItemIcon>
            <InsightsRounded />
          </ListItemIcon>
          {t('Statistik')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            navigate('/calendar/settings');
          }}
        >
          <ListItemIcon>
            <SettingsRounded />
          </ListItemIcon>
          {t('Einstellungen')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            navigate('/calendar/trash');
          }}
        >
          <ListItemIcon>
            <DeleteOutlineRounded />
          </ListItemIcon>
          {t('Papierkorb')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            window.dispatchEvent(new Event('moe:shortcuts'));
          }}
        >
          <ListItemIcon>
            <KeyboardRounded />
          </ListItemIcon>
          {t('Tastenkürzel')}
        </MenuItem>
      </Menu>
    </Box>
  );

  const sidebarActions = {
    onCreate: (kind: ItemKind | 'task') => {
      setDrawer(false);
      openEditor(kind);
    },
    onPick: (day: string) => {
      setDrawer(false);
      go(view === 'year' || view === 'agenda' ? view : view, day);
    },
    onEditCalendar: (id: string, tab?: 'general' | 'share' | 'publish' | 'transfer') => {
      setDrawer(false);
      setCalendarDialog({ id, tab: tab ?? 'general' });
    },
    onNewCalendar: () => {
      setDrawer(false);
      setDialog('new');
    },
    onSubscribe: () => {
      setDrawer(false);
      setDialog('subscribe');
    },
    onImport: () => {
      setDrawer(false);
      setDialog('import');
    },
    onFindTime: () => {
      setDrawer(false);
      setFinder({ emails: [] });
    },
    onNavigate: (href: string) => {
      setDrawer(false);
      navigate(href);
    },
  };

  const sidebar = (
    <Sidebar
      date={date}
      range={page === 'calendar' && view !== 'agenda' && view !== 'year' ? { from: range.from, to: range.to } : null}
      marks={marks}
      {...sidebarActions}
    />
  );

  const content = (() => {
    if (!prefs) return <LinearProgress />;
    if (page === 'tasks') return <TasksView calendars={calendarMap} onOpen={(task) => void openTask(task)} />;
    if (page === 'settings') return <SettingsView />;
    if (page === 'stats') return <StatsView />;
    if (page === 'booking') return <BookingView />;
    if (page === 'polls') return <PollsView />;
    if (page === 'trash') return <TrashView calendars={calendarMap} />;
    if (page === 'search')
      return (
        <SearchView
          query={query.get('q') ?? ''}
          calendars={calendarMap}
          onOpen={(hit) => {
            calendarApi
              .detail(hit.eventId, null)
              .then((detail) => setSelected({ item: occurrenceOf(detail), anchor: null }))
              .catch((error) => toast(errorText(error)));
          }}
        />
      );
    const list = items ?? [];
    const common = {
      items: list,
      calendars: calendarMap,
      prefs,
      selected: selected?.item.key ?? null,
      onOpen: (item: Occurrence, anchor: HTMLElement) => setSelected({ item, anchor }),
      onToggleTask: (item: Occurrence) => void toggleTask(item),
    };
    if (view === 'month')
      return (
        <MonthView
          {...common}
          days={range.days}
          month={parseKey(date).month}
          onCreate={(change, anchor) => setQuick({ range: change, anchor })}
          onMove={(item, change) => void move(item, change)}
          onDay={(day) => go('day', day)}
        />
      );
    if (view === 'year')
      return (
        <YearView
          year={parseKey(date).year}
          items={list}
          prefs={prefs}
          onDay={(day) => go('day', day)}
          onMonth={(day) => go('month', day)}
        />
      );
    if (view === 'agenda')
      return (
        <AgendaView
          {...common}
          from={from}
          to={to}
          onMore={local.agendaDays < 360 ? () => setPrefs({ agendaDays: Math.min(360, local.agendaDays + 30) }) : undefined}
          onDay={(day) => go('day', day)}
        />
      );
    return (
      <TimeGrid
        {...common}
        days={range.days}
        hourHeight={local.hourHeight}
        draft={quick?.range ?? null}
        onCreate={(change, anchor) => setQuick({ range: change, anchor })}
        onMove={(item, change) => void move(item, change)}
        onDay={(day) => go('day', day)}
      />
    );
  })();

  return (
    <AppShell
      active={active}
      topBar={topBar}
      onNavigate={onNavigate}
      framed={false}
      railAction={
        !showSidebar ? (
          <Tooltip title={t('Neuer Termin')} placement="right">
            <Fab
              color="primary"
              aria-label={t('Neuer Termin')}
              onClick={() => openEditor(page === 'tasks' ? 'task' : 'event')}
              sx={{
                borderRadius: `${radius.md}px`,
                boxShadow: 'none',
                bgcolor: c.primaryContainer,
                color: c.onPrimaryContainer,
                '&:hover': { bgcolor: c.primaryContainer },
              }}
            >
              <AddRounded />
            </Fab>
          </Tooltip>
        ) : undefined
      }
      mobileAction={
        page === 'calendar' || page === 'tasks' ? (
          <Fab
            color="primary"
            aria-label={t('Neu')}
            onClick={() => (page === 'tasks' ? openEditor('task') : setQuick({ range: null, anchor: null }))}
            sx={{
              borderRadius: `${radius.md}px`,
              width: 64,
              height: 64,
              bgcolor: c.primaryContainer,
              color: c.onPrimaryContainer,
              '&:hover': { bgcolor: c.primaryContainer },
            }}
          >
            <AddRounded />
          </Fab>
        ) : undefined
      }
    >
      <GlobalStyles
        styles={{
          '@media print': {
            'nav, header, .no-print, .MuiFab-root': { display: 'none !important' },
            'body, #root, main': { background: '#fff !important', color: '#000 !important' },
            '#inhalt, #inhalt *': { overflow: 'visible !important', maxHeight: 'none !important' },
            '[data-print-root]': { height: 'auto !important', margin: '0 !important', padding: '0 !important' },
          },
        }}
      />
      <Box
        data-print-root
        sx={{
          display: 'flex',
          gap: 1.5,
          height: { xs: 'calc(100dvh - 64px - 80px - env(safe-area-inset-bottom))', md: '100%' },
          minHeight: 0,
        }}
      >
        {showSidebar && (
          <Box
            component="aside"
            aria-label={t('Kalender und Monatsübersicht')}
            className="no-print"
            sx={{ width: SIDEBAR, flex: 'none', pt: 1, minHeight: 0 }}
          >
            {sidebar}
          </Box>
        )}
        <Box
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            bgcolor: { md: c.surfaceContainerLowest },
            borderRadius: { md: `${radius.xl}px` },
            border: { md: `1px solid ${c.outlineVariant}` },
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {travelling && (
            <Alert
              severity="info"
              className="no-print"
              sx={{ borderRadius: 0 }}
              action={
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={async () => {
                      try {
                        await api.patch('/api/account/prefs', { zone: deviceZone() });
                        await loadCalendars();
                        invalidate();
                      } catch (error) {
                        toast(errorText(error));
                      }
                    }}
                  >
                    {t('Umstellen')}
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      try {
                        localStorage.setItem('moecloud-calendar-travel', deviceZone());
                      } catch {}
                      setTravelDismissed(true);
                    }}
                  >
                    {t('Beibehalten')}
                  </Button>
                </Box>
              }
            >
              {t('Dein Gerät ist auf {device} eingestellt, dein Kalender auf {zone}.', {
                device: deviceZone().replace(/_/g, ' '),
                zone: userZone.replace(/_/g, ' '),
              })}
            </Alert>
          )}
          {page === 'calendar' && loading && items === null && (
            <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }} />
          )}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <Suspense fallback={<LinearProgress />}>{content}</Suspense>
          </Box>
        </Box>
      </Box>

      {!desktop && (
        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          slotProps={{
            paper: {
              sx: {
                width: 'min(320px, 88vw)',
                p: 1.5,
                pt: 2,
                bgcolor: c.surfaceContainerLow,
                borderRadius: `0 ${radius.lg}px ${radius.lg}px 0`,
              },
            },
          }}
        >
          {sidebar}
        </Drawer>
      )}

      {selected && <EventPopover item={selected.item} anchor={selected.anchor} onClose={closeSelected} onEdit={editExisting} />}
      {quick && (
        <QuickCreate
          range={quick.range}
          anchor={quick.anchor}
          initialText={quick.text}
          onClose={() => setQuick(null)}
          onMore={(form) => {
            setQuick(null);
            openEditor(form.component === 'VTODO' ? 'task' : form.kind, null, form);
          }}
        />
      )}
      {editor && (
        <EventEditor
          request={editor}
          onClose={() => setEditor(null)}
          onFindTime={(form, apply) =>
            setFinder({
              emails: form.attendees.map((attendee) => attendee.email),
              duration: Math.round((form.endTime - form.startTime + 1440) % 1440 || 60),
              day: form.startDate,
              apply,
            })
          }
        />
      )}
      <Suspense fallback={null}>
        {finder && (
          <FindTime
            emails={finder.emails}
            duration={finder.duration}
            day={finder.day}
            onClose={() => setFinder(null)}
            onPick={(start, end, people) => {
              if (finder.apply) finder.apply(start, end, people);
              else {
                const state = getState();
                if (!state.prefs) return;
                const calendar = defaultCalendar('VEVENT');
                const form = newForm({ component: 'VEVENT', calendar, prefs: state.prefs, start, end });
                form.attendees = people.map((person) => ({
                  email: person.email,
                  name: person.name,
                  role: 'REQ-PARTICIPANT',
                  status: 'NEEDS-ACTION',
                }));
                setEditor({ form });
              }
            }}
          />
        )}
        {calendarDialog && <CalendarDialog id={calendarDialog.id} tab={calendarDialog.tab} onClose={() => setCalendarDialog(null)} />}
        {dialog === 'new' && <NewCalendarDialog onClose={() => setDialog(null)} />}
        {dialog === 'subscribe' && <SubscribeDialog onClose={() => setDialog(null)} />}
        {dialog === 'import' && (
          <ImportWizard
            node={importNode}
            onClose={() => {
              setDialog(null);
              setImportNode(null);
            }}
          />
        )}
      </Suspense>
    </AppShell>
  );
}
