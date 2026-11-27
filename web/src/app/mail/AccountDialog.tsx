import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { noteText, type AccountsInfo, type Endpoint, type MailAccount, type Security } from './model';

interface Suggestion {
  source: 'preset' | 'known' | 'guess';
  name: string;
  imap: Endpoint;
  smtp: Endpoint;
  login: string;
  note: string | null;
}

function EndpointFields({ label, value, onChange }: { label: string; value: Endpoint; onChange: (next: Endpoint) => void }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1.3fr' }, gap: 1.5 }}>
      <TextField
        label={label}
        value={value.host}
        onChange={(event) => onChange({ ...value, host: event.target.value.trim() })}
        slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, inputMode: 'url' } }}
      />
      <TextField
        label={t('Port')}
        type="number"
        value={value.port}
        onChange={(event) => onChange({ ...value, port: Number(event.target.value) || 0 })}
        slotProps={{ htmlInput: { min: 1, max: 65535 } }}
      />
      <TextField
        select
        label={t('Verschlüsselung')}
        value={value.security}
        onChange={(event) => onChange({ ...value, security: event.target.value as Security })}
      >
        <MenuItem value="tls">SSL/TLS</MenuItem>
        <MenuItem value="starttls">STARTTLS</MenuItem>
        <MenuItem value="none">{t('Keine')}</MenuItem>
      </TextField>
    </Box>
  );
}

