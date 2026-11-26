import { useEffect, useRef, useState, type DragEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloudSyncRounded from '@mui/icons-material/CloudSyncRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { api, csrfToken, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { ColorPicker } from './CalendarDialogs';
import { PALETTE } from './model';
import { invalidate, loadCalendars, writableCalendars } from './store';

type Source = 'files' | 'url' | 'caldav';

interface JobCalendar {
  key: string;
  name: string;
  color: string | null;
  description: string | null;
  origin: string;
  events: number;
  tasks: number;
  first: number | null;
  last: number | null;
}

interface JobResult {
  key: string;
  calendarId: string;
  name: string;
  color: string;
  createdCalendar: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

interface Job {
  id: string;
  kind: 'file' | 'url' | 'caldav';
  label: string;
  status: 'reading' | 'ready' | 'importing' | 'done' | 'failed';
  calendars: JobCalendar[];
  warnings: string[];
  error: string | null;
  results: JobResult[] | null;
}

interface Choice {
  include: boolean;
  name: string;
  color: string;
  target: string;
}

const PROVIDERS = [
  { key: 'nextcloud', label: 'Nextcloud', url: 'https://cloud.example.com/remote.php/dav' },
  { key: 'icloud', label: 'iCloud', url: 'https://caldav.icloud.com' },
  { key: 'fastmail', label: 'Fastmail', url: 'https://caldav.fastmail.com' },
  { key: 'mailbox', label: 'mailbox.org', url: 'https://dav.mailbox.org' },
  { key: 'posteo', label: 'Posteo', url: 'https://posteo.de:8443' },
  { key: 'other', label: '', url: '' },
] as const;

type Provider = (typeof PROVIDERS)[number]['key'];

function providerHint(provider: Provider) {
  switch (provider) {
    case 'nextcloud':
      return t(
        'Ersetz cloud.example.com durch die Adresse deiner Nextcloud. Ein App-Passwort legst du dort unter Einstellungen › Sicherheit an.'
      );
    case 'icloud':
      return t('Melde dich mit deiner Apple-ID an. Als Passwort brauchst du ein app-spezifisches Passwort von account.apple.com.');
    case 'fastmail':
      return t('Leg in Fastmail ein App-Passwort mit Zugriff auf Kalender an.');
    case 'mailbox':
      return t('Nimm deine Adresse bei mailbox.org und dein Passwort oder ein App-Passwort.');
    case 'posteo':
      return t('Nimm deine Adresse bei Posteo und dein Passwort.');
    default:
      return t('Für Radicale, Baïkal, Synology, SOGo und andere Server mit CalDAV. Oft reicht die Adresse des Servers.');
  }
}

const sameYear = (a: number, b: number) => new Date(a).getFullYear() === new Date(b).getFullYear();

function span(entry: JobCalendar) {
  if (entry.first === null || entry.last === null) return '';
  const year = (time: number) => String(new Date(time).getFullYear());
  return sameYear(entry.first, entry.last) ? year(entry.first) : `${year(entry.first)}–${year(entry.last)}`;
}

function amounts(entry: { events: number; tasks: number }) {
  const parts = [];
  if (entry.events) parts.push(tn(entry.events, '1 Termin', '{count} Termine'));
  if (entry.tasks) parts.push(tn(entry.tasks, '1 Aufgabe', '{count} Aufgaben'));
  return parts.join(', ');
}

async function sendFiles(files: File[]) {
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  const response = await fetch('/api/calendar/import', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
  });
  const data = (await response.json().catch(() => ({}))) as { job?: Job; error?: { message?: string } };
  if (!response.ok || !data.job) throw new Error(data.error?.message ?? t('Der Import hat nicht geklappt'));
  return data.job;
}

function ColorChoice({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <ButtonBase
        aria-label={t('Farbe für „{name}“', { name: label })}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: value, flex: 'none', mt: 1 }}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, maxWidth: 300 } } }}
      >
        <ColorPicker
          value={value}
          onChange={(color) => {
            onChange(color);
            setAnchor(null);
          }}
        />
      </Popover>
    </>
  );
}

