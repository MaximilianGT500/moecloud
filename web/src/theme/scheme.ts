import { Blend, Hct, SchemeContent, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export const BRAND_SEED = '#8b5cf6';

export const SEED_PRESETS = [
  { name: 'Violett', value: '#8b5cf6' },
  { name: 'Blau', value: '#3b82f6' },
  { name: 'Türkis', value: '#06b6d4' },
  { name: 'Grün', value: '#10b981' },
  { name: 'Gelb', value: '#eab308' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Rot', value: '#ef4444' },
  { name: 'Pink', value: '#ec4899' },
] as const;

export const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'surface',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'onSurface',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
  'scrim',
  'shadow',
] as const;

type Role = (typeof ROLES)[number];

const TRUE_BLACK = {
  surface: '#000000',
  surfaceDim: '#000000',
  surfaceContainerLowest: '#000000',
  surfaceContainerLow: '#0b0a0d',
  surfaceContainer: '#111015',
  surfaceContainerHigh: '#18161c',
  surfaceContainerHighest: '#201e24',
};

const HEX = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(value: string | null | undefined): string | null {
  const match = HEX.exec(String(value ?? '').trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

function group(hex: string, source: number, dark: boolean) {
  const palette = TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), source));
  const tone = (t: number) => hexFromArgb(palette.tone(t));
  return dark
    ? { color: tone(80), on: tone(20), container: tone(30), onContainer: tone(90) }
    : { color: tone(40), on: tone(100), container: tone(90), onContainer: tone(10) };
}

export function buildScheme(seed: string, dark: boolean, contrast = 0, trueBlack = false) {
  const source = argbFromHex(normalizeHex(seed) || BRAND_SEED);
  const scheme = new SchemeContent(Hct.fromInt(source), dark, contrast);
  const tokens = Object.fromEntries(ROLES.map((role) => [role, hexFromArgb(scheme[role])])) as Record<Role, string>;
  if (dark && trueBlack) Object.assign(tokens, TRUE_BLACK);
  const success = group('#2e9d58', source, dark);
  const warning = group('#c98a00', source, dark);
  return {
    ...tokens,
    success: success.color,
    onSuccess: success.on,
    successContainer: success.container,
    onSuccessContainer: success.onContainer,
    warning: warning.color,
    onWarning: warning.on,
    warningContainer: warning.container,
    onWarningContainer: warning.onContainer,
  };
}

export type M3Tokens = ReturnType<typeof buildScheme>;

export function buildPalette(seed: string) {
  return { dark: buildScheme(seed, true), light: buildScheme(seed, false) };
}

export const FILE_TYPE_COLORS = {
  dark: { image: '#9085e9', video: '#199e70', audio: '#d95926', text: '#c9a227', other: '#8a8494' },
  light: { image: '#6250d6', video: '#1baf7a', audio: '#eb6834', text: '#a07d00', other: '#8f8a97' },
} as const;

export const FOLDER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

const FOLDER_BASE: Record<FolderColor, string> = {
  red: '#e53935',
  orange: '#fb8c00',
  yellow: '#fbc02d',
  green: '#43a047',
  teal: '#00897b',
  blue: '#1e88e5',
  purple: '#8e24aa',
  pink: '#d81b60',
  brown: '#8d6e63',
  gray: '#78909c',
};

export function folderColors(dark: boolean) {
  return Object.fromEntries(
    FOLDER_COLORS.map((key) => [key, hexFromArgb(TonalPalette.fromInt(argbFromHex(FOLDER_BASE[key])).tone(dark ? 78 : 45))])
  ) as Record<FolderColor, string>;
}
