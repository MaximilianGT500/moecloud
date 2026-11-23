import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';

type Action = 'trash' | 'restore' | 'rename' | 'content' | 'missing';

interface Preview {
  folder: { id: string; name: string; root: boolean };
  at: number;
  counts: Record<Action, number> & { deleted: number };
  total: number;
  items: { id: string; name: string; path: string; action: Action; from?: string }[];
  more: number;
}

const HOUR = 3_600_000;

const minute = (time: number) => Math.floor(time / 60_000) * 60_000;

const localValue = (time: number) => {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function quickTimes() {
  const now = Date.now();
  const morning = new Date();
  morning.setHours(6, 0, 0, 0);
  if (morning.getTime() > now) morning.setDate(morning.getDate() - 1);
  return [
    { label: t('Vor einer Stunde'), at: minute(now - HOUR) },
    { label: t('Heute früh'), at: morning.getTime() },
    { label: t('Gestern um diese Zeit'), at: minute(now - 24 * HOUR) },
    { label: t('Vor einer Woche'), at: minute(now - 7 * 24 * HOUR) },
  ];
}

const ICONS: Record<Action, ReactNode> = {
  restore: <RestoreFromTrashRounded fontSize="small" />,
  content: <HistoryRounded fontSize="small" />,
  rename: <DriveFileRenameOutlineRounded fontSize="small" />,
  trash: <DeleteOutlineRounded fontSize="small" />,
  missing: <HelpOutlineRounded fontSize="small" />,
};

function summary(preview: Preview) {
  const { counts } = preview;
  return [
    counts.restore > 0 && tn(counts.restore, 'Eins kommt aus dem Papierkorb zurück', '{count} kommen aus dem Papierkorb zurück'),
    counts.content > 0 &&
      tn(counts.content, 'Eine Datei bekommt ihren Inhalt von damals zurück', '{count} Dateien bekommen ihren Inhalt von damals zurück'),
    counts.rename > 0 && tn(counts.rename, 'Eins bekommt seinen alten Namen zurück', '{count} bekommen ihren alten Namen zurück'),
    counts.trash > 0 &&
      tn(counts.trash, 'Eins kam danach dazu und wandert in den Papierkorb', '{count} kamen danach dazu und wandern in den Papierkorb'),
  ].filter(Boolean) as string[];
}

function detail(item: Preview['items'][number]) {
  switch (item.action) {
    case 'restore':
      return t('aus dem Papierkorb');
    case 'content':
      return t('Inhalt von damals');
    case 'rename':
      return t('hieß „{name}“', { name: item.from ?? '' });
    case 'trash':
      return t('in den Papierkorb');
    case 'missing':
      return t('keine Version von damals');
  }
}

export function RewindDialog({
  folder,
  initial,
  onClose,
  onDone,
}: {
  folder: { id: string; name: string; root: boolean };
  initial?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [at, setAt] = useState(() => initial ?? minute(Date.now() - HOUR));
  const [input, setInput] = useState(() => localValue(at));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api
        .get<Preview>(`/api/nodes/${folder.id}/rewind?at=${at}`, abort.signal)
        .then((data) => {
          setPreview(data);
          setLoading(false);
        })
        .catch((failure) => {
          if (abort.signal.aborted) return;
          setPreview(null);
          setError(errorText(failure));
          setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [folder.id, at]);

  const pick = (time: number) => {
    setAt(time);
    setInput(localValue(time));
  };

  const apply = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ done: Record<string, number>; skipped: number }>(`/api/nodes/${folder.id}/rewind`, { at });
      const count = Object.values(result.done).reduce((sum, value) => sum + value, 0);
      toast(
        result.skipped
          ? t('Zurückgesetzt: {count} Änderungen, {skipped} übersprungen', { count, skipped: result.skipped })
          : tn(count, 'Zurückgesetzt: eine Änderung', 'Zurückgesetzt: {count} Änderungen')
      );
      onDone();
      onClose();
    } catch (failure) {
      toast(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const name = folder.root ? t('Meine Dateien') : folder.name;
  const lines = preview ? summary(preview) : [];

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="zuruecksetzen-titel">
      <DialogTitle id="zuruecksetzen-titel">{t('„{name}“ auf einen früheren Stand zurücksetzen', { name })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t(
            'Hilft, wenn etwas viele Dateien verändert, umbenannt oder gelöscht hat, etwa ein Erpressungstrojaner auf einem Gerät mit WebDAV. Nichts geht dabei verloren: Was jetzt da ist, bleibt als Version oder im Papierkorb.'
          )}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {quickTimes().map((entry) => (
            <Chip
              key={entry.label}
              label={entry.label}
              onClick={() => pick(entry.at)}
              color={entry.at === at ? 'primary' : 'default'}
              variant={entry.at === at ? 'filled' : 'outlined'}
            />
          ))}
        </Box>
        <TextField
          type="datetime-local"
          label={t('Stand vom')}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            const time = new Date(event.target.value).getTime();
            if (Number.isFinite(time)) setAt(minute(time));
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ maxWidth: 280 }}
        />
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: c.onSurfaceVariant }}>
            <CircularProgress size={20} />
            <Typography variant="body2">{t('Sucht, was sich seitdem geändert hat …')}</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : preview ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-rewind-total={preview.total}>
            {preview.total === 0 ? (
              <Alert severity="success">
                {t('Seit {time} hat sich hier nichts geändert, was sich zurückholen ließe.', { time: formatDateTime(at) })}
              </Alert>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {lines.map((line) => (
                  <Typography component="li" variant="body2" key={line}>
                    {line}
                  </Typography>
                ))}
              </Box>
            )}
            {(preview.counts.missing > 0 || preview.counts.deleted > 0) && (
              <Alert severity="warning">
                {[
                  preview.counts.missing > 0 &&
                    tn(
                      preview.counts.missing,
                      'Bei einer Datei gibt es keine Version von damals mehr.',
                      'Bei {count} Dateien gibt es keine Version von damals mehr.'
                    ),
                  preview.counts.deleted > 0 &&
                    tn(
                      preview.counts.deleted,
                      'Eins wurde endgültig gelöscht und lässt sich nicht zurückholen.',
                      '{count} wurden endgültig gelöscht und lassen sich nicht zurückholen.'
                    ),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Alert>
            )}
            {preview.items.length > 0 && (
              <Box
                component="ul"
                sx={{
                  m: 0,
                  p: 0,
                  listStyle: 'none',
                  maxHeight: 260,
                  overflow: 'auto',
                  borderRadius: `${radius.md}px`,
                  bgcolor: c.surfaceContainer,
                }}
              >
                {preview.items.map((item) => (
                  <Box
                    component="li"
                    key={`${item.id}-${item.action}`}
                    data-rewind={item.action}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.25,
                      px: 1.5,
                      py: 0.75,
                      borderTop: `1px solid ${c.outlineVariant}`,
                      '&:first-of-type': { borderTop: 0 },
                    }}
                  >
                    <Box sx={{ color: item.action === 'missing' ? c.error : c.onSurfaceVariant, display: 'flex' }}>
                      {ICONS[item.action]}
                    </Box>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {item.path}
                    </Typography>
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant, flex: 'none', maxWidth: '40%', textAlign: 'right' }}>
                      {detail(item)}
                    </Typography>
                  </Box>
                ))}
                {preview.more > 0 && (
                  <Typography component="li" variant="caption" sx={{ display: 'block', px: 1.5, py: 1, color: c.onSurfaceVariant }}>
                    {tn(preview.more, 'und eins mehr', 'und {count} mehr')}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
        <Button variant="contained" onClick={() => void apply()} disabled={busy || loading || !preview || preview.total === 0}>
          {t('Zurücksetzen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
