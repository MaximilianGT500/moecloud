import { Suspense, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DifferenceRounded from '@mui/icons-material/DifferenceRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ShareRounded from '@mui/icons-material/ShareRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { c, radius } from '../../theme/tokens';
import { confirm } from '../common/dialogs';
import { lazyNamed } from '../common/lazy';
import { toast } from '../common/toast';
import { triggerDownload } from './actions';
import { ActivityList, type ActivityEntry } from './activity';
import { Comments } from './Comments';
import { Fact, MetaFacts, ScanState } from './facts';
import { canCompare, FileIcon, kindColor, kindLabel, thumbUrl, type Item } from './kinds';
import { useMeta } from './preview/meta';
import { TagChips } from './tags';

const VersionDiff = lazyNamed(() => import('./VersionDiff'), 'VersionDiff');

export type DetailsTab = 'info' | 'activity' | 'comments';

interface Version {
  id: string;
  size: number;
  modifiedAt: number;
  createdAt: number;
  author: string | null;
}

function Versions({ item, onChanged, onUpload }: { item: Item; onChanged: () => void; onUpload?: () => void }) {
  const [versions, setVersions] = useState<{ key: string; list: Version[] } | null>(null);
  const [comparing, setComparing] = useState<Version | null>(null);
  const editable = item.role === 'owner' || item.role === 'edit';
  const key = item.id + item.version;

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: Version[] }>(`/api/nodes/${item.id}/versions`, abort.signal)
      .then((result) => setVersions({ key, list: result.items }))
      .catch(() => {});
    return () => abort.abort();
  }, [item.id, key]);

  const list = versions?.key === key ? versions.list : null;
  return (
    <Box component="section" aria-labelledby="details-versions" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <HistoryRounded sx={{ color: c.onSurfaceVariant }} />
        <Typography id="details-versions" variant="subtitle2" sx={{ flex: 1 }}>
          {t('Versionen')}
        </Typography>
        {editable && onUpload && (
          <Button size="small" startIcon={<UploadRounded />} onClick={onUpload}>
            {t('Neue Version')}
          </Button>
        )}
      </Box>
      {!list ? (
        <CircularProgress size={20} aria-label={t('Lädt')} />
      ) : list.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Es gibt nur diese Version. Lädst du eine Datei mit gleichem Namen hoch, bleibt die alte hier erhalten.')}
        </Typography>
      ) : (
        list.map((version) => (
          <Box key={version.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{formatDateTime(version.modifiedAt)}</Typography>
              <Typography variant="caption" sx={{ color: c.onSurfaceVariant }} component="p">
                {[formatBytes(version.size), version.author].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            {canCompare(item, version) && (
              <Tooltip title={t('Mit der aktuellen Fassung vergleichen')}>
                <IconButton size="small" aria-label={t('Version vergleichen')} onClick={() => setComparing(version)}>
                  <DifferenceRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('Herunterladen')}>
              <IconButton
                size="small"
                aria-label={t('Version herunterladen')}
                onClick={() => triggerDownload(`/api/nodes/${item.id}/versions/${version.id}/content`)}
              >
                <DownloadRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            {editable && (
              <Tooltip title={t('Wiederherstellen')}>
                <IconButton
                  size="small"
                  aria-label={t('Version wiederherstellen')}
                  onClick={async () => {
                    try {
                      await api.post(`/api/nodes/${item.id}/versions/${version.id}/restore`);
                      toast(t('Version wiederhergestellt'));
                      onChanged();
                    } catch (error) {
                      toast(errorText(error));
                    }
                  }}
                >
                  <RestoreRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {editable && (
              <Tooltip title={t('Löschen')}>
                <IconButton
                  size="small"
                  aria-label={t('Version löschen')}
                  onClick={async () => {
                    if (!(await confirm({ title: t('Version löschen?'), confirm: t('Löschen'), danger: true }))) return;
                    try {
                      await api.delete(`/api/nodes/${item.id}/versions/${version.id}`);
                      setVersions({ key, list: list.filter((entry) => entry.id !== version.id) });
                    } catch (error) {
                      toast(errorText(error));
                    }
                  }}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ))
      )}
      {comparing && (
        <Suspense fallback={null}>
          <VersionDiff item={item} version={comparing} onClose={() => setComparing(null)} />
        </Suspense>
      )}
    </Box>
  );
}

function NodeActivity({ item }: { item: Item }) {
  const [state, setState] = useState<{ id: string; list: ActivityEntry[] } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: ActivityEntry[] }>(`/api/nodes/${item.id}/activity`, abort.signal)
      .then((result) => setState({ id: item.id, list: result.items }))
      .catch(() => {});
    return () => abort.abort();
  }, [item.id, item.version, revision]);

  useLive((event, payload) => {
    if (event !== 'change' && event !== 'comment') return;
    const folders = (payload.folders as string[] | undefined) ?? [];
    if (payload.nodeId === item.id || folders.includes(item.id) || (item.parentId && folders.includes(item.parentId))) {
      setRevision((value) => value + 1);
    }
  });

  const list = state?.id === item.id ? state.list : null;
  if (!list) return <CircularProgress size={24} aria-label={t('Lädt')} sx={{ alignSelf: 'center', my: 3 }} />;
  if (list.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          textAlign: 'center',
          color: c.onSurfaceVariant,
          py: 3,
        }}
      >
        <HistoryRounded sx={{ fontSize: 40 }} />
        <Typography variant="body2">{t('Hier ist noch nichts passiert.')}</Typography>
      </Box>
    );
  }
  return <ActivityList entries={list} />;
}

