import { useMemo, useState } from 'react';
import type { Drill } from '../../engine/codec';
import { SYSTEMS } from '../../engine/systems';
import type { SystemId } from '../../engine/types';
import { timerFor } from '../../game/progress';
import { getState, recordAttempt } from '../../game/store';
import { Chart } from '../Chart';
import { Breakdown, dirName, Loading, OutcomeLine, revealLabel, sysName, TopBar, useCountdown, useDrill, usePlayForward, usePracticeClock } from '../common';
import { cssVar, revealOverlays } from '../overlays';
import { RoundEnd } from './RoundEnd';

export function Checklist({ drills, onExit }: { drills: Drill[]; onExit: () => void }) {
  const [k, setK] = useState(0);
  const [score, setScore] = useState({ ok: 0, xp: 0 });
  const d = drills[k];
  if (!d) return <RoundEnd title="Checklist drill" ok={score.ok} total={drills.length} xp={score.xp} onExit={onExit} />;
  return (
    <ChecklistOne
      key={d.id}
      d={d}
      step={k}
      total={drills.length}
      onExit={onExit}
      onNext={(ok, xp) => {
        setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), xp: s.xp + xp }));
        setK(k + 1);
      }}
    />
  );
}

function ChecklistOne({ d, step, total, onExit, onNext }: { d: Drill; step: number; total: number; onExit: () => void; onNext: (ok: boolean, xp: number) => void }) {
  const ld = useDrill(d);
  const sys = d.s as SystemId;
  const def = SYSTEMS[sys];
  const [ticks, setTicks] = useState<Record<string, boolean | undefined>>({});
  const [decision, setDecision] = useState<'take' | 'skip' | 'timeout' | null>(null);
  const revealed = decision !== null;
  usePracticeClock(d.id, !!ld && !revealed);

  const chart = def.rules.filter((r) => r.kind === 'chart');
  const allTicked = chart.every((r) => ticks[r.id] !== undefined);
  const valid = d.k === 'v';
  const ok = decision === 'take' ? valid : decision === 'skip' ? !valid : false;
  const rulesRight = ld?.e ? chart.filter((r) => ticks[r.id] === ld.e!.pass[r.id]).length : 0;
  const xp = (ok ? 10 : -10) + rulesRight * 2;

  const decide = (x: 'take' | 'skip' | 'timeout') => {
    if (decision) return;
    setDecision(x);
    const good = x === 'take' ? valid : x === 'skip' ? !valid : false;
    const right = ld?.e ? chart.filter((r) => ticks[r.id] === ld.e!.pass[r.id]).length : 0;
    recordAttempt({ id: d.id, sys, mode: 'checklist', ok: good }, (good ? 10 : -10) + right * 2);
  };
  const timer = timerFor(getState(), sys);
  const left = useCountdown(timer === null ? null : timer + 25, !!ld && !revealed, () => decide('timeout'));

  const end = ld ? Math.min(ld.w.s.c.length - 1, ld.out ? ld.out.exitIndex + 6 : ld.w.li + 40) : 0;
  const upto = usePlayForward(ld?.w.li ?? 0, end, revealed);
  const ov = useMemo(() => (ld ? (revealed ? revealOverlays(ld.e, ld.out, true) : { marks: [{ i: ld.w.li, text: '?', color: cssVar('--accent'), above: d.d === -1 }] }) : null), [ld, revealed, d.d]);

  return (
    <div className="drill">
      <TopBar title="Checklist drill" step={step} total={total} onExit={onExit} right={left !== null && !revealed ? <span className={left <= 5 ? 'timer hot' : 'timer'}>{left}s</span> : null} />
      <div className="chart-wrap">
        {ld ? <Chart s={ld.w.s} upto={upto} digits={ld.w.digits} showDate={revealed} {...(ov ?? {})} /> : <Loading />}
        <div className="chart-label">{revealed && ld ? revealLabel(ld.w) : 'M15 · date hidden'}</div>
      </div>
      <div className="panel" key={revealed ? 'after' : 'before'}>
        {!revealed ? (
          <>
            <p className="prompt">
              Possible <b>{sysName(sys)}</b> · <span className={d.d === 1 ? 'up-text' : 'down-text'}>{dirName(d.d)}</span> on the last candle. Check each rule.
            </p>
            <ul className="rules ask">
              {def.rules.map((r) =>
                r.kind === 'live' ? (
                  <li key={r.id} className="rule live">
                    <span className="mark">•</span>
                    <div>
                      <div className="rule-title">{r.title}</div>
                      <div className="rule-sub">Live only</div>
                    </div>
                  </li>
                ) : (
                  <li key={r.id} className="rule">
                    <div className="rule-body">
                      <div className="rule-title">
                        {r.title}
                        {r.upgrade ? <span className="mini">upgrade</span> : null}
                      </div>
                      <div className="rule-sub">{r.sub}</div>
                    </div>
                    <div className="yn">
                      <button className={ticks[r.id] === true ? 'yn-btn yes on' : 'yn-btn yes'} onClick={() => setTicks({ ...ticks, [r.id]: true })} aria-label="Met">✓</button>
                      <button className={ticks[r.id] === false ? 'yn-btn no on' : 'yn-btn no'} onClick={() => setTicks({ ...ticks, [r.id]: false })} aria-label="Not met">✗</button>
                    </div>
                  </li>
                ),
              )}
            </ul>
            <div className="answer-row two">
              <button className="btn ghost" disabled={!ld || !allTicked} onClick={() => decide('skip')}>Skip it</button>
              <button className={`btn ${d.d === 1 ? 'buy' : 'sell'}`} disabled={!ld || !allTicked} onClick={() => decide('take')}>Take it</button>
            </div>
            {!allTicked ? <p className="hint">Answer every chart rule first.</p> : null}
          </>
        ) : (
          <>
            <div className={ok ? 'verdict good' : 'verdict bad'}>
              <span className="verdict-icon">{ok ? '✓' : '✗'}</span>
              <span>
                {decision === 'timeout' ? 'Out of time.' : ok ? (valid ? 'Right to take it.' : 'Right to skip it.') : valid ? 'This one was valid — every rule was met.' : 'This one broke a rule. Skip.'} You read {rulesRight}/{chart.length} rules right.
              </span>
            </div>
            <OutcomeLine out={ld?.out ?? null} prefix={valid ? 'Taken, this trade' : 'Had you taken it, it'} />
            {ld?.e ? <Breakdown e={ld.e} highlight={ticks} /> : null}
            <button className="btn primary wide" onClick={() => onNext(ok, xp)}>Next</button>
          </>
        )}
      </div>
    </div>
  );
}
