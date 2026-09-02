/**
 * The Crowd Sentiment column, resolved PER SYMBOL.
 *
 * A1's crowd cell is a retail long/short percentage for the instrument itself,
 * read contrarian. It is never a difference between two currencies, and their
 * own published rows prove that rather than suggest it: their US-DOLLAR row
 * scores crowd +1 and their EURUSD row ALSO scores crowd +1. Under a
 * differenced rule EURUSD would be `EUR - USD = EUR - 1`, which cannot reach +1
 * from any leg in {-1, 0, +1}. No differenced model produces both numbers; a
 * per-symbol one produces them trivially.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM cot.ts. `scoreCrowd` there answers
 * "what does this CONTRACT's small-trader share say". This answers "what is
 * this SYMBOL's crowd cell", which is a different question the moment a symbol
 * has no contract of its own. Keeping them apart is what stops the fallback
 * chain below from being re-derived inline at each call site — it was, and the
 * three copies disagreed about crosses.
 *
 * THE RESOLUTION ORDER, most direct first:
 *
 *   1. A retail positioning feed keyed by symbol. This is A1's actual measure
 *      and the only one that covers a cross. No such provider ships in this
 *      repo today (see RetailPositioningFeed), so this rung is normally empty —
 *      it exists so that adding one is a connector plus a wire-up, not a
 *      rewrite of the scoring layer.
 *   2. The symbol's own futures contract. Gold, the indices, the currency
 *      indices and every DOLLAR pair have one: the CME currency futures ARE the
 *      dollar pairs, so EURO FX small traders are positioned IN EURUSD, and the
 *      yen contract is USDJPY upside down.
 *   3. Nothing. A cross has no contract and no feed, so it has no cell.
 *
 * RUNG 3 REPLACED A DIFFERENCE, DELIBERATELY. Crosses used to score
 * `crowd(base) - crowd(quote)` — retail positioning in EURUSD minus retail
 * positioning in CHFUSD, which is not sentiment in EURCHF and has no instrument
 * behind it. It is the same construct the dollar-pair carve-out already
 * rejected ("nobody trades the euro against the dollar index"); crosses only
 * kept it because a contract was assumed to be the sole possible source, which
 * A1's own broker-fed cross values disprove. Measured on their 2026-08-24
 * Top Setups row for EURCHF: they score +1, the difference scored -1, and an
 * honest blank scores 0. A blank is not as good as the feed — it is better than
 * a number with nothing under it.
 */

import { CROWD_LONG_PCT_BUCKETS } from '@/config/setups.config';
import { CURRENCY_COT_CONTRACT, type SymbolDefinition } from '@/config/symbols.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import { scoreCrowd } from '@/lib/scoring/cot';
import { normalizeZero } from '@/lib/scoring/discrete';

/**
 * One instrument's retail positioning, as a broker-aggregate feed reports it.
 *
 * `longPct` is the share of open retail positions that are LONG the symbol as
 * named — 25 means a quarter of retail is long, which reads +1 contrarian.
 *
 * NO PROVIDER SHIPS THIS TODAY. A1's own numbers match FXSSI's broker
 * aggregate closely enough to be the same population, and Myfxbook's
 * `get-community-outlook` and OANDA's position book expose an equivalent, but
 * all three need either a key or a scrape and none is a production-safe
 * dependency this repo has accepted. The type is here so the scoring layer is
 * already shaped for one; it is not evidence that one exists.
 */
export interface RetailPositioning {
  symbol: string;
  /** Share of open retail positions that are long, 0..100. */
  longPct: number;
  /**
   * Share that is short, as the provider reported it.
   *
   * CARRIED, NOT DERIVED, and never read by the scorer. Every provider surveyed
   * publishes both halves and every one of them sums to 100, so a value here
   * that does not complement `longPct` means the provider changed shape or the
   * parse is wrong — which is worth being able to see at the edge. `longPct`
   * stays the single field the rule reads, so there is exactly one number a
   * cell can depend on.
   */
  shortPct?: number;
  source: string;
  /** ISO date, so staleness against a weekly COT fallback stays visible. */
  observedAt: string;
}

