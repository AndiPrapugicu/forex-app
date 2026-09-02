/**
 * DATED market-consensus rate projections, and the machinery that refuses to
 * use one for a day it did not exist on.
 *
 * WHAT THIS IS FOR. A1's rate column asks a question we can already state
 * exactly: is the market pricing this bank above or below where it stands?
 * Their own Interest Rate Projections page publishes the quarterly consensus,
 * their Interest Rates page publishes the standing rate, and
 * `sign(projection - policy)` reproduces six of their cells — USD 0, EUR +1,
 * GBP +1, CHF 0, NZD +1. The RULE is not the problem.
 *
 * WHAT IS THE PROBLEM, AND WHY THIS FILE SCORES NOTHING IN PRODUCTION. That
 * page has a currency filter and nothing else: no date control, no history, no
 * revision log. A projection read today is a statement about today. Their board
 * of 2026-08-24 was priced off a projection nobody can now recover, and using
 * today's number for it is not an approximation of that value — it is a
 * different measurement wearing its name.
 *
 * The distinction this module exists to keep is therefore:
 *
 *   RULE KNOWN                  yes, and reproduced against six of their cells
 *   HISTORICAL INPUT AVAILABLE  no, and no amount of care makes it available
 *
 * So the seam is built and left unwired. `resolveProjection` answers for a date
 * it holds a snapshot for and returns an explicit missing state for every other
 * date — including, deliberately, every date BEFORE the first snapshot was
 * taken, which today is every board we have.
 *
 * THERE IS NO "NEAREST AVAILABLE" FALLBACK AND THERE MUST NEVER BE ONE. That
 * fallback is exactly the defect this repo has now found twice under other
 * names: `trend:as-of` computed today's price for a past board, and
 * `cot:publication-lag` admitted a report three days before it was published.
 * Both looked like harmless leniency and both silently invented parity. A
 * snapshot that does not exist for a date must read as absent, and the caller
 * must score 0 and say why.
 *
 * Collecting snapshots FORWARD is the only route to replayability, which is why
 * `rates-projection-history` is ranked second in `npm run evidence-next`: it
 * costs nothing but time, and the time has to start passing before it pays.
 */

import type { Currency } from '@/lib/types';

/** `2026Q3`. Their page's own granularity — projections are quarterly. */
export type Quarter = string;

/**
 * One reading of A1's projections page, stamped with WHEN WE READ IT.
 *
 * `observedAt` is ours and is the only date that can be trusted for replay:
 * their page carries no as-of of its own, so the moment of observation is the
 * only thing that bounds when the number was true.
 */
export interface RateProjectionSnapshot {
  /** `YYYY-MM-DD`, the day WE read the page. Never their publication date. */
  observedAt: string;
  /**
   * Their own last-updated stamp where the surface publishes one, else null.
   * Recorded for provenance and deliberately NOT used for selection — a page
   * that lies about its freshness would then decide what a past board saw.
   */
  sourceUpdatedAt: string | null;
  /** Where this was read, verbatim enough to find again. */
  source: string;
  /** How it was read, so a later reader can judge the reading. */
  provenance: string;
  /** Standing policy rate per currency, as their Interest Rates page showed it. */
  policyRates: Partial<Record<Currency, number>>;
  /** Projected policy rate, by quarter then currency. */
  projectionsByQuarter: Partial<Record<Quarter, Partial<Record<Currency, number>>>>;
  /**
   * How coarsely THIS reading was transcribed — 0.1 for a chart tooltip that
   * rounds to one decimal, 0.01 for a two-decimal read.
   *
   * It is per snapshot because it is a property of how the page was read, not
   * of the page. The 2026-08-30 reading carries two decimals and the 2026-09-01
   * one carries one, and treating the second as exact would invent decisions:
   * AUD's 4.4 against a standing 4.35 and CAD's 2.3 against 2.25 each sit
   * exactly half a step away and cannot be told from equality. `cellFor` refuses
   * those rather than calling them, which is the same rule as everywhere else
   * in this repo — a score is never fabricated.
   *
   * A 25bp move rounds clear of half a step, so the coarser reading still sees
   * every decision a central bank can actually take.
   */
  quarterValueStep?: number;
}

