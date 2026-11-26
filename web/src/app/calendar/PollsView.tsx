import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import HowToVoteRounded from '@mui/icons-material/HowToVoteRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import LockOpenRounded from '@mui/icons-material/LockOpenRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { EmptyState, copyText } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { addDays, at, durationText, formatClock, formatDayMedium, today } from './dates';
import { invalidate, writableCalendars } from './store';

import { optionLabel, ResultsTable, type Poll, type PollOption } from './PollTable';

function PollEditor({ poll, onClose, onSaved }: { poll: Poll | null; onClose: () => void; onSaved: () => void }) {
  const compact = useMediaQuery('(max-width:720px)');
  const [title, setTitle] = useState(poll?.title ?? '');
  const [description, setDescription] = useState(poll?.description ?? '');
  const [place, setPlace] = useState(poll?.location ?? '');
  const [options, setOptions] = useState<PollOption[]>(poll?.options ?? []);
  const [settings, setSettings] = useState(poll?.settings ?? { maybe: true, hidden: false, email: false, limit: 0 });
  const [deadline, setDeadline] = useState(poll?.deadline ? new Date(poll.deadline).toISOString().slice(0, 10) : '');
  const [day, setDay] = useState(addDays(today(), 1));
  const [time, setTime] = useState(10 * 60);
  const [duration, setDuration] = useState(60);
  const [allDay, setAllDay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const start = allDay ? Date.parse(`${day}T00:00:00Z`) : at(day, time);
    const end = allDay ? start + 86_400_000 : start + duration * 60_000;
    if (options.some((option) => option.start === start && option.allDay === allDay)) return;
    setOptions([...options, { id: Math.random().toString(36).slice(2, 10), start, end, allDay }].sort((a, b) => a.start - b.start));
    if (!allDay) setTime(Math.min(23 * 60, time + duration));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      title,
      description,
      location: place,
      options: options.map((option) => ({
        id: poll?.options.some((entry) => entry.id === option.id) ? option.id : undefined,
        start: option.start,
        end: option.end,
        allDay: option.allDay,
      })),
      settings,
      deadline: deadline ? Date.parse(`${deadline}T23:59:59Z`) : null,
    };
    try {
      if (poll?.id) await api.patch(`/api/calendar/polls/${poll.id}`, body);
      else {
        const result = await api.post<{ poll: Poll }>('/api/calendar/polls', body);
        await copyText(`${location.origin}/u/${result.poll.token}`, t('Umfrage erstellt, Link kopiert'));
      }
      onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={compact}>
      <DialogTitle>{poll ? t('Umfrage bearbeiten') : t('Neue Terminumfrage')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          autoFocus
          required
          label={t('Titel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('z. B. Spieleabend mit Emi, Mia und Lea')}
        />
        <TextField
          label={t('Beschreibung')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={2}
        />
        <TextField label={t('Ort')} value={place} onChange={(event) => setPlace(event.target.value)} />
        <Box
          sx={{ p: 2, borderRadius: `${radius.lg}px`, bgcolor: c.surfaceContainerHigh, display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <Typography variant="subtitle2">{t('Vorschläge')}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              type="date"
              size="small"
              value={day}
              onChange={(event) => event.target.value && setDay(event.target.value)}
              slotProps={{ htmlInput: { 'aria-label': t('Datum') } }}
            />
            {!allDay && (
              <>
                <TextField
                  select
                  size="small"
                  value={time}
                  onChange={(event) => setTime(Number(event.target.value))}
                  slotProps={{
                    htmlInput: { 'aria-label': t('Uhrzeit') },
                    select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 300 } } } } },
                  }}
                >
                  {Array.from({ length: 96 }, (_, index) => index * 15).map((minutes) => (
                    <MenuItem key={minutes} value={minutes}>
                      {formatClock(minutes)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  slotProps={{ htmlInput: { 'aria-label': t('Dauer') } }}
                >
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                    <MenuItem key={minutes} value={minutes}>
                      {durationText(minutes)}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
            <FormControlLabel
              control={<Switch checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />}
              label={t('Ganztägig')}
            />
            <Button variant="tonal" startIcon={<AddRounded />} onClick={add} disabled={options.length >= 60}>
              {t('Hinzufügen')}
            </Button>
          </Box>
          {options.length === 0 && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Füge mindestens zwei Termine hinzu, zwischen denen abgestimmt wird.')}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {options.map((option) => {
              const label = optionLabel(option);
              return (
                <Chip
                  key={option.id}
                  label={`${label.day}, ${label.time}`}
                  onDelete={() => setOptions(options.filter((entry) => entry.id !== option.id))}
                />
              );
            })}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <FormControlLabel
            control={<Switch checked={settings.maybe} onChange={(event) => setSettings({ ...settings, maybe: event.target.checked })} />}
            label={t('„Vielleicht“ als Antwort erlauben')}
          />
          <FormControlLabel
            control={<Switch checked={settings.hidden} onChange={(event) => setSettings({ ...settings, hidden: event.target.checked })} />}
            label={t('Ergebnisse nur für mich sichtbar')}
          />
          <FormControlLabel
            control={<Switch checked={settings.email} onChange={(event) => setSettings({ ...settings, email: event.target.checked })} />}
            label={t('E-Mail-Adresse abfragen (für die Einladung am Ende)')}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            type="number"
            size="small"
            label={t('Höchstens Zusagen je Termin')}
            value={settings.limit}
            onChange={(event) => setSettings({ ...settings, limit: Math.max(0, Math.min(1000, Number(event.target.value) || 0)) })}
            helperText={t('0 = unbegrenzt')}
            sx={{ width: 240 }}
          />
          <TextField
            type="date"
            size="small"
            label={t('Abstimmen bis')}
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={t('Optional')}
          />
        </Box>
        {busy && <LinearProgress />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !title.trim() || options.length < 1}>
          {poll ? t('Speichern') : t('Erstellen und Link kopieren')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Finalize({ poll, option, onClose, onDone }: { poll: Poll; option: PollOption; onClose: () => void; onDone: () => void }) {
  const calendars = writableCalendars().filter((calendar) => calendar.components.includes('VEVENT'));
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? '');
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const label = optionLabel(option);
  const run = async () => {
    setBusy(true);
    try {
      await api.post(`/api/calendar/polls/${poll.id}/finalize`, { option: option.id, calendarId, invite });
      invalidate();
      toast(t('Termin eingetragen'));
      onDone();
      onClose();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('Termin festlegen')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography>
          {label.day}, {label.time}
        </Typography>
        <TextField select label={t('In Kalender')} value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
          {calendars.map((calendar) => (
            <MenuItem key={calendar.id} value={calendar.id}>
              {calendar.name}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={invite} onChange={(event) => setInvite(event.target.checked)} />}
          label={t('Alle mit E-Mail-Adresse einladen, die nicht abgesagt haben')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" onClick={() => void run()} disabled={busy || !calendarId}>
          {t('Festlegen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PollsView() {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState<Poll | null | 'new'>(null);
  const [finalizing, setFinalizing] = useState<{ poll: Poll; option: PollOption } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () =>
    api
      .get<{ items: Poll[]; enabled: boolean }>('/api/calendar/polls')
      .then((result) => {
        setPolls(result.items);
        setEnabled(result.enabled);
      })
      .catch((error) => toast(errorText(error)));
  useEffect(() => {
    void load();
  }, []);

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 1060, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
              {t('Terminumfragen')}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t(
                'Schlag mehrere Termine vor und lass alle abstimmen, auch ohne Konto. Der beste Termin landet mit einem Klick im Kalender.'
              )}
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing('new')} disabled={!enabled}>
            {t('Neue Umfrage')}
          </Button>
        </Box>
        {!enabled && <Alert severity="info">{t('Terminumfragen sind auf diesem Server ausgeschaltet.')}</Alert>}
        {polls === null && <LinearProgress />}
        {polls?.length === 0 && enabled && (
          <EmptyState
            icon={<HowToVoteRounded />}
            title={t('Noch keine Umfrage')}
            text={t('Ideal für Teamtreffen, Spieleabende oder Familienfeiern.')}
            action={
              <Button variant="contained" onClick={() => setEditing('new')}>
                {t('Erste Umfrage starten')}
              </Button>
            }
          />
        )}
        {polls?.map((poll) => {
          const link = `${location.origin}/u/${poll.token}`;
          const expanded = open === poll.token;
          return (
            <Box
              key={poll.token}
              sx={{
                p: 2.25,
                borderRadius: `${radius.lg}px`,
                bgcolor: c.surfaceContainerLowest,
                border: `1px solid ${c.outlineVariant}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {poll.title}
                    </Typography>
                    {poll.finalOption ? (
                      <Chip size="small" color="primary" icon={<CheckRounded />} label={t('Festgelegt')} />
                    ) : poll.closed ? (
                      <Chip size="small" label={t('Geschlossen')} />
                    ) : (
                      <Chip size="small" color="success" variant="outlined" label={t('Offen')} />
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {[
                      tn(poll.options.length, '1 Vorschlag', '{count} Vorschläge'),
                      tn(poll.count, '1 Stimme', '{count} Stimmen'),
                      poll.deadline ? t('bis {date}', { date: formatDayMedium(new Date(poll.deadline).toISOString().slice(0, 10)) }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Tooltip title={t('Link kopieren')}>
                  <IconButton aria-label={t('Link kopieren')} onClick={() => void copyText(link, t('Link kopiert'))}>
                    <ContentCopyRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Öffnen')}>
                  <IconButton aria-label={t('Öffnen')} href={link} target="_blank" rel="noopener">
                    <OpenInNewRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={poll.closed ? t('Wieder öffnen') : t('Abstimmung schließen')}>
                  <IconButton
                    aria-label={poll.closed ? t('Wieder öffnen') : t('Abstimmung schließen')}
                    onClick={() => void act(() => api.post(`/api/calendar/polls/${poll.id}/close`, { closed: !poll.closed }))}
                  >
                    {poll.closed ? <LockOpenRounded /> : <LockRounded />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Bearbeiten')}>
                  <IconButton aria-label={t('Bearbeiten')} onClick={() => setEditing(poll)}>
                    <EditRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Löschen')}>
                  <IconButton
                    aria-label={t('Löschen')}
                    onClick={async () => {
                      if (await confirm({ title: t('„{title}“ löschen?', { title: poll.title }), confirm: t('Löschen'), danger: true }))
                        void act(() => api.delete(`/api/calendar/polls/${poll.id}`));
                    }}
                  >
                    <DeleteOutlineRounded />
                  </IconButton>
                </Tooltip>
              </Box>
              {expanded ? (
                <ResultsTable
                  poll={poll}
                  onRemoveVote={(vote) => void act(() => api.delete(`/api/calendar/polls/${poll.id}/votes/${vote}`))}
                  onFinalize={(option) => setFinalizing({ poll, option })}
                />
              ) : null}
              <Button onClick={() => setOpen(expanded ? null : poll.token)} sx={{ alignSelf: 'flex-start' }}>
                {expanded ? t('Ergebnisse ausblenden') : t('Ergebnisse ansehen')}
              </Button>
            </Box>
          );
        })}
      </Box>
      {editing && <PollEditor poll={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {finalizing && (
        <Finalize poll={finalizing.poll} option={finalizing.option} onClose={() => setFinalizing(null)} onDone={() => void load()} />
      )}
    </Box>
  );
}
