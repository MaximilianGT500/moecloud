import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Fab from '@mui/material/Fab';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import LocalFireDepartmentRounded from '@mui/icons-material/LocalFireDepartmentRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SaveAltRounded from '@mui/icons-material/SaveAltRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import { errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate, useLocation } from '../../lib/router';
import { c, fonts, mix, radius } from '../../theme/tokens';
import { copyText, CopyField, EmptyState, QrCode } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { PullToRefresh } from '../common/touch';
import { AppShell } from '../shell/AppShell';
import { CodeView } from './CodeView';
import { EXPIRY, LANGUAGE_NAMES, languageName, snippetsApi, type Snippet } from './model';

interface Draft {
  id: string | null;
  title: string;
  language: string;
  content: string;
}

const policy = () => (boot() as { share?: { requirePassword?: boolean; maxDays?: number } }).share ?? {};

function ShareDialog({
  snippet,
  open,
  onClose,
  onChanged,
}: {
  snippet: Snippet;
  open: boolean;
  onClose: () => void;
  onChanged: (snippet: Snippet) => void;
}) {
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState<number | null>(null);
  const [burn, setBurn] = useState(snippet.burn);
  const [busy, setBusy] = useState(false);
  const rules = policy();
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setBurn(snippet.burn);
    setExpiry(null);
  }, [open, snippet.id]);
  const apply = async (input: Parameters<typeof snippetsApi.share>[1], message?: string) => {
    setBusy(true);
    try {
      const result = await snippetsApi.share(snippet.id, input);
      onChanged(result.snippet);
      if (message) toast(message);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const enable = () =>
    apply(
      {
        shared: true,
        burn,
        password: password ? password : undefined,
        expiresAt: expiry ? Date.now() + expiry : snippet.shared ? undefined : null,
      },
      snippet.shared ? t('Gespeichert') : t('Link erstellt')
    );
  const choices = EXPIRY.filter(([, value]) => !rules.maxDays || (value !== null && value <= rules.maxDays * 86_400_000));
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-snippet-share>
      <DialogTitle>{t('Schnipsel teilen')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {snippet.shared && snippet.link ? (
          <>
            <CopyField value={snippet.link} label={t('Link')} />
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <QrCode value={snippet.link} size={160} label={t('QR-Code für den Link')} />
            </Box>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {[
                snippet.protected ? t('Mit Passwort') : t('Ohne Passwort'),
                snippet.burn
                  ? t('Wird nach dem ersten Öffnen gelöscht')
                  : snippet.views
                    ? tn(snippet.views, 'Einmal geöffnet', '{count}-mal geöffnet')
                    : t('Noch nicht geöffnet'),
                snippet.expiresAt ? t('Läuft ab {date}', { date: formatDateTime(snippet.expiresAt) }) : t('Läuft nicht ab'),
              ].join(' · ')}
            </Typography>
            <Divider />
          </>
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Jeder mit dem Link kann den Schnipsel lesen, auch ohne Konto.')}
          </Typography>
        )}
        <TextField
          type="password"
          label={snippet.protected ? t('Neues Passwort') : rules.requirePassword ? t('Passwort (Pflicht)') : t('Passwort (freiwillig)')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          helperText={snippet.protected ? t('Leer lassen, um das bisherige zu behalten') : undefined}
        />
        <TextField
          select
          label={t('Läuft ab')}
          value={expiry === null ? 'never' : String(expiry)}
          onChange={(event) => setExpiry(event.target.value === 'never' ? null : Number(event.target.value))}
        >
          {choices.map(([label, value]) => (
            <MenuItem key={label} value={value === null ? 'never' : String(value)}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={burn} onChange={(event) => setBurn(event.target.checked)} />}
          label={
            <Box>
              <Typography variant="body2">{t('Nach dem Lesen löschen')}</Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('Gut für Passwörter und Geheimnisse')}
              </Typography>
            </Box>
          }
        />
        {busy && <LinearProgress />}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {snippet.shared && (
          <>
            <Button color="error" onClick={() => void apply({ shared: false }, t('Link ausgeschaltet'))} disabled={busy}>
              {t('Link ausschalten')}
            </Button>
            <Button
              onClick={() => void apply({ shared: true, renew: true }, t('Neuer Link erstellt, der alte geht nicht mehr'))}
              disabled={busy}
            >
              {t('Neuer Link')}
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {protectedRemoval(snippet, busy, () => void apply({ shared: true, password: null }, t('Passwort entfernt')))}
        <Button
          variant="contained"
          onClick={() => void enable()}
          disabled={busy || (rules.requirePassword && !snippet.protected && !password)}
          data-snippet-share-save
        >
          {snippet.shared ? t('Speichern') : t('Link erstellen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function protectedRemoval(snippet: Snippet, busy: boolean, run: () => void) {
  if (!snippet.protected || policy().requirePassword) return null;
  return (
    <Button onClick={run} disabled={busy}>
      {t('Passwort entfernen')}
    </Button>
  );
}

function SnippetRow({ snippet, active, onOpen }: { snippet: Snippet; active: boolean; onOpen: () => void }) {
  return (
    <ButtonBase
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      data-snippet-row={snippet.title || snippet.id}
      sx={{
        width: '100%',
        display: 'block',
        textAlign: 'left',
        px: 2,
        py: 1.25,
        borderRadius: { md: `${radius.md}px` },
        bgcolor: active ? c.secondaryContainer : 'transparent',
        '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 5) },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body1" noWrap sx={{ flex: 1, fontWeight: 700 }}>
          {snippet.title || t('Ohne Titel')}
        </Typography>
        {snippet.shared && <LinkRounded sx={{ fontSize: 16, color: c.primary }} aria-label={t('Geteilt')} />}
        {snippet.protected && <LockRounded sx={{ fontSize: 15, color: c.onSurfaceVariant }} aria-label={t('Mit Passwort')} />}
        {snippet.burn && snippet.shared && (
          <LocalFireDepartmentRounded sx={{ fontSize: 16, color: c.error }} aria-label={t('Einmal-Link')} />
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
        <Chip size="small" label={languageName(snippet.language)} sx={{ height: 20, fontSize: '0.6875rem' }} />
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {formatRelative(snippet.updatedAt)} · {tn(snippet.lines, 'eine Zeile', '{count} Zeilen')}
        </Typography>
      </Box>
      {snippet.preview && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.75,
            fontFamily: fonts.mono,
            fontSize: '0.75rem',
            lineHeight: 1.5,
            color: c.onSurfaceVariant,
            whiteSpace: 'pre',
            overflow: 'hidden',
            maxHeight: '4.5em',
            maskImage: 'linear-gradient(to bottom, black 55%, transparent)',
          }}
        >
          {snippet.preview}
        </Box>
      )}
    </ButtonBase>
  );
}

function Editor({
  snippet,
  showBack,
  onBack,
  onSaved,
  onRemoved,
}: {
  snippet: Snippet | null;
  showBack: boolean;
  onBack: () => void;
  onSaved: (snippet: Snippet) => void;
  onRemoved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    id: snippet?.id ?? null,
    title: snippet?.title ?? '',
    language: snippet?.language ?? 'auto',
    content: snippet?.content ?? '',
  });
  const [state, setState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [mode, setMode] = useState<'edit' | 'view'>(snippet?.content ? 'view' : 'edit');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [current, setCurrent] = useState<Snippet | null>(snippet);
  const latest = useRef(draft);
  const saving = useRef<Promise<unknown> | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  const save = useCallback(async () => {
    const value = latest.current;
    if (!value.content.trim()) return;
    if (saving.current) await saving.current;
    setState('saving');
    const job = (async () => {
      try {
        const result = value.id
          ? await snippetsApi.update(value.id, { title: value.title, language: value.language, content: value.content })
          : await snippetsApi.create({ title: value.title, language: value.language, content: value.content });
        setCurrent(result.snippet);
        onSaved(result.snippet);
        if (!value.id) {
          latest.current = { ...latest.current, id: result.snippet.id };
          setDraft((draftNow) => ({ ...draftNow, id: result.snippet.id }));
          navigate(`/snippets?id=${result.snippet.id}`, { replace: true });
        }
        setState(
          latest.current === value ||
            (latest.current.content === value.content && latest.current.title === value.title && latest.current.language === value.language)
            ? 'saved'
            : 'dirty'
        );
      } catch (error) {
        setState('error');
        toast(errorText(error));
      }
    })();
    saving.current = job;
    await job;
    saving.current = null;
  }, [onSaved]);

  useEffect(() => {
    if (state !== 'dirty') return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  }, [draft, state, save]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [save]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'saving') event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [state]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setState('dirty');
  };

  const remove = async () => {
    if (!current) return;
    if (
      !(await confirm({
        title: t('Schnipsel löschen?'),
        text: current.shared ? t('Der geteilte Link geht danach nicht mehr.') : undefined,
        confirm: t('Löschen'),
        danger: true,
      }))
    )
      return;
    try {
      await snippetsApi.remove(current.id);
      onRemoved();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const status =
    state === 'saving'
      ? t('Speichert …')
      : state === 'saved'
        ? t('Gespeichert')
        : state === 'dirty'
          ? t('Nicht gespeichert')
          : state === 'error'
            ? t('Fehler beim Speichern')
            : current
              ? t('Geändert {time}', { time: formatRelative(current.updatedAt) })
              : t('Neu');

  return (
    <Box
      data-snippet-editor
      sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: { xs: 'auto', md: '100%' }, minHeight: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75, borderBottom: `1px solid ${c.outlineVariant}` }}>
        {showBack && (
          <IconButton onClick={onBack} aria-label={t('Zurück')}>
            <ArrowBackRounded />
          </IconButton>
        )}
        <Typography variant="caption" sx={{ color: state === 'error' ? c.error : c.onSurfaceVariant, flex: 1, pl: 1 }} aria-live="polite">
          {status}
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, next: 'edit' | 'view' | null) => next && setMode(next)}>
          <ToggleButton value="edit" aria-label={t('Bearbeiten')}>
            <EditNoteRounded fontSize="small" />
          </ToggleButton>
          <ToggleButton value="view" aria-label={t('Ansehen')} disabled={!draft.content}>
            <CodeRounded fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title={t('Teilen')}>
          <span>
            <IconButton onClick={() => setSharing(true)} disabled={!current} aria-label={t('Teilen')} data-snippet-share-open>
              <ShareRounded color={current?.shared ? 'primary' : undefined} />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton onClick={(event) => setMenu(event.currentTarget)} aria-label={t('Mehr')} aria-haspopup="menu">
          <MoreVertRounded />
        </IconButton>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} onClick={() => setMenu(null)}>
          <MenuItem onClick={() => void copyText(draft.content)} disabled={!draft.content}>
            <ListItemIcon>
              <ContentCopyRounded />
            </ListItemIcon>
            {t('Inhalt kopieren')}
          </MenuItem>
          {current && (
            <MenuItem component="a" href={`/api/snippets/${current.id}/raw`} target="_blank" rel="noopener">
              <ListItemIcon>
                <OpenInNewRounded />
              </ListItemIcon>
              {t('Als Rohtext öffnen')}
            </MenuItem>
          )}
          {current && (
            <MenuItem
              onClick={async () => {
                try {
                  const result = await snippetsApi.save(current.id);
                  toast(t('„{name}“ liegt jetzt in „{folder}“', { name: result.node.name, folder: result.folder.name }), {
                    action: { label: t('Öffnen'), onClick: () => (location.href = `/files/folder/${result.folder.id}`) },
                  });
                } catch (error) {
                  toast(errorText(error));
                }
              }}
            >
              <ListItemIcon>
                <SaveAltRounded />
              </ListItemIcon>
              {t('Als Datei speichern')}
            </MenuItem>
          )}
          {current && <Divider />}
          {current && (
            <MenuItem onClick={() => void remove()} sx={{ color: c.error }}>
              <ListItemIcon sx={{ color: 'inherit' }}>
                <DeleteOutlineRounded />
              </ListItemIcon>
              {t('Löschen')}
            </MenuItem>
          )}
        </Menu>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, px: 2, pt: 2, flexWrap: 'wrap' }}>
        <TextField
          value={draft.title}
          onChange={(event) => edit({ title: event.target.value })}
          placeholder={t('Titel')}
          variant="standard"
          sx={{ flex: '1 1 240px' }}
          slotProps={{
            htmlInput: {
              maxLength: 200,
              'aria-label': t('Titel'),
              style: { fontSize: '1.25rem', fontWeight: 700 },
              'data-snippet-title': '',
            },
          }}
        />
        <TextField
          select
          size="small"
          value={draft.language}
          onChange={(event) => edit({ language: event.target.value })}
          sx={{ minWidth: 190 }}
          slotProps={{ htmlInput: { 'aria-label': t('Sprache') } }}
        >
          {LANGUAGE_NAMES.map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {current?.shared && current.link && (
        <Alert
          severity="info"
          icon={current.burn ? <LocalFireDepartmentRounded /> : <LinkRounded />}
          sx={{ mx: 2, mt: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={() => void copyText(current.link!, t('Link kopiert'))}>
              {t('Kopieren')}
            </Button>
          }
        >
          {current.burn
            ? t('Geteilt als Einmal-Link')
            : current.views
              ? tn(current.views, 'Geteilt, einmal geöffnet', 'Geteilt, {count}-mal geöffnet')
              : t('Geteilt, noch nicht geöffnet')}
        </Alert>
      )}
      <Box sx={{ flex: 1, minHeight: 0, p: 2, display: 'flex', flexDirection: 'column' }}>
        {mode === 'view' ? (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <CodeView code={draft.content} language={draft.language} />
          </Box>
        ) : (
          <Box
            component="textarea"
            ref={area}
            value={draft.content}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => edit({ content: event.target.value })}
            onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
              event.preventDefault();
              const target = event.currentTarget;
              const { selectionStart, selectionEnd, value } = target;
              const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
              edit({ content: next });
              requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
            }}
            placeholder={t('Code, Befehle oder Text hier einfügen …')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus={!snippet}
            aria-label={t('Inhalt')}
            data-snippet-content
            sx={{
              flex: 1,
              minHeight: { xs: '50dvh', md: 0 },
              width: '100%',
              resize: 'none',
              border: `1px solid ${c.outlineVariant}`,
              borderRadius: `${radius.md}px`,
              bgcolor: c.surfaceContainerLow,
              color: c.onSurface,
              p: 2,
              fontFamily: fonts.mono,
              fontSize: '0.8125rem',
              lineHeight: 1.7,
              tabSize: 2,
              outline: 'none',
              '&:focus': { borderColor: c.primary },
            }}
          />
        )}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant, mt: 1 }}>
          {formatBytes(new TextEncoder().encode(draft.content).length)} ·{' '}
          {tn(draft.content ? draft.content.replace(/\n$/, '').split('\n').length : 0, 'eine Zeile', '{count} Zeilen')}
        </Typography>
      </Box>
      {current && (
        <ShareDialog
          snippet={current}
          open={sharing}
          onClose={() => setSharing(false)}
          onChanged={(next) => {
            setCurrent(next);
            onSaved(next);
          }}
        />
      )}
    </Box>
  );
}

export function SnippetsApp() {
  const { query } = useLocation();
  const medium = useMediaQuery('(min-width: 900px)');
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState<Snippet | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const adopted = useRef<string | null>(null);
  const id = query.get('id');

  useEffect(() => {
    if (id !== 'neu') {
      if (id !== adopted.current) adopted.current = null;
      return;
    }
    adopted.current = null;
    setDraftKey((value) => value + 1);
  }, [id]);

  const load = useCallback(async () => {
    try {
      setSnippets((await snippetsApi.list(search.trim() || undefined)).snippets);
    } catch (error) {
      toast(errorText(error));
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    if (!id || id === 'neu') {
      setOpened(null);
      return;
    }
    if (opened?.id === id) return;
    snippetsApi
      .get(id)
      .then((result) => setOpened(result.snippet))
      .catch((error) => {
        toast(errorText(error));
        navigate('/snippets', { replace: true });
      });
  }, [id]);

  useLive((event, data) => {
    if (event !== 'snippets') return;
    if (data.type === 'burned') toast(t('„{title}“ wurde gelesen und ist jetzt gelöscht', { title: String(data.title || t('Schnipsel')) }));
    void load();
  });

  const showEditor = Boolean(id);
  const list = (
    <Box
      data-snippet-list
      sx={{
        width: { md: 360 },
        flex: { xs: 1, md: 'none' },
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: { md: `1px solid ${c.outlineVariant}` },
      }}
    >
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 56 }}>
        <Typography variant="h6" component="h1" sx={{ flex: 1, fontWeight: 700 }}>
          {t('Schnipsel')}
        </Typography>
        <Tooltip title={t('Neuer Schnipsel')}>
          <IconButton onClick={() => navigate('/snippets?id=neu')} aria-label={t('Neuer Schnipsel')}>
            <AddRounded />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, overflowY: { md: 'auto' }, px: { md: 1 }, pb: 12 }}>
        <PullToRefresh onRefresh={load}>
          {!snippets && <LinearProgress sx={{ mx: 2 }} />}
          {snippets && !snippets.length && (
            <EmptyState
              compact
              icon={<CodeRounded />}
              title={search ? t('Nichts gefunden') : t('Noch keine Schnipsel')}
              text={
                search
                  ? undefined
                  : t('Heb Befehle, Code und Textbausteine auf und teile sie per Link, auf Wunsch mit Passwort oder als Einmal-Link.')
              }
            />
          )}
          {snippets?.map((snippet) => (
            <SnippetRow
              key={snippet.id}
              snippet={snippet}
              active={snippet.id === id}
              onOpen={() => navigate(`/snippets?id=${snippet.id}`)}
            />
          ))}
        </PullToRefresh>
      </Box>
    </Box>
  );

  const drafting = id === 'neu' || (id !== null && id === adopted.current);
  const editor = showEditor ? (
    drafting || opened?.id === id ? (
      <Editor
        key={drafting ? `draft-${draftKey}` : id!}
        snippet={drafting ? null : opened}
        showBack={!medium}
        onBack={() => navigate('/snippets')}
        onSaved={(saved) => {
          if (id === 'neu') adopted.current = saved.id;
          setSnippets((list) => [saved, ...(list ?? []).filter((entry) => entry.id !== saved.id)]);
        }}
        onRemoved={() => {
          navigate('/snippets');
          void load();
        }}
      />
    ) : (
      <Box sx={{ flex: 1 }}>
        <LinearProgress sx={{ m: 2 }} />
      </Box>
    )
  ) : (
    <Box sx={{ flex: 1, display: { xs: 'none', md: 'grid' }, placeItems: 'center' }}>
      <EmptyState
        compact
        icon={<VisibilityRounded />}
        title={t('Wähl einen Schnipsel aus')}
        action={
          <Button variant="tonal" startIcon={<AddRounded />} onClick={() => navigate('/snippets?id=neu')}>
            {t('Neuer Schnipsel')}
          </Button>
        }
      />
    </Box>
  );

  return (
    <AppShell
      active="snippets"
      topBar={
        <Box
          role="search"
          sx={{
            flex: 1,
            maxWidth: 720,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            height: 48,
            borderRadius: `${radius.full}px`,
            bgcolor: c.surfaceContainerHigh,
          }}
        >
          <SearchRounded sx={{ color: c.onSurfaceVariant }} />
          <InputBase
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Schnipsel durchsuchen')}
            sx={{ flex: 1 }}
            inputProps={{ 'aria-label': t('Schnipsel durchsuchen'), enterKeyHint: 'search' }}
          />
          {search && (
            <IconButton size="small" onClick={() => setSearch('')} aria-label={t('Suche leeren')}>
              <CloseRounded fontSize="small" />
            </IconButton>
          )}
        </Box>
      }
      railAction={
        <Tooltip title={t('Neuer Schnipsel')} placement="right">
          <Fab color="primary" aria-label={t('Neuer Schnipsel')} onClick={() => navigate('/snippets?id=neu')} data-snippet-new="rail">
            <AddRounded />
          </Fab>
        </Tooltip>
      }
      mobileAction={
        !showEditor ? (
          <Fab color="primary" aria-label={t('Neuer Schnipsel')} onClick={() => navigate('/snippets?id=neu')} data-snippet-new="mobile">
            <AddRounded />
          </Fab>
        ) : undefined
      }
    >
      <Box sx={{ display: 'flex', height: { md: '100%' }, minHeight: 0 }}>
        {(medium || !showEditor) && list}
        {(medium || showEditor) && editor}
      </Box>
    </AppShell>
  );
}
