import { INSTRUMENTS } from '../engine/types';
import type { InstrumentId } from '../engine/types';
import type { State } from './store';

export const LOTS = [0.01, 0.02, 0.03];

export const valuePerUnit = (s: State, x: string) => s.settings.valuePerUnit[x as InstrumentId] ?? INSTRUMENTS[x as InstrumentId].valuePerUnit;

/** Money at risk between entry and stop. */
export const riskMoney = (s: State, x: string, entry: number, stop: number, lots: number) => Math.abs(entry - stop) * valuePerUnit(s, x) * lots;

/** Money made or lost between entry and exit, after the spread. */
export function pnl(s: State, x: string, dir: number, entry: number, exit: number, lots: number): number {
  const spread = INSTRUMENTS[x as InstrumentId].spread;
  return Math.round((dir * (exit - entry) - spread) * valuePerUnit(s, x) * lots * 100) / 100;
}

export const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
