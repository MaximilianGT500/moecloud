import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import GppBadRounded from '@mui/icons-material/GppBadRounded';
import NetworkCheckRounded from '@mui/icons-material/NetworkCheckRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { Loading, SaveBar, Stat, Toggle } from './shared';

interface ScanSettings {
  'scan.enabled': boolean;
  'scan.host': string;
  'scan.port': number;
  'scan.socket': string;
  'scan.maxBytes': number;
  'scan.onError': 'allow' | 'reject';
  'scan.rescanDays': number;
  [key: string]: string | number | boolean;
}

interface ScanView {
  settings: ScanSettings;
  stats: { clean: number; infected: number; skipped: number; error: number; released: number; unscanned: number; lastScan: number | null };
  job: { running: boolean; done: number; total: number; found: number; startedAt: number };
}

interface Quarantined {
  sha256: string;
  size: number;
  signature: string | null;
  scannedAt: number | null;
  files: { id: string; name: string; owner: string }[];
}

const MB = 1024 * 1024;
const LIMITS = [25, 50, 100, 250, 500, 1024, 2048, 4096].map((size) => size * MB);

export function ScanSection() {
  const [view, setView] = useState<ScanView | null>(null);
  const [draft, setDraft] = useState<ScanSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<'tcp' | 'socket'>('tcp');
  const [items, setItems] = useState<Quarantined[] | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (next: ScanView) => {
    setView(next);
    setDraft(next.settings);
    setMode(next.settings['scan.socket'] ? 'socket' : 'tcp');
  };

  const loadQuarantine = () =>
    api
      .get<{ items: Quarantined[] }>('/api/admin/scan/quarantine')
      .then((data) => setItems(data.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    api
      .get<ScanView>('/api/admin/scan')
      .then(apply)
      .catch((error) => toast(errorText(error)));
    void loadQuarantine();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, []);

  const running = view?.job.running ?? false;
  useEffect(() => {
    if (!running) return;
    poll.current = setTimeout(async () => {
      try {
        const next = await api.get<ScanView>('/api/admin/scan');
        setView((current) => (current ? { ...current, stats: next.stats, job: next.job } : next));
        if (!next.job.running) {
          void loadQuarantine();
          toast(tn(next.job.found, 'Prüfung fertig, {count} Fund', 'Prüfung fertig, {count} Funde'));
        }
      } catch {}
    }, 2000);
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [running, view?.job.done]);

  if (!view || !draft) return <Loading />;
  const set = (key: keyof ScanSettings, value: string | number | boolean) => setDraft({ ...draft, [key]: value });
  const changed = (Object.keys(draft) as (keyof ScanSettings)[]).filter((key) => draft[key] !== view.settings[key]);

  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(changed.map((key) => [key, draft[key]]));
      apply(await api.patch<ScanView>('/api/admin/scan', body));
      toast(t('Gespeichert'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const data = await api.post<{ version: string; detects: boolean; ms: number }>(
        '/api/admin/scan/test',
        mode === 'socket' ? { socket: draft['scan.socket'] } : { host: draft['scan.host'], port: Number(draft['scan.port']) }
      );
      setResult({
        ok: data.detects,
        text: data.detects
          ? t('Verbunden mit {version}. Die Testdatei wurde erkannt ({ms} ms).', { version: data.version, ms: data.ms })
          : t('Verbunden mit {version}, aber die Testdatei wurde nicht erkannt. Sind die Signaturen aktuell?', { version: data.version }),
      });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setTesting(false);
    }
  };

  const run = async (all: boolean) => {
    try {
      const data = await api.post<{ job: ScanView['job'] }>('/api/admin/scan/run', { all });
      setView({ ...view, job: data.job });
      if (!data.job.running) toast(t('Es gibt nichts zu prüfen'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const release = async (entry: Quarantined) => {
    const ok = await confirm({
      title: t('Datei freigeben?'),
      text: t(
        'Gib die Datei nur frei, wenn du sicher bist, dass der Fund ein Fehlalarm ist. Danach lässt sie sich wieder öffnen und teilen.'
      ),
      confirm: t('Freigeben'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/admin/scan/release', { sha256: entry.sha256 });
      void loadQuarantine();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const purge = async (entry: Quarantined) => {
    const ok = await confirm({
      title: tn(entry.files.length, 'Befallene Datei löschen?', '{count} befallene Dateien löschen?'),
      text: t('Die Datei verschwindet bei allen, die sie haben. Das lässt sich nicht rückgängig machen.'),
      confirm: t('Endgültig löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/admin/scan/delete', { sha256: entry.sha256 });
      void loadQuarantine();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const { stats, job } = view;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section
        title={t('Virenscan mit ClamAV')}
        description={t(
          'Ist der Scan an, prüft MoeCloud jede neue Datei, bevor sie gespeichert wird. Das gilt für die Weboberfläche, Links zum Hochladen und WebDAV.'
        )}
      >
        <Toggle
          checked={Boolean(draft['scan.enabled'])}
          onChange={(value) => set('scan.enabled', value)}
          label={t('Dateien beim Hochladen prüfen')}
          hint={t('Braucht einen laufenden ClamAV-Dienst (clamd). Mit Docker reicht die Datei docker/clamav.yml.')}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          aria-label={t('Verbindung')}
          onChange={(_event, value: 'tcp' | 'socket' | null) => {
            if (!value) return;
            setMode(value);
            if (value === 'tcp') set('scan.socket', '');
          }}
        >
          <ToggleButton value="tcp">{t('Netzwerk')}</ToggleButton>
          <ToggleButton value="socket">{t('Unix-Socket')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'tcp' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
            <TextField
              label={t('Server')}
              placeholder="clamav"
              value={draft['scan.host']}
              onChange={(event) => set('scan.host', event.target.value)}
            />
            <TextField
              label={t('Port')}
              type="number"
              value={draft['scan.port']}
              onChange={(event) => set('scan.port', Math.max(1, Math.min(65535, Number(event.target.value) || 3310)))}
            />
          </Box>
        ) : (
          <TextField
            label={t('Pfad zum Socket')}
            placeholder="/run/clamav/clamd.ctl"
            value={draft['scan.socket']}
            onChange={(event) => set('scan.socket', event.target.value)}
          />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="tonal" startIcon={<NetworkCheckRounded />} disabled={testing} onClick={() => void test()}>
            {t('Verbindung testen')}
          </Button>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Der Test schickt die harmlose EICAR-Testdatei an ClamAV.')}
          </Typography>
        </Box>
        {testing && <LinearProgress aria-label={t('Teste Verbindung')} />}
        {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.text}</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            select
            label={t('Größte geprüfte Datei')}
            value={draft['scan.maxBytes']}
            onChange={(event) => set('scan.maxBytes', Number(event.target.value))}
            helperText={t('Größere Dateien werden gespeichert, aber nicht geprüft. Passe den Wert an StreamMaxLength in ClamAV an.')}
          >
            {LIMITS.map((limit) => (
              <MenuItem key={limit} value={limit}>
                {formatBytes(limit)}
              </MenuItem>
            ))}
            {!LIMITS.includes(Number(draft['scan.maxBytes'])) && Number(draft['scan.maxBytes']) > 0 && (
              <MenuItem value={draft['scan.maxBytes']}>{formatBytes(Number(draft['scan.maxBytes']))}</MenuItem>
            )}
            <MenuItem value={0}>{t('Keine Grenze')}</MenuItem>
          </TextField>
          <TextField
            select
            label={t('Wenn ClamAV nicht antwortet')}
            value={draft['scan.onError']}
            onChange={(event) => set('scan.onError', event.target.value)}
            helperText={t('Abweisen ist sicherer, blockiert aber alle Uploads, solange ClamAV ausfällt.')}
          >
            <MenuItem value="allow">{t('Datei trotzdem annehmen')}</MenuItem>
            <MenuItem value="reject">{t('Upload abweisen')}</MenuItem>
          </TextField>
          <TextField
            select
            label={t('Vorhandene Dateien erneut prüfen')}
            value={draft['scan.rescanDays']}
            onChange={(event) => set('scan.rescanDays', Number(event.target.value))}
            helperText={t('Mit neuen Signaturen findet ClamAV manchmal, was vorher durchgerutscht ist.')}
          >
            <MenuItem value={0}>{t('Nie automatisch')}</MenuItem>
            {[1, 7, 14, 30, 90].map((days) => (
              <MenuItem key={days} value={days}>
                {days === 1 ? t('Jeden Tag') : tn(days, 'Alle {count} Tage', 'Alle {count} Tage')}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Section>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <Stat label={t('Sauber')} value={formatNumber(stats.clean)} />
        <Stat label={t('Blockiert')} value={formatNumber(stats.infected)} tone={stats.infected ? 'error' : undefined} />
        <Stat
          label={t('Nicht geprüft')}
          value={formatNumber(stats.unscanned + stats.error)}
          hint={stats.error ? tn(stats.error, '{count} mit Fehler', '{count} mit Fehler') : undefined}
        />
        <Stat label={t('Übersprungen')} value={formatNumber(stats.skipped)} hint={t('zu groß')} />
      </Box>

      <Section
        title={t('Vorhandene Dateien prüfen')}
        description={
          stats.lastScan ? t('Letzte Prüfung am {date}', { date: formatDateTime(stats.lastScan) }) : t('Noch keine Datei geprüft.')
        }
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="tonal"
              startIcon={<ReplayRounded />}
              disabled={job.running || !view.settings['scan.enabled']}
              onClick={() => void run(false)}
            >
              {t('Ungeprüfte prüfen')}
            </Button>
            <Button disabled={job.running || !view.settings['scan.enabled']} onClick={() => void run(true)}>
              {t('Alles neu prüfen')}
            </Button>
          </Box>
        }
      >
        {job.running ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <LinearProgress variant="determinate" value={job.total ? (job.done / job.total) * 100 : 0} aria-label={t('Fortschritt')} />
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('{done} von {total} geprüft, {found} gefunden', {
                done: formatNumber(job.done),
                total: formatNumber(job.total),
                found: job.found,
              })}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {view.settings['scan.enabled']
              ? t('Die Prüfung läuft im Hintergrund. Du kannst die Seite währenddessen verlassen.')
              : t('Schalte den Virenscan ein und speichere, dann kannst du vorhandene Dateien prüfen.')}
          </Typography>
        )}
      </Section>

      <Section
        title={t('Gesperrte Dateien')}
        description={t('Befallene Dateien lassen sich nicht öffnen, herunterladen oder teilen, bis du entscheidest.')}
      >
        {!items ? (
          <Loading />
        ) : items.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Keine gesperrten Dateien.')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {items.map((entry) => (
              <Box
                component="li"
                key={entry.sha256}
                sx={{ display: 'flex', gap: 1.5, p: 1.5, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer, flexWrap: 'wrap' }}
              >
                <GppBadRounded sx={{ color: c.error, mt: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                    {entry.signature ?? t('Schadsoftware')}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                    {[formatBytes(entry.size), entry.scannedAt ? formatDateTime(entry.scannedAt) : null, entry.sha256.slice(0, 16)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  {entry.files.map((file) => (
                    <Typography key={file.id} variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>
                      {t('„{name}“ von {owner}', { name: file.name, owner: file.owner })}
                    </Typography>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <Button size="small" onClick={() => void release(entry)}>
                    {t('Freigeben')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => void purge(entry)}
                    sx={{ bgcolor: c.error, color: c.onError, '&:hover': { bgcolor: c.error } }}
                  >
                    {t('Löschen')}
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <SaveBar count={changed.length} busy={busy} onSave={() => void save()} onReset={() => setDraft(view.settings)} />
    </Box>
  );
}
