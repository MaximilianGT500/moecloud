import { Fragment, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import BusinessRounded from '@mui/icons-material/BusinessRounded';
import CakeOutlined from '@mui/icons-material/CakeOutlined';
import CakeRounded from '@mui/icons-material/CakeRounded';
import CallMergeRounded from '@mui/icons-material/CallMergeRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContactsOutlined from '@mui/icons-material/ContactsOutlined';
import ContactsRounded from '@mui/icons-material/ContactsRounded';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DevicesRounded from '@mui/icons-material/DevicesRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditRounded from '@mui/icons-material/EditRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import PhoneRounded from '@mui/icons-material/PhoneRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import ShareRounded from '@mui/icons-material/ShareRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { c, curve, mix, radius } from '../../theme/tokens';
import { lazyNamed } from '../common/lazy';
import { choose, confirm, prompt } from '../common/dialogs';
import { EmptyState, UserAvatar } from '../common/bits';
import { toast } from '../common/toast';
import { AppShell } from '../shell/AppShell';
import {
  addressLines,
  ageNow,
  compareText,
  contactsApi,
  entryLabel,
  formatDay,
  initialsOf,
  letterOf,
  mapUrl,
  nextOccurrence,
  photoUrl,
  shownName,
  sortKey,
  telUrl,
  webUrl,
  type Birthday,
  type Book,
  type Detail,
  type Group,
  type Label,
  type Summary,
} from './model';
import type { EditorRequest } from './ContactEditor';

const ContactEditor = lazyNamed(() => import('./ContactEditor'), 'ContactEditor');
const ImportDialog = lazyNamed(() => import('./ContactDialogs'), 'ImportDialog');
const ShareDialog = lazyNamed(() => import('./ContactDialogs'), 'ShareDialog');
const SyncDialog = lazyNamed(() => import('./ContactDialogs'), 'SyncDialog');

const SIDEBAR = 280;
const SORT_KEY = 'moecloud-contacts-sort';

type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'birthdays' }
  | { kind: 'duplicates' }
  | { kind: 'trash' }
  | { kind: 'book'; id: string }
  | { kind: 'label'; name: string }
  | { kind: 'group'; id: string };

function viewOf(path: string): View {
  const parts = path.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  if (parts[0] === 'favorites') return { kind: 'favorites' };
  if (parts[0] === 'birthdays') return { kind: 'birthdays' };
  if (parts[0] === 'duplicates') return { kind: 'duplicates' };
  if (parts[0] === 'trash') return { kind: 'trash' };
  if (parts[0] === 'book' && parts[1]) return { kind: 'book', id: parts[1] };
  if (parts[0] === 'label' && parts[1]) return { kind: 'label', name: parts[1] };
  if (parts[0] === 'group' && parts[1]) return { kind: 'group', id: parts[1] };
  return { kind: 'all' };
}

function hrefOf(view: View) {
  switch (view.kind) {
    case 'all':
      return '/contacts';
    case 'book':
      return `/contacts/book/${encodeURIComponent(view.id)}`;
    case 'label':
      return `/contacts/label/${encodeURIComponent(view.name)}`;
    case 'group':
      return `/contacts/group/${encodeURIComponent(view.id)}`;
    default:
      return `/contacts/${view.kind}`;
  }
}

function queryOf(view: View, search: string) {
  const params = new URLSearchParams();
  if (view.kind === 'favorites') params.set('favorites', '1');
  if (view.kind === 'trash') params.set('trash', '1');
  if (view.kind === 'book') params.set('book', view.id);
  if (view.kind === 'label') params.set('label', view.name);
  if (view.kind === 'group') params.set('group', view.id);
  if (search.trim()) params.set('q', search.trim());
  const text = params.toString();
  return text ? `?${text}` : '';
}

function ContactAvatar({ entry, size = 40 }: { entry: { id: string; name: string; photo: string | null; kind?: string }; size?: number }) {
  return (
    <Avatar
      src={entry.photo ? photoUrl(entry.id, entry.photo) : undefined}
      alt=""
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        bgcolor: entry.kind === 'org' ? c.tertiaryContainer : c.primaryContainer,
        color: entry.kind === 'org' ? c.onTertiaryContainer : c.onPrimaryContainer,
        fontWeight: 600,
      }}
    >
      {entry.kind === 'org' && !entry.name ? <BusinessRounded sx={{ fontSize: size * 0.5 }} /> : initialsOf(entry.name || '?')}
    </Avatar>
  );
}

function NavRow({
  icon,
  label,
  count,
  active,
  href,
  action,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  href: string;
  action?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', '&:hover .row-action, &:focus-within .row-action': { opacity: 1 } }}>
      <ButtonBase
        component="a"
        href={href}
        nativeButton={false}
        aria-current={active ? 'page' : undefined}
        onClick={(event: React.MouseEvent) => {
          if (event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          navigate(href);
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          gap: 1.5,
          py: 0.9,
          px: 1.5,
          borderRadius: `${radius.full}px`,
          bgcolor: active ? c.secondaryContainer : 'transparent',
          color: active ? c.onSecondaryContainer : c.onSurface,
          '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
          '& svg': { fontSize: 20 },
        }}
      >
        {icon}
        <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: active ? 700 : 500, textAlign: 'left' }}>
          {label}
        </Typography>
        {count !== undefined && count > 0 && (
          <Typography variant="caption" sx={{ color: active ? c.onSecondaryContainer : c.onSurfaceVariant }}>
            {count}
          </Typography>
        )}
      </ButtonBase>
      {action && (
        <Box className="row-action" sx={{ opacity: { xs: 1, md: 0 }, transition: `opacity 120ms ${curve.standard}` }}>
          {action}
        </Box>
      )}
    </Box>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Box component="section" aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'center', pr: 0.25 }}>
        <ButtonBase
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          sx={{ flex: 1, justifyContent: 'flex-start', gap: 0.5, py: 0.75, px: 1.5, borderRadius: `${radius.full}px` }}
        >
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {title}
          </Typography>
          <ExpandMoreRounded
            sx={{
              fontSize: 18,
              color: c.onSurfaceVariant,
              transform: open ? 'none' : 'rotate(-90deg)',
              transition: `transform 160ms ${curve.standard}`,
            }}
          />
        </ButtonBase>
        {action}
      </Box>
      {open && <Box sx={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>}
    </Box>
  );
}

