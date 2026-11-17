import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../lib/api';
import { splitExtension } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { attempt } from './actions';
import { FileIcon, type Item } from './kinds';

interface Templates {
  folder: { id: string; name: string } | null;
  items: Item[];
}

export function TemplateDialog({ parentId, onClose, onDone }: { parentId: string; onClose: () => void; onDone: (node: Item) => void }) {
  const [data, setData] = useState<Templates | null>(null);
  const [chosen, setChosen] = useState<Item | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Templates>('/api/templates', abort.signal)
      .then(setData)
      .catch(() => setData({ folder: null, items: [] }));
    return () => abort.abort();
  }, []);

  const create = async () => {
    if (!chosen) return;
    setBusy(true);
    const result = await attempt(() =>
      api.post<{ node: Item }>(`/api/nodes/${parentId}/from-template`, { templateId: chosen.id, name: name.trim() })
    );
    setBusy(false);
    if (!result) return;
    toast(t('„{name}“ ist angelegt', { name: result.node.name }));
    onDone(result.node);
    onClose();
  };

  const forget = async () => {
    setBusy(true);
    const result = await attempt(() => api.put<Templates>('/api/templates', { folderId: null }));
    setBusy(false);
    if (result) setData(result);
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <DialogTitle>{t('Neu aus Vorlage')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!data ? (
            <CircularProgress size={24} aria-label={t('Lädt')} sx={{ alignSelf: 'center', my: 2 }} />
          ) : !data.folder ? (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t(
                'Du hast noch keinen Vorlagenordner. Öffne das Menü eines Ordners und wähle „Als Vorlagenordner verwenden“. Jede Datei darin erscheint dann hier.'
              )}
            </Typography>
          ) : data.items.length === 0 ? (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t(
                'In „{name}“ liegt noch keine Datei. Leg dort ab, was du immer wieder brauchst, etwa einen Briefkopf oder ein Protokoll.',
                {
                  name: data.folder.name,
                }
              )}
            </Typography>
          ) : (
            <>
              <Box
                role="listbox"
                aria-label={t('Vorlagen')}
                sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 280, overflowY: 'auto' }}
              >
                {data.items.map((item) => (
                  <ButtonBase
                    key={item.id}
                    role="option"
                    aria-selected={chosen?.id === item.id}
                    onClick={() => {
                      setChosen(item);
                      setName(splitExtension(item.name)[0]);
                    }}
                    sx={{
                      justifyContent: 'flex-start',
                      gap: 1.25,
                      px: 1.5,
                      py: 1,
                      borderRadius: `${radius.md}px`,
                      textAlign: 'left',
                      bgcolor: chosen?.id === item.id ? c.secondaryContainer : c.surfaceContainerHigh,
                      color: chosen?.id === item.id ? c.onSecondaryContainer : c.onSurface,
                    }}
                  >
                    <FileIcon item={item} size={22} />
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {item.name}
                    </Typography>
                  </ButtonBase>
                ))}
              </Box>
              {chosen && (
                <TextField
                  label={t('Name der neuen Datei')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              )}
            </>
          )}
          {data?.folder && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('Vorlagen kommen aus dem Ordner „{name}“.', { name: data.folder.name })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          {data?.folder && (
            <Button onClick={() => void forget()} disabled={busy} sx={{ mr: 'auto' }}>
              {t('Ordner nicht mehr verwenden')}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {data?.items.length ? t('Abbrechen') : t('Schließen')}
          </Button>
          {Boolean(data?.items.length) && (
            <Button type="submit" variant="contained" disabled={busy || !chosen || !name.trim()}>
              {t('Erstellen')}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
