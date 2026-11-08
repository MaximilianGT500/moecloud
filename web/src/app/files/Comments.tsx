import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { c, radius } from '../../theme/tokens';
import { UserAvatar } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import type { Item } from './kinds';

interface Comment {
  id: string;
  text: string;
  author: { id: number; name: string; initials: string } | null;
  mine: boolean;
  edited: boolean;
  createdAt: number;
}

export function Comments({ item }: { item: Item }) {
  const [state, setState] = useState<{ id: string; list: Comment[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: Comment[] }>(`/api/nodes/${item.id}/comments`, abort.signal)
      .then((result) => setState({ id: item.id, list: result.items }))
      .catch(() => {});
    return () => abort.abort();
  }, [item.id, revision]);

  useLive((event, payload) => {
    if (event === 'comment' && payload.nodeId === item.id) setRevision((value) => value + 1);
  });

  const list = state?.id === item.id ? state.list : null;
  const count = list?.length ?? 0;

  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const { comment } = await api.post<{ comment: Comment }>(`/api/nodes/${item.id}/comments`, { text });
      setState({ id: item.id, list: [...(list ?? []), comment] });
      setDraft('');
    } catch (error) {
      toast(errorText(error));
    } finally {
      setSending(false);
    }
  };

  const remove = async (comment: Comment) => {
    if (!(await confirm({ title: t('Kommentar löschen?'), confirm: t('Löschen'), danger: true }))) return;
    try {
      await api.delete(`/api/nodes/${item.id}/comments/${comment.id}`);
      setState({ id: item.id, list: (list ?? []).filter((entry) => entry.id !== comment.id) });
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!list ? (
        <CircularProgress size={24} aria-label={t('Lädt')} sx={{ alignSelf: 'center', my: 3 }} />
      ) : list.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            textAlign: 'center',
            color: c.onSurfaceVariant,
            py: 3,
          }}
        >
          <ChatBubbleOutlineRounded sx={{ fontSize: 40 }} />
          <Typography variant="body2">{t('Noch keine Kommentare. Alle, die hier Zugriff haben, sehen, was du schreibst.')}</Typography>
        </Box>
      ) : (
        <Box
          component="ol"
          aria-label={t('Kommentare')}
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          {list.map((comment) => (
            <Box component="li" key={comment.id} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
              <UserAvatar initials={comment.author?.initials ?? '?'} size={32} />
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  px: 1.5,
                  py: 1,
                  borderRadius: `4px ${radius.md}px ${radius.md}px ${radius.md}px`,
                  bgcolor: comment.mine ? c.secondaryContainer : c.surfaceContainerHigh,
                  color: comment.mine ? c.onSecondaryContainer : c.onSurface,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {comment.author?.name ?? t('Gelöschtes Konto')}
                  </Typography>
                  <Typography
                    variant="caption"
                    component="time"
                    title={formatDateTime(comment.createdAt)}
                    sx={{ opacity: 0.75, flex: 'none' }}
                  >
                    {formatRelative(comment.createdAt)}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.25 }}>
                  {comment.text}
                </Typography>
              </Box>
              {(comment.mine || item.role === 'owner') && (
                <Tooltip title={t('Löschen')}>
                  <IconButton size="small" aria-label={t('Kommentar löschen')} onClick={() => void remove(comment)} sx={{ mt: 0.5 }}>
                    <DeleteOutlineRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          ))}
          <div ref={end} />
        </Box>
      )}
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <TextField
          multiline
          minRows={2}
          maxRows={8}
          label={t('Kommentar schreiben')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
          slotProps={{ htmlInput: { maxLength: 4000 } }}
        />
        <Button
          type="submit"
          variant="contained"
          startIcon={<SendRounded />}
          disabled={!draft.trim() || sending}
          sx={{ alignSelf: 'flex-end' }}
        >
          {t('Senden')}
        </Button>
      </Box>
    </Box>
  );
}
