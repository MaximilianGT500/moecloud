import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import InfoRounded from '@mui/icons-material/InfoRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import RotateLeftRounded from '@mui/icons-material/RotateLeftRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import { AnimatePresence, m } from 'motion/react';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { ActionButtons, type Action } from './ActionMenu';
import { triggerDownload } from './actions';
import { Fact, MetaFacts, ScanState } from './facts';
import { FileIcon, contentUrl, kindColor, kindLabel, previewType, thumbUrl, type Item } from './kinds';
import { canEdit } from './model';
import { useMeta } from './preview/meta';
import { Preview } from './preview/Preview';

const SLIDE_SECONDS = 5;

const ROTATABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff']);

interface ViewerProps {
  items: Item[];
  index: number | null;
  onIndex: (index: number | null) => void;
  base?: string;
  canDownload?: boolean;
  actions?: (item: Item) => Action[];
  onSaved?: (item: Item) => void;
  editing?: boolean;
  autoplay?: boolean;
}

function InfoPanel({ item, base, onClose }: { item: Item; base: string; onClose: () => void }) {
  const meta = useMeta(item, base);
  return (
    <Box
      component="aside"
      aria-label={t('Informationen zur Datei')}
      sx={{
        position: { xs: 'absolute', md: 'relative' },
        insetInline: { xs: 8, md: 'auto' },
        bottom: { xs: 8, md: 'auto' },
        zIndex: 2,
        width: { md: 320 },
        maxHeight: { xs: '60%', md: '100%' },
        flex: 'none',
        overflowY: 'auto',
        p: 2.5,
        mr: { md: 2 },
        mb: { md: 2 },
        borderRadius: `${radius.lg}px`,
        bgcolor: mix(c.surfaceContainer, 94),
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 1 }}>
          {t('Informationen')}
        </Typography>
        <IconButton size="small" aria-label={t('Informationen schließen')} onClick={onClose}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Box>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, m: 0 }}>
        <Fact label={t('Name')}>{item.name}</Fact>
        <Fact label={t('Art')}>{kindLabel(item.kind)}</Fact>
        <Fact label={t('Größe')}>{formatBytes(item.size)}</Fact>
        <Fact label={t('Geändert')}>{formatDateTime(item.modifiedAt)}</Fact>
        {item.location !== undefined && item.location !== null && <Fact label={t('Ort')}>{item.location || t('Meine Dateien')}</Fact>}
        {meta && <MetaFacts item={item} meta={meta} />}
      </Box>
      {meta && <ScanState meta={meta} />}
    </Box>
  );
}

