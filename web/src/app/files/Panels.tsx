import { useState, type DragEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import DriveFolderUploadRounded from '@mui/icons-material/DriveFolderUploadRounded';
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded';
import NoteAddRounded from '@mui/icons-material/NoteAddRounded';
import CloudDownloadRounded from '@mui/icons-material/CloudDownloadRounded';
import { AnimatePresence, m } from 'motion/react';
import { formatBytes } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useUploads, type Uploader } from '../../lib/upload';
import { c, elevation, mix, radius, srOnly } from '../../theme/tokens';
import { DRAG_TYPE } from './Items';
import type { Crumb } from './model';

export function Breadcrumbs({
  crumbs,
  rootLabel,
  onNavigate,
  onDrop,
  hrefOf,
  actions,
}: {
  crumbs: Crumb[];
  rootLabel: string;
  onNavigate: (id: string) => void;
  onDrop?: (id: string, transfer: DataTransfer) => void;
  hrefOf: (id: string) => string;
  actions?: ReactNode;
}) {
  const [over, setOver] = useState<string | null>(null);
  const label = (crumb: Crumb, index: number) => (index === 0 && !crumb.name ? rootLabel : crumb.name);
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs[crumbs.length - 2];
  const visible = crumbs.length > 4 ? [crumbs[0], null, ...crumbs.slice(-2)] : crumbs;
  const drop = (crumb: Crumb) =>
    onDrop
      ? {
          onDragOver: (event: DragEvent) => {
            const types = [...event.dataTransfer.types];
            if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
            event.preventDefault();
            setOver(crumb.id);
          },
          onDragLeave: () => setOver(null),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            setOver(null);
            onDrop(crumb.id, event.dataTransfer);
          },
        }
      : {};
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
      {parent && (
        <Tooltip title={t('Zurück zu {name}', { name: label(parent, crumbs.length - 2) })}>
          <IconButton
            component="a"
            href={hrefOf(parent.id)}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(parent.id);
            }}
            aria-label={t('Zurück zu {name}', { name: label(parent, crumbs.length - 2) })}
            sx={{ display: { md: 'none' } }}
          >
            <ArrowBackRounded />
          </IconButton>
        </Tooltip>
      )}
      <Typography
        variant="h5"
        component="h1"
        noWrap
        sx={(theme) => ({ flex: 1, minWidth: 0, pl: parent ? 0 : 1, [theme.breakpoints.up('md')]: srOnly })}
      >
        {current ? label(current, crumbs.length - 1) : rootLabel}
      </Typography>
      <Box component="nav" aria-label={t('Pfad')} sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', minWidth: 0, flex: 1 }}>
        <Box component="ol" sx={{ display: 'flex', alignItems: 'center', listStyle: 'none', m: 0, p: 0, minWidth: 0, gap: 0.25 }}>
          {visible.map((crumb) => {
            if (!crumb) {
              return (
                <Box component="li" key="more" sx={{ display: 'flex', alignItems: 'center', color: c.onSurfaceVariant }}>
                  <MoreHorizRounded sx={{ mx: 1 }} aria-label={t('Weitere Ordner')} />
                  <ChevronRightRounded fontSize="small" />
                </Box>
              );
            }
            const last = crumb.id === current?.id;
            const position = crumbs.indexOf(crumb);
            return (
              <Box component="li" key={crumb.id} sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <ButtonBase
                  component="a"
                  href={hrefOf(crumb.id)}
                  nativeButton={false}
                  aria-current={last ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!last) onNavigate(crumb.id);
                  }}
                  {...drop(crumb)}
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    borderRadius: `${radius.full}px`,
                    minWidth: 0,
                    fontSize: last ? '1.375rem' : '1rem',
                    fontWeight: last ? 700 : 500,
                    color: last ? c.onSurface : c.onSurfaceVariant,
                    bgcolor: over === crumb.id ? c.primaryContainer : 'transparent',
                    outline: over === crumb.id ? `2px solid ${c.primary}` : 'none',
                    '&:hover': { bgcolor: last ? 'transparent' : mix(c.onSurface, 8) },
                    cursor: last ? 'default' : 'pointer',
                  }}
                >
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                    {label(crumb, position)}
                  </Box>
                </ButtonBase>
                {!last && <ChevronRightRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} aria-hidden />}
              </Box>
            );
          })}
        </Box>
      </Box>
      {actions}
    </Box>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
      <Typography variant="h5" component="h1" noWrap sx={{ flex: 1, minWidth: 0, pl: 1, fontSize: { md: '1.375rem' } }}>
        {children}
      </Typography>
      {actions}
    </Box>
  );
}

