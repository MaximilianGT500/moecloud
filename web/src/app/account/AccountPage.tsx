import { useEffect, useState, type ReactNode } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ComputerRounded from '@mui/icons-material/ComputerRounded';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import FolderZipRounded from '@mui/icons-material/FolderZipRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import FingerprintRounded from '@mui/icons-material/FingerprintRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import LockResetRounded from '@mui/icons-material/LockResetRounded';
import LoginRounded from '@mui/icons-material/LoginRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import PhonelinkLockRounded from '@mui/icons-material/PhonelinkLockRounded';
import SmartphoneRounded from '@mui/icons-material/SmartphoneRounded';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import { api, errorText, logout } from '../../lib/api';
import { boot, type SessionUser, type Storage } from '../../lib/boot';
import { deviceOf, formatDate, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { c, fonts, radius } from '../../theme/tokens';
import { AppShell, DEFAULT_BAR, navEntries } from '../shell/AppShell';
import { ArrangeDialog, type Arrangement } from '../common/Arrange';
import { usePlugins } from '../common/plugins';
import { auditDetail, auditLabel, type AuditEntry } from '../common/audit';
import { CopyField, QrCode, Row, Section, StorageMeter, copyText } from '../common/bits';
import { AvatarEdit } from './AvatarEdit';
import { confirm, prompt } from '../common/dialogs';
import { ThemeModeSelector, ThemeToggleButton } from '../common/ThemeToggle';
import { toast } from '../common/toast';
import { useThemeControl } from '../mount';
import { ThemeChoice } from './ThemeChoice';
import { featureAvailable, featureOn, featuresOff, setFeaturesOff, useFeatures } from '../../lib/features';
import { appCatalog } from '../common/apps';
import type { Feature } from '../../../../shared/features';

interface MailPrefs {
  mailShares: boolean;
  mailUploads: boolean;
  mailComments: boolean;
  mailWatch: boolean;
  mailAdmin: boolean;
  mailLogins: boolean;
  mailReminders: boolean;
  mailPlugins: boolean;
  mailInvites: boolean;
  mailBookings: boolean;
  pushReminders: boolean;
  pushMail: boolean;
  pushChat: boolean;
}

interface Prefs extends MailPrefs {
  features?: string[];
  digest: 'off' | 'daily' | 'weekly';
  quiet: { from: number; to: number } | null;
  zone: string;
  start?: 'files' | 'home';
  nav?: Arrangement | null;
  home?: Arrangement | null;
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minutesOf = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Account {
  user: SessionUser;
  storage: Storage;
  passkeysEnabled: boolean;
  mail: boolean;
  prefs: Prefs;
  webPush: number;
  passwordMin: number;
  expiresAt: number | null;
  selfDelete: boolean;
  plugins?: boolean;
  push: { kind: 'ntfy' | 'gotify'; url: string; hasToken: boolean } | null;
  pushEnabled: boolean;
  security: {
    required: boolean;
    setupRequired: boolean;
    hasPassword: boolean;
    sso: { enabled: boolean } | null;
    totp: boolean;
    recoveryCodes: number;
    passkeys: { id: string; name: string; synced: boolean; createdAt: number; lastUsedAt: number | null }[];
    appPasswords: {
      id: string;
      name: string;
      hint: string;
      createdAt: number;
      lastUsedAt: number | null;
      readOnly?: boolean;
      shared?: boolean;
      admin?: boolean;
      expiresAt?: number | null;
      expired?: boolean;
      paused?: { at: number; count: number; since: number | null } | null;
    }[];
    sessions: {
      id: string;
      current: boolean;
      method: string;
      userAgent: string | null;
      ip: string | null;
      createdAt: number;
      lastSeenAt: number;
    }[];
  };
}

function Field({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>;
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="warning">
        {t('Bewahre diese Codes sicher auf. Jeder funktioniert genau einmal, falls du dein Handy nicht zur Hand hast.')}
      </Alert>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 2,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 1,
          borderRadius: `${radius.md}px`,
          bgcolor: c.surfaceContainer,
          fontFamily: fonts.mono,
          fontSize: '1rem',
          textAlign: 'center',
        }}
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="tonal" onClick={() => void copyText(text, t('Codes kopiert'))}>
          {t('Kopieren')}
        </Button>
        <Button
          variant="tonal"
          startIcon={<DownloadRounded />}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${boot().site.name}\n\n${text}\n`], { type: 'text/plain' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'moecloud-wiederherstellungscodes.txt';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t('Als Datei speichern')}
        </Button>
      </Box>
    </Box>
  );
}

function TotpDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSetup(null);
    setCodes(null);
    setCode('');
    setFailed(null);
    api
      .post<{ secret: string; uri: string }>('/api/account/totp/setup')
      .then(setSetup)
      .catch((error) => setFailed(errorText(error)));
  }, [open]);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/api/account/totp/enable', { code });
      setCodes(result.recoveryCodes);
      onDone();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={codes ? onClose : undefined} fullWidth maxWidth="sm">
      <DialogTitle>{codes ? t('Deine Wiederherstellungscodes') : t('Authenticator-App einrichten')}</DialogTitle>
      <DialogContent>
        {failed ? (
          <Alert severity="error">{failed}</Alert>
        ) : codes ? (
          <RecoveryCodes codes={codes} />
        ) : !setup ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress aria-label={t('Lädt')} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 3, flexWrap: { xs: 'wrap', sm: 'nowrap' }, alignItems: 'flex-start' }}>
            <QrCode value={setup.uri} size={176} label={t('QR-Code für die Authenticator-App')} />
            <Field>
              <DialogContentText>
                {t(
                  'Scanne den Code mit einer Authenticator-App wie Aegis, 2FAS oder Google Authenticator. Gib danach den sechsstelligen Code ein.'
                )}
              </DialogContentText>
              <CopyField value={setup.secret} label={t('Schlüssel zum Abtippen')} />
              <TextField
                label={t('Code aus der App')}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }}
                autoFocus
              />
            </Field>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {codes ? (
          <Button variant="contained" onClick={onClose}>
            {t('Ich habe sie gesichert')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Abbrechen')}</Button>
            <Button variant="contained" disabled={code.length !== 6 || busy} onClick={() => void enable()}>
              {t('Bestätigen')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function CodeDialog({
  open,
  title,
  text,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (code: string) => Promise<string[] | void>;
}) {
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setCode('');
    setCodes(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>{codes ? t('Deine Wiederherstellungscodes') : title}</DialogTitle>
      <DialogContent>
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : (
          <Field>
            <DialogContentText>{text}</DialogContentText>
            <TextField
              label={t('Code')}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              slotProps={{ htmlInput: { autoComplete: 'one-time-code' } }}
            />
          </Field>
        )}
      </DialogContent>
      <DialogActions>
        {codes ? (
          <Button variant="contained" onClick={close}>
            {t('Fertig')}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{t('Abbrechen')}</Button>
            <Button
              variant="contained"
              disabled={!code.trim() || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await onSubmit(code.trim());
                  if (result) setCodes(result);
                  else close();
                } catch (error) {
                  toast(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function DeleteAccountDialog({
  open,
  username,
  hasPassword,
  onClose,
}: {
  open: boolean;
  username: string;
  hasPassword: boolean;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = confirm.trim().toLowerCase() === username.toLowerCase();
  const close = () => {
    if (busy) return;
    setPassword('');
    setConfirm('');
    setError('');
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/account/delete', { password: hasPassword ? password : undefined, confirm: confirm.trim() });
      location.assign('/login');
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && (!hasPassword || password)) void submit();
        }}
      >
        <DialogTitle>{t('Konto endgültig löschen?')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <DialogContentText>
            {t(
              'MoeCloud löscht dein Konto mit allen Dateien, Freigaben, Links, Alben und Einstellungen. Das lässt sich nicht rückgängig machen.'
            )}
          </DialogContentText>
          {error && <Alert severity="error">{error}</Alert>}
          {hasPassword && (
            <TextField
              type="password"
              label={t('Passwort')}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          )}
          <TextField
            label={t('Gib zur Bestätigung „{username}“ ein', { username })}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, autoComplete: 'off' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" color="error" disabled={busy || !matches || (hasPassword && !password)}>
            {t('Endgültig löschen')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function PasswordDialog({ open, hasPassword, min, onClose }: { open: boolean; hasPassword: boolean; min: number; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && next !== repeat;
  const close = () => {
    setCurrent('');
    setNext('');
    setRepeat('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.post('/api/account/password', { current, next });
            toast(t('Passwort geändert. Andere Geräte sind jetzt abgemeldet.'));
            close();
          } catch (error) {
            toast(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <DialogTitle>{hasPassword ? t('Passwort ändern') : t('Passwort festlegen')}</DialogTitle>
        <DialogContent>
          <Field>
            <Box />
            {hasPassword && (
              <TextField
                label={t('Aktuelles Passwort')}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            )}
            <TextField
              label={t('Neues Passwort')}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              helperText={t('Mindestens {count} Zeichen.', { count: min })}
              required
            />
            <TextField
              label={t('Neues Passwort wiederholen')}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              error={mismatch}
              helperText={mismatch ? t('Die Passwörter sind nicht gleich') : ' '}
              required
            />
          </Field>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('Abbrechen')}</Button>
          <Button type="submit" variant="contained" disabled={busy || next.length < min || next !== repeat}>
            {t('Speichern')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function SecureDialog({
  open,
  hasPassword,
  onClose,
  onDone,
}: {
  open: boolean;
  hasPassword: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [sessions, setSessions] = useState(true);
  const [appPasswords, setAppPasswords] = useState(true);
  const [links, setLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const close = () => {
    if (busy) return;
    setPassword('');
    setError('');
    setResult('');
    onClose();
  };
  const options: [boolean, (value: boolean) => void, string, string][] = [
    [
      sessions,
      setSessions,
      t('Alle anderen Geräte abmelden'),
      t('Nur dieser Browser bleibt angemeldet. Offene Links zum Zurücksetzen des Passworts verfallen.'),
    ],
    [
      appPasswords,
      setAppPasswords,
      t('Alle App-Passwörter widerrufen'),
      t('Laufwerke, Apps und Skripte brauchen danach ein neues App-Passwort.'),
    ],
    [
      links,
      setLinks,
      t('Meine öffentlichen Links pausieren'),
      t('Niemand kommt mehr über einen Link an deine Dateien, bis du ihn wieder freigibst.'),
    ],
  ];
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || (hasPassword && !password) || !(sessions || appPasswords || links)) return;
          setBusy(true);
          setError('');
          try {
            const done = await api.post<{ sessions: number; appPasswords: number; links: number }>('/api/account/secure', {
              password: hasPassword ? password : undefined,
              sessions,
              appPasswords,
              links,
            });
            setResult(
              t('Erledigt: {sessions} Sitzungen beendet, {tokens} App-Passwörter widerrufen, {links} Links pausiert', {
                sessions: done.sessions,
                tokens: done.appPasswords,
                links: done.links,
              })
            );
            setPassword('');
            onDone();
          } catch (failure) {
            setError(errorText(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        <DialogTitle>{t('Konto absichern')}</DialogTitle>
        {result ? (
          <>
            <DialogContent>
              <Alert severity="success">{result}</Alert>
            </DialogContent>
            <DialogActions>
              <Button variant="contained" onClick={close}>
                {t('Fertig')}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <DialogContentText>
                {t(
                  'Für den Fall, dass ein Gerät weg ist oder jemand an dein Konto gekommen sein könnte. Ändere danach dein Passwort, falls du es noch nicht getan hast.'
                )}
              </DialogContentText>
              {error && <Alert severity="error">{error}</Alert>}
              {options.map(([checked, set, title, text]) => (
                <FormControlLabel
                  key={title}
                  sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
                  control={<Checkbox checked={checked} onChange={(event) => set(event.target.checked)} sx={{ mt: -1 }} />}
                  label={
                    <Box>
                      <Typography variant="body1">{title}</Typography>
                      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                        {text}
                      </Typography>
                    </Box>
                  }
                />
              ))}
              {hasPassword && (
                <TextField
                  type="password"
                  label={t('Aktuelles Passwort')}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={close} disabled={busy}>
                {t('Abbrechen')}
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="error"
                disabled={busy || (hasPassword && !password) || !(sessions || appPasswords || links)}
              >
                {t('Jetzt absichern')}
              </Button>
            </DialogActions>
          </>
        )}
      </form>
    </Dialog>
  );
}

function ConfirmEmailDialog({
  open,
  email,
  onClose,
  onConfirm,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onConfirm: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (busy) return;
    setPassword('');
    setError('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!password || busy) return;
          setBusy(true);
          setError('');
          const failure = await onConfirm(password);
          setBusy(false);
          if (failure) return setError(failure);
          setPassword('');
          onClose();
        }}
      >
        <DialogTitle>{t('E-Mail-Adresse ändern')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <DialogContentText>
            {email
              ? t(
                  'Bestätige mit deinem Passwort, dass ab jetzt {email} zu deinem Konto gehört. Über diese Adresse lässt sich das Passwort zurücksetzen.',
                  {
                    email,
                  }
                )
              : t('Bestätige mit deinem Passwort, dass bei deinem Konto keine E-Mail-Adresse mehr stehen soll.')}
          </DialogContentText>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            type="password"
            label={t('Aktuelles Passwort')}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button type="submit" variant="contained" disabled={!password || busy}>
            {t('Adresse ändern')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function AppPasswordDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const user = boot().user!;
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [shared, setShared] = useState(user.role === 'guest');
  const [manage, setManage] = useState(false);
  const [days, setDays] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const close = () => {
    setName('');
    setReadOnly(false);
    setManage(false);
    setShared(user.role === 'guest');
    setDays(0);
    setToken(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{token ? t('Dein neues App-Passwort') : t('App-Passwort erstellen')}</DialogTitle>
      <DialogContent>
        {token ? (
          <Field>
            <Alert severity="warning">{t('Kopiere das Passwort jetzt. Danach zeigt MoeCloud es nicht mehr an.')}</Alert>
            <CopyField value={user.username} label={t('Benutzername')} />
            <CopyField value={token} label={t('App-Passwort')} />
            <CopyField value={boot().webdav ?? `${location.origin}/dav/`} label={t('WebDAV-Adresse')} />
          </Field>
        ) : (
          <Field>
            <DialogContentText>
              {t('Gib jedem Gerät ein eigenes App-Passwort. So kannst du einzelne Geräte später wieder abmelden.')}
            </DialogContentText>
            <TextField
              label={t('Name')}
              placeholder={t('zum Beispiel Laptop oder rclone')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
            <TextField
              select
              label={t('Gültig')}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              helperText={t('Nach dem Ablauf kommt das Gerät nicht mehr hinein, bis du ihm ein neues Passwort gibst.')}
            >
              <MenuItem value={0}>{t('Ohne Ablauf')}</MenuItem>
              <MenuItem value={7}>{t('7 Tage')}</MenuItem>
              <MenuItem value={30}>{t('30 Tage')}</MenuItem>
              <MenuItem value={90}>{t('90 Tage')}</MenuItem>
              <MenuItem value={365}>{t('Ein Jahr')}</MenuItem>
            </TextField>
            <FormControlLabel
              sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
              control={
                <Checkbox
                  checked={readOnly}
                  onChange={(event) => {
                    setReadOnly(event.target.checked);
                    if (event.target.checked) setManage(false);
                  }}
                  sx={{ mt: -1 }}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">{t('Nur lesen')}</Typography>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {t('Das Gerät sieht und lädt alles, kann aber nichts hochladen, ändern oder löschen.')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
              control={<Checkbox checked={shared} onChange={(event) => setShared(event.target.checked)} sx={{ mt: -1 }} />}
              label={
                <Box>
                  <Typography variant="body1">{t('Im Laufwerk auch Teamordner und Geteiltes zeigen')}</Typography>
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {t(
                      'Sie erscheinen als Ordner neben deinen eigenen. Lass das aus, wenn ein Programm dein Laufwerk spiegelt und dabei löscht, was bei dir fehlt.'
                    )}
                  </Typography>
                </Box>
              }
            />
            {user.role === 'admin' && (
              <FormControlLabel
                sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
                control={
                  <Checkbox checked={manage} disabled={readOnly} onChange={(event) => setManage(event.target.checked)} sx={{ mt: -1 }} />
                }
                label={
                  <Box>
                    <Typography variant="body1">{t('Darf die Verwaltung bedienen')}</Typography>
                    <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                      {t(
                        'Nur für Skripte, die Personen, Einstellungen oder Sicherungen verwalten. Ohne den Haken kommt das App-Passwort an nichts unter Admin.'
                      )}
                    </Typography>
                  </Box>
                }
              />
            )}
          </Field>
        )}
      </DialogContent>
      <DialogActions>
        {token ? (
          <Button variant="contained" onClick={close}>
            {t('Fertig')}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{t('Abbrechen')}</Button>
            <Button
              variant="contained"
              disabled={!name.trim()}
              onClick={async () => {
                try {
                  const result = await api.post<{ token: string }>('/api/account/app-passwords', {
                    name,
                    readOnly,
                    shared,
                    ...(manage ? { admin: true } : {}),
                    expiresAt: days ? Date.now() + days * 24 * 60 * 60 * 1000 : null,
                  });
                  setToken(result.token);
                  onCreated();
                } catch (error) {
                  toast(errorText(error));
                }
              }}
            >
              {t('Erstellen')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function SecurityLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);

  const load = async (before?: number) => {
    try {
      const page = await api.get<{ items: AuditEntry[]; more: boolean }>(`/api/account/security${before ? `?before=${before}` : ''}`);
      setEntries((current) => (before ? [...(current ?? []), ...page.items] : page.items));
      setMore(page.more);
    } catch (error) {
      toast(errorText(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!entries) return <CircularProgress size={24} aria-label={t('Lädt')} />;
  if (entries.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {t('Noch keine Einträge.')}
      </Typography>
    );
  }
  return (
    <>
      {entries.map((entry) => {
        const failed = entry.action === 'login_failed';
        const detail = auditDetail(entry);
        return (
          <Row
            key={entry.id}
            icon={failed ? <ErrorOutlineRounded sx={{ color: c.error }} /> : <ShieldRounded />}
            title={auditLabel(entry.action)}
            text={[detail, entry.ip, formatDateTime(entry.createdAt)].filter(Boolean).join(' · ')}
          />
        );
      })}
      {more && (
        <Button sx={{ alignSelf: 'flex-start' }} onClick={() => void load(entries[entries.length - 1].id)}>
          {t('Ältere anzeigen')}
        </Button>
      )}
    </>
  );
}

function featureList() {
  return appCatalog().filter((entry) => featureAvailable(entry.key));
}

function FeaturesSection({ account, onChanged }: { account: Account; onChanged: (prefs: Prefs) => void }) {
  const on = useFeatures();
  if (account.user.role === 'guest') return null;
  const change = async (key: Feature, value: boolean) => {
    const next = value ? featuresOff().filter((entry) => entry !== key) : [...featuresOff(), key];
    const before = featuresOff();
    setFeaturesOff(next);
    try {
      const result = await api.patch<{ prefs: Prefs }>('/api/account/prefs', { features: next });
      onChanged(result.prefs);
    } catch (error) {
      setFeaturesOff(before);
      toast(errorText(error));
    }
  };
  return (
    <Section
      id="funktionen"
      title={t('Funktionen')}
      description={t(
        'Was du nicht brauchst, blendest du hier aus. Es verschwindet aus Navigation, Startseite und Befehlspalette, deine Daten bleiben erhalten.'
      )}
    >
      <Button
        variant="tonal"
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => window.dispatchEvent(new Event('moe:welcome'))}
        data-welcome-again
      >
        {t('Einführung noch einmal')}
      </Button>
      <Box data-features sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {featureList().map((feature) => (
          <FormControlLabel
            key={feature.key}
            control={
              <Switch
                checked={on(feature.key)}
                disabled={Boolean(feature.parent && !on(feature.parent))}
                onChange={(event) => void change(feature.key, event.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {feature.label}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {feature.text}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'center', m: 0, gap: 1 }}
          />
        ))}
      </Box>
    </Section>
  );
}

function MailSection({ account, onChanged }: { account: Account; onChanged: (prefs: Prefs) => void }) {
  const save = async (patch: Partial<Prefs>) => {
    try {
      const result = await api.patch<{ prefs: Prefs }>('/api/account/prefs', patch);
      onChanged(result.prefs);
    } catch (error) {
      toast(errorText(error));
    }
  };
  const toggle = (key: keyof MailPrefs, value: boolean) => save({ [key]: value });
  const quiet = account.prefs.quiet;
  const setQuiet = (next: { from: number; to: number } | null) => {
    if (next && next.from === next.to) return;
    void save({ quiet: next, zone: zone() });
  };
  const mailing = account.mail && Boolean(account.user.email);
  const pushing = Boolean(account.push) || account.webPush > 0;
  const disabled = !mailing && !pushing;
  const options: { key: keyof MailPrefs; label: string; text: string }[] = [
    { key: 'mailShares', label: t('Wenn jemand etwas mit dir teilt'), text: t('Freigaben von anderen Personen') },
    { key: 'mailUploads', label: t('Wenn über einen Link etwas ankommt'), text: t('Nur für Links, bei denen du das eingeschaltet hast') },
    {
      key: 'mailComments',
      label: t('Bei neuen Kommentaren'),
      text: t('Kommentare an Dateien, die dir gehören, die mit dir geteilt sind oder die du kommentiert hast'),
    },
    {
      key: 'mailWatch',
      label: t('Bei Änderungen in beobachteten Ordnern'),
      text: t('Für Ordner, bei denen du „Beobachten“ eingeschaltet hast'),
    },
    { key: 'mailReminders', label: t('Bei Erinnerungen an Dateien'), text: t('Für Erinnerungen, die du dir selbst gesetzt hast') },
    ...(boot().calendarOn && (featureOn('calendar') || featureOn('tasks'))
      ? [
          {
            key: 'pushReminders' as const,
            label: t('Erinnerungen an Termine und Aufgaben'),
            text: t('Als Push aufs Handy oder in den Browser. Erinnerungen per E-Mail stellst du direkt am Termin ein.'),
          },
          {
            key: 'mailInvites' as const,
            label: t('Einladungen und Antworten'),
            text: t('Wenn dich jemand einlädt, einen Termin ändert oder auf deine Einladung antwortet'),
          },
          {
            key: 'mailBookings' as const,
            label: t('Buchungen und Umfragen'),
            text: t('Neue und stornierte Buchungen, neue Stimmen in deinen Terminumfragen'),
          },
        ]
      : []),
    ...(featureOn('mail')
      ? [
          {
            key: 'pushMail' as const,
            label: t('Neue E-Mails'),
            text: t('Als Push für Postfächer, bei denen „Bei neuen E-Mails benachrichtigen“ an ist'),
          },
        ]
      : []),
    ...(featureOn('chat')
      ? [
          {
            key: 'pushChat' as const,
            label: t('Neue Nachrichten im Chat'),
            text: t('Als Push, wenn dir jemand schreibt, dich erwähnt oder in eine Gruppe holt'),
          },
        ]
      : []),
    {
      key: 'mailLogins',
      label: t('Bei Anmeldung von einem neuen Gerät'),
      text: t('Damit du merkst, wenn sich jemand anderes mit deinem Konto anmeldet'),
    },
  ];
  if (account.plugins) {
    options.push({
      key: 'mailPlugins',
      label: t('Bei Nachrichten von Plugins'),
      text: t('Was die Plugins dieses Servers dir melden'),
    });
  }
  if (account.user.role === 'admin') {
    options.push({
      key: 'mailAdmin',
      label: t('Meldungen für die Verwaltung'),
      text: t('Neue Konten, Schadsoftware, volle Festplatte und Updates'),
    });
  }
  return (
    <Section
      id="benachrichtigungen"
      title={
        mailing && pushing
          ? t('Benachrichtigungen per E-Mail und Push')
          : pushing
            ? t('Push-Benachrichtigungen')
            : t('E-Mail-Benachrichtigungen')
      }
      description={
        mailing && pushing
          ? t('In der Glocke oben siehst du alles. Per E-Mail und Push kommt nur, was du hier einschaltest.')
          : pushing
            ? t('In der Glocke oben siehst du alles. Per Push kommt nur, was du hier einschaltest.')
            : !account.mail
              ? t('Auf diesem Server ist kein E-Mail-Versand eingerichtet. Neuigkeiten siehst du über die Glocke oben.')
              : !account.user.email
                ? t('Hinterleg oben eine E-Mail-Adresse, dann kommen Benachrichtigungen auch per E-Mail.')
                : t('In der Glocke oben siehst du alles. Per E-Mail kommt nur, was du hier einschaltest.')
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {options.map((option) => (
          <FormControlLabel
            key={option.key}
            disabled={disabled}
            control={
              <Switch
                checked={account.prefs[option.key] && !disabled}
                onChange={(event) => void toggle(option.key, event.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {option.label}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {option.text}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'center', m: 0, gap: 1 }}
          />
        ))}
      </Box>
      {!disabled && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3, maxWidth: 560 }}>
          {mailing && (
            <TextField
              select
              label={t('E-Mails schicken')}
              value={account.prefs.digest}
              onChange={(event) => void save({ digest: event.target.value as Prefs['digest'], zone: zone() })}
              helperText={t('Gesammelt bekommst du eine E-Mail mit allem, was du noch nicht gelesen hast.')}
            >
              <MenuItem value="off">{t('Sofort, jede für sich')}</MenuItem>
              <MenuItem value="daily">{t('Gesammelt, jeden Morgen um 8 Uhr')}</MenuItem>
              <MenuItem value="weekly">{t('Gesammelt, montags um 8 Uhr')}</MenuItem>
            </TextField>
          )}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(quiet)}
                  onChange={(event) => setQuiet(event.target.checked ? { from: 22 * 60, to: 7 * 60 } : null)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('Ruhezeiten')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {t(
                      'In dieser Zeit kommen weder E-Mails noch Push. Danach bekommst du eine Zusammenfassung. Neue Anmeldungen meldet MoeCloud immer sofort.'
                    )}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'center', m: 0, gap: 1 }}
            />
            {quiet && (
              <Box sx={{ display: 'flex', gap: 2, mt: 1.5 }}>
                <TextField
                  label={t('Von')}
                  type="time"
                  value={clock(quiet.from)}
                  onChange={(event) => {
                    const from = minutesOf(event.target.value);
                    if (from !== null) setQuiet({ from, to: quiet.to });
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label={t('Bis')}
                  type="time"
                  value={clock(quiet.to)}
                  onChange={(event) => {
                    const to = minutesOf(event.target.value);
                    if (to !== null) setQuiet({ from: quiet.from, to });
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flex: 1 }}
                />
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Section>
  );
}

interface BrowserPushState {
  enabled: boolean;
  publicKey: string | null;
  items: { id: string; device: string; createdAt: number; current: boolean }[];
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function keyBytes(key: string) {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function BrowserPush({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<BrowserPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  const load = async () => {
    const subscription = await currentSubscription().catch(() => null);
    const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : '';
    setState(await api.get<BrowserPushState>(`/api/account/webpush${query}`));
  };

  useEffect(() => {
    let active = true;
    currentSubscription()
      .catch(() => null)
      .then((subscription) =>
        api.get<BrowserPushState>(`/api/account/webpush${subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ''}`)
      )
      .then((result) => {
        if (active) setState(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await task();
      if (done) toast(done);
      await load();
      onChanged();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const enable = () =>
    run(async () => {
      if (!state?.publicKey) return;
      if ((await Notification.requestPermission()) !== 'granted') {
        throw new Error(t('Dein Browser erlaubt MoeCloud keine Benachrichtigungen. Erlaub sie in den Einstellungen für diese Seite.'));
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) }));
      const { endpoint, keys } = subscription.toJSON();
      await api.post('/api/account/webpush', { endpoint, keys });
    }, t('Push ist in diesem Browser eingeschaltet'));

  const remove = (item: BrowserPushState['items'][number]) =>
    run(
      async () => {
        if (item.current) await (await currentSubscription())?.unsubscribe();
        await api.delete(`/api/account/webpush/${item.id}`);
      },
      item.current ? t('Push ist in diesem Browser ausgeschaltet') : undefined
    );

  if (!state?.enabled) return null;
  const here = state.items.some((item) => item.current);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 560 }}>
      <Typography variant="subtitle2" component="h3">
        {t('In diesem Browser')}
      </Typography>
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {supported
          ? t('Benachrichtigungen erscheinen dann auf diesem Gerät, auch wenn MoeCloud gerade nicht offen ist.')
          : t(
              'Dieser Browser kann das nicht. Auf iPhone und iPad geht es, wenn du MoeCloud über Teilen zum Home-Bildschirm hinzufügst und von dort öffnest.'
            )}
      </Typography>
      {supported && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {!here && (
            <Button variant="contained" disabled={busy} onClick={() => void enable()}>
              {t('In diesem Browser einschalten')}
            </Button>
          )}
          {state.items.length > 0 && (
            <Button
              variant="tonal"
              disabled={busy}
              onClick={() => void run(() => api.post('/api/account/webpush/test'), t('Die Testnachricht ist unterwegs'))}
            >
              {t('Testnachricht schicken')}
            </Button>
          )}
        </Box>
      )}
      {state.items.length > 0 && (
        <Box
          component="ul"
          aria-label={t('Browser mit Push')}
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
        >
          {state.items.map((item) => (
            <Box
              component="li"
              key={item.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                pl: 1.5,
                pr: 0.5,
                py: 0.5,
                borderRadius: `${radius.md}px`,
                bgcolor: c.surfaceContainerHigh,
              }}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {item.device}
                {item.current ? ` · ${t('dieser Browser')}` : ''}
              </Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant, flex: 'none' }}>
                {formatDate(item.createdAt)}
              </Typography>
              <Button size="small" color="error" disabled={busy} onClick={() => void remove(item)}>
                {t('Ausschalten')}
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function PushSection({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const current = account.push;
  const [kind, setKind] = useState<'ntfy' | 'gotify'>(current?.kind ?? 'ntfy');
  const [url, setUrl] = useState(current?.url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const keeps = Boolean(current?.hasToken && current.kind === kind);
  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await task();
      toast(done);
      onChanged();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await api.put('/api/account/push', {
        kind,
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : keeps ? {} : { token: null }),
      });
      setToken('');
    }, t('Push ist eingerichtet'));
  return (
    <Section
      id="push"
      title={t('Push')}
      description={t('So erfährst du von Neuigkeiten, auch wenn MoeCloud nicht offen ist: direkt im Browser oder über ntfy und Gotify.')}
    >
      <BrowserPush onChanged={onChanged} />
      <Typography variant="subtitle2" component="h3" sx={{ mt: 3 }}>
        {t('Über ntfy oder Gotify')}
      </Typography>
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mb: 2, mt: 0.5, maxWidth: 560 }}>
        {t('MoeCloud schickt deine Benachrichtigungen an ntfy oder Gotify. Von dort landen sie auf dem Handy oder Rechner.')}
      </Typography>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={kind}
          onChange={(_, value: 'ntfy' | 'gotify' | null) => value && setKind(value)}
          aria-label={t('Push-Dienst')}
        >
          <ToggleButton value="ntfy">ntfy</ToggleButton>
          <ToggleButton value="gotify">Gotify</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          label={kind === 'ntfy' ? t('Adresse mit Thema') : t('Adresse des Gotify-Servers')}
          placeholder={kind === 'ntfy' ? 'https://ntfy.sh/mia-moecloud' : 'https://gotify.example.com'}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          disabled={busy}
          helperText={kind === 'ntfy' ? t('Nimm ein Thema, das niemand errät. Wer es kennt, kann mitlesen.') : undefined}
          slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'none', spellCheck: false } }}
        />
        <TextField
          type="password"
          label={kind === 'ntfy' ? t('Zugangstoken (freiwillig)') : t('App-Token')}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required={kind === 'gotify' && !keeps}
          disabled={busy}
          autoComplete="off"
          helperText={keeps ? t('Ein Token ist gespeichert. Lass das Feld leer, um ihn zu behalten.') : undefined}
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button type="submit" variant="contained" disabled={busy || !url.trim()}>
            {t('Speichern')}
          </Button>
          {current && (
            <Button
              variant="tonal"
              disabled={busy}
              onClick={() => void run(() => api.post('/api/account/push/test'), t('Die Testnachricht ist unterwegs'))}
            >
              {t('Testnachricht schicken')}
            </Button>
          )}
          {current && (
            <Button
              color="error"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.delete('/api/account/push');
                  setUrl('');
                  setToken('');
                }, t('Push ist ausgeschaltet'))
              }
            >
              {t('Ausschalten')}
            </Button>
          )}
        </Box>
      </Box>
    </Section>
  );
}

export function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dialog, setDialog] = useState<'password' | 'totp' | 'disable' | 'recovery' | 'app' | 'delete' | 'email' | 'secure' | null>(null);
  const prefs = usePrefs();
  const [arranging, setArranging] = useState(false);
  const { pages } = usePlugins();
  const control = useThemeControl();
  const supportsPasskeys = typeof window !== 'undefined' && browserSupportsWebAuthn() && window.isSecureContext;

  const load = () =>
    api
      .get<Account>('/api/account')
      .then((data) => {
        setAccount(data);
        setName(data.user.name);
        setEmail(data.user.email ?? '');
      })
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    document.title = `${t('Konto')} » ${boot().site.name}`;
  }, []);

  const ready = Boolean(account);
  useEffect(() => {
    if (!ready || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [ready]);

  const saveProfile = async (password?: string) => {
    const changed = email !== (account?.user.email ?? '');
    if (changed && account?.security.hasPassword && password === undefined) {
      setDialog('email');
      return null;
    }
    try {
      await api.patch('/api/account', { name, ...(changed ? { email, password } : {}) });
      toast(t('Gespeichert'));
      void load();
      return null;
    } catch (error) {
      if (password === undefined) toast(errorText(error));
      return errorText(error);
    }
  };

  const addPasskey = async () => {
    try {
      const options = await api.post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/account/passkeys/options');
      const response = await startRegistration({ optionsJSON: options });
      const label = deviceOf(navigator.userAgent);
      await api.post('/api/account/passkeys', { response, name: label });
      toast(t('Passkey hinzugefügt'));
      void load();
    } catch (error) {
      const reason = error as Error;
      if (reason.name !== 'NotAllowedError' && reason.name !== 'AbortError') toast(errorText(error));
    }
  };

  const security = account?.security;
  const locked = Boolean(security?.setupRequired);
  const unlocked = Boolean(boot().setup2fa && security && !security.setupRequired);

  return (
    <AppShell
      active="account"
      storage={account?.storage}
      framed={false}
      topBar={
        <Typography variant="h5" component="p" sx={{ pl: { xs: 1, md: 1 }, flex: 1 }}>
          {t('Konto')}
        </Typography>
      }
    >
      <Box sx={{ maxWidth: 880, mx: 'auto', px: { xs: 1.5, sm: 2, md: 3 }, pb: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!account || !security ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
            <CircularProgress aria-label={t('Lädt')} />
          </Box>
        ) : (
          <>
            {account.expiresAt ? (
              <Alert severity={account.expiresAt - Date.now() < 7 * 86_400_000 ? 'warning' : 'info'}>
                {t('Dein Konto ist bis {date} freigeschaltet. Danach kannst du dich nicht mehr anmelden.', {
                  date: formatDateTime(account.expiresAt),
                })}
              </Alert>
            ) : null}
            {locked && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 2,
                  p: { xs: 2, sm: 3 },
                  borderRadius: `${radius.lg}px`,
                  bgcolor: c.secondaryContainer,
                  color: c.onSecondaryContainer,
                }}
              >
                <ShieldRounded sx={{ fontSize: 36, flex: 'none', color: c.primary }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" component="h2">
                    {t('Richte die Zwei-Faktor-Anmeldung ein')}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {t(
                      'Die Verwaltung verlangt für dein Konto einen zweiten Faktor. Sobald eine Authenticator-App oder ein Passkey eingerichtet ist, kannst du MoeCloud wie gewohnt nutzen.'
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                    <Button variant="contained" startIcon={<PhonelinkLockRounded />} onClick={() => setDialog('totp')}>
                      {t('Authenticator-App einrichten')}
                    </Button>
                    {account.passkeysEnabled && supportsPasskeys && (
                      <Button variant="outlined" color="inherit" startIcon={<KeyRounded />} onClick={() => void addPasskey()}>
                        {t('Passkey hinzufügen')}
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            )}
            {unlocked && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  pl: 2,
                  pr: 1,
                  py: 1,
                  borderRadius: `${radius.md}px`,
                  bgcolor: c.secondaryContainer,
                  color: c.onSecondaryContainer,
                }}
              >
                <CheckCircleRounded sx={{ color: c.primary }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>
                  {t('Alles eingerichtet. Dein Konto ist jetzt zusätzlich geschützt.')}
                </Typography>
                <Button endIcon={<ArrowForwardRounded />} href="/files" sx={{ color: 'inherit' }}>
                  {t('Zu deinen Dateien')}
                </Button>
              </Box>
            )}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2.5,
                bgcolor: c.surfaceContainerLow,
                borderRadius: `${radius.lg}px`,
                p: { xs: 2, sm: 3 },
                flexWrap: 'wrap',
              }}
            >
              <AvatarEdit
                user={account.user}
                onChange={(avatar: string | null) => setAccount({ ...account, user: { ...account.user, avatar } })}
              />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
                  {account.user.name}
                </Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mb: 1.5 }}>
                  @{account.user.username} ·{' '}
                  {account.user.role === 'admin' ? t('Admin') : account.user.role === 'guest' ? t('Gast') : t('Mitglied')}
                </Typography>
                {account.user.role === 'guest' ? (
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
                    {t('Gastkonten haben keinen eigenen Speicher. Du arbeitest in dem, was andere mit dir teilen.')}
                  </Typography>
                ) : (
                  <StorageMeter storage={account.storage} />
                )}
                <Box sx={{ display: locked || account.user.role === 'guest' ? 'none' : 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
                  <Button size="small" variant="tonal" startIcon={<DataUsageRounded />} href="/files/storage">
                    {t('Speicher ansehen')}
                  </Button>
                  <Tooltip describeChild title={t('Alle deine Dateien und eine Übersicht über dein Konto als ZIP')}>
                    <Button size="small" startIcon={<FolderZipRounded />} href="/api/account/export" download>
                      {t('Daten exportieren')}
                    </Button>
                  </Tooltip>
                </Box>
              </Box>
              <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, flexWrap: 'wrap', width: '100%' }}>
                {!locked && (
                  <Button variant="tonal" startIcon={<DeleteRounded />} href="/files/trash">
                    {t('Papierkorb')}
                  </Button>
                )}
                {account.user.role === 'admin' && !locked && (
                  <Button variant="tonal" startIcon={<AdminPanelSettingsRounded />} href="/admin">
                    {t('Verwaltung')}
                  </Button>
                )}
                <Button startIcon={<LogoutRounded />} onClick={() => void logout()}>
                  {t('Abmelden')}
                </Button>
              </Box>
            </Box>

            <Section title={t('Profil')} description={t('So sehen dich andere, wenn du etwas teilst.')}>
              <Box
                component="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProfile();
                }}
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
              >
                <TextField
                  label={t('Name')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                />
                <TextField
                  label={t('E-Mail')}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
                <TextField
                  label={t('Benutzername')}
                  value={account.user.username}
                  disabled
                  helperText={t('Den Benutzernamen kann nur die Verwaltung ändern.')}
                />
                <TextField
                  select
                  label={t('Sprache')}
                  value={account.user.language ?? boot().lang}
                  onChange={async (event) => {
                    await api.patch('/api/account', { language: event.target.value });
                    location.reload();
                  }}
                >
                  <MenuItem value="de" lang="de">
                    Deutsch
                  </MenuItem>
                  <MenuItem value="en" lang="en">
                    English
                  </MenuItem>
                </TextField>
                {account.user.role !== 'guest' && (
                  <TextField
                    select
                    label={t('Nach der Anmeldung zeigen')}
                    value={account.prefs.start ?? 'files'}
                    onChange={async (event) => {
                      const start = event.target.value as 'files' | 'home';
                      try {
                        await api.patch('/api/account/prefs', { start });
                        setAccount({ ...account, prefs: { ...account.prefs, start } });
                      } catch (error) {
                        toast(errorText(error));
                      }
                    }}
                  >
                    <MenuItem value="files">{t('Meine Dateien')}</MenuItem>
                    <MenuItem value="home">{t('Start mit der Übersicht')}</MenuItem>
                  </TextField>
                )}
                <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="contained" disabled={name === account.user.name && email === (account.user.email ?? '')}>
                    {t('Speichern')}
                  </Button>
                </Box>
              </Box>
            </Section>

            <Section title={t('Darstellung')} action={<ThemeToggleButton placement="bottom" />}>
              {!locked && <ThemeChoice />}
              {!locked && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 220 }}>
                    <Typography variant="subtitle2">{t('Navigation')}</Typography>
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                      {t('Leg fest, was in der Seitenleiste steht und in welcher Reihenfolge. Das gilt auf allen deinen Geräten.')}
                    </Typography>
                  </Box>
                  <Button variant="tonal" onClick={() => setArranging(true)}>
                    {t('Navigation anpassen')}
                  </Button>
                </Box>
              )}
              {arranging && (
                <ArrangeDialog
                  title={t('Navigation anpassen')}
                  text={t(
                    'Schieb die Einträge in deine Reihenfolge und blende aus, was du nicht brauchst. Mit dem Handy-Symbol wählst du bis zu vier Einträge für die untere Leiste.'
                  )}
                  entries={navEntries(account.user, pages)}
                  value={account.prefs.nav ?? null}
                  defaultBar={DEFAULT_BAR}
                  onClose={() => setArranging(false)}
                  onSave={async (nav) => {
                    try {
                      await api.patch('/api/account/prefs', { nav });
                      boot().nav = nav;
                      setAccount({ ...account, prefs: { ...account.prefs, nav } });
                      setArranging(false);
                      toast(nav ? t('Navigation gespeichert') : t('Navigation zurückgesetzt'));
                    } catch (error) {
                      toast(errorText(error));
                    }
                  }}
                />
              )}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>
                {t('Nur in diesem Browser')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Design')}</Typography>
                  <ThemeModeSelector />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Kontrast')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.contrast}
                    onChange={(_event, value) => value !== null && setPrefs({ contrast: value })}
                    aria-label={t('Kontrast')}
                  >
                    <ToggleButton value={0}>{t('Normal')}</ToggleButton>
                    <ToggleButton value={0.5}>{t('Mittel')}</ToggleButton>
                    <ToggleButton value={1}>{t('Hoch')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Ecken')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.shape ?? control.spec.corners}
                    onChange={(_event, value) => value !== null && setPrefs({ shape: value })}
                    aria-label={t('Ecken')}
                  >
                    <ToggleButton value={1}>{t('Rund')}</ToggleButton>
                    <ToggleButton value={0.5}>{t('Weich')}</ToggleButton>
                    <ToggleButton value={0.1}>{t('Kantig')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Schriftgröße')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.scale}
                    onChange={(_event, value) => value !== null && setPrefs({ scale: value })}
                    aria-label={t('Schriftgröße')}
                  >
                    <ToggleButton value={0.9}>{t('Klein')}</ToggleButton>
                    <ToggleButton value={1}>{t('Normal')}</ToggleButton>
                    <ToggleButton value={1.1}>{t('Groß')}</ToggleButton>
                    <ToggleButton value={1.25}>{t('Sehr groß')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-nav-position>
                  <Typography variant="subtitle2">{t('Navigation auf großen Bildschirmen')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.navPosition}
                    onChange={(_event, value) => value !== null && setPrefs({ navPosition: value })}
                    aria-label={t('Navigation auf großen Bildschirmen')}
                  >
                    <ToggleButton value="side">{t('Links')}</ToggleButton>
                    <ToggleButton value="top">{t('Oben')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Zeilen in Listen')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.density}
                    onChange={(_event, value) => value !== null && setPrefs({ density: value })}
                    aria-label={t('Zeilen in Listen')}
                  >
                    <ToggleButton value="comfortable">{t('Luftig')}</ToggleButton>
                    <ToggleButton value="compact">{t('Kompakt')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2">{t('Kacheln in der Rasteransicht')}</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={prefs.tile}
                    onChange={(_event, value) => value !== null && setPrefs({ tile: value })}
                    aria-label={t('Kacheln in der Rasteransicht')}
                  >
                    <ToggleButton value={0.75}>{t('Klein')}</ToggleButton>
                    <ToggleButton value={1}>{t('Mittel')}</ToggleButton>
                    <ToggleButton value={1.35}>{t('Groß')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <FormControlLabel
                  control={<Switch checked={prefs.trueBlack} onChange={(event) => setPrefs({ trueBlack: event.target.checked })} />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('Echtes Schwarz')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {t('Spart Strom auf OLED-Bildschirmen im dunklen Design.')}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'center', m: 0, gap: 1 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={prefs.backdrop === 'glow'}
                      onChange={(event) => setPrefs({ backdrop: event.target.checked ? 'glow' : 'plain' })}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('Farbschimmer im Hintergrund')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {t('Legt einen weichen Verlauf in den Farben des Themes hinter die Oberfläche.')}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'center', m: 0, gap: 1 }}
                />
                <FormControlLabel
                  control={<Switch checked={prefs.barHide} onChange={(event) => setPrefs({ barHide: event.target.checked })} />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('Leiste auf dem Handy beim Scrollen ausblenden')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {t('Die untere Leiste verschwindet, während du nach unten scrollst, und kommt beim Zurückscrollen wieder.')}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'center', m: 0, gap: 1 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={prefs.motion === 'reduced'}
                      onChange={(event) => setPrefs({ motion: event.target.checked ? 'reduced' : 'system' })}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('Weniger Bewegung')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {t('Schaltet Übergänge und Animationen ab, auch wenn dein Gerät sie erlaubt.')}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'center', m: 0, gap: 1 }}
                />
              </Box>
            </Section>

            <FeaturesSection account={account} onChanged={(next) => setAccount({ ...account, prefs: next })} />

            <MailSection account={account} onChanged={(next) => setAccount({ ...account, prefs: next })} />

            {account.pushEnabled && !locked && <PushSection account={account} onChanged={() => void load()} />}

            <Section
              id="sicherheit"
              title={t('Sicherheit')}
              description={t('Je mehr du einrichtest, desto schwerer kommen Fremde an deine Dateien.')}
            >
              <Row
                icon={<LockResetRounded />}
                title={t('Passwort')}
                text={security.hasPassword ? t('Mit Passwort und Benutzername meldest du dich an.') : t('Du hast noch kein Passwort.')}
                action={
                  <Button variant="tonal" onClick={() => setDialog('password')}>
                    {security.hasPassword ? t('Ändern') : t('Festlegen')}
                  </Button>
                }
              />
              {security.sso && (
                <>
                  <Divider />
                  <Row
                    icon={<LoginRounded />}
                    title={t('Single Sign-on')}
                    text={
                      security.hasPassword
                        ? t('Dein Konto ist mit dem Anbieter für die Anmeldung über SSO verknüpft.')
                        : t('Du meldest dich über den Anbieter an. Leg ein Passwort fest, wenn du die Verknüpfung trennen willst.')
                    }
                    action={
                      <Button
                        variant="tonal"
                        disabled={!security.hasPassword}
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: t('Verknüpfung trennen?'),
                              text: t('Danach meldest du dich nur noch mit Benutzername und Passwort an.'),
                              confirm: t('Trennen'),
                              danger: true,
                            }))
                          )
                            return;
                          await api.delete('/api/account/sso').catch((error) => toast(errorText(error)));
                          void load();
                        }}
                      >
                        {t('Trennen')}
                      </Button>
                    }
                  />
                </>
              )}
              <Divider />
              <Row
                icon={<PhonelinkLockRounded />}
                title={t('Authenticator-App')}
                text={
                  security.totp
                    ? tn(
                        security.recoveryCodes,
                        'An. Noch {count} Wiederherstellungscode übrig.',
                        'An. Noch {count} Wiederherstellungscodes übrig.'
                      )
                    : t('Aus. Mit einem Code vom Handy schützt du dein Konto zusätzlich.')
                }
                action={
                  security.totp ? (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Button onClick={() => setDialog('recovery')}>{t('Neue Codes')}</Button>
                      <Button variant="tonal" onClick={() => setDialog('disable')}>
                        {t('Ausschalten')}
                      </Button>
                    </Box>
                  ) : (
                    <Button variant="contained" onClick={() => setDialog('totp')}>
                      {t('Einrichten')}
                    </Button>
                  )
                }
              />
              {account.passkeysEnabled && (
                <>
                  <Divider />
                  <Row
                    icon={<FingerprintRounded />}
                    title={t('Passkeys')}
                    text={t('Melde dich mit Fingerabdruck, Gesicht oder Sicherheitsschlüssel an, ganz ohne Passwort.')}
                    action={
                      <Tooltip title={supportsPasskeys ? '' : t('Passkeys gehen nur über HTTPS und in einem Browser, der sie kann.')}>
                        <span>
                          <Button variant="tonal" startIcon={<KeyRounded />} disabled={!supportsPasskeys} onClick={() => void addPasskey()}>
                            {t('Hinzufügen')}
                          </Button>
                        </span>
                      </Tooltip>
                    }
                  />
                  {security.passkeys.map((passkey) => (
                    <Box key={passkey.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: { sm: 5 } }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                          {passkey.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                          {t('Hinzugefügt {date}', { date: formatDate(passkey.createdAt) })}
                          {passkey.lastUsedAt ? ` · ${t('zuletzt {date}', { date: formatDate(passkey.lastUsedAt) })}` : ''}
                        </Typography>
                      </Box>
                      {passkey.synced && <Chip size="small" icon={<SyncRounded />} label={t('Synchronisiert')} variant="outlined" />}
                      <Tooltip title={t('Umbenennen')}>
                        <IconButton
                          aria-label={t('Passkey umbenennen')}
                          onClick={async () => {
                            const value = await prompt({
                              title: t('Passkey umbenennen'),
                              label: t('Name'),
                              value: passkey.name,
                              confirm: t('Speichern'),
                            });
                            if (!value) return;
                            await api
                              .patch(`/api/account/passkeys/${passkey.id}`, { name: value })
                              .catch((error) => toast(errorText(error)));
                            void load();
                          }}
                        >
                          <EditRounded />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('Entfernen')}>
                        <IconButton
                          aria-label={t('Passkey entfernen')}
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: t('Passkey entfernen?'),
                                text: passkey.name,
                                confirm: t('Entfernen'),
                                danger: true,
                              }))
                            )
                              return;
                            await api.delete(`/api/account/passkeys/${passkey.id}`).catch((error) => toast(errorText(error)));
                            void load();
                          }}
                        >
                          <DeleteOutlineRounded />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </>
              )}
              <Divider />
              <Row
                icon={<ShieldRounded />}
                title={t('Konto absichern')}
                text={t('Meldet andere Geräte ab, widerruft App-Passwörter und pausiert auf Wunsch deine Links, alles in einem Schritt.')}
                action={
                  <Button variant="tonal" onClick={() => setDialog('secure')}>
                    {t('Absichern')}
                  </Button>
                }
              />
            </Section>

            {!locked && (
              <Section
                id="app-passwoerter"
                title={t('WebDAV und App-Passwörter')}
                description={t(
                  'Binde MoeCloud als Laufwerk im Explorer, im Finder oder mit rclone ein. Melde dich dort mit deinem Benutzernamen und einem App-Passwort an.'
                )}
              >
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
                  <CopyField value={boot().webdav ?? `${location.origin}/dav/`} label={t('WebDAV-Adresse')} />
                  <CopyField value={account.user.username} label={t('Benutzername')} />
                  {boot().calendarOn?.caldav && (featureOn('calendar') || featureOn('tasks')) && (
                    <CopyField value={boot().calendarOn!.caldav!} label={t('CalDAV-Adresse für Kalender und Aufgaben')} />
                  )}
                </Box>
                {security.appPasswords.map((entry) => (
                  <Box key={entry.id} data-app-password={entry.name} data-paused={entry.paused ? 'ja' : undefined}>
                    <Row
                      icon={<KeyRounded />}
                      title={entry.name}
                      text={[
                        `…${entry.hint}`,
                        entry.readOnly ? t('nur lesen') : null,
                        entry.admin ? t('mit Verwaltung') : null,
                        entry.shared ? t('mit Teamordnern und Geteiltem') : null,
                        entry.expired ? t('abgelaufen') : null,
                        entry.expiresAt && !entry.expired ? t('gültig bis {date}', { date: formatDate(entry.expiresAt) }) : null,
                        entry.lastUsedAt ? t('zuletzt genutzt {date}', { date: formatDate(entry.lastUsedAt) }) : t('noch nie genutzt'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      action={
                        <Tooltip title={t('Widerrufen')}>
                          <IconButton
                            aria-label={t('App-Passwort {name} widerrufen', { name: entry.name })}
                            onClick={async () => {
                              if (
                                !(await confirm({
                                  title: t('App-Passwort widerrufen?'),
                                  text: t('Geräte, die „{name}“ nutzen, verlieren den Zugriff.', { name: entry.name }),
                                  confirm: t('Widerrufen'),
                                  danger: true,
                                }))
                              )
                                return;
                              await api.delete(`/api/account/app-passwords/${entry.id}`).catch((error) => toast(errorText(error)));
                              void load();
                            }}
                          >
                            <DeleteOutlineRounded />
                          </IconButton>
                        </Tooltip>
                      }
                    />
                    {entry.paused && (
                      <Alert
                        severity="warning"
                        sx={{ mt: 1 }}
                        action={
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <Button
                              color="inherit"
                              size="small"
                              href={`/files?zuruecksetzen=${Math.max(1, (entry.paused.since ?? entry.paused.at) - 60_000)}`}
                            >
                              {t('Dateien zurücksetzen')}
                            </Button>
                            <Button
                              color="inherit"
                              size="small"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: t('„{name}“ wieder freigeben?', { name: entry.name }),
                                  text: t(
                                    'Das Gerät kann danach wieder Dateien ändern. Gib es nur frei, wenn du weißt, woher die vielen Änderungen kamen.'
                                  ),
                                  confirm: t('Freigeben'),
                                });
                                if (!ok) return;
                                await api
                                  .post(`/api/account/app-passwords/${entry.id}/resume`)
                                  .then(() => toast(t('„{name}“ ist wieder freigegeben', { name: entry.name })))
                                  .catch((error) => toast(errorText(error)));
                                void load();
                              }}
                            >
                              {t('Freigeben')}
                            </Button>
                          </Box>
                        }
                      >
                        {t('Angehalten am {date}, nach {count} Änderungen in wenigen Minuten. Das Gerät kann nur noch lesen.', {
                          date: formatDateTime(entry.paused.at),
                          count: entry.paused.count,
                        })}
                      </Alert>
                    )}
                  </Box>
                ))}
                <Box>
                  <Button variant="tonal" startIcon={<KeyRounded />} onClick={() => setDialog('app')}>
                    {t('App-Passwort erstellen')}
                  </Button>
                </Box>
              </Section>
            )}

            <Section
              id="sitzungen"
              title={t('Sitzungen')}
              description={t('Hier bist du gerade angemeldet.')}
              action={
                security.sessions.length > 1 ? (
                  <Button
                    onClick={async () => {
                      await api.post('/api/account/sessions/revoke-others').catch((error) => toast(errorText(error)));
                      toast(t('Andere Geräte sind abgemeldet'));
                      void load();
                    }}
                  >
                    {t('Alle anderen abmelden')}
                  </Button>
                ) : undefined
              }
            >
              {security.sessions.map((session) => (
                <Row
                  key={session.id}
                  icon={/Android|iPhone|iPad/.test(session.userAgent ?? '') ? <SmartphoneRounded /> : <ComputerRounded />}
                  title={
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      {deviceOf(session.userAgent)}
                      {session.current && (
                        <Chip
                          size="small"
                          label={t('Dieses Gerät')}
                          sx={{ bgcolor: c.secondaryContainer, color: c.onSecondaryContainer }}
                        />
                      )}
                    </Box>
                  }
                  text={[session.ip, t('aktiv {date}', { date: formatDateTime(session.lastSeenAt) })].filter(Boolean).join(' · ')}
                  action={
                    session.current ? (
                      <Button startIcon={<LogoutRounded />} onClick={() => void logout()}>
                        {t('Abmelden')}
                      </Button>
                    ) : (
                      <Tooltip title={t('Abmelden')}>
                        <IconButton
                          aria-label={t('Dieses Gerät abmelden')}
                          onClick={async () => {
                            await api.delete(`/api/account/sessions/${session.id}`).catch((error) => toast(errorText(error)));
                            void load();
                          }}
                        >
                          <LogoutRounded />
                        </IconButton>
                      </Tooltip>
                    )
                  }
                />
              ))}
            </Section>

            <Section
              title={t('Sicherheitsprotokoll')}
              description={t(
                'Anmeldungen und Änderungen an deinem Zugang. Kommt dir etwas fremd vor, ändere dein Passwort und melde andere Geräte ab.'
              )}
            >
              <SecurityLog />
            </Section>

            {account.selfDelete && !locked && (
              <Section title={t('Konto löschen')} description={t('Lade vorher mit „Daten exportieren“ herunter, was du behalten willst.')}>
                <Box>
                  <Button variant="outlined" color="error" startIcon={<DeleteForeverRounded />} onClick={() => setDialog('delete')}>
                    {t('Konto löschen')}
                  </Button>
                </Box>
              </Section>
            )}
          </>
        )}
      </Box>
      <PasswordDialog
        open={dialog === 'password'}
        hasPassword={Boolean(security?.hasPassword)}
        min={account?.passwordMin ?? 10}
        onClose={() => setDialog(null)}
      />
      <TotpDialog open={dialog === 'totp'} onClose={() => setDialog(null)} onDone={() => void load()} />
      <CodeDialog
        open={dialog === 'disable'}
        title={t('Authenticator-App ausschalten')}
        text={t('Gib einen Code aus der App oder einen Wiederherstellungscode ein.')}
        confirmLabel={t('Ausschalten')}
        onClose={() => setDialog(null)}
        onSubmit={async (code) => {
          await api.post('/api/account/totp/disable', { code });
          toast(t('Authenticator-App ausgeschaltet'));
          void load();
        }}
      />
      <CodeDialog
        open={dialog === 'recovery'}
        title={t('Neue Wiederherstellungscodes')}
        text={t('Die alten Codes funktionieren danach nicht mehr. Bestätige mit einem Code aus der App.')}
        confirmLabel={t('Neue Codes erzeugen')}
        onClose={() => setDialog(null)}
        onSubmit={async (code) => {
          const result = await api.post<{ recoveryCodes: string[] }>('/api/account/totp/recovery', { code });
          void load();
          return result.recoveryCodes;
        }}
      />
      <AppPasswordDialog open={dialog === 'app'} onClose={() => setDialog(null)} onCreated={() => void load()} />
      <ConfirmEmailDialog open={dialog === 'email'} email={email} onClose={() => setDialog(null)} onConfirm={saveProfile} />
      <SecureDialog
        open={dialog === 'secure'}
        hasPassword={Boolean(account?.security.hasPassword)}
        onClose={() => setDialog(null)}
        onDone={() => void load()}
      />
      {account && (
        <DeleteAccountDialog
          open={dialog === 'delete'}
          username={account.user.username}
          hasPassword={Boolean(security?.hasPassword)}
          onClose={() => setDialog(null)}
        />
      )}
    </AppShell>
  );
}
