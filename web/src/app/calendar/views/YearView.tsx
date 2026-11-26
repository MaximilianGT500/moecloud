import { useMemo } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { t, tn } from '../../../lib/i18n';
import { c, mix, radius } from '../../../theme/tokens';
import { addDays, dateKey, dayNumber, formatDayLong, keyOf, monthName, parseKey, startOfWeek, today, weekdayNarrow } from '../dates';
import { HOLIDAY_COLOR } from '../colors';
import type { CalendarPrefs, Occurrence } from '../model';

interface Props {
  year: number;
  items: Occurrence[];
  prefs: CalendarPrefs;
  onDay: (day: string) => void;
  onMonth: (day: string) => void;
}

export function YearView({ year, items, prefs, onDay, onMonth }: Props) {
  const todayKey = today();
  const { counts, holidays, max } = useMemo(() => {
    const counts = new Map<string, number>();
    const holidays = new Map<string, string>();
    for (const item of items) {
      if (item.holiday) {
        if (item.holiday === 'holiday' && item.startDate) holidays.set(item.startDate, item.title);
        continue;
      }
      const first = item.allDay && item.startDate ? item.startDate : keyOf(item.start);
      const last = item.allDay && item.endDate ? addDays(item.endDate, -1) : keyOf(Math.max(item.start, item.end - 1));
      let day = first;
      for (let guard = 0; guard < 62 && day <= last; guard++, day = addDays(day, 1)) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    let max = 1;
    for (const value of counts.values()) max = Math.max(max, value);
    return { counts, holidays, max };
  }, [items]);

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', p: { xs: 1.5, md: 3 } }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: { xs: 2, md: 3 },
        }}
      >
        {Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const first = dateKey(year, month, 1);
          const start = startOfWeek(first, prefs.weekStart);
          const days = Array.from({ length: 42 }, (_, offset) => addDays(start, offset));
          return (
            <Box
              key={month}
              sx={{ p: 1.5, borderRadius: `${radius.lg}px`, bgcolor: c.surfaceContainerLowest, border: `1px solid ${c.outlineVariant}` }}
            >
              <ButtonBase onClick={() => onMonth(first)} sx={{ borderRadius: `${radius.sm}px`, px: 1, py: 0.25, mb: 1 }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 800,
                    color: parseKey(todayKey).month === month && parseKey(todayKey).year === year ? c.primary : c.onSurface,
                  }}
                >
                  {monthName(month)}
                </Typography>
              </ButtonBase>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                {Array.from({ length: 7 }, (_, column) => (
                  <Typography
                    key={column}
                    variant="caption"
                    sx={{ textAlign: 'center', color: c.onSurfaceVariant, fontSize: 10.5, fontWeight: 600 }}
                  >
                    {weekdayNarrow((prefs.weekStart + column) % 7)}
                  </Typography>
                ))}
                {days.map((day) => {
                  const inMonth = parseKey(day).month === month;
                  if (!inMonth) return <Box key={day} />;
                  const count = counts.get(day) ?? 0;
                  const holiday = holidays.get(day);
                  const isToday = day === todayKey;
                  const level = count ? 12 + Math.round((count / max) * 48) : 0;
                  const label = [formatDayLong(day), holiday, count ? tn(count, '1 Termin', '{count} Termine') : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Tooltip key={day} title={label} disableInteractive enterDelay={400}>
                      <ButtonBase
                        aria-label={label}
                        onClick={() => onDay(day)}
                        sx={{
                          height: 28,
                          borderRadius: `${radius.xs + 2}px`,
                          fontSize: 12,
                          fontWeight: isToday ? 800 : 500,
                          color: isToday ? c.onPrimary : holiday ? HOLIDAY_COLOR : c.onSurface,
                          bgcolor: isToday ? c.primary : level ? mix(c.primary, level) : 'transparent',
                          outline: holiday && !isToday ? `1.5px solid ${mix(HOLIDAY_COLOR, 60)}` : 'none',
                          outlineOffset: -1.5,
                          '&:hover': { bgcolor: isToday ? c.primary : mix(c.onSurface, 10) },
                        }}
                      >
                        {dayNumber(day)}
                      </ButtonBase>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 3, color: c.onSurfaceVariant }}>
        <Typography variant="caption">{t('Wenig')}</Typography>
        {[12, 24, 36, 48, 60].map((level) => (
          <Box key={level} sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: mix(c.primary, level) }} />
        ))}
        <Typography variant="caption">{t('Viel')}</Typography>
      </Box>
    </Box>
  );
}
