import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { MOON_SYMBOL, moonPhases } from '../../../../../shared/moon';
import { utcOf, wallOf } from '../../../../../shared/time';
import { t } from '../../../lib/i18n';
import { c, mix, radius } from '../../../theme/tokens';
import {
  addDays,
  dayNumber,
  dayStart,
  formatDayLong,
  formatTimeShort,
  getZone,
  keyOf,
  monthName,
  parseKey,
  today,
  weekOf,
  weekdayName,
  weekdayOf,
} from '../dates';
import { colorOf, tint } from '../colors';
import { displayTitle, isDeclined, isTentative } from '../display';
import { layoutBars } from '../layout';
import type { CalendarInfo, CalendarPrefs, Occurrence } from '../model';
import type { MoveChange } from './TimeGrid';

interface Props {
  days: string[];
  month: number;
  items: Occurrence[];
  calendars: Map<string, CalendarInfo>;
  prefs: CalendarPrefs;
  selected?: string | null;
  readOnly?: boolean;
  onOpen: (item: Occurrence, anchor: HTMLElement) => void;
  onCreate?: (range: MoveChange, anchor: HTMLElement) => void;
  onMove?: (item: Occurrence, change: MoveChange) => void;
  onToggleTask?: (item: Occurrence) => void;
  onDay: (day: string) => void;
}

const LANE = 22;
const HEAD = 30;

const spanOf = (item: Occurrence): [string, string] => {
  if (item.allDay && item.startDate && item.endDate) return [item.startDate, addDays(item.endDate, -1)];
  return [keyOf(item.start), keyOf(Math.max(item.start, item.end - 1))];
};

const multi = (item: Occurrence) => {
  const [from, to] = spanOf(item);
  return item.allDay || from !== to;
};

interface Drag {
  item: Occurrence;
  pointer: number;
  x: number;
  y: number;
  origin: number;
  delta: number;
  active: boolean;
  element: HTMLElement;
}

