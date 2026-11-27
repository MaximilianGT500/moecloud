import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DevicesRounded from '@mui/icons-material/DevicesRounded';
import InstallMobileRounded from '@mui/icons-material/InstallMobileRounded';
import KeyboardCommandKeyRounded from '@mui/icons-material/KeyboardCommandKeyRounded';
import { FEATURES, type Feature } from '../../../../shared/features';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { featureAvailable, featureOn, setFeaturesOff } from '../../lib/features';
import { t } from '../../lib/i18n';
import { setPrefs, usePrefs } from '../../lib/prefs';
import { c, radius } from '../../theme/tokens';
import { AppPicker } from '../common/AppPicker';
import { ThemeModeSelector } from '../common/ThemeToggle';
import { toast } from '../common/toast';

type Step = 'apps' | 'look' | 'done';
const STEPS: Step[] = ['apps', 'look', 'done'];

function NavChoice({
  value,
  label,
  selected,
  onSelect,
}: {
  value: 'side' | 'top';
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      data-nav-choice={value}
      onClick={onSelect}
      sx={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 1,
        p: 1.5,
        borderRadius: `${radius.md}px`,
        bgcolor: selected ? c.secondaryContainer : c.surfaceContainer,
        boxShadow: selected ? `inset 0 0 0 2px ${c.primary}` : 'none',
        '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          height: 72,
          borderRadius: `${radius.sm}px`,
          bgcolor: c.surfaceContainerHighest,
          display: 'flex',
          flexDirection: value === 'top' ? 'column' : 'row',
          gap: 0.5,
          p: 0.75,
        }}
      >
        <Box
          sx={{
            bgcolor: selected ? c.primary : c.outline,
            borderRadius: `${radius.xs}px`,
            ...(value === 'top' ? { height: 10 } : { width: 12 }),
            opacity: 0.8,
          }}
        />
        <Box sx={{ flex: 1, bgcolor: c.surfaceContainerLow, borderRadius: `${radius.xs}px` }} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, color: selected ? c.onSecondaryContainer : c.onSurface }}>
        {label}
      </Typography>
    </ButtonBase>
  );
}

function Tip({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box
        sx={{
          width: 40,
          height: 40,
          flex: 'none',
          borderRadius: `${radius.md}px`,
          display: 'grid',
          placeItems: 'center',
          bgcolor: c.tertiaryContainer,
          color: c.onTertiaryContainer,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: c.onSurface }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {text}
        </Typography>
      </Box>
    </Box>
  );
}

export function WelcomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phone = useMediaQuery('(max-width: 599.95px)');
  const prefs = usePrefs();
  const [step, setStep] = useState<Step>('apps');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<Feature>>(() => new Set(FEATURES.filter((key) => featureAvailable(key) && featureOn(key))));
  const user = boot().user!;
  const first = user.name.trim().split(/\s+/)[0] || user.name;
  const index = STEPS.indexOf(step);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  const finish = async (save: boolean) => {
    setBusy(true);
    const off = FEATURES.filter((key) => featureAvailable(key) && !selected.has(key));
    try {
      await api.patch('/api/account/prefs', save ? { features: off, welcome: false } : { welcome: false });
      if (save) setFeaturesOff(off);
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Step, [string, string]> = {
    apps: [
      t('Willkommen, {name}!', { name: first }),
      t('Was möchtest du in {site} nutzen? Dateien sind immer dabei, alles andere kannst du später unter Konto › Funktionen ändern.', {
        site: boot().site.name,
      }),
    ],
    look: [t('Wie soll es aussehen?'), t('Das gilt für dieses Gerät. Unter Konto › Darstellung stellst du noch mehr ein.')],
    done: [t('Alles bereit'), t('Noch drei Dinge, die den Alltag leichter machen:')],
  };

  return (
    <Dialog
      open={open}
      onClose={() => void finish(false)}
      fullScreen={phone}
      maxWidth="md"
      fullWidth
      aria-labelledby="moe-welcome-title"
      data-welcome
    >
      <LinearProgress
        variant="determinate"
        value={((index + 1) / STEPS.length) * 100}
        sx={{ mx: { xs: 0, sm: -1 }, mt: { xs: 0, sm: -1 } }}
      />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, pt: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Schritt {step} von {total}', { step: index + 1, total: STEPS.length })}
          </Typography>
          <Typography id="moe-welcome-title" variant="h5" component="h2" sx={{ fontWeight: 700 }}>
            {titles[step][0]}
          </Typography>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 0.5 }}>
            {titles[step][1]}
          </Typography>
        </Box>
        <IconButton aria-label={t('Später')} onClick={() => void finish(false)} disabled={busy}>
          <CloseRounded />
        </IconButton>
      </Box>
      <DialogContent sx={{ pt: 2 }}>
        {step === 'apps' && <AppPicker selected={selected} onChange={setSelected} available={featureAvailable} />}
        {step === 'look' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ color: c.onSurface }}>
                {t('Hell oder dunkel')}
              </Typography>
              <ThemeModeSelector />
            </Box>
            <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ color: c.onSurface }}>
                {t('Navigation')}
              </Typography>
              <Box
                role="radiogroup"
                aria-label={t('Navigation')}
                sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, maxWidth: 420 }}
              >
                <NavChoice
                  value="side"
                  label={t('Links')}
                  selected={prefs.navPosition === 'side'}
                  onSelect={() => setPrefs({ navPosition: 'side' })}
                />
                <NavChoice
                  value="top"
                  label={t('Oben')}
                  selected={prefs.navPosition === 'top'}
                  onSelect={() => setPrefs({ navPosition: 'top' })}
                />
              </Box>
            </Box>
            <FormControlLabel
              sx={{ display: { md: 'none' }, m: 0, gap: 1, alignItems: 'center' }}
              control={<Switch checked={prefs.barHide} onChange={(event) => setPrefs({ barHide: event.target.checked })} />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: c.onSurface }}>
                    {t('Leiste beim Scrollen ausblenden')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {t('Mehr Platz auf dem Handy, beim Zurückscrollen ist sie wieder da.')}
                  </Typography>
                </Box>
              }
            />
          </Box>
        )}
        {step === 'done' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Tip
              icon={<InstallMobileRounded />}
              title={t('Als App installieren')}
              text={t(
                'Im Browser-Menü findest du „Installieren“ oder „Zum Home-Bildschirm“. Dann nimmt MoeCloud auch Dateien und Links aus dem Teilen-Menü an.'
              )}
            />
            <Tip
              icon={<KeyboardCommandKeyRounded />}
              title={t('Schnellzugriff')}
              text={
                mac
                  ? t('Mit ⌘K springst du in jeden Bereich und suchst überall gleichzeitig.')
                  : t('Mit Strg+K springst du in jeden Bereich und suchst überall gleichzeitig.')
              }
            />
            <Tip
              icon={<DevicesRounded />}
              title={t('Mit Handy und Rechner abgleichen')}
              text={t(
                'Dateien, Kalender und Kontakte gibt es auch per WebDAV, CalDAV und CardDAV. Die Adressen und App-Passwörter stehen unter Konto.'
              )}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button onClick={() => (index ? setStep(STEPS[index - 1]) : void finish(false))} disabled={busy}>
          {index ? t('Zurück') : t('Später')}
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          data-welcome-next
          onClick={() => (step === 'done' ? void finish(true) : setStep(STEPS[index + 1]))}
        >
          {step === 'done' ? t('Los geht’s') : t('Weiter')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