export function Viewer({
  items,
  index,
  onIndex,
  base = '/api',
  canDownload = true,
  actions,
  onSaved,
  editing = false,
  autoplay = false,
}: ViewerProps) {
  const item = index === null ? null : (items[index] ?? null);
  const [dirty, setDirty] = useState(false);
  const [info, setInfo] = useState(false);
  const [playing, setPlaying] = useState(autoplay);
  const [rotating, setRotating] = useState(false);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const has = (step: number) => index !== null && index + step >= 0 && index + step < items.length;
  const images = items.filter((entry) => previewType(entry) === 'image');
  const nextImage = index === null ? -1 : items.findIndex((entry, position) => position > index && previewType(entry) === 'image');
  const slideshow = playing && item !== null && previewType(item) === 'image';

  const rotatable = item !== null && Boolean(onSaved) && canEdit(item) && !item.infected && ROTATABLE.has(item.mime ?? '') && !playing;

  const rotate = async (degrees: 90 | 270) => {
    if (!item || rotating) return;
    setRotating(true);
    try {
      const result = await api.post<{ node: Item }>(`/api/nodes/${item.id}/rotate`, { degrees });
      onSaved?.(result.node);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setRotating(false);
    }
  };

  const go = async (step: number) => {
    if (!has(step) || index === null) return;
    if (dirty && !(await confirm({ title: t('Änderungen verwerfen?'), confirm: t('Verwerfen') }))) return;
    setDirty(false);
    onIndex(index + step);
  };

  const close = async () => {
    if (dirty && !(await confirm({ title: t('Änderungen verwerfen?'), confirm: t('Verwerfen') }))) return;
    setDirty(false);
    setPlaying(false);
    onIndex(null);
  };

  useEffect(() => {
    if (!slideshow) return;
    const timer = setTimeout(() => {
      if (nextImage >= 0) onIndex(nextImage);
      else setPlaying(false);
    }, SLIDE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [slideshow, nextImage, onIndex, item?.id]);

  useEffect(() => {
    if (index === null) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['TEXTAREA', 'INPUT', 'VIDEO', 'AUDIO', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === 'ArrowRight') void go(1);
      if (event.key === 'ArrowLeft') void go(-1);
      if (event.key === 'i' && !event.ctrlKey && !event.metaKey) setInfo((value) => !value);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const touchStart = (event: ReactTouchEvent) => {
    if (event.touches.length !== 1) {
      touch.current = null;
      return;
    }
    touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
  };

  const touchEnd = (event: ReactTouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Date.now() - start.at > 600 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    void go(dx < 0 ? 1 : -1);
  };

  const editable = Boolean(item && base === '/api' && (item.role === 'owner' || item.role === 'edit'));
  const ambient = item?.thumb && !item.infected ? thumbUrl(item, base) : null;

  return (
    <Dialog
      open={Boolean(item)}
      onClose={() => void close()}
      fullScreen
      aria-labelledby="viewer-title"
      data-mui-color-scheme="dark"
      slotProps={{ paper: { sx: { bgcolor: c.surfaceContainerLowest, color: c.onSurface, overflow: 'hidden' } } }}
    >
      {item && (
        <Box sx={{ position: 'relative', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
          <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {ambient ? (
              <Box
                component="img"
                src={ambient}
                alt=""
                sx={{
                  position: 'absolute',
                  inset: '-15%',
                  width: '130%',
                  height: '130%',
                  objectFit: 'cover',
                  filter: 'blur(80px) saturate(1.6)',
                  opacity: 0.55,
                }}
              />
            ) : (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background: `radial-gradient(60% 50% at 50% 30%, ${mix(item.infected ? c.error : kindColor(item.kind), 22)}, transparent 70%)`,
                }}
              />
            )}
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(180deg, ${mix(c.surfaceContainerLowest, 70)}, ${mix(c.surfaceContainerLowest, 35)} 30%, ${mix(c.surfaceContainerLowest, 80)})`,
              }}
            />
          </Box>

          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1, px: { xs: 1, sm: 2 }, minHeight: 64 }}>
            <Tooltip title={t('Schließen')}>
              <IconButton aria-label={t('Schließen')} onClick={() => void close()}>
                <ArrowBackRounded />
              </IconButton>
            </Tooltip>
            <FileIcon item={item} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography id="viewer-title" variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                {item.name}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} component="p" noWrap>
                {kindLabel(item.kind)} · {formatBytes(item.size)}
                {item.rendition && !item.infected ? ` · ${t('Vorschaubild')}` : ''}
                {items.length > 1 && index !== null ? ` · ${index + 1} / ${items.length}` : ''}
              </Typography>
            </Box>
            {images.length > 1 && previewType(item) === 'image' && (
              <Tooltip title={playing ? t('Diashow anhalten') : t('Diashow starten')}>
                <IconButton
                  aria-label={playing ? t('Diashow anhalten') : t('Diashow starten')}
                  aria-pressed={playing}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <PauseRounded /> : <PlayArrowRounded />}
                </IconButton>
              </Tooltip>
            )}
            {rotatable && (
              <>
                <Tooltip title={t('Nach links drehen')}>
                  <IconButton aria-label={t('Nach links drehen')} disabled={rotating} onClick={() => void rotate(270)}>
                    <RotateLeftRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Nach rechts drehen')}>
                  <IconButton aria-label={t('Nach rechts drehen')} disabled={rotating} onClick={() => void rotate(90)}>
                    <RotateRightRounded />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <Tooltip title={info ? t('Informationen ausblenden') : t('Informationen zeigen')}>
              <IconButton aria-label={t('Informationen')} aria-pressed={info} onClick={() => setInfo(!info)}>
                {info ? <InfoRounded /> : <InfoOutlined />}
              </IconButton>
            </Tooltip>
            {canDownload && !item.infected && (
              <Tooltip title={t('Herunterladen')}>
                <IconButton aria-label={t('Herunterladen')} onClick={() => triggerDownload(contentUrl(item, base, true))}>
                  <DownloadRounded />
                </IconButton>
              </Tooltip>
            )}
            {actions && <ActionButtons actions={actions(item)} />}
          </Box>

          <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            <Box
              onTouchStart={touchStart}
              onTouchEnd={touchEnd}
              sx={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: { xs: 1, sm: 3 },
                pt: 0,
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={item.id + item.version}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: slideshow ? 0.6 : 0.24 }}
                  style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}
                >
                  <Preview
                    item={item}
                    base={base}
                    canDownload={canDownload}
                    editable={editable}
                    startEditing={editing}
                    onSaved={onSaved}
                    onDirty={setDirty}
                  />
                </m.div>
              </AnimatePresence>
              {has(-1) && (
                <IconButton
                  aria-label={t('Vorherige Datei')}
                  onClick={() => void go(-1)}
                  sx={{
                    position: 'absolute',
                    left: { xs: 4, sm: 16 },
                    top: '50%',
                    transform: 'translateY(-50%)',
                    bgcolor: mix(c.surfaceContainerHigh, 80),
                    '&:hover': { bgcolor: c.surfaceContainerHighest },
                  }}
                >
                  <ChevronLeftRounded />
                </IconButton>
              )}
              {has(1) && (
                <IconButton
                  aria-label={t('Nächste Datei')}
                  onClick={() => void go(1)}
                  sx={{
                    position: 'absolute',
                    right: { xs: 4, sm: 16 },
                    top: '50%',
                    transform: 'translateY(-50%)',
                    bgcolor: mix(c.surfaceContainerHigh, 80),
                    '&:hover': { bgcolor: c.surfaceContainerHighest },
                  }}
                >
                  <ChevronRightRounded />
                </IconButton>
              )}
            </Box>
            {info && <InfoPanel item={item} base={base} onClose={() => setInfo(false)} />}
          </Box>
          {slideshow && (
            <Box
              aria-hidden
              key={`progress-${item.id}`}
              sx={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                height: 3,
                bgcolor: c.primary,
                animation: `moe-slide ${SLIDE_SECONDS}s linear forwards`,
                '@keyframes moe-slide': { from: { width: '0%' }, to: { width: '100%' } },
              }}
            />
          )}
        </Box>
      )}
    </Dialog>
  );
}
