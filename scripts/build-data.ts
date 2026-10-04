// Turns raw candles into what the app loads:
//   chunks of candles, the drill list, and the backtest of each system.
// Usage: tsx scripts/build-data.ts [rawDir] [outDir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CHUNK, encodeChunk } from '../src/engine/codec';
import type { BacktestFile, BacktestRow, Drill, DrillFile, Manifest } from '../src/engine/codec';
import { evaluate } from '../src/engine/evaluate';
import { buildSeries, LOOKAHEAD, WARMUP, windowSeries } from '../src/engine/indicators';
import { MAX_HOLD, simulate } from '../src/engine/outcome';
import { SYSTEMS } from '../src/engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../src/engine/types';
import type { Bars, Dir, Evaluation, SystemId } from '../src/engine/types';

const RAW = process.argv[2] ?? 'data/raw';
const OUT = process.argv[3] ?? 'public/data';
const PER_SYSTEM_VALID = 400;
const PER_SYSTEM_NEAR = 400;
const PER_INSTRUMENT_NOTHING = 300;

let seed = 20211001;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a.slice(0, n);
}

/** Near misses spread evenly across which rule failed, so every rule gets taught. */
function sampleByRule(arr: { e: Evaluation }[], n: number) {
  const groups = new Map<string, { e: Evaluation }[]>();
  for (const x of arr) {
    const k = x.e.failed[0];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(x);
  }
  const shuffled = [...groups.values()].map((g) => sample(g, g.length));
  const out: { e: Evaluation }[] = [];
  for (let round = 0; out.length < n; round++) {
    let added = false;
    for (const g of shuffled) if (round < g.length && out.length < n) {
      out.push(g[round]);
      added = true;
    }
    if (!added) break;
  }
  return out;
}

const sameAnswer = (a: Evaluation | null, b: Evaluation) =>
  !!a && a.candidate === b.candidate && a.valid === b.valid && a.failed.join() === b.failed.join();

