import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import { describeRule, emptyRule, formatRule, parseRule, WEEKDAYS, type Freq, type Rule } from '../../../../shared/rrule';
import { language, locale, t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { addDays, dayNumber, formatDate, parseKey, weekdayName, weekdayOf } from './dates';

const nthOf = (date: string) => {
  const day = dayNumber(date);
  const nth = Math.ceil(day / 7);
  const { year, month } = parseKey(date);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day + 7 > last ? -1 : nth;
};

const ordinal = (nth: number) => {
  if (nth === -1) return t('letzten');
  if (language !== 'en') return t('{n}.', { n: nth });
  const rule = new Intl.PluralRules('en', { type: 'ordinal' }).select(nth);
  return `${nth}${rule === 'one' ? 'st' : rule === 'two' ? 'nd' : rule === 'few' ? 'rd' : 'th'}`;
};

export function describe(rrule: string | null, startDate: string) {
  if (!rrule) return t('Wiederholt sich nicht');
  const rule = parseRule(rrule);
  if (!rule) return t('Wiederholt sich');
  let text = describeRule(rule, startDate, (text, params) => t(text, params), locale);
  if (rule.count) text += `, ${t('{count}-mal', { count: rule.count })}`;
  else if (rule.until)
    text += `, ${t('bis {date}', { date: formatDate(rule.until.slice(0, 4) + '-' + rule.until.slice(4, 6) + '-' + rule.until.slice(6, 8)) })}`;
  return text;
}

export function presets(startDate: string) {
  const weekday = weekdayOf(startDate);
  const code = WEEKDAYS[weekday];
  const day = dayNumber(startDate);
  const nth = nthOf(startDate);
  const { month } = parseKey(startDate);
  return [
    { value: 'none', label: t('Wiederholt sich nicht') },
    { value: 'FREQ=DAILY', label: t('Täglich') },
    { value: `FREQ=WEEKLY;BYDAY=${code}`, label: t('Jede Woche am {day}', { day: weekdayName(weekday, 'long') }) },
    { value: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=' + code, label: t('Alle 2 Wochen am {day}', { day: weekdayName(weekday, 'long') }) },
    { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: t('Jeden Werktag (Montag bis Freitag)') },
    { value: `FREQ=MONTHLY;BYMONTHDAY=${day}`, label: t('Jeden Monat am {day}.', { day }) },
    {
      value: `FREQ=MONTHLY;BYDAY=${nth}${code}`,
      label: t('Jeden Monat am {nth} {day}', { nth: ordinal(nth), day: weekdayName(weekday, 'long') }),
    },
    {
      value: 'FREQ=YEARLY',
      label: t('Jedes Jahr am {date}', {
        date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, month - 1, day)),
      }),
    },
  ];
}

function sameRule(a: string, b: string) {
  const left = parseRule(a);
  const right = parseRule(b);
  return Boolean(left && right && formatRule(left) === formatRule(right));
}

export function RecurrenceField({
  value,
  startDate,
  allDay,
  onChange,
}: {
  value: string | null;
  startDate: string;
  allDay: boolean;
  onChange: (rrule: string | null) => void;
}) {
  const [custom, setCustom] = useState(false);
  const list = presets(startDate);
  const match = value ? list.find((entry) => entry.value !== 'none' && sameRule(entry.value, value)) : list[0];
  const options = match ? list : [...list, { value: value!, label: describe(value, startDate) }];
  return (
    <>
      <TextField
        select
        fullWidth
        size="small"
        label={t('Wiederholung')}
        value={match ? match.value : value}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '__custom') setCustom(true);
          else onChange(next === 'none' ? null : next);
        }}
        slotProps={{ input: { startAdornment: <EventRepeatRounded sx={{ color: c.onSurfaceVariant, mr: 1, fontSize: 20 }} /> } }}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
        <MenuItem value="__custom">{t('Benutzerdefiniert …')}</MenuItem>
      </TextField>
      {custom && (
        <CustomRecurrence
          value={value}
          startDate={startDate}
          allDay={allDay}
          onClose={() => setCustom(false)}
          onSave={(next) => onChange(next)}
        />
      )}
    </>
  );
}

