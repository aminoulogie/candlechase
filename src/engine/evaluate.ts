import { SYSTEMS } from './systems';
import type { Dir, Evaluation, Marks, Series, SystemId } from './types';

const DAY = 86400;
const H = 3600;

const utcHour = (t: number) => ((t % DAY) + DAY) % DAY / H;

/** How far back the EMA Pullback void rule looks: 40 M15 candles = 10 hours. */
export const EMA_VOID_LOOKBACK = 40;

type Info = Record<string, number | number[]>;

function finish(
  sys: SystemId,
  dir: Dir,
  i: number,
  candidate: boolean,
  pass: Record<string, boolean>,
  entry: number,
  stop: number,
  marks: Marks,
  info: Info,
): Evaluation {
  const failed = Object.keys(pass).filter((k) => !pass[k]);
  const risk = Math.abs(entry - stop);
  return {
    sys,
    dir,
    i,
    candidate,
    pass,
    failed,
    valid: candidate && failed.length === 0,
    entry,
    stop,
    target: entry + dir * 2 * risk,
    marks,
    info,
  };
}

function stopFits(s: Series, i: number, entry: number, stop: number, dir: Dir): boolean {
  const dist = dir * (entry - stop);
  return dist >= 0.5 * s.atr[i] && dist <= 3 * s.atr[i];
}

function ready(s: Series, i: number): boolean {
  return i >= 210 && i < s.c.length && !Number.isNaN(s.ema200[i]) && !Number.isNaN(s.atr[i]) && !Number.isNaN(s.rsi[i]);
}

const inHours = (s: Series, i: number) => {
  const hr = utcHour(s.t[i]);
  return hr >= 7 && hr < 20;
};

// ---------------------------------------------------------------- EMA Pullback

export function evalEma(s: Series, i: number, dir: Dir): Evaluation {
  const d = dir;
  const a = s.atr[i];
  const pass: Record<string, boolean> = {};
  const info: Info = {};

  pass.trend = d * (s.ema20[i] - s.ema50[i]) > 0 && d * (s.ema20[i] - s.ema20[i - 5]) > 0 && d * (s.ema50[i] - s.ema50[i - 5]) > 0;

  // furthest close from EMA20 (in ATR, in the trade's direction) over the 10 candles before
  let far = -Infinity;
  let farAt = i - 1;
  for (let j = i - 10; j < i; j++) {
    const x = (d * (s.c[j] - s.ema20[j])) / s.atr[j];
    if (x > far) {
      far = x;
      farAt = j;
    }
  }
  pass.pullback = far >= 1;
  info.far = far;
  info.farAt = farAt;

  const touch = d === 1 ? s.l[i] <= s.ema20[i] + 0.2 * a : s.h[i] >= s.ema20[i] - 0.2 * a;
  const closeBack = d * (s.c[i] - s.o[i]) > 0 && d * (s.c[i] - s.ema20[i]) > 0 && d * (s.rsi[i] - 50) > 0;
  pass.trigger = touch && closeBack;

  const against: number[] = [];
  for (let j = i - EMA_VOID_LOOKBACK + 1; j <= i; j++) if (d * (s.c[j] - s.ema50[j]) < 0) against.push(j);
  pass.void = against.length === 0;
  info.against = against;

  const div = recentDivergenceAt(s, i, -d as Dir, 15);
  pass.opposite = div === null;
  if (div) {
    info.divA = div.j1;
    info.divB = div.j2;
  }
  pass.htf = d * (s.c[i] - s.ema200[i]) > 0;
  pass.hours = inHours(s, i);

  let ext = d === 1 ? Infinity : -Infinity;
  let extI = i;
  for (let j = i - 5; j <= i; j++) {
    const v = d === 1 ? s.l[j] : s.h[j];
    if (d * (ext - v) > 0) {
      ext = v;
      extI = j;
    }
  }
  const entry = s.c[i];
  const stop = ext - d * 0.1 * a;
  pass.stop = stopFits(s, i, entry, stop, d);
  info.extAt = extI;

  return finish('ema', d, i, pass.trigger, pass, entry, stop, { points: [{ i: extI, label: 'Pullback', above: d === -1 }] }, info);
}

// ---------------------------------------------------------------- S/R Retest

interface Swing {
  j: number;
  p: number;
}

