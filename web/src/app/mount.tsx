import { StrictMode, createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../theme/theme';
import { ease } from '../theme/tokens';
import { boot } from '../lib/boot';
import { usePrefs } from '../lib/prefs';
import { Toaster } from './common/toast';
import { DialogHost } from './common/dialogs';
import '../theme/fonts.css';

const SeedContext = createContext<(seed: string) => void>(() => {});
export const useSeed = () => useContext(SeedContext);

const nonce = (document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null)?.nonce || undefined;
const cache = createCache({ key: 'moe', nonce, prepend: true });

function Root({ children, seed: initial }: { children: ReactNode; seed: string }) {
  const [seed, setSeed] = useState(initial);
  const prefs = usePrefs();
  const theme = useMemo(
    () => createAppTheme({ seed, contrast: prefs.contrast, trueBlack: prefs.trueBlack, corners: prefs.corners }),
    [seed, prefs.contrast, prefs.trueBlack, prefs.corners]
  );
  return (
    <SeedContext.Provider value={setSeed}>
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme} defaultMode="dark" modeStorageKey="mui-mode" noSsr disableTransitionOnChange>
          <CssBaseline enableColorScheme />
          <LazyMotion features={domAnimation} strict>
            <MotionConfig reducedMotion="user" transition={{ duration: 0.35, ease: ease.enter }}>
              {children}
              <Toaster />
              <DialogHost />
            </MotionConfig>
          </LazyMotion>
        </ThemeProvider>
      </CacheProvider>
    </SeedContext.Provider>
  );
}

export function mount(app: ReactNode) {
  const container = document.getElementById('root');
  if (!container) return;
  createRoot(container).render(
    <StrictMode>
      <Root seed={boot().site.seed}>{app}</Root>
    </StrictMode>
  );
}
