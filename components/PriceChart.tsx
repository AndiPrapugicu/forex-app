'use client';

/**
 * Candlesticks with our own levels drawn on them — zoomable, pannable, with a
 * crosshair.
 *
 * WHY A LIBRARY HERE, WHEN EVERY OTHER CHART IN THIS APP IS HAND-ROLLED SVG.
 * `IndicatorChart` and `ScoreHistoryChart` argue that a charting library would
 * cost more bundle than the whole page, and for a static bar series that is
 * right — they stay as they are. This chart is a different problem: it needs
 * wheel zoom, drag pan, a snapping crosshair, an auto-scaling price axis and a
 * time axis that re-labels as you zoom. Hand-rolling that is several hundred
 * lines of interaction code whose bugs are all subtle, and it is exactly what
 * Lightweight Charts already is — 45KB gzipped, Apache-2.0, and written by
 * TradingView themselves.
 *
 * WHY NOT JUST EMBED TRADINGVIEW. Their free widget frames fine, but it has no
 * API for custom horizontal lines, so the broken-structure level, the
 * retracement grid and the confluence zones could only ever sit in a list
 * beside the price. This library exposes `createPriceLine`, so the levels go ON
 * the chart, which is the whole point of the page. It also runs from our own
 * bundle: no third-party script, no outbound request, and it still works with
 * `USE_FIXTURES=true` and no network.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  TIMEFRAME_SPEC,
  smaSeries,
  type ChartTimeframe,
  type DailyBars,
} from '@/lib/connectors/technicals';
import { freshnessOf, pollIntervalFor, useLiveQuote } from '@/lib/hooks/useLiveQuotes';
import type { StructureView } from '@/lib/scoring/structure';
import type { TradeIdea } from '@/lib/scoring/trade-ideas';
import { priceDecimals } from '@/components/ui';

/**
 * Literal hex, not `var(--color-bull-cell)`, and this is the one place that is
 * correct. These go to Lightweight Charts, which paints to a canvas — a CSS
 * custom property means nothing there, and it would silently render black.
 * Keep them in step with the `-cell` tokens in globals.css.
 */
const BULL = '#2d6fe6';
const BEAR = '#e5484d';

/** Bars in view on first paint. The rest stays scrollable to the left. */
const INITIAL_BARS = 150;

/**
 * The moving averages drawn on the price.
 *
 * 20/50/200 and not the 100 the scorecard also computes: four lines on a
 * candle chart is more ink than price, and the 100 is the one of the four that
 * no trading convention treats as a level in its own right.
 */
const SMA_OVERLAYS = [
  { period: 20, color: '#4fb0c6' },
  { period: 50, color: '#e0a13a' },
  { period: 200, color: '#b07ae0' },
] as const;

/** Pixels of the 440px chart given to the volume pane, when there is one. */
const VOLUME_PANE_HEIGHT = 84;

/** 1.24M rather than 1,238,400 — the legend has one line and volume is context. */
function compactVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/**
 * The bar's own stamp, at the resolution the bar has.
 *
 * A 1-minute bar needs its time and a weekly one does not — printing
 * "00:00Z" under a weekly candle implies a precision the bucket does not carry.
 * Always UTC, always marked as such: every timestamp in this app is Yahoo's,
 * every level was computed in UTC, and silently rendering one in the reader's
 * local zone is how a bar gets attributed to the wrong session.
 */
