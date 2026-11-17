import { useEffect, useRef, useState, type ReactNode } from 'react';
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

interface Mention {
  username: string;
  name: string;
  me: boolean;
}

interface Person {
  id: number;
  name: string;
  username: string;
  initials: string;
}

const MENTION = /(?<![\w@.-])@([a-zA-Z0-9._-]{3,32})/g;

function CommentText({ text, mentions }: { text: string; mentions: Mention[] }) {
  if (!mentions.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const key = match[1].toLowerCase();
    const person = mentions.find(
      (entry) => key === entry.username.toLowerCase() || key.replace(/[.-]+$/, '') === entry.username.toLowerCase()
    );
    if (!person) continue;
    const length = person.username.length + 1;
    parts.push(text.slice(last, match.index));
    parts.push(
      <Box
        component="span"
        key={match.index}
        title={`@${person.username}`}
        sx={{ fontWeight: 700, color: person.me ? c.tertiary : 'inherit', textDecoration: 'underline', textDecorationThickness: 1 }}
      >
        @{person.name}
      </Box>
    );
    last = match.index + length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function draftMention(text: string, caret: number) {
  const match = /(?:^|[^\w@.-])@([a-zA-Z0-9._-]{0,32})$/.exec(text.slice(0, caret));
  return match ? { query: match[1].toLowerCase(), start: caret - match[1].length - 1 } : null;
}

interface Comment {
  id: string;
  text: string;
  mentions: Mention[];
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
  const [people, setPeople] = useState<{ id: string; list: Person[] } | null>(null);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const typing = dismissed ? null : draftMention(draft, caret);
  const wanted = Boolean(typing);
  useEffect(() => {
    if (!wanted || people?.id === item.id) return;
    const abort = new AbortController();
    api
      .get<{ items: Person[] }>(`/api/nodes/${item.id}/comments/people`, abort.signal)
      .then((result) => setPeople({ id: item.id, list: result.items }))
      .catch(() => {});
    return () => abort.abort();
  }, [wanted, item.id, people?.id]);

  const suggestions =
    typing && people?.id === item.id
      ? people.list
          .filter((person) => person.username.toLowerCase().startsWith(typing.query) || person.name.toLowerCase().includes(typing.query))
          .slice(0, 5)
      : [];
  const active = Math.min(picked, Math.max(0, suggestions.length - 1));

  const mention = (person: Person) => {
    if (!typing) return;
    const next = `${draft.slice(0, typing.start)}@${person.username} ${draft.slice(caret)}`;
    const position = typing.start + person.username.length + 2;
    setDraft(next);
    setCaret(position);
    setPicked(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

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
                  <CommentText text={comment.text} mentions={comment.mentions ?? []} />
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
          inputRef={input}
          helperText={t('Mit @ erwähnst du jemanden, der hier Zugriff hat.')}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setDismissed(false);
          }}
          onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(event) => {
            if (suggestions.length) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setPicked((active + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                return;
              }
              if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
                event.preventDefault();
                mention(suggestions[active]);
                return;
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                setDismissed(true);
                return;
              }
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
          slotProps={{
            htmlInput: {
              maxLength: 4000,
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': suggestions.length > 0,
              'aria-controls': suggestions.length ? 'comment-mentions' : undefined,
              'aria-activedescendant': suggestions.length ? `comment-mention-${suggestions[active].id}` : undefined,
            },
          }}
        />
        {suggestions.length > 0 && (
          <Box
            id="comment-mentions"
            role="listbox"
            aria-label={t('Personen zum Erwähnen')}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              borderRadius: `${radius.md}px`,
              bgcolor: c.surfaceContainerHigh,
              overflow: 'hidden',
            }}
          >
            {suggestions.map((person, index) => (
              <Box
                key={person.id}
                id={`comment-mention-${person.id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  mention(person);
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.25,
                  py: 0.75,
                  cursor: 'pointer',
                  bgcolor: index === active ? c.secondaryContainer : 'transparent',
                  color: index === active ? c.onSecondaryContainer : c.onSurface,
                }}
              >
                <UserAvatar initials={person.initials} size={24} />
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {person.name}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.75 }}>
                  @{person.username}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
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
