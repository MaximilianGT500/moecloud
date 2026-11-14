import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { formatBytes, formatDay, formatNumber } from '../../lib/format';
import { locale, t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { Section } from '../common/bits';

export interface UsageDay {
  day: string;
  users: number;
  files: number;
  bytes: number;
  stored: number;
}

const PLOT = 180;
const TOP = 16;
const AXIS = 28;
const LEFT = 64;
const RIGHT = 20;
const SIZES = [1024 ** 4, 1024 ** 3, 1024 ** 2, 1024, 1];

function scale(max: number) {
  const unit = SIZES.find((size) => max >= size) ?? 1;
  const raw = Math.max(max / unit, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((value) => value >= raw) ?? 10 * power;
  const count = Math.max(1, Math.ceil(max / unit / step));
  return { top: count * step * unit, ticks: Array.from({ length: count + 1 }, (_, index) => index * step * unit) };
}

const timeOf = (day: string) => Date.parse(`${day}T12:00:00Z`);

const markColor = (theme: Theme) => ({ color: c.primary, ...theme.applyStyles('dark', { color: c.inversePrimary }) });

function Table({ history }: { history: UsageDay[] }) {
  return (
    <Box sx={{ maxHeight: 320, overflow: 'auto', borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainer }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 14,
          '& th, & td': { px: 1.5, py: 0.75, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
          '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
          '& thead th': { position: 'sticky', top: 0, bgcolor: c.surfaceContainer, color: c.onSurfaceVariant, fontWeight: 500 },
          '& tbody tr + tr td': { borderTop: `1px solid ${c.outlineVariant}` },
        }}
      >
        <thead>
          <tr>
            <th scope="col">{t('Tag')}</th>
            <th scope="col">{t('Belegt')}</th>
            <th scope="col">{t('Auf der Platte')}</th>
            <th scope="col">{t('Dateien')}</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((entry) => (
            <tr key={entry.day}>
              <td>{formatDay(timeOf(entry.day))}</td>
              <td>{formatBytes(entry.bytes)}</td>
              <td>{formatBytes(entry.stored)}</td>
              <td>{formatNumber(entry.files)}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function Chart({ history }: { history: UsageDay[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = timeOf(history[0].day);
  const last = timeOf(history.at(-1)!.day);
  const { top, ticks } = scale(Math.max(...history.map((entry) => entry.bytes), 1));
  const plotWidth = Math.max(width - LEFT - RIGHT, 1);
  const base = TOP + PLOT;
  const x = (day: string) => LEFT + ((timeOf(day) - first) / Math.max(last - first, 1)) * plotWidth;
  const y = (bytes: number) => base - (bytes / top) * PLOT;
  const points = history.map((entry) => [x(entry.day), y(entry.bytes)] as const);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)![0].toFixed(1)} ${base} L${points[0][0].toFixed(1)} ${base} Z`;
  const years = new Date(first).getUTCFullYear() !== new Date(last).getUTCFullYear();
  const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(years ? { year: '2-digit' } : {}), timeZone: 'UTC' });
  const labels = width > 420 ? [0, Math.floor((history.length - 1) / 2), history.length - 1] : [0, history.length - 1];
  const end = points.at(-1)!;
  const latest = history.at(-1)!;
  const shown = active === null ? null : history[active];
  const nearest = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const position = clientX - rect.left;
    let best = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index][0] - position) < Math.abs(points[best][0] - position)) best = index;
    }
    return best;
  };
  const keys = (event: KeyboardEvent) => {
    const current = active ?? history.length - 1;
    const next =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? history.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.min(history.length - 1, Math.max(0, next)));
  };

  return (
    <Box
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={t('Speicherverlauf über {count} Tage. Mit den Pfeiltasten wählst du einen Tag.', { count: history.length })}
      onPointerMove={(event: PointerEvent) => setActive(nearest(event.clientX))}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((value) => value ?? history.length - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={keys}
      sx={(theme) => ({
        position: 'relative',
        borderRadius: `${radius.sm}px`,
        outline: 'none',
        touchAction: 'pan-y',
        '&:focus-visible': { boxShadow: `0 0 0 2px ${c.primary}` },
        ...markColor(theme),
      })}
    >
      <svg width="100%" height={TOP + PLOT + AXIS} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
        {width > 0 && (
          <>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={LEFT}
                  x2={width - RIGHT}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={c.outlineVariant}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={LEFT - 10}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill={c.onSurfaceVariant}
                  fontSize={12}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {tick === 0 ? '0' : formatBytes(tick)}
                </text>
              </g>
            ))}
            {labels.map((index) => (
              <text
                key={index}
                x={points[index][0]}
                y={base + 20}
                textAnchor={index === 0 ? 'start' : index === history.length - 1 ? 'end' : 'middle'}
                fill={c.onSurfaceVariant}
                fontSize={12}
              >
                {short.format(timeOf(history[index].day))}
              </text>
            ))}
            <path d={area} fill="currentColor" fillOpacity={0.1} />
            <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active === null && (
              <>
                <circle cx={end[0]} cy={end[1]} r={4} fill="currentColor" stroke={c.surfaceContainerLow} strokeWidth={2} />
                <text x={end[0] - 10} y={Math.max(end[1] - 12, 12)} textAnchor="end" fill={c.onSurface} fontSize={13} fontWeight={600}>
                  {formatBytes(latest.bytes)}
                </text>
              </>
            )}
            {active !== null && (
              <>
                <line
                  x1={points[active][0]}
                  x2={points[active][0]}
                  y1={TOP}
                  y2={base}
                  stroke={c.outline}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <circle
                  cx={points[active][0]}
                  cy={points[active][1]}
                  r={4}
                  fill="currentColor"
                  stroke={c.surfaceContainerLow}
                  strokeWidth={2}
                />
              </>
            )}
          </>
        )}
      </svg>
      {shown && width > 0 && (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            top: 0,
            ...(points[active!][0] > width / 2 ? { right: width - points[active!][0] + 12 } : { left: points[active!][0] + 12 }),
            width: 'max-content',
            maxWidth: Math.max(160, width / 2 - 24),
            pointerEvents: 'none',
            px: 1.5,
            py: 1,
            borderRadius: `${radius.sm}px`,
            bgcolor: c.surfaceContainerHighest,
            color: c.onSurface,
            boxShadow: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={(theme) => ({ width: 12, height: 2, borderRadius: 1, bgcolor: 'currentColor', ...markColor(theme) })} />
            <Typography variant="subtitle2" component="p">
              {formatBytes(shown.bytes)}
            </Typography>
          </Box>
          <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
            {formatDay(timeOf(shown.day))}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
            {tn(shown.files, '{count} Datei', '{count} Dateien')} · {t('{size} auf der Platte', { size: formatBytes(shown.stored) })}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export function UsageSection({ history }: { history: UsageDay[] }) {
  const [table, setTable] = useState(false);
  return (
    <Section
      title={t('Speicherverlauf')}
      description={t('Wie viel am Ende jedes Tages belegt war')}
      action={
        history.length > 1 ? (
          <Button size="small" onClick={() => setTable((value) => !value)}>
            {table ? t('Als Diagramm') : t('Als Tabelle')}
          </Button>
        ) : undefined
      }
    >
      {history.length < 2 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('MoeCloud merkt sich ab jetzt jeden Tag, wie viel belegt ist. Ab morgen siehst du hier den Verlauf.')}
        </Typography>
      ) : table ? (
        <Table history={history} />
      ) : (
        <Chart history={history} />
      )}
    </Section>
  );
}
