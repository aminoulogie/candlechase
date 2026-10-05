// Shared by the browser app and the build scripts, so a drill is judged the
// same way everywhere.

/** 1 = buy, -1 = sell */
export type Dir = 1 | -1;

export type SystemId = 'ema' | 'sr' | 'rsi' | 'session';

export const SYSTEM_ORDER: SystemId[] = ['ema', 'sr', 'rsi', 'session'];

export type InstrumentId = 'eurusd' | 'xauusd' | 'nas100';

export interface Bars {
  /** unix seconds, UTC, candle open time */
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}

export interface Series extends Bars {
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  atr: number[];
  /** swing points: 1 when the bar is a swing high/low with k bars either side */
  ph2: Uint8Array;
  pl2: Uint8Array;
  ph5: Uint8Array;
  pl5: Uint8Array;
}

/** 'chart' rules are checked by code; 'live' rules are yours to check when trading for real. */
export type RuleKind = 'chart' | 'live';

export interface RuleDef {
  id: string;
  title: string;
  sub: string;
  /** the exact numbers the code uses */
  precise?: string;
  kind: RuleKind;
  /** added on top of the trader's original checklist */
  upgrade?: boolean;
}

export interface SystemDef {
  id: SystemId;
  name: string;
  family: string;
  tagline: string;
  /** the rule that makes a bar worth looking at; without it there is no setup to judge */
  triggerRule: string;
  rules: RuleDef[];
}

/** Things drawn on the chart when the answer is revealed. */
export interface Marks {
  level?: number;
  rangeHigh?: number;
  rangeLow?: number;
  rangeFrom?: number;
  rangeTo?: number;
  /** bar indexes worth pointing at (swing lows, break candle...) with a label */
  points?: { i: number; label: string; above: boolean }[];
  /** for divergence: two RSI points to join */
  rsiLine?: [number, number];
  priceLine?: [number, number];
}

export interface Evaluation {
  sys: SystemId;
  dir: Dir;
  i: number;
  /** trigger present: there is something here to judge */
  candidate: boolean;
  /** chart rule id -> met */
  pass: Record<string, boolean>;
  failed: string[];
  valid: boolean;
  entry: number;
  stop: number;
  target: number;
  marks: Marks;
  /** the numbers each rule was decided on, for the Explain view */
  info: Record<string, number | number[]>;
}

export interface Outcome {
  result: 'win' | 'loss' | 'open';
  exitIndex: number;
  exitPrice: number;
  /** gross R: +2 on a 2R target, -1 on a stop, partial if still open */
  r: number;
  /** after spread */
  rNet: number;
}

export interface InstrumentMeta {
  id: InstrumentId;
  name: string;
  /** dukascopy symbol */
  source: string;
  /** prices are stored as integers: price * 10^digits */
  digits: number;
  /** typical spread in price units */
  spread: number;
  /** account money per 1.0 price move at 1.00 lot */
  valuePerUnit: number;
  /** what traders call a pip, in price units */
  pip: number;
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentMeta> = {
  eurusd: { id: 'eurusd', name: 'EURUSD', source: 'eurusd', digits: 5, spread: 0.00008, valuePerUnit: 100000, pip: 0.0001 },
  xauusd: { id: 'xauusd', name: 'Gold', source: 'xauusd', digits: 3, spread: 0.25, valuePerUnit: 100, pip: 0.1 },
  nas100: { id: 'nas100', name: 'NAS100', source: 'usatechidxusd', digits: 3, spread: 1.5, valuePerUnit: 1, pip: 1 },
};

export const INSTRUMENT_ORDER: InstrumentId[] = ['eurusd', 'xauusd', 'nas100'];
