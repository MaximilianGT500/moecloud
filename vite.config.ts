import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';

const entry = (name: string) => fileURLToPath(new URL(`./web/src/entries/${name}`, import.meta.url));

function precompress(): Plugin {
  return {
    name: 'moecloud-precompress',
    apply: 'build',
    async writeBundle(options) {
      const dir = options.dir!;
      for (const name of await readdir(dir)) {
        if (!/\.(js|css|svg|json)$/.test(name)) continue;
        const content = await readFile(join(dir, name));
        if (content.length < 1024) continue;
        const brotli = brotliCompressSync(content, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: content.length },
        });
        const gzip = gzipSync(content, { level: 9 });
        if (brotli.length < content.length) await writeFile(join(dir, `${name}.br`), brotli);
        if (gzip.length < content.length) await writeFile(join(dir, `${name}.gz`), gzip);
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: '/assets/',
  publicDir: false,
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), precompress()],
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
        codeSplitting: {
          groups: [
            {
              name: 'core',
              test: /node_modules[\\/](react|react-dom|scheduler|@emotion|stylis|@mui[\\/](system|utils|styled-engine|private-theming)|@popperjs|react-transition-group|clsx|prop-types|react-is|hoist-non-react-statics|@babel[\\/]runtime)[\\/]/,
              priority: 20,
            },
          ],
        },
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
