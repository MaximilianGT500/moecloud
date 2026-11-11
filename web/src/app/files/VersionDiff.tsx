import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import UnfoldMoreRounded from '@mui/icons-material/UnfoldMoreRounded';
import { errorText } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, fonts, mix } from '../../theme/tokens';
import { contentUrl, previewType, type Item } from './kinds';

export interface DiffVersion {
  id: string;
  size: number;
  modifiedAt: number;
  author: string | null;
}

interface Row {
  kind: 'same' | 'added' | 'removed';
  left: number | null;
  right: number | null;
  text: string;
}

type Shown = { type: 'row'; row: Row } | { type: 'gap'; start: number; count: number };

const CONTEXT = 3;
const LIMIT = 2 * 1024 * 1024;
const COMPARABLE = new Set(['markdown', 'code', 'text', 'csv', 'json']);

export const canCompare = (item: Item, version: DiffVersion) =>
  COMPARABLE.has(previewType(item)) && item.size <= LIMIT && version.size <= LIMIT;

async function text(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(t('Die Datei lässt sich nicht laden'));
  const value = await response.text();
  if (value.includes('\u0000')) throw new Error(t('Das lässt sich nicht als Text vergleichen'));
  return value.replace(/\r\n?/g, '\n');
}

const lines = (value: string) => {
  const list = value.split('\n');
  if (list.at(-1) === '') list.pop();
  return list;
};

function rowsOf(changes: { value: string; added: boolean; removed: boolean }[]) {
  const rows: Row[] = [];
  let left = 0;
  let right = 0;
  for (const change of changes) {
    for (const line of lines(change.value)) {
      if (change.added) rows.push({ kind: 'added', left: null, right: ++right, text: line });
      else if (change.removed) rows.push({ kind: 'removed', left: ++left, right: null, text: line });
      else rows.push({ kind: 'same', left: ++left, right: ++right, text: line });
    }
  }
  return rows;
}

function visible(rows: Row[], open: Set<number>, all: boolean): Shown[] {
  if (all) return rows.map((row) => ({ type: 'row', row }));
  const near = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.kind === 'same') return;
    for (let offset = Math.max(0, index - CONTEXT); offset <= Math.min(rows.length - 1, index + CONTEXT); offset++) near[offset] = true;
  });
  const shown: Shown[] = [];
  for (let index = 0; index < rows.length;) {
    if (near[index]) {
      shown.push({ type: 'row', row: rows[index++] });
      continue;
    }
    let end = index;
    while (end < rows.length && !near[end]) end++;
    if (open.has(index) || end - index <= 2) rows.slice(index, end).forEach((row) => shown.push({ type: 'row', row }));
    else shown.push({ type: 'gap', start: index, count: end - index });
    index = end;
  }
  return shown;
}

