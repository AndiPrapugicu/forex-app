/**
 * What we actually KNOW about each column's input, kept apart from what we
 * currently do about it.
 *
 * WHY THIS FILE EXISTS. Eleven rounds of reverse engineering produce a lot of
 * claims, and the expensive failures have all been the same shape: a hypothesis
 * that fitted once got repeated in a summary, then in a comment, then in a
 * decision, and by the time it was tested properly it had spent three rounds
 * being treated as a fact. Round nine's GBPX conclusions and the "quarter over
 * quarter projection" rates model were both retired that way. A claim needs a
 * place to be written down WITH its grade and WITH the dates the grade rests on,
 * so that "we confirmed this" and "this fitted the only row we had" cannot look
 * alike six weeks later.
 *
 * IT IS A LEDGER, NOT A SWITCH. Nothing in the scoring path reads this file. It
 * changes no cell. Downgrading an entry here is not a code change and must not
 * be treated as one — it is the thing that tells a later round which code change
 * is worth attempting.
 *
 * THE GRADES, and what it takes to earn one:
 *
 *   CONFIRMED  A1 states the input or transformation on a page of their own, OR
 *              their own published input reproduces their own published cell
 *              across more than one instance. Reproducing one cell is not
 *              enough — one row is satisfied by many rules.
 *   SUPPORTED  Consistent with every observation held, but the observations do
 *              not exclude a rival explanation. The honest home for anything
 *              that "fits so far".
 *   UNKNOWN    No source identified, or a rule that observation has falsified
 *              with nothing yet in its place.
 *   BLOCKED    The rule is known and the input is not obtainable. Needs a
 *              `blocker` naming what is missing, because a BLOCKED entry is a
 *              purchasing decision rather than an engineering one.
 *
 * A grade NEVER moves because parity improved. That is the rule this file is
 * here to enforce.
 */

import { SCORING_SLOTS } from '@/config/setups.config';

export type Confidence = 'CONFIRMED' | 'SUPPORTED' | 'UNKNOWN' | 'BLOCKED';

export interface ComponentSource {
  /** Scoring slot key, or a pseudo-key for a mechanism that spans slots. */
  key: string;
  component: string;
  /** Where A1 gets it, as far as we can show. */
  a1Source: string;
  /** What A1 does to it. */
  a1Transformation: string;
  /** What we read. */
  ourSource: string;
  confidence: Confidence;
  /** Dates of the observations the grade rests on. Empty only for UNKNOWN. */
  evidenceDates: string[];
  /** The specific measurement, not a summary of it. */
  evidence: string;
  /** Required for BLOCKED: what is missing, and why we cannot get it. */
  blocker?: string;
}

const RETAIL_ORACLE =
  "A1's free Retail Sent. History page, joined to their own Top Setups cells";

