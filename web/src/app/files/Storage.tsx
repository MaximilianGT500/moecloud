import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import DeleteSweepRounded from '@mui/icons-material/DeleteSweepRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import FileCopyRounded from '@mui/icons-material/FileCopyRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, fileTypeColor, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { attempt } from './actions';
import { FileIcon, type Item } from './kinds';

type Group = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

interface Report {
  used: number;
  quota: number | null;
  trash: number;
  versions: number;
  groups: Record<Group, { size: number; count: number }>;
  largest: Item[];
  duplicates: { sha256: string; size: number; count: number; wasted: number; items: Item[] }[];
}

const GROUPS: { key: Group; label: string; color: string }[] = [
  { key: 'image', label: 'Bilder', color: fileTypeColor.image },
  { key: 'video', label: 'Videos', color: fileTypeColor.video },
  { key: 'audio', label: 'Audio', color: fileTypeColor.audio },
  { key: 'document', label: 'Dokumente', color: fileTypeColor.text },
  { key: 'archive', label: 'Archive', color: 'var(--mui-palette-folders-brown)' },
  { key: 'other', label: 'Sonstiges', color: fileTypeColor.other },
];

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: `${radius.lg}px`,
        bgcolor: c.surfaceContainer,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

function FileRow({ item, extra, onOpen }: { item: Item; extra: string; onOpen: (item: Item) => void }) {
  return (
    <ButtonBase
      onClick={() => onOpen(item)}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        gap: 1.5,
        p: 1,
        borderRadius: `${radius.tile}px`,
        textAlign: 'left',
        '&:hover': { bgcolor: c.surfaceContainerHigh },
      }}
    >
      <FileIcon item={item} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          {item.name}
        </Typography>
        <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
          {item.location === '' ? t('Meine Dateien') : (item.location ?? '')}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
        {extra}
      </Typography>
    </ButtonBase>
  );
}