function RowMenu({ label, items }: { label: string; items: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={label}>
        <IconButton size="small" aria-label={label} aria-haspopup="menu" onClick={(event) => setAnchor(event.currentTarget)}>
          <MoreVertRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              setAnchor(null);
              item.run();
            }}
            sx={item.danger ? { color: c.error } : undefined}
          >
            <ListItemIcon sx={item.danger ? { color: c.error } : undefined}>{item.icon}</ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ display: 'flex', gap: 2, py: 1.5, borderTop: `1px solid ${c.outlineVariant}` }}>
      <Box sx={{ color: c.onSurfaceVariant, pt: 0.25, display: 'flex' }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</Box>
    </Box>
  );
}

function Line({ primary, secondary, href, external }: { primary: ReactNode; secondary?: ReactNode; href?: string; external?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      {href ? (
        <Typography
          component="a"
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          variant="body1"
          sx={{ color: c.primary, textDecoration: 'none', wordBreak: 'break-word', '&:hover': { textDecoration: 'underline' } }}
        >
          {primary}
        </Typography>
      ) : (
        <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>
          {primary}
        </Typography>
      )}
      {secondary && (
        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
          {secondary}
        </Typography>
      )}
    </Box>
  );
}

function birthdayNote(value: string) {
  const next = nextOccurrence(value);
  if (!next) return null;
  if (next.days === 0) return next.age ? t('Heute, wird {age}', { age: next.age }) : t('Heute');
  if (next.days === 1) return next.age ? t('Morgen, wird {age}', { age: next.age }) : t('Morgen');
  return next.age
    ? tn(next.days, 'In einem Tag, wird {age}', 'In {count} Tagen, wird {age}', { age: next.age })
    : tn(next.days, 'In einem Tag', 'In {count} Tagen');
}