export function MonthView({
  days,
  month,
  items,
  calendars,
  prefs,
  selected,
  readOnly,
  onOpen,
  onCreate,
  onMove,
  onToggleTask,
  onDay,
}: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  const [more, setMore] = useState<{ day: string; anchor: HTMLElement } | null>(null);
  const [range, setRange] = useState<{ anchor: number; from: number; to: number } | null>(null);
  const rangeRef = useRef<typeof range>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const todayKey = today();
  const now = Date.now();

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const weeks = useMemo(
    () => Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7)),
    [days]
  );
  const rowHeight = Math.max(72, height / weeks.length);
  const lanes = Math.max(1, Math.floor((rowHeight - HEAD - 4) / LANE));

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(multi(b)) - Number(multi(a)) || Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title)
      ),
    [items]
  );

  const rows = useMemo(
    () =>
      weeks.map((week) => {
        const layout = layoutBars(sorted, week, spanOf);
        const hidden = week.map(() => 0);
        for (const bar of layout.bars)
          if (bar.lane >= lanes - 1 && layout.lanes > lanes) for (let index = bar.first; index <= bar.last; index++) hidden[index]++;
        return { week, layout, hidden, shown: layout.lanes > lanes ? lanes - 1 : lanes };
      }),
    [weeks, sorted, lanes]
  );

  const moons = useMemo(() => {
    if (!prefs.moon || !days.length) return new Map<string, string>();
    return new Map(
      moonPhases(dayStart(days[0]), dayStart(addDays(days[days.length - 1], 1))).map((phase) => [
        keyOf(phase.utc),
        MOON_SYMBOL[phase.phase],
      ])
    );
  }, [prefs.moon, days.join('|')]);

  const indexAt = (clientX: number, clientY: number) => {
    const rect = grid.current?.getBoundingClientRect();
    if (!rect) return 0;
    const column = Math.max(0, Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7)));
    const row = Math.max(0, Math.min(weeks.length - 1, Math.floor(((clientY - rect.top) / rect.height) * weeks.length)));
    return row * 7 + column;
  };

  const startRange = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || !onCreate || event.button !== 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement).closest('[data-event],[data-day]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event.clientX, event.clientY);
    const next = { anchor: index, from: index, to: index };
    rangeRef.current = next;
    setRange(next);
  };

  const moveRange = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = rangeRef.current;
    if (!current) return;
    const index = indexAt(event.clientX, event.clientY);
    const next = { anchor: current.anchor, from: Math.min(current.anchor, index), to: Math.max(current.anchor, index) };
    rangeRef.current = next;
    setRange(next);
  };

  const endRange = () => {
    const current = rangeRef.current;
    rangeRef.current = null;
    if (!current || !onCreate) return;
    const start = Date.parse(`${days[current.from]}T00:00:00Z`);
    const end = Date.parse(`${addDays(days[current.to], 1)}T00:00:00Z`);
    requestAnimationFrame(() => {
      if (ghost.current) onCreate({ start, end, allDay: true }, ghost.current);
      setRange(null);
    });
  };

  const tapCreate = (day: string, element: HTMLElement) => {
    if (readOnly || !onCreate) return;
    onCreate({ start: Date.parse(`${day}T00:00:00Z`), end: Date.parse(`${addDays(day, 1)}T00:00:00Z`), allDay: true }, element);
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: Occurrence) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const element = event.currentTarget;
    const movable = !readOnly && !item.readOnly && !item.holiday && Boolean(onMove) && event.pointerType !== 'touch';
    const state: Drag = {
      item,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: indexAt(event.clientX, event.clientY),
      delta: 0,
      active: false,
      element,
    };
    dragRef.current = state;
    const move = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current || moveEvent.pointerId !== current.pointer) return;
      if (!current.active) {
        if (Math.hypot(moveEvent.clientX - current.x, moveEvent.clientY - current.y) < 5 || !movable) return;
        current.active = true;
      }
      current.delta = indexAt(moveEvent.clientX, moveEvent.clientY) - current.origin;
      setDrag({ ...current });
    };
    const up = (upEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current || upEvent.pointerId !== current.pointer) return;
      cleanup();
      setDrag(null);
      if (!current.active) {
        onOpen(current.item, current.element);
        return;
      }
      if (!current.delta) return;
      const target = current.item;
      if (target.allDay && target.startDate && target.endDate) {
        onMove?.(target, {
          start: Date.parse(`${addDays(target.startDate, current.delta)}T00:00:00Z`),
          end: Date.parse(`${addDays(target.endDate, current.delta)}T00:00:00Z`),
          allDay: true,
        });
      } else {
        const zone = getZone();
        const wall = wallOf(target.start, zone);
        const start = utcOf({ ...wall, day: wall.day + current.delta }, zone);
        onMove?.(target, { start, end: start + (target.end - target.start), allDay: false });
      }
    };
    function cleanup() {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const weekdays = days.slice(0, 7).map((day) => weekdayOf(day));
  const dayItems = (day: string) =>
    sorted.filter((item) => {
      const [from, to] = spanOf(item);
      return from <= day && to >= day;
    });

  const renderItem = (
    item: Occurrence,
    first: number,
    last: number,
    lane: number,
    clippedStart: boolean,
    clippedEnd: boolean,
    rowDays: number
  ) => {
    const calendar = calendars.get(item.calendarId);
    const color = colorOf(item, calendar, prefs.colorBy);
    const bar = multi(item) || item.holiday;
    const title = displayTitle(item, prefs);
    const tentative = isTentative(item);
    const shift = drag?.active && drag.item.key === item.key ? drag.delta : 0;
    const from = Math.max(0, Math.min(rowDays - 1, first + shift));
    const to = Math.max(from, Math.min(rowDays - 1, last + shift));
    return (
      <Box
        key={item.key}
        data-event
        role="button"
        tabIndex={0}
        aria-label={title}
        onPointerDown={(event: ReactPointerEvent<HTMLElement>) => startDrag(event, item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOpen(item, event.currentTarget);
        }}
        sx={{
          position: 'absolute',
          top: HEAD + lane * LANE,
          height: LANE - 2,
          left: `calc(${(from / 7) * 100}% + 3px)`,
          width: `calc(${((to - from + 1) / 7) * 100}% - 6px)`,
          borderRadius: `${radius.xs + 2}px`,
          borderTopLeftRadius: clippedStart ? 0 : undefined,
          borderBottomLeftRadius: clippedStart ? 0 : undefined,
          borderTopRightRadius: clippedEnd ? 0 : undefined,
          borderBottomRightRadius: clippedEnd ? 0 : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          cursor: 'pointer',
          overflow: 'hidden',
          zIndex: shift ? 10 : 2,
          bgcolor: bar
            ? tentative
              ? c.surfaceContainerLowest
              : tint(color, item.holiday ? 22 : 34)
            : selected === item.key
              ? tint(color, 20)
              : 'transparent',
          border: tentative && bar ? `1.5px dashed ${color}` : 'none',
          boxShadow: shift ? `0 4px 12px ${mix(c.shadow, 30)}` : 'none',
          opacity: prefs.dimPast && item.end < now && !item.holiday ? 0.6 : 1,
          textDecoration: isDeclined(item) ? 'line-through' : 'none',
          '&:hover': { bgcolor: bar ? undefined : mix(c.onSurface, 6), filter: bar ? 'brightness(1.05)' : undefined },
        }}
      >
        {item.component === 'VTODO' ? (
          <Box
            component="span"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleTask?.(item);
            }}
            sx={{ display: 'inline-flex', color, '& svg': { fontSize: 14 } }}
          >
            {item.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
          </Box>
        ) : (
          !bar && (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: tentative ? 'transparent' : color,
                border: `2px solid ${color}`,
                flex: 'none',
              }}
            />
          )
        )}
        <Typography noWrap sx={{ fontSize: 12, fontWeight: bar ? 700 : 500, textDecoration: item.completed ? 'line-through' : undefined }}>
          {!item.allDay && !bar && (
            <Box component="span" sx={{ color: c.onSurfaceVariant, mr: 0.5, fontVariantNumeric: 'tabular-nums' }}>
              {formatTimeShort(item.start)}
            </Box>
          )}
          {title}
        </Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `${prefs.weekNumbers ? '36px ' : ''}repeat(7, minmax(0, 1fr))`,
          borderBottom: `1px solid ${c.outlineVariant}`,
          flex: 'none',
        }}
      >
        {prefs.weekNumbers && <Box />}
        {weekdays.map((weekday) => (
          <Typography
            key={weekday}
            variant="caption"
            sx={{
              textAlign: 'center',
              py: 1,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: [0, 6].includes(weekday) ? c.onSurfaceVariant : c.onSurface,
            }}
          >
            {weekdayName(weekday)}
          </Typography>
        ))}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {prefs.weekNumbers && (
          <Box sx={{ width: 36, flex: 'none', display: 'grid', gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
            {weeks.map((week) => (
              <Typography
                key={week[0]}
                variant="caption"
                sx={{ color: c.onSurfaceVariant, textAlign: 'center', pt: 1, fontWeight: 600, fontSize: 10.5 }}
              >
                {weekOf(week[0])}
              </Typography>
            ))}
          </Box>
        )}
        <Box
          ref={grid}
          onPointerDown={startRange}
          onPointerMove={moveRange}
          onPointerUp={endRange}
          sx={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`, userSelect: 'none' }}
        >
          {rows.map(({ week, layout, hidden, shown }, rowIndex) => (
            <Box
              key={week[0]}
              sx={{ position: 'relative', borderBottom: `1px solid ${c.outlineVariant}`, minHeight: 0, overflow: 'hidden' }}
            >
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                {week.map((day, column) => {
                  const inMonth = parseKey(day).month === month;
                  const isToday = day === todayKey;
                  const index = rowIndex * 7 + column;
                  const inRange = range && index >= range.from && index <= range.to;
                  return (
                    <Box
                      key={day}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('[data-event],[data-day]') || drag) return;
                        if ((event.nativeEvent as PointerEvent).pointerType === 'touch') tapCreate(day, event.currentTarget);
                      }}
                      sx={{
                        borderLeft: column ? `1px solid ${c.outlineVariant}` : 'none',
                        bgcolor: inRange
                          ? mix(c.primary, 16)
                          : !inMonth
                            ? mix(c.onSurface, 3)
                            : isToday
                              ? mix(c.primary, 5)
                              : 'transparent',
                        position: 'relative',
                      }}
                    >
                      {inRange && index === range!.from && <Box ref={ghost} sx={{ position: 'absolute', inset: 0 }} />}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pt: 0.5, gap: 0.25 }}>
                        <ButtonBase
                          data-day
                          onClick={() => onDay(day)}
                          aria-label={formatDayLong(day)}
                          sx={{
                            minWidth: 26,
                            height: 24,
                            px: 0.75,
                            borderRadius: `${radius.full}px`,
                            fontSize: 12.5,
                            fontWeight: isToday ? 800 : 600,
                            bgcolor: isToday ? c.primary : 'transparent',
                            color: isToday ? c.onPrimary : inMonth ? c.onSurface : c.onSurfaceVariant,
                            opacity: inMonth || isToday ? 1 : 0.65,
                            '&:hover': { bgcolor: isToday ? c.primary : mix(c.onSurface, 8) },
                          }}
                        >
                          {dayNumber(day) === 1 ? `${dayNumber(day)}. ${monthName(parseKey(day).month, 'short')}` : dayNumber(day)}
                        </ButtonBase>
                        {moons.get(day) && <Box sx={{ fontSize: 11 }}>{moons.get(day)}</Box>}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              {layout.bars
                .filter((bar) => bar.lane < shown)
                .map((bar) => renderItem(bar.item, bar.first, bar.last, bar.lane, bar.clippedStart, bar.clippedEnd, week.length))}
              {hidden.map((count, column) =>
                count ? (
                  <ButtonBase
                    key={week[column]}
                    data-day
                    onClick={(event) => setMore({ day: week[column], anchor: event.currentTarget })}
                    sx={{
                      position: 'absolute',
                      top: HEAD + shown * LANE,
                      left: `calc(${(column / 7) * 100}% + 4px)`,
                      width: `calc(${100 / 7}% - 8px)`,
                      justifyContent: 'flex-start',
                      px: 0.75,
                      height: LANE - 2,
                      borderRadius: `${radius.xs + 2}px`,
                      fontSize: 12,
                      fontWeight: 700,
                      color: c.onSurfaceVariant,
                      zIndex: 3,
                      '&:hover': { bgcolor: mix(c.onSurface, 6) },
                    }}
                  >
                    {t('+{count} weitere', { count })}
                  </ButtonBase>
                ) : null
              )}
            </Box>
          ))}
        </Box>
      </Box>
      <Popover
        open={Boolean(more)}
        anchorEl={more?.anchor}
        onClose={() => setMore(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'center' }}
        transformOrigin={{ vertical: 'center', horizontal: 'center' }}
        slotProps={{ paper: { sx: { width: 280, p: 1.5, borderRadius: `${radius.lg}px` } } }}
      >
        {more && (
          <>
            <ButtonBase onClick={() => onDay(more.day)} sx={{ borderRadius: `${radius.sm}px`, px: 1, py: 0.5, mb: 1 }}>
              <Typography variant="subtitle2">{formatDayLong(more.day)}</Typography>
            </ButtonBase>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {dayItems(more.day).map((item) => {
                const color = colorOf(item, calendars.get(item.calendarId), prefs.colorBy);
                return (
                  <ButtonBase
                    key={item.key}
                    onClick={(event) => {
                      onOpen(item, event.currentTarget);
                      setMore(null);
                    }}
                    sx={{
                      justifyContent: 'flex-start',
                      gap: 1,
                      px: 1,
                      py: 0.75,
                      borderRadius: `${radius.sm}px`,
                      bgcolor: tint(color, 22),
                      textAlign: 'left',
                    }}
                  >
                    <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: color }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: 13, fontWeight: 700 }}>
                        {displayTitle(item, prefs)}
                      </Typography>
                      {!item.allDay && (
                        <Typography sx={{ fontSize: 12, color: c.onSurfaceVariant }}>
                          {formatTimeShort(item.start)}–{formatTimeShort(item.end)}
                        </Typography>
                      )}
                    </Box>
                  </ButtonBase>
                );
              })}
            </Box>
          </>
        )}
      </Popover>
    </Box>
  );
}
