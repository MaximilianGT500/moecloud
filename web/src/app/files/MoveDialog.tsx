import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { compareNames } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { createFolder } from './actions';
import type { Item } from './kinds';
import type { Crumb } from './model';

export interface MoveRequest {
  items: Item[];
  mode: 'move' | 'copy';
}

export function MoveDialog({
  request,
  startId,
  onClose,
  onDone,
}: {
  request: MoveRequest | null;
  startId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const rootId = boot().user!.rootId;
  const [folder, setFolder] = useState(startId ?? rootId);
  const [data, setData] = useState<{ id: string; crumbs: Crumb[]; folders: Item[]; role: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!request) return;
    const abort = new AbortController();
    api
      .get<{ breadcrumbs: Crumb[]; items: Item[]; role: string }>(`/api/nodes/${folder}/children?folders=1`, abort.signal)
      .then((result) =>
        setData({
          id: folder,
          crumbs: result.breadcrumbs,
          folders: [...result.items].sort((a, b) => compareNames(a.name, b.name)),
          role: result.role,
        })
      )
      .catch((error: Error) => {
        if (error.name !== 'AbortError') {
          toast(errorText(error));
          setFolder(rootId);
        }
      });
    return () => abort.abort();
  }, [request, folder, revision, rootId]);

  const blocked = new Set(request?.items.map((item) => item.id) ?? []);
  const current = data?.id === folder ? data : null;
  const sameParent = request?.mode === 'move' && request.items.every((item) => item.parentId === folder);
  const canDrop = Boolean(current && current.role !== 'view' && !blocked.has(folder) && !sameParent);

  const submit = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await api.post(`/api/nodes/${request.mode}`, { ids: request.items.map((item) => item.id), target: folder });
      const name = current?.crumbs[current.crumbs.length - 1]?.name || t('Meine Dateien');
      toast(
        request.mode === 'move'
          ? tn(request.items.length, 'Nach „{target}“ verschoben', '{count} Elemente nach „{target}“ verschoben', { target: name })
          : tn(request.items.length, 'Nach „{target}“ kopiert', '{count} Elemente nach „{target}“ kopiert', { target: name })
      );
      onDone();
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const title = request?.mode === 'copy' ? t('Kopieren nach') : t('Verschieben nach');
  return (
    <Dialog open={Boolean(request)} onClose={onClose} fullWidth maxWidth="xs" fullScreen={small} aria-labelledby="move-title">
      <DialogTitle id="move-title">{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 360 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {request &&
            (request.items.length === 1 ? `„${request.items[0].name}“` : tn(request.items.length, '{count} Element', '{count} Elemente'))}
        </Typography>
        <Box
          component="nav"
          aria-label={t('Pfad')}
          sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25, minHeight: 40 }}
        >
          {current?.crumbs.map((crumb, index) => {
            const last = index === current.crumbs.length - 1;
            return (
              <Box key={crumb.id} sx={{ display: 'flex', alignItems: 'center' }}>
                <ButtonBase
                  onClick={() => setFolder(crumb.id)}
                  disabled={last}
                  sx={{
                    px: 1,
                    py: 0.5,
                    borderRadius: `${radius.full}px`,
                    fontWeight: last ? 700 : 500,
                    color: last ? c.onSurface : c.onSurfaceVariant,
                    '&:hover': { bgcolor: mix(c.onSurface, 8) },
                  }}
                >
                  {crumb.name || t('Meine Dateien')}
                </ButtonBase>
                {!last && <ChevronRightRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} />}
              </Box>
            );
          })}
        </Box>
        {!current ? (
          <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
            <CircularProgress aria-label={t('Lädt')} />
          </Box>
        ) : current.folders.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, py: 4, textAlign: 'center' }}>
            {t('Hier gibt es keine Unterordner.')}
          </Typography>
        ) : (
          <List sx={{ mx: -1 }}>
            {current.folders.map((entry) => (
              <ListItemButton key={entry.id} disabled={blocked.has(entry.id)} onClick={() => setFolder(entry.id)}>
                <ListItemIcon sx={{ mr: 2 }}>
                  <FolderRounded sx={{ color: c.primary }} />
                </ListItemIcon>
                <ListItemText primary={entry.name} slotProps={{ primary: { noWrap: true } }} />
                <ChevronRightRounded sx={{ color: c.onSurfaceVariant }} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button
          startIcon={<CreateNewFolderRounded />}
          disabled={!current || current.role === 'view'}
          onClick={async () => {
            const created = await createFolder(folder);
            if (created) setRevision(revision + 1);
          }}
          sx={{ mr: 'auto' }}
        >
          {t('Neuer Ordner')}
        </Button>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={!canDrop || busy} onClick={() => void submit()}>
          {request?.mode === 'copy' ? t('Hierher kopieren') : t('Hierher verschieben')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
