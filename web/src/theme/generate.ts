import {
  Blend,
  DynamicScheme,
  Hct,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  Variant,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';
import {
  BRAND_SEED,
  normalizeHex,
  ROLES,
  TRUE_BLACK,
  type M3Tokens,
  type Palette,
  type Role,
  type ThemeColors,
  type ThemeStyle,
} from './scheme';

const SCHEMES = {
  content: SchemeContent,
  tonal: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  neutral: SchemeNeutral,
  mono: SchemeMonochrome,
} as const;

const VARIANTS: Record<ThemeStyle, Variant> = {
  content: Variant.CONTENT,
  tonal: Variant.TONAL_SPOT,
  vibrant: Variant.VIBRANT,
  expressive: Variant.EXPRESSIVE,
  fidelity: Variant.FIDELITY,
  neutral: Variant.NEUTRAL,
  mono: Variant.MONOCHROME,
};

export type SchemeSource = string | ThemeColors;

function group(hex: string, source: number, dark: boolean) {
  const palette = TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), source));
  const tone = (t: number) => hexFromArgb(palette.tone(t));
  return dark
    ? { color: tone(80), on: tone(20), container: tone(30), onContainer: tone(90) }
    : { color: tone(40), on: tone(100), container: tone(90), onContainer: tone(10) };
}

function colorsOf(input: SchemeSource): ThemeColors {
  if (typeof input === 'string') return { seed: input, style: 'content', secondary: null, tertiary: null };
  return input;
}

function dynamic(colors: ThemeColors, source: number, dark: boolean, contrast: number): DynamicScheme {
  const style = colors.style in SCHEMES ? colors.style : 'content';
  const secondary = normalizeHex(colors.secondary);
  const tertiary = normalizeHex(colors.tertiary);
  const hct = Hct.fromInt(source);
  if (!secondary && !tertiary) return new SCHEMES[style](hct, dark, contrast);
  return new DynamicScheme({
    sourceColorHct: hct,
    variant: VARIANTS[style],
    contrastLevel: contrast,
    isDark: dark,
    ...(secondary ? { secondaryPalette: TonalPalette.fromInt(argbFromHex(secondary)) } : {}),
    ...(tertiary ? { tertiaryPalette: TonalPalette.fromInt(argbFromHex(tertiary)) } : {}),
  });
}

export function buildScheme(input: SchemeSource, dark: boolean, contrast = 0, trueBlack = false): M3Tokens {
  const colors = colorsOf(input);
  const source = argbFromHex(normalizeHex(colors.seed) || BRAND_SEED);
  const scheme = dynamic(colors, source, dark, contrast);
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

export function buildPalette(input: SchemeSource): Palette {
  return { dark: buildScheme(input, true), light: buildScheme(input, false) };
}
