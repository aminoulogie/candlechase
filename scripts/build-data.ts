// Turns raw candles into what the app loads:
//   chunks of candles, the drill list, and the 5-year statistics of each system.
// Usage: tsx scripts/build-data.ts [rawDir] [outDir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { coreRules, gapGuard, scan, SPLIT_T, stats, trade } from '../src/engine/backtest';
import type { Candidate, Trade } from '../src/engine/backtest';
import { CHUNK, encodeChunk } from '../src/engine/codec';
import type { BacktestFile, BacktestRow, Drill, DrillFile, Leader, Manifest, TradeFile } from '../src/engine/codec';
import { evaluate } from '../src/engine/evaluate';
import { buildSeries, windowSeries } from '../src/engine/indicators';
import { simulate } from '../src/engine/outcome';
import { SYSTEMS } from '../src/engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../src/engine/types';
import type { Bars, Evaluation, SystemId } from '../src/engine/types';

const RAW = process.argv[2] ?? 'data/raw';
const OUT = process.argv[3] ?? 'public/data';
const PER_SYSTEM_VALID = 300;
const PER_SYSTEM_NEAR = 300;
const PER_INSTRUMENT_NOTHING = 300;
const TARGETS = [1, 1.5, 2, 3];

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
function sampleByRule(arr: Candidate[], n: number): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const x of arr) {
    const k = x.failed[0];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(x);
  }
  const shuffled = [...groups.values()].map((g) => sample(g, g.length));
  const out: Candidate[] = [];
  for (let round = 0; out.length < n; round++) {
    let added = false;
    for (const g of shuffled)
      if (round < g.length && out.length < n) {
        out.push(g[round]);
        added = true;
      }
    if (!added) break;
  }
  return out;
}

const sameAnswer = (a: Evaluation | null, failed: string[]) => !!a && a.candidate && a.failed.join() === failed.join();

function row(sys: SystemId, x: string, perTarget: Record<string, Trade[]>, seen: number): BacktestRow {
  const tr = perTarget['2'];
  const main = stats(tr, 2);
  let total = 0;
  const curve = tr.map((t) => (total += t.r));
  const step = Math.max(1, Math.ceil(curve.length / 60));
  const byYear: BacktestRow['main']['byYear'] = {};
  for (const t of tr) {
    const y = new Date(t.t * 1000).getUTCFullYear().toString();
    byYear[y] ??= { trades: 0, wins: 0, totalR: 0 };
    byYear[y].trades++;
    if (t.result === 'win') byYear[y].wins++;
    byYear[y].totalR = Math.round((byYear[y].totalR + t.r) * 100) / 100;
  }
  const byTarget: BacktestRow['byTarget'] = {};
  for (const r of TARGETS) byTarget[String(r)] = stats(perTarget[String(r)], r);
  return {
    sys,
    x,
    seen,
    main: {
      ...main,
      curve: curve.filter((_, k) => k % step === 0 || k === curve.length - 1).map((v) => Math.round(v * 10) / 10),
      byYear,
      long: stats(
        tr.filter((t) => t.dir === 1),
        2,
      ),
      short: stats(
        tr.filter((t) => t.dir === -1),
        2,
      ),
    },
    byTarget,
    early: stats(
      tr.filter((t) => t.t < SPLIT_T),
      2,
    ),
    recent: stats(
      tr.filter((t) => t.t >= SPLIT_T),
      2,
    ),
  };
}

