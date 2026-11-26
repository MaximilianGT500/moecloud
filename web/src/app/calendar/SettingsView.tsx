import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import { REGIONS } from '../../../../shared/holidays';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { language, t } from '../../lib/i18n';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { c } from '../../theme/tokens';
import { CopyField, Section } from '../common/bits';
import { toast } from '../common/toast';
import { ImportPanel } from './CalendarDialogs';
import { alarmText, deviceZone, formatClock, weekdayName } from './dates';
import type { AlarmSpec, CalendarPrefs, View } from './model';
import { invalidate, loadCalendars, savePrefs, useCalendarState, writableCalendars } from './store';

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {help && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {help}
          </Typography>
        )}
      </Box>
      <Switch checked={checked} onChange={(event) => onChange(event.target.checked)} slotProps={{ input: { 'aria-label': label } }} />
    </Box>
  );
}

function Setting({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        {help && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {help}
          </Typography>
        )}
      </Box>
      <Box sx={{ flex: 'none', minWidth: { sm: 240 } }}>{children}</Box>
    </Box>
  );
}

const CLOCK = Array.from({ length: 48 }, (_, index) => index * 30);

function ClockSelect({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const options = CLOCK.includes(value) ? CLOCK : [...CLOCK, value].sort((a, b) => a - b);
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      slotProps={{ htmlInput: { 'aria-label': label } }}
      sx={{ minWidth: 110 }}
    >
      {options.map((minutes) => (
        <MenuItem key={minutes} value={minutes}>
          {formatClock(minutes)}
        </MenuItem>
      ))}
    </TextField>
  );
}