export function StorageView({ onReveal }: { onReveal: (item: Item) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<Report>('/api/storage/report', abort.signal)
      .then((data) => {
        setReport(data);
        setError(null);
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [revision]);

  useLive((event) => {
    if (event === 'change') setRevision((value) => value + 1);
  });

  if (error && !report) return <EmptyState icon={<ErrorOutlineRounded />} title={t('Das hat nicht geklappt')} text={error} />;
  if (!report) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 2 }, display: 'flex', flexDirection: 'column', gap: 2 }} aria-busy="true" aria-label={t('Lädt')}>
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={260} />
      </Box>
    );
  }

  const total = Math.max(report.used, 1);
  const files = GROUPS.reduce((sum, group) => sum + report.groups[group.key].size, 0);
  const free = report.quota ? Math.max(0, report.quota - report.used) : null;
  const scale = report.quota ? Math.max(report.quota, report.used) : total;
  const segments = [
    ...GROUPS.map((group) => ({
      key: group.key,
      label: t(group.label),
      color: group.color,
      size: report.groups[group.key].size,
      count: report.groups[group.key].count,
    })),
    { key: 'trash', label: t('Papierkorb'), color: c.error, size: report.trash, count: 0 },
  ].filter((segment) => segment.size > 0);
  const other = Math.max(0, report.used - files - report.trash);
  const wasted = report.duplicates.reduce((sum, group) => sum + group.wasted, 0);
  const tidy = async (groups: Report['duplicates']) => {
    const copies = groups.reduce((sum, group) => sum + group.count - 1, 0);
    const first = groups[0].items[0];
    const ok = await confirm({
      title: tn(copies, 'Eine Kopie in den Papierkorb legen?', '{count} Kopien in den Papierkorb legen?'),
      text:
        groups.length === 1
          ? t('„{name}“ in „{folder}“ bleibt, die anderen Kopien wandern in den Papierkorb.', {
              name: first.name,
              folder: first.location || t('Meine Dateien'),
            })
          : t('Von jeder Datei bleibt die älteste Kopie, die anderen wandern in den Papierkorb.'),
      confirm: t('Aufräumen'),
      danger: true,
    });
    if (!ok) return;
    const result = await attempt(() =>
      api.post<{ removed: number; size: number }>('/api/storage/duplicates', { keep: groups.map((group) => group.items[0].id) })
    );
    if (!result) return;
    toast(tn(result.removed, 'Eine Kopie liegt jetzt im Papierkorb', '{count} Kopien liegen jetzt im Papierkorb'));
    setRevision((value) => value + 1);
  };

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        pb: 4,
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
        alignItems: 'start',
      }}
    >
      <Box sx={{ gridColumn: { lg: '1 / -1' } }}>
        <Card title={t('Belegter Speicher')}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h3" component="p" sx={{ fontWeight: 800 }}>
              {formatBytes(report.used)}
            </Typography>
            <Typography variant="body1" sx={{ color: c.onSurfaceVariant }}>
              {report.quota
                ? t('von {quota}, {free} frei', { quota: formatBytes(report.quota), free: formatBytes(free) })
                : t('ohne Speichergrenze')}
            </Typography>
          </Box>
          <Box
            role="img"
            aria-label={segments.map((segment) => `${segment.label}: ${formatBytes(segment.size)}`).join(', ')}
            sx={{
              display: 'flex',
              height: 16,
              borderRadius: `${radius.full}px`,
              overflow: 'hidden',
              bgcolor: c.surfaceContainerHighest,
              gap: '2px',
            }}
          >
            {segments.map((segment) => (
              <Box key={segment.key} sx={{ width: `${(segment.size / scale) * 100}%`, minWidth: 4, bgcolor: segment.color }} />
            ))}
            {other > 0 && <Box sx={{ width: `${(other / scale) * 100}%`, bgcolor: c.outline }} />}
          </Box>
          <Box
            component="ul"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}
          >
            {segments.map((segment) => (
              <Box component="li" key={segment.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: segment.color, flex: 'none' }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {segment.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {segment.count
                      ? `${formatBytes(segment.size)} · ${tn(segment.count, '{count} Datei', '{count} Dateien')}`
                      : formatBytes(segment.size)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
          {(report.trash > 0 || report.versions > 0) && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {report.trash > 0 && (
                <Button variant="tonal" startIcon={<DeleteSweepRounded />} onClick={() => navigate('/files/trash')}>
                  {t('Papierkorb ansehen')}
                </Button>
              )}
              {report.versions > 0 && (
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryRounded fontSize="small" />
                  {t('Ältere Versionen belegen zusätzlich {size}. Sie zählen nicht zu deinem Speicher.', {
                    size: formatBytes(report.versions),
                  })}
                </Typography>
              )}
            </Box>
          )}
        </Card>
      </Box>
      <Card title={t('Größte Dateien')}>
        {report.largest.length ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', mx: -1 }}>
            {report.largest.map((item) => (
              <FileRow key={item.id} item={item} extra={formatBytes(item.size)} onOpen={onReveal} />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Noch keine Dateien.')}
          </Typography>
        )}
      </Card>
      <Card
        title={t('Doppelte Dateien')}
        action={
          report.duplicates.length > 1 ? (
            <Button size="small" startIcon={<DeleteSweepRounded />} onClick={() => void tidy(report.duplicates)}>
              {t('Alle aufräumen')}
            </Button>
          ) : undefined
        }
      >
        {report.duplicates.length ? (
          <>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Diese Dateien haben genau den gleichen Inhalt. Löschst du die Kopien, werden bis zu {size} frei.', {
                size: formatBytes(wasted),
              })}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {report.duplicates.map((group) => (
                <Box key={group.sha256} sx={{ borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainerLow, p: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5 }}>
                    <FileCopyRounded fontSize="small" sx={{ color: c.onSurfaceVariant }} />
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant, flex: 1 }}>
                      {tn(group.count, '{count} Kopie', '{count} Kopien')} · {t('{size} je Datei', { size: formatBytes(group.size) })}
                    </Typography>
                    <Button size="small" onClick={() => void tidy([group])}>
                      {t('Nur eine behalten')}
                    </Button>
                  </Box>
                  {group.items.map((item) => (
                    <FileRow key={item.id} item={item} extra="" onOpen={onReveal} />
                  ))}
                  {group.count > group.items.length ? (
                    <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, px: 1, pt: 0.5 }}>
                      {tn(group.count - group.items.length, 'und {count} weitere Kopie', 'und {count} weitere Kopien')}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          </>
        ) : (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Keine doppelten Dateien gefunden.')}
          </Typography>
        )}
      </Card>
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant, gridColumn: { lg: '1 / -1' }, px: 1 }}>
        {t('Gleiche Inhalte liegen auf dem Server nur einmal. Für deinen Speicher zählt trotzdem jede Kopie.')}
      </Typography>
    </Box>
  );
}
