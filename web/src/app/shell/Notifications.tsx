import { useState } from 'react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatDateTime, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, mix, radius } from '../../theme/tokens';
import { toast } from '../common/toast';

interface Note {
  id: number;
  kind: string;
  title: string;
  text: string;
  url: string | null;
  read: boolean;
  createdAt: number;
}

export function NotificationBell({ onNavigate }: { onNavigate?: (href: string) => boolean }) {
  const [unread, setUnread] = useState(boot().unread ?? 0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ items: Note[]; unread: number }>('/api/notifications');
      setNotes(data.items);
      setUnread(data.unread);
    } catch (error) {
      toast(errorText(error));
    }
  };

  useLive((event, payload) => {
    if (event === 'reconnect') {
      void api
        .get<{ items: Note[]; unread: number }>('/api/notifications')
        .then((data) => {
          setUnread(data.unread);
          if (anchor) setNotes(data.items);
        })
        .catch(() => {});
      return;
    }
    if (event !== 'notification') return;
    if (typeof payload.unread === 'number') setUnread(payload.unread);
    if (anchor || payload.id) {
      void api
        .get<{ items: Note[]; unread: number }>('/api/notifications')
        .then((data) => {
          if (anchor) setNotes(data.items);
          const fresh = payload.id ? data.items.find((note) => note.id === payload.id) : null;
          if (fresh && !anchor) toast(fresh.title, fresh.url ? { action: { label: t('Ansehen'), onClick: () => go(fresh) } } : undefined);
        })
        .catch(() => {});
    }
  });

  const markAll = async () => {
    try {
      await api.post('/api/notifications/read', {});
      setNotes((current) => current?.map((note) => ({ ...note, read: true })) ?? null);
      setUnread(0);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const clear = async () => {
    try {
      await api.delete('/api/notifications');
      setNotes([]);
      setUnread(0);
    } catch (error) {
      toast(errorText(error));
    }
  };

  function go(note: Note) {
    if (!note.read) void api.post('/api/notifications/read', { ids: [note.id] }).catch(() => {});
    setAnchor(null);
    if (!note.url) return;
    if (!(onNavigate?.(note.url) ?? false)) {
      if (note.url.startsWith('/files') && location.pathname.startsWith('/files')) navigate(note.url);
      else location.href = note.url;
    }
  }

  const label = unread ? tn(unread, '{count} neue Benachrichtigung', '{count} neue Benachrichtigungen') : t('Benachrichtigungen');

  return (
    <>
      <Tooltip title={t('Benachrichtigungen')}>
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
          onClick={(event) => {
            setAnchor(event.currentTarget);
            void load();
          }}
        >
          <Badge badgeContent={unread} max={99} color="error" invisible={!unread}>
            {unread ? <NotificationsRounded /> : <NotificationsNoneRounded />}
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('Benachrichtigungen'),
            sx: {
              width: 'min(400px, calc(100vw - 24px))',
              maxHeight: 'min(560px, 80dvh)',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: `${radius.lg}px`,
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, flex: 1 }}>
            {t('Benachrichtigungen')}
          </Typography>
          {unread > 0 && (
            <Button size="small" onClick={() => void markAll()}>
              {t('Alle gelesen')}
            </Button>
          )}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
          {!notes ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={28} aria-label={t('Lädt')} />
            </Box>
          ) : notes.length === 0 ? (
            <Box sx={{ textAlign: 'center', color: c.onSurfaceVariant, py: 5, px: 3 }}>
              <NotificationsNoneRounded sx={{ fontSize: 40 }} />
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t('Alles ruhig. Hier erfährst du, wenn jemand etwas mit dir teilt, Dateien hochlädt oder kommentiert.')}
              </Typography>
            </Box>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {notes.map((note) => (
                <Box component="li" key={note.id}>
                  <ButtonBase
                    onClick={() => go(note)}
                    sx={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.5,
                      textAlign: 'left',
                      p: 1.25,
                      borderRadius: `${radius.md}px`,
                      bgcolor: note.read ? 'transparent' : mix(c.primary, 8),
                      '&:hover': { bgcolor: note.read ? c.surfaceContainerHigh : mix(c.primary, 14) },
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 8,
                        height: 8,
                        mt: 0.85,
                        borderRadius: '50%',
                        flex: 'none',
                        bgcolor: note.read ? 'transparent' : c.primary,
                      }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: note.read ? 500 : 700, overflowWrap: 'anywhere' }}>
                        {note.title}
                      </Typography>
                      {note.text && (
                        <Typography
                          variant="body2"
                          sx={{
                            color: c.onSurfaceVariant,
                            overflowWrap: 'anywhere',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {note.text}
                        </Typography>
                      )}
                      <Typography
                        variant="caption"
                        component="time"
                        title={formatDateTime(note.createdAt)}
                        sx={{ color: c.onSurfaceVariant }}
                      >
                        {formatRelative(note.createdAt)}
                      </Typography>
                    </Box>
                  </ButtonBase>
                </Box>
              ))}
            </Box>
          )}
        </Box>
        {notes && notes.length > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, px: 2, py: 1, borderTop: `1px solid ${c.outlineVariant}` }}>
            <Button size="small" href="/account#benachrichtigungen">
              {t('Einstellungen')}
            </Button>
            <Button size="small" color="error" onClick={() => void clear()}>
              {t('Alle löschen')}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
