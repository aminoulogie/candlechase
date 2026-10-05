import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Series } from '../engine/types';

export interface PriceMark {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

export interface BarMark {
  /** local index */
  i: number;
  text: string;
  color: string;
  above: boolean;
  shape?: 'arrowUp' | 'arrowDown' | 'circle';
}

interface Props {
  s: Series;
  /** last visible local index */
  upto: number;
  digits: number;
  /** show dates in the crosshair label */
  showDate: boolean;
  lines?: PriceMark[];
  marks?: BarMark[];
  /** two local indexes to join on price and on RSI (divergence) */
  divergence?: { a: number; b: number; up: boolean };
  /** highlight these bars (Asian range) */
  shade?: { from: number; to: number; hi: number; lo: number };
  onTapPrice?: (price: number) => void;
  /** candles an explanation is pointing at */
  focus?: BarMark[];
  /** how many candles before `upto` to show */
  span?: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const hhmm = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const full = (t: number) =>
  new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';

const HISTORY = 400;

export function Chart({ s, upto, digits, showDate, lines = [], marks = [], focus = [], divergence, shade, onTapPrice, span = 90 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    candles: ISeriesApi<'Candlestick'>;
    e20: ISeriesApi<'Line'>;
    e50: ISeriesApi<'Line'>;
    e200: ISeriesApi<'Line'>;
    rsi: ISeriesApi<'Line'>;
    divPrice: ISeriesApi<'Line'>;
    divRsi: ISeriesApi<'Line'>;
    shadeHi: ISeriesApi<'Line'>;
    shadeLo: ISeriesApi<'Line'>;
    markers: ISeriesMarkersPluginApi<Time>;
    priceLines: IPriceLine[];
  } | null>(null);
  const tapRef = useRef(onTapPrice);
  tapRef.current = onTapPrice;
  const showDateRef = useRef(showDate);
  showDateRef.current = showDate;

  useEffect(() => {
    const el = box.current!;
    const text = css('--muted');
    const grid = css('--grid');
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: text, fontSize: 11, attributionLogo: false, panes: { separatorColor: grid } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: (t: Time) => hhmm(t as number),
      },
      localization: {
        timeFormatter: (t: Time) => (showDateRef.current ? full(t as number) : hhmm(t as number) + ' UTC'),
      },
    });
    const fmt = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits };
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: css('--up'),
      downColor: css('--down'),
      borderVisible: false,
      wickUpColor: css('--up'),
      wickDownColor: css('--down'),
      priceFormat: fmt,
    });
    const line = (color: string, width: 1 | 2, style = LineStyle.Solid, pane = 0) =>
      chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt }, pane);
    const e20 = line(css('--ema20'), 2);
    const e50 = line(css('--ema50'), 2);
    const e200 = line(css('--ema200'), 1, LineStyle.Dashed);
    const shadeHi = line(css('--sys-session'), 2);
    const shadeLo = line(css('--sys-session'), 2);
    const divPrice = line(css('--text'), 2, LineStyle.Dashed);
    const rsi = chart.addSeries(LineSeries, { color: css('--rsi'), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 } }, 1);
    const divRsi = chart.addSeries(LineSeries, { color: css('--text'), lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 1);
    for (const [v, c] of [[70, '--down'], [50, '--muted'], [30, '--up']] as const) {
      rsi.createPriceLine({ price: v, color: css(c), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeClick((p) => {
      if (!p.point || !tapRef.current) return;
      const price = candles.coordinateToPrice(p.point.y);
      if (price !== null) tapRef.current(price);
    });
    api.current = { chart, candles, e20, e50, e200, rsi, divPrice, divRsi, shadeHi, shadeLo, markers, priceLines: [] };
    return () => {
      chart.remove();
      api.current = null;
    };
  }, [s, digits]);

  // candles + indicators up to `upto`
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const from = Math.max(0, upto - HISTORY);
    const t = (i: number) => s.t[i] as UTCTimestamp;
    const bars = [];
    const l20 = [];
    const l50 = [];
    const l200 = [];
    const r = [];
    for (let i = from; i <= upto && i < s.t.length; i++) {
      bars.push({ time: t(i), open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] });
      if (!Number.isNaN(s.ema20[i])) l20.push({ time: t(i), value: s.ema20[i] });
      if (!Number.isNaN(s.ema50[i])) l50.push({ time: t(i), value: s.ema50[i] });
      if (!Number.isNaN(s.ema200[i])) l200.push({ time: t(i), value: s.ema200[i] });
      if (!Number.isNaN(s.rsi[i])) r.push({ time: t(i), value: s.rsi[i] });
    }
    a.candles.setData(bars);
    a.e20.setData(l20);
    a.e50.setData(l50);
    a.e200.setData(l200);
    a.rsi.setData(r);
  }, [s, upto]);

  // keep the newest candle in view, keeping whatever zoom the user chose
  const lastUpto = useRef(-1);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const from = Math.max(0, upto - HISTORY);
    const idx = upto - from;
    const ts = a.chart.timeScale();
    if (lastUpto.current < 0 || Math.abs(upto - lastUpto.current) > 30) {
      ts.setVisibleLogicalRange({ from: idx - span, to: idx + 6 });
    } else {
      const r = ts.getVisibleLogicalRange();
      if (r && idx + 3 > r.to) ts.scrollToRealTime();
    }
    lastUpto.current = upto;
  }, [s, upto, span]);

  // overlays
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.priceLines.forEach((p) => a.candles.removePriceLine(p));
    a.priceLines = lines.map((l) =>
      a.candles.createPriceLine({ price: l.price, color: l.color, lineWidth: 2, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title }),
    );
    const m: SeriesMarker<Time>[] = [...marks, ...focus]
      .filter((k) => k.i <= upto && k.i >= 0)
      .sort((x, y) => x.i - y.i)
      .map((k) => ({
        time: s.t[k.i] as UTCTimestamp,
        position: k.above ? 'aboveBar' : 'belowBar',
        color: k.color,
        shape: k.shape ?? (k.above ? 'arrowDown' : 'arrowUp'),
        text: k.text,
      }));
    a.markers.setMarkers(m);
    if (divergence) {
      const { a: i1, b: i2, up } = divergence;
      const px = up ? s.l : s.h;
      a.divPrice.setData([
        { time: s.t[i1] as UTCTimestamp, value: px[i1] },
        { time: s.t[i2] as UTCTimestamp, value: px[i2] },
      ]);
      a.divRsi.setData([
        { time: s.t[i1] as UTCTimestamp, value: s.rsi[i1] },
        { time: s.t[i2] as UTCTimestamp, value: s.rsi[i2] },
      ]);
    } else {
      a.divPrice.setData([]);
      a.divRsi.setData([]);
    }
    if (shade) {
      const pts = (v: number) => {
        const out = [];
        for (let i = shade.from; i <= shade.to; i++) out.push({ time: s.t[i] as UTCTimestamp, value: v });
        return out;
      };
      a.shadeHi.setData(pts(shade.hi));
      a.shadeLo.setData(pts(shade.lo));
    } else {
      a.shadeHi.setData([]);
      a.shadeLo.setData([]);
    }
  }, [s, upto, lines, marks, focus, divergence, shade]);

  return <div className="chart-box" ref={box} />;
}
