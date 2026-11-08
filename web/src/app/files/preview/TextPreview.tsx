import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import EditRounded from '@mui/icons-material/EditRounded';
import SaveRounded from '@mui/icons-material/SaveRounded';
import { csrfToken, errorText } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { c, fonts, radius } from '../../../theme/tokens';
import { toast } from '../../common/toast';
import { contentUrl, languageOf, type Item, type PreviewType } from '../kinds';
import { Fallback } from './Fallback';
import { codeBlock, markdownBody, surfaceBox } from './styles';
import { parseCsv, SheetTable } from './TablePreview';

export const TEXT_LIMIT = 2 * 1024 * 1024;
const HIGHLIGHT_LIMIT = 400 * 1024;

type Mode = 'view' | 'source';

interface Props {
  item: Item;
  base: string;
  type: PreviewType;
  editable: boolean;
  startEditing: boolean;
  inline?: boolean;
  onSaved?: (item: Item) => void;
  onDirty: (dirty: boolean) => void;
}

function Lines({ text }: { text: string }) {
  return (
    <Box
      component="pre"
      tabIndex={0}
      sx={{
        ...codeBlock,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        counterReset: 'line',
        '& > span': { display: 'block', pl: '4.5ch', position: 'relative' },
        '& > span::before': {
          counterIncrement: 'line',
          content: 'counter(line)',
          position: 'absolute',
          left: 0,
          width: '3.5ch',
          textAlign: 'right',
          color: c.outline,
          userSelect: 'none',
        },
      }}
    >
      {text.split('\n').map((line, index) => (
        <span key={index}>{line || ' '}</span>
      ))}
    </Box>
  );
}

