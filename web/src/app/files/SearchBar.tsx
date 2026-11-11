import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Tooltip from '@mui/material/Tooltip';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { navigate } from '../../lib/router';
import { t } from '../../lib/i18n';
import { c, curve, radius } from '../../theme/tokens';

const FILTER_KEYS = ['type', 'date', 'size', 'tag'];

const filtered = () => {
  const params = new URLSearchParams(location.search);
  return location.pathname.startsWith('/files/search') && FILTER_KEYS.some((key) => params.get(key));
};

function target(value: string) {
  const params = new URLSearchParams(location.pathname.startsWith('/files/search') ? location.search : '');
  if (value) params.set('q', value);
  else params.delete('q');
  const query = params.toString();
  return `/files/search${query ? `?${query}` : ''}`;
}

export function SearchBar({ initial, active }: { initial: string; active: boolean }) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const value = text.trim();
      const filters = filtered();
      if (value || (active && filters)) navigate(target(value), { replace: active });
      else if (active) navigate('/files', { replace: true });
    }, 280);
    return () => clearTimeout(timer);
  }, [text, active]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Box
      component="form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) navigate(target(text.trim()), { replace: active });
      }}
      sx={{
        flex: 1,
        maxWidth: 720,
        minWidth: 0,
        height: { xs: 48, md: 56 },
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 2,
        pr: 0.5,
        borderRadius: `${radius.full}px`,
        bgcolor: c.surfaceContainerHigh,
        transition: `background-color 200ms ${curve.standard}, box-shadow 200ms ${curve.standard}`,
        '&:focus-within': { bgcolor: c.surfaceContainerHighest, boxShadow: `inset 0 0 0 2px ${c.primary}` },
      }}
    >
      <SearchRounded sx={{ color: c.onSurfaceVariant }} aria-hidden />
      <InputBase
        inputRef={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setText('');
            input.current?.blur();
          }
        }}
        placeholder={t('In deinen Dateien suchen')}
        inputProps={{ 'aria-label': t('In deinen Dateien suchen'), enterKeyHint: 'search' }}
        sx={{ flex: 1, minWidth: 0, fontSize: '1rem' }}
      />
      {text && (
        <Tooltip title={t('Suche leeren')}>
          <IconButton aria-label={t('Suche leeren')} onClick={() => setText('')}>
            <CloseRounded />
          </IconButton>
        </Tooltip>
      )}
      {!active && (
        <Tooltip title={t('Suchen mit Filtern')}>
          <IconButton aria-label={t('Suchen mit Filtern')} onClick={() => navigate(target(text.trim()))}>
            <TuneRounded />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
