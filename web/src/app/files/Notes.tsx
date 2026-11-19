import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputBase from '@mui/material/InputBase';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import TitleRounded from '@mui/icons-material/TitleRounded';
import { api, ApiError, csrfToken, errorText } from '../../lib/api';
import { formatRelative, splitExtension } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, layer, mix, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import type { Item } from './kinds';
import { renderMarkdown, toggleTask } from './preview/markdown';
import { markdownBody } from './preview/styles';

interface Note extends Item {
  title: string;
  excerpt: string;
  category: string;
}

interface NoteList {
  folderId: string | null;
  items: Note[];
  more: boolean;
}

type Status = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';

const hrefOf = (id: string | null) => (id ? `/files/notes/${id}` : '/files/notes');

function statusText(status: Status) {
  if (status === 'saving') return t('Speichert …');
  if (status === 'dirty') return t('Noch nicht gespeichert');
  if (status === 'failed') return t('Speichern hat nicht geklappt');
  if (status === 'conflict') return t('Woanders geändert');
  return t('Gespeichert');
}

interface Saved {
  note: Note;
  base: string;
}

async function send(id: string, content: string, base: string | undefined, keepalive: boolean): Promise<Saved> {
  if (!keepalive) return api.put<Saved>(`/api/notes/${id}`, { content, base });
  const body = JSON.stringify({ content, base });
  const response = await fetch(`/api/notes/${id}`, {
    method: 'PUT',
    credentials: 'same-origin',
    keepalive: new Blob([body]).size < 60_000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as Saved & { error?: Record<string, unknown> };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal')),
      data.error ?? {}
    );
  }
  return data;
}

function prefixLines(area: HTMLTextAreaElement, text: string, prefix: string) {
  const start = text.lastIndexOf('\n', area.selectionStart - 1) + 1;
  const stop = text.indexOf('\n', area.selectionEnd);
  const end = stop === -1 ? text.length : stop;
  const lines = text.slice(start, end).split('\n');
  const all = lines.every((line) => line.startsWith(prefix));
  const changed = lines.map((line) => (all ? line.slice(prefix.length) : `${prefix}${line.replace(/^(#{1,6} |- \[[ xX]\] |- )/, '')}`));
  return { text: text.slice(0, start) + changed.join('\n') + text.slice(end), caret: start + changed.join('\n').length };
}

