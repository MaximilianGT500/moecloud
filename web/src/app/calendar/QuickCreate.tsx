import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import { parseQuick } from '../../../../shared/quickadd';
import { errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { addDays, at, formatSpan, keyOf, minuteOf, today } from './dates';
import { newForm, payloadOf, type Form } from './form';
import { describe } from './RecurrenceEditor';
import { calendarApi } from './model';
import { defaultCalendar, invalidate, useCalendarState, writableCalendars } from './store';
import type { MoveChange } from './views/TimeGrid';

interface Props {
  range: MoveChange | null;
  anchor: HTMLElement | null;
  initialText?: string;
  onClose: () => void;
  onMore: (form: Form) => void;
}

export function QuickCreate({ range, anchor, initialText = '', onClose, onMore }: Props) {
  const { prefs } = useCalendarState();
  const mobile = useMediaQuery('(max-width:600px)');
  const [text, setText] = useState(initialText);
  const [component, setComponent] = useState<'VEVENT' | 'VTODO'>('VEVENT');
  const [calendarId, setCalendarId] = useState(() => defaultCalendar('VEVENT')?.id ?? '');
  const [busy, setBusy] = useState(false);
  const writable = writableCalendars().filter((calendar) => calendar.components.includes(component));
  const todayKey = today();

  const parsed = useMemo(
    () => (text.trim() ? parseQuick(text, todayKey, { weekStart: prefs?.weekStart, nowMinutes: minuteOf(Date.now()) }) : null),
    [text, prefs?.weekStart, todayKey]
  );
  const recognized = Boolean(parsed && parsed.spans.length > 0);
  const rangeDay = range ? (range.allDay ? new Date(range.start).toISOString().slice(0, 10) : keyOf(range.start)) : todayKey;

  const form = useMemo((): Form | null => {
    if (!prefs) return null;
    const calendar = writableCalendars().find((entry) => entry.id === calendarId) ?? defaultCalendar(component);
    let start = range?.start;
    let end = range?.end;
    let allDay = range?.allDay ?? false;
    if (parsed && (parsed.date || parsed.start !== null)) {
      const date = parsed.date ?? rangeDay;
      if (parsed.start !== null) {
        allDay = false;
        start = at(date, parsed.start);
        if (parsed.end !== null) end = at(parsed.end > parsed.start ? date : addDays(date, 1), parsed.end);
        else end = start + (parsed.duration ?? prefs.duration) * 60_000;
      } else if (parsed.allDay || !range || range.allDay) {
        allDay = true;
        start = Date.parse(`${date}T00:00:00Z`);
        end = start + 86_400_000;
      } else if (range) {
        const startMinute = minuteOf(range.start);
        start = at(date, startMinute);
        end = start + (range.end - range.start);
      }
    } else if (parsed?.duration && start !== undefined && !allDay) {
      end = start + parsed.duration * 60_000;
    }
    const base = newForm({ component, calendar, prefs, start, end, allDay, title: parsed?.title ?? text });
    base.calendarId = calendar?.id ?? '';
    if (parsed) {
      if (parsed.rrule) base.rrule = parsed.rrule;
      if (parsed.location) base.location = parsed.location;
      if (parsed.tags.length) base.categories = parsed.tags;
      if (component === 'VTODO') base.hasDue = Boolean(range) || Boolean(parsed.date) || parsed.start !== null;
    }
    return base;
  }, [prefs, calendarId, component, range, parsed, text, rangeDay]);

  const save = async () => {
    if (!form || busy) return;
    if (!form.calendarId) {
      toast(t('Lege zuerst einen Kalender an'));
      return;
    }
    setBusy(true);
    try {
      await calendarApi.create({ ...payloadOf(form), calendarId: form.calendarId, title: form.title.trim() || text.trim() });
      invalidate();
      toast(component === 'VTODO' ? t('Aufgabe gespeichert') : t('Termin gespeichert'));
      onClose();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  const when = form
    ? component === 'VTODO' && !form.hasDue
      ? t('Ohne Fälligkeitsdatum')
      : form.allDay
        ? formatSpan(Date.parse(`${form.startDate}T00:00:00Z`), Date.parse(`${addDays(form.endDate, 1)}T00:00:00Z`), true)
        : formatSpan(
            at(form.startDate, form.startTime),
            component === 'VTODO' ? at(form.startDate, form.startTime) : at(form.endDate, form.endTime),
            false
          )
    : '';

  const body = (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      sx={{ width: mobile ? '100%' : 420, maxWidth: '100%', p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.75 }}
    >
      <InputBase
        autoFocus
        fullWidth
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={component === 'VTODO' ? t('Was ist zu tun?') : t('Titel, z. B. „Kaffee mit Mia morgen 15 Uhr“')}
        inputProps={{ 'aria-label': t('Titel'), maxLength: 500 }}
        sx={{ fontSize: 20, fontWeight: 700, borderBottom: `2px solid ${c.primary}`, pb: 0.5 }}
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Chip
          label={t('Termin')}
          size="small"
          color={component === 'VEVENT' ? 'primary' : 'default'}
          variant={component === 'VEVENT' ? 'filled' : 'outlined'}
          onClick={() => {
            setComponent('VEVENT');
            if (
              !writableCalendars()
                .find((entry) => entry.id === calendarId)
                ?.components.includes('VEVENT')
            )
              setCalendarId(defaultCalendar('VEVENT')?.id ?? '');
          }}
        />
        <Chip
          label={t('Aufgabe')}
          size="small"
          color={component === 'VTODO' ? 'primary' : 'default'}
          variant={component === 'VTODO' ? 'filled' : 'outlined'}
          onClick={() => {
            setComponent('VTODO');
            if (
              !writableCalendars()
                .find((entry) => entry.id === calendarId)
                ?.components.includes('VTODO')
            )
              setCalendarId(defaultCalendar('VTODO')?.id ?? '');
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', color: c.onSurfaceVariant }}>
        <ScheduleRounded sx={{ fontSize: 20, mt: '1px' }} />
        <Box>
          <Typography variant="body2" sx={{ color: c.onSurface }}>
            {when}
          </Typography>
          {form?.rrule && <Typography variant="caption">{describe(form.rrule, form.startDate)}</Typography>}
        </Box>
      </Box>
      {recognized && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            py: 0.75,
            borderRadius: `${radius.sm}px`,
            bgcolor: mix(c.tertiary, 12),
            color: c.onSurface,
          }}
        >
          <AutoAwesomeRounded sx={{ fontSize: 16, color: c.tertiary }} />
          <Typography variant="caption">
            {[
              parsed!.spans.some((span) => span.kind === 'date' || span.kind === 'time') ? t('Datum und Uhrzeit erkannt') : null,
              parsed!.location ? t('Ort: {place}', { place: parsed!.location }) : null,
              parsed!.tags.length ? parsed!.tags.map((tag) => `#${tag}`).join(' ') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
      )}
      <TextField
        select
        size="small"
        label={t('Kalender')}
        value={form?.calendarId ?? ''}
        onChange={(event) => setCalendarId(event.target.value)}
      >
        {writable.map((calendar) => (
          <MenuItem key={calendar.id} value={calendar.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '4px', bgcolor: calendar.color }} />
              {calendar.name}
            </Box>
          </MenuItem>
        ))}
      </TextField>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={() => form && onMore({ ...form, title: form.title || text })}>{t('Weitere Optionen')}</Button>
        <Button type="submit" variant="contained" disabled={busy || (!text.trim() && component === 'VTODO')}>
          {t('Speichern')}
        </Button>
      </Box>
    </Box>
  );

  if (mobile || !anchor) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px` } } }}>
        {body}
      </Dialog>
    );
  }
  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px`, bgcolor: c.surfaceContainerHigh, ml: 1 } } }}
    >
      {body}
    </Popover>
  );
}
