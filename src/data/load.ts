import { CHUNK, concatBars, decodeChunk } from '../engine/codec';
import type { BacktestFile, Chunk, Drill, DrillFile, Manifest, TradeFile } from '../engine/codec';
import { LOOKAHEAD, WARMUP, windowSeries } from '../engine/indicators';
import type { Bars, Series } from '../engine/types';

const BASE = 'data/';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Library {
  manifest: Manifest;
  drills: Drill[];
  byId: Map<string, Drill>;
  backtest: BacktestFile;
}

let lib: Promise<Library> | null = null;

export function loadLibrary(): Promise<Library> {
  lib ??= Promise.all([getJson<Manifest>('manifest.json'), getJson<DrillFile>('drills.json'), getJson<BacktestFile>('backtest.json')]).then(
    ([manifest, df, backtest]) => ({ manifest, drills: df.drills, byId: new Map(df.drills.map((d) => [d.id, d])), backtest }),
  );
  lib.catch(() => (lib = null));
  return lib;
}

const chunks = new Map<string, Promise<Bars>>();

function loadChunk(x: string, k: number, digits: number): Promise<Bars> {
  const key = `${x}/${k}`;
  if (!chunks.has(key)) {
    const p = getJson<Chunk>(`${x}/${k}.json`).then((c) => decodeChunk(c, digits));
    p.catch(() => chunks.delete(key));
    chunks.set(key, p);
  }
  return chunks.get(key)!;
}

export interface Window {
  /** indicators computed on the window, same as the build did */
  s: Series;
  /** global index of s[0] */
  offset: number;
  /** local index of the decision candle */
  li: number;
  x: string;
  digits: number;
}

/** Candles around global bar i of instrument x, with indicators. */
export async function loadWindow(x: string, i: number): Promise<Window> {
  const { manifest } = await loadLibrary();
  const meta = manifest.instruments[x];
  const k0 = Math.floor(Math.max(0, i - WARMUP) / CHUNK);
  const k1 = Math.floor(Math.min(meta.n - 1, i + LOOKAHEAD) / CHUNK);
  const parts: Bars[] = [];
  for (let k = k0; k <= k1; k++) parts.push(await loadChunk(x, k, meta.digits));
  const base = k0 * CHUNK;
  const w = windowSeries(concatBars(parts), i - base);
  return { s: w.s, offset: base + w.offset, li: i - base - w.offset, x, digits: meta.digits };
}

const full = new Map<string, Promise<Bars>>();

/** Every candle of an instrument (for the Lab). */
export function loadAll(x: string): Promise<Bars> {
  if (!full.has(x)) {
    const p = loadLibrary().then(async ({ manifest }) => {
      const meta = manifest.instruments[x];
      const parts: Bars[] = [];
      for (let k = 0; k < meta.chunks; k++) parts.push(await loadChunk(x, k, meta.digits));
      return concatBars(parts);
    });
    p.catch(() => full.delete(x));
    full.set(x, p);
  }
  return full.get(x)!;
}

export interface SimTrade {
  t: number;
  r: number;
  result: 'win' | 'loss' | 'open';
}

export interface TradeBook {
  /** unix seconds of every time the setup appeared */
  seen: number[];
  byTarget: Record<string, SimTrade[]>;
}

let trades: Promise<Map<string, TradeBook>> | null = null;

/** Every backtest trade, keyed 'system:market' (loaded on demand: ~0.5 MB). */
export function loadTrades(): Promise<Map<string, TradeBook>> {
  trades ??= getJson<TradeFile>('trades.json').then((f) => {
    const undelta = (d: number[]) => {
      let h = 0;
      return d.map((x) => f.start + (h += x) * 3600);
    };
    const out = new Map<string, TradeBook>();
    for (const [key, row] of Object.entries(f.rows)) {
      const byTarget: TradeBook['byTarget'] = {};
      for (const [r, l] of Object.entries(row.byTarget)) {
        const ts = undelta(l.h);
        byTarget[r] = ts.map((t, k) => ({ t, r: l.r[k] / 100, result: l.k[k] === 'w' ? 'win' : l.k[k] === 'l' ? 'loss' : 'open' }));
      }
      out.set(key, { seen: undelta(row.seen), byTarget });
    }
    return out;
  });
  trades.catch(() => (trades = null));
  return trades;
}
