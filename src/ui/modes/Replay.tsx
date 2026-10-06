import { useEffect, useMemo, useState } from 'react';
import type { Drill } from '../../engine/codec';
import { simulate } from '../../engine/outcome';
import { INSTRUMENTS } from '../../engine/types';
import type { Dir, Evaluation, InstrumentId, Outcome } from '../../engine/types';
import { LOTS, money, pnl } from '../../game/account';
import { unlockedSystems } from '../../game/progress';
import { getState, lossLimitHit, recordAttempt, recordTrade } from '../../game/store';
import { Chart } from '../Chart';
import type { BarMark } from '../Chart';
import { bestAt, Breakdown, forceFor, useFocus, dirName, Loading, OutcomeLine, revealLabel, sysName, TopBar, useDrill, usePlayForward, usePracticeClock } from '../common';
import { cssVar, revealOverlays } from '../overlays';
import { LimitHit } from './LimitHit';
import { RoundEnd } from './RoundEnd';

const LEAD = 50;
const AFTER = 12;

export function Replay({ drills, onExit }: { drills: Drill[]; onExit: () => void }) {
  const [k, setK] = useState(0);
  const [score, setScore] = useState({ ok: 0, xp: 0 });
  const [blocked, setBlocked] = useState(() => lossLimitHit(getState()));
  const d = drills[k];
  if (blocked) return <LimitHit onExit={onExit} />;
  if (!d) return <RoundEnd title="Replay" ok={score.ok} total={drills.length} xp={score.xp} onExit={onExit} />;
  return (
    <ReplayOne
      key={d.id}
      d={d}
      step={k}
      total={drills.length}
      onExit={onExit}
      onNext={(ok, xp) => {
        setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), xp: s.xp + xp }));
        setBlocked(lossLimitHit(getState()));
        setK(k + 1);
      }}
    />
  );
}

interface Result {
  /** candle where you entered, or null if you waited it out */
  at: number | null;
  dir: Dir | 0;
  e: Evaluation | null;
  ok: boolean;
  out: Outcome | null;
  money: number;
  xp: number;
}

