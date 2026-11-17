import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import type { ThemeBoot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import {
  FONT_STACKS,
  normalizeHex,
  SEED_PRESETS,
  THEME_STYLES,
  type Palette,
  type ThemeCorners,
  type ThemeFont,
  type ThemeSpec,
  type ThemeStyle,
} from '../../theme/scheme';
import { c, fonts, radius } from '../../theme/tokens';
import { useThemeControl } from '../mount';

export interface ThemeCard extends ThemeSpec {
  id: string;
  name: string;
  source: 'site' | 'builtin' | 'custom' | 'own';
  css: boolean;
  preview: { dark: Record<string, string>; light: Record<string, string> };
}

export interface ThemeList {
  themes: ThemeCard[];
  site: ThemeCard;
  personal: boolean;
  choice: string | null;
  own: ThemeSpec | null;
}

export interface ThemeResult extends ThemeList {
  theme: ThemeBoot;
  palette: Palette;
  css: string;
}

export interface ThemeDraft extends ThemeSpec {
  name: string;
  css: string;
}

export const specOf = (theme: ThemeSpec): ThemeSpec => ({
  seed: theme.seed,
  style: theme.style,
  secondary: theme.secondary ?? null,
  tertiary: theme.tertiary ?? null,
  font: theme.font,
  corners: theme.corners,
});

export async function paletteOf(spec: ThemeSpec): Promise<Palette> {
  const generator = await import('../../theme/generate');
  return generator.buildPalette(spec);
}

export function styleLabel(style: ThemeStyle) {
  switch (style) {
    case 'content':
      return { name: t('Satt'), hint: t('Nah an deiner Farbe, auch in den Flächen') };
    case 'tonal':
      return { name: t('Ruhig'), hint: t('Gedämpfte Flächen, die Farbe setzt Akzente') };
    case 'vibrant':
      return { name: t('Lebhaft'), hint: t('Kräftige Farben überall') };
    case 'expressive':
      return { name: t('Verspielt'), hint: t('Mischt weitere Farbtöne dazu') };
    case 'fidelity':
      return { name: t('Farbtreu'), hint: t('Die Farbe erscheint so, wie du sie wählst') };
    case 'neutral':
      return { name: t('Zurückhaltend'), hint: t('Fast grau, mit einem Hauch Farbe') };
    default:
      return { name: t('Schwarzweiß'), hint: t('Ganz ohne Farbe') };
  }
}

export interface ThemeTileMenu {
  onEdit?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

export interface ThemeTile {
  key: string;
  label: string;
  hint?: string;
  selected: boolean;
  spec: ThemeSpec;
  preview?: ThemeCard['preview'];
  icon?: ReactNode;
  onSelect: () => void;
  menu?: ThemeTileMenu;
}

function TileMenu({ label, menu }: { label: string; menu: ThemeTileMenu }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const run = (action?: () => void) => () => {
    setAnchor(null);
    action?.();
  };
  return (
    <>
      <Tooltip title={t('Aktionen für „{name}“', { name: label })}>
        <IconButton
          size="small"
          aria-label={t('Aktionen für „{name}“', { name: label })}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            bgcolor: c.surfaceContainerHighest,
            '&:hover': { bgcolor: c.surfaceContainerHighest },
          }}
        >
          <MoreVertRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {menu.onEdit && <MenuItem onClick={run(menu.onEdit)}>{t('Bearbeiten')}</MenuItem>}
        {menu.onExport && <MenuItem onClick={run(menu.onExport)}>{t('Als Datei speichern')}</MenuItem>}
        {menu.onDelete && <MenuItem onClick={run(menu.onDelete)}>{t('Löschen')}</MenuItem>}
      </Menu>
    </>
  );
}

