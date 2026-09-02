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
  /**
   * What the cell was ACTUALLY measured against, which is not always what the
   * slot asked for — see the fallback in `scoreSlot`. Callers must read this
   * rather than re-deriving it from `slot.compare`, or a cell scored off the
   * prior print will describe itself as a beat against forecast.
   */
  referenceLabel?: 'forecast' | 'previous';
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
 * Within the country, patterns are tried in order, and the first one offering a
 * candidate of the BEST AVAILABLE QUALITY wins — so the canonical series is
 * still chosen deterministically, but a pattern that matches only prints nobody
 * can score no longer blocks a sibling that has one.
 *
 * That last clause is a bug fix, not a refinement. The loop used to skip to the
 * next pattern only when a pattern matched NOTHING, so a pattern that matched
 * and then produced an unusable print returned it and stopped. New Zealand
 * retail sales is where it showed: `Electronic Card Retail Sales (MoM)` is
 * first in the list and carries no consensus on any of its four prints, so
 * `Retail Sales (QoQ)` — which does carry one — was unreachable, and the column
 * was dead for the entire NZD leg of every kiwi pair.
 */
export function resolveSeries(
  matcher: SeriesMatcher,
  currency: Currency,
  events: NormalizedEvent[],
  /** What the cell will be scored against, so an unscoreable print is skipped. */
  compare: 'forecast' | 'previous' = 'forecast',
  /**
   * The slot's freshness window, so quality can weigh age.
   *
   * Optional, and absent means "do not judge age" — which is exactly the old
   * behaviour, so a caller that does not care is not silently given a different
   * answer than before.
   */
  freshness?: { now: Date; maxAgeDays: number },
): NormalizedEvent | null {
  const patterns = matcher.matchByCurrency?.[currency] ?? matcher.match ?? [];
  if (patterns.length === 0) return null;

  const country = PRIMARY_COUNTRY[currency];
  const pool = events.filter(
    (e) => e.currency === currency && e.actual !== null && (e.countryCode ?? country) === country,
  );

  const newest = (list: NormalizedEvent[]) =>
    list.reduce((best, e) => (e.dateUtc > best.dateUtc ? e : best));

  const referenceOf = (e: NormalizedEvent) => (compare === 'previous' ? priorPrint(e) : e.consensus);

  const hasReference = (e: NormalizedEvent) => referenceOf(e) !== null;

  /**
   * The best print ONE pattern can offer: THE MOST RECENT SCOREABLE ONE, and
   * failing that simply the most recent.
   *
   *  1. any non-null forecast — measurable;
   *  2. anything released — unscoreable, but the card still shows the series and
   *     says why it is blank rather than omitting the row.
   *
   * Tier 1 earned its place: UK core PPI's latest entry carries no consensus,
   * and taking it dropped GBPUSD's PPI to a USD-only reading.
   *
   * THERE USED TO BE A TIER ABOVE BOTH, AND IT WAS REMOVED ON EVIDENCE.
   *
   * The rule was: prefer the most recent INFORMATIVE print — one whose forecast
   * differs from the prior print — reaching back up to REVISION_WINDOW_DAYS to
   * find it. The reasoning was good and is still worth reading, because it is
   * the reasoning anyone will reconstruct before trying this again:
   * `consensus === previous` is a survey that was never taken, so a confirming
   * revision scores a confident 0 about a period that did in fact beat forecast.
   * The euro area publishes a flash and then revisions of the same quarter, and
   * 31% of EUR releases carry consensus === actual against 7% for CAD:
   *
   *   30 Jul  GDP s.a. (QoQ)  actual 0.4  consensus 0.2  <- the flash, a beat
   *   14 Aug  GDP s.a. (QoQ)  actual 0.4  consensus 0.4  <- the revision, silent
   *
   * A1 SCORES THE REVISION. Their 2026-08-23 EURUSD card publishes an Economic
   * Growth subtotal of 5 over five rows, and with the dollar's legs known
   * exactly from their US-DOLLAR card that subtotal reconciles ONLY if the euro
   * GDP leg is 0 — the 14 Aug reading. At +1, the flash reading, their own
   * published subtotal would have to be 6.
   *
   * Measured against that capture, three runs each: TOTAL ABS GAP 96 -> 92,
   * exact rows 7 -> 9. `npm run legs` confirms the change is confined to where
   * the comment above always said it lived: EUR moves +2 -> +1 and every other
   * currency's macro total is untouched, because the euro area is the only
   * economy that revises inside three weeks.
   *
   * So the removed rule was a better read of the world and a worse model of
   * theirs, which is the trade this codebase has already decided (see the
   * `scoring` flag and the absolute bias bands). If a future capture shows them
   * scoring a flash over its revision, this is the function to change and the
   * measurement to re-run.
   */
  const pickWithin = (matches: NormalizedEvent[]): NormalizedEvent => {
    const scoreable = matches.filter(hasReference);
    return newest(scoreable.length > 0 ? scoreable : matches);
  };

  const isFresh = (e: NormalizedEvent) =>
    freshness === undefined || ageInDays(e.dateUtc, freshness.now) <= freshness.maxAgeDays;

  /**
   * How good a pattern's offering is, lower being better.
   *
   * FRESHNESS OUTRANKS SCOREABILITY, and the order is the whole design:
   *
   *   0  fresh and scoreable      what every column wants
   *   1  fresh, no forecast       still describes the world as it is now, and
   *                               `scoreSlot` can read it against its previous
   *                               print rather than throwing it away
   *   2  stale but scoreable      a real surprise, about a month that has ended
   *   3  stale and unscoreable    kept only so the card can name the series
   *
   * Putting 2 above 1 was tried and is wrong. New Zealand retail sales offers a
   * fresh Electronic Card print with no forecast against a quarterly Retail
   * Sales print carrying one but 90 days old, past its 75-day window. Preferring
   * the quarterly hands `scoreSlot` a print it must then reject as stale, so the
   * column stays blank AND the fresher reading is discarded. The staleness
   * windows exist to say a number that old no longer describes anything.
   */
  const rank = (e: NormalizedEvent) => (isFresh(e) ? 0 : 2) + (hasReference(e) ? 0 : 1);

  let best: NormalizedEvent | null = null;
  for (const pattern of patterns) {
    const matches = pool.filter((e) => pattern.test(e.name));
    if (matches.length === 0) continue;

    const candidate = pickWithin(matches);
    // Strictly better only, so ties fall to the earlier pattern and the ordered
    // preference list keeps meaning what it says.
    if (best === null || rank(candidate) < rank(best)) best = candidate;
  }

  return best;
}

