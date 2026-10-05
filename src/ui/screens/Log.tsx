import { useState } from 'react';
import { SYSTEMS } from '../../engine/systems';
import { INSTRUMENTS, INSTRUMENT_ORDER, SYSTEM_ORDER } from '../../engine/types';
import type { InstrumentId, SystemId } from '../../engine/types';
import { LOTS } from '../../game/account';
import { update, useGame } from '../../game/store';
import type { LiveTrade } from '../../game/store';

const GATE_TRADES = 30;
const GATE_SCORE = 0.9;

const followedAll = (t: LiveTrade) => {
  const rules = SYSTEMS[t.sys as SystemId]?.rules ?? [];
  return rules.every((r) => t.rules[r.id]);
};

export function Log() {
  const s = useGame();
  const [adding, setAdding] = useState(false);
  const last = s.live.slice(-GATE_TRADES);
  const follow = last.length ? last.filter(followedAll).length / last.length : null;
  const gateOpen = last.length >= GATE_TRADES && (follow ?? 0) >= GATE_SCORE;
  const quiz = s.attempts.slice(-50);
  const quizAcc = quiz.length ? quiz.filter((a) => a.ok).length / quiz.length : null;
  const liveR = s.live.filter((t) => t.r !== null).reduce((a, t) => a + (t.r ?? 0), 0);

  if (adding) return <AddTrade onDone={() => setAdding(false)} />;

  return (
    <div className="screen">
      <h1 className="screen-title">Live log</h1>
      <section className="card">
        <div className="eyebrow">Does the practice carry over?</div>
        <div className="acct-grid">
          <div><b>{quizAcc === null ? '—' : `${Math.round(quizAcc * 100)}%`}</b><small>game accuracy, last 50</small></div>
          <div><b>{follow === null ? '—' : `${Math.round(follow * 100)}%`}</b><small>live trades by the rules, last {last.length}</small></div>
          <div><b className={liveR >= 0 ? 'up-text' : 'down-text'}>{liveR >= 0 ? '+' : ''}{liveR.toFixed(1)}R</b><small>live result</small></div>
        </div>
        <div className={gateOpen ? 'gate open' : 'gate'}>
          {gateOpen
            ? `Gate open: ${Math.round((follow ?? 0) * 100)}% of your last ${GATE_TRADES} live trades followed every rule. You can consider 0.02.`
            : `Stay at 0.01 lots until 90% of ${GATE_TRADES} live trades in a row follow every rule. Now: ${last.length}/${GATE_TRADES} logged${follow !== null ? `, ${Math.round(follow * 100)}% clean` : ''}. Game scores don’t count.`}
        </div>
      </section>

      <button className="btn primary wide" onClick={() => setAdding(true)}>Log a live trade</button>

      <ul className="live-list">
        {s.live
          .slice()
          .reverse()
          .map((t) => {
            const rules = SYSTEMS[t.sys as SystemId]?.rules ?? [];
            const met = rules.filter((r) => t.rules[r.id]).length;
            return (
              <li key={t.id} className="live-item">
                <div>
                  <b>{INSTRUMENTS[t.x as InstrumentId]?.name ?? t.x}</b> · {SYSTEMS[t.sys as SystemId]?.name} ·{' '}
                  <span className={t.dir === 1 ? 'up-text' : 'down-text'}>{t.dir === 1 ? 'Buy' : 'Sell'}</span> · {t.lots.toFixed(2)}
                  <small>
                    {new Date(t.at).toLocaleString()} · {met}/{rules.length} rules {met === rules.length ? '✓' : '✗'}
                    {t.note ? ` · ${t.note}` : ''}
                  </small>
                </div>
                <div className="live-right">
                  <span className={t.r === null ? '' : t.r >= 0 ? 'up-text' : 'down-text'}>{t.r === null ? 'open' : `${t.r >= 0 ? '+' : ''}${t.r}R`}</span>
                  <button
                    className="link"
                    onClick={() => {
                      if (confirm('Delete this entry?')) update((st) => ({ live: st.live.filter((x) => x.id !== t.id) }));
                    }}
                  >
                    delete
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
      {!s.live.length ? <p className="hint center">Log every real trade here — the honest record is what tells you if the training works.</p> : null}
    </div>
  );
}

function AddTrade({ onDone }: { onDone: () => void }) {
  const [x, setX] = useState<InstrumentId>('eurusd');
  const [sys, setSys] = useState<SystemId>('ema');
  const [dir, setDir] = useState<1 | -1>(1);
  const [lots, setLots] = useState(0.01);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [r, setR] = useState('');
  const [note, setNote] = useState('');

  const save = () => {
    const t: LiveTrade = { id: `${Date.now()}`, at: Date.now(), x, sys, dir, lots, rules, r: r.trim() === '' || !Number.isFinite(Number(r)) ? null : Number(r), note: note.trim() };
    update((st) => ({ live: [...st.live, t] }));
    onDone();
  };

  return (
    <div className="screen">
      <h1 className="screen-title">
        <button className="link" onClick={onDone}>‹ Back</button> Log a live trade
      </h1>
      <section className="card form">
        <div className="chip-row">
          {INSTRUMENT_ORDER.map((i) => (
            <button key={i} className={x === i ? 'chip on' : 'chip'} onClick={() => setX(i)}>{INSTRUMENTS[i].name}</button>
          ))}
        </div>
        <div className="chip-row">
          {SYSTEM_ORDER.map((i) => (
            <button key={i} className={sys === i ? 'chip on' : 'chip'} onClick={() => { setSys(i); setRules({}); }}>{SYSTEMS[i].name}</button>
          ))}
        </div>
        <div className="chip-row">
          <button className={dir === 1 ? 'chip on buy' : 'chip'} onClick={() => setDir(1)}>Buy</button>
          <button className={dir === -1 ? 'chip on sell' : 'chip'} onClick={() => setDir(-1)}>Sell</button>
          {LOTS.map((l) => (
            <button key={l} className={lots === l ? 'chip on' : 'chip'} onClick={() => setLots(l)}>{l.toFixed(2)}</button>
          ))}
        </div>
        <div className="eyebrow">Be honest — which rules did you really check?</div>
        <ul className="rules ask">
          {SYSTEMS[sys].rules.map((rule) => (
            <li key={rule.id} className={rules[rule.id] ? 'rule pass tap' : 'rule tap'} onClick={() => setRules({ ...rules, [rule.id]: !rules[rule.id] })}>
              <span className="mark">{rules[rule.id] ? '✓' : '○'}</span>
              <div className="rule-title">{rule.title}</div>
            </li>
          ))}
        </ul>
        <label>
          Result in R (blank if still open)
          <input inputMode="decimal" value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. 2 or -1" />
        </label>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
        <button className="btn primary wide" onClick={save}>Save</button>
      </section>
    </div>
  );
}
