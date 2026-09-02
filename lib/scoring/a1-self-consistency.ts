/**
 * Scores A1's OWN published data under A1's OWN stated rule, and checks the
 * answer against the leg their board actually printed.
 *
 * WHY THIS EXISTS. Every round has produced the same argument in a different
 * costume: their cell says X, ours says Y, and the question is whose input is
 * wrong. Until now that was settled by reading screenshots side by side, which
 * is slow and produced at least two conclusions that later turned out to be
 * misreadings of a chart's month buckets.
 *
 * There is a third party to ask, and it is A1. Their free economic pages
 * publish the actual AND the forecast per release, and their scoring text says
 * what they do with the pair. So for any release we have captured, the ternary
 * their board SHOULD carry is computable — and their board is right there,
 * solved into per-currency legs by `a1-legs`. Comparing the two answers a
 * question no amount of squinting at our own feed can:
 *
 *   - their cell matches their data  -> our input differs from theirs.
 *     A SOURCE DIFFERENCE, and the fix is a feed, not a rule.
 *   - their cell contradicts their data -> their pipeline is wrong.
 *     AN A1 DEFECT, and it must not be reproduced at any price.
 *
 * That distinction decides whether a mismatch is ours to fix, and it was being
 * made by hand.
 *
 * NOTHING HERE SCORES A PRODUCTION CELL. It reads two fixtures and reports.
 */

import { SCORING_SLOTS } from '@/config/setups.config';
import type { Leg } from '@/lib/scoring/a1-legs';
import type { Currency } from '@/lib/types';

/** One release as A1 publishes it on their own free economic page. */
export interface A1Release {
  slotKey: string;
  currency: Currency;
  /** A1's own release date. `YYYY-MM-DD`, or `YYYY-MM` for a monthly bucket. */
  date: string;
  actual: number | null;
  /** Null where their page shows no forecast — which is itself a finding. */
  forecast: number | null;
  /** Their own printed classification, where the page shows one. */
  a1Label?: string | null;
}

/** What our feed carried for the same slot and currency. */
export interface OurRelease {
  actual: number | null;
  reference: number | null;
  referenceLabel: 'forecast' | 'previous';
}

export type CellVerdict =
  /** Their cell is what their own published pair implies. */
  | 'A1_SELF_CONSISTENT'
  /** Their cell is NOT what their own data implies. Their defect. */
  | 'A1_CONTRADICTS_ITSELF'
  /** Their page publishes no forecast, so the pair cannot be scored. */
  | 'A1_NO_FORECAST'
  /** The board pins no leg for that currency and column. */
  | 'NO_LEG_SOLVED'
  /**
   * A month-bucketed release in the capture's own month: it may or may not have
   * printed before the board was taken, and their page does not say. Reported
   * rather than resolved — see `wasPublishedBy`.
   */
  | 'A1_RELEASE_DATE_AMBIGUOUS'
  /**
   * The release is not the one the board was reading — it postdates the
   * capture, or a newer release of the same series also predates it.
   *
   * THIS CATEGORY IS THE POINT OF THE WHOLE SELECTION STEP. Round thirteen
   * matched A1's `aug. 2026` PPI bucket against a board captured 2026-08-24 and
   * announced that A1 contradicted itself; the board was reading `iul. 2026`,
   * and their page and their board agreed all along. The first draft of THIS
   * FILE reproduced the same error on the same series. A comparison that does
   * not pick the release by date does not measure what it claims to.
   */
  | 'NOT_THE_BOARDS_RELEASE';

export type SourceVerdict =
  | 'SAME_INPUTS'
  | 'ACTUAL_DIFFERS'
  | 'REFERENCE_DIFFERS'
  | 'BOTH_DIFFER'
  | 'OURS_MISSING';

export interface SelfConsistencyRow {
  slotKey: string;
  currency: Currency;
  date: string;
  /** The ternary A1's own pair implies, under A1's own comparison. */
  impliedLeg: Leg | null;
  /** The leg their board actually carries, solved from the captured rows. */
  printedLeg: Leg | null;
  verdict: CellVerdict;
  a1Actual: number | null;
  a1Forecast: number | null;
  ourActual: number | null;
  ourReference: number | null;
  source: SourceVerdict;
  note: string;
}

