import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ManageSearchRounded from '@mui/icons-material/ManageSearchRounded';
import UpdateRounded from '@mui/icons-material/UpdateRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, fonts } from '../../theme/tokens';
import { CopyField, Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { UpdateBanner, updateCommand, type UpdateInfo } from './Overview';
import { Facts, Loading, StatusDot, Toggle } from './shared';

interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  install: string;
  dataDir: string;
  storage: string | null;
  database: number;
  tools: { ffmpeg: boolean; ffprobe: boolean; pdftoppm: boolean; pdftotext: boolean };
  processing: { pending: number; processed: number; failed: number };
  metrics: boolean;
  metricsEnv: boolean;
}

function installLabel(install: string) {
  if (install === 'docker') return 'Docker';
  if (install === 'script') return t('Installationsskript');
  return 'Node.js';
}

function toolHint(tool: string) {
  switch (tool) {
    case 'ffmpeg':
      return t('Vorschaubilder für Videos');
    case 'ffprobe':
      return t('Länge, Auflösung und Aufnahmedatum von Videos');
    case 'pdftoppm':
      return t('Vorschaubilder für PDFs');
    default:
      return t('Suche im Text von PDFs');
  }
}

export function SystemSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.get<SystemInfo>('/api/admin/system'), api.get<UpdateInfo>('/api/admin/updates')])
      .then(([system, status]) => {
        setInfo(system);
        setUpdates(status);
      })
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  if (!info || !updates) return <Loading />;

  const check = async () => {
    setChecking(true);
    try {
      const status = await api.post<UpdateInfo>('/api/admin/updates/check');
      setUpdates(status);
      toast(status.available ? t('Eine neue Version ist verfügbar') : t('Du hast die neueste Version'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setChecking(false);
    }
  };

  const metrics = async (enabled: boolean) => {
    if (
      !enabled &&
      !(await confirm({
        title: t('Metriken ausschalten?'),
        text: t('Das bisherige Token funktioniert danach nicht mehr.'),
        confirm: t('Ausschalten'),
      }))
    )
      return;
    try {
      const result = await api.post<{ token: string | null }>('/api/admin/metrics', { enabled });
      setToken(result.token);
      setInfo({ ...info, metrics: enabled });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const reindex = async () => {
    try {
      const result = await api.post<{ pending: number }>('/api/admin/processing/reindex');
      setInfo({ ...info, processing: { ...info.processing, pending: result.pending } });
      toast(tn(result.pending, '{count} Datei wird neu eingelesen', '{count} Dateien werden neu eingelesen'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const origin = boot().site.url || location.origin;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <UpdateBanner updates={updates} />
      {info.storage && (
        <Alert severity="warning">
          {t(
            'Der Datenordner liegt auf {kind}. Dort funktionieren die Dateisperren von SQLite oft nicht zuverlässig, Befehle wie moecloud backup laufen dann nur bei angehaltenem Server. Leg den Datenordner am besten auf einen lokalen Datenträger.',
            { kind: info.storage }
          )}
        </Alert>
      )}
      <Section
        title={t('Version')}
        action={
          !updates.locked ? (
            <Button variant="tonal" startIcon={<UpdateRounded />} disabled={checking} onClick={() => void check()}>
              {t('Nach Updates sehen')}
            </Button>
          ) : undefined
        }
      >
        <Facts
          rows={[
            [t('MoeCloud'), info.version],
            [t('Node.js'), info.node],
            [t('System'), info.platform],
            [t('Installiert mit'), installLabel(info.install)],
            [
              t('Datenordner'),
              <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem' }}>
                {info.dataDir}
              </Box>,
            ],
            [t('Datenbank'), formatBytes(info.database)],
            [
              t('Neueste Version'),
              updates.locked
                ? t('Prüfung ausgeschaltet')
                : updates.latest
                  ? t('{version}, geprüft am {date}', { version: updates.latest.version, date: formatDateTime(updates.latest.checkedAt) })
                  : t('Noch nicht geprüft'),
            ],
          ]}
        />
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Aktualisieren:')}{' '}
          <Box component="code" sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
            {updateCommand(info.install)}
          </Box>
        </Typography>
      </Section>

      <Section
        title={t('Programme für Vorschauen')}
        description={t(
          'Fehlt ein Programm, läuft MoeCloud trotzdem. Es gibt dann nur weniger Vorschauen. Im Docker-Image ist alles dabei.'
        )}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {(Object.keys(info.tools) as (keyof SystemInfo['tools'])[]).map((tool) => (
            <Box key={tool} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <StatusDot tone={info.tools[tool] ? 'ok' : 'warn'} />
              <Typography variant="body2" sx={{ fontFamily: fonts.mono, width: 96 }}>
                {tool}
              </Typography>
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {info.tools[tool] ? toolHint(tool) : t('fehlt: {hint}', { hint: toolHint(tool) })}
              </Typography>
            </Box>
          ))}
        </Box>
      </Section>

      <Section
        title={t('Verarbeitung im Hintergrund')}
        description={t('Nach dem Hochladen liest MoeCloud Bildinfos, Musik-Tags und Text für die Suche aus und erstellt Vorschaubilder.')}
        action={
          <Button variant="tonal" startIcon={<ManageSearchRounded />} onClick={() => void reindex()}>
            {t('Suchindex neu aufbauen')}
          </Button>
        }
      >
        <Facts
          rows={[
            [t('Warteschlange'), formatNumber(info.processing.pending)],
            [t('Seit dem Start verarbeitet'), formatNumber(info.processing.processed)],
            [t('Fehlgeschlagen'), formatNumber(info.processing.failed)],
          ]}
        />
      </Section>

      <Section
        title={t('Metriken für Prometheus')}
        description={t('Unter /metrics gibt es Zahlen zu Konten, Speicher, Uploads und Virenscan. Der Zugriff braucht ein Token.')}
      >
        {info.metricsEnv ? (
          <Alert severity="info">{t('Das Token ist über die Umgebungsvariable METRICS_TOKEN gesetzt.')}</Alert>
        ) : (
          <Toggle checked={info.metrics} onChange={(value) => void metrics(value)} label={t('Metriken einschalten')} />
        )}
        {token && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2">{t('Dieses Token siehst du nur jetzt. Trag es in deine Prometheus-Konfiguration ein.')}</Typography>
            <CopyField value={token} label={t('Token')} />
          </Box>
        )}
        {(info.metrics || info.metricsEnv) && (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              borderRadius: 2,
              bgcolor: c.surfaceContainer,
              fontFamily: fonts.mono,
              fontSize: '0.8125rem',
              overflowX: 'auto',
            }}
          >
            {`- job_name: moecloud\n  scheme: ${origin.startsWith('https') ? 'https' : 'http'}\n  metrics_path: /metrics\n  authorization:\n    credentials: ${token ?? '<token>'}\n  static_configs:\n    - targets: ['${origin.replace(/^https?:\/\//, '')}']`}
          </Box>
        )}
      </Section>
    </Box>
  );
}
