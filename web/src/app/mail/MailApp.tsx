import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DraftsOutlined from '@mui/icons-material/DraftsOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditRounded from '@mui/icons-material/EditRounded';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import FlagRounded from '@mui/icons-material/FlagRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ForwardRounded from '@mui/icons-material/ForwardRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import InboxRounded from '@mui/icons-material/InboxRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import MarkEmailReadOutlined from '@mui/icons-material/MarkEmailReadOutlined';
import MarkEmailUnreadOutlined from '@mui/icons-material/MarkEmailUnreadOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import OutboxRounded from '@mui/icons-material/OutboxRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import ReplyAllRounded from '@mui/icons-material/ReplyAllRounded';
import ReplyRounded from '@mui/icons-material/ReplyRounded';
import ReportOutlined from '@mui/icons-material/ReportOutlined';
import SaveAltRounded from '@mui/icons-material/SaveAltRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import UnsubscribeRounded from '@mui/icons-material/UnsubscribeRounded';
import { api, errorText } from '../../lib/api';
import { refreshBadges } from '../../lib/badges';
import { featureOn } from '../../lib/features';
import { formatBytes, formatDate, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { navigate, useLocation } from '../../lib/router';
import { c, mix, radius } from '../../theme/tokens';
import { prompt } from '../common/dialogs';
import { EmptyState } from '../common/bits';
import { PullToRefresh, SwipeRow } from '../common/touch';
import { toast } from '../common/toast';
import { AppShell } from '../shell/AppShell';
import { AccountDialog } from './AccountDialog';
import { Composer } from './Composer';
import {
  attachmentUrl,
  bodyUrl,
  draftState,
  emptyCompose,
  formatAddress,
  initialsOf,
  mailApi,
  personName,
  replyState,
  roleLabel,
  type AccountsInfo,
  type ComposeState,
  type Folder,
  type MailAccount,
  type Message,
  type Outbox,
  type Summary,
} from './model';

type Filter = 'unread' | 'flagged' | 'attachments' | null;

const ROLE_ICONS: Record<string, ReactNode> = {
  inbox: <InboxRounded />,
  sent: <SendRounded />,
  drafts: <DraftsOutlined />,
  trash: <DeleteOutlineRounded />,
  junk: <ReportOutlined />,
  archive: <ArchiveOutlined />,
};

function hue(text: string) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 360;
  return value;
}

function SenderAvatar({ summary, selected, onToggle }: { summary: Pick<Summary, 'from'>; selected: boolean; onToggle?: () => void }) {
  const sender = summary.from[0];
  const tint = hue(sender?.address ?? '?');
  return (
    <ButtonBase
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      aria-label={selected ? t('Auswahl aufheben') : t('Auswählen')}
      aria-pressed={selected}
      sx={{ borderRadius: '50%', flex: 'none' }}
    >
      <Avatar
        sx={{
          width: 40,
          height: 40,
          fontSize: '0.875rem',
          fontWeight: 700,
          bgcolor: selected ? c.primary : `hsl(${tint} 45% 45%)`,
          color: selected ? c.onPrimary : '#fff',
        }}
      >
        {selected ? '✓' : initialsOf(sender)}
      </Avatar>
    </ButtonBase>
  );
}

function FolderList({
  info,
  folders,
  account,
  folder,
  outbox,
  onPick,
  onAdd,
  onEdit,
  onOutbox,
  onCreate,
}: {
  info: AccountsInfo;
  folders: Record<string, Folder[] | undefined>;
  account: string;
  folder: string;
  outbox: number;
  onPick: (account: string, folder: string) => void;
  onAdd: () => void;
  onEdit: (account: MailAccount) => void;
  onOutbox: () => void;
  onCreate: (account: string) => void;
}) {
  return (
    <Box
      component="nav"
      aria-label={t('Postfächer und Ordner')}
      data-mail-folders
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, py: 1 }}
    >
      {info.accounts.map((entry) => (
        <Fragment key={entry.id}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5, pb: 0.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>
                {entry.name}
              </Typography>
              <Typography variant="caption" sx={{ color: entry.error ? c.error : c.onSurfaceVariant }} noWrap component="p">
                {entry.error ? t('Verbindung gestört') : entry.email}
              </Typography>
            </Box>
            <IconButton size="small" aria-label={t('Einstellungen für {name}', { name: entry.name })} onClick={() => onEdit(entry)}>
              <SettingsRounded fontSize="small" />
            </IconButton>
          </Box>
          {(folders[entry.id] ?? []).map((item) => {
            const active = entry.id === account && item.path === folder;
            return (
              <ButtonBase
                key={item.path}
                disabled={!item.selectable}
                onClick={() => onPick(entry.id, item.path)}
                data-mail-folder={item.role ?? item.path}
                aria-current={active ? 'page' : undefined}
                sx={{
                  justifyContent: 'flex-start',
                  gap: 1.5,
                  mx: 1,
                  pl: 2 + item.depth * 1.5,
                  pr: 1.5,
                  height: 44,
                  borderRadius: `${radius.full}px`,
                  fontSize: '0.875rem',
                  fontWeight: active || item.unseen ? 700 : 500,
                  color: active ? c.onSecondaryContainer : c.onSurfaceVariant,
                  bgcolor: active ? c.secondaryContainer : 'transparent',
                  '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 8) },
                  '& svg': { fontSize: 20 },
                }}
              >
                {ROLE_ICONS[item.role ?? ''] ?? <FolderOutlined />}
                <Box
                  component="span"
                  sx={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {roleLabel(item)}
                </Box>
                {item.unseen > 0 && item.role !== 'sent' && item.role !== 'trash' && (
                  <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                    {item.unseen}
                  </Box>
                )}
              </ButtonBase>
            );
          })}
          {folders[entry.id] && (
            <Button size="small" startIcon={<AddRounded />} sx={{ alignSelf: 'flex-start', ml: 2 }} onClick={() => onCreate(entry.id)}>
              {t('Ordner')}
            </Button>
          )}
        </Fragment>
      ))}
      {outbox > 0 && (
        <ButtonBase
          onClick={onOutbox}
          sx={{
            justifyContent: 'flex-start',
            gap: 1.5,
            mx: 1,
            px: 2,
            height: 44,
            borderRadius: `${radius.full}px`,
            color: c.onSurfaceVariant,
          }}
        >
          <OutboxRounded />
          <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
            {t('Postausgang')}
          </Box>
          {outbox}
        </ButtonBase>
      )}
      <Divider sx={{ my: 1 }} />
      {info.accounts.length < info.limit && (
        <Button startIcon={<AddRounded />} onClick={onAdd} sx={{ alignSelf: 'flex-start', ml: 1 }} data-mail-add>
          {t('Postfach verbinden')}
        </Button>
      )}
    </Box>
  );
}

