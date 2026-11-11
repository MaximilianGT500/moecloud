import mime from 'mime-types';

export type Kind =
  'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'other';

const RAW: Record<string, string> = {
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  crw: 'image/x-canon-crw',
  nef: 'image/x-nikon-nef',
  nrw: 'image/x-nikon-nrw',
  arw: 'image/x-sony-arw',
  srf: 'image/x-sony-srf',
  sr2: 'image/x-sony-sr2',
  raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
  rwl: 'image/x-leica-rwl',
  pef: 'image/x-pentax-pef',
  srw: 'image/x-samsung-srw',
  '3fr': 'image/x-hasselblad-3fr',
  fff: 'image/x-hasselblad-fff',
  erf: 'image/x-epson-erf',
  kdc: 'image/x-kodak-kdc',
  dcr: 'image/x-kodak-dcr',
  mos: 'image/x-leaf-mos',
  mef: 'image/x-mamiya-mef',
  mrw: 'image/x-minolta-mrw',
  x3f: 'image/x-sigma-x3f',
  iiq: 'image/x-phaseone-iiq',
  gpr: 'image/x-gopro-gpr',
};

const OVERRIDES: Record<string, string> = {
  ...RAW,
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
  bat: 'text/plain',
  cmd: 'text/plain',
  heic: 'image/heic',
  heif: 'image/heif',
  hif: 'image/heif',
  avif: 'image/avif',
  webp: 'image/webp',
  jfif: 'image/jpeg',
  psb: 'image/vnd.adobe.photoshop',
  j2k: 'image/x-jp2-codestream',
  j2c: 'image/x-jp2-codestream',
  jpc: 'image/x-jp2-codestream',
  qoi: 'image/qoi',
  hdr: 'image/vnd.radiance',
  cur: 'image/x-icon',
  ora: 'image/openraster',
  kra: 'application/x-krita',
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
  'application/x-subrip',
  'application/x-tex',
  'message/rfc822',
  'image/svg+xml',
]);

const textual = (type: string) => type.startsWith('text/') || TEXT_MIMES.has(type) || /\+(xml|json)$/.test(type);

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

const SNIFFABLE: Record<string, readonly string[] | null> = {
  'application/octet-stream': null,
  'application/postscript': ['application/pdf'],
  'text/typescript': ['video/mp2t'],
};

export const canSniff = (name: string, type: string | null) => (type || mimeOf(name)) in SNIFFABLE;

export function resolveType(name: string, type: string | null, sniffed?: unknown): string {
  const value = type || mimeOf(name);
  if (typeof sniffed !== 'string' || !(value in SNIFFABLE)) return value;
  const allowed = SNIFFABLE[value];
  return allowed === null || allowed.includes(sniffed) ? sniffed : value;
}

export function kindOf(name: string, type: string | null, nodeType: 'file' | 'folder' = 'file'): Kind {
  if (nodeType === 'folder') return 'folder';
  const ext = extensionOf(name);
  const value = type || mimeOf(name);
  if (value === 'application/pdf') return 'pdf';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (CODE.has(ext)) return 'code';
  if (DOCUMENT.has(ext)) return 'document';
  if (SPREADSHEET.has(ext)) return 'spreadsheet';
  if (PRESENTATION.has(ext)) return 'presentation';
  if (ARCHIVE.has(ext)) return 'archive';
  if (textual(value)) return 'text';
  return 'other';
}

export const isTextual = (name: string, type: string | null) => {
  const kind = kindOf(name, type);
  return kind === 'text' || kind === 'code' || textual(type ?? '');
};

const RAW_TYPES = new Set(Object.values(RAW));
const HEIF_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export const isRaw = (type: string | null) => RAW_TYPES.has(type ?? '');
export const isHeif = (type: string | null) => HEIF_TYPES.has(type ?? '');

const THUMB_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/apng',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/tiff',
  'image/svg+xml',
]);

export const canThumb = (type: string | null) => THUMB_TYPES.has(type ?? '');

const INLINE_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/apng',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
]);

export const isInlineImage = (type: string | null) => INLINE_IMAGES.has(type ?? '');

export function inlineType(name: string, type: string | null): string | null {
  const value = type || mimeOf(name);
  if (INLINE_IMAGES.has(value)) return value;
  if (value.startsWith('video/') || value.startsWith('audio/')) return value;
  if (value === 'application/pdf') return value;
  if (isTextual(name, value)) return 'text/plain; charset=utf-8';
  return null;
}