function swingsIn(s: Series, from: number, to: number): Swing[] {
  const out: Swing[] = [];
  for (let j = Math.max(0, from); j <= to; j++) {
    if (s.ph5[j]) out.push({ j, p: s.h[j] });
    if (s.pl5[j]) out.push({ j, p: s.l[j] });
  }
  return out;
}

const touchesNear = (sw: Swing[], p: number, tol: number) => sw.filter((x) => Math.abs(x.p - p) <= tol);

export function evalSr(s: Series, i: number, dir: Dir): Evaluation {
  const d = dir;
  const a = s.atr[i];
  const pass: Record<string, boolean> = {};
  const info: Info = {};
  const sw = swingsIn(s, i - 300, i - 5);
  const tol = 0.3 * a;
  const green = d * (s.c[i] - s.o[i]) > 0;

  // The level this candle is testing: the one it touched and closed away from, with the most touches.
  let L = NaN;
  let best = -1;
  let bestJ = -1;
  for (const x of sw) {
    const touchSide = d === 1 ? s.l[i] - x.p : x.p - s.h[i]; // how far the wick stayed off the level
    const touched = touchSide <= 0.2 * a && touchSide >= -0.5 * a;
    const closedAway = d * (s.c[i] - x.p) > 0;
    if (!touched || !closedAway) continue;
    const n = touchesNear(sw, x.p, tol).length;
    if (n > best || (n === best && x.j > bestJ)) {
      best = n;
      bestJ = x.j;
      L = x.p;
    }
  }

  const entry = s.c[i];
  if (Number.isNaN(L)) {
    pass.level = false;
    pass.break = false;
    pass.trigger = false;
    pass.void = true;
    pass.room = true;
    pass.hours = inHours(s, i);
    pass.stop = false;
    return finish('sr', d, i, false, pass, entry, entry - d * a, {}, info);
  }

  pass.level = best >= 2;
  pass.trigger = green;
  info.level = L;
  info.touches = touchesNear(sw, L, tol).map((x) => x.j);

  // Most recent close that crossed the level by 0.3 ATR, coming from the other side.
  let b = -1;
  for (let j = i - 3; j >= i - 30; j--) {
    const beyond = d * (s.c[j] - L) >= 0.3 * s.atr[j];
    const prevNot = d * (s.c[j - 1] - L) < 0.3 * s.atr[j - 1];
    if (!beyond || !prevNot) continue;
    let fromOther = false;
    for (let m = j - 20; m < j; m++) if (d * (s.c[m] - L) < 0) fromOther = true;
    if (fromOther) {
      b = j;
      break;
    }
  }
  pass.break = b >= 0;
  if (b >= 0) info.breakAt = b;

  const back: number[] = [];
  if (b >= 0) for (let j = b + 1; j < i; j++) if (d * (s.c[j] - L) < -0.3 * s.atr[j]) back.push(j);
  pass.void = back.length === 0;
  info.back = back;

  const stop = d === 1 ? Math.min(L - 0.3 * a, s.l[i] - 0.1 * a) : Math.max(L + 0.3 * a, s.h[i] + 0.1 * a);
  const target = entry + d * 2 * Math.abs(entry - stop);
  let wall = NaN;
  for (const x of sw) {
    if (Math.abs(x.p - L) <= tol) continue;
    const between = d * (x.p - entry) > 0.2 * a && d * (target - x.p) > 0;
    if (between && touchesNear(sw, x.p, tol).length >= 2) wall = x.p;
  }
  pass.room = Number.isNaN(wall);
  if (!pass.room) info.wall = wall;

  pass.hours = inHours(s, i);
  pass.stop = stopFits(s, i, entry, stop, d);

  const points: Marks['points'] = touchesNear(sw, L, tol).map((x) => ({ i: x.j, label: 'Touch', above: s.h[x.j] === x.p }));
  if (b >= 0) points.push({ i: b, label: 'Break', above: d === 1 });
  return finish('sr', d, i, true, pass, entry, stop, { level: L, points }, info);
}

// ---------------------------------------------------------------- RSI Divergence

interface Div {
  j1: number;
  j2: number;
  r1: number;
  r2: number;
}

const rsiExtreme = (s: Series, j: number, d: Dir) => {
  let v = d === 1 ? Infinity : -Infinity;
  for (let m = j - 2; m <= j + 2; m++) if (m >= 0 && m < s.rsi.length && d * (v - s.rsi[m]) > 0) v = s.rsi[m];
  return v;
};

