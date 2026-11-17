import { z } from 'zod';
import builtinThemes from '../lib/themes.json' with { type: 'json' };
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { hexColor, palette as paletteSchema } from '../lib/validate.ts';
import * as settings from './settings.ts';
import type { CustomTheme, Palette, SiteTheme, ThemeSpec } from './settings.ts';
import { prefsOf, updatePrefs, type UserRow } from './users.ts';

export const THEME_STYLES = ['content', 'tonal', 'vibrant', 'expressive', 'fidelity', 'neutral', 'mono'] as const;
export const THEME_FONTS = ['rounded', 'system', 'serif', 'mono'] as const;
export const THEME_FORMAT = 1;
const MAX_CUSTOM = 50;
const MAX_CSS = 20_000;

export const FONT_STACKS: Record<ThemeSpec['font'], string> = {
  rounded: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

interface BuiltinTheme extends ThemeSpec {
  id: string;
  name: string;
  palette: Palette;
}

const BUILTIN = builtinThemes as BuiltinTheme[];

const PREVIEW_ROLES = [
  'surface',
  'surfaceContainer',
  'surfaceContainerHigh',
  'onSurface',
  'onSurfaceVariant',
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'tertiaryContainer',
  'outlineVariant',
] as const;

const color = hexColor.transform((value) => value.toLowerCase());
const optionalColor = z
  .union([hexColor, z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value.toLowerCase() : null));

export const specSchema = z.object({
  seed: color,
  style: z.enum(THEME_STYLES).default('content'),
  secondary: optionalColor,
  tertiary: optionalColor,
  font: z.enum(THEME_FONTS).default('rounded'),
  corners: z.union([z.literal(1), z.literal(0.5), z.literal(0.1)]).default(1),
});

export const themeSchema = specSchema.extend({
  name: z.string().trim().min(1, 'Gib dem Theme einen Namen').max(40, 'Der Name darf höchstens 40 Zeichen haben'),
  css: z.string().max(MAX_CSS, 'Das eigene CSS darf höchstens 20.000 Zeichen haben').default(''),
  palette: paletteSchema,
});

export const choiceSchema = z.union([
  z.object({ id: z.string().min(1).max(40) }),
  z.object({ own: specSchema, palette: paletteSchema }),
  z.object({ id: z.null() }),
]);

export type ThemeSource = 'site' | 'builtin' | 'custom' | 'own';

export interface EffectiveTheme {
  id: string;
  name: string;
  source: ThemeSource;
  spec: ThemeSpec;
  css: string;
  palette: Palette;
  personal: boolean;
}

function builtinName(lang: Lang, theme: BuiltinTheme) {
  switch (theme.id) {
    case 'ozean':
      return t(lang, 'Ozean');
    case 'wald':
      return t(lang, 'Wald');
    case 'minze':
      return t(lang, 'Minze');
    case 'sonnenuntergang':
      return t(lang, 'Sonnenuntergang');
    case 'kirschbluete':
      return t(lang, 'Kirschblüte');
    case 'koralle':
      return t(lang, 'Koralle');
    case 'bernstein':
      return t(lang, 'Bernstein');
    case 'papagei':
      return t(lang, 'Papagei');
    case 'graphit':
      return t(lang, 'Graphit');
    case 'tinte':
      return t(lang, 'Tinte');
    default:
      return theme.name;
  }
}

const specOf = (theme: ThemeSpec): ThemeSpec => ({
  seed: theme.seed,
  style: theme.style,
  secondary: theme.secondary ?? null,
  tertiary: theme.tertiary ?? null,
  font: theme.font,
  corners: theme.corners,
});

export function cleanCss(raw: string) {
  const css = raw.replace(/\r\n?/g, '\n').trim();
  if (!css) return '';
  if (/<\/|<!--|-->/.test(css)) throw badRequest('Im eigenen CSS darf kein HTML stehen');
  if (css.includes('\\')) throw badRequest('Im eigenen CSS sind keine Rückstriche erlaubt');
  if (/@import|@charset|@namespace/i.test(css)) throw badRequest('Im eigenen CSS ist @import nicht erlaubt');
  if (/expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(css))
    throw badRequest('Im eigenen CSS steht etwas, das Skripte ausführen könnte');
  for (const match of css.matchAll(/url\(\s*(['"]?)\s*([^'")]*)/gi)) {
    if (!/^data:(image|font)\//i.test(match[2] ?? '')) throw badRequest('Im eigenen CSS darf url() nur auf eingebettete Daten zeigen');
  }
  return css;
}

const customThemes = () => settings.get('theme.custom');

function legacySite(): EffectiveTheme {
  return {
    id: '',
    name: '',
    source: 'site',
    spec: { seed: settings.get('site.seed'), style: 'content', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
    css: '',
    palette: settings.get('site.palette'),
    personal: false,
  };
}

export function findTheme(id: string, lang: Lang = settings.get('site.language')): EffectiveTheme | null {
  const builtin = BUILTIN.find((theme) => theme.id === id);
  if (builtin) {
    return {
      id,
      name: builtinName(lang, builtin),
      source: 'builtin',
      spec: specOf(builtin),
      css: '',
      palette: builtin.palette,
      personal: false,
    };
  }
  const custom = customThemes().find((theme) => theme.id === id);
  if (custom)
    return { id, name: custom.name, source: 'custom', spec: specOf(custom), css: custom.css, palette: custom.palette, personal: false };
  return null;
}

export function siteTheme(lang: Lang = settings.get('site.language')): EffectiveTheme {
  const stored = settings.get('theme.site');
  if (!stored) return legacySite();
  if (stored.id) {
    const found = findTheme(stored.id, lang);
    if (found) return found;
  }
  return {
    id: '',
    name: stored.name,
    source: 'site',
    spec: specOf(stored),
    css: '',
    palette: settings.get('site.palette'),
    personal: false,
  };
}

export function effectiveTheme(
  user: Pick<UserRow, 'prefs'> | null | undefined,
  lang: Lang = settings.get('site.language')
): EffectiveTheme {
  const site = siteTheme(lang);
  if (!user || !settings.get('themes.personal')) return site;
  const choice = prefsOf(user).theme;
  if (!choice) return site;
  if ('id' in choice) {
    const found = findTheme(choice.id, lang);
    return found ? { ...found, personal: true } : site;
  }
  const own = specSchema.safeParse(choice.own);
  const palette = paletteSchema.safeParse(choice.palette);
  if (!own.success || !palette.success) return site;
  return { id: '', name: '', source: 'own', spec: own.data, css: '', palette: palette.data, personal: true };
}

export function themeBoot(theme: EffectiveTheme) {
  return { id: theme.id, name: theme.name, source: theme.source, personal: theme.personal, ...theme.spec };
}

export function themeCss(theme: EffectiveTheme) {
  return `:root{--moe-font:${FONT_STACKS[theme.spec.font] ?? FONT_STACKS.rounded};--moe-corners:${theme.spec.corners}}`;
}

function preview(palette: Palette) {
  const pick = (tokens: Record<string, string>) => Object.fromEntries(PREVIEW_ROLES.map((role) => [role, tokens[role] ?? '#000000']));
  return { dark: pick(palette.dark), light: pick(palette.light) };
}

function card(theme: EffectiveTheme) {
  return { id: theme.id, name: theme.name, source: theme.source, ...theme.spec, css: Boolean(theme.css), preview: preview(theme.palette) };
}

export function listThemes(user: Pick<UserRow, 'prefs'> | null, lang: Lang) {
  const site = siteTheme(lang);
  const choice = user ? prefsOf(user).theme : null;
  const own = choice && 'own' in choice ? specSchema.safeParse(choice.own) : null;
  return {
    themes: [
      ...BUILTIN.map((theme) => card(findTheme(theme.id, lang) as EffectiveTheme)),
      ...customThemes().map((theme) => card(findTheme(theme.id, lang) as EffectiveTheme)),
    ],
    site: card(site),
    personal: settings.get('themes.personal'),
    choice: choice && 'id' in choice && findTheme(choice.id) ? choice.id : null,
    own: own?.success ? own.data : null,
  };
}

export function adminThemes() {
  return customThemes().map((theme) => ({ id: theme.id, name: theme.name, ...specOf(theme), css: theme.css, updatedAt: theme.updatedAt }));
}

function syncSite(theme: EffectiveTheme, raw?: { name: string }) {
  const stored: SiteTheme = { id: theme.id, name: raw?.name ?? theme.name, css: '', ...theme.spec };
  settings.setMany({ 'theme.site': stored, 'site.seed': theme.spec.seed, 'site.palette': theme.palette });
}

export function setSiteTheme(input: z.infer<typeof choiceSchema>) {
  if ('own' in input) {
    syncSite({ id: '', name: '', source: 'site', spec: input.own, css: '', palette: input.palette, personal: false });
    return siteTheme();
  }
  if (!input.id) throw badRequest('Wähl ein Theme aus');
  const found = findTheme(input.id);
  if (!found) throw notFound('Dieses Theme gibt es nicht mehr');
  syncSite(found, found.source === 'builtin' ? { name: BUILTIN.find((theme) => theme.id === found.id)?.name ?? found.name } : undefined);
  return siteTheme();
}

export function refreshSiteTheme() {
  const stored = settings.get('theme.site');
  if (!stored?.id) return;
  const found = findTheme(stored.id);
  if (!found) return;
  if (JSON.stringify(found.palette) !== JSON.stringify(settings.get('site.palette')) || found.spec.seed !== settings.get('site.seed')) {
    settings.setMany({ 'site.seed': found.spec.seed, 'site.palette': found.palette });
  }
}

function slug(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'theme'}-${randomId(4).toLowerCase()}`;
}

export function createTheme(input: z.infer<typeof themeSchema>) {
  const list = customThemes();
  if (list.length >= MAX_CUSTOM) throw conflict('Es gibt schon sehr viele eigene Themes, lösch erst ein paar');
  if (list.some((theme) => theme.name.toLowerCase() === input.name.toLowerCase()))
    throw conflict('Ein Theme mit diesem Namen gibt es schon');
  const theme: CustomTheme = {
    id: slug(input.name),
    name: input.name,
    css: cleanCss(input.css),
    palette: input.palette,
    updatedAt: Date.now(),
    seed: input.seed,
    style: input.style,
    secondary: input.secondary,
    tertiary: input.tertiary,
    font: input.font,
    corners: input.corners,
  };
  settings.set('theme.custom', [...list, theme]);
  return theme;
}

export function updateTheme(id: string, input: z.infer<typeof themeSchema>) {
  const list = customThemes();
  const index = list.findIndex((theme) => theme.id === id);
  if (index < 0) throw notFound('Dieses Theme gibt es nicht mehr');
  if (list.some((theme, at) => at !== index && theme.name.toLowerCase() === input.name.toLowerCase())) {
    throw conflict('Ein Theme mit diesem Namen gibt es schon');
  }
  const theme: CustomTheme = {
    id,
    name: input.name,
    css: cleanCss(input.css),
    palette: input.palette,
    updatedAt: Date.now(),
    seed: input.seed,
    style: input.style,
    secondary: input.secondary,
    tertiary: input.tertiary,
    font: input.font,
    corners: input.corners,
  };
  settings.set(
    'theme.custom',
    list.map((entry, at) => (at === index ? theme : entry))
  );
  if (settings.get('theme.site')?.id === id) syncSite(findTheme(id) as EffectiveTheme);
  return theme;
}

export function deleteTheme(id: string) {
  const list = customThemes();
  if (!list.some((theme) => theme.id === id)) throw notFound('Dieses Theme gibt es nicht mehr');
  if (settings.get('theme.site')?.id === id) throw conflict('Dieses Theme ist gerade der Standard für alle. Wähl erst ein anderes');
  settings.set(
    'theme.custom',
    list.filter((theme) => theme.id !== id)
  );
}

export function exportTheme(id: string) {
  const custom = customThemes().find((theme) => theme.id === id);
  const builtin = BUILTIN.find((theme) => theme.id === id);
  const theme = custom ?? builtin;
  if (!theme) throw notFound('Dieses Theme gibt es nicht mehr');
  return { moecloudTheme: THEME_FORMAT, name: theme.name, ...specOf(theme), css: custom?.css ?? '' };
}

export function setUserTheme(user: UserRow, input: z.infer<typeof choiceSchema>) {
  if (!settings.get('themes.personal')) throw badRequest('Eigene Themes sind auf diesem Server ausgeschaltet');
  if ('own' in input) {
    updatePrefs(user.id, { theme: { own: input.own, palette: input.palette } });
    return;
  }
  if (input.id === null) {
    updatePrefs(user.id, { theme: null });
    return;
  }
  if (!findTheme(input.id)) throw notFound('Dieses Theme gibt es nicht mehr');
  updatePrefs(user.id, { theme: { id: input.id } });
}
