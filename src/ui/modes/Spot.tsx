import { useMemo, useState } from 'react';
import type { Drill } from '../../engine/codec';
import { ruleTitle } from '../../engine/systems';
import type { SystemId } from '../../engine/types';
import { timerFor, unlockedSystems } from '../../game/progress';
import { getState, recordAttempt } from '../../game/store';
import { Chart } from '../Chart';
import { Breakdown, dirName, Loading, nearestAt, OutcomeLine, revealLabel, sysName, TopBar, useCountdown, useDrill, usePlayForward, usePracticeClock } from '../common';
import { revealOverlays } from '../overlays';
import { RoundEnd } from './RoundEnd';

interface Answer {
  dir: 0 | 1 | -1;
  sys?: SystemId;
  timeout?: boolean;
}

export function Spot({ drills, onExit, title = 'Spot it' }: { drills: Drill[]; onExit: () => void; title?: string }) {
  const [k, setK] = useState(0);
  const [score, setScore] = useState({ ok: 0, xp: 0 });
  const d = drills[k];
  if (!d) return <RoundEnd title={title} ok={score.ok} total={drills.length} xp={score.xp} onExit={onExit} />;
  return (
    <SpotOne
      key={d.id}
      d={d}
      title={title}
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

function judge(d: Drill, a: Answer, single: boolean): boolean {
  if (a.timeout) return false;
  if (d.k !== 'v') return a.dir === 0;
  return a.dir === d.d && (single || a.sys === d.s || (!!a.sys && !!d.a?.includes(a.sys)));
}

function SpotOne({ d, title, step, total, onExit, onNext }: { d: Drill; title: string; step: number; total: number; onExit: () => void; onNext: (ok: boolean, xp: number) => void }) {
  const ld = useDrill(d);
  const systems = useMemo(() => unlockedSystems(getState()), []);
  const [pendingDir, setPendingDir] = useState<1 | -1 | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [ok, setOk] = useState(false);
  const revealed = answer !== null;
  const timer = d.k !== 'z' ? timerFor(getState(), d.s) : null;
  usePracticeClock(d.id, !!ld && !revealed);

  const submit = (a: Answer) => {
    if (answer) return;
    const good = judge(d, a, systems.length === 1);
    setAnswer(a);
    setOk(good);
    recordAttempt({ id: d.id, sys: d.s, mode: 'spot', ok: good }, good ? 10 : -5);
  };
  const left = useCountdown(timer, !!ld && !revealed, () => submit({ dir: 0, timeout: true }));

  const end = ld ? Math.min(ld.w.s.c.length - 1, ld.out ? ld.out.exitIndex + 6 : ld.w.li + 40) : 0;
  const upto = usePlayForward(ld?.w.li ?? 0, end, revealed);
  const ov = useMemo(() => (revealed && ld ? revealOverlays(ld.e, ld.out, d.k === 'v' || d.k === 'n') : null), [revealed, ld, d.k]);
  const nearest = useMemo(() => (revealed && ld && d.k === 'z' ? nearestAt(ld.w, ld.w.li) : null), [revealed, ld, d.k]);

  const pickDir = (dir: 1 | -1) => {
    if (systems.length === 1) submit({ dir, sys: systems[0] });
    else setPendingDir(dir);
  };

  let verdict = '';
  if (answer) {
    if (answer.timeout) verdict = 'Too slow. Live, the candle is gone.';
    else if (d.k === 'v') verdict = ok ? `Right — ${sysName(d.s)}, ${dirName(d.d).toLowerCase()}.` : answer.dir === 0 ? `Missed it. This was a clean ${sysName(d.s)} ${dirName(d.d).toLowerCase()}.` : `It was ${sysName(d.s)}, ${dirName(d.d).toLowerCase()}.`;
    else if (d.k === 'n') verdict = ok ? `Right to skip. “${ruleTitle(d.s as SystemId, d.f!)}” was not met.` : `Not a trade. “${ruleTitle(d.s as SystemId, d.f!)}” was not met.`;
    else verdict = ok ? 'Right — nothing here.' : 'Nothing here. No system triggered on this candle.';
  }

  return (
    <div className="drill">
      <TopBar
        title={title}
        step={step}
        total={total}
        onExit={onExit}
        right={left !== null && !revealed ? <span className={left <= 5 ? 'timer hot' : 'timer'}>{left}s</span> : null}
      />
      <div className="chart-wrap">
        {ld ? (
          <Chart s={ld.w.s} upto={upto} digits={ld.w.digits} showDate={revealed} {...(ov ?? {})} />
        ) : (
          <Loading />
        )}
        <div className="chart-label">{revealed && ld ? revealLabel(ld.w) : 'M15 · date hidden'}</div>
      </div>
      <div className="panel" key={revealed ? 'after' : 'before'}>
        {!revealed ? (
          pendingDir === null ? (
            <>
              <p className="prompt">This candle just closed. What do you do?</p>
              <div className="answer-row">
                <button className="btn buy" disabled={!ld} onClick={() => pickDir(1)}>Buy</button>
                <button className="btn ghost" disabled={!ld} onClick={() => submit({ dir: 0 })}>No trade</button>
                <button className="btn sell" disabled={!ld} onClick={() => pickDir(-1)}>Sell</button>
              </div>
            </>
          ) : (
            <>
              <p className="prompt">
                {dirName(pendingDir)} — which system?
                <button className="link" onClick={() => setPendingDir(null)}>change</button>
              </p>
              <div className="sys-grid">
                {systems.map((s) => (
                  <button key={s} className={`btn sys sys-${s}`} onClick={() => submit({ dir: pendingDir, sys: s })}>
                    {sysName(s)}
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <div className={ok ? 'verdict good' : 'verdict bad'}>
              <span className="verdict-icon">{ok ? '✓' : '✗'}</span>
              <span>{verdict}</span>
            </div>
            {d.k === 'n' && ld?.out && ld.out.rNet > 0 ? (
              <p className="note">It would have won anyway. A win that broke a rule is luck you can’t repeat — it still counts as a mistake.</p>
            ) : null}
            {ld?.e ? <OutcomeLine out={ld.out} prefix={d.k === 'v' ? 'Taken, this trade' : 'Had you taken it, it'} /> : null}
            {ld?.e ? <Breakdown e={ld.e} /> : null}
            {d.k === 'z' ? (
              <p className="note">
                {nearest
                  ? `Closest thing: a ${sysName(nearest.sys)} ${dirName(nearest.dir).toLowerCase()} missing ${nearest.failed.length} rule${nearest.failed.length === 1 ? '' : 's'}.`
                  : 'No system has even a trigger candle here. Most charts look like this — waiting is the job.'}
              </p>
            ) : null}
            <button className="btn primary wide" onClick={() => onNext(ok, ok ? 10 : -5)}>
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
