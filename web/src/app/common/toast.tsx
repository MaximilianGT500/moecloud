import { useSyncExternalStore } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

let queue: Toast[] = [];
let id = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function toast(message: string, options: { action?: Toast['action']; duration?: number } = {}) {
  queue = [...queue, { id: ++id, message, action: options.action, duration: options.duration ?? (options.action ? 6000 : 4000) }];
  emit();
}

function dismiss(target: number) {
  queue = queue.filter((entry) => entry.id !== target);
  emit();
}

export function Toaster() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => queue[0]
  );
  return (
    <Snackbar
      key={current?.id}
      open={Boolean(current)}
      autoHideDuration={current?.duration}
      onClose={(_event, reason) => {
        if (reason !== 'clickaway' && current) dismiss(current.id);
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message={current?.message}
      sx={{ bottom: { xs: 'calc(96px + env(safe-area-inset-bottom))', md: 24 } }}
      action={
        <>
          {current?.action && (
            <Button
              size="small"
              sx={{ color: c.inversePrimary }}
              onClick={() => {
                current.action?.onClick();
                dismiss(current.id);
              }}
            >
              {current.action.label}
            </Button>
          )}
          <IconButton
            size="small"
            aria-label={t('Schließen')}
            sx={{ color: c.inverseOnSurface }}
            onClick={() => current && dismiss(current.id)}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </>
      }
    />
  );
}
