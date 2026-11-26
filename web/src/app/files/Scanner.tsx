import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DocumentScannerRounded from '@mui/icons-material/DocumentScannerRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { buildPdf, drawPage, type Rotation, type ScanFilter, type ScanPage } from './scan';

const pad = (value: number) => String(value).padStart(2, '0');

function stamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}

let counter = 0;
const nextId = () => `page-${++counter}`;

function cameraProblem(reason: unknown) {
  const name = reason instanceof DOMException ? reason.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return t('Der Zugriff auf die Kamera wurde nicht erlaubt. Du kannst stattdessen Fotos auswählen.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return t('Es wurde keine Kamera gefunden. Du kannst stattdessen Fotos auswählen.');
  return t('Die Kamera lässt sich nicht starten. Du kannst stattdessen Fotos auswählen.');
}

function Thumb({
  page,
  filter,
  index,
  count,
  onRotate,
  onMove,
  onRemove,
}: {
  page: ScanPage;
  filter: ScanFilter;
  index: number;
  count: number;
  onRotate: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const canvas = drawPage(page, filter, 320);
    setUrl(canvas.toDataURL('image/jpeg', 0.7));
  }, [page, page.rotation, filter]);
  return (
    <Box
      component="li"
      data-scan-page
      sx={{ flex: 'none', width: 132, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}
    >
      <Box
        sx={{
          width: 132,
          height: 172,
          borderRadius: `${radius.sm}px`,
          bgcolor: c.surfaceContainerHighest,
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {url && (
          <Box component="img" src={url} alt={t('Seite {number}', { number: index + 1 })} sx={{ maxWidth: '100%', maxHeight: '100%' }} />
        )}
      </Box>
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
        {t('Seite {number}', { number: index + 1 })}
      </Typography>
      <Box sx={{ display: 'flex' }}>
        <Tooltip title={t('Nach vorn')}>
          <span>
            <IconButton size="small" aria-label={t('Nach vorn')} disabled={index === 0} onClick={() => onMove(-1)}>
              <ChevronLeftRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('Drehen')}>
          <IconButton size="small" aria-label={t('Drehen')} onClick={onRotate}>
            <RotateRightRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Entfernen')}>
          <IconButton size="small" aria-label={t('Entfernen')} onClick={onRemove}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Nach hinten')}>
          <span>
            <IconButton size="small" aria-label={t('Nach hinten')} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ChevronRightRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

export function ScanDialog({ onClose, onSave }: { onClose: () => void; onSave: (file: File) => void }) {
  const phone = useMediaQuery('(max-width:600px)');
  const video = useRef<HTMLVideoElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<'starting' | 'ready' | 'off'>('starting');
  const [problem, setProblem] = useState<string | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [filter, setFilter] = useState<ScanFilter>('document');
  const [name, setName] = useState(() => t('Scan {time}', { time: stamp() }));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('off');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then((media) => {
        if (!alive) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play().catch(() => undefined);
        }
        setCamera('ready');
      })
      .catch((reason) => {
        if (!alive) return;
        setProblem(cameraProblem(reason));
        setCamera('off');
      });
    return () => {
      alive = false;
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
    };
  }, []);

  const capture = () => {
    const source = video.current;
    if (!source || !source.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    setPages((current) => [...current, { id: nextId(), source: canvas, rotation: 0 }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: ScanPage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        added.push({ id: nextId(), source: bitmap, rotation: 0 });
      } catch {
        toast(t('„{name}“ lässt sich nicht als Bild lesen', { name: file.name }));
      }
    }
    if (added.length) setPages((current) => [...current, ...added]);
  };

  const update = (id: string, change: (page: ScanPage) => ScanPage) =>
    setPages((current) => current.map((page) => (page.id === id ? change(page) : page)));

  const move = (index: number, delta: number) =>
    setPages((current) => {
      const next = [...current];
      const [page] = next.splice(index, 1);
      next.splice(index + delta, 0, page);
      return next;
    });

  const save = async () => {
    if (!pages.length) return;
    setBusy(true);
    try {
      const title = name.trim().replace(/\.pdf$/i, '') || t('Scan {time}', { time: stamp() });
      const blob = await buildPdf(pages, filter, title);
      onSave(new File([blob], `${title.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`, { type: 'application/pdf' }));
      onClose();
    } catch {
      toast(t('Die PDF ließ sich nicht erstellen'));
      setBusy(false);
    }
  };

  const close = async () => {
    if (
      pages.length &&
      !(await confirm({ title: t('Scan verwerfen?'), text: t('Die aufgenommenen Seiten gehen verloren.'), confirm: t('Verwerfen') }))
    )
      return;
    onClose();
  };

  return (
    <Dialog open onClose={() => void close()} fullScreen={phone} maxWidth="md" fullWidth aria-labelledby="scan-title">
      <DialogTitle id="scan-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DocumentScannerRounded sx={{ color: c.primary }} />
        {t('Dokument scannen')}
      </DialogTitle>
      <DialogContent data-scanner sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {problem && <Alert severity="info">{problem}</Alert>}
        {camera !== 'off' && (
          <Box
            sx={{
              position: 'relative',
              borderRadius: `${radius.lg}px`,
              overflow: 'hidden',
              bgcolor: '#000',
              aspectRatio: phone ? '3 / 4' : '16 / 9',
              maxHeight: '46vh',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Box
              component="video"
              ref={video}
              muted
              playsInline
              aria-label={t('Kamerabild')}
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {camera === 'starting' && <CircularProgress sx={{ position: 'absolute', color: '#fff' }} />}
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                inset: '8%',
                border: '2px dashed rgba(255,255,255,0.7)',
                borderRadius: `${radius.md}px`,
                pointerEvents: 'none',
              }}
            />
            {flash && <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.6)' }} />}
            <Box sx={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
              <Tooltip title={t('Seite aufnehmen')}>
                <span>
                  <IconButton
                    aria-label={t('Seite aufnehmen')}
                    disabled={camera !== 'ready'}
                    onClick={capture}
                    sx={{
                      width: 64,
                      height: 64,
                      border: '4px solid #fff',
                      bgcolor: 'rgba(255,255,255,0.25)',
                      color: '#fff',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.4)' },
                    }}
                  >
                    <DocumentScannerRounded />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="outlined" startIcon={<AddPhotoAlternateRounded />} onClick={() => picker.current?.click()}>
            {t('Fotos auswählen')}
          </Button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            capture={camera === 'off' ? 'environment' : undefined}
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_event, value: ScanFilter | null) => value && setFilter(value)}
            aria-label={t('Darstellung der Seiten')}
          >
            <ToggleButton value="document">{t('Dokument')}</ToggleButton>
            <ToggleButton value="gray">{t('Graustufen')}</ToggleButton>
            <ToggleButton value="color">{t('Farbe')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {pages.length > 0 ? (
          <Box
            component="ol"
            aria-label={t('Seiten')}
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}
          >
            {pages.map((page, index) => (
              <Thumb
                key={page.id}
                page={page}
                filter={filter}
                index={index}
                count={pages.length}
                onRotate={() => update(page.id, (current) => ({ ...current, rotation: ((current.rotation + 90) % 360) as Rotation }))}
                onMove={(delta) => move(index, delta)}
                onRemove={() => setPages((current) => current.filter((entry) => entry.id !== page.id))}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {camera === 'off'
              ? t('Wähle Fotos deiner Seiten aus. Sie landen als eine PDF in diesem Ordner.')
              : t('Halte die Seite in den Rahmen und nimm sie auf. Alle Seiten landen als eine PDF in diesem Ordner.')}
          </Typography>
        )}
        <TextField
          label={t('Name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void close()}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={!pages.length || busy} onClick={() => void save()}>
          {busy ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            tn(pages.length, 'Als PDF speichern', 'Als PDF mit {count} Seiten speichern')
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
