import { SYSTEMS } from '../../engine/systems';
import type { Library } from '../../data/load';
import { money } from '../../game/account';
import { dueIds } from '../../game/pick';
import { currentSystem, DAILY_GOAL_SEC, level, levelFloor, MASTERY_SCORE, MASTERY_WINDOW, streakDays, systemProgress } from '../../game/progress';
import { dayKey, lossLimitHit, todayPnl, useGame } from '../../game/store';
import type { Mode } from '../../game/store';

export interface StartOpts {
  mode: Mode;
  review?: boolean;
}

const MODES: { mode: Mode; name: string; blurb: string; icon: string; trades?: boolean }[] = [
  { mode: 'spot', name: 'Spot it', blurb: 'Buy, sell or no trade? Fast reps, instant answers.', icon: '◎' },
  { mode: 'replay', name: 'Replay', blurb: 'Candles arrive one by one. Pull the trigger at the right close.', icon: '▶', trades: true },
  { mode: 'checklist', name: 'Checklist', blurb: 'Tick every rule on a real chart. Each tick is graded.', icon: '☑' },
  { mode: 'place', name: 'Place it', blurb: 'Set the stop, target and lot size. Scored on the order.', icon: '⌖', trades: true },
  { mode: 'quiz', name: 'Exam', blurb: '10 charts, one per system, 4 choices each. Score at the end.', icon: '✎' },
];

export function Home({ lib, onStart }: { lib: Library; onStart: (o: StartOpts) => void }) {
  const s = useGame();
  const prog = systemProgress(s);
  const cur = currentSystem(s);
  const due = dueIds(lib, s).length;
  const secs = s.practice[dayKey()] ?? 0;
  const ring = Math.min(1, secs / DAILY_GOAL_SEC);
  const lv = level(s.xp);
  const lvPct = (s.xp - levelFloor(lv)) / (levelFloor(lv + 1) - levelFloor(lv));
  const streak = streakDays(s);
  const limited = lossLimitHit(s);
  const pnl = todayPnl(s);

  return (
    <div className="screen home">
      <header className="home-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 4v16M5 8h3v8H5M12 2v20M12 6h3v6h-3M19 6v14M19 10h-3v6h3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          </span>
          Candlechase
        </div>
        <div className="head-stats">
          <span className="pill" title="Days in a row">🔥 {streak}</span>
          <span className="pill lv">
            Lv {lv}
            <span className="lv-bar"><span style={{ width: `${Math.round(lvPct * 100)}%` }} /></span>
          </span>
        </div>
      </header>

      <section className="today card">
        <div className="ring" style={{ ['--p' as string]: ring }}>
          <span>{Math.floor(secs / 60)}<small>/15m</small></span>
        </div>
        <div className="today-text">
          <div className="eyebrow">Today</div>
          <div className="today-line">{ring >= 1 ? 'Goal done. Extra reps are a bonus.' : `${Math.max(1, Math.ceil((DAILY_GOAL_SEC - secs) / 60))} min to today’s goal`}</div>
          <div className="today-sub">15 minutes, every day, beats 2 hours on Sunday.</div>
        </div>
      </section>

      <section className="card focus">
        {cur ? (
          <>
            <div className="eyebrow">Now mastering</div>
            <div className={`focus-name sys-text-${cur.sys}`}>{SYSTEMS[cur.sys].name}</div>
            <div className="focus-tag">{SYSTEMS[cur.sys].tagline}</div>
            <div className="meter">
              <div className="meter-fill" style={{ width: `${Math.round(cur.recent * 100)}%` }} />
              <div className="meter-goal" style={{ left: `${MASTERY_SCORE * 100}%` }} />
            </div>
            <div className="meter-legend">
              <span>
                {Math.round(cur.recent * 100)}% over last {cur.recentCount}/{MASTERY_WINDOW}
              </span>
              <span>Unlock next at 80% over 50</span>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">All four mastered</div>
            <div className="focus-name">Mixed mode</div>
            <div className="focus-tag">Every drill can be any system now. Timers are on. This is what live looks like.</div>
          </>
        )}
        <div className="ladder">
          {prog.map((p, k) => (
            <div key={p.sys} className={`rung ${p.mastered ? 'done' : p.unlocked ? 'open' : 'locked'}`}>
              <span className="rung-n">{p.mastered ? '✓' : p.unlocked ? k + 1 : '🔒'}</span>
              <span className="rung-name">{SYSTEMS[p.sys].name}</span>
            </div>
          ))}
        </div>
      </section>

      {due > 0 ? (
        <button className="card review" onClick={() => onStart({ mode: 'spot', review: true })}>
          <span className="review-n">{due}</span>
          <span className="review-text">
            <b>mistake{due === 1 ? '' : 's'} due for review</b>
            <small>Charts you got wrong come back after 1, 3 and 7 days.</small>
          </span>
          <span className="chev">›</span>
        </button>
      ) : null}

      <section className="modes">
        {MODES.map((m) => (
          <button key={m.mode} className={`mode-card mode-${m.mode}`} onClick={() => onStart({ mode: m.mode })} disabled={m.trades && limited}>
            <span className="mode-icon" aria-hidden>{m.icon}</span>
            <span className="mode-text">
              <b>{m.name}</b>
              <small>{m.trades && limited ? 'Daily loss limit hit — back tomorrow.' : m.blurb}</small>
            </span>
            <span className="chev">›</span>
          </button>
        ))}
      </section>

      <section className="card account">
        <div>
          <div className="eyebrow">Practice account</div>
          <div className="acct-bal">{money(s.balance)}</div>
        </div>
        <div className="acct-right">
          <div className={pnl >= 0 ? 'up-text' : 'down-text'}>{pnl >= 0 ? '+' : ''}{money(pnl)} today</div>
          <small>Stops trading at −{s.settings.dailyLossPct}% a day</small>
        </div>
      </section>
    </div>
  );
}
