import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import BarChartRounded from '@mui/icons-material/BarChartRounded';
import { api, errorText } from '../../lib/api';
import { locale, t, tn } from '../../lib/i18n';
import { setPrefs, usePrefs, type Prefs } from '../../lib/prefs';
import { c, mix, radius } from '../../theme/tokens';
import {
  addDays,
  addMonths,
  dateKey,
  dayStart,
  formatDayLong,
  formatDayMedium,
  formatHour,
  formatRangeTitle,
  parseKey,
  startOfMonth,
  startOfWeek,
  today,
  weekdayName,
} from './dates';
import { useCalendarState } from './store';

interface Stats {
  total: { minutes: number; events: number; allDay: number; meetings: number; meetingMinutes: number; average: number };
  byCalendar: { id: string; name: string; color: string; minutes: number; events: number }[];
  byCategory: { name: string; minutes: number; events: number }[];
  byWeekday: number[];
  byHour: number[];
  byDay: { date: string; minutes: number }[];
  busiest: { date: string; minutes: number } | null;
  longest: { title: string; minutes: number } | null;
}

const number = (value: number, digits = 0) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
const hours = (minutes: number) =>
  minutes < 60
    ? t('{count} Min.', { count: Math.round(minutes) })
    : t('{count} Std.', { count: number(minutes / 60, minutes < 600 ? 1 : 0) });

function rangeOf(kind: Prefs['statsRange'], offset: number) {
  const now = today();
  if (kind === 'week') {
    const from = addDays(startOfWeek(now, 1), offset * 7);
    return { from, to: addDays(from, 7) };
  }
  if (kind === 'month') {
    const from = addMonths(startOfMonth(now), offset);
    return { from, to: addMonths(from, 1) };
  }
  if (kind === 'quarter') {
    const { year, month } = parseKey(now);
    const from = addMonths(dateKey(year, Math.floor((month - 1) / 3) * 3 + 1, 1), offset * 3);
    return { from, to: addMonths(from, 3) };
  }
  const from = dateKey(parseKey(now).year + offset, 1, 1);
  return { from, to: dateKey(parseKey(from).year + 1, 1, 1) };
}

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        gridColumn: wide ? '1 / -1' : undefined,
        p: { xs: 2, sm: 2.5 },
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainerLowest,
        border: `1px solid ${c.outlineVariant}`,
        minWidth: 0,
      }}
    >
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Box
      sx={{
        p: 2.25,
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainerLowest,
        border: `1px solid ${c.outlineVariant}`,
        minWidth: 0,
      }}
    >
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}>{value}</Typography>
      {note && (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap component="p">
          {note}
        </Typography>
      )}
    </Box>
  );
}

