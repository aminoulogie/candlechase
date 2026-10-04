import type { Bars, Dir, Outcome } from './types';

/** Two trading days of M15. */
export const MAX_HOLD = 192;

/**
 * Enter at the close of bar i and walk forward. If a candle touches both the
 * stop and the target we count the stop: candles do not say which came first.
 */
export function simulate(b: Bars, i: number, dir: Dir, entry: number, stop: number, target: number, spread: number): Outcome {
  const risk = Math.abs(entry - stop);
  const spreadR = risk > 0 ? spread / risk : 0;
  const last = Math.min(b.c.length - 1, i + MAX_HOLD);
  for (let j = i + 1; j <= last; j++) {
    const hitStop = dir === 1 ? b.l[j] <= stop : b.h[j] >= stop;
    const hitTarget = dir === 1 ? b.h[j] >= target : b.l[j] <= target;
    if (hitStop) return { result: 'loss', exitIndex: j, exitPrice: stop, r: -1, rNet: -1 - spreadR };
    if (hitTarget) {
      const r = Math.abs(target - entry) / risk;
      return { result: 'win', exitIndex: j, exitPrice: target, r, rNet: r - spreadR };
    }
  }
  const exitPrice = b.c[last];
  const r = risk > 0 ? (dir * (exitPrice - entry)) / risk : 0;
  return { result: 'open', exitIndex: last, exitPrice, r, rNet: r - spreadR };
}