function Editor({ id, onChanged, onGone }: { id: string; onChanged: () => void; onGone: () => void }) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('saved');
  const [mode, setMode] = useState<'write' | 'read'>('write');
  const [missing, setMissing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const live = useRef({
    text: '',
    saved: '',
    base: '',
    writable: false,
    conflict: false,
    gone: false,
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    pending: null as Promise<void> | null,
  });

  const canWrite = note?.role !== 'view';

  const run = async (force: boolean, keepalive: boolean) => {
    const state = live.current;
    const sent = state.text;
    if (!state.gone) setStatus('saving');
    try {
      const result = await send(id, sent, force ? undefined : state.base, keepalive);
      state.saved = sent;
      state.base = result.base;
      if (!state.gone) {
        setNote(result.note);
        setStatus(state.text === sent ? 'saved' : 'dirty');
      }
      onChanged();
    } catch (error) {
      if (state.gone) return;
      if (error instanceof ApiError && error.code === 'note_conflict') {
        state.conflict = true;
        setStatus('conflict');
      } else {
        setStatus('failed');
        toast(errorText(error));
      }
    }
  };

  const save = (force = false, keepalive = false): Promise<void> => {
    const state = live.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = 0;
    if (!state.writable || (state.conflict && !force)) return Promise.resolve();
    if (state.pending) return state.pending.then(() => save(force, keepalive));
    if (state.text === state.saved && !force) return Promise.resolve();
    state.conflict = false;
    state.pending = run(force, keepalive).finally(() => {
      state.pending = null;
    });
    return state.pending;
  };

  const schedule = () => {
    const state = live.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = 0;
      void save();
    }, 1200);
  };

  const change = (next: string) => {
    const state = live.current;
    state.text = next;
    setText(next);
    if (state.conflict) return;
    setStatus('dirty');
    schedule();
  };

  const load = (focusTitle = false) => {
    const abort = new AbortController();
    api
      .get<{ note: Note; content: string; base: string }>(`/api/notes/${id}`, abort.signal)
      .then((result) => {
        const writable = result.note.role !== 'view';
        const state = live.current;
        if (state.timer) clearTimeout(state.timer);
        Object.assign(state, { text: result.content, saved: result.content, base: result.base, writable, conflict: false, timer: 0 });
        setNote(result.note);
        setTitle(result.note.title);
        setText(result.content);
        setStatus('saved');
        setMode(writable ? 'write' : 'read');
        setMissing(false);
        if (focusTitle && writable && !result.content && /^(Neue Notiz|New note)( \(\d+\))?$/.test(result.note.title)) setFresh(true);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        setMissing(true);
        if (!(error instanceof ApiError && error.status === 404)) toast(errorText(error));
      });
    return abort;
  };

  useEffect(() => {
    const state = live.current;
    state.gone = false;
    const abort = load(true);
    const hidden = () => {
      if (document.visibilityState === 'hidden') void save(false, true);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      abort.abort();
      document.removeEventListener('visibilitychange', hidden);
      state.gone = true;
      void save(false, true);
    };
  }, [id]);

  useEffect(() => {
    if (!fresh || !note) return;
    titleInput.current?.select();
    setFresh(false);
  }, [fresh, note]);

  const html = useMemo(() => (mode === 'read' ? renderMarkdown(text, { tasks: canWrite }) : ''), [mode, text, canWrite]);

  if (missing) {
    return (
      <EmptyState
        icon={<StickyNote2Rounded />}
        title={t('Diese Notiz gibt es nicht mehr')}
        text={t('Vielleicht wurde sie gelöscht oder umbenannt.')}
        action={
          <Button variant="tonal" onClick={onGone}>
            {t('Zu den Notizen')}
          </Button>
        }
      />
    );
  }
  if (!note) return null;

  const [, extension] = splitExtension(note.name);

  const rename = async () => {
    const wanted = title.trim();
    if (!wanted || wanted === note.title) {
      setTitle(note.title);
      return;
    }
    try {
      const result = await api.patch<{ node: Item }>(`/api/nodes/${note.id}`, { name: `${wanted}${extension}` });
      setNote({ ...note, ...result.node, title: wanted });
      setTitle(wanted);
      onChanged();
    } catch (error) {
      setTitle(note.title);
      toast(errorText(error));
    }
  };

  const star = async () => {
    try {
      const result = await api.put<{ starred: boolean }>(`/api/nodes/${note.id}/star`, { starred: !note.starred });
      setNote({ ...note, starred: result.starred });
      onChanged();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('„{name}“ löschen?', { name: note.title }),
      text: t('Die Notiz kommt in den Papierkorb und lässt sich von dort zurückholen.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      const state = live.current;
      if (state.timer) clearTimeout(state.timer);
      state.timer = 0;
      state.writable = false;
      await api.post('/api/nodes/trash', { ids: [note.id] });
      toast(t('„{name}“ liegt im Papierkorb', { name: note.title }));
      onChanged();
      onGone();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const format = (prefix: string) => {
    const field = area.current;
    if (!field) return;
    const result = prefixLines(field, live.current.text, prefix);
    flushSync(() => change(result.text));
    field.focus();
    field.setSelectionRange(result.caret, result.caret);
  };

  const tick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.dataset.line === undefined) return;
    change(toggleTask(live.current.text, Number(target.dataset.line)));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: { xs: 0.5, md: 1.5 }, pt: 0.5, flexWrap: 'wrap' }}>
        {!wide && (
          <Tooltip title={t('Zu den Notizen')}>
            <IconButton aria-label={t('Zu den Notizen')} onClick={onGone}>
              <ArrowBackRounded />
            </IconButton>
          </Tooltip>
        )}
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          aria-label={t('Ansicht der Notiz')}
          onChange={(_event, value: 'write' | 'read' | null) => value && setMode(value)}
        >
          <ToggleButton value="write" disabled={!canWrite}>
            {t('Schreiben')}
          </ToggleButton>
          <ToggleButton value="read">{t('Lesen')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'write' && canWrite && (
          <Box sx={{ display: 'flex', order: { xs: 1, sm: 0 }, width: { xs: '100%', sm: 'auto' } }}>
            <Tooltip title={t('Überschrift')}>
              <IconButton aria-label={t('Überschrift')} onClick={() => format('## ')}>
                <TitleRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Liste')}>
              <IconButton aria-label={t('Liste')} onClick={() => format('- ')}>
                <FormatListBulletedRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Aufgabe zum Abhaken')}>
              <IconButton aria-label={t('Aufgabe zum Abhaken')} onClick={() => format('- [ ] ')}>
                <ChecklistRounded />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" role="status" sx={{ color: status === 'failed' ? c.error : c.onSurfaceVariant, px: 1 }}>
          {canWrite ? statusText(status) : t('Nur zum Lesen')}
        </Typography>
        <Tooltip title={note.starred ? t('Aus den Favoriten nehmen') : t('Zu den Favoriten')}>
          <IconButton aria-label={note.starred ? t('Aus den Favoriten nehmen') : t('Zu den Favoriten')} onClick={() => void star()}>
            {note.starred ? <StarRounded sx={{ color: c.tertiary }} /> : <StarOutlineRounded />}
          </IconButton>
        </Tooltip>
        {note.parentId && (
          <Tooltip title={t('Im Ordner zeigen')}>
            <IconButton
              aria-label={t('Im Ordner zeigen')}
              onClick={() => navigate(`/files/folder/${note.parentId}`)}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              <FolderOpenRounded />
            </IconButton>
          </Tooltip>
        )}
        {note.role === 'owner' && (
          <Tooltip title={t('Löschen')}>
            <IconButton aria-label={t('Notiz löschen')} onClick={() => void remove()}>
              <DeleteOutlineRounded />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {status === 'conflict' && (
        <Alert
          severity="warning"
          sx={{ mx: { xs: 1.5, md: 2.5 }, mt: 1 }}
          action={
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button color="inherit" size="small" onClick={() => load()}>
                {t('Neu laden')}
              </Button>
              <Button color="inherit" size="small" onClick={() => void save(true)}>
                {t('Meine Fassung speichern')}
              </Button>
            </Box>
          }
        >
          {t('Die Notiz wurde inzwischen an anderer Stelle geändert. Lade sie neu oder speichere deine Fassung darüber.')}
        </Alert>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: { md: 'auto' }, px: { xs: 2, md: 3.5 }, pb: 4 }}>
        <InputBase
          inputRef={titleInput}
          value={title}
          readOnly={note.role !== 'owner' && note.role !== 'edit'}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            area.current?.focus();
          }}
          fullWidth
          inputProps={{ 'aria-label': t('Titel der Notiz'), maxLength: 200 }}
          sx={{ fontSize: '1.625rem', fontWeight: 600, lineHeight: 1.3, mt: 1.5, mb: 0.5 }}
        />
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'block', mb: 1.5 }}>
          {[note.category, t('zuletzt geändert {date}', { date: formatRelative(note.modifiedAt) })].filter(Boolean).join(' · ')}
        </Typography>
        {mode === 'write' ? (
          <InputBase
            inputRef={area}
            multiline
            fullWidth
            minRows={14}
            value={text}
            readOnly={!canWrite}
            placeholder={t('Schreib los. Markdown wird in der Leseansicht gestaltet.')}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void save();
              }
            }}
            inputProps={{ 'aria-label': t('Text der Notiz'), spellCheck: true }}
            sx={{ alignItems: 'flex-start', fontSize: '1rem', lineHeight: 1.65, p: 0 }}
          />
        ) : text.trim() ? (
          <Box
            className="markdown"
            onClick={tick}
            sx={{ ...markdownBody, px: 0, py: 0, overflow: 'visible', '& li.task > input:not(:disabled)': { cursor: 'pointer' } }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Diese Notiz ist noch leer.')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export function NotesView({ id }: { id: string | null }) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const [list, setList] = useState<NoteList | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () =>
    api
      .get<NoteList>('/api/notes')
      .then(setList)
      .catch((error) => {
        setList((current) => current ?? { folderId: null, items: [], more: false });
        toast(errorText(error));
      });

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useLive((event) => {
    if (event !== 'reconnect' && event !== 'change') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 400);
  });

  const items = list?.items ?? [];
  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort(), [items]);
  const needle = query.trim().toLowerCase();
  const shown = items
    .filter((item) => category === null || item.category === category)
    .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.excerpt.toLowerCase().includes(needle))
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)));

  useEffect(() => {
    if (wide && !id && list && list.items.length > 0) navigate(hrefOf(list.items[0].id), { replace: true });
  }, [wide, id, list]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await api.post<{ note: Note }>('/api/notes', category ? { category } : {});
      await load();
      navigate(hrefOf(result.note.id));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setCreating(false);
    }
  };

  if (!list) return null;

  if (items.length === 0 && !id) {
    return (
      <EmptyState
        icon={<StickyNote2Rounded />}
        title={t('Noch keine Notizen')}
        text={t(
          'Notizen sind Textdateien im Ordner „Notizen“. Du findest sie auch unter Dateien, kannst sie teilen und von jedem Gerät aus bearbeiten.'
        )}
        action={
          <Button variant="contained" startIcon={<AddRounded />} disabled={creating} onClick={() => void create()}>
            {t('Erste Notiz schreiben')}
          </Button>
        }
      />
    );
  }

  const listPane = (
    <Box
      component="nav"
      aria-label={t('Notizen')}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: { md: `1px solid ${c.outlineVariant}` },
        width: { md: 320 },
        flex: { md: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', gap: 1, px: 1.5, pt: 0.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Notizen durchsuchen')}
          slotProps={{
            htmlInput: { 'aria-label': t('Notizen durchsuchen') },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title={t('Neue Notiz')}>
          <span>
            <IconButton
              aria-label={t('Neue Notiz')}
              disabled={creating}
              onClick={() => void create()}
              sx={{ bgcolor: c.primary, color: c.onPrimary, '&:hover': { bgcolor: layer(c.primary, c.onPrimary, 12) } }}
            >
              <AddRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {categories.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, px: 1.5, pb: 1, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <Chip
            label={t('Alle')}
            size="small"
            variant={category === null ? 'filled' : 'outlined'}
            color={category === null ? 'primary' : 'default'}
            onClick={() => setCategory(null)}
            sx={{ flex: 'none' }}
          />
          {categories.map((name) => (
            <Chip
              key={name}
              label={name}
              size="small"
              variant={category === name ? 'filled' : 'outlined'}
              color={category === name ? 'primary' : 'default'}
              onClick={() => setCategory(category === name ? null : name)}
              sx={{ flex: 'none' }}
            />
          ))}
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: { md: 'auto' }, px: 1, pb: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {shown.length === 0 && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, px: 1, py: 2 }}>
            {t('Keine Notiz passt dazu.')}
          </Typography>
        )}
        {shown.map((item) => (
          <ButtonBase
            key={item.id}
            component="a"
            href={hrefOf(item.id)}
            aria-current={item.id === id ? 'page' : undefined}
            onClick={(event: MouseEvent) => {
              event.preventDefault();
              navigate(hrefOf(item.id));
            }}
            sx={{
              display: 'block',
              textAlign: 'left',
              px: 1.5,
              py: 1.25,
              borderRadius: `${radius.md}px`,
              bgcolor: item.id === id ? c.secondaryContainer : 'transparent',
              color: item.id === id ? c.onSecondaryContainer : c.onSurface,
              '&:hover': { bgcolor: item.id === id ? c.secondaryContainer : mix(c.onSurface, 6) },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {item.starred && <StarRounded sx={{ fontSize: 16, color: c.tertiary, flex: 'none' }} />}
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                {item.title}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              component="p"
              sx={{
                color: 'inherit',
                opacity: 0.8,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                minHeight: '1.3em',
              }}
            >
              {item.excerpt || t('Leer')}
            </Typography>
            <Typography variant="caption" component="p" noWrap sx={{ color: 'inherit', opacity: 0.6, mt: 0.25 }}>
              {[formatRelative(item.modifiedAt), item.category].filter(Boolean).join(' · ')}
            </Typography>
          </ButtonBase>
        ))}
        {list.more && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant, px: 1, py: 1 }}>
            {t('Hier stehen die 2000 neuesten Notizen. Ältere findest du über die Suche und unter Dateien.')}
          </Typography>
        )}
      </Box>
    </Box>
  );

  if (!wide) {
    return id ? <Editor key={id} id={id} onChanged={() => void load()} onGone={() => navigate(hrefOf(null))} /> : listPane;
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {listPane}
      {id ? (
        <Editor key={id} id={id} onChanged={() => void load()} onGone={() => navigate(hrefOf(null), { replace: true })} />
      ) : (
        <Box sx={{ flex: 1 }} />
      )}
    </Box>
  );
}
