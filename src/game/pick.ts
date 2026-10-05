import type { Drill } from '../engine/codec';
import { SYSTEM_ORDER } from '../engine/types';
import type { Library } from '../data/load';
import { unlockedSystems } from './progress';
import type { Mode, State } from './store';

const shuffle = <T,>(a: T[]): T[] => {
  const b = a.slice();
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
};

/** How each mode mixes valid setups (v), near misses (n) and empty charts (z). */
const MIX: Record<Exclude<Mode, 'quiz'>, { v: number; n: number; z: number }> = {
  spot: { v: 0.6, n: 0.3, z: 0.1 },
  replay: { v: 0.6, n: 0.4, z: 0 },
  checklist: { v: 0.6, n: 0.4, z: 0 },
  place: { v: 1, n: 0, z: 0 },
};

export function dueIds(lib: Library, s: State): string[] {
  const now = Date.now();
  return Object.values(s.srs)
    .filter((x) => x.due <= now && lib.byId.has(x.id))
    .sort((a, b) => a.due - b.due)
    .map((x) => x.id);
}

export function pickDrills(lib: Library, s: State, mode: Mode, n: number, reviewOnly = false): Drill[] {
  const recent = new Set(s.attempts.slice(-400).map((a) => a.id));
  const fresh = (d: Drill) => !recent.has(d.id);

  if (reviewOnly) return dueIds(lib, s).slice(0, n).map((id) => lib.byId.get(id)!);

  if (mode === 'quiz') {
    // Exam: all four systems, balanced, valid setups only.
    const per = Math.ceil(n / SYSTEM_ORDER.length);
    const out: Drill[] = [];
    for (const sys of SYSTEM_ORDER) out.push(...shuffle(lib.drills.filter((d) => d.k === 'v' && d.s === sys && fresh(d))).slice(0, per));
    return shuffle(out).slice(0, n);
  }

  const open = new Set<string>(unlockedSystems(s));
  const mix = MIX[mode];
  const pool = {
    v: shuffle(lib.drills.filter((d) => d.k === 'v' && open.has(d.s) && fresh(d))),
    n: shuffle(lib.drills.filter((d) => d.k === 'n' && open.has(d.s) && fresh(d))),
    z: shuffle(lib.drills.filter((d) => d.k === 'z' && fresh(d))),
  };

  // Mistakes that are due come back first (up to 30% of the round).
  const due = dueIds(lib, s)
    .map((id) => lib.byId.get(id)!)
    .filter((d) => (mode === 'place' ? d.k === 'v' : mode === 'spot' || d.k !== 'z') && (d.k === 'z' || open.has(d.s)))
    .slice(0, Math.floor(n * 0.3));

  const out: Drill[] = [...due];
  const taken = new Set(out.map((d) => d.id));
  const want = n - out.length;
  for (const k of ['v', 'n', 'z'] as const) {
    const add = pool[k].filter((d) => !taken.has(d.id)).slice(0, Math.round(want * mix[k]));
    add.forEach((d) => taken.add(d.id));
    out.push(...add);
  }
  // top up from valid setups if a pool ran dry
  for (const d of pool.v) {
    if (out.length >= n) break;
    if (!taken.has(d.id)) out.push(d);
  }
  return shuffle(out);
}
