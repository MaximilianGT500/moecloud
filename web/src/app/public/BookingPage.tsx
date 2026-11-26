import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import PhoneRounded from '@mui/icons-material/PhoneRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import EventBusyRounded from '@mui/icons-material/EventBusyRounded';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { api, errorText } from '../../lib/api';
import { boot, type Boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { UserAvatar } from '../common/bits';
import {
  addDays,
  addMonths,
  dayNumber,
  durationText,
  formatDayLong,
  formatMonth,
  formatSpan,
  formatTime,
  getZone,
  parseKey,
  setZone,
  startOfMonth,
  startOfWeek,
  today,
  weekdayNarrow,
} from '../calendar/dates';
import type { BookingPageInfo } from '../calendar/BookingView';
import { PublicFrame } from './PublicFrame';

interface PublicPage extends Omit<BookingPageInfo, 'availability'> {
  owner: { name: string; initials: string };
}

interface BookingSummary {
  name: string;
  email: string;
  start: number;
  end: number;
  zone: string;
  status: 'confirmed' | 'cancelled';
  page: { slug: string; title: string; owner: string; location: string };
  past: boolean;
}

interface BookBoot extends Boot {
  booking: { mode: 'book'; page: PublicPage } | { mode: 'manage'; token: string; booking: BookingSummary; page: PublicPage };
}

function LocationLine({ page }: { page: PublicPage }) {
  if (page.locationKind === 'none') return null;
  const icon =
    page.locationKind === 'video' || page.locationKind === 'link' ? (
      <VideocamRounded />
    ) : page.locationKind === 'phone' ? (
      <PhoneRounded />
    ) : (
      <PlaceOutlined />
    );
  const text =
    page.locationKind === 'video'
      ? t('Videokonferenz, der Link kommt mit der Bestätigung')
      : page.locationKind === 'link'
        ? t('Online, der Link kommt mit der Bestätigung')
        : page.location;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: c.onSurfaceVariant, '& svg': { fontSize: 20 } }}>
      {icon}
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}