export function ImportWizard({ node, onClose }: { node?: string | null; onClose: () => void }) {
  const remote = boot().calendarFeatures?.imports !== false;
  const narrow = useMediaQuery('(max-width:600px)');
  const [source, setSource] = useState<Source>('files');
  const [url, setUrl] = useState('');
  const [provider, setProvider] = useState<Provider>('nextcloud');
  const [server, setServer] = useState<string>(PROVIDERS[0].url);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [mode, setMode] = useState<'merge' | 'skip' | 'copy'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const started = useRef(false);
  const writable = writableCalendars();

  const accept = (next: Job) => {
    setJob(next);
    if (next.status === 'ready') {
      setChoices(
        Object.fromEntries(
          next.calendars.map((entry, index) => [
            entry.key,
            { include: true, name: entry.name, color: entry.color ?? PALETTE[(index + 3) % PALETTE.length], target: 'new' },
          ])
        )
      );
    }
  };

  const begin = async (start: () => Promise<Job>) => {
    setBusy(true);
    setError(null);
    try {
      accept(await start());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!job || job.status !== 'reading') return;
    const timer = window.setTimeout(() => {
      api
        .get<{ job: Job }>(`/api/calendar/import/${job.id}`)
        .then((result) => accept(result.job))
        .catch((failure: unknown) => setError(errorText(failure)));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [job]);

  useEffect(() => {
    if (!node || started.current) return;
    started.current = true;
    void begin(async () => (await api.post<{ job: Job }>('/api/calendar/import', { node })).job);
  }, [node]);

  const pick = (files: File[]) => {
    if (!files.length) return;
    void begin(() => sendFiles(files));
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick([...event.dataTransfer.files]);
  };

  const run = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ job: Job }>(`/api/calendar/import/${job.id}/run`, {
        mode,
        calendars: job.calendars.map((entry) => {
          const choice = choices[entry.key];
          return choice?.include
            ? { key: entry.key, target: choice.target, name: choice.name.trim() || entry.name, color: choice.color }
            : { key: entry.key, target: 'skip' };
        }),
      });
      setJob(result.job);
      invalidate();
      await loadCalendars();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (job) void api.delete(`/api/calendar/import/${job.id}`).catch(() => undefined);
    setJob(null);
    setError(null);
  };

  const selected = job ? job.calendars.filter((entry) => choices[entry.key]?.include) : [];
  const reading = busy || job?.status === 'reading';
  const step =
    !job || job.status === 'failed' ? 'source' : job.status === 'done' ? 'done' : job.status === 'reading' ? 'reading' : 'preview';

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={narrow} data-import-wizard>
      <DialogTitle>{t('Kalender importieren')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        {job?.status === 'failed' && job.error && <Alert severity="error">{job.error}</Alert>}

        {step === 'source' && (
          <>
            {remote && (
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={source}
                onChange={(_event, value: Source | null) => value && setSource(value)}
                aria-label={t('Woher die Termine kommen')}
              >
                <ToggleButton value="files" sx={{ gap: 1 }}>
                  <UploadFileRounded fontSize="small" />
                  {t('Dateien')}
                </ToggleButton>
                <ToggleButton value="url" sx={{ gap: 1 }}>
                  <LinkRounded fontSize="small" />
                  {t('Adresse')}
                </ToggleButton>
                <ToggleButton value="caldav" sx={{ gap: 1 }}>
                  <CloudSyncRounded fontSize="small" />
                  {t('CalDAV-Konto')}
                </ToggleButton>
              </ToggleButtonGroup>
            )}

            {source === 'files' && (
              <Box
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 1.5,
                  p: 3,
                  borderRadius: `${radius.lg}px`,
                  border: `2px dashed ${dragging ? c.primary : c.outlineVariant}`,
                  bgcolor: dragging ? c.primaryContainer : 'transparent',
                }}
              >
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {t(
                    'ICS-Dateien aus Google, Apple, Outlook und Thunderbird, ZIP-Archive aus Google Takeout und CSV aus Google oder Outlook. Auch mehrere auf einmal.'
                  )}
                </Typography>
                <Button component="label" variant="contained" startIcon={<UploadFileRounded />} disabled={reading}>
                  {t('Dateien auswählen')}
                  <input
                    hidden
                    multiple
                    type="file"
                    accept=".ics,.ical,.ifb,.vcs,.zip,.csv,text/calendar,text/csv,application/zip"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      event.target.value = '';
                      pick(files);
                    }}
                  />
                </Button>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {t('Oder zieh die Dateien hierher.')}
                </Typography>
              </Box>
            )}

            {source === 'url' && (
              <Box
                component="form"
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void begin(async () => (await api.post<{ job: Job }>('/api/calendar/import', { url })).job);
                }}
              >
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {t(
                    'Etwa die geheime Adresse im iCal-Format aus den Einstellungen von Google Kalender oder ein veröffentlichter Outlook-Kalender. MoeCloud kopiert die Termine einmal. Soll der Kalender aktuell bleiben, abonnier ihn stattdessen.'
                  )}
                </Typography>
                <TextField
                  autoFocus
                  required
                  label={t('Adresse (https:// oder webcal://)')}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                />
                <Button type="submit" variant="contained" disabled={reading || !url.trim()} sx={{ alignSelf: 'flex-start' }}>
                  {t('Kalender lesen')}
                </Button>
              </Box>
            )}

            {source === 'caldav' && (
              <Box
                component="form"
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void begin(
                    async () => (await api.post<{ job: Job }>('/api/calendar/import', { caldav: { url: server, username, password } })).job
                  );
                }}
              >
                <TextField
                  select
                  label={t('Anbieter')}
                  value={provider}
                  onChange={(event) => {
                    const next = PROVIDERS.find((entry) => entry.key === event.target.value) ?? PROVIDERS[5];
                    setProvider(next.key);
                    setServer(next.url);
                  }}
                >
                  {PROVIDERS.map((entry) => (
                    <MenuItem key={entry.key} value={entry.key}>
                      {entry.label || t('Anderer Server')}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {providerHint(provider)}
                </Typography>
                <TextField required label={t('Adresse des Servers')} value={server} onChange={(event) => setServer(event.target.value)} />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  <TextField
                    required
                    label={t('Benutzername')}
                    autoComplete="off"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  <TextField
                    required
                    type="password"
                    label={t('Passwort oder App-Passwort')}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {t(
                    'MoeCloud nutzt die Zugangsdaten nur für diesen Import und speichert sie nicht. Google und Outlook bieten kein CalDAV mit Passwort an: Lade dort einen Export herunter oder nimm die Adresse im iCal-Format.'
                  )}
                </Typography>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={reading || !server.trim() || !username.trim() || !password}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {t('Verbinden')}
                </Button>
              </Box>
            )}
            {reading && <LinearProgress />}
          </>
        )}

        {step === 'reading' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 2 }}>
            <Typography>{t('MoeCloud liest die Kalender von {host} …', { host: job?.label ?? '' })}</Typography>
            <LinearProgress />
          </Box>
        )}

        {step === 'preview' && job && (
          <>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {tn(
                job.calendars.length,
                'MoeCloud hat einen Kalender gefunden. Leg fest, wie er heißen soll und wohin die Termine kommen.',
                'MoeCloud hat {count} Kalender gefunden. Leg fest, welche du übernimmst, wie sie heißen und wohin die Termine kommen.'
              )}
            </Typography>
            {job.warnings.length > 0 && (
              <Alert severity="warning">
                {job.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </Alert>
            )}
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {job.calendars.map((entry) => {
                const choice = choices[entry.key];
                if (!choice) return null;
                const update = (patch: Partial<Choice>) => setChoices((current) => ({ ...current, [entry.key]: { ...choice, ...patch } }));
                return (
                  <Box
                    component="li"
                    key={entry.key}
                    data-import-calendar={entry.name}
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      p: 1.5,
                      borderRadius: `${radius.md}px`,
                      bgcolor: c.surfaceContainerHigh,
                      opacity: choice.include ? 1 : 0.6,
                    }}
                  >
                    <Checkbox
                      checked={choice.include}
                      onChange={(event) => update({ include: event.target.checked })}
                      slotProps={{ input: { 'aria-label': t('„{name}“ übernehmen', { name: entry.name }) } }}
                      sx={{ alignSelf: 'flex-start' }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        {choice.target === 'new' && (
                          <ColorChoice value={choice.color} label={choice.name || entry.name} onChange={(color) => update({ color })} />
                        )}
                        <TextField
                          select
                          size="small"
                          label={t('Ziel')}
                          value={choice.target}
                          disabled={!choice.include}
                          onChange={(event) => update({ target: event.target.value })}
                          sx={{ minWidth: 160 }}
                        >
                          <MenuItem value="new">{t('Neuer Kalender')}</MenuItem>
                          {writable.map((calendar) => (
                            <MenuItem key={calendar.id} value={calendar.id}>
                              {calendar.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        {choice.target === 'new' && (
                          <TextField
                            size="small"
                            label={t('Name')}
                            value={choice.name}
                            disabled={!choice.include}
                            onChange={(event) => update({ name: event.target.value.slice(0, 100) })}
                            sx={{ flex: 1, minWidth: 0 }}
                          />
                        )}
                      </Box>
                      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                        {[amounts(entry), span(entry), entry.origin !== entry.name ? entry.origin : ''].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
            <TextField
              select
              label={t('Wenn ein Termin schon existiert')}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <MenuItem value="merge">{t('Aktualisieren')}</MenuItem>
              <MenuItem value="skip">{t('Überspringen')}</MenuItem>
              <MenuItem value="copy">{t('Als Kopie anlegen')}</MenuItem>
            </TextField>
            {busy && <LinearProgress />}
          </>
        )}

        {step === 'done' && job?.results && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-import-done>
            {job.results.map((result) => (
              <Box key={result.key} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <CheckCircleRounded sx={{ color: result.color, mt: 0.25 }} />
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{result.name}</Typography>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {t('{created} neu, {updated} aktualisiert, {skipped} übersprungen', {
                      created: result.created,
                      updated: result.updated,
                      skipped: result.skipped,
                    })}
                    {result.failed ? `, ${t('{count} fehlerhaft', { count: result.failed })}` : ''}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'preview' && (
          <>
            <Button onClick={back} disabled={busy} sx={{ mr: 'auto' }}>
              {t('Zurück')}
            </Button>
            <Button onClick={onClose} disabled={busy}>
              {t('Abbrechen')}
            </Button>
            <Button variant="contained" onClick={() => void run()} disabled={busy || !selected.length}>
              {tn(selected.length, 'Einen Kalender importieren', '{count} Kalender importieren')}
            </Button>
          </>
        )}
        {step === 'done' && (
          <Button variant="contained" onClick={onClose}>
            {t('Fertig')}
          </Button>
        )}
        {(step === 'source' || step === 'reading') && (
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