function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const manifest: Manifest = { generated: new Date().toISOString(), timeframe: 'm15', chunk: CHUNK, instruments: {} };
  const drills: Drill[] = [];
  const rows: BacktestRow[] = [];
  // pooled across markets, per system and target
  const pooled: Record<string, Record<string, Trade[]>> = {};
  const pooledSeen: Record<string, number> = {};
  let firstT = Infinity;
  let lastT = 0;
  // per-trade lists for the money simulator, and the search over variants
  const tradeLists: Record<string, { seen: number[]; byTarget: Record<string, Trade[]> }> = {};
  const combos: Leader[] = [];

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
    const clean = gapGuard(bars);
    const cands: Record<string, Candidate[]> = {};
    const validAt = new Map<number, Set<SystemId>>();
    for (const sys of SYSTEM_ORDER) {
      cands[sys] = scan(bars, s, sys, clean);
      for (const c of cands[sys]) if (!c.failed.length) validAt.set(c.i, (validAt.get(c.i) ?? new Set()).add(sys));
    }
    const anyCandidate = new Set<number>();
    for (const sys of SYSTEM_ORDER) for (const c of cands[sys]) anyCandidate.add(c.i);
    console.log(
      `${id}: ${n} candles scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s — valid ${SYSTEM_ORDER.map((x) => `${x} ${cands[x].filter((c) => !c.failed.length).length}`).join(', ')}`,
    );

    // Statistics
    for (const sys of SYSTEM_ORDER) {
      const perTarget: Record<string, Trade[]> = {};
      let seen = 0;
      for (const r of TARGETS) {
        const res = trade(bars, cands[sys], { targetR: r, spread: meta.spread });
        perTarget[String(r)] = res.trades;
        seen = res.seen;
      }
      tradeLists[`${sys}:${id}`] = { seen: cands[sys].filter((c) => !c.failed.length).map((c) => bars.t[c.i]), byTarget: perTarget };

      // Search: each target, with nothing or one non-core rule switched off.
      const core = new Set(coreRules(sys));
      const offs: (string | null)[] = [null, ...SYSTEMS[sys].rules.filter((r) => r.kind === 'chart' && !core.has(r.id)).map((r) => r.id)];
      for (const off of offs)
        for (const r of TARGETS) {
          const tr = off === null ? perTarget[String(r)] : trade(bars, cands[sys], { targetR: r, spread: meta.spread, disabled: new Set([off]) }).trades;
          combos.push({
            sys,
            x: id,
            target: r,
            off,
            early: stats(
              tr.filter((t) => t.t < SPLIT_T),
              r,
            ),
            recent: stats(
              tr.filter((t) => t.t >= SPLIT_T),
              r,
            ),
            all: stats(tr, r),
          });
        }
      rows.push(row(sys, id, perTarget, seen));
      pooled[sys] ??= {};
      for (const r of TARGETS) (pooled[sys][String(r)] ??= []).push(...perTarget[String(r)]);
      pooledSeen[sys] = (pooledSeen[sys] ?? 0) + seen;
    }

    // Drills, double-checked against the same windowed calculation the app runs.
    let dropped = 0;
    const check = (c: Candidate, sys: SystemId) => {
      const w = windowSeries(bars, c.i);
      const ok = sameAnswer(evaluate(w.s, c.i - w.offset, sys, c.dir), c.failed);
      if (!ok) dropped++;
      return ok;
    };
    for (const sys of SYSTEM_ORDER) {
      const trig = SYSTEMS[sys].triggerRule;
      const valid = cands[sys].filter((c) => !c.failed.length);
      for (const c of sample(valid, PER_SYSTEM_VALID * 2)
        .filter((c) => check(c, sys))
        .slice(0, PER_SYSTEM_VALID)) {
        const o = simulate(bars, c.i, c.dir, c.entry, c.stop, c.entry + c.dir * 2 * Math.abs(c.entry - c.stop), meta.spread);
        const also = [...(validAt.get(c.i) ?? [])].filter((x) => x !== sys);
        drills.push({ id: `${id}:${c.i}:${sys}`, x: id, i: c.i, k: 'v', s: sys, d: c.dir, r: Math.round(o.rNet * 100) / 100, ...(also.length ? { a: also } : {}) });
      }
      const near = cands[sys].filter((c) => c.failed.length === 1 && c.failed[0] !== trig && !validAt.has(c.i));
      for (const c of sampleByRule(near, PER_SYSTEM_NEAR * 2)
        .filter((c) => check(c, sys))
        .slice(0, PER_SYSTEM_NEAR)) {
        const o = simulate(bars, c.i, c.dir, c.entry, c.stop, c.entry + c.dir * 2 * Math.abs(c.entry - c.stop), meta.spread);
        drills.push({ id: `${id}:${c.i}:${sys}:n`, x: id, i: c.i, k: 'n', s: sys, d: c.dir, f: c.failed[0], r: Math.round(o.rNet * 100) / 100 });
      }
    }
    const nothing: number[] = [];
    for (let i = 0; i < n; i++) if (clean(i) && i >= 1300 && i < n - 210 && !anyCandidate.has(i)) nothing.push(i);
    for (const i of sample(nothing, PER_INSTRUMENT_NOTHING)) drills.push({ id: `${id}:${i}:z`, x: id, i, k: 'z', s: '', d: 0 });
    if (dropped) console.log(`${id}: dropped ${dropped} drills that did not match the windowed check`);
  }

  for (const sys of SYSTEM_ORDER) {
    if (!pooled[sys]) continue;
    for (const r of TARGETS) pooled[sys][String(r)].sort((a, b) => a.t - b.t);
    rows.push(row(sys, 'all', pooled[sys], pooledSeen[sys]));
  }

  const drillFile: DrillFile = { generated: manifest.generated, drills };
  // Leaders: positive before 2025 AND since, enough trades in each, least likely to be luck first.
  const leaders = combos
    .filter((c) => c.early.trades >= 40 && c.recent.trades >= 40 && c.early.avgR > 0 && c.recent.avgR > 0)
    .sort((a, b) => a.all.pValue - b.all.pValue)
    .slice(0, 10);
  const bt: BacktestFile = {
    generated: manifest.generated,
    from: new Date(firstT * 1000).toISOString().slice(0, 10),
    to: new Date(lastT * 1000).toISOString().slice(0, 10),
    split: new Date(SPLIT_T * 1000).toISOString().slice(0, 10),
    rows,
    searched: combos.length,
    significant: combos.filter((c) => c.all.trades >= 60 && c.all.avgR > 0 && c.all.pValue < 0.05).length,
    leaders,
  };
  const start = Math.floor(firstT / 3600) * 3600;
  const tf: TradeFile = { start, rows: {} };
  const deltas = (ts: number[]) => {
    let prev = 0;
    return ts.map((t) => {
      const h = Math.round((t - start) / 3600);
      const d = h - prev;
      prev = h;
      return d;
    });
  };
  for (const [k, v] of Object.entries(tradeLists)) {
    const byTarget: TradeFile['rows'][string]['byTarget'] = {};
    for (const [r, list] of Object.entries(v.byTarget)) byTarget[r] = { h: deltas(list.map((t) => t.t)), r: list.map((t) => Math.round(t.r * 100)), k: list.map((t) => t.result[0]).join('') };
    tf.rows[k] = { seen: deltas(v.seen), byTarget };
  }
  writeFileSync(`${OUT}/trades.json`, JSON.stringify(tf));
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest));
  writeFileSync(`${OUT}/drills.json`, JSON.stringify(drillFile));
  writeFileSync(`${OUT}/backtest.json`, JSON.stringify(bt));

  const count = (k: string) => drills.filter((d) => d.k === k).length;
  console.log(`drills: ${drills.length} (valid ${count('v')}, near miss ${count('n')}, nothing ${count('z')})`);
  console.log('\nAll markets, 2R target:');
  for (const r of rows.filter((x) => x.x === 'all').sort((a, b) => b.main.avgR - a.main.avgR)) {
    const m = r.main;
    console.log(
      `${SYSTEMS[r.sys as SystemId].name.padEnd(20)} seen ${String(r.seen).padStart(5)}  trades ${String(m.trades).padStart(4)}  win ${(m.winRate * 100).toFixed(0).padStart(2)}% [${(m.ciLo * 100).toFixed(0)}–${(m.ciHi * 100).toFixed(0)}] need ${(m.breakEven * 100).toFixed(0)}%  avg ${m.avgR >= 0 ? '+' : ''}${m.avgR.toFixed(3)}R  total ${m.totalR.toFixed(0).padStart(5)}R  p=${m.pValue.toFixed(3)}  early ${r.early.avgR.toFixed(2)} recent ${r.recent.avgR.toFixed(2)}  best target ${Object.entries(r.byTarget).sort((a, b) => b[1].avgR - a[1].avgR)[0][0]}R`,
    );
  }
}

main();
