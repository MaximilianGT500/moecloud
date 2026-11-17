import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import type { Item } from '../kinds';
import { Fallback } from './Fallback';
import { CoverPreview } from './media';

interface Book {
  title: string | null;
  author: string | null;
  chapters: { title: string | null; path: string }[];
}

const remembered = (id: string) => {
  try {
    return Number(localStorage.getItem(`moe.epub.${id}`)) || 0;
  } catch {
    return 0;
  }
};

const remember = (id: string, chapter: number) => {
  try {
    localStorage.setItem(`moe.epub.${id}`, String(chapter));
  } catch {}
};

export default function EpubPreview({ item, base, inline, action }: { item: Item; base: string; inline?: boolean; action?: ReactNode }) {
  const [state, setState] = useState<{ id: string; book: Book | null; failed: boolean }>({ id: item.id, book: null, failed: false });
  const [chapter, setChapter] = useState(() => remembered(item.id));

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Book>(`${base}/nodes/${item.id}/epub`, abort.signal)
      .then((book) => setState({ id: item.id, book, failed: false }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ id: item.id, book: null, failed: true });
      });
    return () => abort.abort();
  }, [base, item.id, item.version]);

  const book = state.id === item.id ? state.book : null;
  if (state.id === item.id && state.failed) {
    if (item.rendition) return <CoverPreview item={item} base={base} inline={inline} action={action} />;
    return <Fallback item={item} text={t('Das E-Book lässt sich nicht anzeigen.')} action={action} />;
  }
  if (!book) return <CircularProgress aria-label={t('Lädt')} />;
  const index = Math.min(Math.max(0, chapter), book.chapters.length - 1);
  const go = (next: number) => {
    const target = Math.min(Math.max(0, next), book.chapters.length - 1);
    setChapter(target);
    remember(item.id, target);
  };
  const label = (entry: Book['chapters'][number], position: number) => entry.title ?? t('Abschnitt {count}', { count: position + 1 });
  const source = `${base}/nodes/${item.id}/epub/-/${book.chapters[index].path.split('/').map(encodeURIComponent).join('/')}`;

  return (
    <Box
      sx={{
        width: 'min(820px, 100%)',
        height: inline ? '75vh' : '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: 320,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={t('Vorheriger Abschnitt')}>
          <span>
            <IconButton aria-label={t('Vorheriger Abschnitt')} disabled={index === 0} onClick={() => go(index - 1)}>
              <ChevronLeftRounded />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          select
          size="small"
          label={book.title ?? t('Inhalt')}
          value={index}
          onChange={(event) => go(Number(event.target.value))}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {book.chapters.map((entry, position) => (
            <MenuItem key={entry.path} value={position}>
              {label(entry, position)}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title={t('Nächster Abschnitt')}>
          <span>
            <IconButton aria-label={t('Nächster Abschnitt')} disabled={index === book.chapters.length - 1} onClick={() => go(index + 1)}>
              <ChevronRightRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Box
        component="iframe"
        key={source}
        src={source}
        sandbox="allow-same-origin"
        title={`${book.title ?? item.name} · ${label(book.chapters[index], index)}`}
        sx={{ flex: 1, minHeight: 0, width: '100%', border: 0, borderRadius: `${radius.md}px`, bgcolor: '#ffffff' }}
      />
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant, textAlign: 'center' }}>
        {[book.author, t('Abschnitt {index} von {count}', { index: index + 1, count: book.chapters.length })].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  );
}
