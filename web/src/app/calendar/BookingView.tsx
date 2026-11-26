import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
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
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { EmptyState, copyText } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { durationText, formatClock, formatDayMedium, formatTime, getZone, keyOf, weekdayName } from './dates';
import { PALETTE } from './model';
import { useCalendarState, writableCalendars } from './store';

type Interval = [number, number];

interface Question {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'phone' | 'select' | 'checkbox';
  required: boolean;
  options: string[];
}

export interface BookingPageInfo {
  id: string;
  slug: string;
  title: string;
  description: string;
  calendarId: string | null;
  durations: number[];
  availability: { weekly: Record<string, Interval[]>; dates: Record<string, Interval[]> } | null;
  zone: string;
  bufferBefore: number;
  bufferAfter: number;
  notice: number;
  window: number;
  maxPerDay: number;
  step: number;
  conflicts: string[];
  locationKind: 'none' | 'place' | 'phone' | 'video' | 'link';
  location: string;
  questions: Question[];
  color: string | null;
  enabled: boolean;
  bookings?: number;
}

interface Booking {
  id: string;
  eventId: string | null;
  name: string;
  email: string;
  notes: string;
  answers: Record<string, string>;
  start: number;
  end: number;
  status: 'confirmed' | 'cancelled';
  createdAt: number;
}

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180];
const CLOCK = Array.from({ length: 96 }, (_, index) => index * 15);

function blank(): BookingPageInfo {
  return {
    id: '',
    slug: '',
    title: '',
    description: '',
    calendarId: writableCalendars()[0]?.id ?? null,
    durations: [30],
    availability: {
      weekly: { '1': [[540, 1020]], '2': [[540, 1020]], '3': [[540, 1020]], '4': [[540, 1020]], '5': [[540, 1020]] },
      dates: {},
    },
    zone: getZone(),
    bufferBefore: 0,
    bufferAfter: 0,
    notice: 240,
    window: 60,
    maxPerDay: 0,
    step: 30,
    conflicts: writableCalendars().map((calendar) => calendar.id),
    locationKind: 'video',
    location: '',
    questions: [],
    color: null,
    enabled: true,
  };
}

function Clock({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      slotProps={{ htmlInput: { 'aria-label': label }, select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 300 } } } } } }}
      sx={{ minWidth: 100 }}
    >
      {[...new Set([...CLOCK, value, 1440])]
        .sort((a, b) => a - b)
        .map((minutes) => (
          <MenuItem key={minutes} value={minutes}>
            {minutes === 1440 ? '24:00' : formatClock(minutes)}
          </MenuItem>
        ))}
    </TextField>
  );
}

