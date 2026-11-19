import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteSweepRounded from '@mui/icons-material/DeleteSweepRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, fonts } from '../../theme/tokens';
import { copyText, Section } from '../common/bits';
import { toast } from '../common/toast';
import { StatusDot } from './shared';

type Level = 'info' | 'warn' | 'error';

interface Entry {
  id: number;
  at: number;
  level: Level;
  message: string;
  detail: string | null;
}

interface LogView {
  items: Entry[];
  since: number;
}

const levelLabel = (level: Level) => (level === 'error' ? t('Fehler') : level === 'warn' ? t('Warnung') : t('Hinweis'));

export function ServerLog() {
  const [level, setLevel] = useState<Level>('warn');
  const [view, setView] = useState<LogView | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<LogView>(`/api/admin/log?level=${level}`, abort.signal)
      .then(setView)
      .catch(() => {});
    return () => abort.abort();
  }, [level, revision]);

  const clear = async () => {
    try {
      await api.delete('/api/admin/log');
      setRevision((value) => value + 1);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const copy = () => {
    if (!view) return;
    const text = [...view.items]
      .reverse()
      .map(
        (entry) =>
          `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase()} ${entry.message}${entry.detail ? `\n${entry.detail}` : ''}`
      )
      .join('\n');
    void copyText(text, t('Protokoll kopiert'));
  };

  return (
    <Section
      title={t('Serverprotokoll')}
      description={t(
        'Die letzten Meldungen des Servers seit dem Start. Sie liegen nur im Arbeitsspeicher, das vollständige Protokoll schreibt MoeCloud wie bisher in die Ausgabe des Dienstes.'
      )}
      action={
        <Button variant="tonal" startIcon={<RefreshRounded />} onClick={() => setRevision((value) => value + 1)}>
          {t('Neu laden')}
        </Button>
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={level}
          aria-label={t('Meldungen filtern')}
          onChange={(_event, value: Level | null) => value && setLevel(value)}
        >
          <ToggleButton value="error">{t('Fehler')}</ToggleButton>
          <ToggleButton value="warn">{t('Warnungen und Fehler')}</ToggleButton>
          <ToggleButton value="info">{t('Alles')}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<ContentCopyRounded />} disabled={!view?.items.length} onClick={copy}>
          {t('Kopieren')}
        </Button>
        <Button size="small" startIcon={<DeleteSweepRounded />} disabled={!view?.items.length} onClick={() => void clear()}>
          {t('Leeren')}
        </Button>
      </Box>
      {!view ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Lädt …')}
        </Typography>
      ) : view.items.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {level === 'info'
            ? t('Seit dem Start am {date} gibt es keine Meldungen.', { date: formatDateTime(view.since) })
            : t('Seit dem Start am {date} gibt es keine Warnungen oder Fehler.', { date: formatDateTime(view.since) })}
        </Typography>
      ) : (
        <Box
          component="ol"
          aria-label={t('Serverprotokoll')}
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 480, overflowY: 'auto' }}
          tabIndex={0}
        >
          {view.items.map((entry) => (
            <Box component="li" key={entry.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
              <Box sx={{ pt: 0.75 }}>
                <StatusDot tone={entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'off'} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {entry.message || t('Ohne Text')}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} component="p">
                  {levelLabel(entry.level)} · {formatDateTime(entry.at)}
                </Typography>
                {entry.detail && (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 0.5,
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: c.surfaceContainer,
                      fontFamily: fonts.mono,
                      fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      maxHeight: 160,
                      overflowY: 'auto',
                    }}
                    tabIndex={0}
                  >
                    {entry.detail}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Section>
  );
}
