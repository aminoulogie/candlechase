import type { Bars, Series } from './types';

/** EMA seeded with the simple average of the first n closes. */
export function ema(src: number[], n: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (src.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += src[i];
  let prev = sum / n;
  out[n - 1] = prev;
  const k = 2 / (n + 1);
  for (let i = n; i < src.length; i++) {
    prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(c: number[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n;
    loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Wilder ATR. */
export function atr(b: Bars, n = 14): number[] {
  const len = b.c.length;
  const out = new Array<number>(len).fill(NaN);
  if (len <= n) return out;
  const tr = (i: number) =>
    i === 0 ? b.h[0] - b.l[0] : Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1]));
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += tr(i);
  let prev = sum / n;
  out[n] = prev;
  for (let i = n + 1; i < len; i++) {
    prev = (prev * (n - 1) + tr(i)) / n;
    out[i] = prev;
  }
  return out;
}

/**
 * Swing highs/lows with k bars on each side. A swing at j is only known once
 * bar j + k has closed, so callers must only use swings with j <= i - k.
 */
export function pivots(b: Bars, k: number): { ph: Uint8Array; pl: Uint8Array } {
  const len = b.c.length;
  const ph = new Uint8Array(len);
  const pl = new Uint8Array(len);
  for (let j = k; j < len - k; j++) {
    let hi = true;
    let lo = true;
    for (let m = 1; m <= k && (hi || lo); m++) {
      if (b.h[j - m] >= b.h[j] || b.h[j + m] > b.h[j]) hi = false;
      if (b.l[j - m] <= b.l[j] || b.l[j + m] < b.l[j]) lo = false;
    }
    if (hi) ph[j] = 1;
    if (lo) pl[j] = 1;
  }
  return { ph, pl };
}

export function buildSeries(b: Bars): Series {
  const p2 = pivots(b, 2);
  const p5 = pivots(b, 5);
  return {
    ...b,
    ema20: ema(b.c, 20),
    ema50: ema(b.c, 50),
    ema200: ema(b.c, 200),
    rsi: rsi(b.c, 14),
    atr: atr(b, 14),
    ph2: p2.ph,
    pl2: p2.pl,
    ph5: p5.ph,
    pl5: p5.pl,
  };
}

/**
 * Bars needed before a decision candle so every indicator has settled.
 * EMA200 needs the most: after 1300 bars the seed's influence is ~e^-13.
 */
export const WARMUP = 1300;
/** Bars after the decision candle kept for showing what happened next. */
export const LOOKAHEAD = 200;

/** Slice [i - WARMUP, i + LOOKAHEAD] and compute indicators on it, exactly like the app does. */
export function windowSeries(b: Bars, i: number): { s: Series; offset: number } {
  const from = Math.max(0, i - WARMUP);
  const to = Math.min(b.c.length, i + LOOKAHEAD + 1);
  const w: Bars = {
    t: b.t.slice(from, to),
    o: b.o.slice(from, to),
    h: b.h.slice(from, to),
    l: b.l.slice(from, to),
    c: b.c.slice(from, to),
  };
  return { s: buildSeries(w), offset: from };
}
