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
import { splitExtension } from '../../lib/format';
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
