import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CleaningServicesRounded from '@mui/icons-material/CleaningServicesRounded';
import NewReleasesRounded from '@mui/icons-material/NewReleasesRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDay, formatNumber, formatRelative } from '../../lib/format';
import { language, t, tn } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { c, fileTypeColor, radius } from '../../theme/tokens';
import { Section, UserAvatar } from '../common/bits';
import { toast } from '../common/toast';
import { Loading, Stat, StatusDot } from './shared';

type Group = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

export interface UpdateInfo {
  current: string;
  enabled: boolean;
  locked: boolean;
  install: string;
  available: boolean;
  latest: {
    version: string;
    date: string;
    url: string;
    security: boolean;
    notes: { de: string[]; en: string[] };
    checkedAt: number;
  } | null;
}

interface Overview {
  version: string;
  users: number;
  active: number;
  live: number;
  files: number;
  folders: number;
  links: number;
  logical: number;
  physical: number;
  versions: number;
  disk: { total: number; free: number } | null;
  groups: Record<Group, { size: number; count: number }>;
  top: { id: number; name: string; initials: string; size: number; files: number }[];
  health: {
    mail: boolean;
    scan: { clean: number; infected: number; unscanned: number; error: number; lastScan: number | null } | null;
    backup: number | null;
    processing: number;
    tools: { ffmpeg: boolean; ffprobe: boolean; pdftoppm: boolean; pdftotext: boolean };
    maintenance: boolean;
    failedLogins: number;
  };
  updates: UpdateInfo;
}

const GROUPS: { key: Group; color: string }[] = [
  { key: 'image', color: fileTypeColor.image },
  { key: 'video', color: fileTypeColor.video },
  { key: 'audio', color: fileTypeColor.audio },
  { key: 'document', color: fileTypeColor.text },
  { key: 'archive', color: 'var(--mui-palette-folders-brown)' },
  { key: 'other', color: fileTypeColor.other },
];

function groupLabel(group: Group) {
  switch (group) {
    case 'image':
      return t('Bilder');
    case 'video':
      return t('Videos');
    case 'audio':
      return t('Audio');
    case 'document':
      return t('Dokumente');
    case 'archive':
      return t('Archive');
    default:
      return t('Sonstiges');
  }
}

export function updateCommand(install: string) {
  if (install === 'docker') return 'docker compose pull && docker compose up -d';
  if (install === 'script') return 'sudo moecloud update';
  return 'git pull && npm ci && npm run build && npm start';
}

export function UpdateBanner({ updates }: { updates: UpdateInfo }) {
  if (!updates.available || !updates.latest) return null;
  const notes = updates.latest.notes[language] ?? [];
  return (
    <Alert
      severity={updates.latest.security ? 'error' : 'info'}
      icon={<NewReleasesRounded />}
      action={
        updates.latest.url ? (
          <Button color="inherit" size="small" href={updates.latest.url} target="_blank" rel="noopener noreferrer">
            {t('Was ist neu')}
          </Button>
        ) : undefined
      }
    >
      <Typography variant="subtitle2" component="p">
        {updates.latest.security
          ? t('MoeCloud {version} ist da und schließt Sicherheitslücken', { version: updates.latest.version })
          : t('MoeCloud {version} ist da', { version: updates.latest.version })}
      </Typography>
      {notes.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {notes.slice(0, 5).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </Box>
      )}
      <Typography variant="body2" sx={{ mt: 1 }}>
        {t('So aktualisierst du:')}{' '}
        <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
          {updateCommand(updates.install)}
        </Box>
      </Typography>
    </Alert>
  );
}

