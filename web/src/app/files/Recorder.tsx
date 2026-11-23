import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CameraswitchRounded from '@mui/icons-material/CameraswitchRounded';
import FiberManualRecordRounded from '@mui/icons-material/FiberManualRecordRounded';
import MicRounded from '@mui/icons-material/MicRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ScreenShareRounded from '@mui/icons-material/ScreenShareRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import { formatBytes, formatDuration } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import type { RecordMode } from './record';

type Phase = 'starting' | 'ready' | 'recording' | 'paused' | 'done' | 'error';
type Result = { blob: Blob; url: string; kind: 'audio' | 'video' | 'image' };

const AUDIO_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const pick = (types: string[]) => types.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
const pad = (value: number) => String(value).padStart(2, '0');

function stamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
}

function extensionFor(type: string, kind: Result['kind']) {
  if (kind === 'image') return 'jpg';
  if (type.includes('mp4')) return kind === 'audio' ? 'm4a' : 'mp4';
  if (type.includes('ogg')) return 'ogg';
  return kind === 'audio' ? 'weba' : 'webm';
}

function stopAll(streams: (MediaStream | null)[]) {
  for (const stream of streams) for (const track of stream?.getTracks() ?? []) track.stop();
}

function problem(reason: unknown, mode: RecordMode) {
  const name = reason instanceof DOMException ? reason.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return mode === 'screen'
      ? t('Die Freigabe des Bildschirms wurde nicht erlaubt.')
      : t('Der Zugriff wurde nicht erlaubt. Du kannst ihn in den Einstellungen deines Browsers für diese Seite freigeben.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return mode === 'audio' ? t('Es wurde kein Mikrofon gefunden.') : t('Es wurde keine Kamera gefunden.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') return t('Das Gerät wird gerade von einer anderen App benutzt.');
  return t('Die Aufnahme lässt sich nicht starten.');
}

function titleFor(mode: RecordMode) {
  if (mode === 'audio') return t('Sprachnotiz aufnehmen');
  if (mode === 'screen') return t('Bildschirm aufnehmen');
  return t('Foto oder Video aufnehmen');
}

function Shutter({ label, onClick, recording, photo }: { label: string; onClick: () => void; recording?: boolean; photo?: boolean }) {
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        onClick={onClick}
        sx={{
          width: 64,
          height: 64,
          border: `4px solid ${photo ? c.outline : c.error}`,
          bgcolor: photo ? c.surfaceContainerHighest : recording ? c.error : 'transparent',
          color: photo ? c.onSurface : recording ? c.onError : c.error,
          '&:hover': { bgcolor: photo ? c.surfaceContainerHigh : recording ? c.error : c.errorContainer },
        }}
      >
        {photo ? <PhotoCameraRounded /> : recording ? <StopRounded /> : <FiberManualRecordRounded sx={{ fontSize: 32 }} />}
      </IconButton>
    </Tooltip>
  );
}

