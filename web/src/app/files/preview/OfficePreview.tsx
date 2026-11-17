import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import type { Item } from '../kinds';
import { Fallback } from './Fallback';
import { CoverPreview } from './media';

export default function OfficePreview({ item, base, inline, action }: { item: Item; base: string; inline?: boolean; action?: ReactNode }) {
  const key = item.id + item.version;
  const [state, setState] = useState<{ key: string; status: 'ready' | 'error' } | null>(null);
  const url = `${base}/nodes/${item.id}/office`;

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ ok: boolean }>(`${url}?prepare=1`, abort.signal)
      .then((result) => setState({ key, status: result.ok ? 'ready' : 'error' }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ key, status: 'error' });
      });
    return () => abort.abort();
  }, [url, key]);

  const status = state?.key === key ? state.status : 'loading';
  if (status === 'error') {
    if (item.rendition) return <CoverPreview item={item} base={base} inline={inline} action={action} />;
    return <Fallback item={item} text={t('Das Dokument lässt sich nicht anzeigen.')} action={action} />;
  }
  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: c.onSurfaceVariant }} role="status">
        <CircularProgress aria-label={t('Lädt')} />
        <Typography variant="body2">{t('MoeCloud bereitet die Vorschau vor, das dauert bei großen Dokumenten einen Moment.')}</Typography>
      </Box>
    );
  }
  return (
    <Box
      component="iframe"
      src={`${url}?v=${encodeURIComponent(String(item.version ?? ''))}`}
      title={item.name}
      sx={{
        width: 'min(1100px, 100%)',
        height: inline ? '75vh' : '100%',
        border: 0,
        borderRadius: `${radius.md}px`,
        bgcolor: c.surfaceContainerHigh,
      }}
    />
  );
}
