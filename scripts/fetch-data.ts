// Downloads M15 candles from Dukascopy's free historical feed.
//   tsx scripts/fetch-data.ts <instrument> <year>   -> data/raw/parts/<instrument>-<year>.json
//   tsx scripts/fetch-data.ts --merge               -> data/raw/<instrument>.json
// Runs in GitHub Actions, one job per instrument-year so no single runner hits the rate limit.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getHistoricalRates } from 'dukascopy-node';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../src/engine/types';
import type { Bars, InstrumentId } from '../src/engine/types';

// Fixed start so bar indexes (and drill ids) stay stable as new months are added.
export const FROM = '2021-10-01';
const PARTS = 'data/raw/parts';

async function fetchRange(source: string, from: string, to: string): Promise<number[][]> {
  return (await getHistoricalRates({
    instrument: source as never,
    dates: { from, to },
    timeframe: 'm15',
    priceType: 'bid',
    format: 'array',
    volumes: false,
    ignoreFlats: true,
    batchSize: 3,
    pauseBetweenBatchesMs: 1500,
    retryCount: 6,
    pauseBetweenRetriesMs: 10000,
    retryOnEmpty: false,
    failAfterRetryCount: true,
    useCache: true,
    cacheFolderPath: '.dukascopy-cache',
  })) as number[][];
}

async function fetchYear(id: InstrumentId, year: number) {
  const today = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const from = year === Number(FROM.slice(0, 4)) ? FROM : `${year}-01-01`;
  const to = `${year + 1}-01-01` < today ? `${year + 1}-01-01` : today;
  if (from >= to) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const started = Date.now();
      const rows = await fetchRange(INSTRUMENTS[id].source, from, to);
      mkdirSync(PARTS, { recursive: true });
      writeFileSync(`${PARTS}/${id}-${year}.json`, JSON.stringify(rows));
      console.log(`${id} ${from}..${to}: ${rows.length} candles in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      return;
    } catch (e) {
      // Rate limited: back off and try again (days already downloaded are cached).
      if (attempt >= 8) throw e;
      console.log(`${id} ${year}: ${(e as Error).message}, waiting ${attempt * 45}s`);
      await new Promise((r) => setTimeout(r, attempt * 45_000));
    }
  }
}

function merge() {
  for (const id of INSTRUMENT_ORDER) {
    const files = existsSync(PARTS) ? readdirSync(PARTS).filter((f) => f.startsWith(`${id}-`)).sort() : [];
    if (!files.length) {
      console.warn(`${id}: no parts`);
      continue;
    }
    const rows = files.flatMap((f) => JSON.parse(readFileSync(`${PARTS}/${f}`, 'utf8')) as number[][]);
    rows.sort((x, y) => x[0] - y[0]);
    const bars: Bars = { t: [], o: [], h: [], l: [], c: [] };
    let lastT = -1;
    for (const [ts, o, h, l, c] of rows) {
      const t = Math.round(ts / 1000);
      if (t <= lastT) continue; // duplicates at slice edges
      lastT = t;
      bars.t.push(t);
      bars.o.push(o);
      bars.h.push(h);
      bars.l.push(l);
      bars.c.push(c);
    }
    if (bars.t.length < 50000) throw new Error(`${id}: only ${bars.t.length} candles, expected ~120k`);
    writeFileSync(`data/raw/${id}.json`, JSON.stringify(bars));
    console.log(`${id}: ${bars.t.length} candles from ${files.join(', ')}`);
  }
}

async function main() {
  const [a, b] = process.argv.slice(2);
  if (a === '--merge') return merge();
  if (!a || !b || !(a in INSTRUMENTS)) throw new Error('usage: fetch-data.ts <eurusd|xauusd|nas100> <year> | --merge');
  await fetchYear(a as InstrumentId, Number(b));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
