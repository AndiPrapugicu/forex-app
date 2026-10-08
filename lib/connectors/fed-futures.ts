/**
 * The market-implied Fed path, from 30-day fed funds futures on Yahoo.
 *
 * Each CBOT contract settles on the average effective fed funds rate of its
 * month, so 100 minus its price is the rate the market expects for that month.
 * Read against the effective rate today, the chain says how many basis points
 * of hikes (or cuts) are priced, and read a week apart it says how much that
 * pricing moved — "hike bets fell this week" as a number instead of a phrase.
 *
 * Verified on Yahoo 2026-10-03, every contract with a month of daily bars:
 *   ZQ=F 96.12   ZQV26.CBT 96.12   ZQX26.CBT 96.07   ZQZ26.CBT 95.925
 *   ZQF27.CBT 95.855   ZQG27.CBT 95.77   ZQH27.CBT 95.685   ZQJ27.CBT 95.58
 *
 * Only the Fed has this. No free feed carries €STR, SONIA, TONA or the other
 * banks' short-rate futures, so their path is read off 2-year yields instead,
 * and the dossier says which source each currency got.
 */

import { fetchFredSeries, type DatedObservation } from '@/lib/connectors/yields';
import { fetchDailyBars } from '@/lib/connectors/technicals';
import { barsToSeries, obsAt } from '@/lib/analysis/series';

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const;
const DAY_MS = 86_400_000;

export interface FedContract {
  ticker: string;
  /** `YYYY-MM`, the month the contract averages. */
  month: string;
}

export interface FedContractSeries extends FedContract {
  closes: DatedObservation[];
}

export interface FedPathPoint extends FedContract {
  /** Implied rate in percent, as of the reading. */
  implied: number | null;
  impliedWeekAgo: number | null;
  impliedMonthAgo: number | null;
  /** Date of the close behind `implied`. */
  date: string | null;
}

export interface FedPath {
  /** What "priced" is measured from. */
  reference: { value: number; date: string; label: string } | null;
  points: FedPathPoint[];
}

/** Contracts for this month and the next `n − 1`, e.g. 2026-10-03 → V26, X26, Z26, F27… */
export function contractChain(now: Date, n: number): FedContract[] {
  const out: FedContract[] = [];
  const y0 = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  for (let k = 0; k < n; k++) {
    const m = (m0 + k) % 12;
    const y = y0 + Math.floor((m0 + k) / 12);
    out.push({
      ticker: `ZQ${MONTH_CODES[m]}${String(y).slice(2)}.CBT`,
      month: `${y}-${String(m + 1).padStart(2, '0')}`,
    });
  }
  return out;
}

const implied = (o: DatedObservation | null) => (o ? Math.round((100 - o.value) * 10_000) / 10_000 : null);

/**
 * The path as of `at`. Pure, so the engine can rebuild last week's path from
 * the same bars. The reference is the effective rate on or before `at`; when
 * FRED does not answer, the current month's contract stands in, and the label
 * says so.
 */
export function buildFedPath(effr: DatedObservation[], contracts: FedContractSeries[], at: Date): FedPath {
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(at.getTime() - 30 * DAY_MS);
  const atMonth = at.toISOString().slice(0, 7);

  const points: FedPathPoint[] = contracts
    // A contract whose month is over has settled; it is not a forecast.
    .filter((c) => c.month >= atMonth)
    .map((c) => {
      const now = obsAt(c.closes, at);
      return {
        ticker: c.ticker,
        month: c.month,
        implied: implied(now),
        impliedWeekAgo: implied(obsAt(c.closes, weekAgo)),
        impliedMonthAgo: implied(obsAt(c.closes, monthAgo)),
        date: now?.date ?? null,
      };
    });

  const e = obsAt(effr, at);
  let reference: FedPath['reference'] = e ? { value: e.value, date: e.date, label: 'effective fed funds rate (FRED EFFR)' } : null;
  if (!reference) {
    const front = points.find((p) => p.month === atMonth && p.implied !== null);
    if (front && front.implied !== null && front.date) {
      reference = { value: front.implied, date: front.date, label: `this month's contract (${front.ticker}), FRED EFFR unavailable` };
    }
  }
  return { reference, points };
}

/** bp priced between the reference and the contract `monthsAhead` from `at`, now and earlier. */
export function pricedBp(path: FedPath, at: Date, monthsAhead: number): { point: FedPathPoint; now: number | null; weekAgo: number | null; monthAgo: number | null } | null {
  if (!path.reference) return null;
  const target = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + monthsAhead, 1)).toISOString().slice(0, 7);
  const point = path.points.find((p) => p.month === target);
  if (!point) return null;
  const ref = path.reference.value;
  const bp = (v: number | null) => (v === null ? null : Math.round((v - ref) * 100));
  return { point, now: bp(point.implied), weekAgo: bp(point.impliedWeekAgo), monthAgo: bp(point.impliedMonthAgo) };
}

/** Effective rate plus the contract chain. Never throws; missing pieces are nulls. */
export async function fetchFedPathInputs(now: Date, length: number): Promise<{ effr: DatedObservation[]; contracts: FedContractSeries[] }> {
  const chain = contractChain(now, length);
  const [effrRes, bars] = await Promise.all([
    fetchFredSeries('EFFR').catch(() => null),
    Promise.all(chain.map((c) => fetchDailyBars(c.ticker).catch(() => null))),
  ]);
  return {
    effr: effrRes && effrRes.ok ? effrRes.data.slice(-400) : [],
    contracts: chain.map((c, k) => ({ ...c, closes: barsToSeries(bars[k]) })),
  };
}
