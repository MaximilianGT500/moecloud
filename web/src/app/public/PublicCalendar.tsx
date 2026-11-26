import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import AddLinkRounded from '@mui/icons-material/AddLinkRounded';
import { api, errorText } from '../../lib/api';
import { boot, type Boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { AgendaView } from '../calendar/views/AgendaView';
import { MonthView } from '../calendar/views/MonthView';
import { TimeGrid } from '../calendar/views/TimeGrid';
import { addDays, dayStart, formatSpan, getZone, parseKey, step, today, viewTitle, visibleDays } from '../calendar/dates';
import type { CalendarInfo, CalendarPrefs, Occurrence, View } from '../calendar/model';
import { PublicFrame } from './PublicFrame';

interface PublicBoot extends Boot {
  calendar: { token: string; name: string; description: string; color: string; mode: 'details' | 'busy'; zone: string; owner: string };
}

const PREFS: CalendarPrefs = {
  view: 'week',
  weekStart: 1,
  slot: 30,
  scrollTo: 480,
  workStart: 480,
  workEnd: 1080,
  workDays: [1, 2, 3, 4, 5],
  weekends: true,
  weekNumbers: false,
  declined: false,
  dimPast: true,
  zone2: null,
  duration: 60,
  alarms: [],
  alldayAlarms: [],
  holidays: [],
  observances: false,
  moon: false,
  emoji: false,
  tasksInCalendar: false,
  completedTasks: false,
  density: 'comfortable',
  defaultCalendar: null,
  freebusy: false,
  agenda: 'off',
  agendaTime: 420,
  colorBy: 'calendar',
  hideTitle: false,
};

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

function Detail({ token, item, onClose }: { token: string; item: Occurrence; onClose: () => void }) {
  const [detail, setDetail] = useState<{
    title: string;
    description: string;
    location: string;
    url: string;
    conference: string | null;
  } | null>(null);
  useEffect(() => {
    if (item.busyOnly) return;
    api
      .get<{ title: string; description: string; location: string; url: string; conference: string | null }>(
        `/api/calendar/public/calendars/${token}/events/${item.eventId}`
      )
      .then(setDetail)
      .catch(() => undefined);
  }, [item.eventId]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px` } } }}>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
            {item.busyOnly ? t('Beschäftigt') : item.title || t('(Ohne Titel)')}
          </Typography>
          <IconButton aria-label={t('Schließen')} onClick={onClose} sx={{ m: -1 }}>
            <CloseRounded />
          </IconButton>
        </Box>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {formatSpan(item.start, item.end, item.allDay)}
        </Typography>
        {item.recurring && (
          <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: c.onSurfaceVariant }}>
            <EventRepeatRounded sx={{ fontSize: 18 }} />
            {t('Wiederholt sich')}
          </Typography>
        )}
        {!item.busyOnly && !detail && <LinearProgress />}
        {detail?.location && (
          <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <PlaceOutlined sx={{ fontSize: 18, mt: '1px' }} />
            {detail.location}
          </Typography>
        )}
        {detail?.conference && (
          <Button
            variant="contained"
            startIcon={<VideocamRounded />}
            href={detail.conference}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('Videokonferenz beitreten')}
          </Button>
        )}
        {detail?.description && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {detail.description.split(URL_PATTERN).map((part, index) =>
              index % 2 ? (
                <Link key={index} href={part} target="_blank" rel="noopener noreferrer">
                  {part}
                </Link>
              ) : (
                part
              )
            )}
          </Typography>
        )}
        {detail?.url && (
          <Link href={detail.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {detail.url}
          </Link>
        )}
      </Box>
    </Dialog>
  );
}

export function PublicCalendar() {
  const data = boot<PublicBoot>().calendar;
  const narrow = useMediaQuery('(max-width:600px)');
  const embed = new URLSearchParams(location.search).get('embed') === '1';
  const [view, setView] = useState<View>(narrow ? 'agenda' : 'week');
  const [date, setDate] = useState(today());
  const [items, setItems] = useState<Occurrence[] | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => visibleDays(view, date, 1, true, [1, 2, 3, 4, 5]), [view, date]);
  const from = view === 'agenda' ? date : range.from;
  const to = view === 'agenda' ? addDays(date, 60) : range.to;

  useEffect(() => {
    setItems(null);
    api
      .get<{ items: Occurrence[] }>(`/api/calendar/public/calendars/${data.token}/occurrences?from=${dayStart(from)}&to=${dayStart(to)}`)
      .then((result) => setItems(result.items))
      .catch((failure) => setError(errorText(failure)));
  }, [from, to]);

  const calendars = useMemo(() => {
    const map = new Map<string, CalendarInfo>();
    for (const item of items ?? []) {
      if (!map.has(item.calendarId)) map.set(item.calendarId, { id: item.calendarId, name: data.name, color: data.color } as CalendarInfo);
    }
    return map;
  }, [items]);

  const feed = `${location.origin}/p/${data.token}.ics`;
  const views: [View, string][] = [
    ['week', t('Woche')],
    ['month', t('Monat')],
    ['agenda', t('Liste')],
  ];

  const body = (
    <Box
      sx={{
        flex: 1,
        minHeight: embed ? '100dvh' : 640,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: c.surfaceContainerLowest,
        borderRadius: embed ? 0 : `${radius.xl}px`,
        border: embed ? 'none' : `1px solid ${c.outlineVariant}`,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          flexWrap: 'wrap',
          borderBottom: `1px solid ${c.outlineVariant}`,
        }}
      >
        <Button variant="outlined" size="small" onClick={() => setDate(today())} sx={{ borderRadius: `${radius.full}px` }}>
          {t('Heute')}
        </Button>
        <IconButton aria-label={t('Zurück')} onClick={() => setDate(step(view, date, -1))}>
          <ChevronLeftRounded />
        </IconButton>
        <IconButton aria-label={t('Weiter')} onClick={() => setDate(step(view, date, 1))}>
          <ChevronRightRounded />
        </IconButton>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 140 }}>
          {viewTitle(view, date, range)}
        </Typography>
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(_event, value) => value && setView(value)}>
          {views.map(([value, label]) => (
            <ToggleButton key={value} value={value}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      {items === null && !error && <LinearProgress />}
      {error && <Typography sx={{ p: 2, color: c.error }}>{error}</Typography>}
      <Box sx={{ flex: 1, minHeight: 0, height: view === 'agenda' ? 'auto' : 620 }}>
        {items && view === 'month' && (
          <MonthView
            days={range.days}
            month={parseKey(date).month}
            items={items}
            calendars={calendars}
            prefs={PREFS}
            readOnly
            onOpen={(item) => setSelected(item)}
            onDay={(day) => {
              setView('week');
              setDate(day);
            }}
          />
        )}
        {items && view === 'week' && (
          <TimeGrid
            days={range.days}
            items={items}
            calendars={calendars}
            prefs={PREFS}
            hourHeight={44}
            readOnly
            onOpen={(item) => setSelected(item)}
          />
        )}
        {items && view === 'agenda' && (
          <AgendaView from={from} to={to} items={items} calendars={calendars} prefs={PREFS} onOpen={(item) => setSelected(item)} />
        )}
      </Box>
    </Box>
  );

  return (
    <PublicFrame compact={embed} wide>
      {!embed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', py: 2, px: 1 }}>
          <Box sx={{ width: 14, height: 40, borderRadius: 2, bgcolor: data.color }} />
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
              {data.name}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {[
                data.owner ? t('Von {name}', { name: data.owner }) : null,
                data.mode === 'busy' ? t('Nur frei/beschäftigt') : null,
                t('Zeiten in {zone}', { zone: getZone().replace(/_/g, ' ') }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            {data.description && (
              <Typography variant="body1" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                {data.description}
              </Typography>
            )}
          </Box>
          <Tooltip title={t('In deiner Kalender-App abonnieren')}>
            <Button variant="contained" startIcon={<AddLinkRounded />} href={feed.replace(/^https?:/, 'webcal:')}>
              {t('Abonnieren')}
            </Button>
          </Tooltip>
        </Box>
      )}
      {body}
      {selected && <Detail token={data.token} item={selected} onClose={() => setSelected(null)} />}
    </PublicFrame>
  );
}