/** Float noise only — A1's PPI page proves the comparison has no dead band. */
const EPSILON = 1e-9;

function polarityOf(slotKey: string): number {
  return SCORING_SLOTS.find((s) => s.key === slotKey)?.polarity ?? 1;
}

/**
 * A1's comparison: the raw sign of `actual - forecast`, times the slot's
 * polarity. Their PPI page renders Met / Lower / Higher as three separate
 * series with an exact match in its own category, which is this function with
 * no tolerance band.
 */
export function impliedLeg(release: A1Release): Leg | null {
  if (release.actual === null || release.forecast === null) return null;
  const diff = release.actual - release.forecast;
  const raw = Math.abs(diff) < EPSILON ? 0 : diff > 0 ? 1 : -1;
  return (raw * polarityOf(release.slotKey)) as Leg;
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-6;
}

function compareSources(a1: A1Release, ours: OurRelease | undefined): SourceVerdict {
  if (!ours || (ours.actual === null && ours.reference === null)) return 'OURS_MISSING';
  const actualDiffers = !sameNumber(a1.actual, ours.actual);
  const refDiffers = !sameNumber(a1.forecast, ours.reference);
  if (actualDiffers && refDiffers) return 'BOTH_DIFFER';
  if (actualDiffers) return 'ACTUAL_DIFFERS';
  if (refDiffers) return 'REFERENCE_DIFFERS';
  return 'SAME_INPUTS';
}

export interface SelfConsistencyInput {
  /** A1's published releases, from their free economic pages. */
  releases: readonly A1Release[];
  /** Legs solved out of their captured board, by currency then slot. */
  printedLegs: Map<Currency, Partial<Record<string, Leg>>>;
  /** What our feed carried, keyed `slotKey|currency`. */
  ours: Map<string, OurRelease>;
  /** The board's own date. Decides which release each column was reading. */
  capturedOn: string;
}

/**
 * Could this release have been on the board captured that day?
 *
 * THREE ANSWERS, BECAUSE THE HONEST ANSWER IS SOMETIMES "CANNOT TELL", and
 * collapsing that into either boolean has now produced a wrong conclusion in
 * both directions on the same series.
 *
 * A `YYYY-MM-DD` entry is a release date and is knowable from that day on.
 *
 * A `YYYY-MM` entry is a month BUCKET off one of their charts, and this file
 * used to assert that such a figure is never published inside its own month —
 * i.e. that the bucket is a REFERENCE month. The fixture's own header says
 * otherwise ("`date` is A1's own release date"), and their data settles it: A1
 * publishes GBP PPI YoY as `2026-07` -> 3.5 with no forecast and `2026-08` ->
 * 3.1 against 3.2. Our calendar carries those two pairs as the releases of
 * 2026-07-22 and 2026-08-19 — whose REFERENCE months are June and July. The
 * labels track the release month, not the reference month, on both points.
 *
 * So a bucket in a PAST month is published, a bucket in a FUTURE month is not,
 * and a bucket in the capture's OWN month is genuinely indeterminate: the
 * bucket names a month, the board names a day, and nothing on their page says
 * which came first. That case is reported rather than guessed.
 */
export type PublicationCertainty = 'PUBLISHED' | 'NOT_YET' | 'AMBIGUOUS';

export function wasPublishedBy(date: string, capturedOn: string): PublicationCertainty {
  if (!/^\d{4}-\d{2}$/.test(date)) return date <= capturedOn ? 'PUBLISHED' : 'NOT_YET';
  const capturedMonth = capturedOn.slice(0, 7);
  if (date < capturedMonth) return 'PUBLISHED';
  if (date > capturedMonth) return 'NOT_YET';
  return 'AMBIGUOUS';
}

/**
 * The one release per series the board was actually reading: the newest that
 * had been published by the capture date.
 */
