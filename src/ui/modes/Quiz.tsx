import { useMemo, useState } from 'react';
import type { Drill } from '../../engine/codec';
import { SYSTEM_ORDER } from '../../engine/types';
import type { SystemId } from '../../engine/types';
import { recordAttempt } from '../../game/store';
import { Chart } from '../Chart';
import { Breakdown, dirName, Loading, OutcomeLine, revealLabel, sysName, TopBar, useDrill, usePlayForward, usePracticeClock } from '../common';
import { revealOverlays } from '../overlays';
import { RoundEnd } from './RoundEnd';

const isRight = (d: Drill, s: SystemId) => s === d.s || !!d.a?.includes(s);

/** Exam: name the system on each chart. Answers are only shown at the end. */
export function Quiz({ drills, onExit }: { drills: Drill[]; onExit: () => void }) {
  const [answers, setAnswers] = useState<SystemId[]>([]);
  const [review, setReview] = useState<number | null>(null);
  const k = answers.length;

  if (review !== null) return <QuizReview d={drills[review]} answer={answers[review]} onBack={() => setReview(null)} />;

  if (k >= drills.length) {
    const ok = drills.filter((d, j) => isRight(d, answers[j])).length;
    return (
      <RoundEnd title="Exam" ok={ok} total={drills.length} xp={ok * 10 - (drills.length - ok) * 5} onExit={onExit}>
        <ul className="quiz-list">
          {drills.map((d, j) => {
            const good = isRight(d, answers[j]);
            return (
              <li key={d.id}>
                <button className={good ? 'qrow good' : 'qrow bad'} onClick={() => setReview(j)}>
                  <span className="qn">{j + 1}</span>
                  <span className="qtext">
                    {good ? sysName(d.s) : (
                      <>
                        <s>{sysName(answers[j])}</s> → {sysName(d.s)}
                      </>
                    )}
                  </span>
                  <span className="qgo">Review ›</span>
                </button>
              </li>
            );
          })}
        </ul>
      </RoundEnd>
    );
  }

  const d = drills[k];
  return (
    <QuizOne
      key={d.id}
      d={d}
      step={k}
      total={drills.length}
      onExit={onExit}
      onAnswer={(s) => {
        const good = isRight(d, s);
        recordAttempt({ id: d.id, sys: d.s, mode: 'quiz', ok: good }, good ? 10 : -5);
        setAnswers([...answers, s]);
      }}
    />
  );
}

function QuizOne({ d, step, total, onExit, onAnswer }: { d: Drill; step: number; total: number; onExit: () => void; onAnswer: (s: SystemId) => void }) {
  const ld = useDrill(d);
  usePracticeClock(d.id, !!ld);
  return (
    <div className="drill">
      <TopBar title="Exam · all 4 systems" step={step} total={total} onExit={onExit} />
      <div className="chart-wrap">
        {ld ? <Chart s={ld.w.s} upto={ld.w.li} digits={ld.w.digits} showDate={false} /> : <Loading />}
        <div className="chart-label">M15 · date hidden</div>
      </div>
      <div className="panel">
        <p className="prompt">The last candle is a setup. Which system is it?</p>
        <div className="sys-grid">
          {SYSTEM_ORDER.map((s) => (
            <button key={s} className={`btn sys sys-${s}`} disabled={!ld} onClick={() => onAnswer(s)}>
              {sysName(s)}
            </button>
          ))}
        </div>
        <p className="hint">Answers at the end, like a real test.</p>
      </div>
    </div>
  );
}

function QuizReview({ d, answer, onBack }: { d: Drill; answer: SystemId; onBack: () => void }) {
  const ld = useDrill(d);
  const end = ld ? Math.min(ld.w.s.c.length - 1, ld.out ? ld.out.exitIndex + 6 : ld.w.li + 40) : 0;
  const upto = usePlayForward(ld?.w.li ?? 0, end, !!ld);
  const ov = useMemo(() => (ld ? revealOverlays(ld.e, ld.out, true) : null), [ld]);
  const good = isRight(d, answer);
  return (
    <div className="drill">
      <TopBar title="Review" onExit={onBack} />
      <div className="chart-wrap">
        {ld ? <Chart s={ld.w.s} upto={upto} digits={ld.w.digits} showDate {...(ov ?? {})} /> : <Loading />}
        <div className="chart-label">{ld ? revealLabel(ld.w) : ''}</div>
      </div>
      <div className="panel">
        <div className={good ? 'verdict good' : 'verdict bad'}>
          <span className="verdict-icon">{good ? '✓' : '✗'}</span>
          <span>
            You said {sysName(answer)}. It was {sysName(d.s)}, {dirName(d.d).toLowerCase()}
            {d.a?.length ? ` (also a valid ${d.a.map(sysName).join(', ')})` : ''}.
          </span>
        </div>
        <OutcomeLine out={ld?.out ?? null} />
        {ld?.e ? <Breakdown e={ld.e} /> : null}
        <button className="btn primary wide" onClick={onBack}>Back to results</button>
      </div>
    </div>
  );
}