function ReplayOne({ d, step, total, onExit, onNext }: { d: Drill; step: number; total: number; onExit: () => void; onNext: (ok: boolean, xp: number) => void }) {
  const ld = useDrill(d);
  const systems = useMemo(() => unlockedSystems(getState()), []);
  const [cur, setCur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [lots, setLots] = useState(0.01);
  const [res, setRes] = useState<Result | null>(null);
  usePracticeClock(d.id, !!ld && !res);

  const start = ld ? ld.w.li - LEAD : 0;
  const stopAt = ld ? ld.w.li + AFTER : 0;
  const now = cur ?? start;

  useEffect(() => {
    if (!playing || res) return;
    const id = setInterval(() => setCur((c) => Math.min(stopAt, (c ?? start) + 1)), 700);
    return () => clearInterval(id);
  }, [playing, res, start, stopAt]);

  const finishWait = () => {
    if (!ld || res) return;
    const ok = d.k !== 'v';
    const xp = ok ? 10 : -10;
    recordAttempt({ id: d.id, sys: d.s, mode: 'replay', ok }, xp);
    setRes({ at: null, dir: 0, e: ld.e, ok, out: ld.out, money: 0, xp });
  };

  useEffect(() => {
    if (ld && now >= stopAt && !res) {
      setPlaying(false);
      finishWait();
    }
  }, [now, stopAt, ld, res]);

  const enter = (dir: Dir) => {
    if (!ld || res) return;
    setPlaying(false);
    const i = now;
    const e = bestAt(ld.w, i, dir, systems);
    const clean = !!e?.valid;
    const atr = ld.w.s.atr[i];
    const entry = ld.w.s.c[i];
    const stop = e?.candidate ? e.stop : entry - dir * atr;
    const target = e?.candidate ? e.target : entry + dir * 2 * atr;
    const out = simulate(ld.w.s, i, dir, entry, stop, target, INSTRUMENTS[d.x as InstrumentId].spread);
    const m = pnl(getState(), d.x, dir, entry, out.exitPrice, lots);
    const xp = clean ? 10 + (out.rNet > 0 ? 5 : 0) : -20;
    recordTrade({ drill: d.id, x: d.x, sys: e?.sys ?? '', dir, lots, r: out.rNet, pnl: m, clean });
    recordAttempt({ id: d.id, sys: d.s, mode: 'replay', ok: clean }, xp);
    setRes({ at: i, dir, e: e?.candidate ? e : null, ok: clean, out, money: m, xp });
  };

  const from = res ? (res.at ?? stopAt) : now;
  const end = ld ? Math.min(ld.w.s.c.length - 1, res?.out ? Math.max(res.out.exitIndex + 6, from) : from + 30) : 0;
  const upto = usePlayForward(from, end, !!res);

  const [focus, onFocus] = useFocus();
  const overlays = useMemo(() => {
    if (!res || !ld) return null;
    if (res.at !== null) {
      const ov = res.e
        ? revealOverlays(res.e, res.out, true)
        : { lines: [], marks: [] as BarMark[], divergence: undefined, shade: undefined };
      if (!res.e) ov.marks.push({ i: res.at, text: 'You', color: cssVar('--accent'), above: res.dir === -1 });
      if (d.k === 'v' && res.at !== ld.w.li) ov.marks.push({ i: ld.w.li, text: 'Setup', color: cssVar('--warn'), above: d.d === -1 });
      return ov;
    }
    return revealOverlays(ld.e, ld.out, d.k === 'v');
  }, [res, ld, d]);

  let verdict = '';
  if (res) {
    if (res.at === null) verdict = d.k === 'v' ? `Missed it — a ${sysName(d.s)} ${dirName(d.d).toLowerCase()} triggered and you let it go.` : 'Right to wait. The setup that formed here broke a rule.';
    else if (res.ok) verdict = `Clean entry — ${sysName(res.e!.sys)}, every rule met.`;
    else if (res.e) verdict = `Rule break. Closest match: ${sysName(res.e.sys)}, missing ${res.e.failed.length} rule${res.e.failed.length === 1 ? '' : 's'}.`;
    else verdict = 'No setup on that candle. No system had its trigger.';
  }

  return (
    <div className="drill">
      <TopBar title="Replay" step={step} total={total} onExit={onExit} />
      <div className="chart-wrap">
        {ld ? <Chart s={ld.w.s} upto={res ? upto : now} digits={ld.w.digits} showDate={!!res} {...(overlays ?? {})} focus={focus} force={res ? forceFor(res.e?.sys ?? d.s) : []} /> : <Loading />}
        <div className="chart-label">{res && ld ? revealLabel(ld.w) : `M15 · candle ${Math.max(0, now - start + 1)} of ${LEAD + AFTER + 1}`}</div>
      </div>
      <div className="panel" key={res ? 'after' : 'before'}>
        {!res ? (
          <>
            <p className="prompt">Candles arrive one at a time. Enter only when a setup closes — or let it go.</p>
            <div className="replay-row">
              <button className="btn ghost" disabled={!ld} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
              <button className="btn ghost" disabled={!ld || playing} onClick={() => setCur(Math.min(stopAt, now + 1))}>Next candle</button>
            </div>
            <div className="answer-row two">
              <button className="btn buy" disabled={!ld} onClick={() => enter(1)}>Buy</button>
              <button className="btn sell" disabled={!ld} onClick={() => enter(-1)}>Sell</button>
            </div>
            <div className="lot-row">
              {LOTS.map((l) => (
                <button key={l} className={lots === l ? 'chip on' : 'chip'} onClick={() => setLots(l)}>{l.toFixed(2)}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className={res.ok ? 'verdict good' : 'verdict bad'}>
              <span className="verdict-icon">{res.ok ? '✓' : '✗'}</span>
              <span>{verdict}</span>
            </div>
            {res.at !== null ? (
              <>
                <OutcomeLine out={res.out} prefix="Your trade" />
                <p className={res.money >= 0 ? 'money up-text' : 'money down-text'}>{money(res.money)} on the account</p>
                {!res.ok && res.out && res.out.rNet > 0 ? <p className="note">It won, but it broke the rules — that is a bad trade with a lucky ending. Scored as a mistake.</p> : null}
              </>
            ) : (
              <OutcomeLine out={ld?.out ?? null} prefix={d.k === 'v' ? 'Taken, it' : 'Had you taken it, it'} />
            )}
            {res.e && ld ? <Breakdown e={res.e} w={ld.w} wrong={!res.ok} onFocus={onFocus} /> : null}
            <button className="btn primary wide" onClick={() => onNext(res.ok, res.xp)}>Next</button>
          </>
        )}
      </div>
    </div>
  );
}
