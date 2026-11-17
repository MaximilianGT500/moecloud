import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ExtensionRounded from '@mui/icons-material/ExtensionRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { api, csrfToken, errorText } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, fonts, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { refreshPlugins } from '../common/plugins';
import { toast } from '../common/toast';
import { Facts, Loading, StatusDot, Toggle } from './shared';

type Status = 'invalid' | 'off' | 'changed' | 'active' | 'failed' | 'stopped';
type Permission = 'network' | 'files' | 'users' | 'notify';
type Value = string | number | boolean | null;

interface Field {
  key: string;
  label: string;
  hint: string;
  type: 'text' | 'textarea' | 'secret' | 'number' | 'boolean' | 'select';
  required: boolean;
  min: number | null;
  max: number | null;
  options: { value: string; label: string }[];
  value: Value;
  filled?: boolean;
}

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  status: Status;
  error: string | null;
  hash: string;
  files: number;
  bytes: number;
  permissions: Permission[];
  settings: Field[];
  actions: string[];
  pages: string[];
  themes: number;
  routes: number;
  jobs: number;
  events: string[];
  errors: number;
  lastError: { message: string; where: string; at: number } | null;
}

interface Example {
  id: string;
  name: string;
  description: string;
  version: string;
  installed: boolean;
}

interface PluginList {
  enabled: boolean;
  dev: boolean;
  upload: boolean;
  dir: string;
  items: Plugin[];
  examples: Example[];
}

function statusLabel(status: Status) {
  switch (status) {
    case 'active':
      return t('Läuft');
    case 'changed':
      return t('Geändert');
    case 'failed':
      return t('Start misslungen');
    case 'stopped':
      return t('Angehalten');
    case 'invalid':
      return t('Ungültig');
    default:
      return t('Aus');
  }
}

const toneOf = (plugin: Plugin) =>
  plugin.status === 'active'
    ? plugin.lastError
      ? 'warn'
      : 'ok'
    : plugin.status === 'failed' || plugin.status === 'invalid'
      ? 'error'
      : plugin.status === 'changed' || plugin.status === 'stopped'
        ? 'warn'
        : 'off';

function permissionLabel(permission: Permission): [string, string] {
  switch (permission) {
    case 'network':
      return [t('Internet'), t('Ruft Adressen im Netz auf')];
    case 'files':
      return [t('Dateien'), t('Liest und schreibt Dateien in den Konten')];
    case 'users':
      return [t('Personen'), t('Sieht die Liste der Konten')];
    default:
      return [t('Benachrichtigungen'), t('Schickt Nachrichten in die Glocke und per E-Mail')];
  }
}

function brings(plugin: Plugin) {
  const parts: string[] = [];
  if (plugin.actions.length) parts.push(tn(plugin.actions.length, 'eine Aktion im Dateimenü', '{count} Aktionen im Dateimenü'));
  if (plugin.pages.length) parts.push(tn(plugin.pages.length, 'eine Seite', '{count} Seiten'));
  if (plugin.themes) parts.push(tn(plugin.themes, 'ein Theme', '{count} Themes'));
  if (plugin.routes) parts.push(tn(plugin.routes, 'eine Route', '{count} Routen'));
  if (plugin.jobs) parts.push(tn(plugin.jobs, 'eine Aufgabe', '{count} Aufgaben'));
  if (plugin.events.length) parts.push(tn(plugin.events.length, 'ein Ereignis', '{count} Ereignisse'));
  return parts;
}

