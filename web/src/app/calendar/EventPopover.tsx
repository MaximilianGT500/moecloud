import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import GroupOutlined from '@mui/icons-material/GroupOutlined';
import CalendarTodayRounded from '@mui/icons-material/CalendarTodayRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import HelpRounded from '@mui/icons-material/HelpRounded';
import CancelRounded from '@mui/icons-material/CancelRounded';
import HourglassEmptyRounded from '@mui/icons-material/HourglassEmptyRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import CelebrationRounded from '@mui/icons-material/CelebrationRounded';
import ContactPageRounded from '@mui/icons-material/ContactPageRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import { errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { UserAvatar, copyText } from '../common/bits';
import { choose, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { alarmText, formatDayLong, formatSpan, formatTime, getZone, keyOf } from './dates';
import { colorOf } from './colors';
import { ageOf, displayTitle } from './display';
import { calendarApi, videoProvider, type EventDetail, type Occurrence, type PartStat, type Scope } from './model';
import { invalidate, patchLocal, useCalendarState } from './store';

interface Props {
  item: Occurrence;
  anchor: HTMLElement | null;
  onClose: () => void;
  onEdit: (detail: EventDetail, item: Occurrence) => void;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

function plain(text: string) {
  if (!/<\/?[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function Linkified({ text }: { text: string }) {
  const parts = plain(text).split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <Link key={index} href={part} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>
            {part}
          </Link>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      <Box sx={{ width: 20, flex: 'none', color: c.onSurfaceVariant, display: 'flex', mt: '2px', '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>{children}</Box>
    </Box>
  );
}

const STATUS_ICON: Record<string, ReactNode> = {
  ACCEPTED: <CheckCircleRounded sx={{ color: '#22c55e', fontSize: 15 }} />,
  DECLINED: <CancelRounded sx={{ color: '#ef4444', fontSize: 15 }} />,
  TENTATIVE: <HelpRounded sx={{ color: '#f59e0b', fontSize: 15 }} />,
  'NEEDS-ACTION': <HourglassEmptyRounded sx={{ color: '#94a3b8', fontSize: 15 }} />,
};

export function EventPopover({ item, anchor, onClose, onEdit }: Props) {
  const { calendars, prefs } = useCalendarState();
  const mobile = useMediaQuery('(max-width:600px)');
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [rsvp, setRsvp] = useState<PartStat | null>(null);
  const calendar = calendars.find((entry) => entry.id === item.calendarId);
  const color = colorOf(item, calendar, prefs?.colorBy);

  useEffect(() => {
    if (item.holiday || item.contactId) return;
    let alive = true;
    setDetail(null);
    setFailed(null);
    calendarApi
      .detail(item.eventId, item.recurrenceId)
      .then((result) => {
        if (!alive) return;
        setDetail(result);
        setRsvp(result.myStatus);
      })
      .catch((error) => alive && setFailed(errorText(error)));
    return () => {
      alive = false;
    };
  }, [item.eventId, item.recurrenceId, item.holiday, item.contactId]);

  const base = detail ? (detail.instance ?? detail.data) : null;
  const recurring = Boolean(detail?.data.rrule || detail?.data.rdates.length);
  const canEdit = Boolean(detail && !detail.readOnly && !detail.busyOnly);
  const canDelete = canEdit;
  const task = item.component === 'VTODO';
  const zone = getZone();
  const otherZone = base && !base.allDay && !base.floating && base.zone && base.zone !== zone ? base.zone : null;
  const age = ageOf(item);

  const remove = async () => {
    if (!detail) return;
    let scope: Scope = 'all';
    const rid = item.recurrenceId;
    if (recurring && rid) {
      const picked = await choose({
        title: task ? t('Wiederkehrende Aufgabe löschen') : t('Wiederkehrenden Termin löschen'),
        options: [
          { value: 'this', label: t('Nur diesen Termin') },
          { value: 'following', label: t('Diesen und alle folgenden') },
          { value: 'all', label: t('Alle Termine der Serie'), primary: true },
        ],
      });
      if (!picked) return;
      scope = picked as Scope;
    }
    onClose();
    patchLocal(
      (entry) =>
        entry.eventId === detail.id && (scope === 'all' || (scope === 'this' ? entry.recurrenceId === rid : entry.start >= item.start)),
      () => null
    );
    try {
      const result = await calendarApi.remove(detail.id, scope, rid);
      invalidate();
      if (result.trashed) {
        toast(task ? t('Aufgabe gelöscht') : t('Termin gelöscht'), {
          action: {
            label: t('Rückgängig'),
            onClick: () =>
              void calendarApi
                .restore(detail.id)
                .then(invalidate)
                .catch((error) => toast(errorText(error))),
          },
        });
      } else toast(t('Aus der Serie entfernt'));
    } catch (error) {
      toast(errorText(error));
      invalidate();
    }
  };

  const duplicate = async () => {
    setMenu(null);
    if (!detail) return;
    try {
      await calendarApi.duplicate(detail.id, item.recurrenceId);
      invalidate();
      toast(t('Kopie erstellt'));
      onClose();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const answer = async (status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE', withComment = false) => {
    if (!detail) return;
    let comment: string | undefined;
    if (withComment) {
      const text = await prompt({
        title: t('Nachricht an die Organisation'),
        label: t('Nachricht'),
        value: '',
        confirm: t('Senden'),
        multiline: true,
        optional: true,
        maxLength: 500,
      });
      if (text === null) return;
      comment = text;
    }
    const before = rsvp;
    setRsvp(status);
    try {
      await calendarApi.rsvp(detail.id, status, comment);
      invalidate();
      toast(status === 'ACCEPTED' ? t('Zugesagt') : status === 'DECLINED' ? t('Abgesagt') : t('Mit Vielleicht geantwortet'));
    } catch (error) {
      setRsvp(before);
      toast(errorText(error));
    }
  };

  const hide = async () => {
    setMenu(null);
    if (!detail) return;
    try {
      await calendarApi.hide(detail.id, true);
      invalidate();
      onClose();
      toast(t('Einladung ausgeblendet'), {
        action: { label: t('Rückgängig'), onClick: () => void calendarApi.hide(detail.id, false).then(invalidate) },
      });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const toggleTask = async () => {
    if (!detail) return;
    try {
      await calendarApi.complete(detail.id, !item.completed, item.recurrenceId);
      invalidate();
      onClose();
    } catch (error) {
      toast(errorText(error));
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelectorAll('.MuiDialog-root, .MuiMenu-root').length > (mobile || !anchor ? 1 : 0)) return;
      if (event.key === 'e' && canEdit && detail) {
        event.preventDefault();
        onEdit(detail, item);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && canDelete) {
        event.preventDefault();
        void remove();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const link = `${location.origin}/calendar?event=${item.eventId}${item.recurrenceId ? `&rid=${item.recurrenceId}` : ''}`;
  const attendees = base?.attendees ?? [];
  const counts = attendees.reduce<Record<string, number>>(
    (all, attendee) => ({ ...all, [attendee.status]: (all[attendee.status] ?? 0) + 1 }),
    {}
  );
  const provider = videoProvider(base?.conference);
  const mailto = attendees.length
    ? `mailto:${attendees
        .filter((attendee) => !attendee.email.endsWith('.invalid'))
        .map((attendee) => attendee.email)
        .join(',')}?subject=${encodeURIComponent(base?.title ?? '')}`
    : null;

  const body = (
    <Box sx={{ width: mobile ? '100%' : 440, maxWidth: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25, px: 1, pt: 1 }}>
        {canEdit && (
          <Tooltip title={t('Bearbeiten')}>
            <IconButton aria-label={t('Bearbeiten')} onClick={() => detail && onEdit(detail, item)}>
              <EditRounded />
            </IconButton>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title={t('Löschen')}>
            <IconButton aria-label={t('Löschen')} onClick={() => void remove()}>
              <DeleteOutlineRounded />
            </IconButton>
          </Tooltip>
        )}
        {!item.holiday && !item.contactId && (
          <Tooltip title={t('Mehr')}>
            <IconButton aria-label={t('Mehr')} onClick={(event) => setMenu(event.currentTarget)} disabled={!detail}>
              <MoreVertRounded />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('Schließen')}>
          <IconButton aria-label={t('Schließen')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Tooltip>
      </Box>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {detail && !detail.busyOnly && (
          <MenuItem onClick={() => void duplicate()} disabled={!canEdit && !calendars.some((entry) => entry.access === 'owner')}>
            <ListItemIcon>
              <ContentCopyRounded />
            </ListItemIcon>
            {t('Duplizieren')}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenu(null);
            void copyText(link, t('Link kopiert'));
          }}
        >
          <ListItemIcon>
            <LinkRounded />
          </ListItemIcon>
          {t('Link kopieren')}
        </MenuItem>
        {detail && !detail.busyOnly && (
          <MenuItem component="a" href={`/api/calendar/events/${item.eventId}/ics`} download onClick={() => setMenu(null)}>
            <ListItemIcon>
              <DownloadRounded />
            </ListItemIcon>
            {t('Als ICS herunterladen')}
          </MenuItem>
        )}
        {mailto && (
          <MenuItem component="a" href={mailto} onClick={() => setMenu(null)}>
            <ListItemIcon>
              <MailOutlineRounded />
            </ListItemIcon>
            {t('E-Mail an alle Gäste')}
          </MenuItem>
        )}
        {detail?.invited && (
          <MenuItem onClick={() => void hide()}>
            <ListItemIcon>
              <VisibilityOffRounded />
            </ListItemIcon>
            {t('Einladung ausblenden')}
          </MenuItem>
        )}
      </Menu>

      <Box
        sx={{
          px: 3,
          pb: 2.5,
          pt: 0.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.75,
          maxHeight: mobile ? 'none' : 'min(70vh, 640px)',
          overflowY: 'auto',
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          {task ? (
            <IconButton
              aria-label={item.completed ? t('Als offen markieren') : t('Als erledigt markieren')}
              onClick={() => void toggleTask()}
              disabled={!canEdit}
              sx={{ color, m: -1, mt: -0.5 }}
            >
              {item.completed ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
            </IconButton>
          ) : (
            <Box sx={{ width: 20, height: 20, flex: 'none', mt: 0.75, borderRadius: '6px', bgcolor: color }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h5"
              component="h2"
              sx={{ fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere', textDecoration: item.completed ? 'line-through' : 'none' }}
            >
              {displayTitle(item, prefs ? { ...prefs, emoji: false, hideTitle: false } : null)}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 0.5 }}>
              {task
                ? t('Fällig: {when}', {
                    when:
                      item.allDay && item.startDate
                        ? formatDayLong(item.startDate)
                        : `${formatDayLong(keyOf(item.start))} · ${formatTime(item.start)}`,
                  })
                : formatSpan(item.start, item.end, item.allDay)}
            </Typography>
            {otherZone && (
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PublicRounded sx={{ fontSize: 14 }} />
                {t('{time} in {zone}', {
                  time: `${formatTime(item.start, otherZone)}–${formatTime(item.end, otherZone)}`,
                  zone: otherZone.replace(/_/g, ' '),
                })}
              </Typography>
            )}
            {detail?.recurrence && (
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <EventRepeatRounded sx={{ fontSize: 14 }} />
                {detail.recurrence}
              </Typography>
            )}
          </Box>
        </Box>

        {item.holiday && (
          <Line icon={<CelebrationRounded />}>
            {item.holiday === 'holiday' ? t('Gesetzlicher Feiertag') : t('Aktions- oder Gedenktag')}
          </Line>
        )}
        {age !== null && <Line icon={<CelebrationRounded />}>{t('Wird {age} Jahre alt', { age })}</Line>}
        {item.contactId && (
          <Box>
            <Button size="small" variant="outlined" startIcon={<ContactPageRounded />} href={`/contacts?c=${item.contactId}`}>
              {t('Kontakt öffnen')}
            </Button>
          </Box>
        )}

        {!item.holiday && !item.contactId && !detail && !failed && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Skeleton width="70%" />
            <Skeleton width="50%" />
            <Skeleton width="60%" />
          </Box>
        )}
        {failed && (
          <Typography variant="body2" sx={{ color: c.error }}>
            {failed}
          </Typography>
        )}

        {detail && base && (
          <>
            {detail.busyOnly && <Line icon={<LockRounded />}>{t('Für dich sind nur Zeiten sichtbar, keine Details.')}</Line>}
            {base.conference && (
              <Line icon={<VideocamRounded />}>
                <Button variant="contained" href={base.conference} target="_blank" rel="noopener noreferrer" size="small" sx={{ mb: 0.5 }}>
                  {provider ? t('Mit {provider} teilnehmen', { provider }) : t('Videokonferenz beitreten')}
                </Button>
                <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
                  {base.conference.replace(/^https?:\/\//, '')}
                </Typography>
              </Line>
            )}
            {base.location && (
              <Line icon={<PlaceOutlined />}>
                {/^https?:\/\//.test(base.location) ? (
                  <Linkified text={base.location} />
                ) : (
                  <>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {base.location}
                    </Typography>
                    <Link
                      variant="caption"
                      href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(base.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('Auf der Karte zeigen')}
                    </Link>
                  </>
                )}
              </Line>
            )}
            {attendees.length > 0 && (
              <Line icon={<GroupOutlined />}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('{count} Gäste', { count: attendees.length })}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {[
                    counts.ACCEPTED ? t('{count} Zusagen', { count: counts.ACCEPTED }) : null,
                    counts.TENTATIVE ? t('{count} vielleicht', { count: counts.TENTATIVE }) : null,
                    counts.DECLINED ? t('{count} Absagen', { count: counts.DECLINED }) : null,
                    counts['NEEDS-ACTION'] ? t('{count} ausstehend', { count: counts['NEEDS-ACTION'] }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
                  {base.organizer && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <UserAvatar initials={(base.organizer.name ?? base.organizer.email).slice(0, 1).toUpperCase()} size={28} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {base.organizer.name ?? base.organizer.email}
                        </Typography>
                        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                          {t('Organisation')}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  {attendees.slice(0, 30).map((attendee) => {
                    const info = detail.attendeeInfo.find((entry) => entry.email === attendee.email);
                    return (
                      <Box key={attendee.email} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ position: 'relative' }}>
                          <UserAvatar initials={(attendee.name ?? attendee.email).slice(0, 1).toUpperCase()} size={28} />
                          <Box
                            sx={{
                              position: 'absolute',
                              right: -4,
                              bottom: -4,
                              bgcolor: c.surfaceContainerHigh,
                              borderRadius: '50%',
                              display: 'flex',
                            }}
                          >
                            {STATUS_ICON[attendee.status]}
                          </Box>
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {attendee.name ?? attendee.email}
                            {attendee.role === 'OPT-PARTICIPANT' && (
                              <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                                {t('optional')}
                              </Typography>
                            )}
                          </Typography>
                          {info?.comment && (
                            <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, fontStyle: 'italic' }}>
                              „{info.comment}“
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                  {attendees.length > 30 && (
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                      {t('und {count} weitere', { count: attendees.length - 30 })}
                    </Typography>
                  )}
                </Box>
              </Line>
            )}
            {base.description && (
              <Line icon={<NotesRounded />}>
                <Typography
                  variant="body2"
                  component="div"
                  sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto' }}
                >
                  <Linkified text={base.description} />
                </Typography>
              </Line>
            )}
            {base.url && (
              <Line icon={<LinkRounded />}>
                <Linkified text={base.url} />
              </Line>
            )}
            {task && (base.priority > 0 || base.percent > 0) && (
              <Line icon={<FlagRounded />}>
                {[
                  base.priority > 0
                    ? base.priority <= 4
                      ? t('Hohe Priorität')
                      : base.priority === 5
                        ? t('Mittlere Priorität')
                        : t('Niedrige Priorität')
                    : null,
                  base.percent > 0 ? t('{percent} % erledigt', { percent: base.percent }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Line>
            )}
            {base.categories.length > 0 && (
              <Line icon={<SellOutlined />}>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {base.categories.map((category) => (
                    <Box
                      key={category}
                      component="span"
                      sx={{ px: 1, py: 0.25, borderRadius: `${radius.xs}px`, bgcolor: mix(color, 16), fontSize: 12.5 }}
                    >
                      #{category}
                    </Box>
                  ))}
                </Box>
              </Line>
            )}
            {base.alarms.length > 0 && (
              <Line icon={<NotificationsNoneRounded />}>
                {base.alarms
                  .filter((alarm) => alarm.absolute === null)
                  .map(
                    (alarm) =>
                      `${alarmText(Math.round(-alarm.offset / 60_000), base.allDay)}${alarm.action === 'EMAIL' ? ` (${t('E-Mail')})` : ''}`
                  )
                  .join(', ')}
              </Line>
            )}
            <Line icon={<CalendarTodayRounded />}>
              {detail.calendar.name}
              {calendar && calendar.access !== 'owner' && (
                <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                  {t('von {name}', { name: detail.calendar.owner })}
                </Typography>
              )}
              {!calendar && detail.invited && (
                <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                  {t('Einladung von {name}', { name: base.organizer?.name ?? detail.calendar.owner })}
                </Typography>
              )}
              {base.transparency === 'TRANSPARENT' && !task && (
                <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                  · {t('als frei angezeigt')}
                </Typography>
              )}
              {base.privacy !== 'PUBLIC' && (
                <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 0.75 }}>
                  · {t('privat')}
                </Typography>
              )}
            </Line>
          </>
        )}
      </Box>

      {detail?.invited && !detail.busyOnly && (
        <>
          <Divider />
          <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 120 }}>
              {recurring ? t('Teilnehmen (ganze Serie)?') : t('Teilnehmen?')}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={rsvp}
              onChange={(_event, value: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | null) => value && void answer(value)}
            >
              <ToggleButton value="ACCEPTED">{t('Ja')}</ToggleButton>
              <ToggleButton value="TENTATIVE">{t('Vielleicht')}</ToggleButton>
              <ToggleButton value="DECLINED">{t('Nein')}</ToggleButton>
            </ToggleButtonGroup>
            <Tooltip title={t('Mit Nachricht antworten')}>
              <IconButton
                size="small"
                aria-label={t('Mit Nachricht antworten')}
                onClick={() =>
                  void answer((rsvp === 'NEEDS-ACTION' || !rsvp ? 'ACCEPTED' : rsvp) as 'ACCEPTED' | 'DECLINED' | 'TENTATIVE', true)
                }
              >
                <MailOutlineRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </>
      )}
    </Box>
  );

  if (mobile || !anchor) {
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        slotProps={{
          paper: {
            sx: {
              borderRadius: `${radius.xl}px`,
              m: mobile ? 1 : 4,
              width: mobile ? 'calc(100% - 16px)' : undefined,
              alignSelf: mobile ? 'flex-end' : 'center',
            },
          },
        }}
      >
        {body}
      </Dialog>
    );
  }
  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
      transformOrigin={{ vertical: 'center', horizontal: 'left' }}
      slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px`, bgcolor: c.surfaceContainerHigh, ml: 1 } } }}
    >
      {body}
    </Popover>
  );
}