export function AccountDialog({
  open,
  info,
  account,
  onClose,
  onSaved,
}: {
  open: boolean;
  info: AccountsInfo;
  account: MailAccount | null;
  onClose: () => void;
  onSaved: (account: MailAccount | null) => void;
}) {
  const phone = useMediaQuery('(max-width: 599.95px)');
  const editing = Boolean(account);
  const [email, setEmail] = useState(account?.email ?? info.email ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(account?.name ?? '');
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [signature, setSignature] = useState(account?.signature ?? '');
  const [notify, setNotify] = useState(account?.notify ?? true);
  const [saveSent, setSaveSent] = useState(account?.saveSent ?? true);
  const [login, setLogin] = useState(account?.login ?? '');
  const [imap, setImap] = useState<Endpoint>(account?.imap ?? { host: '', port: 993, security: 'tls' });
  const [smtp, setSmtp] = useState<Endpoint>(account?.smtp ?? { host: '', port: 465, security: 'tls' });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [usePreset, setUsePreset] = useState(Boolean(account?.preset));
  const [connection, setConnection] = useState(!editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return;
    const timer = setTimeout(() => {
      api
        .get<{ suggestion: Suggestion | null }>(`/api/mail/setup?email=${encodeURIComponent(email)}`)
        .then((result) => {
          setSuggestion(result.suggestion);
          if (!result.suggestion) return;
          setImap(result.suggestion.imap);
          setSmtp(result.suggestion.smtp);
          setLogin(result.suggestion.login);
          setUsePreset(result.suggestion.source === 'preset');
          if (result.suggestion.source === 'guess') setAdvanced(true);
        })
        .catch(() => setSuggestion(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [email, editing]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let saved: MailAccount | null = account;
      if (connection) {
        const payload = {
          name: name.trim(),
          email: email.trim(),
          displayName: displayName.trim(),
          login: login.trim(),
          password,
          preset: usePreset,
          ...(usePreset ? {} : { imap, smtp }),
        };
        const result = editing
          ? await api.put<{ account: MailAccount }>(`/api/mail/accounts/${account!.id}/connection`, payload)
          : await api.post<{ account: MailAccount }>('/api/mail/accounts', payload);
        saved = result.account;
      }
      if (saved && (editing || signature || name || displayName)) {
        const result = await api.patch<{ account: MailAccount }>(`/api/mail/accounts/${saved.id}`, {
          ...(name.trim() ? { name: name.trim() } : {}),
          displayName: displayName.trim(),
          signature,
          notify,
          saveSent,
        });
        saved = result.account;
      }
      toast(editing ? t('Gespeichert') : t('Postfach verbunden'));
      onSaved(saved);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!account) return;
    const sure = await confirm({
      title: t('Postfach „{name}“ entfernen?', { name: account.name }),
      text: t('Die E-Mails bleiben auf dem Mailserver, MoeCloud vergisst nur die Verbindung.'),
      confirm: t('Entfernen'),
      danger: true,
    });
    if (!sure) return;
    try {
      await api.delete(`/api/mail/accounts/${account.id}`);
      onSaved(null);
    } catch (reason) {
      toast(errorText(reason));
    }
  };

  const note = noteText(suggestion?.note ?? null);
  const presetMatch = suggestion?.source === 'preset';
  const valid = connection
    ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && password.length > 0 && (usePreset || (imap.host && smtp.host))
    : true;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullScreen={phone} maxWidth="sm" fullWidth data-mail-account-dialog>
      {busy && <LinearProgress sx={{ position: 'absolute', insetInline: 0, top: 0 }} />}
      <DialogTitle>{editing ? t('Postfach bearbeiten') : t('Postfach verbinden')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {!editing && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {info.preset
              ? t('Für Adressen von {domain} reicht dein Passwort. Andere Postfächer verbindest du über IMAP und SMTP.', {
                  domain: info.preset.domain || info.preset.name,
                })
              : t('MoeCloud holt deine E-Mails per IMAP und verschickt sie per SMTP. Das Passwort liegt verschlüsselt auf dem Server.')}
          </Typography>
        )}
        {editing && (
          <>
            <TextField
              label={t('Name in der Liste')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
            <TextField
              label={t('Absendername')}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              helperText={t('So sehen andere deinen Namen.')}
            />
            <TextField
              label={t('Signatur')}
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              multiline
              minRows={3}
              helperText={t('Steht unter jeder neuen E-Mail.')}
            />
            <FormControlLabel
              control={<Switch checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
              label={t('Bei neuen E-Mails benachrichtigen')}
            />
            <FormControlLabel
              control={<Switch checked={saveSent} onChange={(event) => setSaveSent(event.target.checked)} />}
              label={t('Gesendete E-Mails im Ordner „Gesendet“ ablegen')}
            />
            <Button variant="text" sx={{ alignSelf: 'flex-start' }} onClick={() => setConnection(!connection)}>
              {connection ? t('Zugangsdaten so lassen') : t('Zugangsdaten ändern')}
            </Button>
          </>
        )}
        <Collapse in={connection} unmountOnExit>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
            <TextField
              label={t('E-Mail-Adresse')}
              value={email}
              onChange={(event) => setEmail(event.target.value.trim())}
              type="email"
              autoComplete="email"
              autoFocus={!editing}
              slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
            />
            <TextField
              label={t('Passwort')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              helperText={note ?? undefined}
            />
            {!editing && (
              <TextField
                label={t('Name in der Liste')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('zum Beispiel Privat oder Arbeit')}
              />
            )}
            {presetMatch && (
              <FormControlLabel
                control={<Switch checked={usePreset} onChange={(event) => setUsePreset(event.target.checked)} />}
                label={t('Einstellungen von „{name}“ nehmen', { name: suggestion!.name })}
              />
            )}
            {!usePreset && (
              <>
                {suggestion && !advanced && (
                  <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                    {suggestion.source === 'known'
                      ? t('Erkannt: {imap} und {smtp}', { imap: suggestion.imap.host, smtp: suggestion.smtp.host })
                      : t('Vermutet: {imap} und {smtp}', { imap: suggestion.imap.host, smtp: suggestion.smtp.host })}
                  </Typography>
                )}
                <Button variant="text" sx={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)} data-mail-advanced>
                  {advanced ? t('Server ausblenden') : t('Server selbst eintragen')}
                </Button>
                <Collapse in={advanced}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label={t('Benutzername')}
                      value={login}
                      onChange={(event) => setLogin(event.target.value)}
                      helperText={t('Meist die E-Mail-Adresse.')}
                      slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
                    />
                    <EndpointFields label={t('Eingang (IMAP)')} value={imap} onChange={setImap} />
                    <EndpointFields label={t('Ausgang (SMTP)')} value={smtp} onChange={setSmtp} />
                  </Box>
                </Collapse>
              </>
            )}
          </Box>
        </Collapse>
        {error && (
          <Alert severity="error" data-mail-account-error>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: editing ? 'space-between' : 'flex-end' }}>
        {editing && (
          <Button color="error" onClick={() => void remove()} disabled={busy}>
            {t('Entfernen')}
          </Button>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={busy}>
            {t('Abbrechen')}
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !valid} data-mail-connect>
            {connection ? t('Verbinden') : t('Speichern')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
