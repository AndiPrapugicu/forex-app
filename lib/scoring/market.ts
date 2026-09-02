/**
 * Cross-market reads that sit above any single symbol.
 *
 *   Risk gauge      is capital moving toward risk or toward safety right now?
 *   Smart money     are institutions and retail on opposite sides?
 *   Surprise index  is an economy beating or missing expectations lately?
 *   Strength index  which currencies are fundamentally strongest?
 *
 * The risk gauge is OUR rule set, not a reproduction. A1 ships something similar
 * but the page documenting it 404s, so rather than encode a second-hand
 * description as though it were their specification, the rules below are written
 * down here and owned.
 */

import { SCORING_SLOTS } from '@/config/setups.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import { buildCurrencyHeatmap } from '@/lib/scoring/heatmap';
import type { CurrencySlotScores } from '@/lib/scoring/setups';
import type { Currency, NormalizedEvent } from '@/lib/types';

// ---------------------------------------------------------------------------
// Risk on / risk off
// ---------------------------------------------------------------------------

/**
 * Six inputs, each ±1 against its own short average, summing to −6..+6.
 *
 * Sign convention: POSITIVE IS RISK-ON throughout. Three of the six invert,
 * because they rise when capital is running for cover — getting one of those
 * backwards silently halves the gauge's resolution, so each is stated
 * explicitly rather than derived.
 */
export const RISK_INPUTS = [
  { key: 'VIX', symbol: 'VIX', label: 'Volatility (VIX)', riskOnWhenRising: false },
  { key: 'SPX', symbol: 'SPX500', label: 'Equities (S&P 500)', riskOnWhenRising: true },
  { key: 'GOLD', symbol: 'XAUUSD', label: 'Gold', riskOnWhenRising: false },
  { key: 'US10Y', symbol: 'US10Y', label: '10-year yield', riskOnWhenRising: true },
  { key: 'DXY', symbol: 'DXY', label: 'Dollar index', riskOnWhenRising: false },
  { key: 'JPY', symbol: 'USDJPY', label: 'Yen (USDJPY)', riskOnWhenRising: true },
] as const;

/** Band edges on the −6..+6 scale. */
export const RISK_BANDS = { strong: 5, moderate: 3 } as const;

export type RiskLabel =
  | 'Heavy risk-on'
  | 'Risk-on'
  | 'Neutral'
  | 'Risk-off'
  | 'Heavy risk-off';

export interface RiskComponent {
  key: string;
  label: string;
  /** −1, 0 or +1, already expressed as risk-on positive. */
  cell: number;
  price: number | null;
  average: number | null;
  /** True when this input reads inverted (VIX, gold, DXY). */
  inverted: boolean;
  explanation: string;
}

export interface RiskGauge {
  score: number;
  label: RiskLabel;
  components: RiskComponent[];
  /** How many of the six had data. A 2-of-6 reading is not a market view. */
  populated: number;
}

export function labelRisk(score: number): RiskLabel {
  if (score >= RISK_BANDS.strong) return 'Heavy risk-on';
  if (score >= RISK_BANDS.moderate) return 'Risk-on';
  if (score <= -RISK_BANDS.strong) return 'Heavy risk-off';
  if (score <= -RISK_BANDS.moderate) return 'Risk-off';
  return 'Neutral';
}

/**
 * Scores one input against its own 14-day average.
 *
 * The slow trend average is reused deliberately: it is already computed for
 * every symbol, and a second window here would mean the risk gauge and the trend
 * column could disagree about whether the same instrument is rising.
 */
function scoreRiskInput(
  input: (typeof RISK_INPUTS)[number],
  tech: Technicals | undefined,
): RiskComponent {
  const base = {
    key: input.key,
    label: input.label,
    inverted: !input.riskOnWhenRising,
  };

  if (!tech || tech.smaSlow === null) {
    return { ...base, cell: 0, price: null, average: null, explanation: `${input.label}: no data` };
  }

  const rising = tech.price > tech.smaSlow;
  // Flip so the result reads as risk-on regardless of the instrument.
  const cell = rising === input.riskOnWhenRising ? 1 : -1;

  return {
    ...base,
    cell,
    price: tech.price,
    average: tech.smaSlow,
    explanation:
      `${input.label} is ${rising ? 'above' : 'below'} its 14-day average — ` +
      `${cell > 0 ? 'risk-on' : 'risk-off'}${base.inverted ? ' (inverted: it rises when capital seeks safety)' : ''}.`,
  };
}