function Tile({ tile, dark }: { tile: ThemeTile; dark: boolean }) {
  const colors = tile.preview?.[dark ? 'dark' : 'light'];
  const round = (value: number) => `${Math.max(2, Math.round(value * tile.spec.corners))}px`;
  return (
    <Box sx={{ position: 'relative' }}>
      <ButtonBase
        role="radio"
        aria-checked={tile.selected}
        aria-label={tile.label}
        onClick={tile.onSelect}
        sx={{
          width: '100%',
          flexDirection: 'column',
          alignItems: 'stretch',
          textAlign: 'left',
          overflow: 'hidden',
          borderRadius: `${radius.md}px`,
          bgcolor: tile.selected ? c.secondaryContainer : c.surfaceContainer,
          color: tile.selected ? c.onSecondaryContainer : c.onSurface,
          boxShadow: tile.selected ? `inset 0 0 0 2px ${c.primary}` : `inset 0 0 0 1px ${c.outlineVariant}`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            height: 86,
            m: '2px',
            mb: 0,
            p: 1.25,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            borderRadius: `${radius.md - 2}px ${radius.md - 2}px 0 0`,
            bgcolor: colors?.surface ?? c.surfaceContainerHigh,
          }}
        >
          {colors ? (
            <>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                <Box sx={{ width: 30, height: 8, borderRadius: round(8), bgcolor: colors.primary }} />
                <Box sx={{ width: 16, height: 8, borderRadius: round(8), bgcolor: colors.tertiary }} />
                <Box sx={{ ml: 'auto', width: 8, height: 8, borderRadius: '50%', bgcolor: colors.onSurfaceVariant }} />
              </Box>
              <Box
                sx={{
                  flex: 1,
                  p: 0.75,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  borderRadius: round(10),
                  bgcolor: colors.surfaceContainerHigh,
                }}
              >
                <Box sx={{ width: 38, height: 14, borderRadius: round(14), bgcolor: colors.secondaryContainer }} />
                <Box sx={{ width: 24, height: 24, borderRadius: round(9), bgcolor: colors.primaryContainer }} />
              </Box>
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: c.onSurfaceVariant }}>
              {tile.icon ?? <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: tile.spec.seed }} />}
            </Box>
          )}
        </Box>
        <Box sx={{ px: 1.25, py: 1, minHeight: 52, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontFamily: FONT_STACKS[tile.spec.font] }}>
              {tile.label}
            </Typography>
            {tile.hint && (
              <Typography variant="caption" noWrap sx={{ display: 'block', opacity: 0.8 }}>
                {tile.hint}
              </Typography>
            )}
          </Box>
          {tile.selected && <CheckRounded fontSize="small" sx={{ color: c.primary }} />}
        </Box>
      </ButtonBase>
      {tile.menu && <TileMenu label={tile.label} menu={tile.menu} />}
    </Box>
  );
}

export function ThemeGallery({ label, tiles }: { label: string; tiles: ThemeTile[] }) {
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) !== 'light';
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1.5 }}
    >
      {tiles.map((tile) => (
        <Tile key={tile.key} tile={tile} dark={dark} />
      ))}
    </Box>
  );
}

function ColorField({
  label,
  value,
  optional,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  optional?: boolean;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (normalizeHex(text) !== value) setText(value ?? '');
  }
  const valid = optional && text.trim() === '' ? true : Boolean(normalizeHex(text));
  return (
    <TextField
      label={label}
      value={text}
      disabled={disabled}
      error={!valid}
      placeholder={optional ? t('Aus der Grundfarbe') : '#8b5cf6'}
      helperText={valid ? undefined : t('Hex-Wert wie #8b5cf6')}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const hex = normalizeHex(next);
        if (hex) onChange(hex);
        else if (optional && next.trim() === '') onChange(null);
      }}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { maxLength: 7, spellCheck: false, style: { fontFamily: fonts.mono } },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Box
                component="input"
                type="color"
                aria-label={t('{label} auswählen', { label })}
                disabled={disabled}
                value={normalizeHex(text) ?? '#888888'}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setText(event.target.value);
                  onChange(event.target.value.toLowerCase());
                }}
                sx={{
                  width: 28,
                  height: 28,
                  p: 0,
                  border: 0,
                  borderRadius: '50%',
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  '&::-webkit-color-swatch-wrapper': { p: 0 },
                  '&::-webkit-color-swatch': { border: `1px solid ${c.outlineVariant}`, borderRadius: '50%' },
                  '&::-moz-color-swatch': { border: `1px solid ${c.outlineVariant}`, borderRadius: '50%' },
                }}
              />
            </InputAdornment>
          ),
          endAdornment:
            optional && text ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={t('{label} entfernen', { label })}
                  onClick={() => {
                    setText('');
                    onChange(null);
                  }}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
        },
      }}
    />
  );
}

