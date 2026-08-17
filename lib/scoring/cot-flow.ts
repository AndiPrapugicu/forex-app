/**
 * What large speculators actually DID last week, in a sentence.
 *
 * The COT table already carries every number, and none of them speak. JPY prints
 * `Δ Long +45,957 / Δ Short −71,982` and the reader is left to work out for
 * themselves that specs bought with both hands, that it was the heaviest week in
 * years, and that they are STILL net short — which makes it a squeeze rather
 * than a fresh long. All three of those are derivable from data already fetched.
 *
 * TWO IDEAS DO THE WORK HERE.
 *
 * First, the sign pair. `Δ Net` alone hides which side moved, and the four
 * quadrants of (Δlong, Δshort) are genuinely different markets: longs piling in
 * while shorts cover is a market with one opinion; both books growing is a
 * market with two. Same net change, opposite meaning.
 *
 * Second, the scale is relative to the CONTRACT'S OWN HISTORY. Five thousand
 * contracts is a huge week in NZD and a rounding error in gold, so any absolute
 * threshold just ranks the biggest markets top forever. Percentile against the
 * contract's own 156 weekly changes is the only way "heavy" means the same thing
 * across the board — the same argument `scoreCot` already makes for net
 * positioning, reusing the same `percentileRank`.
 *
 * NOTHING HERE FEEDS A SCORE. A1's bias bands are absolute, so a new scoring
 * input would silently redefine "Bullish". This is a reading of the same numbers
 * the COT cell already scores, not another cell.
 */

import { COT_FLOW_BANDS } from '@/config/setups.config';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import { percentileRank } from '@/lib/scoring/cot';

/**
 * The four quadrants of (Δlong, Δshort).
 *
 * `accumulation` and `distribution` are the one-sided cases — both books moving
 * the same way. `expansion` and `liquidation` are the two-sided ones, where the
 * net change hides a disagreement, and conviction is correspondingly weaker.
 */
export type CotFlowKind = 'accumulation' | 'distribution' | 'expansion' | 'liquidation' | 'flat';

export type CotFlowStrength = 'extreme' | 'heavy' | 'notable' | 'routine';

export interface CotFlow {
  contract: string;
  kind: CotFlowKind;
  strength: CotFlowStrength;
  /** Where this week's absolute net change sits in the contract's own history. */
  percentile: number;
  /** Weeks the percentile was measured against. Few weeks, weak claim. */
  sampleWeeks: number;
  direction: 'buying' | 'selling' | 'flat';
  netChange: number;
  longChange: number;
  shortChange: number;
  /**
   * They moved AGAINST their own book — reducing an existing bet rather than
   * adding to one. The difference between "specs are buying yen" and "specs are
   * covering a yen short", which is the whole story in a squeeze.
   */
  againstPosition: boolean;
  /** The book crossed zero this week: net short became net long, or the reverse. */
  flipped: boolean;
  /** Open interest agrees with the kind — new money in, or money leaving. */
  oiConfirms: boolean;
  /** Net position AFTER this week's change, for the sentence. */
  netAfter: number;
  /** Table-cell length, e.g. "Heavy accumulation". */
  headline: string;
  /** The full read, a couple of sentences. */
  sentence: string;
}

const KIND_LABEL: Record<CotFlowKind, string> = {
  accumulation: 'accumulation',
  distribution: 'distribution',
  expansion: 'two-sided build',
  liquidation: 'liquidation',
  flat: 'no change',
};

function classify(longChange: number, shortChange: number): CotFlowKind {
  if (longChange === 0 && shortChange === 0) return 'flat';
  if (longChange >= 0 && shortChange <= 0) return 'accumulation';
  if (longChange <= 0 && shortChange >= 0) return 'distribution';
  return longChange > 0 ? 'expansion' : 'liquidation';
}

function strengthFor(percentile: number): CotFlowStrength {
  if (percentile >= COT_FLOW_BANDS.extreme) return 'extreme';
  if (percentile >= COT_FLOW_BANDS.heavy) return 'heavy';
  if (percentile >= COT_FLOW_BANDS.notable) return 'notable';
  return 'routine';
}

const fmt = (n: number) => Math.abs(n).toLocaleString();

/**
 * Prose for one week's flow.
 *
 * Composed from a template rather than generated, so it can never claim
 * something the numbers do not say. Every clause is switched on a boolean
 * computed above; there is no path that invents a direction.
 */
