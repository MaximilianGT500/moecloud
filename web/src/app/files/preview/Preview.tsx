import { Suspense, lazy } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { triggerDownload } from '../actions';
import { contentUrl, previewType, type Item } from '../kinds';
import { Fallback, InfectedNotice } from './Fallback';
import { AudioPreview, CoverPreview, FontPreview, ImagePreview, VideoPreview } from './media';
import XlsxPreview from './TablePreview';
import { TextPreview, TEXT_LIMIT } from './TextPreview';

const DocxPreview = lazy(() => import('./DocxPreview'));
const ArchivePreview = lazy(() => import('./ArchivePreview'));
const EmailPreview = lazy(() => import('./EmailPreview'));
const CalendarPreview = lazy(() => import('./PimPreview').then((module) => ({ default: module.CalendarPreview })));
const ContactPreview = lazy(() => import('./PimPreview').then((module) => ({ default: module.ContactPreview })));

const DOCUMENT_LIMIT = 40 * 1024 * 1024;
const EMAIL_LIMIT = 25 * 1024 * 1024;

export interface PreviewProps {
  item: Item;
  base?: string;
  canDownload?: boolean;
  editable?: boolean;
  startEditing?: boolean;
  inline?: boolean;
  onSaved?: (item: Item) => void;
  onDirty?: (dirty: boolean) => void;
}

const loading = <CircularProgress aria-label={t('Lädt')} />;

export function Preview({
  item,
  base = '/api',
  canDownload = true,
  editable = false,
  startEditing = false,
  inline,
  onSaved,
  onDirty,
}: PreviewProps) {
  if (item.infected) return <InfectedNotice item={item} />;
  const type = previewType(item);
  const url = contentUrl(item, base);
  const download = canDownload ? (
    <Button variant="contained" startIcon={<DownloadRounded />} onClick={() => triggerDownload(contentUrl(item, base, true))}>
      {t('Herunterladen')}
    </Button>
  ) : null;

  switch (type) {
    case 'image':
      return <ImagePreview item={item} base={base} inline={inline} action={download} />;
    case 'cover':
      return <CoverPreview item={item} base={base} inline={inline} action={download} />;
    case 'video':
      return <VideoPreview item={item} base={base} inline={inline} action={download} />;
    case 'audio':
      return <AudioPreview item={item} base={base} action={download} />;
    case 'pdf':
      return (
        <Box
          component="iframe"
          src={url}
          title={item.name}
          sx={{
            width: 'min(1100px, 100%)',
            height: inline ? '75vh' : '100%',
            border: 0,
            borderRadius: `${radius.md}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        />
      );
    case 'markdown':
    case 'csv':
    case 'json':
    case 'code':
    case 'text':
      if (item.size > TEXT_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} action={download} />;
      return (
        <TextPreview
          item={item}
          base={base}
          type={type}
          editable={editable}
          startEditing={startEditing}
          inline={inline}
          onSaved={onSaved}
          onDirty={onDirty ?? (() => undefined)}
        />
      );
    case 'docx':
      if (item.size > DOCUMENT_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} action={download} />;
      return (
        <Suspense fallback={loading}>
          <DocxPreview item={item} base={base} />
        </Suspense>
      );
    case 'xlsx':
      if (item.size > DOCUMENT_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} action={download} />;
      return <XlsxPreview item={item} base={base} />;
    case 'zip':
      return (
        <Suspense fallback={loading}>
          <ArchivePreview item={item} base={base} canDownload={canDownload} />
        </Suspense>
      );
    case 'email':
      if (item.size > EMAIL_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} action={download} />;
      return (
        <Suspense fallback={loading}>
          <EmailPreview item={item} base={base} canDownload={canDownload} />
        </Suspense>
      );
    case 'calendar':
      return (
        <Suspense fallback={loading}>
          <CalendarPreview item={item} base={base} />
        </Suspense>
      );
    case 'contacts':
      return (
        <Suspense fallback={loading}>
          <ContactPreview item={item} base={base} />
        </Suspense>
      );
    case 'font':
      return <FontPreview item={item} base={base} />;
    default:
      return <Fallback item={item} text={t('Für diese Datei gibt es keine Vorschau.')} action={download} />;
  }
}