function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const manifest: Manifest = { generated: new Date().toISOString(), timeframe: 'm15', chunk: CHUNK, instruments: {} };
  const drills: Drill[] = [];
  const rows: BacktestRow[] = [];
  let firstT = Infinity;
  let lastT = 0;

  for (const id of INSTRUMENT_ORDER) {
    const file = `${RAW}/${id}.json`;
    if (!existsSync(file)) {
      console.warn(`skip ${id}: ${file} missing`);
      continue;
    }
    const meta = INSTRUMENTS[id];
    const bars: Bars = JSON.parse(readFileSync(file, 'utf8'));
    const n = bars.t.length;
    firstT = Math.min(firstT, bars.t[0]);
    lastT = Math.max(lastT, bars.t[n - 1]);

    mkdirSync(`${OUT}/${id}`, { recursive: true });
    const chunks = Math.ceil(n / CHUNK);
    for (let k = 0; k < chunks; k++) {
      writeFileSync(`${OUT}/${id}/${k}.json`, JSON.stringify(encodeChunk(bars, k * CHUNK, Math.min(n, (k + 1) * CHUNK), meta.digits)));
    }
    manifest.instruments[id] = { n, chunks, digits: meta.digits, first: bars.t[0], last: bars.t[n - 1] };

    const t0 = Date.now();
    const s = buildSeries(bars);
    const valid: Record<SystemId, Evaluation[]> = { ema: [], sr: [], rsi: [], session: [] };
    const near: Record<SystemId, { e: Evaluation }[]> = { ema: [], sr: [], rsi: [], session: [] };
    const nothing: number[] = [];
    const validAt = new Map<number, SystemId[]>();

    for (let i = WARMUP; i < n - Math.max(MAX_HOLD, LOOKAHEAD) - 1; i++) {
      let anyTrigger = false;
      for (const sys of SYSTEM_ORDER) {
        for (const dir of [1, -1] as Dir[]) {
          const e = evaluate(s, i, sys, dir);
          if (!e || !e.candidate) continue;
          if (e.pass[SYSTEMS[sys].triggerRule]) anyTrigger = true;
          if (e.valid) {
            valid[sys].push(e);
            validAt.set(i, [...(validAt.get(i) ?? []), sys]);
          } else if (e.pass[SYSTEMS[sys].triggerRule] && e.failed.length === 1) {
            near[sys].push({ e });
          }
        }
      }
      if (!anyTrigger) nothing.push(i);
    }
    console.log(
      `${id}: ${n} candles scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s — valid ${SYSTEM_ORDER.map((x) => `${x} ${valid[x].length}`).join(', ')}`,
    );

    // Backtest: every valid signal, one trade at a time per system.
    for (const sys of SYSTEM_ORDER) {
      let busyUntil = -1;
      let wins = 0;
      let losses = 0;
      let open = 0;
      let gross = 0;
      let grossLoss = 0;
      let total = 0;
      let streak = 0;
      let maxStreak = 0;
      const curve: number[] = [];
      const byYear: BacktestRow['byYear'] = {};
      const rs: number[] = [];
      for (const e of valid[sys]) {
        if (e.i <= busyUntil) continue;
        const o = simulate(bars, e.i, e.dir, e.entry, e.stop, e.target, meta.spread);
        busyUntil = o.exitIndex;
        rs.push(o.rNet);
        total += o.rNet;
        if (o.rNet > 0) gross += o.rNet;
        else grossLoss -= o.rNet;
        if (o.result === 'win') wins++;
        else if (o.result === 'loss') losses++;
        else open++;
        streak = o.rNet < 0 ? streak + 1 : 0;
        maxStreak = Math.max(maxStreak, streak);
        const y = new Date(bars.t[e.i] * 1000).getUTCFullYear().toString();
        byYear[y] ??= { trades: 0, totalR: 0 };
        byYear[y].trades++;
        byYear[y].totalR = Math.round((byYear[y].totalR + o.rNet) * 100) / 100;
        curve.push(total);
      }
      const step = Math.max(1, Math.ceil(curve.length / 60));
      const trades = rs.length;
      rows.push({
        sys,
        x: id,
        trades,
        wins,
        losses,
        open,
        winRate: trades ? wins / trades : 0,
        avgR: trades ? total / trades : 0,
        totalR: total,
        profitFactor: grossLoss > 0 ? gross / grossLoss : gross > 0 ? 99 : 0,
        maxLosingStreak: maxStreak,
        curve: curve.filter((_, k) => k % step === 0 || k === curve.length - 1).map((v) => Math.round(v * 10) / 10),
        byYear,
      });
    }

    // Drills, double-checked against the same windowed calculation the app runs.
    let dropped = 0;
    const check = (e: Evaluation) => {
      const w = windowSeries(bars, e.i);
      const ok = sameAnswer(evaluate(w.s, e.i - w.offset, e.sys, e.dir), e);
      if (!ok) dropped++;
      return ok;
    };
    for (const sys of SYSTEM_ORDER) {
      for (const e of sample(valid[sys], PER_SYSTEM_VALID * 2).filter(check).slice(0, PER_SYSTEM_VALID)) {
        const o = simulate(bars, e.i, e.dir, e.entry, e.stop, e.target, meta.spread);
        const also = (validAt.get(e.i) ?? []).filter((x) => x !== sys);
        drills.push({ id: `${id}:${e.i}:${sys}`, x: id, i: e.i, k: 'v', s: sys, d: e.dir, r: Math.round(o.rNet * 100) / 100, ...(also.length ? { a: [...new Set(also)] } : {}) });
      }
      const nearClean = near[sys].filter((x) => !validAt.has(x.e.i));
      for (const { e } of sampleByRule(nearClean, PER_SYSTEM_NEAR * 2).filter((x) => check(x.e)).slice(0, PER_SYSTEM_NEAR)) {
        const o = simulate(bars, e.i, e.dir, e.entry, e.stop, e.target, meta.spread);
        drills.push({ id: `${id}:${e.i}:${sys}:n`, x: id, i: e.i, k: 'n', s: sys, d: e.dir, f: e.failed[0], r: Math.round(o.rNet * 100) / 100 });
      }
    }
    for (const i of sample(nothing, PER_INSTRUMENT_NOTHING)) {
      drills.push({ id: `${id}:${i}:z`, x: id, i, k: 'z', s: '', d: 0 });
    }
    if (dropped) console.log(`${id}: dropped ${dropped} drills that did not match the windowed check`);
  }

  const drillFile: DrillFile = { generated: manifest.generated, drills };
  const bt: BacktestFile = {
    generated: manifest.generated,
    from: new Date(firstT * 1000).toISOString().slice(0, 10),
    to: new Date(lastT * 1000).toISOString().slice(0, 10),
    rows,
  };
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest));
  writeFileSync(`${OUT}/drills.json`, JSON.stringify(drillFile));
  writeFileSync(`${OUT}/backtest.json`, JSON.stringify(bt));

  const count = (k: string) => drills.filter((d) => d.k === k).length;
  console.log(`drills: ${drills.length} (valid ${count('v')}, near miss ${count('n')}, nothing ${count('z')})`);
  for (const r of rows) {
    console.log(
      `${r.x.padEnd(7)} ${r.sys.padEnd(8)} trades ${String(r.trades).padStart(4)}  win ${(r.winRate * 100).toFixed(0).padStart(3)}%  avg ${r.avgR.toFixed(2).padStart(6)}R  total ${r.totalR.toFixed(1).padStart(7)}R  PF ${r.profitFactor.toFixed(2)}  worst streak ${r.maxLosingStreak}`,
    );
  }
}

main();
