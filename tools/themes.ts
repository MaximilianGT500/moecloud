import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/lib/themes.json');

const THEMES = [
  { id: 'moe', name: 'Moe', seed: '#8b5cf6', style: 'content', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  { id: 'ozean', name: 'Ozean', seed: '#0284c7', style: 'tonal', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  { id: 'wald', name: 'Wald', seed: '#2f855a', style: 'tonal', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  { id: 'minze', name: 'Minze', seed: '#10b981', style: 'vibrant', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  {
    id: 'sonnenuntergang',
    name: 'Sonnenuntergang',
    seed: '#f97316',
    style: 'vibrant',
    secondary: null,
    tertiary: '#db2777',
    font: 'rounded',
    corners: 1,
  },
  {
    id: 'kirschbluete',
    name: 'Kirschblüte',
    seed: '#ec4899',
    style: 'tonal',
    secondary: null,
    tertiary: null,
    font: 'rounded',
    corners: 1,
  },
  { id: 'koralle', name: 'Koralle', seed: '#f43f5e', style: 'content', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  {
    id: 'bernstein',
    name: 'Bernstein',
    seed: '#d97706',
    style: 'fidelity',
    secondary: null,
    tertiary: null,
    font: 'rounded',
    corners: 0.5,
  },
  { id: 'papagei', name: 'Papagei', seed: '#06b6d4', style: 'expressive', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  { id: 'graphit', name: 'Graphit', seed: '#64748b', style: 'neutral', secondary: null, tertiary: null, font: 'system', corners: 0.5 },
  { id: 'tinte', name: 'Tinte', seed: '#334155', style: 'mono', secondary: null, tertiary: null, font: 'serif', corners: 0.5 },
  { id: 'terminal', name: 'Terminal', seed: '#22c55e', style: 'fidelity', secondary: null, tertiary: null, font: 'mono', corners: 0.1 },
  {
    id: 'nordlicht',
    name: 'Nordlicht',
    seed: '#14b8a6',
    style: 'expressive',
    secondary: null,
    tertiary: '#8b5cf6',
    font: 'geist',
    corners: 1,
  },
  {
    id: 'mitternacht',
    name: 'Mitternacht',
    seed: '#4338ca',
    style: 'fidelity',
    secondary: null,
    tertiary: null,
    font: 'geist',
    corners: 0.5,
  },
  { id: 'lagune', name: 'Lagune', seed: '#0891b2', style: 'content', secondary: null, tertiary: '#f59e0b', font: 'geist', corners: 1 },
  { id: 'zitrone', name: 'Zitrone', seed: '#eab308', style: 'vibrant', secondary: null, tertiary: null, font: 'rounded', corners: 1 },
  { id: 'sand', name: 'Sand', seed: '#b08968', style: 'tonal', secondary: null, tertiary: null, font: 'fraunces', corners: 0.5 },
  { id: 'rosenholz', name: 'Rosenholz', seed: '#9f1239', style: 'tonal', secondary: null, tertiary: null, font: 'fraunces', corners: 0.5 },
  { id: 'espresso', name: 'Espresso', seed: '#7c4a2d', style: 'fidelity', secondary: null, tertiary: null, font: 'serif', corners: 0.5 },
  {
    id: 'klarblick',
    name: 'Klarblick',
    seed: '#1d4ed8',
    style: 'fidelity',
    secondary: null,
    tertiary: null,
    font: 'legible',
    corners: 0.5,
  },
] as const;

const server = await createServer({
  root: join(root, 'web'),
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
  ssr: { noExternal: ['@material/material-color-utilities'] },
});

try {
  const generator = (await server.ssrLoadModule('/src/theme/generate.ts')) as { buildPalette(input: unknown): unknown };
  const themes = THEMES.map((theme) => ({ ...theme, palette: generator.buildPalette(theme) }));
  const next = `${JSON.stringify(themes, null, 2)}\n`;
  const fallback = JSON.parse(await readFile(join(root, 'src/lib/default-palette.json'), 'utf8')) as unknown;
  if (JSON.stringify(themes[0].palette) !== JSON.stringify(fallback)) {
    console.error('Das Theme „Moe“ weicht von src/lib/default-palette.json ab');
    process.exitCode = 1;
  } else if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== next) {
      console.error('src/lib/themes.json ist veraltet. Erzeuge es neu mit: node tools/themes.ts');
      process.exitCode = 1;
    } else {
      console.log(`${themes.length} Themes geprüft, 0 Probleme`);
    }
  } else {
    await writeFile(target, next);
    console.log(`${themes.length} Themes nach src/lib/themes.json geschrieben`);
  }
} finally {
  await server.close();
}
