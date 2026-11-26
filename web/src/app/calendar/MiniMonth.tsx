import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import {
  addDays,
  addMonths,
  dayNumber,
  formatDayLong,
  formatMonth,
  parseKey,
  startOfMonth,
  startOfWeek,
  today,
  weekOf,
  weekdayNarrow,
} from './dates';

interface Props {
  value: string;
  weekStart: number;
  range?: { from: string; to: string } | null;
  marks?: Map<string, number>;
  weekNumbers?: boolean;
  onPick: (day: string) => void;
  onWeek?: (day: string) => void;
}

export function MiniMonth({ value, weekStart, range, marks, weekNumbers, onPick, onWeek }: Props) {
  const [shown, setShown] = useState(startOfMonth(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    const month = startOfMonth(value);
    if (month !== shown) setShown(month);
  }
  const first = startOfWeek(shown, weekStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const month = parseKey(shown).month;
  const todayKey = today();
  const columns = weekNumbers ? '24px repeat(7, 1fr)' : 'repeat(7, 1fr)';
  return (
    <Box sx={{ userSelect: 'none' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', pl: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 700 }} aria-live="polite">
          {formatMonth(shown)}
        </Typography>
        <IconButton size="small" aria-label={t('Vorheriger Monat')} onClick={() => setShown(addMonths(shown, -1))}>
          <ChevronLeftRounded fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label={t('Nächster Monat')} onClick={() => setShown(addMonths(shown, 1))}>
          <ChevronRightRounded fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, rowGap: '2px' }} role="grid" aria-label={formatMonth(shown)}>
        {weekNumbers && <Box />}
        {Array.from({ length: 7 }, (_, index) => (
          <Typography
            key={index}
            variant="caption"
            sx={{ textAlign: 'center', color: c.onSurfaceVariant, fontWeight: 600, fontSize: 11, py: 0.5 }}
          >
            {weekdayNarrow((weekStart + index) % 7)}
          </Typography>
        ))}
        {days.map((day, index) => {
          const inMonth = parseKey(day).month === month;
          const selected = day === value;
          const isToday = day === todayKey;
          const inRange = range ? day >= range.from && day < range.to : false;
          const count = marks?.get(day) ?? 0;
          const rowStart = index % 7 === 0;
          const rowEnd = index % 7 === 6;
          return (
            <Box key={day} sx={{ display: 'contents' }}>
              {weekNumbers && rowStart && (
                <ButtonBase
                  onClick={() => (onWeek ?? onPick)(day)}
                  aria-label={t('Kalenderwoche {week}', { week: weekOf(day) })}
                  sx={{ fontSize: 10, color: c.onSurfaceVariant, borderRadius: `${radius.xs}px`, opacity: 0.8 }}
                >
                  {weekOf(day)}
                </ButtonBase>
              )}
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: inRange ? mix(c.primary, 12) : 'transparent',
                  borderTopLeftRadius: inRange && (rowStart || day === range?.from) ? 16 : 0,
                  borderBottomLeftRadius: inRange && (rowStart || day === range?.from) ? 16 : 0,
                  borderTopRightRadius: inRange && (rowEnd || addDays(day, 1) === range?.to) ? 16 : 0,
                  borderBottomRightRadius: inRange && (rowEnd || addDays(day, 1) === range?.to) ? 16 : 0,
                }}
              >
                <ButtonBase
                  role="gridcell"
                  aria-selected={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={formatDayLong(day)}
                  onClick={() => onPick(day)}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    fontSize: 12.5,
                    fontWeight: isToday || selected ? 800 : 500,
                    position: 'relative',
                    color: selected ? c.onPrimary : isToday ? c.primary : inMonth ? c.onSurface : c.onSurfaceVariant,
                    opacity: inMonth || selected ? 1 : 0.55,
                    bgcolor: selected ? c.primary : 'transparent',
                    outline: isToday && !selected ? `1.5px solid ${c.primary}` : 'none',
                    outlineOffset: -1.5,
                    '&:hover': { bgcolor: selected ? c.primary : mix(c.onSurface, 8) },
                  }}
                >
                  {dayNumber(day)}
                  {count > 0 && !selected && (
                    <Box
                      component="span"
                      sx={{
                        position: 'absolute',
                        bottom: 3,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: count > 3 ? 10 : 4,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: isToday ? c.primary : c.tertiary,
                        opacity: 0.85,
                      }}
                    />
                  )}
                </ButtonBase>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
