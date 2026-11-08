import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { EmptyState } from '../common/bits';
import { ActivityList, type ActivityEntry } from './activity';

export function ActivityView({ onOpen }: { onOpen: (entry: ActivityEntry) => void }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: ActivityEntry[]; more: boolean }>('/api/activity', abort.signal)
      .then((page) => {
        setEntries(page.items);
        setMore(page.more);
        setError(null);
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(errorText(reason));
      });
    return () => abort.abort();
  }, [revision]);

  useLive((event) => {
    if (event !== 'change' && event !== 'comment' && event !== 'reconnect') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevision((value) => value + 1), 500);
  });

  const loadMore = async () => {
    if (!entries?.length) return;
    setLoading(true);
    try {
      const page = await api.get<{ items: ActivityEntry[]; more: boolean }>(`/api/activity?before=${entries[entries.length - 1].id}`);
      setEntries([...entries, ...page.items]);
      setMore(page.more);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  };

  if (error && !entries) return <EmptyState icon={<ErrorOutlineRounded />} title={t('Das hat nicht geklappt')} text={error} />;
  if (!entries) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, display: 'flex', flexDirection: 'column', gap: 1.5 }} aria-busy="true" aria-label={t('Lädt')}>
        {Array.from({ length: 8 }, (_, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Skeleton variant="circular" width={36} height={36} />
            <Skeleton variant="text" sx={{ flex: 1, maxWidth: `${70 - index * 5}%` }} />
          </Box>
        ))}
      </Box>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<HistoryRounded />}
        title={t('Noch keine Aktivität')}
        text={t('Hier siehst du, was in deinen Dateien passiert: Uploads, Änderungen, Freigaben und Kommentare.')}
      />
    );
  }
  return (
    <Box sx={{ px: { xs: 1, md: 2 }, pb: 4, maxWidth: 820 }}>
      <ActivityList entries={entries} onOpen={onOpen} grouped />
      {more && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button variant="tonal" disabled={loading} onClick={() => void loadMore()}>
            {t('Ältere anzeigen')}
          </Button>
        </Box>
      )}
    </Box>
  );
}
