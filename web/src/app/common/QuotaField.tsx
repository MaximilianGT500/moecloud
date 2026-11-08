import { useState } from 'react';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { formatBytes } from '../../lib/format';
import { t } from '../../lib/i18n';

const GB = 1024 ** 3;
const PRESETS = [1, 5, 10, 50, 100, 500, 1024].map((size) => size * GB);

export function QuotaField({
  label,
  value,
  onChange,
  allowDefault = false,
  unlimitedLabel,
  helperText,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  allowDefault?: boolean;
  unlimitedLabel?: string;
  helperText?: string;
}) {
  const known = value === null || value === 0 || PRESETS.includes(value);
  const [custom, setCustom] = useState(!known);
  const mode = custom ? 'custom' : value === null ? 'default' : String(value);
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      <TextField
        select
        label={label}
        value={mode}
        helperText={helperText}
        sx={{ flex: 1, minWidth: 200 }}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'custom') {
            setCustom(true);
            onChange(value && value > 0 ? value : 20 * GB);
            return;
          }
          setCustom(false);
          onChange(next === 'default' ? null : Number(next));
        }}
      >
        {allowDefault && <MenuItem value="default">{t('Standard des Servers')}</MenuItem>}
        <MenuItem value="0">{unlimitedLabel ?? t('Unbegrenzt')}</MenuItem>
        {PRESETS.map((preset) => (
          <MenuItem key={preset} value={String(preset)}>
            {formatBytes(preset)}
          </MenuItem>
        ))}
        <MenuItem value="custom">{t('Eigener Wert')}</MenuItem>
      </TextField>
      {custom && (
        <TextField
          label={t('Größe')}
          type="number"
          value={value ? Math.round((value / GB) * 100) / 100 : ''}
          onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value) * GB)))}
          slotProps={{ input: { endAdornment: <InputAdornment position="end">GB</InputAdornment> }, htmlInput: { min: 0, step: 1 } }}
          sx={{ width: 160 }}
        />
      )}
    </Box>
  );
}
