import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

function trustProxy(value: string | undefined): boolean | string {
  if (value === undefined || value === '') return 'loopback,linklocal,uniquelocal';
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));

function databaseUrl() {
  const file = process.env.DATABASE_URL_FILE;
  const value = (file ? readFileSync(file, 'utf8') : process.env.DATABASE_URL || '').trim();
  if (!value) return resolve(dataDir, 'moecloud.db');
  if (/^postgres(?:ql)?:\/\//i.test(value)) return value;
  return resolve(value.replace(/^sqlite:(?:\/\/)?/i, ''));
}

export const config = {
  version: pkg.version,
  root,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  database: databaseUrl(),
  paths: {
    db: resolve(dataDir, 'moecloud.db'),
    blobs: resolve(dataDir, 'blobs'),
    thumbs: resolve(dataDir, 'thumbs'),
    previews: resolve(dataDir, 'previews'),
    tmp: resolve(dataDir, 'tmp'),
    backups: resolve(dataDir, 'backups'),
  },
  backupCopy: process.env.BACKUP_COPY_DIR ? resolve(process.env.BACKUP_COPY_DIR) : null,
  web: resolve(root, 'dist/web'),
  public: resolve(root, 'public'),
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty',
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  devServer: process.env.VITE_DEV_SERVER || '',
  publicUrl: process.env.PUBLIC_URL || '',
  updateUrl: process.env.UPDATE_CHECK_URL || 'https://moecloud.moestudio.net/version.json',
  metricsToken: process.env.METRICS_TOKEN || '',
  tools: {
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
    pdftoppm: process.env.PDFTOPPM_PATH || 'pdftoppm',
    pdftotext: process.env.PDFTOTEXT_PATH || 'pdftotext',
  },
  install: process.env.MOECLOUD_INSTALL || 'node',
  test: process.env.NODE_ENV === 'test',
};
