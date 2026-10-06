import { stats } from '../engine/backtest';
import type { StatBlock, Trade } from '../engine/backtest';
import type { SimTrade } from '../data/load';
import { update } from './store';
import type { SimSettings, State } from './store';

export const DEFAULT_SIM: SimSettings = { balance: 10000, risk: 1, years: 5, target: 2 };

export const getSim = (s: State): SimSettings => ({ ...DEFAULT_SIM, ...s.sim });
export const setSim = (patch: Partial<SimSettings>) => update((s) => ({ sim: { ...getSim(s), ...patch } }));

const YEAR = 365.25 * 86400;

/** Trades within the last `years`, measured back from the end of the data. */
export function lastYears<T extends { t: number }>(list: T[], years: number, end: number): T[] {
  const from = end - years * YEAR;
  return list.filter((x) => x.t >= from);
}

export interface MoneyResult {
  start: number;
  end: number;
  profit: number;
  /** % return over the period */
  ret: number;
  /** worst fall from a high point, % */
  maxDrawdown: number;
  trades: number;
  /** account after each trade, sampled for a sparkline */
  curve: number[];
}

/**
 * Risk a fixed % of the current balance on every trade (so wins and losses
 * compound). A 2R win at 1% risk adds 2%; a stop removes 1%.
 */
export function simulateMoney(list: { r: number }[], balance: number, riskPct: number): MoneyResult {
  let bal = balance;
  let peak = balance;
  let dd = 0;
  const curve = [balance];
  for (const t of list) {
    bal *= 1 + (riskPct / 100) * t.r;
    bal = Math.max(bal, 0);
    peak = Math.max(peak, bal);
    dd = Math.max(dd, peak > 0 ? (peak - bal) / peak : 0);
    curve.push(bal);
  }
  const step = Math.max(1, Math.ceil(curve.length / 60));
  return {
    start: balance,
    end: bal,
    profit: bal - balance,
    ret: (bal / balance - 1) * 100,
    maxDrawdown: dd * 100,
    trades: list.length,
    curve: curve.filter((_, k) => k % step === 0 || k === curve.length - 1),
  };
}

/** Rebuild full trades from the compact list so the shared stats() can run on them. */
export function statsOf(list: SimTrade[], target: number): StatBlock {
  const full: Trade[] = list.map((x) => ({
    i: 0,
    t: x.t,
    dir: 1,
    result: x.result,
    r: x.r,
    // spread cost in R, recovered from the net result
    sr: x.result === 'win' ? Math.max(0, target - x.r) : x.result === 'loss' ? Math.max(0, -1 - x.r) : 0,
  }));
  return stats(full, target);
}

export const fmtMoney = (v: number) => {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return `${sign}$${a >= 100000 ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : 2 })}`;
};
