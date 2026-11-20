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

export const THEME_STYLES = ['content', 'tonal', 'vibrant', 'expressive', 'fidelity', 'neutral', 'mono'] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const THEME_FONTS = ['rounded', 'system', 'serif', 'mono', 'geist', 'legible', 'fraunces'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

export const THEME_CORNERS = [1, 0.5, 0.1] as const;
export type ThemeCorners = (typeof THEME_CORNERS)[number];

export interface ThemeColors {
  seed: string;
  style: ThemeStyle;
  secondary: string | null;
  tertiary: string | null;
}

export interface ThemeSpec extends ThemeColors {
  font: ThemeFont;
  corners: ThemeCorners;
}

export const DEFAULT_SPEC: ThemeSpec = { seed: BRAND_SEED, style: 'content', secondary: null, tertiary: null, font: 'rounded', corners: 1 };

export const sameColors = (a: ThemeColors, b: ThemeColors) =>
  a.seed.toLowerCase() === b.seed.toLowerCase() &&
  a.style === b.style &&
  (a.secondary ?? '').toLowerCase() === (b.secondary ?? '').toLowerCase() &&
  (a.tertiary ?? '').toLowerCase() === (b.tertiary ?? '').toLowerCase();

export const FONT_STACKS: Record<ThemeFont, string> = {
  rounded: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  geist: '"Geist Variable", Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  legible: '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", Verdana, system-ui, -apple-system, "Segoe UI", sans-serif',
  fraunces: '"Fraunces Variable", Fraunces, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
};

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
