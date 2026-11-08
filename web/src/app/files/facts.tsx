import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import GppBadRounded from '@mui/icons-material/GppBadRounded';
import GppGoodRounded from '@mui/icons-material/GppGoodRounded';
import GppMaybeRounded from '@mui/icons-material/GppMaybeRounded';
import { formatDateTime, formatDuration, formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import type { Item } from './kinds';
import type { NodeMeta } from './preview/media';

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Typography component="dt" variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

function exposureText(value: unknown) {
  if (typeof value !== 'number' || value <= 0) return null;
  return value >= 1 ? `${formatNumber(value)} s` : `1/${Math.round(1 / value)} s`;
}

export function MetaFacts({ item, meta }: { item: Item; meta: NodeMeta }) {
  const tags = meta.meta;
  const text = (key: string) => (typeof tags[key] === 'string' || typeof tags[key] === 'number' ? String(tags[key]) : null);
  const settings = [
    typeof tags.aperture === 'number' ? `ƒ/${formatNumber(tags.aperture)}` : null,
    exposureText(tags.exposure),
    typeof tags.focal === 'number' ? `${formatNumber(tags.focal)} mm` : null,
    typeof tags.iso === 'number' ? `ISO ${tags.iso}` : null,
  ].filter(Boolean);
  return (
    <>
      {meta.width && meta.height ? (
        <Fact label={t('Abmessungen')}>
          {formatNumber(meta.width)} × {formatNumber(meta.height)}
        </Fact>
      ) : null}
      {meta.takenAt && <Fact label={t('Aufgenommen')}>{formatDateTime(meta.takenAt)}</Fact>}
      {typeof tags.duration === 'number' && <Fact label={t('Dauer')}>{formatDuration(tags.duration)}</Fact>}
      {text('title') && item.kind === 'audio' && <Fact label={t('Titel')}>{text('title')}</Fact>}
      {text('artist') && <Fact label={t('Interpret')}>{text('artist')}</Fact>}
      {text('album') && <Fact label={t('Album')}>{text('album')}</Fact>}
      {text('year') && <Fact label={t('Jahr')}>{text('year')}</Fact>}
      {text('camera') && <Fact label={t('Kamera')}>{text('camera')}</Fact>}
      {text('lens') && <Fact label={t('Objektiv')}>{text('lens')}</Fact>}
      {settings.length > 0 && <Fact label={t('Belichtung')}>{settings.join(' · ')}</Fact>}
      {text('codec') && <Fact label={t('Format')}>{text('codec')}</Fact>}
      {typeof tags.bitrate === 'number' && <Fact label={t('Bitrate')}>{`${formatNumber(Math.round(tags.bitrate / 1000))} kbit/s`}</Fact>}
    </>
  );
}

export function ScanState({ meta }: { meta: NodeMeta }) {
  if (!meta.scan) return null;
  const { status, signature, at } = meta.scan;
  const when = at ? formatDateTime(at) : '';
  const look =
    status === 'infected'
      ? { icon: <GppBadRounded />, color: c.error, text: t('Schadsoftware gefunden: {signature}', { signature: signature ?? '' }) }
      : status === 'clean'
        ? { icon: <GppGoodRounded />, color: c.success, text: t('Keine Schadsoftware gefunden') }
        : status === 'released'
          ? { icon: <GppMaybeRounded />, color: c.onSurfaceVariant, text: t('Von der Verwaltung freigegeben') }
          : status === 'skipped'
            ? { icon: <GppMaybeRounded />, color: c.onSurfaceVariant, text: t('Nicht geprüft, die Datei ist zu groß') }
            : { icon: <GppMaybeRounded />, color: c.onSurfaceVariant, text: t('Die Prüfung ist fehlgeschlagen') };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer }}>
      <Box sx={{ color: look.color, display: 'grid' }}>{look.icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {look.text}
        </Typography>
        {when && (
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Virenscan vom {date}', { date: when })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
