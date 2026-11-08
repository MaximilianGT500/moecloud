import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import LockRounded from '@mui/icons-material/LockRounded';
import { api, errorText } from '../../../lib/api';
import { formatBytes, formatDate, formatNumber } from '../../../lib/format';
import { t, tn } from '../../../lib/i18n';
import { c, radius } from '../../../theme/tokens';
import { triggerDownload } from '../actions';
import type { Item } from '../kinds';
import { Fallback } from './Fallback';

interface Entry {
  path: string;
  size: number;
  compressed: number;
  modified: number;
  folder: boolean;
  encrypted: boolean;
}

export default function ArchivePreview({ item, base, canDownload }: { item: Item; base: string; canDownload: boolean }) {
  const [data, setData] = useState<{ key: string; entries: Entry[]; truncated: boolean; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const key = item.id + item.version;

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ entries: Entry[]; truncated: boolean; total: number }>(`${base}/nodes/${item.id}/archive`, abort.signal)
      .then((result) => setData({ key, ...result }))
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [item.id, base, key]);

  if (error) return <Fallback item={item} text={error} />;
  if (!data || data.key !== key) return <CircularProgress aria-label={t('Lädt')} />;
  const files = data.entries.filter((entry) => !entry.folder);
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  const query = filter.trim().toLowerCase();
  const shown = data.entries.filter((entry) => !query || entry.path.toLowerCase().includes(query)).slice(0, 2000);

  return (
    <Box sx={{ width: 'min(900px, 100%)', height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant, flex: 1, minWidth: 200 }}>
          {tn(files.length, '{count} Datei, entpackt {size}', '{count} Dateien, entpackt {size}', { size: formatBytes(total) })}
          {data.truncated ? ` · ${t('die ersten {count} Einträge', { count: formatNumber(data.entries.length) })}` : ''}
        </Typography>
        <TextField size="small" label={t('Im Archiv suchen')} value={filter} onChange={(event) => setFilter(event.target.value)} />
      </Box>
      <Box
        role="list"
        aria-label={t('Inhalt von {name}', { name: item.name })}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainerLow, py: 0.5 }}
      >
        {shown.map((entry) => {
          const depth = entry.path.replace(/\/$/, '').split('/').length - 1;
          const name = entry.path.replace(/\/$/, '').split('/').pop();
          return (
            <Box
              role="listitem"
              key={entry.path}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                minHeight: 44,
                pr: 1,
                pl: `${16 + Math.min(depth, 8) * 18}px`,
                '&:hover': { bgcolor: c.surfaceContainer },
              }}
            >
              {entry.folder ? (
                <FolderRounded sx={{ color: c.primary, fontSize: 20 }} />
              ) : (
                <InsertDriveFileOutlined sx={{ color: c.onSurfaceVariant, fontSize: 20 }} />
              )}
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={entry.path}>
                {query ? entry.path : name}
              </Typography>
              {entry.encrypted && <LockRounded sx={{ fontSize: 18, color: c.onSurfaceVariant }} aria-label={t('Verschlüsselt')} />}
              {!entry.folder && (
                <Typography
                  variant="caption"
                  sx={{ color: c.onSurfaceVariant, display: { xs: 'none', sm: 'block' }, width: 90, textAlign: 'right' }}
                >
                  {formatDate(entry.modified)}
                </Typography>
              )}
              {!entry.folder && (
                <Typography
                  variant="caption"
                  sx={{ color: c.onSurfaceVariant, width: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatBytes(entry.size)}
                </Typography>
              )}
              {!entry.folder && canDownload && !entry.encrypted ? (
                <Tooltip title={t('Herunterladen')}>
                  <IconButton
                    size="small"
                    aria-label={t('{name} herunterladen', { name: name ?? '' })}
                    onClick={() => triggerDownload(`${base}/nodes/${item.id}/archive/entry?path=${encodeURIComponent(entry.path)}`)}
                  >
                    <DownloadRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : (
                <Box sx={{ width: 34 }} />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
