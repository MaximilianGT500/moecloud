import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import { api, errorText } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import type { Item } from './kinds';

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other';
type Format = 'pdf' | 'jpeg' | 'png' | 'webp' | 'avif';

type Action =
  | { type: 'tag'; tagId: string }
  | { type: 'move'; folderId: string; by: 'none' | 'year' | 'month'; folderName?: string }
  | { type: 'rename'; pattern: string }
  | { type: 'star' }
  | { type: 'notify' }
  | { type: 'convert'; format: Format }
  | { type: 'copy'; folderId: string; folderName?: string }
  | { type: 'album'; albumId: string; albumName?: string };

interface Automation {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  deep: boolean;
  conditions: { kinds: Kind[]; extensions: string[]; nameContains: string; minSize: number | null; maxSize: number | null };
  actions: Action[];
  enabled: boolean;
  runs: number;
  runAt: number | null;
  error: string | null;
}

interface Draft {
  id: string | null;
  name: string;
  deep: boolean;
  kinds: Kind[];
  extensions: string;
  nameContains: string;
  tagId: string;
  pattern: string;
  convert: Format | '';
  folderId: string;
  by: 'none' | 'year' | 'month';
  copyTo: string;
  albumId: string;
  star: boolean;
  notify: boolean;
}

interface Tag {
  id: string;
  name: string;
}

interface Target {
  id: string;
  label: string;
}

const KINDS: { value: Kind; label: string }[] = [
  { value: 'image', label: t('Bilder') },
  { value: 'video', label: t('Videos') },
  { value: 'audio', label: t('Musik') },
  { value: 'pdf', label: t('PDFs') },
  { value: 'document', label: t('Dokumente') },
  { value: 'archive', label: t('Archive') },
  { value: 'other', label: t('Sonstiges') },
];

const FORMATS: { value: Format; label: string }[] = [
  { value: 'pdf', label: t('PDF, für Office-Dokumente') },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
];

const EMPTY: Draft = {
  id: null,
  name: '',
  deep: false,
  kinds: [],
  extensions: '',
  nameContains: '',
  tagId: '',
  pattern: '',
  convert: '',
  folderId: '',
  by: 'none',
  copyTo: '',
  albumId: '',
  star: false,
  notify: false,
};

function draftOf(automation: Automation): Draft {
  const find = <T extends Action['type']>(type: T) =>
    automation.actions.find((action) => action.type === type) as Extract<Action, { type: T }> | undefined;
  const move = find('move');
  return {
    id: automation.id,
    name: automation.name,
    deep: automation.deep,
    kinds: automation.conditions.kinds,
    extensions: automation.conditions.extensions.join(', '),
    nameContains: automation.conditions.nameContains,
    tagId: find('tag')?.tagId ?? '',
    pattern: find('rename')?.pattern ?? '',
    convert: find('convert')?.format ?? '',
    folderId: move?.folderId ?? '',
    by: move?.by ?? 'none',
    copyTo: find('copy')?.folderId ?? '',
    albumId: find('album')?.albumId ?? '',
    star: Boolean(find('star')),
    notify: Boolean(find('notify')),
  };
}

function actionsOf(draft: Draft, folderId: string): Action[] {
  const actions: Action[] = [];
  if (draft.tagId) actions.push({ type: 'tag', tagId: draft.tagId });
  if (draft.pattern.trim()) actions.push({ type: 'rename', pattern: draft.pattern.trim() });
  if (draft.convert) actions.push({ type: 'convert', format: draft.convert });
  if (draft.copyTo) actions.push({ type: 'copy', folderId: draft.copyTo });
  if (draft.folderId || draft.by !== 'none') actions.push({ type: 'move', folderId: draft.folderId || folderId, by: draft.by });
  if (draft.albumId) actions.push({ type: 'album', albumId: draft.albumId });
  if (draft.star) actions.push({ type: 'star' });
  if (draft.notify) actions.push({ type: 'notify' });
  return actions;
}

