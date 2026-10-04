// Downloads M15 candles from Dukascopy's free historical feed into data/raw/.
// Runs in GitHub Actions (the feed is not reachable from every network).
import { mkdirSync, writeFileSync } from 'node:fs';
import { getHistoricalRates } from 'dukascopy-node';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../src/engine/types';
import type { Bars } from '../src/engine/types';

// Fixed start so bar indexes (and drill ids) stay stable as new months are added.
const FROM = process.env.FROM ?? '2021-10-01';
const TO = process.env.TO ?? new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const only = process.argv[2];

async function fetchRange(source: string, from: string, to: string): Promise<number[][]> {
  const rows = (await getHistoricalRates({
    instrument: source as never,
    dates: { from, to },
    timeframe: 'm15',
    priceType: 'bid',
    format: 'array',
    volumes: false,
    ignoreFlats: true,
    batchSize: 15,
    pauseBetweenBatchesMs: 300,
    retryCount: 4,
    pauseBetweenRetriesMs: 1500,
    retryOnEmpty: false,
    failAfterRetryCount: true,
    useCache: true,
    cacheFolderPath: '.dukascopy-cache',
  })) as number[][];
  return rows;
}

function yearSlices(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let a = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (a < end) {
    const b = new Date(Date.UTC(a.getUTCFullYear() + 1, 0, 1));
    const stop = b < end ? b : end;
    out.push([a.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)]);
    a = b;
  }
  return out;
}

async function main() {
  mkdirSync('data/raw', { recursive: true });
  for (const id of INSTRUMENT_ORDER) {
    if (only && only !== id) continue;
    const meta = INSTRUMENTS[id];
    const all: number[][] = [];
    for (const [a, b] of yearSlices(FROM, TO)) {
      const started = Date.now();
      const rows = await fetchRange(meta.source, a, b);
      console.log(`${id} ${a}..${b}: ${rows.length} candles in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      all.push(...rows);
    }
    all.sort((x, y) => x[0] - y[0]);
    const bars: Bars = { t: [], o: [], h: [], l: [], c: [] };
    let lastT = -1;
    for (const [ts, o, h, l, c] of all) {
      const t = Math.round(ts / 1000);
      if (t <= lastT) continue; // drop duplicates at slice edges
      lastT = t;
      bars.t.push(t);
      bars.o.push(o);
      bars.h.push(h);
      bars.l.push(l);
      bars.c.push(c);
    }
    if (bars.t.length < 50000) throw new Error(`${id}: only ${bars.t.length} candles, expected ~120k`);
    writeFileSync(`data/raw/${id}.json`, JSON.stringify(bars));
    console.log(`${id}: ${bars.t.length} candles saved`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
