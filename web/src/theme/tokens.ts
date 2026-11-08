import type { M3Tokens } from './scheme';

export const c = new Proxy({} as Record<keyof M3Tokens, string>, {
  get: (_target, key: string) => `var(--mui-palette-m3-${key})`,
});

export const fileTypeColor = {
  image: 'var(--mui-palette-fileTypes-image)',
  video: 'var(--mui-palette-fileTypes-video)',
  audio: 'var(--mui-palette-fileTypes-audio)',
  text: 'var(--mui-palette-fileTypes-text)',
  other: 'var(--mui-palette-fileTypes-other)',
} as const;

export const folderColor = (key: string) => `var(--mui-palette-folders-${key})`;

export const fonts = {
  sans: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

export const radius = { xs: 4, sm: 8, tile: 12, md: 16, lg: 24, xl: 28, full: 999 };

export const elevation = {
  0: 'none',
  1: '0 1px 2px rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15)',
  2: '0 1px 2px rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15)',
  3: '0 1px 3px rgb(0 0 0 / 0.30), 0 4px 8px 3px rgb(0 0 0 / 0.15)',
  4: '0 2px 3px rgb(0 0 0 / 0.30), 0 6px 10px 4px rgb(0 0 0 / 0.15)',
  5: '0 4px 4px rgb(0 0 0 / 0.30), 0 8px 12px 6px rgb(0 0 0 / 0.15)',
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1] as const,
  enter: [0.05, 0.7, 0.1, 1] as const,
  exit: [0.3, 0, 0.8, 0.15] as const,
};

export const curve = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
};

export const duration = { shortest: 120, shorter: 180, short: 220, standard: 280, complex: 380, enter: 320, exit: 200 };

export const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const layer = (color: string, on: string, percent: number) => `color-mix(in srgb, ${on} ${percent}%, ${color})`;

export const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