export type RetailPositioningFeed = Map<string, RetailPositioning>;

/**
 * Which rung of the resolution order produced a crowd cell.
 *
 * NAMED AND EXPORTED because it travels: `own-contract` means the cell was
 * measured on a WEEKLY CME FUTURES population where A1's column is a DAILY
 * RETAIL SPOT book. That is a methodology substitution, not a rounding
 * difference, and anything reading the number downstream has to be able to see
 * it without parsing an explanation string.
 */
export type CrowdBasis = 'retail-feed' | 'own-contract' | 'none';

export interface CrowdCell {
  cell: number | null;
  status: 'scored' | 'no-data';
  /**
   * Which rung of the resolution order produced this. Carried so a parity run
   * can separate "we read a different population" from "we read a different
   * instrument" without re-deriving the branch.
   */
  basis: CrowdBasis;
  explanation: string;
}

/**
 * Retail long share -> cell, INVERTED.
 *
 * The sign flip is the whole point: a crowd leaning long is read as bearish.
 * The inversion lives in the bucket mapping rather than in a negation, so the
 * thresholds stay readable against A1's published 40/60 bands.
 */
export function scoreRetailLongPct(longPct: number): number {
  if (longPct >= CROWD_LONG_PCT_BUCKETS.bearish) return -1;
  if (longPct <= CROWD_LONG_PCT_BUCKETS.bullish) return 1;
  return 0;
}

/**
 * The single CFTC contract a pair IS, when one exists, and which way up.
 *
 * Every CME currency future is quoted CUR/USD, so a dollar pair maps onto
 * exactly one of them: EURUSD is EURO FX the right way up, and USDJPY is the
 * yen contract upside down — long yen futures is short USDJPY.
 *
 * The non-USD leg is looked up in `CURRENCY_COT_CONTRACT` first and falls back
 * to the symbol's own `cotContract`, which is what lets USDZAR resolve: the
 * rand has no entry in the majors table but the symbol carries
 * `SO AFRICAN RAND` directly, and that contract is ZARUSD — USDZAR inverted.
 *
 * Null for a cross. There is no EURJPY contract, and building one out of two
 * others is exactly the difference this module exists to stop.
 */
export function pairContract(def: SymbolDefinition): { name: string; sign: 1 | -1 } | null {
  if (def.kind !== 'fx' || !def.base || !def.quote) return null;

  if (def.quote === 'USD') {
    const name = CURRENCY_COT_CONTRACT[def.base] ?? def.cotContract;
    return name ? { name, sign: 1 } : null;
  }
  if (def.base === 'USD') {
    const name = CURRENCY_COT_CONTRACT[def.quote] ?? def.cotContract;
    return name ? { name, sign: -1 } : null;
  }
  return null;
}

/**
 * A currency-index row's retail read, taken from that currency's DOLLAR PAIR.
 *
 * MEASURED, NOT ASSUMED. A1's free Retail Sentiment dashboard
 * (a1trading.com/retail-sentiment/, report cfd37bd1-45ce-459a-8d11-b6b7eac72b0d)
 * publishes a "Currencies" category alongside its pairs, and on 2026-08-29 every
 * one of the seven non-dollar index rows was EXACTLY its own dollar pair, the
 * right way up or upside down:
 *
 *   GB-POUND  50     = GBPUSD 50            CA-DOLLAR 58 = 100 - USDCAD 42
 *   NZ-DOLLAR 48     = NZDUSD 48            JP-YEN    56 = 100 - USDJPY 44
 *   EURO      47     = EURUSD 47            CH-FRANC  39 = 100 - USDCHF 61
 *   AU-DOLLAR 28     = AUDUSD 28
 *
 * Four identities and three complements, eight rows for eight, to the point.
 *
 * US-DOLLAR IS THE EXCEPTION AND IS EXCLUDED. It read 92.51% on the same
 * screen — a two-decimal value like their index and CFD rows, not a whole
 * integer like every FX row — which no dollar pair produces. The dollar index
 * has its own instrument and its own book, so DXY must not be derived here.
 * That also answers a question `EdgeFinder-scoring-diagnosis.md` had left open:
 * how their DXY row reaches a crowd cell at all.
 *
 * INERT UNTIL A FEED EXISTS. With no retail provider configured this returns
 * null and every index row falls through to the CFTC contract read exactly as
 * before — which is the same SHAPE (a CME currency future is quoted CUR/USD, so
 * it is the dollar pair) over a different population.
 */