export type ProjectionStatus =
  /** A snapshot covers this date, currency and quarter. */
  | 'FOUND'
  /**
   * Every snapshot we hold was taken AFTER the date asked for. The live case for
   * every board on file, and the reason this module scores nothing.
   */
  | 'NO_SNAPSHOT_YET'
  /** A snapshot predates the date but by more than the staleness window. */
  | 'SNAPSHOT_TOO_STALE'
  /** The snapshot exists but does not cover that quarter. */
  | 'QUARTER_NOT_COVERED'
  /** The snapshot covers the quarter but not that currency. */
  | 'CURRENCY_NOT_COVERED'
  /** The snapshot covers the quarter but has no standing rate to compare to. */
  | 'POLICY_RATE_NOT_COVERED';

export interface ProjectionLookup {
  status: ProjectionStatus;
  /** The snapshot used, where one was. */
  snapshot: RateProjectionSnapshot | null;
  projection: number | null;
  policyRate: number | null;
  /** -1, 0, +1 — or null whenever `status !== 'FOUND'`. Never a guess. */
  cell: number | null;
  explanation: string;
}

/**
 * How long a projection stays usable after it was read.
 *
 * Their page is quarterly and moves when the consensus moves, so a month-old
 * reading is a reasonable description of a month-old board and a quarter-old one
 * is not. The window bounds staleness in the ONE direction that is defensible;
 * the other direction — a snapshot serving a date before it existed — is not a
 * matter of degree and is refused outright.
 */
export const PROJECTION_MAX_STALENESS_DAYS = 31;

