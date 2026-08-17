/**
 * Event-name classification.
 *
 * EVENT_RULES is an ORDERED list and the first pattern to match wins, so adding
 * a rule can silently steal names from an existing one. This suite pins real
 * names taken from two years of live FXStreet data against their expected rule.
 *
 * It has already earned its place twice:
 *   - "ADP Employment Change" was being classified as `nfp`, because it contains
 *     the words "employment change" and the broader nfp pattern sat first.
 *   - "ECB Rate On Deposit Facility" matched nothing, so every euro policy
 *     decision scored as `unclassified` at 0.3 weight with a confidence penalty.
 *
 * Both are the kind of bug that produces plausible-looking numbers rather than
 * an error, which is exactly why they need a test rather than a spot check.
 */

import { describe, expect, it } from 'vitest';
import { EVENT_RULES, matchEventRule } from '@/config/scoring.config';
import { PRIMARY_COUNTRY, SLOTS } from '@/config/setups.config';
import {
  ALL_SYMBOLS,
  CURRENCY_COT_CONTRACT,
  FX_SYMBOLS,
  MINOR_FX_SYMBOLS,
  findSymbol,
  streamTicker,
  tradingViewSymbol,
} from '@/config/symbols.config';
import { MAJORS, isMajor } from '@/lib/types';

/** [event name as it appears in the feed, expected rule key] */
const CLASSIFICATIONS: [string, string][] = [
  // PMI split — manufacturing and services must not collapse into the generic rule
  ['ISM Manufacturing PMI', 'mpmi'],
  ['HCOB Manufacturing PMI', 'mpmi'],
  ['Jibun Bank Manufacturing PMI', 'mpmi'],
  ['Business NZ PMI', 'mpmi'],
  ['ISM Services PMI', 'spmi'],
  ['HCOB Services PMI', 'spmi'],
  ['Business NZ PSI', 'spmi'],
  ['Ivey Purchasing Managers Index', 'pmi'],

  // Inflation
  ['Consumer Price Index (YoY)', 'cpi'],
  ['Harmonized Index of Consumer Prices (YoY)', 'cpi'],
  ['National Consumer Price Index (YoY)', 'cpi'],
  ['Producer Price Index (YoY)', 'ppi'],
  ['Core Personal Consumption Expenditures - Price Index (YoY)', 'pce'],
  ['KOF Leading Indicator', 'inflation-gauge'],

  // Labour — ordering-sensitive
  ['ADP Employment Change', 'adp'],
  ['Nonfarm Payrolls', 'nfp'],
  ['Net Change in Employment', 'nfp'],
  ['Employment Level (QoQ)', 'nfp'],
  ['Jobs / Applicants Ratio', 'jobs-applicants-ratio'],
  ['Unemployment Rate', 'unemployment-rate'],
  ['ILO Unemployment Rate (3M)', 'unemployment-rate'],
  ['Unemployment Rate s.a (MoM)', 'unemployment-rate'],
  ['Initial Jobless Claims', 'jobless-claims'],
  ['JOLTS Job Openings', 'job-openings'],

  // Growth
  ['Gross Domestic Product (QoQ)', 'gdp'],
  ['Gross Domestic Product s.a. (QoQ)', 'gdp'],
  ['Retail Sales (MoM)', 'retail-sales'],
  ['Retail Trade (YoY)', 'retail-sales'],
  ['Electronic Card Retail Sales  (MoM)', 'retail-sales'],
  ['Real Retail Sales (YoY)', 'retail-sales'],
  ['Consumer Confidence', 'confidence-survey'],
  ['Westpac Consumer Confidence', 'confidence-survey'],
  ['Michigan Consumer Sentiment Index', 'confidence-survey'],

  // Central bank — the ECB names its rates after the facility, not the decision
  ['Fed Interest Rate Decision', 'rate-decision'],
  ['RBA Interest Rate Decision', 'rate-decision'],
  ['ECB Rate On Deposit Facility', 'rate-decision'],
  ['ECB Main Refinancing Operations Rate', 'rate-decision'],
];

