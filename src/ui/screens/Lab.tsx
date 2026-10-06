import { useEffect, useState } from 'react';
import { coreRules, gapGuard, scan, SPLIT_T, stats, trade, verdict, VERDICT_TEXT } from '../../engine/backtest';
import type { Candidate, StatBlock, Trade } from '../../engine/backtest';
import type { Library } from '../../data/load';
import { getSim, lastYears, simulateMoney } from '../../game/money';
import { getState, update, useGame } from '../../game/store';
import { buildSeries } from '../../engine/indicators';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../../engine/types';
import type { Bars, InstrumentId, Series, SystemId } from '../../engine/types';
import { loadAll } from '../../data/load';
import { luckLine, MoneyLine, SimBar, WinBar } from './Odds';

const TARGETS = [1, 1.5, 2, 3];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r2 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;

// Scans are slow-ish on a phone; keep them for the session.
const seriesCache = new Map<string, { bars: Bars; s: Series; clean: (i: number) => boolean }>();
const candCache = new Map<string, Candidate[]>();
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Result {
  trades: Trade[];
  target: number;
  all: StatBlock;
  early: StatBlock;
  recent: StatBlock;
  seen: number;
  label: string;
}

export function Lab({ lib }: { lib: Library }) {
  // "Test it in the Lab" from the Odds tab arrives as a one-time preset.
  const [preset] = useState(() => getState().labPreset ?? null);
  useEffect(() => {
    if (preset) update(() => ({ labPreset: null }));
  }, [preset]);
  const [sys, setSys] = useState<SystemId>((preset?.sys as SystemId) ?? 'ema');
  const [markets, setMarkets] = useState<Set<InstrumentId>>(new Set((preset?.markets as InstrumentId[]) ?? INSTRUMENT_ORDER));
  const [target, setTarget] = useState(preset?.target ?? 2);
  const [off, setOff] = useState<Set<string>>(new Set(preset?.off ?? []));
  const sim = getSim(useGame());
  const endT = Math.max(...Object.values(lib.manifest.instruments).map((m) => m.last));
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  const def = SYSTEMS[sys];
  const core = new Set(coreRules(sys));
  const rules = def.rules.filter((r) => r.kind === 'chart');

  const pickSystem = (s: SystemId) => {
    setSys(s);
    setOff(new Set());
    setResults([]);
  };

  const run = async () => {
    const trades: Trade[] = [];
    let seen = 0;
    for (const x of INSTRUMENT_ORDER) {
      if (!markets.has(x)) continue;
      let entry = seriesCache.get(x);
      if (!entry) {
        setBusy(`Loading 5 years of ${INSTRUMENTS[x].name}…`);
        await tick();
        const bars = await loadAll(x);
        setBusy(`Calculating indicators for ${INSTRUMENTS[x].name}…`);
        await tick();
        entry = { bars, s: buildSeries(bars), clean: gapGuard(bars) };
        seriesCache.set(x, entry);
      }
      const key = `${x}:${sys}`;
      let cands = candCache.get(key);
      if (!cands) {
        setBusy(`Finding every ${def.name} on ${INSTRUMENTS[x].name}…`);
        await tick();
        cands = scan(entry.bars, entry.s, sys, entry.clean);
        candCache.set(key, cands);
      }
      const res = trade(entry.bars, cands, { targetR: target, spread: INSTRUMENTS[x].spread, disabled: off });
      trades.push(...res.trades);
      seen += res.seen;
    }
    trades.sort((a, b) => a.t - b.t);
    const label = `${def.name} · ${target}R · ${[...markets].map((m) => INSTRUMENTS[m].name).join(', ')}${off.size ? ` · without: ${[...off].map((id) => rules.find((r) => r.id === id)?.title ?? id).join('; ')}` : ''}`;
    setResults([
      {
        trades,
        target,
        all: stats(trades, target),
        early: stats(
          trades.filter((t) => t.t < SPLIT_T),
          target,
        ),
        recent: stats(
          trades.filter((t) => t.t >= SPLIT_T),
          target,
        ),
        seen,
        label,
      },
      ...results,
    ].slice(0, 6));
    setBusy('');
  };

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
              }}
            >
              {INSTRUMENTS[x].name}
            </button>
          ))}
        </div>
        <div className="eyebrow">Target</div>
        <div className="chip-row">
          {TARGETS.map((t) => (
            <button key={t} className={target === t ? 'chip on' : 'chip'} onClick={() => setTarget(t)}>
              {t}R
            </button>
          ))}
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
        <button className="btn primary wide" disabled={!!busy} onClick={run}>
          {busy || 'Run 5-year test'}
        </button>
      </section>

      <SimBar showTarget={false} />

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
                  Last {sim.years} year{sim.years > 1 ? 's' : ''} · {sim.risk}% risk · win {+(latest.target * sim.risk).toFixed(2)}% · {m.trades} trades
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
              <h4>Earlier runs</h4>
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
