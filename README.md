# Candlechase

A training game for four trading systems, played on five years of real M15
history (EURUSD, Gold, NAS100). Built to make setups automatic: lots of graded
reps, instant feedback, and mistakes that come back until you get them right.

**Play:** https://aminoulogie.github.io/candlechase/ — on iPhone, open it in
Safari and use *Share → Add to Home Screen*.

## The four systems

| | System | Idea |
|---|---|---|
| 1 | **EMA Pullback** | Trend is running; join it when price pulls back to EMA20/50 and closes back in the trend direction. |
| 2 | **S/R Retest** | A respected level breaks on a close, price comes back to test it from the other side, and it holds. |
| 3 | **RSI Divergence** | Price makes a new extreme, RSI doesn't; enter when a candle closes back through the second swing. |
| 4 | **Session Breakout** | Mark the Asian range (00:00–07:00 UTC) and trade the first strong close outside it in the London window. |

The EMA Pullback checklist is the trader's own, word for word. The other three
are written in the same style. Every rule has exact numbers behind it (see the
Rulebook tab, or `src/engine/systems.ts`), and those numbers are what grades
every drill.

## Modes

- **Spot it** — Buy, sell, or no trade on the candle that just closed. Instant answer with the full rule breakdown and what happened next.
- **Replay** — Candles arrive one at a time. Enter only when a setup closes.
- **Checklist** — Tick each rule as met or not; every tick is graded.
- **Place it** — Tap the chart to set stop and target, choose 0.01–0.03 lots; scored on the order.
- **Exam** — 10 charts across all four systems; answers at the end.

About 40% of practice charts are *not* trades (near misses that break exactly
one rule, or nothing at all). Systems unlock one at a time at 80% accuracy over
50 drills; a timer switches on for a system once it's mastered. Wrong answers
come back after 1, 3 and 7 days. A practice account with a daily loss limit
tracks Replay and Place it trades. The **Live log** records real trades and
compares rule-following live against game accuracy.

## How the data works

- `scripts/fetch-data.ts` downloads M15 bid candles from Dukascopy's free
  historical feed (one GitHub Actions job per market-year, to stay under the
  rate limit).
- `scripts/build-data.ts` scans every candle with the rule engine, samples
  valid setups / one-rule near misses / empty charts as drills, backtests each
  system (one trade at a time, 2R target, spread included, stop counted first
  when a candle touches both), and writes `public/data/`.
- The app loads the candles around each drill and recomputes the indicators
  itself, with the same engine — a test checks it reaches the same verdict as
  the build.

The **Refresh market data** workflow runs monthly and on demand; the
**Deploy app** workflow publishes to GitHub Pages after every push or data
refresh.

## Develop

```sh
npm install
npm run data:synthetic          # made-up candles for offline work (never publish)
npx tsx scripts/build-data.ts data/raw-synthetic public/data
npm run dev
npm test
```

Progress is stored in the browser (localStorage). Stats → *Save progress file*
makes a backup you can load on another device.

Practice tool, not financial advice. Past results don't promise future ones.