function barStamp(time: number, bucketSeconds: number): string {
  const iso = new Date(time * 1000).toISOString();
  return bucketSeconds < 86_400 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z` : iso.slice(0, 10);
}

interface Hovered {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export function PriceChart({
  bars,
  view,
  idea,
  label,
  symbol,
  timeframe,
  structureTimeframe,
}: {
  bars: DailyBars;
  view: StructureView;
  idea: TradeIdea | null;
  label: string;
  symbol: string;
  timeframe: ChartTimeframe;
  structureTimeframe: ChartTimeframe;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  /** Candlesticks normally; a line when the source sends sampled points. */
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /**
   * The bar currently being built out of live ticks. Held here rather than in
   * state so a tick does not have to wait for a render to accumulate, and kept
   * out of `candles` so the SMAs, markers and levels keep seeing closed bars
   * only.
   */
  const formingBar = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);
  const livePriceLine = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);

  /**
   * True from the moment `chart.remove()` is called until the next mount.
   *
   * REACT RUNS A COMPONENT'S EFFECT CLEANUPS IN DECLARATION ORDER, so the
   * teardown below runs BEFORE the cleanups of the two effects that follow it.
   * Those hold a captured `series` and would each touch a destroyed chart.
   *
   * That is not a harmless no-op. `removePriceLine` on a dead series reaches
   * the model's invalidate handler, which schedules a fresh
   * `requestAnimationFrame` — after `destroy()` has already cancelled the
   * pending one, so nothing cancels this one. A frame later the draw touches
   * the destroyed time-axis widget and its canvas binding throws
   * "Object is disposed". Because that lands a frame after unmount, the error
   * surfaced on whatever page had been navigated to — /scorecard/[symbol],
   * which has no chart on it at all.
   *
   * A ref rather than a check on `chartRef.current`: it says what it means, and
   * it stays correct if the teardown order below is ever reordered.
   */
  const disposed = useRef(false);

  const [live, setLive] = useState(true);
  const [showSmas, setShowSmas] = useState(true);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  /** The forming bar as the live tick has left it. Null until the first tick. */
  const [liveBar, setLiveBar] = useState<Hovered | null>(null);
  const quote = useLiveQuote(symbol, live);
  const freshness = freshnessOf(quote);

  /** The bar the live price belongs to, so a tick extends it instead of adding one. */
  const spec = TIMEFRAME_SPEC[timeframe];
  const { bucketSeconds, anchorOffset } = spec;

  /**
   * Lightweight Charts rejects duplicate or out-of-order timestamps outright.
   * Resampled 4H buckets are already unique and ascending, but a Yahoo series
   * occasionally repeats a stamp, and one repeat throws away the whole render —
   * so dedupe rather than trust it.
   *
   * Volume is carried alongside on the same filtered indices, so a dropped
   * duplicate cannot shift the histogram one bar out of step with the candles.
   */
  const candles = useMemo(() => {
    const seen = new Set<number>();
    const out: {
      time: UTCTimestamp;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number | null;
    }[] = [];
    for (let i = 0; i < bars.closes.length; i++) {
      const time = bars.timestamps[i];
      if (seen.has(time)) continue;
      seen.add(time);
      out.push({
        time: time as UTCTimestamp,
        open: bars.opens[i],
        high: bars.highs[i],
        low: bars.lows[i],
        close: bars.closes[i],
        volume: bars.volumes ? bars.volumes[i] : null,
      });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [bars]);

  /**
   * Spot FX has no volume to report and Yahoo sends none — see `DailyBars`. No
   * pane at all in that case, rather than an empty one implying the data is
   * merely missing.
   */
  const hasVolume = bars.volumes !== undefined;

  /**
   * TRUE WHEN THE SOURCE GAVE US SAMPLED POINTS RATHER THAN BARS.
   *
   * Yahoo's 1-minute series for SPOT FX is not OHLC at all: measured on
   * GBPUSD=X, all 9,222 bars came back with open, high, low and close equal —
   * a mean range of exactly zero. They are single samples once a minute, and
   * there is no tick data behind them because spot FX has no exchange. The same
   * request for GC=F, BTC-USD and even GBPUSD at 5m returns real ranges (0.2%,
   * 1.0% and 0.4% flat respectively), so this is specific and detectable rather
   * than a general caveat.
   *
   * Drawing those as candlesticks produces a field of one-pixel dots that reads
   * as a broken chart. They are not broken; they are points, and a line is what
   * a series of points looks like. Detected from the data rather than hardcoded
   * per symbol, so a source that starts sending real 1m bars is drawn as bars
   * the moment it does.
   */
  const sampledNotBars = useMemo(() => {
    if (candles.length < 20) return false;
    let flat = 0;
    for (const c of candles) if (c.high === c.low) flat++;
    return flat / candles.length > 0.9;
  }, [candles]);

  /**
   * Averages of the SERIES ON SCREEN, so the 20 on a 15-minute chart is a
   * 5-hour average and says so in the legend. These are a different object from
   * the daily SMAs behind the confluence zones, which stay where they were —
   * conflating the two would put an "SMA 200" line and an "SMA 200" level at
   * different prices with the same name.
   */
  const smaLines = useMemo(
    () =>
      SMA_OVERLAYS.map(({ period, color }) => ({
        period,
        color,
        data: smaSeries(
          candles.map((c) => c.close),
          period,
        ).map((value, i) =>
          value === null ? { time: candles[i].time } : { time: candles[i].time, value },
        ),
      })),
    [candles],
  );

  /**
   * Create once. Data and levels are pushed in the second effect, so a redraw
   * updates the chart rather than tearing down the canvas and losing the zoom.
   */
  useEffect(() => {
    if (!host.current) return;

    disposed.current = false;

    const chart = createChart(host.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7794',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(107,119,148,0.08)' },
        horzLines: { color: 'rgba(107,119,148,0.08)' },
      },
      crosshair: {
        // Magnet snaps the crosshair to OHLC, which is what makes reading a
        // level off the chart precise rather than approximate.
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(107,119,148,0.5)', labelBackgroundColor: '#1a1f2e' },
        horzLine: { color: 'rgba(107,119,148,0.5)', labelBackgroundColor: '#1a1f2e' },
      },
      rightPriceScale: { borderColor: 'rgba(107,119,148,0.2)' },
      timeScale: { borderColor: 'rgba(107,119,148,0.2)', rightOffset: 6 },
      autoSize: true,
    });

    // Captured so the cleanup clears the map this effect populated, rather
    // than whatever `smaRefs.current` happens to point at by then.
    const smas = smaRefs.current;

    chartRef.current = chart;
    const priceSeries = sampledNotBars
      ? chart.addSeries(LineSeries, { color: BULL, lineWidth: 2, priceLineVisible: false })
      : chart.addSeries(CandlestickSeries, {
          upColor: BULL,
          downColor: BEAR,
          borderUpColor: BULL,
          borderDownColor: BEAR,
          wickUpColor: BULL,
          wickDownColor: BEAR,
        });
    seriesRef.current = priceSeries;
    markersRef.current = createSeriesMarkers(priceSeries);

    /**
     * The moving averages go on the PRICE pane, under the candles by creation
     * order, and are excluded from the price scale's autoscale range. A 200
     * average that has not warmed up yet is far from price, and letting it vote
     * on the axis squashed the candles into the top third of the pane.
     */
    for (const { period, color } of SMA_OVERLAYS) {
      smas.set(
        period,
        chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        }),
      );
    }

    /**
     * Volume in its OWN pane, via the third argument to `addSeries` — the one
     * this app had never passed. An overlay on the price pane is the usual
     * shortcut and it is wrong here: it either compresses the candles to fit
     * volume's range or floats over them, and both cost more than the pane's
     * 84 pixels.
     */
    if (hasVolume) {
      volumeRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          priceLineVisible: false,
          lastValueVisible: false,
        },
        1,
      );
      chart.panes()[1]?.setHeight(VOLUME_PANE_HEIGHT);
    }

    /**
     * The OHLC legend. Reads the hovered bar out of the crosshair event and
     * nulls it on the way out, so leaving the chart falls back to the last
     * close rather than freezing on whatever was under the cursor.
     */
    const onCrosshair: Parameters<typeof chart.subscribeCrosshairMove>[0] = (param) => {
      if (disposed.current) return;
      const bar = param.seriesData.get(priceSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!bar || param.time === undefined) {
        setHovered(null);
        return;
      }
      const vol = volumeRef.current
        ? (param.seriesData.get(volumeRef.current) as { value: number } | undefined)
        : undefined;
      setHovered({
        time: param.time as number,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol?.value ?? null,
      });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      disposed.current = true;
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      smas.clear();
      // All four belonged to the chart just destroyed. Left set, a remount would
      // hand the next effect handles from a chart that no longer exists.
      markersRef.current = null;
      livePriceLine.current = null;
    };
    // Both decide which SERIES OBJECTS exist, so a change has to rebuild the
    // chart rather than push different data into the wrong kind of series. In
    // practice neither changes without the symbol or timeframe changing too,
    // which already remounts this component via its key.
  }, [hasVolume, sampledNotBars]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const dp = priceDecimals(view.price);
    series.applyOptions({
      priceFormat: { type: 'price', precision: dp, minMove: 10 ** -dp },
    });

    if (sampledNotBars) {
      (series as ISeriesApi<'Line'>).setData(candles.map((c) => ({ time: c.time, value: c.close })));
    } else {
      (series as ISeriesApi<'Candlestick'>).setData(candles);
    }

    /**
     * Volume bars take the candle's own colour, which is the whole reason a
     * volume pane is worth having: a big red bar and a big blue bar mean
     * opposite things and an all-one-colour histogram hides that.
     */
    if (volumeRef.current) {
      volumeRef.current.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume ?? 0,
          color: c.close >= c.open ? 'rgba(58,122,224,0.45)' : 'rgba(242,80,110,0.45)',
        })),
      );
    }

    for (const { period, data } of smaLines) {
      smaRefs.current.get(period)?.setData(data);
    }

    /**
     * Entry, stop and target, pinned to their exact prices at the right edge.
     *
     * `atPriceMiddle` rather than the usual above/below-bar placement: these are
     * price levels, not events, and a marker floating over a bar it has nothing
     * to do with would be decoration. Drawn from `buildTradeIdea` — the same
     * call the trade panel renders — so the two cannot disagree.
     */
    if (markersRef.current) {
      const last = candles[candles.length - 1];
      const markers: SeriesMarker<Time>[] =
        idea && last
          ? [
              {
                time: last.time,
                position: 'atPriceMiddle',
                price: (idea.entryMin + idea.entryMax) / 2,
                shape: idea.direction === 'long' ? 'arrowUp' : 'arrowDown',
                color: '#e6e9f0',
                /**
                 * The MIDPOINT, not the band. Marker text is centred on the
                 * marker and the marker sits on the last bar, so half of it
                 * hangs into the six bars of right offset — measured on EURUSD,
                 * "entry 1.15257–1.15523" lost its last four characters to the
                 * price scale. Both edges of the band are spelled out in the
                 * footer, where nothing can clip them.
                 */
                text: `entry ${((idea.entryMin + idea.entryMax) / 2).toFixed(dp)}`,
              },
              {
                time: last.time,
                position: 'atPriceMiddle',
                price: idea.stop,
                shape: 'square',
                color: BEAR,
                text: `stop ${idea.stop.toFixed(dp)}`,
              },
              {
                time: last.time,
                position: 'atPriceMiddle',
                price: idea.target,
                shape: 'square',
                color: BULL,
                text: `target ${idea.target.toFixed(dp)}`,
              },
            ]
          : [];
      markersRef.current.setMarkers(markers);
    }

    /**
     * Re-enable autoscale explicitly on every data change.
     *
     * Without this, switching from USDJPY to EURUSD left the axis pinned to the
     * 155-163 range and the euro's 1.14 candles rendered off-canvas. The price
     * scale keeps whatever range it last computed, and `setVisibleLogicalRange`
     * below can settle before the new data's extent is known.
     */
    chart.priceScale('right').applyOptions({ autoScale: true });

    /**
     * Levels are recreated wholesale on every data change; there is no partial
     * update that could leave a stale line from the previous symbol behind.
     *
     * `drawn` suppresses duplicates. A confluence zone is usually MADE OF the
     * broken level or a range edge, so both were drawing a line at the same
     * price and their axis labels stacked on top of each other — two tags for
     * one level, which reads as two levels. First one wins, and the ordering
     * below puts the structural line first deliberately.
     */
    const lines: ReturnType<typeof series.createPriceLine>[] = [];
    const drawn: number[] = [];
    const tick = 10 ** -dp;

    const line = (
      price: number,
      title: string,
      color: string,
      style: LineStyle,
      width: 1 | 2 = 1,
    ) => {
      if (drawn.some((p) => Math.abs(p - price) <= tick)) return;
      drawn.push(price);
      lines.push(
        series.createPriceLine({
          price,
          color,
          lineWidth: width,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        }),
      );
    };

    const brk = view.structure.latest;
    if (brk) {
      line(
        brk.level,
        brk.direction === 'bullish' ? 'BOS support' : 'BOS resistance',
        '#e6e9f0',
        LineStyle.Solid,
        2,
      );
    } else if (view.structure.range) {
      line(view.structure.range.high, 'range high', '#e6e9f0', LineStyle.Solid, 2);
      line(view.structure.range.low, 'range low', '#e6e9f0', LineStyle.Solid, 2);
    }

    /**
     * Zones before individual fib levels, and each zone NAMES ITS SOURCES.
     *
     * Drawing both put two lines two ticks apart — "2x support" and "fib 0.618"
     * — for what is one level. Labelling the zone "0.618+SMA 50" says the same
     * thing in one line and says it better: the count alone never told you what
     * the confluence was made of.
     */
    const covered = new Set<number>();

    for (const zone of view.zones) {
      if (zone.sources.length < 2) continue;

      const golden = zone.sources.some((src) => src.kind === 'fib' && src.label.includes('0.618'));
      line(
        zone.price,
        zone.sources.map((src) => src.label.replace('fib ', '')).join('+'),
        golden ? '#e0a13a' : zone.side === 'support' ? 'rgb(var(--color-bull-cell-rgb) / 75%)' : 'rgba(242,80,110,0.75)',
        LineStyle.Solid,
        golden ? 2 : 1,
      );
      for (const src of zone.sources) covered.add(src.price);
    }

    // Whatever the zones did not already account for.
    if (view.fib && !view.fib.invalidated) {
      for (const level of view.fib.levels) {
        if (covered.has(level.price)) continue;
        const golden = level.ratio === 0.618;
        line(
          level.price,
          `fib ${level.ratio}`,
          golden ? '#e0a13a' : 'rgba(107,119,148,0.7)',
          golden ? LineStyle.Solid : LineStyle.Dashed,
          golden ? 2 : 1,
        );
      }
    }

    /**
     * Show the recent window rather than two years squeezed into the canvas,
     * but leave the rest scrollable — the user asked for zoom, so the history
     * has to still be there to zoom out into.
     */
    const total = candles.length;
    if (total > INITIAL_BARS) {
      chart.timeScale().setVisibleLogicalRange({ from: total - INITIAL_BARS, to: total + 6 });
    } else {
      chart.timeScale().fitContent();
    }

    return () => {
      // The chart teardown above already took every line with it.
      if (disposed.current) return;
      for (const l of lines) series.removePriceLine(l);
    };
  }, [candles, view, smaLines, idea, sampledNotBars]);

  /**
   * The SMA toggle. `applyOptions` rather than adding and removing series, so
   * turning them back on does not re-push a few thousand points.
   */
  useEffect(() => {
    if (disposed.current) return;
    for (const series of smaRefs.current.values()) series.applyOptions({ visible: showSmas });
  }, [showSmas]);

  /**
   * The live tick, merged into the forming bar.
   *
   * `series.update()` on the CURRENT bucket extends it; a tick that has crossed
   * into a new bucket opens a bar instead. High and low only ever widen, so a
   * poll that misses the actual extreme understates the wick rather than
   * inventing one — and Yahoo's own day high/low is preferred where they send
   * it, since it saw the ticks between our polls.
   *
   * NOTHING ELSE MOVES. Every level, swing and retracement on this chart was
   * computed server-side from closed bars. A live price that silently redrew
   * them would mean the levels shifted under an order without the page saying
   * so, which is the one thing this chart must not do.
   */
  useEffect(() => {
    const series = seriesRef.current;
    const last = candles[candles.length - 1];
    if (disposed.current || !series || !quote || !last) return;

    /**
     * Anchored exactly as `resampleBars` anchors, offset and all — a weekly
     * candle starts on a Monday, and a live tick computing its bucket from the
     * bare epoch would open a phantom Thursday bar beside the real week.
     */
    const t = quote.time ?? Date.now() / 1000;
    const bucket = Math.floor((t + anchorOffset) / bucketSeconds) * bucketSeconds - anchorOffset;

    /**
     * THE DAY'S RANGE BELONGS ONLY TO A BAR THAT IS AT LEAST A DAY LONG.
     *
     * This folded `quote.dayHigh`/`quote.dayLow` into the forming bar
     * unconditionally, which is right for the daily candle — the day's extremes
     * ARE that bar's extremes, and Yahoo saw ticks between our polls that we did
     * not. On every intraday width it is badly wrong: it drew the whole session
     * range into one five-minute candle. Observed on GBPUSD, the forming 5m bar
     * spanned 1.3476–1.3501 — the entire day — and rendered as a full-height
     * spike beside candles a couple of pips tall. That single line is most of
     * why the chart did not look like it was showing real price action.
     */
    const dayIsThisBar = bucketSeconds >= 86_400;
    const dayHigh = dayIsThisBar ? (quote.dayHigh ?? quote.price) : quote.price;
    const dayLow = dayIsThisBar ? (quote.dayLow ?? quote.price) : quote.price;

    /**
     * THE FORMING BAR HAS TO REMEMBER ITSELF, and this is the defect that made
     * the whole chart look dead.
     *
     * Both branches used to build the bar from `last` — the SERVER snapshot,
     * which never changes after page load. So the moment the clock crossed into
     * a new bucket, every subsequent tick took the "new bucket" branch and
     * re-opened the bar at the current price: open, high, low and close all set
     * to the same number, over and over. The candle was a doji on every tick
     * forever, and the legend read +0.00% no matter how much price moved. At
     * one bar per day that is nearly invisible; at one per minute it is the
     * entire complaint.
     *
     * Keeping the bar in a ref means the open is fixed when the bucket opens
     * and the extremes only ever widen — which is what a candle is.
     */
    /**
     * NEVER BEHIND THE SERIES. Lightweight Charts rejects an `update` older
     * than the last point outright — "Cannot update oldest data" — and a quote
     * legitimately arrives stamped a second or two before Yahoo's own forming
     * bar, which put the computed bucket one whole candle in the past. Clamping
     * folds that tick into the newest bar, which is where it belongs anyway.
     */
    const barTime = (bucket > last.time ? bucket : last.time) as UTCTimestamp;

    let base = formingBar.current;
    if (!base || base.time !== barTime) {
      base =
        barTime === last.time
          ? // Still inside the last server bar: extend it rather than flatten it.
            { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close }
          : { time: barTime, open: quote.price, high: quote.price, low: quote.price, close: quote.price };
    }

    const merged = {
      time: barTime,
      open: base.open,
      high: Math.max(base.high, dayHigh, quote.price),
      low: Math.min(base.low, dayLow, quote.price),
      close: quote.price,
    };

    formingBar.current = merged;
    if (sampledNotBars) {
      (series as ISeriesApi<'Line'>).update({ time: barTime, value: quote.price });
    } else {
      (series as ISeriesApi<'Candlestick'>).update(merged);
    }

    /**
     * Hand the legend the bar that is actually on the canvas.
     *
     * It used to read `candles`, which is the SERVER snapshot and never changes
     * between page loads — so the legend sat at the last closed value showing
     * O=H=L=C and +0.00% while the candle beside it moved. The live bar is kept
     * in a ref rather than folded back into `candles` so that the memo, the SMA
     * series and the marker placement all keep computing off closed bars only.
     */
    setLiveBar({ ...merged, volume: barTime === last.time ? last.volume : null });

    /**
     * A line, but no axis tag: the series already labels its own last value at
     * this exact price, and a second tag on top of it read as two prices.
     */
    if (livePriceLine.current) series.removePriceLine(livePriceLine.current);
    livePriceLine.current = series.createPriceLine({
      price: quote.price,
      color: 'rgba(107,119,148,0.9)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: '',
    });
  }, [quote, candles, bucketSeconds, anchorOffset, sampledNotBars]);

  const dp = priceDecimals(view.price);

  /**
   * Where the shown bar sits, resolved once. The SMA legend needs it three
   * times and a linear scan per line, on every crosshair move, over a 1-minute
   * series of ten thousand bars, is thirty thousand comparisons per mouse pixel.
   */
  const timeIndex = useMemo(() => {
    const m = new Map<number, number>();
    candles.forEach((c, i) => m.set(c.time, i));
    return m;
  }, [candles]);

  /**
   * Hovered bar first, then the FORMING bar, then the last closed one.
   *
   * The middle term is the fix: this used to fall straight through to
   * `candles`, which is the server snapshot and never changes after load, so
   * the legend sat frozen at O=H=L=C and +0.00% while the candle beside it
   * moved on every tick.
   */
  const shown: Hovered | null =
    hovered ??
    liveBar ??
    (candles.length > 0
      ? {
          time: candles[candles.length - 1].time,
          open: candles[candles.length - 1].open,
          high: candles[candles.length - 1].high,
          low: candles[candles.length - 1].low,
          close: candles[candles.length - 1].close,
          volume: candles[candles.length - 1].volume,
        }
      : null);

  /**
   * Which bar the SMA legend should read.
   *
   * The forming bar is not in `candles` — it does not exist as a closed bar yet
   * — so looking it up returns nothing and all three averages rendered as a
   * dash. The right value there is the last CLOSED bar's, which is exactly what
   * the lines on the canvas end at, since a moving average does not include a
   * bar that has not closed.
   */
  const shownIndex = shown
    ? (timeIndex.get(shown.time) ?? candles.length - 1)
    : -1;

  return (
    <div>
      <div className="relative">
        <div
          ref={host}
          className="h-[440px] w-full"
          role="img"
          aria-label={`${label} candlestick chart with structure levels`}
        />

        {/*
          Absolutely positioned over the canvas, and `pointer-events-none` so it
          cannot swallow the drag that pans the chart underneath it.
        */}
        {shown && (
          <div className="pointer-events-none absolute top-1.5 left-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-micro leading-tight">
            <span className="font-mono font-semibold text-[var(--color-text)]">
              {label}
              <span className="ml-1 font-normal text-[var(--color-faint)]">{spec.label}</span>
            </span>
            {/*
              Only the close when the source sent points rather than bars.
              Printing "O 1.3527 H 1.3527 L 1.3527 C 1.3527" four times over
              would dress a single sample up as an OHLC bar it never was.
            */}
            {(
              sampledNotBars
                ? ([['Price', shown.close]] as const)
                : ([
                    ['O', shown.open],
                    ['H', shown.high],
                    ['L', shown.low],
                    ['C', shown.close],
                  ] as const)
            ).map(([key, value]) => (
              <span key={key} className="tnum">
                <span className="text-[var(--color-faint)]">{key}</span>{' '}
                <span
                  className={
                    shown.close >= shown.open
                      ? 'text-[var(--color-bull)]'
                      : 'text-[var(--color-bear)]'
                  }
                >
                  {value.toFixed(dp)}
                </span>
              </span>
            ))}
            {/*
              The absolute move as well as the percentage. A one-minute FX bar
              that travelled three tenths of a pip is genuinely +0.00% at two
              decimals, so the percentage alone reads as "nothing is happening"
              on exactly the timeframe added to show that something is.
            */}
            {!sampledNotBars && (
              <span className="tnum text-[var(--color-muted)]">
                {shown.close >= shown.open ? '+' : '−'}
                {Math.abs(shown.close - shown.open).toFixed(dp)}
                <span className="ml-1 text-[var(--color-faint)]">
                  ({shown.close >= shown.open ? '+' : '−'}
                  {Math.abs(((shown.close - shown.open) / shown.open) * 100).toFixed(2)}%)
                </span>
              </span>
            )}
            {shown.volume !== null && (
              <span className="tnum text-[var(--color-faint)]">
                Vol {compactVolume(shown.volume)}
              </span>
            )}
            <span className="text-[var(--color-faint)]">{barStamp(shown.time, bucketSeconds)}</span>
            {showSmas &&
              smaLines.map(({ period, color, data }) => {
                const point = shownIndex >= 0 ? data[shownIndex] : undefined;
                const value = point && 'value' in point ? (point.value ?? null) : null;
                return (
                  <span key={period} className="tnum" style={{ color }}>
                    {period} {value === null ? '—' : value.toFixed(dp)}
                  </span>
                );
              })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-4 py-2 text-micro text-[var(--color-faint)]">
        <button
          type="button"
          onClick={() => setLive((on) => !on)}
          className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-1.5 py-0.5 transition-colors hover:text-[var(--color-text)]"
          aria-pressed={live}
        >
          {/*
            The dot only pulses green when the quote is genuinely current.
            Gold, silver, copper, WTI and DXY all arrive exactly 600 seconds
            late under an exchange-mandated delay, and the European indices 900
            — showing those under the same live dot was the badge claiming
            something nobody had checked.
          */}
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              !live
                ? 'bg-[var(--color-faint)]'
                : freshness.kind === 'live'
                  ? 'animate-pulse bg-[var(--color-bull)]'
                  : 'bg-[var(--color-uncertain)]'
            }`}
          />
          {live ? freshness.label : 'Live off'}
        </button>

        {live && quote && (
          <span className="tnum text-[var(--color-text)]">
            {quote.price.toFixed(dp)}
            <span className="ml-1 text-[var(--color-faint)]">
              {/*
                Which transport, not a guess at how fast it is. A streamed
                symbol arrives about once a second; a polled one arrives when we
                ask. Claiming the faster of the two while on the slower one is
                the same class of error the Live badge already had.
              */}
              {quote.source === 'stream'
                ? ' · streaming'
                : ` · polled every ${pollIntervalFor([quote]) / 1000}s`}
              {quote.time !== null &&
                ` · quote stamped ${new Date(quote.time * 1000).toISOString().slice(11, 19)}Z`}
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={() => setShowSmas((on) => !on)}
          className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-1.5 py-0.5 transition-colors hover:text-[var(--color-text)]"
          aria-pressed={showSmas}
        >
          {SMA_OVERLAYS.map(({ period, color }) => (
            <span
              key={period}
              className="inline-block h-0.5 w-2.5 rounded-full"
              style={{ backgroundColor: showSmas ? color : 'var(--color-faint)' }}
            />
          ))}
          SMA {showSmas ? 'on' : 'off'}
        </button>

        {idea && (
          <span className="tnum">
            <span className={idea.direction === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}>
              {idea.direction}
            </span>{' '}
            <span className="text-[var(--color-muted)]">
              entry {idea.entryMin.toFixed(dp)}–{idea.entryMax.toFixed(dp)} · stop{' '}
              {idea.stop.toFixed(dp)} · target {idea.target.toFixed(dp)} ·{' '}
              {idea.rewardRisk.toFixed(1)}R
            </span>
          </span>
        )}

        <span>Scroll to zoom · drag to pan · double-click the axis to reset</span>
        <span>
          {bars.closes.length} {spec.prose} bars
          {candles.length > 0 && ` back to ${barStamp(candles[0].time, 86_400)}`}
        </span>
        {!hasVolume && <span>No volume — spot FX has no exchange to report it.</span>}
        {sampledNotBars && (
          <span className="text-[var(--color-uncertain)]">
            Drawn as a line: this source sends one sample per {spec.prose.replace('-', ' ')}{' '}
            interval, not an open, high, low and close.
          </span>
        )}
        <span>
          ATR {view.atr.toFixed(dp)} ({view.atrPct.toFixed(2)}%)
          {structureTimeframe !== timeframe &&
            ` · levels and ATR measured on the ${TIMEFRAME_SPEC[structureTimeframe].prose} series`}
        </span>
        <span>
          {/*
            The invariant, still true and still stated. The SMA lines added
            beside the candles are computed from the same closed bars — the
            forming candle contributes nothing to any of them until it closes.
          */}
          Levels and averages come from CLOSED bars and do not move with the live price.
        </span>
      </div>
    </div>
  );
}