function MessageRow({
  item,
  active,
  selected,
  onOpen,
  onToggle,
  onFlag,
  onSwipeRead,
  onSwipeDelete,
}: {
  item: Summary;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onFlag: () => void;
  onSwipeRead: () => void;
  onSwipeDelete: () => void;
}) {
  const sender = item.draft ? t('Entwurf') : personName(item.from[0]) || t('Unbekannt');
  return (
    <SwipeRow
      surface={c.surface}
      start={{
        icon: item.seen ? <MarkEmailUnreadOutlined /> : <MarkEmailReadOutlined />,
        label: item.seen ? t('Ungelesen') : t('Gelesen'),
        color: c.onPrimaryContainer,
        background: c.primaryContainer,
        run: onSwipeRead,
      }}
      end={{
        icon: <DeleteOutlineRounded />,
        label: t('Löschen'),
        color: c.onErrorContainer,
        background: c.errorContainer,
        run: onSwipeDelete,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        data-mail-row={item.uid}
        data-unread={item.seen ? undefined : ''}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOpen();
        }}
        sx={{
          display: 'flex',
          gap: 1.5,
          alignItems: 'flex-start',
          px: 1.5,
          py: 1.25,
          cursor: 'pointer',
          borderRadius: { md: `${radius.md}px` },
          bgcolor: active ? c.secondaryContainer : selected ? mix(c.primary, 10) : 'transparent',
          '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
          '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
        }}
      >
        <SenderAvatar summary={item} selected={selected} onToggle={onToggle} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            {!item.seen && (
              <Box
                aria-label={t('Ungelesen')}
                sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c.primary, flex: 'none', alignSelf: 'center' }}
              />
            )}
            <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: item.seen ? 500 : 800, color: c.onSurface }}>
              {sender}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: item.seen ? c.onSurfaceVariant : c.primary, fontWeight: item.seen ? 400 : 700, flex: 'none' }}
            >
              {formatDate(item.date)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{ flex: 1, color: item.seen ? c.onSurfaceVariant : c.onSurface, fontWeight: item.seen ? 400 : 600 }}
            >
              {item.answered && <ReplyRounded sx={{ fontSize: 14, mr: 0.5, verticalAlign: '-2px', color: c.onSurfaceVariant }} />}
              {item.forwarded && <ForwardRounded sx={{ fontSize: 14, mr: 0.5, verticalAlign: '-2px', color: c.onSurfaceVariant }} />}
              {item.subject || t('(kein Betreff)')}
            </Typography>
            {item.attachments && <AttachFileRounded sx={{ fontSize: 16, color: c.onSurfaceVariant }} aria-label={t('Mit Anhang')} />}
            <IconButton
              size="small"
              aria-label={item.flagged ? t('Markierung entfernen') : t('Markieren')}
              onClick={(event) => {
                event.stopPropagation();
                onFlag();
              }}
              sx={{ p: 0.25, color: item.flagged ? c.error : c.outline }}
            >
              {item.flagged ? <FlagRounded fontSize="small" /> : <FlagOutlined fontSize="small" />}
            </IconButton>
          </Box>
        </Box>
      </Box>
    </SwipeRow>
  );
}

function AddressLine({ label, list }: { label: string; list: Message['to'] }) {
  if (!list.length) return null;
  return (
    <Typography variant="body2" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
      <Box component="span" sx={{ fontWeight: 600, mr: 0.5 }}>
        {label}:
      </Box>
      {list.map(formatAddress).join(', ')}
    </Typography>
  );
}

