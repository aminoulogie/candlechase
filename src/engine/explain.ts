import { EMA_VOID_LOOKBACK } from './evaluate';
import type { Evaluation, Series } from './types';

export interface Explanation {
  /** plain sentences with the actual numbers */
  text: string;
  /** candles to point at on the chart (local indexes) */
  bars: { i: number; label: string; above: boolean }[];
}

const hhmm = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const ok = (b: boolean) => (b ? 'Met.' : 'Not met.');

/** Why one rule came out the way it did on this candle, with the numbers that decided it. */
export function explainRule(s: Series, e: Evaluation, id: string, digits: number): Explanation | null {
  const i = e.i;
  const d = e.dir;
  const buy = d === 1;
  const f = (p: number) => p.toFixed(digits);
  const atr = s.atr[i];
  const inAtr = (x: number) => `${(x / atr).toFixed(1)} ATR`;
  const at = (j: number) => hhmm(s.t[j]);
  const n = (k: string) => e.info[k] as number;
  const list = (k: string) => (e.info[k] as number[] | undefined) ?? [];
  const met = e.pass[id];
  const side = buy ? 'above' : 'below';
  const wrongSide = buy ? 'below' : 'above';

  const hours = (): Explanation => ({
    text: `The trigger candle closed at ${at(i)} UTC. The rule allows 07:00–20:00 UTC, when London or New York is trading. ${ok(met)}`,
    bars: [],
  });
  const stopRule = (): Explanation => {
    const dist = Math.abs(e.entry - e.stop);
    return {
      text: `Entry ${f(e.entry)}, stop ${f(e.stop)}: that is ${inAtr(dist)} away (1 ATR = ${f(atr)}). The rule wants 0.5–3 ATR — closer gets hit by normal noise, further is a different trade. ${ok(met)}`,
      bars: [],
    };
  };
  const htf = (): Explanation => ({
    text: `Close ${f(s.c[i])} vs EMA200 ${f(s.ema200[i])} (the faint dashed line): price is ${s.c[i] > s.ema200[i] ? 'above' : 'below'} it. To ${buy ? 'buy' : 'sell'} it must be ${side}. ${ok(met)}`,
    bars: [],
  });

  if (e.sys === 'ema') {
    switch (id) {
      case 'trend': {
        const e20 = s.ema20[i];
        const e50 = s.ema50[i];
        const r20 = s.ema20[i] - s.ema20[i - 5];
        const r50 = s.ema50[i] - s.ema50[i - 5];
        const dirWord = (x: number) => (x > 0 ? 'rising' : x < 0 ? 'falling' : 'flat');
        return {
          text: `EMA20 ${f(e20)} is ${e20 > e50 ? 'above' : 'below'} EMA50 ${f(e50)}. Over the last 5 candles EMA20 went ${f(s.ema20[i - 5])} → ${f(e20)} (${dirWord(r20)}) and EMA50 ${f(s.ema50[i - 5])} → ${f(e50)} (${dirWord(r50)}). To ${buy ? 'buy' : 'sell'}, EMA20 must be ${side} EMA50 and both must be ${buy ? 'rising' : 'falling'}. ${ok(met)}`,
          bars: [{ i: i - 5, label: '5 back', above: !buy }],
        };
      }
      case 'pullback':
        return met
          ? {
              text: `At ${at(n('farAt'))} price closed ${n('far').toFixed(1)} ATR ${side} EMA20 — it really left the line, so coming back to it is a pullback. Met.`,
              bars: [{ i: n('farAt'), label: 'Left', above: !buy }],
            }
          : {
              text: `In the 10 candles before, the furthest close ${side} EMA20 was only ${n('far').toFixed(1)} ATR (at ${at(n('farAt'))}). The rule needs 1 ATR. Price never left the line, so there is nothing to pull back from. Not met.`,
              bars: [{ i: n('farAt'), label: 'Furthest', above: !buy }],
            };
      case 'trigger': {
        const touch = buy ? s.l[i] <= s.ema20[i] + 0.2 * atr : s.h[i] >= s.ema20[i] - 0.2 * atr;
        const color = d * (s.c[i] - s.o[i]) > 0;
        const closed = d * (s.c[i] - s.ema20[i]) > 0;
        const rsiOk = d * (s.rsi[i] - 50) > 0;
        const mk = (b: boolean) => (b ? '✓' : '✗');
        return {
          text: `${mk(touch)} ${buy ? 'Low' : 'High'} ${f(buy ? s.l[i] : s.h[i])} reached EMA20 ${f(s.ema20[i])} (within 0.2 ATR). ${mk(color)} Candle is ${s.c[i] > s.o[i] ? 'green' : s.c[i] < s.o[i] ? 'red' : 'flat'} — needs ${buy ? 'green' : 'red'}. ${mk(closed)} Closed at ${f(s.c[i])}, ${s.c[i] > s.ema20[i] ? 'above' : 'below'} EMA20 — needs ${side}. ${mk(rsiOk)} RSI ${s.rsi[i].toFixed(0)} — needs ${buy ? 'over' : 'under'} 50. ${ok(met)}`,
          bars: [],
        };
      }
      case 'void': {
        const against = list('against');
        if (!against.length)
          return {
            text: `All of the last ${EMA_VOID_LOOKBACK} candles (since ${at(i - EMA_VOID_LOOKBACK + 1)}) closed ${side} EMA50. Earlier candles are outside the rule's window. Met.`,
            bars: [{ i: i - EMA_VOID_LOOKBACK + 1, label: 'Window starts', above: !buy }],
          };
        return {
          text: `${against.length} of the last ${EMA_VOID_LOOKBACK} candles closed ${wrongSide} EMA50 — against a ${buy ? 'buy' : 'sell'}: ${against
            .slice(0, 6)
            .map(at)
            .join(', ')}${against.length > 6 ? '…' : ''}. That breaks the trend. Not met.`,
          bars: against.slice(-6).map((j) => ({ i: j, label: '✗', above: buy })),
        };
      }
      case 'opposite':
        return met
          ? { text: `No ${buy ? 'bearish' : 'bullish'} RSI divergence finished in the last 15 candles. Met.`, bars: [] }
          : {
              text: `A ${buy ? 'bearish' : 'bullish'} RSI divergence finished at ${at(n('divB'))}: price made a ${buy ? 'higher high' : 'lower low'} (${at(n('divA'))} → ${at(n('divB'))}) while RSI did not. That is the other system calling the turn. Not met.`,
              bars: [
                { i: n('divA'), label: 'Div 1', above: buy },
                { i: n('divB'), label: 'Div 2', above: buy },
              ],
            };
      case 'htf':
        return htf();
      case 'hours':
        return hours();
      case 'stop':
        return stopRule();
    }
  }

  if (e.sys === 'sr') {
    const L = e.info.level as number | undefined;
    switch (id) {
      case 'level':
        if (L === undefined) return { text: 'No earlier swing high or low sits where this candle touched. Not met.', bars: [] };
        return {
          text: `Level ${f(L)} has ${list('touches').length} swing point${list('touches').length === 1 ? '' : 's'} within 0.3 ATR in the last 300 candles. The rule needs 2. ${ok(met)}`,
          bars: list('touches').map((j) => ({ i: j, label: 'Touch', above: s.h[j] - L < L - s.l[j] })),
        };
      case 'break':
        return e.info.breakAt !== undefined
          ? {
              text: `At ${at(n('breakAt'))} a candle closed at ${f(s.c[n('breakAt')])}, ${inAtr(Math.abs(s.c[n('breakAt')] - L!))} ${side} the level, after trading on the other side. ${ok(met)}`,
              bars: [{ i: n('breakAt'), label: 'Break', above: buy }],
            }
          : { text: `In the 3–30 candles before, no candle closed 0.3 ATR ${side} ${L === undefined ? 'the level' : f(L)} coming from the other side. A wick through is not a break. Not met.`, bars: [] };
      case 'trigger':
        return {
          text: `The candle touched ${L === undefined ? 'the level' : f(L)} and closed ${s.c[i] > s.o[i] ? 'green' : 'red'} at ${f(s.c[i])}. To ${buy ? 'buy' : 'sell'} it must close ${buy ? 'green' : 'red'}, ${side} the level. ${ok(met)}`,
          bars: [],
        };
      case 'void': {
        const back = list('back');
        return back.length
          ? {
              text: `After the break, ${back.length} candle${back.length === 1 ? '' : 's'} closed back ${wrongSide} the level by more than 0.3 ATR (${back.slice(0, 4).map(at).join(', ')}). The break failed. Not met.`,
              bars: back.slice(-4).map((j) => ({ i: j, label: '✗', above: buy })),
            }
          : { text: `Since the break no candle closed back through the level. Met.`, bars: [] };
      }
      case 'room':
        return met
          ? { text: `Between entry ${f(e.entry)} and target ${f(e.target)} there is no other level with 2+ touches. Met.`, bars: [] }
          : { text: `A level at ${f(n('wall'))} (2+ touches) sits between entry ${f(e.entry)} and target ${f(e.target)}. Price often stops there. Not met.`, bars: [] };
      case 'hours':
        return hours();
      case 'stop':
        return stopRule();
    }
  }

  if (e.sys === 'rsi') {
    const j2 = e.info.j2 as number | undefined;
    const low = buy ? 'low' : 'high';
    switch (id) {
      case 'diverge':
        if (j2 === undefined) return { text: `No confirmed swing ${low} in the 2–6 candles before. Not met.`, bars: [] };
        if (e.info.j1 === undefined)
          return { text: `Swing ${low} at ${at(j2)}, but no earlier swing in the 5–40 candles before it that price has since gone past. Not met.`, bars: [{ i: j2, label: 'Swing 2', above: !buy }] };
        return {
          text: `Price: swing ${low} ${f(buy ? s.l[n('j1')] : s.h[n('j1')])} at ${at(n('j1'))} → ${f(buy ? s.l[j2] : s.h[j2])} at ${at(j2)} (${buy ? 'lower' : 'higher'}). RSI: ${n('r1').toFixed(0)} → ${n('r2').toFixed(0)}. Needs RSI at least 3 points ${buy ? 'higher' : 'lower'} the second time. ${ok(met)}`,
          bars: [
            { i: n('j1'), label: 'Swing 1', above: !buy },
            { i: j2, label: 'Swing 2', above: !buy },
          ],
        };
      case 'extreme':
        return e.info.r1 === undefined
          ? { text: 'There is no first swing to check. Not met.', bars: [] }
          : { text: `RSI at the first swing was ${n('r1').toFixed(0)}. To ${buy ? 'buy' : 'sell'} it must have been ${buy ? 'under 35' : 'over 65'}. ${ok(met)}`, bars: [] };
      case 'trigger':
        if (j2 === undefined) return { text: 'No second swing, so no trigger. Not met.', bars: [] };
        return {
          text:
            e.info.earlier !== undefined
              ? `A candle at ${at(n('earlier'))} already closed through the swing candle — this is a later candle, not the trigger. Not met.`
              : `Close ${f(s.c[i])} vs the swing candle's ${buy ? 'high' : 'low'} ${f(buy ? s.h[j2] : s.l[j2])}, candle ${s.c[i] > s.o[i] ? 'green' : 'red'}. ${ok(met)}`,
          bars: e.info.earlier !== undefined ? [{ i: n('earlier'), label: 'First close', above: buy }] : [],
        };
      case 'void':
        return e.info.newExtreme !== undefined
          ? { text: `At ${at(n('newExtreme'))} price went past the second swing ${low}. The divergence is gone. Not met.`, bars: [{ i: n('newExtreme'), label: '✗', above: !buy }] }
          : { text: `Nothing has gone past the second swing ${low}. Met.`, bars: [] };
      case 'steam':
        return { text: `EMA20 moved ${n('slope').toFixed(1)} ATR over the last 10 candles. Under 1.5 means the trend is slowing. ${ok(met)}`, bars: [{ i: i - 10, label: '10 back', above: !buy }] };
      case 'hours':
        return hours();
      case 'stop':
        return stopRule();
    }
  }

  if (e.sys === 'session') {
    const hi = e.marks.rangeHigh;
    const lo = e.marks.rangeLow;
    switch (id) {
      case 'tight':
        return e.info.avg === undefined
          ? { text: 'Not enough earlier days to compare the Asian range with. Not met.', bars: [] }
          : {
              text: `Today's Asian range is ${f(n('height'))} high; the 10-day average is ${f(n('avg'))} — ${(n('height') / n('avg')).toFixed(2)}×. The rule wants 0.5–1.3×. ${ok(met)}`,
              bars: [],
            };
      case 'window':
        return { text: `The candle closed at ${at(i)} UTC. The London window is 07:00–10:00. ${ok(met)}`, bars: [] };
      case 'trigger':
        return {
          text: `Close ${f(s.c[i])} vs range ${buy ? 'high' : 'low'} ${hi === undefined ? '—' : f(buy ? hi : lo!)}. It must close at least 0.1 ATR ${buy ? 'above' : 'below'}. ${ok(met)}`,
          bars: [],
        };
      case 'first':
        return e.info.earlier !== undefined
          ? { text: `At ${at(n('earlier'))} a candle already closed outside the range. This is not the first break of the day. Not met.`, bars: [{ i: n('earlier'), label: 'First break', above: buy }] }
          : { text: 'No candle closed outside the range earlier today. Met.', bars: [] };
      case 'body':
        return { text: `The body is ${(n('body') * 100).toFixed(0)}% of the candle and must be ${buy ? 'green' : 'red'} and at least 50%. ${ok(met)}`, bars: [] };
      case 'htf':
        return htf();
      case 'stop':
        return stopRule();
    }
  }
  return null;
}
