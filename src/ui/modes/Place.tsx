import { useMemo, useState } from 'react';
import type { Drill } from '../../engine/codec';
import { simulate } from '../../engine/outcome';
import { INSTRUMENTS } from '../../engine/types';
import type { InstrumentId, Outcome } from '../../engine/types';
import { LOTS, money, pnl, riskMoney } from '../../game/account';
import { getState, lossLimitHit, recordAttempt, recordTrade, useGame } from '../../game/store';
import { Chart } from '../Chart';
import type { PriceMark } from '../Chart';
import { Breakdown, dirName, Loading, revealLabel, sysName, TopBar, useDrill, usePlayForward, usePracticeClock } from '../common';
import { cssVar, revealOverlays } from '../overlays';
import { LimitHit } from './LimitHit';
import { RoundEnd } from './RoundEnd';

export function Place({ drills, onExit }: { drills: Drill[]; onExit: () => void }) {
  const [k, setK] = useState(0);
  const [score, setScore] = useState({ ok: 0, xp: 0 });
  const [blocked, setBlocked] = useState(() => lossLimitHit(getState()));
  const d = drills[k];
  if (blocked) return <LimitHit onExit={onExit} />;
  if (!d) return <RoundEnd title="Place it" ok={score.ok} total={drills.length} xp={score.xp} onExit={onExit} />;
  return (
    <PlaceOne
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

interface Check {
  label: string;
  ok: boolean;
}

function PlaceOne({ d, step, total, onExit, onNext }: { d: Drill; step: number; total: number; onExit: () => void; onNext: (ok: boolean, xp: number) => void }) {
  const ld = useDrill(d);
  const st = useGame();
  const [stop, setStop] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [active, setActive] = useState<'stop' | 'target'>('stop');
  const [lots, setLots] = useState(0.01);
  const [result, setResult] = useState<{ checks: Check[]; ok: boolean; out: Outcome | null; money: number; xp: number } | null>(null);
  usePracticeClock(d.id, !!ld && !result);

  const e = ld?.e ?? null;
  const atr = ld ? ld.w.s.atr[ld.w.li] : 0;
  const digits = ld?.w.digits ?? 5;
  const entry = e?.entry ?? 0;
  const dir = d.d;

  const tap = (p: number) => {
    if (result) return;
    if (active === 'stop') {
      setStop(p);
      if (target === null) setActive('target');
    } else setTarget(p);
  };
  const nudge = (which: 'stop' | 'target', k: number) => {
    const step = Math.max(atr * 0.1, 10 ** -digits);
    if (which === 'stop') setStop((v) => (v ?? entry - dir * atr) + k * step);
    else setTarget((v) => (v ?? entry + dir * 2 * atr) + k * step);
  };

  const risk = stop !== null ? riskMoney(st, d.x, entry, stop, lots) : 0;
  const riskPct = st.balance > 0 ? (risk / st.balance) * 100 : 0;
  const rr = stop !== null && target !== null && entry !== stop ? (dir * (target - entry)) / Math.abs(entry - stop) : 0;

  const submit = () => {
    if (!ld || !e || stop === null || target === null) return;
    const side = dir * (entry - stop) > 0 && dir * (target - entry) > 0;
    const dist = Math.abs(entry - stop) / atr;
    const ref = Math.abs(entry - e.stop) / atr;
    const checks: Check[] = [
      { label: 'Stop and target on the right sides', ok: side },
      { label: `Stop has room (0.5–3 ATR) — yours ${dist.toFixed(1)} ATR`, ok: side && dist >= 0.5 && dist <= 3 },
      { label: `Stop where the system puts it (${ref.toFixed(1)} ATR, ±0.5)`, ok: side && Math.abs(dist - ref) <= 0.5 },
      { label: `Target at least 2× the risk — yours ${rr.toFixed(1)}×`, ok: rr >= 1.9 },
      { label: `Risk at most 2% of the account — yours ${riskPct.toFixed(1)}%`, ok: riskPct <= 2 },
    ];
    const ok = checks.every((c) => c.ok);
    const xp = ok ? 15 : -5 + 3 * checks.filter((c) => c.ok).length;
    let out: Outcome | null = null;
    let m = 0;
    if (side) {
      out = simulate(ld.w.s, ld.w.li, e.dir, entry, stop, target, INSTRUMENTS[d.x as InstrumentId].spread);
      m = pnl(getState(), d.x, dir, entry, out.exitPrice, lots);
      recordTrade({ drill: d.id, x: d.x, sys: d.s, dir, lots, r: out.rNet, pnl: m, clean: ok });
    }
    recordAttempt({ id: d.id, sys: d.s, mode: 'place', ok }, xp);
    setResult({ checks, ok, out, money: m, xp });
  };

  const end = ld ? Math.min(ld.w.s.c.length - 1, result?.out ? result.out.exitIndex + 6 : ld.w.li + 40) : 0;
  const upto = usePlayForward(ld?.w.li ?? 0, end, !!result);
  const lines = useMemo<PriceMark[]>(() => {
    if (!ld || !e) return [];
    const out: PriceMark[] = [{ price: entry, color: cssVar('--text'), title: 'Entry' }];
    if (stop !== null) out.push({ price: stop, color: cssVar('--down'), title: 'Your stop' });
    if (target !== null) out.push({ price: target, color: cssVar('--up'), title: 'Your target' });
    if (result) {
      out.push({ price: e.stop, color: cssVar('--muted'), title: 'System stop', dashed: true });
      const ov = revealOverlays(e, null, false);
      out.push(...ov.lines);
    }
    return out;
  }, [ld, e, entry, stop, target, result]);
  const marks = useMemo(() => (ld && e && result ? revealOverlays(e, null, false).marks : []), [ld, e, result]);

  const fmt = (p: number | null) => (p === null ? '—' : p.toFixed(digits));

  return (
    <div className="drill">
      <TopBar title="Place it" step={step} total={total} onExit={onExit} />
      <div className="chart-wrap">
        {ld ? <Chart s={ld.w.s} upto={upto} digits={digits} showDate={!!result} lines={lines} marks={marks} onTapPrice={tap} /> : <Loading />}
        <div className="chart-label">{result && ld ? revealLabel(ld.w) : 'Tap the chart to place your lines'}</div>
      </div>
      <div className="panel" key={result ? 'after' : 'before'}>
        {!result ? (
          <>
            <p className="prompt">
              <b>{sysName(d.s)}</b> · <span className={dir === 1 ? 'up-text' : 'down-text'}>{dirName(dir)}</span> at {fmt(entry)}. Where do the stop and target go?
            </p>
            <div className="place-grid">
              {(['stop', 'target'] as const).map((w) => (
                <div key={w} className={active === w ? `place-box on ${w}` : `place-box ${w}`} onClick={() => setActive(w)}>
                  <div className="pb-label">{w === 'stop' ? 'Stop' : 'Target'}{active === w ? ' · tap chart' : ''}</div>
                  <div className="pb-value">{fmt(w === 'stop' ? stop : target)}</div>
                  <div className="pb-nudge">
                    <button className="chip" onClick={(ev) => { ev.stopPropagation(); nudge(w, -1); }}>−</button>
                    <button className="chip" onClick={(ev) => { ev.stopPropagation(); nudge(w, 1); }}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="lot-row">
              {LOTS.map((l) => (
                <button key={l} className={lots === l ? 'chip on' : 'chip'} onClick={() => setLots(l)}>{l.toFixed(2)}</button>
              ))}
            </div>
            <div className="facts">
              <span>Risk <b>{money(risk)}</b> ({riskPct.toFixed(1)}%)</span>
              <span>Reward <b>{rr ? rr.toFixed(1) : '—'}×</b></span>
              <span>ATR <b>{atr.toFixed(digits)}</b></span>
            </div>
            <button className="btn primary wide" disabled={!ld || stop === null || target === null} onClick={submit}>Place order</button>
          </>
        ) : (
          <>
            <div className={result.ok ? 'verdict good' : 'verdict bad'}>
              <span className="verdict-icon">{result.ok ? '✓' : '✗'}</span>
              <span>{result.ok ? 'Clean order.' : 'The order needs work.'} {result.out ? `${result.out.result === 'win' ? 'Target hit' : result.out.result === 'loss' ? 'Stopped out' : 'Still open after 2 days'}: ${money(result.money)}.` : ''}</span>
            </div>
            <ul className="checks">
              {result.checks.map((c) => (
                <li key={c.label} className={c.ok ? 'pass' : 'fail'}>
                  <span className="mark">{c.ok ? '✓' : '✗'}</span>
                  {c.label}
                </li>
              ))}
            </ul>
            {e ? <Breakdown e={e} /> : null}
            <button className="btn primary wide" onClick={() => onNext(result.ok, result.xp)}>Next</button>
          </>
        )}
      </div>
    </div>
  );
}
