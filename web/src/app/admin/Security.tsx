import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import InfoRounded from '@mui/icons-material/InfoRounded';
import LockOpenRounded from '@mui/icons-material/LockOpenRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { c, fonts, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { toast } from '../common/toast';
import { Loading, Stat } from './shared';

interface Check {
  id: string;
  level: 'ok' | 'hint' | 'warn';
  title: string;
  text: string;
  link: string | null;
}

interface Lockout {
  kind: 'account' | 'address';
  id: string;
  label: string;
  until: number;
}

interface Report {
  checkedAt: number;
  items: Check[];
  counts: { ok: number; hint: number; warn: number };
  lockouts: Lockout[];
  contact: string;
  networks: string;
  address: string;
  stats: { sessions: number; appPasswords: number; failedLogins: number };
}

function CheckRow({ check }: { check: Check }) {
  const tone = check.level === 'warn' ? c.error : check.level === 'hint' ? c.tertiary : c.success;
  const Icon = check.level === 'warn' ? ErrorRounded : check.level === 'hint' ? InfoRounded : CheckCircleRounded;
  return (
    <Box
      component="li"
      data-check={check.id}
      data-level={check.level}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        py: 1.5,
        borderTop: `1px solid ${c.outlineVariant}`,
        '&:first-of-type': { borderTop: 0, pt: 0 },
      }}
    >
      <Icon aria-hidden sx={{ color: tone, mt: '2px', flex: 'none' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, textWrap: 'pretty' }}>
          {check.title}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
          {check.text}
        </Typography>
      </Box>
      {check.link && check.level !== 'ok' && (
        <Button
          size="small"
          href={check.link}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || check.link === '/account') return;
            event.preventDefault();
            navigate(check.link!);
          }}
          sx={{ flex: 'none' }}
        >
          {t('Ansehen')}
        </Button>
      )}
    </Box>
  );
}

interface IntegrityProblem {
  sha256: string;
  kind: 'missing' | 'damaged';
  size: number;
  files: number;
  versions: number;
  examples: { name: string; owner: string }[];
}

interface IntegrityState {
  running: {
    startedAt: number;
    total: number;
    totalBytes: number;
    checked: number;
    bytes: number;
    missing: number;
    damaged: number;
  } | null;
  last: {
    at: number;
    durationMs: number;
    checked: number;
    bytes: number;
    missing: number;
    damaged: number;
    problems: IntegrityProblem[];
  } | null;
  schedule: 'off' | 'weekly' | 'monthly';
}

