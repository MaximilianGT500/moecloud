import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import PersonAddRounded from '@mui/icons-material/PersonAddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatBytes, formatDate, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, fonts, radius } from '../../theme/tokens';
import { Section, UserAvatar } from '../common/bits';
import { confirm } from '../common/dialogs';
import { QuotaField } from '../common/QuotaField';
import { toast } from '../common/toast';
import { Loading } from './shared';

export interface AdminUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'user';
  initials: string;
  disabled: boolean;
  quota: number | null;
  effectiveQuota: number | null;
  used: number;
  totp: boolean;
  passkeys: number;
  needs2fa: boolean;
  hasPassword: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  sessions: number;
  links: number;
  files: number;
}

function DeleteDialog({
  user,
  people,
  onClose,
  onDeleted,
}: {
  user: AdminUser | null;
  people: AdminUser[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<'delete' | 'transfer'>('transfer');
  const [target, setTarget] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const others = people.filter((person) => person.id !== user?.id && !person.disabled);
  const me = boot().user!;
  const [current, setCurrent] = useState<number | null>(null);
  if (user && current !== user.id) {
    setCurrent(user.id);
    setMode(user.files > 0 ? 'transfer' : 'delete');
    setTarget(others.some((person) => person.id === me.id) ? me.id : (others[0]?.id ?? ''));
  }

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/users/${user.id}${mode === 'transfer' && target ? `?transfer=${target}` : ''}`);
      toast(t('{name} ist gelöscht', { name: user.name }));
      onDeleted();
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{user ? t('{name} löschen?', { name: user.name }) : ''}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <DialogContentText>
          {user
            ? t('Das Konto, alle Freigaben und Links von {name} verschwinden. Das lässt sich nicht rückgängig machen.', { name: user.name })
            : ''}
        </DialogContentText>
        {user && user.files > 0 && (
          <RadioGroup value={mode} onChange={(event) => setMode(event.target.value as 'delete' | 'transfer')}>
            <FormControlLabel
              value="transfer"
              control={<Radio />}
              disabled={others.length === 0}
              label={tn(user.files, '{count} Datei an eine andere Person übertragen', '{count} Dateien an eine andere Person übertragen')}
            />
            {mode === 'transfer' && others.length > 0 && (
              <TextField
                select
                label={t('Neue Besitzerin oder neuer Besitzer')}
                value={target}
                onChange={(event) => setTarget(Number(event.target.value))}
                helperText={t('Die Dateien landen dort in einem Ordner „Von {name}“.', { name: user.name })}
                sx={{ ml: 4, mb: 1 }}
              >
                {others.map((person) => (
                  <MenuItem key={person.id} value={person.id}>
                    {person.name} (@{person.username})
                  </MenuItem>
                ))}
              </TextField>
            )}
            <FormControlLabel
              value="delete"
              control={<Radio />}
              label={
                <Typography sx={{ color: c.error }}>
                  {tn(user.files, '{count} Datei endgültig löschen', '{count} Dateien endgültig löschen')}
                </Typography>
              }
            />
          </RadioGroup>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Abbrechen')}</Button>
        <Button
          variant="contained"
          disabled={busy || (mode === 'transfer' && Boolean(user?.files) && !target)}
          onClick={() => void submit()}
          sx={{ bgcolor: c.error, color: c.onError, '&:hover': { bgcolor: c.error } }}
        >
          {t('Konto löschen')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UserDialog({
  user,
  open,
  mail,
  onClose,
  onSaved,
  onDelete,
}: {
  user: AdminUser | null;
  open: boolean;
  mail: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (user: AdminUser) => void;
}) {
  const empty = {
    name: '',
    username: '',
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user',
    quota: null as number | null,
    disabled: false,
    sendLink: false,
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const me = boot().user!;
  const key = open ? `${user?.id ?? 'new'}` : null;
  if (key !== current) {
    setCurrent(key);
    if (open) {
      setForm({
        name: user?.name ?? '',
        username: user?.username ?? '',
        email: user?.email ?? '',
        password: '',
        role: user?.role ?? 'user',
        quota: user?.quota ?? null,
        disabled: user?.disabled ?? false,
        sendLink: !user && mail,
      });
    }
  }

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const linkMode = !user && form.sendLink && mail;

  const save = async () => {
    setBusy(true);
    try {
      if (user) {
        await api.patch(`/api/admin/users/${user.id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
          quota: form.quota,
          disabled: form.disabled,
          ...(form.password ? { password: form.password } : {}),
        });
        toast(t('Gespeichert'));
      } else {
        const result = await api.post<{ sent: boolean }>('/api/admin/users', {
          name: form.name,
          username: form.username,
          email: form.email,
          role: form.role,
          quota: form.quota,
          ...(linkMode ? { sendLink: true } : { password: form.password }),
        });
        toast(
          result.sent
            ? t('{name} ist angelegt und bekommt eine E-Mail', { name: form.name })
            : t('{name} ist angelegt', { name: form.name })
        );
      }
      onSaved();
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const self = user?.id === me.id;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{user ? t('{name} bearbeiten', { name: user.name }) : t('Person anlegen')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, pt: '8px !important' }}>
          <TextField label={t('Name')} value={form.name} onChange={(event) => set({ name: event.target.value })} required />
          <TextField
            label={t('Benutzername')}
            value={form.username}
            onChange={(event) => set({ username: event.target.value })}
            required
            disabled={Boolean(user)}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          />
          <TextField
            label={t('E-Mail')}
            type="email"
            value={form.email}
            onChange={(event) => set({ email: event.target.value })}
            required={linkMode}
          />
          <TextField
            select
            label={t('Rolle')}
            value={form.role}
            onChange={(event) => set({ role: event.target.value as 'admin' | 'user' })}
            disabled={self}
          >
            <MenuItem value="user">{t('Mitglied')}</MenuItem>
            <MenuItem value="admin">{t('Admin')}</MenuItem>
          </TextField>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <QuotaField label={t('Speicher')} value={form.quota} allowDefault onChange={(quota) => set({ quota })} />
          </Box>
          {!user && mail && (
            <FormControlLabel
              sx={{ gridColumn: '1 / -1', m: 0, gap: 1 }}
              control={<Switch checked={form.sendLink} onChange={(event) => set({ sendLink: event.target.checked })} />}
              label={t('Link per E-Mail schicken, damit die Person ihr Passwort selbst wählt')}
            />
          )}
          {!linkMode && (
            <TextField
              sx={{ gridColumn: '1 / -1' }}
              label={user ? t('Neues Passwort (freiwillig)') : t('Passwort')}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => set({ password: event.target.value })}
              required={!user}
              helperText={
                user
                  ? t('Setzt du ein neues Passwort, wird die Person überall abgemeldet.')
                  : t('Mindestens 10 Zeichen. Gib es der Person auf einem sicheren Weg.')
              }
            />
          )}
          {user && !self && (
            <FormControlLabel
              sx={{ gridColumn: '1 / -1' }}
              control={<Switch checked={form.disabled} onChange={(event) => set({ disabled: event.target.checked })} />}
              label={t('Konto sperren')}
            />
          )}
          {user && (
            <Box sx={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {[
                  tn(user.files, '{count} Datei', '{count} Dateien'),
                  tn(user.links, '{count} Link', '{count} Links'),
                  tn(user.sessions, '{count} Sitzung', '{count} Sitzungen'),
                  user.passkeys ? tn(user.passkeys, '{count} Passkey', '{count} Passkeys') : null,
                  t('seit {date}', { date: formatDate(user.createdAt) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {mail && user.email && (
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      try {
                        await api.post(`/api/admin/users/${user.id}/send-reset`);
                        toast(t('E-Mail an {email} ist unterwegs', { email: user.email ?? '' }));
                      } catch (error) {
                        toast(errorText(error));
                      }
                    }}
                  >
                    {t('Link zum Zurücksetzen schicken')}
                  </Button>
                )}
                {user.totp && (
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t('Authenticator-App zurücksetzen?'),
                          text: t('{name} meldet sich danach nur mit Passwort oder Passkey an.', { name: user.name }),
                          confirm: t('Zurücksetzen'),
                        }))
                      )
                        return;
                      await api.post(`/api/admin/users/${user.id}/reset-2fa`).catch((error) => toast(errorText(error)));
                      toast(t('Zurückgesetzt'));
                      onSaved();
                    }}
                  >
                    {t('Authenticator-App zurücksetzen')}
                  </Button>
                )}
                {user.passkeys > 0 && (
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t('Alle Passkeys entfernen?'),
                          text: t('Hilft, wenn {name} das Gerät mit dem Passkey verloren hat.', { name: user.name }),
                          confirm: t('Entfernen'),
                          danger: true,
                        }))
                      )
                        return;
                      await api.post(`/api/admin/users/${user.id}/reset-passkeys`).catch((error) => toast(errorText(error)));
                      toast(t('Passkeys entfernt'));
                      onSaved();
                    }}
                  >
                    {t('Passkeys entfernen')}
                  </Button>
                )}
                {!self && user.sessions > 0 && (
                  <Button
                    variant="tonal"
                    onClick={async () => {
                      await api.post(`/api/admin/users/${user.id}/logout`).catch((error) => toast(errorText(error)));
                      toast(t('{name} ist überall abgemeldet', { name: user.name }));
                      onSaved();
                    }}
                  >
                    {t('Überall abmelden')}
                  </Button>
                )}
                {!self && (
                  <Button sx={{ color: c.error, ml: 'auto' }} startIcon={<DeleteOutlineRounded />} onClick={() => onDelete(user)}>
                    {t('Löschen')}
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {user ? t('Speichern') : t('Anlegen')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

interface ImportLine {
  line: number;
  username: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  quota: number | null;
  status: 'ready' | 'created' | 'skipped' | 'error';
  message: string | null;
  sent?: boolean;
}

const IMPORT_EXAMPLE = 'username;name;email;role;quota\nlea;Lea;lea@example.com;user;10 GB\nmia;Mia;mia@example.com;admin;';

function ImportDialog({ open, mail, onClose, onDone }: { open: boolean; mail: boolean; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [sendLinks, setSendLinks] = useState(true);
  const [lines, setLines] = useState<ImportLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCsv('');
    setLines(null);
    setDone(false);
  };

  const send = async (apply: boolean) => {
    setBusy(true);
    try {
      const result = await api.post<{ lines: ImportLine[]; created: number }>('/api/admin/users/import', { csv, sendLinks, apply });
      setLines(result.lines);
      if (apply) {
        setDone(true);
        toast(tn(result.created, 'Eine Person angelegt', '{count} Personen angelegt'));
        onDone();
      }
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const ready = lines?.filter((line) => line.status === 'ready').length ?? 0;
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const label: Record<ImportLine['status'], string> = {
    ready: t('Bereit'),
    created: t('Angelegt'),
    skipped: t('Übersprungen'),
    error: t('Fehler'),
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{t('Personen aus CSV importieren')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!lines ? (
          <>
            <DialogContentText>
              {t(
                'Die erste Zeile nennt die Spalten. Pflicht sind username und name, dazu passen email, role, quota, password und language. Trenne mit Komma oder Semikolon.'
              )}
            </DialogContentText>
            <Box
              component="pre"
              sx={{ m: 0, p: 1.5, borderRadius: `${radius.sm}px`, bgcolor: c.surfaceContainerHigh, fontSize: 13, overflowX: 'auto' }}
            >
              {IMPORT_EXAMPLE}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button component="label" variant="tonal" startIcon={<UploadFileRounded />} disabled={busy}>
                {t('CSV-Datei wählen')}
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void file.text().then(setCsv);
                  }}
                />
              </Button>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('oder füge den Inhalt unten ein')}
              </Typography>
            </Box>
            <TextField
              multiline
              minRows={5}
              maxRows={12}
              label={t('CSV')}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: fonts.mono, fontSize: 13 } } }}
            />
            <FormControlLabel
              disabled={!mail || busy}
              control={<Switch checked={sendLinks && mail} onChange={(event) => setSendLinks(event.target.checked)} />}
              label={
                mail ? t('Wer kein Passwort hat, bekommt einen Link per E-Mail') : t('Ohne E-Mail-Versand braucht jede Person ein Passwort')
              }
            />
          </>
        ) : (
          <>
            <DialogContentText>
              {done
                ? t('Fertig. So ist es gelaufen:')
                : ready
                  ? tn(ready, 'Eine Person kann angelegt werden.', '{count} Personen können angelegt werden.')
                  : t('Niemand aus der Datei kann angelegt werden.')}
            </DialogContentText>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {lines.map((line) => (
                <Box
                  component="li"
                  key={line.line}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1,
                    borderRadius: `${radius.sm}px`,
                    bgcolor: c.surfaceContainerLow,
                  }}
                >
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant, minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>
                    {line.line}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {line.name || line.username} {line.username ? `@${line.username}` : ''}
                    </Typography>
                    <Typography variant="caption" component="p" sx={{ color: line.status === 'error' ? c.error : c.onSurfaceVariant }}>
                      {line.message ??
                        [
                          line.email,
                          line.role === 'admin' ? t('Admin') : null,
                          line.quota ? formatBytes(line.quota) : null,
                          line.sent ? t('Link verschickt') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={label[line.status]}
                    sx={
                      line.status === 'error'
                        ? { bgcolor: c.errorContainer, color: c.onErrorContainer }
                        : line.status === 'skipped'
                          ? undefined
                          : { bgcolor: c.primaryContainer, color: c.onPrimaryContainer }
                    }
                  />
                </Box>
              ))}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {lines && !done && (
          <Button onClick={() => setLines(null)} disabled={busy} sx={{ mr: 'auto' }}>
            {t('Zurück')}
          </Button>
        )}
        <Button onClick={close} disabled={busy}>
          {done ? t('Schließen') : t('Abbrechen')}
        </Button>
        {!lines && (
          <Button variant="contained" onClick={() => void send(false)} disabled={busy || !csv.trim()}>
            {t('Prüfen')}
          </Button>
        )}
        {lines && !done && (
          <Button variant="contained" onClick={() => void send(true)} disabled={busy || !ready}>
            {tn(ready, 'Eine Person anlegen', '{count} Personen anlegen')}
          </Button>
        )}
      </DialogActions>
      {busy && <LinearProgress aria-label={t('Lädt')} />}
    </Dialog>
  );
}

