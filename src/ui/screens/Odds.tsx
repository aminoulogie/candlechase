import { useEffect, useState } from 'react';
import { verdict, VERDICT_TEXT } from '../../engine/backtest';
import type { StatBlock } from '../../engine/backtest';
import type { BacktestRow } from '../../engine/codec';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../../engine/types';
import type { InstrumentId, SystemId } from '../../engine/types';
import { loadTrades } from '../../data/load';
import type { Library, TradeBook } from '../../data/load';
import { fmtMoney, getSim, lastYears, setSim, simulateMoney, statsOf } from '../../game/money';
import type { MoneyResult } from '../../game/money';
import { useGame } from '../../game/store';
import type { LabPreset } from '../../game/store';

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

/** Account, risk, period and target: the inputs every money figure uses. */
export function SimBar({ showTarget = true }: { showTarget?: boolean }) {
  const sim = getSim(useGame());
  return (
    <section className="card simbar">
      <label className="sim-balance">
        <span>Account</span>
        <input
          id="sim-balance"
          inputMode="numeric"
          value={sim.balance}
          onChange={(e) => {
            const v = Number(e.target.value.replace(/[^0-9.]/g, ''));
            if (Number.isFinite(v)) setSim({ balance: v });
          }}
        />
      </label>
      <div className="sim-row">
        <span>Risk</span>
        {[0.5, 1, 2].map((r) => (
          <button key={r} className={sim.risk === r ? 'chip on' : 'chip'} onClick={() => setSim({ risk: r })}>
            {r}%
          </button>
        ))}
      </div>
      <div className="sim-row">
        <span>Period</span>
        {[1, 2, 5].map((y) => (
          <button key={y} className={sim.years === y ? 'chip on' : 'chip'} onClick={() => setSim({ years: y })}>
            {y} yr
          </button>
        ))}
      </div>
      {showTarget ? (
        <div className="sim-row">
          <span>Win</span>
          {[1, 1.5, 2, 3].map((t) => (
            <button key={t} className={sim.target === t ? 'chip on' : 'chip'} onClick={() => setSim({ target: t })}>
              {+(t * sim.risk).toFixed(2)}%
            </button>
          ))}
        </div>
      ) : null}
      <p className="hint">
        Risk {sim.risk}% of the account per trade, take profit at {+(sim.target * sim.risk).toFixed(2)}% ({sim.target}R). Gains and losses compound.
      </p>
    </section>
  );
}

export function MoneyLine({ m }: { m: MoneyResult }) {
  return (
    <div className="money-line">
      <div>
        <small>Account</small>
        <b>
          {fmtMoney(m.start)} → <span className={m.profit >= 0 ? 'up-text' : 'down-text'}>{fmtMoney(m.end)}</span>
        </b>
      </div>
      <div>
        <small>Return</small>
        <b className={m.ret >= 0 ? 'up-text' : 'down-text'}>
          {m.ret >= 0 ? '+' : ''}
          {m.ret.toFixed(1)}%
        </b>
      </div>
      <div>
        <small>Worst drop</small>
        <b className="down-text">−{m.maxDrawdown.toFixed(1)}%</b>
      </div>
    </div>
  );
}

interface CardData {
  sys: SystemId;
  row: BacktestRow;
  st: StatBlock;
  seen: number;
  money: MoneyResult | null;
}

