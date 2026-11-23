import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddReactionOutlined from '@mui/icons-material/AddReactionOutlined';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { locale, t, tn } from '../../lib/i18n';
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
  avatar?: string | null;
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

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  people: string[];
}

interface Comment {
  id: string;
  text: string;
  mentions: Mention[];
  author: { id: number; name: string; initials: string; avatar?: string | null } | null;
  mine: boolean;
  edited: boolean;
  createdAt: number;
  reactions?: Reaction[];
}

const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '✅'];

function reactionName(emoji: string) {
  switch (emoji) {
    case '👍':
      return t('Daumen hoch');
    case '❤️':
      return t('Herz');
    case '😂':
      return t('Lachen');
    case '🎉':
      return t('Feiern');
    case '😮':
      return t('Staunen');
    case '😢':
      return t('Traurig');
    case '👀':
      return t('Schau ich mir an');
    case '✅':
      return t('Erledigt');
    default:
      return emoji;
  }
}

function reactedBy(entry: Reaction) {
  const names = [...(entry.mine ? [t('Du')] : []), ...entry.people];
  const rest = entry.count - names.length;
  if (rest > 0) names.push(tn(rest, 'eine weitere Person', '{count} weitere'));
  return `${reactionName(entry.emoji)}: ${new Intl.ListFormat(locale, { type: 'conjunction' }).format(names)}`;
}

function Reactions({ item, comment, onChange }: { item: Item; comment: Comment; onChange: (next: Comment) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const list = comment.reactions ?? [];

  const react = async (emoji: string, on: boolean) => {
    setAnchor(null);
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.post<{ comment: Comment }>(`/api/nodes/${item.id}/comments/${comment.id}/reactions`, { emoji, on });
      onChange(result.comment);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-reactions={comment.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
      {list.map((entry) => (
        <Tooltip key={entry.emoji} title={reactedBy(entry)}>
          <ButtonBase
            data-reaction={entry.emoji}
            aria-pressed={entry.mine}
            aria-label={tn(entry.count, '{reaction}, eine Person', '{reaction}, {count} Personen', { reaction: reactionName(entry.emoji) })}
            onClick={() => void react(entry.emoji, !entry.mine)}
            sx={{
              gap: 0.5,
              height: 28,
              px: 1,
              borderRadius: `${radius.full}px`,
              border: 1,
              borderColor: entry.mine ? c.primary : c.outlineVariant,
              bgcolor: entry.mine ? c.primaryContainer : 'transparent',
              color: entry.mine ? c.onPrimaryContainer : c.onSurfaceVariant,
              fontSize: 15,
              '&:hover': { bgcolor: entry.mine ? c.primaryContainer : c.surfaceContainerHigh },
              '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
            }}
          >
            <span aria-hidden="true">{entry.emoji}</span>
            <Typography component="span" variant="caption" sx={{ fontWeight: 600 }}>
              {formatNumber(entry.count)}
            </Typography>
          </ButtonBase>
        </Tooltip>
      ))}
      <Tooltip title={t('Reagieren')}>
        <IconButton
          size="small"
          aria-label={t('Reagieren')}
          aria-haspopup="true"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: c.onSurfaceVariant, width: 28, height: 28 }}
        >
          <AddReactionOutlined sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { borderRadius: `${radius.full}px` } } }}
      >
        <Box role="group" aria-label={t('Reaktion wählen')} sx={{ display: 'flex', gap: 0.25, p: 0.5 }}>
          {REACTIONS.map((emoji) => {
            const mine = list.some((entry) => entry.emoji === emoji && entry.mine);
            return (
              <Tooltip key={emoji} title={reactionName(emoji)}>
                <IconButton
                  aria-label={reactionName(emoji)}
                  aria-pressed={mine}
                  onClick={() => void react(emoji, !mine)}
                  sx={{ width: 40, height: 40, fontSize: 22, bgcolor: mine ? c.primaryContainer : undefined }}
                >
                  <span aria-hidden="true">{emoji}</span>
                </IconButton>
              </Tooltip>
            );
          })}
        </Box>
      </Popover>
    </Box>
  );
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
              <UserAvatar
                initials={comment.author?.initials ?? '?'}
                size={32}
                avatar={comment.author?.avatar}
                userId={comment.author?.id}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
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
                <Reactions
                  item={item}
                  comment={comment}
                  onChange={(next) => setState({ id: item.id, list: (list ?? []).map((entry) => (entry.id === next.id ? next : entry)) })}
                />
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
                <UserAvatar initials={person.initials} size={24} avatar={person.avatar} userId={person.id} />
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
