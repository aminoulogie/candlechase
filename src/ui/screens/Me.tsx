import { useRef, useState } from 'react';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER } from '../../engine/types';
import { money, valuePerUnit } from '../../game/account';
import { systemProgress } from '../../game/progress';
import { exportState, importState, resetAll, update, useGame } from '../../game/store';
import { ConfirmButton } from '../common';
import type { Mode } from '../../game/store';

const MODE_NAMES: Record<Mode, string> = { spot: 'Spot it', replay: 'Replay', checklist: 'Checklist', place: 'Place it', quiz: 'Exam' };

/** Your progress, practice account, live log and settings. */
export function Me({ onOpenLog }: { onOpenLog: () => void }) {
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

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `candlechase-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Me</h1>

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
        <div className="eyebrow">Live trades</div>
        <p className="hint">Log real trades and see whether the game is carrying over to how you trade.</p>
        <button className="btn ghost wide" onClick={onOpenLog}>
          Open live log
        </button>
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
          <ConfirmButton className="btn danger" label="Reset everything" confirmLabel="Tap again to erase all progress" onConfirm={resetAll} />
        </div>
        {msg ? <p className="hint">{msg}</p> : null}
      </section>
      <p className="foot">Data: Dukascopy M15 bid candles. Practice tool, not financial advice.</p>
    </div>
  );
}
