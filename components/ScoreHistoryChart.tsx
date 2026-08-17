'use client';

/**
 * Score over time, against price.
 *
 * Two series on one x-axis with genuinely different units, so they get their own
 * y-axes: score on the left over a fixed ±range, price on the right auto-scaled
 * to its own window. Sharing one axis would make either the score invisible or
 * the price a flat line.
 *
 * Hand-rolled SVG, matching IndicatorChart — the page already renders charts
 * this way and a second approach here would be the inconsistency. (The Chart
 * page's candlesticks DO use a library — they need zoom, pan and a snapping
 * crosshair, which is interaction code rather than drawing code.)
 *
 * The bias bands are drawn as background shading rather than gridlines because
 * they are the thing being read: the question is "when did this cross into
 * Bullish", not "what exact number was it on Tuesday".
 */

import { useMemo, useState } from 'react';
import { BIAS_THRESHOLDS } from '@/config/setups.config';
import type { ScoreSnapshot } from '@/lib/types';

const W = 900;
const H = 280;
const PAD = { top: 16, right: 52, bottom: 32, left: 40 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Bullish/bearish thresholds, for the shaded bands. */
const BULLISH = BIAS_THRESHOLDS.find((t) => t.bias === 'Bullish')!.min;
const VERY_BULLISH = BIAS_THRESHOLDS.find((t) => t.bias === 'Very Bullish')!.min;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ScoreHistoryChart({
  history,
  range,
}: {
  history: ScoreSnapshot[];
  /** Half-width of the score axis, so it matches the gauge on the scorecard. */
  range: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const prices = history.map((h) => h.price).filter((p): p is number => p !== null);
    const priceLo = prices.length ? Math.min(...prices) : 0;
    const priceHi = prices.length ? Math.max(...prices) : 1;
    // A totally flat price would divide by zero; give it a nominal band.
    const priceSpan = priceHi - priceLo || Math.abs(priceHi) * 0.01 || 1;

    const x = (i: number) =>
      history.length === 1
        ? PAD.left + PLOT_W / 2
        : PAD.left + (i / (history.length - 1)) * PLOT_W;

    const yScore = (v: number) => PAD.top + ((range - v) / (2 * range)) * PLOT_H;
    const yPrice = (v: number) => PAD.top + ((priceHi - v) / priceSpan) * PLOT_H;

    const scoreLine = history.map((h, i) => `${x(i)},${yScore(h.totalScore)}`).join(' ');
    const priceLine = history
      .map((h, i) => (h.price === null ? null : `${x(i)},${yPrice(h.price)}`))
      .filter(Boolean)
      .join(' ');

    return { x, yScore, yPrice, scoreLine, priceLine, priceLo, priceHi };
  }, [history, range]);

  if (history.length === 0) return null;

  const { x, yScore, scoreLine, priceLine, priceLo, priceHi } = geometry;
  const active = hover === null ? history[history.length - 1] : history[hover];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[640px]"
        role="img"
        aria-label={`Score history over ${history.length} snapshots`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Bias bands. Bullish shaded blue-ish, bearish red-ish, neutral bare. */}
        <rect
          x={PAD.left} y={yScore(range)} width={PLOT_W} height={yScore(VERY_BULLISH) - yScore(range)}
          fill="var(--color-bull)" opacity={0.14}
        />
        <rect
          x={PAD.left} y={yScore(VERY_BULLISH)} width={PLOT_W} height={yScore(BULLISH) - yScore(VERY_BULLISH)}
          fill="var(--color-bull)" opacity={0.07}
        />
        <rect
          x={PAD.left} y={yScore(-BULLISH + 1)} width={PLOT_W} height={yScore(-VERY_BULLISH) - yScore(-BULLISH + 1)}
          fill="var(--color-bear)" opacity={0.07}
        />
        <rect
          x={PAD.left} y={yScore(-VERY_BULLISH)} width={PLOT_W} height={yScore(-range) - yScore(-VERY_BULLISH)}
          fill="var(--color-bear)" opacity={0.14}
        />

        {/* Zero line */}
        <line
          x1={PAD.left} x2={W - PAD.right} y1={yScore(0)} y2={yScore(0)}
          stroke="var(--color-border-bright)" strokeWidth={1}
        />

        {/* Score axis labels */}
        {[range, VERY_BULLISH, 0, -VERY_BULLISH, -range].map((v) => (
          <text
            key={v} x={PAD.left - 6} y={yScore(v) + 3}
            textAnchor="end" fontSize={9} fill="var(--color-faint)" className="tnum"
          >
            {v > 0 ? `+${v}` : v}
          </text>
        ))}

        {/* Price, dashed and secondary — context for the score, not the subject. */}
        {priceLine && (
          <polyline
            points={priceLine} fill="none"
            stroke="var(--color-muted)" strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8}
          />
        )}

        {/* Score */}
        <polyline
          points={scoreLine} fill="none"
          stroke="var(--color-bull)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />

        {/* Price axis, right */}
        <text x={W - PAD.right + 6} y={PAD.top + 4} fontSize={9} fill="var(--color-faint)" className="tnum">
          {priceHi.toLocaleString()}
        </text>
        <text x={W - PAD.right + 6} y={PAD.top + PLOT_H} fontSize={9} fill="var(--color-faint)" className="tnum">
          {priceLo.toLocaleString()}
        </text>

        {/* Hover targets. One invisible full-height band per point, so the whole
            column is grabbable rather than just the 2px line. */}
        {history.map((h, i) => (
          <rect
            key={h.capturedAtUtc}
            x={x(i) - PLOT_W / Math.max(history.length - 1, 1) / 2}
            y={PAD.top}
            width={PLOT_W / Math.max(history.length - 1, 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {hover !== null && (
          <line
            x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + PLOT_H}
            stroke="var(--color-border-bright)" strokeWidth={1}
          />
        )}
        <circle cx={x(hover ?? history.length - 1)} cy={yScore(active.totalScore)} r={3.5} fill="var(--color-bull)" />

        {/* First and last date only. A dense axis on a many-point series is noise. */}
        <text x={PAD.left} y={H - 12} fontSize={9} fill="var(--color-faint)">
          {formatDay(history[0].capturedAtUtc)}
        </text>
        <text x={W - PAD.right} y={H - 12} textAnchor="end" fontSize={9} fill="var(--color-faint)">
          {formatDay(history[history.length - 1].capturedAtUtc)}
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-[var(--color-faint)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--color-bull)]" /> score
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-[var(--color-muted)]" /> price
        </span>
        <span className="ml-auto tnum">
          {formatDay(active.capturedAtUtc)} · score {active.totalScore > 0 ? '+' : ''}
          {active.totalScore} · {active.bias}
          {active.price !== null && ` · ${active.price.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}
