import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import GroupOutlined from '@mui/icons-material/GroupOutlined';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import CalendarTodayRounded from '@mui/icons-material/CalendarTodayRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import LinkRounded from '@mui/icons-material/LinkRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import BookmarkAddOutlined from '@mui/icons-material/BookmarkAddOutlined';
import BookmarksOutlined from '@mui/icons-material/BookmarksOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import HelpRounded from '@mui/icons-material/HelpRounded';
import CancelRounded from '@mui/icons-material/CancelRounded';
import HourglassEmptyRounded from '@mui/icons-material/HourglassEmptyRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import AssignmentIndOutlined from '@mui/icons-material/AssignmentIndOutlined';
import CakeRounded from '@mui/icons-material/CakeRounded';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { UserAvatar, copyText } from '../common/bits';
import { choose, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { addDays, alarmText, durationText, formatClock, formatTime, getZone } from './dates';
import { changesOf, jitsiLink, payloadOf, timesOf, validate, type AlarmRow, type Form } from './form';
import {
  calendarApi,
  colorName,
  PALETTE,
  videoProvider,
  type CalendarInfo,
  type EventDetail,
  type ItemKind,
  type Occurrence,
  type Scope,
  type Member,
} from './model';
import { PeopleInput, type Picked } from './PeopleInput';
import { describe, RecurrenceField } from './RecurrenceEditor';
import { invalidate, useCalendarState, writableCalendars } from './store';

export interface EditorRequest {
  form: Form;
  detail?: EventDetail | null;
  occurrence?: Occurrence | null;
}

interface Props {
  request: EditorRequest;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onFindTime?: (form: Form, apply: (start: number, end: number, people: Picked[]) => void) => void;
}

const TIMED_ALARMS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const ALLDAY_ALARMS = [-540, 900, 2340, 9540];

function Field({ icon, children, top }: { icon: ReactNode; children: ReactNode; top?: boolean }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: top ? 'flex-start' : 'center' }}>
      <Box sx={{ width: 24, flex: 'none', color: c.onSurfaceVariant, display: 'flex', mt: top ? 1 : 0, '& svg': { fontSize: 22 } }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function TimeSelect({
  value,
  onChange,
  label,
  from,
  date,
}: {
  value: number;
  onChange: (minutes: number) => void;
  label: string;
  from?: number;
  date?: string;
}) {
  const options = useMemo(() => {
    const list: number[] = [];
    for (let minutes = 0; minutes < 1440; minutes += 15) list.push(minutes);
    if (!list.includes(value)) list.push(value);
    return list.sort((a, b) => a - b);
  }, [value]);
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      slotProps={{ htmlInput: { 'aria-label': label }, select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
      sx={{ minWidth: 112 }}
    >
      {options.map((minutes) => (
        <MenuItem key={minutes} value={minutes}>
          {formatClock(minutes)}
          {from !== undefined && date === undefined && minutes > from && (
            <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant, ml: 1 }}>
              ({durationText(minutes - from)})
            </Typography>
          )}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function EventEditor({ request, onClose, onSaved, onFindTime }: Props) {
  const { calendars, prefs } = useCalendarState();
  const compact = useMediaQuery('(max-width:720px)');
  const initial = useRef(request.form);
  const [form, setForm] = useState<Form>(request.form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(Boolean(request.detail) && (request.form.url !== '' || request.form.categories.length > 0));
  const [zones, setZones] = useState(request.form.zone !== getZone());
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; data: Record<string, unknown> }[] | null>(null);
  const [templateMenu, setTemplateMenu] = useState<HTMLElement | null>(null);
  const [conflicts, setConflicts] = useState<Occurrence[]>([]);
  const [category, setCategory] = useState('');
  const detail = request.detail ?? null;
  const editing = Boolean(detail);
  const task = form.component === 'VTODO';
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  const writable = writableCalendars().filter(
    (calendar) => calendar.components.includes(form.component) || calendar.id === form.calendarId
  );
  const calendar = calendars.find((entry) => entry.id === form.calendarId) ?? null;
  const color = form.color ?? calendar?.color ?? c.primary;
  const zoneList = useMemo(() => (zones ? supportedZones() : []), [zones]);
  const features = boot().calendarFeatures;
  const recurringSeries = Boolean(detail?.data.rrule || detail?.data.rdates.length);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    if (!task || !form.calendarId) {
      setMembers([]);
      return;
    }
    let alive = true;
    calendarApi
      .members(form.calendarId)
      .then((list) => {
        if (!alive) return;
        setMembers(list);
        setForm((current) =>
          current.assignee && !list.some((member) => member.id === current.assignee) ? { ...current, assignee: null } : current
        );
      })
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [task, form.calendarId]);

  useEffect(() => {
    if (task || !form.startDate) return;
    const times = timesOf(form);
    const start = typeof times.start === 'number' ? times.start : Date.parse(`${times.start}T00:00:00Z`);
    const end = typeof times.end === 'number' ? times.end : Date.parse(`${times.end}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || form.transparency === 'TRANSPARENT') {
      setConflicts([]);
      return;
    }
    const timer = window.setTimeout(() => {
      calendarApi
        .occurrences(start, end)
        .then((result) =>
          setConflicts(
            result.items.filter(
              (item) =>
                item.eventId !== detail?.id &&
                !item.allDay &&
                item.transparency !== 'TRANSPARENT' &&
                item.invitation !== 'DECLINED' &&
                item.component === 'VEVENT' &&
                item.start < end &&
                item.end > start &&
                !calendars.find((entry) => entry.id === item.calendarId)?.hidden
            )
          )
        )
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.startDate, form.startTime, form.endDate, form.endTime, form.allDay, form.zone, form.transparency, task]);

  const changeStartDate = (date: string) => {
    if (!date) return;
    const span = Math.max(0, Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000));
    set({ startDate: date, endDate: addDays(date, span) });
  };

  const changeStartTime = (minutes: number) => {
    const duration =
      Date.parse(`${form.endDate}T00:00:00Z`) / 60_000 +
      form.endTime -
      (Date.parse(`${form.startDate}T00:00:00Z`) / 60_000 + form.startTime);
    const total = Date.parse(`${form.startDate}T00:00:00Z`) / 60_000 + minutes + Math.max(15, duration);
    const endDate = new Date(total * 60_000).toISOString().slice(0, 10);
    set({ startTime: minutes, endDate, endTime: ((total % 1440) + 1440) % 1440 });
  };

  const save = async () => {
    const problem = validate(form);
    if (problem) {
      setError(t(problem));
      return;
    }
    if (!form.calendarId) {
      setError(t('Wähl einen Kalender aus'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!detail) {
        const result = await calendarApi.create({ ...payloadOf(form), calendarId: form.calendarId });
        invalidate();
        toast(task ? t('Aufgabe gespeichert') : t('Termin gespeichert'));
        onSaved?.(result.id);
        onClose();
        return;
      }
      const changes = changesOf(initial.current, form);
      if (form.calendarId !== detail.calendarId) changes.calendarId = form.calendarId;
      if (!Object.keys(changes).length) {
        onClose();
        return;
      }
      let scope: Scope = 'all';
      const rid = request.occurrence?.recurrenceId ?? detail.recurrenceId ?? null;
      if (recurringSeries && rid) {
        const ruleChanged = 'rrule' in changes;
        const options = [
          ...(ruleChanged || 'calendarId' in changes ? [] : [{ value: 'this', label: t('Nur diesen Termin') }]),
          { value: 'following', label: t('Diesen und alle folgenden') },
          { value: 'all', label: t('Alle Termine der Serie'), primary: true },
        ];
        const picked = await choose({ title: task ? t('Wiederkehrende Aufgabe ändern') : t('Wiederkehrenden Termin ändern'), options });
        if (!picked) {
          setBusy(false);
          return;
        }
        scope = picked as Scope;
      }
      const result = await calendarApi.update(detail.id, changes, scope, scope === 'all' && !('start' in changes) ? null : rid);
      invalidate();
      toast(t('Änderungen gespeichert'));
      onSaved?.(result.created ?? result.id);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const loadTemplates = async (anchor: HTMLElement) => {
    setTemplateMenu(anchor);
    try {
      const result = await api.get<{ items: { id: string; name: string; data: Record<string, unknown> }[] }>('/api/calendar/templates');
      setTemplates(result.items);
    } catch (failure) {
      toast(errorText(failure));
    }
  };

  const applyTemplate = (data: Record<string, unknown>) => {
    const patch = data as Partial<Form> & { duration?: number };
    const next: Partial<Form> = {};
    for (const key of [
      'title',
      'location',
      'conference',
      'description',
      'url',
      'categories',
      'alarms',
      'transparency',
      'privacy',
      'color',
      'kind',
      'attendees',
      'rrule',
      'allDay',
      'priority',
    ] as const) {
      if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
    }
    if (typeof patch.calendarId === 'string' && writable.some((entry) => entry.id === patch.calendarId)) next.calendarId = patch.calendarId;
    setForm((current) => {
      const merged = { ...current, ...next };
      if (typeof patch.duration === 'number' && !merged.allDay) {
        const total = merged.startTime + patch.duration;
        merged.endDate = addDays(merged.startDate, Math.floor(total / 1440));
        merged.endTime = total % 1440;
      }
      return merged;
    });
    setTemplateMenu(null);
  };

  const saveTemplate = async () => {
    setMenu(null);
    const name = await prompt({
      title: t('Als Vorlage speichern'),
      label: t('Name der Vorlage'),
      value: form.title,
      confirm: t('Speichern'),
    });
    if (!name) return;
    const duration = Math.max(0, Math.round((timesOf(form).end as number) - (timesOf(form).start as number)) / 60_000);
    const { startDate: _a, endDate: _b, startTime: _c, endTime: _d, hasDue: _e, zone: _f, completed: _g, ...rest } = form;
    try {
      await api.post('/api/calendar/templates', { name, data: { ...rest, duration: form.allDay ? undefined : duration } });
      toast(t('Vorlage gespeichert'));
    } catch (failure) {
      toast(errorText(failure));
    }
  };

  const addAlarm = () => {
    const used = new Set(form.alarms.map((alarm) => alarm.minutes));
    const options = form.allDay ? ALLDAY_ALARMS : TIMED_ALARMS;
    const minutes = options.find((value) => !used.has(value)) ?? options[0];
    set({ alarms: [...form.alarms, { minutes, email: false }] });
  };

  const updateAlarm = (index: number, patch: Partial<AlarmRow>) =>
    set({ alarms: form.alarms.map((alarm, position) => (position === index ? { ...alarm, ...patch } : alarm)) });

  const addCategory = (value: string) => {
    const name = value.trim().replace(/^#/, '');
    if (!name || form.categories.includes(name)) return;
    set({ categories: [...form.categories, name].slice(0, 20) });
    setCategory('');
  };

  const kinds: [ItemKind, string][] = [
    ['event', t('Termin')],
    ['birthday', t('Geburtstag')],
    ['focus', t('Fokuszeit')],
    ['ooo', t('Abwesend')],
  ];

  const statusIcon = (status: string) =>
    status === 'ACCEPTED' ? (
      <CheckCircleRounded sx={{ color: '#22c55e', fontSize: 16 }} />
    ) : status === 'DECLINED' ? (
      <CancelRounded sx={{ color: c.error, fontSize: 16 }} />
    ) : status === 'TENTATIVE' ? (
      <HelpRounded sx={{ color: '#f59e0b', fontSize: 16 }} />
    ) : (
      <HourglassEmptyRounded sx={{ color: c.onSurfaceVariant, fontSize: 16 }} />
    );

  const alarmOptions = (current: number) => {
    const list = [...(form.allDay ? ALLDAY_ALARMS : TIMED_ALARMS)];
    if (!list.includes(current)) list.push(current);
    return list.sort((a, b) => a - b);
  };

  const title = editing
    ? task
      ? t('Aufgabe bearbeiten')
      : t('Termin bearbeiten')
    : task
      ? t('Neue Aufgabe')
      : form.kind === 'birthday'
        ? t('Neuer Geburtstag')
        : t('Neuer Termin');

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullScreen={compact}
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          'aria-label': title,
          sx: { borderRadius: compact ? 0 : `${radius.xl}px`, maxHeight: compact ? undefined : 'calc(100% - 48px)' },
        },
      }}
    >
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        }}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: { xs: 1, sm: 2 },
            py: 1.25,
            borderBottom: `1px solid ${c.outlineVariant}`,
            bgcolor: mix(color, 10),
          }}
        >
          <IconButton aria-label={t('Schließen')} onClick={onClose} disabled={busy}>
            <CloseRounded />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
            {title}
          </Typography>
          <Tooltip title={t('Vorlagen')}>
            <IconButton aria-label={t('Vorlagen')} onClick={(event) => void loadTemplates(event.currentTarget)}>
              <BookmarksOutlined />
            </IconButton>
          </Tooltip>
          <IconButton aria-label={t('Weitere Optionen')} onClick={(event) => setMenu(event.currentTarget)}>
            <MoreVertRounded />
          </IconButton>
          <Button type="submit" variant="contained" disabled={busy} sx={{ ml: 0.5, px: 3 }}>
            {t('Speichern')}
          </Button>
        </Box>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => void saveTemplate()}>
            <ListItemIcon>
              <BookmarkAddOutlined />
            </ListItemIcon>
            {t('Als Vorlage speichern')}
          </MenuItem>
          {!task && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                const payload = payloadOf(form);
                void copyText(
                  JSON.stringify({ title: payload.title, start: payload.start, end: payload.end, location: payload.location }, null, 2),
                  t('Details kopiert')
                );
              }}
            >
              <ListItemIcon>
                <ContentCopyRounded />
              </ListItemIcon>
              {t('Details kopieren')}
            </MenuItem>
          )}
        </Menu>
        <Menu
          anchorEl={templateMenu}
          open={Boolean(templateMenu)}
          onClose={() => setTemplateMenu(null)}
          slotProps={{ paper: { sx: { minWidth: 240 } } }}
        >
          {templates === null && <MenuItem disabled>{t('Lädt …')}</MenuItem>}
          {templates?.length === 0 && <MenuItem disabled>{t('Noch keine Vorlagen gespeichert')}</MenuItem>}
          {templates?.map((template) => (
            <MenuItem key={template.id} onClick={() => applyTemplate(template.data)}>
              <ListItemText primary={template.name} />
              <IconButton
                size="small"
                edge="end"
                aria-label={t('Vorlage löschen')}
                onClick={(event) => {
                  event.stopPropagation();
                  void api
                    .delete(`/api/calendar/templates/${template.id}`)
                    .then(() => setTemplates((list) => list?.filter((entry) => entry.id !== template.id) ?? null));
                }}
              >
                <DeleteOutlineRounded fontSize="small" />
              </IconButton>
            </MenuItem>
          ))}
        </Menu>

        <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Box sx={{ pl: { sm: 5 } }}>
            <InputBase
              autoFocus={!editing}
              fullWidth
              value={form.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder={task ? t('Was ist zu tun?') : form.kind === 'birthday' ? t('Wer hat Geburtstag?') : t('Titel hinzufügen')}
              inputProps={{ 'aria-label': t('Titel'), maxLength: 500 }}
              sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 700, borderBottom: `2px solid ${mix(color, 70)}`, pb: 0.5 }}
            />
            {!editing && (
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                <Chip
                  label={t('Termin')}
                  color={!task ? 'primary' : 'default'}
                  variant={!task ? 'filled' : 'outlined'}
                  onClick={() => {
                    const target = writable.find((entry) => entry.components.includes('VEVENT'));
                    set({
                      component: 'VEVENT',
                      calendarId: calendar?.components.includes('VEVENT') ? form.calendarId : (target?.id ?? form.calendarId),
                      hasDue: true,
                    });
                  }}
                />
                <Chip
                  label={t('Aufgabe')}
                  color={task ? 'primary' : 'default'}
                  variant={task ? 'filled' : 'outlined'}
                  onClick={() => {
                    const target = writable.find((entry) => entry.components.includes('VTODO'));
                    set({
                      component: 'VTODO',
                      kind: 'event',
                      calendarId: calendar?.components.includes('VTODO') ? form.calendarId : (target?.id ?? form.calendarId),
                      alarms: [],
                      attendees: [],
                    });
                  }}
                />
              </Box>
            )}
          </Box>

          {!task && (
            <Field icon={<CategoryOutlined />}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={form.kind}
                onChange={(_event, kind: ItemKind | null) => {
                  if (!kind) return;
                  const patch: Partial<Form> = { kind };
                  if (kind === 'birthday')
                    Object.assign(patch, { allDay: true, rrule: form.rrule ?? 'FREQ=YEARLY', transparency: 'TRANSPARENT' });
                  if (kind === 'ooo') Object.assign(patch, { transparency: 'OPAQUE' });
                  if (kind === 'focus') Object.assign(patch, { transparency: 'OPAQUE', allDay: false });
                  set(patch);
                }}
                sx={{ flexWrap: 'wrap' }}
              >
                {kinds.map(([kind, label]) => (
                  <ToggleButton key={kind} value={kind} sx={{ px: 1.75 }}>
                    {label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Field>
          )}

          <Field icon={<ScheduleRounded />} top>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {task && (
                <FormControlLabel
                  control={<Switch checked={form.hasDue} onChange={(event) => set({ hasDue: event.target.checked })} />}
                  label={t('Fälligkeitsdatum')}
                />
              )}
              {(!task || form.hasDue) && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                  <TextField
                    type="date"
                    size="small"
                    value={form.startDate}
                    onChange={(event) => changeStartDate(event.target.value)}
                    slotProps={{ htmlInput: { 'aria-label': task ? t('Fällig am') : t('Beginn') } }}
                  />
                  {!form.allDay && (
                    <TimeSelect label={task ? t('Uhrzeit') : t('Beginnt um')} value={form.startTime} onChange={changeStartTime} />
                  )}
                  {!task && (
                    <>
                      <Typography sx={{ color: c.onSurfaceVariant }}>–</Typography>
                      {!form.allDay && (
                        <TimeSelect
                          label={t('Endet um')}
                          value={form.endTime}
                          from={form.endDate === form.startDate ? form.startTime : undefined}
                          onChange={(minutes) =>
                            set({
                              endTime: minutes,
                              endDate:
                                form.endDate === form.startDate && minutes <= form.startTime ? addDays(form.startDate, 1) : form.endDate,
                            })
                          }
                        />
                      )}
                      <TextField
                        type="date"
                        size="small"
                        value={form.endDate}
                        onChange={(event) => event.target.value && set({ endDate: event.target.value })}
                        slotProps={{ htmlInput: { 'aria-label': t('Ende'), min: form.startDate } }}
                      />
                    </>
                  )}
                </Box>
              )}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
                {(!task || form.hasDue) && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={form.allDay}
                        onChange={(event) => {
                          const allDay = event.target.checked;
                          const patch: Partial<Form> = { allDay };
                          if (!editing && !task && calendar) {
                            const defaults = allDay ? (calendar.alldayAlarms ?? prefs?.alldayAlarms) : (calendar.alarms ?? prefs?.alarms);
                            if (defaults && JSON.stringify(form.alarms) === JSON.stringify(initial.current.alarms))
                              patch.alarms = defaults.map((spec) => ({ minutes: spec.minutes, email: Boolean(spec.email) }));
                          }
                          set(patch);
                        }}
                      />
                    }
                    label={t('Ganztägig')}
                  />
                )}
                {!form.allDay && (!task || form.hasDue) && (
                  <Button
                    size="small"
                    startIcon={<PublicRounded />}
                    onClick={() => setZones((value) => !value)}
                    sx={{ color: c.onSurfaceVariant }}
                  >
                    {zones ? zoneLabel(form.zone) : t('Zeitzone')}
                  </Button>
                )}
                {!task && features?.freebusy !== false && onFindTime && (
                  <Button
                    size="small"
                    startIcon={<GroupsRounded />}
                    onClick={() =>
                      onFindTime(form, (start, end, people) => {
                        const zone = form.zone;
                        const toParts = (utc: number) => {
                          const value = new Intl.DateTimeFormat('en-CA', {
                            timeZone: zone,
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hourCycle: 'h23',
                          }).formatToParts(utc);
                          const get = (type: string) => value.find((part) => part.type === type)?.value ?? '00';
                          return {
                            date: `${get('year')}-${get('month')}-${get('day')}`,
                            time: Number(get('hour')) * 60 + Number(get('minute')),
                          };
                        };
                        const a = toParts(start);
                        const b = toParts(end);
                        setForm((current) => ({
                          ...current,
                          allDay: false,
                          startDate: a.date,
                          startTime: a.time,
                          endDate: b.date,
                          endTime: b.time,
                          attendees: [
                            ...current.attendees,
                            ...people
                              .filter((person) => !current.attendees.some((attendee) => attendee.email === person.email))
                              .map((person) => ({
                                email: person.email,
                                name: person.name,
                                role: 'REQ-PARTICIPANT' as const,
                                status: 'NEEDS-ACTION' as const,
                              })),
                          ],
                        }));
                      })
                    }
                    sx={{ color: c.onSurfaceVariant }}
                  >
                    {t('Zeit finden')}
                  </Button>
                )}
              </Box>
              <Collapse in={zones && !form.allDay} unmountOnExit>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('Zeitzone')}
                  value={form.zone}
                  onChange={(event) => set({ zone: event.target.value })}
                >
                  {zoneList.map((zone) => (
                    <MenuItem key={zone} value={zone}>
                      {zoneLabel(zone)}
                    </MenuItem>
                  ))}
                </TextField>
              </Collapse>
              {(!task || form.hasDue) && (
                <RecurrenceField value={form.rrule} startDate={form.startDate} allDay={form.allDay} onChange={(rrule) => set({ rrule })} />
              )}
              {conflicts.length > 0 && (
                <Alert severity="warning" icon={<WarningAmberRounded />} sx={{ py: 0 }}>
                  {conflicts.length === 1
                    ? t('Überschneidet sich mit „{title}“ ({time})', {
                        title: conflicts[0].busyOnly ? t('Beschäftigt') : conflicts[0].title || t('(Ohne Titel)'),
                        time: `${formatTime(conflicts[0].start)}–${formatTime(conflicts[0].end)}`,
                      })
                    : t('Überschneidet sich mit {count} Terminen', { count: conflicts.length })}
                </Alert>
              )}
            </Box>
          </Field>

          {form.kind === 'birthday' && !task && (
            <Field icon={<CakeRounded />}>
              <TextField
                size="small"
                type="number"
                label={t('Geburtsjahr (optional)')}
                value={form.birthYear ?? ''}
                onChange={(event) =>
                  set({ birthYear: event.target.value ? Math.max(1800, Math.min(2200, Number(event.target.value))) : null })
                }
                helperText={t('Dann zeigt der Kalender das Alter an.')}
                sx={{ maxWidth: 240 }}
              />
            </Field>
          )}

          <Field icon={<CalendarTodayRounded />}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
              <TextField
                select
                size="small"
                label={t('Kalender')}
                value={form.calendarId}
                onChange={(event) => set({ calendarId: event.target.value })}
                sx={{ minWidth: 220, flex: 1 }}
              >
                {writable.map((entry: CalendarInfo) => (
                  <MenuItem key={entry.id} value={entry.id} disabled={!entry.components.includes(form.component)}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '4px', bgcolor: entry.color }} />
                      {entry.name}
                      {entry.access !== 'owner' && (
                        <Typography component="span" variant="caption" sx={{ color: c.onSurfaceVariant }}>
                          {entry.owner.name}
                        </Typography>
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }} role="radiogroup" aria-label={t('Farbe')}>
                <Tooltip title={t('Kalenderfarbe')}>
                  <ButtonBase
                    role="radio"
                    aria-checked={form.color === null}
                    aria-label={t('Kalenderfarbe')}
                    onClick={() => set({ color: null })}
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: `conic-gradient(${calendar?.color ?? c.primary} 0 50%, ${c.surfaceContainerHighest} 50% 100%)`,
                      outline: form.color === null ? `2px solid ${c.onSurface}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                </Tooltip>
                {PALETTE.slice(0, 12).map((hex) => (
                  <Tooltip key={hex} title={colorName(hex)}>
                    <ButtonBase
                      role="radio"
                      aria-checked={form.color === hex}
                      aria-label={colorName(hex)}
                      onClick={() => set({ color: hex })}
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: hex,
                        outline: form.color === hex ? `2px solid ${c.onSurface}` : 'none',
                        outlineOffset: 2,
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          </Field>

          {!task && (
            <Field icon={<PlaceOutlined />}>
              <TextField
                size="small"
                fullWidth
                label={t('Ort')}
                value={form.location}
                onChange={(event) => set({ location: event.target.value })}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Field>
          )}

          {!task && (
            <Field icon={<VideocamOutlined />}>
              {form.conference ? (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={videoProvider(form.conference) ?? t('Videokonferenz')}
                    value={form.conference}
                    onChange={(event) => set({ conference: event.target.value })}
                  />
                  <Tooltip title={t('Link kopieren')}>
                    <IconButton aria-label={t('Link kopieren')} onClick={() => void copyText(form.conference)}>
                      <ContentCopyRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Entfernen')}>
                    <IconButton aria-label={t('Videokonferenz entfernen')} onClick={() => set({ conference: '' })}>
                      <CloseRounded />
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="tonal" startIcon={<VideocamOutlined />} onClick={() => set({ conference: jitsiLink() })}>
                    {t('Jitsi-Videokonferenz hinzufügen')}
                  </Button>
                  <Button
                    onClick={async () => {
                      const link = await prompt({
                        title: t('Link zur Videokonferenz'),
                        label: t('Link'),
                        value: '',
                        confirm: t('Hinzufügen'),
                        helper: t('Zoom, Teams, Google Meet, BigBlueButton …'),
                      });
                      if (link) set({ conference: link.trim() });
                    }}
                  >
                    {t('Eigenen Link einfügen')}
                  </Button>
                </Box>
              )}
            </Field>
          )}

          {!task && (
            <Field icon={<GroupOutlined />} top>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <PeopleInput
                  exclude={form.attendees.map((attendee) => attendee.email)}
                  allowEmail={features?.externalInvites !== false}
                  label={t('Gäste einladen')}
                  onPick={(person) =>
                    set({
                      attendees: [
                        ...form.attendees,
                        { email: person.email, name: person.name, role: 'REQ-PARTICIPANT', status: 'NEEDS-ACTION' },
                      ],
                    })
                  }
                />
                {form.attendees.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant, mb: 0.5 }}>
                      {t('{count} Gäste · {yes} Zusagen, {open} ausstehend', {
                        count: form.attendees.length,
                        yes: form.attendees.filter((attendee) => attendee.status === 'ACCEPTED').length,
                        open: form.attendees.filter((attendee) => attendee.status === 'NEEDS-ACTION').length,
                      })}
                    </Typography>
                    {form.attendees.map((attendee, index) => (
                      <Box key={attendee.email} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.5 }}>
                        <Box sx={{ position: 'relative' }}>
                          <UserAvatar initials={(attendee.name ?? attendee.email).slice(0, 1).toUpperCase()} size={32} />
                          <Box
                            sx={{ position: 'absolute', right: -3, bottom: -3, bgcolor: c.surface, borderRadius: '50%', display: 'flex' }}
                          >
                            {statusIcon(attendee.status)}
                          </Box>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                            {attendee.name ?? attendee.email}
                          </Typography>
                          <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                            {attendee.role === 'OPT-PARTICIPANT'
                              ? t('Optional')
                              : attendee.email.endsWith('.invalid')
                                ? t('Auf diesem Server')
                                : attendee.email}
                          </Typography>
                        </Box>
                        <Tooltip
                          title={attendee.role === 'OPT-PARTICIPANT' ? t('Als erforderlich markieren') : t('Als optional markieren')}
                        >
                          <Chip
                            size="small"
                            variant="outlined"
                            label={attendee.role === 'OPT-PARTICIPANT' ? t('Optional') : t('Erforderlich')}
                            onClick={() =>
                              set({
                                attendees: form.attendees.map((entry, position) =>
                                  position === index
                                    ? { ...entry, role: entry.role === 'OPT-PARTICIPANT' ? 'REQ-PARTICIPANT' : 'OPT-PARTICIPANT' }
                                    : entry
                                ),
                              })
                            }
                          />
                        </Tooltip>
                        <IconButton
                          size="small"
                          aria-label={t('{name} entfernen', { name: attendee.name ?? attendee.email })}
                          onClick={() => set({ attendees: form.attendees.filter((_, position) => position !== index) })}
                        >
                          <CloseRounded fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Field>
          )}

          {!(task && !form.hasDue) && (
            <Field icon={<NotificationsNoneRounded />} top>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                {form.alarms.map((alarm, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                      select
                      size="small"
                      value={alarm.minutes}
                      onChange={(event) => updateAlarm(index, { minutes: Number(event.target.value) })}
                      sx={{ minWidth: 220 }}
                      slotProps={{ htmlInput: { 'aria-label': t('Erinnerung') } }}
                    >
                      {alarmOptions(alarm.minutes).map((minutes) => (
                        <MenuItem key={minutes} value={minutes}>
                          {alarmText(minutes, form.allDay)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={alarm.email ? 'mail' : 'push'}
                      onChange={(_event, value) => value && updateAlarm(index, { email: value === 'mail' })}
                    >
                      <ToggleButton value="push">{t('Benachrichtigung')}</ToggleButton>
                      <ToggleButton value="mail">{t('E-Mail')}</ToggleButton>
                    </ToggleButtonGroup>
                    <IconButton
                      size="small"
                      aria-label={t('Erinnerung entfernen')}
                      onClick={() => set({ alarms: form.alarms.filter((_, position) => position !== index) })}
                    >
                      <CloseRounded fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
                {form.alarms.length < 5 && (
                  <Button size="small" startIcon={<AddRounded />} onClick={addAlarm}>
                    {t('Erinnerung hinzufügen')}
                  </Button>
                )}
              </Box>
            </Field>
          )}

          {task && (
            <Field icon={<FlagRounded />} top>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={form.priority === 0 ? 0 : form.priority <= 4 ? 1 : form.priority === 5 ? 5 : 9}
                  onChange={(_event, value: number | null) => value !== null && set({ priority: value })}
                >
                  <ToggleButton value={0}>{t('Keine Priorität')}</ToggleButton>
                  <ToggleButton value={9}>{t('Niedrig')}</ToggleButton>
                  <ToggleButton value={5}>{t('Mittel')}</ToggleButton>
                  <ToggleButton value={1}>{t('Hoch')}</ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, maxWidth: 420 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'nowrap', color: c.onSurfaceVariant }}>
                    {t('Fortschritt')}
                  </Typography>
                  <Slider
                    value={form.percent}
                    step={10}
                    marks
                    min={0}
                    max={100}
                    onChange={(_event, value) =>
                      set({ percent: value as number, completed: value === 100 ? true : form.completed && value === 100 })
                    }
                    aria-label={t('Fortschritt')}
                    valueLabelDisplay="auto"
                  />
                </Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.completed}
                      onChange={(event) =>
                        set({
                          completed: event.target.checked,
                          percent: event.target.checked ? 100 : form.percent === 100 ? 0 : form.percent,
                        })
                      }
                    />
                  }
                  label={t('Erledigt')}
                />
              </Box>
            </Field>
          )}

          {task && members.length > 1 && (
            <Field icon={<AssignmentIndOutlined />}>
              <TextField
                select
                fullWidth
                size="small"
                label={t('Zuständig')}
                value={form.assignee ?? ''}
                onChange={(event) => set({ assignee: event.target.value === '' ? null : Number(event.target.value) })}
                helperText={t('Bekommt eine Benachrichtigung, sobald du speicherst.')}
              >
                <MenuItem value="">{t('Niemand')}</MenuItem>
                {members.map((member) => (
                  <MenuItem key={member.id} value={member.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <UserAvatar initials={member.initials} avatar={member.avatar} userId={member.id} size={24} />
                      {member.id === boot().user?.id ? t('{name} (du)', { name: member.name }) : member.name}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            </Field>
          )}

          <Field icon={<NotesRounded />} top>
            <TextField
              multiline
              minRows={3}
              maxRows={14}
              fullWidth
              label={t('Beschreibung')}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 20_000 } }}
            />
          </Field>

          <Divider />
          <ButtonBase
            onClick={() => setMore((value) => !value)}
            aria-expanded={more}
            sx={{ alignSelf: 'flex-start', gap: 1, px: 1, py: 0.5, borderRadius: `${radius.sm}px`, color: c.onSurfaceVariant }}
          >
            <TuneRounded />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {more ? t('Weniger Optionen') : t('Weitere Optionen')}
            </Typography>
          </ButtonBase>
          <Collapse in={more} unmountOnExit>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
              {!task && (
                <Field icon={<TuneRounded />} top>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                    <TextField
                      select
                      size="small"
                      label={t('Anzeigen als')}
                      value={form.transparency}
                      onChange={(event) => set({ transparency: event.target.value as Form['transparency'] })}
                      sx={{ minWidth: 170 }}
                    >
                      <MenuItem value="OPAQUE">{t('Beschäftigt')}</MenuItem>
                      <MenuItem value="TRANSPARENT">{t('Frei')}</MenuItem>
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={t('Sichtbarkeit')}
                      value={form.privacy}
                      onChange={(event) => set({ privacy: event.target.value as Form['privacy'] })}
                      sx={{ minWidth: 170 }}
                    >
                      <MenuItem value="PUBLIC">{t('Standard')}</MenuItem>
                      <MenuItem value="PRIVATE">{t('Privat')}</MenuItem>
                      <MenuItem value="CONFIDENTIAL">{t('Vertraulich')}</MenuItem>
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={t('Status')}
                      value={form.status ?? 'CONFIRMED'}
                      onChange={(event) =>
                        set({ status: event.target.value === 'CONFIRMED' && !initial.current.status ? null : event.target.value })
                      }
                      sx={{ minWidth: 170 }}
                    >
                      <MenuItem value="CONFIRMED">{t('Bestätigt')}</MenuItem>
                      <MenuItem value="TENTATIVE">{t('Vorläufig')}</MenuItem>
                      <MenuItem value="CANCELLED">{t('Abgesagt')}</MenuItem>
                    </TextField>
                  </Box>
                </Field>
              )}
              <Field icon={<SellOutlined />} top>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('Schlagwörter')}
                    value={category}
                    placeholder={t('Eingeben und Enter drücken')}
                    onChange={(event) => setCategory(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        addCategory(category);
                      }
                    }}
                    onBlur={() => addCategory(category)}
                  />
                  {form.categories.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      {form.categories.map((name) => (
                        <Chip
                          key={name}
                          label={`#${name}`}
                          size="small"
                          onDelete={() => set({ categories: form.categories.filter((entry) => entry !== name) })}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              </Field>
              <Field icon={<LinkRounded />}>
                <TextField
                  size="small"
                  fullWidth
                  label={t('Webseite')}
                  value={form.url}
                  onChange={(event) => set({ url: event.target.value })}
                  placeholder="https://"
                />
              </Field>
            </Box>
          </Collapse>

          {detail && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant, pl: { sm: 5 } }}>
              {[
                detail.createdBy ? t('Erstellt von {name}', { name: detail.createdBy }) : null,
                detail.updatedBy && detail.updatedAt !== detail.createdAt
                  ? t('Zuletzt geändert von {name}', { name: detail.updatedBy })
                  : null,
                recurringSeries && form.rrule ? describe(form.rrule, form.startDate) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
