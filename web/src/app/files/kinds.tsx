import { useState } from 'react';
import Box from '@mui/material/Box';
import FolderRounded from '@mui/icons-material/FolderRounded';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import MovieRounded from '@mui/icons-material/MovieRounded';
import AudioFileRounded from '@mui/icons-material/AudioFileRounded';
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import ArticleRounded from '@mui/icons-material/ArticleRounded';
import TableChartRounded from '@mui/icons-material/TableChartRounded';
import SlideshowRounded from '@mui/icons-material/SlideshowRounded';
import FolderZipRounded from '@mui/icons-material/FolderZipRounded';
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded';
import GppBadRounded from '@mui/icons-material/GppBadRounded';
import type { SvgIconComponent } from '@mui/icons-material';
import { c, fileTypeColor, folderColor, radius } from '../../theme/tokens';
import { t } from '../../lib/i18n';

export type Kind =
  'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'other';

export interface Item {
  id: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  kind: Kind;
  mime: string | null;
  size: number;
  items: number | null;
  createdAt?: number;
  updatedAt?: number;
  modifiedAt: number;
  trashedAt?: number | null;
  version: string;
  thumb: boolean;
  rendition?: boolean;
  starred?: boolean;
  shared?: boolean;
  role?: 'owner' | 'edit' | 'view';
  owner?: { id: number; name: string } | null;
  location?: string | null;
  grantId?: string;
  viaGroup?: string;
  color?: string | null;
  infected?: boolean;
  takenAt?: number | null;
  width?: number | null;
  height?: number | null;
  snippet?: string | null;
}

export type PreviewType =
  'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'csv' | 'json' | 'code' | 'text' | 'docx' | 'xlsx' | 'zip' | 'font' | 'cover' | 'none';

const BROWSER_IMAGES = new Set([
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

const extension = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : name.toLowerCase() === 'dockerfile' ? 'dockerfile' : '';
};

export function previewType(item: Pick<Item, 'name' | 'kind' | 'mime' | 'type' | 'infected' | 'rendition'>): PreviewType {
  if (item.type === 'folder' || item.infected) return 'none';
  const ext = extension(item.name);
  if (item.kind === 'image') return item.rendition || BROWSER_IMAGES.has(item.mime ?? '') ? 'image' : 'none';
  if (item.kind === 'video') return 'video';
  if (item.kind === 'audio') return 'audio';
  if (item.kind === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json' || ext === 'geojson' || ext === 'webmanifest') return 'json';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'zip') return 'zip';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (item.kind === 'code') return 'code';
  if (item.kind === 'text') return 'text';
  return item.rendition ? 'cover' : 'none';
}

export const languageOf = (name: string) => extension(name);

const ICONS: Record<Kind, SvgIconComponent> = {
  folder: FolderRounded,
  image: ImageRounded,
  video: MovieRounded,
  audio: AudioFileRounded,
  pdf: PictureAsPdfRounded,
  text: DescriptionRounded,
  code: CodeRounded,
  document: ArticleRounded,
  spreadsheet: TableChartRounded,
  presentation: SlideshowRounded,
  archive: FolderZipRounded,
  other: InsertDriveFileRounded,
};

export function kindColor(kind: Kind) {
  if (kind === 'folder') return c.primary;
  if (kind === 'image') return fileTypeColor.image;
  if (kind === 'video') return fileTypeColor.video;
  if (kind === 'audio') return fileTypeColor.audio;
  if (['pdf', 'text', 'code', 'document', 'spreadsheet', 'presentation'].includes(kind)) return fileTypeColor.text;
  return fileTypeColor.other;
}

export const KIND_LABELS: Record<Kind, string> = {
  folder: 'Ordner',
  image: 'Bild',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  text: 'Text',
  code: 'Code',
  document: 'Dokument',
  spreadsheet: 'Tabelle',
  presentation: 'Präsentation',
  archive: 'Archiv',
  other: 'Datei',
};

export const kindLabel = (kind: Kind) => t(KIND_LABELS[kind]);

export const FOLDER_COLOR_OPTIONS = [
  { key: 'red', label: 'Rot' },
  { key: 'orange', label: 'Orange' },
  { key: 'yellow', label: 'Gelb' },
  { key: 'green', label: 'Grün' },
  { key: 'teal', label: 'Türkis' },
  { key: 'blue', label: 'Blau' },
  { key: 'purple', label: 'Lila' },
  { key: 'pink', label: 'Pink' },
  { key: 'brown', label: 'Braun' },
  { key: 'gray', label: 'Grau' },
];

export function FileIcon({ item, size = 24 }: { item: Pick<Item, 'kind' | 'shared' | 'color' | 'infected'>; size?: number }) {
  if (item.infected) return <GppBadRounded sx={{ fontSize: size, color: c.error, flex: 'none' }} aria-hidden />;
  const Icon = item.kind === 'folder' && item.shared ? FolderSharedRounded : (ICONS[item.kind] ?? InsertDriveFileRounded);
  const color = item.kind === 'folder' && item.color ? folderColor(item.color) : kindColor(item.kind);
  return <Icon sx={{ fontSize: size, color, flex: 'none' }} aria-hidden />;
}

export const thumbUrl = (item: Pick<Item, 'id' | 'version'>, base = '/api') => `${base}/nodes/${item.id}/thumb?v=${item.version}`;
export const contentUrl = (item: Pick<Item, 'id' | 'version'>, base = '/api', download = false) =>
  `${base}/nodes/${item.id}/content?v=${item.version}${download ? '&download=1' : ''}`;
export const previewUrl = (item: Pick<Item, 'id' | 'version'>, base = '/api') => `${base}/nodes/${item.id}/preview?v=${item.version}`;

export function Thumb({
  item,
  size,
  base = '/api',
  fit = 'cover',
}: {
  item: Item;
  size: number | string;
  base?: string;
  fit?: 'cover' | 'contain';
}) {
  const [failed, setFailed] = useState(false);
  if (!item.thumb || failed || item.infected) {
    return (
      <Box sx={{ width: size, height: size, display: 'grid', placeItems: 'center', flex: 'none' }}>
        <FileIcon item={item} size={typeof size === 'number' ? Math.round(size * 0.6) : 40} />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={thumbUrl(item, base)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      sx={{
        width: size,
        height: size,
        objectFit: fit,
        borderRadius: `${radius.sm}px`,
        display: 'block',
        flex: 'none',
        bgcolor: c.surfaceContainerHighest,
      }}
    />
  );
}
