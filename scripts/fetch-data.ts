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
    batchSize: 2,
    pauseBetweenBatchesMs: 2000,
    retryCount: 3,
    pauseBetweenRetriesMs: 15000,
    retryOnEmpty: false,
    failAfterRetryCount: true,
  })) as number[][];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One file per month, so a rate-limited run keeps what it got and the next run resumes. */
async function fetchYear(id: InstrumentId, year: number) {
  mkdirSync(PARTS, { recursive: true });
  const yesterday = new Date(Date.now() - 86400_000);
  const recent = Date.now() - 40 * 86400_000;
  for (let m = 0; m < 12; m++) {
    const a = new Date(Date.UTC(year, m, 1));
    const b = new Date(Date.UTC(year, m + 1, 1));
    const from = iso(a) < FROM ? FROM : iso(a);
    const to = b > yesterday ? iso(yesterday) : iso(b);
    if (from >= to || iso(b) <= FROM) continue;
    const file = `${PARTS}/${id}-${year}-${String(m + 1).padStart(2, '0')}.json`;
    // finished months never change; the last ~6 weeks are refetched to pick up new candles
    if (existsSync(file) && b.getTime() < recent) continue;
    for (let attempt = 1; ; attempt++) {
      try {
        const rows = await fetchRange(INSTRUMENTS[id].source, from, to);
        writeFileSync(file, JSON.stringify(rows));
        console.log(`${id} ${from}..${to}: ${rows.length} candles`);
        break;
      } catch (e) {
        if (attempt >= 6) throw e;
        console.log(`${id} ${from}: ${(e as Error).message}, waiting ${attempt * 60}s`);
        await new Promise((r) => setTimeout(r, attempt * 60_000));
      }
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