function AlarmList({ value, allDay, onChange }: { value: AlarmSpec[]; allDay: boolean; onChange: (value: AlarmSpec[]) => void }) {
  const options = allDay ? [-540, 900, 2340, 9540] : [0, 5, 10, 15, 30, 60, 120, 1440];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
      {value.map((alarm, index) => (
        <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            value={alarm.minutes}
            onChange={(event) =>
              onChange(value.map((entry, position) => (position === index ? { ...entry, minutes: Number(event.target.value) } : entry)))
            }
            sx={{ minWidth: 220 }}
          >
            {[...new Set([...options, alarm.minutes])]
              .sort((a, b) => a - b)
              .map((minutes) => (
                <MenuItem key={minutes} value={minutes}>
                  {alarmText(minutes, allDay)}
                </MenuItem>
              ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={Boolean(alarm.email)}
                onChange={(event) =>
                  onChange(value.map((entry, position) => (position === index ? { ...entry, email: event.target.checked } : entry)))
                }
              />
            }
            label={t('per E-Mail')}
          />
          <IconButton
            size="small"
            aria-label={t('Erinnerung entfernen')}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </Box>
      ))}
      {value.length < 5 && (
        <Button
          size="small"
          startIcon={<AddRounded />}
          onClick={() =>
            onChange([...value, { minutes: options.find((minutes) => !value.some((entry) => entry.minutes === minutes)) ?? options[0] }])
          }
        >
          {t('Erinnerung hinzufügen')}
        </Button>
      )}
    </Box>
  );
}

export function SettingsView() {
  const { prefs, zone } = useCalendarState();
  const local = usePrefs();
  const zones = useMemo(() => supportedZones(), []);
  const [sending, setSending] = useState(false);
  if (!prefs) return null;
  const save = (patch: Partial<CalendarPrefs>) => void savePrefs(patch);
  const features = boot().calendarFeatures;
  const caldav = boot().caldav;
  const user = boot().user!;

  const changeZone = async (next: string) => {
    try {
      await api.patch('/api/account/prefs', { zone: next });
      await loadCalendars();
      invalidate();
      toast(t('Zeitzone geändert'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const testAgenda = async () => {
    setSending(true);
    try {
      await api.post('/api/calendar/agenda-test', { weekly: prefs.agenda === 'weekly' });
      toast(t('Testmail verschickt'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setSending(false);
    }
  };

  const views: [View, string][] = [
    ['day', t('Tag')],
    ['days3', t('3 Tage')],
    ['workweek', t('Arbeitswoche')],
    ['week', t('Woche')],
    ['month', t('Monat')],
    ['year', t('Jahr')],
    ['agenda', t('Terminliste')],
  ];
  const countries = [...new Set(REGIONS.map((region) => region.country))];
  const countryName: Record<string, string> = {
    de: t('Deutschland'),
    at: t('Österreich'),
    ch: t('Schweiz'),
    gb: t('Vereinigtes Königreich'),
    us: t('USA'),
  };
  const toggleRegion = (id: string) =>
    save({ holidays: prefs.holidays.includes(id) ? prefs.holidays.filter((entry) => entry !== id) : [...prefs.holidays, id].slice(0, 10) });

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 860, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Section title={t('Ansicht')}>
          <Setting label={t('Startansicht')}>
            <TextField select size="small" fullWidth value={prefs.view} onChange={(event) => save({ view: event.target.value as View })}>
              {views.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Setting>
          <Setting label={t('Woche beginnt am')}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={prefs.weekStart}
              onChange={(_event, value) => value !== null && save({ weekStart: value })}
            >
              {[1, 0, 6].map((day) => (
                <ToggleButton key={day} value={day}>
                  {weekdayName(day, 'long')}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Setting>
          <Setting label={t('Zeitraster')} help={t('In welchen Schritten du Termine im Kalender aufziehst')}>
            <ToggleButtonGroup exclusive size="small" value={prefs.slot} onChange={(_event, value) => value && save({ slot: value })}>
              {[15, 30, 60].map((minutes) => (
                <ToggleButton key={minutes} value={minutes}>
                  {t('{count} Min.', { count: minutes })}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Setting>
          <Setting label={t('Zeilenhöhe')}>
            <Slider
              value={local.hourHeight}
              min={36}
              max={96}
              step={4}
              onChange={(_event, value) => setPrefs({ hourHeight: value as number })}
              aria-label={t('Zeilenhöhe')}
              valueLabelDisplay="auto"
            />
          </Setting>
          <Setting label={t('Dichte')}>
            <ToggleButtonGroup exclusive size="small" value={prefs.density} onChange={(_event, value) => value && save({ density: value })}>
              <ToggleButton value="comfortable">{t('Luftig')}</ToggleButton>
              <ToggleButton value="compact">{t('Kompakt')}</ToggleButton>
            </ToggleButtonGroup>
          </Setting>
          <Setting label={t('Farben nach')}>
            <ToggleButtonGroup exclusive size="small" value={prefs.colorBy} onChange={(_event, value) => value && save({ colorBy: value })}>
              <ToggleButton value="calendar">{t('Kalender')}</ToggleButton>
              <ToggleButton value="category">{t('Schlagwort')}</ToggleButton>
            </ToggleButtonGroup>
          </Setting>
          <Toggle label={t('Wochenenden anzeigen')} checked={prefs.weekends} onChange={(weekends) => save({ weekends })} />
          <Toggle label={t('Kalenderwochen anzeigen')} checked={prefs.weekNumbers} onChange={(weekNumbers) => save({ weekNumbers })} />
          <Toggle label={t('Vergangene Termine abblenden')} checked={prefs.dimPast} onChange={(dimPast) => save({ dimPast })} />
          <Toggle label={t('Abgesagte Termine anzeigen')} checked={prefs.declined} onChange={(declined) => save({ declined })} />
          <Toggle
            label={t('Passende Emojis vor Titel setzen')}
            help={t('Etwa 🏋️ vor „Training“ oder 🦷 vor „Zahnarzt“')}
            checked={prefs.emoji}
            onChange={(emoji) => save({ emoji })}
          />
          <Toggle label={t('Mondphasen anzeigen')} checked={prefs.moon} onChange={(moon) => save({ moon })} />
          <Toggle
            label={t('Titel verbergen')}
            help={t('Praktisch, wenn du deinen Bildschirm teilst: Termine erscheinen nur als „Beschäftigt“.')}
            checked={prefs.hideTitle}
            onChange={(hideTitle) => save({ hideTitle })}
          />
        </Section>

        <Section
          title={t('Arbeitszeit')}
          description={t('Außerhalb der Arbeitszeit wird der Kalender schattiert. Andere sehen sie bei der Terminsuche.')}
        >
          <Setting label={t('Von – bis')}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <ClockSelect label={t('Beginn')} value={prefs.workStart} onChange={(workStart) => save({ workStart })} />
              <span>–</span>
              <ClockSelect label={t('Ende')} value={prefs.workEnd} onChange={(workEnd) => save({ workEnd })} />
            </Box>
          </Setting>
          <Setting label={t('Arbeitstage')}>
            <ToggleButtonGroup size="small" value={prefs.workDays} onChange={(_event, value: number[]) => save({ workDays: value })}>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <ToggleButton key={day} value={day} sx={{ px: 1.25 }}>
                  {weekdayName(day).slice(0, 2)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Setting>
          <Setting label={t('Beim Öffnen scrollen zu')}>
            <ClockSelect label={t('Uhrzeit')} value={prefs.scrollTo} onChange={(scrollTo) => save({ scrollTo })} />
          </Setting>
        </Section>

        <Section title={t('Zeitzonen')}>
          <Setting
            label={t('Deine Zeitzone')}
            help={zone !== deviceZone() ? t('Dein Gerät ist auf {zone} eingestellt.', { zone: zoneLabel(deviceZone()) }) : undefined}
          >
            <TextField select size="small" fullWidth value={zone} onChange={(event) => void changeZone(event.target.value)}>
              {zones.map((entry) => (
                <MenuItem key={entry} value={entry}>
                  {zoneLabel(entry)}
                </MenuItem>
              ))}
            </TextField>
          </Setting>
          <Setting label={t('Zweite Zeitzone')} help={t('Erscheint als zusätzliche Zeitleiste in der Tages- und Wochenansicht')}>
            <TextField
              select
              size="small"
              fullWidth
              value={prefs.zone2 ?? ''}
              onChange={(event) => save({ zone2: event.target.value || null })}
            >
              <MenuItem value="">{t('Keine')}</MenuItem>
              {zones.map((entry) => (
                <MenuItem key={entry} value={entry}>
                  {zoneLabel(entry)}
                </MenuItem>
              ))}
            </TextField>
          </Setting>
        </Section>

        <Section title={t('Neue Termine')}>
          <Setting label={t('Standarddauer')}>
            <TextField
              select
              size="small"
              fullWidth
              value={prefs.duration}
              onChange={(event) => save({ duration: Number(event.target.value) })}
            >
              {[15, 20, 25, 30, 45, 50, 60, 90, 120].map((minutes) => (
                <MenuItem key={minutes} value={minutes}>
                  {t('{count} Minuten', { count: minutes })}
                </MenuItem>
              ))}
            </TextField>
          </Setting>
          <Setting label={t('Standardkalender')}>
            <TextField
              select
              size="small"
              fullWidth
              value={prefs.defaultCalendar ?? ''}
              onChange={(event) => save({ defaultCalendar: event.target.value || null })}
            >
              <MenuItem value="">{t('Erster sichtbarer Kalender')}</MenuItem>
              {writableCalendars().map((calendar) => (
                <MenuItem key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </MenuItem>
              ))}
            </TextField>
          </Setting>
          <Box>
            <Typography sx={{ fontWeight: 500, mb: 1 }}>{t('Erinnerungen für Termine')}</Typography>
            <AlarmList value={prefs.alarms} allDay={false} onChange={(alarms) => save({ alarms })} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 500, mb: 1 }}>{t('Erinnerungen für ganztägige Termine')}</Typography>
            <AlarmList value={prefs.alldayAlarms} allDay onChange={(alldayAlarms) => save({ alldayAlarms })} />
          </Box>
        </Section>

        <Section
          title={t('Feiertage')}
          description={t('Feiertage erscheinen als eigener Kalender. Du kannst mehrere Regionen kombinieren.')}
        >
          {countries.map((country) => (
            <Box key={country}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {countryName[country] ?? country.toUpperCase()}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {REGIONS.filter((region) => region.country === country).map((region) => (
                  <FormControlLabel
                    key={region.id}
                    control={<Checkbox checked={prefs.holidays.includes(region.id)} onChange={() => toggleRegion(region.id)} />}
                    label={region.name[language]}
                  />
                ))}
              </Box>
            </Box>
          ))}
          <Toggle
            label={t('Aktions- und Gedenktage')}
            help={t('Etwa Muttertag, Advent oder die Zeitumstellung')}
            checked={prefs.observances}
            onChange={(observances) => save({ observances })}
          />
        </Section>

        <Section title={t('Aufgaben')}>
          <Toggle
            label={t('Aufgaben im Kalender zeigen')}
            help={t('Fällige Aufgaben erscheinen zwischen deinen Terminen')}
            checked={prefs.tasksInCalendar}
            onChange={(tasksInCalendar) => save({ tasksInCalendar })}
          />
          <Toggle
            label={t('Erledigte Aufgaben im Kalender zeigen')}
            checked={prefs.completedTasks}
            onChange={(completedTasks) => save({ completedTasks })}
          />
        </Section>

        <Section
          title={t('Tagesübersicht per E-Mail')}
          description={t('Bekomm morgens eine Mail mit allen Terminen und fälligen Aufgaben.')}
        >
          <Setting label={t('Zustellung')}>
            <ToggleButtonGroup exclusive size="small" value={prefs.agenda} onChange={(_event, value) => value && save({ agenda: value })}>
              <ToggleButton value="off">{t('Aus')}</ToggleButton>
              <ToggleButton value="daily">{t('Täglich')}</ToggleButton>
              <ToggleButton value="weekly">{t('Montags')}</ToggleButton>
            </ToggleButtonGroup>
          </Setting>
          {prefs.agenda !== 'off' && (
            <Setting label={t('Uhrzeit')}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <ClockSelect label={t('Uhrzeit')} value={prefs.agendaTime} onChange={(agendaTime) => save({ agendaTime })} />
                <Button startIcon={<SendRounded />} onClick={() => void testAgenda()} disabled={sending || !user.email}>
                  {t('Jetzt testen')}
                </Button>
              </Box>
            </Setting>
          )}
          {!user.email && (
            <Typography variant="body2" sx={{ color: c.error }}>
              {t('Hinterlege zuerst eine E-Mail-Adresse in deinem Konto.')}
            </Typography>
          )}
        </Section>

        <Section title={t('Privatsphäre')}>
          <Toggle
            label={t('Frei/beschäftigt für alle sichtbar')}
            help={
              features?.freebusy === false
                ? t('Auf diesem Server ausgeschaltet.')
                : t('Andere auf diesem Server sehen bei der Terminsuche, wann du beschäftigt bist, aber keine Details.')
            }
            checked={prefs.freebusy && features?.freebusy !== false}
            onChange={(freebusy) => save({ freebusy })}
          />
        </Section>

        {caldav && features?.caldav !== false && (
          <Section
            title={t('Mit Apps synchronisieren')}
            description={t(
              'MoeCloud spricht CalDAV. So landen deine Kalender und Aufgaben auf iPhone, Mac, Android (DAVx⁵), in Thunderbird, Outlook (CalDav Synchronizer) und vielen mehr.'
            )}
          >
            <CopyField label={t('Server-Adresse')} value={caldav} />
            <CopyField label={t('Benutzername')} value={user.username} mono={false} />
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Als Passwort nimmst du ein App-Passwort. Dein normales Passwort funktioniert dort aus Sicherheitsgründen nicht.')}
            </Typography>
            <Button variant="tonal" startIcon={<KeyRounded />} href="/account#app-passwoerter" sx={{ alignSelf: 'flex-start' }}>
              {t('App-Passwort erstellen')}
            </Button>
          </Section>
        )}

        <Section title={t('Importieren und exportieren')}>
          <ImportPanel />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<DownloadRounded />} href="/api/calendar/export.zip" download>
              {t('Alle Kalender als ZIP')}
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadRounded />}
              href={`/api/calendar/export.csv?from=${Date.UTC(new Date().getUTCFullYear(), 0, 1)}&to=${Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)}`}
              download
            >
              {t('Dieses Jahr als CSV')}
            </Button>
          </Box>
        </Section>
      </Box>
    </Box>
  );
}