export const SOURCE_CONFIDENCE: readonly ComponentSource[] = [
  {
    key: 'trend',
    component: 'Trend',
    a1Source: 'Their own chart read, published as "4H/Daily Chart Trend" on the free Forex Scorecard',
    a1Transformation: 'A fast and a slow moving average, per a1trading.com/edgefinder/trend/',
    ourSource: 'TradingView technicals, same two averages',
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-24', '2026-08-25'],
    evidence:
      'Reproduces their cell on EIGHT of eight checksummed rows once the price series is cut at ' +
      "each capture's own timestamp (2026-08-30); computed live it matched six, and the two it " +
      'missed — EURCHF and CHFX — were the two whose trend had turned during the week between the ' +
      'capture and the run. That is stronger than the old reading, because the two cells it newly ' +
      'explains moved by 3 and 4 points and landed exactly. Still SUPPORTED rather than CONFIRMED: ' +
      'the averages are inferred from their prose rather than stated as periods, and a trend cell ' +
      'agreeing remains weak evidence on its own — only three values are possible and most days are ' +
      'trending. See `trend:as-of` in the parity ledger for the fix this measurement licensed.',
  },
  {
    key: 'seasonality',
    component: 'Seasonality',
    a1Source: 'A1 Seasonality Scanners (free), labelled "Current month\'s 10yr seasonality"',
    a1Transformation: "Ten-year average return for the calendar month, signed",
    ourSource: 'Ten-year monthly return average from daily bars',
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-24', '2026-08-29'],
    evidence:
      'Their Forex Scorecard row label states the window verbatim ("10yr"), which pins the ' +
      'lookback; what it does not pin is whether they average returns or count positive months.',
  },
  {
    key: 'cot',
    component: 'COT',
    a1Source: 'CFTC Commitments of Traders, republished on their free COT Data page',
    a1Transformation: 'Net non-commercial positioning, plus a separate weekly-change reading',
    ourSource: 'CFTC, same report',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-29'],
    evidence:
      'The same public CFTC report, republished by them; there is no population difference to argue ' +
      'about the way there is on Crowd. Their Retail Sent. History page plots "Net COT positioning ' +
      'Final" alongside retail share, so the two are visibly distinct series inside their own data. ' +
      'The SOURCE was never in doubt; WHICH REPORT was. Until 2026-08-30 a rewound board could be ' +
      'handed a report published up to three days after it, because the cut was on the Tuesday ' +
      'surveyed rather than the Friday released. Corrected, and it is what moved NZDX Crowd onto ' +
      "A1's +1 — so the agreement on this row is now measured against the report they could actually " +
      'have read.',
  },
  {
    key: 'crowd',
    component: 'Crowd Sentiment',
    a1Source: "A1 Retail Sentiment — daily retail long share per instrument. Upstream provider NOT named.",
    a1Transformation: 'Contrarian bands: long% <= 40 -> +1, 40 < long% < 60 -> 0, long% >= 60 -> -1',
    ourSource: 'CFTC small-trader share on the symbol\'s own contract (a different population)',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-25', '2026-08-29'],
    evidence:
      `${RETAIL_ORACLE}: 8 of 8 cells reproduced across two capture dates, spanning two majors, ` +
      'a cross, two metals and three currency indices (two of those derived from a dollar pair, ' +
      'one of them inverted). The bands are read off A1\'s own Bearish/Bullish/Neutral labels on ' +
      '29 rows, with EURGBP at exactly 40 classified Bullish pinning the lower bound inclusive.',
  },
  {
    key: 'crowd:index',
    component: 'Crowd Sentiment — currency index rows',
    a1Source: 'The currency\'s own dollar pair in the same retail dataset',
    a1Transformation: 'index long% = long%(CURUSD), or 100 - long%(USDCUR) when the currency is the quote',
    ourSource: 'The index\'s own CME currency future, via CFTC',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-25', '2026-08-29'],
    evidence:
      'Eight for eight on the snapshot (four identities, three complements, DXY excluded), and ' +
      'independently: EURX/NZDX/CHFX crowd cells reproduced from EURUSD/NZDUSD/USDCHF on the ' +
      'exact dates those rows were captured.',
  },
  {
    key: 'crowd:dxy',
    component: 'Crowd Sentiment — the dollar index',
    a1Source: 'The dollar index has its OWN book — 92.51% long, two decimals, matching no dollar pair',
    a1Transformation: 'Same 40/60 bands, different instrument',
    ourSource: 'USD INDEX contract, via CFTC',
    confidence: 'BLOCKED',
    evidenceDates: ['2026-08-29'],
    evidence:
      'Excluded from the index derivation deliberately: deriving DXY from EURUSD would invent a ' +
      'basket A1 does not use. Their own value is visible on the snapshot page but that page has ' +
      'no per-day history for it, so it cannot be joined to a dated Top Setups row.',
    blocker:
      'A retail positioning feed that quotes the dollar index as an instrument. No free provider ' +
      'surveyed carries one.',
  },
  {
    key: 'gdp',
    component: 'GDP',
    a1Source: 'A1 Economic Growth Data (free), row label "GDP vs. forecast"',
    a1Transformation: 'Actual against consensus, signed by surprise',
    ourSource: 'FXStreet / FairEconomy calendar, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-29'],
    evidence:
      "Their Forex Scorecard prints the row as 'GDP vs. forecast', stating the comparison outright " +
      'rather than leaving it inferred, and the same free Economic Growth page publishes GDP QoQ ' +
      'with a forecast column per country.',
  },
  {
    key: 'mpmi',
    component: 'mPMI',
    a1Source: 'A1 Economic Growth Data, row label "ISM mPMI vs. forecast"',
    a1Transformation: 'Actual against consensus',
    ourSource: 'Calendar manufacturing PMI, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-29'],
    evidence:
      'Row label states the basis. The leg is also over-determined three ways on 2026-08-24 and ' +
      'consistent (USD +1, EUR +1, GBP -1, CHF +1).',
  },
  {
    key: 'spmi',
    component: 'sPMI',
    a1Source: 'A1 Economic Growth Data, row label "ISM sPMI vs. forecast"',
    a1Transformation: 'Actual against consensus',
    ourSource: 'Calendar services PMI, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Their Forex Scorecard prints the row as 'ISM sPMI vs. forecast', which states the comparison " +
      'rather than leaving it to be inferred. No checksummed row held pins the leg independently, ' +
      'so the BASIS is confirmed and the SERIES is not.',
  },
  {
    key: 'retail-sales',
    component: 'Retail Sales',
    a1Source: 'A1 Economic Growth Data, row label "Retail sales vs. forecast"',
    a1Transformation: 'Actual against consensus',
    ourSource: 'Calendar retail sales MoM, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Row label reads 'Retail sales vs. forecast'. Their free Economic Growth page publishes the " +
      'same series MoM, matching the release this repo reads for the majors it covers.',
  },
  {
    key: 'consumer-confidence',
    component: 'Cnsmr Conf',
    a1Source: 'A1 Economic Growth Data — Consumer Confidence, actual and forecast per currency',
    a1Transformation: 'Actual against forecast, raw sign',
    ourSource: 'Conference Board / national confidence series, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-30'],
    evidence:
      "Their free page publishes actual AND forecast with release dates, and the legs solved from " +
      "their own cells fall out of it: USD 2026-08-25 89.4 vs 90.3 = -1, CHF 2026-08-07 -33 vs -34 " +
      '= +1, GBP -14 vs -18 = +1 — three currencies, three matches, including a one-point CHF beat ' +
      'that a deadband would have swallowed. The remaining CHF cell difference is a SOURCE ' +
      'difference, not a basis one: our actual for that same release is -35 against the same -34 ' +
      'forecast. See `parity-ledger.ts` entry `consumer-confidence:CHF` — the long-proposed switch ' +
      'to comparing against the previous print is now refuted, not merely unsupported.',
  },
  {
    key: 'cpi',
    component: 'CPI YoY',
    a1Source: 'A1 Inflation Data — CPI YoY, published with their own CPI Forecast per country',
    a1Transformation: 'Actual against forecast ("CPI YoY vs. forecast")',
    ourSource: 'Calendar CPI YoY, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      'Their free CPI page carries a forecast for every month INCLUDING CHF, and 2026-08 reads ' +
      'actual 0.4% against forecast 0.4% — which is what this repo scores. So the CHF override ' +
      'to "previous" is not justified by an absent A1 forecast.',
  },
  {
    key: 'ppi',
    component: 'PPI YoY',
    a1Source: 'A1 Inflation Data — PPI YoY, row label "PPI YoY vs. forecast"',
    a1Transformation: 'Actual against forecast',
    ourSource: 'Calendar PPI YoY, actual vs consensus',
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-29'],
    evidence:
      'Basis stated. GBP has a persistent discrepancy on this column across captures and the ' +
      'series definition (input vs output PPI) has never been pinned against theirs.',
  },
  {
    key: 'pce',
    component: 'PCE YoY',
    a1Source: 'A1 Inflation Data — PCE YoY (USA only)',
    a1Transformation: 'Actual against forecast',
    ourSource: 'Calendar PCE YoY, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      'US-only by construction — their own page scopes the PCE chart to the USA, which is the ' +
      'basis of the structural-zero check that caught two misread rows.',
  },
  {
    key: 'rates',
    component: 'Interest Rates — FX rows',
    a1Source:
      'CONFIRMED, and both halves are free: the standing policy rate (their Interest Rates page) ' +
      'and market-consensus projections by calendar quarter (their Interest Rate Projections page).',
    a1Transformation:
      'sign(current quarter projected rate - standing policy rate), differenced base minus quote',
    ourSource: "Fed dot plot, else the next scheduled decision's calendar consensus, else 0",
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-24', '2026-08-25', '2026-08-29', '2026-08-30'],
    evidence:
      'On 2026-08-30 their own two pages give USD 3.75->3.75 (0), EUR 2.40->2.65 (+1), GBP ' +
      '3.75->4.00 (+1), CHF 0.00->0.00 (0), NZD 2.25->2.75 (+1). Those five legs reproduce SIX of ' +
      "A1's own cells across three dates: EURUSD +1, GBPUSD +1, EURCHF +1 (2026-08-24 Top Setups), " +
      'CHFX 0, NZDX +1 (2026-08-25), EURCHF Bullish (2026-08-29 Forex Scorecard). Tested SAME-DAY ' +
      'on 2026-08-30 for the first time, reading their projections and their EURCHF scorecard on ' +
      'one day: the rule predicts Bullish and they printed Bullish, while the quarter-over-quarter ' +
      'reading predicts Neutral and is eliminated. Still not CONFIRMED, but the reason has changed ' +
      "shape. The single contradicting observation — EURX's 2026-08-24 rates cell reading 0 where " +
      'the rule says +1 — is now known to be UNTESTED rather than attested: that row also carries ' +
      'an unemployment cell its own board contradicts by exactly one in the opposite direction, so ' +
      'the two cancel and the row sums to its printed 7 under either reading. A checksum cannot ' +
      'see a compensating pair. What still blocks CONFIRMED is that no second checksum-valid index ' +
      'row exists to retest the cell, and the projections chart has no history control, so a ' +
      'revision cannot be ruled out either. Three candidates are FALSIFIED and must not return: ' +
      'quarter-over-quarter projected change (twice — EURCHF Bullish on 2026-08-29 with both legs ' +
      'flat, and again same-day on 2026-08-30), and per-currency 2Y yield vs its 21-day SMA ' +
      '(missed USD, EUR and GBP against real historical yields on 2026-08-24).',
  },
  {
    key: 'rates:assets',
    component: 'Interest Rates - asset rows (metals, indices, commodities)',
    a1Source:
      'The US 2-year yield. Their Asset Scorecard labels the row verbatim "US02Yield (21 day ' +
      'SMA)" - the CONSTANT-MATURITY Treasury yield, which is FRED DGS2 and not a futures ' +
      'contract on it.',
    a1Transformation:
      'Yield against its own 21-day moving average; above -> -1 for a risk asset, below -> +1',
    ourSource: 'The same comparison on the same series, in scoreYield2y over FRED DGS2',
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-23', '2026-08-25', '2026-08-30', '2026-08-31'],
    evidence:
      'The label is printed on their own free Asset Scorecard, and their checksummed DXY row ' +
      'scores rates -1 on a card explaining it as "the 2yr yield is falling (dovish)". This is ' +
      'the ONLY place the 21-day-SMA rule is attested; extending it to the other seven majors ' +
      'was tested against real historical yields and failed for USD, EUR and GBP. ' +
      'DOWNGRADED FROM CONFIRMED 2026-08-31, and the downgrade is the honest half of that ' +
      'round. It was graded CONFIRMED while the input was Yahoo 2YY=F, a DIFFERENT INSTRUMENT ' +
      'reading 24bp away from the series their label names, whose live quote was being compared ' +
      'against twelve sessions of stalled closes. The two metal cells it matched were matching ' +
      'by artifact, and on the correct series they do not match on either captured date. The ' +
      'gap is small and one-directional: 2026-08-24 reads 4.24 against a 4.219 average, inside ' +
      'the 0.5% flat band by three thousandths of a point, and their 2026-08-23 card calls the ' +
      'same yield falling when DGS2 has it marginally rising. So the RULE is not in question - ' +
      'their label states it - but which 2-year they read now is. See ledger ' +
      '`rates:assets-2026-08-24`. A dated Asset Scorecard row taken on a day the 2-year is ' +
      'clearly off its average is what restores CONFIRMED.',
  },
  {
    key: 'employment',
    component: 'NFP',
    a1Source: 'A1 Labor Market Data (free), US Non-Farm Payroll',
    a1Transformation: 'Actual against forecast',
    ourSource: 'Calendar NFP, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Row label reads 'Non-Farm Payroll' against a Forecast column on their own free Labor Market " +
      'page. US-only by construction, which is what makes it usable as a structural-zero check: a ' +
      'row with no dollar leg must print 0 here.',
  },
  {
    key: 'unemployment',
    component: 'Unemploy. Rate',
    a1Source: 'A1 Labor Market Data, row label "Unemployment rate vs forecast"',
    a1Transformation: 'Actual against forecast, inverted (a higher rate is bearish)',
    ourSource:
      'Calendar unemployment rate, actual vs consensus, inverted. CHF is the exception in two ' +
      'ways and both come off one A1 row: the UNADJUSTED series, read against the PREVIOUS print.',
    confidence: 'SUPPORTED',
    evidenceDates: ['2026-08-24', '2026-08-29', '2026-08-31'],
    evidence:
      'Basis stated. EUR carries a persistent discrepancy on this column and the release we read ' +
      'may not be the one they read (euro-area aggregate vs national). ' +
      'THE SWISS SERIES IS NOW NAMED, 2026-08-31. Their CH heatmap card row is dated `Jan 9, 26` ' +
      'and reads actual 3.1, Forecast blank, previous 2.9 — a pair no seasonally adjusted Swiss ' +
      'print has ever produced (the adjusted series sat at 3.0 either side of it) and exactly the ' +
      'unadjusted December 2025 reading. Their own free Unemployment Rate page carries the same ' +
      'unadjusted series, agreeing with TradingView Switzerland to the decimal on the last five ' +
      'months. So one card row fixes both the SERIES and the REFERENCE for this currency, and the ' +
      'board agrees on both captured dates. The column stays SUPPORTED rather than CONFIRMED ' +
      'because EUR is still unexplained, not because CHF is.',
  },
  {
    key: 'claims',
    component: 'Unemploy. Claims',
    a1Source: 'A1 Labor Market Data, "Weekly unemp. claims vs. forec."',
    a1Transformation: 'Actual against forecast, inverted',
    ourSource: 'Calendar initial claims, actual vs consensus, inverted',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Row label reads 'Weekly unemp. claims vs. forec.' and the series is US-only, so it is one of " +
      'the five columns the structural-zero check screens rows against.',
  },
  {
    key: 'adp',
    component: 'ADP',
    a1Source: 'A1 Labor Market Data, "ADP vs. forecast"',
    a1Transformation: 'Actual against forecast',
    ourSource: 'Calendar ADP, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Row label reads 'ADP vs. forecast'. US-only, and one of the five structural-zero columns " +
      'that caught the two misread rows withdrawn in round ten.',
  },
  {
    key: 'jolts',
    component: 'JOLTS',
    a1Source: 'A1 Labor Market Data, "JOLTS vs. forecast"',
    a1Transformation: 'Actual against forecast',
    ourSource: 'Calendar JOLTS, actual vs consensus',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-29'],
    evidence:
      "Row label reads 'JOLTS vs. forecast'. US-only, and the fifth of the structural-zero columns." +
      ' Their free Labor Market page publishes the same openings series with a forecast column.',
  },
  {
    key: 'structure:leg-differencing',
    component: 'Board structure — are pair cells base minus quote?',
    a1Source: "A1's own board",
    a1Transformation: 'cell(pair) = leg(base) - leg(quote), clamped',
    ourSource: 'The same, in buildSetupsMatrix',
    confidence: 'CONFIRMED',
    evidenceDates: ['2026-08-24', '2026-08-25'],
    evidence:
      'PROVED on their own board, over-determined, on 2026-08-24. Gold and silver carry only the ' +
      'dollar leg, inverted, so negating either row reads USD DIRECTLY with no differencing ' +
      'assumed — and the two metals agree with each other in all fourteen economic columns. ' +
      'Measuring the same leg the other way, as EURX minus EURUSD, reconciles with it in 13 of ' +
      'those 14. If A1 did not difference legs the two routes would agree only by coincidence, ' +
      'column after column. The single exception is unemployment, where the differenced route ' +
      'yields +2 — out of range for a ternary leg, so it dates a bad CELL rather than the rule. ' +
      'Pinned by lib/scoring/index-rows.test.ts. Note this grades the ECONOMIC block; a currency ' +
      'index row also carries trend, seasonality, COT and crowd, which come from the index ' +
      'INSTRUMENT and are not leg-differenced at all.',
  },
] as const;

/** Cheap lookup for scripts and tests. */
export function sourceFor(key: string): ComponentSource | undefined {
  return SOURCE_CONFIDENCE.find((entry) => entry.key === key);
}

/** Scoring slots with no ledger entry. Should always be empty. */
export function slotsWithoutSource(): string[] {
  return SCORING_SLOTS.filter((slot) => !sourceFor(slot.key)).map((slot) => slot.key);
}

export function byConfidence(): Record<Confidence, ComponentSource[]> {
  const out: Record<Confidence, ComponentSource[]> = {
    CONFIRMED: [],
    SUPPORTED: [],
    UNKNOWN: [],
    BLOCKED: [],
  };
  for (const entry of SOURCE_CONFIDENCE) out[entry.confidence].push(entry);
  return out;
}