function summary(automation: Automation, tags: Tag[]) {
  const when = [
    automation.conditions.kinds.length
      ? automation.conditions.kinds.map((kind) => KINDS.find((entry) => entry.value === kind)?.label ?? kind).join(', ')
      : null,
    automation.conditions.extensions.length ? automation.conditions.extensions.map((extension) => `.${extension}`).join(', ') : null,
    automation.conditions.nameContains ? t('Name enthält „{text}“', { text: automation.conditions.nameContains }) : null,
  ].filter(Boolean);
  const then = automation.actions.map((action) => {
    if (action.type === 'tag') return t('Schlagwort „{name}“', { name: tags.find((tag) => tag.id === action.tagId)?.name ?? '?' });
    if (action.type === 'rename') return t('umbenennen');
    if (action.type === 'convert') return t('als {format} speichern', { format: action.format.toUpperCase() });
    if (action.type === 'move') {
      const sorted = action.by === 'year' ? t('nach Jahr') : action.by === 'month' ? t('nach Monat') : '';
      const target = action.folderId === automation.folderId ? '' : t('nach „{name}“ verschieben', { name: action.folderName || '?' });
      return [target, sorted ? t('{how} einsortieren', { how: sorted }) : ''].filter(Boolean).join(', ');
    }
    if (action.type === 'copy') return t('Kopie nach „{name}“', { name: action.folderName || '?' });
    if (action.type === 'album') return t('ins Album „{name}“', { name: action.albumName || '?' });
    if (action.type === 'star') return t('als Favorit markieren');
    return t('Bescheid geben');
  });
  return `${when.length ? when.join(' · ') : t('Alle neuen Dateien')} → ${then.join(', ')}`;
}

