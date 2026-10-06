import { useState } from 'react';
import { verdict, VERDICT_TEXT } from '../../engine/backtest';
import type { StatBlock } from '../../engine/backtest';
import type { BacktestRow } from '../../engine/codec';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../../engine/types';
import type { InstrumentId, SystemId } from '../../engine/types';
import type { Library } from '../../data/load';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const r2 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
const marketName = (x: string) => (x === 'all' ? 'All 3 markets' : INSTRUMENTS[x as InstrumentId].name);

export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (k: number) => (k / (values.length - 1)) * 100;
  const y = (v: number) => 28 - ((v - min) / span) * 26;
  const d = values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values[values.length - 1];
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="spark-zero" />
      <path d={d} className={last >= 0 ? 'spark-up' : 'spark-down'} />
    </svg>
  );
}

/** Win rate with its 95% range, against the win rate needed to break even. */
export function WinBar({ b }: { b: StatBlock }) {
  return (
    <div className="winbar" aria-label={`Win rate ${pct(b.winRate)}, needs ${pct(b.breakEven)}`}>
      <div className="wb-track">
        <div className="wb-ci" style={{ left: `${b.ciLo * 100}%`, width: `${(b.ciHi - b.ciLo) * 100}%` }} />
        <div className={b.winRate >= b.breakEven ? 'wb-dot up' : 'wb-dot down'} style={{ left: `${b.winRate * 100}%` }} />
        <div className="wb-need" style={{ left: `${b.breakEven * 100}%` }} />
      </div>
      <div className="wb-legend">
        <span>
          Wins <b>{pct(b.winRate)}</b> <small>(likely {pct(b.ciLo)}–{pct(b.ciHi)})</small>
        </span>
        <span>
          Needs <b>{pct(b.breakEven)}</b>
        </span>
      </div>
    </div>
  );
}

export function luckLine(b: StatBlock): string {
  if (b.trades < 30) return 'Too few trades to tell luck from skill.';
  const p = b.pValue;
  if (b.avgR <= 0) return 'Lost money — no luck test needed.';
  return `A system with no edge would do this well ${p < 0.01 ? 'less than 1%' : `${Math.round(p * 100)}%`} of the time by luck.`;
}

