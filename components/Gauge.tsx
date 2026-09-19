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
import { bandStrength, bandedFraction } from '@/lib/ui/gauge-scale';
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
  bands,
  showDirection = true,
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
  /**
   * Bias band edges in score units, ascending, from -max to +max — from
   * `biasBandEdges`. Given them, the dial stops being linear: each band takes an
   * equal slice of the sweep, the track is painted band by band, and the face
   * labels the CUTS instead of the ends.
   *
   * The scorecard needs this because its bands are absolute (±4, ±7) while its
   * maximum is the sum of eighteen columns. Linear, the face read "-34 … +34",
   * a range nothing reaches, and a Very Bearish -9 sat almost dead centre under
   * a banner saying Very Bearish. The continuous news score on the event page
   * has no bands and stays linear.
   */
  bands?: readonly number[];
  /**
   * The word under the number. Off where the caller prints a more precise one
   * of its own: the scorecard banner says "Very Bearish", and this line only
   * knows "Bearish", so showing both made the panel argue with itself.
   */
  showDirection?: boolean;
  displaySuffix?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const stroke = 12;

  // Map the score onto a 180-degree sweep: through the bands where they exist,
  // linearly over ±range where they do not.
  const fraction = bands
    ? bandedFraction(score, bands)
    : (Math.max(-range, Math.min(range, score)) + range) / (2 * range);
  const needleAngle = fraction * 180;
  const scaleMax = bands ? bands[bands.length - 1] : range;

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

  /** Inner cuts: the band boundaries, for the ticks and the numbers. */
  const bandCount = bands ? bands.length - 1 : 0;
  const cuts = bands ? bands.slice(1, -1) : [];
  /**
   * The score a boundary stands for, which is the first one that earns the word
   * FURTHER FROM ZERO. The boundary itself is a half-point, so +3.5 is labelled
   * "+4" and -3.5 is labelled "-4" — reading them both as "+0.5" printed a face
   * of -6, -3, +4, +7, which is the same two cuts written two different ways.
   */
  const cutLabel = (edge: number) => formatScore(edge + (edge >= 0 ? 0.5 : -0.5));

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img"
        aria-label={
          bands
            ? `Score ${formatScore(score)}, ${style.label.toLowerCase()}, on a dial banded at ${cuts
                .map(cutLabel)
                .join(', ')} with a maximum of ${formatScore(scaleMax)}, confidence ${confidence} percent`
            : `Score ${formatScore(score)} out of ${range}, ${style.label.toLowerCase()}, confidence ${confidence} percent`
        }>
        {bands ? (
          /* One arc per band, red through grey to blue. The track itself carries
             the verdict, so the needle only has to say where inside it. */
          bands.slice(0, -1).map((_, i) => {
            const strength = bandStrength(i, bandCount);
            const middle = (bandCount - 1) / 2;
            const colour =
              i === middle
                ? 'var(--color-heat-zero)'
                : `rgb(var(--color-heat-${i < middle ? 'bear' : 'bull'}-rgb) / ${Math.round((0.45 + 0.55 * strength) * 100)}%)`;
            return (
              <path
                key={i}
                d={arcPath(cx, cy, r, (i / bandCount) * 180, ((i + 1) / bandCount) * 180)}
                fill="none"
                stroke={colour}
                strokeWidth={stroke}
              />
            );
          })
        ) : (
          <>
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
          </>
        )}

        {/* Centre tick marks the zero point. */}
        <line
          x1={cx} y1={cy - r - stroke / 2 - 2}
          x2={cx} y2={cy - r + stroke / 2 + 2}
          stroke="var(--color-border-bright)" strokeWidth={2}
        />

        {/* Band cuts, ticked on the arc and numbered inside it. The number is
            the CUT — the first score that earns the next word — not the
            half-point boundary the geometry runs on. */}
        {cuts.map((cut, i) => {
          const angle = ((i + 1) / bandCount) * 180;
          const outer = polar(cx, cy, r + stroke / 2 + 2, angle);
          const inner = polar(cx, cy, r - stroke / 2 - 2, angle);
          const text = polar(cx, cy, r - stroke - 9, angle);
          return (
            <g key={cut}>
              <line
                x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke="var(--color-border-bright)" strokeWidth={1}
              />
              <text x={text.x} y={text.y + 3} textAnchor="middle" fill="var(--color-faint)" fontSize={9} className="tnum">
                {cutLabel(cut)}
              </text>
            </g>
          );
        })}

        <line
          x1={needleBase.x} y1={needleBase.y}
          x2={needle.x} y2={needle.y}
          stroke={bands ? 'var(--color-text)' : arcColor} strokeWidth={3} strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill={bands ? 'var(--color-text)' : arcColor} />

        {/* A banded dial has no honest end label: the ends ARE the model
            maximum, which nothing reaches, and printing it is what made this
            gauge look broken. The cuts above are the scale that means
            something; the maximum stays in the aria description. */}
        {!bands && (
          <>
            <text x={16} y={cy + 18} fill="var(--color-faint)" fontSize={10} className="tnum">-{range}</text>
            <text x={size - 26} y={cy + 18} fill="var(--color-faint)" fontSize={10} className="tnum">+{range}</text>
          </>
        )}
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
        {showDirection && (
          <div className={`text-xs font-medium ${style.color}`}>
            {style.glyph} {style.label}
          </div>
        )}
        {label && <div className="mt-0.5 text-micro text-[var(--color-faint)]">{label}</div>}
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
        <span className="text-micro tracking-wide text-[var(--color-faint)] uppercase">
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

