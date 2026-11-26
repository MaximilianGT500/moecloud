import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { REGIONS } from '../../../../shared/holidays';
import { supportedZones, zoneLabel } from '../../../../shared/time';
import { language, t } from '../../lib/i18n';
import { Section } from '../common/bits';
import { Loading, SaveBar, Toggle, loadSettings, saveSettings, useDraft, type Settings } from './shared';

export function CalendarSection() {
  const form = useDraft<Settings>(loadSettings, saveSettings);
  const { draft, saved } = form;
  if (!draft || !saved) return <Loading />;
  const set = (key: string, value: string | number | boolean | null) => form.set(key, value as string);
  const on = Boolean(draft['calendar.enabled']);

  return (
    <Box data-admin-calendar sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 10 }}>
      <Section title={t('Kalender')}>
        <Toggle
          checked={on}
          onChange={(value) => set('calendar.enabled', value)}
          label={t('Kalender einschalten')}
          hint={t(
            'Termine, Aufgaben, Buchungsseiten, Umfragen und CalDAV. Ausgeschaltet bleiben alle Daten erhalten, sind aber nicht erreichbar.'
          )}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            select
            label={t('Zeitzone für neue Konten')}
            value={draft['calendar.zone']}
            disabled={!on}
            onChange={(event) => set('calendar.zone', event.target.value)}
            helperText={t('Jede Person kann ihre Zeitzone selbst ändern.')}
          >
            {supportedZones().map((zone) => (
              <MenuItem key={zone} value={zone}>
                {zoneLabel(zone)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('Feiertage für neue Konten')}
            value={draft['calendar.holidays']}
            disabled={!on}
            onChange={(event) => set('calendar.holidays', event.target.value)}
          >
            <MenuItem value="">{t('Keine')}</MenuItem>
            {REGIONS.map((region) => (
              <MenuItem key={region.id} value={region.id}>
                {region.name[language]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('Papierkorb leeren nach')}
            type="number"
            value={draft['calendar.trashDays']}
            disabled={!on && !draft['contacts.enabled']}
            onChange={(event) => set('calendar.trashDays', Math.max(0, Math.min(3650, Number(event.target.value))))}
            helperText={t('In Tagen, gilt auch für Kontakte. Bei 0 bleibt alles im Papierkorb, bis es jemand löscht.')}
          />
        </Box>
        <Toggle
          checked={Boolean(draft['calendar.caldav'])}
          disabled={!on}
          onChange={(value) => set('calendar.caldav', value)}
          label={t('CalDAV')}
          hint={t('Kalender-Apps auf Handy und Computer synchronisieren mit App-Passwörtern.')}
        />
        <Toggle
          checked={Boolean(draft['calendar.freebusy'])}
          disabled={!on}
          onChange={(value) => set('calendar.freebusy', value)}
          label={t('Frei/beschäftigt-Suche')}
          hint={t('Personen können bei der Terminsuche sehen, wann andere beschäftigt sind, sofern diese das erlauben.')}
        />
      </Section>

      <Section title={t('Teilen und Einladen')}>
        <Toggle
          checked={Boolean(draft['calendar.publicLinks'])}
          disabled={!on}
          onChange={(value) => set('calendar.publicLinks', value)}
          label={t('Öffentliche Kalender')}
          hint={t('Kalender lassen sich per Link ohne Konto ansehen und abonnieren.')}
        />
        <Toggle
          checked={Boolean(draft['calendar.externalInvites'])}
          disabled={!on}
          onChange={(value) => set('calendar.externalInvites', value)}
          label={t('Externe Gäste per E-Mail einladen')}
          hint={t('Einladungen an Adressen außerhalb dieses Servers, mit Antwort-Link und Kalendereintrag.')}
        />
        <Toggle
          checked={Boolean(draft['calendar.booking'])}
          disabled={!on}
          onChange={(value) => set('calendar.booking', value)}
          label={t('Buchungsseiten')}
          hint={t('Andere buchen freie Zeiten ohne Konto.')}
        />
        <Toggle
          checked={Boolean(draft['calendar.polls'])}
          disabled={!on}
          onChange={(value) => set('calendar.polls', value)}
          label={t('Terminumfragen')}
          hint={t('Abstimmen über mehrere Terminvorschläge, auch ohne Konto.')}
        />
      </Section>

      <Section title={t('Abos und Importe')}>
        <Toggle
          checked={Boolean(draft['calendar.subscriptions'])}
          disabled={!on}
          onChange={(value) => set('calendar.subscriptions', value)}
          label={t('Kalender abonnieren erlauben')}
          hint={t('MoeCloud lädt iCal-Kalender aus dem Internet regelmäßig nach.')}
        />
        <Toggle
          checked={Boolean(draft['calendar.imports'])}
          disabled={!on}
          onChange={(value) => set('calendar.imports', value)}
          label={t('Import aus anderen Diensten erlauben')}
          hint={t(
            'Termine einmalig von einer iCal-Adresse oder aus einem CalDAV-Konto wie Nextcloud oder iCloud übernehmen. Dateien lassen sich immer importieren.'
          )}
        />
        <Toggle
          checked={Boolean(draft['calendar.subscriptionsPrivate'])}
          disabled={!on || (!draft['calendar.subscriptions'] && !draft['calendar.imports'])}
          onChange={(value) => set('calendar.subscriptionsPrivate', value)}
          label={t('Auch Adressen im lokalen Netz erlauben')}
          hint={t(
            'Gilt für Abos und Importe. Ausgeschaltet kommt niemand über MoeCloud an Geräte in deinem Netz, etwa den Router oder andere Dienste auf dem Server.'
          )}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label={t('Höchstens Abos pro Person')}
            type="number"
            disabled={!on}
            value={draft['calendar.maxSubscriptions']}
            onChange={(event) => set('calendar.maxSubscriptions', Math.max(0, Math.min(500, Number(event.target.value))))}
          />
          <TextField
            label={t('Frühestens neu laden nach')}
            type="number"
            disabled={!on}
            value={draft['calendar.minRefresh']}
            onChange={(event) => set('calendar.minRefresh', Math.max(5, Math.min(1440, Number(event.target.value))))}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">{t('Min.')}</InputAdornment> } }}
          />
        </Box>
      </Section>

      <Section title={t('Kontakte')}>
        <Toggle
          checked={Boolean(draft['contacts.enabled'])}
          onChange={(value) => set('contacts.enabled', value)}
          label={t('Kontakte einschalten')}
          hint={t(
            'Adressbücher im Browser und per CardDAV auf Telefonen und in Thunderbird, dazu Geburtstage im Kalender. Ausgeschaltet bleiben alle Kontakte erhalten.'
          )}
        />
      </Section>

      <SaveBar count={form.changed.length} busy={form.busy} onSave={() => void form.save()} onReset={() => form.reset()} />
    </Box>
  );
}
