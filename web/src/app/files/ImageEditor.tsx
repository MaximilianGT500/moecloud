import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FlipRounded from '@mui/icons-material/FlipRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import RotateLeftRounded from '@mui/icons-material/RotateLeftRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { savedToast } from './actions';
import { contentUrl, previewUrl, type Item } from './kinds';
import { canEdit } from './model';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Format = 'original' | 'jpeg' | 'png' | 'webp' | 'avif';
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const FULL: Rect = { x: 0, y: 0, width: 1, height: 1 };
const WRITABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff']);
const MIN = 0.02;
const RATIOS: { key: string; label: string; value: number | null }[] = [
  { key: 'free', label: '', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
  { key: '9:16', label: '9:16', value: 9 / 16 },
];
const SIZES = [null, 4096, 2560, 1920, 1280, 800];
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function fitted(ratio: number) {
  if (ratio >= 1) return { x: 0, y: (1 - 1 / ratio) / 2, width: 1, height: 1 / ratio };
  return { x: (1 - ratio) / 2, y: 0, width: ratio, height: 1 };
}

function resize(start: Rect, handle: Handle, dx: number, dy: number, ratio: number | null): Rect {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) };
  }
  let { x, y, width, height } = start;
  const right = x + width;
  const bottom = y + height;
  if (handle.includes('w')) x = clamp(x + dx, 0, right - MIN);
  if (handle.includes('e')) width = clamp(width + dx, MIN, 1 - x);
  if (handle.includes('n')) y = clamp(y + dy, 0, bottom - MIN);
  if (handle.includes('s')) height = clamp(height + dy, MIN, 1 - y);
  if (handle.includes('w')) width = right - x;
  if (handle.includes('n')) height = bottom - y;
  if (ratio) {
    const wanted = handle === 'n' || handle === 's' ? height * ratio : width;
    width = clamp(wanted, MIN, handle.includes('w') ? right : 1 - x);
    height = width / ratio;
    if (handle.includes('n') ? height > bottom : y + height > 1) {
      height = handle.includes('n') ? bottom : 1 - y;
      width = height * ratio;
    }
    if (handle.includes('w')) x = right - width;
    if (handle.includes('n')) y = bottom - height;
  }
  return { x, y, width, height };
}

