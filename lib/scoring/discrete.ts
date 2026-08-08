/**
 * The bridge between the continuous scoring engine and the discrete scorecard.
 *
 * The −10..+10 engine in surprise.ts is unchanged and still drives news, alerts
 * and market mood. This module buckets the SAME sigma into −2..+2 cells so the
 * matrix and the rest of the app can never disagree about what a print meant.
 *
 * The other job here is resolving WHICH release fills a slot. That is not
 * obvious: a currency publishes several plausible candidates for "Retail Sales"
 * in any given month, and picking whichever printed most recently would make the
 * column flicker between series. Resolution is by ordered preference, scoped to
 * the currency's primary country.
 */

import {
  CELL_MAX,
  CELL_MIN,
  DEFAULT_MAX_AGE_DAYS,
  PRIMARY_COUNTRY,
  SIGMA_BUCKETS,
  type SlotDefinition,
} from '@/config/setups.config';
import { computeSurprise } from '@/lib/scoring/surprise';
import type { Currency, NormalizedEvent } from '@/lib/types';

/** Why a cell has no value. Drives how the UI renders the blank. */
export type CellStatus = 'scored' | 'stale' | 'no-data' | 'not-released';

export interface SlotResult {
  slotKey: string;
  currency: Currency;
  /** null unless status is 'scored'. */
  cell: number | null;
  status: CellStatus;
  /** The release this slot resolved to, for the scorecard detail table. */
  event: NormalizedEvent | null;
  sigma: number | null;
  ageDays: number | null;
  explanation: string;
}

/**
 * Buckets a signed sigma into a discrete cell.
 *
 * Boundaries are inclusive at the lower edge (|sigma| exactly 0.25 scores ±1)
 * and the middle band is deliberately wide — most releases land near forecast,
 * and a matrix where every cell reads ±1 carries no information.
 */
export function bucketSigma(sigma: number): number {
  const magnitude = Math.abs(sigma);
  const sign = sigma >= 0 ? 1 : -1;

  if (magnitude >= SIGMA_BUCKETS.strong) return sign * 2;
  if (magnitude >= SIGMA_BUCKETS.mild) return sign * 1;
  return 0;
}

function ageInDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Picks the release that fills a slot for one currency.
 *
 * Scoped to the currency's primary country FIRST. For EUR this is the whole
 * point: "Consumer Price Index (YoY)" exists for Germany, Italy, Spain and
 * others, while the euro-area aggregate is published under EMU with a different
 * name. Without the country filter the column would show whichever member state
 * printed last.
 *
 * Within the country, patterns are tried in order and the first with a released
 * value wins, so the canonical series is chosen deterministically.
 */
export function resolveSlotEvent(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
): NormalizedEvent | null {
  if (slot.kind !== 'economic') return null;

  const patterns = slot.matchByCurrency?.[currency] ?? slot.match ?? [];
  if (patterns.length === 0) return null;

  const country = PRIMARY_COUNTRY[currency];
  const pool = events.filter(
    (e) => e.currency === currency && e.actual !== null && (e.countryCode ?? country) === country,
  );

  for (const pattern of patterns) {
    const matches = pool.filter((e) => pattern.test(e.name));
    if (matches.length === 0) continue;

    // Most recent release of the first matching series.
    return matches.reduce((newest, e) => (e.dateUtc > newest.dateUtc ? e : newest));
  }

  return null;
}

/**
 * Scores one slot for one currency.
 *
 * Staleness produces a distinct status rather than a zero. A GDP print from five
 * months ago and a GDP print that landed exactly on forecast are both "0" if you
 * only look at the number, and conflating them would let the matrix imply
 * knowledge it does not have.
 */
export function scoreSlot(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): SlotResult {
  const base = { slotKey: slot.key, currency, cell: null, event: null, sigma: null, ageDays: null };

  if (slot.kind !== 'economic') {
    return { ...base, status: 'no-data', explanation: 'Computed elsewhere' };
  }

  const event = resolveSlotEvent(slot, currency, events);
  if (!event) {
    return { ...base, status: 'no-data', explanation: `No ${slot.label} data for ${currency}` };
  }

  const age = ageInDays(event.dateUtc, now);
  const maxAge = slot.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;

  if (age > maxAge) {
    return {
      ...base,
      event,
      ageDays: Math.round(age),
      status: 'stale',
      explanation:
        `Last ${slot.label} print was ${Math.round(age)} days ago, beyond the ${maxAge}-day window`,
    };
  }

  const surprise = computeSurprise(event);
  if (surprise.sigma === null) {
    return {
      ...base,
      event,
      ageDays: Math.round(age),
      status: 'not-released',
      explanation: surprise.detail,
    };
  }

  // Polarity converts "the number went up" into "the currency should go up".
  const polarity = slot.polarity ?? 1;
  const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, bucketSigma(surprise.sigma) * polarity));

  return {
    slotKey: slot.key,
    currency,
    cell,
    status: 'scored',
    event,
    sigma: Math.round(surprise.sigma * 100) / 100,
    ageDays: Math.round(age),
    explanation:
      `${event.name}: ${event.actual}${event.unit ?? ''} vs ${event.consensus ?? '—'} forecast ` +
      `(${surprise.sigma > 0 ? '+' : ''}${surprise.sigma.toFixed(2)}σ)` +
      (polarity === -1 ? ', inverted — higher is bearish here' : ''),
  };
}

/**
 * Combines two currency legs into a pair cell.
 *
 * A missing leg counts as 0 rather than voiding the cell, which is what lets
 * NZDUSD show a value in the NFP column: NZD publishes no payrolls, so the cell
 * is simply the inverted USD reading. Clamped because two opposing ±2 legs would
 * otherwise produce ±4.
 */
export function combinePairCells(
  baseCell: number | null,
  quoteCell: number | null,
): { cell: number | null; status: CellStatus } {
  if (baseCell === null && quoteCell === null) return { cell: null, status: 'no-data' };

  const value = (baseCell ?? 0) - (quoteCell ?? 0);
  return { cell: Math.max(CELL_MIN, Math.min(CELL_MAX, value)), status: 'scored' };
}
