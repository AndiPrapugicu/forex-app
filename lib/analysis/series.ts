/**
 * Dated daily series, read AS OF a moment.
 *
 * The narrative engine runs twice — now and a week ago — off the same inputs,
 * so every reading here takes the moment it is for and never looks past it.
 * Changes are over CALENDAR days (a week is 7), not sessions, so a holiday
 * cannot stretch "a week" into eight sessions on one series and not another.
 */

import type { DailyBars } from '@/lib/connectors/technicals';
import type { DatedObservation } from '@/lib/connectors/yields';

const DAY_MS = 86_400_000;

/** Daily closes, oldest first, keyed by UTC date. */
export function barsToSeries(bars: DailyBars | null): DatedObservation[] {
  if (!bars) return [];
  const out: DatedObservation[] = [];
  for (let i = 0; i < bars.timestamps.length; i++) {
    const c = bars.closes[i];
    if (typeof c !== 'number' || !Number.isFinite(c)) continue;
    const date = new Date(bars.timestamps[i] * 1000).toISOString().slice(0, 10);
    // A re-dated or duplicated session keeps its last close.
    if (out.length > 0 && out[out.length - 1].date === date) out[out.length - 1] = { date, value: c };
    else out.push({ date, value: c });
  }
  return out;
}

/** The last observation on or before `at`. */
export function obsAt(series: readonly DatedObservation[] | undefined, at: Date): DatedObservation | null {
  if (!series || series.length === 0) return null;
  const day = at.toISOString().slice(0, 10);
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= day) return series[i];
  return null;
}

export function valueAt(series: readonly DatedObservation[] | undefined, at: Date): number | null {
  return obsAt(series, at)?.value ?? null;
}

function pair(series: readonly DatedObservation[] | undefined, at: Date, days: number) {
  const now = obsAt(series, at);
  const then = obsAt(series, new Date(at.getTime() - days * DAY_MS));
  // The two must be different observations, or a stale series reads "unchanged".
  if (!now || !then || now.date === then.date) return null;
  return { now, then };
}

/** Change in basis points of a series quoted in percent. */
export function changeBp(series: readonly DatedObservation[] | undefined, at: Date, days: number): number | null {
  const p = pair(series, at, days);
  return p ? (p.now.value - p.then.value) * 100 : null;
}

/** Percent change of a price series. */
export function changePct(series: readonly DatedObservation[] | undefined, at: Date, days: number): number | null {
  const p = pair(series, at, days);
  return p && p.then.value !== 0 ? ((p.now.value - p.then.value) / p.then.value) * 100 : null;
}

/** −2..+2 from a signed magnitude and two bands. */
export function band(value: number | null, moderate: number, strong: number): -2 | -1 | 0 | 1 | 2 {
  if (value === null || !Number.isFinite(value)) return 0;
  const a = Math.abs(value);
  const m = a >= strong ? 2 : a >= moderate ? 1 : 0;
  return (value < 0 ? -m : m) as -2 | -1 | 0 | 1 | 2;
}

export function clampEffect(v: number): -2 | -1 | 0 | 1 | 2 {
  const r = Math.round(v);
  return Math.max(-2, Math.min(2, r === 0 ? 0 : r)) as -2 | -1 | 0 | 1 | 2;
}
