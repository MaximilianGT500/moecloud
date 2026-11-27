import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { FEATURE_SETTING, type Feature } from '../../../../shared/features';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { APP_GROUPS, appCatalog, groupLabel, type AppInfo } from '../common/apps';
import { Section } from '../common/bits';
import { Loading, SaveBar, Toggle, loadSettings, saveSettings, useDraft, type Settings } from './shared';

function AppRow({
  app,
  checked,
  blocked,
  onChange,
}: {
  app: AppInfo;
  checked: boolean;
  blocked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Box
      data-admin-app={app.key}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        py: 1,
        px: 1.5,
        borderRadius: `${radius.md}px`,
        bgcolor: checked && !blocked ? c.surfaceContainerHigh : 'transparent',
        opacity: blocked ? 0.6 : 1,
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          flex: 'none',
          borderRadius: `${radius.md}px`,
          display: 'grid',
          placeItems: 'center',
          bgcolor: checked && !blocked ? c.primaryContainer : c.surfaceContainerHighest,
          color: checked && !blocked ? c.onPrimaryContainer : c.onSurfaceVariant,
        }}
      >
        {app.icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {app.label}
        </Typography>
        <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
          {blocked ? t('Geht nur zusammen mit dem Kalender') : app.text}
        </Typography>
      </Box>
      <Switch
        checked={checked}
        disabled={blocked}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { 'aria-label': app.label } }}
      />
    </Box>
  );
}

interface MailServer {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
}

interface MailPreset {
  name: string;
  domain: string;
  login: 'email' | 'local';
  imap: MailServer;
  smtp: MailServer;
}

const EMPTY_PRESET: MailPreset = {
  name: '',
  domain: '',
  login: 'email',
  imap: { host: '', port: 993, security: 'tls' },
  smtp: { host: '', port: 465, security: 'tls' },
};

function ServerFields({ label, value, onChange }: { label: string; value: MailServer; onChange: (next: MailServer) => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      <TextField
        label={label}
        value={value.host}
        onChange={(event) => onChange({ ...value, host: event.target.value.trim() })}
        placeholder="mail.example.com"
        sx={{ flex: '2 1 220px' }}
      />
      <TextField
        label={t('Port')}
        type="number"
        value={value.port}
        onChange={(event) => onChange({ ...value, port: Math.min(65535, Math.max(1, Math.round(Number(event.target.value) || 1))) })}
        sx={{ flex: '0 1 110px' }}
      />
      <TextField
        select
        label={t('Verschlüsselung')}
        value={value.security}
        onChange={(event) => onChange({ ...value, security: event.target.value as MailServer['security'] })}
        sx={{ flex: '1 1 160px' }}
      >
        <MenuItem value="tls">TLS</MenuItem>
        <MenuItem value="starttls">STARTTLS</MenuItem>
        <MenuItem value="none">{t('Keine')}</MenuItem>
      </TextField>
    </Box>
  );
}

function ReadingSection({ draft, set }: { draft: Settings; set: (key: string, value: unknown) => void }) {
  const preset = (draft['webmail.preset'] as unknown as MailPreset | null) ?? null;
  const mailOn = Boolean(draft['webmail.enabled']);
  const feedsOn = Boolean(draft['feeds.enabled']) || Boolean(draft['bookmarks.enabled']);
  if (!mailOn && !feedsOn) return null;
  return (
    <Section
      title={t('E-Mail, Feeds und Lesezeichen')}
      description={t('Wie weit MoeCloud für E-Mail, Feeds und Lesezeichen ins Netz greifen darf.')}
    >
      {mailOn && (
        <Box data-admin-webmail sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Toggle
            checked={Boolean(draft['webmail.custom'])}
            onChange={(value) => set('webmail.custom', value)}
            label={t('Eigene Mailserver erlauben')}
            hint={t('Aus: Verbinden lassen sich nur Postfächer mit der Vorgabe unten.')}
          />
          <Toggle
            checked={Boolean(draft['webmail.private'])}
            onChange={(value) => set('webmail.private', value)}
            label={t('Mailserver im lokalen Netz erlauben')}
            hint={t('Für einen Mailserver im selben Netz wie MoeCloud. Nur damit gehen auch Verbindungen ohne Verschlüsselung.')}
          />
          <TextField
            label={t('Postfächer pro Konto')}
            type="number"
            value={draft['webmail.maxAccounts'] ?? 5}
            onChange={(event) => set('webmail.maxAccounts', Math.min(20, Math.max(1, Math.round(Number(event.target.value) || 1))))}
            slotProps={{ htmlInput: { min: 1, max: 20 } }}
            sx={{ maxWidth: 240 }}
          />
          <Toggle
            checked={Boolean(preset)}
            onChange={(value) => set('webmail.preset', value ? EMPTY_PRESET : null)}
            label={t('Vorgabe für einen eigenen Mailserver')}
            hint={t('Wer eine Adresse dieser Domain verbindet, braucht nur das Passwort. Ohne Domain gilt die Vorgabe für alle Adressen.')}
          />
          {preset && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pl: { md: 2 } }} data-admin-preset>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <TextField
                  label={t('Name')}
                  value={preset.name}
                  onChange={(event) => set('webmail.preset', { ...preset, name: event.target.value })}
                  placeholder={t('zum Beispiel Firma')}
                  sx={{ flex: '1 1 200px' }}
                />
                <TextField
                  label={t('Domain')}
                  value={preset.domain}
                  onChange={(event) => set('webmail.preset', { ...preset, domain: event.target.value.trim().toLowerCase() })}
                  placeholder="example.com"
                  sx={{ flex: '1 1 200px' }}
                />
                <TextField
                  select
                  label={t('Anmeldung mit')}
                  value={preset.login}
                  onChange={(event) => set('webmail.preset', { ...preset, login: event.target.value })}
                  sx={{ flex: '1 1 200px' }}
                >
                  <MenuItem value="email">{t('der ganzen E-Mail-Adresse')}</MenuItem>
                  <MenuItem value="local">{t('dem Teil vor dem @')}</MenuItem>
                </TextField>
              </Box>
              <ServerFields
                label={t('Eingang (IMAP)')}
                value={preset.imap}
                onChange={(imap) => set('webmail.preset', { ...preset, imap })}
              />
              <ServerFields
                label={t('Ausgang (SMTP)')}
                value={preset.smtp}
                onChange={(smtp) => set('webmail.preset', { ...preset, smtp })}
              />
            </Box>
          )}
        </Box>
      )}
      {feedsOn && (
        <Box data-admin-feeds sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Toggle
            checked={Boolean(draft['feeds.private'])}
            onChange={(value) => set('feeds.private', value)}
            label={t('Seiten im lokalen Netz abrufen')}
            hint={t('Feeds, Lesezeichen und Bilder aus E-Mails dürfen dann auch Adressen im selben Netz wie MoeCloud laden.')}
          />
          {Boolean(draft['feeds.enabled']) && (
            <TextField
              label={t('Feeds pro Konto')}
              type="number"
              value={draft['feeds.maxFeeds'] ?? 200}
              onChange={(event) => set('feeds.maxFeeds', Math.min(2000, Math.max(1, Math.round(Number(event.target.value) || 1))))}
              slotProps={{
                htmlInput: { min: 1, max: 2000 },
                input: { endAdornment: <InputAdornment position="end">{t('Feeds')}</InputAdornment> },
              }}
              sx={{ maxWidth: 240 }}
            />
          )}
        </Box>
      )}
    </Section>
  );
}