function PageEditor({ page, onClose, onSaved }: { page: BookingPageInfo; onClose: () => void; onSaved: () => void }) {
  const { calendars } = useCalendarState();
  const compact = useMediaQuery('(max-width:720px)');
  const [draft, setDraft] = useState<BookingPageInfo>(page);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BookingPageInfo>) => setDraft((current) => ({ ...current, ...patch }));
  const weekly = draft.availability?.weekly ?? {};
  const setWeekly = (day: number, intervals: Interval[]) =>
    set({ availability: { weekly: { ...weekly, [day]: intervals }, dates: draft.availability?.dates ?? {} } });
  const zones = supportedZones();

  const save = async () => {
    setBusy(true);
    setError(null);
    const { id, bookings: _bookings, ...body } = draft;
    try {
      if (id) await api.patch(`/api/calendar/booking-pages/${id}`, body);
      else await api.post('/api/calendar/booking-pages', { ...body, slug: body.slug.trim() || undefined });
      toast(t('Buchungsseite gespeichert'));
      onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={compact}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {draft.id ? t('Buchungsseite bearbeiten') : t('Neue Buchungsseite')}
        </Box>
        <IconButton aria-label={t('Schließen')} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        variant="scrollable"
        sx={{ px: 2, borderBottom: `1px solid ${c.outlineVariant}` }}
      >
        <Tab label={t('Allgemein')} />
        <Tab label={t('Verfügbarkeit')} />
        <Tab label={t('Regeln')} />
        <Tab label={t('Fragen')} />
      </Tabs>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '20px !important', minHeight: 420 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {tab === 0 && (
          <>
            <TextField
              autoFocus
              label={t('Titel')}
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder={t('z. B. Kennenlerngespräch')}
              required
            />
            <TextField
              label={t('Adresse')}
              value={draft.slug}
              onChange={(event) => set({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              helperText={`${location.origin}/b/${draft.slug || t('wird-automatisch-erzeugt')}`}
            />
            <TextField
              label={t('Beschreibung')}
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
              multiline
              minRows={3}
            />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('Wählbare Dauer')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {DURATIONS.map((minutes) => {
                  const on = draft.durations.includes(minutes);
                  return (
                    <Chip
                      key={minutes}
                      label={durationText(minutes)}
                      color={on ? 'primary' : 'default'}
                      variant={on ? 'filled' : 'outlined'}
                      onClick={() => {
                        const next = on
                          ? draft.durations.filter((entry) => entry !== minutes)
                          : [...draft.durations, minutes].sort((a, b) => a - b);
                        if (next.length && next.length <= 6) set({ durations: next });
                      }}
                    />
                  );
                })}
              </Box>
            </Box>
            <TextField
              select
              label={t('Buchungen landen in')}
              value={draft.calendarId ?? ''}
              onChange={(event) => set({ calendarId: event.target.value || null })}
            >
              {writableCalendars().map((calendar) => (
                <MenuItem key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                select
                label={t('Ort')}
                value={draft.locationKind}
                onChange={(event) => set({ locationKind: event.target.value as BookingPageInfo['locationKind'] })}
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="none">{t('Keine Angabe')}</MenuItem>
                <MenuItem value="video">{t('Videokonferenz (Jitsi, automatisch)')}</MenuItem>
                <MenuItem value="link">{t('Eigener Link')}</MenuItem>
                <MenuItem value="place">{t('Adresse')}</MenuItem>
                <MenuItem value="phone">{t('Telefon')}</MenuItem>
              </TextField>
              {draft.locationKind !== 'none' && draft.locationKind !== 'video' && (
                <TextField
                  label={draft.locationKind === 'phone' ? t('Telefonnummer') : draft.locationKind === 'link' ? t('Link') : t('Adresse')}
                  value={draft.location}
                  onChange={(event) => set({ location: event.target.value })}
                  sx={{ flex: 1, minWidth: 220 }}
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {PALETTE.slice(0, 12).map((hex) => (
                <Box
                  key={hex}
                  component="button"
                  type="button"
                  aria-label={hex}
                  aria-pressed={draft.color === hex}
                  onClick={() => set({ color: draft.color === hex ? null : hex })}
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: 0,
                    cursor: 'pointer',
                    bgcolor: hex,
                    outline: draft.color === hex ? `3px solid ${c.onSurface}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </Box>
            <FormControlLabel
              control={<Switch checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} />}
              label={t('Seite ist online')}
            />
          </>
        )}
        {tab === 1 && (
          <>
            <TextField select size="small" label={t('Zeitzone')} value={draft.zone} onChange={(event) => set({ zone: event.target.value })}>
              {zones.map((zone) => (
                <MenuItem key={zone} value={zone}>
                  {zoneLabel(zone)}
                </MenuItem>
              ))}
            </TextField>
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const intervals = weekly[String(day)] ?? [];
              return (
                <Box
                  key={day}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    py: 0.5,
                    borderBottom: `1px solid ${c.outlineVariant}`,
                  }}
                >
                  <FormControlLabel
                    sx={{ width: 150 }}
                    control={
                      <Checkbox
                        checked={intervals.length > 0}
                        onChange={(event) => setWeekly(day, event.target.checked ? [[540, 1020]] : [])}
                      />
                    }
                    label={weekdayName(day, 'long')}
                  />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                    {intervals.length === 0 && (
                      <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 1 }}>
                        {t('Nicht buchbar')}
                      </Typography>
                    )}
                    {intervals.map(([from, to], index) => (
                      <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Clock
                          label={t('Von')}
                          value={from}
                          onChange={(value) =>
                            setWeekly(
                              day,
                              intervals.map((entry, position) => (position === index ? [value, Math.max(value + 15, entry[1])] : entry))
                            )
                          }
                        />
                        <span>–</span>
                        <Clock
                          label={t('Bis')}
                          value={to}
                          onChange={(value) =>
                            setWeekly(
                              day,
                              intervals.map((entry, position) => (position === index ? [entry[0], value] : entry))
                            )
                          }
                        />
                        <IconButton
                          size="small"
                          aria-label={t('Zeitraum entfernen')}
                          onClick={() =>
                            setWeekly(
                              day,
                              intervals.filter((_, position) => position !== index)
                            )
                          }
                        >
                          <CloseRounded fontSize="small" />
                        </IconButton>
                        {index === intervals.length - 1 && intervals.length < 6 && (
                          <Tooltip title={t('Weiteren Zeitraum hinzufügen')}>
                            <IconButton
                              size="small"
                              aria-label={t('Weiteren Zeitraum hinzufügen')}
                              onClick={() => setWeekly(day, [...intervals, [Math.min(1380, to + 60), Math.min(1440, to + 180)]])}
                            >
                              <AddRounded fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </>
        )}
        {tab === 2 && (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                select
                label={t('Vorlauf mindestens')}
                value={draft.notice}
                onChange={(event) => set({ notice: Number(event.target.value) })}
              >
                {[0, 60, 120, 240, 720, 1440, 2880, 10080].map((minutes) => (
                  <MenuItem key={minutes} value={minutes}>
                    {minutes === 0 ? t('Kein Vorlauf') : durationText(minutes)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('Buchbar für die nächsten')}
                value={draft.window}
                onChange={(event) => set({ window: Number(event.target.value) })}
              >
                {[7, 14, 30, 60, 90, 180, 365].map((days) => (
                  <MenuItem key={days} value={days}>
                    {tn(days, '1 Tag', '{count} Tage')}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('Puffer davor')}
                value={draft.bufferBefore}
                onChange={(event) => set({ bufferBefore: Number(event.target.value) })}
              >
                {[0, 5, 10, 15, 30, 60].map((minutes) => (
                  <MenuItem key={minutes} value={minutes}>
                    {minutes ? durationText(minutes) : t('Kein Puffer')}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('Puffer danach')}
                value={draft.bufferAfter}
                onChange={(event) => set({ bufferAfter: Number(event.target.value) })}
              >
                {[0, 5, 10, 15, 30, 60].map((minutes) => (
                  <MenuItem key={minutes} value={minutes}>
                    {minutes ? durationText(minutes) : t('Kein Puffer')}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('Startzeiten im Abstand von')}
                value={draft.step}
                onChange={(event) => set({ step: Number(event.target.value) })}
              >
                {[5, 10, 15, 20, 30, 60].map((minutes) => (
                  <MenuItem key={minutes} value={minutes}>
                    {durationText(minutes)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('Höchstens pro Tag')}
                value={draft.maxPerDay}
                onChange={(event) => set({ maxPerDay: Number(event.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
                  <MenuItem key={count} value={count}>
                    {count ? tn(count, '1 Buchung', '{count} Buchungen') : t('Unbegrenzt')}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('Auf Überschneidungen prüfen in')}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('Zeiten, in denen du in diesen Kalendern beschäftigt bist, sind nicht buchbar.')}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {calendars
                  .filter((calendar) => calendar.access === 'owner' || calendar.access === 'write' || calendar.access === 'read')
                  .map((calendar) => (
                    <FormControlLabel
                      key={calendar.id}
                      control={
                        <Checkbox
                          checked={draft.conflicts.includes(calendar.id)}
                          onChange={(event) =>
                            set({
                              conflicts: event.target.checked
                                ? [...draft.conflicts, calendar.id]
                                : draft.conflicts.filter((id) => id !== calendar.id),
                            })
                          }
                        />
                      }
                      label={calendar.name}
                    />
                  ))}
              </Box>
            </Box>
          </>
        )}
        {tab === 3 && (
          <>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Name und E-Mail fragt MoeCloud immer ab. Hier ergänzt du eigene Fragen.')}
            </Typography>
            {draft.questions.map((question, index) => (
              <Box
                key={question.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  p: 2,
                  borderRadius: `${radius.md}px`,
                  bgcolor: c.surfaceContainerHigh,
                }}
              >
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('Frage')}
                    value={question.label}
                    onChange={(event) =>
                      set({
                        questions: draft.questions.map((entry, position) =>
                          position === index ? { ...entry, label: event.target.value } : entry
                        ),
                      })
                    }
                  />
                  <IconButton
                    aria-label={t('Frage entfernen')}
                    onClick={() => set({ questions: draft.questions.filter((_, position) => position !== index) })}
                  >
                    <DeleteOutlineRounded />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextField
                    select
                    size="small"
                    label={t('Art')}
                    value={question.type}
                    onChange={(event) =>
                      set({
                        questions: draft.questions.map((entry, position) =>
                          position === index ? { ...entry, type: event.target.value as Question['type'] } : entry
                        ),
                      })
                    }
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="text">{t('Kurzer Text')}</MenuItem>
                    <MenuItem value="textarea">{t('Langer Text')}</MenuItem>
                    <MenuItem value="phone">{t('Telefonnummer')}</MenuItem>
                    <MenuItem value="select">{t('Auswahl')}</MenuItem>
                    <MenuItem value="checkbox">{t('Häkchen')}</MenuItem>
                  </TextField>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={question.required}
                        onChange={(event) =>
                          set({
                            questions: draft.questions.map((entry, position) =>
                              position === index ? { ...entry, required: event.target.checked } : entry
                            ),
                          })
                        }
                      />
                    }
                    label={t('Pflichtfeld')}
                  />
                </Box>
                {question.type === 'select' && (
                  <TextField
                    size="small"
                    label={t('Antworten, eine pro Zeile')}
                    multiline
                    minRows={2}
                    value={question.options.join('\n')}
                    onChange={(event) =>
                      set({
                        questions: draft.questions.map((entry, position) =>
                          position === index ? { ...entry, options: event.target.value.split('\n').slice(0, 20) } : entry
                        ),
                      })
                    }
                  />
                )}
              </Box>
            ))}
            {draft.questions.length < 10 && (
              <Button
                startIcon={<AddRounded />}
                onClick={() =>
                  set({
                    questions: [
                      ...draft.questions,
                      { id: Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false, options: [] },
                    ],
                  })
                }
                sx={{ alignSelf: 'flex-start' }}
              >
                {t('Frage hinzufügen')}
              </Button>
            )}
          </>
        )}
        {busy && <LinearProgress />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !draft.title.trim() || !draft.durations.length}>
          {t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Bookings({ page, onClose }: { page: BookingPageInfo; onClose: () => void }) {
  const [items, setItems] = useState<Booking[] | null>(null);
  useEffect(() => {
    api
      .get<{ items: Booking[] }>(`/api/calendar/booking-pages/${page.id}/bookings`)
      .then((result) => setItems(result.items))
      .catch((error) => toast(errorText(error)));
  }, [page.id]);
  const now = Date.now();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Buchungen für „{title}“', { title: page.title })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items === null && <LinearProgress />}
        {items?.length === 0 && <Typography sx={{ color: c.onSurfaceVariant }}>{t('Noch keine Buchungen.')}</Typography>}
        {items?.map((booking) => (
          <Box
            key={booking.id}
            sx={{
              p: 1.5,
              borderRadius: `${radius.md}px`,
              bgcolor: c.surfaceContainerHigh,
              opacity: booking.status === 'cancelled' || booking.end < now ? 0.6 : 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontWeight: 700, flex: 1 }}>{booking.name}</Typography>
              {booking.status === 'cancelled' && <Chip size="small" label={t('Storniert')} color="error" variant="outlined" />}
            </Box>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {formatDayMedium(keyOf(booking.start))}, {formatTime(booking.start)}–{formatTime(booking.end)} · {booking.email}
            </Typography>
            {booking.notes && (
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                {booking.notes}
              </Typography>
            )}
            {Object.entries(booking.answers).map(([id, answer]) => (
              <Typography key={id} variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                {page.questions.find((question) => question.id === id)?.label ?? id}: {answer}
              </Typography>
            ))}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Schließen')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function BookingView() {
  const [pages, setPages] = useState<BookingPageInfo[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState<BookingPageInfo | null>(null);
  const [viewing, setViewing] = useState<BookingPageInfo | null>(null);
  const load = () =>
    api
      .get<{ items: BookingPageInfo[]; enabled: boolean }>('/api/calendar/booking-pages')
      .then((result) => {
        setPages(result.items);
        setEnabled(result.enabled);
      })
      .catch((error) => toast(errorText(error)));
  useEffect(() => {
    void load();
  }, []);

  const remove = async (page: BookingPageInfo) => {
    const ok = await confirm({
      title: t('„{title}“ löschen?', { title: page.title }),
      text: t('Bestehende Buchungen bleiben als Termine in deinem Kalender.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/calendar/booking-pages/${page.id}`);
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const toggle = async (page: BookingPageInfo) => {
    try {
      await api.patch(`/api/calendar/booking-pages/${page.id}`, { enabled: !page.enabled });
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 960, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
              {t('Buchungsseiten')}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Teile einen Link, über den andere freie Zeiten in deinem Kalender buchen können, ganz ohne Hin und Her.')}
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing(blank())} disabled={!enabled}>
            {t('Neue Buchungsseite')}
          </Button>
        </Box>
        {!enabled && <Alert severity="info">{t('Buchungsseiten sind auf diesem Server ausgeschaltet.')}</Alert>}
        {pages === null && <LinearProgress />}
        {pages?.length === 0 && enabled && (
          <EmptyState
            icon={<EventAvailableRounded />}
            title={t('Noch keine Buchungsseite')}
            text={t(
              'Lege fest, wann du verfügbar bist, und MoeCloud zeigt nur die freien Zeiten an. Gebuchte Termine landen direkt in deinem Kalender.'
            )}
            action={
              <Button variant="contained" onClick={() => setEditing(blank())}>
                {t('Erste Buchungsseite anlegen')}
              </Button>
            }
          />
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1.5 }}>
          {pages?.map((page) => {
            const link = `${location.origin}/b/${page.slug}`;
            return (
              <Box
                key={page.id}
                sx={{
                  p: 2.25,
                  borderRadius: `${radius.lg}px`,
                  bgcolor: c.surfaceContainerLowest,
                  border: `1px solid ${c.outlineVariant}`,
                  borderTop: `4px solid ${page.color ?? c.primary}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  opacity: page.enabled ? 1 : 0.65,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                      {page.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                      {page.durations.map(durationText).join(' · ')}
                    </Typography>
                  </Box>
                  <Switch checked={page.enabled} onChange={() => void toggle(page)} slotProps={{ input: { 'aria-label': t('Online') } }} />
                </Box>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
                  {link.replace(/^https?:\/\//, '')}
                </Typography>
                <Typography variant="body2">{tn(page.bookings ?? 0, '1 anstehende Buchung', '{count} anstehende Buchungen')}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 'auto' }}>
                  <Tooltip title={t('Link kopieren')}>
                    <IconButton aria-label={t('Link kopieren')} onClick={() => void copyText(link, t('Link kopiert'))}>
                      <ContentCopyRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Seite öffnen')}>
                    <IconButton aria-label={t('Seite öffnen')} href={link} target="_blank" rel="noopener">
                      <OpenInNewRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Buchungen')}>
                    <IconButton aria-label={t('Buchungen')} onClick={() => setViewing(page)}>
                      <PeopleAltRounded />
                    </IconButton>
                  </Tooltip>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title={t('Bearbeiten')}>
                    <IconButton aria-label={t('Bearbeiten')} onClick={() => setEditing(page)}>
                      <EditRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Löschen')}>
                    <IconButton aria-label={t('Löschen')} onClick={() => void remove(page)}>
                      <DeleteOutlineRounded />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
      {editing && <PageEditor page={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {viewing && <Bookings page={viewing} onClose={() => setViewing(null)} />}
    </Box>
  );
}
