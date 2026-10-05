import type { Evaluation, Outcome } from '../engine/types';
import type { BarMark, PriceMark } from './Chart';

const v = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** What to draw once the answer is shown: the setup's anatomy and the trade. */
export function revealOverlays(e: Evaluation | null, out: Outcome | null, showTrade: boolean) {
  const lines: PriceMark[] = [];
  const marks: BarMark[] = [];
  let divergence: { a: number; b: number; up: boolean } | undefined;
  let shade: { from: number; to: number; hi: number; lo: number } | undefined;
  if (!e) return { lines, marks, divergence, shade };

  if (e.marks.level !== undefined) lines.push({ price: e.marks.level, color: v('--warn'), title: 'Level', dashed: true });
  if (e.marks.rangeHigh !== undefined && e.marks.rangeFrom !== undefined) {
    shade = { from: e.marks.rangeFrom, to: e.i, hi: e.marks.rangeHigh, lo: e.marks.rangeLow! };
  }
  if (e.marks.priceLine) divergence = { a: e.marks.priceLine[0], b: e.marks.priceLine[1], up: e.dir === 1 };
  for (const p of (e.marks.points ?? []).filter((x) => x.i !== e.i)) marks.push({ i: p.i, text: p.label, color: v('--muted'), above: p.above, shape: 'circle' });

  marks.push({ i: e.i, text: e.dir === 1 ? 'Buy here' : 'Sell here', color: v('--accent'), above: e.dir === -1 });

  if (showTrade && e.candidate) {
    lines.push({ price: e.entry, color: v('--text'), title: 'Entry' });
    lines.push({ price: e.stop, color: v('--down'), title: 'Stop' });
    lines.push({ price: e.target, color: v('--up'), title: 'Target' });
  }
  if (out && out.result !== 'open') {
    marks.push({ i: out.exitIndex, text: out.result === 'win' ? 'Target' : 'Stopped', color: out.result === 'win' ? v('--up') : v('--down'), above: out.result === 'win' ? e.dir === 1 : e.dir === -1, shape: 'circle' });
  }
  return { lines, marks, divergence, shade };
}

export const cssVar = v;
