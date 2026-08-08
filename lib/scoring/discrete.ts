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
  TERNARY_EPSILON,
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
 * Ternary read of a release: beat, miss, or on forecast.
 *
 * Takes the RAW difference rather than sigma, because sigma is a normalisation
 * and this scale has no use for one — the only question is which side of the
 * forecast the print landed on.
 *
 * Deliberately has no deadband. The previous sigma bucketing used ±0.25 and
 * swallowed genuine misses (JOLTS 7.359 against a 7.4 forecast scored 0). The
 * epsilon here only absorbs float noise between values the feed itself reports
 * as equal.
 */
export function ternarySign(actual: number, consensus: number): number {
  const diff = actual - consensus;
  if (Math.abs(diff) < TERNARY_EPSILON) return 0;
  return diff > 0 ? 1 : -1;
}

/**
 * Collapses JavaScript's negative zero to positive zero.
 *
 * `0 * -1` is `-0`, which renders as "-0" in the UI and fails Object.is against
 * `0`. Every place a cell is multiplied by a polarity or an inversion needs this.
 */
export function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
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

  /**
   * Ternary needs a forecast to compare against. Without one there is no beat or
   * miss to read, so the slot goes unscored rather than falling back to the
   * previous print — "above last month" is a different claim from "above what
   * the market expected", and conflating them was never intended here.
   */
  if (event.consensus === null || event.actual === null) {
    return {
      ...base,
      event,
      ageDays: Math.round(age),
      status: 'not-released',
      explanation: `${event.name}: no forecast to compare against`,
    };
  }

  // Sigma no longer drives the cell, but it is still the most informative thing
  // to show a reader, so it is computed and carried through.
  const surprise = computeSurprise(event);

  // Polarity converts "the number went up" into "the currency should go up".
  const polarity = slot.polarity ?? 1;
  const cell = normalizeZero(
    Math.max(CELL_MIN, Math.min(CELL_MAX, ternarySign(event.actual, event.consensus) * polarity)),
  );

  const sigmaNote =
    surprise.sigma === null ? '' : ` (${surprise.sigma > 0 ? '+' : ''}${surprise.sigma.toFixed(2)}σ)`;

  return {
    slotKey: slot.key,
    currency,
    cell,
    status: 'scored',
    event,
    sigma: surprise.sigma === null ? null : Math.round(surprise.sigma * 100) / 100,
    ageDays: Math.round(age),
    explanation:
      `${event.name}: ${event.actual}${event.unit ?? ''} vs ${event.consensus}${event.unit ?? ''} forecast` +
      sigmaNote +
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
  return {
    cell: normalizeZero(Math.max(CELL_MIN, Math.min(CELL_MAX, value))),
    status: 'scored',
  };
}
