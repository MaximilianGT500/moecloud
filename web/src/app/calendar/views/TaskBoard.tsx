import { useState, type DragEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { t } from '../../../lib/i18n';
import { c, mix, radius } from '../../../theme/tokens';
import { UserAvatar } from '../../common/bits';
import { formatDateShort, formatTime, keyOf, relativeDay } from '../dates';
import type { CalendarInfo, Task } from '../model';

export type Column = 'open' | 'progress' | 'done';

export const columnOf = (task: Task): Column => (task.completed ? 'done' : task.status === 'IN-PROCESS' ? 'progress' : 'open');

const PRIORITY_COLOR = (priority: number) => (priority === 0 ? null : priority <= 4 ? '#ef4444' : priority === 5 ? '#f59e0b' : '#3b82f6');

function dueKey(task: Task) {
  if (task.due === null) return null;
  return task.allDay ? new Date(task.due).toISOString().slice(0, 10) : keyOf(task.due);
}

function Card({
  task,
  calendar,
  todayKey,
  onOpen,
  onMove,
  onToggle,
}: {
  task: Task;
  calendar: CalendarInfo | undefined;
  todayKey: string;
  onOpen: (task: Task) => void;
  onMove: (task: Task, column: Column) => void;
  onToggle: (task: Task) => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const color = task.color ?? calendar?.color ?? c.primary;
  const key = dueKey(task);
  const overdue = !task.completed && key !== null && key < todayKey;
  const priority = PRIORITY_COLOR(task.priority);
  const current = columnOf(task);
  const targets: [Column, string][] = (
    [
      ['open', t('Offen')],
      ['progress', t('In Arbeit')],
      ['done', t('Erledigt')],
    ] as [Column, string][]
  ).filter(([column]) => column !== current);
  return (
    <Box
      data-board-card={task.title}
      draggable={!task.readOnly}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData('text/x-moecloud-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        p: 1,
        borderRadius: `${radius.md}px`,
        bgcolor: c.surfaceContainerLowest,
        border: `1px solid ${c.outlineVariant}`,
        borderLeft: `4px solid ${color}`,
        cursor: task.readOnly ? 'default' : 'grab',
        '&:hover': { borderColor: mix(color, 60), borderLeftColor: color },
      }}
    >
      <IconButton
        role="checkbox"
        aria-checked={Boolean(task.completed)}
        aria-label={t('„{title}“ erledigt', { title: task.title })}
        disabled={task.readOnly}
        onClick={() => onToggle(task)}
        size="small"
        sx={{ color }}
      >
        {task.completed ? <CheckCircleRounded fontSize="small" /> : <RadioButtonUncheckedRounded fontSize="small" />}
      </IconButton>
      <ButtonBase
        onClick={() => onOpen(task)}
        sx={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'column',
          alignItems: 'flex-start',
          textAlign: 'left',
          py: 0.25,
          borderRadius: `${radius.sm}px`,
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            overflowWrap: 'anywhere',
            textDecoration: task.completed ? 'line-through' : 'none',
            color: task.completed ? c.onSurfaceVariant : c.onSurface,
          }}
        >
          {task.title || t('(Ohne Titel)')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
          {key && task.due !== null && (
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, color: overdue ? c.error : key === todayKey ? c.primary : c.onSurfaceVariant }}
            >
              {relativeDay(key) ?? formatDateShort(key)}
              {!task.allDay ? `, ${formatTime(task.due)}` : ''}
            </Typography>
          )}
          {task.recurring && <EventRepeatRounded sx={{ fontSize: 14, color: c.onSurfaceVariant }} />}
          {priority && <FlagRounded sx={{ fontSize: 15, color: priority }} />}
          {task.categories.slice(0, 3).map((category) => (
            <Box key={category} component="span" sx={{ fontSize: 11, px: 0.75, borderRadius: `${radius.xs}px`, bgcolor: mix(color, 16) }}>
              #{category}
            </Box>
          ))}
          {calendar && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap>
              {calendar.name}
            </Typography>
          )}
        </Box>
      </ButtonBase>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        {task.assignee && (
          <Tooltip title={t('Zuständig: {name}', { name: task.assignee.name })}>
            <Box>
              <UserAvatar initials={task.assignee.initials} size={24} />
            </Box>
          </Tooltip>
        )}
        {!task.readOnly && (
          <>
            <Tooltip title={t('Status ändern')}>
              <IconButton
                size="small"
                aria-label={t('Status von „{title}“ ändern', { title: task.title })}
                onClick={(event) => setMenu(event.currentTarget)}
              >
                <MoreHorizRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
              {targets.map(([column, label]) => (
                <MenuItem
                  key={column}
                  onClick={() => {
                    setMenu(null);
                    onMove(task, column);
                  }}
                >
                  <ListItemText>{t('Nach „{column}“ verschieben', { column: label })}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Box>
    </Box>
  );
}

export function TaskBoard({
  tasks,
  calendars,
  todayKey,
  onOpen,
  onMove,
  onToggle,
}: {
  tasks: Task[];
  calendars: Map<string, CalendarInfo>;
  todayKey: string;
  onOpen: (task: Task) => void;
  onMove: (task: Task, column: Column) => void;
  onToggle: (task: Task) => void;
}) {
  const [over, setOver] = useState<Column | null>(null);
  const columns: [Column, string][] = [
    ['open', t('Offen')],
    ['progress', t('In Arbeit')],
    ['done', t('Erledigt')],
  ];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return (
    <Box
      data-task-board
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
        gap: 1.5,
        alignItems: 'start',
      }}
    >
      {columns.map(([column, title]) => {
        const list = tasks.filter((task) => columnOf(task) === column);
        return (
          <Box
            key={column}
            component="section"
            aria-label={title}
            data-board-column={column}
            onDragOver={(event: DragEvent) => {
              if (!event.dataTransfer.types.includes('text/x-moecloud-task')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOver(column);
            }}
            onDragLeave={() => setOver((value) => (value === column ? null : value))}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              setOver(null);
              const task = byId.get(event.dataTransfer.getData('text/x-moecloud-task'));
              if (task) onMove(task, column);
            }}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              p: 1,
              minHeight: 160,
              borderRadius: `${radius.lg}px`,
              bgcolor: over === column ? mix(c.primary, 12) : c.surfaceContainerLow,
              outline: over === column ? `2px dashed ${c.primary}` : 'none',
              transition: 'background-color 120ms',
            }}
          >
            <Typography variant="overline" component="h2" sx={{ px: 0.5, fontWeight: 800, color: c.onSurfaceVariant }}>
              {title} · {list.length}
            </Typography>
            {list.map((task) => (
              <Card
                key={task.id}
                task={task}
                calendar={calendars.get(task.calendarId)}
                todayKey={todayKey}
                onOpen={onOpen}
                onMove={onMove}
                onToggle={onToggle}
              />
            ))}
            {!list.length && (
              <Typography variant="caption" sx={{ px: 0.5, py: 2, color: c.onSurfaceVariant, textAlign: 'center' }}>
                {column === 'progress' ? t('Zieh Aufgaben hierher, an denen du gerade sitzt.') : t('Nichts hier.')}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
