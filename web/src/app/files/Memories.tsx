import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import { api } from '../../lib/api';
import { dayValue, formatDay } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, curve, mix, radius } from '../../theme/tokens';
import type { Action } from './ActionMenu';
import { Thumb, type Item } from './kinds';
import { Viewer } from './Viewer';

interface Memory {
  year: number;
  items: Item[];
}

const HIDDEN = 'moecloud-memories-hidden';

function hiddenToday(today: string) {
  try {
    return localStorage.getItem(HIDDEN) === today;
  } catch {
    return false;
  }
}

export function Memories({ actions, revision }: { actions: (item: Item) => Action[]; revision: number }) {
  const today = dayValue(Date.now());
  const [groups, setGroups] = useState<Memory[]>([]);
  const [hidden, setHidden] = useState(() => hiddenToday(today));
  const [open, setOpen] = useState<{ year: number; index: number } | null>(null);

  useEffect(() => {
    if (hidden) return;
    const abort = new AbortController();
    api
      .get<{ groups: Memory[] }>(`/api/photos/memories?date=${today}&offset=${new Date().getTimezoneOffset()}`, abort.signal)
      .then((result) => setGroups(result.groups))
      .catch(() => setGroups([]));
    return () => abort.abort();
  }, [today, hidden, revision]);

  if (hidden || groups.length === 0) return null;
  const current = open ? groups.find((group) => group.year === open.year) : undefined;
  const thisYear = new Date().getFullYear();

  const hide = () => {
    try {
      localStorage.setItem(HIDDEN, today);
    } catch {}
    setHidden(true);
  };

  return (
    <Box component="section" aria-labelledby="memories-title">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, mb: 1.25 }}>
        <HistoryRounded fontSize="small" sx={{ color: c.primary }} />
        <Typography id="memories-title" variant="subtitle1" component="h2" sx={{ fontWeight: 800, flex: 1 }}>
          {t('An diesem Tag')}
        </Typography>
        <Tooltip title={t('Für heute ausblenden')}>
          <IconButton size="small" aria-label={t('Für heute ausblenden')} onClick={hide}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          gap: 1.5,
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          pb: 0.5,
        }}
      >
        {groups.map((group) => {
          const ago = thisYear - group.year;
          const cover = group.items.find((item) => item.thumb) ?? group.items[0];
          const label = tn(ago, 'Vor {count} Jahr', 'Vor {count} Jahren');
          return (
            <Box component="li" key={group.year} sx={{ flex: 'none', width: { xs: 160, md: 200 }, scrollSnapAlign: 'start' }}>
              <ButtonBase
                onClick={() => setOpen({ year: group.year, index: 0 })}
                aria-label={`${label}, ${tn(group.items.length, '{count} Element', '{count} Elemente')}`}
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '3 / 4',
                  borderRadius: `${radius.lg}px`,
                  overflow: 'hidden',
                  bgcolor: c.surfaceContainerHighest,
                  display: 'block',
                  '& img': { transition: `transform 280ms ${curve.standard}` },
                  '&:hover img': { transform: 'scale(1.04)' },
                }}
              >
                <Thumb item={cover} size="100%" />
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    p: 1.5,
                    textAlign: 'left',
                    background: `linear-gradient(to top, ${mix(c.scrim, 72)}, transparent 60%)`,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#fff' }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" noWrap sx={{ color: 'rgb(255 255 255 / 0.85)' }}>
                    {formatDay(group.items[0].takenAt ?? group.items[0].modifiedAt)}
                  </Typography>
                  <Typography variant="caption" noWrap sx={{ color: 'rgb(255 255 255 / 0.85)' }}>
                    {tn(group.items.length, '{count} Element', '{count} Elemente')}
                  </Typography>
                </Box>
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
      {current && (
        <Viewer
          items={current.items}
          index={open?.index ?? null}
          onIndex={(index) => setOpen(index === null ? null : { year: current.year, index })}
          actions={actions}
        />
      )}
    </Box>
  );
}
