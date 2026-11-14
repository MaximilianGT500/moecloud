import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import { api } from '../../../lib/api';
import { formatBytes, formatDate } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { triggerDownload } from '../actions';
import type { Item } from '../kinds';
import { Fallback } from './Fallback';

interface Person {
  name: string;
  address: string;
}

interface Summary {
  subject: string;
  from: Person[];
  to: Person[];
  cc: Person[];
  replyTo: Person[];
  date: number | null;
  html: boolean;
  remote: boolean;
  attachments: { index: number; name: string; type: string; size: number }[];
}

const person = (entry: Person) => (entry.name && entry.address ? `${entry.name} <${entry.address}>` : entry.name || entry.address);

function Line({ label, people }: { label: string; people: Person[] }) {
  if (!people.length) return null;
  return (
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
      <Box component="span" sx={{ color: c.onSurfaceVariant, mr: 1 }}>
        {label}
      </Box>
      {people.map(person).join(', ')}
    </Typography>
  );
}

export default function EmailPreview({ item, base, canDownload }: { item: Item; base: string; canDownload: boolean }) {
  const root = `${base}/nodes/${item.id}/email`;
  const key = `${root}@${item.version}`;
  const [state, setState] = useState<{ key: string; summary: Summary | null } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Summary>(root, abort.signal)
      .then((summary) => setState({ key, summary }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ key, summary: null });
      });
    return () => abort.abort();
  }, [root, key]);

  if (state?.key !== key) return <CircularProgress aria-label={t('Lädt')} />;
  const summary = state.summary;
  if (!summary) return <Fallback item={item} text={t('Die E-Mail lässt sich nicht anzeigen.')} />;
  const title = summary.subject || t('Ohne Betreff');

  return (
    <Box sx={{ width: 'min(1000px, 100%)', height: '100%', minHeight: 420, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box
        component="header"
        sx={{ bgcolor: c.surfaceContainerHigh, borderRadius: `${radius.md}px`, p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}
      >
        <Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        <Line label={t('Von')} people={summary.from} />
        <Line label={t('An')} people={summary.to} />
        <Line label={t('Kopie an')} people={summary.cc} />
        <Line label={t('Antwort an')} people={summary.replyTo} />
        {summary.date ? (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {formatDate(summary.date)}
          </Typography>
        ) : null}
        {summary.attachments.length > 0 && (
          <Box role="list" aria-label={t('Anhänge')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {summary.attachments.map((file) => (
              <Box role="listitem" key={file.index} sx={{ minWidth: 0, maxWidth: '100%' }}>
                <Chip
                  icon={<AttachFileRounded />}
                  label={`${file.name} · ${formatBytes(file.size)}`}
                  onClick={canDownload ? () => triggerDownload(`${root}/attachments/${file.index}`) : undefined}
                  sx={{ maxWidth: '100%' }}
                />
              </Box>
            ))}
          </Box>
        )}
        {summary.remote && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, mt: 0.5 }}>
            {t('Bilder aus dem Internet lädt MoeCloud nicht, so erfährt niemand, dass du die E-Mail geöffnet hast.')}
          </Typography>
        )}
      </Box>
      <Box
        component="iframe"
        src={`${root}/body`}
        title={title}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        sx={{ flex: 1, minHeight: 320, width: '100%', border: 0, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainerLowest }}
      />
    </Box>
  );
}