function indexFromDollarPair(
  def: SymbolDefinition,
  feed: RetailPositioningFeed,
): { longPct: number; via: string; source: string; observedAt: string } | null {
  if (def.kind !== 'currency' || def.base || !def.macroEconomy) return null;
  if (def.macroEconomy === 'USD') return null; // the dollar index has its own book

  const currency = def.macroEconomy;
  const direct = feed.get(`${currency}USD`);
  if (direct) {
    return { longPct: direct.longPct, via: `${currency}USD`, source: direct.source, observedAt: direct.observedAt };
  }
  const inverted = feed.get(`USD${currency}`);
  if (inverted) {
    return {
      longPct: 100 - inverted.longPct,
      via: `USD${currency}`,
      source: inverted.source,
      observedAt: inverted.observedAt,
    };
  }
  return null;
}

/**
 * The crowd cell for one symbol.
 *
 * Never differences two currencies. Where no direct read exists the cell is
 * null, and `basis: 'none'` says which of the two reasons applies.
 */
export function resolveCrowd(
  def: SymbolDefinition,
  cot: Map<string, CotSeries>,
  feed?: RetailPositioningFeed,
): CrowdCell {
  // 1. A per-symbol retail feed is A1's own measure, so it wins outright.
  const retail = feed?.get(def.symbol);
  if (retail) {
    return {
      cell: normalizeZero(scoreRetailLongPct(retail.longPct)),
      status: 'scored',
      basis: 'retail-feed',
      explanation:
        `${retail.longPct.toFixed(1)}% of retail is long ${def.symbol} ` +
        `(${retail.source}, ${retail.observedAt}), read contrarian.`,
    };
  }

  /**
   * 1b. A currency index, read off its own dollar pair in that same feed.
   *
   * No retail provider will ever carry a key called `GBPX`, so rung 1 can never
   * fire for an index row and it would fall through to CFTC even with a feed
   * configured and the answer sitting one lookup away. See
   * `indexFromDollarPair` for the eight-for-eight measurement behind this.
   */
  const derived = feed ? indexFromDollarPair(def, feed) : null;
  if (derived) {
    return {
      cell: normalizeZero(scoreRetailLongPct(derived.longPct)),
      status: 'scored',
      basis: 'retail-feed',
      explanation:
        `${derived.longPct.toFixed(1)}% of retail is long ${def.macroEconomy} ` +
        `(read off ${derived.via}${derived.via.startsWith('USD') ? ', inverted' : ''}; ` +
        `${derived.source}, ${derived.observedAt}), read contrarian.`,
    };
  }

  // 2. The symbol's own contract: a standalone asset, or a dollar pair that IS
  //    one of the CME currency futures.
  const direct =
    def.cotContract && !def.base
      ? { name: def.cotContract, sign: 1 as const }
      : pairContract(def);

  if (direct) {
    const score = scoreCrowd(cot.get(direct.name));
    if (score) {
      return {
        cell: normalizeZero(score.cell * direct.sign),
        status: 'scored',
        basis: 'own-contract',
        explanation:
          `${direct.name}: ${score.explanation}` +
          (direct.sign === -1
            ? `  |  inverted — the contract is quoted against the dollar, ${def.symbol} the other way up`
            : ''),
      };
    }
    return {
      cell: null,
      status: 'no-data',
      basis: 'none',
      explanation: `No COT data for ${direct.name}`,
    };
  }

  // 3. A cross. See the module header: a difference here would be a number with
  //    no instrument under it, so this stays blank until a feed fills rung 1.
  return {
    cell: null,
    status: 'no-data',
    basis: 'none',
    explanation:
      `No retail positioning source for ${def.symbol}. A cross has no futures contract of its ` +
      `own, and differencing ${def.base ?? '—'} against ${def.quote ?? '—'} would measure two ` +
      `dollar pairs rather than this one.`,
  };
}