/**
 * Divergence ending at swing j2 (bullish when d = 1). Looks back for the most
 * recent earlier swing that price has since exceeded.
 */
function divergenceAt(s: Series, j2: number, d: Dir): { div: Div | null; found: Div | null } {
  const piv = d === 1 ? s.pl2 : s.ph2;
  const px = d === 1 ? s.l : s.h;
  for (let j1 = j2 - 5; j1 >= Math.max(0, j2 - 40); j1--) {
    if (!piv[j1]) continue;
    if (d * (px[j1] - px[j2]) <= 0) continue; // need lower low (higher high to sell)
    const r1 = rsiExtreme(s, j1, d);
    const r2 = rsiExtreme(s, j2, d);
    const found = { j1, j2, r1, r2 };
    return { div: d * (r2 - r1) >= 3 ? found : null, found };
  }
  return { div: null, found: null };
}

/** A divergence (with an oversold/overbought first swing) completed in the last `look` candles. */
function recentDivergenceAt(s: Series, i: number, d: Dir, look: number): Div | null {
  const piv = d === 1 ? s.pl2 : s.ph2;
  for (let j2 = i - 2; j2 >= i - look; j2--) {
    if (!piv[j2]) continue;
    const { div } = divergenceAt(s, j2, d);
    if (div && (d === 1 ? div.r1 < 35 : div.r1 > 65)) return div;
  }
  return null;
}

export function recentDivergence(s: Series, i: number, d: Dir, look: number): boolean {
  return recentDivergenceAt(s, i, d, look) !== null;
}

export function evalRsi(s: Series, i: number, dir: Dir): Evaluation {
  const d = dir;
  const a = s.atr[i];
  const pass: Record<string, boolean> = {};
  const info: Info = {};
  const piv = d === 1 ? s.pl2 : s.ph2;
  const px = d === 1 ? s.l : s.h;
  const opp = d === 1 ? s.h : s.l;

  let j2 = -1;
  for (let j = i - 2; j >= i - 6; j--)
    if (piv[j]) {
      j2 = j;
      break;
    }
  const entry = s.c[i];
  if (j2 < 0) {
    pass.diverge = false;
    pass.extreme = false;
    pass.trigger = false;
    pass.void = true;
    pass.steam = true;
    pass.hours = inHours(s, i);
    pass.stop = false;
    return finish('rsi', d, i, false, pass, entry, entry - d * a, {}, info);
  }
  info.j2 = j2;

  let earlier = -1;
  for (let m = j2 + 1; m < i; m++) if (d * (s.c[m] - opp[j2]) > 0 && earlier < 0) earlier = m;
  pass.trigger = d * (s.c[i] - opp[j2]) > 0 && d * (s.c[i] - s.o[i]) > 0 && earlier < 0;
  if (earlier >= 0) info.earlier = earlier;

  const { div, found } = divergenceAt(s, j2, d);
  pass.diverge = div !== null;
  pass.extreme = found !== null && (d === 1 ? found.r1 < 35 : found.r1 > 65);
  if (found) {
    info.j1 = found.j1;
    info.r1 = found.r1;
    info.r2 = found.r2;
  }

  let newExtreme = -1;
  for (let m = j2 + 1; m <= i; m++) if (d * (px[m] - px[j2]) < 0 && newExtreme < 0) newExtreme = m;
  pass.void = newExtreme < 0;
  if (newExtreme >= 0) info.newExtreme = newExtreme;
  info.slope = Math.abs(s.ema20[i] - s.ema20[i - 10]) / a;
  pass.steam = (info.slope as number) < 1.5;
  pass.hours = inHours(s, i);

  const stop = px[j2] - d * 0.2 * a;
  pass.stop = stopFits(s, i, entry, stop, d);

  const marks: Marks = { points: [{ i: j2, label: 'Swing 2', above: d === -1 }] };
  if (found) {
    marks.points!.push({ i: found.j1, label: 'Swing 1', above: d === -1 });
    marks.priceLine = [found.j1, j2];
    marks.rsiLine = [found.j1, j2];
  }
  return finish('rsi', d, i, pass.trigger, pass, entry, stop, marks, info);
}

// ---------------------------------------------------------------- Session Breakout

