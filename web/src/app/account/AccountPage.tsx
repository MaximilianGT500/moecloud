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
import { AppShell } from '../shell/AppShell';
import { auditDetail, auditLabel, type AuditEntry } from '../common/audit';
import { CopyField, QrCode, Row, Section, StorageMeter, UserAvatar, copyText } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { ThemeModeSelector, ThemeToggleButton } from '../common/ThemeToggle';
import { toast } from '../common/toast';

interface MailPrefs {
  mailShares: boolean;
  mailUploads: boolean;
  mailComments: boolean;
  mailWatch: boolean;
  mailAdmin: boolean;
  mailLogins: boolean;
}

interface Account {
  user: SessionUser;
  storage: Storage;
  passkeysEnabled: boolean;
  mail: boolean;
  prefs: MailPrefs;
  security: {
    required: boolean;
    setupRequired: boolean;
    hasPassword: boolean;
    sso: { enabled: boolean } | null;
    totp: boolean;
    recoveryCodes: number;
    passkeys: { id: string; name: string; synced: boolean; createdAt: number; lastUsedAt: number | null }[];
    appPasswords: { id: string; name: string; hint: string; createdAt: number; lastUsedAt: number | null }[];
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

function PasswordDialog({ open, hasPassword, onClose }: { open: boolean; hasPassword: boolean; onClose: () => void }) {
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
              helperText={t('Mindestens 10 Zeichen.')}
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
          <Button type="submit" variant="contained" disabled={busy || next.length < 10 || next !== repeat}>
            {t('Speichern')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function AppPasswordDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const close = () => {
    setName('');
    setToken(null);
    onClose();
  };
  const user = boot().user!;
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
                  const result = await api.post<{ token: string }>('/api/account/app-passwords', { name });
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

function MailSection({ account, onChanged }: { account: Account; onChanged: (prefs: MailPrefs) => void }) {
  const toggle = async (key: keyof MailPrefs, value: boolean) => {
    try {
      const result = await api.patch<{ prefs: MailPrefs }>('/api/account/prefs', { [key]: value });
      onChanged(result.prefs);
    } catch (error) {
      toast(errorText(error));
    }
  };
  const disabled = !account.mail || !account.user.email;
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
    {
      key: 'mailLogins',
      label: t('Bei Anmeldung von einem neuen Gerät'),
      text: t('Damit du merkst, wenn sich jemand anderes mit deinem Konto anmeldet'),
    },
  ];
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
      title={t('E-Mail-Benachrichtigungen')}
      description={
        !account.mail
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
    </Section>
  );
}

export function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dialog, setDialog] = useState<'password' | 'totp' | 'disable' | 'recovery' | 'app' | null>(null);
  const prefs = usePrefs();
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

  const saveProfile = async () => {
    try {
      await api.patch('/api/account', { name, email });
      toast(t('Gespeichert'));
      void load();
    } catch (error) {
      toast(errorText(error));
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
              <UserAvatar initials={account.user.initials} size={72} />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
                  {account.user.name}
                </Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mb: 1.5 }}>
                  @{account.user.username} · {account.user.role === 'admin' ? t('Admin') : t('Mitglied')}
                </Typography>
                <StorageMeter storage={account.storage} />
                <Box sx={{ display: locked ? 'none' : 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
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
                <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="contained" disabled={name === account.user.name && email === (account.user.email ?? '')}>
                    {t('Speichern')}
                  </Button>
                </Box>
              </Box>
            </Section>

            <Section title={t('Darstellung')} description={t('Gilt für diesen Browser.')} action={<ThemeToggleButton placement="bottom" />}>
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
                    value={prefs.corners}
                    onChange={(_event, value) => value !== null && setPrefs({ corners: value })}
                    aria-label={t('Ecken')}
                  >
                    <ToggleButton value={1}>{t('Rund')}</ToggleButton>
                    <ToggleButton value={0.5}>{t('Weich')}</ToggleButton>
                    <ToggleButton value={0.1}>{t('Kantig')}</ToggleButton>
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
              </Box>
            </Section>

            <MailSection account={account} onChanged={(next) => setAccount({ ...account, prefs: next })} />

            <Section title={t('Sicherheit')} description={t('Je mehr du einrichtest, desto schwerer kommen Fremde an deine Dateien.')}>
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
            </Section>

            {!locked && (
              <Section
                title={t('WebDAV und App-Passwörter')}
                description={t(
                  'Binde MoeCloud als Laufwerk im Explorer, im Finder oder mit rclone ein. Melde dich dort mit deinem Benutzernamen und einem App-Passwort an.'
                )}
              >
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
                  <CopyField value={boot().webdav ?? `${location.origin}/dav/`} label={t('WebDAV-Adresse')} />
                  <CopyField value={account.user.username} label={t('Benutzername')} />
                </Box>
                {security.appPasswords.map((entry) => (
                  <Row
                    key={entry.id}
                    icon={<KeyRounded />}
                    title={entry.name}
                    text={`…${entry.hint} · ${entry.lastUsedAt ? t('zuletzt genutzt {date}', { date: formatDate(entry.lastUsedAt) }) : t('noch nie genutzt')}`}
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
          </>
        )}
      </Box>
      <PasswordDialog open={dialog === 'password'} hasPassword={Boolean(security?.hasPassword)} onClose={() => setDialog(null)} />
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
    </AppShell>
  );
}