function describe(f: Omit<CotFlow, 'headline' | 'sentence'>): { headline: string; sentence: string } {
  const label = KIND_LABEL[f.kind];
  const headline =
    f.kind === 'flat'
      ? 'No change'
      : `${f.strength === 'routine' ? '' : f.strength[0].toUpperCase() + f.strength.slice(1) + ' '}${label}`
          .trim()
          .replace(/^./, (c) => c.toUpperCase());

  if (f.kind === 'flat') {
    return { headline, sentence: 'Large speculators did not move this contract last week.' };
  }

  const longs =
    f.longChange === 0
      ? 'left longs alone'
      : `${f.longChange > 0 ? 'added' : 'cut'} ${fmt(f.longChange)} longs`;
  const shorts =
    f.shortChange === 0
      ? 'left shorts alone'
      : f.shortChange > 0
        ? `added ${fmt(f.shortChange)} shorts`
        : `covered ${fmt(f.shortChange)} shorts`;

  // What the two legs together mean — the part a single net figure loses.
  const reading =
    f.kind === 'accumulation'
      ? 'buying with both hands'
      : f.kind === 'distribution'
        ? 'selling with both hands'
        : f.kind === 'expansion'
          ? `new money on both sides, with ${f.direction === 'buying' ? 'buyers' : 'sellers'} ahead`
          : `both sides cutting, ${f.direction === 'buying' ? 'shorts' : 'longs'} faster`;

  const scale =
    f.sampleWeeks < 26
      ? `only ${f.sampleWeeks} weeks of history to compare against`
      : f.strength === 'extreme'
        ? `the heaviest week in ${Math.round(f.sampleWeeks / 52)} years`
        : f.strength === 'heavy'
          ? `bigger than ${Math.round(f.percentile)}% of its weeks`
          : f.strength === 'notable'
            ? 'a middling week by its own standards'
            : 'a quiet week by its own standards';

  let closing: string;
  if (f.flipped) {
    closing = `That flips the book ${f.netAfter > 0 ? 'net long' : 'net short'} at ${fmt(f.netAfter)}.`;
  } else if (f.againstPosition) {
    // The distinction that stops a big number being read as a big signal.
    closing =
      `Still net ${f.netAfter > 0 ? 'long' : 'short'} ${fmt(f.netAfter)}, so this is a ` +
      `${f.direction === 'buying' ? 'squeeze out of' : 'trim from'} an existing position rather than a fresh ` +
      `${f.direction === 'buying' ? 'long' : 'short'}.`;
  } else {
    closing = `That adds to an existing net ${f.netAfter > 0 ? 'long' : 'short'} of ${fmt(f.netAfter)}.`;
  }

  const oi = f.oiConfirms ? '' : ' Open interest disagrees with that read.';

  return {
    headline,
    sentence: `Specs ${longs} and ${shorts} — ${reading}, ${scale}. ${closing}${oi}`,
  };
}

/**
 * Reads one contract's latest weekly filing.
 *
 * Returns `null` when the report carries no week-on-week change — the very first
 * filing for a contract has no prior week to difference, and rendering that as
 * "quiet" would state something the data does not support.
 */
/**
 * A number we actually have, as a type guard.
 *
 * `Number.isFinite` alone does not narrow, so without this the compiler still
 * treats the value as nullable three lines later and the guard reads as
 * decoration rather than as the precondition it is.
 */
function isMeasured(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function readCotFlow(series: CotSeries): CotFlow | null {
  const latest: CotReport | undefined = series.reports[0];
  if (!latest) return null;

  /**
   * `Number.isFinite` rather than a null check, and that matters here more than
   * anywhere else in this file.
   *
   * These fields arrive from JSON and can be absent, not null, whenever the
   * payload predates them — every report in the captured COT fixture is missing
   * both. A `=== null` test lets `undefined` straight through, and the
   * subtraction below then yields NaN, which does not throw: it percentile-ranks
   * to a number and this function returns a fully-formed narrative
   * ("Notable liquidation") describing arithmetic on nothing. Returning null is
   * the honest answer to a week we cannot measure.
   */
  const longChange = latest.specLongChange;
  const shortChange = latest.specShortChange;
  if (!isMeasured(longChange) || !isMeasured(shortChange)) return null;

  const netChange = latest.specNetChange ?? longChange - shortChange;

  /**
   * Compared against the contract's OWN prior weeks, excluding this one — a
   * value ranked against a set containing itself can never reach the top band.
   */
  const history = series.reports
    .slice(1)
    .map((r) => r.specNetChange)
    .filter((v): v is number => v !== null)
    .map(Math.abs);

  const percentile = history.length > 0 ? percentileRank(Math.abs(netChange), history) : 0;

  const kind = classify(longChange, shortChange);
  const netBefore = latest.specNet - netChange;

  const partial: Omit<CotFlow, 'headline' | 'sentence'> = {
    contract: series.contract,
    kind,
    strength: kind === 'flat' ? 'routine' : strengthFor(percentile),
    percentile,
    sampleWeeks: history.length,
    direction: netChange > 0 ? 'buying' : netChange < 0 ? 'selling' : 'flat',
    netChange,
    longChange,
    shortChange,
    // Zero net is nobody's existing bet, so it cannot be moved against.
    againstPosition: latest.specNet !== 0 && Math.sign(netChange) !== Math.sign(latest.specNet),
    flipped: netBefore !== 0 && Math.sign(latest.specNet) !== Math.sign(netBefore),
    oiConfirms:
      latest.openInterestChange === null
        ? false
        : kind === 'liquidation'
          ? latest.openInterestChange < 0
          : latest.openInterestChange > 0,
    netAfter: latest.specNet,
  };

  return { ...partial, ...describe(partial) };
}

/** Every contract that has a readable week, biggest mover first. */
export function readAllCotFlows(data: Record<string, CotSeries>): CotFlow[] {
  return Object.values(data)
    .map(readCotFlow)
    .filter((f): f is CotFlow => f !== null)
    .sort((a, b) => b.percentile - a.percentile || Math.abs(b.netChange) - Math.abs(a.netChange));
}
