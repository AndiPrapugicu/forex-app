/**
 * The chart set: inline SVG, no library, no hooks — usable from a server page.
 *
 * Every chart draws into a fixed viewBox and scales to its container width, so
 * one component serves a phone and a monitor. Colours come from the theme
 * tokens (SVG, unlike the Lightweight Charts canvas, resolves CSS variables).
 *
 * Direction is never colour alone: bars sit above or below a drawn baseline, and
 * every chart takes an accessible `label`.
 */

import type { ReactNode } from 'react';

const BULL = 'var(--color-bull-cell)';
const BEAR = 'var(--color-bear-cell)';
const MUTED = 'var(--color-faint)';

function extent(values: number[], pad = 0.08): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

// ---------------------------------------------------------------------------
// Sparkline — a trend at table-cell size.
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  label,
  width = 96,
  height = 28,
  tone = 'auto',
  baseline,
}: {
  values: (number | null)[];
  label: string;
  width?: number;
  height?: number;
  /** `auto` colours by last minus first. */
  tone?: 'auto' | 'bull' | 'bear' | 'muted';
  /** Draw a dashed reference line, e.g. 0 or 50. */
  baseline?: number;
}) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (pts.length < 2) {
    return <span className="text-caption text-[var(--color-faint)]">—</span>;
  }
  const [lo, hi] = extent([...pts.map((p) => p.v), ...(baseline !== undefined ? [baseline] : [])]);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - lo) / (hi - lo)) * (height - 2);
  const delta = pts[pts.length - 1].v - pts[0].v;
  const stroke =
    tone === 'bull' ? BULL : tone === 'bear' ? BEAR : tone === 'muted' || delta === 0 ? MUTED : delta > 0 ? BULL : BEAR;
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="inline-block align-middle">
      {baseline !== undefined && (
        <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-border-bright)" strokeDasharray="2 2" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1].i)} cy={y(pts[pts.length - 1].v)} r={2} fill={stroke} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MetricBars — actual bars with forecast dots, A1's economic-data chart.
// ---------------------------------------------------------------------------

export interface MetricPoint {
  label: string;
  actual: number | null;
  forecast?: number | null;
}

export function MetricBars({
  points,
  label,
  baseline = 0,
  unit = '',
  height = 220,
}: {
  points: MetricPoint[];
  label: string;
  /** Bars grow from here: 0 for growth rates, 50 for a PMI. */
  baseline?: number;
  unit?: string;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const padL = 36;
  const padB = 22;
  const padT = 8;
  const values = points.flatMap((p) => [p.actual, p.forecast ?? null]).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return <p className="py-8 text-center text-small text-[var(--color-muted)]">No readings in this window.</p>;
  }
  const [lo, hi] = extent([...values, baseline], 0.1);
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const step = plotW / points.length;
  const barW = Math.max(2, Math.min(28, step * 0.62));
  const labelEvery = Math.ceil(points.length / 8);
  const ticks = [lo, baseline, hi].filter((v, i, a) => a.findIndex((w) => Math.abs(w - v) < (hi - lo) * 0.08) === i);
  const fmt = (v: number) => `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}${unit}`;

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === baseline ? 'var(--color-border-bright)' : 'var(--color-border)'} />
          <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--color-faint)">
            {fmt(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = padL + step * i + step / 2;
        const surprise = p.actual !== null && p.forecast != null ? p.actual - p.forecast : null;
        const fill = p.actual === null ? MUTED : surprise === null || surprise === 0 ? 'var(--color-muted)' : surprise > 0 ? BULL : BEAR;
        return (
          <g key={`${p.label}-${i}`}>
            <title>
              {`${p.label}: actual ${p.actual === null ? '—' : fmt(p.actual)}` +
                (p.forecast != null ? `, forecast ${fmt(p.forecast)}` : '')}
            </title>
            {p.actual !== null && (
              <rect
                x={cx - barW / 2}
                y={Math.min(y(p.actual), y(baseline))}
                width={barW}
                height={Math.max(1, Math.abs(y(p.actual) - y(baseline)))}
                rx={1.5}
                fill={fill}
              />
            )}
            {p.forecast != null && (
              <circle cx={cx} cy={y(p.forecast)} r={3} fill="var(--color-head)" stroke="var(--color-bg)" strokeWidth={1} />
            )}
            {i % labelEvery === 0 && (
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StackedBar — long vs short as one 100% bar.
// ---------------------------------------------------------------------------

export function StackedBar({
  longPct,
  label,
  showValues = true,
}: {
  /** 0–100; the short side is the remainder. */
  longPct: number | null;
  label: string;
  showValues?: boolean;
}) {
  if (longPct === null || !Number.isFinite(longPct)) {
    return <span className="text-caption text-[var(--color-faint)]">—</span>;
  }
  const l = Math.max(0, Math.min(100, longPct));
  return (
    <div className="flex w-full min-w-24 items-center gap-2">
      {showValues && <span className="tnum w-9 text-right text-caption text-[var(--color-bull-cell)]">{l.toFixed(0)}%</span>}
      <div role="img" aria-label={label} className="flex h-2.5 flex-1 overflow-hidden rounded-[var(--radius-pill)]">
        <span style={{ width: `${l}%`, background: BULL }} />
        <span style={{ width: `${100 - l}%`, background: BEAR }} />
      </div>
      {showValues && <span className="tnum w-9 text-caption text-[var(--color-bear)]">{(100 - l).toFixed(0)}%</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DivergingRow — a labelled centre-anchored bar with its value.
// ---------------------------------------------------------------------------

export function DivergingRow({
  label,
  value,
  max,
  format = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
  aside,
}: {
  label: ReactNode;
  value: number | null;
  max: number;
  format?: (v: number) => string;
  aside?: ReactNode;
}) {
  const v = value ?? 0;
  const pct = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  return (
    <div className="grid min-h-9 grid-cols-[5.5rem_1fr_4rem] items-center gap-3 md:grid-cols-[7rem_1fr_4.5rem]">
      <span className="truncate text-small font-medium">{label}</span>
      <div className="relative h-3 rounded-[var(--radius-pill)] bg-[var(--color-surface-2)]">
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
        {value !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 rounded-[var(--radius-pill)]"
            style={{ left: v >= 0 ? '50%' : `${50 - pct}%`, width: `${pct}%`, background: v >= 0 ? BULL : BEAR }}
          />
        )}
      </div>
      <span
        className={`tnum text-right text-small font-semibold ${
          value === null ? 'text-[var(--color-faint)]' : v > 0 ? 'text-[var(--color-bull-cell)]' : v < 0 ? 'text-[var(--color-bear)]' : 'text-[var(--color-muted)]'
        }`}
      >
        {value === null ? '—' : format(v)}
        {aside}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BandedLine — a series against labelled horizontal thresholds.
// ---------------------------------------------------------------------------

export function BandedLine({
  points,
  bands = [],
  label,
  height = 200,
  format = (v) => v.toFixed(2),
}: {
  points: { label: string; value: number | null }[];
  /** A threshold line with a caption, e.g. 1.20 "High put volume". */
  bands?: { value: number; label: string; tone: 'bull' | 'bear' | 'muted' }[];
  label: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const W = 640;
  const H = height;
  const padL = 40;
  const padB = 22;
  const padT = 8;
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) {
    return <p className="py-8 text-center text-small text-[var(--color-muted)]">Not enough history to draw yet.</p>;
  }
  const [lo, hi] = extent([...vals, ...bands.map((b) => b.value)], 0.1);
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  const labelEvery = Math.ceil(points.length / 7);
  const toneColor = { bull: BULL, bear: BEAR, muted: MUTED } as const;

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
      {bands.map((b) => (
        <g key={b.label}>
          <line x1={padL} x2={W} y1={y(b.value)} y2={y(b.value)} stroke={toneColor[b.tone]} strokeDasharray="4 3" />
          <text x={W - 4} y={y(b.value) - 4} textAnchor="end" fontSize={10} fill={toneColor[b.tone]}>
            {`${b.label} ${format(b.value)}`}
          </text>
        </g>
      ))}
      {[lo, hi].map((t) => (
        <text key={t} x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--color-faint)">
          {format(t)}
        </text>
      ))}
      <path d={d} fill="none" stroke="var(--color-text)" strokeWidth={1.6} strokeLinejoin="round" />
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={`${p.label}-${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-faint)">
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