function CustomRecurrence({
  value,
  startDate,
  allDay,
  onClose,
  onSave,
}: {
  value: string | null;
  startDate: string;
  allDay: boolean;
  onClose: () => void;
  onSave: (rrule: string) => void;
}) {
  const initial = (value && parseRule(value)) || { ...emptyRule('WEEKLY'), byDay: [{ day: weekdayOf(startDate), nth: 0 }] };
  const [rule, setRule] = useState<Rule>(initial);
  const [monthly, setMonthly] = useState<'day' | 'weekday'>(initial.byDay.some((entry) => entry.nth) ? 'weekday' : 'day');
  const [ending, setEnding] = useState<'never' | 'until' | 'count'>(initial.count ? 'count' : initial.until ? 'until' : 'never');
  const [until, setUntil] = useState(
    initial.until ? `${initial.until.slice(0, 4)}-${initial.until.slice(4, 6)}-${initial.until.slice(6, 8)}` : addDays(startDate, 90)
  );
  const [count, setCount] = useState(initial.count ?? 10);
  const set = (patch: Partial<Rule>) => setRule((current) => ({ ...current, ...patch }));
  const weekday = weekdayOf(startDate);

  const build = () => {
    const next: Rule = { ...rule, count: null, until: null };
    if (next.freq === 'MONTHLY') {
      next.byMonthDay = monthly === 'day' ? [dayNumber(startDate)] : [];
      next.byDay = monthly === 'weekday' ? [{ day: weekday, nth: nthOf(startDate) }] : [];
      next.bySetPos = [];
    } else if (next.freq === 'WEEKLY') {
      if (!next.byDay.length) next.byDay = [{ day: weekday, nth: 0 }];
      next.byMonthDay = [];
    } else {
      next.byDay = next.freq === 'DAILY' ? next.byDay.filter((entry) => !entry.nth) : [];
      next.byMonthDay = [];
    }
    if (ending === 'count') next.count = Math.max(1, Math.min(999, count));
    if (ending === 'until') next.until = allDay ? until.replace(/-/g, '') : `${until.replace(/-/g, '')}T235959Z`;
    return formatRule(next);
  };

  const units: [Freq, string][] = [
    ['DAILY', rule.interval === 1 ? t('Tag') : t('Tage')],
    ['WEEKLY', rule.interval === 1 ? t('Woche') : t('Wochen')],
    ['MONTHLY', rule.interval === 1 ? t('Monat') : t('Monate')],
    ['YEARLY', rule.interval === 1 ? t('Jahr') : t('Jahre')],
  ];
  const preview = describe(build(), startDate);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('Benutzerdefinierte Wiederholung')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography>{t('Alle')}</Typography>
          <TextField
            type="number"
            size="small"
            value={rule.interval}
            onChange={(event) => set({ interval: Math.max(1, Math.min(999, Number(event.target.value) || 1)) })}
            sx={{ width: 84 }}
            slotProps={{ htmlInput: { min: 1, max: 999, 'aria-label': t('Intervall') } }}
          />
          <TextField
            select
            size="small"
            value={rule.freq}
            onChange={(event) => set({ freq: event.target.value as Freq })}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { 'aria-label': t('Einheit') } }}
          >
            {units.map(([freq, label]) => (
              <MenuItem key={freq} value={freq}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {rule.freq === 'WEEKLY' && (
          <Box>
            <Typography variant="body2" sx={{ mb: 1, color: c.onSurfaceVariant }}>
              {t('Am')}
            </Typography>
            <ToggleButtonGroup
              value={rule.byDay.map((entry) => entry.day)}
              onChange={(_event, days: number[]) => set({ byDay: days.map((day) => ({ day, nth: 0 })) })}
              size="small"
              sx={{ flexWrap: 'wrap' }}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <ToggleButton
                  key={day}
                  value={day}
                  aria-label={weekdayName(day, 'long')}
                  sx={{ width: 42, borderRadius: '50% !important', mx: 0.25, border: 'none !important' }}
                >
                  {weekdayName(day).slice(0, 2)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        )}
        {rule.freq === 'MONTHLY' && (
          <RadioGroup value={monthly} onChange={(event) => setMonthly(event.target.value as 'day' | 'weekday')}>
            <FormControlLabel value="day" control={<Radio />} label={t('Am {day}. des Monats', { day: dayNumber(startDate) })} />
            <FormControlLabel
              value="weekday"
              control={<Radio />}
              label={t('Am {nth} {day}', { nth: ordinal(nthOf(startDate)), day: weekdayName(weekday, 'long') })}
            />
          </RadioGroup>
        )}
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5, color: c.onSurfaceVariant }}>
            {t('Endet')}
          </Typography>
          <RadioGroup value={ending} onChange={(event) => setEnding(event.target.value as typeof ending)}>
            <FormControlLabel value="never" control={<Radio />} label={t('Nie')} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControlLabel value="until" control={<Radio />} label={t('Am')} sx={{ minWidth: 96 }} />
              <TextField
                type="date"
                size="small"
                value={until}
                disabled={ending !== 'until'}
                onChange={(event) => setUntil(event.target.value)}
                slotProps={{ htmlInput: { min: startDate, 'aria-label': t('Enddatum') } }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControlLabel value="count" control={<Radio />} label={t('Nach')} sx={{ minWidth: 96 }} />
              <TextField
                type="number"
                size="small"
                value={count}
                disabled={ending !== 'count'}
                onChange={(event) => setCount(Number(event.target.value) || 1)}
                sx={{ width: 96 }}
                slotProps={{ htmlInput: { min: 1, max: 999, 'aria-label': t('Anzahl') } }}
              />
              <Typography>{t('Terminen')}</Typography>
            </Box>
          </RadioGroup>
        </Box>
        <Typography variant="body2" sx={{ p: 1.5, borderRadius: 2, bgcolor: c.surfaceContainerHigh, fontWeight: 600 }}>
          {preview}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button
          variant="contained"
          onClick={() => {
            onSave(build());
            onClose();
          }}
        >
          {t('Übernehmen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