/** `2026-08-24` -> `2026Q3`. */
export function quarterOf(date: string): Quarter {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  return `${year}Q${Math.floor((month - 1) / 3) + 1}`;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * The newest snapshot taken ON OR BEFORE `on`, or null.
 *
 * Reads strictly backwards. A snapshot from after `on` is not a worse answer
 * than one from before it, it is an answer to a different question.
 */
export function snapshotFor(
  snapshots: readonly RateProjectionSnapshot[],
  on: string,
): RateProjectionSnapshot | null {
  let best: RateProjectionSnapshot | null = null;
  for (const s of snapshots) {
    if (s.observedAt > on) continue;
    if (!best || s.observedAt > best.observedAt) best = s;
  }
  return best;
}

/**
 * A1's stated rule, applied to one currency on one date — or a refusal.
 *
 * "If the forecast happened to be higher than current rates, [the currency]
 * would get a -1" for the QUOTE leg, +1 for the base. So for a leg in isolation:
 * the sign of projection minus standing rate.
 */
export function resolveProjection(
  snapshots: readonly RateProjectionSnapshot[],
  currency: Currency,
  on: string,
  quarter: Quarter = quarterOf(on),
): ProjectionLookup {
  const miss = (
    status: ProjectionStatus,
    snapshot: RateProjectionSnapshot | null,
    explanation: string,
  ): ProjectionLookup => ({
    status,
    snapshot,
    projection: null,
    policyRate: null,
    cell: null,
    explanation,
  });

  const snapshot = snapshotFor(snapshots, on);
  if (!snapshot) {
    const earliest = [...snapshots].sort((a, b) => a.observedAt.localeCompare(b.observedAt))[0];
    return miss(
      'NO_SNAPSHOT_YET',
      null,
      earliest
        ? `No projection snapshot existed on ${on}; the earliest held was read ${earliest.observedAt}. ` +
            'Their page publishes no history, so this date cannot be replayed.'
        : `No projection snapshots are held at all, so ${on} cannot be replayed.`,
    );
  }

  const age = daysBetween(snapshot.observedAt, on);
  if (age > PROJECTION_MAX_STALENESS_DAYS) {
    return miss(
      'SNAPSHOT_TOO_STALE',
      snapshot,
      `The newest snapshot on or before ${on} was read ${snapshot.observedAt}, ${Math.round(age)} ` +
        `days earlier — beyond the ${PROJECTION_MAX_STALENESS_DAYS}-day window.`,
    );
  }

  const forQuarter = snapshot.projectionsByQuarter[quarter];
  if (!forQuarter) {
    return miss(
      'QUARTER_NOT_COVERED',
      snapshot,
      `The ${snapshot.observedAt} snapshot has no ${quarter} column.`,
    );
  }

  const projection = forQuarter[currency];
  if (projection === undefined) {
    return miss(
      'CURRENCY_NOT_COVERED',
      snapshot,
      `The ${snapshot.observedAt} snapshot covers ${quarter} but not ${currency}.`,
    );
  }

  const policyRate = snapshot.policyRates[currency];
  if (policyRate === undefined) {
    return miss(
      'POLICY_RATE_NOT_COVERED',
      snapshot,
      `${currency} has a ${quarter} projection of ${projection} but no standing rate to compare against.`,
    );
  }

  const diff = projection - policyRate;
  /**
   * A move has to clear HALF THE SNAPSHOT'S OWN PRECISION to be called one.
   *
   * Not a smoothing band and not an opinion about what counts as material: it is
   * the interval inside which the recorded number and the standing rate are the
   * same number as far as this reading can tell. With `quarterValueStep` 0.1,
   * 4.4 against 4.35 is unreadable and scores 0; 4.5 against 4.35 is a quarter
   * point and scores +1.
   */
  const band = (snapshot.quarterValueStep ?? 0) / 2 + 1e-9;
  const cell = Math.abs(diff) <= band ? 0 : diff > 0 ? 1 : -1;

  return {
    status: 'FOUND',
    snapshot,
    projection,
    policyRate,
    cell,
    explanation:
      `${currency} ${quarter}: consensus ${projection}% against a standing ${policyRate}% -> ` +
      `${cell > 0 ? '+1' : cell}, from the snapshot read ${snapshot.observedAt}.` +
      (cell === 0 && Math.abs(diff) > 1e-9
        ? `  The ${diff > 0 ? 'gap' : 'shortfall'} of ${Math.abs(diff).toFixed(2)} is within the ` +
          `reading's own ${snapshot.quarterValueStep} precision, so it is not a projected move.`
        : ''),
  };
}

/**
 * The rates legs for a WHOLE BOARD, or nothing at all.
 *
 * ALL-OR-NOTHING IS THE POINT, and it is what kept this rule out of production
 * for four rounds. A1's rates column is a DIFFERENCE, so a leg computed under
 * this rule and differenced against a leg computed under the fallback is not a
 * measurement of anything — it is two models subtracted. The first attempt held
 * the Fed's dot plot alone, switching USD's leg while the other seven sat at a
 * placeholder 0, and cell parity went 84/98 to 82/98 with no cell gained. See
 * `scoreRateExpectation` and ledger `rates:usd-leg`.
 *
 * So: every major resolves FOUND, or the caller uses none of this. A partial
 * snapshot is not a partial answer.
 *
 * WHAT THIS REPRODUCES. Against A1's own published index rows, the current
 * quarter's projection versus the standing rate gives all eight legs exactly,
 * on the 2026-08-31 AND 2026-09-01 captures:
 *
 *   EUR +1   GBP +1   JPY +1   NZD +1   USD +1   AUD 0   CAD 0   CHF 0
 *
 * The two zeros that are not blanks matter as much as the ones: AUD and CAD are
 * 0 because their projections sit inside the reading's precision, and A1 prints
 * 0 for both.
 */
export function resolveConsensusProjectionLegs(
  snapshots: readonly RateProjectionSnapshot[],
  currencies: readonly Currency[],
  on: string,
): { legs: Map<Currency, ProjectionLookup> } | { legs: null; why: string } {
  const legs = new Map<Currency, ProjectionLookup>();
  for (const currency of currencies) {
    const lookup = resolveProjection(snapshots, currency, on);
    if (lookup.status !== 'FOUND') {
      return {
        legs: null,
        why:
          `${currency} is ${lookup.status} on ${on}, so no currency uses projections for this ` +
          `board — a differenced column cannot mix two rules. ${lookup.explanation}`,
      };
    }
    legs.set(currency, lookup);
  }
  return { legs };
}
