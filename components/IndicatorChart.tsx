'use client';

/**
 * Indicator history: actual as bars, forecast as an overlaid line.
 *
 * Hand-rolled SVG rather than Recharts. The chart is a bar series plus a
 * polyline plus two axes — pulling in a charting library for that would cost
 * more bundle than the whole page, and this way the bars can share an exact
 * baseline with the forecast markers.
 *
 * The baseline is zero when the series crosses zero, and the data minimum
 * otherwise. Anchoring an inflation series at zero would waste most of the
 * height on empty space and flatten the variation that matters.
 */

import { useMemo, useState } from 'react';
import type { IndicatorSeries } from '@/lib/scoring/indicator-history';
import { Panel } from '@/components/ui';

const W = 900;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function IndicatorChart({ series }: { series: IndicatorSeries }) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const points = series.points;
    const actuals = points.map((p) => p.actual);
    const consensuses = points.map((p) => p.consensus).filter((c): c is number => c !== null);
    const all = [...actuals, ...consensuses];

    const dataMin = Math.min(...all);
    const dataMax = Math.max(...all);

    const crossesZero = dataMin < 0 && dataMax > 0;

    const lo = crossesZero ? Math.min(dataMin, 0) : dataMin;
    const hi = crossesZero ? Math.max(dataMax, 0) : dataMax;
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;

    const yMin = lo - pad;
    const yMax = hi + pad;

    /**
     * Where bars are drawn from.
     *
     * Zero when the series spans it — a positive and a negative print must sit
     * on opposite sides of a shared line.
     *
     * Otherwise the BOTTOM OF THE AXIS, not the data minimum. Anchoring at the
     * minimum gives the smallest bar in the series exactly zero height, which
     * reads as missing data rather than a low reading. Observed on ISM Services
     * PMI, where a 53.5 print against a 53.5-55 range vanished entirely.
     */
    const baseline = crossesZero ? 0 : yMin;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const x = (i: number) => PAD.left + (plotW / points.length) * (i + 0.5);
    const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const barW = Math.max((plotW / points.length) * 0.62, 2);

    return { x, y, barW, yMin, yMax, baseline, ticks: niceTicks(yMin, yMax) };
  }, [series]);

  const { x, y, barW, baseline, ticks } = geometry;
  const points = series.points;
  const unit = series.unit ?? '';

  const forecastPath = points
    .map((p, i) => (p.consensus === null ? null : `${x(i)},${y(p.consensus)}`))
    .filter(Boolean)
    .join(' ');

  const active = hover !== null ? points[hover] : null;

  return (
    <Panel
      title={`${series.currency} ${series.label}`}
      subtitle={series.eventName}
      action={
        series.beatRatePct !== null && (
          <span className="text-micro text-[var(--color-faint)]">
            beat forecast {series.beatRatePct}% of {points.filter((p) => p.consensus !== null).length}
          </span>
        )
      }
    >
      <div className="overflow-x-auto px-2 pt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label={`${series.currency} ${series.label} history`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Gridlines and y axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-border)"
                strokeWidth={t === baseline ? 1.5 : 0.5}
              />
              <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--color-faint)">
                {t}
                {unit}
              </text>
            </g>
          ))}

          {/* Actual bars */}
          {points.map((p, i) => {
            const top = Math.min(y(p.actual), y(baseline));
            const height = Math.max(Math.abs(y(p.actual) - y(baseline)), 1);
            const beat = p.consensus !== null && p.actual > p.consensus;
            const miss = p.consensus !== null && p.actual < p.consensus;

            return (
              <rect
                key={p.dateUtc}
                x={x(i) - barW / 2}
                y={top}
                width={barW}
                height={height}
                rx={1.5}
                // Colour by beat/miss, not by sign: the point of the chart is
                // the comparison with forecast, not whether the number is
                // positive.
                fill={beat ? 'rgb(var(--color-bull-cell-rgb) / 85%)' : miss ? 'rgba(242,80,110,0.8)' : 'rgba(107,119,148,0.7)'}
                opacity={hover === null || hover === i ? 1 : 0.45}
                onMouseEnter={() => setHover(i)}
              />
            );
          })}

          {/* Forecast overlay */}
          {forecastPath && (
            <polyline
              points={forecastPath}
              fill="none"
              stroke="var(--color-uncertain)"
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          )}
          {points.map((p, i) =>
            p.consensus === null ? null : (
              <circle key={`c${p.dateUtc}`} cx={x(i)} cy={y(p.consensus)} r={2} fill="var(--color-uncertain)" />
            ),
          )}

          {/* X labels, thinned so they never collide */}
          {points.map((p, i) => {
            const every = Math.ceil(points.length / 12);
            if (i % every !== 0) return null;
            return (
              <text
                key={`x${p.dateUtc}`}
                x={x(i)}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                fontSize={8}
                fill="var(--color-faint)"
              >
                {p.dateUtc.slice(2, 7)}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-4 py-2 text-micro">
        <span className="flex items-center gap-1 text-[var(--color-faint)]">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: 'rgb(var(--color-bull-cell-rgb) / 85%)' }} />
          beat forecast
        </span>
        <span className="flex items-center gap-1 text-[var(--color-faint)]">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: 'rgba(242,80,110,0.8)' }} />
          missed
        </span>
        <span className="flex items-center gap-1 text-[var(--color-faint)]">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: 'var(--color-uncertain)' }} />
          forecast
        </span>

        {active && (
          <span className="tnum ml-auto text-[var(--color-text)]">
            {active.dateUtc.slice(0, 10)} · actual{' '}
            <span className="font-semibold">
              {active.actual}
              {unit}
            </span>
            {active.consensus !== null && (
              <>
                {' '}vs {active.consensus}
                {unit} forecast
                <span
                  className={
                    (active.surprise ?? 0) > 0
                      ? ' text-[var(--color-bull)]'
                      : ' text-[var(--color-bear)]'
                  }
                >
                  {' '}
                  ({(active.surprise ?? 0) > 0 ? '+' : ''}
                  {Math.round((active.surprise ?? 0) * 100) / 100})
                </span>
              </>
            )}
          </span>
        )}
      </div>
    </Panel>
  );
}
