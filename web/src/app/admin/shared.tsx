import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';

export type Settings = Record<string, string | number | boolean>;

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'error' | 'warning' }) {
  return (
    <Box
      sx={{
        bgcolor: tone === 'error' ? c.errorContainer : c.surfaceContainerLow,
        color: tone === 'error' ? c.onErrorContainer : c.onSurface,
        borderRadius: `${radius.lg}px`,
        p: 2.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      <Typography variant="body2" sx={{ color: tone === 'error' ? 'inherit' : c.onSurfaceVariant }}>
        {label}
      </Typography>
      <Typography variant="h4" component="p" sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: tone === 'error' ? 'inherit' : c.onSurfaceVariant }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function Loading() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
      <CircularProgress aria-label={t('Lädt')} />
    </Box>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <FormControlLabel
      disabled={disabled}
      control={<Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
          {hint && (
            <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
              {hint}
            </Typography>
          )}
        </Box>
      }
      sx={{ m: 0, gap: 1, alignItems: 'center' }}
    />
  );
}

export function SaveBar({ count, busy, onSave, onReset }: { count: number; busy: boolean; onSave: () => void; onReset: () => void }) {
  if (count === 0) return null;
  return (
    <Box sx={{ position: 'sticky', bottom: { xs: 88, md: 16 }, display: 'flex', justifyContent: 'flex-end', gap: 1, zIndex: 3 }}>
      <Button variant="tonal" onClick={onReset}>
        {t('Verwerfen')}
      </Button>
      <Button variant="contained" disabled={busy} onClick={onSave} sx={{ boxShadow: 3 }}>
        {tn(count, '{count} Änderung speichern', '{count} Änderungen speichern')}
      </Button>
    </Box>
  );
}

export function useDraft<T extends Settings>(load: () => Promise<T>, save: (changes: Partial<T>) => Promise<T>) {
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load()
      .then((value) => {
        setSaved(value);
        setDraft(value);
      })
      .catch((error) => toast(errorText(error)));
  }, []);

  const changed = draft && saved ? (Object.keys(draft) as (keyof T)[]).filter((key) => draft[key] !== saved[key]) : [];

  return {
    draft,
    saved,
    busy,
    changed,
    set: (key: keyof T, value: T[keyof T]) => setDraft((current) => (current ? { ...current, [key]: value } : current)),
    reset: () => setDraft(saved),
    replace: (value: T) => {
      setSaved(value);
      setDraft(value);
    },
    save: async () => {
      if (!draft) return;
      setBusy(true);
      try {
        const next = await save(Object.fromEntries(changed.map((key) => [key, draft[key]])) as Partial<T>);
        setSaved(next);
        setDraft(next);
        toast(t('Gespeichert'));
      } catch (error) {
        toast(errorText(error));
      } finally {
        setBusy(false);
      }
    },
  };
}

export const loadSettings = () => api.get<{ settings: Settings }>('/api/admin/settings').then((result) => result.settings);
export const saveSettings = (changes: Partial<Settings>) =>
  api.patch<{ settings: Settings }>('/api/admin/settings', changes).then((result) => result.settings);

export function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return tn(days, '{count} Tag', '{count} Tage') + (hours ? `, ${tn(hours, '{count} Stunde', '{count} Stunden')}` : '');
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? tn(hours, '{count} Stunde', '{count} Stunden') : tn(minutes, '{count} Minute', '{count} Minuten');
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', columnGap: 3, rowGap: 1, m: 0 }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'error' | 'off' }) {
  const color = tone === 'ok' ? c.success : tone === 'warn' ? c.warning : tone === 'error' ? c.error : c.outline;
  return <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flex: 'none' }} />;
}
