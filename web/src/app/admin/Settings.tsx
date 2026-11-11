import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { dayValue, endOfDay } from '../../lib/format';
import { t } from '../../lib/i18n';
import { buildPalette, normalizeHex, SEED_PRESETS } from '../../theme/scheme';
import { c, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { QuotaField } from '../common/QuotaField';
import { useSeed } from '../mount';
import { Loading, SaveBar, Toggle, loadSettings, saveSettings, useDraft, type Settings } from './shared';

function SeedPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(value);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box
        role="radiogroup"
        aria-label={t('Grundfarbe')}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1.5 }}
      >
        {SEED_PRESETS.map((preset) => {
          const selected = preset.value === value;
          return (
            <ButtonBase
              key={preset.value}
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(preset.value);
                setCustom(preset.value);
              }}
              sx={{
                flexDirection: 'column',
                gap: 1,
                p: 1.5,
                borderRadius: `${radius.md}px`,
                bgcolor: selected ? c.secondaryContainer : c.surfaceContainer,
                color: selected ? c.onSecondaryContainer : c.onSurface,
                boxShadow: selected ? `inset 0 0 0 2px ${c.primary}` : 'none',
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  bgcolor: preset.value,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                }}
              >
                {selected && <CheckRounded fontSize="small" />}
              </Box>
              <Typography variant="caption" sx={{ fontWeight: 500 }}>
                {t(preset.name)}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>
      <TextField
        label={t('Eigene Farbe')}
        value={custom}
        onChange={(event) => {
          setCustom(event.target.value);
          const hex = normalizeHex(event.target.value);
          if (hex) onChange(hex);
        }}
        error={!normalizeHex(custom)}
        helperText={
          normalizeHex(custom)
            ? t('Alle Farben der Oberfläche entstehen aus diesem Wert.')
            : t('Die Farbe muss als Hex-Wert wie #8b5cf6 angegeben werden.')
        }
        slotProps={{
          input: {
            startAdornment: (
              <Box
                component="input"
                type="color"
                aria-label={t('Farbe wählen')}
                value={normalizeHex(custom) ?? '#8b5cf6'}
                onChange={(event) => {
                  const next = (event.target as HTMLInputElement).value;
                  setCustom(next);
                  onChange(next);
                }}
                sx={{
                  width: 32,
                  height: 32,
                  p: 0,
                  border: 0,
                  borderRadius: '50%',
                  bgcolor: 'transparent',
                  mr: 1,
                  cursor: 'pointer',
                  '&::-webkit-color-swatch': { borderRadius: '50%', border: 'none' },
                  '&::-webkit-color-swatch-wrapper': { p: 0 },
                }}
              />
            ),
          },
        }}
        sx={{ maxWidth: 320 }}
      />
    </Box>
  );
}

export function SettingsSection({ onChanged }: { onChanged?: (settings: Settings) => void }) {
  const setSeed = useSeed();
  const form = useDraft<Settings>(loadSettings, async (changes) => {
    const body: Record<string, unknown> = { ...changes };
    if (body['site.seed']) body['site.palette'] = buildPalette(String(body['site.seed']));
    const next = await saveSettings(body as Partial<Settings>);
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

      <Section title={t('Aussehen')} description={t('Wähle die Grundfarbe für alle. Die Vorschau siehst du sofort.')}>
        <SeedPicker
          value={String(draft['site.seed'])}
          onChange={(value) => {
            set('site.seed', value);
            setSeed(value);
          }}
        />
      </Section>

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
        </Box>
        <Toggle
          checked={Boolean(draft['search.content'])}
          onChange={(value) => set('search.content', value)}
          label={t('Auch im Inhalt von Dateien suchen')}
          hint={t('Durchsucht Texte, PDFs und Office-Dokumente. Der Suchindex liegt in der Datenbank.')}
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

      <SaveBar
        count={form.changed.length}
        busy={form.busy}
        onSave={() => void form.save()}
        onReset={() => {
          form.reset();
          setSeed(String(saved['site.seed']));
        }}
      />
    </Box>
  );
}
