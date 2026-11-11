import { useEffect, useState, type DragEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
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
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import CallSplitRounded from '@mui/icons-material/CallSplitRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import RotateLeftRounded from '@mui/icons-material/RotateLeftRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import { api, errorText } from '../../lib/api';
import { splitExtension } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import { attempt, savedToast } from './actions';
import type { Item } from './kinds';
import { canEdit } from './model';

interface Page {
  key: number;
  page: number;
  rotate: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  rotation: number;
}

const isPdf = (item: Item) => item.type === 'file' && item.mime === 'application/pdf' && !item.infected;
export const canMergePdfs = (items: Item[]) => items.length >= 2 && items.length <= 50 && items.every(isPdf);
export const canOrganizePdf = (item: Item) => isPdf(item);

const baseName = (name: string) => splitExtension(name)[0];
const turn = (value: number, step: number) => (((value + step) % 360) + 360) % 360;

export function PdfMergeDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: (node: Item) => void }) {
  const [order, setOrder] = useState(items);
  const [name, setName] = useState(t('{name} (zusammengefügt)', { name: baseName(items[0].name) }));
  const [busy, setBusy] = useState(false);
  const move = (index: number, step: number) => {
    const next = [...order];
    const [entry] = next.splice(index, 1);
    next.splice(index + step, 0, entry);
    setOrder(next);
  };
  const submit = async () => {
    setBusy(true);
    const result = await attempt(() => api.post<{ node: Item }>('/api/pdf/merge', { ids: order.map((item) => item.id), name }));
    setBusy(false);
    if (!result) return;
    savedToast(result.node);
    onDone(result.node);
    onClose();
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogTitle>{t('PDFs zusammenfügen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Die Seiten kommen in dieser Reihenfolge in die neue PDF.')}
          </Typography>
          <Box
            component="ol"
            aria-label={t('Reihenfolge')}
            sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            {order.map((item, index) => (
              <Box
                component="li"
                key={item.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pl: 1.5,
                  pr: 0.5,
                  py: 0.25,
                  borderRadius: `${radius.md}px`,
                  bgcolor: c.surfaceContainerHigh,
                }}
              >
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, width: 20 }}>
                  {index + 1}
                </Typography>
                <PictureAsPdfRounded sx={{ color: c.error }} fontSize="small" />
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {item.name}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={t('{name} nach oben', { name: item.name })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpwardRounded fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={t('{name} nach unten', { name: item.name })}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownwardRounded fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
          <TextField
            label={t('Name der neuen PDF')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !name.trim()}>
            {t('Zusammenfügen')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function PageTile({
  item,
  entry,
  index,
  selected,
  dragged,
  onToggle,
  onTurn,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  item: Item;
  entry: Page;
  index: number;
  selected: boolean;
  dragged: boolean;
  onToggle: () => void;
  onTurn: (step: number) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const [failed, setFailed] = useState(false);
  const shownRotation = turn(entry.rotation, entry.rotate);
  const sideways = shownRotation === 90 || shownRotation === 270;
  return (
    <Box
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      role="listitem"
      aria-label={t('Seite {count}', { count: entry.page })}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        p: 1,
        borderRadius: `${radius.md}px`,
        bgcolor: selected ? c.secondaryContainer : c.surfaceContainer,
        outline: selected ? `2px solid ${c.primary}` : 'none',
        opacity: dragged ? 0.4 : 1,
        cursor: 'grab',
      }}
    >
      <ButtonBase
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={t('Seite {count} auswählen', { count: entry.page })}
        sx={{
          aspectRatio: '3 / 4',
          borderRadius: `${radius.sm}px`,
          bgcolor: c.surfaceContainerHighest,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {failed ? (
          <Typography variant="h5" sx={{ color: c.onSurfaceVariant, transform: `rotate(${entry.rotate}deg)` }}>
            {entry.page}
          </Typography>
        ) : (
          <Box
            component="img"
            alt=""
            loading="lazy"
            draggable={false}
            src={`/api/nodes/${item.id}/pdf/${entry.page}?size=360&v=${item.version}`}
            onError={() => setFailed(true)}
            sx={{
              maxWidth: sideways ? '75%' : '100%',
              maxHeight: sideways ? '75%' : '100%',
              objectFit: 'contain',
              transform: `rotate(${entry.rotate}deg)`,
              transition: 'transform 180ms',
              boxShadow: '0 1px 4px rgb(0 0 0 / 0.3)',
              bgcolor: '#fff',
            }}
          />
        )}
      </ButtonBase>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Checkbox
          size="small"
          checked={selected}
          onChange={onToggle}
          slotProps={{ input: { 'aria-label': t('Seite {count} auswählen', { count: entry.page }) } }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" component="div" noWrap sx={{ color: c.onSurfaceVariant, lineHeight: 1.3 }}>
            {t('Seite {count}', { count: index + 1 })}
          </Typography>
          {index + 1 !== entry.page && (
            <Typography variant="caption" component="div" noWrap sx={{ color: c.primary, lineHeight: 1.3 }}>
              {t('War Seite {count}', { count: entry.page })}
            </Typography>
          )}
        </Box>
        <IconButton size="small" aria-label={t('Seite {count} drehen', { count: entry.page })} onClick={() => onTurn(90)}>
          <RotateRightRounded fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

export function PdfPagesDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: (node: Item) => void }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [original, setOriginal] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState<number | null>(null);
  const [save, setSave] = useState<'copy' | 'version'>('copy');
  const [name, setName] = useState(t('{name} (bearbeitet)', { name: baseName(item.name) }));
  const [busy, setBusy] = useState(false);
  const versionable = canEdit(item) && !item.grantId && !item.viaGroup;

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ pages: { width: number; height: number; rotation: number }[] }>(`/api/nodes/${item.id}/pdf`, abort.signal)
      .then((data) => {
        const list = data.pages.map((page, index) => ({ ...page, key: index + 1, page: index + 1, rotate: 0 as const }));
        setPages(list);
        setOriginal(list);
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [item]);

  const list = pages ?? [];
  const chosen = list.filter((entry) => selected.has(entry.key));
  const changed =
    JSON.stringify(list.map((entry) => [entry.page, entry.rotate])) !== JSON.stringify(original.map((entry) => [entry.page, entry.rotate]));

  const update = (fn: (entry: Page) => Page, only?: Set<number>) =>
    setPages(list.map((entry) => (!only || only.has(entry.key) ? fn(entry) : entry)));

  const shift = (step: -1 | 1) => {
    const next = [...list];
    const indexes = next.map((_entry, index) => index);
    for (const index of step < 0 ? indexes : indexes.reverse()) {
      const other = index + step;
      if (other < 0 || other >= next.length) continue;
      if (selected.has(next[index].key) && !selected.has(next[other].key)) [next[index], next[other]] = [next[other], next[index]];
    }
    setPages(next);
  };
  const canShift = (step: -1 | 1) =>
    list.some((entry, index) => {
      const other = list[index + step];
      return selected.has(entry.key) && other && !selected.has(other.key);
    });

  const toggle = (key: number) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const run = async (choice: Page[], mode: 'copy' | 'version', target: string) => {
    setBusy(true);
    try {
      const result = await api.post<{ node: Item }>(`/api/nodes/${item.id}/pdf`, {
        pages: choice.map((entry) => ({ page: entry.page, rotate: entry.rotate })),
        save: mode,
        name: target,
      });
      if (mode === 'version') toast(t('Neue Version gespeichert'));
      else savedToast(result.node);
      onDone(result.node);
      onClose();
    } catch (reason) {
      toast(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const extract = () =>
    void run(
      chosen,
      'copy',
      t('{name} (Seiten {pages})', { name: baseName(item.name), pages: chosen.map((entry) => entry.page).join(', ') }).slice(0, 200)
    );

  return (
    <Dialog open fullScreen onClose={busy ? undefined : onClose} aria-labelledby="pdf-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: c.surfaceContainerLowest }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            py: 1,
            borderBottom: `1px solid ${c.outlineVariant}`,
            flexWrap: 'wrap',
          }}
        >
          <IconButton aria-label={t('Schließen')} onClick={onClose} disabled={busy}>
            <CloseRounded />
          </IconButton>
          <Typography id="pdf-title" variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 120, fontWeight: 700 }}>
            {t('Seiten von „{name}“', { name: item.name })}
          </Typography>
          {chosen.length > 0 && (
            <Box
              role="toolbar"
              aria-label={t('Auswahl')}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 0, md: 0.5 },
                order: { xs: 3, md: 0 },
                width: { xs: '100%', md: 'auto' },
              }}
            >
              <Typography variant="body2" noWrap sx={{ px: 1, flex: { xs: 1, md: 'none' } }}>
                {tn(chosen.length, '{count} ausgewählt', '{count} ausgewählt')}
              </Typography>
              <Tooltip title={t('Nach links drehen')}>
                <IconButton
                  aria-label={t('Nach links drehen')}
                  onClick={() => update((entry) => ({ ...entry, rotate: turn(entry.rotate, 270) as Page['rotate'] }), selected)}
                >
                  <RotateLeftRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Nach rechts drehen')}>
                <IconButton
                  aria-label={t('Nach rechts drehen')}
                  onClick={() => update((entry) => ({ ...entry, rotate: turn(entry.rotate, 90) as Page['rotate'] }), selected)}
                >
                  <RotateRightRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Nach vorne schieben')}>
                <span>
                  <IconButton aria-label={t('Nach vorne schieben')} disabled={!canShift(-1)} onClick={() => shift(-1)}>
                    <ArrowBackRounded />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('Nach hinten schieben')}>
                <span>
                  <IconButton aria-label={t('Nach hinten schieben')} disabled={!canShift(1)} onClick={() => shift(1)}>
                    <ArrowForwardRounded />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('Als neue PDF speichern')}>
                <span>
                  <IconButton aria-label={t('Als neue PDF speichern')} onClick={extract} disabled={busy}>
                    <CallSplitRounded />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('Seiten entfernen')}>
                <span>
                  <IconButton
                    aria-label={t('Seiten entfernen')}
                    disabled={chosen.length === list.length}
                    onClick={() => {
                      setPages(list.filter((entry) => !selected.has(entry.key)));
                      setSelected(new Set());
                    }}
                  >
                    <DeleteOutlineRounded />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}
          <Tooltip title={t('Zurücksetzen')}>
            <IconButton
              sx={{ order: { xs: 2, md: 0 } }}
              aria-label={t('Zurücksetzen')}
              onClick={() => {
                setPages(original);
                setSelected(new Set());
              }}
            >
              <RestartAltRounded />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 1.5, md: 3 } }}>
          {error ? (
            <Typography sx={{ color: c.error }}>{error}</Typography>
          ) : !pages ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress aria-label={t('Lädt')} />
            </Box>
          ) : (
            <Box
              role="list"
              aria-label={t('Seiten')}
              sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
            >
              {list.map((entry, index) => (
                <PageTile
                  key={entry.key}
                  item={item}
                  entry={entry}
                  index={index}
                  selected={selected.has(entry.key)}
                  dragged={dragging === index}
                  onToggle={() => toggle(entry.key)}
                  onTurn={(step) =>
                    update((current) => ({ ...current, rotate: turn(current.rotate, step) as Page['rotate'] }), new Set([entry.key]))
                  }
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(index);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging === null || dragging === index) return;
                    const next = [...list];
                    const [moved] = next.splice(dragging, 1);
                    next.splice(index, 0, moved);
                    setPages(next);
                    setDragging(null);
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
            px: 2,
            py: 1.5,
            borderTop: `1px solid ${c.outlineVariant}`,
            bgcolor: c.surfaceContainerLow,
          }}
        >
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
          {(!versionable || save === 'copy') && (
            <TextField
              size="small"
              label={t('Name der neuen PDF')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          )}
          <Box sx={{ flex: versionable && save === 'version' ? 1 : 'none' }} />
          <Button
            variant="contained"
            disabled={busy || !pages || !changed || (save === 'copy' && !name.trim())}
            onClick={() => void run(list, versionable ? save : 'copy', name)}
          >
            {busy ? <CircularProgress size={20} aria-label={t('Speichert')} /> : t('Speichern')}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
