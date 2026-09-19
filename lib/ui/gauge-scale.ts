/**
 * Where a score sits on a BANDED dial.
 *
 * The scorecard gauge used to be linear over the model's true maximum, and its
 * face said "-34 … +34" — a range no symbol will ever reach. The bias bands are
 * absolute (±4 Bullish, ±7 Very Bullish) while the maximum is the sum of
 * eighteen columns, so a genuinely Very Bearish -9 pushed the needle a tenth of
 * the way off centre underneath a banner shouting "Very Bearish". The dial
 * disagreed with its own verdict.
 *
 * The fix is not to shrink the scale to where scores usually land — that would
 * be fitting the axis to a snapshot, and it would make a -9 look maxed out.
 * Instead each bias band owns an EQUAL slice of the sweep and the needle
 * interpolates inside its own band. The ends stay the true model maximum, the
 * printed number is still the raw score, and the needle can no longer contradict
 * the word beneath it.
 *
 * The maths lives here rather than in the SVG so the mapping is tested instead
 * of eyeballed.
 */

/**
 * Band edges in score units, ascending, from -max to +max.
 *
 * `minima` are the lower bounds of the bias bands as the config states them
 * (7, 4, -3, -6 …). A band boundary sits half a point below each cut, so the
 * integer cut itself lands cleanly inside its own band: +7 is the first score
 * that is Very Bullish, so the boundary is +6.5.
 *
 * Infinite minima (the open-ended outer band) are dropped, and any cut wider
 * than `max` is clamped, so a small-range dial still produces ascending edges.
 */
export function biasBandEdges(max: number, minima: readonly number[]): number[] {
  const inner = minima
    .filter((m) => Number.isFinite(m))
    .map((m) => Math.max(-max, Math.min(max, m - 0.5)))
    .sort((a, b) => a - b);
  return [-max, ...inner, max];
}

/**
 * Fraction 0..1 across the dial, with every band given the same angular width.
 *
 * Out-of-range scores clamp to the ends. A band with no width left (a cut
 * clamped onto the edge) contributes its slice without dividing by zero.
 */
export function bandedFraction(score: number, edges: readonly number[]): number {
  const bands = edges.length - 1;
  if (bands < 1) return 0.5;
  if (!Number.isFinite(score)) return 0.5;
  if (score <= edges[0]) return 0;
  if (score >= edges[bands]) return 1;

  for (let i = 0; i < bands; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    if (score < hi || i === bands - 1) {
      const span = hi - lo;
      const within = span > 0 ? (score - lo) / span : 0;
      return (i + within) / bands;
    }
  }
  return 1;
}

/**
 * Fill strength for band `index` of `bands`, 0..1.
 *
 * The middle band is the neutral one and the outer bands are the "Very" ones,
 * so strength rises with distance from the centre. This is what turns the track
 * into the red → grey → blue ramp A1 draws.
 */
export function bandStrength(index: number, bands: number): number {
  const centre = (bands - 1) / 2;
  const distance = Math.abs(index - centre);
  return centre > 0 ? distance / centre : 0;
}
