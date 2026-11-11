import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import { api } from '../../../lib/api';
import { formatDuration } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { c, elevation, fonts, radius } from '../../../theme/tokens';
import { contentUrl, previewUrl, thumbUrl, type Item } from '../kinds';
import { useResume, useSubtitles } from '../playback';
import { Fallback } from './Fallback';

export interface NodeMeta {
  width: number | null;
  height: number | null;
  takenAt: number | null;
  processed: boolean;
  meta: Record<string, string | number | boolean | undefined>;
  scan: { status: string; signature: string | null; at: number | null } | null;
}

export function useMeta(item: Item | null, base = '/api') {
  const [state, setState] = useState<{ key: string; meta: NodeMeta | null } | null>(null);
  const key = item ? `${base}:${item.id}:${item.version}` : '';
  useEffect(() => {
    if (!item || item.type !== 'file' || item.trashedAt) return;
    const abort = new AbortController();
    api
      .get<NodeMeta>(`${base}/nodes/${item.id}/meta`, abort.signal)
      .then((meta) => setState({ key, meta }))
      .catch(() => setState({ key, meta: null }));
    return () => abort.abort();
  }, [item, base, key]);
  return state?.key === key ? state.meta : null;
}

interface MediaProps {
  item: Item;
  base: string;
  inline?: boolean;
  action?: ReactNode;
}

export function ImagePreview({ item, base, inline, action }: MediaProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const key = item.id + item.version;
  const [current, setCurrent] = useState(key);
  if (current !== key) {
    setCurrent(key);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setState('loading');
  }
  const waiting = Boolean(item.rendition) && state === 'loading';

  if (state === 'failed') return <Fallback item={item} text={t('Diese Datei lässt sich nicht anzeigen.')} action={action} />;

  const wheel = (event: ReactWheelEvent) => {
    if (inline) return;
    const next = Math.min(8, Math.max(1, zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setZoom(next);
    if (next === 1) setOffset({ x: 0, y: 0 });
  };

  const down = (event: ReactPointerEvent) => {
    if (zoom === 1) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };

  const up = () => {
    drag.current = null;
    setDragging(false);
  };

  const move = (event: ReactPointerEvent) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
  };

  return (
    <Box
      onWheel={wheel}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => {
        if (inline) return;
        setZoom(zoom === 1 ? 2.5 : 1);
        setOffset({ x: 0, y: 0 });
      }}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: waiting ? 160 : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: inline ? 'default' : zoom > 1 ? 'grab' : 'zoom-in',
        touchAction: zoom > 1 ? 'none' : 'auto',
      }}
    >
      {waiting && (
        <CircularProgress
          aria-label={t('Lädt')}
          sx={{
            position: 'absolute',
            animation: 'moe-appear 200ms 400ms both',
            '@keyframes moe-appear': { from: { opacity: 0 }, to: { opacity: 1 } },
          }}
        />
      )}
      <Box
        component="img"
        src={item.rendition ? previewUrl(item, base) : contentUrl(item, base)}
        alt={item.name}
        draggable={false}
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
        sx={{
          maxWidth: '100%',
          maxHeight: inline ? '70vh' : '100%',
          objectFit: 'contain',
          borderRadius: `${radius.md}px`,
          boxShadow: elevation[5],
          opacity: waiting ? 0 : 1,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transition: dragging ? 'none' : 'transform 160ms cubic-bezier(0.2, 0, 0, 1), opacity 160ms',
          userSelect: 'none',
        }}
      />
    </Box>
  );
}

export function CoverPreview({ item, base, inline, action }: MediaProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Fallback item={item} text={t('Für diese Datei gibt es keine Vorschau.')} action={action} />;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        maxHeight: '100%',
        overflowY: 'auto',
        textAlign: 'center',
        px: 2,
        py: 1,
      }}
    >
      <Box
        component="img"
        src={previewUrl(item, base)}
        alt={t('Vorschaubild von „{name}“', { name: item.name })}
        draggable={false}
        onError={() => setFailed(true)}
        sx={{
          maxWidth: '100%',
          maxHeight: inline ? '55vh' : '62vh',
          objectFit: 'contain',
          borderRadius: `${radius.md}px`,
          boxShadow: elevation[5],
          bgcolor: c.surfaceContainerHighest,
        }}
      />
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant, maxWidth: 480 }}>
        {t('MoeCloud zeigt hier das Vorschaubild aus der Datei.')}
      </Typography>
      {action}
    </Box>
  );
}

