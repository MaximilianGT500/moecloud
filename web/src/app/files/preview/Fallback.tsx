import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import GppBadRounded from '@mui/icons-material/GppBadRounded';
import { formatBytes } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { FileIcon, kindColor, kindLabel, type Item } from '../kinds';

export function Fallback({ item, text, action }: { item?: Item; text?: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center', px: 3, py: 4 }}>
      {item && (
        <Box
          sx={{
            width: 120,
            height: 120,
            borderRadius: `${radius.xl}px`,
            display: 'grid',
            placeItems: 'center',
            bgcolor: `color-mix(in srgb, ${kindColor(item.kind)} 18%, ${c.surfaceContainerHigh})`,
          }}
        >
          <FileIcon item={item} size={64} />
        </Box>
      )}
      {item && (
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
          {item.name}
        </Typography>
      )}
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant, maxWidth: 480 }}>
        {text ?? (item ? t('{kind} · {size}', { kind: kindLabel(item.kind), size: formatBytes(item.size) }) : '')}
      </Typography>
      {action}
    </Box>
  );
}

export function InfectedNotice({ item }: { item: Item }) {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        maxWidth: 520,
        p: 2.5,
        borderRadius: `${radius.lg}px`,
        bgcolor: c.errorContainer,
        color: c.onErrorContainer,
      }}
    >
      <GppBadRounded sx={{ fontSize: 32, color: c.error, flex: 'none' }} />
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {t('„{name}“ ist gesperrt', { name: item.name })}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {t(
            'Der Virenscan hat in dieser Datei Schadsoftware gefunden. Öffnen und Herunterladen gehen nicht mehr. Lösch die Datei oder frag die Verwaltung.'
          )}
        </Typography>
      </Box>
    </Box>
  );
}
