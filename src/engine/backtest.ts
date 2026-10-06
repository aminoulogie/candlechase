import { evaluate } from './evaluate';
import { LOOKAHEAD, WARMUP } from './indicators';
import { MAX_HOLD, simulate } from './outcome';
import { SYSTEMS } from './systems';
import type { Bars, Dir, Series, SystemId } from './types';

/** A candle where a system's trigger fired, with the rules that failed on it. */
export interface Candidate {
  i: number;
  dir: Dir;
  entry: number;
  stop: number;
  failed: string[];
}

export interface Trade {
  i: number;
  t: number;
  dir: Dir;
  result: 'win' | 'loss' | 'open';
  /** net R after spread */
  r: number;
  /** spread cost in R */
  sr: number;
}

export interface StatBlock {
  trades: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  /** 95% Wilson interval for the win rate */
  ciLo: number;
  ciHi: number;
  /** win rate needed to break even at this target, after spread */
  breakEven: number;
  avgR: number;
  totalR: number;
  profitFactor: number;
  maxLosingStreak: number;
  /** worst peak-to-trough fall of the running total, in R */
  maxDrawdown: number;
  /** chance a system with no edge would score this well or better by luck (one-sided t-test) */
  pValue: number;
}

/** Rules that define the candidate itself, so the Lab cannot switch them off. */
export function coreRules(sys: SystemId): string[] {
  const extra: Partial<Record<SystemId, string[]>> = { bb: ['stretch'], inside: ['inside'] };
  return [SYSTEMS[sys].triggerRule, ...(extra[sys] ?? [])];
}

/** Indexes whose evaluation window crosses a hole in the data (> 4 days without candles). */
export function gapGuard(bars: Bars): (i: number) => boolean {
  const n = bars.t.length;
  const gaps = new Int32Array(n + 1);
  for (let i = 1; i < n; i++) gaps[i + 1] = gaps[i] + (bars.t[i] - bars.t[i - 1] > 4 * 86400 ? 1 : 0);
  return (i: number) => i - WARMUP + 1 >= 0 && gaps[Math.min(n, i + LOOKAHEAD + 1)] - gaps[i - WARMUP + 1] === 0;
}

/** Every candle where the system's candidate shape appears, either direction. */
export function scan(bars: Bars, s: Series, sys: SystemId, clean: (i: number) => boolean): Candidate[] {
  const out: Candidate[] = [];
  const n = bars.t.length;
  for (let i = WARMUP; i < n - Math.max(MAX_HOLD, LOOKAHEAD) - 1; i++) {
    if (!clean(i)) continue;
    for (const dir of [1, -1] as Dir[]) {
      const e = evaluate(s, i, sys, dir);
      if (e && e.candidate) out.push({ i, dir, entry: e.entry, stop: e.stop, failed: e.failed });
    }
  }
  return out;
}

export interface TradeOptions {
  /** target as a multiple of the stop distance */
  targetR: number;
  spread: number;
  /** rules treated as met */
  disabled?: Set<string>;
  /** scale the system's stop distance (0.5 = half as far) */
  stopMult?: number;
  /** fixed stop and target distances in price units, replacing the system's stop */
  fixed?: { stop: number; target: number };
}

/** Take every valid candidate, one trade at a time, stop as the rules say, target at targetR. */
export function trade(bars: Bars, cands: Candidate[], o: TradeOptions): { trades: Trade[]; seen: number } {
  const trades: Trade[] = [];
  let busyUntil = -1;
  let seen = 0;
  for (const c of cands) {
    if (!c.failed.every((f) => o.disabled?.has(f))) continue;
    seen++;
    if (c.i <= busyUntil) continue;
    const risk = o.fixed ? o.fixed.stop : Math.abs(c.entry - c.stop) * (o.stopMult ?? 1);
    if (!(risk > 0)) continue;
    const stop = c.entry - c.dir * risk;
    const target = c.entry + c.dir * (o.fixed ? o.fixed.target : o.targetR * risk);
    const out = simulate(bars, c.i, c.dir, c.entry, stop, target, o.spread);
    busyUntil = out.exitIndex;
    trades.push({ i: c.i, t: bars.t[c.i], dir: c.dir, result: out.result, r: out.rNet, sr: o.spread / risk });
  }
  return { trades, seen };
}

const erf = (x: number) => {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export function stats(trades: Trade[], targetR: number): StatBlock {
  const n = trades.length;
  let wins = 0;
  let losses = 0;
  let open = 0;
  let total = 0;
  let gross = 0;
  let grossLoss = 0;
  let streak = 0;
  let maxStreak = 0;
  let peak = 0;
  let dd = 0;
  let srSum = 0;
  for (const t of trades) {
    if (t.result === 'win') wins++;
    else if (t.result === 'loss') losses++;
    else open++;
    total += t.r;
    srSum += t.sr;
    if (t.r > 0) gross += t.r;
    else grossLoss -= t.r;
    streak = t.r < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    peak = Math.max(peak, total);
    dd = Math.max(dd, peak - total);
  }
  const p = n ? wins / n : 0;
  const z = 1.96;
  const den = 1 + (z * z) / Math.max(n, 1);
  const centre = (p + (z * z) / (2 * Math.max(n, 1))) / den;
  const half = n ? (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den : 0;
  const mean = n ? total / n : 0;
  let v = 0;
  for (const t of trades) v += (t.r - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
  const pValue = n > 1 && sd > 0 ? 1 - normCdf(mean / (sd / Math.sqrt(n))) : 1;
  const sr = n ? srSum / n : 0;
  return {
    trades: n,
    wins,
    losses,
    open,
    winRate: p,
    ciLo: n ? Math.max(0, centre - half) : 0,
    ciHi: n ? Math.min(1, centre + half) : 0,
    breakEven: (1 + sr) / (targetR + 1),
    avgR: mean,
    totalR: total,
    profitFactor: grossLoss > 0 ? gross / grossLoss : gross > 0 ? 99 : 0,
    maxLosingStreak: maxStreak,
    maxDrawdown: dd,
    pValue,
  };
}

export type Verdict = 'works' | 'maybe' | 'none' | 'few';

/**
 * Works: profitable overall, unlikely to be luck, and still profitable on the
 * most recent data it was never tuned on.
 */
export function verdict(all: StatBlock, recent: StatBlock): Verdict {
  if (all.trades < 30) return 'few';
  if (all.avgR > 0 && all.pValue < 0.05 && recent.trades >= 10 && recent.avgR > 0) return 'works';
  if (all.avgR > 0) return 'maybe';
  return 'none';
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  works: 'Has an edge',
  maybe: 'Positive, could be luck',
  none: 'No edge',
  few: 'Too few trades',
};

/** Unseen-data split: the Lab tunes on everything before this date and checks after it. */
export const SPLIT_T = Date.UTC(2025, 0, 1) / 1000;
