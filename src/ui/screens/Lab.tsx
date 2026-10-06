import { useEffect, useState } from 'react';
import { coreRules, gapGuard, scan, SPLIT_T, stats, trade, verdict, VERDICT_TEXT } from '../../engine/backtest';
import type { Candidate, StatBlock, Trade, TradeOptions } from '../../engine/backtest';
import { aggregate, buildSeries } from '../../engine/indicators';
import type { Timeframe } from '../../engine/indicators';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../../engine/types';
import type { Bars, InstrumentId, Series, SystemId } from '../../engine/types';
import { loadAll } from '../../data/load';
import type { Library } from '../../data/load';
import { fmtMoney, getSim, lastYears, simulateMoney } from '../../game/money';
import { getState, update, useGame } from '../../game/store';
import { luckLine, MoneyLine, SimBar, WinBar } from './Odds';

const TFS: { id: Timeframe; label: string }[] = [
  { id: 'm15', label: '15 min' },
  { id: 'h1', label: '1 hour' },
  { id: 'h4', label: '4 hours' },
];
const STOPS = [0.5, 0.75, 1, 1.5, 2];
const TARGETS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
/** Systems built on clock times (Asia range, NY open) only make sense on 15-minute candles. */
const M15_ONLY = new Set<SystemId>(['session', 'nyorb']);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r2 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
const tfName = (tf: Timeframe) => TFS.find((t) => t.id === tf)!.label;

// Scans are slow-ish on a phone; keep them for the session.
const seriesCache = new Map<string, { bars: Bars; s: Series; clean: (i: number) => boolean }>();
const candCache = new Map<string, Candidate[]>();
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Exits {
  mode: 'rules' | 'pips';
  stopMult: number;
  target: number;
  stopPips: number;
  targetPips: number;
}

interface Result {
  trades: Trade[];
  targetR: number;
  all: StatBlock;
  early: StatBlock;
  recent: StatBlock;
  seen: number;
  label: string;
}

interface Combo {
  tf: Timeframe;
  stopMult: number;
  target: number;
  all: StatBlock;
  early: StatBlock;
  recent: StatBlock;
  end: number;
}

