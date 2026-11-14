import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import WifiTetheringRounded from '@mui/icons-material/WifiTetheringRounded';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { copyText, Section } from '../common/bits';
import { toast } from '../common/toast';
import { Loading, SaveBar, Toggle } from './shared';

interface SsoSettings {
  'oidc.enabled': boolean;
  'oidc.issuer': string;
  'oidc.clientId': string;
  'oidc.label': string;
  'oidc.autoCreate': boolean;
  'oidc.adminGroup': string;
  [key: string]: string | boolean;
}

interface SsoView {
  settings: SsoSettings;
  hasSecret: boolean;
  callback: string;
  ready: boolean;
  linked: number;
}

export function SsoSection() {
  const [view, setView] = useState<SsoView | null>(null);
  const [draft, setDraft] = useState<SsoSettings | null>(null);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (next: SsoView) => {
    setView(next);
    setDraft(next.settings);
    setSecret('');
    setClearSecret(false);
  };

  useEffect(() => {
    api
      .get<SsoView>('/api/admin/sso')
      .then(apply)
      .catch((error) => toast(errorText(error)));
  }, []);

  if (!view || !draft) return <Loading />;
  const set = (key: keyof SsoSettings, value: string | boolean) => setDraft({ ...draft, [key]: value });
  const changed = (Object.keys(draft) as (keyof SsoSettings)[]).filter((key) => draft[key] !== view.settings[key]);
  const count = changed.length + (secret ? 1 : 0) + (clearSecret ? 1 : 0);

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(changed.map((key) => [key, draft[key]]));
      if (secret) body['oidc.clientSecret'] = secret;
      if (clearSecret) body.clearSecret = true;
      apply(await api.patch<SsoView>('/api/admin/sso', body));
      setResult(null);
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
      const found = await api.post<{ issuer: string; groups: boolean }>('/api/admin/sso/test', {});
      const groups =
        draft['oidc.adminGroup'] && !found.groups
          ? ` ${t('Der Anbieter nennt keinen Scope groups, prüf dort, ob Gruppen im Token stehen.')}`
          : '';
      setResult({ ok: true, text: `${t('Der Anbieter {issuer} antwortet.', { issuer: found.issuer })}${groups}` });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section
        title={t('Anmeldung über OpenID Connect')}
        description={t(
          'Damit melden sich alle mit dem Konto eines Anbieters wie Authentik, Keycloak, Authelia, Zitadel, Google oder Microsoft an. Passwörter und Passkeys funktionieren daneben weiter.'
        )}
      >
        {view.settings['oidc.enabled'] && !view.ready && <Alert severity="warning">{t('Es fehlen noch Anbieter oder Client-ID.')}</Alert>}
        <Toggle
          checked={Boolean(draft['oidc.enabled'])}
          onChange={(value) => set('oidc.enabled', value)}
          label={t('Anmeldung über SSO anbieten')}
          hint={t('Auf der Anmeldeseite erscheint ein eigener Knopf dafür.')}
        />
        <TextField
          label={t('Weiterleitungsadresse')}
          value={view.callback}
          helperText={t('Trag diese Adresse beim Anbieter als Redirect URI ein.')}
          slotProps={{
            input: {
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={t('Kopieren')}>
                    <IconButton aria-label={t('Kopieren')} edge="end" onClick={() => void copyText(view.callback)}>
                      <ContentCopyRounded />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          label={t('Adresse des Anbieters')}
          placeholder="https://auth.example.com/application/o/moecloud/"
          value={draft['oidc.issuer']}
          onChange={(event) => set('oidc.issuer', event.target.value)}
          helperText={t('Die Issuer-URL. MoeCloud liest alles Weitere aus /.well-known/openid-configuration.')}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('Client-ID')}
            autoComplete="off"
            value={draft['oidc.clientId']}
            onChange={(event) => set('oidc.clientId', event.target.value)}
          />
          <TextField
            label={view.hasSecret ? t('Neues Client-Secret') : t('Client-Secret')}
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            helperText={
              view.hasSecret
                ? t('Ein Secret ist gespeichert. Leer lassen, um es zu behalten.')
                : t('Leer lassen für öffentliche Clients mit PKCE.')
            }
          />
          <TextField
            label={t('Text auf dem Knopf')}
            placeholder={t('Mit SSO anmelden')}
            value={draft['oidc.label']}
            onChange={(event) => set('oidc.label', event.target.value)}
          />
          <TextField
            label={t('Gruppe für Admins')}
            placeholder="moecloud-admins"
            value={draft['oidc.adminGroup']}
            onChange={(event) => set('oidc.adminGroup', event.target.value)}
            helperText={t('Wer in dieser Gruppe ist, wird Admin. Leer lassen, um Rollen nur hier zu vergeben.')}
          />
        </Box>
        {view.hasSecret && (
          <FormControlLabel
            control={<Switch checked={clearSecret} onChange={(event) => setClearSecret(event.target.checked)} />}
            label={t('Gespeichertes Secret löschen')}
          />
        )}
        <Toggle
          checked={Boolean(draft['oidc.autoCreate'])}
          onChange={(value) => set('oidc.autoCreate', value)}
          label={t('Konten automatisch anlegen')}
          hint={t(
            'Wer sich zum ersten Mal über den Anbieter anmeldet, bekommt ein Konto. Ausgeschaltet kommen nur Konten herein, deren bestätigte E-Mail-Adresse hier schon hinterlegt ist.'
          )}
        />
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {view.linked
            ? tn(view.linked, '{count} Konto ist mit dem Anbieter verknüpft.', '{count} Konten sind mit dem Anbieter verknüpft.')
            : t('Noch ist kein Konto mit dem Anbieter verknüpft.')}
        </Typography>
      </Section>
      <Section title={t('Verbindung testen')} description={t('Speichere zuerst, dann prüft der Test die gespeicherten Einstellungen.')}>
        <Box>
          <Button variant="tonal" startIcon={<WifiTetheringRounded />} disabled={testing || count > 0} onClick={() => void test()}>
            {t('Verbindung testen')}
          </Button>
        </Box>
        {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.text}</Alert>}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t(
            'Startwerte kannst du auch über Umgebungsvariablen wie OIDC_ISSUER und OIDC_CLIENT_ID setzen. Was du hier speicherst, hat Vorrang.'
          )}
        </Typography>
      </Section>
      <SaveBar
        count={count}
        busy={busy}
        onSave={() => void save()}
        onReset={() => {
          setDraft(view.settings);
          setSecret('');
          setClearSecret(false);
        }}
      />
    </Box>
  );
}
