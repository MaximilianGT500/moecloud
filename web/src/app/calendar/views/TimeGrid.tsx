import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { MOON_SYMBOL, moonPhases } from '../../../../../shared/moon';
import { utcOf, wallOf } from '../../../../../shared/time';
import { t } from '../../../lib/i18n';
import { c, curve, mix, radius } from '../../../theme/tokens';
import {
  addDays,
  at,
  dayNumber,
  dayStart,
  formatHour,
  formatTime,
  formatTimeShort,
  getZone,
  keyOf,
  minuteOf,
  today,
  weekOf,
  weekdayOf,
  weekdayShort,
} from '../dates';
import { busyStripes, colorOf, tint } from '../colors';
import { Badges, displayTitle, isDeclined, isTentative } from '../display';
import { layoutBars, layoutDay } from '../layout';
import type { CalendarInfo, CalendarPrefs, Occurrence } from '../model';

export interface MoveChange {
  start: number;
  end: number;
  allDay: boolean;
}

export interface GridProps {
  days: string[];
  items: Occurrence[];
  calendars: Map<string, CalendarInfo>;
  prefs: CalendarPrefs;
  hourHeight: number;
  selected?: string | null;
  draft?: MoveChange | null;
  readOnly?: boolean;
  onOpen: (item: Occurrence, anchor: HTMLElement) => void;
  onCreate?: (range: MoveChange, anchor: HTMLElement) => void;
  onMove?: (item: Occurrence, change: MoveChange) => void;
  onToggleTask?: (item: Occurrence) => void;
  onDay?: (day: string) => void;
}

const GUTTER = 58;
const ALLDAY_LANE = 24;

interface Drag {
  item: Occurrence;
  mode: 'move' | 'resize';
  pointer: number;
  startX: number;
  startY: number;
  originDay: number;
  originMinute: number;
  active: boolean;
  timer: number | null;
  touch: boolean;
  deltaMinutes: number;
  deltaDays: number;
  element: HTMLElement;
}

interface Selection {
  day: number;
  anchor: number;
  from: number;
  to: number;
  moved: boolean;
  touch: boolean;
}

const snap = (minutes: number, slot: number) => Math.round(minutes / slot) * slot;

const spanKeys = (item: Occurrence): [string, string] => {
  if (item.allDay && item.startDate && item.endDate) return [item.startDate, addDays(item.endDate, -1)];
  return [keyOf(item.start), keyOf(Math.max(item.start, item.end - 1))];
};

const isLongTimed = (item: Occurrence) =>
  !item.allDay && keyOf(item.start) !== keyOf(Math.max(item.start, item.end - 1)) && item.end - item.start >= 20 * 3_600_000;

