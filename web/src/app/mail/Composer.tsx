import { useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import ScheduleSendRounded from '@mui/icons-material/ScheduleSendRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import WbSunnyOutlined from '@mui/icons-material/WbSunnyOutlined';
import { errorText } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { refreshBadges } from '../../lib/badges';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import {
  base,
  composePayload,
  formatAddress,
  mailApi,
  parseAddresses,
  personName,
  postCompose,
  type Address,
  type ComposeState,
  type MailAccount,
  type Outbox,
} from './model';

const UNDO_MS = 8000;
const SIZE_LIMIT = 25 * 1024 * 1024;

const unique = (list: Address[]) =>
  list.filter((entry, index) => list.findIndex((other) => other.address.toLowerCase() === entry.address.toLowerCase()) === index);

function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  name,
}: {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  autoFocus?: boolean;
  name: string;
}) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Address[]>([]);
  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      mailApi
        .recipients(q)
        .then((result) => setOptions(result.recipients))
        .catch(() => setOptions([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [input]);
  const commit = (text: string) => {
    const parsed = parseAddresses(text);
    if (!parsed.length) return false;
    onChange(unique([...value, ...parsed]));
    setInput('');
    return true;
  };
  return (
    <Autocomplete<Address, true, false, true>
      multiple
      freeSolo
      options={options}
      value={value}
      inputValue={input}
      filterOptions={(list) => list}
      filterSelectedOptions
      getOptionLabel={(option) => (typeof option === 'string' ? option : formatAddress(option))}
      isOptionEqualToValue={(option, current) => typeof current !== 'string' && option.address === current.address}
      onInputChange={(_event, next, reason) => {
        if (reason !== 'input') return;
        if (/[,;\s]$/.test(next) && commit(next)) return;
        setInput(next);
      }}
      onChange={(_event, next) => {
        onChange(unique(next.flatMap((entry) => (typeof entry === 'string' ? parseAddresses(entry) : [entry]))));
        setInput('');
      }}
      renderValue={(items, getItemProps) =>
        items.map((item, index) => {
          const { key, ...rest } = getItemProps({ index });
          const entry = typeof item === 'string' ? { name: '', address: item } : item;
          return <Chip key={key} {...rest} size="small" label={personName(entry)} title={entry.address} />;
        })
      }
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important' }}>
            <Typography variant="body2">{option.name || option.address}</Typography>
            {option.name && (
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {option.address}
              </Typography>
            )}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          label={label}
          name={name}
          autoFocus={autoFocus}
          onBlur={() => commit(input)}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, autoCapitalize: 'none', spellCheck: false, 'data-recipient': name },
          }}
        />
      )}
    />
  );
}

function nextMorning(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(8, 0, 0, 0);
  return date.getTime();
}

function nextMonday() {
  const date = new Date();
  const add = (8 - date.getDay()) % 7 || 7;
  return nextMorning(add);
}

async function toHtml(text: string) {
  const { renderMarkdown } = await import('../files/preview/markdown');
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55">${renderMarkdown(text)}</div>`;
}

