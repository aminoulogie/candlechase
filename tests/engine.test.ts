import { describe, expect, it } from 'vitest';
import { concatBars, decodeChunk, encodeChunk } from '../src/engine/codec';
import { evaluate } from '../src/engine/evaluate';
import { buildSeries, ema, rsi, WARMUP, windowSeries } from '../src/engine/indicators';
import { simulate } from '../src/engine/outcome';
import { SYSTEM_ORDER } from '../src/engine/types';
import type { Bars, Dir } from '../src/engine/types';

function walk(n: number, seed = 1): Bars {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const b: Bars = { t: [], o: [], h: [], l: [], c: [] };
  let p = 1.1;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.round((p + (rnd() - 0.495) * 0.001) * 1e5) / 1e5;
    b.t.push(1633046400 + i * 900);
    b.o.push(o);
    b.c.push(p);
    b.h.push(Math.round((Math.max(o, p) + rnd() * 0.0004) * 1e5) / 1e5);
    b.l.push(Math.round((Math.min(o, p) - rnd() * 0.0004) * 1e5) / 1e5);
  }
  return b;
}

describe('indicators', () => {
  it('ema of a constant is the constant', () => {
    expect(ema(Array(60).fill(2), 20).at(-1)).toBeCloseTo(2);
  });
  it('rsi is 100 on a straight rise and 0 on a straight fall', () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => i)).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => -i)).at(-1)).toBeCloseTo(0);
  });
});

describe('codec', () => {
  it('round-trips candles exactly', () => {
    const b = walk(500);
    const back = concatBars([decodeChunk(encodeChunk(b, 0, 250, 5), 5), decodeChunk(encodeChunk(b, 250, 500, 5), 5)]);
    expect(back.t).toEqual(b.t);
    for (const k of ['o', 'h', 'l', 'c'] as const) back[k].forEach((v, i) => expect(v).toBeCloseTo(b[k][i], 9));
  });
});

describe('the app judges a candle the same way the build did', () => {
  it('windowed evaluation matches full-history evaluation', () => {
    const b = walk(WARMUP + 3000, 7);
    const full = buildSeries(b);
    let compared = 0;
    for (let i = WARMUP + 50; i < WARMUP + 2700; i += 7) {
      const w = windowSeries(b, i);
      for (const sys of SYSTEM_ORDER)
        for (const d of [1, -1] as Dir[]) {
          const a = evaluate(full, i, sys, d);
          const c = evaluate(w.s, i - w.offset, sys, d);
          expect(c?.valid).toBe(a?.valid);
          expect(c?.failed).toEqual(a?.failed);
          compared++;
        }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});

describe('simulate', () => {
  const b: Bars = { t: [0, 1, 2, 3], o: [1, 1, 1, 1], h: [1, 1.01, 1.03, 1], l: [1, 0.995, 0.99, 1], c: [1, 1, 1, 1] };
  it('counts the stop first when a candle touches both', () => {
    expect(simulate(b, 0, 1, 1, 0.99, 1.02, 0).result).toBe('loss');
  });
  it('wins when the target is hit first', () => {
    const o = simulate(b, 0, 1, 1, 0.98, 1.01, 0.001);
    expect(o.result).toBe('win');
    expect(o.r).toBeCloseTo(0.5);
    expect(o.rNet).toBeCloseTo(0.45);
  });
});
