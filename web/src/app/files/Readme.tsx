import { useEffect, useLayoutEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ArticleRounded from '@mui/icons-material/ArticleRounded';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { contentUrl, type Item } from './kinds';
import { markdownBody } from './preview/styles';

const NAMES = [/^readme\.(md|markdown)$/i, /^liesmich\.(md|markdown)$/i];
const LIMIT = 256 * 1024;
const FOLDED = 168;

export const readmeOf = (items: Item[]) => {
  const files = items.filter((item) => item.type === 'file' && !item.infected && item.size > 0 && item.size <= LIMIT);
  for (const pattern of NAMES) {
    const found = files.find((item) => pattern.test(item.name));
    if (found) return found;
  }
  return null;
};

export function FolderReadme({
  item,
  base = '/api',
  sx,
  onOpen,
}: {
  item: Item;
  base?: string;
  sx?: Record<string, unknown>;
  onOpen: () => void;
}) {
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [tall, setTall] = useState(false);
  const key = item.id + item.version;

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      fetch(contentUrl(item, base), { credentials: 'same-origin', signal: abort.signal }).then((response) =>
        response.ok ? response.text() : ''
      ),
      import('./preview/markdown'),
    ])
      .then(([text, { renderMarkdown }]) => setHtml({ key, value: text.trim() ? renderMarkdown(text) : '' }))
      .catch(() => {});
    return () => abort.abort();
  }, [item, key, base]);

  const current = html?.key === key ? html.value : null;

  useLayoutEffect(() => {
    if (!body) return;
    const measure = () => setTall(body.scrollHeight > FOLDED + 48);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [body, current]);

  if (!current) return null;
  const folded = tall && !expanded;
  return (
    <Box
      component="section"
      aria-label={t('Beschreibung des Ordners')}
      sx={{ mx: { xs: 1.5, md: 2 }, mb: 2, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer, overflow: 'hidden', ...sx }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.25 }}>
        <ArticleRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} />
        <ButtonBase onClick={onOpen} sx={{ borderRadius: `${radius.xs}px`, px: 0.5 }}>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, fontWeight: 600 }}>
            {item.name}
          </Typography>
        </ButtonBase>
      </Box>
      <Box sx={{ position: 'relative' }}>
        <Box
          ref={setBody}
          className="markdown"
          sx={{
            ...markdownBody,
            px: 2.5,
            py: 1.5,
            fontSize: '0.9375rem',
            overflow: 'hidden',
            maxHeight: folded ? FOLDED : 'none',
            '& h1': { fontSize: '1.5rem' },
            '& h2': { fontSize: '1.25rem', pb: 0.5, borderBottom: `1px solid ${c.outlineVariant}` },
          }}
          dangerouslySetInnerHTML={{ __html: current }}
        />
        {folded && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 64,
              background: `linear-gradient(to bottom, transparent, ${c.surfaceContainer})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
      {tall && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <Button
            size="small"
            startIcon={expanded ? <ExpandLessRounded /> : <ExpandMoreRounded />}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? t('Weniger anzeigen') : t('Mehr anzeigen')}
          </Button>
        </Box>
      )}
    </Box>
  );
}
