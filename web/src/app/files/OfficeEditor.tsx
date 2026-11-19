import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import type { Item } from './kinds';

interface Session {
  url: string;
  token: string;
  ttl: number;
  origin: string;
  write: boolean;
  name: string;
}

let known: string[] | null = null;
let loading: Promise<string[]> | null = null;

export function officeExtensions(initial: string[] | null | undefined) {
  if (initial === null || initial === undefined) return [];
  if (known === null && initial.length > 0) known = initial;
  return known ?? initial;
}

export function loadOfficeExtensions() {
  loading ??= api
    .get<{ enabled: boolean; extensions: string[] }>('/api/office')
    .then((result) => {
      known = result.enabled ? result.extensions : [];
      return known;
    })
    .catch(() => {
      loading = null;
      return [];
    });
  return loading;
}

export const officeEditable = (item: Item, extensions: string[]) => {
  if (item.type !== 'file' || item.infected || item.trashedAt) return false;
  const dot = item.name.lastIndexOf('.');
  return dot > 0 && extensions.includes(item.name.slice(dot + 1).toLowerCase());
};

export function OfficeEditor({ item, onClose }: { item: Item; onClose: (changed: boolean) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const frameName = `office-${item.id}`;

  useEffect(() => {
    let active = true;
    api
      .post<Session>(`/api/nodes/${item.id}/office/edit`)
      .then((result) => active && setSession(result))
      .catch((failure) => active && setError(errorText(failure)));
    return () => {
      active = false;
    };
  }, [item.id]);

  useEffect(() => {
    if (!session) return;
    form.current?.submit();
    const listener = (event: MessageEvent) => {
      if (event.origin !== session.origin || event.source !== frame.current?.contentWindow) return;
      let message: { MessageId?: string; Values?: { Status?: string } } | null = null;
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!message?.MessageId) return;
      if (message.MessageId === 'App_LoadingStatus') {
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }),
          session.origin
        );
        if (message.Values?.Status === 'Frame_Ready' || message.Values?.Status === 'Document_Loaded') setReady(true);
      }
      if (message.MessageId === 'UI_Close') onClose(true);
    };
    window.addEventListener('message', listener);
    const fallback = window.setTimeout(() => setReady(true), 8000);
    return () => {
      window.removeEventListener('message', listener);
      window.clearTimeout(fallback);
    };
  }, [session]);

  return (
    <Dialog open fullScreen onClose={() => onClose(Boolean(session))} aria-labelledby="office-title">
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: c.surface }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, minHeight: 56, borderBottom: `1px solid ${c.outlineVariant}` }}>
          <Typography id="office-title" variant="subtitle1" component="h2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {item.name}
          </Typography>
          {session && !session.write && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, display: { xs: 'none', sm: 'block' } }}>
              {t('Nur Ansicht')}
            </Typography>
          )}
          <Tooltip title={t('Schließen')}>
            <IconButton aria-label={t('Schließen')} onClick={() => onClose(Boolean(session))}>
              <CloseRounded />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
          {error ? (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                p: 3,
                textAlign: 'center',
              }}
            >
              <Typography variant="body1" role="alert">
                {error}
              </Typography>
              <Button variant="tonal" onClick={() => onClose(false)}>
                {t('Schließen')}
              </Button>
            </Box>
          ) : (
            <>
              {!ready && (
                <Box
                  role="status"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    color: c.onSurfaceVariant,
                    pointerEvents: 'none',
                  }}
                >
                  <CircularProgress aria-label={t('Lädt')} />
                  <Typography variant="body2">{t('Office wird geöffnet …')}</Typography>
                </Box>
              )}
              {session && (
                <>
                  <form ref={form} action={session.url} method="post" target={frameName} encType="multipart/form-data" hidden>
                    <input type="hidden" name="access_token" value={session.token} />
                    <input type="hidden" name="access_token_ttl" value={String(session.ttl)} />
                  </form>
                  <Box
                    component="iframe"
                    ref={frame}
                    name={frameName}
                    title={t('{name} in Office', { name: item.name })}
                    allow="clipboard-read *; clipboard-write *; fullscreen *"
                    sx={{ width: '100%', height: '100%', border: 0, display: 'block', opacity: ready ? 1 : 0 }}
                  />
                </>
              )}
            </>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
