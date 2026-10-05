import { useRef, useState } from 'react';
import type { BacktestRow } from '../../engine/codec';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../../engine/types';
import type { InstrumentId, SystemId } from '../../engine/types';
import type { Library } from '../../data/load';
import { money, valuePerUnit } from '../../game/account';
import { systemProgress } from '../../game/progress';
import { exportState, importState, resetAll, update, useGame } from '../../game/store';
import type { Mode } from '../../game/store';

const MODE_NAMES: Record<Mode, string> = { spot: 'Spot it', replay: 'Replay', checklist: 'Checklist', place: 'Place it', quiz: 'Exam' };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (k: number) => (k / (values.length - 1)) * 100;
  const y = (v: number) => 28 - ((v - min) / span) * 26;
  const d = values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values[values.length - 1];
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="spark-zero" />
      <path d={d} className={last >= 0 ? 'spark-up' : 'spark-down'} />
    </svg>
  );
}

function BacktestCard({ sys, rows }: { sys: SystemId; rows: BacktestRow[] }) {
  const all = rows.reduce((a, r) => ({ trades: a.trades + r.trades, total: a.total + r.totalR }), { trades: 0, total: 0 });
  const avg = all.trades ? all.total / all.trades : 0;
  const verdict = all.trades < 30 ? 'Too few trades to judge' : avg > 0.1 ? 'Has had an edge' : avg > 0 ? 'Barely positive — thin edge' : 'Lost money after spread';
  return (
    <div className="bt-card">
      <div className="bt-head">
        <b className={`sys-text-${sys}`}>{SYSTEMS[sys].name}</b>
        <span className={avg > 0 ? 'tag ok' : 'tag bad'}>{verdict}</span>
      </div>
      <table className="bt">
        <thead>
          <tr>
            <th>Market</th>
            <th>Trades</th>
            <th>Win</th>
            <th>Avg</th>
            <th>Total</th>
            <th>Worst run</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.x}>
              <td>{INSTRUMENTS[r.x as InstrumentId].name}</td>
              <td>{r.trades}</td>
              <td>{Math.round(r.winRate * 100)}%</td>
              <td className={r.avgR >= 0 ? 'up-text' : 'down-text'}>{r.avgR >= 0 ? '+' : ''}{r.avgR.toFixed(2)}R</td>
              <td className={r.totalR >= 0 ? 'up-text' : 'down-text'}>{r.totalR >= 0 ? '+' : ''}{r.totalR.toFixed(0)}R</td>
              <td>{r.maxLosingStreak} losses</td>
              <td className="spark-cell"><Spark values={r.curve} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stats({ lib }: { lib: Library }) {
  const s = useGame();
  const prog = systemProgress(s);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const modes = (Object.keys(MODE_NAMES) as Mode[]).map((m) => {
    const a = s.attempts.filter((x) => x.mode === m);
    const last = a.slice(-50);
    return { m, n: a.length, acc: last.length ? last.filter((x) => x.ok).length / last.length : null };
  });
  const clean = s.trades.length ? s.trades.filter((t) => t.clean).length / s.trades.length : null;
  const bt = lib.backtest;

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `candlechase-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Stats</h1>

      <section className="card">
        <div className="eyebrow">Your skill</div>
        {prog.map((p) => (
          <div key={p.sys} className="skill-row">
            <div className="skill-name">
              <span className={`sys-dot sys-${p.sys}`} />
              {SYSTEMS[p.sys].name}
              <small>{p.mastered ? 'mastered' : p.unlocked ? `${p.recentCount}/50` : 'locked'}</small>
            </div>
            <div className="meter small">
              <div className="meter-fill" style={{ width: `${Math.round(p.recent * 100)}%` }} />
              <div className="meter-goal" style={{ left: '80%' }} />
            </div>
            <span className="skill-pct">{p.recentCount ? `${Math.round(p.recent * 100)}%` : '—'}</span>
          </div>
        ))}
        <div className="mode-stats">
          {modes.map((m) => (
            <div key={m.m}>
              <b>{m.acc === null ? '—' : `${Math.round(m.acc * 100)}%`}</b>
              <small>{MODE_NAMES[m.m]} · {m.n}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Practice account</div>
        <div className="acct-grid">
          <div><b>{money(s.balance)}</b><small>balance</small></div>
          <div><b>{s.trades.length}</b><small>trades</small></div>
          <div><b>{clean === null ? '—' : `${Math.round(clean * 100)}%`}</b><small>by the rules</small></div>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Do the systems work?</div>
        <p className="hint">
          Every valid setup from {bt.from} to {bt.to}, one trade at a time per system, stop as the rules say, target 2R, spread included. If a candle
          touched both the stop and the target, it counts as a loss. Past results are not a promise — this shows which systems deserve your attention.
        </p>
        {SYSTEM_ORDER.map((sys) => (
          <BacktestCard key={sys} sys={sys} rows={INSTRUMENT_ORDER.map((x) => bt.rows.find((r) => r.sys === sys && r.x === x)).filter((r): r is BacktestRow => !!r)} />
        ))}
      </section>

      <section className="card settings">
        <div className="eyebrow">Settings</div>
        <label>
          Daily loss limit (% of account)
          <input type="number" min={1} max={10} step={0.5} value={s.settings.dailyLossPct} onChange={(e) => update((st) => ({ settings: { ...st.settings, dailyLossPct: Number(e.target.value) || 3 } }))} />
        </label>
        <label>
          Practice account balance ($)
          <input type="number" min={50} step={50} value={s.balance} onChange={(e) => update(() => ({ balance: Number(e.target.value) || 1000 }))} />
        </label>
        {INSTRUMENT_ORDER.map((x) => (
          <label key={x}>
            {INSTRUMENTS[x].name}: $ per 1.0 price move at 1.00 lot
            <input
              type="number"
              min={0}
              step="any"
              value={valuePerUnit(s, x)}
              onChange={(e) => update((st) => ({ settings: { ...st.settings, valuePerUnit: { ...st.settings.valuePerUnit, [x]: Number(e.target.value) || INSTRUMENTS[x].valuePerUnit } } }))}
            />
          </label>
        ))}
        <p className="hint">EURUSD 100000 = $10 a pip. Gold 100 = $1 per $0.01 at 1 lot (100 oz). NAS100 differs a lot by broker — check yours.</p>
        <div className="btn-row">
          <button className="btn ghost" onClick={download}>Save progress file</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Load progress file</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                importState(await f.text());
                setMsg('Progress loaded.');
              } catch (err) {
                setMsg((err as Error).message);
              }
            }}
          />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Erase all progress, trades and the live log?')) resetAll();
            }}
          >
            Reset everything
          </button>
        </div>
        {msg ? <p className="hint">{msg}</p> : null}
      </section>
      <p className="foot">Data: Dukascopy M15 bid candles. Practice tool, not financial advice.</p>
    </div>
  );
}
