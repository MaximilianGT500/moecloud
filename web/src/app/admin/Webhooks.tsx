import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import WebhookRounded from '@mui/icons-material/WebhookRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { Loading, StatusDot } from './shared';

type Kind = 'discord' | 'slack' | 'matrix' | 'telegram' | 'ntfy' | 'json';

interface Webhook {
  id: string;
  name: string;
  kind: Kind;
  events: string[];
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, boolean>;
  createdAt: number;
  lastAt: number | null;
  lastStatus: number | null;
  lastError: string | null;
}

const KIND_NAMES: Record<Kind, string> = {
  discord: 'Discord',
  slack: 'Slack',
  matrix: 'Matrix',
  telegram: 'Telegram',
  ntfy: 'ntfy',
  json: 'JSON',
};
const EVENTS = ['user_registered', 'virus', 'scan_error', 'backup_failed', 'disk_low', 'update', 'login_failed'];

function eventLabel(event: string) {
  switch (event) {
    case 'user_registered':
      return t('Neue Konten');
    case 'virus':
      return t('Schadsoftware gefunden');
    case 'scan_error':
      return t('Virenscan gestört');
    case 'backup_failed':
      return t('Sicherung fehlgeschlagen');
    case 'disk_low':
      return t('Wenig Speicherplatz');
    case 'update':
      return t('Neue Version');
    case 'login_failed':
      return t('Viele fehlgeschlagene Anmeldungen');
    default:
      return event;
  }
}

interface Field {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  helper?: string;
  optional?: boolean;
}

function fieldsOf(kind: Kind): Field[] {
  switch (kind) {
    case 'discord':
      return [
        {
          key: 'url',
          label: t('Webhook-Adresse'),
          secret: true,
          placeholder: 'https://discord.com/api/webhooks/…',
          helper: t('In Discord unter Servereinstellungen, Integrationen, Webhooks.'),
        },
      ];
    case 'slack':
      return [{ key: 'url', label: t('Webhook-Adresse'), secret: true, placeholder: 'https://hooks.slack.com/services/…' }];
    case 'matrix':
      return [
        { key: 'homeserver', label: t('Homeserver'), placeholder: 'https://matrix.example.com' },
        { key: 'room', label: t('Raum-ID'), placeholder: '!abcdef:example.com' },
        { key: 'token', label: t('Zugangstoken'), secret: true, helper: t('Am besten von einem eigenen Konto für Benachrichtigungen.') },
      ];
    case 'telegram':
      return [
        { key: 'token', label: t('Bot-Token'), secret: true, helper: t('Bekommst du von @BotFather.') },
        { key: 'chatId', label: t('Chat-ID'), placeholder: '-1001234567890' },
      ];
    case 'ntfy':
      return [
        { key: 'server', label: t('Server'), placeholder: 'https://ntfy.sh', optional: true },
        { key: 'topic', label: t('Thema'), placeholder: 'moecloud-meldungen' },
        { key: 'token', label: t('Zugangstoken'), secret: true, optional: true },
      ];
    default:
      return [
        { key: 'url', label: t('Adresse'), secret: true, placeholder: 'https://example.com/hooks/moecloud' },
        {
          key: 'secret',
          label: t('Geheimnis zum Signieren'),
          secret: true,
          optional: true,
          helper: t('Dann trägt jede Anfrage den Header X-MoeCloud-Signature mit einer HMAC-SHA256-Signatur.'),
        },
      ];
  }
}

const EMPTY = {
  name: '',
  kind: 'discord' as Kind,
  events: ['virus', 'backup_failed', 'disk_low', 'update', 'scan_error'],
  enabled: true,
  config: {} as Record<string, string>,
};

