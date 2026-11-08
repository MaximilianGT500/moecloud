import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { escapeHtml } from './http.ts';

interface Chunk {
  file: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
}

export type Entry = 'files' | 'admin' | 'account' | 'setup' | 'share' | 'auth';

const SOURCES: Record<Entry, string> = {
  files: 'src/entries/files.tsx',
  admin: 'src/entries/admin.tsx',
  account: 'src/entries/account.tsx',
  setup: 'src/entries/setup.tsx',
  share: 'src/entries/share.tsx',
  auth: 'src/entries/auth.ts',
};

const MANIFEST = join(config.web, '.vite', 'manifest.json');
const PRELOAD_FONTS = /m-plus-rounded-1c-latin-(400|700)-normal-[^/]+\.woff2$/;

let manifest: Record<string, Chunk> | null = null;
let stamp = 0;

function load() {
  try {
    const { mtimeMs } = statSync(MANIFEST);
    if (!manifest || mtimeMs !== stamp) {
      manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Chunk>;
      stamp = mtimeMs;
    }
  } catch {
    manifest = null;
  }
  return manifest;
}

export const hasBuild = () => Boolean(config.devServer || load());

function devTags(entry: Entry, nonce: string) {
  const origin = `${config.devServer.replace(/\/+$/, '')}/assets/`;
  const n = escapeHtml(nonce);
  const preamble =
    entry === 'auth'
      ? ''
      : `<script type="module" nonce="${n}">import RefreshRuntime from "${origin}@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script>`;
  return {
    head: '',
    body: `${preamble}<script type="module" nonce="${n}" src="${origin}@vite/client"></script><script type="module" nonce="${n}" src="${origin}${SOURCES[entry]}"></script>`,
  };
}

export function entryTags(entry: Entry, nonce: string) {
  if (config.devServer) return devTags(entry, nonce);
  const files = load();
  const key = SOURCES[entry];
  if (!files?.[key]) return null;
  const css = new Set<string>();
  const preload = new Set<string>();
  const fonts = new Set<string>();
  const seen = new Set<string>();
  const walk = (name: string, root: boolean) => {
    const chunk = files[name];
    if (!chunk || seen.has(name)) return;
    seen.add(name);
    chunk.css?.forEach((file) => css.add(file));
    chunk.assets?.forEach((file) => PRELOAD_FONTS.test(file) && fonts.add(file));
    if (!root) preload.add(chunk.file);
    chunk.imports?.forEach((child) => walk(child, false));
  };
  walk(key, true);
  const n = escapeHtml(nonce);
  const href = (file: string) => escapeHtml(`/assets/${file}`);
  return {
    head: [
      ...[...fonts].map((file) => `<link rel="preload" href="${href(file)}" as="font" type="font/woff2" crossorigin>`),
      ...[...css].map((file) => `<link rel="stylesheet" href="${href(file)}">`),
      ...[...preload].map((file) => `<link rel="modulepreload" nonce="${n}" href="${href(file)}">`),
    ].join('\n'),
    body: `<script type="module" nonce="${n}" src="${href(files[key].file)}"></script>`,
  };
}
