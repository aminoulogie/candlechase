import { CHUNK, concatBars, decodeChunk } from '../engine/codec';
import type { BacktestFile, Chunk, Drill, DrillFile, Manifest } from '../engine/codec';
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
