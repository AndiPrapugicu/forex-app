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
  DEFAULT_MAX_AGE_DAYS,
  REVISION_WINDOW_DAYS,
  PAIR_CELL_MAX,
  PAIR_CELL_MIN,
  PRIMARY_COUNTRY,
  TERNARY_EPSILON,
  type SeriesMatcher,
  type SlotDefinition,
} from '@/config/setups.config';
import { computeSurprise } from '@/lib/scoring/surprise';
import type { Currency, NormalizedEvent } from '@/lib/types';

/**
 * Why a cell reads the way it does. Drives how the UI renders it.
 *
 * `partial` is the odd one out: it carries a NUMBER, not a blank. It means one
 * contributing leg was expected and did not arrive, so the value on screen is
 * built from the other leg alone. That distinction used to be invisible — a
 * failed COT contract turned EURUSD's cell from `eur − usd` into `0 − usd` and
 * still stamped it `scored`, so a transient upstream failure was indistinguishable
 * from a genuine neutral reading.
 */
export type CellStatus = 'scored' | 'partial' | 'stale' | 'no-data' | 'not-released';

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
  /** Per-sub-series detail for composite slots (PMI). Empty otherwise. */
  components?: ComponentResult[];
}

/** One sub-series of a composite slot, so PMI can show both legs. */
export interface ComponentResult {
  key: string;
  label: string;
  cell: number;
  event: NormalizedEvent;
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
export function resolveSeries(
  matcher: SeriesMatcher,
  currency: Currency,
  events: NormalizedEvent[],
  /** What the cell will be scored against, so an unscoreable print is skipped. */
  compare: 'forecast' | 'previous' = 'forecast',
): NormalizedEvent | null {
  const patterns = matcher.matchByCurrency?.[currency] ?? matcher.match ?? [];
  if (patterns.length === 0) return null;

  const country = PRIMARY_COUNTRY[currency];
  const pool = events.filter(
    (e) => e.currency === currency && e.actual !== null && (e.countryCode ?? country) === country,
  );

  const newest = (list: NormalizedEvent[]) =>
    list.reduce((best, e) => (e.dateUtc > best.dateUtc ? e : best));

  const referenceOf = (e: NormalizedEvent) => (compare === 'previous' ? e.previous : e.consensus);

  const hasReference = (e: NormalizedEvent) => referenceOf(e) !== null;

  /**
   * A forecast that says something the previous print did not.
   *
   * `consensus === previous` is a survey that was never taken: the feed carried
   * the prior reading forward into the forecast column, so "beat the forecast"
   * degenerates into "differed from last time" and a confirming revision scores
   * a confident 0. It is the same emptiness as a null consensus, wearing a
   * number — which is why it belongs next to `hasReference` rather than in a
   * caller.
   *
   * The euro area is where this bites hardest, because it publishes a flash and
   * then one or more revisions of the same reference period. Measured live:
   *
   *   30 Jul  GDP s.a. (QoQ)  actual 0.4  consensus 0.2  <- the real surprise
   *   14 Aug  GDP s.a. (QoQ)  actual 0.4  consensus 0.4  <- a confirmation
   *
   * Taking the newest scoreable print meant scoring the confirmation and
   * reporting "no news" about a quarter that had, in fact, beaten forecast.
   * Across the feed 31% of EUR releases carry consensus === actual against 15%
   * for USD and 7% for CAD, and that asymmetry was landing entirely on the euro
   * legs of every pair.
   */
  const isInformative = (e: NormalizedEvent) => {
    const ref = referenceOf(e);
    return ref !== null && e.previous !== null && ref !== e.previous;
  };

  for (const pattern of patterns) {
    const matches = pool.filter((e) => pattern.test(e.name));
    if (matches.length === 0) continue;

    /**
     * The most recent INFORMATIVE print, then the most recent scoreable one,
     * then simply the most recent.
     *
     * Each tier drops a release that cannot say what the next one can:
     *
     *  1. a real forecast that differs from the prior print — a genuine surprise
     *     is measurable against it;
     *  2. any non-null forecast — measurable, though a consensus echoing the
     *     previous reading makes the comparison weak;
     *  3. anything released — unscoreable, but the card still shows the series
     *     and says why it is blank rather than omitting the row.
     *
     * Tier 2 already earned its place: UK core PPI's latest entry carries no
     * consensus, and taking it dropped GBPUSD's PPI to a USD-only reading.
     * Tier 1 is the same argument one step further, and is what stops a euro-area
     * revision overwriting the flash that carried the actual surprise.
     */
    const scoreable = matches.filter(hasReference);
    const latest = newest(scoreable.length > 0 ? scoreable : matches);

    /**
     * Reach back for the informative print ONLY if it describes the same
     * reference period — that is, only if the newest print is a revision of it.
     *
     * Without the window this rule reaches into a previous MONTH, which is the
     * opposite of an improvement: Japan's PMIs carry a forecast equal to the
     * prior reading every month, so every one of them looked uninformative and
     * the fallback scored a stale month as though it were current. CHFJPY lost
     * eight points that way.
     *
     * Three weeks separates the two cases cleanly. A euro-area GDP revision
     * follows its flash by about a fortnight; consecutive months of any monthly
     * series are at least four weeks apart.
     */
    const informative = matches.filter(isInformative);
    if (informative.length > 0) {
      const best = newest(informative);
      const daysApart = ageInDays(best.dateUtc, new Date(latest.dateUtc));
      if (daysApart <= REVISION_WINDOW_DAYS) return best;
    }

    return latest;
  }

  return null;
}

export function resolveSlotEvent(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
): NormalizedEvent | null {
  if (slot.kind !== 'economic') return null;
  return resolveSeries(slot, currency, events, slot.compare ?? 'forecast');
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

  if (slot.components) return scoreCompositeSlot(slot, currency, events, now);

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
   * What the print is measured against.
   *
   * `forecast` is the default and needs a consensus — without one there is no
   * beat or miss to read, so the slot goes unscored rather than quietly falling
   * back to the previous print. "Above last month" is a different claim from
   * "above what the market expected".
   *
   * `previous` is PMI only, and there it is A1's actual rule rather than a
   * fallback.
   */
  const againstPrevious = slot.compare === 'previous';
  const reference = againstPrevious ? event.previous : event.consensus;
  const referenceLabel = againstPrevious ? 'previous' : 'forecast';

  if (reference === null || reference === undefined || event.actual === null) {
    return {
      ...base,
      event,
      ageDays: Math.round(age),
      status: 'not-released',
      explanation: `${event.name}: no ${referenceLabel} to compare against`,
    };
  }

  // Sigma no longer drives the cell, but it is still the most informative thing
  // to show a reader, so it is computed and carried through.
  const surprise = computeSurprise(event);

  // Polarity converts "the number went up" into "the currency should go up".
  const polarity = slot.polarity ?? 1;
  const bound = slot.maxCell ?? CELL_MAX;
  const cell = normalizeZero(
    Math.max(-bound, Math.min(bound, ternarySign(event.actual, reference) * polarity)),
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
      `${event.name}: ${event.actual}${event.unit ?? ''} vs ${reference}${event.unit ?? ''} ${referenceLabel}` +
      sigmaNote +
      (polarity === -1 ? ', inverted — higher is bearish here' : ''),
  };
}

/**
 * Scores a slot made of several sub-series.
 *
 * PMI is the only one. A1 reads manufacturing AND services under a single
 * column, so the two are scored independently and then collapsed back to a
 * single +/-1 for the currency. Collapsing by SIGN OF THE SUM means the two
 * agreeing gives +/-1 and the two disagreeing gives 0 — a currency where
 * factories are slowing while services accelerate is genuinely saying nothing.
 *
 * One missing sub-series does not void the column; the other still votes.
 */
function scoreCompositeSlot(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
  now: Date,
): SlotResult {
  const base = { slotKey: slot.key, currency, cell: null, event: null, sigma: null, ageDays: null };
  const maxAge = slot.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const polarity = slot.polarity ?? 1;
  const againstPrevious = slot.compare === 'previous';

  const scored: ComponentResult[] = [];
  let sawStale = false;

  for (const component of slot.components ?? []) {
    const event = resolveSeries(component, currency, events, slot.compare ?? 'forecast');
    if (!event || event.actual === null) continue;

    if (ageInDays(event.dateUtc, now) > maxAge) {
      sawStale = true;
      continue;
    }

    const reference = againstPrevious ? event.previous : event.consensus;
    if (reference === null || reference === undefined) continue;

    scored.push({
      key: component.key,
      label: component.label,
      cell: normalizeZero(ternarySign(event.actual, reference) * polarity),
      event,
      explanation:
        `${component.label}: ${event.actual} vs ${reference} ` +
        (againstPrevious ? 'previous' : 'forecast'),
    });
  }

  if (scored.length === 0) {
    return sawStale
      ? { ...base, status: 'stale', explanation: `${slot.label} prints are beyond the ${maxAge}-day window` }
      : { ...base, status: 'no-data', explanation: `No ${slot.label} data for ${currency}` };
  }

  const sum = scored.reduce((total, c) => total + c.cell, 0);
  const bound = slot.maxCell ?? CELL_MAX;
  const cell = normalizeZero(Math.max(-bound, Math.min(bound, Math.sign(sum))));

  // The freshest sub-series stands in as "the" event for detail views.
  const newest = scored.reduce((a, b) => (b.event.dateUtc > a.event.dateUtc ? b : a));

  return {
    slotKey: slot.key,
    currency,
    cell,
    status: 'scored',
    event: newest.event,
    sigma: null, // A composite of two series has no single meaningful sigma.
    ageDays: Math.round(ageInDays(newest.event.dateUtc, now)),
    explanation: scored.map((c) => c.explanation).join('  |  '),
    components: scored,
  };
}

/**
 * What a caller knows about one leg of a pair cell.
 *
 * `expected` is the whole point. A leg can be missing for two completely
 * different reasons and the cell must not treat them alike:
 *
 *   by design    NZD publishes no payrolls, so NZDUSD's NFP cell is the
 *                inverted USD reading and always was. Nothing failed.
 *   by failure   the EURO FX contract 404'd this run, so EURUSD's COT cell is
 *                missing its base leg. Something failed, and last run's number
 *                was built from more information than this run's.
 *
 * Only the second makes a cell `partial`. Callers set `expected` from the
 * SOURCE, not from the value — a currency present in the lookup with a null
 * score was expected and did not arrive; a currency absent from the lookup
 * entirely was never going to score.
 */
export interface PairLegState {
  /** Reported as the missing leg — a currency code. */
  label?: string;
  /** True when this leg should have resolved to a value. */
  expected?: boolean;
}

export interface PairCellResult {
  cell: number | null;
  status: CellStatus;
  /** Named when the status is 'partial'. Null otherwise. */
  missingLeg: string | null;
}

/**
 * Combines two currency legs into a pair cell.
 *
 * A missing leg counts as 0 rather than voiding the cell — dropping the cell
 * entirely would swing the score further than the failure did. Clamped because
 * two opposing ±2 legs would otherwise produce ±4.
 *
 * Without `legs` this reports `scored` exactly as before, so a caller that
 * genuinely cannot tell the two kinds of absence apart does not get to claim it
 * can.
 */
export function combinePairCells(
  baseCell: number | null,
  quoteCell: number | null,
  bound = PAIR_CELL_MAX,
  legs?: { base?: PairLegState; quote?: PairLegState },
): PairCellResult {
  if (baseCell === null && quoteCell === null) {
    return { cell: null, status: 'no-data', missingLeg: null };
  }

  const value = (baseCell ?? 0) - (quoteCell ?? 0);

  const missingLeg =
    baseCell === null && legs?.base?.expected
      ? (legs.base.label ?? 'base')
      : quoteCell === null && legs?.quote?.expected
        ? (legs.quote.label ?? 'quote')
        : null;

  return {
    cell: normalizeZero(Math.max(-bound, Math.min(bound, value))),
    status: missingLeg ? 'partial' : 'scored',
    missingLeg,
  };
}

// Re-exported so consumers importing from this module get the pair bounds too.
export { PAIR_CELL_MAX, PAIR_CELL_MIN };
