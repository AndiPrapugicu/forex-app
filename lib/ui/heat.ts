/**
 * A1's heat scale, as one function every table uses.
 *
 * A1 paints the CELL, not the number: solid blue for bullish, solid red for
 * bearish, grey for a measured zero. Continuous columns (a percentage, a net
 * position) fade the same hue by magnitude. Kept out of the components so the
 * thresholds are tested once instead of eyeballed in twelve places.
 *
 * Returns plain strings rather than React types, so a server module can use it
 * too. The colours are theme tokens in `app/globals.css`.
 */

export interface HeatStyle {
  backgroundColor?: string;
  color?: string;
}

export interface HeatOptions {
  /**
   * The magnitude that paints at full strength. Omit for a discrete score
   * (−2…+2), which always paints solid.
   */
  max?: number;
  /** Paint a measured zero grey. Default true; continuous columns usually want false. */
  zeroGrey?: boolean;
  /** Values within ±deadband of zero are treated as zero. Default 0. */
  deadband?: number;
}

/** Weakest fill a non-zero continuous value gets, so a small move is still visible. */
export const HEAT_MIN_ALPHA = 0.3;
/** At or above this alpha the text turns white for contrast. */
export const HEAT_WHITE_TEXT_AT = 0.55;

export function heatAlpha(value: number, max: number | undefined): number {
  if (max === undefined) return 1;
  if (!(max > 0)) return HEAT_MIN_ALPHA;
  const share = Math.min(1, Math.abs(value) / max);
  return Math.round((HEAT_MIN_ALPHA + (1 - HEAT_MIN_ALPHA) * share) * 100) / 100;
}

export function heatStyle(value: number | null | undefined, options: HeatOptions = {}): HeatStyle {
  const { max, zeroGrey = true, deadband = 0 } = options;
  if (value === null || value === undefined || !Number.isFinite(value)) return {};

  if (Math.abs(value) <= deadband) {
    return zeroGrey ? { backgroundColor: 'var(--color-heat-zero)', color: 'var(--color-text)' } : {};
  }

  const alpha = heatAlpha(value, max);
  const rgb = value > 0 ? 'var(--color-heat-bull-rgb)' : 'var(--color-heat-bear-rgb)';
  return {
    backgroundColor: `rgb(${rgb} / ${Math.round(alpha * 100)}%)`,
    color: alpha >= HEAT_WHITE_TEXT_AT ? '#fff' : 'var(--color-text)',
  };
}
