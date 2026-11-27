import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';

const PULL = 64;
const SWIPE = 84;

const coarse = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const atTop = () => window.scrollY <= 0 && (document.getElementById('inhalt')?.scrollTop ?? 0) <= 0;

const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {}
};

export function PullToRefresh({ onRefresh, children, disabled }: { onRefresh: () => unknown; children: ReactNode; disabled?: boolean }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef({ startY: 0, startX: 0, active: false, pull: 0, busy: false });
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });

  useEffect(() => {
    if (disabled || !coarse()) return;
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'contain';
    const start = (event: TouchEvent) => {
      if (state.current.busy || event.touches.length !== 1 || !atTop()) return;
      if ((event.target as HTMLElement | null)?.closest('.MuiDialog-root, .MuiPopover-root, [data-no-pull]')) return;
      state.current.startY = event.touches[0].clientY;
      state.current.startX = event.touches[0].clientX;
      state.current.active = true;
      state.current.pull = 0;
    };
    const move = (event: TouchEvent) => {
      if (!state.current.active) return;
      const dy = event.touches[0].clientY - state.current.startY;
      const dx = event.touches[0].clientX - state.current.startX;
      if (dy <= 0 || Math.abs(dx) > dy || !atTop()) {
        if (state.current.pull) setPull(0);
        state.current.pull = 0;
        if (dy < 0 || Math.abs(dx) > 12) state.current.active = false;
        return;
      }
      const next = Math.min(PULL * 1.8, dy * 0.5);
      if (state.current.pull < PULL && next >= PULL) buzz();
      state.current.pull = next;
      setPull(next);
      if (event.cancelable && dy > 8) event.preventDefault();
    };
    const end = async () => {
      if (!state.current.active) return;
      state.current.active = false;
      const ready = state.current.pull >= PULL;
      state.current.pull = 0;
      setPull(0);
      if (!ready) return;
      state.current.busy = true;
      setBusy(true);
      try {
        await refresh.current();
      } finally {
        state.current.busy = false;
        setBusy(false);
      }
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      root.style.overscrollBehaviorY = before;
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [disabled]);

  const height = busy ? 48 : pull;
  return (
    <>
      <Box
        role={busy ? 'status' : undefined}
        aria-label={busy ? t('Wird aktualisiert') : undefined}
        data-pull={pull > 0 || busy ? '' : undefined}
        sx={{
          height,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          transition: pull ? 'none' : 'height 200ms ease',
          color: c.primary,
        }}
      >
        {(pull > 8 || busy) && (
          <CircularProgress
            size={24}
            thickness={5}
            variant={busy ? 'indeterminate' : 'determinate'}
            value={Math.min(100, (pull / PULL) * 100)}
          />
        )}
      </Box>
      {children}
    </>
  );
}

export interface SwipeAction {
  icon: ReactNode;
  label: string;
  color: string;
  background: string;
  run: () => void;
}

export function SwipeRow({
  start,
  end,
  surface = c.surface,
  children,
}: {
  start?: SwipeAction;
  end?: SwipeAction;
  surface?: string;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null; armed: boolean } | null>(null);
  const enabled = Boolean(start || end);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, armed: false };
    setSettling(false);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (current.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (current.axis !== 'x') return;
    const allowed = dx > 0 ? (start ? dx : 0) : end ? dx : 0;
    const armed = Math.abs(allowed) >= SWIPE;
    if (armed !== current.armed) {
      current.armed = armed;
      if (armed) buzz();
    }
    setOffset(allowed);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setSettling(true);
    if (current.axis === 'x' && current.armed) {
      const action = offset > 0 ? start : end;
      setOffset(0);
      action?.run();
      return;
    }
    setOffset(0);
  };

  const action = offset > 0 ? start : offset < 0 ? end : null;
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden', touchAction: enabled ? 'pan-y' : undefined }} data-swipe-row>
      {action && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: offset > 0 ? 'flex-start' : 'flex-end',
            gap: 1,
            px: 3,
            bgcolor: action.background,
            color: action.color,
            fontWeight: 600,
            fontSize: '0.875rem',
            '& svg': { transform: Math.abs(offset) >= SWIPE ? 'scale(1.2)' : 'none', transition: 'transform 120ms ease' },
          }}
        >
          {action.icon}
          {action.label}
        </Box>
      )}
      <Box
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        sx={{
          position: 'relative',
          bgcolor: offset ? surface : undefined,
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: settling ? 'transform 200ms ease' : 'none',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