export function AppsSection() {
  const form = useDraft<Settings>(loadSettings, saveSettings);
  const { draft, saved } = form;
  if (!draft || !saved) return <Loading />;
  const catalog = appCatalog();
  const raw = (key: Feature) => Boolean(draft[FEATURE_SETTING[key]]);
  const enabled = (app: AppInfo): boolean => raw(app.key) && (!app.parent || raw(app.parent));
  const newOff = (draft['accounts.features'] as unknown as string[] | undefined) ?? [];
  const count = catalog.filter(enabled).length;

  return (
    <Box data-admin-apps sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section
        title={t('Funktionen für alle')}
        description={t(
          'Was du hier ausschaltest, ist für alle weg: aus Navigation, Startseite und Suche, dazu die Schnittstellen, Abgleiche und öffentlichen Seiten. Die Daten bleiben erhalten und sind wieder da, sobald du die Funktion einschaltest.'
        )}
      >
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('{count} von {total} Funktionen sind eingeschaltet', { count, total: catalog.length })}
        </Typography>
        {APP_GROUPS.map((group) => (
          <Box key={group} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="overline" sx={{ color: c.onSurfaceVariant, px: 1.5 }}>
              {groupLabel(group)}
            </Typography>
            {catalog
              .filter((app) => app.group === group)
              .map((app) => (
                <AppRow
                  key={app.key}
                  app={app}
                  checked={raw(app.key)}
                  blocked={Boolean(app.parent && !raw(app.parent))}
                  onChange={(value) => form.set(FEATURE_SETTING[app.key], value as unknown as string)}
                />
              ))}
          </Box>
        ))}
      </Section>

      <Section
        title={t('Für neue Konten')}
        description={t(
          'So sieht MoeCloud für Personen aus, die neu dazukommen. Jede Person ändert das später selbst unter Konto › Funktionen.'
        )}
      >
        <Toggle
          checked={Boolean(draft['accounts.welcome'])}
          onChange={(value) => form.set('accounts.welcome', value as unknown as string)}
          label={t('Mit einer Einführung begrüßen')}
          hint={t(
            'Beim ersten Anmelden fragt MoeCloud, welche Funktionen jemand nutzen möchte, wo die Navigation sitzen soll und ob es hell oder dunkel sein darf.'
          )}
        />
        <Box data-new-features sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t('Sichtbar für neue Konten')}
          </Typography>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Was hier aus ist, sehen neue Konten erst, wenn sie es unter Konto › Funktionen einschalten.')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
            {catalog.filter(enabled).map((app) => (
              <FormControlLabel
                key={app.key}
                control={
                  <Checkbox
                    checked={!newOff.includes(app.key)}
                    onChange={(event) =>
                      form.set(
                        'accounts.features',
                        (event.target.checked ? newOff.filter((entry) => entry !== app.key) : [...newOff, app.key]) as unknown as string
                      )
                    }
                  />
                }
                label={app.label}
              />
            ))}
          </Box>
        </Box>
      </Section>

      <ReadingSection draft={draft} set={(key, value) => form.set(key, value as unknown as string)} />

      <SaveBar count={form.changed.length} busy={form.busy} onSave={() => void form.save()} onReset={() => form.reset()} />
    </Box>
  );
}
