/**
 * Put-call arithmetic over stored option snapshots.
 *
 * A1 publishes the rule and nothing else: a 5-day moving average of the ratio,
 * with reference lines at 1.07 ("High Call Volume") and 1.20 ("High Put
 * Volume"). A ratio at or below the lower line means calls dominated; at or
 * above the upper line, puts did. Between them is ordinary flow.
 *
 * The average is only reported once five real sessions exist. Averaging two days
 * and labelling it a 5-day average is exactly the kind of number this app does
 * not publish.
 */

import { PUT_CALL_BANDS, PUT_CALL_MA_DAYS } from '@/config/options.config';
import type { ChainSummary } from '@/lib/connectors/yahoo-options';
import type { OptionsSnapshot } from '@/lib/types';

/** Capture only after the US close on a weekday, so a row is a finished session. */
export function shouldCaptureOptions(now: Date): boolean {
  const day = now.getUTCDay();
  return day >= 1 && day <= 5 && now.getUTCHours() >= 21;
}

export function sessionDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function toOptionsSnapshot(summary: ChainSummary, date: string): OptionsSnapshot {
  return {
    symbol: summary.symbol,
    date,
    callVolume: summary.callVolume,
    putVolume: summary.putVolume,
    callOpenInterest: summary.callOpenInterest,
    putOpenInterest: summary.putOpenInterest,
  };
}

export interface PutCallPoint {
  date: string;
  ratio: number | null;
  /** Null until `PUT_CALL_MA_DAYS` sessions with a ratio exist. */
  movingAverage: number | null;
  /** True for today's intraday read that has not been stored yet. */
  live: boolean;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * One symbol's ratio series, oldest first. A live summary for a date not yet
 * stored is appended, marked `live`.
 */
export function putCallSeries(
  snapshots: OptionsSnapshot[],
  symbol: string,
  live?: { date: string; summary: ChainSummary },
  maDays = PUT_CALL_MA_DAYS,
): PutCallPoint[] {
  const rows = snapshots
    .filter((s) => s.symbol === symbol)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, call: s.callVolume, put: s.putVolume, live: false }));

  if (live && !rows.some((r) => r.date === live.date)) {
    rows.push({ date: live.date, call: live.summary.callVolume, put: live.summary.putVolume, live: true });
  }

  const ratios: (number | null)[] = rows.map((r) => (r.call > 0 ? round3(r.put / r.call) : null));

  return rows.map((r, i) => {
    const window = ratios.slice(Math.max(0, i - maDays + 1), i + 1);
    const complete = window.length === maDays && window.every((v) => v !== null);
    return {
      date: r.date,
      ratio: ratios[i],
      movingAverage: complete ? round3((window as number[]).reduce((a, b) => a + b, 0) / maDays) : null,
      live: r.live,
    };
  });
}

export type PutCallReading = 'High call volume' | 'High put volume' | 'Normal';

export function readPutCall(value: number | null): PutCallReading | null {
  if (value === null) return null;
  if (value <= PUT_CALL_BANDS.highCallVolume) return 'High call volume';
  if (value >= PUT_CALL_BANDS.highPutVolume) return 'High put volume';
  return 'Normal';
}
