import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import SortRounded from '@mui/icons-material/SortRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ViewKanbanRounded from '@mui/icons-material/ViewKanbanRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import { parseQuick } from '../../../../../shared/quickadd';
import { api, errorText } from '../../../lib/api';
import { t, tn } from '../../../lib/i18n';
import { setPrefs, usePrefs, type Prefs } from '../../../lib/prefs';
import { c, mix, radius } from '../../../theme/tokens';
import { EmptyState, UserAvatar } from '../../common/bits';
import { boot } from '../../../lib/boot';
import { useLocation } from '../../../lib/router';
import { TaskBoard, columnOf, type Column } from './TaskBoard';
import { toast } from '../../common/toast';
import { addDays, at, formatDateShort, formatTime, keyOf, minuteOf, relativeDay, today } from '../dates';
import { calendarApi, type CalendarInfo, type Task } from '../model';
import { defaultCalendar, invalidate, useCalendarState } from '../store';

interface Props {
  calendars: Map<string, CalendarInfo>;
  onOpen: (task: Task) => void;
}

const PRIORITY_COLOR = (priority: number) => (priority === 0 ? null : priority <= 4 ? '#ef4444' : priority === 5 ? '#f59e0b' : '#3b82f6');

function dueKey(task: Task) {
  if (task.due === null) return null;
  return task.allDay ? new Date(task.due).toISOString().slice(0, 10) : keyOf(task.due);
}