export function TimeGrid({
  days,
  items,
  calendars,
  prefs,
  hourHeight,
  selected,
  draft,
  readOnly,
  onOpen,
  onCreate,
  onMove,
  onToggleTask,
  onDay,
}: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef<{ day: number; minute: number; x: number; y: number } | null>(null);
  const todayKey = today();
  const slot = prefs.slot;
  const pxPerMinute = hourHeight / 60;
  const compact = prefs.density === 'compact';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const showsToday = days.includes(todayKey);
    const minute = showsToday ? Math.max(0, minuteOf(Date.now()) - 90) : prefs.scrollTo;
    element.scrollTop = minute * pxPerMinute;
  }, [days.join('|'), hourHeight]);

  const allDayItems = useMemo(() => items.filter((item) => item.allDay || isLongTimed(item)), [items]);
  const timedItems = useMemo(() => items.filter((item) => !item.allDay && !isLongTimed(item)), [items]);
  const bars = useMemo(() => layoutBars(allDayItems, days, spanKeys), [allDayItems, days]);
  const lanesShown = expanded ? bars.lanes : Math.min(bars.lanes, 3);
  const hiddenPerDay = useMemo(() => {
    const counts = days.map(() => 0);
    for (const bar of bars.bars) if (bar.lane >= lanesShown) for (let index = bar.first; index <= bar.last; index++) counts[index]++;
    return counts;
  }, [bars, lanesShown, days]);

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const start = dayStart(day);
        const end = dayStart(addDays(day, 1));
        const list = timedItems.filter(
          (item) => item.start < end && (item.end > start || (item.end === item.start && item.start >= start))
        );
        return { day, start, end, placed: layoutDay(list, minuteOf, start, end, compact ? 15 : 20) };
      }),
    [timedItems, days, compact]
  );

  const moons = useMemo(() => {
    if (!prefs.moon || !days.length) return new Map<string, string>();
    const phases = moonPhases(dayStart(days[0]), dayStart(addDays(days[days.length - 1], 1)));
    return new Map(phases.map((phase) => [keyOf(phase.utc), MOON_SYMBOL[phase.phase]]));
  }, [prefs.moon, days.join('|')]);

  const columnAt = (clientX: number) => {
    const rect = columns.current?.getBoundingClientRect();
    if (!rect) return 0;
    const index = Math.floor(((clientX - rect.left) / rect.width) * days.length);
    return Math.max(0, Math.min(days.length - 1, index));
  };

  const minuteAt = (clientY: number) => {
    const rect = columns.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1440, (clientY - rect.top) / pxPerMinute));
  };

  const beginSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || !onCreate || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-event]')) return;
    const day = columnAt(event.clientX);
    const minute = Math.floor(minuteAt(event.clientY) / slot) * slot;
    if (event.pointerType === 'touch') {
      tapRef.current = { day, minute, x: event.clientX, y: event.clientY };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: Selection = { day, anchor: minute, from: minute, to: Math.min(1440, minute + slot), moved: false, touch: false };
    selectionRef.current = next;
    setSelection(next);
  };

  const moveSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = selectionRef.current;
    if (!current || current.touch || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const minute = snap(minuteAt(event.clientY), slot);
    const next: Selection =
      minute >= current.anchor
        ? {
            ...current,
            from: current.anchor,
            to: Math.min(1440, Math.max(current.anchor + slot, minute)),
            moved: current.moved || minute > current.anchor + slot,
          }
        : { ...current, from: Math.max(0, minute), to: current.anchor + slot, moved: true };
    selectionRef.current = next;
    setSelection(next);
  };

  function finishSelect() {
    const current = selectionRef.current;
    selectionRef.current = null;
    if (!current || !onCreate) return;
    const day = days[current.day];
    const to = current.moved || current.touch ? current.to : Math.min(1440, current.from + prefs.duration);
    if (to !== current.to) setSelection({ ...current, to });
    const start = at(day, current.from);
    const end = at(day, to);
    requestAnimationFrame(() => {
      if (ghostRef.current) onCreate({ start, end, allDay: false }, ghostRef.current);
    });
  }

  const endSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    tapRef.current = null;
    if (tap && event.pointerType === 'touch') {
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
      const next: Selection = {
        day: tap.day,
        anchor: tap.minute,
        from: tap.minute,
        to: Math.min(1440, tap.minute + prefs.duration),
        moved: false,
        touch: true,
      };
      selectionRef.current = next;
      setSelection(next);
      return;
    }
    if (!selectionRef.current || selectionRef.current.touch) return;
    finishSelect();
  };

  useEffect(() => {
    if (selection?.touch && selectionRef.current) finishSelect();
  }, [selection]);

  useEffect(() => {
    if (!draft) setSelection(null);
  }, [draft]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: Occurrence, mode: 'move' | 'resize') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const element = event.currentTarget;
    const touch = event.pointerType === 'touch';
    const state: Drag = {
      item,
      mode,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originDay: columnAt(event.clientX),
      originMinute: minuteAt(event.clientY),
      active: false,
      timer: null,
      touch,
      deltaMinutes: 0,
      deltaDays: 0,
      element,
    };
    const movable = !readOnly && !item.readOnly && !item.holiday && Boolean(onMove);
    if (movable && touch) {
      state.timer = window.setTimeout(() => {
        state.active = true;
        navigator.vibrate?.(10);
        setDrag({ ...state });
      }, 380);
    }
    dragRef.current = state;
    const move = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current || moveEvent.pointerId !== current.pointer) return;
      const dx = moveEvent.clientX - current.startX;
      const dy = moveEvent.clientY - current.startY;
      if (!current.active) {
        if (Math.hypot(dx, dy) < 5) return;
        if (current.touch || !movable) {
          cleanup();
          return;
        }
        current.active = true;
      }
      moveEvent.preventDefault();
      if (current.item.allDay || isLongTimed(current.item)) {
        current.deltaDays = columnAt(moveEvent.clientX) - current.originDay;
        current.deltaMinutes = 0;
      } else {
        const minutes = minuteAt(moveEvent.clientY) - current.originMinute;
        current.deltaMinutes = snap(minutes, 15);
        current.deltaDays = current.mode === 'move' ? columnAt(moveEvent.clientX) - current.originDay : 0;
      }
      setDrag({ ...current });
    };
    const up = (upEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current || upEvent.pointerId !== current.pointer) return;
      cleanup();
      if (!current.active) {
        onOpen(current.item, current.element);
        return;
      }
      const change = moved(current);
      setDrag(null);
      if (change && (current.deltaMinutes || current.deltaDays)) onMove?.(current.item, change);
    };
    const cancel = () => {
      cleanup();
      setDrag(null);
    };
    function cleanup() {
      if (state.timer) window.clearTimeout(state.timer);
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape);
    }
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cancel();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape);
  };

  function moved(state: Drag): MoveChange | null {
    const item = state.item;
    if (item.allDay && item.startDate && item.endDate) {
      const start = Date.parse(`${addDays(item.startDate, state.deltaDays)}T00:00:00Z`);
      const end = Date.parse(`${addDays(item.endDate, state.deltaDays)}T00:00:00Z`);
      return { start, end, allDay: true };
    }
    const shift = (utc: number, days: number, minutes: number) => {
      const zone = getZone();
      const wall = wallOf(utc, zone);
      const base = utcOf({ ...wall, day: wall.day + days }, zone);
      return base + minutes * 60_000;
    };
    if (state.mode === 'resize') {
      const end = Math.max(item.start + 15 * 60_000, item.end + state.deltaMinutes * 60_000);
      return { start: item.start, end, allDay: false };
    }
    const start = shift(item.start, state.deltaDays, state.deltaMinutes);
    return { start, end: start + (item.end - item.start), allDay: false };
  }

  const preview = drag?.active ? moved(drag) : null;
  const visibleDays = days.length;
  const nowMinute = minuteOf(now);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const zone2 = prefs.zone2;

  const renderBlock = (
    item: Occurrence,
    top: number,
    height: number,
    left: string,
    width: string,
    ghost = false,
    layer = 2,
    stacked = false
  ) => {
    const calendar = calendars.get(item.calendarId);
    const color = colorOf(item, calendar, prefs.colorBy);
    const tentative = isTentative(item);
    const declined = isDeclined(item);
    const past = prefs.dimPast && item.end < now;
    const small = height < 34;
    const title = displayTitle(item, prefs);
    const task = item.component === 'VTODO';
    const timeText = task ? formatTime(item.start) : `${formatTimeShort(item.start)}–${formatTimeShort(item.end)}`;
    const isSelected = selected === item.key;
    return (
      <Box
        key={`${item.key}${ghost ? ':ghost' : ''}`}
        data-event
        role="button"
        tabIndex={ghost ? -1 : 0}
        aria-label={`${title}, ${timeText}`}
        onPointerDown={ghost ? undefined : (event: ReactPointerEvent<HTMLElement>) => startDrag(event, item, 'move')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(item, event.currentTarget);
          }
        }}
        sx={{
          position: 'absolute',
          top,
          height: Math.max(height, 16),
          left,
          width,
          zIndex: ghost ? 30 : isSelected ? 20 : Math.min(19, layer + 1),
          px: 0.75,
          py: small ? 0 : 0.375,
          borderRadius: `${Math.min(radius.sm, Math.max(4, height / 3))}px`,
          bgcolor: item.busyOnly ? undefined : tentative ? c.surfaceContainerLowest : tint(color, declined ? 10 : 30),
          background: item.busyOnly ? busyStripes(color) : undefined,
          border: tentative ? `1.5px dashed ${color}` : `1px solid ${stacked ? c.surfaceContainerLowest : mix(color, 30)}`,
          borderLeft: `3.5px solid ${color}`,
          color: c.onSurface,
          overflow: 'hidden',
          cursor: ghost ? 'grabbing' : 'pointer',
          userSelect: 'none',
          touchAction: drag?.active ? 'none' : 'auto',
          opacity: ghost ? 0.92 : past ? 0.55 : 1,
          boxShadow: ghost || isSelected ? `0 6px 18px ${mix(c.shadow, 35)}` : stacked ? `0 0 0 1px ${c.surfaceContainerLowest}` : 'none',
          outline: isSelected ? `2px solid ${color}` : 'none',
          outlineOffset: 1,
          transition: ghost ? 'none' : `box-shadow 160ms ${curve.standard}, filter 160ms`,
          '&:hover': { filter: 'brightness(1.06)' },
          '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
          textDecoration: declined ? 'line-through' : 'none',
        }}
      >
        {small ? (
          <Typography noWrap sx={{ fontSize: 11.5, lineHeight: `${Math.max(14, height - 2)}px`, fontWeight: 700 }}>
            {task && (item.completed ? '☑ ' : '☐ ')}
            {title}
            <Box component="span" sx={{ fontWeight: 500, opacity: 0.75 }}>
              {`, ${timeText}`}
            </Box>
          </Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
              {task && onToggleTask && !ghost && (
                <Box
                  component="span"
                  role="checkbox"
                  aria-checked={item.completed}
                  aria-label={t('Erledigt')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleTask(item);
                  }}
                  sx={{ display: 'inline-flex', mt: '1px', color, '& svg': { fontSize: 15 } }}
                >
                  {item.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
                </Box>
              )}
              <Typography
                sx={{
                  fontSize: 12.5,
                  lineHeight: 1.25,
                  fontWeight: 700,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: height > 60 ? 3 : 1,
                  WebkitBoxOrient: 'vertical',
                  textDecoration: item.completed ? 'line-through' : undefined,
                  wordBreak: 'break-word',
                }}
              >
                {title}
              </Typography>
            </Box>
            <Typography noWrap sx={{ fontSize: 11.5, lineHeight: 1.35, opacity: 0.8 }}>
              {timeText}
              {item.location && height > 48 ? ` · ${item.location}` : ''}
            </Typography>
            {height > 64 && (
              <Box sx={{ mt: 0.25 }}>
                <Badges item={item} />
              </Box>
            )}
          </>
        )}
        {!ghost && !readOnly && !item.readOnly && !task && height > 22 && onMove && (
          <Box
            aria-hidden
            onPointerDown={(event) => startDrag(event, item, 'resize')}
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 8,
              cursor: 'ns-resize',
              '&::after': {
                content: '""',
                position: 'absolute',
                left: '50%',
                bottom: 2,
                width: 18,
                ml: '-9px',
                height: 3,
                borderRadius: 2,
                bgcolor: mix(c.onSurface, 30),
                opacity: 0,
              },
              '&:hover::after': { opacity: 1 },
            }}
          />
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        userSelect: drag?.active || selection ? 'none' : 'auto',
      }}
    >
      <Box sx={{ display: 'flex', borderBottom: `1px solid ${c.outlineVariant}`, flex: 'none', pr: '8px' }}>
        <Box sx={{ width: GUTTER, flex: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 1 }}>
          {prefs.weekNumbers && days.length > 1 && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant, fontWeight: 700 }}>
              {t('KW {week}', { week: weekOf(days[0]) })}
            </Typography>
          )}
        </Box>
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${visibleDays}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const isToday = day === todayKey;
            const weekend = [0, 6].includes(weekdayOf(day));
            return (
              <ButtonBase
                key={day}
                onClick={() => onDay?.(day)}
                disabled={!onDay}
                sx={{
                  flexDirection: 'column',
                  py: 1,
                  gap: 0.25,
                  borderRadius: `${radius.md}px`,
                  color: isToday ? c.primary : weekend ? c.onSurfaceVariant : c.onSurface,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
                  {weekdayShort(day)}
                  {moons.get(day) ? ` ${moons.get(day)}` : ''}
                </Typography>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 22,
                    fontWeight: 800,
                    bgcolor: isToday ? c.primary : 'transparent',
                    color: isToday ? c.onPrimary : 'inherit',
                    transition: `background-color 200ms ${curve.standard}`,
                  }}
                >
                  {dayNumber(day)}
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      {(bars.lanes > 0 || !readOnly) && (
        <Box
          sx={{ display: 'flex', borderBottom: `1px solid ${c.outlineVariant}`, flex: 'none', pr: '8px', bgcolor: c.surfaceContainerLow }}
        >
          <Box
            sx={{
              width: GUTTER,
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              py: 0.5,
            }}
          >
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant, fontSize: 10.5, textAlign: 'center', lineHeight: 1.2 }}>
              {t('Ganztägig')}
            </Typography>
            {bars.lanes > 3 && (
              <Tooltip title={expanded ? t('Weniger zeigen') : t('Alle zeigen')}>
                <IconButton
                  size="small"
                  onClick={() => setExpanded((value) => !value)}
                  aria-label={expanded ? t('Weniger zeigen') : t('Alle zeigen')}
                >
                  {expanded ? <ExpandLessRounded fontSize="small" /> : <ExpandMoreRounded fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
          </Box>
          <Box
            sx={{
              flex: 1,
              position: 'relative',
              minHeight: Math.max(28, lanesShown * ALLDAY_LANE + 6 + (hiddenPerDay.some(Boolean) ? 18 : 0)),
            }}
            onDoubleClick={(event) => {
              if (readOnly || !onCreate || (event.target as HTMLElement).closest('[data-event]')) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const index = Math.max(0, Math.min(days.length - 1, Math.floor(((event.clientX - rect.left) / rect.width) * days.length)));
              const day = days[index];
              onCreate(
                { start: Date.parse(`${day}T00:00:00Z`), end: Date.parse(`${addDays(day, 1)}T00:00:00Z`), allDay: true },
                event.currentTarget
              );
            }}
          >
            {bars.bars
              .filter((bar) => bar.lane < lanesShown)
              .map((bar) => {
                const item = bar.item;
                const shift = drag?.active && drag.item.key === item.key ? drag.deltaDays : 0;
                const first = Math.max(0, Math.min(days.length - 1, bar.first + shift));
                const last = Math.max(first, Math.min(days.length - 1, bar.last + shift));
                const calendar = calendars.get(item.calendarId);
                const color = colorOf(item, calendar, prefs.colorBy);
                const title = displayTitle(item, prefs);
                const tentative = isTentative(item);
                return (
                  <Box
                    key={item.key}
                    data-event
                    role="button"
                    tabIndex={0}
                    aria-label={title}
                    onPointerDown={(event: ReactPointerEvent<HTMLElement>) => startDrag(event, item, 'move')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpen(item, event.currentTarget);
                    }}
                    sx={{
                      position: 'absolute',
                      top: 3 + bar.lane * ALLDAY_LANE,
                      height: ALLDAY_LANE - 3,
                      left: `calc(${(first / days.length) * 100}% + 2px)`,
                      width: `calc(${((last - first + 1) / days.length) * 100}% - 4px)`,
                      borderRadius: `${radius.xs + 2}px`,
                      borderTopLeftRadius: bar.clippedStart ? 0 : undefined,
                      borderBottomLeftRadius: bar.clippedStart ? 0 : undefined,
                      borderTopRightRadius: bar.clippedEnd ? 0 : undefined,
                      borderBottomRightRadius: bar.clippedEnd ? 0 : undefined,
                      bgcolor: item.holiday ? tint(color, 22) : tentative ? c.surfaceContainerLowest : tint(color, 34),
                      border: tentative ? `1.5px dashed ${color}` : 'none',
                      borderLeft: item.holiday || bar.clippedStart ? undefined : `3.5px solid ${color}`,
                      px: 0.75,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      zIndex: shift ? 10 : 1,
                      boxShadow: selected === item.key || shift ? `0 4px 12px ${mix(c.shadow, 30)}` : 'none',
                      opacity: prefs.dimPast && item.end < now && !item.holiday ? 0.6 : 1,
                      textDecoration: isDeclined(item) ? 'line-through' : 'none',
                      '&:hover': { filter: 'brightness(1.06)' },
                    }}
                  >
                    {item.component === 'VTODO' && (
                      <Box
                        component="span"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleTask?.(item);
                        }}
                        sx={{ display: 'inline-flex', color, '& svg': { fontSize: 15 } }}
                      >
                        {item.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
                      </Box>
                    )}
                    <Typography
                      noWrap
                      sx={{ fontSize: 12.5, fontWeight: 700, textDecoration: item.completed ? 'line-through' : undefined }}
                    >
                      {!item.allDay && `${formatTimeShort(item.start)} `}
                      {title}
                    </Typography>
                  </Box>
                );
              })}
            {hiddenPerDay.map((count, index) =>
              count ? (
                <ButtonBase
                  key={days[index]}
                  onClick={() => setExpanded(true)}
                  sx={{
                    position: 'absolute',
                    top: 3 + lanesShown * ALLDAY_LANE,
                    left: `calc(${(index / days.length) * 100}% + 4px)`,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: c.onSurfaceVariant,
                    borderRadius: `${radius.xs}px`,
                    px: 0.5,
                  }}
                >
                  {t('+{count} weitere', { count })}
                </ButtonBase>
              ) : null
            )}
          </Box>
        </Box>
      )}

      <Box
        ref={scroller}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', scrollbarGutter: 'stable' }}
      >
        <Box sx={{ display: 'flex', position: 'relative', height: 24 * hourHeight }}>
          <Box sx={{ width: GUTTER, flex: 'none', position: 'relative' }}>
            {hours.map((hour) => (
              <Box key={hour} sx={{ position: 'absolute', top: hour * hourHeight - 7, right: 8, textAlign: 'right' }}>
                {hour > 0 && (
                  <>
                    <Typography sx={{ fontSize: 11, color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                      {formatHour(hour)}
                    </Typography>
                    {zone2 && (
                      <Typography sx={{ fontSize: 10, color: c.tertiary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                        {formatTime(at(days[0] ?? todayKey, hour * 60), zone2)}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            ))}
          </Box>
          <Box
            ref={columns}
            onPointerDown={beginSelect}
            onPointerMove={moveSelect}
            onPointerUp={endSelect}
            onPointerCancel={() => {
              tapRef.current = null;
            }}
            sx={{
              flex: 1,
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `repeat(${visibleDays}, minmax(0, 1fr))`,
              backgroundImage: `repeating-linear-gradient(to bottom, ${c.outlineVariant} 0, ${c.outlineVariant} 1px, transparent 1px, transparent ${hourHeight}px)`,
              cursor: readOnly ? 'default' : 'cell',
            }}
          >
            {perDay.map(({ day, placed }, index) => {
              const work = prefs.workDays.includes(weekdayOf(day));
              const isToday = day === todayKey;
              return (
                <Box
                  key={day}
                  sx={{
                    position: 'relative',
                    borderLeft: `1px solid ${c.outlineVariant}`,
                    bgcolor: isToday ? mix(c.primary, 3) : undefined,
                  }}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <Box
                      key={hour}
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: hour * hourHeight + hourHeight / 2,
                        borderTop: `1px dashed ${mix(c.outlineVariant, 55)}`,
                      }}
                    />
                  ))}
                  {(!work || prefs.workStart > 0) && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: 0,
                        height: work ? prefs.workStart * pxPerMinute : '100%',
                        bgcolor: mix(c.onSurface, 3),
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {work && prefs.workEnd < 1440 && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: prefs.workEnd * pxPerMinute,
                        bottom: 0,
                        bgcolor: mix(c.onSurface, 3),
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {placed.map((entry) => {
                    if (drag?.active && drag.item.key === entry.item.key) return null;
                    const top = entry.top * pxPerMinute + 1;
                    const height = Math.max(entry.bottom - entry.top, compact ? 15 : 20) * pxPerMinute - 2;
                    const left = `calc(${entry.left * 100}% + 1px)`;
                    const width = `calc(${entry.width * 100}% - ${entry.left + entry.width < 0.999 ? 2 : 6}px)`;
                    return renderBlock(entry.item, top, height, left, width, false, entry.z, entry.stacked);
                  })}
                  {selection && selection.day === index && (
                    <Box
                      ref={ghostRef}
                      sx={{
                        position: 'absolute',
                        left: 2,
                        right: 4,
                        top: selection.from * pxPerMinute,
                        height: (selection.to - selection.from) * pxPerMinute,
                        borderRadius: `${radius.sm}px`,
                        bgcolor: mix(c.primary, 22),
                        border: `2px solid ${c.primary}`,
                        zIndex: 25,
                        px: 0.75,
                        pointerEvents: 'none',
                      }}
                    >
                      <Typography sx={{ fontSize: 12, fontWeight: 700, color: c.onSurface }}>
                        {formatTimeShort(at(day, selection.from))}–{formatTimeShort(at(day, Math.min(1440, selection.to)))}
                      </Typography>
                    </Box>
                  )}
                  {preview &&
                    drag &&
                    !drag.item.allDay &&
                    !isLongTimed(drag.item) &&
                    keyOf(preview.start) === day &&
                    renderBlock(
                      { ...drag.item, start: preview.start, end: preview.end },
                      minuteOf(preview.start) * pxPerMinute,
                      Math.max(15, (preview.end - preview.start) / 60_000) * pxPerMinute - 2,
                      '2px',
                      'calc(100% - 6px)',
                      true
                    )}
                  {isToday && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: -5,
                        right: 0,
                        top: nowMinute * pxPerMinute - 1,
                        height: 2,
                        bgcolor: c.error,
                        zIndex: 15,
                        pointerEvents: 'none',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          left: 0,
                          top: -4,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          bgcolor: c.error,
                        },
                      }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
