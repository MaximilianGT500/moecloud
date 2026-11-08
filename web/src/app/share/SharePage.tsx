import { useEffect, useRef, useState, type DragEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import { m } from 'motion/react';
import { api, errorText } from '../../lib/api';
import { boot, type Boot } from '../../lib/boot';
import { formatBytes, formatDay } from '../../lib/format';
import { sortItems } from '../files/model';
import { t, tn } from '../../lib/i18n';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { setQuery, useLocation } from '../../lib/router';
import { Uploader, entriesFromDrop, entriesFromInput, hasFiles, useUploads, type UploadEntry } from '../../lib/upload';
import { c, mix, radius } from '../../theme/tokens';
import { BrandMark, EmptyState, SkipLink } from '../common/bits';
import { ThemeToggleButton } from '../common/ThemeToggle';
import { toast } from '../common/toast';
import { triggerDownload } from '../files/actions';
import { Items } from '../files/Items';
import { FileIcon, contentUrl, kindColor, kindLabel, thumbUrl, type Item } from '../files/kinds';
import { DropOverlay, UploadPanel } from '../files/Panels';
import { Preview } from '../files/preview/Preview';
import { Viewer } from '../files/Viewer';

interface ShareBoot extends Boot {
  user: Boot['user'];
  share: {
    token: string;
    label: string | null;
    owner: string;
    allowDownload: boolean;
    allowUpload: boolean;
    uploadOnly: boolean;
    expiresAt: number | null;
    node: Item;
  };
}

function UploadBox({ uploader, folderId, onPick }: { uploader: Uploader; folderId: string; onPick: () => void }) {
  const items = useUploads(uploader);
  const done = items.filter((item) => item.status === 'done');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ButtonBase
        onClick={onPick}
        sx={{
          flexDirection: 'column',
          gap: 1.5,
          py: 6,
          px: 3,
          borderRadius: `${radius.lg}px`,
          border: `2px dashed ${c.outline}`,
          bgcolor: c.surfaceContainer,
          '&:hover': { bgcolor: c.surfaceContainerHigh, borderColor: c.primary },
        }}
        data-folder={folderId}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: c.primaryContainer,
            color: c.onPrimaryContainer,
          }}
        >
          <CloudUploadRounded sx={{ fontSize: 36 }} />
        </Box>
        <Typography variant="h6">{t('Dateien hierher ziehen')}</Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('oder klicken, um sie auszuwählen')}
        </Typography>
      </ButtonBase>
      {done.length > 0 && (
        <Alert severity="success">
          {tn(done.length, '„{name}“ ist angekommen.', '{count} Dateien sind angekommen.', { name: done[0].name })}
        </Alert>
      )}
    </Box>
  );
}