function InviteCard({ message, onImport }: { message: Message; onImport: () => void }) {
  const invite = message.invite!;
  const when = (value: string | null) => {
    if (!value) return '';
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value);
    if (!match) return value;
    const [, year, month, day, hour, minute, second, utc] = match;
    if (!hour)
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date(Number(year), Number(month) - 1, Number(day)));
    const date = utc
      ? new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
      : new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(date);
  };
  return (
    <Box
      data-mail-invite
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        p: 1.5,
        borderRadius: `${radius.md}px`,
        bgcolor: c.tertiaryContainer,
        color: c.onTertiaryContainer,
        flexWrap: 'wrap',
      }}
    >
      <CalendarMonthRounded />
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography variant="subtitle2">
          {invite.method === 'CANCEL' ? t('Absage: {title}', { title: invite.summary }) : invite.summary}
        </Typography>
        <Typography variant="body2">{[when(invite.start), invite.location].filter(Boolean).join(' · ')}</Typography>
        {invite.organizer && <Typography variant="caption">{t('Von {name}', { name: invite.organizer })}</Typography>}
      </Box>
      {featureOn('calendar') && invite.method !== 'CANCEL' && (
        <Button variant="contained" size="small" onClick={onImport} data-mail-invite-import>
          {t('In den Kalender')}
        </Button>
      )}
    </Box>
  );
}

