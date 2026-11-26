import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import { api, errorText } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { formatDayMedium, formatTime, keyOf } from './dates';
import type { CalendarInfo } from './model';
import { invalidate, loadCalendars } from './store';

interface Trash {
  calendars: { id: string; name: string; color: string; trashedAt: number }[];
  events: {
    id: string;
    calendarId: string;
    title: string;
    component: 'VEVENT' | 'VTODO';
    start: number | null;
    allDay: boolean;
    recurring: boolean;
    trashedAt: number;
  }[];
  days: number;
}

export function TrashView({ calendars }: { calendars: Map<string, CalendarInfo> }) {
  const [trash, setTrash] = useState<Trash | null>(null);
  const load = () =>
    api
      .get<Trash>('/api/calendar/trash')
      .then(setTrash)
      .catch((error) => toast(errorText(error)));
  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message);
      invalidate();
      await Promise.all([load(), loadCalendars()]);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const purgeAll = async () => {
    if (!trash) return;
    const ok = await confirm({
      title: t('Papierkorb leeren?'),
      text: t('Alle Einträge im Papierkorb werden endgültig gelöscht.'),
      confirm: t('Endgültig löschen'),
      danger: true,
    });
    if (!ok) return;
    await run(
      () =>
        Promise.all([
          ...trash.events.map((event) => api.delete(`/api/calendar/events/${event.id}/forever`)),
          ...trash.calendars.map((calendar) => api.delete(`/api/calendar/calendars/${calendar.id}/forever`)),
        ]),
      t('Papierkorb geleert')
    );
  };

  const empty = trash && !trash.events.length && !trash.calendars.length;
  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 860, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
              {t('Papierkorb')}
            </Typography>
            {trash && (
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {tn(trash.days, 'Einträge werden nach 1 Tag endgültig gelöscht.', 'Einträge werden nach {count} Tagen endgültig gelöscht.')}
              </Typography>
            )}
          </Box>
          {trash && !empty && (
            <Button color="error" startIcon={<DeleteForeverRounded />} onClick={() => void purgeAll()}>
              {t('Leeren')}
            </Button>
          )}
        </Box>
        {!trash && <LinearProgress />}
        {empty && (
          <EmptyState
            icon={<DeleteOutlineRounded />}
            title={t('Der Papierkorb ist leer')}
            text={t('Gelöschte Termine, Aufgaben und Kalender landen erst einmal hier.')}
          />
        )}
        {trash && trash.calendars.length > 0 && (
          <Box sx={{ borderRadius: `${radius.lg}px`, bgcolor: c.surfaceContainerLow, p: 1 }}>
            <Typography variant="overline" sx={{ px: 1.5, color: c.onSurfaceVariant, fontWeight: 800 }}>
              {t('Kalender')}
            </Typography>
            {trash.calendars.map((calendar) => (
              <Box key={calendar.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1 }}>
                <Box sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: calendar.color }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>
                    {calendar.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {t('Gelöscht {time}', { time: formatRelative(calendar.trashedAt) })}
                  </Typography>
                </Box>
                <Tooltip title={t('Wiederherstellen')}>
                  <IconButton
                    aria-label={t('{name} wiederherstellen', { name: calendar.name })}
                    onClick={() =>
                      void run(() => api.post(`/api/calendar/calendars/${calendar.id}/restore`), t('Kalender wiederhergestellt'))
                    }
                  >
                    <RestoreFromTrashRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Endgültig löschen')}>
                  <IconButton
                    aria-label={t('{name} endgültig löschen', { name: calendar.name })}
                    onClick={() => void run(() => api.delete(`/api/calendar/calendars/${calendar.id}/forever`), t('Endgültig gelöscht'))}
                  >
                    <DeleteForeverRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
        {trash && trash.events.length > 0 && (
          <Box sx={{ borderRadius: `${radius.lg}px`, bgcolor: c.surfaceContainerLow, p: 1 }}>
            <Typography variant="overline" sx={{ px: 1.5, color: c.onSurfaceVariant, fontWeight: 800 }}>
              {t('Termine und Aufgaben')}
            </Typography>
            {trash.events.map((event) => {
              const calendar = calendars.get(event.calendarId);
              const when =
                event.start === null
                  ? t('Ohne Datum')
                  : event.allDay
                    ? formatDayMedium(new Date(event.start).toISOString().slice(0, 10))
                    : `${formatDayMedium(keyOf(event.start))}, ${formatTime(event.start)}`;
              return (
                <Box key={event.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1 }}>
                  <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: calendar?.color ?? c.outline }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>
                      {event.title || t('(Ohne Titel)')}
                      {event.recurring && (
                        <EventRepeatRounded sx={{ fontSize: 15, ml: 0.75, verticalAlign: 'middle', color: c.onSurfaceVariant }} />
                      )}
                    </Typography>
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                      {[when, calendar?.name, t('gelöscht {time}', { time: formatRelative(event.trashedAt) })].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <Tooltip title={t('Wiederherstellen')}>
                    <IconButton
                      aria-label={t('{name} wiederherstellen', { name: event.title })}
                      onClick={() => void run(() => api.post(`/api/calendar/events/${event.id}/restore`), t('Wiederhergestellt'))}
                    >
                      <RestoreFromTrashRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Endgültig löschen')}>
                    <IconButton
                      aria-label={t('{name} endgültig löschen', { name: event.title })}
                      onClick={() => void run(() => api.delete(`/api/calendar/events/${event.id}/forever`), t('Endgültig gelöscht'))}
                    >
                      <DeleteForeverRounded />
                    </IconButton>
                  </Tooltip>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
