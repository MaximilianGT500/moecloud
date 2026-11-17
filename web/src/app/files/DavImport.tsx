import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';

interface DavJob {
  id: string;
  folderId: string;
  folder: string;
  host: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  found: number;
  files: number;
  folders: number;
  bytes: number;
  failed: number;
  problems: string[];
  current: string | null;
  error: string | null;
}

function Progress({ job }: { job: DavJob }) {
  const running = job.status === 'running';
  const summary = `${t('{done} von {total} Dateien', { done: formatNumber(job.files), total: formatNumber(job.found) })} · ${formatBytes(job.bytes)}`;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} aria-live="polite">
      {job.status === 'failed' && <Alert severity="error">{job.error}</Alert>}
      {job.status === 'cancelled' && (
        <Alert severity="info">{t('Der Import wurde abgebrochen. Was schon da ist, bleibt im Ordner.')}</Alert>
      )}
      {job.status === 'done' && (
        <Alert severity={job.failed ? 'warning' : 'success'}>
          {job.failed
            ? tn(job.failed, 'Fertig, aber eine Datei ließ sich nicht holen.', 'Fertig, aber {count} Dateien ließen sich nicht holen.')
            : t('Fertig. Alles liegt jetzt in „{folder}“.', { folder: job.folder })}
        </Alert>
      )}
      {running && (
        <>
          <Typography variant="body2">
            {t('MoeCloud holt die Dateien von {host} nach „{folder}“.', { host: job.host, folder: job.folder })}
          </Typography>
          <LinearProgress
            variant={job.found ? 'determinate' : 'indeterminate'}
            value={job.found ? Math.min(100, ((job.files + job.failed) / job.found) * 100) : undefined}
            aria-label={t('Fortschritt des Imports')}
          />
        </>
      )}
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {summary}
      </Typography>
      {running && job.current && (
        <Typography variant="caption" noWrap sx={{ color: c.onSurfaceVariant }} title={job.current}>
          {job.current}
        </Typography>
      )}
      {job.problems.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 160, overflow: 'auto', color: c.onSurfaceVariant }}>
          {job.problems.map((problem) => (
            <Typography component="li" variant="caption" key={problem} sx={{ display: 'list-item', overflowWrap: 'anywhere' }}>
              {problem}
            </Typography>
          ))}
        </Box>
      )}
      {running && (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('Du kannst das Fenster schließen. Der Import läuft weiter, und am Ende bekommst du eine Benachrichtigung.')}
        </Typography>
      )}
    </Box>
  );
}

export function DavImportDialog({
  parentId,
  onClose,
  onOpenFolder,
  onChanged,
}: {
  parentId: string;
  onClose: () => void;
  onOpenFolder: (id: string) => void;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<DavJob | null>(null);
  const [form, setForm] = useState({ url: '', username: '', password: '', name: '' });
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const status = useRef<string | null>(null);
  const changed = useRef(onChanged);

  useEffect(() => {
    changed.current = onChanged;
  });

  useEffect(() => {
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const { items } = await api.get<{ items: DavJob[] }>('/api/imports/webdav');
        if (!active) return;
        const latest = items[0] ?? null;
        setJob(latest);
        if (status.current === 'running' && latest?.status !== 'running') changed.current();
        status.current = latest?.status ?? null;
        if (latest?.status === 'running') timer = window.setTimeout(() => void poll(), 1500);
      } catch {
        if (active) timer = window.setTimeout(() => void poll(), 4000);
      } finally {
        if (active) setReady(true);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [busy]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { job: started } = await api.post<{ job: DavJob }>(`/api/nodes/${parentId}/import/webdav`, {
        url: form.url.trim(),
        username: form.username,
        password: form.password,
        name: form.name.trim() || null,
      });
      status.current = 'running';
      setJob(started);
      setFresh(false);
      setForm({ ...form, password: '' });
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await api.delete(`/api/imports/webdav/${job.id}`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const showForm = ready && (!job || fresh);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value }),
    disabled: busy,
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (showForm) void start();
        }}
      >
        <DialogTitle>{t('Per WebDAV importieren')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {showForm ? (
            <>
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {t(
                  'Zieh mit deinen Dateien von Nextcloud, ownCloud oder einem anderen Speicher mit WebDAV um. MoeCloud legt hier einen neuen Ordner an und holt alles hinein, mit allen Unterordnern.'
                )}
              </Typography>
              <TextField
                label={t('WebDAV-Adresse')}
                placeholder="https://cloud.example.com/remote.php/dav/files/mia/"
                required
                autoFocus
                helperText={t('Bei Nextcloud steht sie unter Dateien › Einstellungen › WebDAV.')}
                slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'none', spellCheck: false } }}
                {...field('url')}
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  label={t('Benutzername')}
                  required
                  autoComplete="off"
                  slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
                  {...field('username')}
                />
                <TextField label={t('Passwort oder App-Passwort')} type="password" required autoComplete="off" {...field('password')} />
              </Box>
              <TextField label={t('Name des neuen Ordners (freiwillig)')} {...field('name')} />
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('Die Zugangsdaten nutzt MoeCloud nur für diesen Import und speichert sie nicht.')}
              </Typography>
            </>
          ) : job ? (
            <Progress job={job} />
          ) : (
            <LinearProgress aria-label={t('Lädt')} />
          )}
        </DialogContent>
        <DialogActions>
          {showForm ? (
            <>
              <Button onClick={job ? () => setFresh(false) : onClose} disabled={busy}>
                {job ? t('Zurück') : t('Abbrechen')}
              </Button>
              <Button type="submit" variant="contained" disabled={busy || !form.url.trim() || !form.username || !form.password}>
                {t('Import starten')}
              </Button>
            </>
          ) : job ? (
            <>
              {job.status === 'running' ? (
                <Button color="error" onClick={() => void cancel()} disabled={busy}>
                  {t('Import abbrechen')}
                </Button>
              ) : (
                <Button onClick={() => setFresh(true)}>{t('Neuer Import')}</Button>
              )}
              <Box sx={{ flex: 1 }} />
              <Button onClick={onClose}>{t('Schließen')}</Button>
              {(job.status === 'done' || job.files > 0) && (
                <Button
                  variant="contained"
                  onClick={() => {
                    onOpenFolder(job.folderId);
                    onClose();
                  }}
                >
                  {t('Zum Ordner')}
                </Button>
              )}
            </>
          ) : (
            <Button onClick={onClose}>{t('Schließen')}</Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
