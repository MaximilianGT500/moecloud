import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddCommentRounded from '@mui/icons-material/AddCommentRounded';
import AddReactionOutlined from '@mui/icons-material/AddReactionOutlined';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import BookmarkRounded from '@mui/icons-material/BookmarkRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import NotificationsOffOutlined from '@mui/icons-material/NotificationsOffOutlined';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import PushPinOutlined from '@mui/icons-material/PushPinOutlined';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import ReplyRounded from '@mui/icons-material/ReplyRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, errorText } from '../../lib/api';
import { refreshBadges } from '../../lib/badges';
import { boot } from '../../lib/boot';
import { formatBytes, formatTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { c, mix, radius } from '../../theme/tokens';
import { EmptyState, UserAvatar, copyText } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { StatusBadge, statusLine } from '../common/status';
import { PullToRefresh, SwipeRow } from '../common/touch';
import { toast } from '../common/toast';
import { AppShell } from '../shell/AppShell';
import {
  chatApi,
  fileUrl,
  isImage,
  QUICK,
  systemText,
  thumbUrl,
  uploadToChat,
  type ChatMessage,
  type Member,
  type Person,
  type Room,
} from './model';

const me = () => boot().user!;

function dayLabel(time: number) {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('Heute');
  if (date.toDateString() === yesterday.toDateString()) return t('Gestern');
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function shortTime(time: number) {
  const date = new Date(time);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(time);
  if (now.getTime() - time < 6 * 24 * 3600_000) return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function RoomAvatar({ room, size = 44 }: { room: Pick<Room, 'kind' | 'name' | 'other'>; size?: number }) {
  if (room.kind === 'self') {
    return (
      <Avatar sx={{ width: size, height: size, bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer }}>
        <BookmarkRounded />
      </Avatar>
    );
  }
  if (room.kind === 'direct' && room.other) {
    return (
      <StatusBadge status={room.other.status}>
        <UserAvatar initials={room.other.initials} avatar={room.other.avatar} userId={room.other.id} size={size} />
      </StatusBadge>
    );
  }
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: c.secondaryContainer, color: c.onSecondaryContainer }}>
      <GroupsRounded />
    </Avatar>
  );
}

const roomTitle = (room: Pick<Room, 'kind' | 'name'>) => (room.kind === 'self' ? t('Notizen an mich') : room.name || t('Unbenannt'));