export function VersionDiff({ item, version, onClose }: { item: Item; version: DiffVersion; onClose: () => void }) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const [state, setState] = useState<{ rows: Row[] } | { error: string } | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      text(`/api/nodes/${item.id}/versions/${version.id}/content`, abort.signal),
      text(contentUrl(item), abort.signal),
      import('diff'),
    ])
      .then(([before, after, { diffLines }]) => {
        const changes = diffLines(before, after, { timeout: 4000 });
        setState(changes ? { rows: rowsOf(changes) } : { error: t('Zu viele Unterschiede zum Anzeigen') });
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ error: errorText(error) });
      });
    return () => abort.abort();
  }, [item, version.id]);

  const rows = state && 'rows' in state ? state.rows : [];
  const added = rows.filter((row) => row.kind === 'added').length;
  const removed = rows.filter((row) => row.kind === 'removed').length;
  const shown = visible(rows, open, all);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={small}
      aria-labelledby="diff-title"
      slotProps={{ paper: { sx: { p: 0, overflow: 'hidden' } } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: small ? '100%' : '85vh', minHeight: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
            px: 2,
            py: 1.5,
            borderBottom: `1px solid ${c.outlineVariant}`,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography id="diff-title" variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {t('Änderungen an „{name}“', { name: item.name })}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Fassung vom {date} verglichen mit der aktuellen', { date: formatDateTime(version.modifiedAt) })}
            </Typography>
          </Box>
          {state && 'rows' in state && (
            <Typography
              variant="body2"
              sx={{ fontFamily: fonts.mono }}
              aria-label={t('{added} Zeilen dazu, {removed} Zeilen weg', { added, removed })}
            >
              <Box component="span" sx={{ color: c.success }}>
                +{added}
              </Box>{' '}
              <Box component="span" sx={{ color: c.error }}>
                −{removed}
              </Box>
            </Typography>
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={all ? 'all' : 'changes'}
            onChange={(_event, value) => value && setAll(value === 'all')}
          >
            <ToggleButton value="changes">{t('Nur Änderungen')}</ToggleButton>
            <ToggleButton value="all">{t('Alles')}</ToggleButton>
          </ToggleButtonGroup>
          <IconButton aria-label={t('Schließen')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: c.surfaceContainerLow }}>
          {!state ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
              <CircularProgress aria-label={t('Lädt')} />
            </Box>
          ) : 'error' in state ? (
            <Typography sx={{ p: 3, color: c.error }}>{state.error}</Typography>
          ) : added + removed === 0 ? (
            <Typography sx={{ p: 3, color: c.onSurfaceVariant }}>{t('Beide Fassungen sind gleich.')}</Typography>
          ) : (
            <Box
              role="table"
              aria-label={t('Unterschiede')}
              sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem', lineHeight: 1.6, minWidth: 'fit-content', py: 1 }}
            >
              {shown.map((entry) =>
                entry.type === 'gap' ? (
                  <ButtonBase
                    key={`gap-${entry.start}`}
                    onClick={() => setOpen(new Set([...open, entry.start]))}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      width: '100%',
                      justifyContent: 'flex-start',
                      px: 2,
                      py: 0.5,
                      my: 0.5,
                      color: c.primary,
                      bgcolor: mix(c.primary, 8),
                      fontFamily: fonts.sans,
                      fontSize: '0.8125rem',
                    }}
                  >
                    <UnfoldMoreRounded fontSize="small" />
                    {tn(entry.count, '{count} gleiche Zeile zeigen', '{count} gleiche Zeilen zeigen')}
                  </ButtonBase>
                ) : (
                  <Box
                    role="row"
                    key={`${entry.row.left ?? '-'}:${entry.row.right ?? '-'}`}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '48px 48px 20px minmax(0, 1fr)',
                      bgcolor:
                        entry.row.kind === 'added' ? mix(c.success, 14) : entry.row.kind === 'removed' ? mix(c.error, 14) : 'transparent',
                    }}
                  >
                    <Box role="cell" sx={{ color: c.onSurfaceVariant, textAlign: 'right', pr: 1, userSelect: 'none', opacity: 0.8 }}>
                      {entry.row.left ?? ''}
                    </Box>
                    <Box role="cell" sx={{ color: c.onSurfaceVariant, textAlign: 'right', pr: 1, userSelect: 'none', opacity: 0.8 }}>
                      {entry.row.right ?? ''}
                    </Box>
                    <Box
                      role="cell"
                      aria-label={entry.row.kind === 'added' ? t('Neu') : entry.row.kind === 'removed' ? t('Entfernt') : undefined}
                      sx={{
                        textAlign: 'center',
                        userSelect: 'none',
                        color: entry.row.kind === 'added' ? c.success : entry.row.kind === 'removed' ? c.error : 'transparent',
                      }}
                    >
                      {entry.row.kind === 'added' ? '+' : entry.row.kind === 'removed' ? '−' : ''}
                    </Box>
                    <Box role="cell" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', pr: 2, color: c.onSurface }}>
                      {entry.row.text || ' '}
                    </Box>
                  </Box>
                )
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
