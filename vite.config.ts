import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';

const entry = (name: string) => fileURLToPath(new URL(`./web/src/entries/${name}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: '/assets/',
  publicDir: false,
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    assetsDir: '',
    emptyOutDir: true,
    manifest: true,
    target: ['chrome117', 'edge121', 'firefox121', 'safari17'],
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      input: {
        files: entry('files.tsx'),
        admin: entry('admin.tsx'),
        account: entry('account.tsx'),
        setup: entry('setup.tsx'),
        share: entry('share.tsx'),
        auth: entry('auth.ts'),
      },
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:5173',
  },
});