/** High/low of 00:00–07:00 UTC for the day containing bar i (searching back only). */
function asianRange(s: Series, i: number, dayStart: number): { hi: number; lo: number; n: number; from: number; to: number } | null {
  let hi = -Infinity;
  let lo = Infinity;
  let n = 0;
  let from = -1;
  let to = -1;
  for (let j = i; j >= 0 && s.t[j] >= dayStart; j--) {
    if (s.t[j] < dayStart + 7 * H) {
      hi = Math.max(hi, s.h[j]);
      lo = Math.min(lo, s.l[j]);
      n++;
      if (to < 0) to = j;
      from = j;
    }
  }
  return n >= 16 ? { hi, lo, n, from, to } : null;
}

export function evalSession(s: Series, i: number, dir: Dir): Evaluation {
  const d = dir;
  const a = s.atr[i];
  const pass: Record<string, boolean> = {};
  const info: Info = {};
  const t = s.t[i];
  const dayStart = Math.floor(t / DAY) * DAY;
  const hr = (t - dayStart) / H;
  const entry = s.c[i];
  const range = hr >= 7 ? asianRange(s, i, dayStart) : null;

  if (!range || hr >= 13) {
    pass.tight = false;
    pass.window = false;
    pass.trigger = false;
    pass.first = true;
    pass.body = true;
    pass.htf = true;
    pass.stop = false;
    return finish('session', d, i, false, pass, entry, entry - d * a, {}, info);
  }

  const edge = d === 1 ? range.hi : range.lo;
  pass.trigger = d * (s.c[i] - edge) >= 0.1 * a;
  pass.window = hr < 10;

  // Average of the previous 10 Asian ranges.
  let sum = 0;
  let days = 0;
  let j = range.from - 1;
  while (days < 10 && j > 0) {
    const ds = Math.floor(s.t[j] / DAY) * DAY;
    const r = asianRange(s, j, ds);
    if (r) {
      sum += r.hi - r.lo;
      days++;
      j = r.from - 1;
    } else {
      // skip back to the previous day
      while (j > 0 && s.t[j] >= ds) j--;
    }
  }
  const height = range.hi - range.lo;
  const avg = days >= 5 ? sum / days : NaN;
  pass.tight = !Number.isNaN(avg) && height >= 0.5 * avg && height <= 1.3 * avg;
  info.height = height;
  if (!Number.isNaN(avg)) info.avg = avg;

  let earlier = -1;
  for (let m = range.to + 1; m < i; m++) {
    if ((s.c[m] - range.hi >= 0.1 * s.atr[m] || range.lo - s.c[m] >= 0.1 * s.atr[m]) && earlier < 0) earlier = m;
  }
  pass.first = earlier < 0;
  if (earlier >= 0) info.earlier = earlier;

  const span = s.h[i] - s.l[i];
  info.body = span > 0 ? Math.abs(s.c[i] - s.o[i]) / span : 0;
  pass.body = span > 0 && d * (s.c[i] - s.o[i]) >= 0.5 * span;
  pass.htf = d * (s.c[i] - s.ema200[i]) > 0;

  const stop = (range.hi + range.lo) / 2;
  pass.stop = stopFits(s, i, entry, stop, d);

  return finish(
    'session',
    d,
    i,
    pass.trigger,
    pass,
    entry,
    stop,
    { rangeHigh: range.hi, rangeLow: range.lo, rangeFrom: range.from, rangeTo: range.to },
    info,
  );
}

// ----------------------------------------------------------------

const EVAL: Record<SystemId, (s: Series, i: number, d: Dir) => Evaluation> = {
  ema: evalEma,
  sr: evalSr,
  rsi: evalRsi,
  session: evalSession,
};

export function evaluate(s: Series, i: number, sys: SystemId, dir: Dir): Evaluation | null {
  if (!ready(s, i)) return null;
  return EVAL[sys](s, i, dir);
}

/** Both directions; prefers a valid one, then a candidate with the fewest failures. */
export function evaluateBest(s: Series, i: number, sys: SystemId): Evaluation | null {
  const a = evaluate(s, i, sys, 1);
  const b = evaluate(s, i, sys, -1);
  if (!a || !b) return a ?? b;
  return rank(a) <= rank(b) ? a : b;
}

export function rank(e: Evaluation): number {
  if (e.valid) return 0;
  if (e.candidate) return 1 + e.failed.length;
  return 100;
}

export function rulesOrder(sys: SystemId): string[] {
  return SYSTEMS[sys].rules.filter((r) => r.kind === 'chart').map((r) => r.id);
}
