import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { UserAvatar } from '../common/bits';
import {
  addDays,
  dayStart,
  durationText,
  formatDayLong,
  formatDayMedium,
  formatHour,
  formatTime,
  keyOf,
  minuteOf,
  today,
  weekdayOf,
} from './dates';
import { emailOf, PeopleInput, type Person, type Picked } from './PeopleInput';
import { useCalendarState } from './store';

interface Busy {
  start: number;
  end: number;
  allDay: boolean;
}

interface PersonBusy {
  userId: number;
  name: string;
  initials: string;
  visible: boolean;
  workStart?: number;
  workEnd?: number;
  zone?: string;
  busy: Busy[];
}

interface Props {
  emails?: string[];
  duration?: number;
  day?: string;
  onClose: () => void;
  onPick: (start: number, end: number, people: Picked[]) => void;
}

export function FindTime({ emails = [], duration: initialDuration, day: initialDay, onClose, onPick }: Props) {
  const { prefs } = useCalendarState();
  const compact = useMediaQuery('(max-width:720px)');
  const me = boot().user!;
  const [people, setPeople] = useState<Picked[]>([]);
  const [day, setDay] = useState(() => {
    let start = initialDay && initialDay >= today() ? initialDay : today();
    while ([0, 6].includes(weekdayOf(start))) start = addDays(start, 1);
    return start;
  });
  const [duration, setDuration] = useState(
    initialDuration && initialDuration > 0 && initialDuration <= 480 ? initialDuration : (prefs?.duration ?? 60)
  );
  const [workdays, setWorkdays] = useState(true);
  const [rows, setRows] = useState<PersonBusy[] | null>(null);
  const [suggestions, setSuggestions] = useState<{ start: number; end: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      emails.map(async (email): Promise<Picked | null> => {
        const query = /@users\.moe(cloud|calendar)\.invalid$/.test(email) ? email.split('@')[0] : email;
        const result = await api
          .get<{ items: Person[] }>(`/api/calendar/people?q=${encodeURIComponent(query)}`)
          .catch(() => ({ items: [] as Person[] }));
        const found = result.items.find((person) => emailOf(person) === email.toLowerCase());
        return found ? { email: emailOf(found), name: found.name, userId: found.id, initials: found.initials } : null;
      })
    ).then((list) => {
      if (alive) setPeople(list.filter((entry): entry is Picked => Boolean(entry)));
    });
    return () => {
      alive = false;
    };
  }, []);

  const ids = useMemo(() => [me.id, ...people.map((person) => person.userId!).filter(Boolean)], [people, me.id]);

  useEffect(() => {
    const from = dayStart(day);
    const to = dayStart(addDays(day, 1));
    setRows(null);
    api
      .get<{ people: PersonBusy[] }>(`/api/calendar/freebusy?users=${ids.join(',')}&from=${from}&to=${to}`)
      .then((result) => setRows(result.people))
      .catch((failure) => setError(errorText(failure)));
  }, [day, ids.join(',')]);

  useEffect(() => {
    const from = Math.max(Date.now(), dayStart(day));
    setSuggestions(null);
    api
      .post<{ suggestions: { start: number; end: number }[] }>('/api/calendar/freebusy/suggest', {
        users: ids.filter((id) => id !== me.id),
        from,
        to: from + 14 * 86_400_000,
        duration,
        workdays,
      })
      .then((result) => setSuggestions(result.suggestions))
      .catch((failure) => setError(errorText(failure)));
  }, [day, duration, workdays, ids.join(',')]);

  const first = Math.min(prefs?.workStart ?? 480, 7 * 60);
  const last = Math.max(prefs?.workEnd ?? 1080, 20 * 60);
  const span = last - first;
  const hours = Array.from({ length: Math.ceil(span / 60) }, (_, index) => Math.floor(first / 60) + index);
  const position = (utc: number) => Math.max(0, Math.min(100, ((minuteOf(utc) - first) / span) * 100));
  const start = dayStart(day);
  const end = dayStart(addDays(day, 1));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={compact}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {t('Gemeinsame Zeit finden')}
        </Box>
        <IconButton aria-label={t('Schließen')} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <PeopleInput
              allowEmail={false}
              exclude={[...people.map((person) => person.email), (me.email ?? `${me.username}@users.moecloud.invalid`).toLowerCase()]}
              onPick={(person) => person.userId && setPeople((list) => [...list, person])}
            />
          </Box>
          <TextField
            select
            size="small"
            label={t('Dauer')}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            sx={{ minWidth: 140 }}
          >
            {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
              <MenuItem key={minutes} value={minutes}>
                {durationText(minutes)}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={workdays} onChange={(event) => setWorkdays(event.target.checked)} />}
            label={t('Nur Werktage')}
          />
        </Box>
        {people.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {people.map((person) => (
              <Chip
                key={person.email}
                avatar={<UserAvatar initials={person.initials} size={24} />}
                label={person.name ?? person.email}
                onDelete={() => setPeople((list) => list.filter((entry) => entry.email !== person.email))}
              />
            ))}
          </Box>
        )}

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <IconButton aria-label={t('Vorheriger Tag')} onClick={() => setDay(addDays(day, -1))}>
              <ChevronLeftRounded />
            </IconButton>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, textAlign: 'center' }}>
              {formatDayLong(day)}
            </Typography>
            <IconButton aria-label={t('Nächster Tag')} onClick={() => setDay(addDays(day, 1))}>
              <ChevronRightRounded />
            </IconButton>
          </Box>
          <Box sx={{ borderRadius: `${radius.lg}px`, border: `1px solid ${c.outlineVariant}`, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', borderBottom: `1px solid ${c.outlineVariant}`, bgcolor: c.surfaceContainerLow }}>
              <Box sx={{ width: { xs: 96, sm: 160 }, flex: 'none' }} />
              <Box sx={{ flex: 1, position: 'relative', height: 28 }}>
                {hours.map((hour) => (
                  <Typography
                    key={hour}
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      top: 6,
                      left: `${((hour * 60 - first) / span) * 100}%`,
                      transform: 'translateX(-50%)',
                      color: c.onSurfaceVariant,
                      fontSize: 10.5,
                      display: hour % (compact ? 3 : 2) ? 'none' : 'block',
                    }}
                  >
                    {formatHour(hour)}
                  </Typography>
                ))}
              </Box>
            </Box>
            {rows === null && <LinearProgress />}
            {rows?.map((row) => (
              <Box
                key={row.userId}
                sx={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.outlineVariant}`, minHeight: 48 }}
              >
                <Box sx={{ width: { xs: 96, sm: 160 }, flex: 'none', display: 'flex', alignItems: 'center', gap: 1, px: 1.5 }}>
                  <UserAvatar initials={row.initials} size={28} />
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {row.userId === me.id ? t('Du') : row.name}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, position: 'relative', height: 48, bgcolor: mix(c.onSurface, 2) }}>
                  {hours.map((hour) => (
                    <Box
                      key={hour}
                      sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${((hour * 60 - first) / span) * 100}%`,
                        borderLeft: `1px solid ${mix(c.outlineVariant, 60)}`,
                      }}
                    />
                  ))}
                  {row.workStart !== undefined && row.workEnd !== undefined && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${Math.max(0, ((row.workStart - first) / span) * 100)}%`,
                        width: `${Math.max(0, ((Math.min(row.workEnd, last) - Math.max(row.workStart, first)) / span) * 100)}%`,
                        bgcolor: mix('#22c55e', 7),
                      }}
                    />
                  )}
                  {!row.visible && (
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 0.5,
                        color: c.onSurfaceVariant,
                      }}
                    >
                      <LockRounded sx={{ fontSize: 16 }} />
                      <Typography variant="caption">{t('Kalender nicht freigegeben')}</Typography>
                    </Box>
                  )}
                  {row.busy
                    .filter((busy) => busy.end > start && busy.start < end)
                    .map((busy, index) => {
                      const left = busy.allDay || busy.start <= start ? 0 : position(busy.start);
                      const right = busy.allDay || busy.end >= end ? 100 : position(busy.end);
                      if (right <= left) return null;
                      return (
                        <Tooltip
                          key={index}
                          title={busy.allDay ? t('Ganztägig beschäftigt') : `${formatTime(busy.start)}–${formatTime(busy.end)}`}
                        >
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 8,
                              bottom: 8,
                              left: `${left}%`,
                              width: `${right - left}%`,
                              borderRadius: `${radius.xs}px`,
                              bgcolor: busy.allDay ? mix(c.tertiary, 35) : c.primary,
                              opacity: 0.85,
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('Vorschläge')}
          </Typography>
          {suggestions === null && <LinearProgress />}
          {suggestions?.length === 0 && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('In den nächsten zwei Wochen passt nichts. Probier eine kürzere Dauer.')}
            </Typography>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1 }}>
            {suggestions?.map((slot) => (
              <ButtonBase
                key={slot.start}
                onClick={() => {
                  onPick(slot.start, slot.end, people);
                  onClose();
                }}
                sx={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  p: 1.5,
                  borderRadius: `${radius.md}px`,
                  border: `1px solid ${c.outlineVariant}`,
                  textAlign: 'left',
                  '&:hover': { bgcolor: mix(c.primary, 8), borderColor: c.primary },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatDayMedium(keyOf(slot.start))}
                </Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {formatTime(slot.start)}–{formatTime(slot.end)}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Schließen')}</Button>
      </DialogActions>
    </Dialog>
  );
}