function IntegrityCard({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<IntegrityState | null>(null);
  const [busy, setBusy] = useState(false);
  const running = Boolean(state?.running);

  useEffect(() => {
    api
      .get<IntegrityState>('/api/admin/integrity')
      .then(setState)
      .catch((error) => toast(errorText(error)));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .get<IntegrityState>('/api/admin/integrity')
        .then((next) => {
          setState(next);
          if (!next.running) onDone();
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [running]);

  const act = async (call: () => Promise<IntegrityState>) => {
    setBusy(true);
    try {
      setState(await call());
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Loading />;
  const { last } = state;
  const bad = last ? last.missing + last.damaged : 0;
  const progress = state.running;
  const share = progress
    ? progress.totalBytes > 0
      ? (progress.bytes / progress.totalBytes) * 100
      : progress.total > 0
        ? (progress.checked / progress.total) * 100
        : 100
    : 0;

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      data-integrity={progress ? 'running' : last ? (bad ? 'bad' : 'ok') : 'never'}
    >
      {progress ? (
        <>
          <LinearProgress variant="determinate" value={Math.min(100, share)} aria-label={t('Fortschritt der Prüfung')} />
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('{done} von {total} Dateien gelesen, {size}', {
              done: formatNumber(progress.checked),
              total: formatNumber(progress.total),
              size: formatBytes(progress.bytes),
            })}
          </Typography>
        </>
      ) : last ? (
        <Typography variant="body2" sx={{ color: bad ? c.error : c.onSurfaceVariant }}>
          {bad
            ? t('Zuletzt geprüft am {date}. Fehlende Dateien: {missing}, beschädigte: {damaged}, gelesen: {count}.', {
                date: formatDateTime(last.at),
                missing: formatNumber(last.missing),
                damaged: formatNumber(last.damaged),
                count: formatNumber(last.checked),
              })
            : t('Zuletzt geprüft am {date}: {files} mit {size} gelesen, alles in Ordnung.', {
                date: formatDateTime(last.at),
                files: tn(last.checked, '{count} Datei', '{count} Dateien'),
                size: formatBytes(last.bytes),
              })}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Bisher lief noch keine Prüfung.')}
        </Typography>
      )}
      {!progress && last && last.problems.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {last.problems.map((problem) => (
            <Box
              key={problem.sha256}
              data-problem={problem.kind}
              sx={{
                display: 'flex',
                gap: 1.5,
                alignItems: 'flex-start',
                p: 1.5,
                borderRadius: `${radius.md}px`,
                bgcolor: c.surfaceContainerLow,
              }}
            >
              <ErrorRounded sx={{ color: c.error, mt: 0.25 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {problem.examples.length > 0
                    ? problem.examples.map((example) => t('{name} von {owner}', { name: example.name, owner: example.owner })).join(', ')
                    : t('Nur noch als ältere Version vorhanden')}
                  {problem.files > problem.examples.length
                    ? ` ${t('und {count} weitere', { count: problem.files - problem.examples.length })}`
                    : ''}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
                  {[
                    problem.kind === 'missing' ? t('Fehlt auf der Platte') : t('Inhalt stimmt nicht mehr'),
                    formatBytes(problem.size),
                    problem.versions > 0
                      ? tn(problem.versions, 'auch in {count} älteren Version', 'auch in {count} älteren Versionen')
                      : null,
                    `SHA-256 ${problem.sha256.slice(0, 16)}…`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
            </Box>
          ))}
          {bad > last.problems.length && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('Die Liste zeigt die ersten {count}. Alle nennt die Kommandozeile mit check --deep.', { count: last.problems.length })}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {progress ? (
          <Button variant="outlined" disabled={busy} onClick={() => void act(() => api.delete<IntegrityState>('/api/admin/integrity'))}>
            {t('Prüfung abbrechen')}
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<FactCheckRounded />}
            disabled={busy}
            onClick={() => void act(() => api.post<IntegrityState>('/api/admin/integrity'))}
          >
            {t('Jetzt prüfen')}
          </Button>
        )}
        <TextField
          select
          size="small"
          label={t('Von selbst prüfen')}
          value={state.schedule}
          onChange={(event) => {
            const schedule = event.target.value as IntegrityState['schedule'];
            void act(async () => {
              await api.patch('/api/admin/settings', { 'integrity.schedule': schedule });
              toast(t('Gespeichert'));
              return { ...state, schedule };
            });
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="off">{t('Nie')}</MenuItem>
          <MenuItem value="weekly">{t('Jede Woche, nachts')}</MenuItem>
          <MenuItem value="monthly">{t('Jeden Monat, nachts')}</MenuItem>
        </TextField>
      </Box>
    </Box>
  );
}

export function SecuritySection() {
  const [report, setReport] = useState<Report | null>(null);
  const [contact, setContact] = useState('');
  const [networks, setNetworks] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<Report>('/api/admin/security')
      .then((data) => {
        setReport(data);
        setContact(data.contact);
        setNetworks(data.networks);
      })
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  if (!report) return <Loading />;

  const open = report.items.filter((item) => item.level !== 'ok');
  const done = report.items.filter((item) => item.level === 'ok');
  const summary =
    report.counts.warn > 0
      ? tn(report.counts.warn, 'Ein Punkt braucht deine Aufmerksamkeit', '{count} Punkte brauchen deine Aufmerksamkeit')
      : report.counts.hint > 0
        ? tn(report.counts.hint, 'Nichts Dringendes, aber ein Hinweis', 'Nichts Dringendes, aber {count} Hinweise')
        : t('Alles in Ordnung');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <Stat
          label={t('Zu erledigen')}
          value={formatNumber(report.counts.warn)}
          hint={tn(report.counts.hint, '{count} Hinweis', '{count} Hinweise')}
          tone={report.counts.warn > 0 ? 'error' : undefined}
        />
        <Stat label={t('Offene Sitzungen')} value={formatNumber(report.stats.sessions)} hint={t('auf allen Geräten')} />
        <Stat label={t('App-Passwörter')} value={formatNumber(report.stats.appPasswords)} hint={t('für Laufwerke und Skripte')} />
        <Stat
          label={t('Fehlgeschlagene Anmeldungen')}
          value={formatNumber(report.stats.failedLogins)}
          hint={t('in den letzten 24 Stunden')}
        />
      </Box>

      <Section
        title={summary}
        description={t('MoeCloud prüft hier die Einstellungen, die über die Sicherheit entscheiden. Stand: {date}.', {
          date: formatDateTime(report.checkedAt),
        })}
        action={
          <Button startIcon={<RefreshRounded />} onClick={() => void load()}>
            {t('Neu prüfen')}
          </Button>
        }
      >
        {open.length > 0 && (
          <Box component="ul" aria-label={t('Offene Punkte')} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {open.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </Box>
        )}
        {done.length > 0 && (
          <Box
            component="ul"
            aria-label={t('In Ordnung')}
            sx={{ listStyle: 'none', m: 0, p: 2, bgcolor: c.surfaceContainer, borderRadius: `${radius.md}px` }}
          >
            {done.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </Box>
        )}
      </Section>

      <Section
        title={t('Gesperrte Anmeldungen')}
        description={t(
          'Nach zu vielen Fehlversuchen sperrt MoeCloud ein Konto oder eine Adresse für eine Viertelstunde. Hat sich jemand nur vertippt, gibst du die Anmeldung hier wieder frei.'
        )}
      >
        {report.lockouts.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Gerade ist niemand gesperrt.')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {report.lockouts.map((entry) => (
              <Box key={entry.id} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {entry.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {entry.kind === 'account'
                      ? t('Konto, gesperrt bis {date}', { date: formatDateTime(entry.until) })
                      : t('Adresse, gesperrt bis {date}', { date: formatDateTime(entry.until) })}
                  </Typography>
                </Box>
                <Button
                  startIcon={<LockOpenRounded />}
                  aria-label={t('Sperre für {name} aufheben', { name: entry.label })}
                  onClick={async () => {
                    try {
                      const result = await api.post<{ lockouts: Lockout[] }>('/api/admin/security/unlock', { id: entry.id });
                      setReport({ ...report, lockouts: result.lockouts });
                      toast(t('Sperre aufgehoben'));
                    } catch (error) {
                      toast(errorText(error));
                      void load();
                    }
                  }}
                >
                  {t('Freigeben')}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section
        title={t('Dateien prüfen')}
        description={t(
          'MoeCloud liest jede gespeicherte Datei und vergleicht sie mit ihrer Prüfsumme. So fällt auf, wenn eine Datei auf der Platte fehlt oder sich verändert hat, etwa durch einen defekten Datenträger. Bei vielen Dateien dauert das, der Betrieb läuft dabei weiter.'
        )}
      >
        <IntegrityCard onDone={() => void load()} />
      </Section>

      <Section
        title={t('Verwaltung nur aus bestimmten Netzen')}
        description={t(
          'Trag Adressen oder Netze ein, eines pro Zeile, etwa 192.168.1.0/24 oder 203.0.113.7. Von überall sonst bleibt die Verwaltung zu, auch für Admins und ihre App-Passwörter. Ohne Eintrag ist sie von überall erreichbar.'
        )}
      >
        <Box
          component="form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api.put('/api/admin/security/networks', { networks });
              toast(networks.trim() ? t('Die Verwaltung ist jetzt beschränkt') : t('Die Verwaltung ist wieder von überall erreichbar'));
              await load();
            } catch (error) {
              toast(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start' }}
        >
          <TextField
            label={t('Adressen und Netze')}
            placeholder="192.168.1.0/24"
            multiline
            minRows={3}
            fullWidth
            value={networks}
            onChange={(event) => setNetworks(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 4000, spellCheck: false, style: { fontFamily: fonts.mono, fontSize: 13 } } }}
            helperText={t(
              'MoeCloud sieht dich gerade unter {address}. Steht dort die Adresse deines Proxys, sehen alle gleich aus. Trag den Proxy dann zuerst in TRUST_PROXY ein.',
              { address: report.address }
            )}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={
              busy ||
              networks
                .trim()
                .split(/[\s,;]+/)
                .filter(Boolean)
                .join('\n') === report.networks
            }
          >
            {t('Netze speichern')}
          </Button>
        </Box>
      </Section>

      <Section
        title={t('Kontakt für Sicherheitsmeldungen')}
        description={t(
          'Wer eine Lücke in deiner Cloud findet, sucht unter /.well-known/security.txt nach einer Adresse. Trag eine E-Mail-Adresse oder eine Seite mit https:// ein, dann legt MoeCloud die Datei an.'
        )}
      >
        <Box
          component="form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api.patch('/api/admin/settings', { 'security.contact': contact.trim() });
              toast(t('Gespeichert'));
              await load();
            } catch (error) {
              toast(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
          sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
          <TextField
            label={t('Adresse für Meldungen')}
            placeholder="sicherheit@example.com"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <Button type="submit" variant="contained" disabled={busy || contact.trim() === report.contact} sx={{ mt: 1 }}>
            {t('Speichern')}
          </Button>
        </Box>
      </Section>
    </Box>
  );
}
