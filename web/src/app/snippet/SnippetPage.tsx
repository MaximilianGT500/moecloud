import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import LocalFireDepartmentRounded from '@mui/icons-material/LocalFireDepartmentRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatBytes, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { BrandMark, copyText, EmptyState, SkipLink } from '../common/bits';
import { ThemeToggleButton } from '../common/ThemeToggle';
import { CodeView } from '../snippets/CodeView';
import { languageName } from '../snippets/model';

interface PublicSnippet {
  title: string;
  language: string;
  size: number;
  lines: number;
  protected: boolean;
  burn: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  by: string;
  content?: string;
}

const EXTENSIONS: Record<string, string> = {
  markdown: 'md',
  javascript: 'js',
  typescript: 'ts',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  python: 'py',
  bash: 'sh',
  powershell: 'ps1',
  sql: 'sql',
  yaml: 'yaml',
  ini: 'ini',
  go: 'go',
  rust: 'rs',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  php: 'php',
  ruby: 'rb',
  lua: 'lua',
  diff: 'diff',
  xml: 'xml',
};

export function SnippetPage() {
  const data = boot() as ReturnType<typeof boot> & { token: string; user: { name: string } | null };
  const [snippet, setSnippet] = useState<PublicSnippet | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burned, setBurned] = useState(false);
  const [wrap, setWrap] = useState(false);

  useEffect(() => {
    api
      .get<{ snippet: PublicSnippet }>(`/api/public/snippets/${data.token}`)
      .then((result) => {
        setSnippet(result.snippet);
        if (result.snippet.content !== undefined) setContent(result.snippet.content);
      })
      .catch(() => setMissing(true));
  }, [data.token]);

  useEffect(() => {
    if (snippet) document.title = `${snippet.title || t('Schnipsel')} » ${data.site.name}`;
  }, [snippet, data.site.name]);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ content: string; burned: boolean }>(`/api/public/snippets/${data.token}/view`, {
        password: password || undefined,
      });
      setContent(result.content);
      setBurned(result.burned);
    } catch (problem) {
      setError(errorText(problem));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (content === null || !snippet) return;
    const extension = EXTENSIONS[snippet.language] ?? 'txt';
    const name = `${(snippet.title || 'schnipsel').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'schnipsel'}.${extension}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  let body;
  if (missing) {
    body = (
      <EmptyState
        icon={<SearchOffRounded />}
        title={t('Schnipsel nicht gefunden')}
        text={t('Den Schnipsel gibt es nicht oder nicht mehr. Vielleicht ist der Link abgelaufen oder wurde schon gelesen.')}
      />
    );
  } else if (!snippet) {
    body = <LinearProgress />;
  } else {
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: `${radius.md}px`,
              display: 'grid',
              placeItems: 'center',
              bgcolor: c.primaryContainer,
              color: c.onPrimaryContainer,
              flex: 'none',
            }}
          >
            <NotesRounded />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
              {snippet.title || t('Schnipsel')}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {[
                t('Von {name}', { name: snippet.by }),
                languageName(snippet.language),
                tn(snippet.lines, 'eine Zeile', '{count} Zeilen'),
                formatBytes(snippet.size),
                formatDateTime(snippet.updatedAt),
              ].join(' · ')}
            </Typography>
            {snippet.expiresAt && (
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('Läuft ab {date}', { date: formatDateTime(snippet.expiresAt) })}
              </Typography>
            )}
          </Box>
          {content !== null && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<ContentCopyRounded />} onClick={() => void copyText(content)} data-snippet-copy>
                {t('Kopieren')}
              </Button>
              <Button variant="tonal" startIcon={<DownloadRounded />} onClick={download}>
                {t('Herunterladen')}
              </Button>
              {!snippet.protected && !snippet.burn && (
                <Button href={`/t/${data.token}/raw`} target="_blank" rel="noopener">
                  {t('Rohtext')}
                </Button>
              )}
            </Box>
          )}
        </Box>
        {burned && (
          <Alert severity="warning" icon={<LocalFireDepartmentRounded />}>
            {t('Dieser Schnipsel wurde jetzt gelöscht. Kopier dir den Inhalt, bevor du die Seite schließt.')}
          </Alert>
        )}
        {content === null ? (
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              void reveal();
            }}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxWidth: 420,
              mx: 'auto',
              py: 4,
              textAlign: 'center',
              alignItems: 'center',
            }}
          >
            <Box
              sx={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: snippet.burn ? c.errorContainer : c.secondaryContainer,
                color: snippet.burn ? c.onErrorContainer : c.onSecondaryContainer,
              }}
            >
              {snippet.burn ? <LocalFireDepartmentRounded fontSize="large" /> : <LockRounded fontSize="large" />}
            </Box>
            <Typography variant="body1">
              {snippet.burn
                ? t('Dieser Schnipsel lässt sich nur einmal öffnen. Danach ist er gelöscht.')
                : t('Dieser Schnipsel ist mit einem Passwort geschützt.')}
            </Typography>
            {snippet.protected && (
              <TextField
                type="password"
                label={t('Passwort')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                fullWidth
                autoComplete="off"
                slotProps={{ htmlInput: { 'data-snippet-password': '' } }}
              />
            )}
            {error && (
              <Alert severity="error" sx={{ width: '100%' }}>
                {error}
              </Alert>
            )}
            <Button type="submit" variant="contained" disabled={busy || (snippet.protected && !password)} data-snippet-reveal>
              {snippet.burn ? t('Jetzt öffnen') : t('Entsperren')}
            </Button>
          </Box>
        ) : (
          <>
            <FormControlLabel
              control={<Switch size="small" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />}
              label={<Typography variant="body2">{t('Zeilen umbrechen')}</Typography>}
              sx={{ alignSelf: 'flex-end' }}
            />
            <CodeView code={content} language={snippet.language} wrap={wrap} />
          </>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: c.surface }}>
      <SkipLink />
      <Box
        component="header"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 3 }, py: 2, maxWidth: 1100, mx: 'auto' }}
      >
        <BrandMark size={36} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>
          {data.site.name}
        </Typography>
        {data.user && (
          <Button href="/snippets" variant="tonal" size="small">
            {t('Zu meinen Schnipseln')}
          </Button>
        )}
        <ThemeToggleButton placement="bottom" />
      </Box>
      <Box component="main" id="inhalt" sx={{ maxWidth: 1100, mx: 'auto', px: { xs: 1.5, sm: 3 }, pb: 8 }}>
        <Box sx={{ bgcolor: c.surfaceContainerLow, borderRadius: `${radius.xl}px`, p: { xs: 2, sm: 3 } }}>{body}</Box>
      </Box>
    </Box>
  );
}
