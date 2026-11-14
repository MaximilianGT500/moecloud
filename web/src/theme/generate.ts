import { Blend, Hct, SchemeContent, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import { BRAND_SEED, normalizeHex, ROLES, TRUE_BLACK, type M3Tokens, type Palette, type Role } from './scheme';

function group(hex: string, source: number, dark: boolean) {
  const palette = TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), source));
  const tone = (t: number) => hexFromArgb(palette.tone(t));
  return dark
    ? { color: tone(80), on: tone(20), container: tone(30), onContainer: tone(90) }
    : { color: tone(40), on: tone(100), container: tone(90), onContainer: tone(10) };
}

export function buildScheme(seed: string, dark: boolean, contrast = 0, trueBlack = false): M3Tokens {
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

export function buildPalette(seed: string): Palette {
  return { dark: buildScheme(seed, true), light: buildScheme(seed, false) };
}