// ---------------------------------------------------------------------------
// Percent gauge — a 0..100 dial for the Economic Surprise Meter
// ---------------------------------------------------------------------------

/**
 * A SIGNED score and a PERCENTAGE are different quantities, so this is a
 * separate component rather than `ScoreGauge` with a wider range.
 *
 * ScoreGauge prints `formatScore` — "+11" — and labels its axis ±range. Both
 * are right for a scorecard total and wrong for "61% of this economy's releases
 * beat expectations", where there is no sign, no zero point in the middle, and
 * the ends are 0 and 100. Forcing one component to do both would mean a prop
 * that switches its meaning, which is how a chart starts lying.
 *
 * The arc helpers are shared, so there is still only one piece of trigonometry
 * in the app.
 *
 * Colour follows the reading rather than a fixed track: the left half of the
 * dial is the bearish side and the right half the bullish one, matching how the
 * heatmap colours the same numbers.
 */
export function PercentGauge({
  pct,
  label,
  size = 150,
  sublabel,
}: {
  /** 0..100, or null when nothing directional resolved. */
  pct: number | null;
  /** Sits inside the arc — the currency, usually. */
  label: string;
  size?: number;
  sublabel?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const stroke = 11;

  const known = pct !== null;
  const angle = known ? (pct / 100) * 180 : 90;
  const needle = polar(cx, cy, r - 2, angle);
  const needleBase = polar(cx, cy, 5, angle);

  const colour = !known
    ? 'var(--color-neutral)'
    : pct > 50
      ? 'var(--color-bull)'
      : pct < 50
        ? 'var(--color-bear)'
        : 'var(--color-neutral)';

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size / 2 + 30}
        viewBox={`0 0 ${size} ${size / 2 + 30}`}
        role="img"
        aria-label={
          known
            ? `${label}: ${pct}% of releases beat expectations`
            : `${label}: no directional releases to measure`
        }
      >
        {/* Bearish half, then bullish half. The track itself carries the
            meaning, so a needle just left of centre reads as weak at a glance. */}
        <path d={arcPath(cx, cy, r, 0, 90)} fill="none" stroke="var(--color-bear)" strokeWidth={stroke} opacity={0.32} />
        <path d={arcPath(cx, cy, r, 90, 180)} fill="none" stroke="var(--color-bull)" strokeWidth={stroke} opacity={0.32} />

        {/* Midpoint tick: half the releases beat, half missed. */}
        <line
          x1={cx} y1={cy - r - stroke / 2 - 2}
          x2={cx} y2={cy - r + stroke / 2 + 2}
          stroke="var(--color-border-bright)" strokeWidth={2}
        />

        {known && (
          <>
            <line
              x1={needleBase.x} y1={needleBase.y}
              x2={needle.x} y2={needle.y}
              stroke={colour} strokeWidth={3} strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={5} fill={colour} />
          </>
        )}

        <text
          x={cx} y={cy - 14}
          textAnchor="middle"
          fill="var(--color-muted)"
          fontSize={13}
          fontWeight={600}
        >
          {label}
        </text>

        <text x={12} y={cy + 16} fill="var(--color-faint)" fontSize={9} className="tnum">0</text>
        <text x={size - 20} y={cy + 16} fill="var(--color-faint)" fontSize={9} className="tnum">100</text>
      </svg>

      <div className="-mt-2 text-center">
        <div className="tnum text-xl font-bold" style={{ color: colour }}>
          {known ? `${Math.round(pct)}%` : '—'}
        </div>
        {sublabel && <div className="text-micro text-[var(--color-faint)]">{sublabel}</div>}
      </div>
    </div>
  );
}
