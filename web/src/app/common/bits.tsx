import { useState, type ReactNode } from 'react';
import { encode } from 'uqr';
import Avatar from '@mui/material/Avatar';
import Box, { type BoxProps } from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { m } from 'motion/react';
import { formatBytes } from '../../lib/format';
import { t } from '../../lib/i18n';
import type { Storage } from '../../lib/boot';
import { c, fonts, mix, radius, srOnly } from '../../theme/tokens';
import { toast } from './toast';

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <Box
      component="img"
      src="/favicon.svg"
      alt=""
      width={size}
      height={size}
      sx={{ width: size, height: size, borderRadius: `${Math.round(size * 0.28)}px`, display: 'block', flex: 'none' }}
    />
  );
}

export function UserAvatar({ initials, size = 40, label }: { initials: string; size?: number; label?: string }) {
  return (
    <Avatar
      aria-label={label}
      sx={{ width: size, height: size, fontSize: size * 0.38, bgcolor: c.secondaryContainer, color: c.onSecondaryContainer }}
    >
      {initials}
    </Avatar>
  );
}

export function SkipLink() {
  return (
    <Box
      component="a"
      href="#inhalt"
      sx={{
        ...srOnly,
        '&:focus': {
          position: 'fixed',
          zIndex: 2000,
          top: 12,
          left: 12,
          width: 'auto',
          height: 'auto',
          clip: 'auto',
          margin: 0,
          padding: '10px 18px',
          borderRadius: `${radius.full}px`,
          bgcolor: c.primary,
          color: c.onPrimary,
          fontWeight: 700,
          textDecoration: 'none',
        },
      }}
    >
      {t('Zum Inhalt springen')}
    </Box>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 1.5,
          py: compact ? 4 : { xs: 6, md: 10 },
          px: 3,
          maxWidth: 440,
          mx: 'auto',
        }}
      >
        <Box
          sx={{
            width: compact ? 64 : 88,
            height: compact ? 64 : 88,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: c.secondaryContainer,
            color: c.onSecondaryContainer,
            mb: 1,
            '& svg': { fontSize: compact ? 30 : 40 },
          }}
        >
          {icon}
        </Box>
        <Typography variant={compact ? 'subtitle1' : 'h5'} component="h2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {text && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
            {text}
          </Typography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </Box>
    </m.div>
  );
}

export async function copyText(text: string, message = t('Kopiert')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    return true;
  } catch {
    toast(t('Kopieren ging nicht, markiere den Text und kopiere ihn selbst'));
    return false;
  }
}

export function CopyField({ value, label, mono = true }: { value: string; label: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      onFocus={(event) => event.target.select()}
      slotProps={{
        htmlInput: { readOnly: true, style: mono ? { fontFamily: fonts.mono, fontSize: '0.875rem' } : undefined },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={t('Kopieren')}>
                <IconButton
                  aria-label={t('Kopieren')}
                  edge="end"
                  onClick={async () => {
                    if (await copyText(value)) {
                      setDone(true);
                      setTimeout(() => setDone(false), 1600);
                    }
                  }}
                >
                  {done ? <CheckRounded /> : <ContentCopyRounded />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

export function StorageMeter({ storage, compact = false }: { storage: Storage; compact?: boolean }) {
  const percent = storage.quota ? Math.min(100, (storage.used / storage.quota) * 100) : 0;
  const warn = percent >= 90;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {storage.quota ? (
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-label={t('Speicher')}
          sx={{ height: compact ? 4 : 6, '& .MuiLinearProgress-bar': { bgcolor: warn ? c.error : c.primary } }}
        />
      ) : null}
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
        {storage.quota
          ? t('{used} von {quota} belegt', { used: formatBytes(storage.used), quota: formatBytes(storage.quota) })
          : t('{used} belegt', { used: formatBytes(storage.used) })}
      </Typography>
    </Box>
  );
}

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { data, size: modules } = encode(value, { ecc: 'M', border: 2 });
  const rects: ReactNode[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />);
    })
  );
  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: '#ffffff',
        borderRadius: `${radius.md}px`,
        display: 'inline-flex',
        border: `1px solid ${c.outlineVariant}`,
      }}
    >
      <svg viewBox={`0 0 ${modules} ${modules}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
        <g fill="#1d1b20">{rects}</g>
      </svg>
    </Box>
  );
}

export function Section({
  title,
  description,
  children,
  action,
  ...props
}: { title: string; description?: ReactNode; action?: ReactNode } & BoxProps) {
  return (
    <Box
      component="section"
      {...props}
      sx={{
        bgcolor: c.surfaceContainerLow,
        borderRadius: `${radius.lg}px`,
        p: { xs: 2, sm: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        ...props.sx,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 0.5, textWrap: 'pretty' }}>
              {description}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Box>
  );
}

export function Row({
  icon,
  title,
  text,
  action,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        py: 1.25,
        px: 1.5,
        mx: -1.5,
        borderRadius: `${radius.tile}px`,
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { bgcolor: mix(c.onSurface, 6) } : undefined,
      }}
    >
      {icon && <Box sx={{ color: c.onSurfaceVariant, display: 'flex', '& svg': { fontSize: 24 } }}>{icon}</Box>}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {text && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
            {text}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}
