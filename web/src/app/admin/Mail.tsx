import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { Section } from '../common/bits';
import { toast } from '../common/toast';
import { Loading, SaveBar, Toggle } from './shared';

interface MailSettings {
  'mail.enabled': boolean;
  'mail.host': string;
  'mail.port': number;
  'mail.security': 'tls' | 'starttls' | 'none';
  'mail.user': string;
  'mail.from': string;
  'mail.fromName': string;
  [key: string]: string | number | boolean;
}

interface MailView {
  settings: MailSettings;
  hasPassword: boolean;
  ready: boolean;
}

const PORTS: Record<string, number> = { tls: 465, starttls: 587, none: 25 };

export function MailSection() {
  const [view, setView] = useState<MailView | null>(null);
  const [draft, setDraft] = useState<MailSettings | null>(null);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(boot().user?.email ?? '');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (next: MailView) => {
    setView(next);
    setDraft(next.settings);
    setPassword('');
    setClearPassword(false);
  };

  useEffect(() => {
    api
      .get<MailView>('/api/admin/mail')
      .then(apply)
      .catch((error) => toast(errorText(error)));
  }, []);

  if (!view || !draft) return <Loading />;
  const set = (key: keyof MailSettings, value: string | number | boolean) => setDraft({ ...draft, [key]: value });
  const changed = (Object.keys(draft) as (keyof MailSettings)[]).filter((key) => draft[key] !== view.settings[key]);
  const count = changed.length + (password ? 1 : 0) + (clearPassword ? 1 : 0);

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(changed.map((key) => [key, draft[key]]));
      if (password) body['mail.password'] = password;
      if (clearPassword) body.clearPassword = true;
      apply(await api.patch<MailView>('/api/admin/mail', body));
      toast(t('Gespeichert'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const data = await api.post<{ to: string }>('/api/admin/mail/test', to.trim() ? { to: to.trim() } : {});
      setResult({ ok: true, text: t('Die Test-E-Mail an {email} ist raus. Schau auch im Spam-Ordner nach.', { email: data.to }) });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section
        title={t('E-Mail-Versand')}
        description={t(
          'Darüber verschickt MoeCloud Links zum Zurücksetzen von Passwörtern, Einladungen und Benachrichtigungen. Du brauchst dafür die Zugangsdaten eines SMTP-Servers.'
        )}
      >
        {!view.ready && view.settings['mail.enabled'] && (
          <Alert severity="warning">{t('Es fehlen noch Server oder Absenderadresse.')}</Alert>
        )}
        <Toggle
          checked={Boolean(draft['mail.enabled'])}
          onChange={(value) => set('mail.enabled', value)}
          label={t('E-Mails verschicken')}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('SMTP-Server')}
            placeholder="smtp.example.com"
            value={draft['mail.host']}
            onChange={(event) => set('mail.host', event.target.value)}
          />
          <TextField
            label={t('Port')}
            type="number"
            value={draft['mail.port']}
            onChange={(event) => set('mail.port', Math.max(1, Math.min(65535, Number(event.target.value) || 587)))}
          />
          <TextField
            select
            label={t('Verschlüsselung')}
            value={draft['mail.security']}
            onChange={(event) => {
              const value = event.target.value as MailSettings['mail.security'];
              setDraft({ ...draft, 'mail.security': value, 'mail.port': PORTS[value] });
            }}
          >
            <MenuItem value="starttls">{t('STARTTLS (meist Port 587)')}</MenuItem>
            <MenuItem value="tls">{t('TLS (meist Port 465)')}</MenuItem>
            <MenuItem value="none">{t('Keine (nur im eigenen Netz)')}</MenuItem>
          </TextField>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('Benutzername')}
            autoComplete="off"
            value={draft['mail.user']}
            onChange={(event) => set('mail.user', event.target.value)}
          />
          <TextField
            label={view.hasPassword ? t('Neues Passwort') : t('Passwort')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            helperText={view.hasPassword ? t('Ein Passwort ist gespeichert. Leer lassen, um es zu behalten.') : undefined}
          />
          <TextField
            label={t('Absenderadresse')}
            type="email"
            placeholder="cloud@example.com"
            value={draft['mail.from']}
            onChange={(event) => set('mail.from', event.target.value)}
          />
          <TextField
            label={t('Absendername')}
            placeholder={boot().site.name}
            value={draft['mail.fromName']}
            onChange={(event) => set('mail.fromName', event.target.value)}
          />
        </Box>
        {view.hasPassword && (
          <FormControlLabel
            control={<Switch checked={clearPassword} onChange={(event) => setClearPassword(event.target.checked)} />}
            label={t('Gespeichertes Passwort löschen')}
          />
        )}
      </Section>
      <Section title={t('Test-E-Mail')} description={t('Speichere zuerst, dann prüft der Test die gespeicherten Einstellungen.')}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            label={t('Empfänger')}
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
          />
          <Button variant="tonal" startIcon={<SendRounded />} disabled={testing || count > 0} onClick={() => void test()} sx={{ mt: 1 }}>
            {t('Test senden')}
          </Button>
        </Box>
        {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.text}</Alert>}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t('Startwerte kannst du auch über Umgebungsvariablen wie SMTP_HOST und SMTP_FROM setzen. Was du hier speicherst, hat Vorrang.')}
        </Typography>
      </Section>
      <SaveBar
        count={count}
        busy={busy}
        onSave={() => void save()}
        onReset={() => {
          setDraft(view.settings);
          setPassword('');
          setClearPassword(false);
        }}
      />
    </Box>
  );
}
