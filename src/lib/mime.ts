import mime from 'mime-types';

export type Kind =
  'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'other';

const OVERRIDES: Record<string, string> = {
  ts: 'text/typescript',
  tsx: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  md: 'text/markdown',
  markdown: 'text/markdown',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/plain',
  ini: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  log: 'text/plain',
  rs: 'text/x-rust',
  go: 'text/x-go',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  dart: 'text/x-dart',
  vue: 'text/plain',
  svelte: 'text/plain',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  webp: 'image/webp',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mkv: 'video/x-matroska',
};

const CODE = new Set([
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'mts',
  'cts',
  'json',
  'py',
  'rb',
  'php',
  'java',
  'kt',
  'swift',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cs',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'vue',
  'svelte',
  'dart',
  'lua',
  'r',
  'pl',
  'dockerfile',
]);

const DOCUMENT = new Set(['doc', 'docx', 'odt', 'rtf', 'pages', 'epub']);
const SPREADSHEET = new Set(['xls', 'xlsx', 'ods', 'numbers', 'csv', 'tsv']);
const PRESENTATION = new Set(['ppt', 'pptx', 'odp', 'key']);
const ARCHIVE = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'dmg']);

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-yaml',
  'application/toml',
  'application/sql',
  'application/x-httpd-php',
  'image/svg+xml',
]);

export const extensionOf = (name: string) => {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const index = lower.lastIndexOf('.');
  return index > 0 ? lower.slice(index + 1) : '';
};

export function mimeOf(name: string): string {
  const ext = extensionOf(name);
  return OVERRIDES[ext] || mime.lookup(name) || 'application/octet-stream';
}

export function kindOf(name: string, type: string | null, nodeType: 'file' | 'folder' = 'file'): Kind {
  if (nodeType === 'folder') return 'folder';
  const ext = extensionOf(name);
  const value = type || mimeOf(name);
  if (value === 'application/pdf') return 'pdf';
  if (CODE.has(ext)) return 'code';
  if (DOCUMENT.has(ext)) return 'document';
  if (SPREADSHEET.has(ext)) return 'spreadsheet';
  if (PRESENTATION.has(ext)) return 'presentation';
  if (ARCHIVE.has(ext)) return 'archive';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (value.startsWith('text/') || TEXT_MIMES.has(value)) return 'text';
  return 'other';
}

export const isTextual = (name: string, type: string | null) => {
  const kind = kindOf(name, type);
  return kind === 'text' || kind === 'code' || (type ?? '').startsWith('text/') || TEXT_MIMES.has(type ?? '');
};

const THUMB_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
]);

export const canThumb = (type: string | null) => THUMB_TYPES.has(type ?? '');

const INLINE_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
]);

export function inlineType(name: string, type: string | null): string | null {
  const value = type || mimeOf(name);
  if (INLINE_IMAGES.has(value)) return value;
  if (value.startsWith('video/') || value.startsWith('audio/')) return value;
  if (value === 'application/pdf') return value;
  if (isTextual(name, value)) return 'text/plain; charset=utf-8';
  return null;
}
