import { useEffect, useState, type ReactNode } from 'react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { toast } from './toast';

export type StatusState = 'available' | 'busy' | 'away' | 'dnd';

export interface Status {
  state: StatusState;
  emoji: string;
  text: string;
  until: number | null;
}

export const STATUS_COLORS: Record<StatusState, string> = {
  available: '#2e9d57',
  busy: '#d93a3a',
  away: '#e5a019',
  dnd: '#d93a3a',
};

export function statusLabel(state: StatusState) {
  return { available: t('Verfügbar'), busy: t('Beschäftigt'), away: t('Abwesend'), dnd: t('Nicht stören') }[state];
}

export function statusLine(status: Status | null | undefined) {
  if (!status) return '';
  const parts = [status.emoji, status.text || statusLabel(status.state)].filter(Boolean).join(' ');
  if (!status.until) return parts;
  return t('{status} bis {time}', {
    status: parts,
    time: new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(status.until)),
  });
}

export function StatusBadge({ status, children, size = 12 }: { status: Status | null | undefined; children: ReactNode; size?: number }) {
  if (!status) return <>{children}</>;
  return (
    <Badge
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      variant="dot"
      aria-label={statusLabel(status.state)}
      sx={{
        '& .MuiBadge-badge': {
          width: size,
          height: size,
          minWidth: size,
          borderRadius: '50%',
          bgcolor: STATUS_COLORS[status.state],
          boxShadow: `0 0 0 2px ${c.surface}`,
          '&::after':
            status.state === 'dnd'
              ? { content: '""', position: 'absolute', inset: '45% 22%', bgcolor: '#fff', borderRadius: 1 }
              : undefined,
        },
      }}
    >
      {children}
    </Badge>
  );
}

const UNTIL = [
  { value: 'never', label: () => t('Nicht automatisch') },
  { value: '30', label: () => t('30 Minuten') },
  { value: '60', label: () => t('1 Stunde') },
  { value: '240', label: () => t('4 Stunden') },
  { value: 'today', label: () => t('Heute') },
  { value: 'week', label: () => t('Diese Woche') },
];

function untilOf(choice: string) {
  const now = new Date();
  if (choice === 'never') return null;
  if (choice === 'today') {
    now.setHours(23, 59, 0, 0);
    return now.getTime();
  }
  if (choice === 'week') {
    const days = (7 - now.getDay()) % 7;
    now.setDate(now.getDate() + days);
    now.setHours(23, 59, 0, 0);
    return now.getTime();
  }
  return Date.now() + Number(choice) * 60_000;
}

const SUGGESTIONS: { emoji: string; text: () => string; state: StatusState; until: string }[] = [
  { emoji: '📅', text: () => t('In einem Termin'), state: 'busy', until: '60' },
  { emoji: '🎧', text: () => t('Konzentriert'), state: 'dnd', until: '240' },
  { emoji: '🍜', text: () => t('Mittagspause'), state: 'away', until: '60' },
  { emoji: '🏝️', text: () => t('Im Urlaub'), state: 'away', until: 'week' },
  { emoji: '🤒', text: () => t('Krank'), state: 'away', until: 'today' },
];

export function StatusDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (status: Status | null) => void;
}) {
  const [state, setState] = useState<StatusState>('available');
  const [emoji, setEmoji] = useState('');
  const [text, setText] = useState('');
  const [until, setUntil] = useState('never');
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    api
      .get<{ status: Status | null }>('/api/account/status')
      .then((result) => {
        setKept(result.status?.until ?? null);
        if (!result.status) return;
        setState(result.status.state);
        setEmoji(result.status.emoji);
        setText(result.status.text);
        setUntil(result.status.until ? 'keep' : 'never');
      })
      .catch(() => undefined);
  }, [open]);
  const save = async (clear: boolean) => {
    setBusy(true);
    try {
      const result = clear
        ? await api.delete<{ status: Status | null }>('/api/account/status')
        : await api.put<{ status: Status | null }>('/api/account/status', {
            state,
            emoji,
            text,
            until: until === 'keep' ? kept : untilOf(until),
          });
      onSaved?.(result.status);
      window.dispatchEvent(new CustomEvent('moe:status', { detail: result.status }));
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-status-dialog>
      <DialogTitle>{t('Status')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={state}
          onChange={(_event, value) => value && setState(value)}
          aria-label={t('Status')}
          sx={{ flexWrap: 'wrap' }}
        >
          {(['available', 'busy', 'away', 'dnd'] as StatusState[]).map((value) => (
            <ToggleButton key={value} value={value} sx={{ gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_COLORS[value] }} />
              {statusLabel(value)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {state === 'dnd' && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Solange „Nicht stören“ gilt, hält MoeCloud Push und E-Mails zurück und schickt sie danach gesammelt.')}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label={t('Emoji')}
            value={emoji}
            onChange={(event) => setEmoji([...event.target.value].slice(-2).join(''))}
            sx={{ width: 84 }}
          />
          <TextField
            label={t('Was machst du gerade?')}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 120))}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { 'data-status-text': '' } }}
          />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {SUGGESTIONS.map((entry) => (
            <Button
              key={entry.emoji}
              size="small"
              variant="outlined"
              onClick={() => {
                setEmoji(entry.emoji);
                setText(entry.text());
                setState(entry.state);
                setUntil(entry.until);
              }}
            >
              {entry.emoji} {entry.text()}
            </Button>
          ))}
        </Box>
        <TextField select label={t('Zurücksetzen nach')} value={until} onChange={(event) => setUntil(event.target.value)}>
          {until === 'keep' && kept && (
            <MenuItem value="keep">
              {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(kept))}
            </MenuItem>
          )}
          {UNTIL.map((entry) => (
            <MenuItem key={entry.value} value={entry.value}>
              {entry.label()}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={() => void save(true)} disabled={busy}>
          {t('Status löschen')}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="contained" onClick={() => void save(false)} disabled={busy} data-status-save>
            {t('Speichern')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