function Highlighted({ html, lines }: { html: string; lines: number }) {
  return (
    <Box sx={{ display: 'flex', minWidth: 0, overflow: 'auto', height: '100%' }} tabIndex={0}>
      <Box
        component="pre"
        aria-hidden
        sx={{ ...codeBlock, pr: 1.5, color: c.outline, textAlign: 'right', userSelect: 'none', overflow: 'visible', flex: 'none' }}
      >
        {Array.from({ length: lines }, (_, index) => index + 1).join('\n')}
      </Box>
      <Box component="pre" sx={{ ...codeBlock, pl: 0, overflow: 'visible', flex: 1, whiteSpace: 'pre' }}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </Box>
    </Box>
  );
}

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function TextPreview({ item, base, type, editable, startEditing, inline, onSaved, onDirty }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(startEditing);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('view');
  const [rendered, setRendered] = useState<{ key: string; html: string | null } | null>(null);
  const extension = languageOf(item.name);
  const shown = type === 'json' && text !== null ? pretty(text) : (text ?? '');
  const renderKey = `${item.id}:${item.version}:${mode}:${type}`;

  useEffect(() => {
    const abort = new AbortController();
    if (item.size > TEXT_LIMIT) return () => abort.abort();
    fetch(contentUrl(item, base), { credentials: 'same-origin', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t('Die Datei konnte nicht geladen werden'));
        const value = await response.text();
        setText(value);
        setDraft(value);
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      });
    return () => abort.abort();
  }, [item, base]);

  useEffect(() => {
    if (text === null || editing) return;
    let cancelled = false;
    const source = type === 'json' ? pretty(text) : text;
    const job =
      type === 'markdown' && mode === 'view'
        ? import('./markdown').then((module) => module.renderMarkdown(source))
        : (type === 'code' || type === 'json' || (type === 'markdown' && mode === 'source')) && source.length <= HIGHLIGHT_LIMIT
          ? import('./highlight').then((module) =>
              module.highlight(source, type === 'json' ? 'json' : type === 'markdown' ? 'md' : extension)
            )
          : Promise.resolve(null);
    job
      .then((html) => {
        if (!cancelled) setRendered({ key: renderKey, html });
      })
      .catch(() => {
        if (!cancelled) setRendered({ key: renderKey, html: null });
      });
    return () => {
      cancelled = true;
    };
  }, [text, editing, type, mode, extension, renderKey]);

  const dirty = editing && text !== null && draft !== text;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/nodes/${item.id}/content`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
        body: new Blob([draft], { type: 'text/plain' }),
      });
      const data = (await response.json()) as { node?: Item; error?: { message: string } };
      if (!response.ok || !data.node) throw new Error(data.error?.message ?? t('Speichern fehlgeschlagen'));
      setText(draft);
      setEditing(false);
      toast(t('Gespeichert'));
      onSaved?.(data.node);
    } catch (reason) {
      toast(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  if (item.size > TEXT_LIMIT) return <Fallback item={item} text={t('Die Datei ist zu groß für die Vorschau.')} />;
  if (error) return <Fallback item={item} text={error} />;
  if (text === null) return <CircularProgress aria-label={t('Lädt')} />;

  const switchable = (type === 'markdown' || type === 'csv') && !editing;
  const html = rendered?.key === renderKey ? rendered.html : undefined;
  const body = () => {
    if (editing) {
      return (
        <Box
          component="textarea"
          value={draft}
          autoFocus
          spellCheck={false}
          aria-label={t('Inhalt von {name}', { name: item.name })}
          onChange={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
          onKeyDown={(event: ReactKeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              if (dirty) void save();
            }
          }}
          sx={{
            flex: 1,
            minHeight: inline ? 360 : 0,
            resize: 'none',
            width: '100%',
            boxSizing: 'border-box',
            p: 2.5,
            border: `2px solid ${c.primary}`,
            borderRadius: `${radius.md}px`,
            bgcolor: c.surfaceContainerLow,
            color: c.onSurface,
            fontFamily: fonts.mono,
            fontSize: '0.875rem',
            lineHeight: 1.7,
            outline: 'none',
            tabSize: 2,
          }}
        />
      );
    }
    if (type === 'csv' && mode === 'view') return <SheetTable rows={parseCsv(text, extension)} maxHeight={inline ? '60vh' : '100%'} />;
    if (type === 'markdown' && mode === 'view') {
      if (html === undefined) return <CircularProgress aria-label={t('Lädt')} sx={{ m: 'auto' }} />;
      return (
        <Box
          className="markdown"
          tabIndex={0}
          sx={{ ...surfaceBox, ...markdownBody, flex: 1, minHeight: 0, maxHeight: inline ? '70vh' : undefined }}
          dangerouslySetInnerHTML={{ __html: html ?? '' }}
        />
      );
    }
    if (html) {
      return (
        <Box sx={{ ...surfaceBox, flex: 1, minHeight: 0, overflow: 'hidden', maxHeight: inline ? '70vh' : undefined }}>
          <Highlighted html={html} lines={shown.split('\n').length} />
        </Box>
      );
    }
    return (
      <Box sx={{ ...surfaceBox, flex: 1, minHeight: 0, overflow: 'auto', maxHeight: inline ? '70vh' : undefined }}>
        <Lines text={shown} />
      </Box>
    );
  };

  return (
    <Box
      sx={{
        width: 'min(1100px, 100%)',
        height: inline ? 'auto' : '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minHeight: 0,
      }}
    >
      {(editable || switchable) && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {switchable && (
            <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_event, value: Mode | null) => value && setMode(value)}>
              <ToggleButton value="view">{type === 'csv' ? t('Tabelle') : t('Ansicht')}</ToggleButton>
              <ToggleButton value="source">{t('Quelltext')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Box sx={{ flex: 1 }} />
          {editable &&
            (editing ? (
              <>
                <Button
                  onClick={() => {
                    setDraft(text);
                    setEditing(false);
                  }}
                >
                  {t('Verwerfen')}
                </Button>
                <Button variant="contained" startIcon={<SaveRounded />} disabled={!dirty || saving} onClick={() => void save()}>
                  {t('Speichern')}
                </Button>
              </>
            ) : (
              <Button variant="tonal" startIcon={<EditRounded />} onClick={() => setEditing(true)}>
                {t('Bearbeiten')}
              </Button>
            ))}
        </Box>
      )}
      {body()}
    </Box>
  );
}