export function PeopleSection() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [mail, setMail] = useState(false);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ user: AdminUser | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const load = () =>
    api
      .get<{ items: AdminUser[]; mail: boolean }>('/api/admin/users')
      .then((result) => {
        setUsers(result.items);
        setMail(result.mail);
      })
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  const query = filter.trim().toLowerCase();
  const shown = (users ?? []).filter(
    (user) =>
      !query ||
      user.name.toLowerCase().includes(query) ||
      user.username.toLowerCase().includes(query) ||
      (user.email ?? '').toLowerCase().includes(query)
  );
  const total = (users ?? []).reduce((sum, user) => sum + user.used, 0);

  return (
    <Section
      title={t('Alle Konten')}
      description={
        users ? `${tn(users.length, '{count} Konto', '{count} Konten')} · ${t('zusammen {size}', { size: formatBytes(total) })}` : undefined
      }
      action={
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="tonal" startIcon={<UploadFileRounded />} onClick={() => setImporting(true)}>
            {t('Importieren')}
          </Button>
          <Button variant="contained" startIcon={<PersonAddRounded />} onClick={() => setEditing({ user: null })}>
            {t('Person anlegen')}
          </Button>
        </Box>
      }
    >
      {!users ? (
        <Loading />
      ) : (
        <>
          {users.length > 6 && (
            <TextField
              size="small"
              placeholder={t('Nach Name, Benutzername oder E-Mail suchen')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              slotProps={{
                htmlInput: { 'aria-label': t('Personen durchsuchen') },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ maxWidth: 420 }}
            />
          )}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {shown.map((user) => {
              const percent = user.effectiveQuota ? Math.min(100, (user.used / user.effectiveQuota) * 100) : null;
              return (
                <Box component="li" key={user.id}>
                  <ButtonBase
                    onClick={() => setEditing({ user })}
                    sx={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      gap: 2,
                      p: 1.5,
                      borderRadius: `${radius.md}px`,
                      '&:hover': { bgcolor: c.surfaceContainer },
                      flexWrap: { xs: 'wrap', sm: 'nowrap' },
                      opacity: user.disabled ? 0.7 : 1,
                    }}
                  >
                    <UserAvatar initials={user.initials} size={44} />
                    <Box sx={{ flex: 1, minWidth: 160 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2">{user.name}</Typography>
                        {user.role === 'admin' && (
                          <Chip size="small" label={t('Admin')} sx={{ bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer }} />
                        )}
                        {user.disabled && (
                          <Chip size="small" label={t('Gesperrt')} sx={{ bgcolor: c.errorContainer, color: c.onErrorContainer }} />
                        )}
                        {(user.totp || user.passkeys > 0) && (
                          <Chip size="small" label={user.totp ? '2FA' : t('Passkey')} variant="outlined" />
                        )}
                        {user.needs2fa && !user.disabled && (
                          <Chip size="small" label={t('2FA fehlt')} sx={{ bgcolor: c.errorContainer, color: c.onErrorContainer }} />
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        @{user.username}
                        {user.email ? ` · ${user.email}` : ''}
                        {user.lastLoginAt
                          ? ` · ${t('zuletzt {date}', { date: formatDate(user.lastLoginAt) })}`
                          : ` · ${t('noch nie angemeldet')}`}
                      </Typography>
                    </Box>
                    <Box sx={{ width: { xs: '100%', sm: 200 }, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {percent !== null && (
                        <LinearProgress
                          variant="determinate"
                          value={percent}
                          aria-label={t('Speicher von {name}', { name: user.name })}
                          sx={{ '& .MuiLinearProgress-bar': { bgcolor: percent > 90 ? c.error : c.primary } }}
                        />
                      )}
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {user.effectiveQuota
                          ? t('{used} von {quota}', { used: formatBytes(user.used), quota: formatBytes(user.effectiveQuota) })
                          : t('{used}, unbegrenzt', { used: formatBytes(user.used) })}
                        {` · ${formatNumber(user.files)}`}
                      </Typography>
                    </Box>
                    <EditRounded sx={{ color: c.onSurfaceVariant, display: { xs: 'none', sm: 'block' } }} />
                  </ButtonBase>
                </Box>
              );
            })}
          </Box>
          {shown.length === 0 && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Niemand passt zu dieser Suche.')}
            </Typography>
          )}
        </>
      )}
      <UserDialog
        user={editing?.user ?? null}
        open={Boolean(editing)}
        mail={mail}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
        onDelete={(user) => {
          setEditing(null);
          setDeleting(user);
        }}
      />
      <DeleteDialog user={deleting} people={users ?? []} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
      <ImportDialog open={importing} mail={mail} onClose={() => setImporting(false)} onDone={() => void load()} />
    </Section>
  );
}
