export type MoonPhase = 'new' | 'first' | 'full' | 'last';

export interface MoonEvent {
  phase: MoonPhase;
  utc: number;
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const PHASES: MoonPhase[] = ['new', 'first', 'full', 'last'];

function phaseTime(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = rad(2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);
  const O = rad(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
  const fraction = Math.round((k - Math.floor(k)) * 4) % 4;
  const sin = Math.sin;
  if (fraction === 0 || fraction === 2) {
    const full = fraction === 2;
    jde +=
      (full ? -0.40614 : -0.4072) * sin(Mp) +
      (full ? 0.17302 : 0.17241) * E * sin(M) +
      (full ? 0.01614 : 0.01608) * sin(2 * Mp) +
      (full ? 0.01043 : 0.01039) * sin(2 * F) +
      (full ? 0.00734 : 0.00739) * E * sin(Mp - M) -
      (full ? 0.00515 : 0.00514) * E * sin(Mp + M) +
      (full ? 0.00209 : 0.00208) * E * E * sin(2 * M) -
      0.00111 * sin(Mp - 2 * F) -
      0.00057 * sin(Mp + 2 * F) +
      0.00056 * E * sin(2 * Mp + M) -
      0.00042 * sin(3 * Mp) +
      0.00042 * E * sin(M + 2 * F) +
      0.00038 * E * sin(M - 2 * F) -
      0.00024 * E * sin(2 * Mp - M) -
      0.00017 * sin(O);
  } else {
    jde +=
      -0.62801 * sin(Mp) +
      0.17172 * E * sin(M) -
      0.01183 * E * sin(Mp + M) +
      0.00862 * sin(2 * Mp) +
      0.00804 * sin(2 * F) +
      0.00454 * E * sin(Mp - M) +
      0.00204 * E * E * sin(2 * M) -
      0.0018 * sin(Mp - 2 * F) -
      0.0007 * sin(Mp + 2 * F) -
      0.0004 * sin(3 * Mp) -
      0.00034 * E * sin(2 * Mp - M) +
      0.00032 * E * sin(M + 2 * F) +
      0.00032 * E * sin(M - 2 * F) -
      0.00028 * E * E * sin(Mp + 2 * M) +
      0.00027 * E * sin(2 * Mp + M);
    const W =
      0.00306 -
      0.00038 * E * Math.cos(M) +
      0.00026 * Math.cos(Mp) -
      0.00002 * Math.cos(Mp - M) +
      0.00002 * Math.cos(Mp + M) +
      0.00002 * Math.cos(2 * F);
    jde += fraction === 1 ? W : -W;
  }
  return Math.round((jde - 2440587.5) * 86_400_000 - 70_000);
}

export function moonPhases(fromUtc: number, toUtc: number): MoonEvent[] {
  const years = (fromUtc / 86_400_000 - 10_957.5) / 365.25;
  let k = Math.floor(years * 12.3685) - 1;
  const out: MoonEvent[] = [];
  for (let guard = 0; guard < 2000; guard++, k++) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const utc = phaseTime(k + quarter / 4);
      if (utc >= toUtc) return out;
      if (utc >= fromUtc) out.push({ phase: PHASES[quarter], utc });
    }
  }
  return out;
}

export const MOON_SYMBOL: Record<MoonPhase, string> = { new: '🌑', first: '🌓', full: '🌕', last: '🌗' };