function Reader({
  account,
  message,
  loading,
  onBack,
  onReply,
  onArchive,
  onDelete,
  onToggleSeen,
  onToggleFlag,
  onMove,
  onEditDraft,
  showBack,
}: {
  account: MailAccount;
  message: Message | null;
  loading: boolean;
  onBack: () => void;
  onReply: (mode: 'reply' | 'all' | 'forward') => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleSeen: () => void;
  onToggleFlag: () => void;
  onMove: () => void;
  onEditDraft: () => void;
  showBack: boolean;
}) {
  const [images, setImages] = useState(false);
  const [more, setMore] = useState<HTMLElement | null>(null);
  useEffect(() => setImages(Boolean(message?.trusted)), [message?.uid, message?.trusted]);
  if (!message) {
    return (
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 4 }}>
        {loading ? (
          <LinearProgress sx={{ width: 200 }} />
        ) : (
          <EmptyState icon={<MailOutlineRounded />} title={t('Wähl eine E-Mail aus')} compact />
        )}
      </Box>
    );
  }
  const sender = message.from[0];
  const saveAttachments = async (indexes: number[]) => {
    try {
      const result = await api.post<{ nodes: { id: string; name: string }[]; folder: { id: string; name: string } }>(
        `/api/mail/accounts/${account.id}/save`,
        { folder: message.folder, uid: message.uid, indexes }
      );
      toast(
        tn(result.nodes.length, 'Eine Datei liegt jetzt in „{folder}“', '{count} Dateien liegen jetzt in „{folder}“', {
          folder: result.folder.name || t('Meine Dateien'),
        }),
        {
          action: { label: t('Öffnen'), onClick: () => (location.href = `/files/folder/${result.folder.id}`) },
        }
      );
    } catch (error) {
      toast(errorText(error));
    }
  };
  const importInvite = async () => {
    try {
      const calendars = await api.get<{ calendars: { id: string; name: string; access?: string; readOnly?: boolean }[] }>(
        '/api/calendar/calendars'
      );
      const target = calendars.calendars[0];
      if (!target) throw new Error(t('Du hast noch keinen Kalender'));
      await api.post(`/api/mail/accounts/${account.id}/invite`, { folder: message.folder, uid: message.uid, calendar: target.id });
      toast(t('Im Kalender „{name}“ eingetragen', { name: target.name }), {
        action: { label: t('Öffnen'), onClick: () => (location.href = '/calendar') },
      });
    } catch (error) {
      toast(errorText(error));
    }
  };
  const asTask = async () => {
    const title = await prompt({
      title: t('Als Aufgabe übernehmen'),
      label: t('Titel'),
      value: message.subject || t('E-Mail von {name}', { name: personName(sender) }),
      confirm: t('Anlegen'),
    });
    if (!title) return;
    try {
      const calendars = await api.get<{ calendars: { id: string; components?: string }[] }>('/api/calendar/calendars');
      const target = calendars.calendars.find((entry) => !entry.components || entry.components.includes('VTODO')) ?? calendars.calendars[0];
      await api.post('/api/calendar/events', {
        calendarId: target.id,
        component: 'VTODO',
        title,
        description: `${t('Von')}: ${sender ? formatAddress(sender) : ''}\n${t('Betreff')}: ${message.subject}\n${location.origin}/mail?account=${account.id}&folder=${encodeURIComponent(message.folder)}&uid=${message.uid}`,
      });
      toast(t('Aufgabe angelegt'), { action: { label: t('Öffnen'), onClick: () => (location.href = '/calendar/tasks') } });
    } catch (error) {
      toast(errorText(error));
    }
  };
  const saveContact = async () => {
    if (!sender) return;
    try {
      const books = await api.get<{ books: { id: string; access: string }[] }>('/api/contacts/books');
      const book = books.books.find((entry) => entry.access !== 'read') ?? books.books[0];
      const [given, ...rest] = (sender.name || sender.address.split('@')[0]).split(' ');
      await api.post('/api/contacts', {
        bookId: book.id,
        data: { given, family: rest.join(' '), emails: [{ type: 'other', value: sender.address, label: '' }] },
      });
      toast(t('Zu den Kontakten hinzugefügt'));
    } catch (error) {
      toast(errorText(error));
    }
  };
  const trust = async () => {
    if (!sender) return;
    setImages(true);
    await api.post('/api/mail/senders/trust', { address: sender.address, trusted: true }).catch(() => undefined);
  };
  const draft = message.flags.draft;
  return (
    <Box
      data-mail-reader
      sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: { xs: 'calc(100dvh - 160px)', md: 0 } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, flexWrap: 'wrap' }}>
        {showBack && (
          <IconButton onClick={onBack} aria-label={t('Zurück')}>
            <ArrowBackRounded />
          </IconButton>
        )}
        <Box sx={{ flex: 1 }} />
        {draft ? (
          <Button variant="contained" startIcon={<EditRounded />} onClick={onEditDraft}>
            {t('Weiterschreiben')}
          </Button>
        ) : (
          <>
            <Tooltip title={t('Antworten')}>
              <IconButton onClick={() => onReply('reply')} aria-label={t('Antworten')} data-mail-reply>
                <ReplyRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Allen antworten')}>
              <IconButton onClick={() => onReply('all')} aria-label={t('Allen antworten')}>
                <ReplyAllRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Weiterleiten')}>
              <IconButton onClick={() => onReply('forward')} aria-label={t('Weiterleiten')}>
                <ForwardRounded />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title={t('Archivieren')}>
          <IconButton onClick={onArchive} aria-label={t('Archivieren')}>
            <ArchiveOutlined />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Löschen')}>
          <IconButton onClick={onDelete} aria-label={t('Löschen')}>
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
        <IconButton onClick={(event) => setMore(event.currentTarget)} aria-label={t('Mehr')} aria-haspopup="menu">
          <MoreVertRounded />
        </IconButton>
        <Menu anchorEl={more} open={Boolean(more)} onClose={() => setMore(null)} onClick={() => setMore(null)}>
          <MenuItem onClick={onToggleSeen}>
            <ListItemIcon>{message.flags.seen ? <MarkEmailUnreadOutlined /> : <MarkEmailReadOutlined />}</ListItemIcon>
            {message.flags.seen ? t('Als ungelesen markieren') : t('Als gelesen markieren')}
          </MenuItem>
          <MenuItem onClick={onToggleFlag}>
            <ListItemIcon>{message.flags.flagged ? <FlagRounded /> : <FlagOutlined />}</ListItemIcon>
            {message.flags.flagged ? t('Markierung entfernen') : t('Markieren')}
          </MenuItem>
          <MenuItem onClick={onMove}>
            <ListItemIcon>
              <DriveFileMoveOutlined />
            </ListItemIcon>
            {t('Verschieben …')}
          </MenuItem>
          {featureOn('tasks') && (
            <MenuItem onClick={() => void asTask()}>
              <ListItemIcon>
                <TaskAltRounded />
              </ListItemIcon>
              {t('Als Aufgabe übernehmen')}
            </MenuItem>
          )}
          {featureOn('contacts') && sender && (
            <MenuItem onClick={() => void saveContact()}>
              <ListItemIcon>
                <PersonAddAlt1Rounded />
              </ListItemIcon>
              {t('Absender zu Kontakten')}
            </MenuItem>
          )}
          {message.unsubscribe && (
            <MenuItem
              component="a"
              href={message.unsubscribe.web ?? `mailto:${message.unsubscribe.mail}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ListItemIcon>
                <UnsubscribeRounded />
              </ListItemIcon>
              {t('Abbestellen')}
            </MenuItem>
          )}
          <MenuItem
            component="a"
            href={`/api/mail/accounts/${account.id}/source?folder=${encodeURIComponent(message.folder)}&uid=${message.uid}`}
          >
            <ListItemIcon>
              <CodeRounded />
            </ListItemIcon>
            {t('Original herunterladen')}
          </MenuItem>
        </Menu>
      </Box>
      <Box sx={{ px: { xs: 2, md: 3 }, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }} data-mail-subject>
          {message.subject || t('(kein Betreff)')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <SenderAvatar summary={message} selected={false} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap>
              {personName(sender)}
              {sender?.name && (
                <Box component="span" sx={{ color: c.onSurfaceVariant, fontWeight: 400, ml: 0.75 }}>
                  {sender.address}
                </Box>
              )}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {formatDateTime(message.date)}
            </Typography>
          </Box>
        </Box>
        <AddressLine label={t('An')} list={message.to} />
        <AddressLine label={t('Cc')} list={message.cc} />
        <AddressLine label={t('Bcc')} list={message.bcc} />
        {message.invite && <InviteCard message={message} onImport={() => void importInvite()} />}
        {message.remote && !images && (
          <Alert severity="info" icon={<ImageRounded />} data-mail-images>
            {t('Bilder aus dem Internet sind blockiert, so erfährt niemand, wann du die E-Mail öffnest.')}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              <Button size="small" variant="tonal" onClick={() => setImages(true)} data-mail-load-images>
                {t('Bilder laden')}
              </Button>
              {sender && (
                <Button size="small" onClick={() => void trust()}>
                  {t('Immer von {name}', { name: personName(sender) })}
                </Button>
              )}
            </Box>
          </Alert>
        )}
        {message.attachments.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }} data-mail-attachments>
            {message.attachments.map((file) => (
              <Chip
                key={file.index}
                icon={<AttachFileRounded />}
                label={`${file.name} · ${formatBytes(file.size)}`}
                component="a"
                href={attachmentUrl(account.id, message.folder, message.uid, file.index)}
                clickable
                onDelete={() => void saveAttachments([file.index])}
                deleteIcon={
                  <Tooltip title={t('In Dateien speichern')}>
                    <SaveAltRounded />
                  </Tooltip>
                }
                sx={{ maxWidth: '100%' }}
              />
            ))}
            {message.attachments.length > 1 && (
              <Button
                size="small"
                startIcon={<DownloadRounded />}
                onClick={() => void saveAttachments(message.attachments.map((file) => file.index))}
              >
                {t('Alle in Dateien speichern')}
              </Button>
            )}
          </Box>
        )}
      </Box>
      <Box
        component="iframe"
        key={`${message.folder}-${message.uid}-${images}`}
        src={bodyUrl(account.id, message.folder, message.uid, images)}
        title={message.subject || t('E-Mail')}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        data-mail-body
        sx={{
          flex: 1,
          minHeight: { xs: '60dvh', md: 320 },
          width: '100%',
          border: 0,
          borderRadius: { md: `${radius.md}px` },
          bgcolor: '#fff',
        }}
      />
    </Box>
  );
}

function useMessages(account: string | null, folder: string, q: string, filter: Filter) {
  const [state, setState] = useState<{
    key: string;
    items: Summary[];
    more: boolean;
    total: number;
    loading: boolean;
    error: string | null;
  }>({
    key: '',
    items: [],
    more: false,
    total: 0,
    loading: false,
    error: null,
  });
  const key = `${account}|${folder}|${q}|${filter}`;
  const load = useCallback(
    async (offset = 0, quiet = false) => {
      if (!account) return;
      if (!quiet)
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
          ...(offset === 0 && current.key !== key ? { items: [], key } : {}),
        }));
      try {
        const result = await mailApi.messages(account, { folder, offset, q, filter });
        setState((current) => {
          const base = offset === 0 ? [] : current.items;
          const seen = new Set(base.map((item) => item.uid));
          return {
            key,
            items: [...base, ...result.items.filter((item) => !seen.has(item.uid))],
            more: result.more,
            total: result.total,
            loading: false,
            error: null,
          };
        });
      } catch (error) {
        setState((current) => ({ ...current, key, loading: false, error: errorText(error) }));
      }
    },
    [account, folder, q, filter, key]
  );
  useEffect(() => {
    void load(0);
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(0, true);
    }, 60_000);
    const visible = () => {
      if (document.visibilityState === 'visible') void load(0, true);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  const patch = (uids: number[], change: Partial<Summary> | null) =>
    setState((current) => ({
      ...current,
      items: change
        ? current.items.map((item) => (uids.includes(item.uid) ? { ...item, ...change } : item))
        : current.items.filter((item) => !uids.includes(item.uid)),
    }));
  return { ...state, load, patch, stale: state.key !== key };
}

export function MailApp() {
  const { query } = useLocation();
  const wide = useMediaQuery('(min-width: 1280px)');
  const medium = useMediaQuery('(min-width: 900px)');
  const [info, setInfo] = useState<AccountsInfo | null>(null);
  const [folders, setFolders] = useState<Record<string, Folder[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ account: MailAccount | null } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [opening, setOpening] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [search, setSearch] = useState(query.get('q') ?? '');
  const accountId = query.get('account') ?? info?.accounts[0]?.id ?? null;
  const folder = query.get('folder') ?? 'INBOX';
  const uid = Number(query.get('uid')) || null;
  const q = query.get('q') ?? '';
  const filter = (query.get('filter') as Filter) ?? null;
  const account = info?.accounts.find((entry) => entry.id === accountId) ?? info?.accounts[0] ?? null;
  const list = useMessages(account?.id ?? null, folder, q, filter);
  const listRef = useRef(list);
  listRef.current = list;

  const go = (params: Record<string, string | number | null>, replace = false) => {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === '') url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    navigate(url.pathname + url.search, { replace });
  };

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await mailApi.accounts());
    } catch (reason) {
      setError(errorText(reason));
    }
  }, []);

  const loadFolders = useCallback(async (id: string) => {
    try {
      const result = await mailApi.folders(id);
      setFolders((current) => ({ ...current, [id]: result.folders }));
    } catch (reason) {
      setFolders((current) => ({ ...current, [id]: current[id] ?? [] }));
      toast(errorText(reason));
    }
  }, []);

  const loadOutbox = useCallback(() => {
    mailApi
      .outbox()
      .then((result) => setOutbox(result.outbox))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadInfo();
    loadOutbox();
  }, [loadInfo, loadOutbox]);

  useEffect(() => {
    for (const entry of info?.accounts ?? []) if (!folders[entry.id]) void loadFolders(entry.id);
  }, [info]);

  useEffect(() => {
    if (!info || !account) return;
    const to = query.get('to');
    const attach = query.get('attach');
    if (query.get('compose') !== '1' && !to && !attach) return;
    void (async () => {
      const attachments = [];
      for (const id of (attach ?? '').split(',').filter(Boolean).slice(0, 20)) {
        try {
          const node = await api.get<{ node: { id: string; name: string; size: number } }>(`/api/nodes/${encodeURIComponent(id)}`);
          attachments.push({ kind: 'node' as const, node: node.node.id, name: node.node.name, size: node.node.size });
        } catch (reason) {
          toast(errorText(reason));
        }
      }
      setCompose(
        emptyCompose(account, {
          to: to ? to.split(',').map((address) => ({ name: '', address })) : [],
          attachments,
          subject: query.get('subject') ?? '',
        })
      );
      go({ compose: null, to: null, attach: null, subject: null }, true);
    })();
  }, [info, account?.id, query]);

  useEffect(() => {
    if (!account || !uid) {
      setMessage(null);
      return;
    }
    let live = true;
    setOpening(true);
    mailApi
      .message(account.id, folder, uid)
      .then((result) => {
        if (!live) return;
        setMessage(result.message);
        if (!result.message.flags.seen) return;
        listRef.current.patch([uid], { seen: true });
        void refreshBadges();
        setFolders((current) => ({
          ...current,
          [account.id]: current[account.id]?.map((entry) =>
            entry.path === folder
              ? { ...entry, unseen: Math.max(0, entry.unseen - (listRef.current.items.find((item) => item.uid === uid)?.seen ? 0 : 1)) }
              : entry
          ),
        }));
      })
      .catch((reason) => {
        if (live) {
          setMessage(null);
          toast(errorText(reason));
        }
      })
      .finally(() => live && setOpening(false));
    return () => {
      live = false;
    };
  }, [account?.id, folder, uid]);

  useEffect(() => setSelection(new Set()), [account?.id, folder, q, filter]);
  useEffect(() => setSearch(q), [q]);

  const currentFolders = account ? (folders[account.id] ?? []) : [];
  const folderInfo = currentFolders.find((entry) => entry.path === folder);

  const refresh = async () => {
    await list.load(0);
    if (account) await loadFolders(account.id);
    loadOutbox();
    void refreshBadges();
  };

  const act = async (uids: number[], action: 'archive' | 'delete' | 'read' | 'unread' | 'flag' | 'unflag') => {
    if (!account || !uids.length) return;
    try {
      if (action === 'archive') {
        list.patch(uids, null);
        await mailApi.archive(account.id, folder, uids);
        toast(tn(uids.length, 'Archiviert', '{count} archiviert'));
      } else if (action === 'delete') {
        list.patch(uids, null);
        const result = await mailApi.remove(account.id, folder, uids);
        toast(
          result.result === 'deleted'
            ? tn(uids.length, 'Endgültig gelöscht', '{count} endgültig gelöscht')
            : tn(uids.length, 'In den Papierkorb gelegt', '{count} in den Papierkorb gelegt')
        );
      } else {
        const change = action === 'read' || action === 'unread' ? { seen: action === 'read' } : { flagged: action === 'flag' };
        list.patch(uids, change);
        await mailApi.flags(account.id, folder, uids, change);
      }
      if (uid && uids.includes(uid) && (action === 'archive' || action === 'delete')) go({ uid: null });
      if (message && uids.includes(message.uid) && action !== 'archive' && action !== 'delete') {
        setMessage({
          ...message,
          flags: {
            ...message.flags,
            ...(action === 'read' || action === 'unread' ? { seen: action === 'read' } : {}),
            ...(action === 'flag' || action === 'unflag' ? { flagged: action === 'flag' } : {}),
          },
        });
      }
      setSelection(new Set());
      void loadFolders(account.id);
      void refreshBadges();
    } catch (reason) {
      toast(errorText(reason));
      void list.load(0, true);
    }
  };

  const moveTo = async (uids: number[]) => {
    if (!account || !uids.length) return;
    const options = currentFolders.filter((entry) => entry.selectable && entry.path !== folder);
    const { choose } = await import('../common/dialogs');
    const target = await choose({
      title: t('Verschieben nach'),
      options: options.map((entry) => ({ value: entry.path, label: roleLabel(entry) })),
    });
    if (!target) return;
    try {
      list.patch(uids, null);
      await mailApi.move(account.id, folder, uids, target);
      if (uid && uids.includes(uid)) go({ uid: null });
      setSelection(new Set());
      void loadFolders(account.id);
    } catch (reason) {
      toast(errorText(reason));
    }
  };

  const createFolder = async (id: string) => {
    const name = await prompt({ title: t('Neuer Ordner'), label: t('Name'), value: '', confirm: t('Anlegen') });
    if (!name) return;
    try {
      await api.post(`/api/mail/accounts/${id}/folders`, { path: name });
      void loadFolders(id);
    } catch (reason) {
      toast(errorText(reason));
    }
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('.MuiDialog-root, .MuiMenu-root')) return;
      if (event.key === 'c' && account) {
        event.preventDefault();
        setCompose(emptyCompose(account));
      } else if (message && account && (event.key === 'r' || event.key === 'a' || event.key === 'f')) {
        event.preventDefault();
        setCompose(replyState(account, message, event.key === 'r' ? 'reply' : event.key === 'a' ? 'all' : 'forward'));
      } else if (message && (event.key === 'e' || event.key === '#' || event.key === 'Delete')) {
        event.preventDefault();
        void act([message.uid], event.key === 'e' ? 'archive' : 'delete');
      } else if (message && event.key === 'u') void act([message.uid], message.flags.seen ? 'unread' : 'read');
      else if (event.key === 'Escape' && uid) go({ uid: null });
      else if ((event.key === 'j' || event.key === 'k') && list.items.length) {
        const index = list.items.findIndex((item) => item.uid === uid);
        const next = list.items[Math.max(0, Math.min(list.items.length - 1, index + (event.key === 'j' ? 1 : -1)))];
        if (next) go({ uid: next.uid });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const pick = (id: string, path: string) => {
    setDrawer(false);
    go({ account: id, folder: path, uid: null, q: null, filter: null });
  };

  const openDraftOrMessage = (item: Summary) => {
    go({ uid: item.uid });
  };

  const folderPane = info && (
    <FolderList
      info={info}
      folders={folders}
      account={account?.id ?? ''}
      folder={folder}
      outbox={outbox.length}
      onPick={pick}
      onAdd={() => setDialog({ account: null })}
      onEdit={(entry) => setDialog({ account: entry })}
      onOutbox={() => setDrawer(false)}
      onCreate={(id) => void createFolder(id)}
    />
  );

  const selectionBar = selection.size > 0 && (
    <Box
      data-mail-bulk
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        bgcolor: c.secondaryContainer,
        borderRadius: `${radius.full}px`,
        mx: 1,
        mb: 1,
      }}
    >
      <Checkbox
        checked={selection.size === list.items.length}
        indeterminate={selection.size < list.items.length}
        onChange={(event) => setSelection(event.target.checked ? new Set(list.items.map((item) => item.uid)) : new Set())}
        slotProps={{ input: { 'aria-label': t('Alle auswählen') } }}
      />
      <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
        {tn(selection.size, '{count} ausgewählt', '{count} ausgewählt')}
      </Typography>
      <Tooltip title={t('Als gelesen markieren')}>
        <IconButton onClick={() => void act([...selection], 'read')} aria-label={t('Als gelesen markieren')}>
          <MarkEmailReadOutlined />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('Archivieren')}>
        <IconButton onClick={() => void act([...selection], 'archive')} aria-label={t('Archivieren')}>
          <ArchiveOutlined />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('Verschieben …')}>
        <IconButton onClick={() => void moveTo([...selection])} aria-label={t('Verschieben …')}>
          <DriveFileMoveOutlined />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('Löschen')}>
        <IconButton onClick={() => void act([...selection], 'delete')} aria-label={t('Löschen')}>
          <DeleteOutlineRounded />
        </IconButton>
      </Tooltip>
    </Box>
  );

  const listPane = account && (
    <Box
      data-mail-list
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        width: { md: wide ? 400 : 360 },
        flex: { xs: 1, md: 'none' },
        borderRight: { md: `1px solid ${c.outlineVariant}` },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
        {!wide && (
          <IconButton onClick={() => setDrawer(true)} aria-label={t('Ordner')} data-mail-menu>
            <MenuRounded />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2" noWrap sx={{ fontWeight: 700 }}>
            {q ? t('Suche: {q}', { q }) : folderInfo ? roleLabel(folderInfo) : folder}
          </Typography>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {account.name}
            {folderInfo?.unseen ? ` · ${tn(folderInfo.unseen, '{count} ungelesen', '{count} ungelesen')}` : ''}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, px: 1.5, pb: 1, overflowX: 'auto' }}>
        {([null, 'unread', 'flagged', 'attachments'] as Filter[]).map((entry) => (
          <Chip
            key={entry ?? 'all'}
            size="small"
            label={
              entry === 'unread'
                ? t('Ungelesen')
                : entry === 'flagged'
                  ? t('Markiert')
                  : entry === 'attachments'
                    ? t('Mit Anhang')
                    : t('Alle')
            }
            color={filter === entry ? 'primary' : 'default'}
            variant={filter === entry ? 'filled' : 'outlined'}
            onClick={() => go({ filter: entry, uid: null })}
          />
        ))}
      </Box>
      {selectionBar}
      {(list.loading || list.stale) && <LinearProgress sx={{ mx: 1.5 }} />}
      {list.error && (
        <Alert
          severity="error"
          sx={{ mx: 1.5 }}
          action={
            <Button color="inherit" onClick={() => void list.load(0)}>
              {t('Nochmal')}
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}
      <Box sx={{ flex: 1, overflowY: { md: 'auto' }, px: { md: 0.5 }, pb: 2 }}>
        <PullToRefresh onRefresh={refresh}>
          {!list.loading && !list.stale && !list.items.length && !list.error && (
            <EmptyState icon={<InboxRounded />} title={q || filter ? t('Nichts gefunden') : t('Hier ist alles erledigt')} compact />
          )}
          {list.items.map((item) => (
            <MessageRow
              key={item.uid}
              item={item}
              active={item.uid === uid}
              selected={selection.has(item.uid)}
              onOpen={() => openDraftOrMessage(item)}
              onToggle={() =>
                setSelection((current) => {
                  const next = new Set(current);
                  if (next.has(item.uid)) next.delete(item.uid);
                  else next.add(item.uid);
                  return next;
                })
              }
              onFlag={() => void act([item.uid], item.flagged ? 'unflag' : 'flag')}
              onSwipeRead={() => void act([item.uid], item.seen ? 'unread' : 'read')}
              onSwipeDelete={() => void act([item.uid], 'delete')}
            />
          ))}
          {list.more && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <Button onClick={() => void list.load(list.items.length)} disabled={list.loading}>
                {t('Mehr laden')}
              </Button>
            </Box>
          )}
        </PullToRefresh>
      </Box>
    </Box>
  );

  const readerPane = account && (
    <Reader
      account={account}
      message={message && message.uid === uid ? message : null}
      loading={opening}
      showBack={!medium}
      onBack={() => go({ uid: null })}
      onReply={(mode) => message && setCompose(replyState(account, message, mode))}
      onArchive={() => message && void act([message.uid], 'archive')}
      onDelete={() => message && void act([message.uid], 'delete')}
      onToggleSeen={() => message && void act([message.uid], message.flags.seen ? 'unread' : 'read')}
      onToggleFlag={() => message && void act([message.uid], message.flags.flagged ? 'unflag' : 'flag')}
      onMove={() => message && void moveTo([message.uid])}
      onEditDraft={() => message && setCompose(draftState(account, message))}
    />
  );

  const composeButton = (size: 'rail' | 'mobile') =>
    account && (
      <Tooltip title={t('Neue E-Mail')} placement="right">
        <Fab
          variant={size === 'mobile' ? 'extended' : 'circular'}
          color="primary"
          aria-label={t('Neue E-Mail')}
          onClick={() => setCompose(emptyCompose(account))}
          data-mail-compose={size}
        >
          <EditRounded />
          {size === 'mobile' && t('Schreiben')}
        </Fab>
      </Tooltip>
    );

  let content: ReactNode;
  if (error)
    content = (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  else if (!info) content = <LinearProgress sx={{ m: 2 }} />;
  else if (!info.accounts.length) {
    content = (
      <EmptyState
        icon={<MailOutlineRounded />}
        title={t('Noch kein Postfach verbunden')}
        text={t('Verbinde dein Postfach per IMAP und SMTP, zum Beispiel von GMX, web.de, Posteo, mailbox.org oder deinem eigenen Server.')}
        action={
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setDialog({ account: null })} data-mail-add>
            {t('Postfach verbinden')}
          </Button>
        }
      />
    );
  } else if (medium) {
    content = (
      <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
        {wide && <Box sx={{ width: 260, flex: 'none', overflowY: 'auto', borderRight: `1px solid ${c.outlineVariant}` }}>{folderPane}</Box>}
        {listPane}
        {readerPane}
      </Box>
    );
  } else content = uid ? readerPane : listPane;

  return (
    <AppShell
      active="mail"
      railAction={composeButton('rail')}
      mobileAction={!uid ? composeButton('mobile') : undefined}
      topBar={
        <Box
          component="form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: search.trim() || null, uid: null });
          }}
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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('In E-Mails suchen')}
            inputProps={{ 'aria-label': t('In E-Mails suchen'), enterKeyHint: 'search' }}
            sx={{ flex: 1 }}
          />
        </Box>
      }
    >
      <Box sx={{ height: { md: '100%' }, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {outbox.length > 0 && (
          <Alert
            severity={outbox.some((entry) => entry.state === 'failed') ? 'warning' : 'info'}
            icon={<OutboxRounded />}
            sx={{ m: 1 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  for (const entry of outbox) await mailApi.cancel(entry.id).catch(() => undefined);
                  loadOutbox();
                }}
              >
                {t('Alle zurücknehmen')}
              </Button>
            }
          >
            {outbox.map((entry) => (
              <Box key={entry.id}>
                {entry.state === 'failed'
                  ? t('„{subject}“ ließ sich nicht senden: {error}', {
                      subject: entry.subject || t('(kein Betreff)'),
                      error: entry.error ?? '',
                    })
                  : t('„{subject}“ an {to} geht {time} raus', {
                      subject: entry.subject || t('(kein Betreff)'),
                      to: entry.recipients,
                      time: formatDateTime(entry.sendAt),
                    })}
              </Box>
            ))}
          </Alert>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
      </Box>
      <Drawer open={drawer} onClose={() => setDrawer(false)} slotProps={{ paper: { sx: { width: 300, bgcolor: c.surfaceContainerLow } } }}>
        {folderPane}
      </Drawer>
      {dialog && info && (
        <AccountDialog
          open
          info={info}
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            void loadInfo();
            if (saved) {
              void loadFolders(saved.id);
              if (!info.accounts.length) go({ account: saved.id, folder: 'INBOX' });
            } else go({ account: null, folder: null, uid: null });
          }}
        />
      )}
      {compose && info && (
        <Composer
          key={`${compose.account}-${compose.draft?.uid ?? 'neu'}-${compose.subject}`}
          initial={compose}
          accounts={info.accounts}
          onClose={() => {
            setCompose(null);
            setTimeout(() => {
              loadOutbox();
              void list.load(0, true);
              if (account) void loadFolders(account.id);
            }, 1500);
            setTimeout(loadOutbox, 9500);
          }}
          onReopen={(state) => {
            setCompose(state);
            loadOutbox();
          }}
        />
      )}
    </AppShell>
  );
}