function RichText({ text, mine }: { text: string; mine: boolean }) {
  const own = me().username.toLowerCase();
  const nodes: ReactNode[] = [];
  const blocks = text.split(/```/);
  blocks.forEach((block, index) => {
    if (index % 2 === 1) {
      nodes.push(
        <Box
          key={`code-${index}`}
          component="pre"
          sx={{
            m: 0,
            my: 0.5,
            p: 1,
            borderRadius: `${radius.sm}px`,
            bgcolor: mix(mine ? c.onPrimaryContainer : c.onSurface, 8),
            overflowX: 'auto',
            fontFamily: 'var(--moe-mono, monospace)',
            fontSize: '0.8125rem',
          }}
        >
          {block.replace(/^\w*\n/, '')}
        </Box>
      );
      return;
    }
    const pattern = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(@[a-zA-Z0-9._-]{2,32})/g;
    let last = 0;
    for (const match of block.matchAll(pattern)) {
      if (match.index > last) nodes.push(block.slice(last, match.index));
      const [value] = match;
      const key = `${index}-${match.index}`;
      if (match[1]) {
        nodes.push(
          <Box
            key={key}
            component="a"
            href={value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            sx={{ color: 'inherit', textDecoration: 'underline', overflowWrap: 'anywhere' }}
          >
            {value}
          </Box>
        );
      } else if (match[2]) {
        nodes.push(
          <Box
            key={key}
            component="code"
            sx={{
              px: 0.5,
              borderRadius: `${radius.xs}px`,
              bgcolor: mix(mine ? c.onPrimaryContainer : c.onSurface, 10),
              fontSize: '0.85em',
            }}
          >
            {value.slice(1, -1)}
          </Box>
        );
      } else if (match[3]) nodes.push(<strong key={key}>{value.slice(2, -2)}</strong>);
      else if (match[4]) nodes.push(<em key={key}>{value.slice(1, -1)}</em>);
      else {
        const target = value.slice(1).toLowerCase();
        nodes.push(
          <Box key={key} component="span" sx={{ fontWeight: 700, color: target === own || target === 'alle' ? c.tertiary : 'inherit' }}>
            {value}
          </Box>
        );
      }
      last = match.index + value.length;
    }
    if (last < block.length) nodes.push(block.slice(last));
  });
  return <>{nodes}</>;
}

function MessageBubble({
  message,
  room,
  first,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  message: ChatMessage;
  room: Room;
  first: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  const mine = message.user?.id === me().id;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (message.kind === 'system') {
    return (
      <Typography variant="caption" component="p" sx={{ textAlign: 'center', color: c.onSurfaceVariant, my: 1 }} data-chat-system>
        {systemText(message.body, t)}
      </Typography>
    );
  }
  const deleted = Boolean(message.deletedAt);
  const open = (x: number, y: number) => !deleted && setMenu({ x, y });
  return (
    <Box
      data-chat-message={message.id}
      sx={{
        display: 'flex',
        flexDirection: mine ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 1,
        mt: first ? 1.5 : 0.25,
        px: { xs: 1, md: 2 },
        '&:hover .chat-actions': { opacity: 1 },
      }}
    >
      {!mine && room.kind === 'group' && (
        <Box sx={{ width: 32, flex: 'none' }}>
          {first && message.user && (
            <UserAvatar initials={message.user.initials} avatar={message.user.avatar} userId={message.user.id} size={32} />
          )}
        </Box>
      )}
      <Box
        sx={{
          maxWidth: { xs: '82%', md: '70%' },
          display: 'flex',
          flexDirection: 'column',
          alignItems: mine ? 'flex-end' : 'flex-start',
          minWidth: 0,
        }}
      >
        {first && !mine && room.kind === 'group' && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, ml: 1.5, mb: 0.25, fontWeight: 600 }}>
            {message.user?.name ?? t('Unbekannt')}
          </Typography>
        )}
        <Box
          onContextMenu={(event) => {
            event.preventDefault();
            open(event.clientX, event.clientY);
          }}
          onPointerDown={(event) => {
            if (event.pointerType !== 'touch') return;
            const { clientX, clientY } = event;
            press.current = setTimeout(() => open(clientX, clientY), 450);
          }}
          onPointerUp={() => press.current && clearTimeout(press.current)}
          onPointerCancel={() => press.current && clearTimeout(press.current)}
          onPointerMove={() => press.current && clearTimeout(press.current)}
          sx={{
            px: 1.5,
            py: 1,
            borderRadius: '18px',
            borderBottomRightRadius: mine ? '6px' : '18px',
            borderBottomLeftRadius: mine ? '18px' : '6px',
            bgcolor: deleted ? 'transparent' : mine ? c.primaryContainer : c.surfaceContainerHigh,
            color: mine ? c.onPrimaryContainer : c.onSurface,
            border: deleted ? `1px dashed ${c.outlineVariant}` : 'none',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontSize: '0.9375rem',
            lineHeight: 1.45,
            userSelect: 'text',
            WebkitTouchCallout: 'none',
          }}
        >
          {message.replyTo && (
            <Box sx={{ borderLeft: `3px solid ${mine ? c.onPrimaryContainer : c.primary}`, pl: 1, mb: 0.75, opacity: 0.85 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                {message.replyTo.name}
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
              >
                {message.replyTo.preview || t('Gelöschte Nachricht')}
              </Typography>
            </Box>
          )}
          {deleted ? (
            <Typography variant="body2" sx={{ fontStyle: 'italic', color: c.onSurfaceVariant }}>
              {t('Nachricht gelöscht')}
            </Typography>
          ) : (
            <>
              {message.files.map((file) =>
                isImage(file) ? (
                  <Box
                    key={file.node}
                    component="a"
                    href={fileUrl(room.id, file.node)}
                    target="_blank"
                    rel="noopener"
                    sx={{ display: 'block', mb: message.body ? 0.75 : 0 }}
                  >
                    <Box
                      component="img"
                      src={thumbUrl(room.id, file.node)}
                      alt={file.name}
                      loading="lazy"
                      sx={{ display: 'block', maxWidth: '100%', maxHeight: 280, borderRadius: '12px' }}
                    />
                  </Box>
                ) : (
                  <Chip
                    key={file.node}
                    icon={<AttachFileRounded />}
                    label={`${file.name} · ${formatBytes(file.size)}`}
                    component="a"
                    href={fileUrl(room.id, file.node, true)}
                    clickable
                    onDelete={() => (location.href = fileUrl(room.id, file.node, true))}
                    deleteIcon={<DownloadRounded />}
                    sx={{ mb: message.body ? 0.75 : 0, maxWidth: '100%', bgcolor: mix(c.onSurface, 8) }}
                  />
                )
              )}
              {message.body && <RichText text={message.body} mine={mine} />}
            </>
          )}
          <Typography
            component="span"
            variant="caption"
            sx={{ display: 'block', textAlign: 'right', opacity: 0.65, fontSize: '0.6875rem', mt: 0.25 }}
          >
            {message.editedAt && !deleted ? `${t('bearbeitet')} · ` : ''}
            {formatTime(message.createdAt)}
          </Typography>
        </Box>
        {message.reactions.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {message.reactions.map((reaction) => (
              <Tooltip key={reaction.emoji} title={reaction.names.join(', ')}>
                <Chip
                  size="small"
                  label={`${reaction.emoji} ${reaction.count}`}
                  onClick={() => onReact(reaction.emoji)}
                  color={reaction.mine ? 'primary' : 'default'}
                  variant={reaction.mine ? 'filled' : 'outlined'}
                  data-chat-reaction={reaction.emoji}
                />
              </Tooltip>
            ))}
          </Box>
        )}
      </Box>
      {!deleted && (
        <Box
          className="chat-actions"
          sx={{ display: { xs: 'none', md: 'flex' }, opacity: 0, transition: 'opacity 120ms', alignSelf: 'center' }}
        >
          <Tooltip title={t('Reagieren')}>
            <IconButton size="small" onClick={(event) => open(event.clientX, event.clientY)} aria-label={t('Reagieren')}>
              <AddReactionOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('Antworten')}>
            <IconButton size="small" onClick={onReply} aria-label={t('Antworten')}>
              <ReplyRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <Box sx={{ display: 'flex', gap: 0.25, px: 1, pb: 0.5 }}>
          {QUICK.map((emoji) => (
            <IconButton
              key={emoji}
              onClick={() => {
                setMenu(null);
                onReact(emoji);
              }}
              aria-label={t('Mit {emoji} reagieren', { emoji })}
              sx={{ fontSize: '1.25rem', width: 40, height: 40 }}
            >
              {emoji}
            </IconButton>
          ))}
        </Box>
        <MenuItem
          onClick={() => {
            setMenu(null);
            onReply();
          }}
        >
          <ListItemIcon>
            <ReplyRounded />
          </ListItemIcon>
          {t('Antworten')}
        </MenuItem>
        {message.body && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              void copyText(message.body);
            }}
          >
            <ListItemIcon>
              <ContentCopyRounded />
            </ListItemIcon>
            {t('Text kopieren')}
          </MenuItem>
        )}
        {mine && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              onEdit();
            }}
          >
            <ListItemIcon>
              <EditRounded />
            </ListItemIcon>
            {t('Bearbeiten')}
          </MenuItem>
        )}
        {(mine || canDelete) && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              onDelete();
            }}
            sx={{ color: c.error }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineRounded />
            </ListItemIcon>
            {t('Löschen')}
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

function PeoplePicker({ value, onChange, label }: { value: Person[]; onChange: (next: Person[]) => void; label: string }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Person[]>([]);
  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      chatApi
        .people(q)
        .then((result) => setOptions(result.people))
        .catch(() => setOptions([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [input]);
  return (
    <Autocomplete
      multiple
      options={options}
      value={value}
      filterOptions={(list) => list}
      filterSelectedOptions
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, current) => option.id === current.id}
      inputValue={input}
      onInputChange={(_event, next) => setInput(next)}
      onChange={(_event, next) => onChange(next)}
      noOptionsText={input ? t('Niemand gefunden') : t('Tipp einen Namen')}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <StatusBadge status={option.status} size={10}>
              <UserAvatar initials={option.initials} avatar={option.avatar} userId={option.id} size={32} />
            </StatusBadge>
            <Box>
              <Typography variant="body2">{option.name}</Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                @{option.username}
                {option.status ? ` · ${statusLine(option.status)}` : ''}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderValue={(items, getItemProps) =>
        items.map((item, index) => {
          const { key, ...rest } = getItemProps({ index });
          return <Chip key={key} {...rest} label={item.name} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={t('Name oder Benutzername')}
          autoFocus
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'data-chat-people': '' } }}
        />
      )}
    />
  );
}

function NewChatDialog({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (room: Room) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPeople([]);
      setName('');
    }
  }, [open]);
  const group = people.length > 1;
  const start = async () => {
    setBusy(true);
    try {
      const result = group
        ? await chatApi.open({
            kind: 'group',
            name: name.trim() || people.map((entry) => entry.name.split(' ')[0]).join(', '),
            members: people.map((entry) => entry.id),
          })
        : await chatApi.open({ kind: 'direct', user: people[0].id });
      onOpen(result.room);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-chat-new>
      <DialogTitle>{t('Neuer Chat')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <PeoplePicker value={people} onChange={setPeople} label={t('Mit wem?')} />
        {group && (
          <TextField
            label={t('Name der Gruppe')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
        )}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {group ? t('Mit mehreren Personen entsteht eine Gruppe.') : t('Mit einer Person schreibst du direkt.')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={!people.length || busy} onClick={() => void start()} data-chat-start>
          {group ? t('Gruppe anlegen') : t('Chat öffnen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MembersDialog({ room, open, onClose, onChanged }: { room: Room; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState<Person[]>([]);
  const load = useCallback(() => {
    chatApi
      .details(room.id)
      .then((result) => setMembers(result.members))
      .catch(() => undefined);
  }, [room.id]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  const add = async () => {
    try {
      await api.post(`/api/chat/rooms/${room.id}/members`, { users: adding.map((entry) => entry.id) });
      setAdding([]);
      load();
      onChanged();
    } catch (error) {
      toast(errorText(error));
    }
  };
  const remove = async (member: Member) => {
    if (!(await confirm({ title: t('{name} entfernen?', { name: member.name }), confirm: t('Entfernen'), danger: true }))) return;
    try {
      await api.delete(`/api/chat/rooms/${room.id}/members/${member.id}`);
      load();
      onChanged();
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{tn(members.length, 'Eine Person', '{count} Personen')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {members.map((member) => (
          <Box key={member.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <StatusBadge status={member.status} size={10}>
              <UserAvatar initials={member.initials} avatar={member.avatar} userId={member.id} size={36} />
            </StatusBadge>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {member.name}
                {member.role === 'owner' && (
                  <Box component="span" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                    {t('gegründet')}
                  </Box>
                )}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} noWrap component="p">
                {statusLine(member.status) || `@${member.username}`}
              </Typography>
            </Box>
            {room.kind === 'group' && room.role === 'owner' && member.id !== me().id && (
              <IconButton size="small" onClick={() => void remove(member)} aria-label={t('{name} entfernen', { name: member.name })}>
                <CloseRounded fontSize="small" />
              </IconButton>
            )}
          </Box>
        ))}
        {room.kind === 'group' && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1 }}>
            <Box sx={{ flex: 1 }}>
              <PeoplePicker value={adding} onChange={setAdding} label={t('Dazuholen')} />
            </Box>
            <Button variant="tonal" disabled={!adding.length} onClick={() => void add()} sx={{ mt: 1 }}>
              {t('Dazu')}
            </Button>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Fertig')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Composer({
  room,
  members,
  reply,
  editing,
  onCancel,
  onSent,
}: {
  room: Room;
  members: Member[];
  reply: ChatMessage | null;
  editing: ChatMessage | null;
  onCancel: () => void;
  onSent: (message: ChatMessage) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const phone = useMediaQuery('(pointer: coarse)');
  useEffect(() => {
    setText(editing?.body ?? '');
    if (editing || reply) input.current?.focus();
  }, [editing?.id, reply?.id]);
  useEffect(() => {
    const draft = sessionStorage.getItem(`moe-chat-${room.id}`);
    setText(draft ?? '');
  }, [room.id]);
  useEffect(() => {
    if (editing) return;
    try {
      if (text) sessionStorage.setItem(`moe-chat-${room.id}`, text);
      else sessionStorage.removeItem(`moe-chat-${room.id}`);
    } catch {}
  }, [text, room.id, editing]);
  const mention = /(?:^|\s)@([a-zA-Z0-9._-]*)$/.exec(text)?.[1];
  const suggestions =
    mention !== undefined && room.kind === 'group'
      ? members.filter((member) => member.id !== me().id && member.username.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5)
      : [];
  const send = async (files: string[] = []) => {
    const body = text.trim();
    if (!body && !files.length) return;
    setBusy(true);
    try {
      if (editing) {
        await chatApi.edit(editing.id, body);
        onCancel();
      } else {
        const result = await chatApi.send(room.id, body, reply?.id ?? null, files);
        onSent(result.message);
      }
      setText('');
      sessionStorage.removeItem(`moe-chat-${room.id}`);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setProgress(0);
    try {
      const uploaded = await uploadToChat([...list], setProgress);
      await send(uploaded.map((entry) => entry.node));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setProgress(null);
    }
  };
  return (
    <Box
      sx={{ px: { xs: 1, md: 2 }, pt: 1, pb: { xs: 'calc(8px + env(safe-area-inset-bottom))', md: 1.5 }, bgcolor: c.surface }}
      data-chat-composer
    >
      {progress !== null && <LinearProgress variant="determinate" value={progress * 100} sx={{ mb: 1 }} />}
      {(reply || editing) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            mb: 0.75,
            borderRadius: `${radius.md}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          {editing ? <EditRounded fontSize="small" /> : <ReplyRounded fontSize="small" />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
              {editing ? t('Nachricht bearbeiten') : t('Antwort an {name}', { name: reply?.user?.name ?? '' })}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
              {(editing ?? reply)?.body || t('Datei')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onCancel} aria-label={t('Abbrechen')}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Box>
      )}
      {suggestions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
          {suggestions.map((member) => (
            <Chip
              key={member.id}
              size="small"
              label={`@${member.username}`}
              onClick={() => {
                setText(text.replace(/@([a-zA-Z0-9._-]*)$/, `@${member.username} `));
                input.current?.focus();
              }}
            />
          ))}
        </Box>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          pl: 0.5,
          pr: 0.5,
          py: 0.5,
          borderRadius: '24px',
          bgcolor: c.surfaceContainerHigh,
        }}
      >
        {!editing && (
          <Tooltip title={t('Datei senden')}>
            <IconButton onClick={() => file.current?.click()} aria-label={t('Datei senden')} disabled={busy || progress !== null}>
              <AttachFileRounded />
            </IconButton>
          </Tooltip>
        )}
        <input ref={file} type="file" multiple hidden onChange={(event) => void upload(event.target.files)} />
        <InputBase
          inputRef={input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          multiline
          maxRows={8}
          placeholder={room.kind === 'self' ? t('Notiz, Link oder Datei für später …') : t('Nachricht schreiben …')}
          inputProps={{ 'aria-label': t('Nachricht'), 'data-chat-input': '', enterKeyHint: phone ? 'enter' : 'send' }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !phone && !suggestions.length) {
              event.preventDefault();
              void send();
            }
            if (event.key === 'Escape' && (editing || reply)) onCancel();
            if (event.key === 'ArrowUp' && !text) window.dispatchEvent(new Event('moe:chat-edit-last'));
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault();
              void upload(event.clipboardData.files);
            }
          }}
          sx={{ flex: 1, px: 1, py: 1, fontSize: '0.9375rem' }}
        />
        <IconButton
          color="primary"
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          aria-label={editing ? t('Speichern') : t('Senden')}
          data-chat-send
          sx={{
            bgcolor: text.trim() ? c.primary : 'transparent',
            color: text.trim() ? `${c.onPrimary} !important` : undefined,
            '&:hover': { bgcolor: text.trim() ? c.primary : undefined },
          }}
        >
          <SendRounded />
        </IconButton>
      </Box>
    </Box>
  );
}

