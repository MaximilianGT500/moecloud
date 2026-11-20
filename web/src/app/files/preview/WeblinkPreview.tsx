import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { copyText } from '../../common/bits';
import { contentUrl, type Item } from '../kinds';
import { Fallback } from './Fallback';
import { parseWeblink, type Weblink } from './weblink';

const LIMIT = 64 * 1024;

export function WeblinkPreview({ item, base }: { item: Item; base: string }) {
  const url = contentUrl(item, base);
  const [state, setState] = useState<{ url: string; link: Weblink | null } | null>(null);

  useEffect(() => {
    if (item.size > LIMIT) return;
    const controller = new AbortController();
    fetch(url, { credentials: 'same-origin', signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('status'))))
      .then((text) => setState({ url, link: parseWeblink(item.name, text) }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ url, link: null });
      });
    return () => controller.abort();
  }, [url, item.name, item.size]);

  if (item.size > LIMIT) return <Fallback item={item} text={t('In dieser Datei steht keine Adresse.')} />;
  if (!state || state.url !== url) return <CircularProgress aria-label={t('Lädt')} />;
  const link = state.link;
  if (!link) return <Fallback item={item} text={t('In dieser Datei steht keine Adresse.')} />;

  return (
    <Box
      data-weblink
      sx={{
        width: 'min(560px, 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        p: { xs: 3, sm: 4 },
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainer,
        textAlign: 'center',
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 64,
          height: 64,
          display: 'grid',
          placeItems: 'center',
          borderRadius: `${radius.full}px`,
          bgcolor: c.primaryContainer,
          color: c.onPrimaryContainer,
        }}
      >
        <LinkRounded fontSize="large" />
      </Box>
      <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Typography variant="h6" component="p" sx={{ overflowWrap: 'anywhere' }}>
          {link.host}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere', userSelect: 'all' }}>
          {link.url}
        </Typography>
      </Box>
      {link.safe ? (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('Der Link führt aus deiner Cloud hinaus. Öffne ihn nur, wenn du der Adresse traust.')}
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: c.error }}>
          {t('Diese Adresse öffnet MoeCloud nicht von selbst, weil sie keine gewöhnliche Webadresse ist.')}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        {link.safe && (
          <Button
            variant="contained"
            component="a"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            startIcon={<OpenInNewRounded />}
          >
            {t('Link öffnen')}
          </Button>
        )}
        <Button variant="tonal" startIcon={<ContentCopyRounded />} onClick={() => void copyText(link.url, t('Adresse kopiert'))}>
          {t('Adresse kopieren')}
        </Button>
      </Box>
    </Box>
  );
}