export function ThemeEditorDialog({
  title,
  initial,
  admin,
  onClose,
  onSave,
}: {
  title: string;
  initial: ThemeDraft;
  admin?: boolean;
  onClose: () => void;
  onSave: (draft: ThemeDraft, palette: Palette) => Promise<boolean>;
}) {
  const control = useThemeControl();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const preview = useRef(control.preview);
  preview.current = control.preview;
  const set = (patch: Partial<ThemeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const spec = specOf(draft);
  const key = JSON.stringify([spec, admin ? draft.css : null]);
  useEffect(() => {
    preview.current(JSON.parse(key)[0] as ThemeSpec, admin ? (JSON.parse(key)[1] as string) : undefined);
  }, [key, admin]);
  const cancel = () => {
    control.preview(null);
    onClose();
  };
  const valid = Boolean(normalizeHex(draft.seed)) && (!admin || draft.name.trim().length > 0);
  const save = async () => {
    setBusy(true);
    const done = await onSave({ ...draft, name: draft.name.trim() }, await paletteOf(spec)).catch(() => false);
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : cancel} fullWidth maxWidth="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Die Vorschau siehst du sofort in der ganzen Oberfläche. Gespeichert wird erst mit dem Knopf unten.')}
          </Typography>
          {admin && (
            <TextField
              label={t('Name')}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              disabled={busy}
              autoFocus
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box role="radiogroup" aria-label={t('Grundfarbe')} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {SEED_PRESETS.map((preset) => {
                const selected = preset.value === draft.seed;
                return (
                  <Tooltip key={preset.value} title={t(preset.name)}>
                    <ButtonBase
                      role="radio"
                      aria-checked={selected}
                      aria-label={t(preset.name)}
                      disabled={busy}
                      onClick={() => set({ seed: preset.value })}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        bgcolor: preset.value,
                        color: '#fff',
                        boxShadow: selected ? `0 0 0 2px ${c.surfaceContainerHigh}, 0 0 0 4px ${c.primary}` : 'none',
                      }}
                    >
                      {selected && <CheckRounded fontSize="small" />}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>
            <ColorField
              label={t('Grundfarbe')}
              value={normalizeHex(draft.seed)}
              disabled={busy}
              onChange={(value) => value && set({ seed: value })}
            />
          </Box>
          <TextField
            select
            label={t('Stil')}
            value={draft.style}
            disabled={busy}
            onChange={(event) => set({ style: event.target.value as ThemeStyle })}
            slotProps={{ select: { renderValue: (value) => styleLabel(value as ThemeStyle).name } }}
          >
            {THEME_STYLES.map((style) => (
              <MenuItem key={style} value={style}>
                <ListItemText primary={styleLabel(style).name} secondary={styleLabel(style).hint} />
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <ColorField
              label={t('Zweite Farbe')}
              value={draft.secondary}
              optional
              disabled={busy}
              onChange={(value) => set({ secondary: value })}
            />
            <ColorField
              label={t('Dritte Farbe')}
              value={draft.tertiary}
              optional
              disabled={busy}
              onChange={(value) => set({ tertiary: value })}
            />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">{t('Schrift')}</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                fullWidth
                value={draft.font}
                disabled={busy}
                onChange={(_event, value: ThemeFont | null) => value && set({ font: value })}
                aria-label={t('Schrift')}
              >
                <ToggleButton value="rounded">{t('Rund')}</ToggleButton>
                <ToggleButton value="system">{t('System')}</ToggleButton>
                <ToggleButton value="serif">{t('Serifen')}</ToggleButton>
                <ToggleButton value="mono">{t('Mono')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">{t('Ecken')}</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                fullWidth
                value={draft.corners}
                disabled={busy}
                onChange={(_event, value: ThemeCorners | null) => value && set({ corners: value })}
                aria-label={t('Ecken')}
              >
                <ToggleButton value={1}>{t('Rund')}</ToggleButton>
                <ToggleButton value={0.5}>{t('Weich')}</ToggleButton>
                <ToggleButton value={0.1}>{t('Kantig')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>
          {admin && (
            <TextField
              label={t('Eigenes CSS (freiwillig)')}
              value={draft.css}
              onChange={(event) => set({ css: event.target.value })}
              disabled={busy}
              multiline
              minRows={3}
              maxRows={10}
              helperText={t('Für Feinheiten, die das Theme nicht abdeckt. Ohne @import und ohne Adressen im Internet.')}
              slotProps={{ htmlInput: { maxLength: 20000, spellCheck: false, style: { fontFamily: fonts.mono, fontSize: 13 } } }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancel} disabled={busy}>
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
