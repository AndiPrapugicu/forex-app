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
import { ALL_SYMBOLS, CURRENCY_COT_CONTRACT, FX_SYMBOLS } from '@/config/symbols.config';
import { MAJORS } from '@/lib/types';

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
    for (const slot of SLOTS.filter((s) => s.kind === 'economic')) {
      expect(slot.polarity, `${slot.key} polarity`).toBeDefined();
      const hasPatterns = (slot.match?.length ?? 0) > 0 || Object.keys(slot.matchByCurrency ?? {}).length > 0;
      expect(hasPatterns, `${slot.key} patterns`).toBe(true);
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
    expect(FX_SYMBOLS).toHaveLength(28);
    const symbols = FX_SYMBOLS.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(28);
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
});