function TrustDialog({ plugin, busy, onClose, onConfirm }: { plugin: Plugin; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const offers = brings(plugin);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {plugin.status === 'changed'
          ? t('„{name}“ neu freigeben?', { name: plugin.name })
          : t('„{name}“ einschalten?', { name: plugin.name })}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="warning">
          {t(
            'Ein Plugin läuft mit allen Rechten von MoeCloud und kann alles lesen und ändern, was der Server kann. Schalte es nur ein, wenn du den Code geprüft hast oder der Quelle vertraust.'
          )}
        </Alert>
        <Facts
          rows={[
            [t('Version'), plugin.version],
            ...(plugin.author ? ([[t('Von'), plugin.author]] as [string, string][]) : []),
            [t('Umfang'), `${tn(plugin.files, 'eine Datei', '{count} Dateien')}, ${formatBytes(plugin.bytes)}`],
            [
              t('Prüfsumme'),
              <Box key="hash" component="span" title={plugin.hash} sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem' }}>
                {plugin.hash.slice(0, 16)}
              </Box>,
            ],
          ]}
        />
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t('Das gibt das Plugin an')}
          </Typography>
          {plugin.permissions.length === 0 && offers.length === 0 ? (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Keine besonderen Zugriffe.')}
            </Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {plugin.permissions.map((permission) => {
                const [label, hint] = permissionLabel(permission);
                return (
                  <Typography key={permission} component="li" variant="body2">
                    <strong>{label}</strong>: {hint}
                  </Typography>
                );
              })}
              {offers.length > 0 && (
                <Typography component="li" variant="body2">
                  <strong>{t('Bringt mit')}</strong>: {offers.join(', ')}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('MoeCloud merkt sich die Prüfsumme. Ändert sich eine Datei des Plugins, hält es an, bis du es neu freigibst.')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button variant="contained" disabled={busy} onClick={onConfirm}>
          {plugin.status === 'changed' ? t('Neu freigeben') : t('Einschalten')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SettingsDialog({ plugin, onClose, onSaved }: { plugin: Plugin; onClose: () => void; onSaved: (list: PluginList) => void }) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(plugin.settings.map((field) => [field.key, field.type === 'secret' ? '' : field.value]))
  );
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: Value) => setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, Value> = {};
      for (const field of plugin.settings) {
        const value = values[field.key];
        if (field.type === 'secret') {
          if (value) body[field.key] = value;
        } else if (field.type === 'number') {
          body[field.key] = value === '' || value === null ? null : Number(value);
        } else {
          body[field.key] = value;
        }
      }
      const result = await api.put<PluginList>(`/api/admin/plugins/${plugin.id}/settings`, { values: body });
      toast(t('Gespeichert'));
      onSaved(result);
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{t('Einstellungen von „{name}“', { name: plugin.name })}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {plugin.settings.map((field) => {
            const value = values[field.key];
            if (field.type === 'boolean') {
              return (
                <Toggle
                  key={field.key}
                  checked={value === true}
                  onChange={(next) => set(field.key, next)}
                  label={field.label}
                  hint={field.hint || undefined}
                />
              );
            }
            if (field.type === 'select') {
              return (
                <TextField
                  key={field.key}
                  select
                  label={field.label}
                  helperText={field.hint || undefined}
                  required={field.required}
                  value={String(value ?? '')}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  {field.options.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              );
            }
            return (
              <TextField
                key={field.key}
                label={field.label}
                helperText={field.hint || undefined}
                type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                multiline={field.type === 'textarea'}
                minRows={field.type === 'textarea' ? 3 : undefined}
                autoComplete="off"
                required={field.required && !(field.type === 'secret' && field.filled)}
                placeholder={field.type === 'secret' && field.filled ? t('Gespeichert, leer lassen zum Behalten') : undefined}
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(event) => set(field.key, event.target.value)}
                slotProps={{
                  htmlInput: {
                    maxLength: field.type === 'number' ? undefined : 5000,
                    min: field.min ?? undefined,
                    max: field.max ?? undefined,
                  },
                  inputLabel: field.type === 'secret' && field.filled ? { shrink: true } : undefined,
                }}
              />
            );
          })}
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

export function PluginsSection() {
  const [list, setList] = useState<PluginList | null>(null);
  const [busy, setBusy] = useState(false);
  const [trusting, setTrusting] = useState<Plugin | null>(null);
  const [configuring, setConfiguring] = useState<Plugin | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const adopt = (next: PluginList) => {
    setList(next);
    void refreshPlugins();
  };

  const rescan = async (quiet = false) => {
    setBusy(true);
    try {
      adopt(await api.post<PluginList>('/api/admin/plugins/rescan'));
      if (!quiet) toast(t('Der Ordner ist neu eingelesen'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void rescan(true);
  }, []);

  const enable = async (plugin: Plugin) => {
    setBusy(true);
    try {
      adopt(await api.post<PluginList>(`/api/admin/plugins/${plugin.id}/enable`, { hash: plugin.hash }));
      toast(t('„{name}“ läuft', { name: plugin.name }));
      setTrusting(null);
    } catch (error) {
      toast(errorText(error));
      void rescan(true);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (plugin: Plugin) => {
    setBusy(true);
    try {
      adopt(await api.post<PluginList>(`/api/admin/plugins/${plugin.id}/disable`));
      toast(t('„{name}“ ist aus', { name: plugin.name }));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const start = (plugin: Plugin) => {
    const missing = plugin.settings.find(
      (field) =>
        field.required && field.type !== 'boolean' && (field.type === 'secret' ? !field.filled : field.value === '' || field.value === null)
    );
    if (missing) {
      toast(t('Trag zuerst die Einstellungen ein, es fehlt „{label}“', { label: missing.label }));
      setConfiguring(plugin);
      return;
    }
    if (plugin.status === 'failed' || plugin.status === 'stopped') void enable(plugin);
    else setTrusting(plugin);
  };

  const remove = async (plugin: Plugin) => {
    const sure = await confirm({
      title: t('„{name}“ entfernen?', { name: plugin.name }),
      text: t('Der Ordner des Plugins, seine Einstellungen und seine gespeicherten Daten werden gelöscht.'),
      confirm: t('Entfernen'),
      danger: true,
    });
    if (!sure) return;
    setBusy(true);
    try {
      adopt(await api.delete<PluginList>(`/api/admin/plugins/${plugin.id}`));
      toast(t('„{name}“ ist entfernt', { name: plugin.name }));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const addExample = async (example: Example) => {
    setBusy(true);
    try {
      adopt(await api.post<PluginList>(`/api/admin/plugins/examples/${example.id}`));
      toast(t('„{name}“ liegt jetzt im Ordner. Schau es dir an und schalte es ein.', { name: example.name }));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/plugins/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken() },
        body: picked,
      });
      const data = (await response.json().catch(() => ({}))) as PluginList & {
        installed?: { id: string; version: string };
        error?: { message?: string };
      };
      if (!response.ok || !data.installed) {
        toast(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal'));
        return;
      }
      adopt(data);
      toast(
        t('„{name}“ {version} ist eingespielt. Prüf es und schalte es ein.', { name: data.installed.id, version: data.installed.version })
      );
    } catch {
      toast(t('Keine Verbindung zum Server, prüf dein Netz'));
    } finally {
      setBusy(false);
    }
  };

  if (!list) {
    return (
      <Section title={t('Plugins auf diesem Server')}>
        <Loading />
      </Section>
    );
  }

  return (
    <Section
      title={t('Plugins auf diesem Server')}
      description={t(
        'Plugins erweitern MoeCloud um Aktionen im Dateimenü, eigene Seiten, Regeln für Uploads, Aufgaben und Themes. Sie laufen auf dem Server und starten erst, wenn du sie hier freigibst.'
      )}
      action={
        list.enabled ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {list.upload && (
              <Button variant="contained" startIcon={<UploadFileRounded />} disabled={busy} onClick={() => file.current?.click()}>
                {t('Plugin hochladen')}
              </Button>
            )}
            <Button variant="tonal" startIcon={<RefreshRounded />} disabled={busy} onClick={() => void rescan()}>
              {t('Neu einlesen')}
            </Button>
            <input
              ref={file}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </Box>
        ) : undefined
      }
    >
      {!list.enabled && <Alert severity="info">{t('Plugins sind auf diesem Server mit PLUGINS=off abgeschaltet.')}</Alert>}
      {list.enabled && list.dev && (
        <Alert severity="warning">
          {t(
            'Der Entwicklermodus ist an. MoeCloud prüft keine Prüfsummen und lädt freigegebene Plugins neu, sobald sich ihre Dateien ändern.'
          )}
        </Alert>
      )}
      {list.enabled && list.items.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, color: c.onSurfaceVariant }}>
          <ExtensionRounded />
          <Typography variant="body2">
            {t('Noch kein Plugin gefunden. Leg den Ordner eines Plugins auf dem Server hierhin und lies neu ein:')}{' '}
            <Box component="code" sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
              {list.dir}
            </Box>
          </Typography>
        </Box>
      )}
      {list.items.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {list.items.map((plugin) => {
            const offers = brings(plugin);
            const on = plugin.status !== 'off' && plugin.status !== 'invalid';
            return (
              <Box
                component="li"
                key={plugin.id}
                sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <StatusDot tone={toneOf(plugin)} />
                  <Box sx={{ flex: 1, minWidth: 180 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
                        {plugin.name}
                      </Typography>
                      {plugin.version && <Chip size="small" variant="outlined" label={plugin.version} />}
                      <Chip
                        size="small"
                        label={statusLabel(plugin.status)}
                        sx={plugin.status === 'active' ? { bgcolor: c.secondaryContainer, color: c.onSecondaryContainer } : undefined}
                      />
                    </Box>
                    {(plugin.author || plugin.homepage) && (
                      <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                        {plugin.author}
                        {plugin.author && plugin.homepage ? ' · ' : ''}
                        {plugin.homepage && (
                          <Link href={plugin.homepage} target="_blank" rel="noopener noreferrer" color="inherit">
                            {plugin.homepage.replace(/^https:\/\//, '').replace(/\/$/, '')}
                          </Link>
                        )}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    {plugin.settings.length > 0 && (
                      <Tooltip title={t('Einstellungen')}>
                        <IconButton
                          aria-label={t('Einstellungen von „{name}“', { name: plugin.name })}
                          onClick={() => setConfiguring(plugin)}
                        >
                          <TuneRounded />
                        </IconButton>
                      </Tooltip>
                    )}
                    {list.upload && (
                      <Tooltip title={t('Entfernen')}>
                        <IconButton
                          aria-label={t('{name} entfernen', { name: plugin.name })}
                          disabled={busy}
                          onClick={() => void remove(plugin)}
                        >
                          <DeleteOutlineRounded />
                        </IconButton>
                      </Tooltip>
                    )}
                    {on && (
                      <Button disabled={busy} onClick={() => void disable(plugin)}>
                        {t('Ausschalten')}
                      </Button>
                    )}
                    {plugin.status === 'off' && (
                      <Button variant="tonal" disabled={busy} onClick={() => start(plugin)}>
                        {t('Einschalten')}
                      </Button>
                    )}
                    {plugin.status === 'changed' && (
                      <Button variant="contained" disabled={busy} onClick={() => start(plugin)}>
                        {t('Neu freigeben')}
                      </Button>
                    )}
                    {(plugin.status === 'failed' || plugin.status === 'stopped') && (
                      <Button variant="tonal" disabled={busy} onClick={() => start(plugin)}>
                        {t('Nochmal starten')}
                      </Button>
                    )}
                  </Box>
                </Box>
                {plugin.description && <Typography variant="body2">{plugin.description}</Typography>}
                {(plugin.permissions.length > 0 || offers.length > 0) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    {plugin.permissions.map((permission) => {
                      const [label, hint] = permissionLabel(permission);
                      return (
                        <Tooltip key={permission} title={hint}>
                          <Chip size="small" variant="outlined" label={label} tabIndex={0} />
                        </Tooltip>
                      );
                    })}
                    {offers.length > 0 && (
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {offers.join(' · ')}
                      </Typography>
                    )}
                  </Box>
                )}
                {plugin.status === 'changed' && (
                  <Alert severity="warning">
                    {t('Die Dateien haben sich seit der Freigabe geändert. Das Plugin steht still, bis du es neu freigibst.')}
                  </Alert>
                )}
                {plugin.error && plugin.status !== 'changed' && <Alert severity="error">{plugin.error}</Alert>}
                {plugin.lastError && plugin.status === 'active' && (
                  <Alert severity="warning">
                    {tn(
                      plugin.errors,
                      'Ein Fehler seit dem Start, zuletzt am {date} bei „{where}“: {message}',
                      '{count} Fehler seit dem Start, zuletzt am {date} bei „{where}“: {message}',
                      { date: formatDateTime(plugin.lastError.at), where: plugin.lastError.where, message: plugin.lastError.message }
                    )}
                  </Alert>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {list.enabled && list.examples.some((example) => !example.installed) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box>
            <Typography variant="subtitle2" component="h3">
              {t('Mitgelieferte Beispiele')}
            </Typography>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t(
                'Zum Ausprobieren und als Vorlage für eigene Plugins. Hinzufügen legt nur den Ordner an, einschalten musst du danach selbst.'
              )}
            </Typography>
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {list.examples
              .filter((example) => !example.installed)
              .map((example) => (
                <Box component="li" key={example.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {example.name}
                    </Typography>
                    <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                      {example.description}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    disabled={busy}
                    aria-label={t('„{name}“ hinzufügen', { name: example.name })}
                    onClick={() => void addExample(example)}
                  >
                    {t('Hinzufügen')}
                  </Button>
                </Box>
              ))}
          </Box>
        </Box>
      )}
      {list.enabled && (
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {list.upload
            ? t('Plugins liegen auf dem Server in {dir}.', { dir: list.dir })
            : t(
                'Plugins liegen auf dem Server in {dir}. Im Browser hochladen lässt sich nur, wenn der Server mit PLUGIN_UPLOAD=on läuft.',
                { dir: list.dir }
              )}
        </Typography>
      )}
      {trusting && <TrustDialog plugin={trusting} busy={busy} onClose={() => setTrusting(null)} onConfirm={() => void enable(trusting)} />}
      {configuring && <SettingsDialog plugin={configuring} onClose={() => setConfiguring(null)} onSaved={setList} />}
    </Section>
  );
}