export function RecordDialog({ mode, onClose, onSave }: { mode: RecordMode; onClose: () => void; onSave: (file: File) => void }) {
  const phone = useMediaQuery('(max-width: 599.95px)');
  const [phase, setPhase] = useState<Phase>(mode === 'screen' ? 'ready' : 'starting');
  const [error, setError] = useState('');
  const [live, setLive] = useState<MediaStream | null>(null);
  const [kind, setKind] = useState<'photo' | 'video'>('photo');
  const [result, setResult] = useState<Result | null>(null);
  const [name, setName] = useState('');
  const [extension, setExtension] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [size, setSize] = useState(0);
  const [cameras, setCameras] = useState<string[]>([]);
  const [device, setDevice] = useState<string | null>(null);
  const [withMic, setWithMic] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const streams = useRef<MediaStream[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const clock = useRef({ started: 0, before: 0 });
  const discard = useRef(false);
  const preview = useRef<HTMLVideoElement | null>(null);
  const meter = useRef<HTMLDivElement | null>(null);
  const mixer = useRef<AudioContext | null>(null);
  const resultUrl = useRef<string | null>(null);

  const release = () => {
    stopAll(streams.current);
    streams.current = [];
    void mixer.current?.close().catch(() => undefined);
    mixer.current = null;
    setLive(null);
  };

  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      stopAll(streams.current);
      void mixer.current?.close().catch(() => undefined);
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    },
    []
  );

  useEffect(() => {
    if (mode === 'screen') return;
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(t('Aufnehmen geht nur, wenn MoeCloud über HTTPS läuft.'));
      setPhase('error');
      return;
    }
    const constraints: MediaStreamConstraints =
      mode === 'audio'
        ? { audio: { echoCancellation: true, noiseSuppression: true } }
        : {
            video: device
              ? { deviceId: { exact: device } }
              : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(async (stream) => {
        if (cancelled) {
          stopAll([stream]);
          return;
        }
        stopAll(streams.current);
        streams.current = [stream];
        setLive(stream);
        setPhase('ready');
        if (mode === 'camera') {
          const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
          if (!cancelled)
            setCameras(devices.filter((entry) => entry.kind === 'videoinput' && entry.deviceId).map((entry) => entry.deviceId));
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(problem(reason, mode));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [mode, device, attempt]);

  useEffect(() => {
    if (mode !== 'audio' || !live || !live.getAudioTracks().length) return;
    const context = new AudioContext();
    void context.resume().catch(() => undefined);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(live).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      if (meter.current) meter.current.style.transform = `scale(${1 + level * 0.6})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      void context.close().catch(() => undefined);
    };
  }, [mode, live]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      setElapsed(clock.current.before + Date.now() - clock.current.started);
      setSize(chunks.current.reduce((sum, chunk) => sum + chunk.size, 0));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const finish = (blob: Blob, kindOf: Result['kind'], type: string) => {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    const url = URL.createObjectURL(blob);
    resultUrl.current = url;
    const ending = extensionFor(type, kindOf);
    const label =
      mode === 'audio' ? t('Sprachnotiz') : mode === 'screen' ? t('Bildschirmaufnahme') : kindOf === 'image' ? t('Foto') : t('Video');
    setResult({ blob, url, kind: kindOf });
    setName(`${label} ${stamp()}`);
    setExtension(ending);
    setPhase('done');
    release();
  };

  const begin = (source: MediaStream) => {
    const type = pick(source.getVideoTracks().length ? VIDEO_TYPES : AUDIO_TYPES);
    let next: MediaRecorder;
    try {
      next = new MediaRecorder(source, type ? { mimeType: type } : undefined);
    } catch (reason) {
      setError(problem(reason, mode));
      setPhase('error');
      release();
      return;
    }
    chunks.current = [];
    discard.current = false;
    next.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    next.onstop = () => {
      if (discard.current) return;
      const mime = (next.mimeType || type || 'video/webm').split(';')[0];
      finish(new Blob(chunks.current, { type: mime }), source.getVideoTracks().length ? 'video' : 'audio', mime);
    };
    next.start(1000);
    recorder.current = next;
    clock.current = { started: Date.now(), before: 0 };
    setElapsed(0);
    setSize(0);
    setPhase('recording');
  };

  const stop = () => {
    const current = recorder.current;
    if (current && current.state !== 'inactive') current.stop();
  };

  const pause = () => {
    const current = recorder.current;
    if (!current || current.state !== 'recording') return;
    current.pause();
    clock.current.before += Date.now() - clock.current.started;
    setElapsed(clock.current.before);
    setPhase('paused');
  };

  const resume = () => {
    const current = recorder.current;
    if (!current || current.state !== 'paused') return;
    current.resume();
    clock.current.started = Date.now();
    setPhase('recording');
  };

  const startCameraVideo = async () => {
    if (!live) return;
    let source = live;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      streams.current.push(microphone);
      source = new MediaStream([...live.getVideoTracks(), ...microphone.getAudioTracks()]);
    } catch {
      toast(t('Das Video wird ohne Ton aufgenommen, weil das Mikrofon nicht freigegeben ist.'));
    }
    begin(source);
  };

  const snap = () => {
    const element = preview.current;
    if (!element || !element.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0);
    canvas.toBlob((blob) => blob && finish(blob, 'image', 'image/jpeg'), 'image/jpeg', 0.92);
  };

  const shareScreen = async () => {
    if (!window.isSecureContext || typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      setError(t('Aufnehmen geht nur, wenn MoeCloud über HTTPS läuft.'));
      setPhase('error');
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'NotAllowedError') return;
      setError(problem(reason, 'screen'));
      setPhase('error');
      return;
    }
    streams.current = [display];
    const voices = [...display.getAudioTracks()];
    if (withMic) {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.current.push(microphone);
        voices.push(...microphone.getAudioTracks());
      } catch {
        toast(t('Die Aufnahme läuft ohne Mikrofon, weil es nicht freigegeben ist.'));
      }
    }
    let sound = voices;
    if (voices.length > 1) {
      const context = new AudioContext();
      const target = context.createMediaStreamDestination();
      for (const track of voices) context.createMediaStreamSource(new MediaStream([track])).connect(target);
      mixer.current = context;
      sound = target.stream.getAudioTracks();
    }
    const combined = new MediaStream([...display.getVideoTracks(), ...sound]);
    display.getVideoTracks()[0]?.addEventListener('ended', () => stop());
    setLive(combined);
    begin(combined);
  };

  const again = () => {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setError('');
    setElapsed(0);
    setSize(0);
    setPhase(mode === 'screen' ? 'ready' : 'starting');
    if (mode !== 'screen') setAttempt((value) => value + 1);
  };

  const close = async (ask = true) => {
    const busy = phase === 'recording' || phase === 'paused' || phase === 'done';
    if (ask && busy && !(await confirm({ title: t('Aufnahme verwerfen?'), confirm: t('Verwerfen'), danger: true }))) return;
    discard.current = true;
    stop();
    release();
    onClose();
  };

  const save = () => {
    if (!result) return;
    const base = name.trim() || t('Aufnahme');
    const file = new File([result.blob], base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`, {
      type: result.blob.type,
    });
    discard.current = true;
    onSave(file);
    onClose();
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const index = device ? cameras.indexOf(device) : -1;
    release();
    setDevice(cameras[(index + 1) % cameras.length]);
    setPhase('starting');
  };

  const recording = phase === 'recording' || phase === 'paused';
  const showVideo = Boolean(live?.getVideoTracks().length) && phase !== 'done';

  return (
    <Dialog open onClose={() => void close()} fullWidth maxWidth="sm" fullScreen={phone} aria-labelledby="aufnehmen-titel">
      <DialogTitle id="aufnehmen-titel">{titleFor(mode)}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
        {phase === 'error' && (
          <Alert severity="error" action={<Button onClick={again}>{t('Noch mal versuchen')}</Button>}>
            {error}
          </Alert>
        )}
        {phase === 'starting' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 6, color: c.onSurfaceVariant }}>
            <CircularProgress size={24} />
            <Typography variant="body2">{mode === 'audio' ? t('Mikrofon wird vorbereitet …') : t('Kamera wird vorbereitet …')}</Typography>
          </Box>
        )}
        {mode === 'screen' && phase === 'ready' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 3, textAlign: 'center' }}>
            <ScreenShareRounded sx={{ fontSize: 48, color: c.primary }} />
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, maxWidth: 420 }}>
              {t('Du wählst gleich aus, ob du den ganzen Bildschirm, ein Fenster oder einen Tab aufnimmst. Die Aufnahme beginnt sofort.')}
            </Typography>
            <FormControlLabel
              control={<Switch checked={withMic} onChange={(event) => setWithMic(event.target.checked)} />}
              label={t('Mikrofon mit aufnehmen')}
            />
            <Button variant="contained" startIcon={<ScreenShareRounded />} onClick={() => void shareScreen()}>
              {t('Bildschirm wählen')}
            </Button>
          </Box>
        )}
        {showVideo && (
          <Box
            sx={{
              position: 'relative',
              borderRadius: `${radius.lg}px`,
              overflow: 'hidden',
              bgcolor: '#000',
              aspectRatio: '16 / 9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <video
              data-record-preview
              ref={(element) => {
                preview.current = element;
                if (element && live && element.srcObject !== live) element.srcObject = live;
              }}
              autoPlay
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {recording && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: `${radius.full}px`,
                  bgcolor: 'rgba(0, 0, 0, 0.6)',
                  color: '#fff',
                }}
              >
                <FiberManualRecordRounded sx={{ fontSize: 14, color: phase === 'paused' ? '#fff' : '#ff5449' }} />
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(elapsed / 1000)}
                </Typography>
              </Box>
            )}
          </Box>
        )}
        {mode === 'audio' && (phase === 'ready' || recording) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
            <Box sx={{ position: 'relative', width: 120, height: 120, display: 'grid', placeItems: 'center' }}>
              <Box
                ref={meter}
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  bgcolor: recording ? c.errorContainer : c.primaryContainer,
                  transition: 'transform 80ms linear',
                }}
              />
              <MicRounded sx={{ position: 'relative', fontSize: 48, color: recording ? c.onErrorContainer : c.onPrimaryContainer }} />
            </Box>
            <Typography variant="h4" component="p" aria-live="off" sx={{ fontVariantNumeric: 'tabular-nums' }} data-record-time>
              {formatDuration(elapsed / 1000)}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant, minHeight: 20 }}>
              {recording ? (phase === 'paused' ? t('Pausiert') : formatBytes(size)) : t('Bereit')}
            </Typography>
          </Box>
        )}
        {mode !== 'audio' && recording && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, textAlign: 'center' }}>
            {phase === 'paused' ? t('Pausiert') : formatBytes(size)}
          </Typography>
        )}
        {(phase === 'ready' || recording) && (mode !== 'screen' || recording) && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
            {mode === 'camera' && !recording && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={kind}
                onChange={(_event, value: 'photo' | 'video' | null) => value && setKind(value)}
                aria-label={t('Art der Aufnahme')}
              >
                <ToggleButton value="photo">
                  <PhotoCameraRounded fontSize="small" sx={{ mr: 0.75 }} />
                  {t('Foto')}
                </ToggleButton>
                <ToggleButton value="video">
                  <VideocamRounded fontSize="small" sx={{ mr: 0.75 }} />
                  {t('Video')}
                </ToggleButton>
              </ToggleButtonGroup>
            )}
            {recording && (
              <Tooltip title={phase === 'paused' ? t('Fortsetzen') : t('Pause')}>
                <IconButton
                  aria-label={phase === 'paused' ? t('Fortsetzen') : t('Pause')}
                  onClick={phase === 'paused' ? resume : pause}
                  sx={{ width: 48, height: 48, bgcolor: c.surfaceContainerHigh }}
                >
                  {phase === 'paused' ? <PlayArrowRounded /> : <PauseRounded />}
                </IconButton>
              </Tooltip>
            )}
            {mode === 'camera' && kind === 'photo' && !recording ? (
              <Shutter label={t('Foto aufnehmen')} onClick={snap} photo />
            ) : recording ? (
              <Shutter label={t('Aufnahme beenden')} onClick={stop} recording />
            ) : (
              <Shutter
                label={t('Aufnahme starten')}
                onClick={() => {
                  if (mode === 'camera') void startCameraVideo();
                  else if (live) begin(live);
                }}
              />
            )}
            {mode === 'camera' && !recording && cameras.length > 1 && (
              <Tooltip title={t('Kamera wechseln')}>
                <IconButton
                  aria-label={t('Kamera wechseln')}
                  onClick={switchCamera}
                  sx={{ width: 48, height: 48, bgcolor: c.surfaceContainerHigh }}
                >
                  <CameraswitchRounded />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
        {phase === 'done' && result && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box
              sx={{
                borderRadius: `${radius.lg}px`,
                overflow: 'hidden',
                bgcolor: result.kind === 'audio' ? c.surfaceContainerHigh : '#000',
                display: 'flex',
                justifyContent: 'center',
                p: result.kind === 'audio' ? 2 : 0,
              }}
            >
              {result.kind === 'image' ? (
                <img
                  data-record-result
                  src={result.url}
                  alt={t('Aufgenommenes Foto')}
                  style={{ maxWidth: '100%', maxHeight: '50vh', display: 'block' }}
                />
              ) : result.kind === 'video' ? (
                <video
                  data-record-result
                  src={result.url}
                  controls
                  playsInline
                  style={{ maxWidth: '100%', maxHeight: '50vh', display: 'block' }}
                />
              ) : (
                <audio data-record-result src={result.url} controls style={{ width: '100%' }} />
              )}
            </Box>
            <TextField
              label={t('Name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              helperText={`${formatBytes(result.blob.size)} · .${extension}`}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'done' ? (
          <>
            <Button onClick={() => void close(false)}>{t('Verwerfen')}</Button>
            <Button onClick={again}>{t('Neu aufnehmen')}</Button>
            <Button variant="contained" onClick={save}>
              {t('Speichern')}
            </Button>
          </>
        ) : (
          <Button onClick={() => void close()}>{recording ? t('Abbrechen') : t('Schließen')}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