function WebhookDialog({
  hook,
  open,
  onClose,
  onSaved,
}: {
  hook: Webhook | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = open ? (hook?.id ?? 'new') : null;
  if (key !== current) {
    setCurrent(key);
    if (open)
      setForm(hook ? { name: hook.name, kind: hook.kind, events: hook.events, enabled: hook.enabled, config: { ...hook.config } } : EMPTY);
  }

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, config: Object.fromEntries(Object.entries(form.config).filter(([, value]) => value !== undefined)) };
      if (hook) await api.patch(`/api/admin/webhooks/${hook.id}`, body);
      else await api.post('/api/admin/webhooks', body);
      toast(t('Gespeichert'));
      onSaved();
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const sameKind = hook?.kind === form.kind;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{hook ? t('Ziel bearbeiten') : t('Ziel hinzufügen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField
              select
              label={t('Dienst')}
              value={form.kind}
              disabled={Boolean(hook)}
              onChange={(event) => setForm({ ...form, kind: event.target.value as Kind, config: {} })}
            >
              {(Object.keys(KIND_NAMES) as Kind[]).map((kind) => (
                <MenuItem key={kind} value={kind}>
                  {kind === 'json' ? t('Eigener Webhook (JSON)') : KIND_NAMES[kind]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('Name')}
              placeholder={KIND_NAMES[form.kind]}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
          </Box>
          {fieldsOf(form.kind).map((field) => (
            <TextField
              key={field.key}
              label={field.optional ? t('{label} (freiwillig)', { label: field.label }) : field.label}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={
                field.secret && sameKind && hook?.secrets[field.key] ? t('Gespeichert, leer lassen zum Behalten') : field.placeholder
              }
              value={form.config[field.key] ?? ''}
              required={!field.optional && !(field.secret && sameKind && hook?.secrets[field.key])}
              helperText={field.helper}
              onChange={(event) => setForm({ ...form, config: { ...form.config, [field.key]: event.target.value } })}
            />
          ))}
          {form.kind === 'ntfy' && (
            <TextField
              select
              label={t('Priorität')}
              value={form.config.priority ?? ''}
              onChange={(event) => setForm({ ...form, config: { ...form.config, priority: event.target.value } })}
            >
              <MenuItem value="">{t('Je nach Meldung')}</MenuItem>
              {['1', '2', '3', '4', '5'].map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('Melden bei')}
            </Typography>
            <FormGroup sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              {EVENTS.map((event) => (
                <FormControlLabel
                  key={event}
                  control={
                    <Checkbox
                      checked={form.events.includes(event)}
                      onChange={(change) =>
                        setForm({
                          ...form,
                          events: change.target.checked ? [...form.events, event] : form.events.filter((entry) => entry !== event),
                        })
                      }
                    />
                  }
                  label={eventLabel(event)}
                />
              ))}
            </FormGroup>
          </Box>
          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />}
            label={t('Aktiv')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {t('Speichern')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function WebhooksSection() {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [editing, setEditing] = useState<{ hook: Webhook | null } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ items: Webhook[] }>('/api/admin/webhooks')
      .then((result) => setHooks(result.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  const test = async (hook: Webhook) => {
    setTesting(hook.id);
    try {
      const result = await api.post<{ ok: boolean; status: number; error?: string }>(`/api/admin/webhooks/${hook.id}/test`);
      toast(
        result.ok
          ? t('Testnachricht an {name} geschickt', { name: hook.name })
          : t('Fehlgeschlagen: {error}', { error: result.error ?? String(result.status) })
      );
      void load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setTesting(null);
    }
  };

  const remove = async (hook: Webhook) => {
    if (!(await confirm({ title: t('„{name}“ entfernen?', { name: hook.name }), confirm: t('Entfernen'), danger: true }))) return;
    try {
      await api.delete(`/api/admin/webhooks/${hook.id}`);
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Section
      title={t('Meldungen an andere Dienste')}
      description={t(
        'Wichtige Ereignisse schickt MoeCloud an Discord, Slack, Matrix, Telegram, ntfy oder einen eigenen Webhook. Die Glocke und E-Mails an Admins gibt es zusätzlich.'
      )}
      action={
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing({ hook: null })}>
          {t('Ziel hinzufügen')}
        </Button>
      }
    >
      {!hooks ? (
        <Loading />
      ) : hooks.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: c.onSurfaceVariant }}>
          <WebhookRounded />
          <Typography variant="body2">{t('Noch kein Ziel eingerichtet.')}</Typography>
        </Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {hooks.map((hook) => (
            <Box
              component="li"
              key={hook.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                borderRadius: `${radius.md}px`,
                bgcolor: c.surfaceContainer,
                flexWrap: 'wrap',
              }}
            >
              <StatusDot tone={!hook.enabled ? 'off' : hook.lastError ? 'error' : hook.lastAt ? 'ok' : 'off'} />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {hook.name}
                  </Typography>
                  <Chip size="small" label={KIND_NAMES[hook.kind]} variant="outlined" />
                  {!hook.enabled && <Chip size="small" label={t('Pausiert')} />}
                </Box>
                <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                  {hook.events
                    .filter((event) => event !== 'test')
                    .map(eventLabel)
                    .join(', ') || t('Keine Ereignisse')}
                </Typography>
                {hook.lastAt && (
                  <Typography variant="caption" component="p" sx={{ color: hook.lastError ? c.error : c.onSurfaceVariant }}>
                    {hook.lastError
                      ? t('Zuletzt fehlgeschlagen am {date}: {error}', { date: formatDateTime(hook.lastAt), error: hook.lastError })
                      : t('Zuletzt zugestellt am {date}', { date: formatDateTime(hook.lastAt) })}
                  </Typography>
                )}
              </Box>
              <Tooltip title={t('Testnachricht senden')}>
                <span>
                  <IconButton
                    aria-label={t('Testnachricht an {name} senden', { name: hook.name })}
                    disabled={testing === hook.id}
                    onClick={() => void test(hook)}
                  >
                    <SendRounded />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('Bearbeiten')}>
                <IconButton aria-label={t('{name} bearbeiten', { name: hook.name })} onClick={() => setEditing({ hook })}>
                  <EditRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Entfernen')}>
                <IconButton aria-label={t('{name} entfernen', { name: hook.name })} onClick={() => void remove(hook)}>
                  <DeleteOutlineRounded />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <WebhookDialog hook={editing?.hook ?? null} open={Boolean(editing)} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </Section>
  );
}