function HealthRow({ tone, title, text, href }: { tone: 'ok' | 'warn' | 'error' | 'off'; title: string; text: ReactNode; href?: string }) {
  const body = (
    <>
      <StatusDot tone={tone} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
          {text}
        </Typography>
      </Box>
      {href && <ChevronRightRounded sx={{ color: c.onSurfaceVariant }} />}
    </>
  );
  const sx = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    p: 1.25,
    mx: -1.25,
    borderRadius: `${radius.tile}px`,
    textAlign: 'left' as const,
    width: 'calc(100% + 20px)',
  };
  return href ? (
    <ButtonBase onClick={() => navigate(href)} sx={{ ...sx, justifyContent: 'flex-start', '&:hover': { bgcolor: c.surfaceContainer } }}>
      {body}
    </ButtonBase>
  ) : (
    <Box sx={sx}>{body}</Box>
  );
}

export function OverviewSection() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Overview>('/api/admin/overview')
      .then(setData)
      .catch((error) => toast(errorText(error)));
  }, []);

  if (!data) return <Loading />;
  const saved = Math.max(0, data.logical - data.physical);
  const usedDisk = data.disk ? data.disk.total - data.disk.free : 0;
  const diskPercent = data.disk ? (usedDisk / data.disk.total) * 100 : 0;
  const { health } = data;
  const missing = (['ffmpeg', 'pdftoppm', 'pdftotext'] as const).filter((tool) => !health.tools[tool]);
  const totalGroups = Math.max(
    1,
    GROUPS.reduce((sum, group) => sum + data.groups[group.key].size, 0)
  );
  const backupAge = health.backup ? Date.now() - health.backup : 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <UpdateBanner updates={data.updates} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' }, gap: 2 }}>
        <Stat
          label={t('Personen')}
          value={formatNumber(data.users)}
          hint={`${tn(data.active, '{count} aktiv in 7 Tagen', '{count} aktiv in 7 Tagen')} · ${tn(data.live, '{count} gerade verbunden', '{count} gerade verbunden')}`}
        />
        <Stat
          label={t('Dateien')}
          value={formatNumber(data.files)}
          hint={`${tn(data.folders, '{count} Ordner', '{count} Ordner')} · ${tn(data.versions, '{count} Version', '{count} Versionen')}`}
        />
        <Stat
          label={t('Belegt')}
          value={formatBytes(data.logical)}
          hint={
            saved > 0
              ? t('{size} gespart, weil gleiche Dateien nur einmal liegen', { size: formatBytes(saved) })
              : t('auf der Platte {size}', { size: formatBytes(data.physical) })
          }
        />
        <Stat
          label={t('Freier Platz')}
          value={data.disk ? formatBytes(data.disk.free) : '–'}
          hint={data.disk ? t('von {total}', { total: formatBytes(data.disk.total) }) : undefined}
          tone={data.disk && diskPercent > 95 ? 'error' : undefined}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Section title={t('Zustand')}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {health.maintenance && (
              <HealthRow
                tone="warn"
                title={t('Wartungsmodus')}
                text={t('Nur Admins können sich gerade anmelden.')}
                href="/admin/settings"
              />
            )}
            <HealthRow
              tone={health.mail ? 'ok' : 'warn'}
              title={t('E-Mail-Versand')}
              text={health.mail ? t('Eingerichtet') : t('Nicht eingerichtet. Ohne E-Mail gibt es kein „Passwort vergessen“.')}
              href="/admin/mail"
            />
            <HealthRow
              tone={
                !health.scan ? 'off' : health.scan.infected > 0 ? 'error' : health.scan.unscanned + health.scan.error > 0 ? 'warn' : 'ok'
              }
              title={t('Virenscan')}
              text={
                !health.scan
                  ? t('Aus')
                  : health.scan.infected > 0
                    ? tn(health.scan.infected, '{count} Datei ist gesperrt', '{count} Dateien sind gesperrt')
                    : health.scan.unscanned + health.scan.error > 0
                      ? tn(
                          health.scan.unscanned + health.scan.error,
                          '{count} Datei ist noch nicht geprüft',
                          '{count} Dateien sind noch nicht geprüft'
                        )
                      : t('Aktiv, nichts gefunden')
              }
              href="/admin/scan"
            />
            <HealthRow
              tone={health.backup === null ? 'off' : health.backup === 0 || backupAge > 2 * 86_400_000 ? 'warn' : 'ok'}
              title={t('Sicherungen')}
              text={
                health.backup === null
                  ? t('Automatische Sicherung aus')
                  : health.backup === 0
                    ? t('Noch keine automatische Sicherung')
                    : t('Letzte Sicherung {time}', { time: formatRelative(health.backup) })
              }
              href="/admin/backups"
            />
            <HealthRow
              tone={health.processing > 0 ? 'warn' : 'ok'}
              title={t('Verarbeitung')}
              text={
                health.processing > 0
                  ? tn(health.processing, '{count} Datei wartet auf Vorschau und Suche', '{count} Dateien warten auf Vorschau und Suche')
                  : t('Alle Dateien sind verarbeitet')
              }
              href="/admin/system"
            />
            {missing.length > 0 && (
              <HealthRow
                tone="warn"
                title={t('Fehlende Programme')}
                text={t('{tools} fehlt. Manche Vorschauen gibt es dann nicht.', { tools: missing.join(', ') })}
                href="/admin/system"
              />
            )}
            <HealthRow
              tone={health.failedLogins > 20 ? 'error' : health.failedLogins > 0 ? 'warn' : 'ok'}
              title={t('Fehlgeschlagene Anmeldungen')}
              text={tn(health.failedLogins, '{count} in den letzten 24 Stunden', '{count} in den letzten 24 Stunden')}
              href="/admin/audit"
            />
          </Box>
        </Section>

        <Section
          title={t('Speicher nach Art')}
          action={
            <Button
              variant="tonal"
              startIcon={<CleaningServicesRounded />}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api.post<{ trash: number; uploads: number; blobs: number }>('/api/admin/maintenance');
                  toast(t('Aufgeräumt: {trash} aus dem Papierkorb, {blobs} verwaiste Dateien, {uploads} alte Uploads', result));
                } catch (error) {
                  toast(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Jetzt aufräumen')}
            </Button>
          }
        >
          {data.disk && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <LinearProgress
                variant="determinate"
                value={diskPercent}
                aria-label={t('Speicherplatz auf dem Server')}
                sx={{ height: 8, '& .MuiLinearProgress-bar': { bgcolor: diskPercent > 90 ? c.error : c.primary } }}
              />
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('{used} von {total} belegt, davon MoeCloud {cloud}', {
                  used: formatBytes(usedDisk),
                  total: formatBytes(data.disk.total),
                  cloud: formatBytes(data.physical),
                })}
              </Typography>
            </Box>
          )}
          <Box
            sx={{
              display: 'flex',
              height: 12,
              borderRadius: `${radius.full}px`,
              overflow: 'hidden',
              gap: '2px',
              bgcolor: c.surfaceContainerHighest,
            }}
            aria-hidden
          >
            {GROUPS.filter((group) => data.groups[group.key].size > 0).map((group) => (
              <Box
                key={group.key}
                sx={{ width: `${(data.groups[group.key].size / totalGroups) * 100}%`, minWidth: 4, bgcolor: group.color }}
              />
            ))}
          </Box>
          <Box
            component="ul"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.25 }}
          >
            {GROUPS.map((group) => (
              <Box component="li" key={group.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: group.color, flex: 'none' }} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {groupLabel(group.key)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {formatBytes(data.groups[group.key].size)} · {formatNumber(data.groups[group.key].count)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
          {data.top.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              <Typography variant="subtitle2" component="h3">
                {t('Wer am meisten belegt')}
              </Typography>
              {data.top.map((person) => (
                <Box key={person.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <UserAvatar initials={person.initials} size={32} />
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {person.name}
                  </Typography>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums' }}>
                    {formatBytes(person.size)}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Section>
      </Box>
      {data.updates.latest?.checkedAt ? (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant, px: 1 }}>
          {t('Version {version}, zuletzt nach Updates gesucht am {date}', {
            version: data.version,
            date: formatDay(data.updates.latest.checkedAt),
          })}
        </Typography>
      ) : null}
    </Box>
  );
}
