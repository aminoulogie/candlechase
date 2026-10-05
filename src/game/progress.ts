import { SYSTEM_ORDER } from '../engine/types';
import type { SystemId } from '../engine/types';
import type { State } from './store';

export const MASTERY_WINDOW = 50;
export const MASTERY_SCORE = 0.8;
export const DAILY_GOAL_SEC = 15 * 60;

export interface SystemProgress {
  sys: SystemId;
  attempts: number;
  /** accuracy over the last 50 drills about this system */
  recent: number;
  recentCount: number;
  mastered: boolean;
  unlocked: boolean;
}

export function systemProgress(s: State): SystemProgress[] {
  const out: SystemProgress[] = [];
  let unlocked = true;
  for (const sys of SYSTEM_ORDER) {
    const mine = s.attempts.filter((a) => a.sys === sys);
    const last = mine.slice(-MASTERY_WINDOW);
    const recent = last.length ? last.filter((a) => a.ok).length / last.length : 0;
    const mastered = last.length >= MASTERY_WINDOW && recent >= MASTERY_SCORE;
    out.push({ sys, attempts: mine.length, recent, recentCount: last.length, mastered, unlocked });
    // the next system opens once this one is mastered
    unlocked = unlocked && mastered;
  }
  return out;
}

export function unlockedSystems(s: State): SystemId[] {
  return systemProgress(s)
    .filter((p) => p.unlocked)
    .map((p) => p.sys);
}

/** The system you are working on: the first unlocked one not yet mastered. */
export function currentSystem(s: State): SystemProgress | null {
  return systemProgress(s).find((p) => p.unlocked && !p.mastered) ?? null;
}

/** Timer switches on for a system once it is mastered. */
export function timerFor(s: State, sys: string): number | null {
  const p = systemProgress(s).find((x) => x.sys === sys);
  return p?.mastered ? 20 : null;
}

export function streakDays(s: State): number {
  let n = 0;
  const d = new Date();
  // today counts if practised; otherwise start from yesterday
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (!s.practice[key(d)]) d.setDate(d.getDate() - 1);
  while (s.practice[key(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const level = (xp: number) => Math.floor(Math.sqrt(xp / 40)) + 1;
export const levelFloor = (lv: number) => (lv - 1) ** 2 * 40;