function SystemCard({ d, rows, market, years, target }: { d: CardData; rows: BacktestRow[]; market: string; years: number; target: number }) {
  const [open, setOpen] = useState(false);
  const { sys, row: r, st: m, money } = d;
  const v = verdict(m, r.recent);
  const best = Object.entries(r.byTarget).sort((a, b) => b[1].avgR - a[1].avgR)[0];
  const tLabel = `${target}R`;
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
          <b>{d.seen}</b>
          <small>times it showed up</small>
        </div>
        <div>
          <b className="up-text">{m.wins}</b>
          <small>right (hit {tLabel})</small>
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
      {money ? <MoneyLine m={money} /> : null}
      <div className="odds-line">
        <span>
          Per trade <b className={m.avgR >= 0 ? 'up-text' : 'down-text'}>{r2(m.avgR)}</b>
        </span>
        <span>
          {years} yr <b className={m.totalR >= 0 ? 'up-text' : 'down-text'}>{m.totalR >= 0 ? '+' : ''}{m.totalR.toFixed(0)}R</b>
        </span>
        <span className="spark-wrap">
          <Spark values={money ? money.curve.map((x) => x - money.start) : r.main.curve} />
        </span>
      </div>
      <p className="hint">{luckLine(m)}</p>

      {open ? (
        <div className="odds-detail">
          <p className="hint">
            5-year detail at 2R: {r.main.trades} trades taken (one at a time — {r.seen - r.main.trades} more showed up while a trade was still open). Worst losing streak{' '}
            {r.main.maxLosingStreak}, deepest drawdown {r.main.maxDrawdown.toFixed(1)}R.
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
                ['Buys', r.main.long],
                ['Sells', r.main.short],
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
              {Object.entries(r.main.byYear).map(([y, b]) => (
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

export function Odds({ lib, onTryInLab }: { lib: Library; onTryInLab: (p: LabPreset) => void }) {
  const bt = lib.backtest;
  const [market, setMarket] = useState('all');
  const [book, setBook] = useState<Map<string, TradeBook> | null>(null);
  const sim = getSim(useGame());
  useEffect(() => {
    loadTrades().then(setBook, () => setBook(null));
  }, []);

  const endT = Math.max(...Object.values(lib.manifest.instruments).map((m) => m.last));
  const markets = market === 'all' ? INSTRUMENT_ORDER : [market as InstrumentId];
  const cards: CardData[] = bt.rows
    .filter((r) => r.x === market)
    .map((row) => {
      const sys = row.sys as SystemId;
      if (!book) return { sys, row, st: row.main, seen: row.seen, money: null };
      const list = markets.flatMap((x) => book.get(`${sys}:${x}`)?.byTarget[String(sim.target)] ?? []).sort((a, b) => a.t - b.t);
      const inPeriod = lastYears(list, sim.years, endT);
      const seen = markets.reduce((n, x) => n + lastYears((book.get(`${sys}:${x}`)?.seen ?? []).map((t) => ({ t })), sim.years, endT).length, 0);
      return { sys, row, st: statsOf(inPeriod, sim.target), seen, money: simulateMoney(inPeriod, sim.balance, sim.risk) };
    })
    .sort((a, b) => (a.money && b.money ? b.money.end - a.money.end : b.st.avgR - a.st.avgR));

  const verdicts = cards.map((c) => verdict(c.st, c.row.recent));
  const works = verdicts.filter((v) => v === 'works').length;
  const top = cards[0];
  const leaders = bt.leaders.filter((l) => market === 'all' || l.x === market);
  const ruleName = (sys: string, id: string | null) => (id ? SYSTEMS[sys as SystemId].rules.find((r) => r.id === id)?.title ?? id : null);

  return (
    <div className="screen">
      <h1 className="screen-title">Odds</h1>
      <section className="card summary">
        <div className="eyebrow">
          {bt.from} → {bt.to} · M15 · spread included
        </div>
        {top?.money ? (
          <p className="summary-line">
            Best over the last {sim.years} year{sim.years > 1 ? 's' : ''} on {marketName(market)}: {SYSTEMS[top.sys].name}, {fmtMoney(top.money.start)} →{' '}
            <span className={top.money.profit >= 0 ? 'up-text' : 'down-text'}>{fmtMoney(top.money.end)}</span>.{' '}
            {works ? `${works} of ${cards.length} show a real edge.` : `None of the ${cards.length} shows a proven edge.`}
          </p>
        ) : (
          <p className="summary-line">{works ? `${works} of ${cards.length} systems show a real edge.` : `None of the ${cards.length} systems shows a proven edge.`}</p>
        )}
        <p className="hint">
          Every time a system’s rules were all met on a closed candle, it was traded: stop where the rules say, one trade at a time per system, a candle touching both
          stop and target counted as a loss. “Has an edge” means profitable, under 5% chance of luck, and still profitable in 2025–26.
        </p>
      </section>
      <SimBar />
      <div className="chip-row">
        {['all', ...INSTRUMENT_ORDER].map((x) => (
          <button key={x} className={market === x ? 'chip on' : 'chip'} onClick={() => setMarket(x)}>
            {x === 'all' ? 'All markets' : INSTRUMENTS[x as InstrumentId].name}
          </button>
        ))}
      </div>

      {leaders.length ? (
        <section className="card leaders">
          <div className="eyebrow">Best found · {bt.searched} combinations tested</div>
          <p className="hint">
            Every system × market × target, with each rule switched off in turn. These are the ones that made money both before 2025 and since, least likely to be luck first.
            Testing {bt.searched} versions and keeping the best always flatters the winner — treat these as leads to test live at 0.01, not proof.
          </p>
          <ol className="leader-list">
            {leaders.slice(0, 5).map((l, k) => (
              <li key={k}>
                <div className="leader-name">
                  <b>
                    {SYSTEMS[l.sys as SystemId].name} · {INSTRUMENTS[l.x as InstrumentId].name} · {l.target}R
                  </b>
                  <small>{l.off ? `without “${ruleName(l.sys, l.off)}”` : 'rules as written'}</small>
                </div>
                <div className="leader-nums">
                  <span>
                    <b className="up-text">{r2(l.all.avgR)}</b> per trade
                  </span>
                  <span>{pct(l.all.winRate)} win</span>
                  <span>{l.all.trades} trades</span>
                  <span>luck {l.all.pValue < 0.01 ? '<1' : Math.round(l.all.pValue * 100)}%</span>
                </div>
                <button
                  className="why-btn"
                  onClick={() => onTryInLab({ sys: l.sys, markets: [l.x], target: l.target, off: l.off ? [l.off] : [] })}
                >
                  Test it in the Lab with your money ›
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {!book ? <p className="hint center">Loading every trade for the money figures…</p> : null}
      {cards.map((c) => (
        <SystemCard key={c.sys} d={c} rows={bt.rows} market={market} years={sim.years} target={sim.target} />
      ))}
      <p className="foot">Past results don’t promise future ones. Practice tool, not financial advice.</p>
    </div>
  );
}
