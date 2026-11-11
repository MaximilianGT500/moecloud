import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import { api } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, folderColor, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm, pickColor, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { attempt } from './actions';
import { FOLDER_COLOR_OPTIONS, type Item } from './kinds';

export interface Tag {
  id: string;
  name: string;
  color: string;
  count: number;
}

let cache: Tag[] | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadTags() {
  pending ??= api
    .get<{ items: Tag[] }>('/api/tags')
    .then((data) => {
      cache = data.items;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useTags() {
  return useSyncExternalStore(subscribe, () => cache) ?? [];
}

export function useTagSync() {
  useEffect(() => {
    if (!cache) void loadTags();
  }, []);
  useLive((event) => {
    if (event === 'tags' || event === 'reconnect') void loadTags();
  });
}

const colorOptions = () =>
  FOLDER_COLOR_OPTIONS.map((option) => ({ key: option.key, label: t(option.label), color: folderColor(option.key) }));

function useTagMap() {
  const tags = useTags();
  return useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
}

export function TagDots({ ids, size = 8 }: { ids?: string[]; size?: number }) {
  const map = useTagMap();
  const tags = (ids ?? []).map((id) => map.get(id)).filter((tag): tag is Tag => Boolean(tag));
  if (tags.length === 0) return null;
  const names = tags.map((tag) => tag.name).join(', ');
  return (
    <Box
      component="span"
      role="img"
      aria-label={t('Schlagwörter: {names}', { names })}
      title={names}
      sx={{ display: 'inline-flex', alignItems: 'center', flex: 'none', pl: 0.75 }}
    >
      {tags.slice(0, 4).map((tag) => (
        <Box
          key={tag.id}
          component="span"
          sx={{ width: size, height: size, borderRadius: '50%', bgcolor: folderColor(tag.color), ml: '3px' }}
        />
      ))}
    </Box>
  );
}

export function TagChips({ ids, onEdit }: { ids?: string[]; onEdit?: () => void }) {
  const map = useTagMap();
  const tags = (ids ?? []).map((id) => map.get(id)).filter((tag): tag is Tag => Boolean(tag));
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
      {tags.map((tag) => (
        <Chip
          key={tag.id}
          size="small"
          label={tag.name}
          onClick={() => navigate(`/files/tags/${tag.id}`)}
          icon={
            <Box
              component="span"
              sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: folderColor(tag.color), ml: '8px !important' }}
            />
          }
          variant="outlined"
        />
      ))}
      {onEdit && (
        <Chip
          size="small"
          variant="outlined"
          icon={tags.length ? <SellRounded /> : <AddRounded />}
          label={tags.length ? t('Ändern') : t('Schlagwort hinzufügen')}
          onClick={onEdit}
        />
      )}
    </Box>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Box role="radiogroup" aria-label={t('Farbe')} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {colorOptions().map((option) => {
        const active = option.key === value;
        return (
          <ButtonBase
            key={option.key}
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.key)}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: option.color,
              outline: active ? `2px solid ${c.onSurface}` : 'none',
              outlineOffset: 2,
            }}
          />
        );
      })}
    </Box>
  );
}

type State = 'all' | 'some' | 'none';

