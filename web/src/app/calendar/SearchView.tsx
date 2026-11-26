import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { formatDayMedium, formatTime, keyOf, parseKey } from './dates';
import type { CalendarInfo } from './model';

export interface SearchHit {
  eventId: string;
  calendarId: string;
  component: 'VEVENT' | 'VTODO';
  title: string;
  location: string;
  description: string;
  start: number | null;
  allDay: boolean;
  recurring: boolean;
  completed: boolean;
  color: string | null;
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 ? (
          <Box key={index} component="mark" sx={{ bgcolor: mix(c.tertiary, 30), color: 'inherit', borderRadius: '3px', px: '1px' }}>
            {part}
          </Box>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

export function SearchView({
  query,
  calendars,
  onOpen,
}: {
  query: string;
  calendars: Map<string, CalendarInfo>;
  onOpen: (hit: SearchHit) => void;
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = query.trim().split(/\s+/).filter(Boolean);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setHits([]);
      return;
    }
    setHits(null);
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .get<{ items: SearchHit[] }>(`/api/calendar/search?q=${encodeURIComponent(term)}`, abort.signal)
        .then((result) => setHits(result.items))
        .catch((failure) => {
          if ((failure as Error).name !== 'AbortError') setError(errorText(failure));
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  const now = Date.now();
  const upcoming = (hits ?? [])
    .filter((hit) => hit.start !== null && hit.start >= now - 86_400_000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const past = (hits ?? []).filter((hit) => hit.start === null || hit.start < now - 86_400_000);

  const renderHit = (hit: SearchHit) => {
    const calendar = calendars.get(hit.calendarId);
    const color = hit.color ?? calendar?.color ?? c.primary;
    const key = hit.start !== null ? (hit.allDay ? new Date(hit.start).toISOString().slice(0, 10) : keyOf(hit.start)) : null;
    return (
      <ButtonBase
        key={hit.eventId}
        onClick={() => onOpen(hit)}
        sx={{
          width: '100%',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          gap: 2,
          px: 2,
          py: 1.5,
          borderRadius: `${radius.md}px`,
          textAlign: 'left',
          '&:hover': { bgcolor: mix(c.onSurface, 5) },
        }}
      >
        <Box sx={{ width: 64, flex: 'none', textAlign: 'center' }}>
          {key ? (
            <>
              <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{parseKey(key).day}</Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {formatDayMedium(key).replace(/^\S+\s/, '')}
              </Typography>
            </>
          ) : (
            <TaskAltRounded sx={{ color: c.onSurfaceVariant }} />
          )}
        </Box>
        <Box sx={{ width: 4, borderRadius: 2, bgcolor: color, flex: 'none' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, textDecoration: hit.completed ? 'line-through' : 'none' }} noWrap>
            <Highlight text={hit.title || t('(Ohne Titel)')} words={words} />
          </Typography>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }} noWrap>
            {[
              key ? `${formatDayMedium(key)}${!hit.allDay && hit.start !== null ? `, ${formatTime(hit.start)}` : ''}` : t('Ohne Datum'),
              hit.location,
              calendar?.name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          {hit.description && (
            <Typography
              variant="caption"
              sx={{
                color: c.onSurfaceVariant,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              <Highlight text={hit.description} words={words} />
            </Typography>
          )}
        </Box>
        {hit.recurring && <EventRepeatRounded sx={{ color: c.onSurfaceVariant, fontSize: 18, alignSelf: 'center' }} />}
      </ButtonBase>
    );
  };

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 860, mx: 'auto' }}>
        {hits === null && !error && <LinearProgress />}
        {error && <Typography sx={{ color: c.error }}>{error}</Typography>}
        {hits !== null && hits.length === 0 && query.trim() && (
          <EmptyState
            icon={<SearchOffRounded />}
            title={t('Nichts gefunden')}
            text={t('Probier andere Wörter oder prüf die Schreibweise.')}
          />
        )}
        {hits !== null && hits.length > 0 && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 2, mb: 1 }}>
            {tn(hits.length, '1 Treffer', '{count} Treffer')}
          </Typography>
        )}
        {upcoming.length > 0 && (
          <>
            <Typography variant="overline" component="h2" sx={{ px: 2, color: c.onSurfaceVariant, fontWeight: 800 }}>
              {t('Demnächst')}
            </Typography>
            {upcoming.map(renderHit)}
          </>
        )}
        {past.length > 0 && (
          <>
            <Typography
              variant="overline"
              component="h2"
              sx={{ px: 2, mt: 2, display: 'block', color: c.onSurfaceVariant, fontWeight: 800 }}
            >
              {t('Vergangen und ohne Datum')}
            </Typography>
            {past.map(renderHit)}
          </>
        )}
      </Box>
    </Box>
  );
}