function InfoTab({
  item,
  location,
  onShare,
  onTags,
  onChanged,
  onUploadVersion,
}: {
  item: Item;
  location?: string;
  onShare?: (item: Item) => void;
  onTags?: (item: Item) => void;
  onChanged: () => void;
  onUploadVersion?: (item: Item) => void;
}) {
  const meta = useMeta(item);
  return (
    <>
      <Box
        sx={{
          aspectRatio: '16 / 10',
          borderRadius: `${radius.md}px`,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          bgcolor:
            item.thumb && !item.infected
              ? c.surfaceContainerHighest
              : `color-mix(in srgb, ${kindColor(item.kind)} 14%, ${c.surfaceContainerHigh})`,
        }}
      >
        {item.thumb && !item.infected ? (
          <Box component="img" src={thumbUrl(item)} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <FileIcon item={item} size={64} />
        )}
      </Box>
      <Box>
        <Typography variant="h6" component="p" sx={{ overflowWrap: 'anywhere' }}>
          {item.name}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {kindLabel(item.kind)}
        </Typography>
      </Box>
      {onTags && item.parentId && !item.trashedAt && (
        <Box role="group" aria-label={t('Schlagwörter')}>
          <TagChips ids={item.tags} onEdit={() => onTags(item)} />
        </Box>
      )}
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, m: 0 }}>
        {item.type === 'file' ? (
          <Fact label={t('Größe')}>{formatBytes(item.size)}</Fact>
        ) : (
          <Fact label={t('Inhalt')}>{tn(item.items ?? 0, '{count} Element', '{count} Elemente')}</Fact>
        )}
        {location !== undefined && <Fact label={t('Ort')}>{location || t('Meine Dateien')}</Fact>}
        <Fact label={t('Geändert')}>{formatDateTime(item.modifiedAt)}</Fact>
        {item.createdAt && <Fact label={t('Erstellt')}>{formatDateTime(item.createdAt)}</Fact>}
        <Fact label={t('Gehört')}>{item.owner ? item.owner.name : t('Dir')}</Fact>
        {item.viaGroup && <Fact label={t('Geteilt über')}>{t('Gruppe {name}', { name: item.viaGroup })}</Fact>}
        {item.role && item.role !== 'owner' && (
          <Fact label={t('Deine Rechte')}>{item.role === 'edit' ? t('Kann bearbeiten') : t('Kann ansehen')}</Fact>
        )}
        {meta && <MetaFacts item={item} meta={meta} />}
      </Box>
      {meta && <ScanState meta={meta} />}
      {onShare && item.role !== 'view' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer }}>
          <PeopleRounded sx={{ color: c.onSurfaceVariant }} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {item.shared ? t('Geteilt') : t('Nicht geteilt')}
          </Typography>
          <Button size="small" variant="tonal" startIcon={<ShareRounded />} onClick={() => onShare(item)}>
            {item.shared ? t('Verwalten') : t('Teilen')}
          </Button>
        </Box>
      )}
      {item.type === 'file' && !item.trashedAt && (
        <Versions item={item} onChanged={onChanged} onUpload={onUploadVersion ? () => onUploadVersion(item) : undefined} />
      )}
    </>
  );
}