export function VideoPreview({ item, base, inline, action }: MediaProps) {
  const [failed, setFailed] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const subtitles = useSubtitles(item, base);
  const resume = useResume(item, video, base === '/api', 60);
  const { resumedAt } = resume;

  if (failed) return <Fallback item={item} text={t('Dein Browser kann dieses Video nicht abspielen.')} action={action} />;
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        maxWidth: '100%',
        maxHeight: '100%',
        width: inline ? '100%' : undefined,
      }}
    >
      <Box
        component="video"
        ref={setVideo}
        src={contentUrl(item, base)}
        controls
        autoPlay={!inline}
        playsInline
        poster={item.thumb ? thumbUrl(item, base) : undefined}
        onError={() => setFailed(true)}
        sx={{
          maxWidth: '100%',
          maxHeight: inline ? '70vh' : '100%',
          width: inline ? '100%' : undefined,
          borderRadius: `${radius.md}px`,
          bgcolor: c.scrim,
          outline: 'none',
        }}
      >
        {subtitles.list.map((track, index) => (
          <track
            key={track.id}
            kind="subtitles"
            src={`${base}/nodes/${track.id}/vtt`}
            srcLang={track.code}
            label={track.label}
            default={index === subtitles.preferred}
          />
        ))}
      </Box>
      {resumedAt !== null && (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 1.5,
            pr: 0.5,
            py: 0.5,
            borderRadius: `${radius.full}px`,
            bgcolor: c.inverseSurface,
            color: c.inverseOnSurface,
            boxShadow: elevation[2],
          }}
        >
          <Typography variant="body2">{t('Weiter bei {time}', { time: formatDuration(resumedAt) })}</Typography>
          <Button size="small" onClick={resume.restart} sx={{ color: c.inversePrimary }}>
            {t('Von vorn')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

export function AudioPreview({ item, base, action }: MediaProps) {
  const meta = useMeta(item, base);
  const [failed, setFailed] = useState(false);
  const tags = meta?.meta ?? {};
  const title = typeof tags.title === 'string' ? tags.title : item.name;
  const line = [tags.artist, tags.album, tags.year].filter(Boolean).join(' · ');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5, textAlign: 'center', px: 3 }}>
      <Box
        sx={{
          width: 'min(280px, 70vw)',
          aspectRatio: '1',
          borderRadius: `${radius.xl}px`,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          bgcolor: `color-mix(in srgb, var(--mui-palette-fileTypes-audio) 22%, ${c.surfaceContainerHigh})`,
          boxShadow: elevation[3],
        }}
      >
        {item.thumb ? (
          <Box component="img" src={thumbUrl(item, base)} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <MusicNoteRounded sx={{ fontSize: 96, color: 'var(--mui-palette-fileTypes-audio)' }} />
        )}
      </Box>
      <Box>
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {line && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {line}
          </Typography>
        )}
        {typeof tags.duration === 'number' && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {formatDuration(tags.duration)}
          </Typography>
        )}
      </Box>
      {failed ? (
        <>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, maxWidth: 420 }}>
            {t('Dein Browser kann diese Audiodatei nicht abspielen.')}
          </Typography>
          {action}
        </>
      ) : (
        <Box
          component="audio"
          src={contentUrl(item, base)}
          controls
          autoPlay
          onError={() => setFailed(true)}
          sx={{ width: 'min(420px, 90vw)' }}
        />
      )}
    </Box>
  );
}

let fontCounter = 0;

export function FontPreview({ item, base }: { item: Item; base: string }) {
  const [family, setFamily] = useState<{ key: string; name: string | null } | null>(null);
  const [size, setSize] = useState(48);
  const [sample, setSample] = useState(t('Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.'));
  const key = item.id + item.version;

  useEffect(() => {
    const abort = new AbortController();
    let face: FontFace | null = null;
    fetch(contentUrl(item, base), { credentials: 'same-origin', signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error('load');
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        const name = `moe-preview-${++fontCounter}`;
        face = new FontFace(name, buffer);
        await face.load();
        document.fonts.add(face);
        if (!abort.signal.aborted) setFamily({ key, name });
      })
      .catch(() => {
        if (!abort.signal.aborted) setFamily({ key, name: null });
      });
    return () => {
      abort.abort();
      if (face) document.fonts.delete(face);
    };
  }, [item, base, key]);

  if (!family || family.key !== key) return <CircularProgress aria-label={t('Lädt')} />;
  if (!family.name) return <Fallback item={item} text={t('Die Schrift lässt sich nicht laden.')} />;
  return (
    <Box
      sx={{
        width: 'min(1000px, 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        p: { xs: 2, sm: 4 },
        bgcolor: c.surfaceContainerLow,
        borderRadius: `${radius.lg}px`,
      }}
    >
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label={t('Beispieltext')}
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          sx={{ flex: 1, minWidth: 240 }}
        />
        <Box sx={{ width: 220 }}>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Größe: {size} px', { size })}
          </Typography>
          <Slider value={size} min={12} max={120} onChange={(_event, value) => setSize(value as number)} aria-label={t('Schriftgröße')} />
        </Box>
      </Box>
      <Box sx={{ fontFamily: `"${family.name}", ${fonts.sans}`, fontSize: size, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{sample}</Box>
      <Box
        sx={{
          fontFamily: `"${family.name}", ${fonts.sans}`,
          fontSize: 20,
          lineHeight: 1.6,
          color: c.onSurfaceVariant,
          overflowWrap: 'anywhere',
        }}
      >
        ABCDEFGHIJKLMNOPQRSTUVWXYZ ÄÖÜ
        <br />
        abcdefghijklmnopqrstuvwxyz äöüß
        <br />
        0123456789 &amp; ! ? € @ ( ) [ ] {'{ }'}
      </Box>
    </Box>
  );
}
