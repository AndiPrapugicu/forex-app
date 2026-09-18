/**
 * The arithmetic behind the charts, kept out of the SVG so it can be tested.
 *
 * WHY A FIXED DOMAIN IS AN OPTION AND NOT A DEFAULT. An auto-scaled axis is
 * right for a series with no natural range — a net position in contracts — and
 * wrong for one read against thresholds. The put-call chart is the case that
 * forced this: with two stored sessions the axis became 1.03 to 1.55, which
 * pinned the line to the top of the plot and squeezed the 1.07 and 1.20 bands
 * against the bottom, so a normal reading looked like an error. A1 draws that
 * metric on a fixed 0 to 1.6 axis, where the same two points sit where they
 * belong.
 */

export interface DomainOptions {
  /** Use this axis verbatim. Values outside it are clamped by the caller's scale. */
  domain?: readonly [number, number];
  /** Fraction of the range added at each end when auto-scaling. */
  pad?: number;
  /** Values that must be inside the axis even if the series never reaches them. */
  include?: readonly number[];
}

/**
 * The y-axis for a set of values: the fixed domain if one is given, else the
 * data's own extent padded a little.
 *
 * A single distinct value gets ±1 rather than a zero-height axis, which would
 * divide by zero in every caller.
 */
export function scaleDomain(
  values: readonly number[],
  { domain, pad = 0.08, include = [] }: DomainOptions = {},
): [number, number] {
  if (domain) return [domain[0], domain[1]];

  const all = [...values, ...include];
  if (all.length === 0) return [0, 1];

  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

/**
 * Tick values across `[lo, hi]`, rounded to a 1/2/5 step so the labels read as
 * numbers a person would choose (0, 0.4, 0.8 …) rather than as the data's own
 * endpoints. Always includes an end tick at or beyond each bound's step.
 */
export function axisTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || count < 2) return [lo, hi];

  const raw = (hi - lo) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(lo / step) * step;
  for (let v = first; v <= hi + step / 1000; v += step) {
    // Float steps accumulate error; round to the step's own precision.
    ticks.push(Math.round(v / step) * step);
  }
  return ticks.length > 0 ? ticks : [lo, hi];
}