export function Details({
  items,
  location,
  tab = 'info',
  onTab,
  onClose,
  onShare,
  onTags,
  onChanged,
  onUploadVersion,
}: {
  items: Item[];
  location?: string;
  tab?: DetailsTab;
  onTab?: (tab: DetailsTab) => void;
  onClose?: () => void;
  onShare?: (item: Item) => void;
  onTags?: (item: Item) => void;
  onChanged: () => void;
  onUploadVersion?: (item: Item) => void;
}) {
  const item = items.length === 1 ? items[0] : null;
  const tabs = Boolean(item && onTab && !item.trashedAt);
  const current = tabs ? tab : 'info';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, pt: 2, pb: tabs ? 0.5 : 0 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 1 }}>
          {t('Details')}
        </Typography>
        {onClose && (
          <Tooltip title={t('Details schließen')}>
            <IconButton aria-label={t('Details schließen')} onClick={onClose}>
              <CloseRounded />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {tabs && (
        <Tabs
          value={current}
          onChange={(_event, value: DetailsTab) => onTab?.(value)}
          variant="fullWidth"
          aria-label={t('Bereiche der Details')}
          sx={{
            px: 1,
            minHeight: 44,
            borderBottom: `1px solid ${c.outlineVariant}`,
            '& .MuiTab-root': { minHeight: 44, textTransform: 'none' },
          }}
        >
          <Tab value="info" label={t('Info')} id="details-tab-info" aria-controls="details-panel" />
          <Tab value="activity" label={t('Aktivität')} id="details-tab-activity" aria-controls="details-panel" />
          <Tab value="comments" label={t('Kommentare')} id="details-tab-comments" aria-controls="details-panel" />
        </Tabs>
      )}
      <Box
        id="details-panel"
        role={tabs ? 'tabpanel' : undefined}
        aria-labelledby={tabs ? `details-tab-${current}` : undefined}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, p: 2.5, flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {items.length === 0 && (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 1.5,
              color: c.onSurfaceVariant,
              px: 2,
            }}
          >
            <InfoOutlined sx={{ fontSize: 48 }} />
            <Typography variant="body2">{t('Wähle eine Datei oder einen Ordner aus, um Details zu sehen.')}</Typography>
          </Box>
        )}
        {items.length > 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="h6">{tn(items.length, '{count} Element', '{count} Elemente')}</Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Dateien zusammen: {size}', {
                size: formatBytes(items.filter((entry) => entry.type === 'file').reduce((sum, entry) => sum + entry.size, 0)),
              })}
            </Typography>
          </Box>
        )}
        {item && current === 'info' && (
          <InfoTab
            item={item}
            location={location}
            onShare={onShare}
            onTags={onTags}
            onChanged={onChanged}
            onUploadVersion={onUploadVersion}
          />
        )}
        {item && current === 'activity' && <NodeActivity item={item} />}
        {item && current === 'comments' && <Comments item={item} />}
      </Box>
    </Box>
  );
}
