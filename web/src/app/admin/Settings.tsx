import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { api, errorText } from '../../lib/api';
import { dayValue, endOfDay } from '../../lib/format';
import { t } from '../../lib/i18n';
import { Section } from '../common/bits';
import { QuotaField } from '../common/QuotaField';
import { toast } from '../common/toast';
import { Loading, SaveBar, Toggle, loadSettings, saveSettings, useDraft, type Settings } from './shared';
import { AppearanceSection } from './Appearance';

export function SettingsSection({ onChanged }: { onChanged?: (settings: Settings) => void }) {
  const form = useDraft<Settings>(loadSettings, async (changes) => {
    const next = await saveSettings(changes);
    onChanged?.(next);
    return next;
  });
  const { draft, saved } = form;
  if (!draft || !saved) return <Loading />;
  const set = (key: string, value: string | number | boolean | null) => form.set(key, value as string);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section title={t('Allgemein')}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('Name der Cloud')}
            value={draft['site.name']}
            onChange={(event) => set('site.name', event.target.value)}
            helperText={t('Steht im Browser-Tab, bei der Anmeldung und in Link-Vorschauen.')}
          />
          <TextField
            label={t('Adresse')}
            value={draft['site.url']}
            onChange={(event) => set('site.url', event.target.value)}
            helperText={t('Unter dieser Adresse erreichen andere deine Cloud. Links und Passkeys nutzen sie.')}
          />
          <TextField
            select
            label={t('Standardsprache')}
            value={draft['site.language']}
            onChange={(event) => set('site.language', event.target.value)}
            helperText={t('Gilt, bis jemand eine eigene Sprache wählt.')}
          >
            <MenuItem value="de">Deutsch</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </TextField>
        </Box>
      </Section>

      <Section
        title={t('Hinweis für alle')}
        description={t('Erscheint oben auf jeder Seite, zum Beispiel vor einer geplanten Wartung. Jede Person kann ihn ausblenden.')}
      >
        <TextField
          label={t('Text')}
          value={draft['notice.text']}
          onChange={(event) => set('notice.text', event.target.value)}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: 500 } }}
          placeholder={t('Am Samstag ab 20 Uhr ist die Cloud für etwa eine Stunde nicht erreichbar.')}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField select label={t('Art')} value={draft['notice.level']} onChange={(event) => set('notice.level', event.target.value)}>
            <MenuItem value="info">{t('Information')}</MenuItem>
            <MenuItem value="warning">{t('Warnung')}</MenuItem>
          </TextField>
          <TextField
            label={t('Anzeigen bis')}
            type="date"
            value={dayValue(Number(draft['notice.until']))}
            onChange={(event) => set('notice.until', endOfDay(event.target.value) ?? 0)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={t('Leer lassen, damit der Hinweis bleibt, bis du ihn löschst.')}
          />
        </Box>
      </Section>

      <Section
        title={t('Wartungsmodus')}
        description={t('Im Wartungsmodus kommen nur Admins rein. Alle anderen sehen eine Wartungsseite, Links und WebDAV sind gesperrt.')}
      >
        <Toggle
          checked={Boolean(draft['maintenance.enabled'])}
          onChange={(value) => set('maintenance.enabled', value)}
          label={t('Wartungsmodus einschalten')}
        />
        <TextField
          label={t('Nachricht auf der Wartungsseite')}
          value={draft['maintenance.message']}
          onChange={(event) => set('maintenance.message', event.target.value)}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: 500 } }}
          placeholder={t('Wir spielen gerade ein Update ein. In ein paar Minuten geht es weiter.')}
        />
      </Section>

      <AppearanceSection personal={Boolean(draft['themes.personal'])} onPersonal={(value) => set('themes.personal', value)} />

      <Section title={t('Anmeldung')}>
        <RadioGroup
          value={draft['auth.registration']}
          onChange={(event) => set('auth.registration', event.target.value)}
          aria-label={t('Registrierung')}
        >
          <FormControlLabel value="closed" control={<Radio />} label={t('Nur Admins legen Konten an')} />
          <FormControlLabel value="invite" control={<Radio />} label={t('Mit Einladungslink')} />
          <FormControlLabel value="open" control={<Radio />} label={t('Jeder darf sich registrieren')} />
        </RadioGroup>
        <Toggle
          checked={Boolean(draft['auth.passkeys'])}
          onChange={(value) => set('auth.passkeys', value)}
          label={t('Passkeys erlauben')}
          hint={t('Anmelden mit Fingerabdruck, Gesicht oder Sicherheitsschlüssel.')}
        />
        <TextField
          label={t('Mindestlänge für Passwörter')}
          type="number"
          value={draft['auth.passwordMin']}
          onChange={(event) => set('auth.passwordMin', Math.min(64, Math.max(0, Math.round(Number(event.target.value)))))}
          slotProps={{
            htmlInput: { min: 10, max: 64 },
            input: { endAdornment: <InputAdornment position="end">{t('Zeichen')}</InputAdornment> },
          }}
          helperText={t('Gilt für neue und geänderte Passwörter, zwischen 10 und 64.')}
          sx={{ maxWidth: 320 }}
        />
        <Toggle
          checked={Boolean(draft['auth.passwordBreach'])}
          onChange={(value) => set('auth.passwordBreach', value)}
          label={t('Passwörter aus Datenlecks ablehnen')}
          hint={t(
            'MoeCloud fragt bei Have I Been Pwned nach, ob ein neues Passwort schon in einem Datenleck stand. Übertragen werden nur fünf Zeichen eines Hashwerts, nie das Passwort.'
          )}
        />
        <Toggle
          checked={Boolean(draft['users.selfDelete'])}
          onChange={(value) => set('users.selfDelete', value)}
          label={t('Eigenes Konto löschen erlauben')}
          hint={t('Jede Person kann ihr Konto samt aller Dateien unter Konto selbst löschen. Den letzten Admin schützt MoeCloud.')}
        />
        <TextField
          select
          label={t('Zwei-Faktor-Anmeldung vorschreiben')}
          value={draft['auth.require2fa']}
          onChange={(event) => set('auth.require2fa', event.target.value)}
          helperText={t(
            'Wer noch keine Authenticator-App und keinen Passkey hat, richtet das direkt nach der nächsten Anmeldung ein. Bis dahin funktionieren auch App-Passwörter nicht.'
          )}
          sx={{ maxWidth: 420 }}
        >
          <MenuItem value="off">{t('Nicht vorschreiben')}</MenuItem>
          <MenuItem value="admins">{t('Für Admins')}</MenuItem>
          <MenuItem value="all">{t('Für alle')}</MenuItem>
        </TextField>
      </Section>

      <Section title={t('Speicher')}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <QuotaField
            label={t('Speicher pro Person')}
            value={Number(draft['storage.defaultQuota'])}
            onChange={(value) => set('storage.defaultQuota', value ?? 0)}
            helperText={t('Gilt für alle ohne eigenen Wert.')}
          />
          <QuotaField
            label={t('Größte Datei')}
            value={Number(draft['storage.maxUpload'])}
            onChange={(value) => set('storage.maxUpload', value ?? 0)}
            unlimitedLabel={t('Keine Grenze')}
          />
          <TextField
            label={t('Papierkorb leeren nach')}
            type="number"
            value={draft['storage.trashDays']}
            onChange={(event) => set('storage.trashDays', Math.max(0, Number(event.target.value)))}
            helperText={t('In Tagen. Bei 0 bleibt alles im Papierkorb, bis es jemand löscht.')}
          />
          <TextField
            label={t('Versionen pro Datei')}
            type="number"
            value={draft['storage.versions']}
            onChange={(event) => set('storage.versions', Math.max(0, Math.min(100, Number(event.target.value))))}
            helperText={t('So viele ältere Fassungen bleiben erhalten. Bei 0 gibt es keine Versionen.')}
          />
          <TextField
            label={t('Versionen löschen nach')}
            type="number"
            value={draft['storage.versionDays']}
            onChange={(event) => set('storage.versionDays', Math.max(0, Math.min(3650, Number(event.target.value))))}
            helperText={t('In Tagen. Bei 0 bleiben Versionen, bis die Zahl pro Datei erreicht ist.')}
          />
        </Box>
        <Toggle
          checked={Boolean(draft['search.content'])}
          onChange={(value) => set('search.content', value)}
          label={t('Auch im Inhalt von Dateien suchen')}
          hint={t('Durchsucht Texte, PDFs und Office-Dokumente. Der Suchindex liegt in der Datenbank.')}
        />
        <Toggle
          checked={Boolean(draft['import.enabled'])}
          onChange={(value) => set('import.enabled', value)}
          label={t('Downloads aus dem Internet')}
          hint={t('Unter „Neu“ lädt MoeCloud eine Datei von einer Adresse direkt in einen Ordner.')}
        />
        <Toggle
          checked={Boolean(draft['import.private'])}
          disabled={!draft['import.enabled']}
          onChange={(value) => set('import.private', value)}
          label={t('Auch Adressen im lokalen Netz erlauben')}
          hint={t(
            'Ausgeschaltet kommt niemand über MoeCloud an Geräte in deinem Netz, etwa den Router oder andere Dienste auf dem Server.'
          )}
        />
      </Section>

      <Section title={t('Wochenbericht')}>
        <Toggle
          checked={Boolean(draft['report.weekly'])}
          onChange={(value) => set('report.weekly', value)}
          label={t('Wochenbericht per E-Mail')}
          hint={t(
            'Jeden Montag um 8 Uhr bekommen alle Admins mit E-Mail-Adresse eine Übersicht: Speicher, Konten, Anmeldungen, Links, Sicherung und Updates.'
          )}
        />
        <Box>
          <Button
            variant="tonal"
            onClick={() =>
              void api
                .post('/api/admin/report/send')
                .then(() => toast(t('Der Bericht ist unterwegs an deine Adresse')))
                .catch((error: unknown) => toast(errorText(error)))
            }
          >
            {t('Jetzt an mich schicken')}
          </Button>
        </Box>
      </Section>

      <Section title={t('Push-Benachrichtigungen')}>
        <Toggle
          checked={Boolean(draft['push.enabled'])}
          onChange={(value) => set('push.enabled', value)}
          label={t('Push im Browser und über ntfy oder Gotify')}
          hint={t('Jede Person schaltet Push unter Konto für ihre Browser ein oder trägt einen eigenen Push-Dienst ein.')}
        />
        <Toggle
          checked={Boolean(draft['push.private'])}
          disabled={!draft['push.enabled']}
          onChange={(value) => set('push.private', value)}
          label={t('Push-Dienste im lokalen Netz erlauben')}
          hint={t(
            'Nötig, wenn ntfy oder Gotify bei dir zu Hause oder im selben Docker-Netz laufen. Dann kann jede Person Adressen in deinem Netz eintragen.'
          )}
        />
      </Section>

      <Section title={t('Teilen')}>
        <Toggle
          checked={Boolean(draft['share.links'])}
          onChange={(value) => set('share.links', value)}
          label={t('Öffentliche Links')}
          hint={t('Wer den Link kennt, kann ohne Konto zugreifen.')}
        />
        <Toggle
          checked={Boolean(draft['share.requirePassword'])}
          onChange={(value) => set('share.requirePassword', value)}
          label={t('Passwort für Links verlangen')}
        />
        <Toggle
          checked={Boolean(draft['share.stripLocation'])}
          onChange={(value) => set('share.stripLocation', value)}
          label={t('Standort aus Fotos in Links entfernen')}
          hint={t('Wer Fotos über einen Link öffnet oder herunterlädt, sieht keine GPS-Daten. Die Originale bleiben unverändert.')}
        />
        <Toggle
          checked={Boolean(draft['share.slugs'])}
          onChange={(value) => set('share.slugs', value)}
          label={t('Eigene Adressen für Links erlauben')}
          hint={t('Statt einer zufälligen Adresse geht dann auch /s/urlaub-2026. Solche Adressen lassen sich leichter erraten.')}
        />
        <Toggle
          checked={Boolean(draft['share.reports'])}
          onChange={(value) => set('share.reports', value)}
          label={t('Besucher können Links melden')}
          hint={t('Auf jeder geteilten Seite steht „Inhalt melden“. Meldungen landen unter Admin › Links und bei allen Admins.')}
        />
        <TextField
          label={t('Links laufen spätestens ab nach')}
          type="number"
          value={draft['share.maxDays']}
          onChange={(event) => set('share.maxDays', Math.max(0, Number(event.target.value)))}
          helperText={t('In Tagen. Bei 0 dürfen Links unbegrenzt gelten.')}
          sx={{ maxWidth: 360 }}
        />
        <Toggle
          checked={Boolean(draft['share.users'])}
          onChange={(value) => set('share.users', value)}
          label={t('Mit Personen teilen')}
          hint={t('Personen mit Konto teilen Ordner und Dateien miteinander.')}
        />
        <Toggle
          checked={Boolean(draft['users.directory'])}
          onChange={(value) => set('users.directory', value)}
          label={t('Personen finden')}
          hint={t('Beim Teilen schlägt MoeCloud passende Namen vor. Ohne diese Einstellung muss man den Benutzernamen genau kennen.')}
        />
      </Section>

      <Section title={t('Aufbewahrung und Updates')}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('Protokoll aufbewahren')}
            type="number"
            value={draft['audit.days']}
            onChange={(event) => set('audit.days', Math.max(0, Number(event.target.value)))}
            helperText={t('In Tagen. Bei 0 bleibt alles erhalten.')}
          />
          <TextField
            label={t('Aktivität aufbewahren')}
            type="number"
            value={draft['activity.days']}
            onChange={(event) => set('activity.days', Math.max(0, Number(event.target.value)))}
            helperText={t('In Tagen. Bei 0 bleibt alles erhalten.')}
          />
        </Box>
        <Toggle
          checked={Boolean(draft['updates.check'])}
          onChange={(value) => set('updates.check', value)}
          label={t('Einmal am Tag nach neuen Versionen sehen')}
          hint={t(
            'Lädt dafür die Datei version.json von moecloud.moestudio.net, ohne Angaben über deinen Server oder die installierte Version.'
          )}
        />
      </Section>

      <Section
        title={t('Rechtliches')}
        description={t(
          'Eine Adresse wie https://example.com/impressum verlinkt eine fremde Seite. Text erscheint auf einer eigenen Seite. „## “ am Zeilenanfang macht eine Überschrift.'
        )}
      >
        <TextField
          label={t('Impressum')}
          value={draft['site.imprint']}
          onChange={(event) => set('site.imprint', event.target.value)}
          multiline
          minRows={3}
        />
        <TextField
          label={t('Datenschutz')}
          value={draft['site.privacy']}
          onChange={(event) => set('site.privacy', event.target.value)}
          multiline
          minRows={3}
        />
      </Section>

      <SaveBar count={form.changed.length} busy={form.busy} onSave={() => void form.save()} onReset={() => form.reset()} />
    </Box>
  );
}