function Conversation({
  room,
  onBack,
  showBack,
  onRoomsChanged,
}: {
  room: Room;
  onBack: () => void;
  showBack: boolean;
  onRoomsChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const lastRead = useRef(0);

  const load = useCallback(async () => {
    try {
      const result = await chatApi.messages(room.id);
      setMessages(result.messages);
      setMore(result.more);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [room.id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setReply(null);
    setEditing(null);
    stick.current = true;
    void load();
    chatApi
      .details(room.id)
      .then((result) => setMembers(result.members))
      .catch(() => undefined);
  }, [room.id, load]);

  const markRead = useCallback(() => {
    const latest = messages.at(-1)?.id ?? 0;
    if (!latest || latest <= lastRead.current || document.visibilityState !== 'visible') return;
    lastRead.current = latest;
    void chatApi.read(room.id, latest).then(() => {
      void refreshBadges();
      onRoomsChanged();
    });
  }, [messages, room.id, onRoomsChanged]);

  useEffect(() => {
    markRead();
    const visible = () => markRead();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [markRead]);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const editLast = () => {
      const own = [...messages].reverse().find((entry) => entry.user?.id === me().id && !entry.deletedAt && entry.kind === 'text');
      if (own) setEditing(own);
    };
    window.addEventListener('moe:chat-edit-last', editLast);
    return () => window.removeEventListener('moe:chat-edit-last', editLast);
  }, [messages]);

  useLive((event, data) => {
    if (event === 'reconnect') void load();
    if (event !== 'chat' || data.room !== room.id) return;
    if (data.type === 'message' && data.message) {
      const message = data.message as ChatMessage;
      setMessages((current) => (current.some((entry) => entry.id === message.id) ? current : [...current, message]));
    } else if (data.type === 'edit' && data.message) {
      const message = data.message as ChatMessage;
      setMessages((current) => current.map((entry) => (entry.id === message.id ? message : entry)));
    } else if (data.type === 'delete') {
      setMessages((current) =>
        current.map((entry) => (entry.id === data.id ? { ...entry, body: '', files: [], reactions: [], deletedAt: Date.now() } : entry))
      );
    } else if (data.type === 'reaction' || data.type === 'room') {
      void load();
      if (data.type === 'room')
        chatApi
          .details(room.id)
          .then((result) => setMembers(result.members))
          .catch(() => undefined);
    }
  });

  const older = async () => {
    const first = messages[0];
    if (!first) return;
    stick.current = false;
    const box = scroller.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;
    const result = await chatApi.messages(room.id, first.id);
    setMessages((current) => [...result.messages, ...current]);
    setMore(result.more);
    requestAnimationFrame(() => {
      if (box) box.scrollTop = box.scrollHeight - before;
    });
  };

  const react = async (message: ChatMessage, emoji: string) => {
    try {
      const result = await chatApi.react(message.id, emoji);
      setMessages((current) => current.map((entry) => (entry.id === message.id ? { ...entry, reactions: result.reactions } : entry)));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const remove = async (message: ChatMessage) => {
    if (
      !(await confirm({
        title: t('Nachricht löschen?'),
        text: t('Sie verschwindet für alle im Chat.'),
        confirm: t('Löschen'),
        danger: true,
      }))
    )
      return;
    try {
      await chatApi.remove(message.id);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const rename = async () => {
    const name = await prompt({ title: t('Gruppe umbenennen'), label: t('Name'), value: room.name, confirm: t('Speichern') });
    if (!name) return;
    try {
      await api.patch(`/api/chat/rooms/${room.id}`, { name });
      onRoomsChanged();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const leave = async () => {
    const group = room.kind === 'group';
    if (
      !(await confirm({
        title: group ? t('Gruppe verlassen?') : t('Chat ausblenden?'),
        text: group ? undefined : t('Bei einer neuen Nachricht taucht er wieder auf.'),
        confirm: group ? t('Verlassen') : t('Ausblenden'),
        danger: group,
      }))
    )
      return;
    try {
      await api.delete(`/api/chat/rooms/${room.id}/members/${me().id}`);
      onRoomsChanged();
      onBack();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const toggle = async (patch: { muted?: boolean; pinned?: boolean }) => {
    await chatApi.settings(room.id, patch).catch((error) => toast(errorText(error)));
    onRoomsChanged();
  };

  const subtitle =
    room.kind === 'direct'
      ? statusLine(room.other?.status) || `@${room.other?.username ?? ''}`
      : room.kind === 'group'
        ? tn(room.members, 'Eine Person', '{count} Personen')
        : t('Nur für dich, auf allen Geräten');

  let lastDay = '';
  return (
    <Box
      data-chat-room={room.id}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        height: { xs: 'calc(100dvh - var(--moe-header, 64px) - 80px - env(safe-area-inset-bottom))', md: '100%' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, borderBottom: `1px solid ${c.outlineVariant}` }}>
        {showBack && (
          <IconButton onClick={onBack} aria-label={t('Zurück')}>
            <ArrowBackRounded />
          </IconButton>
        )}
        <RoomAvatar room={room} size={40} />
        <ButtonBase
          onClick={() => room.kind !== 'self' && setShowMembers(true)}
          sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', borderRadius: `${radius.sm}px`, px: 0.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {roomTitle(room)}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
              {subtitle}
            </Typography>
          </Box>
        </ButtonBase>
        <IconButton onClick={(event) => setMenu(event.currentTarget)} aria-label={t('Mehr')} aria-haspopup="menu">
          <MoreVertRounded />
        </IconButton>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} onClick={() => setMenu(null)}>
          {room.kind !== 'self' && (
            <MenuItem onClick={() => setShowMembers(true)}>
              <ListItemIcon>{room.kind === 'group' ? <PersonAddAlt1Rounded /> : <GroupsRounded />}</ListItemIcon>
              {room.kind === 'group' ? t('Personen verwalten') : t('Details')}
            </MenuItem>
          )}
          {room.kind === 'group' && (
            <MenuItem onClick={() => void rename()}>
              <ListItemIcon>
                <EditRounded />
              </ListItemIcon>
              {t('Umbenennen')}
            </MenuItem>
          )}
          <MenuItem onClick={() => void toggle({ pinned: !room.pinned })}>
            <ListItemIcon>{room.pinned ? <PushPinRounded /> : <PushPinOutlined />}</ListItemIcon>
            {room.pinned ? t('Nicht mehr anheften') : t('Anheften')}
          </MenuItem>
          {room.kind !== 'self' && (
            <MenuItem onClick={() => void toggle({ muted: !room.muted })}>
              <ListItemIcon>{room.muted ? <NotificationsOutlined /> : <NotificationsOffOutlined />}</ListItemIcon>
              {room.muted ? t('Wieder benachrichtigen') : t('Stummschalten')}
            </MenuItem>
          )}
          {room.kind !== 'self' && (
            <MenuItem onClick={() => void leave()} sx={{ color: c.error }}>
              <ListItemIcon sx={{ color: 'inherit' }}>
                <LogoutRounded />
              </ListItemIcon>
              {room.kind === 'group' ? t('Gruppe verlassen') : t('Chat ausblenden')}
            </MenuItem>
          )}
        </Menu>
      </Box>
      <Box
        ref={scroller}
        onScroll={() => {
          const box = scroller.current;
          if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
        sx={{ flex: 1, overflowY: 'auto', py: 1, overscrollBehavior: 'contain' }}
        data-no-pull
      >
        {loading && <LinearProgress sx={{ mx: 2 }} />}
        {more && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <Button size="small" onClick={() => void older()}>
              {t('Ältere Nachrichten')}
            </Button>
          </Box>
        )}
        {!loading && !messages.length && (
          <EmptyState
            icon={room.kind === 'self' ? <BookmarkRounded /> : <ForumRounded />}
            title={room.kind === 'self' ? t('Deine Ablage') : t('Noch keine Nachrichten')}
            text={
              room.kind === 'self'
                ? t('Schick dir Notizen, Links und Dateien. Sie sind sofort auf all deinen Geräten.')
                : t('Schreib die erste Nachricht.')
            }
            compact
          />
        )}
        {messages.map((message, index) => {
          const day = dayLabel(message.createdAt);
          const previous = messages[index - 1];
          const first =
            !previous ||
            previous.user?.id !== message.user?.id ||
            previous.kind !== message.kind ||
            message.createdAt - previous.createdAt > 5 * 60_000 ||
            day !== lastDay;
          const separator = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={message.id}>
              {separator && (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.5 }}>
                  <Chip size="small" label={day} sx={{ bgcolor: c.surfaceContainerHigh }} />
                </Box>
              )}
              <MessageBubble
                message={message}
                room={room}
                first={first}
                canDelete={room.kind === 'group' && room.role === 'owner'}
                onReply={() => {
                  setEditing(null);
                  setReply(message);
                }}
                onEdit={() => {
                  setReply(null);
                  setEditing(message);
                }}
                onDelete={() => void remove(message)}
                onReact={(emoji) => void react(message, emoji)}
              />
            </Fragment>
          );
        })}
      </Box>
      <Composer
        room={room}
        members={members}
        reply={reply}
        editing={editing}
        onCancel={() => {
          setReply(null);
          setEditing(null);
        }}
        onSent={(message) => {
          stick.current = true;
          setReply(null);
          setMessages((current) => (current.some((entry) => entry.id === message.id) ? current : [...current, message]));
          onRoomsChanged();
        }}
      />
      <MembersDialog room={room} open={showMembers} onClose={() => setShowMembers(false)} onChanged={onRoomsChanged} />
    </Box>
  );
}

function RoomRow({
  room,
  active,
  onOpen,
  onToggle,
}: {
  room: Room;
  active: boolean;
  onOpen: () => void;
  onToggle: (patch: { muted?: boolean; pinned?: boolean }) => void;
}) {
  const preview = room.last
    ? room.last.kind === 'system'
      ? systemText(room.last.preview, t) || t('Neuigkeiten in der Gruppe')
      : room.last.deleted
        ? t('Nachricht gelöscht')
        : `${room.last.by === 'me' ? `${t('Du')}: ` : room.kind === 'group' && room.last.by ? `${room.last.by.split(' ')[0]}: ` : ''}${room.last.preview}`
    : room.kind === 'self'
      ? t('Notizen, Links und Dateien für dich')
      : t('Noch keine Nachrichten');
  return (
    <SwipeRow
      start={{
        icon: room.pinned ? <PushPinOutlined /> : <PushPinRounded />,
        label: room.pinned ? t('Lösen') : t('Anheften'),
        color: c.onPrimaryContainer,
        background: c.primaryContainer,
        run: () => onToggle({ pinned: !room.pinned }),
      }}
      end={
        room.kind === 'self'
          ? undefined
          : {
              icon: room.muted ? <NotificationsOutlined /> : <NotificationsOffOutlined />,
              label: room.muted ? t('Laut') : t('Stumm'),
              color: c.onTertiaryContainer,
              background: c.tertiaryContainer,
              run: () => onToggle({ muted: !room.muted }),
            }
      }
    >
      <ButtonBase
        onClick={onOpen}
        data-chat-room-row={room.kind === 'self' ? 'self' : room.name}
        aria-current={active ? 'page' : undefined}
        sx={{
          width: '100%',
          justifyContent: 'flex-start',
          gap: 1.5,
          px: 1.5,
          py: 1.25,
          borderRadius: { md: `${radius.md}px` },
          bgcolor: active ? c.secondaryContainer : 'transparent',
          textAlign: 'left',
          '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
        }}
      >
        <RoomAvatar room={room} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: room.unread ? 800 : 600, color: c.onSurface }}>
              {roomTitle(room)}
            </Typography>
            {room.pinned && <PushPinRounded sx={{ fontSize: 14, color: c.onSurfaceVariant }} />}
            {room.muted && <NotificationsOffOutlined sx={{ fontSize: 14, color: c.onSurfaceVariant }} />}
            <Typography variant="caption" sx={{ color: room.unread ? c.primary : c.onSurfaceVariant, fontWeight: room.unread ? 700 : 400 }}>
              {room.last ? shortTime(room.lastAt) : ''}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" noWrap sx={{ flex: 1, color: room.unread ? c.onSurface : c.onSurfaceVariant }}>
              {preview}
            </Typography>
            {room.mentions > 0 && <Chip size="small" label="@" color="primary" sx={{ height: 20, '& .MuiChip-label': { px: 0.75 } }} />}
            {room.unread > 0 && (
              <Badge
                badgeContent={room.unread}
                color={room.muted ? 'default' : 'primary'}
                max={99}
                sx={{ mr: 1.25, '& .MuiBadge-badge': { position: 'static', transform: 'none' } }}
              />
            )}
          </Box>
        </Box>
      </ButtonBase>
    </SwipeRow>
  );
}

export function ChatApp() {
  const { query } = useLocation();
  const medium = useMediaQuery('(min-width: 900px)');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const roomId = query.get('room');
  const room = rooms?.find((entry) => entry.id === roomId) ?? null;

  const load = useCallback(async () => {
    try {
      setRooms((await chatApi.rooms()).rooms);
    } catch (error) {
      toast(errorText(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 300);
  }, [load]);

  useLive((event) => {
    if (event === 'chat' || event === 'reconnect' || event === 'status') reload();
  });

  useEffect(() => {
    if (!rooms || roomId || !medium) return;
    const first = rooms[0];
    if (first) navigate(`/chat?room=${first.id}`, { replace: true });
  }, [rooms, roomId, medium]);

  const open = (id: string | null) => navigate(id ? `/chat?room=${id}` : '/chat');
  const toggle = async (target: Room, patch: { muted?: boolean; pinned?: boolean }) => {
    await chatApi.settings(target.id, patch).catch((error) => toast(errorText(error)));
    void load();
  };

  const shown = (rooms ?? []).filter((entry) => !filter.trim() || roomTitle(entry).toLowerCase().includes(filter.trim().toLowerCase()));

  const list = (
    <Box
      data-chat-rooms
      sx={{
        width: { md: 340 },
        flex: { xs: 1, md: 'none' },
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: { md: `1px solid ${c.outlineVariant}` },
      }}
    >
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
        <Typography variant="h6" component="h1" sx={{ flex: 1, fontWeight: 700 }}>
          {t('Chat')}
        </Typography>
        <Tooltip title={t('Neuer Chat')}>
          <IconButton onClick={() => setCreating(true)} aria-label={t('Neuer Chat')} data-chat-new-button>
            <GroupAddRounded />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, overflowY: { md: 'auto' }, px: { md: 0.5 }, pb: 2 }}>
        <PullToRefresh onRefresh={load}>
          {!rooms && <LinearProgress sx={{ mx: 1.5 }} />}
          {shown.map((entry) => (
            <RoomRow
              key={entry.id}
              room={entry}
              active={entry.id === roomId}
              onOpen={() => open(entry.id)}
              onToggle={(patch) => void toggle(entry, patch)}
            />
          ))}
          {rooms && rooms.length <= 1 && (
            <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mb: 1.5 }}>
                {t('Schreib Leuten auf diesem Server, einzeln oder in Gruppen.')}
              </Typography>
              <Button variant="tonal" startIcon={<AddCommentRounded />} onClick={() => setCreating(true)}>
                {t('Neuer Chat')}
              </Button>
            </Box>
          )}
        </PullToRefresh>
      </Box>
    </Box>
  );

  const conversation = room ? (
    <Conversation key={room.id} room={room} showBack={!medium} onBack={() => open(null)} onRoomsChanged={reload} />
  ) : (
    <Box sx={{ flex: 1, display: { xs: 'none', md: 'grid' }, placeItems: 'center' }}>
      <EmptyState icon={<ForumRounded />} title={t('Wähl einen Chat aus')} compact />
    </Box>
  );

  return (
    <AppShell
      active="chat"
      topBar={
        <Box
          role="search"
          sx={{
            flex: 1,
            maxWidth: 720,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            height: 48,
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          <SearchRounded sx={{ color: c.onSurfaceVariant }} />
          <InputBase
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              if (room && !medium) open(null);
            }}
            placeholder={t('Chats durchsuchen')}
            sx={{ flex: 1 }}
            inputProps={{ 'aria-label': t('Chats durchsuchen'), enterKeyHint: 'search' }}
          />
          {filter && (
            <IconButton size="small" onClick={() => setFilter('')} aria-label={t('Suche leeren')}>
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      }
      mobileAction={
        !room ? (
          <Fab color="primary" aria-label={t('Neuer Chat')} onClick={() => setCreating(true)}>
            <AddCommentRounded />
          </Fab>
        ) : undefined
      }
    >
      <Box sx={{ display: 'flex', height: { md: '100%' }, minHeight: 0 }}>
        {(medium || !room) && list}
        {(medium || room) && conversation}
      </Box>
      <NewChatDialog
        open={creating}
        onClose={() => setCreating(false)}
        onOpen={(created) => {
          setCreating(false);
          void load().then(() => open(created.id));
        }}
      />
    </AppShell>
  );
}