function RankedBars({ rows }: { rows: { key: string; label: string; swatch?: string; minutes: number; events: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  if (!rows.length) {
    return (
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {t('Keine Daten in diesem Zeitraum')}
      </Typography>
    );
  }
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {rows.map((row) => (
        <Tooltip
          key={row.key}
          title={`${row.label}: ${hours(row.minutes)} · ${tn(row.events, '1 Termin', '{count} Termine')}`}
          disableInteractive
        >
          <Box
            component="li"
            tabIndex={0}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(120px, 30%) 1fr auto' },
              alignItems: 'center',
              columnGap: 1.5,
              rowGap: 0.5,
              borderRadius: `${radius.xs}px`,
              '&:hover .bar, &:focus-visible .bar': { filter: 'brightness(1.12)' },
              outlineOffset: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              {row.swatch && <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: row.swatch, flex: 'none' }} />}
              <Typography variant="body2" noWrap>
                {row.label}
              </Typography>
            </Box>
            <Box
              sx={{
                gridColumn: { xs: '1 / -1', sm: 'auto' },
                gridRow: { xs: 2, sm: 'auto' },
                height: 12,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Box
                className="bar"
                sx={{
                  height: 12,
                  width: `${Math.max(1, (row.minutes / max) * 100)}%`,
                  bgcolor: c.primary,
                  borderRadius: '0 4px 4px 0',
                  transition: 'width 300ms',
                }}
              />
            </Box>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {hours(row.minutes)}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

function Columns({ values, labels, full, height = 160 }: { values: number[]; labels: string[]; full: string[]; height?: number }) {
  const max = Math.max(1, ...values);
  const step = max > 600 ? 120 : max > 240 ? 60 : max > 60 ? 30 : 15;
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Box sx={{ position: 'relative', width: 44, height, flex: 'none' }}>
        {ticks.map((tick) => (
          <Typography
            key={tick}
            variant="caption"
            sx={{
              position: 'absolute',
              right: 0,
              bottom: `calc(${(tick / top) * 100}% - 8px)`,
              color: c.onSurfaceVariant,
              fontSize: 10.5,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tick === 0 ? '0' : hours(tick)}
          </Typography>
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
          {ticks.map((tick) => (
            <Box
              key={tick}
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${(tick / top) * 100}%`,
                borderTop: `1px solid ${c.outlineVariant}`,
                pointerEvents: 'none',
              }}
            />
          ))}
          {values.map((value, index) => (
            <Tooltip key={index} title={`${full[index]}: ${hours(value)}`} disableInteractive>
              <Box
                tabIndex={0}
                aria-label={`${full[index]}: ${hours(value)}`}
                sx={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 1,
                  '&:hover .col, &:focus-visible .col': { filter: 'brightness(1.12)' },
                }}
              >
                <Box
                  className="col"
                  sx={{
                    width: '100%',
                    maxWidth: 24,
                    height: `${(value / top) * 100}%`,
                    minHeight: value ? 2 : 0,
                    bgcolor: c.primary,
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 300ms',
                  }}
                />
              </Box>
            </Tooltip>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: '2px', mt: 0.75 }}>
          {labels.map((label, index) => (
            <Typography
              key={index}
              variant="caption"
              sx={{ flex: 1, textAlign: 'center', color: c.onSurfaceVariant, fontSize: 10.5, overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
              {label}
            </Typography>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function Heatmap({ from, to, days, weekStart }: { from: string; to: string; days: Map<string, number>; weekStart: number }) {
  const first = startOfWeek(from, weekStart);
  const weeks: string[][] = [];
  for (let cursor = first; cursor < to; cursor = addDays(cursor, 7))
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
  const max = Math.max(1, ...days.values());
  const levels = [0, 0.25, 0.5, 0.75, 1];
  const strength = (minutes: number) =>
    minutes <= 0 ? 0 : minutes < max * 0.25 ? 22 : minutes < max * 0.5 ? 42 : minutes < max * 0.75 ? 64 : 88;
  const size = weeks.length > 30 ? 13 : weeks.length > 12 ? 16 : 26;
  return (
    <Box sx={{ overflowX: 'auto', pb: 1 }}>
      <Box sx={{ display: 'flex', gap: '3px', minWidth: 'min-content' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', mr: 0.5 }}>
          {Array.from({ length: 7 }, (_, index) => (
            <Typography
              key={index}
              variant="caption"
              sx={{
                height: size,
                lineHeight: `${size}px`,
                fontSize: 10,
                color: c.onSurfaceVariant,
                visibility: index % 2 ? 'visible' : 'hidden',
              }}
            >
              {weekdayName((weekStart + index) % 7)}
            </Typography>
          ))}
        </Box>
        {weeks.map((week) => (
          <Box key={week[0]} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {week.map((day) => {
              const inside = day >= from && day < to;
              const minutes = days.get(day) ?? 0;
              return (
                <Tooltip
                  key={day}
                  title={inside ? `${formatDayLong(day)}: ${minutes ? hours(minutes) : t('frei')}` : ''}
                  disableInteractive
                >
                  <Box
                    tabIndex={inside ? 0 : -1}
                    aria-label={inside ? `${formatDayLong(day)}: ${hours(minutes)}` : undefined}
                    sx={{
                      width: size,
                      height: size,
                      borderRadius: '3px',
                      bgcolor: !inside ? 'transparent' : minutes ? mix(c.primary, strength(minutes)) : mix(c.onSurface, 6),
                      outline: day === today() ? `1.5px solid ${c.onSurface}` : 'none',
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5, color: c.onSurfaceVariant }}>
        <Typography variant="caption">{t('Weniger')}</Typography>
        {levels.map((level) => (
          <Box
            key={level}
            sx={{
              width: 12,
              height: 12,
              borderRadius: '3px',
              bgcolor: level ? mix(c.primary, strength(level * max)) : mix(c.onSurface, 6),
            }}
          />
        ))}
        <Typography variant="caption">{t('Mehr')}</Typography>
      </Box>
    </Box>
  );
}

export function StatsView() {
  const { prefs, version, calendars } = useCalendarState();
  const local = usePrefs();
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const range = useMemo(() => rangeOf(local.statsRange, offset), [local.statsRange, offset]);

  useEffect(() => {
    setLoading(true);
    api
      .get<Stats>(`/api/calendar/stats?from=${dayStart(range.from)}&to=${dayStart(range.to)}`)
      .then((result) => {
        setStats(result);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)))
      .finally(() => setLoading(false));
  }, [range.from, range.to, version]);

  const weekStart = prefs?.weekStart ?? 1;
  const weekdayOrder = Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);
  const presets: [Prefs['statsRange'], string][] = [
    ['week', t('Woche')],
    ['month', t('Monat')],
    ['quarter', t('Quartal')],
    ['year', t('Jahr')],
  ];
  const days = useMemo(() => new Map((stats?.byDay ?? []).map((entry) => [entry.date, entry.minutes])), [stats]);
  const span = Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000));
  const calendarLabel = (row: { id: string; name: string }) => {
    const calendar = calendars.find((entry) => entry.id === row.id);
    if (!calendar) return t('Einladungen');
    return calendar.access === 'owner' ? calendar.name : `${calendar.name} (${calendar.owner.name})`;
  };
  const meetingShare = stats && stats.total.minutes ? Math.round((stats.total.meetingMinutes / stats.total.minutes) * 100) : 0;

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={local.statsRange}
            onChange={(_event, value) => {
              if (!value) return;
              setPrefs({ statsRange: value });
              setOffset(0);
            }}
          >
            {presets.map(([value, label]) => (
              <ToggleButton key={value} value={value}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <IconButton aria-label={t('Zurück')} onClick={() => setOffset(offset - 1)}>
            <ChevronLeftRounded />
          </IconButton>
          <IconButton aria-label={t('Weiter')} onClick={() => setOffset(offset + 1)}>
            <ChevronRightRounded />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {formatRangeTitle(range.from, range.to)}
          </Typography>
          {offset !== 0 && <Button onClick={() => setOffset(0)}>{t('Aktuell')}</Button>}
          <Box sx={{ flex: 1 }} />
          <Button startIcon={table ? <BarChartRounded /> : <TableRowsRounded />} onClick={() => setTable((value) => !value)}>
            {table ? t('Als Diagramme') : t('Als Tabelle')}
          </Button>
        </Box>
        {error && <Typography sx={{ color: c.error }}>{error}</Typography>}
        {stats && (
          <Box sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity 200ms', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
              <Tile
                label={t('Verplante Zeit')}
                value={hours(stats.total.minutes)}
                note={t('Ø {value} pro Tag', { value: hours(stats.total.minutes / span) })}
              />
              <Tile
                label={t('Termine')}
                value={number(stats.total.events)}
                note={stats.total.allDay ? tn(stats.total.allDay, 'plus 1 ganztägiger', 'plus {count} ganztägige') : undefined}
              />
              <Tile
                label={t('Mit Gästen')}
                value={number(stats.total.meetings)}
                note={
                  stats.total.meetingMinutes
                    ? t('{value}, {share} % deiner Zeit', { value: hours(stats.total.meetingMinutes), share: meetingShare })
                    : undefined
                }
              />
              <Tile
                label={t('Vollster Tag')}
                value={stats.busiest ? formatDayMedium(stats.busiest.date) : '–'}
                note={stats.busiest ? hours(stats.busiest.minutes) : undefined}
              />
            </Box>
            {table ? (
              <Card title={t('Alle Werte')} wide>
                <Box
                  component="table"
                  sx={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    '& th, & td': { textAlign: 'left', py: 0.75, px: 1, borderBottom: `1px solid ${c.outlineVariant}`, fontSize: 14 },
                    '& td:last-of-type, & th:last-of-type': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
                  }}
                >
                  <thead>
                    <tr>
                      <th>{t('Bereich')}</th>
                      <th>{t('Eintrag')}</th>
                      <th>{t('Termine')}</th>
                      <th>{t('Zeit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byCalendar.map((row) => (
                      <tr key={`calendar-${row.id}`}>
                        <td>{t('Kalender')}</td>
                        <td>{calendarLabel(row)}</td>
                        <td>{number(row.events)}</td>
                        <td>{hours(row.minutes)}</td>
                      </tr>
                    ))}
                    {stats.byCategory.map((row) => (
                      <tr key={`category-${row.name}`}>
                        <td>{t('Schlagwort')}</td>
                        <td>#{row.name}</td>
                        <td>{number(row.events)}</td>
                        <td>{hours(row.minutes)}</td>
                      </tr>
                    ))}
                    {weekdayOrder.map((weekday) => (
                      <tr key={`weekday-${weekday}`}>
                        <td>{t('Wochentag')}</td>
                        <td>{weekdayName(weekday, 'long')}</td>
                        <td>–</td>
                        <td>{hours(stats.byWeekday[weekday])}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Card>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
                <Card title={t('Zeit pro Kalender')}>
                  <RankedBars
                    rows={stats.byCalendar.map((row) => ({
                      key: row.id,
                      label: calendarLabel(row),
                      swatch: row.color,
                      minutes: row.minutes,
                      events: row.events,
                    }))}
                  />
                </Card>
                <Card title={t('Zeit pro Schlagwort')}>
                  <RankedBars
                    rows={stats.byCategory.map((row) => ({
                      key: row.name,
                      label: `#${row.name}`,
                      minutes: row.minutes,
                      events: row.events,
                    }))}
                  />
                </Card>
                <Card title={t('Nach Wochentag')}>
                  <Columns
                    values={weekdayOrder.map((weekday) => stats.byWeekday[weekday])}
                    labels={weekdayOrder.map((weekday) => weekdayName(weekday))}
                    full={weekdayOrder.map((weekday) => weekdayName(weekday, 'long'))}
                  />
                </Card>
                <Card title={t('Nach Tageszeit')}>
                  <Columns
                    values={stats.byHour}
                    labels={stats.byHour.map((_, hour) => (hour % 3 === 0 ? formatHour(hour).replace(':00', '') : ''))}
                    full={stats.byHour.map((_, hour) => `${formatHour(hour)}–${formatHour((hour + 1) % 24)}`)}
                  />
                </Card>
                <Card title={t('Auslastung je Tag')} wide>
                  <Heatmap from={range.from} to={range.to} days={days} weekStart={weekStart} />
                </Card>
              </Box>
            )}
            {stats.longest && (
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 1 }}>
                {t('Längster Termin: „{title}“ mit {value}', {
                  title: stats.longest.title || t('(Ohne Titel)'),
                  value: hours(stats.longest.minutes),
                })}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
