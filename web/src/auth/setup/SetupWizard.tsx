import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import { AnimatePresence, m } from 'motion/react';
import { api, errorText } from '../../lib/api';
import { boot, type Boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { buildPalette } from '../../theme/generate';
import { normalizeHex, SEED_PRESETS } from '../../theme/scheme';
import { c, mix, radius } from '../../theme/tokens';
import { useSeed } from '../../app/mount';
import { BrandMark, SkipLink } from '../../app/common/bits';
import { QuotaField } from '../../app/common/QuotaField';
import { ThemeToggleButton } from '../../app/common/ThemeToggle';

interface SetupBoot extends Boot {
  defaults: { url: string; language: 'de' | 'en' };
}

const STEPS = ['code', 'cloud', 'look', 'admin', 'rules'] as const;
type Step = (typeof STEPS)[number];

function Choice({ selected, title, text, onClick }: { selected: boolean; title: string; text?: string; onClick: () => void }) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      sx={{
        justifyContent: 'flex-start',
        textAlign: 'left',
        gap: 2,
        p: 2,
        borderRadius: `${radius.md}px`,
        bgcolor: selected ? c.secondaryContainer : c.surfaceContainer,
        color: selected ? c.onSecondaryContainer : c.onSurface,
        boxShadow: selected ? `inset 0 0 0 2px ${c.primary}` : 'none',
        width: '100%',
      }}
    >
      <Box
        sx={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          border: `2px solid ${selected ? c.primary : c.outline}`,
          bgcolor: selected ? c.primary : 'transparent',
          color: c.onPrimary,
        }}
      >
        {selected && <CheckRounded sx={{ fontSize: 16 }} />}
      </Box>
      <Box>
        <Typography variant="subtitle2">{title}</Typography>
        {text && (
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {text}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}

function Preview({ name }: { name: string }) {
  return (
    <Box
      aria-hidden
      sx={{
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainerLow,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        border: `1px solid ${c.outlineVariant}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <BrandMark size={28} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {name || 'MoeCloud'}
        </Typography>
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderRadius: `${radius.full}px`,
            bgcolor: c.primary,
            color: c.onPrimary,
            fontSize: '0.75rem',
            fontWeight: 500,
          }}
        >
          {t('Neu')}
        </Box>
      </Box>
      {[
        { icon: <FolderRounded sx={{ color: c.primary }} />, label: t('Fotos'), active: true },
        { icon: <ImageRounded sx={{ color: c.tertiary }} />, label: 'Kirschblüten.jpg', active: false },
      ].map((row) => (
        <Box
          key={row.label}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1.5,
            py: 1,
            borderRadius: `${radius.tile}px`,
            bgcolor: row.active ? c.secondaryContainer : c.surfaceContainer,
            color: row.active ? c.onSecondaryContainer : c.onSurface,
          }}
        >
          {row.icon}
          <Typography variant="body2" sx={{ flex: 1 }}>
            {row.label}
          </Typography>
          {row.active && <StarRounded sx={{ fontSize: 18, color: c.tertiary }} />}
        </Box>
      ))}
    </Box>
  );
}

export function SetupWizard() {
  const data = boot<SetupBoot>();
  const setSeed = useSeed();
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const [step, setStep] = useState<Step>('code');
  const [direction, setDirection] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: initialCode,
    siteName: 'MoeCloud',
    siteUrl: data.defaults?.url ?? location.origin,
    language: data.defaults?.language ?? 'de',
    seed: '#8b5cf6',
    registration: 'invite' as 'closed' | 'open' | 'invite',
    defaultQuota: 0,
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const index = STEPS.indexOf(step);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) > index ? 1 : -1);
    setError(null);
    setStep(next);
  };

  const valid: Record<Step, boolean> = {
    code: form.code.trim().length > 0,
    cloud: form.siteName.trim().length > 0 && /^https?:\/\/\S+$/.test(form.siteUrl.trim()),
    look: Boolean(normalizeHex(form.seed)),
    admin: form.name.trim().length > 0 && /^[a-zA-Z0-9._-]{3,32}$/.test(form.username) && form.password.length >= 10,
    rules: true,
  };

  const next = async () => {
    setError(null);
    if (step === 'code') {
      setBusy(true);
      try {
        await api.post('/api/setup/check', { code: form.code.trim() });
        go('cloud');
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step !== 'rules') {
      go(STEPS[index + 1]);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ redirect: string }>('/api/setup', {
        code: form.code.trim(),
        siteName: form.siteName.trim(),
        siteUrl: form.siteUrl.trim(),
        language: form.language,
        seed: form.seed,
        palette: buildPalette(form.seed),
        registration: form.registration,
        defaultQuota: form.defaultQuota,
        admin: { name: form.name.trim(), username: form.username.trim(), email: form.email.trim(), password: form.password },
      });
      location.href = result.redirect;
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const titles: Record<Step, [string, string]> = {
    code: [t('Willkommen bei MoeCloud'), t('In ein paar Schritten läuft deine eigene Cloud. Deine Dateien bleiben auf deinem Server.')],
    cloud: [t('Deine Cloud'), t('Wie heißt sie und unter welcher Adresse ist sie erreichbar?')],
    look: [t('Aussehen'), t('Alle Farben entstehen aus einer Grundfarbe. Du kannst sie später unter Admin › Einstellungen ändern.')],
    admin: [t('Dein Konto'), t('Damit verwaltest du MoeCloud. Weitere Personen legst du danach an.')],
    rules: [t('Regeln'), t('Wer darf sich registrieren und wie viel Platz bekommt jede Person?')],
  };

  let body: ReactNode = null;
  if (step === 'code') {
    body = (
      <>
        <TextField
          label={t('Einrichtungscode')}
          value={form.code}
          onChange={(event) => set({ code: event.target.value })}
          autoFocus={!initialCode}
          helperText={t('Steht im Log des Servers, zum Beispiel mit „docker logs moecloud“.')}
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, autoComplete: 'off' } }}
        />
        <Box role="radiogroup" aria-label={t('Sprache')} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          {(['de', 'en'] as const).map((lang) => (
            <Choice
              key={lang}
              selected={form.language === lang}
              title={lang === 'de' ? 'Deutsch' : 'English'}
              onClick={() => {
                set({ language: lang });
                if (lang !== data.lang) location.href = `/lang/${lang}?next=${encodeURIComponent(location.pathname + location.search)}`;
              }}
            />
          ))}
        </Box>
      </>
    );
  } else if (step === 'cloud') {
    body = (
      <>
        <TextField
          label={t('Name')}
          value={form.siteName}
          onChange={(event) => set({ siteName: event.target.value })}
          autoFocus
          helperText={t('Steht im Browser-Tab, bei der Anmeldung und in Link-Vorschauen.')}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <TextField
          label={t('Adresse')}
          value={form.siteUrl}
          onChange={(event) => set({ siteUrl: event.target.value })}
          helperText={t('Unter dieser Adresse öffnen andere deine Links. Für Passkeys braucht sie HTTPS.')}
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, inputMode: 'url' } }}
        />
      </>
    );
  } else if (step === 'look') {
    body = (
      <>
        <Box role="radiogroup" aria-label={t('Grundfarbe')} sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5 }}>
          {SEED_PRESETS.map((preset) => {
            const selected = form.seed === preset.value;
            return (
              <ButtonBase
                key={preset.value}
                role="radio"
                aria-checked={selected}
                aria-label={t(preset.name)}
                onClick={() => {
                  set({ seed: preset.value });
                  setSeed(preset.value);
                }}
                sx={{
                  flexDirection: 'column',
                  gap: 1,
                  py: 1.5,
                  borderRadius: `${radius.md}px`,
                  bgcolor: selected ? c.secondaryContainer : c.surfaceContainer,
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
                <Typography variant="caption" sx={{ fontWeight: 500, color: selected ? c.onSecondaryContainer : c.onSurface }}>
                  {t(preset.name)}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
        <Preview name={form.siteName} />
      </>
    );
  } else if (step === 'admin') {
    body = (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <TextField
          label={t('Name')}
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          autoFocus
          autoComplete="name"
        />
        <TextField
          label={t('Benutzername')}
          value={form.username}
          onChange={(event) => set({ username: event.target.value.replace(/\s/g, '') })}
          autoComplete="username"
          helperText={t('3 bis 32 Zeichen')}
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
        />
        <TextField
          label={t('E-Mail (freiwillig)')}
          type="email"
          value={form.email}
          onChange={(event) => set({ email: event.target.value })}
          autoComplete="email"
          sx={{ gridColumn: '1 / -1' }}
        />
        <TextField
          label={t('Passwort')}
          type="password"
          value={form.password}
          onChange={(event) => set({ password: event.target.value })}
          autoComplete="new-password"
          helperText={t('Mindestens 10 Zeichen.')}
          sx={{ gridColumn: '1 / -1' }}
        />
      </Box>
    );
  } else {
    body = (
      <>
        <Box role="radiogroup" aria-label={t('Registrierung')} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Choice
            selected={form.registration === 'closed'}
            title={t('Nur ich lege Konten an')}
            text={t('Du entscheidest, wer dabei ist.')}
            onClick={() => set({ registration: 'closed' })}
          />
          <Choice
            selected={form.registration === 'invite'}
            title={t('Mit Einladungslink')}
            text={t('Du verschickst Links, mit denen sich Personen selbst anmelden.')}
            onClick={() => set({ registration: 'invite' })}
          />
          <Choice
            selected={form.registration === 'open'}
            title={t('Jeder darf sich registrieren')}
            text={t('Sinnvoll nur, wenn deine Cloud öffentlich sein soll.')}
            onClick={() => set({ registration: 'open' })}
          />
        </Box>
        <QuotaField
          label={t('Speicher pro Person')}
          value={form.defaultQuota}
          onChange={(value) => set({ defaultQuota: value ?? 0 })}
          helperText={t('Für dich und alle anderen, solange du nichts anderes einstellst.')}
        />
      </>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 1.5, sm: 3 },
        background: `radial-gradient(70% 55% at 85% 0%, ${mix(c.primary, 16)}, transparent 70%), radial-gradient(60% 50% at 0% 100%, ${mix(c.tertiary, 12)}, transparent 70%), ${c.surface}`,
      }}
    >
      <SkipLink />
      <Box sx={{ position: 'fixed', top: 12, right: 12 }}>
        <ThemeToggleButton placement="bottom" />
      </Box>
      <m.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.38 }}
        style={{ width: '100%', maxWidth: 560 }}
      >
        <Box
          component="main"
          id="inhalt"
          sx={{
            bgcolor: c.surfaceContainerLow,
            borderRadius: `${radius.xl}px`,
            p: { xs: 2.5, sm: 4 },
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <BrandMark size={44} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2">{t('Einrichtung')}</Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                {t('Schritt {step} von {total}', { step: index + 1, total: STEPS.length })}
              </Typography>
            </Box>
          </Box>
          <LinearProgress variant="determinate" value={((index + 1) / STEPS.length) * 100} aria-label={t('Fortschritt')} />
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <m.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: 24 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction, transition: { duration: 0.18 } }}
              transition={{ duration: 0.3 }}
            >
              <Box
                component="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (valid[step] && !busy) void next();
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
              >
                <Box>
                  <Typography variant="h4" component="h1" sx={{ textWrap: 'balance' }}>
                    {titles[step][0]}
                  </Typography>
                  <Typography variant="body1" sx={{ color: c.onSurfaceVariant, mt: 1, textWrap: 'pretty' }}>
                    {titles[step][1]}
                  </Typography>
                </Box>
                {body}
                {error && <Alert severity="error">{error}</Alert>}
                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', pt: 1 }}>
                  {index > 0 ? (
                    <Button startIcon={<ArrowBackRounded />} onClick={() => go(STEPS[index - 1])}>
                      {t('Zurück')}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={!valid[step] || busy}
                    endIcon={step === 'rules' ? <CheckRounded /> : <ArrowForwardRounded />}
                  >
                    {step === 'rules' ? t('Fertig, los geht’s') : t('Weiter')}
                  </Button>
                </Box>
              </Box>
            </m.div>
          </AnimatePresence>
        </Box>
      </m.div>
    </Box>
  );
}
