import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ConstructionRounded from '@mui/icons-material/ConstructionRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';

const KEY = 'moecloud-notice';

function hash(text: string) {
  let value = 0;
  for (let index = 0; index < text.length; index++) value = (Math.imul(31, value) + text.charCodeAt(index)) | 0;
  return String(value);
}

function readDismissed() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function SiteNotice() {
  const { site, user } = boot();
  const notice = site.notice ?? null;
  const [dismissed, setDismissed] = useState(readDismissed);
  const maintenance = Boolean(site.maintenance && user?.role === 'admin');
  const showNotice = Boolean(notice && dismissed !== hash(notice.text));
  if (!maintenance && !showNotice) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: { xs: 1.5, md: 0 }, pb: 1 }}>
      {maintenance && (
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1,
            borderRadius: `${radius.md}px`,
            bgcolor: c.tertiaryContainer,
            color: c.onTertiaryContainer,
          }}
        >
          <ConstructionRounded />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t('Der Wartungsmodus ist an. Gerade können sich nur Admins anmelden.')}
          </Typography>
          <Button size="small" href="/admin/settings" sx={{ color: 'inherit', flex: 'none' }}>
            {t('Ändern')}
          </Button>
        </Box>
      )}
      {showNotice && notice && (
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            pl: 2,
            pr: 0.5,
            py: 0.5,
            borderRadius: `${radius.md}px`,
            bgcolor: notice.level === 'warning' ? c.errorContainer : c.secondaryContainer,
            color: notice.level === 'warning' ? c.onErrorContainer : c.onSecondaryContainer,
          }}
        >
          {notice.level === 'warning' ? <WarningAmberRounded /> : <CampaignRounded />}
          <Typography variant="body2" sx={{ flex: 1, py: 0.75, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
            {notice.text}
          </Typography>
          <IconButton
            size="small"
            aria-label={t('Hinweis ausblenden')}
            sx={{ color: 'inherit' }}
            onClick={() => {
              const value = hash(notice.text);
              try {
                localStorage.setItem(KEY, value);
              } catch {}
              setDismissed(value);
            }}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
