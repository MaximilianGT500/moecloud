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

export type Role = (typeof ROLES)[number];

export const TRUE_BLACK = {
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

export const EXTRA_ROLES = [
  'success',
  'onSuccess',
  'successContainer',
  'onSuccessContainer',
  'warning',
  'onWarning',
  'warningContainer',
  'onWarningContainer',
] as const;

export type M3Tokens = Record<Role | (typeof EXTRA_ROLES)[number], string>;

export interface Palette {
  dark: M3Tokens;
  light: M3Tokens;
}

export function isPalette(value: unknown): value is Palette {
  const palette = value as Partial<Palette> | null | undefined;
  return [palette?.dark, palette?.light].every(
    (tokens) => tokens && [...ROLES, ...EXTRA_ROLES].every((role) => typeof tokens[role] === 'string' && HEX.test(tokens[role]))
  );
}

export const FILE_TYPE_COLORS = {
  dark: { image: '#9085e9', video: '#199e70', audio: '#d95926', text: '#c9a227', other: '#8a8494' },
  light: { image: '#6250d6', video: '#1baf7a', audio: '#eb6834', text: '#a07d00', other: '#8f8a97' },
} as const;

export const FOLDER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'gray'] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

const FOLDER_TONES: Record<'dark' | 'light', Record<FolderColor, string>> = {
  dark: {
    red: '#ffaba3',
    orange: '#ffb06b',
    yellow: '#f2b824',
    green: '#77d675',
    teal: '#6ad2c2',
    blue: '#97c4ff',
    purple: '#f1a6ff',
    pink: '#ffa9b9',
    brown: '#deb9ac',
    gray: '#acc5d2',
  },
  light: {
    red: '#cd2727',
    orange: '#a15800',
    yellow: '#886500',
    green: '#187b27',
    teal: '#00786c',
    blue: '#006dbd',
    purple: '#a33bbe',
    pink: '#d0115b',
    brown: '#826459',
    gray: '#566e79',
  },
};

export const folderColors = (dark: boolean) => FOLDER_TONES[dark ? 'dark' : 'light'];
