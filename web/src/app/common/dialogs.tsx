import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import CheckRounded from '@mui/icons-material/CheckRounded';
import FormatColorResetRounded from '@mui/icons-material/FormatColorResetRounded';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';

interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  text?: ReactNode;
  confirm: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

interface PromptRequest {
  kind: 'prompt';
  title: string;
  label: string;
  value: string;
  confirm: string;
  helper?: string;
  select?: [number, number];
  resolve: (value: string | null) => void;
}

interface ChooseRequest {
  kind: 'choose';
  title: string;
  text?: ReactNode;
  options: { value: string; label: string; primary?: boolean }[];
  resolve: (value: string | null) => void;
}

interface ColorRequest {
  kind: 'color';
  title: string;
  value: string | null;
  options: { key: string; label: string; color: string }[];
  resolve: (value: string | null | undefined) => void;
}

type DialogRequest = ConfirmRequest | PromptRequest | ChooseRequest | ColorRequest;

let current: DialogRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function confirm(options: Omit<ConfirmRequest, 'kind' | 'resolve'>) {
  return new Promise<boolean>((resolve) => {
    current = { kind: 'confirm', ...options, resolve };
    emit();
  });
}

export function prompt(options: Omit<PromptRequest, 'kind' | 'resolve'>) {
  return new Promise<string | null>((resolve) => {
    current = { kind: 'prompt', ...options, resolve };
    emit();
  });
}

export function choose(options: Omit<ChooseRequest, 'kind' | 'resolve'>) {
  return new Promise<string | null>((resolve) => {
    current = { kind: 'choose', ...options, resolve };
    emit();
  });
}

export function pickColor(options: Omit<ColorRequest, 'kind' | 'resolve'>) {
  return new Promise<string | null | undefined>((resolve) => {
    current = { kind: 'color', ...options, resolve };
    emit();
  });
}

function close() {
  current = null;
  emit();
}

function PromptBody({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const element = input.current;
      if (!element) return;
      element.focus();
      if (request.select) element.setSelectionRange(request.select[0], request.select[1]);
      else element.select();
    }, 60);
    return () => clearTimeout(timer);
  }, [request]);
  const submit = () => {
    if (!value.trim()) return;
    request.resolve(value.trim());
    close();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogTitle>{request.title}</DialogTitle>
      <DialogContent>
        <TextField
          inputRef={input}
          label={request.label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          fullWidth
          margin="dense"
          helperText={request.helper}
          slotProps={{ htmlInput: { maxLength: 255, spellCheck: false, autoCapitalize: 'none' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            request.resolve(null);
            close();
          }}
        >
          {t('Abbrechen')}
        </Button>
        <Button type="submit" variant="contained" disabled={!value.trim()}>
          {request.confirm}
        </Button>
      </DialogActions>
    </form>
  );
}

export function DialogHost() {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
  const cancel = () => {
    if (!request) return;
    if (request.kind === 'confirm') request.resolve(false);
    else if (request.kind === 'color') request.resolve(undefined);
    else request.resolve(null);
    close();
  };
  return (
    <Dialog open={Boolean(request)} onClose={cancel} fullWidth maxWidth="xs">
      {request?.kind === 'confirm' && (
        <>
          <DialogTitle>{request.title}</DialogTitle>
          {request.text && (
            <DialogContent>
              <DialogContentText component="div">{request.text}</DialogContentText>
            </DialogContent>
          )}
          <DialogActions>
            <Button onClick={cancel}>{t('Abbrechen')}</Button>
            <Button
              variant="contained"
              autoFocus
              sx={request.danger ? { bgcolor: c.error, color: c.onError, '&:hover': { bgcolor: c.error } } : undefined}
              onClick={() => {
                request.resolve(true);
                close();
              }}
            >
              {request.confirm}
            </Button>
          </DialogActions>
        </>
      )}
      {request?.kind === 'prompt' && <PromptBody key={request.title + request.value} request={request} />}
      {request?.kind === 'color' && (
        <>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogContent>
            <Box
              role="radiogroup"
              aria-label={t('Farbe')}
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 1.5, pt: 0.5 }}
            >
              {[{ key: '', label: t('Keine Farbe'), color: '' }, ...request.options].map((option) => {
                const active = (request.value ?? '') === option.key;
                return (
                  <Tooltip key={option.key || 'none'} title={option.label}>
                    <ButtonBase
                      role="radio"
                      aria-checked={active}
                      aria-label={option.label}
                      onClick={() => {
                        request.resolve(option.key || null);
                        close();
                      }}
                      sx={{
                        aspectRatio: '1',
                        borderRadius: `${radius.full}px`,
                        bgcolor: option.color || c.surfaceContainerHighest,
                        color: option.color ? c.surface : c.onSurfaceVariant,
                        boxShadow: active ? `0 0 0 3px ${c.surface}, 0 0 0 5px ${c.onSurface}` : 'none',
                        '&.Mui-focusVisible': { boxShadow: `0 0 0 3px ${c.surface}, 0 0 0 5px ${c.primary}` },
                      }}
                    >
                      {active ? <CheckRounded /> : option.color ? null : <FormatColorResetRounded />}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={cancel}>{t('Abbrechen')}</Button>
          </DialogActions>
        </>
      )}
      {request?.kind === 'choose' && (
        <>
          <DialogTitle>{request.title}</DialogTitle>
          {request.text && (
            <DialogContent>
              <DialogContentText component="div">{request.text}</DialogContentText>
            </DialogContent>
          )}
          <DialogActions sx={{ flexWrap: 'wrap' }}>
            <Button onClick={cancel}>{t('Abbrechen')}</Button>
            {request.options.map((option) => (
              <Button
                key={option.value}
                variant={option.primary ? 'contained' : 'tonal'}
                onClick={() => {
                  request.resolve(option.value);
                  close();
                }}
              >
                {option.label}
              </Button>
            ))}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
