import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ImageRounded from '@mui/icons-material/ImageRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import { api, csrfToken, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { Section, setSiteLogo } from '../common/bits';
import { toast } from '../common/toast';

type Kind = 'logo' | 'background';

interface Stamps {
  'site.logo'?: string;
  'login.background'?: string;
}

function ImageSlot({
  kind,
  stamp,
  title,
  hint,
  onChanged,
}: {
  kind: Kind;
  stamp: string;
  title: string;
  hint: string;
  onChanged: (settings: Stamps) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = stamp ? `/branding/${kind}?v=${stamp}` : null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/branding/${kind}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
        body: file,
      });
      const data = (await response.json().catch(() => ({}))) as { settings?: Stamps; error?: { message?: string } };
      if (!response.ok || !data.settings) throw new Error(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal'));
      onChanged(data.settings);
      toast(t('Bild gespeichert'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const data = await api.delete<{ settings: Stamps }>(`/api/admin/branding/${kind}`);
      onChanged(data.settings);
      toast(t('Bild entfernt'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }} data-branding={kind}>
      <Box
        sx={{
          width: kind === 'logo' ? 72 : 128,
          height: 72,
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
          borderRadius: `${radius.tile}px`,
          bgcolor: c.surfaceContainerHigh,
          color: c.onSurfaceVariant,
          overflow: 'hidden',
        }}
      >
        {url ? (
          <Box
            component="img"
            src={url}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: kind === 'logo' ? 'contain' : 'cover', p: kind === 'logo' ? 1 : 0 }}
          />
        ) : (
          <ImageRounded />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {hint}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label={title}
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button variant="tonal" startIcon={<UploadRounded />} disabled={busy} onClick={() => input.current?.click()}>
          {url ? t('Ersetzen') : t('Hochladen')}
        </Button>
        {url && (
          <Button startIcon={<DeleteOutlineRounded />} disabled={busy} onClick={() => void remove()}>
            {t('Entfernen')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function BrandingSection({
  draft,
  set,
  onImages,
}: {
  draft: Record<string, unknown>;
  set: (key: string, value: string) => void;
  onImages: (settings: Stamps) => void;
}) {
  const changed = (settings: Stamps) => {
    setSiteLogo(settings['site.logo'] ? `/branding/logo?v=${settings['site.logo']}` : null);
    onImages(settings);
  };
  return (
    <Section
      title={t('Logo und Anmeldeseite')}
      description={t('So sieht deine Cloud aus, bevor sich jemand anmeldet. Das Logo steht außerdem oben in der Seitenleiste.')}
    >
      <ImageSlot
        kind="logo"
        stamp={String(draft['site.logo'] ?? '')}
        title={t('Logo')}
        hint={t('Am besten quadratisch und mit durchsichtigem Hintergrund. PNG, JPEG oder WebP bis 6 MB.')}
        onChanged={changed}
      />
      <ImageSlot
        kind="background"
        stamp={String(draft['login.background'] ?? '')}
        title={t('Hintergrundbild')}
        hint={t('Liegt hinter der Anmeldung und allen Seiten ohne Konto. Ein ruhiges Foto im Querformat wirkt am besten.')}
        onChanged={changed}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <TextField
          label={t('Überschrift der Anmeldung')}
          value={String(draft['login.title'] ?? '')}
          onChange={(event) => set('login.title', event.target.value)}
          placeholder={t('Anmelden')}
          slotProps={{ htmlInput: { maxLength: 60 }, inputLabel: { shrink: true } }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2">{t('Platz der Anmeldung')}</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            fullWidth
            value={draft['login.layout'] ?? 'center'}
            onChange={(_event, value: string | null) => value && set('login.layout', value)}
            aria-label={t('Platz der Anmeldung')}
          >
            <ToggleButton value="left">{t('Links')}</ToggleButton>
            <ToggleButton value="center">{t('Mitte')}</ToggleButton>
            <ToggleButton value="right">{t('Rechts')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>
      <TextField
        label={t('Begrüßung auf der Anmeldeseite')}
        value={String(draft['login.text'] ?? '')}
        onChange={(event) => set('login.text', event.target.value)}
        placeholder={t('Melde dich an, um zu deinen Dateien zu kommen.')}
        multiline
        minRows={2}
        maxRows={5}
        slotProps={{ htmlInput: { maxLength: 400 }, inputLabel: { shrink: true } }}
        helperText={t('Steht unter der Überschrift. Leer lassen für den üblichen Text.')}
      />
    </Section>
  );
}
