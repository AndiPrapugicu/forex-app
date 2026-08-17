/**
 * Radial gauges, hand-rolled in SVG.
 *
 * No chart library: these are a couple of arcs each, and pulling in a gauge
 * dependency for that would cost more bytes than the whole dashboard.
 *
 * The design rule throughout: SCORE and CONFIDENCE are separate visual channels
 * and must never be conflated. The needle says which way; the ring says how much
 * to trust it. A big score with a thin ring should look obviously different from
 * a big score with a full ring.
 */

import type { Direction } from '@/lib/types';
import { DIRECTION_STYLE, formatScore } from '@/components/ui';

// ---------------------------------------------------------------------------
// Score gauge — a semicircular dial over a caller-supplied ±range
// ---------------------------------------------------------------------------

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function ScoreGauge({
  score,
  direction,
  confidence,
  size = 180,
  label,
  range = 10,
  displaySuffix,
}: {
  /** Drives the needle, on whatever scale `range` declares. */
  score: number;
  direction: Direction;
  confidence: number;
  size?: number;
  label?: string;
  /**
   * Half-width of the scale, so the needle can position itself on the caller's
   * own units instead of everything being forced through ±10.
   *
   * That forcing is what made the app look like it capped at 10: the scorecard
   * total runs to ±25 and was being divided down to fit this dial, so a genuine
   * 14 arrived here as 5.6 and the printed number had to be patched back in
   * separately.
   */
  range?: number;
  displaySuffix?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const stroke = 12;

  // Map -range..+range onto a 180-degree sweep.
  const clamped = Math.max(-range, Math.min(range, score));
  const fraction = (clamped + range) / (2 * range);
  const needleAngle = fraction * 180;

  const style = DIRECTION_STYLE[direction];
  const arcColor =
    direction === 'uncertain'
      ? 'var(--color-uncertain)'
      : score > 0.5
        ? 'var(--color-bull)'
        : score < -0.5
          ? 'var(--color-bear)'
          : 'var(--color-neutral)';

  // Fill from centre (0) out to the score, so the arc length reads as magnitude.
  const centreAngle = 90;
  const fillStart = Math.min(centreAngle, needleAngle);
  const fillEnd = Math.max(centreAngle, needleAngle);

  const needle = polar(cx, cy, r - 2, needleAngle);
  const needleBase = polar(cx, cy, 6, needleAngle);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img"
        aria-label={`Score ${formatScore(score)} out of ${range}, ${style.label.toLowerCase()}, confidence ${confidence} percent`}>
        {/* Track */}
        <path
          d={arcPath(cx, cy, r, 0, 180)}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />

        {/* Filled portion. Opacity carries confidence as a secondary cue, so a
            low-confidence reading looks visibly washed out. */}
        {Math.abs(fillEnd - fillStart) > 0.5 && (
          <path
            d={arcPath(cx, cy, r, fillStart, fillEnd)}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            opacity={0.35 + (confidence / 100) * 0.65}
          />
        )}

        {/* Centre tick marks the zero point. */}
        <line
          x1={cx} y1={cy - r - stroke / 2 - 2}
          x2={cx} y2={cy - r + stroke / 2 + 2}
          stroke="var(--color-border-bright)" strokeWidth={2}
        />

        <line
          x1={needleBase.x} y1={needleBase.y}
          x2={needle.x} y2={needle.y}
          stroke={arcColor} strokeWidth={3} strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill={arcColor} />

        <text x={16} y={cy + 18} fill="var(--color-faint)" fontSize={10} className="tnum">-{range}</text>
        <text x={size - 26} y={cy + 18} fill="var(--color-faint)" fontSize={10} className="tnum">+{range}</text>
      </svg>

      <div className="-mt-1 text-center">
        {/* One number, the caller's own. No rescale to patch back around. */}
        <div className={`tnum text-3xl font-bold ${style.color}`}>
          {formatScore(score)}
          {displaySuffix && (
            <span className="ml-0.5 text-base font-normal text-[var(--color-faint)]">
              {displaySuffix}
            </span>
          )}
        </div>
        <div className={`text-xs font-medium ${style.color}`}>
          {style.glyph} {style.label}
        </div>
        {label && <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{label}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence ring
// ---------------------------------------------------------------------------

/**
 * Confidence is deliberately monochrome-to-amber and never green/red: it is a
 * different question from direction, and sharing the palette would make a
 * low-confidence bullish call look bearish.
 */
export function ConfidenceRing({
  confidence,
  size = 72,
  showLabel = true,
}: {
  confidence: number;
  size?: number;
  showLabel?: boolean;
}) {
  const r = size / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, confidence));
  const dash = (pct / 100) * circumference;

  // Below 40 the app refuses to state a direction, so the ring turns amber to
  // match the "uncertain" language everywhere else.
  const color =
    pct < 40 ? 'var(--color-uncertain)' : pct < 70 ? 'var(--color-muted)' : 'var(--color-text)';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`Confidence ${pct} percent`}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--color-surface-2)" strokeWidth={5}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x={size / 2} y={size / 2 + 4}
          textAnchor="middle" fill={color}
          fontSize={size / 4} fontWeight={600} className="tnum"
        >
          {pct}
        </text>
      </svg>
      {showLabel && (
        <span className="text-[10px] tracking-wide text-[var(--color-faint)] uppercase">
          Confidence
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal score bar
// ---------------------------------------------------------------------------

/**
 * Compact -10..+10 bar growing out from a centre line.
 * Used in dense lists where a radial gauge would not fit.
 */
export function ScoreBar({
  score,
  direction,
  confidence,
  width = 120,
  height = 8,
}: {
  score: number;
  direction: Direction;
  confidence?: number;
  width?: number;
  height?: number;
}) {
  const clamped = Math.max(-10, Math.min(10, score));
  const half = width / 2;
  const barWidth = (Math.abs(clamped) / 10) * half;

  const color =
    direction === 'uncertain'
      ? 'var(--color-uncertain)'
      : clamped > 0.5
        ? 'var(--color-bull)'
        : clamped < -0.5
          ? 'var(--color-bear)'
          : 'var(--color-neutral)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Score ${formatScore(score)}`}>
      <rect x={0} y={height / 2 - 1} width={width} height={2} fill="var(--color-surface-2)" rx={1} />
      <rect
        x={clamped >= 0 ? half : half - barWidth}
        y={0}
        width={Math.max(barWidth, clamped === 0 ? 0 : 2)}
        height={height}
        fill={color}
        opacity={confidence === undefined ? 1 : 0.4 + (confidence / 100) * 0.6}
        rx={2}
      />
      <rect x={half - 0.5} y={0} width={1} height={height} fill="var(--color-border-bright)" />
    </svg>
  );
}
