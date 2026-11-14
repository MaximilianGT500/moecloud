import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import InputBase from '@mui/material/InputBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BookmarkRounded from '@mui/icons-material/BookmarkRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { navigate } from '../../lib/router';
import { t } from '../../lib/i18n';
import { c, curve, elevation, radius } from '../../theme/tokens';
import { searchHref, useSavedSearches } from './searches';

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
  const [focused, setFocused] = useState(false);
  const [used, setUsed] = useState(false);
  const saved = useSavedSearches(used);
  const input = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLFormElement | null>(null);
  const open = focused && !text && saved.length > 0;
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
      onFocus={(event) => {
        setAnchor(event.currentTarget as HTMLFormElement);
        setFocused(true);
        setUsed(true);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || (!event.currentTarget.contains(next) && !document.getElementById('saved-searches')?.contains(next))) setFocused(false);
      }}
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
      <Popper open={open} anchorEl={anchor} placement="bottom-start" sx={{ zIndex: 1300, width: anchor?.offsetWidth }}>
        <Paper
          id="saved-searches"
          sx={{ mt: 1, py: 1, borderRadius: `${radius.lg}px`, bgcolor: c.surfaceContainer, boxShadow: elevation[2] }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || (!event.currentTarget.contains(next) && !anchor?.contains(next))) setFocused(false);
          }}
        >
          <Typography variant="caption" component="p" sx={{ px: 2, pb: 0.5, color: c.onSurfaceVariant }}>
            {t('Gespeicherte Suchen')}
          </Typography>
          <MenuList aria-label={t('Gespeicherte Suchen')} sx={{ py: 0 }}>
            {saved.map((entry) => (
              <MenuItem
                key={entry.id}
                onClick={() => {
                  setFocused(false);
                  input.current?.blur();
                  navigate(searchHref(entry), { replace: active });
                }}
              >
                <ListItemIcon>
                  <BookmarkRounded fontSize="small" />
                </ListItemIcon>
                <ListItemText>{entry.name}</ListItemText>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </Popper>
    </Box>
  );
}