function SystemCard({ sys, rows, market }: { sys: SystemId; rows: BacktestRow[]; market: string }) {
  const [open, setOpen] = useState(false);
  const r = rows.find((x) => x.sys === sys && x.x === market);
  if (!r) return null;
  const m = r.main;
  const v = verdict(m, r.recent);
  const best = Object.entries(r.byTarget).sort((a, b) => b[1].avgR - a[1].avgR)[0];
  return (
    <section className={`card odds v-${v}`}>
      <button className="odds-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`sys-dot sys-${sys}`} />
        <span className="odds-name">
          <b>{SYSTEMS[sys].name}</b>
          <small>{SYSTEMS[sys].family}</small>
        </span>
        <span className={`verdict-chip v-${v}`}>{VERDICT_TEXT[v]}</span>
      </button>

      <div className="odds-counts">
        <div>
          <b>{r.seen}</b>
          <small>times it showed up</small>
        </div>
        <div>
          <b className="up-text">{m.wins}</b>
          <small>right (hit 2R)</small>
        </div>
        <div>
          <b className="down-text">{m.losses}</b>
          <small>wrong (stopped)</small>
        </div>
        <div>
          <b>{m.open}</b>
          <small>neither in 2 days</small>
        </div>
      </div>
      <WinBar b={m} />
      <div className="odds-line">
        <span>
          Per trade <b className={m.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(m.avgR)}</b>
        </span>
        <span>
          5 years <b className={m.totalR >= 0 ? 'up-text' : 'down-text'}>{m.totalR >= 0 ? '+' : ''}{m.totalR.toFixed(0)}R</b>
        </span>
        <span className="spark-wrap">
          <Spark values={m.curve} />
        </span>
      </div>
      <p className="hint">{luckLine(m)}</p>

      {open ? (
        <div className="odds-detail">
          <p className="hint">
            {m.trades} trades taken (one at a time — {r.seen - m.trades} more showed up while a trade was still open). Worst losing streak {m.maxLosingStreak}, deepest drawdown{' '}
            {m.maxDrawdown.toFixed(1)}R.
          </p>
          <h4>Before 2025 vs since</h4>
          <table className="bt">
            <tbody>
              {[
                ['2021–2024', r.early],
                ['2025–now', r.recent],
              ].map(([label, b]) => (
                <tr key={label as string}>
                  <td>{label as string}</td>
                  <td>{(b as StatBlock).trades} trades</td>
                  <td>{pct((b as StatBlock).winRate)} win</td>
                  <td className={(b as StatBlock).avgR >= 0 ? 'up-text' : 'down-text'}>{r2((b as StatBlock).avgR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Other targets (same entries and stops)</h4>
          <table className="bt">
            <tbody>
              {Object.entries(r.byTarget).map(([t, b]) => (
                <tr key={t} className={t === best[0] ? 'best' : ''}>
                  <td>{t}R target</td>
                  <td>{pct(b.winRate)} win</td>
                  <td>needs {pct(b.breakEven)}</td>
                  <td className={b.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(b.avgR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Buys vs sells</h4>
          <table className="bt">
            <tbody>
              {[
                ['Buys', m.long],
                ['Sells', m.short],
              ].map(([label, b]) => (
                <tr key={label as string}>
                  <td>{label as string}</td>
                  <td>{(b as StatBlock).trades} trades</td>
                  <td>{pct((b as StatBlock).winRate)} win</td>
                  <td className={(b as StatBlock).avgR >= 0 ? 'up-text' : 'down-text'}>{r2((b as StatBlock).avgR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>By year</h4>
          <table className="bt">
            <tbody>
              {Object.entries(m.byYear).map(([y, b]) => (
                <tr key={y}>
                  <td>{y}</td>
                  <td>{b.trades} trades</td>
                  <td>{b.trades ? pct(b.wins / b.trades) : '—'} win</td>
                  <td className={b.totalR >= 0 ? 'up-text' : 'down-text'}>{b.totalR >= 0 ? '+' : ''}{b.totalR.toFixed(1)}R</td>
                </tr>
              ))}
            </tbody>
          </table>
          {market === 'all' ? (
            <>
              <h4>By market</h4>
              <table className="bt">
                <tbody>
                  {INSTRUMENT_ORDER.map((x) => {
                    const mr = rows.find((y) => y.sys === sys && y.x === x);
                    if (!mr) return null;
                    return (
                      <tr key={x}>
                        <td>{INSTRUMENTS[x].name}</td>
                        <td>{mr.main.trades} trades</td>
                        <td>{pct(mr.main.winRate)} win</td>
                        <td className={mr.main.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(mr.main.avgR)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      ) : (
        <button className="why-btn" onClick={() => setOpen(true)}>
          Years, targets, buys vs sells{market === 'all' ? ', markets' : ''} ›
        </button>
      )}
    </section>
  );
}

export function Odds({ lib }: { lib: Library }) {
  const bt = lib.backtest;
  const [market, setMarket] = useState('all');
  const rows = bt.rows.filter((r) => r.x === market).sort((a, b) => b.main.avgR - a.main.avgR);
  const verdicts = rows.map((r) => verdict(r.main, r.recent));
  const works = verdicts.filter((v) => v === 'works').length;
  const maybe = verdicts.filter((v) => v === 'maybe').length;

  return (
    <div className="screen">
      <h1 className="screen-title">Odds</h1>
      <section className="card summary">
        <div className="eyebrow">
          {bt.from} → {bt.to} · M15 · spread included
        </div>
        <p className="summary-line">
          {works
            ? `${works} of ${rows.length} systems show a real edge on ${marketName(market)}.`
            : `None of the ${rows.length} systems shows a proven edge on ${marketName(market)}.`}
          {maybe ? ` ${maybe} made a little money, but not enough to rule out luck.` : ''}
        </p>
        <p className="hint">
          Every time a system’s rules were all met on a closed candle, it was traded: stop where the rules say, target 2× the risk, one trade at a time per system, a
          candle touching both stop and target counted as a loss. “Has an edge” means profitable, under 5% chance of luck, and still profitable in 2025–26.
        </p>
      </section>
      <div className="chip-row">
        {['all', ...INSTRUMENT_ORDER].map((x) => (
          <button key={x} className={market === x ? 'chip on' : 'chip'} onClick={() => setMarket(x)}>
            {x === 'all' ? 'All markets' : INSTRUMENTS[x as InstrumentId].name}
          </button>
        ))}
      </div>
      {rows.map((r) => (
        <SystemCard key={r.sys} sys={r.sys as SystemId} rows={bt.rows} market={market} />
      ))}
      <p className="foot">Past results don’t promise future ones. Practice tool, not financial advice.</p>
    </div>
  );
}