export function buildRiskGauge(technicals: Map<string, Technicals>): RiskGauge {
  const components = RISK_INPUTS.map((input) => scoreRiskInput(input, technicals.get(input.symbol)));
  const populated = components.filter((c) => c.price !== null).length;

  return {
    score: components.reduce((total, c) => total + c.cell, 0),
    label: labelRisk(components.reduce((total, c) => total + c.cell, 0)),
    components,
    populated,
  };
}

// ---------------------------------------------------------------------------
// Smart money
// ---------------------------------------------------------------------------

export interface SmartMoneyRow {
  contract: string;
  label: string;
  /** Speculator net as a share of their total positions, −100..100. */
  specNetPct: number;
  /** Small-trader net as a share of theirs, −100..100. */
  retailNetPct: number;
  /** specNetPct − retailNetPct. Positive means institutions are more bullish. */
  spread: number;
  divergent: boolean;
  reportDate: string;
}

function netPct(long: number, short: number): number {
  const total = long + short;
  return total === 0 ? 0 : ((long - short) / total) * 100;
}

/**
 * Institutions against the crowd, per contract.
 *
 * The spread is the point: both sides being 60% long is agreement and says
 * little, while specs at +40 and retail at −40 is the setup worth looking at.
 * Sorted by absolute spread so the widest disagreements surface first.
 */
export function buildSmartMoney(
  cot: Map<string, CotSeries>,
  labels: Map<string, string> = new Map(),
): SmartMoneyRow[] {
  const rows: SmartMoneyRow[] = [];

  for (const [contract, series] of cot) {
    const latest = series.reports[0];
    if (!latest) continue;
    // Same floor the crowd cell uses: a percentage off a handful of contracts is
    // arithmetic, not signal.
    if (latest.retailLong + latest.retailShort < 500) continue;

    const specNetPct = netPct(latest.specLong, latest.specShort);
    const retailNetPct = netPct(latest.retailLong, latest.retailShort);

    rows.push({
      contract,
      label: labels.get(contract) ?? contract,
      specNetPct: Math.round(specNetPct * 10) / 10,
      retailNetPct: Math.round(retailNetPct * 10) / 10,
      spread: Math.round((specNetPct - retailNetPct) * 10) / 10,
      divergent: Math.sign(specNetPct) !== Math.sign(retailNetPct) && retailNetPct !== 0,
      reportDate: latest.reportDate,
    });
  }

  return rows.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
}

// ---------------------------------------------------------------------------
// Economic surprise index
// ---------------------------------------------------------------------------

export interface SurpriseIndex {
  currency: Currency;
  /**
   * 0..100. 100 = every DIRECTIONAL release beat, 0 = every one missed.
   *
   * Null when nothing directional resolved — no releases at all, or every one
   * landing exactly on forecast. Both are "no signal", and neither is 50.
   */
  index: number | null;
  beats: number;
  misses: number;
  inline: number;
  /** Releases that actually resolved. Below ~4 the percentage is noise. */
  sampled: number;
}

/** Under this many resolved releases the index is not meaningful. */
export const SURPRISE_MIN_SAMPLE = 4;

/**
 * Share of recent releases that beat expectations, per currency.
 *
 * DERIVED FROM THE HEATMAP, not computed a second time. Three functions in this
 * repo used to answer this one question and no two agreed: `bullishShare`
 * divided by every resolved row, this one counted an on-forecast print as half a
 * beat, and A1 — whose number we are trying to match — excludes neutrals from
 * the denominator entirely. Two of the three were ours, on two different pages,
 * and a user comparing /macro against /heatmap would have been shown different
 * percentages for the same currency on the same data.
 *
 * So this now reads `buildCurrencyHeatmap` and reports what it reports.
 *
 * SAMPLE SIZES STILL DIFFER BY CURRENCY, and that is not a bug to fix here. The
 * dollar has thirteen rows against seven for the Australian dollar, because the
 * United States genuinely publishes payrolls, claims, ADP, JOLTS and PCE and
 * nobody else does. The heatmap drops slots an economy does not publish rather
 * than counting them as empty, so no currency is penalised for a series that
 * does not exist — but a percentage over thirteen releases is a steadier number
 * than one over seven, which is what `sampled` and SURPRISE_MIN_SAMPLE are for.
 */