function Manage({ token, booking: initial, page }: { token: string; booking: BookingSummary; page: PublicPage }) {
  const [booking, setBooking] = useState(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ booking: BookingSummary }>(`/api/calendar/public/booking/${token}/cancel`, { reason });
      setBooking(result.booking);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  const cancelled = booking.status === 'cancelled';
  return (
    <Box
      sx={{
        maxWidth: 560,
        mx: 'auto',
        mt: 4,
        p: { xs: 2.5, sm: 4 },
        borderRadius: `${radius.xl}px`,
        bgcolor: c.surfaceContainerLow,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {cancelled ? (
          <EventBusyRounded sx={{ color: c.error, fontSize: 36 }} />
        ) : (
          <CheckCircleRounded sx={{ color: '#22c55e', fontSize: 36 }} />
        )}
        <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
          {cancelled ? t('Termin storniert') : t('Dein Termin steht')}
        </Typography>
      </Box>
      <Typography variant="h6">{booking.page.title}</Typography>
      <Typography sx={{ color: c.onSurfaceVariant }}>{t('mit {name}', { name: booking.page.owner })}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleRounded sx={{ color: c.onSurfaceVariant }} />
        <Typography sx={{ textDecoration: cancelled ? 'line-through' : 'none' }}>
          {formatSpan(booking.start, booking.end, false)}
        </Typography>
      </Box>
      <LocationLine page={page} />
      {error && <Alert severity="error">{error}</Alert>}
      {!cancelled && !booking.past && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
          <TextField
            label={t('Grund (optional)')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Button color="error" variant="outlined" onClick={() => void cancel()} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
            {t('Termin stornieren')}
          </Button>
          <Button href={`/b/${booking.page.slug}`} sx={{ alignSelf: 'flex-start' }}>
            {t('Anderen Termin buchen')}
          </Button>
        </Box>
      )}
      {cancelled && (
        <Button variant="contained" href={`/b/${booking.page.slug}`} sx={{ alignSelf: 'flex-start' }}>
          {t('Neuen Termin buchen')}
        </Button>
      )}
    </Box>
  );
}

export function BookingPage() {
  const data = boot<BookBoot>().booking;
  if (data.mode === 'manage')
    return (
      <PublicFrame>
        <Manage token={data.token} booking={data.booking} page={data.page} />
      </PublicFrame>
    );
  return (
    <PublicFrame>
      <Book page={data.page} />
    </PublicFrame>
  );
}

function Book({ page }: { page: PublicPage }) {
  const [duration, setDuration] = useState(page.durations[0]);
  const [zone, setVisitorZone] = useState(getZone());
  const [month, setMonth] = useState(startOfMonth(today()));
  const [days, setDays] = useState<Map<string, number[]> | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', notes: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; start: number; end: number } | null>(null);
  const zones = useMemo(() => supportedZones(), []);

  useEffect(() => {
    setZone(zone);
  }, [zone]);

  useEffect(() => {
    setDays(null);
    const from = month < today() ? today() : month;
    api
      .get<{ zone: string; days: { date: string; slots: number[] }[] }>(
        `/api/calendar/public/book/${page.slug}/slots?from=${from}&days=42&duration=${duration}`
      )
      .then((result) => {
        const map = new Map<string, number[]>();
        for (const entry of result.days) {
          for (const start of entry.slots) {
            const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
              start
            );
            const list = map.get(key) ?? [];
            list.push(start);
            map.set(key, list);
          }
        }
        setDays(map);
        if (day && !map.has(day)) setDay(null);
        if (!day) {
          const first = [...map.keys()].sort()[0];
          if (first && first.slice(0, 7) === month.slice(0, 7)) setDay(first);
        }
      })
      .catch((failure) => setError(errorText(failure)));
  }, [month, duration, zone]);

  const submit = async () => {
    if (slot === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ token: string; start: number; end: number }>(`/api/calendar/public/book/${page.slug}`, {
        start: slot,
        duration,
        ...form,
        answers,
        zone,
      });
      setDone(result);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Box
        sx={{
          maxWidth: 560,
          mx: 'auto',
          mt: 4,
          p: { xs: 2.5, sm: 4 },
          borderRadius: `${radius.xl}px`,
          bgcolor: c.surfaceContainerLow,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          textAlign: 'center',
          alignItems: 'center',
        }}
      >
        <CheckCircleRounded sx={{ color: '#22c55e', fontSize: 56 }} />
        <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
          {t('Gebucht!')}
        </Typography>
        <Typography>{t('{title} mit {name}', { title: page.title, name: page.owner.name })}</Typography>
        <Typography sx={{ fontWeight: 700 }}>{formatSpan(done.start, done.end, false)}</Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {form.email
            ? t('Eine Bestätigung mit Kalendereintrag ist unterwegs an {email}.', { email: form.email })
            : t('Speichere dir den Link unten, um den Termin später zu verwalten.')}
        </Typography>
        <Button variant="outlined" href={`/b/manage/${done.token}`}>
          {t('Termin verwalten')}
        </Button>
      </Box>
    );
  }

  const first = startOfWeek(month, 1);
  const grid = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const slots = day ? (days?.get(day) ?? []) : [];
  const required = page.questions.filter((question) => question.required);
  const ready =
    form.name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    required.every((question) => (answers[question.id] ?? '').trim());

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '320px 1fr' }, gap: 2, mt: 2 }}>
      <Box
        sx={{
          p: 3,
          borderRadius: `${radius.xl}px`,
          bgcolor: c.surfaceContainerLow,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          alignSelf: 'start',
          borderTop: `6px solid ${page.color ?? c.primary}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <UserAvatar initials={page.owner.initials} size={40} />
          <Typography sx={{ fontWeight: 600 }}>{page.owner.name}</Typography>
        </Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
          {page.title}
        </Typography>
        {page.description && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {page.description}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: c.onSurfaceVariant }}>
          <ScheduleRounded sx={{ fontSize: 20 }} />
          <Typography variant="body2">{page.durations.map(durationText).join(' · ')}</Typography>
        </Box>
        <LocationLine page={page} />
        {page.durations.length > 1 && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={duration}
            onChange={(_event, value) => {
              if (!value) return;
              setDuration(value);
              setSlot(null);
            }}
            sx={{ flexWrap: 'wrap' }}
          >
            {page.durations.map((minutes) => (
              <ToggleButton key={minutes} value={minutes}>
                {durationText(minutes)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <TextField
          select
          size="small"
          label={t('Deine Zeitzone')}
          value={zone}
          onChange={(event) => {
            setVisitorZone(event.target.value);
            setSlot(null);
          }}
          slotProps={{ input: { startAdornment: <PublicRounded sx={{ fontSize: 18, mr: 1, color: c.onSurfaceVariant }} /> } }}
        >
          {zones.map((entry) => (
            <MenuItem key={entry} value={entry}>
              {zoneLabel(entry)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: `${radius.xl}px`, bgcolor: c.surfaceContainerLow, minWidth: 0 }}>
        {slot === null ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 220px' }, gap: 3 }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
                  {formatMonth(month)}
                </Typography>
                <IconButton
                  aria-label={t('Vorheriger Monat')}
                  disabled={month <= startOfMonth(today())}
                  onClick={() => setMonth(addMonths(month, -1))}
                >
                  <ChevronLeftRounded />
                </IconButton>
                <IconButton
                  aria-label={t('Nächster Monat')}
                  disabled={month >= startOfMonth(addDays(today(), page.window))}
                  onClick={() => setMonth(addMonths(month, 1))}
                >
                  <ChevronRightRounded />
                </IconButton>
              </Box>
              {days === null && <LinearProgress sx={{ mb: 1 }} />}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }} role="grid" aria-label={formatMonth(month)}>
                {Array.from({ length: 7 }, (_, index) => (
                  <Typography key={index} variant="caption" sx={{ textAlign: 'center', color: c.onSurfaceVariant, fontWeight: 700 }}>
                    {weekdayNarrow((1 + index) % 7)}
                  </Typography>
                ))}
                {grid.map((key) => {
                  const inMonth = parseKey(key).month === parseKey(month).month;
                  const available = Boolean(days?.get(key)?.length);
                  const selected = key === day;
                  return (
                    <ButtonBase
                      key={key}
                      role="gridcell"
                      aria-label={formatDayLong(key)}
                      aria-selected={selected}
                      disabled={!available || !inMonth}
                      onClick={() => setDay(key)}
                      sx={{
                        aspectRatio: '1',
                        borderRadius: '50%',
                        fontWeight: available ? 800 : 400,
                        fontSize: 15,
                        visibility: inMonth ? 'visible' : 'hidden',
                        color: selected ? c.onPrimary : available ? c.primary : c.onSurfaceVariant,
                        bgcolor: selected ? c.primary : available ? mix(c.primary, 12) : 'transparent',
                        opacity: available ? 1 : 0.45,
                        '&:hover': { bgcolor: selected ? c.primary : mix(c.primary, 22) },
                      }}
                    >
                      {dayNumber(key)}
                    </ButtonBase>
                  );
                })}
              </Box>
              {days && days.size === 0 && (
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 2 }}>
                  {t('In diesem Zeitraum ist leider nichts mehr frei.')}
                </Typography>
              )}
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                {day ? formatDayLong(day) : t('Wähl einen Tag')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 420, overflowY: 'auto', pr: 0.5 }}>
                {slots.map((start) => (
                  <Button
                    key={start}
                    variant="outlined"
                    onClick={() => setSlot(start)}
                    sx={{ justifyContent: 'center', py: 1.25, fontWeight: 700, borderRadius: `${radius.md}px` }}
                  >
                    {formatTime(start)}
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
        ) : (
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton aria-label={t('Zurück')} onClick={() => setSlot(null)}>
                <ArrowBackRounded />
              </IconButton>
              <Box>
                <Typography sx={{ fontWeight: 700 }}>{formatSpan(slot, slot + duration * 60_000, false)}</Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {durationText(duration)} · {zoneLabel(zone)}
                </Typography>
              </Box>
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              label={t('Dein Name')}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoComplete="name"
            />
            <TextField
              required
              type="email"
              label={t('E-Mail-Adresse')}
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email"
              helperText={t('Dorthin schicken wir die Bestätigung')}
            />
            {page.questions.map((question) =>
              question.type === 'checkbox' ? (
                <FormControlLabel
                  key={question.id}
                  control={
                    <Checkbox
                      checked={answers[question.id] === 'ja'}
                      onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.checked ? 'ja' : '' })}
                      required={question.required}
                    />
                  }
                  label={question.label}
                />
              ) : question.type === 'select' ? (
                <TextField
                  key={question.id}
                  select
                  required={question.required}
                  label={question.label}
                  value={answers[question.id] ?? ''}
                  onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                >
                  {question.options.filter(Boolean).map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  key={question.id}
                  required={question.required}
                  label={question.label}
                  type={question.type === 'phone' ? 'tel' : 'text'}
                  multiline={question.type === 'textarea'}
                  minRows={question.type === 'textarea' ? 3 : undefined}
                  value={answers[question.id] ?? ''}
                  onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                />
              )
            )}
            <TextField
              label={t('Nachricht (optional)')}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              multiline
              minRows={3}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            {busy && <LinearProgress />}
            <Button
              type="submit"
              variant="contained"
              size="large"
              startIcon={<EventAvailableRounded />}
              disabled={busy || !ready}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('Verbindlich buchen')}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