export function AutomationsDialog({ folder, onClose }: { folder: Item; onClose: () => void }) {
  const [items, setItems] = useState<Automation[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [albums, setAlbums] = useState<Tag[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ items: Automation[] }>(`/api/automations?folder=${folder.id}`)
      .then((result) => setItems(result.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
    api
      .get<{ items: Tag[] }>('/api/tags')
      .then((result) => setTags(result.items))
      .catch(() => {});
    api
      .get<{ items: Tag[] }>('/api/albums')
      .then((result) => setAlbums(result.items))
      .catch(() => {});
    const inside = api.get<{ items: Item[] }>(`/api/nodes/${folder.id}/children?folders=1`).catch(() => ({ items: [] as Item[] }));
    const beside = folder.parentId
      ? api.get<{ items: Item[]; folder: Item }>(`/api/nodes/${folder.parentId}/children?folders=1`).catch(() => null)
      : Promise.resolve(null);
    void Promise.all([inside, beside]).then(([children, siblings]) => {
      setTargets([
        ...children.items.map((item) => ({ id: item.id, label: t('Unterordner „{name}“', { name: item.name }) })),
        ...(siblings
          ? siblings.items
              .filter((item) => item.id !== folder.id && (item.role === 'owner' || item.role === 'edit'))
              .map((item) => ({ id: item.id, label: t('Daneben: „{name}“', { name: item.name }) }))
          : []),
      ]);
    });
  }, [folder.id]);

  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = async () => {
    if (!draft) return;
    const actions = actionsOf(draft, folder.id);
    if (actions.length === 0) {
      toast(t('Wähl mindestens eine Aktion aus'));
      return;
    }
    const body = {
      name: draft.name,
      deep: draft.deep,
      conditions: {
        kinds: draft.kinds,
        extensions: draft.extensions
          .split(/[\s,;]+/)
          .map((entry) => entry.replace(/^\./, '').trim())
          .filter(Boolean),
        nameContains: draft.nameContains,
      },
      actions,
    };
    setBusy(true);
    try {
      if (draft.id) await api.patch(`/api/automations/${draft.id}`, body);
      else await api.post('/api/automations', { ...body, folderId: folder.id });
      toast(draft.id ? t('Ablauf gespeichert') : t('Ablauf angelegt'));
      setDraft(null);
      await load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (automation: Automation, enabled: boolean) => {
    try {
      await api.patch(`/api/automations/${automation.id}`, { enabled });
      await load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const remove = async (automation: Automation) => {
    const ok = await confirm({
      title: t('Ablauf „{name}“ löschen?', { name: automation.name }),
      text: t('Dateien, die er schon bearbeitet hat, bleiben wie sie sind.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/automations/${automation.id}`);
      await load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const runNow = async (automation: Automation) => {
    const ok = await confirm({
      title: t('„{name}“ jetzt anwenden?', { name: automation.name }),
      text: automation.deep
        ? t('Der Ablauf geht einmal durch alle Dateien, die schon in diesem Ordner und seinen Unterordnern liegen.')
        : t('Der Ablauf geht einmal durch alle Dateien, die schon in diesem Ordner liegen.'),
      confirm: t('Anwenden'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.post<{ applied: number; checked: number }>(`/api/automations/${automation.id}/run`);
      toast(tn(result.applied, 'Eine Datei bearbeitet', '{count} Dateien bearbeitet'));
      await load();
    } catch (error) {
      toast(errorText(error));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {draft ? (draft.id ? t('Ablauf bearbeiten') : t('Neuer Ablauf')) : t('Abläufe für „{name}“', { name: folder.name })}
      </DialogTitle>
      {draft ? (
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('Name')}
            placeholder={t('zum Beispiel Rechnungen ablegen')}
            value={draft.name}
            autoFocus
            onChange={(event) => set({ name: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <Typography variant="subtitle2" component="h3" sx={{ mt: 1 }}>
            {t('Wenn eine neue Datei ankommt')}
          </Typography>
          <Box role="group" aria-label={t('Art der Datei')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {KINDS.map((kind) => {
              const on = draft.kinds.includes(kind.value);
              return (
                <Chip
                  key={kind.value}
                  label={kind.label}
                  variant={on ? 'filled' : 'outlined'}
                  color={on ? 'primary' : 'default'}
                  aria-pressed={on}
                  onClick={() => set({ kinds: on ? draft.kinds.filter((entry) => entry !== kind.value) : [...draft.kinds, kind.value] })}
                />
              );
            })}
          </Box>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, mt: -1 }}>
            {t('Ohne Auswahl gilt der Ablauf für jede Art von Datei.')}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              label={t('Nur diese Endungen')}
              placeholder="pdf, jpg"
              value={draft.extensions}
              onChange={(event) => set({ extensions: event.target.value })}
            />
            <TextField
              label={t('Name enthält')}
              placeholder={t('zum Beispiel Rechnung')}
              value={draft.nameContains}
              onChange={(event) => set({ nameContains: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
          </Box>
          <FormControlLabel
            sx={{ m: 0, gap: 1 }}
            control={<Switch checked={draft.deep} onChange={(event) => set({ deep: event.target.checked })} />}
            label={t('Auch in Unterordnern')}
          />
          <Typography variant="subtitle2" component="h3" sx={{ mt: 1 }}>
            {t('Dann')}
          </Typography>
          <TextField select label={t('Schlagwort vergeben')} value={draft.tagId} onChange={(event) => set({ tagId: event.target.value })}>
            <MenuItem value="">{t('Keins')}</MenuItem>
            {tags.map((tag) => (
              <MenuItem key={tag.id} value={tag.id}>
                {tag.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('Umbenennen nach Muster')}
            placeholder="{datum} {name}"
            value={draft.pattern}
            onChange={(event) => set({ pattern: event.target.value })}
            helperText={t('Platzhalter: {name}, {datum}, {jahr}, {monat}, {tag}, {zeit} und {nummer}. Die Endung bleibt.')}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField
            select
            label={t('Zusätzlich speichern als')}
            value={draft.convert}
            onChange={(event) => set({ convert: event.target.value as Format | '' })}
            helperText={t('Das Original bleibt erhalten. Passt das Format nicht zur Datei, passiert nichts.')}
          >
            <MenuItem value="">{t('Nicht umwandeln')}</MenuItem>
            {FORMATS.map((format) => (
              <MenuItem key={format.value} value={format.value}>
                {format.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              select
              label={t('Verschieben nach')}
              value={draft.folderId}
              onChange={(event) => set({ folderId: event.target.value })}
            >
              <MenuItem value="">{t('Nicht verschieben')}</MenuItem>
              {targets.map((target) => (
                <MenuItem key={target.id} value={target.id}>
                  {target.label}
                </MenuItem>
              ))}
              {draft.folderId && !targets.some((target) => target.id === draft.folderId) && (
                <MenuItem value={draft.folderId}>{t('Bisheriger Zielordner')}</MenuItem>
              )}
            </TextField>
            <TextField
              select
              label={t('Dort einsortieren')}
              value={draft.by}
              onChange={(event) => set({ by: event.target.value as Draft['by'] })}
            >
              <MenuItem value="none">{t('Ohne Unterordner')}</MenuItem>
              <MenuItem value="year">{t('In Ordner pro Jahr')}</MenuItem>
              <MenuItem value="month">{t('In Ordner pro Jahr und Monat')}</MenuItem>
            </TextField>
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              select
              label={t('Kopie ablegen in')}
              value={draft.copyTo}
              onChange={(event) => set({ copyTo: event.target.value })}
              helperText={t('Die Kopie entsteht, bevor die Datei verschoben wird.')}
            >
              <MenuItem value="">{t('Keine Kopie')}</MenuItem>
              {targets.map((target) => (
                <MenuItem key={target.id} value={target.id}>
                  {target.label}
                </MenuItem>
              ))}
              {draft.copyTo && !targets.some((target) => target.id === draft.copyTo) && (
                <MenuItem value={draft.copyTo}>{t('Bisheriger Zielordner')}</MenuItem>
              )}
            </TextField>
            <TextField
              select
              label={t('In ein Album legen')}
              value={draft.albumId}
              onChange={(event) => set({ albumId: event.target.value })}
              helperText={t('Gilt für Bilder und Videos.')}
            >
              <MenuItem value="">{t('In keins')}</MenuItem>
              {albums.map((album) => (
                <MenuItem key={album.id} value={album.id}>
                  {album.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <FormControlLabel
              control={<Checkbox checked={draft.star} onChange={(event) => set({ star: event.target.checked })} />}
              label={t('Als Favorit markieren')}
            />
            <FormControlLabel
              control={<Checkbox checked={draft.notify} onChange={(event) => set({ notify: event.target.checked })} />}
              label={t('Mir Bescheid geben')}
            />
          </Box>
        </DialogContent>
      ) : (
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
            {t(
              'Ein Ablauf kümmert sich um jede neue Datei in diesem Ordner, egal ob sie hochgeladen wird, über einen Link zum Hochladen kommt oder über WebDAV.'
            )}
          </Typography>
          {!items ? (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Lädt …')}
            </Typography>
          ) : items.length === 0 ? (
            <Typography variant="body2">{t('Für diesen Ordner gibt es noch keinen Ablauf.')}</Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((automation) => (
                <Box component="li" key={automation.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Switch
                      checked={automation.enabled}
                      onChange={(event) => void toggle(automation, event.target.checked)}
                      slotProps={{ input: { 'aria-label': t('Ablauf {name} einschalten', { name: automation.name }) } }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                        {automation.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'block', overflowWrap: 'anywhere' }}>
                        {summary(automation, tags)}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'block' }}>
                        {[
                          automation.deep ? t('mit Unterordnern') : null,
                          automation.runs
                            ? tn(automation.runs, 'eine Datei bearbeitet', '{count} Dateien bearbeitet')
                            : t('noch keine Datei bearbeitet'),
                          automation.runAt ? t('zuletzt {when}', { when: formatRelative(automation.runAt) }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </Box>
                    <Tooltip title={t('Jetzt auf vorhandene Dateien anwenden')}>
                      <span>
                        <IconButton
                          aria-label={t('{name} jetzt anwenden', { name: automation.name })}
                          disabled={busy}
                          onClick={() => void runNow(automation)}
                        >
                          <PlayArrowRounded />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('Bearbeiten')}>
                      <IconButton
                        aria-label={t('{name} bearbeiten', { name: automation.name })}
                        onClick={() => setDraft(draftOf(automation))}
                      >
                        <EditRounded />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('Löschen')}>
                      <IconButton aria-label={t('{name} löschen', { name: automation.name })} onClick={() => void remove(automation)}>
                        <DeleteOutlineRounded />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {automation.error && (
                    <Alert severity="warning" sx={{ py: 0 }}>
                      {t('Beim letzten Mal hat es nicht geklappt: {error}', { error: automation.error })}
                    </Alert>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
      )}
      <DialogActions>
        {draft ? (
          <>
            <Button onClick={() => setDraft(null)}>{t('Zurück')}</Button>
            <Button variant="contained" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              {draft.id ? t('Speichern') : t('Anlegen')}
            </Button>
          </>
        ) : (
          <>
            <Button startIcon={<AddRounded />} onClick={() => setDraft({ ...EMPTY })} sx={{ mr: 'auto' }}>
              {t('Neuer Ablauf')}
            </Button>
            <Button onClick={onClose}>{t('Fertig')}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