function ContactDetail({
  id,
  books,
  onEdit,
  onClose,
  showBack,
}: {
  id: string;
  books: Book[];
  onEdit: (detail: Detail) => void;
  onClose: () => void;
  showBack: boolean;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  const load = useCallback(() => {
    contactsApi
      .detail(id)
      .then((next) => {
        setDetail(next);
        setFailed(null);
      })
      .catch((error) => setFailed(errorText(error)));
  }, [id]);

  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  useLive((event) => {
    if (event === 'contacts' || event === 'reconnect') load();
  });

  if (failed) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="warning">{failed}</Alert>
        <Button onClick={onClose} sx={{ alignSelf: 'flex-start' }}>
          {t('Zurück zur Liste')}
        </Button>
      </Box>
    );
  }
  if (!detail) return <LinearProgress />;

  const data = detail.data;
  const book = books.find((entry) => entry.id === detail.bookId);
  const subtitle = [data.kind === 'org' ? '' : data.organization, data.department, data.title].filter(Boolean).join(' · ');
  const age = data.birthday ? ageNow(data.birthday) : null;
  const trashed = Boolean(detail.trashedAt);

  const toggleFavorite = async () => {
    try {
      await contactsApi.favorite(detail.id, !detail.favorite);
      setDetail({ ...detail, favorite: !detail.favorite });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const remove = async () => {
    try {
      const result = await contactsApi.remove([detail.id]);
      toast(
        result.days > 0
          ? tn(result.days, 'In den Papierkorb gelegt, dort bleibt er einen Tag', 'In den Papierkorb gelegt, dort bleibt er {count} Tage')
          : t('In den Papierkorb gelegt'),
        {
          action: {
            label: t('Rückgängig'),
            onClick: () =>
              void contactsApi
                .restore(detail.id)
                .then(load)
                .catch((error) => toast(errorText(error))),
          },
        }
      );
      onClose();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box data-contact-detail={data.name} sx={{ height: '100%', overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        {showBack && (
          <Tooltip title={t('Zurück')}>
            <IconButton aria-label={t('Zurück')} onClick={onClose}>
              <ArrowBackRounded />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {!trashed && (
          <Tooltip title={detail.favorite ? t('Aus Favoriten entfernen') : t('Zu Favoriten')}>
            <IconButton
              aria-label={detail.favorite ? t('Aus Favoriten entfernen') : t('Zu Favoriten')}
              aria-pressed={detail.favorite}
              onClick={() => void toggleFavorite()}
            >
              {detail.favorite ? <StarRounded sx={{ color: '#f59e0b' }} /> : <StarOutlineRounded />}
            </IconButton>
          </Tooltip>
        )}
        {!trashed && !detail.readOnly && (
          <Button variant="tonal" startIcon={<EditRounded />} onClick={() => onEdit(detail)}>
            {t('Bearbeiten')}
          </Button>
        )}
        <Tooltip title={t('Mehr')}>
          <IconButton aria-label={t('Mehr')} aria-haspopup="menu" onClick={(event) => setMenu(event.currentTarget)}>
            <MoreVertRounded />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
          <MenuItem component="a" href={`/api/contacts/${detail.id}/vcard`} download onClick={() => setMenu(null)}>
            <ListItemIcon>
              <DownloadRounded fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('Als vCard herunterladen')}</ListItemText>
          </MenuItem>
          {!trashed && !detail.readOnly && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                void remove();
              }}
              sx={{ color: c.error }}
            >
              <ListItemIcon sx={{ color: c.error }}>
                <DeleteOutlineRounded fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('Löschen')}</ListItemText>
            </MenuItem>
          )}
        </Menu>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1, pb: 2 }}>
        <ContactAvatar entry={{ id: detail.id, name: data.name, photo: detail.photo, kind: data.kind }} size={112} />
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
          {shownName(data)}
        </Typography>
        {data.nickname && data.nickname !== data.name && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            „{data.nickname}“
          </Typography>
        )}
        {subtitle && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {subtitle}
          </Typography>
        )}
        {data.categories.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center' }}>
            {data.categories.map((label) => (
              <Chip key={label} size="small" label={label} onClick={() => navigate(`/contacts/label/${encodeURIComponent(label)}`)} />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {data.phones[0] && (
            <Button variant="outlined" startIcon={<PhoneRounded />} href={telUrl(data.phones[0].value)}>
              {t('Anrufen')}
            </Button>
          )}
          {data.emails[0] && (
            <Button variant="outlined" startIcon={<MailOutlineRounded />} href={`mailto:${data.emails[0].value}`}>
              {t('E-Mail')}
            </Button>
          )}
        </Box>
        {trashed && <Alert severity="info">{t('Dieser Kontakt liegt im Papierkorb.')}</Alert>}
      </Box>

      {data.phones.length > 0 && (
        <Section icon={<PhoneRounded />} title={t('Telefon')}>
          {data.phones.map((entry, index) => (
            <Line key={index} primary={entry.value} secondary={entryLabel(entry)} href={telUrl(entry.value)} />
          ))}
        </Section>
      )}
      {data.emails.length > 0 && (
        <Section icon={<MailOutlineRounded />} title={t('E-Mail')}>
          {data.emails.map((entry, index) => (
            <Line key={index} primary={entry.value} secondary={entryLabel(entry)} href={`mailto:${entry.value}`} />
          ))}
        </Section>
      )}
      {data.addresses.length > 0 && (
        <Section icon={<PlaceOutlined />} title={t('Adresse')}>
          {data.addresses.map((entry, index) => (
            <Box key={index}>
              {addressLines(entry).map((line, position) => (
                <Typography key={position} variant="body1">
                  {line}
                </Typography>
              ))}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {entryLabel(entry)}
                </Typography>
                <Typography
                  component="a"
                  variant="caption"
                  href={mapUrl(entry)}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ color: c.primary, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                >
                  {t('Auf der Karte zeigen')}
                </Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
      {data.urls.length > 0 && (
        <Section icon={<LinkRounded />} title={t('Webseite')}>
          {data.urls.map((entry, index) => {
            const url = webUrl(entry.value);
            return <Line key={index} primary={entry.value} secondary={entryLabel(entry)} href={url ?? undefined} external />;
          })}
        </Section>
      )}
      {(data.birthday || data.anniversary) && (
        <Section icon={<CakeOutlined />} title={t('Geburtstag')}>
          {data.birthday && (
            <Line
              primary={formatDay(data.birthday)}
              secondary={[t('Geburtstag'), age !== null ? tn(age, 'Ein Jahr alt', '{count} Jahre alt') : null, birthdayNote(data.birthday)]
                .filter(Boolean)
                .join(' · ')}
            />
          )}
          {data.anniversary && (
            <Line
              primary={formatDay(data.anniversary)}
              secondary={[t('Jahrestag'), birthdayNote(data.anniversary)].filter(Boolean).join(' · ')}
            />
          )}
        </Section>
      )}
      {data.note && (
        <Section icon={<NotesRounded />} title={t('Notiz')}>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {data.note}
          </Typography>
        </Section>
      )}
      {detail.accounts.length > 0 && (
        <Section icon={<ContactsOutlined />} title={t('Auf diesem Server')}>
          {detail.accounts.map((account) => (
            <Box key={account.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UserAvatar initials={account.initials} size={28} />
              <Typography variant="body2">{t('{name} hat ein Konto auf diesem Server', { name: account.name })}</Typography>
            </Box>
          ))}
        </Section>
      )}
      <Box sx={{ borderTop: `1px solid ${c.outlineVariant}`, pt: 1.5, mt: 0.5 }}>
        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
          {book ? t('Im Adressbuch „{name}“', { name: book.name }) : null}
          {book?.owner ? ` · ${t('von {name}', { name: book.owner.name })}` : ''}
        </Typography>
        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
          {t('Zuletzt geändert am {date}', {
            date: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.updatedAt)),
          })}
          {detail.updatedBy ? ` · ${detail.updatedBy.name}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}

function BirthdaysView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Birthday[] | null>(null);
  const load = useCallback(() => {
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const end = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    contactsApi
      .birthdays(from, to)
      .then(setItems)
      .catch((error) => toast(errorText(error)));
  }, []);
  useEffect(load, [load]);
  useLive((event) => event === 'contacts' && load());
  if (!items) return <LinearProgress />;
  if (!items.length)
    return (
      <EmptyState
        icon={<CakeRounded />}
        title={t('Keine Geburtstage')}
        text={t('Trag bei deinen Kontakten Geburtstage ein, dann erscheinen sie hier und im Kalender.')}
      />
    );
  const months = new Map<string, Birthday[]>();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const list = months.get(key);
    if (list) list.push(item);
    else months.set(key, [item]);
  }
  return (
    <Box data-birthdays sx={{ overflowY: 'auto', height: '100%', px: { xs: 1, sm: 2 }, py: 1 }}>
      {[...months.entries()].map(([month, list]) => (
        <Box key={month} component="section" sx={{ mb: 2 }}>
          <Typography variant="overline" component="h3" sx={{ px: 1, color: c.onSurfaceVariant, fontWeight: 700 }}>
            {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
              new Date(`${month}-01T00:00:00Z`)
            )}
          </Typography>
          {list.map((item) => {
            const days = Math.round(
              (Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000
            );
            return (
              <ButtonBase
                key={`${item.contactId}-${item.date}`}
                onClick={() => onOpen(item.contactId)}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  gap: 1.5,
                  px: 1,
                  py: 1,
                  borderRadius: `${radius.md}px`,
                  '&:hover': { bgcolor: mix(c.onSurface, 6) },
                }}
              >
                <ContactAvatar entry={{ id: item.contactId, name: item.name, photo: item.photo }} />
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                    {formatDay(item.date)}
                    {item.age !== null ? ` · ${t('wird {age}', { age: item.age })}` : ''}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={days <= 0 ? t('Heute') : days === 1 ? t('Morgen') : tn(days, 'in einem Tag', 'in {count} Tagen')}
                  color={days <= 7 ? 'primary' : 'default'}
                  variant={days <= 7 ? 'filled' : 'outlined'}
                />
              </ButtonBase>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function DuplicatesView({ onOpen }: { onOpen: (id: string) => void }) {
  const [groups, setGroups] = useState<{ reasons: string[]; items: Summary[] }[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => {
    contactsApi
      .duplicates()
      .then(setGroups)
      .catch((error) => toast(errorText(error)));
  }, []);
  useEffect(load, [load]);
  if (!groups) return <LinearProgress />;
  if (!groups.length)
    return (
      <EmptyState
        icon={<CallMergeRounded />}
        title={t('Keine doppelten Kontakte')}
        text={t('MoeCloud hat nichts gefunden, das doppelt aussieht.')}
      />
    );
  const reasonText = (reason: string) =>
    reason === 'email' ? t('gleiche E-Mail-Adresse') : reason === 'phone' ? t('gleiche Telefonnummer') : t('gleicher Name');
  return (
    <Box
      data-duplicates
      sx={{ overflowY: 'auto', height: '100%', p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {tn(
          groups.length,
          'MoeCloud hat eine Gruppe gefunden, die doppelt aussieht. Beim Zusammenführen bleibt der erste Kontakt, die anderen landen im Papierkorb.',
          'MoeCloud hat {count} Gruppen gefunden, die doppelt aussehen. Beim Zusammenführen bleibt der erste Kontakt, die anderen landen im Papierkorb.'
        )}
      </Typography>
      {groups.map((group, index) => (
        <Box
          key={group.items.map((item) => item.id).join('-')}
          sx={{ border: `1px solid ${c.outlineVariant}`, borderRadius: `${radius.lg}px`, p: 1.5 }}
        >
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {group.reasons.map(reasonText).join(', ')}
          </Typography>
          {group.items.map((item) => (
            <ButtonBase
              key={item.id}
              onClick={() => onOpen(item.id)}
              sx={{
                width: '100%',
                justifyContent: 'flex-start',
                gap: 1.5,
                px: 1,
                py: 0.75,
                borderRadius: `${radius.md}px`,
                '&:hover': { bgcolor: mix(c.onSurface, 6) },
              }}
            >
              <ContactAvatar entry={item} size={36} />
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {shownName(item)}
                </Typography>
                <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                  {[item.email, item.phone].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="tonal"
              startIcon={<CallMergeRounded />}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(index);
                try {
                  await contactsApi.merge(group.items.map((item) => item.id));
                  toast(t('Kontakte zusammengeführt'));
                  load();
                } catch (error) {
                  toast(errorText(error));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t('Zusammenführen')}
            </Button>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ContactList({
  items,
  selected,
  checked,
  trash,
  order,
  onOpen,
  onCheck,
  onRestore,
  onDestroy,
}: {
  items: Summary[];
  selected: string | null;
  checked: Set<string>;
  trash: boolean;
  order: 'first' | 'last';
  onOpen: (id: string) => void;
  onCheck: (id: string, value: boolean) => void;
  onRestore: (id: string) => void;
  onDestroy: (id: string) => void;
}) {
  const sorted = useMemo(
    () =>
      items
        .map((item) => ({ item, key: sortKey(item, order) }))
        .sort((a, b) => Number(b.item.favorite) - Number(a.item.favorite) || compareText(a.key, b.key))
        .map((entry) => entry),
    [items, order]
  );
  const favorites = sorted.filter((entry) => entry.item.favorite);
  const rest = sorted.filter((entry) => !entry.item.favorite);
  const sections: [string, typeof sorted][] = [];
  if (favorites.length && !trash) sections.push([t('Favoriten'), favorites]);
  for (const entry of trash ? sorted : rest) {
    const letter = letterOf(entry.key);
    const last = sections[sections.length - 1];
    if (last && last[0] === letter) last[1].push(entry);
    else sections.push([letter, [entry]]);
  }
  const selecting = checked.size > 0;
  return (
    <Box role="list" aria-label={t('Kontakte')} sx={{ overflowY: 'auto', height: '100%', pb: 12 }}>
      {sections.map(([title, list]) => (
        <Fragment key={title}>
          <Typography
            variant="caption"
            component="h3"
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              px: 2,
              py: 0.5,
              fontWeight: 700,
              color: c.primary,
              bgcolor: { xs: c.surface, md: c.surfaceContainerLowest },
            }}
          >
            {title}
          </Typography>
          {list.map(({ item }) => {
            const active = item.id === selected;
            const isChecked = checked.has(item.id);
            const secondary = [item.kind === 'org' ? '' : item.organization, item.email ?? item.phone].filter(Boolean).join(' · ');
            return (
              <Box
                key={item.id}
                role="listitem"
                data-contact-row={item.name}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mx: 1,
                  borderRadius: `${radius.md}px`,
                  bgcolor: active ? c.secondaryContainer : isChecked ? mix(c.primary, 10) : 'transparent',
                  '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 6) },
                  '&:hover .check, &:focus-within .check': { opacity: 1 },
                }}
              >
                <ButtonBase
                  onClick={() => (selecting && !trash ? onCheck(item.id, !isChecked) : onOpen(item.id))}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    justifyContent: 'flex-start',
                    gap: 1.5,
                    pl: 1,
                    pr: 0.5,
                    py: 0.85,
                    borderRadius: `${radius.md}px`,
                  }}
                >
                  <Box sx={{ position: 'relative', flex: 'none' }}>
                    <ContactAvatar entry={item} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, color: active ? c.onSecondaryContainer : c.onSurface }}>
                      {shownName(item)}
                    </Typography>
                    {secondary && (
                      <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                        {secondary}
                      </Typography>
                    )}
                  </Box>
                  {item.favorite && <StarRounded sx={{ fontSize: 18, color: '#f59e0b', flex: 'none' }} aria-label={t('Favorit')} />}
                </ButtonBase>
                {trash ? (
                  <Box sx={{ display: 'flex', pr: 0.5 }}>
                    {!item.readOnly && (
                      <>
                        <Tooltip title={t('Wiederherstellen')}>
                          <IconButton aria-label={t('Wiederherstellen')} onClick={() => onRestore(item.id)}>
                            <RestoreFromTrashRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('Endgültig löschen')}>
                          <IconButton aria-label={t('Endgültig löschen')} onClick={() => onDestroy(item.id)}>
                            <DeleteForeverRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                ) : (
                  <Checkbox
                    className="check"
                    size="small"
                    checked={isChecked}
                    onChange={(event) => onCheck(item.id, event.target.checked)}
                    slotProps={{ input: { 'aria-label': t('{name} auswählen', { name: shownName(item) }) } }}
                    sx={{ opacity: { xs: selecting ? 1 : 0.6, md: selecting || isChecked ? 1 : 0 }, mr: 0.5 }}
                  />
                )}
              </Box>
            );
          })}
        </Fragment>
      ))}
    </Box>
  );
}

function download(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

export function ContactsApp() {
  const { path, query } = useLocation();
  const view = viewOf(path);
  const selected = query.get('c');
  const importNode = query.get('import');
  const desktop = useMediaQuery('(min-width:900px)');
  const wide = useMediaQuery('(min-width:1200px)');
  const [books, setBooks] = useState<Book[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [importing, setImporting] = useState<{ node: string | null } | null>(importNode ? { node: importNode } : null);
  const [sharing, setSharing] = useState<Book | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [moreMenu, setMoreMenu] = useState<HTMLElement | null>(null);
  const [order, setOrder] = useState<'first' | 'last'>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === 'last' ? 'last' : 'first';
    } catch {
      return 'first';
    }
  });
  const listKey = queryOf(view, search);
  const listView = view.kind !== 'birthdays' && view.kind !== 'duplicates';

  const loadMeta = useCallback(async () => {
    try {
      const [nextBooks, meta] = await Promise.all([contactsApi.books(), contactsApi.labels()]);
      setBooks(nextBooks);
      setLabels(meta.labels);
      setGroups(meta.groups);
    } catch (failure) {
      setError(errorText(failure));
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!listView) return;
    try {
      const result = await contactsApi.list(listKey);
      setItems(result.items);
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  }, [listKey, listView]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const viewKey = hrefOf(view);
  useEffect(() => {
    setItems(null);
    setChecked(new Set());
  }, [viewKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), search ? 160 : 0);
    return () => window.clearTimeout(timer);
  }, [loadList, search]);

  useEffect(() => {
    if (!importNode) return;
    const url = new URL(location.href);
    url.searchParams.delete('import');
    navigate(url.pathname + url.search, { replace: true });
  }, [importNode]);

  useLive((event) => {
    if (event !== 'contacts' && event !== 'reconnect') return;
    void loadMeta();
    void loadList();
  });

  const own = books.find((book) => book.access === 'owner');
  const currentBook = view.kind === 'book' ? books.find((book) => book.id === view.id) : undefined;
  const writable = books.filter((book) => book.access !== 'read');
  const defaultBook = currentBook && currentBook.access !== 'read' ? currentBook.id : (own?.id ?? writable[0]?.id ?? '');
  const total = books.reduce((sum, book) => sum + book.count, 0);
  const labelNames = labels.map((label) => label.name);

  const open = (id: string | null) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('c', id);
    else url.searchParams.delete('c');
    navigate(url.pathname + url.search);
    setDrawer(false);
  };

  const go = (href: string) => {
    navigate(href);
    setDrawer(false);
  };

  const newContact = () => {
    if (!defaultBook) {
      toast(t('Du hast kein Adressbuch, in das du schreiben darfst'));
      return;
    }
    setEditor({ detail: null, bookId: defaultBook, preset: view.kind === 'label' ? { categories: [view.name] } : undefined });
  };

  const setSort = (value: 'first' | 'last') => {
    setOrder(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {}
  };

  const title =
    view.kind === 'all'
      ? t('Alle Kontakte')
      : view.kind === 'favorites'
        ? t('Favoriten')
        : view.kind === 'birthdays'
          ? t('Geburtstage')
          : view.kind === 'duplicates'
            ? t('Doppelte Kontakte')
            : view.kind === 'trash'
              ? t('Papierkorb')
              : view.kind === 'book'
                ? (currentBook?.name ?? t('Adressbuch'))
                : view.kind === 'label'
                  ? view.name
                  : (groups.find((group) => group.id === view.id)?.name ?? t('Gruppe'));

  const bookActions = (book: Book) => [
    ...(book.access === 'owner'
      ? [
          {
            label: t('Umbenennen'),
            icon: <EditRounded fontSize="small" />,
            run: async () => {
              const name = await prompt({
                title: t('Adressbuch umbenennen'),
                label: t('Name'),
                value: book.name,
                confirm: t('Umbenennen'),
              });
              if (!name?.trim()) return;
              try {
                await contactsApi.renameBook(book.id, name.trim());
                await loadMeta();
              } catch (failure) {
                toast(errorText(failure));
              }
            },
          },
          { label: t('Teilen'), icon: <ShareRounded fontSize="small" />, run: () => setSharing(book) },
        ]
      : []),
    {
      label: t('Als vCard exportieren'),
      icon: <DownloadRounded fontSize="small" />,
      run: () => download(`/api/contacts/export?book=${book.id}`),
    },
    {
      label: t('Als CSV exportieren'),
      icon: <DownloadRounded fontSize="small" />,
      run: () => download(`/api/contacts/export?book=${book.id}&format=csv`),
    },
    {
      label: book.access === 'owner' ? t('Löschen') : t('Nicht mehr anzeigen'),
      icon: <DeleteOutlineRounded fontSize="small" />,
      danger: true,
      run: async () => {
        const ok = await confirm({
          title:
            book.access === 'owner' ? t('„{name}“ löschen?', { name: book.name }) : t('„{name}“ nicht mehr anzeigen?', { name: book.name }),
          text:
            book.access === 'owner'
              ? tn(book.count, 'Der Kontakt darin wird endgültig gelöscht.', 'Die {count} Kontakte darin werden endgültig gelöscht.')
              : t('Das Adressbuch bleibt bei {name} erhalten.', { name: book.owner?.name ?? '' }),
          confirm: book.access === 'owner' ? t('Löschen') : t('Nicht mehr anzeigen'),
          danger: true,
        });
        if (!ok) return;
        try {
          await contactsApi.removeBook(book.id);
          if (view.kind === 'book' && view.id === book.id) navigate('/contacts');
          await loadMeta();
        } catch (failure) {
          toast(errorText(failure));
        }
      },
    },
  ];

  const labelActions = (label: Label) => [
    {
      label: t('Umbenennen'),
      icon: <EditRounded fontSize="small" />,
      run: async () => {
        const name = await prompt({ title: t('Label umbenennen'), label: t('Name'), value: label.name, confirm: t('Umbenennen') });
        if (!name?.trim() || name.trim() === label.name) return;
        try {
          await contactsApi.renameLabel(label.name, name.trim());
          navigate(`/contacts/label/${encodeURIComponent(name.trim())}`);
        } catch (failure) {
          toast(errorText(failure));
        }
      },
    },
    {
      label: t('Label entfernen'),
      icon: <DeleteOutlineRounded fontSize="small" />,
      danger: true,
      run: async () => {
        const ok = await confirm({
          title: t('Label „{name}“ entfernen?', { name: label.name }),
          text: t('Die Kontakte bleiben erhalten, nur das Label verschwindet.'),
          confirm: t('Entfernen'),
          danger: true,
        });
        if (!ok) return;
        try {
          await contactsApi.renameLabel(label.name, null);
          if (view.kind === 'label') navigate('/contacts');
        } catch (failure) {
          toast(errorText(failure));
        }
      },
    },
  ];

  const sidebar = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 1 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<PersonAddAlt1Rounded />}
          onClick={newContact}
          sx={{
            height: 56,
            borderRadius: `${radius.md}px`,
            px: 2.5,
            bgcolor: c.primaryContainer,
            color: c.onPrimaryContainer,
            boxShadow: 'none',
            fontWeight: 700,
            '&:hover': { bgcolor: `color-mix(in srgb, ${c.onPrimaryContainer} 8%, ${c.primaryContainer})`, boxShadow: 'none' },
          }}
        >
          {t('Neuer Kontakt')}
        </Button>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          px: 0.5,
          pb: 2,
          scrollbarWidth: 'thin',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <NavRow icon={<ContactsRounded />} label={t('Alle Kontakte')} count={total} active={view.kind === 'all'} href="/contacts" />
          <NavRow icon={<StarOutlineRounded />} label={t('Favoriten')} active={view.kind === 'favorites'} href="/contacts/favorites" />
          <NavRow icon={<CakeOutlined />} label={t('Geburtstage')} active={view.kind === 'birthdays'} href="/contacts/birthdays" />
        </Box>
        <Group
          title={t('Adressbücher')}
          action={
            <Tooltip title={t('Neues Adressbuch')}>
              <IconButton
                size="small"
                aria-label={t('Neues Adressbuch')}
                onClick={async () => {
                  const name = await prompt({ title: t('Neues Adressbuch'), label: t('Name'), value: '', confirm: t('Anlegen') });
                  if (!name?.trim()) return;
                  try {
                    const book = await contactsApi.createBook(name.trim());
                    await loadMeta();
                    go(`/contacts/book/${book.id}`);
                  } catch (failure) {
                    toast(errorText(failure));
                  }
                }}
              >
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
          {books.map((book) => (
            <NavRow
              key={book.id}
              icon={book.owner ? <GroupsOutlined /> : <ContactsOutlined />}
              label={book.owner ? t('{name} ({owner})', { name: book.name, owner: book.owner.name }) : book.name}
              count={book.count}
              active={view.kind === 'book' && view.id === book.id}
              href={`/contacts/book/${book.id}`}
              action={<RowMenu label={t('Optionen für „{name}“', { name: book.name })} items={bookActions(book)} />}
            />
          ))}
        </Group>
        {labels.length > 0 && (
          <Group title={t('Labels')}>
            {labels.map((label) => (
              <NavRow
                key={label.name}
                icon={<SellOutlined />}
                label={label.name}
                count={label.count}
                active={view.kind === 'label' && view.name.toLowerCase() === label.name.toLowerCase()}
                href={`/contacts/label/${encodeURIComponent(label.name)}`}
                action={<RowMenu label={t('Optionen für „{name}“', { name: label.name })} items={labelActions(label)} />}
              />
            ))}
          </Group>
        )}
        {groups.length > 0 && (
          <Group title={t('Gruppen')}>
            {groups.map((group) => (
              <NavRow
                key={group.id}
                icon={<GroupsOutlined />}
                label={group.name}
                count={group.count}
                active={view.kind === 'group' && view.id === group.id}
                href={`/contacts/group/${group.id}`}
              />
            ))}
          </Group>
        )}
        <Divider sx={{ mx: 1.5, my: 0.5 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <NavRow
            icon={<CallMergeRounded />}
            label={t('Doppelte zusammenführen')}
            active={view.kind === 'duplicates'}
            href="/contacts/duplicates"
          />
          <NavRow icon={<DeleteOutlineRounded />} label={t('Papierkorb')} active={view.kind === 'trash'} href="/contacts/trash" />
          <ButtonBase
            onClick={() => {
              setImporting({ node: null });
              setDrawer(false);
            }}
            sx={{
              justifyContent: 'flex-start',
              gap: 1.5,
              py: 0.9,
              px: 1.5,
              borderRadius: `${radius.full}px`,
              '&:hover': { bgcolor: mix(c.onSurface, 6) },
              '& svg': { fontSize: 20 },
            }}
          >
            <UploadFileRounded />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('Importieren')}
            </Typography>
          </ButtonBase>
          <ButtonBase
            onClick={() => {
              setSyncing(true);
              setDrawer(false);
            }}
            sx={{
              justifyContent: 'flex-start',
              gap: 1.5,
              py: 0.9,
              px: 1.5,
              borderRadius: `${radius.full}px`,
              '&:hover': { bgcolor: mix(c.onSurface, 6) },
              '& svg': { fontSize: 20 },
            }}
          >
            <DevicesRounded />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('Auf Geräten nutzen')}
            </Typography>
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );

  const selectedIds = [...checked];
  const bulk = async (action: 'delete' | 'move' | 'label' | 'export') => {
    try {
      if (action === 'export') {
        download(`/api/contacts/export?ids=${selectedIds.join(',')}`);
        return;
      }
      if (action === 'delete') {
        const ok = await confirm({
          title: tn(selectedIds.length, 'Einen Kontakt löschen?', '{count} Kontakte löschen?'),
          text: t('Sie landen im Papierkorb und lassen sich von dort wiederherstellen.'),
          confirm: t('Löschen'),
          danger: true,
        });
        if (!ok) return;
        await contactsApi.remove(selectedIds);
      }
      if (action === 'move') {
        const target = await choose({
          title: t('In welches Adressbuch?'),
          options: writable.map((book) => ({
            value: book.id,
            label: book.owner ? t('{name} ({owner})', { name: book.name, owner: book.owner.name }) : book.name,
          })),
        });
        if (!target) return;
        const result = await contactsApi.move(selectedIds, target);
        toast(tn(result.moved, 'Ein Kontakt verschoben', '{count} Kontakte verschoben'));
      }
      if (action === 'label') {
        const name = await prompt({
          title: t('Label hinzufügen'),
          label: t('Label'),
          value: '',
          confirm: t('Hinzufügen'),
          helper: t('Zum Beispiel Familie oder Verein'),
        });
        if (!name?.trim()) return;
        await contactsApi.label(selectedIds, name.trim());
      }
      setChecked(new Set());
    } catch (failure) {
      toast(errorText(failure));
    }
  };

  const topBar = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 1 }, flex: 1, minWidth: 0 }}>
      {!desktop && (
        <Tooltip title={t('Adressbücher')}>
          <IconButton aria-label={t('Adressbücher')} onClick={() => setDrawer(true)}>
            <MenuRounded />
          </IconButton>
        </Tooltip>
      )}
      <Typography
        component="h1"
        variant="h6"
        noWrap
        sx={{ fontWeight: 700, fontSize: { xs: 18, sm: 20 }, minWidth: 0, flexShrink: 1, ml: 0.5 }}
      >
        {title}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {listView && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            height: 44,
            width: { xs: 160, sm: 280, md: 360 },
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          <SearchRounded sx={{ color: c.onSurfaceVariant, fontSize: 20 }} />
          <InputBase
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Kontakte durchsuchen')}
            inputProps={{ 'aria-label': t('Kontakte durchsuchen') }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          {search && (
            <IconButton size="small" aria-label={t('Suche leeren')} onClick={() => setSearch('')}>
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      )}
      <Tooltip title={t('Mehr')}>
        <IconButton aria-label={t('Weitere Aktionen')} aria-haspopup="menu" onClick={(event) => setMoreMenu(event.currentTarget)}>
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={moreMenu} open={Boolean(moreMenu)} onClose={() => setMoreMenu(null)}>
        <MenuItem
          selected={order === 'first'}
          onClick={() => {
            setSort('first');
            setMoreMenu(null);
          }}
        >
          <ListItemText>{t('Nach Vorname sortieren')}</ListItemText>
        </MenuItem>
        <MenuItem
          selected={order === 'last'}
          onClick={() => {
            setSort('last');
            setMoreMenu(null);
          }}
        >
          <ListItemText>{t('Nach Nachname sortieren')}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            setImporting({ node: null });
          }}
        >
          <ListItemIcon>
            <UploadFileRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('Importieren')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            download(`/api/contacts/export${currentBook ? `?book=${currentBook.id}` : ''}`);
          }}
        >
          <ListItemIcon>
            <DownloadRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText>{currentBook ? t('Adressbuch exportieren') : t('Alle Kontakte exportieren')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreMenu(null);
            setSyncing(true);
          }}
        >
          <ListItemIcon>
            <DevicesRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('Auf Geräten nutzen')}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );

  const showDetail = Boolean(selected);
  const showList = !showDetail || desktop;
  const trash = view.kind === 'trash';

  let listContent: ReactNode;
  if (view.kind === 'birthdays') listContent = <BirthdaysView onOpen={(id) => open(id)} />;
  else if (view.kind === 'duplicates') listContent = <DuplicatesView onOpen={(id) => open(id)} />;
  else if (error && !items)
    listContent = (
      <Alert severity="warning" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  else if (!items) listContent = <LinearProgress />;
  else if (!items.length)
    listContent = search ? (
      <EmptyState
        compact
        icon={<SearchRounded />}
        title={t('Nichts gefunden')}
        text={t('Kein Kontakt passt zu „{query}“.', { query: search })}
      />
    ) : trash ? (
      <EmptyState icon={<DeleteOutlineRounded />} title={t('Der Papierkorb ist leer')} />
    ) : (
      <EmptyState
        icon={<ContactsRounded />}
        title={view.kind === 'favorites' ? t('Noch keine Favoriten') : t('Noch keine Kontakte')}
        text={
          view.kind === 'favorites'
            ? t('Markier Kontakte mit dem Stern, dann stehen sie hier und ganz oben in der Liste.')
            : t('Leg Kontakte an oder hol sie von deinem Telefon, aus Google oder Outlook.')
        }
        action={
          view.kind === 'favorites' ? undefined : (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={newContact}>
                {t('Neuer Kontakt')}
              </Button>
              <Button variant="outlined" startIcon={<UploadFileRounded />} onClick={() => setImporting({ node: null })}>
                {t('Importieren')}
              </Button>
            </Box>
          )
        }
      />
    );
  else
    listContent = (
      <ContactList
        items={items}
        selected={selected}
        checked={checked}
        trash={trash}
        order={order}
        onOpen={(id) => open(id)}
        onCheck={(id, value) =>
          setChecked((current) => {
            const next = new Set(current);
            if (value) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        onRestore={async (id) => {
          try {
            await contactsApi.restore(id);
            toast(t('Kontakt wiederhergestellt'));
          } catch (failure) {
            toast(errorText(failure));
          }
        }}
        onDestroy={async (id) => {
          const ok = await confirm({
            title: t('Endgültig löschen?'),
            text: t('Das lässt sich nicht rückgängig machen.'),
            confirm: t('Löschen'),
            danger: true,
          });
          if (!ok) return;
          try {
            await contactsApi.destroy(id);
            if (selected === id) open(null);
          } catch (failure) {
            toast(errorText(failure));
          }
        }}
      />
    );

  return (
    <AppShell
      active="contacts"
      topBar={topBar}
      framed={false}
      mobileAction={
        !showDetail ? (
          <Fab
            color="primary"
            aria-label={t('Neuer Kontakt')}
            onClick={newContact}
            sx={{
              borderRadius: `${radius.md}px`,
              width: 64,
              height: 64,
              bgcolor: c.primaryContainer,
              color: c.onPrimaryContainer,
              '&:hover': { bgcolor: c.primaryContainer },
            }}
          >
            <PersonAddAlt1Rounded />
          </Fab>
        ) : undefined
      }
    >
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          height: { xs: 'calc(100dvh - 64px - 80px - env(safe-area-inset-bottom))', md: '100%' },
          minHeight: 0,
        }}
      >
        {desktop && (
          <Box component="aside" aria-label={t('Adressbücher und Labels')} sx={{ width: SIDEBAR, flex: 'none', pt: 1, minHeight: 0 }}>
            {sidebar}
          </Box>
        )}
        {!desktop && (
          <Drawer
            open={drawer}
            onClose={() => setDrawer(false)}
            slotProps={{ paper: { sx: { width: 300, pt: 2, bgcolor: c.surfaceContainerLow } } }}
          >
            {sidebar}
          </Drawer>
        )}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            minHeight: 0,
            bgcolor: { md: c.surfaceContainerLowest },
            borderRadius: { md: `${radius.xl}px` },
            border: { md: `1px solid ${c.outlineVariant}` },
            overflow: 'hidden',
          }}
        >
          {showList && (
            <Box
              sx={{
                width: showDetail && desktop ? (wide ? 420 : 340) : '100%',
                flex: showDetail && desktop ? 'none' : 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: showDetail && desktop ? `1px solid ${c.outlineVariant}` : 'none',
              }}
            >
              {checked.size > 0 && (
                <Box
                  data-bulk-bar
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1,
                    py: 0.5,
                    bgcolor: c.secondaryContainer,
                    color: c.onSecondaryContainer,
                  }}
                >
                  <Tooltip title={t('Auswahl aufheben')}>
                    <IconButton aria-label={t('Auswahl aufheben')} onClick={() => setChecked(new Set())} sx={{ color: 'inherit' }}>
                      <CloseRounded />
                    </IconButton>
                  </Tooltip>
                  <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
                    {tn(checked.size, 'Einer ausgewählt', '{count} ausgewählt')}
                  </Typography>
                  <Tooltip title={t('Label hinzufügen')}>
                    <IconButton aria-label={t('Label hinzufügen')} onClick={() => void bulk('label')} sx={{ color: 'inherit' }}>
                      <SellOutlined />
                    </IconButton>
                  </Tooltip>
                  {writable.length > 1 && (
                    <Tooltip title={t('Verschieben')}>
                      <IconButton aria-label={t('Verschieben')} onClick={() => void bulk('move')} sx={{ color: 'inherit' }}>
                        <DriveFileMoveOutlined />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={t('Exportieren')}>
                    <IconButton aria-label={t('Exportieren')} onClick={() => void bulk('export')} sx={{ color: 'inherit' }}>
                      <DownloadRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Löschen')}>
                    <IconButton aria-label={t('Löschen')} onClick={() => void bulk('delete')} sx={{ color: 'inherit' }}>
                      <DeleteOutlineRounded />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              {trash && items && items.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
                  <Typography variant="caption" sx={{ flex: 1, color: c.onSurfaceVariant }}>
                    {t('Gelöschte Kontakte bleiben eine Weile hier und verschwinden dann endgültig.')}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('Papierkorb leeren?'),
                        text: t('Alle Kontakte im Papierkorb werden endgültig gelöscht.'),
                        confirm: t('Leeren'),
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await contactsApi.emptyTrash();
                      } catch (failure) {
                        toast(errorText(failure));
                      }
                    }}
                  >
                    {t('Papierkorb leeren')}
                  </Button>
                </Box>
              )}
              <Box sx={{ flex: 1, minHeight: 0 }}>{listContent}</Box>
            </Box>
          )}
          {showDetail && selected && (
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <ContactDetail
                key={selected}
                id={selected}
                books={books}
                showBack={!desktop}
                onClose={() => open(null)}
                onEdit={(detail) => setEditor({ detail, bookId: detail.bookId })}
              />
            </Box>
          )}
        </Box>
      </Box>
      <Suspense fallback={null}>
        {editor && (
          <ContactEditor
            request={editor}
            books={books}
            labels={labelNames}
            onClose={() => setEditor(null)}
            onSaved={(detail) => {
              setEditor(null);
              void loadMeta();
              void loadList();
              open(detail.id);
            }}
          />
        )}
        {importing && (
          <ImportDialog
            books={books}
            node={importing.node}
            defaultBook={defaultBook}
            onClose={() => setImporting(null)}
            onDone={(bookId) => {
              setImporting(null);
              void loadMeta();
              go(`/contacts/book/${bookId}`);
            }}
          />
        )}
        {sharing && (
          <ShareDialog
            book={sharing}
            onClose={() => {
              setSharing(null);
              void loadMeta();
            }}
          />
        )}
        {syncing && <SyncDialog onClose={() => setSyncing(false)} />}
      </Suspense>
    </AppShell>
  );
}
