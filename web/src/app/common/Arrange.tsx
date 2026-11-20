import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import SmartphoneRounded from '@mui/icons-material/SmartphoneRounded';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';

export interface ArrangeEntry {
  key: string;
  label: string;
  icon?: ReactNode;
  locked?: boolean;
  bar?: boolean;
}

export interface Arrangement {
  order: string[];
  hidden: string[];
  bar?: string[];
}

export const BAR_SLOTS = 4;

export function arrange<T extends { key: string }>(
  items: T[],
  value: Pick<Arrangement, 'order' | 'hidden'> | null | undefined,
  locked: string[] = []
) {
  if (!value) return items;
  const rank = new Map(value.order.map((key, index) => [key, index]));
  const hidden = new Set(value.hidden.filter((key) => !locked.includes(key)));
  return items
    .map((item, index) => ({ item, position: rank.get(item.key) ?? value.order.length + index }))
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.item)
    .filter((item) => !hidden.has(item.key));
}

export function ArrangeDialog({
  title,
  text,
  entries,
  value,
  defaultBar,
  onClose,
  onSave,
}: {
  title: string;
  text: string;
  entries: ArrangeEntry[];
  value: Arrangement | null;
  defaultBar?: string[];
  onClose: () => void;
  onSave: (value: Arrangement | null) => Promise<void>;
}) {
  const known = new Set(entries.map((entry) => entry.key));
  const [order, setOrder] = useState(() => arrange(entries, value ? { order: value.order, hidden: [] } : null).map((entry) => entry.key));
  const [hidden, setHidden] = useState(() => new Set((value?.hidden ?? []).filter((key) => known.has(key))));
  const [bar, setBar] = useState(() => (value?.bar?.length ? value.bar : (defaultBar ?? [])).filter((key) => known.has(key)));
  const [busy, setBusy] = useState(false);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const withBar = Boolean(defaultBar);

  const move = (index: number, step: number) => {
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const save = async (next: Arrangement | null) => {
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {text}
        </Typography>
        <Box component="ul" aria-label={title} sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {order.map((key, index) => {
            const entry = byKey.get(key);
            if (!entry) return null;
            const shown = !hidden.has(key);
            const inBar = bar.includes(key);
            return (
              <Box
                component="li"
                key={key}
                data-arrange={key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pl: 1.5,
                  pr: 0.5,
                  minHeight: 48,
                  borderRadius: `${radius.tile}px`,
                  bgcolor: c.surfaceContainer,
                  opacity: shown ? 1 : 0.6,
                }}
              >
                {entry.icon && <Box sx={{ display: 'grid', placeItems: 'center', color: c.onSurfaceVariant, mr: 0.5 }}>{entry.icon}</Box>}
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
                  {entry.label}
                </Typography>
                {withBar && entry.bar !== false && (
                  <Tooltip title={inBar ? t('Steht auf dem Handy in der unteren Leiste') : t('Auf dem Handy in die untere Leiste')}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t('„{name}“ auf dem Handy in der unteren Leiste', { name: entry.label })}
                        aria-pressed={inBar}
                        disabled={!shown || (!inBar && bar.length >= BAR_SLOTS)}
                        onClick={() => setBar(inBar ? bar.filter((item) => item !== key) : [...bar, key])}
                        sx={{ color: inBar ? c.primary : c.onSurfaceVariant }}
                      >
                        <SmartphoneRounded fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
                <IconButton
                  size="small"
                  aria-label={t('„{name}“ nach oben', { name: entry.label })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpwardRounded fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={t('„{name}“ nach unten', { name: entry.label })}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownwardRounded fontSize="small" />
                </IconButton>
                <Switch
                  checked={shown}
                  disabled={entry.locked}
                  onChange={(event) => {
                    const next = new Set(hidden);
                    if (event.target.checked) next.delete(key);
                    else next.add(key);
                    setHidden(next);
                    if (!event.target.checked) setBar(bar.filter((item) => item !== key));
                  }}
                  slotProps={{ input: { 'aria-label': t('„{name}“ anzeigen', { name: entry.label }) } }}
                />
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy || !value} onClick={() => void save(null)} sx={{ mr: 'auto' }}>
          {t('Zurücksetzen')}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          {t('Abbrechen')}
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void save({ order, hidden: [...hidden], ...(withBar ? { bar: order.filter((key) => bar.includes(key)) } : {}) })}
        >
          {t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