export function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  return (
    <m.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} style={{ flex: 1, minWidth: 0 }}>
      <Box
        role="toolbar"
        aria-label={t('Auswahl')}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          minHeight: 48,
          pl: 0.5,
          pr: 1,
          borderRadius: `${radius.full}px`,
          bgcolor: c.secondaryContainer,
          color: c.onSecondaryContainer,
          '& .MuiIconButton-root': { color: 'inherit' },
        }}
      >
        <Tooltip title={t('Auswahl aufheben')}>
          <IconButton aria-label={t('Auswahl aufheben')} onClick={onClear}>
            <CloseRounded />
          </IconButton>
        </Tooltip>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap aria-live="polite">
          {tn(count, '{count} ausgewählt', '{count} ausgewählt')}
        </Typography>
        {children}
      </Box>
    </m.div>
  );
}

export function useNewMenu({
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
  onNewText,
  onImport,
  disabled,
}: {
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onNewFolder: () => void;
  onNewText: () => void;
  onImport?: () => void;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const item = (icon: ReactNode, label: string, action: () => void) => (
    <MenuItem
      onClick={() => {
        close();
        action();
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  );
  const menu = (
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
      {item(<UploadFileRounded />, t('Dateien hochladen'), onUploadFiles)}
      {item(<DriveFolderUploadRounded />, t('Ordner hochladen'), onUploadFolder)}
      <Divider sx={{ my: 0.5 }} />
      {item(<CreateNewFolderRounded />, t('Neuer Ordner'), onNewFolder)}
      {item(<NoteAddRounded />, t('Neue Textdatei'), onNewText)}
      {onImport && item(<CloudDownloadRounded />, t('Aus dem Internet laden'), onImport)}
    </Menu>
  );
  return {
    rail: (
      <>
        <Tooltip title={t('Neu')} placement="right">
          <span>
            <Fab aria-label={t('Neu')} aria-haspopup="menu" disabled={disabled} onClick={(event) => setAnchor(event.currentTarget)}>
              <AddRounded />
            </Fab>
          </span>
        </Tooltip>
        {menu}
      </>
    ),
    mobile: (
      <Fab variant="extended" disabled={disabled} aria-haspopup="menu" onClick={(event) => setAnchor(event.currentTarget)}>
        <AddRounded />
        {t('Neu')}
      </Fab>
    ),
  };
}

export function UploadPanel({ uploader }: { uploader: Uploader }) {
  const items = useUploads(uploader);
  const [open, setOpen] = useState(true);
  const visible = items.filter((item) => item.status !== 'cancelled' || items.length < 50);
  const running = items.filter((item) => ['queued', 'uploading', 'processing'].includes(item.status));
  const failed = items.filter((item) => item.status === 'error');
  const done = items.filter((item) => item.status === 'done');
  const total = items.reduce((sum, item) => sum + (item.status === 'cancelled' ? 0 : item.size), 0);
  const loaded = items.reduce((sum, item) => sum + (item.status === 'cancelled' ? 0 : item.status === 'done' ? item.size : item.loaded), 0);
  const percent = total ? Math.round((loaded / total) * 100) : 100;
  const title = running.length
    ? t('{done} von {total} hochgeladen', { done: done.length, total: items.filter((item) => item.status !== 'cancelled').length })
    : failed.length
      ? tn(failed.length, '{count} Upload fehlgeschlagen', '{count} Uploads fehlgeschlagen')
      : tn(done.length, '{count} Datei hochgeladen', '{count} Dateien hochgeladen');
  return (
    <AnimatePresence>
      {items.length > 0 && (
        <m.div
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 48, transition: { duration: 0.2 } }}
          transition={{ duration: 0.42 }}
          style={{ position: 'fixed', zIndex: 1300, right: 16, bottom: 0, pointerEvents: 'none' }}
        >
          <Box
            role="region"
            aria-label={t('Uploads')}
            sx={{
              pointerEvents: 'auto',
              width: { xs: 'calc(100vw - 32px)', sm: 380 },
              mb: { xs: 'calc(96px + env(safe-area-inset-bottom) + var(--moe-player, 0px))', md: 'calc(16px + var(--moe-player, 0px))' },
              bgcolor: c.surfaceContainerHigh,
              borderRadius: `${radius.lg}px`,
              boxShadow: elevation[3],
              overflow: 'hidden',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap aria-live="polite">
                  {title}
                </Typography>
                {running.length > 0 && (
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {percent} % · {formatBytes(loaded)} / {formatBytes(total)}
                  </Typography>
                )}
              </Box>
              <IconButton
                size="small"
                aria-label={open ? t('Einklappen') : t('Ausklappen')}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? <ExpandMoreRounded /> : <ExpandLessRounded />}
              </IconButton>
              <Tooltip title={running.length ? t('Alle abbrechen') : t('Schließen')}>
                <IconButton
                  size="small"
                  aria-label={running.length ? t('Alle abbrechen') : t('Schließen')}
                  onClick={() => (running.length ? uploader.cancelAll() : uploader.clear())}
                >
                  <CloseRounded />
                </IconButton>
              </Tooltip>
            </Box>
            {running.length > 0 && <LinearProgress variant="determinate" value={percent} sx={{ mx: 2, mb: 1 }} />}
            {open && (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pb: 1, maxHeight: 280, overflowY: 'auto' }}>
                {visible.map((item) => (
                  <Box component="li" key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.75 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={item.relativePath ? `${item.relativePath}/${item.name}` : item.name}>
                        {item.name}
                      </Typography>
                      {item.status === 'uploading' || item.status === 'processing' ? (
                        <LinearProgress
                          variant={item.status === 'processing' ? 'indeterminate' : 'determinate'}
                          value={item.size ? (item.loaded / item.size) * 100 : 100}
                          sx={{ mt: 0.75 }}
                          aria-label={t('Fortschritt von {name}', { name: item.name })}
                        />
                      ) : (
                        <Typography
                          variant="caption"
                          sx={{ color: item.status === 'error' ? c.error : c.onSurfaceVariant }}
                          noWrap
                          component="p"
                        >
                          {item.status === 'error'
                            ? item.error
                            : item.status === 'cancelled'
                              ? t('Abgebrochen')
                              : item.status === 'queued'
                                ? t('Wartet')
                                : formatBytes(item.size)}
                        </Typography>
                      )}
                    </Box>
                    {item.status === 'done' && <CheckCircleRounded sx={{ color: c.success }} aria-label={t('Fertig')} />}
                    {item.status === 'error' && <ErrorRounded sx={{ color: c.error }} aria-hidden />}
                    {(item.status === 'error' || item.status === 'cancelled') && (
                      <Tooltip title={t('Nochmal versuchen')}>
                        <IconButton size="small" aria-label={t('Nochmal versuchen')} onClick={() => uploader.retry(item.key)}>
                          <ReplayRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['queued', 'uploading'].includes(item.status) && (
                      <Tooltip title={t('Abbrechen')}>
                        <IconButton
                          size="small"
                          aria-label={t('{name} abbrechen', { name: item.name })}
                          onClick={() => uploader.cancel(item.key)}
                        >
                          <CloseRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function DropOverlay({ active, label }: { active: boolean; label: string }) {
  return (
    <AnimatePresence>
      {active && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 8,
              borderRadius: `${radius.lg}px`,
              border: `2px dashed ${c.primary}`,
              bgcolor: mix(c.primaryContainer, 72),
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <m.div
              initial={{ scale: 0.94, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 16 }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1.5,
                  color: c.onPrimaryContainer,
                  textAlign: 'center',
                  px: 3,
                }}
              >
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: c.primary,
                    color: c.onPrimary,
                  }}
                >
                  <UploadFileRounded sx={{ fontSize: 36 }} />
                </Box>
                <Typography variant="h6">{label}</Typography>
              </Box>
            </m.div>
          </Box>
        </m.div>
      )}
    </AnimatePresence>
  );
}
