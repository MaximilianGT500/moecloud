import { StrictMode, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { LazyMotion, MotionConfig } from 'motion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { DEFAULT_SPEC, FONT_STACKS, isPalette, sameColors, TRUE_BLACK, type Palette, type ThemeSpec } from '../theme/scheme';
import { createAppTheme } from '../theme/theme';
import { ease } from '../theme/tokens';
import { boot, type ThemeBoot } from '../lib/boot';
import { currentPrefs, usePrefs } from '../lib/prefs';
import { Toaster } from './common/toast';
import { DialogHost } from './common/dialogs';
import { ErrorBoundary } from './common/ErrorBoundary';
import '../theme/fonts.css';

const features = import('./motion-features').then((module) => module.default);
const motionFeatures = () => features;

export interface ThemeControl {
  spec: ThemeSpec;
  preview: (spec: ThemeSpec | null, css?: string | null) => void;
  adopt: (theme: ThemeBoot, palette: unknown, css?: string) => void;
}

function bootSpec(): ThemeSpec {
  const theme = boot().theme;
  return {
    seed: boot().site.seed,
    style: theme?.style ?? DEFAULT_SPEC.style,
    secondary: theme?.secondary ?? null,
    tertiary: theme?.tertiary ?? null,
    font: theme?.font ?? DEFAULT_SPEC.font,
    corners: theme?.corners ?? DEFAULT_SPEC.corners,
  };
}

const ThemeContext = createContext<ThemeControl>({ spec: DEFAULT_SPEC, preview: () => {}, adopt: () => {} });
export const useThemeControl = () => useContext(ThemeContext);
export const useSeed = () => {
  const control = useContext(ThemeContext);
  return (seed: string) => control.preview({ ...DEFAULT_SPEC, seed });
};

const nonce = (document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null)?.nonce || undefined;
const cache = createCache({ key: 'moe', nonce, prepend: true });

type Generator = typeof import('../theme/generate');

let generator: Generator | null = null;
let savedCss: string | null = null;

async function loadGenerator() {
  generator ??= await import('../theme/generate');
  return generator;
}

function styleElement() {
  let element = document.getElementById('moe-theme-css') as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = 'moe-theme-css';
    if (nonce) element.nonce = nonce;
    document.head.appendChild(element);
  }
  savedCss ??= element.textContent ?? '';
  return element;
}

function showCss(css: string | null | undefined) {
  const element = styleElement();
  const next = css ?? savedCss ?? '';
  if (element.textContent !== next) element.textContent = next;
}

function stored(trueBlack: boolean): Palette | null {
  const palette = boot().site.palette;
  if (!isPalette(palette)) return null;
  return { dark: trueBlack ? { ...palette.dark, ...TRUE_BLACK } : palette.dark, light: palette.light };
}

function paletteFor(spec: ThemeSpec, contrast: number, trueBlack: boolean): Palette | null {
  if (contrast === 0 && sameColors(spec, bootSpec())) {
    const palette = stored(trueBlack);
    if (palette) return palette;
  }
  if (!generator) return null;
  return { dark: generator.buildScheme(spec, true, contrast, trueBlack), light: generator.buildScheme(spec, false, contrast) };
}

function Root({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState(bootSpec);
  const [loaded, setLoaded] = useState(0);
  const prefs = usePrefs();
  const palette = useMemo(() => paletteFor(spec, prefs.contrast, prefs.trueBlack), [spec, prefs.contrast, prefs.trueBlack, loaded]);
  const [shown, setShown] = useState(palette);
  if (palette && palette !== shown) setShown(palette);
  useEffect(() => {
    if (!palette) void loadGenerator().then(() => setLoaded((count) => count + 1));
  }, [palette]);
  useEffect(() => {
    document.documentElement.style.setProperty('--moe-font', FONT_STACKS[spec.font] ?? FONT_STACKS.rounded);
    document.documentElement.style.setProperty('--moe-corners', String(prefs.shape ?? spec.corners));
  }, [spec.font, spec.corners, prefs.shape]);
  const control = useMemo<ThemeControl>(
    () => ({
      spec,
      preview: (next, css) => {
        setSpec(next ?? bootSpec());
        showCss(next ? css : null);
      },
      adopt: (theme, next, css) => {
        const data = boot();
        data.theme = theme;
        data.site.seed = theme.seed;
        if (isPalette(next)) data.site.palette = next;
        if (css !== undefined) {
          styleElement();
          savedCss = css;
        }
        showCss(null);
        setSpec(bootSpec());
        setLoaded((count) => count + 1);
      },
    }),
    [spec]
  );
  const current = palette ?? shown ?? stored(prefs.trueBlack);
  const corners = prefs.shape ?? spec.corners;
  const theme = useMemo(() => (current ? createAppTheme({ palette: current, corners }) : null), [current, corners]);
  if (!theme) return null;
  return (
    <ThemeContext.Provider value={control}>
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme} defaultMode="dark" modeStorageKey="mui-mode" noSsr disableTransitionOnChange>
          <CssBaseline enableColorScheme />
          <LazyMotion features={motionFeatures} strict>
            <MotionConfig reducedMotion="user" transition={{ duration: 0.35, ease: ease.enter }}>
              <ErrorBoundary>{children}</ErrorBoundary>
              <Toaster />
              <DialogHost />
            </MotionConfig>
          </LazyMotion>
        </ThemeProvider>
      </CacheProvider>
    </ThemeContext.Provider>
  );
}

export async function mount(app: ReactNode) {
  const container = document.getElementById('root');
  if (!container) return;
  const prefs = currentPrefs();
  if (!paletteFor(bootSpec(), prefs.contrast, prefs.trueBlack)) await loadGenerator().catch(() => undefined);
  createRoot(container).render(
    <StrictMode>
      <Root>{app}</Root>
    </StrictMode>
  );
}
