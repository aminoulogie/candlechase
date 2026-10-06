import { useSyncExternalStore } from 'react';
import type { InstrumentId } from '../engine/types';

export type Mode = 'spot' | 'quiz' | 'replay' | 'checklist' | 'place';

export interface Attempt {
  id: string;
  /** the system the drill is about ('' for "nothing here") */
  sys: string;
  mode: Mode;
  ok: boolean;
  at: number;
}

export interface SrsItem {
  id: string;
  due: number;
  step: number;
}

export interface GameTrade {
  at: number;
  drill: string;
  x: string;
  sys: string;
  dir: number;
  lots: number;
  r: number;
  pnl: number;
  /** all rules met when it was taken */
  clean: boolean;
}

export interface LiveTrade {
  id: string;
  at: number;
  x: string;
  sys: string;
  dir: number;
  lots: number;
  /** rule id -> followed */
  rules: Record<string, boolean>;
  r: number | null;
  note: string;
}

export interface Settings {
  startBalance: number;
  dailyLossPct: number;
  /** account money per 1.0 price move at 1.00 lot, per instrument */
  valuePerUnit: Partial<Record<InstrumentId, number>>;
}

export interface SimSettings {
  /** starting account, in account currency */
  balance: number;
  /** % of the account risked per trade */
  risk: number;
  /** look back this many years */
  years: number;
  /** target as a multiple of the risk */
  target: number;
}

export interface LabPreset {
  sys: string;
  markets: string[];
  target: number;
  off: string[];
}

export interface State {
  v: 1;
  sim?: SimSettings;
  /** set by "Try it in the Lab", read once by the Lab */
  labPreset?: LabPreset | null;
  attempts: Attempt[];
  srs: Record<string, SrsItem>;
  xp: number;
  balance: number;
  trades: GameTrade[];
  live: LiveTrade[];
  /** yyyy-mm-dd -> seconds practised */
  practice: Record<string, number>;
  settings: Settings;
}

const KEY = 'candlechase:v1';

const fresh = (): State => ({
  v: 1,
  attempts: [],
  srs: {},
  xp: 0,
  balance: 1000,
  trades: [],
  live: [],
  practice: {},
  settings: { startBalance: 1000, dailyLossPct: 3, valuePerUnit: {} },
});

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    // private mode or blocked storage: play without saving
  }
  return fresh();
}

let state = read();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function useGame(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getState = () => state;

export function update(fn: (s: State) => Partial<State>) {
  commit({ ...state, ...fn(state) });
}

export const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DAY_MS = 86400_000;
const SRS_STEPS = [1, 3, 7];

/** Record an answer, schedule mistakes to come back, and add XP. */
export function recordAttempt(a: Omit<Attempt, 'at'>, xp: number) {
  update((s) => {
    const attempts = [...s.attempts, { ...a, at: Date.now() }].slice(-5000);
    const srs = { ...s.srs };
    const cur = srs[a.id];
    if (!a.ok) srs[a.id] = { id: a.id, step: 0, due: Date.now() + SRS_STEPS[0] * DAY_MS };
    else if (cur) {
      const step = cur.step + 1;
      if (step >= SRS_STEPS.length) delete srs[a.id];
      else srs[a.id] = { id: a.id, step, due: Date.now() + SRS_STEPS[step] * DAY_MS };
    }
    return { attempts, srs, xp: Math.max(0, s.xp + xp) };
  });
}

export function addPractice(seconds: number) {
  if (seconds <= 0) return;
  update((s) => {
    const k = dayKey();
    return { practice: { ...s.practice, [k]: Math.round((s.practice[k] ?? 0) + Math.min(seconds, 300)) } };
  });
}

export function recordTrade(t: Omit<GameTrade, 'at'>) {
  update((s) => ({ trades: [...s.trades, { ...t, at: Date.now() }].slice(-2000), balance: Math.round((s.balance + t.pnl) * 100) / 100 }));
}

export function todayPnl(s: State): number {
  const k = dayKey();
  return s.trades.filter((t) => dayKey(t.at) === k).reduce((a, t) => a + t.pnl, 0);
}

/** Same rule as live: once the day's losses reach the limit, no more trades today. */
export function lossLimitHit(s: State): boolean {
  const pnl = todayPnl(s);
  return pnl <= -(s.settings.dailyLossPct / 100) * (s.balance - pnl);
}

export function resetAll() {
  commit(fresh());
}

export function exportState(): string {
  return JSON.stringify(state);
}

export function importState(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.v !== 1) throw new Error('Not a Candlechase backup');
  commit({ ...fresh(), ...parsed });
}
