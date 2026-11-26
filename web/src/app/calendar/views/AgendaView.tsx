import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import { t } from '../../../lib/i18n';
import { c, mix, radius } from '../../../theme/tokens';
import { EmptyState } from '../../common/bits';
import { addDays, dayNumber, formatTime, keyOf, monthName, parseKey, relativeDay, today, weekdayLong } from '../dates';
import { colorOf, tint } from '../colors';
import { Badges, displayTitle, isDeclined, isTentative } from '../display';
import { videoProvider, type CalendarInfo, type CalendarPrefs, type Occurrence } from '../model';

interface Props {
  from: string;
  to: string;
  items: Occurrence[];
  calendars: Map<string, CalendarInfo>;
  prefs: CalendarPrefs;
  selected?: string | null;
  onOpen: (item: Occurrence, anchor: HTMLElement) => void;
  onToggleTask?: (item: Occurrence) => void;
  onMore?: () => void;
  onDay?: (day: string) => void;
  emptyText?: string;
}

export function AgendaView({ from, to, items, calendars, prefs, selected, onOpen, onToggleTask, onMore, onDay, emptyText }: Props) {
  const todayKey = today();
  const now = Date.now();
  const days = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const item of items) {
      const first = item.allDay && item.startDate ? item.startDate : keyOf(item.start);
      const last = item.allDay && item.endDate ? addDays(item.endDate, -1) : keyOf(Math.max(item.start, item.end - 1));
      let day = first < from ? from : first;
      for (let guard = 0; guard < 62 && day <= last && day < to; guard++, day = addDays(day, 1)) {
        const list = map.get(day) ?? [];
        list.push(item);
        map.set(day, list);
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, list]) => [day, list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)] as const);
  }, [items, from, to]);

  if (!days.length) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
        <EmptyState
          icon={<EventAvailableRounded />}
          title={emptyText ?? t('Nichts geplant')}
          text={t('In diesem Zeitraum gibt es keine Termine.')}
          action={
            onMore && (
              <Button variant="outlined" onClick={onMore}>
                {t('Weiter in die Zukunft schauen')}
              </Button>
            )
          }
        />
      </Box>
    );
  }

  let lastMonth = '';
  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 880, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {days.map(([day, list]) => {
          const parts = parseKey(day);
          const monthLabel = `${monthName(parts.month)} ${parts.year}`;
          const showMonth = monthLabel !== lastMonth;
          lastMonth = monthLabel;
          const isToday = day === todayKey;
          const relative = relativeDay(day);
          return (
            <Box key={day}>
              {showMonth && (
                <Typography variant="h6" component="h2" sx={{ fontWeight: 800, mt: 2, mb: 1, px: 1, color: c.onSurface }}>
                  {monthLabel}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: { xs: 1, md: 2 }, py: 1, borderTop: `1px solid ${c.outlineVariant}` }}>
                <ButtonBase
                  onClick={() => onDay?.(day)}
                  disabled={!onDay}
                  sx={{
                    width: { xs: 56, md: 72 },
                    flex: 'none',
                    flexDirection: 'column',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
                    py: 0.5,
                    borderRadius: `${radius.md}px`,
                  }}
                >
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 22,
                      fontWeight: 800,
                      bgcolor: isToday ? c.primary : 'transparent',
                      color: isToday ? c.onPrimary : c.onSurface,
                    }}
                  >
                    {dayNumber(day)}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: isToday ? c.primary : c.onSurfaceVariant, textAlign: 'center', lineHeight: 1.2 }}
                  >
                    {relative ?? weekdayLong(day)}
                  </Typography>
                </ButtonBase>
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {list.map((item) => {
                    const calendar = calendars.get(item.calendarId);
                    const color = colorOf(item, calendar, prefs.colorBy);
                    const past = prefs.dimPast && item.end < now && !item.holiday;
                    const multi = !item.allDay && keyOf(item.start) !== keyOf(Math.max(item.start, item.end - 1));
                    let time = t('Ganztägig');
                    if (!item.allDay) {
                      if (!multi)
                        time = item.component === 'VTODO' ? formatTime(item.start) : `${formatTime(item.start)} – ${formatTime(item.end)}`;
                      else if (keyOf(item.start) === day) time = t('ab {time}', { time: formatTime(item.start) });
                      else if (keyOf(Math.max(item.start, item.end - 1)) === day) time = t('bis {time}', { time: formatTime(item.end) });
                    }
                    const provider = videoProvider(item.conference);
                    return (
                      <ButtonBase
                        key={`${item.key}:${day}`}
                        onClick={(event) => onOpen(item, event.currentTarget)}
                        sx={{
                          justifyContent: 'flex-start',
                          alignItems: 'stretch',
                          gap: 1.5,
                          px: 1.5,
                          py: 1,
                          borderRadius: `${radius.md}px`,
                          textAlign: 'left',
                          opacity: past ? 0.55 : 1,
                          bgcolor: selected === item.key ? tint(color, 18) : 'transparent',
                          '&:hover': { bgcolor: mix(c.onSurface, 5) },
                        }}
                      >
                        <Box
                          sx={{
                            width: 4,
                            borderRadius: 2,
                            bgcolor: isTentative(item) ? 'transparent' : color,
                            border: isTentative(item) ? `2px dashed ${color}` : 'none',
                            flex: 'none',
                          }}
                        />
                        <Typography
                          sx={{
                            width: { xs: 86, md: 128 },
                            flex: 'none',
                            fontSize: 13.5,
                            color: c.onSurfaceVariant,
                            fontVariantNumeric: 'tabular-nums',
                            pt: '1px',
                          }}
                        >
                          {time}
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            {item.component === 'VTODO' && (
                              <Box
                                component="span"
                                role="checkbox"
                                aria-checked={item.completed}
                                aria-label={t('Erledigt')}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onToggleTask?.(item);
                                }}
                                sx={{ display: 'inline-flex', color, '& svg': { fontSize: 18 } }}
                              >
                                {item.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
                              </Box>
                            )}
                            <Typography
                              sx={{
                                fontWeight: 700,
                                fontSize: 15,
                                textDecoration: isDeclined(item) || item.completed ? 'line-through' : 'none',
                              }}
                              noWrap
                            >
                              {displayTitle(item, prefs)}
                            </Typography>
                            <Badges item={item} size={14} />
                          </Box>
                          <Box
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              columnGap: 1.5,
                              rowGap: 0.25,
                              color: c.onSurfaceVariant,
                              fontSize: 13,
                            }}
                          >
                            {item.location && (
                              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
                                <PlaceOutlined sx={{ fontSize: 15 }} />
                                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.location}
                                </Box>
                              </Box>
                            )}
                            {provider && (
                              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                                <VideocamRounded sx={{ fontSize: 15 }} />
                                {provider}
                              </Box>
                            )}
                            {calendar && <span>{calendar.name}</span>}
                            {item.invitation === 'NEEDS-ACTION' && (
                              <Box component="span" sx={{ color: c.tertiary, fontWeight: 700 }}>
                                {t('Antwort ausstehend')}
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </ButtonBase>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          );
        })}
        {onMore && (
          <Button onClick={onMore} sx={{ alignSelf: 'center', mt: 2 }}>
            {t('Mehr laden')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