export function boardsReleases(
  releases: readonly A1Release[],
  capturedOn: string,
): Set<A1Release> {
  const newest = new Map<string, A1Release>();
  for (const r of releases) {
    // AMBIGUOUS counts as a candidate here and is separated by the caller. A
    // release that MIGHT be the board's must not silently promote an older one
    // into that position — that is how the previous rule hid a disagreement.
    if (wasPublishedBy(r.date, capturedOn) === 'NOT_YET') continue;
    const key = `${r.slotKey}|${r.currency}`;
    const held = newest.get(key);
    if (!held || r.date > held.date) newest.set(key, r);
  }
  return new Set(newest.values());
}

/**
 * One row per captured release.
 *
 * A release whose leg the board does not pin is still reported: knowing their
 * published pair without a cell to check it against is the exact shape of the
 * next capture worth taking.
 */
export function checkSelfConsistency(input: SelfConsistencyInput): SelfConsistencyRow[] {
  const rows: SelfConsistencyRow[] = [];

  const onTheBoard = boardsReleases(input.releases, input.capturedOn);

  for (const release of input.releases) {
    const implied = impliedLeg(release);
    const printed = input.printedLegs.get(release.currency)?.[release.slotKey] ?? null;
    const ours = input.ours.get(`${release.slotKey}|${release.currency}`);
    const source = compareSources(release, ours);

    let verdict: CellVerdict;
    let note: string;

    if (!onTheBoard.has(release)) {
      verdict = 'NOT_THE_BOARDS_RELEASE';
      note =
        `Not the release the ${input.capturedOn} board was reading — ` +
        'superseded by a newer print, or not yet published. Not compared.';
    } else if (wasPublishedBy(release.date, input.capturedOn) === 'AMBIGUOUS') {
      verdict = 'A1_RELEASE_DATE_AMBIGUOUS';
      const direction =
        implied === null || printed === null
          ? 'and no comparison is available either way'
          : implied === printed
            ? `and it would AGREE with their printed ${printed} if it was`
            : `and it would CONTRADICT their printed ${printed} (their pair implies ${implied}) if it was`;
      note =
        `Their page buckets this release as ${release.date} with no day. The board was taken ` +
        `${input.capturedOn}, inside that month, so whether this is the release it read is ` +
        `unknowable from their page — ${direction}. Resolving it needs the release day, which ` +
        'our own calendar carries but their chart does not.';
    } else if (release.forecast === null) {
      verdict = 'A1_NO_FORECAST';
      note =
        'Their page shows no forecast for this release. Their chart still classifies it, ' +
        'which is how a missing consensus becomes a scored beat on their side.';
    } else if (printed === null) {
      verdict = 'NO_LEG_SOLVED';
      note = 'Their published pair implies a cell no captured row pins. A capture would test it.';
    } else if (implied === printed) {
      verdict = 'A1_SELF_CONSISTENT';
      note =
        source === 'SAME_INPUTS'
          ? 'Their cell, their data and our data all agree.'
          : `Their cell matches their own data; ours differs (${source}). A feed difference, not a rule difference.`;
    } else {
      verdict = 'A1_CONTRADICTS_ITSELF';
      note =
        `Their own published pair implies ${implied}, their board prints ${printed}. ` +
        'No correct implementation reproduces this cell.';
    }

    rows.push({
      slotKey: release.slotKey,
      currency: release.currency,
      date: release.date,
      impliedLeg: implied,
      printedLeg: printed,
      verdict,
      a1Actual: release.actual,
      a1Forecast: release.forecast,
      ourActual: ours?.actual ?? null,
      ourReference: ours?.reference ?? null,
      source,
      note,
    });
  }

  return rows;
}

/** Counts by verdict, for the script's summary line. */
export function summarize(rows: readonly SelfConsistencyRow[]): Record<CellVerdict, number> {
  const out: Record<CellVerdict, number> = {
    A1_SELF_CONSISTENT: 0,
    A1_CONTRADICTS_ITSELF: 0,
    A1_NO_FORECAST: 0,
    NO_LEG_SOLVED: 0,
    A1_RELEASE_DATE_AMBIGUOUS: 0,
    NOT_THE_BOARDS_RELEASE: 0,
  };
  for (const r of rows) out[r.verdict] += 1;
  return out;
}
