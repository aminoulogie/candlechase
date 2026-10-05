import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Drill } from '../engine/codec';
import { evaluate, evaluateBest, rank } from '../engine/evaluate';
import { simulate } from '../engine/outcome';
import { SYSTEMS } from '../engine/systems';
import { INSTRUMENTS, SYSTEM_ORDER } from '../engine/types';
import type { Dir, Evaluation, InstrumentId, Outcome, SystemId } from '../engine/types';
import { loadWindow } from '../data/load';
import type { Window } from '../data/load';
import { addPractice } from '../game/store';

export const sysName = (s: string) => (s in SYSTEMS ? SYSTEMS[s as SystemId].name : 'Nothing');
export const dirName = (d: number) => (d === 1 ? 'Buy' : d === -1 ? 'Sell' : '');

export function TopBar({ title, step, total, onExit, right }: { title: string; step?: number; total?: number; onExit: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onExit} aria-label="Close">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <div className="topbar-mid">
        <div className="topbar-title">{title}</div>
        {total ? (
          <div className="dots">
            {Array.from({ length: total }, (_, k) => (
              <span key={k} className={k < (step ?? 0) ? 'dot done' : k === step ? 'dot now' : 'dot'} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export interface Loaded {
  w: Window;
  /** evaluation of the drill's own system at the decision candle */
  e: Evaluation | null;
  out: Outcome | null;
}

export function useDrill(d: Drill | undefined): Loaded | null {
  const [st, setSt] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    setSt(null);
    if (!d) return;
    loadWindow(d.x, d.i).then((w) => {
      if (!live) return;
      let e: Evaluation | null = null;
      if (d.k !== 'z' && d.s) e = evaluate(w.s, w.li, d.s as SystemId, d.d as Dir);
      const out = e && e.candidate ? simulate(w.s, w.li, e.dir, e.entry, e.stop, e.target, INSTRUMENTS[d.x as InstrumentId].spread) : null;
      setSt({ w, e, out });
    });
    return () => {
      live = false;
    };
  }, [d]);
  return st;
}

/** For a candle the trader chose: the best reading across systems in that direction. */
export function bestAt(w: Window, i: number, dir: Dir, systems: SystemId[]): Evaluation | null {
  let best: Evaluation | null = null;
  for (const sys of systems) {
    const e = evaluate(w.s, i, sys, dir);
    if (e && (!best || rank(e) < rank(best))) best = e;
  }
  return best;
}

/** The closest thing to a setup on an "empty" candle, to explain why it is empty. */
export function nearestAt(w: Window, i: number): Evaluation | null {
  let best: Evaluation | null = null;
  for (const sys of SYSTEM_ORDER) {
    const e = evaluateBest(w.s, i, sys);
    if (e && e.candidate && (!best || rank(e) < rank(best))) best = e;
  }
  return best;
}

export function Breakdown({ e, highlight }: { e: Evaluation; highlight?: Record<string, boolean | undefined> }) {
  const def = SYSTEMS[e.sys];
  return (
    <div className="breakdown">
      <div className="bd-head">
        <span className={`tag sys-${e.sys}`}>{def.name}</span>
        <span className={e.dir === 1 ? 'tag up' : 'tag down'}>{dirName(e.dir)}</span>
        {e.valid ? <span className="tag ok">All rules met</span> : <span className="tag bad">{e.failed.length} rule{e.failed.length === 1 ? '' : 's'} not met</span>}
      </div>
      <ul className="rules">
        {def.rules.map((r) => {
          if (r.kind === 'live')
            return (
              <li key={r.id} className="rule live">
                <span className="mark">•</span>
                <div>
                  <div className="rule-title">{r.title}</div>
                  <div className="rule-sub">Live only — the chart can’t tell you this one.</div>
                </div>
              </li>
            );
          const ok = e.pass[r.id];
          const you = highlight?.[r.id];
          return (
            <li key={r.id} className={`rule ${ok ? 'pass' : 'fail'}`}>
              <span className="mark">{ok ? '✓' : '✗'}</span>
              <div>
                <div className="rule-title">
                  {r.title}
                  {r.upgrade ? <span className="mini">upgrade</span> : null}
                </div>
                {!ok || you !== undefined ? <div className="rule-sub">{r.precise ?? r.sub}</div> : null}
                {you !== undefined ? <div className={you === ok ? 'you right' : 'you wrong'}>You said {you ? 'met' : 'not met'} — {you === ok ? 'right' : 'wrong'}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OutcomeLine({ out, prefix }: { out: Outcome | null; prefix?: string }) {
  if (!out) return null;
  const bars = out.exitIndex;
  const r = out.rNet;
  const txt =
    out.result === 'win' ? `hit the target: +${r.toFixed(2)}R after spread` : out.result === 'loss' ? `hit the stop: ${r.toFixed(2)}R after spread` : `was still open after 2 days: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
  return (
    <div className={`outcome ${out.result}`} data-bars={bars}>
      {prefix ?? 'This trade'} {txt}.
    </div>
  );
}

/** Seconds left; calls onTimeout once. null = no timer. */
export function useCountdown(seconds: number | null, running: boolean, onTimeout: () => void): number | null {
  const [left, setLeft] = useState(seconds);
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  useEffect(() => setLeft(seconds), [seconds]);
  useEffect(() => {
    if (seconds === null || !running) return;
    const started = Date.now();
    const id = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(l);
      if (l === 0) {
        clearInterval(id);
        cb.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [seconds, running]);
  return seconds === null ? null : left;
}

/** Counts time on a drill toward today's practice. */
export function usePracticeClock(key: unknown, running: boolean) {
  useEffect(() => {
    if (!running) return;
    const t = Date.now();
    return () => addPractice((Date.now() - t) / 1000);
  }, [key, running]);
}

/** Plays the candles after the decision so you see what happened. */
export function usePlayForward(from: number, to: number, on: boolean, msPerBar = 45): number {
  const [i, setI] = useState(from);
  useEffect(() => {
    setI(from);
    if (!on) return;
    let cur = from;
    const id = setInterval(() => {
      cur = Math.min(to, cur + 1);
      setI(cur);
      if (cur >= to) clearInterval(id);
    }, msPerBar);
    return () => clearInterval(id);
  }, [from, to, on, msPerBar]);
  return on ? i : from;
}

export function revealLabel(w: Window) {
  const t = w.s.t[w.li];
  const when = new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${INSTRUMENTS[w.x as InstrumentId].name} · ${when} UTC`;
}

export function Loading({ text = 'Loading chart…' }: { text?: string }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}
