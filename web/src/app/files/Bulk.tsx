import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { api } from '../../lib/api';
import { formatDateTime, splitExtension } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { attempt, savedToast } from './actions';
import type { Item } from './kinds';

type Mode = 'replace' | 'add' | 'number' | 'date';

interface Planned {
  item: Item;
  name: string;
  problem: string | null;
}

const FORBIDDEN = /[/\\\u0000-\u001f\u007f]/;
const two = (value: number) => String(value).padStart(2, '0');
const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parts = (item: Item): [string, string] => (item.type === 'folder' ? [item.name, ''] : splitExtension(item.name));
const dateOf = (item: Item) => item.takenAt ?? item.modifiedAt;

function stamp(time: number, withTime: boolean) {
  const date = new Date(time);
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return withTime ? `${day} ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}` : day;
}

function problemOf(name: string) {
  if (!name || name === '.' || name === '..') return t('Ohne Namen geht es nicht');
  if (FORBIDDEN.test(name)) return t('Schrägstriche und Steuerzeichen gehen nicht');
  if (new TextEncoder().encode(name).length > 255) return t('Der Name wird zu lang');
  return null;
}

export function RenameManyDialog({
  items,
  siblings,
  suggestion,
  onClose,
  onDone,
}: {
  items: Item[];
  siblings: Item[];
  suggestion: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const [mode, setMode] = useState<Mode>('replace');
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [text, setText] = useState('');
  const [where, setWhere] = useState<'before' | 'after'>('after');
  const [base, setBase] = useState(suggestion);
  const [start, setStart] = useState('1');
  const [order, setOrder] = useState<'list' | 'taken'>('list');
  const [withTime, setWithTime] = useState(false);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);

  const first = Math.max(0, Math.min(999_999, Math.floor(Number(start) || 0)));
  const sequence = order === 'taken' ? [...items].sort((a, b) => dateOf(a) - dateOf(b) || a.name.localeCompare(b.name)) : items;
  const width = String(first + items.length - 1).length;
  const pattern = find ? new RegExp(escape(find), matchCase ? 'g' : 'gi') : null;
  const stamps = new Map<string, number>();

  const named = sequence.map((item, index) => {
    const [stem, extension] = parts(item);
    let next = item.name;
    if (mode === 'replace' && pattern) next = stem.replace(pattern, () => replacement) + extension;
    if (mode === 'add' && text) next = (where === 'before' ? text + stem : stem + text) + extension;
    if (mode === 'number') next = `${[base.trim(), String(first + index).padStart(width, '0')].filter(Boolean).join(' ')}${extension}`;
    if (mode === 'date') {
      const label = stamp(dateOf(item), withTime);
      const plain = keep ? `${label} ${stem}` : label;
      const seen = (stamps.get(`${item.parentId}/${nameKey(plain + extension)}`) ?? 0) + 1;
      stamps.set(`${item.parentId}/${nameKey(plain + extension)}`, seen);
      next = `${plain}${seen > 1 ? ` (${seen})` : ''}${extension}`;
    }
    return { item, name: next.normalize('NFC').trim() };
  });

  const batch = new Set(items.map((item) => item.id));
  const occupied = new Set(siblings.filter((item) => !batch.has(item.id)).map((item) => `${item.parentId}/${nameKey(item.name)}`));
  const planned: Planned[] = named.map(({ item, name }) => {
    const key = `${item.parentId}/${nameKey(name)}`;
    const problem = problemOf(name) ?? (occupied.has(key) ? t('Den Namen gibt es hier schon') : null);
    occupied.add(key);
    return { item, name, problem };
  });
  const changes = planned.filter((entry) => entry.name !== entry.item.name);
  const problems = planned.filter((entry) => entry.problem);

  const submit = async () => {
    setBusy(true);
    const result = await attempt(() =>
      api.post<{ items: Item[] }>('/api/nodes/rename', { items: changes.map((entry) => ({ id: entry.item.id, name: entry.name })) })
    );
    setBusy(false);
    if (!result) return;
    toast(tn(changes.length, '{count} Element umbenannt', '{count} Elemente umbenannt'));
    onDone();
    onClose();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={small}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changes.length && !problems.length) void submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <DialogTitle>{tn(items.length, '{count} Element umbenennen', '{count} Elemente umbenennen')}</DialogTitle>
        <Tabs
          value={mode}
          onChange={(_event, value: Mode) => setMode(value)}
          variant={small ? 'scrollable' : 'fullWidth'}
          aria-label={t('Art der Umbenennung')}
          sx={{ px: 2, minHeight: 44, '& .MuiTab-root': { minHeight: 44, textTransform: 'none' } }}
        >
          <Tab value="replace" label={t('Ersetzen')} />
          <Tab value="add" label={t('Ergänzen')} />
          <Tab value="number" label={t('Nummerieren')} />
          <Tab value="date" label={t('Datum')} />
        </Tabs>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          {mode === 'replace' && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <TextField
                  autoFocus
                  label={t('Suchen')}
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <TextField
                  label={t('Ersetzen durch')}
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  sx={{ flex: 1, minWidth: 180 }}
                />
              </Box>
              <FormControlLabel
                control={<Checkbox checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />}
                label={t('Groß- und Kleinschreibung beachten')}
              />
            </>
          )}
          {mode === 'add' && (
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField
                autoFocus
                label={t('Text')}
                value={text}
                onChange={(event) => setText(event.target.value)}
                sx={{ flex: 1, minWidth: 180 }}
              />
              <ToggleButtonGroup
                exclusive
                value={where}
                onChange={(_event, value: 'before' | 'after' | null) => value && setWhere(value)}
                aria-label={t('Stelle')}
              >
                <ToggleButton value="before">{t('Vor dem Namen')}</ToggleButton>
                <ToggleButton value="after">{t('Nach dem Namen')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
          {mode === 'number' && (
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                autoFocus
                label={t('Name')}
                value={base}
                onChange={(event) => setBase(event.target.value)}
                sx={{ flex: 2, minWidth: 180 }}
              />
              <TextField
                label={t('Beginnt bei')}
                value={start}
                onChange={(event) => setStart(event.target.value.replace(/\D/g, '').slice(0, 6))}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ flex: 1, minWidth: 100 }}
              />
              <TextField
                select
                label={t('Reihenfolge')}
                value={order}
                onChange={(event) => setOrder(event.target.value as 'list' | 'taken')}
                sx={{ flex: 2, minWidth: 180 }}
              >
                <MenuItem value="list">{t('Wie in der Liste')}</MenuItem>
                <MenuItem value="taken">{t('Nach Aufnahmedatum')}</MenuItem>
              </TextField>
            </Box>
          )}
          {mode === 'date' && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                  select
                  label={t('Format')}
                  value={withTime ? 'time' : 'day'}
                  onChange={(event) => setWithTime(event.target.value === 'time')}
                  sx={{ flex: 1, minWidth: 220 }}
                >
                  <MenuItem value="day">{stamp(Date.now(), false)}</MenuItem>
                  <MenuItem value="time">{stamp(Date.now(), true)}</MenuItem>
                </TextField>
                <FormControlLabel
                  control={<Checkbox checked={keep} onChange={(event) => setKeep(event.target.checked)} />}
                  label={t('Bisherigen Namen behalten')}
                />
              </Box>
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {t('MoeCloud nimmt das Aufnahmedatum und sonst das Datum der letzten Änderung.')}
              </Typography>
            </>
          )}
          <Box>
            <Typography variant="body2" sx={{ color: problems.length ? c.error : c.onSurfaceVariant, mb: 1 }}>
              {problems.length
                ? tn(problems.length, '{count} Name geht so nicht', '{count} Namen gehen so nicht')
                : changes.length
                  ? tn(changes.length, '{count} Element bekommt einen neuen Namen', '{count} Elemente bekommen einen neuen Namen')
                  : t('Endungen bleiben, wie sie sind.')}
            </Typography>
            <Box
              component="ul"
              aria-label={t('Vorschau')}
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                maxHeight: small ? 'none' : 280,
                overflowY: 'auto',
                borderRadius: `${radius.md}px`,
                bgcolor: c.surfaceContainerHigh,
              }}
            >
              {planned.map((entry) => {
                const same = entry.name === entry.item.name;
                return (
                  <Box
                    component="li"
                    key={entry.item.id}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) 20px minmax(0, 1fr)' },
                      alignItems: 'center',
                      columnGap: 1,
                      px: 1.5,
                      py: 0.75,
                      borderBottom: `1px solid ${c.outlineVariant}`,
                      '&:last-of-type': { borderBottom: 0 },
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      title={entry.item.name}
                      sx={{ color: c.onSurfaceVariant, fontSize: { xs: '0.75rem', sm: '0.875rem' } }}
                    >
                      {entry.item.name}
                    </Typography>
                    <ArrowForwardRounded
                      fontSize="small"
                      sx={{ color: c.onSurfaceVariant, display: { xs: 'none', sm: 'block' } }}
                      aria-hidden
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        title={entry.name}
                        sx={{ color: entry.problem ? c.error : same ? c.onSurfaceVariant : c.onSurface, fontWeight: same ? 400 : 600 }}
                      >
                        {entry.name || '–'}
                      </Typography>
                      {entry.problem && (
                        <Typography variant="caption" sx={{ color: c.error }}>
                          {entry.problem}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !changes.length || problems.length > 0}>
            {busy ? <CircularProgress size={20} aria-label={t('Speichert')} /> : t('Umbenennen')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function PackDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const single = items.length === 1 ? items[0] : null;
  const [name, setName] = useState(single ? (single.type === 'folder' ? single.name : splitExtension(single.name)[0]) : t('Archiv'));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await attempt(() =>
      api.post<{ node: Item }>('/api/nodes/zip', { ids: items.map((item) => item.id), name: `${name.trim().replace(/\.zip$/i, '')}.zip` })
    );
    setBusy(false);
    if (!result) return;
    savedToast(result.node);
    onDone();
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <DialogTitle>{t('Als ZIP packen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {single
              ? t('„{name}“ kommt in ein ZIP-Archiv in der Cloud.', { name: single.name })
              : tn(
                  items.length,
                  '{count} Element kommt in ein ZIP-Archiv in der Cloud.',
                  '{count} Elemente kommen in ein ZIP-Archiv in der Cloud.'
                )}
          </Typography>
          <TextField
            autoFocus
            label={t('Name des Archivs')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            slotProps={{
              htmlInput: { maxLength: 200 },
              input: { endAdornment: <InputAdornment position="end">.zip</InputAdornment> },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
            {busy ? <CircularProgress size={20} aria-label={t('Packt')} /> : t('Packen')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function reminderChoices() {
  const now = new Date();
  const at = (days: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour).getTime();
  const untilMonday = (8 - now.getDay()) % 7 || 7;
  const list = [{ key: 'hour', label: t('In einer Stunde'), time: now.getTime() + 3_600_000 }];
  if (now.getHours() < 17) list.push({ key: 'evening', label: t('Heute um 18 Uhr'), time: at(0, 18) });
  list.push({ key: 'tomorrow', label: t('Morgen um 8 Uhr'), time: at(1, 8) });
  list.push({ key: 'monday', label: t('Nächsten Montag um 8 Uhr'), time: at(untilMonday, 8) });
  return list;
}

const localValue = (time: number) => {
  const date = new Date(time);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
};

export function ReminderDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [choices] = useState(reminderChoices);
  const [choice, setChoice] = useState(item.reminder ? 'custom' : 'tomorrow');
  const [custom, setCustom] = useState(() => localValue(item.reminder?.dueAt ?? choices[choices.length - 2].time));
  const [note, setNote] = useState(item.reminder?.note ?? '');
  const [busy, setBusy] = useState(false);
  const time = choice === 'custom' ? new Date(custom).getTime() : (choices.find((entry) => entry.key === choice)?.time ?? NaN);
  const valid = Number.isFinite(time) && time > Date.now();
  const save = async () => {
    setBusy(true);
    const result = await attempt(() => api.put(`/api/nodes/${item.id}/reminder`, { dueAt: time, note: note.trim() || null }));
    setBusy(false);
    if (!result) return;
    toast(t('Erinnerung für {when} gemerkt', { when: formatDateTime(time) }));
    onDone();
    onClose();
  };
  const remove = async () => {
    setBusy(true);
    const result = await attempt(() => api.delete(`/api/nodes/${item.id}/reminder`));
    setBusy(false);
    if (result === undefined) return;
    toast(t('Erinnerung gelöscht'));
    onDone();
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save();
        }}
      >
        <DialogTitle>{t('An „{name}“ erinnern', { name: item.name })}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Zur gewählten Zeit bekommst du eine Benachrichtigung. Die Erinnerung siehst nur du.')}
          </Typography>
          <TextField select label={t('Wann')} value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
            {choices.map((entry) => (
              <MenuItem key={entry.key} value={entry.key}>
                {entry.label}
              </MenuItem>
            ))}
            <MenuItem value="custom">{t('Eigener Zeitpunkt')}</MenuItem>
          </TextField>
          {choice === 'custom' && (
            <TextField
              label={t('Datum und Uhrzeit')}
              type="datetime-local"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              disabled={busy}
              error={!valid}
              helperText={valid ? undefined : t('Der Zeitpunkt muss in der Zukunft liegen')}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localValue(Date.now()) } }}
            />
          )}
          <TextField
            label={t('Notiz (freiwillig)')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
            multiline
            maxRows={4}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions>
          {item.reminder && (
            <Button color="error" onClick={() => void remove()} disabled={busy} sx={{ mr: 'auto' }}>
              {t('Erinnerung löschen')}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !valid}>
            {t('Erinnern')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function expiryChoices() {
  const now = new Date();
  const at = (days: number, months = 0) => new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + days, 23, 59).getTime();
  return [
    { key: 'day', label: t('Morgen'), time: at(1) },
    { key: 'week', label: t('In einer Woche'), time: at(7) },
    { key: 'month', label: t('In einem Monat'), time: at(0, 1) },
    { key: 'quarter', label: t('In drei Monaten'), time: at(0, 3) },
    { key: 'year', label: t('In einem Jahr'), time: at(0, 12) },
  ];
}

export function ExpiryDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [choices] = useState(expiryChoices);
  const [choice, setChoice] = useState(item.expiresAt ? 'custom' : 'week');
  const [custom, setCustom] = useState(() => localValue(item.expiresAt ?? choices[1].time));
  const [busy, setBusy] = useState(false);
  const time = choice === 'custom' ? new Date(custom).getTime() : (choices.find((entry) => entry.key === choice)?.time ?? NaN);
  const valid = Number.isFinite(time) && time > Date.now() + 60_000;
  const send = async (at: number | null) => {
    setBusy(true);
    const result = await attempt(() => api.put(`/api/nodes/${item.id}/expiry`, { at }));
    setBusy(false);
    if (!result) return;
    toast(at ? t('„{name}“ landet am {when} im Papierkorb', { name: item.name, when: formatDateTime(at) }) : t('Ablaufdatum entfernt'));
    onDone();
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void send(time);
        }}
      >
        <DialogTitle>{t('Ablaufdatum für „{name}“', { name: item.name })}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {item.type === 'folder'
              ? t('Danach verschiebt MoeCloud den Ordner mit allem darin in den Papierkorb. Von dort lässt er sich noch wiederherstellen.')
              : t('Danach verschiebt MoeCloud die Datei in den Papierkorb. Von dort lässt sie sich noch wiederherstellen.')}
          </Typography>
          <TextField select label={t('Läuft ab')} value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
            {choices.map((entry) => (
              <MenuItem key={entry.key} value={entry.key}>
                {entry.label}
              </MenuItem>
            ))}
            <MenuItem value="custom">{t('Eigener Zeitpunkt')}</MenuItem>
          </TextField>
          {choice === 'custom' && (
            <TextField
              label={t('Datum und Uhrzeit')}
              type="datetime-local"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              disabled={busy}
              error={!valid}
              helperText={valid ? undefined : t('Der Zeitpunkt muss in der Zukunft liegen')}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localValue(Date.now()) } }}
            />
          )}
        </DialogContent>
        <DialogActions>
          {item.expiresAt && (
            <Button color="error" onClick={() => void send(null)} disabled={busy} sx={{ mr: 'auto' }}>
              {t('Ablaufdatum entfernen')}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !valid}>
            {t('Speichern')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const LOCK_CHOICES = [60, 480, 1440, 10080, 0];

export function LockDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [minutes, setMinutes] = useState(480);
  const [busy, setBusy] = useState(false);
  const label = (value: number) => {
    if (value === 0) return t('Bis ich sie entsperre');
    if (value < 1440) return tn(value / 60, 'Für eine Stunde', 'Für {count} Stunden');
    if (value === 10080) return t('Für eine Woche');
    return tn(value / 1440, 'Für einen Tag', 'Für {count} Tage');
  };
  const save = async () => {
    setBusy(true);
    const result = await attempt(() => api.post(`/api/nodes/${item.id}/lock`, { minutes: minutes || null }));
    setBusy(false);
    if (!result) return;
    toast(t('„{name}“ ist jetzt gesperrt', { name: item.name }));
    onDone();
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('„{name}“ sperren', { name: item.name })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t(
            'Solange die Sperre gilt, können andere die Datei ansehen und herunterladen, aber nicht ändern, umbenennen, verschieben oder löschen.'
          )}
        </Typography>
        <TextField select label={t('Dauer')} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={busy}>
          {LOCK_CHOICES.map((value) => (
            <MenuItem key={value} value={value}>
              {label(value)}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy}>
          {busy ? <CircularProgress size={20} aria-label={t('Speichert')} /> : t('Sperren')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const CLEANUP_DAYS = [7, 14, 30, 90, 365];

export function CleanupDialog({
  item,
  trashDays,
  onClose,
  onDone,
}: {
  item: Item;
  trashDays: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [days, setDays] = useState<number | null>(item.cleanup ?? 30);
  const [busy, setBusy] = useState(false);
  const options = CLEANUP_DAYS.includes(item.cleanup ?? 30) ? CLEANUP_DAYS : [...CLEANUP_DAYS, item.cleanup!].sort((a, b) => a - b);
  const label = (value: number) => (value === 365 ? t('Nach einem Jahr') : tn(value, 'Nach einem Tag', 'Nach {count} Tagen'));
  const save = async (value: number | null) => {
    setBusy(true);
    const result = await attempt(() => api.put<{ cleanup: number | null }>(`/api/nodes/${item.id}/cleanup`, { days: value }));
    setBusy(false);
    if (!result) return;
    toast(result.cleanup ? t('„{name}“ räumt jetzt automatisch auf', { name: item.name }) : t('Aufräumregel ausgeschaltet'));
    onDone();
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('Aufräumregel für „{name}“', { name: item.name })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {trashDays > 0
            ? tn(
                trashDays,
                'Dateien, die hier länger unverändert liegen, wandern von selbst in den Papierkorb. Dort bleiben sie noch einen Tag.',
                'Dateien, die hier länger unverändert liegen, wandern von selbst in den Papierkorb. Dort bleiben sie noch {count} Tage.'
              )
            : t('Dateien, die hier länger unverändert liegen, wandern von selbst in den Papierkorb.')}
        </Typography>
        <TextField
          select
          label={t('Aufräumen')}
          value={days ?? 0}
          onChange={(event) => setDays(Number(event.target.value) || null)}
          disabled={busy}
        >
          {options.map((value) => (
            <MenuItem key={value} value={value}>
              {label(value)}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('Das gilt auch für Unterordner und für alles, was andere hier ablegen.')}
        </Typography>
      </DialogContent>
      <DialogActions>
        {item.cleanup ? (
          <Button color="error" onClick={() => void save(null)} disabled={busy} sx={{ mr: 'auto' }}>
            {t('Ausschalten')}
          </Button>
        ) : null}
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
        <Button variant="contained" onClick={() => void save(days)} disabled={busy || !days}>
          {busy ? <CircularProgress size={20} aria-label={t('Speichert')} /> : t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