export function ImageEditor({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: (node: Item) => void }) {
  const writable = WRITABLE.has(item.mime ?? '');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<Rect>(FULL);
  const [ratio, setRatio] = useState('free');
  const [size, setSize] = useState<number | null>(null);
  const [format, setFormat] = useState<Format>(writable ? 'original' : 'jpeg');
  const [quality, setQuality] = useState(90);
  const [save, setSave] = useState<'copy' | 'version'>('copy');
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null);
  const versionable = writable && format === 'original' && canEdit(item) && !item.grantId && !item.viaGroup;

  useEffect(() => {
    const element = new Image();
    element.decoding = 'async';
    element.onload = () => setImage(element);
    element.onerror = () => setFailed(true);
    element.src = item.rendition ? previewUrl(item) : contentUrl(item);
    return () => {
      element.onload = null;
      element.onerror = null;
    };
  }, [item]);

  useLayoutEffect(() => {
    if (!stage) return;
    const observer = new ResizeObserver(() => setArea({ width: stage.clientWidth, height: stage.clientHeight }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const turned = rotate === 90 || rotate === 270;
  const naturalWidth = image ? (turned ? image.naturalHeight : image.naturalWidth) : 0;
  const naturalHeight = image ? (turned ? image.naturalWidth : image.naturalHeight) : 0;
  const scale =
    image && area.width > 32 && area.height > 32 ? Math.min((area.width - 32) / naturalWidth, (area.height - 32) / naturalHeight, 1) : 0;
  const shown = { width: Math.max(1, Math.floor(naturalWidth * scale)), height: Math.max(1, Math.floor(naturalHeight * scale)) };
  const ratioValue = RATIOS.find((entry) => entry.key === ratio)?.value ?? null;
  const relative = ratioValue && shown.width ? (ratioValue * shown.height) / shown.width : null;

  useEffect(() => {
    const element = canvas.current;
    if (!element || !image || scale <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(shown.width * dpr);
    element.height = Math.round(shown.height * dpr);
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, shown.width, shown.height);
    context.translate(shown.width / 2, shown.height / 2);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    context.rotate((rotate * Math.PI) / 180);
    const width = turned ? shown.height : shown.width;
    const height = turned ? shown.width : shown.height;
    context.drawImage(image, -width / 2, -height / 2, width, height);
  }, [image, rotate, flipH, flipV, shown.width, shown.height, scale, turned]);

  const turn = (step: 90 | 270) => {
    setRotate(((rotate + step) % 360) as 0 | 90 | 180 | 270);
    setFlipH(flipV);
    setFlipV(flipH);
    setCrop(FULL);
    setRatio('free');
  };

  const chooseRatio = (key: string) => {
    setRatio(key);
    const value = RATIOS.find((entry) => entry.key === key)?.value ?? null;
    setCrop(value && shown.width ? fitted((value * shown.height) / shown.width) : FULL);
  };

  const begin = (handle: Handle) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { handle, x: event.clientX, y: event.clientY, start: crop };
  };

  const moveTo = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || !shown.width) return;
    const dx = (event.clientX - current.x) / shown.width;
    const dy = (event.clientY - current.y) / shown.height;
    setCrop(resize(current.start, current.handle, dx, dy, relative));
  };

  const nudge = (key: string) => {
    const step = 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[key];
    if (move) setCrop(resize(crop, 'move', move[0], move[1], null));
  };

  const reset = () => {
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
    setCrop(FULL);
    setRatio('free');
  };

  const cropped = crop.width < 0.999 || crop.height < 0.999;
  const changed = rotate !== 0 || flipH || flipV || cropped || size !== null || format !== 'original';

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ node: Item }>(`/api/nodes/${item.id}/edit`, {
        rotate,
        flipH,
        flipV,
        crop: cropped ? crop : null,
        maxEdge: size,
        format,
        quality,
        save: versionable ? save : 'copy',
      });
      if (versionable && save === 'version') toast(t('Neue Version gespeichert'));
      else savedToast(result.node);
      onSaved(result.node);
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const lossy =
    format === 'jpeg' || format === 'webp' || format === 'avif' || (format === 'original' && /jpeg|webp|avif/.test(item.mime ?? ''));

  return (
    <Dialog open fullScreen onClose={busy ? undefined : onClose} aria-labelledby="editor-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: c.surfaceContainerLowest }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, borderBottom: `1px solid ${c.outlineVariant}` }}>
          <IconButton aria-label={t('Schließen')} onClick={onClose} disabled={busy}>
            <CloseRounded />
          </IconButton>
          <Typography id="editor-title" variant="subtitle1" noWrap sx={{ flex: 1, fontWeight: 700 }}>
            {t('„{name}“ bearbeiten', { name: item.name })}
          </Typography>
          <Button variant="contained" onClick={() => void submit()} disabled={busy || !image || !changed}>
            {busy ? <CircularProgress size={20} aria-label={t('Speichert')} /> : t('Speichern')}
          </Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
          <Box
            ref={setStage}
            sx={{ flex: 1, minHeight: 240, minWidth: 0, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}
          >
            {failed ? (
              <Typography sx={{ color: c.onSurfaceVariant }}>{t('Das Bild lässt sich nicht laden.')}</Typography>
            ) : !image ? (
              <CircularProgress aria-label={t('Lädt')} />
            ) : (
              <Box sx={{ position: 'relative', width: `${shown.width}px`, height: `${shown.height}px`, touchAction: 'none' }}>
                <canvas ref={canvas} style={{ width: shown.width, height: shown.height, display: 'block' }} aria-label={t('Vorschau')} />
                <Box
                  role="group"
                  tabIndex={0}
                  aria-label={t('Zuschnitt, mit den Pfeiltasten verschieben')}
                  onPointerDown={begin('move')}
                  onPointerMove={moveTo}
                  onPointerUp={() => (drag.current = null)}
                  onKeyDown={(event) => {
                    if (event.key.startsWith('Arrow')) {
                      event.preventDefault();
                      nudge(event.key);
                    }
                  }}
                  sx={{
                    position: 'absolute',
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                    boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
                    outline: `2px solid ${c.primary}`,
                    cursor: 'move',
                    '&:focus-visible': { outline: `3px solid ${c.tertiary}` },
                    backgroundImage:
                      'linear-gradient(to right, transparent 33.2%, rgb(255 255 255 / 0.35) 33.3%, transparent 33.5%, transparent 66.5%, rgb(255 255 255 / 0.35) 66.6%, transparent 66.8%), linear-gradient(to bottom, transparent 33.2%, rgb(255 255 255 / 0.35) 33.3%, transparent 33.5%, transparent 66.5%, rgb(255 255 255 / 0.35) 66.6%, transparent 66.8%)',
                  }}
                >
                  {HANDLES.map((handle) => (
                    <Box
                      key={handle}
                      aria-hidden
                      onPointerDown={begin(handle)}
                      onPointerMove={moveTo}
                      onPointerUp={() => (drag.current = null)}
                      sx={{
                        position: 'absolute',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: c.primary,
                        border: `3px solid ${c.surface}`,
                        left: handle.includes('w') ? -11 : handle.includes('e') ? 'calc(100% - 11px)' : 'calc(50% - 11px)',
                        top: handle.includes('n') ? -11 : handle.includes('s') ? 'calc(100% - 11px)' : 'calc(50% - 11px)',
                        cursor: `${handle === 'n' || handle === 's' ? 'ns' : handle === 'e' || handle === 'w' ? 'ew' : handle === 'ne' || handle === 'sw' ? 'nesw' : 'nwse'}-resize`,
                        display: ratioValue && handle.length === 1 ? 'none' : 'block',
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
          <Box
            component="aside"
            aria-label={t('Einstellungen')}
            sx={{
              width: { md: 320 },
              flex: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
              p: 2.5,
              overflowY: 'auto',
              maxHeight: { xs: '45vh', md: 'none' },
              borderLeft: { md: `1px solid ${c.outlineVariant}` },
              borderTop: { xs: `1px solid ${c.outlineVariant}`, md: 'none' },
              bgcolor: c.surfaceContainerLow,
            }}
          >
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Tooltip title={t('Nach links drehen')}>
                <IconButton aria-label={t('Nach links drehen')} onClick={() => turn(270)}>
                  <RotateLeftRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Nach rechts drehen')}>
                <IconButton aria-label={t('Nach rechts drehen')} onClick={() => turn(90)}>
                  <RotateRightRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Waagerecht spiegeln')}>
                <IconButton aria-label={t('Waagerecht spiegeln')} aria-pressed={flipH} onClick={() => setFlipH(!flipH)}>
                  <FlipRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Senkrecht spiegeln')}>
                <IconButton aria-label={t('Senkrecht spiegeln')} aria-pressed={flipV} onClick={() => setFlipV(!flipV)}>
                  <FlipRounded sx={{ transform: 'rotate(90deg)' }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Zurücksetzen')}>
                <IconButton aria-label={t('Zurücksetzen')} onClick={reset}>
                  <RestartAltRounded />
                </IconButton>
              </Tooltip>
            </Box>
            <Box>
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('Seitenverhältnis')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={ratio}
                onChange={(_event, value: string | null) => value && chooseRatio(value)}
                aria-label={t('Seitenverhältnis')}
                sx={{ flexWrap: 'wrap' }}
              >
                {RATIOS.map((entry) => (
                  <ToggleButton key={entry.key} value={entry.key}>
                    {entry.value ? entry.label : t('Frei')}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <TextField
              select
              size="small"
              label={t('Größe')}
              value={size ?? 'full'}
              onChange={(event) => setSize(event.target.value === 'full' ? null : Number(event.target.value))}
            >
              {SIZES.map((entry) => (
                <MenuItem key={entry ?? 'full'} value={entry ?? 'full'}>
                  {entry ? t('Längste Seite {count} Pixel', { count: entry }) : t('Originalgröße')}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label={t('Format')} value={format} onChange={(event) => setFormat(event.target.value as Format)}>
              {writable && <MenuItem value="original">{t('Wie das Original')}</MenuItem>}
              <MenuItem value="jpeg">JPEG</MenuItem>
              <MenuItem value="png">PNG</MenuItem>
              <MenuItem value="webp">WebP</MenuItem>
              <MenuItem value="avif">AVIF</MenuItem>
            </TextField>
            {lossy && (
              <Box>
                <Typography id="editor-quality" variant="subtitle2" component="h3">
                  {t('Qualität {count}', { count: quality })}
                </Typography>
                <Slider
                  value={quality}
                  min={40}
                  max={100}
                  step={1}
                  onChange={(_event, value) => setQuality(value as number)}
                  aria-labelledby="editor-quality"
                />
              </Box>
            )}
            <Box>
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('Speichern als')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={versionable ? save : 'copy'}
                onChange={(_event, value: 'copy' | 'version' | null) => value && setSave(value)}
                aria-label={t('Speichern als')}
              >
                <ToggleButton value="copy">{t('Kopie')}</ToggleButton>
                <ToggleButton value="version" disabled={!versionable}>
                  {t('Neue Version')}
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, mt: 1, borderRadius: `${radius.sm}px` }}>
                {versionable && save === 'version'
                  ? t('Die bisherige Fassung bleibt unter Versionen erhalten.')
                  : t('Die Kopie landet neben dem Original, das Original bleibt unverändert.')}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
