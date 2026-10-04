// FOR LOCAL TESTING ONLY. Writes made-up candles so the pipeline can be run
// without network access. Never publish its output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../src/engine/types';
import type { Bars } from '../src/engine/types';

const dir = process.argv[2] ?? 'data/raw-synthetic';
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const start: Record<string, number> = { eurusd: 1.16, xauusd: 1750, nas100: 15000 };
mkdirSync(dir, { recursive: true });
for (const id of INSTRUMENT_ORDER) {
  const b: Bars = { t: [], o: [], h: [], l: [], c: [] };
  let p = start[id];
  let drift = 0;
  const vol = 0.0009;
  for (let t = Date.UTC(2021, 9, 1) / 1000; t < Date.UTC(2026, 9, 1) / 1000; t += 900) {
    const d = new Date(t * 1000);
    const wd = d.getUTCDay();
    if (wd === 6 || (wd === 0 && d.getUTCHours() < 22) || (wd === 5 && d.getUTCHours() >= 21)) continue;
    if (rnd() < 0.004) drift = (rnd() - 0.5) * 0.0006;
    const hr = d.getUTCHours();
    const season = hr < 7 ? 0.45 : hr < 12 ? 1.4 : hr < 17 ? 1.2 : 0.7;
    const o = p;
    const steps = 6;
    let hi = o;
    let lo = o;
    for (let k = 0; k < steps; k++) {
      p *= 1 + drift / steps + (gauss() * vol * season) / Math.sqrt(steps);
      hi = Math.max(hi, p);
      lo = Math.min(lo, p);
    }
    const m = 10 ** INSTRUMENTS[id].digits;
    const r = (v: number) => Math.round(v * m) / m;
    b.t.push(t);
    b.o.push(r(o));
    b.h.push(r(hi));
    b.l.push(r(lo));
    b.c.push(r(p));
  }
  writeFileSync(`${dir}/${id}.json`, JSON.stringify(b));
  console.log(id, b.t.length);
}