export function buildSurpriseIndex(
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): SurpriseIndex {
  const heatmap = buildCurrencyHeatmap(currency, events, now);

  let beats = 0;
  let misses = 0;
  let inline = 0;

  for (const row of heatmap.rows) {
    // Polarity is already applied, so a positive impact means "bullish for this
    // currency", which for an inverted slot like unemployment is a lower print.
    if (row.currencyImpact === null) continue;
    if (row.currencyImpact > 0) beats++;
    else if (row.currencyImpact < 0) misses++;
    else inline++;
  }

  return {
    currency,
    index: heatmap.currencyImpactPct,
    beats,
    misses,
    inline,
    sampled: beats + misses + inline,
  };
}

// ---------------------------------------------------------------------------
// Economic strength index
// ---------------------------------------------------------------------------

export interface StrengthRow {
  currency: Currency;
  /** Sum of that currency's own economic cells. */
  macroScore: number;
  /** Policy rate minus CPI year-on-year. The real return on holding it. */
  realYield: number | null;
  policyRate: number | null;
  cpi: number | null;
  /** Null when no directional release resolved — see `SurpriseIndex.index`. */
  surpriseIndex: number | null;
  /** Rank position, 1 = strongest. */
  rank: number;
}

/**
 * Ranks currencies on their own fundamentals, independent of any pair.
 *
 * Real yield is included because it is the one number that explains flows the
 * macro cells cannot: a 5% policy rate against 6% inflation is a NEGATIVE real
 * return, and nominally-high-rate currencies with hot inflation are routinely
 * weak for exactly that reason.
 *
 * Ordering is by macro score with real yield as the tiebreak, rather than by a
 * blended composite — a composite would need weights we have no basis for.
 */
export function buildStrengthIndex(
  currencies: readonly Currency[],
  currencyScores: CurrencySlotScores,
  policyRates: Map<Currency, number>,
  cpiByCurrency: Map<Currency, number>,
  events: NormalizedEvent[],
  now = new Date(),
): StrengthRow[] {
  const rows = currencies.map((currency) => {
    const slots = currencyScores.get(currency);

    let macroScore = 0;
    if (slots) {
      for (const slot of SCORING_SLOTS) {
        if (slot.kind !== 'economic') continue;
        macroScore += slots.get(slot.key)?.cell ?? 0;
      }
    }

    const policyRate = policyRates.get(currency) ?? null;
    const cpi = cpiByCurrency.get(currency) ?? null;
    const realYield =
      policyRate !== null && cpi !== null ? Math.round((policyRate - cpi) * 100) / 100 : null;

    return {
      currency,
      macroScore,
      realYield,
      policyRate,
      cpi,
      surpriseIndex: buildSurpriseIndex(currency, events, now).index,
      rank: 0,
    };
  });

  rows.sort((a, b) => {
    if (b.macroScore !== a.macroScore) return b.macroScore - a.macroScore;
    return (b.realYield ?? -Infinity) - (a.realYield ?? -Infinity);
  });

  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Carry scanner
// ---------------------------------------------------------------------------

export interface CarryRow {
  symbol: string;
  label: string;
  base: Currency;
  quote: Currency;
  baseRate: number;
  quoteRate: number;
  /** baseRate − quoteRate, in percentage points per year. */
  carry: number;
  /** Which side of the pair collects the differential. */
  direction: 'long' | 'short';
}

/**
 * Annual interest differential for every pair, both directions.
 *
 * `carry` keeps the sign of base − quote so the number is readable against the
 * pair as quoted, while `direction` states which side actually collects. A
 * −3.5% carry on EURJPY is a +3.5% carry on the short — the same fact, and
 * showing only one of the two invites reading the sign backwards.
 *
 * A pair is omitted when either policy rate is missing rather than assuming
 * zero. Treating an unknown rate as 0% would manufacture the largest carry in
 * the table out of missing data.
 */
export function buildCarryTable(
  pairs: { symbol: string; label: string; base?: Currency; quote?: Currency }[],
  policyRates: Map<Currency, number>,
): CarryRow[] {
  const rows: CarryRow[] = [];

  for (const pair of pairs) {
    if (!pair.base || !pair.quote) continue;

    const baseRate = policyRates.get(pair.base);
    const quoteRate = policyRates.get(pair.quote);
    if (baseRate === undefined || quoteRate === undefined) continue;

    const carry = Math.round((baseRate - quoteRate) * 100) / 100;

    rows.push({
      symbol: pair.symbol,
      label: pair.label,
      base: pair.base,
      quote: pair.quote,
      baseRate,
      quoteRate,
      carry,
      direction: carry >= 0 ? 'long' : 'short',
    });
  }

  // Widest differential first — a 0.1% carry is not a trade at any size.
  return rows.sort((a, b) => Math.abs(b.carry) - Math.abs(a.carry));
}
