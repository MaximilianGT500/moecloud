import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import QueueMusicRounded from '@mui/icons-material/QueueMusicRounded';
import RepeatOneRounded from '@mui/icons-material/RepeatOneRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import ShuffleRounded from '@mui/icons-material/ShuffleRounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded';
import { formatDuration } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, elevation, mix, radius } from '../../theme/tokens';
import { RAIL } from '../shell/AppShell';
import { thumbUrl, type Item } from './kinds';
import {
  clear,
  cycleRepeat,
  ensureInfo,
  jump,
  next,
  prefetchInfo,
  previous,
  remove,
  seek,
  setVolume,
  toggle,
  toggleShuffle,
  usePlayer,
  type PlayerState,
} from './player';

function Cover({ item, size }: { item: Item; size: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: `${size > 80 ? radius.lg : radius.sm}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        bgcolor: `color-mix(in srgb, var(--mui-palette-fileTypes-audio) 22%, ${c.surfaceContainerHighest})`,
      }}
    >
      {item.thumb && !failed ? (
        <Box
          component="img"
          src={thumbUrl(item)}
          alt=""
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <MusicNoteRounded sx={{ color: 'var(--mui-palette-fileTypes-audio)', fontSize: size * 0.5 }} />
      )}
    </Box>
  );
}

const titleOf = (player: PlayerState, item: Item) => player.info[item.id]?.title || item.name;
const lineOf = (player: PlayerState, item: Item) => [player.info[item.id]?.artist, player.info[item.id]?.album].filter(Boolean).join(' · ');

function Timeline({ player, compact = false }: { player: PlayerState; compact?: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? player.time;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}
      >
        {formatDuration(value)}
      </Typography>
      <Slider
        size="small"
        aria-label={t('Stelle im Titel')}
        min={0}
        max={Math.max(1, player.duration)}
        step={1}
        value={Math.min(value, Math.max(1, player.duration))}
        disabled={!player.duration}
        onChange={(_event, next) => setDragging(next as number)}
        onChangeCommitted={(_event, next) => {
          seek(next as number);
          setDragging(null);
        }}
        getAriaValueText={(seconds) => formatDuration(seconds)}
        sx={{ flex: 1, py: compact ? 1 : undefined }}
      />
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
        {player.duration ? formatDuration(player.duration) : '–:––'}
      </Typography>
    </Box>
  );
}

function Controls({ player, large = false }: { player: PlayerState; large?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: large ? 1.5 : 0.5 }}>
      <Tooltip title={t('Vorheriger Titel')}>
        <IconButton aria-label={t('Vorheriger Titel')} onClick={previous}>
          <SkipPreviousRounded />
        </IconButton>
      </Tooltip>
      <IconButton
        aria-label={player.playing ? t('Pause') : t('Abspielen')}
        onClick={toggle}
        sx={{
          width: large ? 64 : 44,
          height: large ? 64 : 44,
          bgcolor: c.primary,
          color: c.onPrimary,
          '&:hover': { bgcolor: mix(c.primary, 88) },
        }}
      >
        {player.playing ? (
          <PauseRounded fontSize={large ? 'large' : 'medium'} />
        ) : (
          <PlayArrowRounded fontSize={large ? 'large' : 'medium'} />
        )}
      </IconButton>
      <Tooltip title={t('Nächster Titel')}>
        <span>
          <IconButton
            aria-label={t('Nächster Titel')}
            onClick={next}
            disabled={player.index >= player.queue.length - 1 && player.repeat !== 'all'}
          >
            <SkipNextRounded />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

function Modes({ player }: { player: PlayerState }) {
  const repeatLabel =
    player.repeat === 'off' ? t('Wiederholen ist aus') : player.repeat === 'all' ? t('Alle wiederholen') : t('Titel wiederholen');
  return (
    <>
      <Tooltip title={player.shuffle ? t('Zufällige Reihenfolge ist an') : t('Zufällige Reihenfolge')}>
        <IconButton
          aria-label={t('Zufällige Reihenfolge')}
          aria-pressed={player.shuffle}
          onClick={toggleShuffle}
          sx={{ color: player.shuffle ? c.primary : c.onSurfaceVariant }}
        >
          <ShuffleRounded />
        </IconButton>
      </Tooltip>
      <Tooltip title={repeatLabel}>
        <IconButton
          aria-label={repeatLabel}
          aria-pressed={player.repeat !== 'off'}
          onClick={cycleRepeat}
          sx={{ color: player.repeat === 'off' ? c.onSurfaceVariant : c.primary }}
        >
          {player.repeat === 'one' ? <RepeatOneRounded /> : <RepeatRounded />}
        </IconButton>
      </Tooltip>
    </>
  );
}

function QueuePanel({ player, small, onClose }: { player: PlayerState; small: boolean; onClose: () => void }) {
  const track = player.queue[player.index];
  useEffect(() => {
    void prefetchInfo();
  }, [player.queue]);
  return (
    <Drawer
      open
      anchor={small ? 'bottom' : 'right'}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: small ? '100%' : 400,
            maxHeight: small ? '92dvh' : '100%',
            borderRadius: small ? `${radius.xl}px ${radius.xl}px 0 0` : `${radius.xl}px 0 0 ${radius.xl}px`,
            bgcolor: c.surfaceContainerLow,
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5 }}>
        <Typography variant="subtitle1" component="h2" sx={{ flex: 1, fontWeight: 700 }}>
          {t('Wiedergabe')}
        </Typography>
        <IconButton aria-label={t('Schließen')} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Box>
      {track && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, px: 3, pb: 2, textAlign: 'center' }}>
          <Cover item={track} size={small ? 200 : 160} />
          <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
            <Typography variant="h6" noWrap>
              {titleOf(player, track)}
            </Typography>
            <Typography variant="body2" noWrap sx={{ color: c.onSurfaceVariant }}>
              {lineOf(player, track) || track.name}
            </Typography>
          </Box>
          <Box sx={{ width: '100%' }}>
            <Timeline player={player} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Modes player={player} />
            <Controls player={player} large />
          </Box>
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, borderTop: `1px solid ${c.outlineVariant}` }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {tn(player.queue.length, 'Ein Titel in der Warteschlange', '{count} Titel in der Warteschlange')}
        </Typography>
        <Button
          size="small"
          onClick={() => {
            clear();
            onClose();
          }}
        >
          {t('Leeren')}
        </Button>
      </Box>
      <Box
        component="ol"
        aria-label={t('Warteschlange')}
        sx={{ m: 0, p: 0, pb: 2, listStyle: 'none', overflowY: 'auto', flex: 1, minHeight: 0 }}
      >
        {player.queue.map((item, index) => {
          const active = index === player.index;
          return (
            <Box component="li" key={item.id} sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
              <ButtonBase
                onClick={() => jump(index)}
                aria-current={active ? 'true' : undefined}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  px: 2,
                  py: 0.75,
                  borderRadius: `${radius.md}px`,
                  bgcolor: active ? c.secondaryContainer : 'transparent',
                }}
              >
                <Cover item={item} size={40} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: active ? 700 : 500, color: active ? c.onSecondaryContainer : c.onSurface }}
                  >
                    {titleOf(player, item)}
                  </Typography>
                  {lineOf(player, item) && (
                    <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                      {lineOf(player, item)}
                    </Typography>
                  )}
                </Box>
              </ButtonBase>
              <Tooltip title={t('Aus der Warteschlange nehmen')}>
                <IconButton
                  size="small"
                  aria-label={t('„{name}“ aus der Warteschlange nehmen', { name: item.name })}
                  onClick={() => remove(index)}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Box>
    </Drawer>
  );
}

export function MiniPlayer() {
  const player = usePlayer();
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('md'));
  const [panel, setPanel] = useState(false);
  const track = player.queue[player.index] ?? null;
  const visible = Boolean(track);

  useEffect(() => {
    if (track) void ensureInfo(track);
  }, [track]);

  useEffect(() => {
    document.documentElement.style.setProperty('--moe-player', visible ? (small ? '72px' : '88px') : '0px');
    return () => document.documentElement.style.setProperty('--moe-player', '0px');
  }, [visible, small]);

  if (!track) return null;
  const progress = player.duration ? Math.min(100, (player.time / player.duration) * 100) : 0;

  return (
    <>
      <Box
        role="region"
        aria-label={t('Musik')}
        sx={{
          position: 'fixed',
          zIndex: 1150,
          left: { xs: 8, md: RAIL },
          right: { xs: 8, md: 16 },
          bottom: { xs: 'calc(84px + env(safe-area-inset-bottom))', md: 16 },
          height: { xs: 64, md: 72 },
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, md: 2 },
          pl: { xs: 1, md: 1.5 },
          pr: { xs: 0.5, md: 1.5 },
          borderRadius: `${radius.lg}px`,
          bgcolor: c.surfaceContainerHigh,
          boxShadow: elevation[2],
          overflow: 'hidden',
        }}
      >
        <ButtonBase
          onClick={() => setPanel(true)}
          aria-label={t('Wiedergabe öffnen')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flex: { xs: 1, md: '0 1 300px' },
            minWidth: 0,
            justifyContent: 'flex-start',
            textAlign: 'left',
            borderRadius: `${radius.md}px`,
          }}
        >
          <Cover item={track} size={small ? 44 : 52} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
              {titleOf(player, track)}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
              {lineOf(player, track) || t('Titel {index} von {count}', { index: player.index + 1, count: player.queue.length })}
            </Typography>
          </Box>
        </ButtonBase>
        {small ? (
          <>
            <IconButton aria-label={player.playing ? t('Pause') : t('Abspielen')} onClick={toggle}>
              {player.playing ? <PauseRounded /> : <PlayArrowRounded />}
            </IconButton>
            <IconButton
              aria-label={t('Nächster Titel')}
              onClick={next}
              disabled={player.index >= player.queue.length - 1 && player.repeat !== 'all'}
            >
              <SkipNextRounded />
            </IconButton>
            <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, bgcolor: mix(c.onSurface, 10) }}>
              <Box sx={{ width: `${progress}%`, height: '100%', bgcolor: c.primary }} />
            </Box>
          </>
        ) : (
          <>
            <Controls player={player} />
            <Timeline player={player} />
            <Modes player={player} />
            <Tooltip title={player.volume ? t('Ton aus') : t('Ton an')}>
              <IconButton aria-label={player.volume ? t('Ton aus') : t('Ton an')} onClick={() => setVolume(player.volume ? 0 : 1)}>
                {player.volume ? <VolumeUpRounded /> : <VolumeOffRounded />}
              </IconButton>
            </Tooltip>
            <Slider
              size="small"
              aria-label={t('Lautstärke')}
              min={0}
              max={1}
              step={0.05}
              value={player.volume}
              onChange={(_event, value) => setVolume(value as number)}
              sx={{ width: 88, display: { md: 'none', lg: 'block' } }}
            />
            <Tooltip title={t('Warteschlange')}>
              <IconButton aria-label={t('Warteschlange')} onClick={() => setPanel(true)}>
                <QueueMusicRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('Player schließen')}>
              <IconButton aria-label={t('Player schließen')} onClick={clear}>
                <CloseRounded />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      {panel && <QueuePanel player={player} small={small} onClose={() => setPanel(false)} />}
    </>
  );
}