export function TasksView({ calendars, onOpen }: Props) {
  const { version } = useCalendarState();
  const local = usePrefs();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sortMenu, setSortMenu] = useState<HTMLElement | null>(null);
  const filter = local.taskFilter;
  const board = local.taskLayout === 'board';
  const done = filter === 'done' || filter === 'all' || board;
  const me = boot().user?.id ?? 0;
  const { query } = useLocation();
  const wanted = query.get('task');

  useEffect(() => {
    let alive = true;
    api
      .get<{ items: Task[] }>(`/api/calendar/tasks${done ? '?completed=1' : ''}`)
      .then((result) => alive && setTasks(result.items))
      .catch((error) => toast(errorText(error)));
    return () => {
      alive = false;
    };
  }, [version, done]);

  useEffect(() => {
    if (!wanted || !tasks) return;
    const task = tasks.find((entry) => entry.id === wanted);
    const url = new URL(location.href);
    url.searchParams.delete('task');
    history.replaceState(null, '', url.pathname + url.search);
    if (task) onOpen(task);
  }, [wanted, tasks]);

  const todayKey = today();
  const groups = useMemo(() => {
    if (!tasks) return [];
    const visible = tasks.filter((task) => {
      const calendar = calendars.get(task.calendarId);
      if (calendar?.hidden) return false;
      const key = dueKey(task);
      switch (filter) {
        case 'open':
          return !task.completed;
        case 'today':
          return !task.completed && key !== null && key <= todayKey;
        case 'overdue':
          return !task.completed && key !== null && key < todayKey;
        case 'upcoming':
          return !task.completed && key !== null && key > todayKey;
        case 'mine':
          return !task.completed && task.assignee?.id === me;
        case 'done':
          return Boolean(task.completed);
        default:
          return true;
      }
    });
    const sorter = (a: Task, b: Task) => {
      switch (local.taskSort) {
        case 'priority':
          return (a.priority || 10) - (b.priority || 10) || (a.due ?? Infinity) - (b.due ?? Infinity);
        case 'created':
          return b.createdAt - a.createdAt;
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return (a.due ?? Infinity) - (b.due ?? Infinity) || (a.priority || 10) - (b.priority || 10);
      }
    };
    const byUid = new Map(visible.map((task) => [task.uid, task]));
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const task of visible) {
      if (task.parent && byUid.has(task.parent) && task.parent !== task.uid) {
        const list = children.get(task.parent) ?? [];
        list.push(task);
        children.set(task.parent, list);
      } else roots.push(task);
    }
    const sections: { key: string; title: string; tasks: { task: Task; depth: number }[] }[] = [];
    const bucketOf = (task: Task) => {
      if (task.completed) return 'done';
      const key = dueKey(task);
      if (key === null) return 'none';
      if (key < todayKey) return 'overdue';
      if (key === todayKey) return 'today';
      if (key === addDays(todayKey, 1)) return 'tomorrow';
      if (key < addDays(todayKey, 7)) return 'week';
      return 'later';
    };
    const titles: Record<string, string> = {
      overdue: t('Überfällig'),
      today: t('Heute'),
      tomorrow: t('Morgen'),
      week: t('Nächste 7 Tage'),
      later: t('Später'),
      none: t('Ohne Datum'),
      done: t('Erledigt'),
    };
    const order = local.taskSort === 'due' ? ['overdue', 'today', 'tomorrow', 'week', 'later', 'none', 'done'] : ['all', 'done'];
    const flatten = (task: Task, depth: number, out: { task: Task; depth: number }[], seen: Set<string>) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      out.push({ task, depth });
      for (const child of (children.get(task.uid) ?? []).sort(sorter)) flatten(child, depth + 1, out, seen);
    };
    for (const bucket of order) {
      const list = roots.filter((task) => (bucket === 'all' ? !task.completed : bucketOf(task) === bucket)).sort(sorter);
      if (!list.length) continue;
      const out: { task: Task; depth: number }[] = [];
      const seen = new Set<string>();
      for (const task of list) flatten(task, 0, out, seen);
      sections.push({ key: bucket, title: bucket === 'all' ? t('Offen') : titles[bucket], tasks: out });
    }
    return sections;
  }, [tasks, filter, local.taskSort, calendars, todayKey, me]);

  const boardTasks = useMemo(() => {
    if (!tasks || !board) return [];
    const recent = Date.now() - 14 * 86_400_000;
    const visible = tasks.filter((task) => {
      if (calendars.get(task.calendarId)?.hidden) return false;
      const key = dueKey(task);
      if (filter === 'today') return key !== null && key <= todayKey;
      if (filter === 'overdue') return key !== null && key < todayKey && !task.completed;
      if (filter === 'upcoming') return key !== null && key > todayKey;
      if (filter === 'mine') return task.assignee?.id === me;
      return true;
    });
    const open = visible
      .filter((task) => !task.completed)
      .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || (a.priority || 10) - (b.priority || 10));
    const finished = visible
      .filter((task) => task.completed && task.completed >= recent)
      .sort((a, b) => (b.completed ?? 0) - (a.completed ?? 0))
      .slice(0, 50);
    return [...open, ...finished];
  }, [tasks, board, calendars, filter, todayKey, me]);

  const move = async (task: Task, column: Column) => {
    if (task.readOnly || columnOf(task) === column) return;
    setTasks(
      (list) =>
        list?.map((entry) =>
          entry.id === task.id
            ? {
                ...entry,
                completed: column === 'done' ? Date.now() : null,
                status: column === 'done' ? 'COMPLETED' : column === 'progress' ? 'IN-PROCESS' : 'NEEDS-ACTION',
              }
            : entry
        ) ?? null
    );
    try {
      if (column === 'done') await calendarApi.complete(task.id, true, null);
      else await calendarApi.update(task.id, { completed: false, status: column === 'progress' ? 'IN-PROCESS' : 'NEEDS-ACTION' });
      invalidate();
    } catch (error) {
      toast(errorText(error));
      invalidate();
    }
  };

  const toggle = async (task: Task) => {
    const completed = !task.completed;
    setTasks(
      (list) => list?.map((entry) => (entry.id === task.id ? { ...entry, completed: completed ? Date.now() : null } : entry)) ?? null
    );
    try {
      await calendarApi.complete(task.id, completed, null);
      invalidate();
      if (completed)
        toast(t('Erledigt'), {
          action: { label: t('Rückgängig'), onClick: () => void calendarApi.complete(task.id, false, null).then(invalidate) },
        });
    } catch (error) {
      toast(errorText(error));
      invalidate();
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    const calendar = defaultCalendar('VTODO');
    if (!calendar) {
      toast(t('Lege zuerst einen Kalender an, der Aufgaben aufnehmen kann'));
      return;
    }
    const parsed = parseQuick(text, todayKey, { nowMinutes: minuteOf(Date.now()) });
    const date = parsed.date ?? todayKey;
    const hasDate = parsed.date !== null || parsed.start !== null;
    const due = !hasDate ? null : parsed.start !== null ? at(date, parsed.start) : date;
    setDraft('');
    try {
      await calendarApi.create({
        calendarId: calendar.id,
        component: 'VTODO',
        title: parsed.title || text,
        allDay: parsed.start === null,
        due,
        rrule: parsed.rrule,
        categories: parsed.tags,
        priority: /!!!/.test(text) ? 1 : /!!/.test(text) ? 5 : 0,
      });
      invalidate();
    } catch (error) {
      setDraft(text);
      toast(errorText(error));
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    }
  };

  const filters: [Prefs['taskFilter'], string][] = [
    ['open', t('Offen')],
    ['today', t('Heute fällig')],
    ['overdue', t('Überfällig')],
    ['upcoming', t('Demnächst')],
    ...(tasks?.some((task) => task.assignee) || filter === 'mine' ? [['mine', t('Mir zugewiesen')] as [Prefs['taskFilter'], string]] : []),
    ...(board
      ? []
      : ([
          ['done', t('Erledigt')],
          ['all', t('Alle')],
        ] as [Prefs['taskFilter'], string][])),
  ];
  const sorts: [Prefs['taskSort'], string][] = [
    ['due', t('Nach Fälligkeit')],
    ['priority', t('Nach Priorität')],
    ['created', t('Neueste zuerst')],
    ['title', t('Nach Titel')],
  ];
  const count = groups.reduce((sum, group) => sum + (group.key === 'done' ? 0 : group.tasks.length), 0);

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: board ? 1200 : 820, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            height: 56,
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          <AddRounded sx={{ color: c.onSurfaceVariant }} />
          <InputBase
            fullWidth
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            placeholder={t('Aufgabe hinzufügen, z. B. „Steuer abgeben Freitag 10 Uhr #Büro“')}
            inputProps={{ 'aria-label': t('Aufgabe hinzufügen') }}
          />
          {draft.trim() && (
            <Tooltip title={t('Hinzufügen')}>
              <IconButton
                onClick={() => void add()}
                aria-label={t('Hinzufügen')}
                sx={{ bgcolor: c.primary, color: c.onPrimary, '&:hover': { bgcolor: c.primary } }}
              >
                <CheckRounded />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {filters.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              onClick={() => setPrefs({ taskFilter: value })}
              color={filter === value ? 'primary' : 'default'}
              variant={filter === value ? 'filled' : 'outlined'}
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={board ? t('Als Liste zeigen') : t('Als Board zeigen')}>
            <IconButton
              aria-label={board ? t('Als Liste zeigen') : t('Als Board zeigen')}
              onClick={() =>
                setPrefs({
                  taskLayout: board ? 'list' : 'board',
                  ...(!board && (filter === 'done' || filter === 'all') ? { taskFilter: 'open' as const } : {}),
                })
              }
            >
              {board ? <ViewListRounded /> : <ViewKanbanRounded />}
            </IconButton>
          </Tooltip>
          {!board && (
            <Tooltip title={t('Sortieren')}>
              <IconButton aria-label={t('Sortieren')} onClick={(event) => setSortMenu(event.currentTarget)}>
                <SortRounded />
              </IconButton>
            </Tooltip>
          )}
          <Menu anchorEl={sortMenu} open={Boolean(sortMenu)} onClose={() => setSortMenu(null)}>
            {sorts.map(([value, label]) => (
              <MenuItem
                key={value}
                selected={local.taskSort === value}
                onClick={() => {
                  setPrefs({ taskSort: value });
                  setSortMenu(null);
                }}
              >
                <ListItemIcon>{local.taskSort === value && <CheckRounded />}</ListItemIcon>
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Box>
        {tasks === null && <LinearProgress />}
        {tasks !== null && board && (
          <TaskBoard
            tasks={boardTasks}
            calendars={calendars}
            todayKey={todayKey}
            onOpen={onOpen}
            onMove={(task, column) => void move(task, column)}
            onToggle={(task) => void toggle(task)}
          />
        )}
        {tasks !== null && !board && !groups.length && (
          <EmptyState
            icon={<TaskAltRounded />}
            title={filter === 'done' ? t('Noch nichts erledigt') : t('Alles erledigt')}
            text={t('Neue Aufgaben schreibst du einfach oben ins Feld. Datum, Uhrzeit und #Schlagwörter erkennt MoeCloud von selbst.')}
          />
        )}
        {tasks !== null && !board && count > 0 && filter !== 'done' && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 1 }}>
            {tn(count, '1 offene Aufgabe', '{count} offene Aufgaben')}
          </Typography>
        )}
        {!board &&
          groups.map((group) => (
            <Box key={group.key} component="section" aria-label={group.title}>
              <Typography
                variant="overline"
                component="h2"
                sx={{ px: 1, color: group.key === 'overdue' ? c.error : c.onSurfaceVariant, fontWeight: 800 }}
              >
                {group.title} · {group.tasks.length}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: `${radius.lg}px`,
                  bgcolor: c.surfaceContainerLowest,
                  border: `1px solid ${c.outlineVariant}`,
                  overflow: 'hidden',
                }}
              >
                {group.tasks.map(({ task, depth }, index) => {
                  const calendar = calendars.get(task.calendarId);
                  const color = task.color ?? calendar?.color ?? c.primary;
                  const key = dueKey(task);
                  const overdue = !task.completed && key !== null && key < todayKey;
                  const priority = PRIORITY_COLOR(task.priority);
                  return (
                    <Box
                      key={task.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        pl: 1 + depth * 3.5,
                        pr: 1.5,
                        py: 1,
                        borderTop: index ? `1px solid ${c.outlineVariant}` : 'none',
                        '&:hover': { bgcolor: mix(c.onSurface, 4) },
                      }}
                    >
                      {depth > 0 && <SubdirectoryArrowRightRounded sx={{ fontSize: 18, color: c.onSurfaceVariant, mt: 1 }} />}
                      <IconButton
                        role="checkbox"
                        aria-checked={Boolean(task.completed)}
                        aria-label={t('„{title}“ erledigt', { title: task.title })}
                        disabled={task.readOnly}
                        onClick={() => void toggle(task)}
                        sx={{ color, mt: -0.25 }}
                      >
                        {task.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
                      </IconButton>
                      <ButtonBase
                        onClick={() => onOpen(task)}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          textAlign: 'left',
                          py: 0.5,
                          borderRadius: `${radius.sm}px`,
                        }}
                      >
                        <Typography
                          sx={{
                            fontWeight: 600,
                            textDecoration: task.completed ? 'line-through' : 'none',
                            color: task.completed ? c.onSurfaceVariant : c.onSurface,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {task.title || t('(Ohne Titel)')}
                        </Typography>
                        {task.description && (
                          <Typography
                            variant="body2"
                            sx={{
                              color: c.onSurfaceVariant,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {task.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          {key && (
                            <Typography
                              variant="caption"
                              sx={{ fontWeight: 700, color: overdue ? c.error : key === todayKey ? c.primary : c.onSurfaceVariant }}
                            >
                              {relativeDay(key) ?? formatDateShort(key)}
                              {!task.allDay && task.due !== null ? `, ${formatTime(task.due)}` : ''}
                            </Typography>
                          )}
                          {task.recurring && <EventRepeatRounded sx={{ fontSize: 14, color: c.onSurfaceVariant }} />}
                          {priority && (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', color: priority }}>
                              <FlagRounded sx={{ fontSize: 15 }} />
                            </Box>
                          )}
                          {task.categories.map((category) => (
                            <Box
                              key={category}
                              component="span"
                              sx={{ fontSize: 12, px: 0.75, borderRadius: `${radius.xs}px`, bgcolor: mix(color, 16), color: c.onSurface }}
                            >
                              #{category}
                            </Box>
                          ))}
                          {task.percent > 0 && task.percent < 100 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <LinearProgress variant="determinate" value={task.percent} sx={{ width: 48, height: 4, borderRadius: 2 }} />
                              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                                {task.percent} %
                              </Typography>
                            </Box>
                          )}
                          {calendar && (
                            <Box
                              component="span"
                              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: c.onSurfaceVariant }}
                            >
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: calendar.color }} />
                              {calendar.name}
                            </Box>
                          )}
                          {task.assignee && (
                            <Box
                              component="span"
                              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: c.onSurfaceVariant }}
                            >
                              <UserAvatar initials={task.assignee.initials} size={18} />
                              {task.assignee.id === me ? t('Du') : task.assignee.name}
                            </Box>
                          )}
                        </Box>
                      </ButtonBase>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
      </Box>
    </Box>
  );
}