export function SharePage() {
  const data = boot<ShareBoot>();
  const share = data.share;
  const base = `/api/public/${share.token}`;
  const root = share.node;
  const { query } = useLocation();
  const prefs = usePrefs();
  const folderId = root.type === 'folder' ? (query.get('f') ?? root.id) : root.id;
  const [listing, setListing] = useState<{ id: string; items: Item[]; crumbs: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [uploader] = useState(() => new Uploader(base));
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  useEffect(() => {
    uploader.onDone = () => setRevision((value) => value + 1);
  });

  useEffect(() => {
    document.title = `${share.label || root.name} » ${data.site.name}`;
  }, [share.label, root.name, data.site.name]);

  useEffect(() => {
    if (root.type !== 'folder' || share.uploadOnly) return;
    const abort = new AbortController();
    api
      .get<{ items: Item[]; breadcrumbs: { id: string; name: string }[] }>(`${base}/nodes/${folderId}/children`, abort.signal)
      .then((result) => setListing({ id: folderId, items: sortItems(result.items, 'name', 'asc'), crumbs: result.breadcrumbs }))
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [base, folderId, root.type, share.uploadOnly, revision]);

  const current = listing?.id === folderId ? listing : null;
  const files = current?.items.filter((item) => item.type === 'file') ?? [];
  const viewerIndex = viewer ? files.findIndex((item) => item.id === viewer) : -1;
  const canUpload = share.allowUpload && root.type === 'folder';

  const upload = (entries: UploadEntry[]) => {
    if (entries.length) uploader.add(entries, share.uploadOnly ? root.id : folderId);
  };

  const drop = canUpload
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!hasFiles(event.dataTransfer)) return;
          depth.current++;
          setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          void entriesFromDrop(event.dataTransfer).then(upload);
        },
      }
    : {};

  const ambient = root.type === 'file' && root.thumb ? thumbUrl(root, base) : null;

  return (
    <Box sx={{ minHeight: '100dvh', position: 'relative', overflowX: 'hidden' }} {...drop}>
      <SkipLink />
      <Box aria-hidden sx={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
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
              opacity: 0.6,
            }}
          />
        ) : (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(70% 55% at 80% 0%, ${mix(c.primary, 20)}, transparent 70%), radial-gradient(60% 50% at 10% 100%, ${mix(c.tertiary, 14)}, transparent 70%)`,
            }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, ${mix(c.surface, 55)}, ${mix(c.surface, 85)} 45%, ${c.surface})`,
          }}
        />
      </Box>

      <Box
        component="header"
        sx={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: { xs: 2, sm: 3 },
          py: 2,
          maxWidth: 1200,
          mx: 'auto',
        }}
      >
        <BrandMark size={36} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>
          {data.site.name}
        </Typography>
        {data.user && (
          <Button href="/files" variant="tonal" size="small">
            {t('Zu meinen Dateien')}
          </Button>
        )}
        <ThemeToggleButton placement="bottom" />
      </Box>

      <Box component="main" id="inhalt" sx={{ position: 'relative', zIndex: 1, maxWidth: 1200, mx: 'auto', px: { xs: 1.5, sm: 3 }, pb: 8 }}>
        <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Box
            sx={{
              bgcolor: mix(c.surfaceContainerLow, 92),
              backdropFilter: 'blur(20px)',
              borderRadius: `${radius.xl}px`,
              p: { xs: 2, sm: 3 },
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
              position: 'relative',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: `${radius.md}px`,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: `color-mix(in srgb, ${kindColor(root.kind)} 18%, ${c.surfaceContainerHigh})`,
                  flex: 'none',
                }}
              >
                <FileIcon item={root} size={32} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
                  {share.label || root.name}
                </Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                  {[
                    share.owner ? t('Geteilt von {name}', { name: share.owner }) : null,
                    root.type === 'file' ? `${kindLabel(root.kind)} · ${formatBytes(root.size)}` : null,
                    share.expiresAt ? t('verfügbar bis {date}', { date: formatDay(share.expiresAt) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {canUpload && !share.uploadOnly && (
                  <Button variant="tonal" startIcon={<UploadRounded />} onClick={() => input.current?.click()}>
                    {t('Hochladen')}
                  </Button>
                )}
                {share.allowDownload && !share.uploadOnly && (
                  <Button
                    variant="contained"
                    startIcon={<DownloadRounded />}
                    onClick={() =>
                      triggerDownload(
                        root.type === 'file' ? contentUrl(root, base, true) : `${base}/zip${folderId !== root.id ? `?ids=${folderId}` : ''}`
                      )
                    }
                  >
                    {root.type === 'file' ? t('Herunterladen') : t('Alles herunterladen')}
                  </Button>
                )}
              </Box>
            </Box>

            {share.uploadOnly ? (
              <>
                <Typography variant="body1" sx={{ color: c.onSurfaceVariant }}>
                  {t(
                    '{name} bittet dich um Dateien. Was du hier hochlädst, landet direkt bei {name}. Den Inhalt des Ordners siehst du nicht.',
                    { name: share.owner }
                  )}
                </Typography>
                <UploadBox uploader={uploader} folderId={root.id} onPick={() => input.current?.click()} />
              </>
            ) : root.type === 'file' ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', minHeight: 200 }}>
                <Preview item={root} base={base} canDownload={share.allowDownload} inline />
              </Box>
            ) : error ? (
              <EmptyState compact icon={<FolderOpenRounded />} title={t('Das hat nicht geklappt')} text={error} />
            ) : !current ? (
              <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
                <CircularProgress aria-label={t('Lädt')} />
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    component="nav"
                    aria-label={t('Pfad')}
                    sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}
                  >
                    {current.crumbs.map((crumb, index) => {
                      const last = index === current.crumbs.length - 1;
                      return (
                        <Box key={crumb.id} sx={{ display: 'flex', alignItems: 'center' }}>
                          <ButtonBase
                            disabled={last}
                            onClick={() => setQuery('f', crumb.id === root.id ? null : crumb.id, false)}
                            sx={{
                              px: 1,
                              py: 0.5,
                              borderRadius: `${radius.full}px`,
                              fontWeight: last ? 700 : 500,
                              color: last ? c.onSurface : c.onSurfaceVariant,
                              '&:hover': { bgcolor: mix(c.onSurface, 8) },
                            }}
                          >
                            {crumb.name}
                          </ButtonBase>
                          {!last && <ChevronRightRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} />}
                        </Box>
                      );
                    })}
                  </Box>
                  <Tooltip title={prefs.view === 'list' ? t('Kacheln') : t('Liste')}>
                    <IconButton
                      aria-label={prefs.view === 'list' ? t('Als Kacheln zeigen') : t('Als Liste zeigen')}
                      onClick={() => setPrefs({ view: prefs.view === 'list' ? 'grid' : 'list' })}
                    >
                      {prefs.view === 'list' ? <GridViewRounded /> : <ViewListRounded />}
                    </IconButton>
                  </Tooltip>
                </Box>
                {current.items.length === 0 ? (
                  <EmptyState compact icon={<FolderOpenRounded />} title={t('Dieser Ordner ist leer')} />
                ) : (
                  <Box sx={{ mx: { xs: -1, sm: -2 } }}>
                    <Items
                      items={current.items}
                      layout={prefs.view}
                      selected={selected}
                      onSelect={setSelected}
                      onOpen={(item) => (item.type === 'folder' ? setQuery('f', item.id, false) : setViewer(item.id))}
                      onMenu={(item) =>
                        share.allowDownload
                          ? triggerDownload(item.type === 'file' ? contentUrl(item, base, true) : `${base}/zip?ids=${item.id}`)
                          : toast(t('Herunterladen ist für diesen Link ausgeschaltet'))
                      }
                      base={base}
                      label={root.name}
                      menu={share.allowDownload ? { icon: <DownloadRounded fontSize="small" />, label: t('Herunterladen') } : undefined}
                    />
                  </Box>
                )}
              </>
            )}
            <DropOverlay active={dragging} label={t('Loslassen, um hochzuladen')} />
          </Box>
        </m.div>
        {data.site.legal.length > 0 && (
          <Box component="footer" sx={{ display: 'flex', gap: 2.5, justifyContent: 'center', mt: 3, flexWrap: 'wrap' }}>
            {data.site.legal.map((link) => (
              <Typography
                key={link.href}
                component="a"
                href={link.href}
                variant="body2"
                sx={{ color: c.onSurfaceVariant, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                {link.label}
              </Typography>
            ))}
          </Box>
        )}
      </Box>

      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) upload(entriesFromInput(event.target.files));
          event.target.value = '';
        }}
      />
      <UploadPanel uploader={uploader} />
      <Viewer
        items={files}
        index={viewerIndex >= 0 ? viewerIndex : null}
        onIndex={(index) => setViewer(index === null ? null : files[index].id)}
        base={base}
        canDownload={share.allowDownload}
      />
    </Box>
  );
}