describe('matchEventRule', () => {
  it.each(CLASSIFICATIONS)('classifies %j as %s', (name, expected) => {
    expect(matchEventRule(name).key).toBe(expected);
  });

  it('has no duplicate rule keys', () => {
    const keys = EVENT_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('places ADP before NFP, since ADP names contain "employment change"', () => {
    const adp = EVENT_RULES.findIndex((r) => r.key === 'adp');
    const nfp = EVENT_RULES.findIndex((r) => r.key === 'nfp');
    expect(adp).toBeGreaterThanOrEqual(0);
    expect(adp).toBeLessThan(nfp);
  });

  it('places the specific PMI rules before the generic one', () => {
    const generic = EVENT_RULES.findIndex((r) => r.key === 'pmi');
    expect(EVENT_RULES.findIndex((r) => r.key === 'mpmi')).toBeLessThan(generic);
    expect(EVENT_RULES.findIndex((r) => r.key === 'spmi')).toBeLessThan(generic);
  });
});

describe('setups config', () => {
  it('covers every major currency with a primary country', () => {
    for (const c of MAJORS) expect(PRIMARY_COUNTRY[c]).toBeTruthy();
  });

  it('has unique slot keys', () => {
    const keys = SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every economic slot a polarity and at least one pattern', () => {
    const hasPatterns = (m: { match?: RegExp[]; matchByCurrency?: object }) =>
      (m.match?.length ?? 0) > 0 || Object.keys(m.matchByCurrency ?? {}).length > 0;

    for (const slot of SLOTS.filter((s) => s.kind === 'economic')) {
      expect(slot.polarity, `${slot.key} polarity`).toBeDefined();

      // A composite slot (PMI) carries its patterns on its components instead.
      if (slot.components) {
        expect(slot.components.length, `${slot.key} components`).toBeGreaterThan(0);
        for (const component of slot.components) {
          expect(hasPatterns(component), `${slot.key}.${component.key} patterns`).toBe(true);
        }
      } else {
        expect(hasPatterns(slot), `${slot.key} patterns`).toBe(true);
      }
    }
  });

  it('does not give non-economic slots a polarity', () => {
    for (const slot of SLOTS.filter((s) => s.kind !== 'economic')) {
      expect(slot.polarity).toBeUndefined();
    }
  });
});

describe('symbols config', () => {
  it('builds all 28 unique major pairs', () => {
    /**
     * The cross product, measured on its own rather than on FX_SYMBOLS.
     *
     * FX_SYMBOLS now also carries hand-listed minors, and asserting a flat
     * total would turn "one more minor pair" into a failing test with nothing
     * wrong. What must not drift is that the eight majors still produce exactly
     * their 28 combinations and no duplicates.
     */
    const crosses = FX_SYMBOLS.filter(
      (s) => isMajor(s.base) && isMajor(s.quote),
    );
    expect(crosses).toHaveLength(28);
    expect(new Set(crosses.map((s) => s.symbol)).size).toBe(28);
  });

  it('lists every minor pair by hand rather than crossing it', () => {
    // A minor in MAJORS would silently create seven more pairs against it.
    for (const s of MINOR_FX_SYMBOLS) {
      expect(isMajor(s.base) && isMajor(s.quote), s.symbol).toBe(false);
      expect(FX_SYMBOLS).toContain(s);
    }
  });

  it('maps every currency with a scored leg to a COT contract', () => {
    // A pair whose leg has no contract gets a silently empty COT cell rather
    // than an error, so this is the only place that catches it.
    for (const s of FX_SYMBOLS) {
      expect(CURRENCY_COT_CONTRACT[s.base!], s.base).toBeTruthy();
      expect(CURRENCY_COT_CONTRACT[s.quote!], s.quote).toBeTruthy();
    }
  });

  it('never pairs a currency with itself', () => {
    for (const s of FX_SYMBOLS) expect(s.base).not.toBe(s.quote);
  });

  it('has no duplicate symbols across the whole universe', () => {
    const symbols = ALL_SYMBOLS.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('gives every symbol a Yahoo ticker', () => {
    for (const s of ALL_SYMBOLS) expect(s.yahoo, s.symbol).toBeTruthy();
  });

  it('maps every major currency to a COT contract', () => {
    for (const c of MAJORS) expect(CURRENCY_COT_CONTRACT[c], c).toBeTruthy();
  });

  /**
   * The copper bug, generalised.
   *
   * `tradingViewSymbol` falls through to `FX:${symbol}` for FX and to the bare
   * symbol for everything else. That fallback is right for the 36 FX pairs and
   * wrong for every non-FX row, because our tickers — XCUUSD, XAUUSD, SPX500 —
   * are our own invention and TradingView has never heard of them. Copper shipped
   * without an entry and the widget came up blank with nothing on screen saying
   * why, because an unresolvable ticker is not an error there.
   */
  /**
   * The streaming aliases.
   *
   * Yahoo's socket ACCEPTS a subscription to `USDJPY=X` and then never sends a
   * frame for it — measured at zero over 40 seconds against 39 for `JPY=X`. So
   * the failure this guards is not an error anywhere; it is USDJPY, USDCHF and
   * USDCAD quietly staying on the 15-second poll while every other pair
   * streams, which looks exactly like nothing being wrong.
   */
  it('strips the USD from USD-base pairs, which is the only name that ticks', () => {
    const streamOf = (symbol: string) => streamTicker(findSymbol(symbol)!);

    expect(streamOf('USDJPY')).toBe('JPY=X');
    expect(streamOf('USDCHF')).toBe('CHF=X');
    expect(streamOf('USDCAD')).toBe('CAD=X');

    // Only when USD is the BASE. Everything else keeps its own ticker.
    expect(streamOf('EURUSD')).toBe('EURUSD=X');
    expect(streamOf('GBPUSD')).toBe('GBPUSD=X');
    expect(streamOf('EURGBP')).toBe('EURGBP=X');
  });

  it('does not offer a socket for the futures that never send one', () => {
    // GC=F, SI=F, CL=F and HG=F all accept the subscription and stay silent;
    // they are ten minutes delayed over REST and a socket does not change that.
    for (const symbol of ['XAUUSD', 'XAGUSD', 'WTIUSD', 'XCUUSD', 'EURX']) {
      expect(streamTicker(findSymbol(symbol)!), symbol).toBeNull();
    }

    // Cash indices and the dollar index DO stream, during their own session.
    expect(streamTicker(findSymbol('UK100')!)).toBe('^FTSE');
    expect(streamTicker(findSymbol('DXY')!)).toBe('DX-Y.NYB');
  });

  it('never maps two symbols onto one stream ticker', () => {
    // The tick fan-out is keyed by feed ticker, so a collision would deliver
    // one market's price to another market's row.
    const seen = new Map<string, string>();
    for (const s of ALL_SYMBOLS) {
      const ticker = streamTicker(s);
      if (!ticker) continue;
      expect(seen.has(ticker), `${ticker} claimed by both ${seen.get(ticker)} and ${s.symbol}`).toBe(
        false,
      );
      seen.set(ticker, s.symbol);
    }
  });

  it('gives every non-FX symbol an explicit TradingView ticker', () => {
    for (const s of ALL_SYMBOLS) {
      if (s.kind === 'fx') continue;
      expect(
        tradingViewSymbol(s),
        `${s.symbol} falls through to a ticker TradingView cannot resolve`,
      ).toMatch(/^[A-Z0-9_]+:/);
    }
  });
});