/**
 * The freshness window for one slot and one currency.
 *
 * Cadence is a property of the country, not the indicator — New Zealand's
 * retail sales is quarterly where everyone else's is monthly — so the per-slot
 * default can be overridden per currency. Everything that judges staleness must
 * go through here, or `resolveSeries` picks a print that `scoreSlot` then
 * rejects and the column goes blank for a reason neither of them reports.
 */
export function maxAgeFor(slot: SlotDefinition, currency: Currency): number {
  return slot.maxAgeDaysByCurrency?.[currency] ?? slot.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
}

/**
 * The prior print, AS IT STANDS TODAY rather than as it was first announced.
 *
 * Every calendar release carries two versions of last period's number: the
 * value originally published, and — where the agency has since restated it —
 * the revision. FXStreet exposes both, `previous` and `revised`; TradingView
 * exposes only one, and the one it exposes is the revised value. That is not a
 * quirk of either vendor, it is what a revision MEANS: after it, last month's
 * figure is the new number and the old one is history.
 *
 * BusinessNZ's PSI is the case that forced this, and it is a clean one because
 * every other input agrees:
 *
 *   2026-08-16   actual 50.6   previous 50.6   revised 50.9
 *
 * Against the announced 50.6 the print is FLAT and scores 0. Against the
 * restated 50.9 it FELL and scores -1. A1's 2026-08-25 board carries -1, and
 * TradingView's `previous` column for that release reads 50.9.
 *
 * Only reachable where the comparison is against the prior print at all — a
 * forecast-based comparison never touches this, and a revision cannot change a
 * consensus that was published before it.
 */
export function priorPrint(event: NormalizedEvent): number | null {
  return event.revised ?? event.previous;
}

/**
 * What this slot is measured against FOR THIS CURRENCY.
 *
 * Defaults to the slot's own rule and therefore to `forecast`. The per-currency
 * override exists because forecast coverage differs between calendars — see
 * `compareByCurrency` in the slot config for the evidence and the warning that
 * goes with it.
 *
 * Note this is the INTENDED basis, not necessarily the one used: where the
 * intent is `forecast` and no consensus exists, `scoreSlot` still falls back to
 * the prior print, which is A1's rule.
 */
export function compareFor(slot: SlotDefinition, currency: Currency): 'forecast' | 'previous' {
  return slot.compareByCurrency?.[currency] ?? slot.compare ?? 'forecast';
}

