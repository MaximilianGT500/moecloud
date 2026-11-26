import { useEffect, useState, type ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRounded from '@mui/icons-material/CloseRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import AutorenewRounded from '@mui/icons-material/AutorenewRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { api, csrfToken, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { CopyField, QrCode, UserAvatar } from '../common/bits';
import { toast } from '../common/toast';
import { alarmText } from './dates';
import { colorName, PALETTE, type AlarmSpec, type CalendarInfo } from './model';
import { PeopleInput } from './PeopleInput';
import { invalidate, loadCalendars, patchCalendar, useCalendarState, writableCalendars } from './store';

export type CalendarTab = 'general' | 'share' | 'publish' | 'transfer';

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <Box role="radiogroup" aria-label={t('Farbe')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {PALETTE.map((hex) => (
        <Tooltip key={hex} title={colorName(hex)}>
          <ButtonBase
            role="radio"
            aria-checked={value === hex}
            aria-label={colorName(hex)}
            onClick={() => onChange(hex)}
            sx={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              bgcolor: hex,
              outline: value === hex ? `3px solid ${c.onSurface}` : 'none',
              outlineOffset: 2,
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

const TIMED = [0, 5, 10, 15, 30, 60, 120, 1440];
const ALLDAY = [-540, 900, 2340, 9540];

function AlarmDefaults({
  label,
  value,
  allDay,
  onChange,
}: {
  label: string;
  value: AlarmSpec[] | null;
  allDay: boolean;
  onChange: (value: AlarmSpec[] | null) => void;
}) {
  const list = value ?? [];
  const options = allDay ? ALLDAY : TIMED;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          {label}
        </Typography>
        <FormControlLabel
          control={<Switch size="small" checked={value === null} onChange={(event) => onChange(event.target.checked ? null : [])} />}
          label={t('Wie in den Einstellungen')}
        />
      </Box>
      {value !== null && (
        <>
          {list.map((alarm, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                select
                size="small"
                value={alarm.minutes}
                onChange={(event) =>
                  onChange(list.map((entry, position) => (position === index ? { ...entry, minutes: Number(event.target.value) } : entry)))
                }
                sx={{ flex: 1 }}
              >
                {[...new Set([...options, alarm.minutes])]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <MenuItem key={minutes} value={minutes}>
                      {alarmText(minutes, allDay)}
                    </MenuItem>
                  ))}
              </TextField>
              <IconButton
                size="small"
                aria-label={t('Erinnerung entfernen')}
                onClick={() => onChange(list.filter((_, position) => position !== index))}
              >
                <CloseRounded fontSize="small" />
              </IconButton>
            </Box>
          ))}
          {list.length < 5 && (
            <Button
              size="small"
              startIcon={<AddRounded />}
              onClick={() =>
                onChange([...list, { minutes: options.find((minutes) => !list.some((entry) => entry.minutes === minutes)) ?? options[0] }])
              }
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('Erinnerung hinzufügen')}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}

export function NewCalendarDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[Math.floor(Math.random() * 12)]);
  const [description, setDescription] = useState('');
  const [components, setComponents] = useState<'VEVENT,VTODO' | 'VEVENT' | 'VTODO'>('VEVENT,VTODO');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/calendar/calendars', { name, color, description, components });
      await loadCalendars();
      toast(t('Kalender angelegt'));
      onClose();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{t('Neuer Kalender')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <TextField
            autoFocus
            required
            label={t('Name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('z. B. Arbeit, Familie, Sport')}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <TextField
            label={t('Beschreibung (optional)')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={2}
          />
          <TextField
            select
            label={t('Enthält')}
            value={components}
            onChange={(event) => setComponents(event.target.value as typeof components)}
          >
            <MenuItem value="VEVENT,VTODO">{t('Termine und Aufgaben')}</MenuItem>
            <MenuItem value="VEVENT">{t('Nur Termine')}</MenuItem>
            <MenuItem value="VTODO">{t('Nur Aufgaben')}</MenuItem>
          </TextField>
          <ColorPicker value={color} onChange={setColor} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
            {t('Anlegen')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[6]);
  const [refresh, setRefresh] = useState(Math.max(60, boot().calendarFeatures?.minRefresh ?? 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minimum = boot().calendarFeatures?.minRefresh ?? 15;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ calendar: CalendarInfo; result: { created?: number; error?: string } | null }>(
        '/api/calendar/subscriptions',
        {
          url,
          name: name.trim() || undefined,
          color,
          refreshMinutes: refresh,
        }
      );
      await loadCalendars();
      invalidate();
      if (result.result && 'error' in result.result && result.result.error)
        toast(t('Abo angelegt, aber das Laden klappte noch nicht: {error}', { error: result.result.error }));
      else toast(tn(result.result?.created ?? 0, 'Abo angelegt, 1 Termin geladen', 'Abo angelegt, {count} Termine geladen'));
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{t('Kalender abonnieren')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t(
              'Füge die iCal-Adresse eines Kalenders ein, etwa Schulferien, Spielpläne, Müllabfuhr oder einen geteilten Google- oder Outlook-Kalender. MoeCloud hält das Abo automatisch aktuell.'
            )}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            required
            label={t('Adresse (https:// oder webcal://)')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="webcal://…"
          />
          <TextField
            label={t('Name (optional)')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            helperText={t('Leer lassen, um den Namen aus dem Kalender zu übernehmen')}
          />
          <TextField select label={t('Aktualisieren')} value={refresh} onChange={(event) => setRefresh(Number(event.target.value))}>
            {[15, 30, 60, 180, 360, 720, 1440, 10080]
              .filter((minutes) => minutes >= minimum)
              .map((minutes) => (
                <MenuItem key={minutes} value={minutes}>
                  {minutes < 60
                    ? t('Alle {count} Minuten', { count: minutes })
                    : minutes < 1440
                      ? tn(minutes / 60, 'Jede Stunde', 'Alle {count} Stunden')
                      : minutes === 1440
                        ? t('Einmal am Tag')
                        : t('Einmal pro Woche')}
                </MenuItem>
              ))}
          </TextField>
          <ColorPicker value={color} onChange={setColor} />
          {busy && <LinearProgress />}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button type="submit" variant="contained" disabled={busy || !url.trim()}>
            {t('Abonnieren')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

async function upload(calendarId: string, file: File, mode: string) {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`/api/calendar/calendars/${calendarId}/import?mode=${mode}`, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
  });
  const data = (await response.json().catch(() => ({}))) as {
    created?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(data.error?.message ?? t('Der Import hat nicht geklappt'));
  return data as { created: number; updated: number; skipped: number; failed: number };
}

export function ImportPanel({ calendarId, onDone }: { calendarId?: string; onDone?: () => void }) {
  const writable = writableCalendars();
  const [target, setTarget] = useState(calendarId ?? writable[0]?.id ?? '');
  const [mode, setMode] = useState('merge');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !target) return;
    setBusy(true);
    setResult(null);
    try {
      const done = await upload(target, file, mode);
      invalidate();
      await loadCalendars();
      setResult(
        t('{created} neu, {updated} aktualisiert, {skipped} übersprungen', {
          created: done.created,
          updated: done.updated,
          skipped: done.skipped,
        }) + (done.failed ? `, ${t('{count} fehlerhaft', { count: done.failed })}` : '')
      );
      onDone?.();
    } catch (error) {
      setResult(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!calendarId && (
        <TextField select label={t('In Kalender')} value={target} onChange={(event) => setTarget(event.target.value)}>
          {writable.map((calendar) => (
            <MenuItem key={calendar.id} value={calendar.id}>
              {calendar.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField select label={t('Wenn ein Termin schon existiert')} value={mode} onChange={(event) => setMode(event.target.value)}>
        <MenuItem value="merge">{t('Aktualisieren')}</MenuItem>
        <MenuItem value="skip">{t('Überspringen')}</MenuItem>
        <MenuItem value="copy">{t('Als Kopie anlegen')}</MenuItem>
      </TextField>
      <Button
        component="label"
        variant="tonal"
        startIcon={<UploadFileRounded />}
        disabled={busy || !target}
        sx={{ alignSelf: 'flex-start' }}
      >
        {t('ICS-Datei auswählen')}
        <input hidden type="file" accept=".ics,.ical,.ifb,.vcs,text/calendar" onChange={(event) => void pick(event)} />
      </Button>
      {busy && <LinearProgress />}
      {result && <Alert severity="info">{result}</Alert>}
    </Box>
  );
}

interface Share {
  userId: number;
  name: string;
  username: string;
  email: string | null;
  initials: string;
  permission: 'freebusy' | 'read' | 'write';
}

function SharePanel({ calendar }: { calendar: CalendarInfo }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [permission, setPermission] = useState<Share['permission']>('read');
  useEffect(() => {
    api
      .get<{ shares: Share[] }>(`/api/calendar/calendars/${calendar.id}/shares`)
      .then((result) => setShares(result.shares))
      .catch((error) => toast(errorText(error)));
  }, [calendar.id]);
  const set = async (userId: number, next: Share['permission']) => {
    try {
      const result = await api.put<{ shares: Share[] }>(`/api/calendar/calendars/${calendar.id}/shares/${userId}`, { permission: next });
      setShares(result.shares);
      void loadCalendars();
    } catch (error) {
      toast(errorText(error));
    }
  };
  const remove = async (userId: number) => {
    try {
      const result = await api.delete<{ shares: Share[] }>(`/api/calendar/calendars/${calendar.id}/shares/${userId}`);
      setShares(result.shares);
      void loadCalendars();
    } catch (error) {
      toast(errorText(error));
    }
  };
  const labels: Record<Share['permission'], string> = {
    freebusy: t('Nur frei/beschäftigt'),
    read: t('Alle Details sehen'),
    write: t('Bearbeiten'),
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {t('Teile den Kalender mit Personen auf diesem Server. Sie sehen ihn dann in ihrer Kalenderliste und in ihren Apps per CalDAV.')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <PeopleInput
            allowEmail={false}
            label={t('Person hinzufügen')}
            exclude={[]}
            onPick={(person) => person.userId && void set(person.userId, permission)}
          />
        </Box>
        <TextField
          select
          size="small"
          value={permission}
          onChange={(event) => setPermission(event.target.value as Share['permission'])}
          sx={{ minWidth: 200 }}
          slotProps={{ htmlInput: { 'aria-label': t('Berechtigung') } }}
        >
          {(Object.keys(labels) as Share['permission'][]).map((key) => (
            <MenuItem key={key} value={key}>
              {labels[key]}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {shares === null && <LinearProgress />}
      {shares?.length === 0 && (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Noch mit niemandem geteilt.')}
        </Typography>
      )}
      {shares?.map((share) => (
        <Box key={share.userId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <UserAvatar initials={share.initials} size={36} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {share.name}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap component="p">
              @{share.username}
            </Typography>
          </Box>
          <TextField
            select
            size="small"
            value={share.permission}
            onChange={(event) => void set(share.userId, event.target.value as Share['permission'])}
            sx={{ minWidth: 190 }}
            slotProps={{ htmlInput: { 'aria-label': t('Berechtigung für {name}', { name: share.name }) } }}
          >
            {(Object.keys(labels) as Share['permission'][]).map((key) => (
              <MenuItem key={key} value={key}>
                {labels[key]}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={t('Freigabe entfernen')}>
            <IconButton aria-label={t('Freigabe für {name} entfernen', { name: share.name })} onClick={() => void remove(share.userId)}>
              <CloseRounded />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}

function PublishPanel({ calendar }: { calendar: CalendarInfo }) {
  const [mode, setMode] = useState<'details' | 'busy' | null>(calendar.publicMode);
  const [token, setToken] = useState(calendar.publicToken);
  const [busy, setBusy] = useState(false);
  const update = async (next: 'details' | 'busy' | null, renew = false) => {
    setBusy(true);
    try {
      const result = await api.put<{ token: string | null; mode: 'details' | 'busy' | null }>(
        `/api/calendar/calendars/${calendar.id}/public`,
        {
          mode: next,
          renew,
        }
      );
      setMode(result.mode);
      setToken(result.token);
      void loadCalendars();
      if (renew) toast(t('Neuer Link erstellt, der alte funktioniert nicht mehr'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  if (boot().calendarFeatures?.publicLinks === false) {
    return <Alert severity="info">{t('Öffentliche Links sind auf diesem Server ausgeschaltet.')}</Alert>;
  }
  const page = token ? `${location.origin}/p/${token}` : '';
  const feed = token ? `${location.origin}/p/${token}.ics` : '';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {t('Mit einem öffentlichen Link können alle, die ihn kennen, den Kalender ansehen oder abonnieren, ganz ohne Konto.')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        value={mode ?? 'off'}
        disabled={busy}
        onChange={(_event, value) => value && void update(value === 'off' ? null : value)}
        sx={{ flexWrap: 'wrap' }}
      >
        <ToggleButton value="off">{t('Privat')}</ToggleButton>
        <ToggleButton value="busy">{t('Nur frei/beschäftigt')}</ToggleButton>
        <ToggleButton value="details">{t('Mit allen Details')}</ToggleButton>
      </ToggleButtonGroup>
      {token && mode && (
        <>
          <CopyField label={t('Link zur Kalenderseite')} value={page} />
          <CopyField label={t('Abo-Adresse (ICS)')} value={feed} />
          <CopyField
            label={t('Zum Einbetten in Webseiten')}
            value={`<iframe src="${page}?embed=1" style="border:0;width:100%;height:640px" loading="lazy"></iframe>`}
          />
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <QrCode value={page} size={140} label={t('QR-Code für den Kalender')} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button variant="outlined" href={feed.replace(/^https?:/, 'webcal:')} sx={{ alignSelf: 'flex-start' }}>
                {t('In Kalender-App öffnen')}
              </Button>
              <Button
                startIcon={<AutorenewRounded />}
                onClick={() => void update(mode, true)}
                disabled={busy}
                sx={{ alignSelf: 'flex-start' }}
              >
                {t('Neuen Link erzeugen')}
              </Button>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}

export function CalendarDialog({ id, tab: initialTab = 'general', onClose }: { id: string; tab?: CalendarTab; onClose: () => void }) {
  const { calendars } = useCalendarState();
  const calendar = calendars.find((entry) => entry.id === id);
  const compact = useMediaQuery('(max-width:600px)');
  const [tab, setTab] = useState<CalendarTab>(initialTab);
  const [draft, setDraft] = useState(() => ({
    name: calendar?.name ?? '',
    description: calendar?.description ?? '',
    color: calendar?.color ?? PALETTE[0],
    zone: calendar?.zone ?? '',
    alarms: calendar?.alarms ?? null,
    alldayAlarms: calendar?.alldayAlarms ?? null,
    refreshMinutes: calendar?.refreshMinutes ?? 60,
    notify: calendar?.notify ?? true,
  }));
  const [zones] = useState(() => supportedZones());
  if (!calendar) return null;
  const owner = calendar.access === 'owner';
  const subscription = calendar.kind === 'subscription';
  const user = boot().user;
  const caldav = boot().caldav;
  const davUrl =
    caldav && user ? `${caldav}/calendars/${encodeURIComponent(user.username)}/${owner ? calendar.slug : `s-${calendar.id}`}/` : null;

  const save = async () => {
    const patch: Record<string, unknown> = owner
      ? {
          name: draft.name.trim() || calendar.name,
          description: draft.description,
          color: draft.color,
          zone: draft.zone || null,
          alarms: draft.alarms,
          alldayAlarms: draft.alldayAlarms,
          ...(subscription ? { refreshMinutes: draft.refreshMinutes } : {}),
        }
      : { color: draft.color, notify: draft.notify };
    await patchCalendar(calendar.id, patch);
    toast(t('Gespeichert'));
    onClose();
  };

  const tabs: [CalendarTab, string][] = [
    ['general', t('Allgemein')],
    ...(owner && !subscription
      ? ([
          ['share', t('Teilen')],
          ['publish', t('Veröffentlichen')],
        ] as [CalendarTab, string][])
      : []),
    ...(calendar.access !== 'freebusy' ? ([['transfer', t('Import/Export')]] as [CalendarTab, string][]) : []),
  ];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={compact}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 0 }}>
        <Box sx={{ width: 16, height: 16, borderRadius: '5px', bgcolor: draft.color, flex: 'none' }} />
        <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {calendar.name}
        </Box>
        <IconButton aria-label={t('Schließen')} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_event, value: CalendarTab) => setTab(value)}
        variant="scrollable"
        sx={{ px: 2, borderBottom: `1px solid ${c.outlineVariant}` }}
      >
        {tabs.map(([value, label]) => (
          <Tab key={value} value={value} label={label} />
        ))}
      </Tabs>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '20px !important', minHeight: 360 }}>
        {tab === 'general' && (
          <>
            {owner ? (
              <>
                <TextField
                  label={t('Name')}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
                <TextField
                  label={t('Beschreibung')}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  multiline
                  minRows={2}
                />
              </>
            ) : (
              <Alert severity="info">
                {t('Geteilt von {name}. Farbe und Erinnerungen stellst du nur für dich ein.', { name: calendar.owner.name })}
              </Alert>
            )}
            <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            {owner && !subscription && (
              <TextField
                select
                label={t('Zeitzone für neue Termine')}
                value={draft.zone}
                onChange={(event) => setDraft({ ...draft, zone: event.target.value })}
              >
                <MenuItem value="">{t('Deine Zeitzone')}</MenuItem>
                {zones.map((zone) => (
                  <MenuItem key={zone} value={zone}>
                    {zoneLabel(zone)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {subscription && (
              <>
                <CopyField label={t('Quelle')} value={calendar.sourceUrl ?? ''} mono />
                <TextField
                  select
                  label={t('Aktualisieren')}
                  value={draft.refreshMinutes}
                  onChange={(event) => setDraft({ ...draft, refreshMinutes: Number(event.target.value) })}
                  disabled={!owner}
                >
                  {[15, 30, 60, 180, 360, 720, 1440, 10080].map((minutes) => (
                    <MenuItem key={minutes} value={minutes}>
                      {minutes < 60
                        ? t('Alle {count} Minuten', { count: minutes })
                        : minutes < 1440
                          ? tn(minutes / 60, 'Jede Stunde', 'Alle {count} Stunden')
                          : minutes === 1440
                            ? t('Einmal am Tag')
                            : t('Einmal pro Woche')}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" sx={{ color: calendar.syncError ? c.error : c.onSurfaceVariant }}>
                  {calendar.syncError
                    ? t('Letzter Fehler: {error}', { error: calendar.syncError })
                    : calendar.syncedAt
                      ? t('Zuletzt aktualisiert: {time}', { time: formatDateTime(calendar.syncedAt) })
                      : t('Noch nicht geladen')}
                </Typography>
                {owner && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                    <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                      {t(
                        'Als eigener Kalender lassen sich die Termine bearbeiten und teilen. MoeCloud lädt sie dann aber nicht mehr nach.'
                      )}
                    </Typography>
                    <Button
                      variant="tonal"
                      data-detach
                      onClick={async () => {
                        try {
                          await api.post(`/api/calendar/calendars/${calendar.id}/detach`, {});
                          await loadCalendars();
                          invalidate();
                          toast(t('„{name}“ ist jetzt ein eigener Kalender', { name: calendar.name }));
                          onClose();
                        } catch (failure) {
                          toast(errorText(failure));
                        }
                      }}
                    >
                      {t('In eigenen Kalender umwandeln')}
                    </Button>
                  </Box>
                )}
              </>
            )}
            {owner && !subscription && (
              <>
                <AlarmDefaults
                  label={t('Standard-Erinnerungen für Termine')}
                  value={draft.alarms}
                  allDay={false}
                  onChange={(alarms) => setDraft({ ...draft, alarms })}
                />
                <AlarmDefaults
                  label={t('Standard-Erinnerungen für ganztägige Termine')}
                  value={draft.alldayAlarms}
                  allDay
                  onChange={(alldayAlarms) => setDraft({ ...draft, alldayAlarms })}
                />
              </>
            )}
            {!owner && (
              <FormControlLabel
                control={<Switch checked={draft.notify} onChange={(event) => setDraft({ ...draft, notify: event.target.checked })} />}
                label={t('Erinnerungen aus diesem Kalender bekommen')}
              />
            )}
            {davUrl && calendar.access !== 'freebusy' && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: `${radius.md}px`,
                  bgcolor: c.surfaceContainerHigh,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Typography variant="subtitle2">{t('CalDAV-Adresse')}</Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {t('Für Thunderbird, DAVx⁵ und andere Apps, die einzelne Kalender einbinden. Melde dich mit einem App-Passwort an.')}
                </Typography>
                <CopyField label={t('CalDAV-Adresse')} value={davUrl} />
              </Box>
            )}
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {tn(calendar.count, '1 Eintrag', '{count} Einträge')}
            </Typography>
          </>
        )}
        {tab === 'share' && <SharePanel calendar={calendar} />}
        {tab === 'publish' && <PublishPanel calendar={calendar} />}
        {tab === 'transfer' && (
          <>
            <Button
              variant="outlined"
              startIcon={<DownloadRounded />}
              href={`/api/calendar/calendars/${calendar.id}/export.ics`}
              download
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('Als ICS-Datei exportieren')}
            </Button>
            {(owner || calendar.access === 'write') && !subscription && <ImportPanel calendarId={calendar.id} />}
          </>
        )}
      </DialogContent>
      {tab === 'general' && (
        <DialogActions>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="contained" onClick={() => void save()}>
            {t('Speichern')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
