import { StrictMode, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { LazyMotion, MotionConfig } from 'motion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { isPalette, TRUE_BLACK, type Palette } from '../theme/scheme';
import { createAppTheme } from '../theme/theme';
import { ease } from '../theme/tokens';
import { boot } from '../lib/boot';
import { currentPrefs, usePrefs } from '../lib/prefs';
import { Toaster } from './common/toast';
import { DialogHost } from './common/dialogs';
import { ErrorBoundary } from './common/ErrorBoundary';
import '../theme/fonts.css';

const features = import('./motion-features').then((module) => module.default);
const motionFeatures = () => features;

const SeedContext = createContext<(seed: string) => void>(() => {});
export const useSeed = () => useContext(SeedContext);

const nonce = (document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null)?.nonce || undefined;
const cache = createCache({ key: 'moe', nonce, prepend: true });

type Generator = typeof import('../theme/generate');

let generator: Generator | null = null;

async function loadGenerator() {
  generator ??= await import('../theme/generate');
  return generator;
}

function stored(trueBlack: boolean): Palette | null {
  const palette = boot().site.palette;
  if (!isPalette(palette)) return null;
  return { dark: trueBlack ? { ...palette.dark, ...TRUE_BLACK } : palette.dark, light: palette.light };
}

function paletteFor(seed: string, contrast: number, trueBlack: boolean): Palette | null {
  if (seed === boot().site.seed && contrast === 0) {
    const palette = stored(trueBlack);
    if (palette) return palette;
  }
  if (!generator) return null;
  return { dark: generator.buildScheme(seed, true, contrast, trueBlack), light: generator.buildScheme(seed, false, contrast) };
}

function Root({ children, seed: initial }: { children: ReactNode; seed: string }) {
  const [seed, setSeed] = useState(initial);
  const [loaded, setLoaded] = useState(0);
  const prefs = usePrefs();
  const palette = useMemo(() => paletteFor(seed, prefs.contrast, prefs.trueBlack), [seed, prefs.contrast, prefs.trueBlack, loaded]);
  const [shown, setShown] = useState(palette);
  if (palette && palette !== shown) setShown(palette);
  useEffect(() => {
    if (!palette) void loadGenerator().then(() => setLoaded((count) => count + 1));
  }, [palette]);
  const current = palette ?? shown ?? stored(prefs.trueBlack);
  const theme = useMemo(() => (current ? createAppTheme({ palette: current, corners: prefs.corners }) : null), [current, prefs.corners]);
  if (!theme) return null;
  return (
    <SeedContext.Provider value={setSeed}>
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
    </SeedContext.Provider>
  );
}

export async function mount(app: ReactNode) {
  const container = document.getElementById('root');
  if (!container) return;
  const prefs = currentPrefs();
  if (!paletteFor(boot().site.seed, prefs.contrast, prefs.trueBlack)) await loadGenerator().catch(() => undefined);
  createRoot(container).render(
    <StrictMode>
      <Root seed={boot().site.seed}>{app}</Root>
    </StrictMode>
  );
}