export function resolveSlotEvent(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
  /**
   * Omitted means age is not weighed when choosing between patterns, matching
   * how this behaved before `resolveSeries` learned about freshness. `scoreSlot`
   * always passes it; the tests that pin the tier rules deliberately do not.
   */
  now?: Date,
): NormalizedEvent | null {
  if (slot.kind !== 'economic') return null;
  return resolveSeries(
    slot,
    currency,
    events,
    compareFor(slot, currency),
    now === undefined ? undefined : { now, maxAgeDays: maxAgeFor(slot, currency) },
  );
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

  const event = resolveSlotEvent(slot, currency, events, now);
  if (!event) {
    return { ...base, status: 'no-data', explanation: `No ${slot.label} data for ${currency}` };
  }

  const age = ageInDays(event.dateUtc, now);
  const maxAge = maxAgeFor(slot, currency);

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
   * What the print is measured against, and what to do when that is missing.
   *
   * `forecast` is the default and wants a consensus. Where one exists nothing
   * below changes: "above what the market expected" remains a strictly stronger
   * claim than "above last month", and every column that can make it still does.
   *
   * WHERE NO FORECAST EXISTS, READ THE DIRECTION OFF THE PRIOR PRINT.
   *
   * This is A1's rule, not an approximation of it. Their per-country economic
   * heatmaps publish a Surprise column beside Actual, Forecast and Previous, and
   * wherever Forecast is blank the Surprise is exactly `actual − previous`:
   *
   *   NZ  Manufacturing PMI   56.1 − 51.4 = 4.7
   *   NZ  Services PMI        51.5 − 46.9 = 4.6
   *   JP  Services PMI        53.9 − 49.4 = 4.5
   *   AU  PPI YoY              3.5 −  3.4 = 0.1
   *
   * The category it serves is permanent rather than a gap waiting to be filled:
   * BusinessNZ's PMI and PSI carry a consensus on none of FXStreet, TradingView
   * or ForexFactory, because no privately-run survey in New Zealand or Australia
   * is polled ahead of time — only the official statistical agencies are.
   * Holding out for a forecast that will never come left four of New Zealand's
   * macro columns scoring nothing at all.
   *
   * IT WAS TRIED ONCE BEFORE AND REVERTED, on a measurement that moved parity
   * from 48 to 54. That measurement was confounded, and the confound is now
   * removed: the six rows that got worse were all NZD or AUD, and most of the
   * damage came from two legs A1 does not have at all — Westpac and ANZ-Roy
   * Morgan consumer confidence, which their heatmaps carry no row for. Those
   * series are gone (see the consumer-confidence slot), and New Zealand's retail
   * column now resolves to the quarterly Stats NZ series they actually use.
   *
   * REMOVING IT WAS TRIED AGAIN ON 2026-08-21 AND IS SETTLED. TOTAL ABS GAP fell
   * 63 -> 57, which looks like a win until the rows are read: 9 improved and 5
   * got worse, and they split perfectly along the line this comment draws.
   * Everything that improved was a JPY row (JPYX, JP225, USDJPY, CHFJPY, AUDJPY,
   * GBPJPY) and improved for the WRONG reason — A1 has a forecast for Jibun Bank
   * Services PMI that our calendars do not carry, so blanking the cell moved us
   * toward their -1 by accident, from +1 to 0 rather than to -1. Everything that
   * got worse was NZD (GBPNZD, NZDCAD, NZDJPY), where A1 genuinely has no
   * forecast and reads the prior print exactly as the cards above show.
   *
   * So the six points were bought by breaking the rule where it is right in order
   * to paper over a data gap where it is not the problem. The gap to close is
   * consensus coverage for the JP flash PMIs — the flash prints carry an actual
   * and no forecast, while the following month's final carries a forecast and no
   * actual, and ForexFactory's backfill lends 0 of the 69 rows it offers.
   *
   * Where a forecast DOES exist nothing here changes. "Above what the market
   * expected" remains a strictly stronger claim than "above last month", and the
   * cell records which basis it used so the card can say so rather than letting a
   * reader assume.
   *
   * `previous` as a slot-level setting is a different thing: there it is the
   * intended rule rather than a fallback, and it is left alone.
   */
  const againstPrevious = compareFor(slot, currency) === 'previous';
  let reference = againstPrevious ? priorPrint(event) : event.consensus;
  let referenceLabel: 'forecast' | 'previous' = againstPrevious ? 'previous' : 'forecast';

  if ((reference === null || reference === undefined) && !againstPrevious) {
    reference = priorPrint(event);
    referenceLabel = 'previous';
  }

  if (reference === null || reference === undefined || event.actual === null) {
    return {
      ...base,
      event,
      ageDays: Math.round(age),
      status: 'not-released',
      // Nothing to compare against at all — no forecast AND no prior print.
      explanation: `${event.name}: no forecast or previous print to compare against`,
    };
  }

  // Sigma no longer drives the cell, but it is still the most informative thing
  // to show a reader, so it is computed and carried through.
  const surprise = computeSurprise(event, reference);

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
    referenceLabel,
    explanation:
      `${event.name}: ${event.actual}${event.unit ?? ''} vs ${reference}${event.unit ?? ''} ${referenceLabel}` +
      sigmaNote +
      (polarity === -1 ? ', inverted — higher is bearish here' : '') +
      // A cell built on last month's print is a weaker claim than one built on a
      // forecast, and must not read the same.
      (referenceLabel === 'previous' && !againstPrevious
        ? ' — no forecast is published for this series, so the direction is read against the prior print'
        : ''),
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
  const maxAge = maxAgeFor(slot, currency);
  const polarity = slot.polarity ?? 1;
  const againstPrevious = compareFor(slot, currency) === 'previous';

  const scored: ComponentResult[] = [];
  let sawStale = false;

  for (const component of slot.components ?? []) {
    const event = resolveSeries(component, currency, events, compareFor(slot, currency), {
      now,
      maxAgeDays: maxAge,
    });
    if (!event || event.actual === null) continue;

    if (ageInDays(event.dateUtc, now) > maxAge) {
      sawStale = true;
      continue;
    }

    const reference = againstPrevious ? priorPrint(event) : event.consensus;
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
