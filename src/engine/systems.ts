import type { SystemDef, SystemId } from './types';

// Rule wording for EMA Pullback is the trader's own checklist, word for word.
// The other three are drafted in the same voice. `precise` is what the code checks.

const LIVE_CLOSED = {
  id: 'closed',
  title: 'The trigger candle has closed',
  sub: 'A candle that is still moving has not triggered anything yet.',
  precise: 'In the game you only ever decide on closed candles. Live, this one is on you.',
  kind: 'live' as const,
};

const LIVE_NEWS = {
  id: 'news',
  title: 'Not within 15 minutes of big USD or EUR news',
  sub: 'The spread and the spike will take the stop before the idea gets a chance.',
  precise: 'Upgrade: for NFP, CPI and FOMC make it 30 minutes before and 15 after.',
  kind: 'live' as const,
};

const LIVE_ORDER = {
  id: 'order',
  title: 'Stop loss and take profit are in the order itself',
  sub: 'Set now, while you have no position and no opinion about it.',
  kind: 'live' as const,
};

// `upgrade` marks rules added on top of the trader's own EMA checklist; the
// other systems are drafted whole, so their versions carry no such label.
const HOURS_BASE = {
  id: 'hours',
  title: 'London or New York is open',
  sub: 'Asian-hours moves on M15 are mostly noise.',
  precise: 'Trigger candle between 07:00 and 20:00 UTC.',
  kind: 'chart' as const,
};
const HOURS = { ...HOURS_BASE, upgrade: true };

const HTF_BASE = {
  id: 'htf',
  title: 'The bigger trend agrees',
  sub: 'An M15 setup against the hourly trend is swimming upstream.',
  precise: 'Price above EMA200 to buy, below to sell (EMA200 on M15 ≈ EMA50 on H1).',
  kind: 'chart' as const,
};
const HTF = { ...HTF_BASE, upgrade: true };

const stopBase = (where: string) => ({
  id: 'stop',
  title: 'The stop has a real place to go',
  sub: `${where} Target is 2× the risk.`,
  precise: 'Stop distance between 0.5 and 3 ATR. Tighter gets hit by noise, wider is a different trade.',
  kind: 'chart' as const,
});
const stopRule = (where: string) => ({ ...stopBase(where), upgrade: true });