export function Lab({ lib }: { lib: Library }) {
  // "Test it in the Lab" from the Odds tab arrives as a one-time preset.
  const [preset] = useState(() => getState().labPreset ?? null);
  useEffect(() => {
    if (preset) update(() => ({ labPreset: null }));
  }, [preset]);
  const [sys, setSys] = useState<SystemId>((preset?.sys as SystemId) ?? 'ema');
  const [markets, setMarkets] = useState<Set<InstrumentId>>(new Set((preset?.markets as InstrumentId[]) ?? INSTRUMENT_ORDER));
  const [tf, setTf] = useState<Timeframe>((preset?.tf as Timeframe) ?? 'm15');
  const [ex, setEx] = useState<Exits>({ mode: 'rules', stopMult: preset?.stopMult ?? 1, target: preset?.target ?? 2, stopPips: 10, targetPips: 20 });
  const [off, setOff] = useState<Set<string>>(new Set(preset?.off ?? []));
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [combos, setCombos] = useState<Combo[] | null>(null);
  const sim = getSim(useGame());
  const endT = Math.max(...Object.values(lib.manifest.instruments).map((m) => m.last));

  const def = SYSTEMS[sys];
  const core = new Set(coreRules(sys));
  const rules = def.rules.filter((r) => r.kind === 'chart');
  const tfAllowed = (t: Timeframe) => t === 'm15' || !M15_ONLY.has(sys);
  const oneMarket = markets.size === 1 ? [...markets][0] : null;

  const pickSystem = (s: SystemId) => {
    setSys(s);
    setOff(new Set());
    setResults([]);
    setCombos(null);
    if (M15_ONLY.has(s)) setTf('m15');
  };

  async function candidates(x: InstrumentId, t: Timeframe, s: SystemId) {
    const sk = `${x}:${t}`;
    let entry = seriesCache.get(sk);
    if (!entry) {
      setBusy(`Loading ${INSTRUMENTS[x].name}…`);
      await tick();
      const raw = await loadAll(x);
      setBusy(`Building ${tfName(t)} candles for ${INSTRUMENTS[x].name}…`);
      await tick();
      const bars = aggregate(raw, t);
      entry = { bars, s: buildSeries(bars), clean: gapGuard(bars) };
      seriesCache.set(sk, entry);
    }
    const ck = `${sk}:${s}`;
    let cands = candCache.get(ck);
    if (!cands) {
      setBusy(`Finding every ${SYSTEMS[s].name} on ${INSTRUMENTS[x].name} (${tfName(t)})…`);
      await tick();
      cands = scan(entry.bars, entry.s, s, entry.clean);
      candCache.set(ck, cands);
    }
    return { bars: entry.bars, cands };
  }

  const optsFor = (x: InstrumentId, e: Exits): TradeOptions => {
    const pip = INSTRUMENTS[x].pip;
    return e.mode === 'pips'
      ? { targetR: e.targetPips / e.stopPips, spread: INSTRUMENTS[x].spread, disabled: off, fixed: { stop: e.stopPips * pip, target: e.targetPips * pip } }
      : { targetR: e.target, spread: INSTRUMENTS[x].spread, disabled: off, stopMult: e.stopMult };
  };

  const run = async (e: Exits = ex, t: Timeframe = tf) => {
    const trades: Trade[] = [];
    let seen = 0;
    for (const x of INSTRUMENT_ORDER) {
      if (!markets.has(x)) continue;
      const { bars, cands } = await candidates(x, t, sys);
      const res = trade(bars, cands, optsFor(x, e));
      trades.push(...res.trades);
      seen += res.seen;
    }
    trades.sort((a, b) => a.t - b.t);
    const targetR = e.mode === 'pips' ? e.targetPips / e.stopPips : e.target;
    const exits = e.mode === 'pips' ? `stop ${e.stopPips} pips, target ${e.targetPips} pips` : `stop ×${e.stopMult}, target ${e.target}R`;
    const label = `${def.name} · ${tfName(t)} · ${exits} · ${[...markets].map((m) => INSTRUMENTS[m].name).join(', ')}${off.size ? ` · without: ${[...off].map((id) => rules.find((r) => r.id === id)?.title ?? id).join('; ')}` : ''}`;
    setResults((prev) =>
      [
        {
          trades,
          targetR,
          all: stats(trades, targetR),
          early: stats(
            trades.filter((x) => x.t < SPLIT_T),
            targetR,
          ),
          recent: stats(
            trades.filter((x) => x.t >= SPLIT_T),
            targetR,
          ),
          seen,
          label,
        },
        ...prev,
      ].slice(0, 6),
    );
    setBusy('');
  };

  /** Every timeframe × stop size × target for this system and these markets, judged on both periods. */
  const findBest = async () => {
    const found: Combo[] = [];
    for (const t of TFS.map((x) => x.id).filter(tfAllowed)) {
      const per: { x: InstrumentId; bars: Bars; cands: Candidate[] }[] = [];
      for (const x of INSTRUMENT_ORDER) if (markets.has(x)) per.push({ x, ...(await candidates(x, t, sys)) });
      setBusy(`Trying ${STOPS.length * TARGETS.length} exits on ${tfName(t)} candles…`);
      await tick();
      for (const sm of STOPS)
        for (const r of TARGETS) {
          const tr = per.flatMap((p) => trade(p.bars, p.cands, optsFor(p.x, { ...ex, mode: 'rules', stopMult: sm, target: r })).trades).sort((a, b) => a.t - b.t);
          if (tr.length < 30) continue;
          const inPeriod = lastYears(tr, sim.years, endT);
          found.push({
            tf: t,
            stopMult: sm,
            target: r,
            all: stats(tr, r),
            early: stats(
              tr.filter((x) => x.t < SPLIT_T),
              r,
            ),
            recent: stats(
              tr.filter((x) => x.t >= SPLIT_T),
              r,
            ),
            end: simulateMoney(inPeriod, sim.balance, sim.risk).end,
          });
        }
    }
    setCombos(found);
    setBusy('');
  };

  const held = (combos ?? []).filter((c) => c.early.trades >= 20 && c.recent.trades >= 20 && c.early.avgR > 0 && c.recent.avgR > 0);
  const byMoney = [...held].sort((a, b) => b.end - a.end).slice(0, 5);
  const byWin = [...held].sort((a, b) => b.all.winRate - a.all.winRate).slice(0, 3);
  const apply = (c: Combo) => {
    const e: Exits = { ...ex, mode: 'rules', stopMult: c.stopMult, target: c.target };
    setTf(c.tf);
    setEx(e);
    run(e, c.tf);
  };

  // Break-even win rate for the exits as set.
  const spreadPips = oneMarket ? INSTRUMENTS[oneMarket].spread / INSTRUMENTS[oneMarket].pip : null;
  const be =
    ex.mode === 'pips'
      ? { r: ex.targetPips / ex.stopPips, need: (1 + (spreadPips ?? 0) / ex.stopPips) / (ex.targetPips / ex.stopPips + 1) }
      : { r: ex.target, need: 1 / (ex.target + 1) };

  const latest = results[0];
  return (
    <div className="screen">
      <h1 className="screen-title">Lab</h1>
      <p className="hint">
        Change a system and re-run 5 years in seconds. Tune on 2021–2024, then check 2025–26 — data your changes never saw. If a tweak only works on the early years, it was luck.
      </p>

      <section className="card lab">
        <div className="eyebrow">System</div>
        <div className="chip-row">
          {SYSTEM_ORDER.map((s) => (
            <button key={s} className={sys === s ? 'chip on' : 'chip'} onClick={() => pickSystem(s)}>
              {SYSTEMS[s].name}
            </button>
          ))}
        </div>
        <div className="eyebrow">Markets</div>
        <div className="chip-row">
          {INSTRUMENT_ORDER.map((x) => (
            <button
              key={x}
              className={markets.has(x) ? 'chip on' : 'chip'}
              onClick={() => {
                const next = new Set(markets);
                if (next.has(x) && next.size > 1) next.delete(x);
                else next.add(x);
                setMarkets(next);
                setCombos(null);
              }}
            >
              {INSTRUMENTS[x].name}
            </button>
          ))}
        </div>
        <div className="eyebrow">Candle size</div>
        <div className="chip-row">
          {TFS.map((t) => (
            <button key={t.id} className={tf === t.id ? 'chip on' : 'chip'} disabled={!tfAllowed(t.id)} onClick={() => setTf(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {M15_ONLY.has(sys) ? <p className="hint">This system uses clock times (session open), so it only runs on 15-minute candles.</p> : null}

        <div className="eyebrow">Exits</div>
        <div className="seg two">
          <button className={ex.mode === 'rules' ? 'seg-btn on' : 'seg-btn'} onClick={() => setEx({ ...ex, mode: 'rules' })}>
            Stop from the rules
          </button>
          <button className={ex.mode === 'pips' ? 'seg-btn on' : 'seg-btn'} onClick={() => setEx({ ...ex, mode: 'pips' })}>
            Fixed pips
          </button>
        </div>
        {ex.mode === 'rules' ? (
          <>
            <div className="sim-row">
              <span>Stop</span>
              {STOPS.map((m) => (
                <button key={m} className={ex.stopMult === m ? 'chip on' : 'chip'} onClick={() => setEx({ ...ex, stopMult: m })}>
                  ×{m}
                </button>
              ))}
            </div>
            <div className="sim-row">
              <span>Target</span>
              {TARGETS.map((t) => (
                <button key={t} className={ex.target === t ? 'chip on' : 'chip'} onClick={() => setEx({ ...ex, target: t })}>
                  {t}R
                </button>
              ))}
            </div>
            <p className="hint">
              Stop ×{ex.stopMult} = {ex.stopMult === 1 ? 'where the rules put it' : `${ex.stopMult < 1 ? 'closer' : 'further'} than the rules (${ex.stopMult}× the distance)`}. Target {ex.target}R ={' '}
              {ex.target}× the stop distance — e.g. risk 1%, win {+(ex.target * 1).toFixed(2)}%.
            </p>
          </>
        ) : (
          <div className="pip-grid">
            <label>
              Stop (pips)
              <input id="stop-pips" inputMode="decimal" value={ex.stopPips} onChange={(e) => setEx({ ...ex, stopPips: Math.max(0.5, Number(e.target.value) || 0) })} />
            </label>
            <label>
              Target (pips)
              <input id="target-pips" inputMode="decimal" value={ex.targetPips} onChange={(e) => setEx({ ...ex, targetPips: Math.max(0.5, Number(e.target.value) || 0) })} />
            </label>
            <p className="hint">1 pip = 0.0001 on EURUSD, $0.10 on Gold, 1 point on NAS100. Same pips on every market is rarely fair — test one market at a time.</p>
          </div>
        )}
        <div className="breakeven">
          <b>
            To break even you need {pct(be.need)} wins
          </b>
          <span>
            Reward {+be.r.toFixed(2)}× the risk
            {ex.mode === 'pips' && spreadPips !== null ? `, after ${+spreadPips.toFixed(1)} pips spread` : ' (before spread)'}. Above that you make money; below it you lose.
          </span>
        </div>

        <div className="eyebrow">Rules</div>
        <ul className="lab-rules">
          {rules.map((r) => {
            const locked = core.has(r.id);
            const on = !off.has(r.id);
            return (
              <li key={r.id}>
                <button
                  className={on ? 'lab-rule on' : 'lab-rule'}
                  disabled={locked}
                  onClick={() => {
                    const next = new Set(off);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    setOff(next);
                    setCombos(null);
                  }}
                >
                  <span className="switch" aria-hidden />
                  <span>
                    {r.title}
                    {locked ? <small> · defines the setup</small> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="btn primary wide" disabled={!!busy} onClick={() => run()}>
          {busy || 'Run 5-year test'}
        </button>
        <button className="btn ghost wide" disabled={!!busy} onClick={findBest}>
          Find the best combo for this system
        </button>
        <p className="hint">Tries every candle size × stop size × target for the markets above ({STOPS.length * TARGETS.length} exits per candle size) and keeps only those that made money both before 2025 and since.</p>
      </section>

      <SimBar showTarget={false} />

      {combos ? (
        <section className="card lab-result">
          <div className="eyebrow">Best combos · {combos.length} tried</div>
          {held.length ? (
            <>
              <h4 className="lab-h">Most money ({fmtMoney(sim.balance)}, {sim.risk}% risk, last {sim.years} yr)</h4>
              <ol className="combo-list">
                {byMoney.map((c, k) => (
                  <ComboRow key={k} c={c} start={sim.balance} onApply={() => apply(c)} />
                ))}
              </ol>
              <h4 className="lab-h">Highest win rate that still made money</h4>
              <ol className="combo-list">
                {byWin.map((c, k) => (
                  <ComboRow key={k} c={c} start={sim.balance} onApply={() => apply(c)} />
                ))}
              </ol>
              <p className="hint">Picking the best of {combos.length} always flatters the winner. Prefer combos whose neighbours (a bit more or less stop or target) also do well — that means it is not a lucky spike.</p>
            </>
          ) : (
            <p className="hint">None of the {combos.length} combinations made money both before 2025 and since. This system has no exit that rescues it on these markets.</p>
          )}
        </section>
      ) : null}

      {latest ? (
        <section className="card lab-result">
          <div className="eyebrow">Result</div>
          <p className="lab-label">{latest.label}</p>
          <div className="odds-counts">
            <div>
              <b>{latest.seen}</b>
              <small>showed up</small>
            </div>
            <div>
              <b className="up-text">{latest.all.wins}</b>
              <small>right</small>
            </div>
            <div>
              <b className="down-text">{latest.all.losses}</b>
              <small>wrong</small>
            </div>
            <div>
              <b>{latest.all.open}</b>
              <small>neither</small>
            </div>
          </div>
          <WinBar b={latest.all} />
          <table className="bt lab-split">
            <thead>
              <tr>
                <th />
                <th>Trades</th>
                <th>Win</th>
                <th>Per trade</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['2021–24 (tuning)', latest.early],
                ['2025–26 (unseen)', latest.recent],
                ['All', latest.all],
              ].map(([label, b]) => {
                const x = b as StatBlock;
                return (
                  <tr key={label as string}>
                    <td>{label as string}</td>
                    <td>{x.trades}</td>
                    <td>{pct(x.winRate)}</td>
                    <td className={x.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(x.avgR)}</td>
                    <td className={x.totalR >= 0 ? 'up-text' : 'down-text'}>{x.totalR >= 0 ? '+' : ''}{x.totalR.toFixed(0)}R</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(() => {
            const inPeriod = lastYears(latest.trades, sim.years, endT);
            const m = simulateMoney(inPeriod, sim.balance, sim.risk);
            return (
              <div className="lab-money">
                <div className="eyebrow">
                  Last {sim.years} year{sim.years > 1 ? 's' : ''} · {sim.risk}% risk · win {+(latest.targetR * sim.risk).toFixed(2)}% · {m.trades} trades
                </div>
                <MoneyLine m={m} />
              </div>
            );
          })()}
          <p className="hint">
            <b>{VERDICT_TEXT[verdict(latest.all, latest.recent)]}.</b> {luckLine(latest.all)} Worst losing streak {latest.all.maxLosingStreak}.
          </p>
          {results.length > 1 ? (
            <>
              <h4 className="lab-h">Earlier runs</h4>
              <ul className="lab-history">
                {results.slice(1).map((r, k) => (
                  <li key={k}>
                    <span>{r.label}</span>
                    <b className={r.all.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(r.all.avgR)}</b>
                    <small>unseen {r2(r.recent.avgR)}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ComboRow({ c, start, onApply }: { c: Combo; start: number; onApply: () => void }) {
  return (
    <li>
      <button className="combo" onClick={onApply}>
        <span className="combo-name">
          {tfName(c.tf)} · stop ×{c.stopMult} · target {c.target}R
        </span>
        <span className="combo-nums">
          <b className={c.end >= start ? 'up-text' : 'down-text'}>
            {fmtMoney(start)} → {fmtMoney(c.end)}
          </b>
          <small>
            {pct(c.all.winRate)} win · {r2(c.all.avgR)} · {c.all.trades} trades · unseen {r2(c.recent.avgR)}
          </small>
        </span>
        <span className="chev">›</span>
      </button>
    </li>
  );
}
