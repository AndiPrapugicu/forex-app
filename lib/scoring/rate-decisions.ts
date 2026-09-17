/**
 * The Rates column from the central banks' own decision calendar.
 *
 * WHY THIS REPLACED THE SNAPSHOT AS THE LIVE INPUT. `rate-projections.ts` reads
 * dated transcriptions of A1's Interest Rate Projections page. The last one was
 * read 2026-09-01; within a fortnight the RBNZ, the ECB and the Fed had all
 * moved, and our EUR, GBP, NZD and USD legs kept scoring a hike that had either
 * happened or been priced out. A1 had moved on: on their 09-15 and 09-17 boards
 * those legs read 0 (USD +1 until the Fed's 09-16 decision).
 *
 * THE RULE. For each bank, the consensus for its NEXT scheduled decision against
 * the rate standing now: a hike expected is +1, a cut -1, a hold 0. A decision
 * with no consensus published yet is a hold as far as anyone has said, so 0.
 * Against A1's own legs:
 *
 *   2026-09-15  USD +1 (Fed 4.00 vs 3.75)  JPY +1 (BoJ 1.25 vs 1.00)  others 0
 *   2026-09-17  USD 0 (Fed decided)        JPY +1                     others 0
 *
 * which reproduces EURUSD -1, GBPJPY -1, NZDUSD -1 and AUDNZD 0 on 09-15, and
 * USDJPY -1, EURUSD 0 and EURX/GBPX/NZDX 0 on 09-17.
 *
 * WHEN IT RUNS. Only when a bank has decided since the newest snapshot was read
 * (`decidedSince`); until then the snapshot, which is A1's own page, stands.
 * All or nothing, for the reason `resolveConsensusProjectionLegs` gives: a
 * differenced column cannot mix two rules.
 *
 * KNOWN LIMIT. On a rewound board the consensus is today's, not the one that
 * stood then — the calendar keeps no history of its forecast column.
 */

import { TRADINGVIEW } from '@/config/sources.config';
import { RATE_SPREAD_FLAT_BAND } from '@/lib/scoring/rates';
import type { ProjectionLookup } from '@/lib/scoring/rate-projections';
import type { Currency, NormalizedEvent } from '@/lib/types';

const DECISION = TRADINGVIEW.rateDecisions.publishAs;

const BANK_BY_CURRENCY = new Map<string, string>(
  Object.values(TRADINGVIEW.rateDecisions.titles).map((t) => [t.currency, t.bank]),
);

function decisions(events: readonly NormalizedEvent[], currency: Currency): NormalizedEvent[] {
  return events
    .filter((e) => e.name === DECISION && e.currency === currency)
    .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
}

/** True when any bank in `currencies` announced a decision after the end of `day`. */
export function decidedSince(
  events: readonly NormalizedEvent[],
  currencies: readonly Currency[],
  day: string,
  now: Date,
): boolean {
  const after = `${day}T23:59:59.999Z`;
  const iso = now.toISOString();
  return events.some(
    (e) =>
      e.name === DECISION &&
      currencies.includes(e.currency as Currency) &&
      e.actual !== null &&
      e.dateUtc > after &&
      e.dateUtc <= iso,
  );
}

export function resolveCalendarRateLegs(
  events: readonly NormalizedEvent[],
  currencies: readonly Currency[],
  now: Date,
): { legs: Map<Currency, ProjectionLookup> } | { legs: null; why: string } {
  const iso = now.toISOString();
  const legs = new Map<Currency, ProjectionLookup>();

  for (const currency of currencies) {
    const rows = decisions(events, currency);
    const bank = BANK_BY_CURRENCY.get(currency) ?? currency;
    const released = rows.filter((e) => e.dateUtc <= iso && e.actual !== null);
    const next = rows.find((e) => e.dateUtc > iso && e.actual === null) ?? null;

    const standing = released.at(-1)?.actual ?? next?.previous ?? null;
    if (standing === null) {
      return {
        legs: null,
        why: `No ${bank} decision on the calendar gives a standing rate, so no currency uses it — a differenced column cannot mix two rules.`,
      };
    }

    let cell = 0;
    let explanation: string;
    if (!next) {
      explanation = `${currency}: ${bank} rate stands at ${standing}% and no next decision is on the calendar yet, so no move is expected.`;
    } else if (next.consensus === null) {
      explanation =
        `${currency}: ${bank} rate stands at ${standing}%; no consensus is published yet for the ` +
        `${next.dateUtc.slice(0, 10)} decision, so no move is expected.`;
    } else {
      const move = next.consensus - standing;
      cell = Math.abs(move) < RATE_SPREAD_FLAT_BAND ? 0 : move > 0 ? 1 : -1;
      explanation =
        `${currency}: ${bank} decision on ${next.dateUtc.slice(0, 10)} is forecast at ${next.consensus}% ` +
        `against a standing ${standing}% — ${cell === 0 ? 'a hold' : cell > 0 ? 'a hike' : 'a cut'} is expected.`;
    }

    legs.set(currency, {
      status: 'FOUND',
      snapshot: null,
      projection: next?.consensus ?? standing,
      policyRate: standing,
      cell,
      explanation: `${explanation}  Source: central-bank decision calendar (TradingView).`,
    });
  }

  return { legs };
}