export function Composer({
  initial,
  accounts,
  onClose,
  onReopen,
}: {
  initial: ComposeState;
  accounts: MailAccount[];
  onClose: () => void;
  onReopen: (state: ComposeState) => void;
}) {
  const phone = useMediaQuery('(max-width: 599.95px)');
  const [state, setState] = useState<ComposeState>(initial);
  const [copies, setCopies] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const saving = useRef(false);
  const file = useRef<HTMLInputElement | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const total = state.attachments.reduce((sum, entry) => sum + entry.size, 0);

  const update = (patch: Partial<ComposeState>) => {
    setState((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const saveDraft = async (quiet: boolean) => {
    if (saving.current) return;
    saving.current = true;
    try {
      const current = latest.current;
      const html = current.formatted ? await toHtml(current.text) : null;
      const { payload, files } = composePayload(current, html, null);
      const result = await postCompose<{ draft: { folder: string; uid: number | null } }>(
        `${base(current.account)}/drafts`,
        payload,
        files
      );
      const draft = result.draft.uid ? { folder: result.draft.folder, uid: result.draft.uid } : null;
      setState((value) => ({
        ...value,
        draft,
        attachments: value.attachments.map((entry, index) =>
          entry.kind === 'upload' && draft
            ? { kind: 'message' as const, folder: draft.folder, uid: draft.uid, index, name: entry.name, size: entry.size }
            : entry
        ),
      }));
      setDirty(false);
      if (!quiet) toast(t('Als Entwurf gespeichert'));
    } catch (error) {
      if (!quiet) toast(errorText(error));
    } finally {
      saving.current = false;
    }
  };

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void saveDraft(true), 30_000);
    return () => clearTimeout(timer);
  }, [dirty, state]);

  const empty =
    !state.to.length && !state.cc.length && !state.bcc.length && !state.subject.trim() && !state.text.replace(/--\s*\n[\s\S]*$/, '').trim();

  const close = async () => {
    if (dirty && !empty) await saveDraft(false);
    onClose();
  };

  const discard = async () => {
    if (!empty && !(await confirm({ title: t('Entwurf verwerfen?'), confirm: t('Verwerfen'), danger: true }))) return;
    if (state.draft) await mailApi.remove(state.account, state.draft.folder, [state.draft.uid]).catch(() => undefined);
    onClose();
  };

  const send = async (at: number | null) => {
    if (!state.to.length && !state.cc.length && !state.bcc.length) {
      toast(t('Gib mindestens eine Adresse an'));
      return;
    }
    if (!state.subject.trim() && !(await confirm({ title: t('Ohne Betreff senden?'), confirm: t('Senden') }))) return;
    setBusy(true);
    try {
      const html = state.formatted ? await toHtml(state.text) : null;
      const undo = at === null;
      const { payload, files } = composePayload(state, html, at ?? Date.now() + UNDO_MS);
      const result = await postCompose<{ sent: boolean; queued?: Outbox }>(`${base(state.account)}/send`, payload, files);
      onClose();
      const queued = result.queued;
      if (queued && undo) {
        toast(t('Wird gesendet …'), {
          duration: UNDO_MS - 500,
          action: {
            label: t('Rückgängig'),
            onClick: () => {
              mailApi
                .cancel(queued.id)
                .then(() => onReopen(state))
                .catch((error) => toast(errorText(error)));
            },
          },
        });
        setTimeout(() => void refreshBadges(), UNDO_MS + 2000);
      } else if (queued) {
        toast(
          t('Geplant für {time}', {
            time: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(queued.sendAt)),
          })
        );
      } else toast(t('Gesendet'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const pickLater = async () => {
    setLater(null);
    const value = await prompt({
      title: t('Später senden'),
      label: t('Datum und Uhrzeit'),
      value: new Date(nextMorning() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
      confirm: t('Planen'),
      helper: t('Zum Beispiel 2026-12-24T09:00'),
    });
    if (!value) return;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time < Date.now() + 60_000) {
      toast(t('Wähl einen Zeitpunkt in der Zukunft'));
      return;
    }
    void send(time);
  };

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [
      ...state.attachments,
      ...[...files].map((entry) => ({ kind: 'upload' as const, file: entry, name: entry.name, size: entry.size })),
    ];
    if (next.reduce((sum, entry) => sum + entry.size, 0) > SIZE_LIMIT) {
      toast(t('Zusammen höchstens {size} MB. Teile große Dateien lieber als Link.', { size: 25 }));
      return;
    }
    update({ attachments: next });
  };

  return (
    <Dialog
      open
      onClose={() => void close()}
      fullScreen={phone}
      maxWidth="md"
      fullWidth
      aria-labelledby="moe-compose-title"
      data-composer
      slotProps={{ paper: { sx: { height: { sm: 'min(860px, 92dvh)' }, display: 'flex', flexDirection: 'column' } } }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        add(event.dataTransfer.files);
      }}
    >
      {busy && <LinearProgress sx={{ position: 'absolute', insetInline: 0, top: 0 }} />}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: { xs: 1, sm: 1.5 } }}>
        <Typography id="moe-compose-title" variant="h6" component="h2" sx={{ flex: 1, fontWeight: 700 }} noWrap>
          {state.subject.trim() || (state.answered ? (state.answered.forward ? t('Weiterleiten') : t('Antworten')) : t('Neue E-Mail'))}
        </Typography>
        <Tooltip title={t('Verwerfen')}>
          <IconButton onClick={() => void discard()} aria-label={t('Verwerfen')}>
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Schließen und als Entwurf speichern')}>
          <IconButton onClick={() => void close()} aria-label={t('Schließen')}>
            <CloseRounded />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ px: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {accounts.length > 1 && (
          <TextField
            select
            variant="standard"
            label={t('Von')}
            value={state.account}
            onChange={(event) => update({ account: event.target.value })}
          >
            {accounts.map((entry) => (
              <MenuItem key={entry.id} value={entry.id}>
                {entry.displayName ? `${entry.displayName} <${entry.email}>` : entry.email}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <RecipientField label={t('An')} name="to" value={state.to} onChange={(to) => update({ to })} autoFocus={!state.to.length} />
          </Box>
          {!copies && (
            <Button size="small" onClick={() => setCopies(true)} sx={{ mb: 0.5 }}>
              {t('Cc/Bcc')}
            </Button>
          )}
        </Box>
        {copies && (
          <>
            <RecipientField label={t('Cc')} name="cc" value={state.cc} onChange={(cc) => update({ cc })} />
            <RecipientField label={t('Bcc')} name="bcc" value={state.bcc} onChange={(bcc) => update({ bcc })} />
          </>
        )}
        <TextField
          variant="standard"
          label={t('Betreff')}
          value={state.subject}
          onChange={(event) => update({ subject: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 998, 'data-subject': '' } }}
          autoFocus={state.to.length > 0 && !state.subject}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2, pt: 1.5 }}>
        <InputBase
          multiline
          value={state.text}
          onChange={(event) => update({ text: event.target.value })}
          placeholder={t('Schreib deine Nachricht …')}
          autoFocus={state.to.length > 0 && Boolean(state.subject) && !state.answered}
          inputProps={{ 'aria-label': t('Nachricht'), 'data-mail-text': '' }}
          sx={{
            flex: 1,
            alignItems: 'flex-start',
            overflow: 'auto',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            '& textarea': { minHeight: { xs: '40dvh', sm: 240 } },
          }}
          onFocus={(event) => {
            if (state.answered && !state.answered.forward) {
              const target = event.target as HTMLTextAreaElement;
              if (target.selectionStart === target.value.length) target.setSelectionRange(0, 0);
            }
          }}
        />
        {state.attachments.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, py: 1 }} data-compose-attachments>
            {state.attachments.map((entry, index) => (
              <Chip
                key={`${entry.kind}-${entry.name}-${index}`}
                icon={<AttachFileRounded />}
                label={`${entry.name} · ${formatBytes(entry.size)}`}
                onDelete={() => update({ attachments: state.attachments.filter((_, position) => position !== index) })}
                sx={{ maxWidth: '100%' }}
              />
            ))}
            <Typography variant="caption" sx={{ color: total > SIZE_LIMIT ? c.error : c.onSurfaceVariant, alignSelf: 'center' }}>
              {formatBytes(total)} / 25 MB
            </Typography>
          </Box>
        )}
      </Box>
      <Divider />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, flexWrap: 'wrap' }}>
        <ButtonGroup variant="contained" disabled={busy} sx={{ borderRadius: `${radius.full}px`, overflow: 'hidden' }}>
          <Button
            startIcon={<SendRounded />}
            onClick={() => void send(null)}
            data-mail-send
            sx={{ borderRadius: `${radius.full}px 0 0 ${radius.full}px` }}
          >
            {t('Senden')}
          </Button>
          <Button
            aria-label={t('Später senden')}
            aria-haspopup="menu"
            onClick={(event) => setLater(event.currentTarget)}
            sx={{ px: 1, minWidth: 0, borderRadius: `0 ${radius.full}px ${radius.full}px 0` }}
          >
            <ArrowDropDownRounded />
          </Button>
        </ButtonGroup>
        <Menu anchorEl={later} open={Boolean(later)} onClose={() => setLater(null)}>
          <MenuItem
            onClick={() => {
              setLater(null);
              void send(nextMorning());
            }}
          >
            <ListItemIcon>
              <WbSunnyOutlined />
            </ListItemIcon>
            {t('Morgen um 8 Uhr')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setLater(null);
              void send(nextMonday());
            }}
          >
            <ListItemIcon>
              <EventRounded />
            </ListItemIcon>
            {t('Montag um 8 Uhr')}
          </MenuItem>
          <MenuItem onClick={() => void pickLater()}>
            <ListItemIcon>
              <ScheduleSendRounded />
            </ListItemIcon>
            {t('Zeitpunkt wählen …')}
          </MenuItem>
        </Menu>
        <Tooltip title={t('Datei anhängen')}>
          <IconButton onClick={() => file.current?.click()} aria-label={t('Datei anhängen')}>
            <AttachFileRounded />
          </IconButton>
        </Tooltip>
        <input ref={file} type="file" multiple hidden onChange={(event) => add(event.target.files)} />
        <FormControlLabel
          sx={{ ml: 'auto', mr: 0 }}
          control={<Switch size="small" checked={state.formatted} onChange={(event) => update({ formatted: event.target.checked })} />}
          label={
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Formatierung mit Markdown')}
            </Typography>
          }
        />
      </Box>
    </Dialog>
  );
}