export function TagDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const tags = useTags();
  const initial = useMemo(() => {
    const states = new Map<string, State>();
    for (const tag of tags) {
      const count = items.filter((item) => item.tags?.includes(tag.id)).length;
      states.set(tag.id, count === 0 ? 'none' : count === items.length ? 'all' : 'some');
    }
    return states;
  }, [tags, items]);
  const [changes, setChanges] = useState<Map<string, 'all' | 'none'>>(new Map());
  const [created, setCreated] = useState<{ name: string; color: string }[]>([]);
  const [filter, setFilter] = useState('');
  const [color, setColor] = useState(FOLDER_COLOR_OPTIONS[(tags.length * 3) % FOLDER_COLOR_OPTIONS.length].key);
  const [busy, setBusy] = useState(false);
  const query = filter.trim().toLocaleLowerCase();
  const shown = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query));
  const known = [...tags.map((tag) => tag.name), ...created.map((tag) => tag.name)].some((name) => name.toLocaleLowerCase() === query);
  const stateOf = (tag: Tag) => changes.get(tag.id) ?? initial.get(tag.id) ?? 'none';

  const toggle = (tag: Tag) => {
    const next = new Map(changes);
    next.set(tag.id, stateOf(tag) === 'all' ? 'none' : 'all');
    setChanges(next);
  };

  const add = () => {
    const name = filter.trim();
    if (!name || known) return;
    setCreated([...created, { name, color }]);
    setFilter('');
    setColor(FOLDER_COLOR_OPTIONS[((tags.length + created.length + 1) * 3) % FOLDER_COLOR_OPTIONS.length].key);
  };

  const save = async () => {
    setBusy(true);
    const fresh: string[] = [];
    for (const entry of created) {
      const done = await attempt(() => api.post<{ tag: Tag }>('/api/tags', entry));
      if (!done) {
        setBusy(false);
        return;
      }
      fresh.push(done.tag.id);
    }
    const add = [...fresh, ...[...changes].filter(([id, state]) => state === 'all' && initial.get(id) !== 'all').map(([id]) => id)];
    const remove = [...changes].filter(([id, state]) => state === 'none' && initial.get(id) !== 'none').map(([id]) => id);
    if (add.length || remove.length) {
      const done = await attempt(() => api.put('/api/nodes/tags', { ids: items.map((item) => item.id), add, remove }));
      if (done === undefined) {
        setBusy(false);
        return;
      }
    }
    await loadTags();
    setBusy(false);
    onDone();
    onClose();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {items.length === 1
          ? t('Schlagwörter für „{name}“', { name: items[0].name })
          : t('Schlagwörter für {count} Elemente', { count: items.length })}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <TextField
            autoFocus
            fullWidth
            size="small"
            margin="dense"
            label={t('Suchen oder neu anlegen')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            slotProps={{
              htmlInput: { maxLength: 40 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </form>
        {query && !known && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              p: 1.5,
              borderRadius: `${radius.md}px`,
              bgcolor: c.surfaceContainerHigh,
            }}
          >
            <Swatches value={color} onChange={setColor} />
            <Button variant="tonal" startIcon={<AddRounded />} onClick={add} sx={{ alignSelf: 'flex-start' }}>
              {t('„{name}“ anlegen', { name: filter.trim() })}
            </Button>
          </Box>
        )}
        <Box
          role="group"
          aria-label={t('Schlagwörter')}
          sx={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto', mx: -1 }}
        >
          {created.map((entry) => (
            <Box key={entry.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
              <Checkbox checked disabled />
              <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: folderColor(entry.color), flex: 'none' }} />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {entry.name}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant, pr: 1 }}>
                {t('Neu')}
              </Typography>
            </Box>
          ))}
          {shown.map((tag) => {
            const state = stateOf(tag);
            return (
              <Box
                key={tag.id}
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  borderRadius: `${radius.sm}px`,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: c.surfaceContainerHigh },
                }}
              >
                <Checkbox checked={state === 'all'} indeterminate={state === 'some'} onChange={() => toggle(tag)} />
                <Box component="span" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: folderColor(tag.color), flex: 'none' }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {tag.name}
                </Typography>
              </Box>
            );
          })}
          {tags.length === 0 && created.length === 0 && !query && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 1, py: 2 }}>
              {t('Noch keine Schlagwörter. Gib oben einen Namen ein, um eins anzulegen.')}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy}>
          {t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

async function renameTag(tag: Tag) {
  const name = await prompt({ title: t('Schlagwort umbenennen'), label: t('Name'), value: tag.name, confirm: t('Umbenennen') });
  if (!name || name === tag.name) return;
  if (await attempt(() => api.patch(`/api/tags/${tag.id}`, { name }))) await loadTags();
}

async function recolorTag(tag: Tag) {
  const color = await pickColor({
    title: t('Farbe für „{name}“', { name: tag.name }),
    value: tag.color,
    options: colorOptions(),
    required: true,
  });
  if (!color || color === tag.color) return;
  if (await attempt(() => api.patch(`/api/tags/${tag.id}`, { color }))) await loadTags();
}

async function removeTag(tag: Tag, after?: () => void) {
  const ok = await confirm({
    title: t('„{name}“ löschen?', { name: tag.name }),
    text: t('Das Schlagwort verschwindet von allen Dateien und Ordnern. Die Dateien selbst bleiben.'),
    confirm: t('Löschen'),
    danger: true,
  });
  if (!ok) return;
  if ((await attempt(() => api.delete(`/api/tags/${tag.id}`))) === undefined) return;
  await loadTags();
  toast(t('Schlagwort gelöscht'));
  after?.();
}

export async function createTag() {
  const name = await prompt({ title: t('Neues Schlagwort'), label: t('Name'), value: '', confirm: t('Weiter') });
  if (!name) return;
  const color = await pickColor({ title: t('Farbe für „{name}“', { name }), value: null, options: colorOptions(), required: true });
  if (!color) return;
  if (await attempt(() => api.post('/api/tags', { name, color }))) await loadTags();
}

export function TagMenu({ tag, onDeleted }: { tag: Tag; onDeleted?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entries: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] = [
    { label: t('Umbenennen'), icon: <DriveFileRenameOutlineRounded />, run: () => void renameTag(tag) },
    { label: t('Farbe'), icon: <PaletteRounded />, run: () => void recolorTag(tag) },
    { label: t('Löschen'), icon: <DeleteOutlineRounded />, run: () => void removeTag(tag, onDeleted), danger: true },
  ];
  return (
    <>
      <IconButton aria-label={t('Aktionen für {name}', { name: tag.name })} onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertRounded />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {entries.map((entry) => (
          <MenuItem
            key={entry.label}
            onClick={() => {
              setAnchor(null);
              entry.run();
            }}
            sx={entry.danger ? { color: c.error } : undefined}
          >
            <ListItemIcon sx={entry.danger ? { color: c.error } : undefined}>{entry.icon}</ListItemIcon>
            <ListItemText>{entry.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function TagsView() {
  const tags = useTags();
  if (tags.length === 0) {
    return (
      <EmptyState
        icon={<SellRounded />}
        title={t('Noch keine Schlagwörter')}
        text={t('Gib Dateien und Ordnern Schlagwörter über das Menü oder die Details. Sie sind nur für dich sichtbar.')}
        action={
          <Button variant="tonal" startIcon={<AddRounded />} onClick={() => void createTag()}>
            {t('Neues Schlagwort')}
          </Button>
        }
      />
    );
  }
  return (
    <Box sx={{ px: { xs: 1.5, md: 2 }, pb: 4 }}>
      <Box
        component="ul"
        aria-label={t('Schlagwörter')}
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
      >
        {tags.map((tag) => (
          <Box
            component="li"
            key={tag.id}
            sx={{ display: 'flex', alignItems: 'center', borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer, pr: 0.5 }}
          >
            <ButtonBase
              onClick={() => navigate(`/files/tags/${tag.id}`)}
              sx={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'flex-start',
                gap: 1.5,
                px: 2,
                py: 1.5,
                borderRadius: `${radius.md}px`,
                textAlign: 'left',
              }}
            >
              <Box component="span" sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: folderColor(tag.color), flex: 'none' }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {tag.name}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {tn(tag.count, '{count} Element', '{count} Elemente')}
                </Typography>
              </Box>
            </ButtonBase>
            <TagMenu tag={tag} />
          </Box>
        ))}
      </Box>
      <Button startIcon={<AddRounded />} onClick={() => void createTag()} sx={{ mt: 2 }}>
        {t('Neues Schlagwort')}
      </Button>
    </Box>
  );
}
