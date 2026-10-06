import type { StatBlock } from './backtest';
import type { Bars } from './types';

// Candles are shipped as small JSON chunks: times as minute gaps, prices as
// integer deltas. Gzip on the wire squeezes the repeats.

export const CHUNK = 10000;

export interface Chunk {
  /** global index of the first bar */
  from: number;
  t0: number;
  /** minutes since the previous bar (first entry is 0) */
  dt: number[];
  /** o,h,l,c per bar as integers (price * 10^digits), each stored as the difference from the previous number */
  p: number[];
}

export function encodeChunk(b: Bars, from: number, to: number, digits: number): Chunk {
  const m = 10 ** digits;
  const dt: number[] = [];
  const p: number[] = [];
  let prev = 0;
  for (let i = from; i < to; i++) {
    dt.push(i === from ? 0 : Math.round((b.t[i] - b.t[i - 1]) / 60));
    for (const v of [b.o[i], b.h[i], b.l[i], b.c[i]]) {
      const n = Math.round(v * m);
      p.push(n - prev);
      prev = n;
    }
  }
  return { from, t0: b.t[from], dt, p };
}

export function decodeChunk(ch: Chunk, digits: number): Bars {
  const m = 10 ** digits;
  const n = ch.dt.length;
  const out: Bars = { t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n) };
  let t = ch.t0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    t += ch.dt[k] * 60;
    out.t[k] = t;
    acc += ch.p[4 * k];
    out.o[k] = acc / m;
    acc += ch.p[4 * k + 1];
    out.h[k] = acc / m;
    acc += ch.p[4 * k + 2];
    out.l[k] = acc / m;
    acc += ch.p[4 * k + 3];
    out.c[k] = acc / m;
  }
  return out;
}

export function concatBars(parts: Bars[]): Bars {
  return {
    t: parts.flatMap((x) => x.t),
    o: parts.flatMap((x) => x.o),
    h: parts.flatMap((x) => x.h),
    l: parts.flatMap((x) => x.l),
    c: parts.flatMap((x) => x.c),
  };
}

export interface Manifest {
  generated: string;
  timeframe: 'm15';
  chunk: number;
  instruments: Record<string, { n: number; chunks: number; digits: number; first: number; last: number }>;
}

/** One drill: a closed candle with a known answer. */
export interface Drill {
  /** stable id: instrument:barIndex:system */
  id: string;
  /** instrument */
  x: string;
  /** global bar index of the decision candle */
  i: number;
  /** v = valid setup, n = near miss (one rule failed), z = nothing here */
  k: 'v' | 'n' | 'z';
  /** system this drill is about (for z: the system whose near-trigger it is closest to, or '') */
  s: string;
  /** direction 1 / -1 (0 for z) */
  d: number;
  /** failed rule id for near misses */
  f?: string;
  /** net R if taken with the system's stop and 2R target */
  r?: number;
  /** other systems that are also valid on this candle */
  a?: string[];
}

export interface DrillFile {
  generated: string;
  drills: Drill[];
}

export interface BacktestRow {
  sys: string;
  /** instrument id, or 'all' for the three markets together */
  x: string;
  /** how many times the setup appeared (valid on a closed candle) */
  seen: number;
  /** at the standard 2R target */
  main: StatBlock & {
    /** cumulative net R, sampled for a sparkline */
    curve: number[];
    byYear: Record<string, { trades: number; wins: number; totalR: number }>;
    long: StatBlock;
    short: StatBlock;
  };
  /** the same trades with other targets: '1', '1.5', '2', '3' */
  byTarget: Record<string, StatBlock>;
  /** before 2025 vs 2025 onward */
  early: StatBlock;
  recent: StatBlock;
}

/** One combination from the search over systems, markets, targets and switched-off rules. */
export interface Leader {
  sys: string;
  x: string;
  target: number;
  /** rule switched off, if any */
  off: string | null;
  /** candle size the system ran on */
  tf: 'm15' | 'h1' | 'h4';
  /** multiple of the system's stop distance */
  stopMult: number;
  early: StatBlock;
  recent: StatBlock;
  all: StatBlock;
  /** its trades, compact (same coding as TradeFile) so the app can price them with your settings */
  trades: { start: number; h: number[]; r: number[]; k: string };
}

export interface BacktestFile {
  generated: string;
  from: string;
  to: string;
  split: string;
  rows: BacktestRow[];
  /** how many combinations the search tried, and the best that held up on unseen data */
  searched: number;
  significant: number;
  /** held up before 2025 and since — most money first */
  leaders: Leader[];
  /** held up before 2025 and since — highest win rate first */
  winLeaders: Leader[];
}

/**
 * Every trade of every system (for the money simulator), keyed 'sys:market'.
 * Times are hours since `start`, delta-coded; R is in hundredths.
 */
export interface TradeFile {
  start: number;
  /** k: one letter per trade — w(in), l(oss), o(pen after 2 days) */
  rows: Record<string, { seen: number[]; byTarget: Record<string, { h: number[]; r: number[]; k: string }> }>;
}