export const SYSTEMS: Record<SystemId, SystemDef> = {
  ema: {
    id: 'ema',
    name: 'EMA Pullback',
    family: 'Trend continuation',
    tagline: 'The trend is running. Wait for it to breathe back to the line, then join it.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'trend',
        title: 'EMA20 and EMA50 are stacked and both moving your way',
        sub: 'Above and rising to buy, below and falling to sell. Flat or tangled is no trade.',
        precise: 'EMA20 above EMA50 (below to sell), and both higher (lower) than 5 candles ago.',
        kind: 'chart',
      },
      {
        id: 'pullback',
        title: 'Price left the EMAs, came back, and touched EMA20 or EMA50',
        sub: 'A pullback that never reaches the line is not this setup.',
        precise: 'In the 10 candles before, a close at least 1 ATR beyond EMA20.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'A candle touched the EMA and CLOSED back in the trend direction',
        sub: 'Green above EMA20 with RSI over 50 to buy; red below with RSI under 50 to sell.',
        precise: 'Its low within 0.2 ATR of EMA20 or deeper (high, to sell), green and closing above EMA20, RSI > 50.',
        kind: 'chart',
      },
      {
        id: 'void',
        title: 'No candle has closed through EMA50 against the trend',
        sub: 'That is the void condition. If it has happened, the trend is not yours any more.',
        precise: 'No close below EMA50 (above, to sell) in the last 40 candles — 10 hours of M15.',
        kind: 'chart',
      },
      LIVE_CLOSED,
      {
        id: 'opposite',
        title: 'No other system is signalling the opposite way',
        sub: 'RSI divergence first — it is the one that catches the others out.',
        precise: 'No bearish RSI divergence (bullish, to sell) in the last 15 candles.',
        kind: 'chart',
      },
      LIVE_NEWS,
      LIVE_ORDER,
      HTF,
      HOURS,
      stopRule('Stop goes beyond the pullback’s extreme, plus 0.1 ATR.'),
    ],
  },
  sr: {
    id: 'sr',
    name: 'S/R Retest',
    family: 'Levels',
    tagline: 'A level breaks, price comes back to test it from the other side, and it holds.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'level',
        title: 'The level has been respected before',
        sub: 'At least two swing points at the same price. One touch is a line, not a level.',
        precise: 'Two or more swing highs/lows (5 candles each side) within 0.3 ATR of each other in the last 300 candles.',
        kind: 'chart',
      },
      {
        id: 'break',
        title: 'Price broke through it with a candle CLOSE',
        sub: 'Wicks through do not count. The close is the vote.',
        precise: 'A close at least 0.3 ATR beyond the level 3–30 candles ago, coming from the other side.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'Price came back, touched the level, and CLOSED away from it',
        sub: 'The old ceiling is now the floor to buy; the old floor is the ceiling to sell.',
        precise: 'Low within 0.2 ATR of the level and not more than 0.5 ATR through it; green, closing above it (mirror to sell).',
        kind: 'chart',
      },
      {
        id: 'void',
        title: 'No candle has closed back through the level since the break',
        sub: 'If it closed back through, the break failed. That is the void condition.',
        precise: 'Since the break, no close more than 0.3 ATR back on the wrong side.',
        kind: 'chart',
      },
      {
        id: 'room',
        title: 'There is room to the target',
        sub: 'No other level between entry and 2R. A target behind a wall rarely gets hit.',
        precise: 'No level with two or more touches between entry and target.',
        kind: 'chart',
      },
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the level by 0.3 ATR, or past the trigger candle, whichever is further.'),
    ],
  },
  rsi: {
    id: 'rsi',
    name: 'RSI Divergence',
    family: 'Reversal',
    tagline: 'Price pushes to a new extreme but RSI does not follow. The move is running out of fuel.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'diverge',
        title: 'Price made a new low and RSI did not',
        sub: 'Lower low on price, higher low on RSI to buy. Higher high, lower high on RSI to sell.',
        precise: 'Two swing lows (2 candles each side) 5–40 candles apart; second price low lower, second RSI low at least 3 points higher.',
        kind: 'chart',
      },
      {
        id: 'extreme',
        title: 'The first RSI low was oversold',
        sub: 'Under 35 to buy, over 65 to sell. Divergence in the middle of the range is noise.',
        precise: 'Lowest RSI around the first swing under 35 (highest over 65, to sell).',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'A candle CLOSED back through the second swing candle',
        sub: 'Green close above the high of the second-low candle to buy; red below the low of the second-high candle to sell.',
        precise: 'The first such close, within 6 candles of the second swing.',
        kind: 'chart',
      },
      {
        id: 'void',
        title: 'No new extreme since the second swing',
        sub: 'If price made a lower low after it, the divergence is gone. That is the void condition.',
        precise: 'Nothing below the second swing low since it formed (above the high, to sell).',
        kind: 'chart',
      },
      {
        id: 'steam',
        title: 'The trend is losing steam, not speeding up',
        sub: 'Divergence against a runaway trend gets run over.',
        precise: 'EMA20 moved less than 1.5 ATR over the last 10 candles.',
        kind: 'chart',
      },
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the second swing by 0.2 ATR.'),
    ],
  },
  session: {
    id: 'session',
    name: 'Session Breakout',
    family: 'Volatility',
    tagline: 'Asia builds a quiet box overnight. London arrives and breaks it.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'tight',
        title: 'The Asian range is a normal size',
        sub: 'A box that already stretched has spent its energy. One that is tiny is just a quiet night.',
        precise: 'High–low from 00:00 to 07:00 UTC is 0.5–1.3× the average of the previous 10 days.',
        kind: 'chart',
      },
      {
        id: 'window',
        title: 'It is the London open window',
        sub: '07:00 to 10:00 UTC. A late break is a different trade.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'A candle CLOSED outside the range',
        sub: 'Above the high to buy, below the low to sell. A wick outside is not a break.',
        precise: 'Close at least 0.1 ATR beyond the range.',
        kind: 'chart',
      },
      {
        id: 'first',
        title: 'It is the first break of the day',
        sub: 'If price already closed outside the box today, either side, the clean break is gone.',
        kind: 'chart',
      },
      {
        id: 'body',
        title: 'The breakout candle is strong',
        sub: 'Body at least half of the candle. A doji poking out is not conviction.',
        kind: 'chart',
      },
      {
        id: 'htf',
        title: 'The bigger trend does not fight it',
        sub: 'Breakouts against the hourly trend fail more often.',
        precise: 'Price above EMA200 to buy, below to sell.',
        kind: 'chart',
      },
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      stopBase('Stop goes at the middle of the Asian range.'),
    ],
  },
  bb: {
    id: 'bb',
    name: 'Bollinger Snap-back',
    family: 'Mean reversion',
    tagline: 'Price stretches outside the band, then snaps back inside. Trade the return to normal.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'stretch',
        title: 'The candle before closed OUTSIDE the band',
        sub: 'Below the lower band to buy, above the upper band to sell. A wick outside is not a stretch.',
        precise: 'Bollinger Bands 20, 2. Previous close beyond the band.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'This candle CLOSED back inside the band',
        sub: 'Green and back above the lower band to buy; red and back below the upper band to sell.',
        kind: 'chart',
      },
      {
        id: 'rsi',
        title: 'RSI was at an extreme on the stretch',
        sub: 'Under 30 to buy, over 70 to sell. Without it the stretch is just a strong move.',
        precise: 'RSI(14) on the stretch candle.',
        kind: 'chart',
      },
      {
        id: 'calm',
        title: 'The market is not trending hard',
        sub: 'Snap-backs work in ranges. In a runaway trend price walks along the band.',
        precise: 'EMA50 moved less than 2 ATR over the last 20 candles.',
        kind: 'chart',
      },
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the stretch extreme, plus 0.1 ATR.'),
    ],
  },
  macd: {
    id: 'macd',
    name: 'MACD Trend Cross',
    family: 'Momentum',
    tagline: 'In an uptrend, the MACD dips below zero and crosses back up. The dip is over.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'trigger',
        title: 'MACD crossed its signal line on this candle',
        sub: 'Crossing up to buy, crossing down to sell.',
        precise: 'MACD 12, 26, 9. Above the signal now, at or below it one candle ago (mirror to sell).',
        kind: 'chart',
      },
      {
        id: 'zero',
        title: 'The cross happened on the far side of zero',
        sub: 'Below zero to buy, above zero to sell. That makes it a dip in a trend, not a chase.',
        kind: 'chart',
      },
      {
        id: 'ema',
        title: 'Price closed on the right side of EMA50',
        sub: 'Above to buy, below to sell. The short trend has turned back your way.',
        kind: 'chart',
      },
      HTF_BASE,
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the extreme of the last 10 candles, plus 0.1 ATR.'),
    ],
  },
  donchian: {
    id: 'donchian',
    name: 'Donchian Breakout',
    family: 'Trend breakout',
    tagline: 'Price has been boxed in for 5 hours. A close above the box starts the next leg.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'trigger',
        title: 'A candle CLOSED above the 20-candle high',
        sub: 'Above the highest high of the last 20 candles to buy, below the lowest low to sell.',
        kind: 'chart',
      },
      {
        id: 'quiet',
        title: 'The box was quiet',
        sub: 'A tight box stores energy. A wide one has already moved.',
        precise: '20-candle high minus low between 2 and 8 ATR.',
        kind: 'chart',
      },
      {
        id: 'fresh',
        title: 'It is a fresh breakout',
        sub: 'No close outside the box in the 10 candles before. Late breakouts are chases.',
        kind: 'chart',
      },
      {
        id: 'body',
        title: 'The breakout candle is strong',
        sub: 'Body at least half of the candle.',
        kind: 'chart',
      },
      HTF_BASE,
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes at the middle of the box.'),
    ],
  },
  inside: {
    id: 'inside',
    name: 'Inside Bar Breakout',
    family: 'Price action',
    tagline: 'A big candle, then a small one inside it: the market pauses. Trade the side it breaks.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'mother',
        title: 'Two candles ago was a big "mother" candle',
        sub: 'Its range is at least 1.2 ATR.',
        kind: 'chart',
      },
      {
        id: 'inside',
        title: 'The next candle stayed completely inside it',
        sub: 'High no higher, low no lower than the mother candle.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'This candle CLOSED outside the mother candle',
        sub: 'Above its high to buy, below its low to sell.',
        kind: 'chart',
      },
      {
        id: 'trend',
        title: 'EMA20 is on the right side of EMA50',
        sub: 'Above to buy, below to sell. Trade the break that goes with the trend.',
        kind: 'chart',
      },
      HTF_BASE,
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the inside candle, plus 0.1 ATR.'),
    ],
  },
  pin: {
    id: 'pin',
    name: 'Pin Bar Rejection',
    family: 'Price action at a level',
    tagline: 'Price stabs through a level and gets thrown back. The long wick is the rejection.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'trigger',
        title: 'This candle is a pin bar',
        sub: 'Long lower wick and a close in the top third to buy; long upper wick, close in the bottom third to sell.',
        precise: 'Wick at least 2× the body and at least 60% of the candle.',
        kind: 'chart',
      },
      {
        id: 'level',
        title: 'The wick tested a real level',
        sub: 'The wick reached an earlier swing low (high, to sell). A pin bar in the middle of nowhere means little.',
        precise: 'A swing point (5 candles each side) from the last 200 candles within 0.3 ATR of the wick.',
        kind: 'chart',
      },
      {
        id: 'extreme',
        title: 'The wick made the lowest point of the last 10 candles',
        sub: 'Highest point, to sell. It swept the stops below, then got rejected.',
        kind: 'chart',
      },
      HTF_BASE,
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      HOURS_BASE,
      stopBase('Stop goes beyond the wick, plus 0.1 ATR.'),
    ],
  },
  nyorb: {
    id: 'nyorb',
    name: 'NY Open Breakout',
    family: 'Session',
    tagline: 'New York opens, the first 30 minutes set a range. The first clean close outside it leads.',
    triggerRule: 'trigger',
    rules: [
      {
        id: 'size',
        title: 'The opening range is a normal size',
        sub: 'Not a tiny doji pair, not an already-exploded move.',
        precise: 'First 30 minutes after the NY stock open (13:30 UTC in US summer, 14:30 in winter): 0.8–3 ATR high.',
        kind: 'chart',
      },
      {
        id: 'window',
        title: 'It is within 90 minutes of the range',
        sub: 'Late breaks lose the opening momentum.',
        kind: 'chart',
      },
      {
        id: 'trigger',
        title: 'A candle CLOSED outside the opening range',
        sub: 'Above the high to buy, below the low to sell, by at least 0.1 ATR.',
        kind: 'chart',
      },
      {
        id: 'first',
        title: 'It is the first break after the open',
        sub: 'If price already closed outside on either side, the clean break is gone.',
        kind: 'chart',
      },
      HTF_BASE,
      LIVE_CLOSED,
      LIVE_NEWS,
      LIVE_ORDER,
      stopBase('Stop goes at the middle of the opening range.'),
    ],
  },
};

export function chartRules(sys: SystemId) {
  return SYSTEMS[sys].rules.filter((r) => r.kind === 'chart');
}

export function ruleTitle(sys: SystemId, id: string): string {
  return SYSTEMS[sys].rules.find((r) => r.id === id)?.title ?? id;
}
