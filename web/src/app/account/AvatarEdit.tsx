import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import { csrfToken, errorText } from '../../lib/api';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { UserAvatar } from '../common/bits';
import { toast } from '../common/toast';

const EDGE = 512;

async function squared(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(EDGE, side);
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('Das Bild ließ sich nicht lesen'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('Das Bild ließ sich nicht lesen')))), 'image/jpeg', 0.9)
  );
}

export function AvatarEdit({
  user,
  onChange,
}: {
  user: { id: number; initials: string; avatar?: string | null; name: string };
  onChange: (avatar: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      let body: Blob = file;
      try {
        body = await squared(file);
      } catch {
        body = file;
      }
      const response = await fetch('/api/account/avatar', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
        body,
      });
      const data = (await response.json().catch(() => ({}))) as { avatar?: string; error?: { message?: string } };
      if (!response.ok || !data.avatar) throw new Error(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal'));
      onChange(data.avatar);
      toast(t('Profilbild gespeichert'));
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
      await api.delete('/api/account/avatar');
      onChange(null);
      toast(t('Profilbild entfernt'));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ position: 'relative', flex: 'none' }}>
      <UserAvatar
        initials={user.initials}
        size={88}
        avatar={user.avatar}
        userId={user.id}
        label={t('Profilbild von {name}', { name: user.name })}
      />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        hidden
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <Tooltip title={user.avatar ? t('Profilbild ändern') : t('Profilbild hochladen')}>
        <IconButton
          size="small"
          disabled={busy}
          aria-label={user.avatar ? t('Profilbild ändern') : t('Profilbild hochladen')}
          onClick={() => input.current?.click()}
          sx={{
            position: 'absolute',
            right: -6,
            bottom: -6,
            bgcolor: c.primaryContainer,
            color: c.onPrimaryContainer,
            '&:hover': { bgcolor: c.primaryContainer },
          }}
        >
          <PhotoCameraRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      {user.avatar && (
        <Tooltip title={t('Profilbild entfernen')}>
          <IconButton
            size="small"
            disabled={busy}
            aria-label={t('Profilbild entfernen')}
            onClick={() => void remove()}
            sx={{
              position: 'absolute',
              left: -6,
              bottom: -6,
              bgcolor: c.surfaceContainerHighest,
              color: c.onSurfaceVariant,
              '&:hover': { bgcolor: c.surfaceContainerHighest },
            }}
          >
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
