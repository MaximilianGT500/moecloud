import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import CakeRounded from '@mui/icons-material/CakeRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import PhoneRounded from '@mui/icons-material/PhoneRounded';
import PlaceRounded from '@mui/icons-material/PlaceRounded';
import { formatDay } from '../../../lib/format';
import { locale, t, tn } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { UserAvatar } from '../../common/bits';
import { contentUrl, type Item } from '../kinds';
import { Fallback } from './Fallback';
import { parseCalendar, parseContacts, type CalendarEvent, type Contact, type Moment } from './pim';

const TEXT_LIMIT = 4 * 1024 * 1024;

function useText(item: Item, base: string) {
  const url = contentUrl(item, base);
  const [state, setState] = useState<{ url: string; text: string | null } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(url, { credentials: 'same-origin', signal: abort.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('load'))))
      .then((text) => setState({ url, text }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ url, text: null });
      });
    return () => abort.abort();
  }, [url]);
  return state?.url === url ? state : null;
}

function Frame({ item, base, children }: { item: Item; base: string; children: (text: string) => ReactNode }) {
  const state = useText(item, base);
  if (item.size > TEXT_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} />;
  if (!state) return <CircularProgress aria-label={t('Lädt')} />;
  if (state.text === null) return <Fallback item={item} text={t('Die Datei lässt sich nicht anzeigen.')} />;
  return (
    <Box
      sx={{ width: 'min(820px, 100%)', maxHeight: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, p: 0.5 }}
    >
      {children(state.text)}
    </Box>
  );
}

const dayFormat = () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

function when(event: CalendarEvent) {
  const start = event.start;
  if (!start) return t('Ohne Datum');
  const day = dayFormat();
  const time = timeFormat();
  if (start.allDay) {
    const last = event.end ? event.end.time - 86_400_000 : start.time;
    return last > start.time && !sameDay(last, start.time)
      ? `${day.format(start.time)} – ${day.format(last)}`
      : `${day.format(start.time)} · ${t('ganztägig')}`;
  }
  if (!event.end || event.end.time <= start.time) return `${day.format(start.time)}, ${time.format(start.time)}`;
  if (sameDay(start.time, event.end.time)) return `${day.format(start.time)}, ${time.format(start.time)}–${time.format(event.end.time)}`;
  return `${day.format(start.time)}, ${time.format(start.time)} – ${day.format(event.end.time)}, ${time.format(event.end.time)}`;
}

function DateBadge({ moment }: { moment: Moment | null }) {
  const date = moment ? new Date(moment.time) : null;
  return (
    <Box
      aria-hidden
      sx={{
        width: 56,
        height: 56,
        flex: 'none',
        borderRadius: `${radius.md}px`,
        bgcolor: c.primaryContainer,
        color: c.onPrimaryContainer,
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        lineHeight: 1,
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1 }}>{date ? date.getDate() : '–'}</Typography>
      <Typography variant="caption" sx={{ lineHeight: 1.4 }}>
        {date ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(date) : ''}
      </Typography>
    </Box>
  );
}

export function CalendarPreview({ item, base }: { item: Item; base: string }) {
  return (
    <Frame item={item} base={base}>
      {(text) => {
        const events = parseCalendar(text);
        if (!events.length) return <Fallback item={item} text={t('In dieser Datei steht kein Termin.')} />;
        return (
          <>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 0.5 }}>
              {tn(events.length, 'Ein Termin', '{count} Termine')}
            </Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {events.map((event, index) => (
                <Box
                  component="li"
                  key={index}
                  sx={{ display: 'flex', gap: 2, p: 2, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainerHigh, minWidth: 0 }}
                >
                  <DateBadge moment={event.start} />
                  <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {event.title || t('Ohne Titel')}
                    </Typography>
                    <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                      {when(event)}
                      {event.repeats ? ` · ${t('wiederholt sich')}` : ''}
                    </Typography>
                    {event.location && (
                      <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflowWrap: 'anywhere' }}>
                        <PlaceRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} />
                        {event.location}
                      </Typography>
                    )}
                    {event.description && (
                      <Typography
                        variant="body2"
                        sx={{
                          color: c.onSurfaceVariant,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          mt: 0.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 6,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {event.description}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </>
        );
      }}
    </Frame>
  );
}

const phoneLabel = (type: string) =>
  type === 'cell' ? t('Mobil') : type === 'home' ? t('Privat') : type === 'work' ? t('Arbeit') : type === 'fax' ? t('Fax') : '';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';

function birthday(value: string) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  return match ? formatDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()) : value;
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
      <Box sx={{ color: c.onSurfaceVariant, display: 'flex', pt: 0.25 }}>{icon}</Box>
      <Typography variant="body2" component="div" sx={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {children}
      </Typography>
    </Box>
  );
}

function Card({ contact }: { contact: Contact }) {
  const name = contact.name || contact.organization || contact.emails[0] || t('Ohne Namen');
  return (
    <Box
      component="li"
      sx={{
        p: 2,
        borderRadius: `${radius.md}px`,
        bgcolor: c.surfaceContainerHigh,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <UserAvatar initials={initialsOf(name)} size={44} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {name}
          </Typography>
          {(contact.organization || contact.role) && contact.name ? (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
              {[contact.role, contact.organization].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
        </Box>
      </Box>
      {contact.phones.map((phone, index) => (
        <Detail key={`tel-${index}`} icon={<PhoneRounded fontSize="small" />}>
          <Link href={`tel:${phone.value.replace(/[^\d+]/g, '')}`}>{phone.value}</Link>
          {phoneLabel(phone.type) ? (
            <Box component="span" sx={{ color: c.onSurfaceVariant }}>
              {` · ${phoneLabel(phone.type)}`}
            </Box>
          ) : null}
        </Detail>
      ))}
      {contact.emails.map((email, index) => (
        <Detail key={`mail-${index}`} icon={<MailOutlineRounded fontSize="small" />}>
          <Link href={`mailto:${email}`}>{email}</Link>
        </Detail>
      ))}
      {contact.addresses.map((address, index) => (
        <Detail key={`adr-${index}`} icon={<PlaceRounded fontSize="small" />}>
          {address}
        </Detail>
      ))}
      {contact.birthday && <Detail icon={<CakeRounded fontSize="small" />}>{birthday(contact.birthday)}</Detail>}
      {contact.urls.map((url, index) => (
        <Detail key={`url-${index}`} icon={<LinkRounded fontSize="small" />}>
          <Link href={url} target="_blank" rel="noopener noreferrer">
            {url.replace(/^https?:\/\//i, '')}
          </Link>
        </Detail>
      ))}
      {contact.note && <Detail icon={<NotesRounded fontSize="small" />}>{contact.note}</Detail>}
    </Box>
  );
}

export function ContactPreview({ item, base }: { item: Item; base: string }) {
  return (
    <Frame item={item} base={base}>
      {(text) => {
        const contacts = parseContacts(text);
        if (!contacts.length) return <Fallback item={item} text={t('In dieser Datei steht kein Kontakt.')} />;
        return (
          <>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 0.5 }}>
              {tn(contacts.length, 'Ein Kontakt', '{count} Kontakte')}
            </Typography>
            <Box
              component="ul"
              sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {contacts.map((contact, index) => (
                <Card key={index} contact={contact} />
              ))}
            </Box>
          </>
        );
      }}
    </Frame>
  );
}
