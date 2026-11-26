import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { BrandMark, SkipLink } from '../common/bits';
import { ThemeToggleButton } from '../common/ThemeToggle';

export function PublicFrame({ children, compact, wide }: { children: ReactNode; compact?: boolean; wide?: boolean }) {
  const site = boot().site;
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: c.surface }}>
      <SkipLink />
      {!compact && (
        <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, md: 4 }, py: 1.5 }}>
          <Box
            component="a"
            href="/"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: 'inherit', textDecoration: 'none', borderRadius: 2 }}
          >
            <BrandMark size={34} />
            <Typography sx={{ fontWeight: 800, fontSize: 17 }}>{site.name}</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <ThemeToggleButton placement="bottom" />
        </Box>
      )}
      <Box
        component="main"
        id="inhalt"
        tabIndex={-1}
        sx={{
          flex: 1,
          width: '100%',
          maxWidth: wide ? 1280 : 1040,
          mx: 'auto',
          px: { xs: compact ? 0 : 1.5, md: compact ? 0 : 3 },
          pb: compact ? 0 : 4,
          outline: 'none',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {children}
      </Box>
      {!compact && (
        <Box
          component="footer"
          sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', py: 2.5, color: c.onSurfaceVariant }}
        >
          <Typography variant="caption">{t('Bereitgestellt mit MoeCloud')}</Typography>
          {site.legal.map((entry) => (
            <Link key={entry.href} href={entry.href} variant="caption" color="inherit">
              {entry.label}
            </Link>
          ))}
        </Box>
      )}
    </Box>
  );
}
