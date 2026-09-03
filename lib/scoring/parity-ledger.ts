/**
 * Every unresolved mismatch, with what it IS rather than how big it is.
 *
 * WHY A LEDGER AND NOT A REPORT. `npm run component-parity` says a cell differs.
 * It cannot say whether that difference is a rule we got wrong, a number our
 * provider does not have, a contradiction inside A1's own board, or a
 * screenshot that was misread — and those four demand completely different
 * responses. Without somewhere to write the answer down, each round re-derives
 * it, and twice now a difference has been "discovered" that a previous round had
 * already diagnosed and correctly declined to fix.
 *
 * `lib/scoring/source-confidence.ts` is the other half of this: that one grades
 * what we know about each COLUMN's input, this one records what happened to each
 * individual CELL. A column can be CONFIRMED and still have a mismatching cell,
 * which is exactly the shape of a data-source difference.
 *
 * THE CLASSIFICATIONS, and what each one licenses:
 *
 *   FIXED               Rule and input both proven, change landed. Carries the
 *                       commit-worthy chain in `rootCause`.
 *   SOURCE_DIFFERENCE   A1's rule is ours; A1's NUMBER is not. Never fix by
 *                       changing the formula — that is how a scoring engine
 *                       becomes a curve fit. Fix by changing the feed, or not
 *                       at all.
 *   A1_INCONSISTENCY    A1's own cells disagree with A1's own published data, or
 *                       with each other. Matching one side is picking a coin
 *                       flip and calling it evidence.
 *   TIMING              Both models right, snapshots taken at different moments.
 *   TRANSCRIPTION_ERROR The observation is unsafe. Discard it; do not average it
 *                       in and do not let it pin a leg.
 *   UNKNOWN             Genuinely unresolved. The only class that licenses more
 *                       research.
 *
 * NOTHING IN THE SCORING PATH READS THIS FILE. It changes no cell.
 */

export type ParityClassification =
  | 'FIXED'
  | 'SOURCE_DIFFERENCE'
  | 'A1_INCONSISTENCY'
  | 'TIMING'
  | 'TRANSCRIPTION_ERROR'
  | 'UNKNOWN';

export type LedgerConfidence = 'PROVEN' | 'STRONG' | 'WEAK';

/**
 * WHICH A1 THE OBSERVATION WAS MADE AGAINST.
 *
 * Everything in this file before 2026-08-31 was measured through A1's tiered
 * demo: Top Setups was "Premium only", the Asset Scorecard showed PLATINUM
 * alone, and the Forex Scorecard was capped to EUR/CHF. Conclusions drawn there
 * were drawn under an information constraint that no longer exists, and several
 * have already been overturned by full access.
 *
 * They are NOT deleted and NOT rewritten -- a demo-era entry records a real
 * measurement, and knowing what was measured is what lets a later round tell an
 * assumption from an observation. They are labelled, and the label is derived
 * from the date rather than hand-set on 40-odd entries, so it cannot drift.
 *
 * The rule for the whole project: where a full-access observation contradicts a
 * demo-era one, the observation wins and the demo-era entry is annotated.
 */
export type EvidenceTier = 'DEMO_ERA' | 'FULL_ACCESS';

/** A1's Free Week began on this date; before it, everything was the demo. */
export const FULL_ACCESS_FROM = '2026-08-31';

export interface ParityLedgerEntry {
  /** Stable key, `component:scope`. Referenced from code comments and docs. */
  key: string;
  component: string;
  /** The symbol the mismatch was observed on, or the currency whose leg it is. */
  symbol: string;
  /** ISO date of the observation. `null` only for a standing structural finding. */
  date: string | null;
  /** Our cell, as a string so "0" and "not scored" stay distinguishable. */
  ours: string;
  a1: string;
  classification: ParityClassification;
  /** The measurement, with both sides' numbers in it. */
  evidence: string;
  confidence: LedgerConfidence;
  rootCause: string;
  /** What production should do. "None" is a real answer and the common one. */
  productionAction: string;
  /**
   * Set only to override the date-derived tier -- e.g. an entry dated during
   * the free week whose evidence still came from a demo-era capture.
   */
  evidenceTier?: EvidenceTier;
}

/** Demo-era or full-access, derived from the date unless explicitly overridden. */
export function evidenceTierOf(entry: ParityLedgerEntry): EvidenceTier {
  if (entry.evidenceTier) return entry.evidenceTier;
  if (entry.date === null) return 'DEMO_ERA';
  return entry.date >= FULL_ACCESS_FROM ? 'FULL_ACCESS' : 'DEMO_ERA';
}

/** Entries grouped by which A1 they were observed against. */
export function ledgerByEvidenceTier(): Record<EvidenceTier, ParityLedgerEntry[]> {
  const out: Record<EvidenceTier, ParityLedgerEntry[]> = { DEMO_ERA: [], FULL_ACCESS: [] };
  for (const entry of PARITY_LEDGER) out[evidenceTierOf(entry)].push(entry);
  return out;
}

export const PARITY_LEDGER: readonly ParityLedgerEntry[] = [
  {
    key: 'cot:publication-lag',
    component: 'COT, Crowd',
    symbol: 'NZDX (observable); 15 cells in all',
    date: '2026-08-25',
    ours: '0',
    a1: '+1',
    classification: 'FIXED',
    evidence:
      'The CFTC surveys positions on a Tuesday and releases the report the following Friday — stated ' +
      "in lib/connectors/cftc.ts's own header since the connector was written, and confirmed in the " +
      'data: every reportDate we hold is a Tuesday, and on Sunday 2026-08-30 the newest was ' +
      '2026-08-25, published Friday 2026-08-28. Replaying Tuesday 2026-08-25 admitted that report ' +
      'and moved fifteen cells. One of them is checksummed: NZDX Crowd, which A1 prints as +1 and ' +
      'we scored 0. Cut on the publication date it reads +1. The 2026-08-24 board is unaffected — ' +
      'zero cells move — so all six of its checksummed rows keep the COT cells they already matched.',
    confidence: 'PROVEN',
    rootCause:
      '`asOf` in lib/scoring/backtest.ts filtered COT on `reportDate`, the Tuesday SURVEYED, under a ' +
      'comment asserting "anything later was not public yet". The survey date is not the knowable ' +
      'date; the report does not exist for three more days. The doc block directly above the ' +
      'function already said so — "COT reports are published days after their survey date" — and ' +
      'nothing read it. This is look-ahead bias in `runBacktest` as much as a false rewind in the ' +
      'parity scripts, and it is the same class of defect as `trend:as-of`: a harness claiming a ' +
      'rewind it does not perform.',
    productionAction:
      'DONE. `publicationDate` and `COT_PUBLICATION_LAG_DAYS` are exported from the CFTC connector, ' +
      'where the schedule belongs, and `asOf` cuts on the publication date. NOT a scoring change — ' +
      '`scoreCot` and `scoreCrowd` are untouched; only which report they are handed changed. ' +
      'Regression tests in lib/scoring/backtest.test.ts pin both directions: a Tuesday replay must ' +
      'exclude the report surveyed that same day, and a Monday replay must still admit the one from ' +
      'the previous week.',
  },
  {
    key: 'rates:yield2y-source',
    component: 'Rates (DXY, metals, every non-FX row)',
    symbol: 'XAUUSD, XAGUSD, DXY',
    date: '2026-08-24',
    ours: '0 (DGS2, rewound)',
    a1: '+1',
    classification: 'FIXED',
    evidence:
      'A1 NAMES THE SERIES. Their Asset Scorecard labels the row verbatim US02Yield (21 day ' +
      'SMA) - the constant-maturity US Treasury 2-year, which is FRED DGS2. We were reading ' +
      'Yahoo 2YY=F, the CBOT 2-Year Yield FUTURE, which is a different instrument. Measured on ' +
      '2026-08-31 the two disagreed by 24bp on the same day (Yahoo 3.961, DGS2 4.20), and the ' +
      'Yahoo daily closes had sat at exactly 4.170 for twelve consecutive sessions while DGS2 ' +
      'took ten distinct values over the same window. DGS2 is 12,557 daily observations and was ' +
      'ALREADY being fetched by this repo for the sovereign yield map.',
    confidence: 'PROVEN',
    rootCause:
      'A source-selection defect, not a scoring one: a futures contract standing in for the ' +
      'constant-maturity yield their own label names. It hid behind a second defect - the column ' +
      'could not be rewound, so the series was never compared against a dated alternative.',
    productionAction:
      'DONE, AND IT COST TWO EXACT CELLS, WHICH IS THE POINT. `fetchYield2y` now reads FRED DGS2 ' +
      'and takes `pricesAsOf` like every other price-derived input, closing the last look-ahead ' +
      'leak in `runBacktest`. `scoreYield2y` is untouched. XAUUSD and XAGUSD rates went EXACT to ' +
      'MISMATCH: their +1 was produced by comparing a broken live quote (3.961) against closes ' +
      'from a different regime (4.172), a 5.05% deviation where the real instrument moved 0.19%. ' +
      'An agreement manufactured by a 24bp feed error is not a reproduction of their rule. ' +
      'BE CLEAR ABOUT WHAT THIS DID NOT BUY: on the correct series our cells do not match theirs ' +
      'on EITHER captured date, and no claim is made that they do. The change is justified by the ' +
      'instrument their label names and by the feed being measurably broken, not by parity. ' +
      'Tests: `yield2yAsOf` in lib/connectors/technicals.test.ts pins the cutoff, ' +
      'lib/connectors/yields.test.ts pins the parser. See `rates:assets-2026-08-24` for what is ' +
      'still open.',
  },
  {
    key: 'rates:assets-2026-08-24',
    component: 'Rates (metals)',
    symbol: 'XAUUSD, XAGUSD',
    date: '2026-08-24',
    ours: '0',
    a1: '+1',
    classification: 'UNKNOWN',
    evidence:
      'OPENED BY FIXING THE SOURCE, and it is a much narrower question than it looks. On ' +
      '2026-08-24 DGS2 read 4.24 against a 21-observation average of 4.219 - a deviation of ' +
      '0.497% against a flat band of 0.500%. We are inside the band by THREE THOUSANDTHS of a ' +
      'percentage point and score 0; A1 scores +1. This is not a rule disagreement.' +
      ' BUT +1 FOR A METAL MEANS THE YIELD IS BELOW ITS AVERAGE, and 4.24 was at the top of a ' +
      '4.15-4.33 range, so no window convention that includes recent data puts it there: ' +
      'excl-current gives 4.223 and a one-day lag gives 4.223, both still above. Their +1 is ' +
      'therefore not the DGS2 21-day read on that date under any variant tried.',
    confidence: 'STRONG',
    rootCause:
      'Unknown, and BROADER than one board once the series was corrected. Their 2026-08-23 DXY ' +
      'card says rates -1 and explains it as the 2yr yield FALLING; DGS2 on that date read 4.24 ' +
      'against a 4.223 average, which is marginally RISING and inside the flat band either way. ' +
      'So their reading of the 2-year disagrees with the constant-maturity series on both dates ' +
      'we hold, in the same direction. Candidates: their US02Yield is a broker or futures quote ' +
      'rather than the Treasury series their label names; or their board lags its yield input by ' +
      'more than a day; or the metals rate cell is not the 2-year read at all - their +1 also ' +
      'reconciles as the USD policy leg inverted (EURUSD +1 with EURX 0 forces USD -1). Two ' +
      'dates cannot separate three candidates.',
    productionAction:
      'NONE. Do not tune YIELD_FLAT_BAND: a band chosen to move this cell would be fitted to one ' +
      'observation three thousandths from its own boundary, and the direction it would have to ' +
      'move (4.24 reading as BELOW 4.219) is not reachable by widening or narrowing a band at ' +
      'all. AND DO NOT SWITCH BACK to the futures quote: it agreed with these two cells while ' +
      'being 24bp from the instrument, which is luck rather than method. What settles it is a ' +
      'dated Asset Scorecard row taken on a day the 2-year is CLEARLY off its average, where a ' +
      'stale or different quote could not produce the same sign by accident.',
  },
  {
    key: 'chf:legs-move-between-boards',
    component: 'mPMI, Cnsmr Conf, Rates',
    symbol: 'CHF (EURCHF @ 08-24 vs CHFX @ 08-25)',
    date: '2026-08-25',
    ours: 'one stable value per column',
    a1: 'two different values one day apart',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "Solving A1's own two boards into per-currency legs, three of CHF's columns carry DIFFERENT " +
      'values on consecutive days with no release in between: mPMI +1 then -1, Consumer Confidence ' +
      "+1 then 0, Rates -1 then 0. Their own published data settles two of them against their " +
      '2026-08-24 board: CHF mPMI printed 53.2 against a 54.5 forecast on 2026-08-03, which is -1 — ' +
      'the value their 08-25 board carries and ours carries, not the +1 their 08-24 board implies. ' +
      'Swiss consumer confidence and the SNB policy rate likewise had no release between the two ' +
      'boards. Measured by `npm run self-consistency`, which drops a moved leg rather than picking ' +
      'one.',
    confidence: 'PROVEN',
    rootCause:
      "A1's own value for these CHF legs changed between two consecutive captures without an " +
      'underlying release. Whatever produced that — a refresh, a revision, a stale cell — it is on ' +
      'their side, and it has a hard consequence for this project: NO single value of ours can match ' +
      'both boards, so any source change aimed at one of these cells necessarily breaks the other. ' +
      'CHF unemployment is the control that shows this is not a general CHF problem: its leg reads ' +
      '-1 on BOTH boards, via two independent routes, and is a genuine stable target.',
    productionAction:
      'None, and specifically: do not switch the Swiss consumer-confidence or PMI source to chase ' +
      'the 08-24 board. Three of the four contested CHF columns are unreproducible by construction. ' +
      'Spend the effort on unemployment, which is stable.',
  },
  {
    key: 'trend:as-of',
    component: 'Trend',
    symbol: 'EURCHF, CHFX',
    date: '2026-08-24',
    ours: '+2 and -2 (computed live)',
    a1: '-1 and +2',
    classification: 'FIXED',
    evidence:
      "A1's board carries its own timestamp, 2026-08-23T15:11:37Z. Cutting the daily price series at " +
      "each capture's timestamp and applying our UNCHANGED `scoreTrend` reproduces A1's trend cell on " +
      'EIGHT of eight checksummed rows; computed live it matched six. EURCHF went +2 -> -1 and CHFX ' +
      '-2 -> +2, both landing exactly on A1s printed cell. The other six (EURUSD, GBPUSD, XAUUSD, ' +
      'XAGUSD, EURX, NZDX) were already +2 and stayed +2, so the rewind moved only the two cells that ' +
      'were wrong.',
    confidence: 'PROVEN',
    rootCause:
      '`runSetupsPipeline` has always taken a `now` and handed it to the calendar connectors, so a ' +
      'rewound board scored its economic columns against releases the frame had actually seen. It ' +
      'never handed it to `fetchTechnicals`. The moving averages were therefore the tail of the ' +
      'series regardless of the date being reproduced, and `scripts/parity.ts` printed "rewound to ' +
      'end of that day" over a comparison in which one column was not rewound at all.',
    productionAction:
      'DONE. `seriesAsOf` in lib/connectors/technicals.ts drops bars after the cutoff; ' +
      '`runSetupsPipeline` takes a `pricesAsOf` option and the parity scripts pass their capture ' +
      'date. NOT a formula change — `scoreTrend` and `TREND_SMA` are untouched, which is the ' +
      'difference between reproducing our own rule at the right moment and fitting a new one to A1. ' +
      'The price cutoff is deliberately SEPARATE from `now`: rewinding `now` too narrows the calendar ' +
      "fetch and loses the RBNZ's future-dated decision, which cost NZDX's rates cell when both were " +
      'conflated. Live scoring is unaffected — `seriesAsOf` returns the same object when nothing is ' +
      'after the cutoff. Regression tests in lib/connectors/technicals.test.ts.',
  },
  {
    key: 'consumer-confidence:CHF',
    component: 'Cnsmr Conf',
    symbol: 'CHF',
    date: '2026-08-24',
    ours: '-1',
    a1: '+1',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's own free Consumer Confidence page, CHF, release 2026-08-07: actual -33 against forecast " +
      '-34, a beat, +1. Ours for the same release: actual -35 against forecast -34, a miss, -1. The ' +
      'FORECASTS ARE IDENTICAL and the release dates match to the day; only the actual differs. A1s ' +
      'leg is +1 by algebra too — their EURX consumer-confidence cell reads +1 (so EUR = +1) and ' +
      'their checksummed EURCHF row reads 0, which forces CHF = +1. CAVEAT ADDED 2026-08-30: ' +
      'their CHFX row prints 0 for this column on 2026-08-25, contradicting both that algebra ' +
      'and their own published -33 vs -34. Of the three CHF legs where the two routes disagree, ' +
      'CHFX matches their published data on mpmi and rates and EURCHF matches it here, so ' +
      'NEITHER route is authoritative. The source difference in the ACTUAL is unaffected — it ' +
      'rests on their series page, not on either derivation.',
    confidence: 'PROVEN',
    rootCause:
      'Our feed reports a different actual for the same SECO release than A1 holds. Same series, same ' +
      'date, same forecast, different number.',
    productionAction:
      'NONE, and the number cannot be sourced. TradingView carries this SECO series independently ' +
      "and agrees with A1 on the four releases before this one — 2026-07-10 -36/-35, 2026-06-15 " +
      '-38/-38, 2026-05-08 -40/-46, 2026-04-10 -43/-32, all identical on both actual and forecast — ' +
      'then reads -35 for 2026-08-07 where A1 reads -33. Same series, four months of agreement, one ' +
      'disagreeing print. No feed available to us produces -33, and the CHF leg for this column ' +
      'moves between their own two boards anyway (+1 on 08-24, 0 on 08-25), so no single value ' +
      'could match both. THIS ALSO closes a standing temptation. The long-running proposal was to score CHF ' +
      "consumer confidence against the PREVIOUS print instead of the forecast, because that produced " +
      "A1's +1. It is now refuted: A1 compares against the forecast, holds the same forecast we do, " +
      'and reaches +1 from a different actual. Changing the comparison would have been the right ' +
      'answer for the wrong reason, and would have broken every other currency on that column.',
  },
  {
    key: 'mpmi:GBP',
    component: 'mPMI',
    symbol: 'GBP',
    date: '2026-08-24',
    ours: '0',
    a1: '-1',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's own free Manufacturing PMI page, GBP flash of 2026-08-21: actual 51.5 against forecast " +
      '51.6, a miss, -1. Ours for the same release: actual 51.5 against forecast 51.5, a match, 0. ' +
      'Same actual, same date, forecast differs by 0.1.',
    confidence: 'PROVEN',
    rootCause:
      'A one-decimal difference in the consensus our calendar carries. Both models then apply the ' +
      'same rule to different inputs and land either side of the line.',
    productionAction:
      'NONE. There is no threshold to tune here — a deadband would not help, it would make the cell ' +
      '0 under A1s numbers too, which is wrong in the other direction. CORROBORATED 2026-08-31 from ' +
      'two directions: `npm run self-consistency` files this release A1_SELF_CONSISTENT with source ' +
      'REFERENCE_DIFFERS, so their cell is exactly what their own pair implies; and TradingView ' +
      'independently carries 51.5 as the consensus, agreeing with FXStreet against A1. Two ' +
      'calendars, one number, and it is not 51.6.',
  },
  {
    key: 'mpmi:CHF',
    component: 'mPMI',
    symbol: 'CHF',
    date: '2026-08-24',
    ours: '-1',
    a1: '+1',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "A1's own free Manufacturing PMI page, CHF release 2026-08-03: actual 53.2 against forecast " +
      '54.5 — a clear miss, and OUR NUMBERS ARE IDENTICAL to theirs. Any rule applied to that pair ' +
      'gives -1. But their own cells force +1: their EURX mPMI reads +1 (EUR = +1) and their ' +
      'checksummed EURCHF mPMI reads 0, so CHF = +1.',
    confidence: 'STRONG',
    rootCause:
      "A1's published CHF mPMI data contradicts the CHF leg implied by their own cells. Either the " +
      "EURCHF row's mPMI cell is not EUR minus CHF, or one of the two is stale against the other.",
    productionAction:
      'NONE. Our cell already agrees with A1s own published input; it is their output that does not. ' +
      'Note the pattern: BOTH CHF legs that disagree with A1s published data (this and rates) are ' +
      'derived through the EURCHF row, and the CHF leg read directly off CHFX agrees. Weight EURCHF ' +
      'derivations accordingly.',
  },
  {
    key: 'rates:usd-leg',
    component: 'Interest Rates',
    symbol: 'USD',
    date: '2026-08-24',
    ours: '-1',
    a1: '0',
    classification: 'UNKNOWN',
    evidence:
      "A1 publishes both halves of their comparison free: the standing policy rate (Interest Rates " +
      'page) and market-consensus projections by calendar quarter (Interest Rate Projections). On ' +
      '2026-08-30 the current quarter against the standing rate gives USD 3.75->3.75 (0), EUR ' +
      '2.40->2.65 (+1), GBP 3.75->4.00 (+1), CHF 0.00->0.00 (0), NZD 2.25->2.75 (+1). Those five ' +
      'legs reproduce SIX of A1s own cells across three dates: EURUSD +1, GBPUSD +1, EURCHF +1 ' +
      '(2026-08-24), CHFX 0, NZDX +1 (2026-08-25), EURCHF Bullish (2026-08-29 Forex Scorecard). ' +
      'SAME-DAY TEST, 2026-08-30: reading their projections and their EURCHF scorecard on one day ' +
      'eliminated a rival. The quarter-over-quarter reading (EUR 2026Q3 2.65 -> 2026Q4 2.65) ' +
      'predicts a Neutral rates cell; A1 printed Bullish. The current-quarter-against-standing-rate ' +
      'reading predicts Bullish and matches. A third reading, 2026Q2 -> 2026Q3 within the chart, ' +
      'gives an IDENTICAL leg set for all five currencies, so the leg assignment does not depend on ' +
      'choosing between those two. The one remaining exception is EURXs 2026-08-24 rates cell, read ' +
      'as 0 where the rule says +1 - and see `rates:EURX`, whose checksum cannot test that cell.',
    confidence: 'STRONG',
    rootCause:
      'Our projection branch compares the dot plots current-year median to its next-year median — ' +
      'two projections a year apart. A1 compares the nearest projected rate to the rate standing ' +
      'today. Different question, and for USD it is the difference between -1 and 0.',
    productionAction:
      'NONE, and the reason is a measurement rather than caution. The change was implemented on ' +
      '2026-08-30 and reverted the same session: the Fed is the only bank whose own projection this ' +
      'repo holds, so it moves USD alone while EUR and GBP sit at a placeholder 0. Cell parity went ' +
      '84/98 -> 82/98 and the rates column 5/6 -> 3/6 exact, with NO cell gained — EURUSD previously ' +
      'read +1 as EUR(0) - USD(-1) and became 0, where A1s +1 is EUR(+1) - USD(0). A differenced ' +
      'column cannot be adopted one currency at a time. Needs a quarterly consensus feed for every ' +
      'major at once; FXStreet carries projections for the Fed alone.',
  },
  {
    key: 'rates:EURX',
    component: 'Interest Rates',
    symbol: 'EURX',
    date: '2026-08-24',
    ours: '0',
    a1: '0',
    classification: 'TRANSCRIPTION_ERROR',
    evidence:
      'The cell agrees, which is why it is easy to miss. It is listed because it is the ONLY ' +
      'observation anywhere that contradicts the rates rule. What changed this round is that the ' +
      "row's checksum turns out to be blind to it. Two independent lines of evidence each say one " +
      'EURX cell is off by one, in OPPOSITE directions: the rates cell should be +1 (their own ' +
      'published EUR policy rate 2.40 against their own 2026Q3 projection 2.65) and the ' +
      'unemployment cell should be -1 (forced by their own EURUSD -2 and their own metals USD +1). ' +
      '+1 and -1 cancel, so the row sums to its printed 7 either way. The checksum that admitted ' +
      'this row never tested either cell - see lib/scoring/index-rows.test.ts.',
    confidence: 'STRONG',
    rootCause:
      'A pair of compensating misreads on one crowded multi-row crop is now the simplest explanation ' +
      'that satisfies every other row on the same board. The alternative the cell forces at face ' +
      'value (EUR 0, USD -1, GBP 0, CHF -1) matches A1s own published rate inputs for not one of ' +
      'those four currencies, and its unemployment half is separately contradicted.',
    productionAction:
      'NONE, and specifically NOT a fixture edit. Recording that a checksum is blind is not licence ' +
      'to correct a cell - the fixture keeps what was read and `solveA1Legs` keeps using it. What ' +
      'this DOES license: stop quoting this cell as a counter-example to the rates rule, and stop ' +
      'treating legs solved through it (USD rates = -1, CHF rates = -1) as measurements.',
  },
  {
    key: 'unemployment:EUR',
    component: 'Unemploy. Rate',
    symbol: 'EURX',
    date: '2026-08-24',
    ours: '-1',
    a1: '0 (EURX row), -1 (their own EURUSD and metals)',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "CLOSED BY ALGEBRA, not by a new capture. A1's gold and silver rows carry the dollar leg and " +
      'nothing else, inverted, and agree with each other in all fourteen economic columns, which puts ' +
      'USD unemployment at +1. Their EURUSD row prints -2. EUR = EURUSD + USD = -1, which is exactly ' +
      'the cell we produce. Their EURX row prints 0. That 0 is unreconcilable with their own EURUSD ' +
      'and their own metals, and the same three rows reconcile on 13 of the 14 economic columns, so ' +
      'the method is not in doubt — see lib/scoring/index-rows.test.ts.',
    confidence: 'STRONG',
    rootCause:
      "Not a comparison-basis difference and not a forecast difference. A1's EURX cell disagrees with " +
      "A1's other rows on the same board; ours agrees with them.",
    productionAction:
      'NONE, and the column is no longer an open question. The standing proposal was to score EUR ' +
      'unemployment against the PREVIOUS print because A1 publishes no forecast — that would have ' +
      'moved a cell their own board says is already right. Do not reopen without a checksum-valid ' +
      'EURX row from a different date.',
  },
  {
    key: 'ppi:GBP',
    component: 'PPI YoY',
    symbol: 'GBP',
    date: '2026-08-24',
    ours: '-1',
    a1: '+1',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "MECHANISM FOUND 2026-08-30, and it is a bug in their pipeline rather than a rule. A1's own PPI " +
      'YoY page classifies each release Met / Lower than expected / Higher than expected. Hovering ' +
      'the buckets: iul. 2026 reads "Forecast: 0,00%" and "Higher than expected: 3,50%", and apr. ' +
      '2026 reads "Forecast: 0,00%" and "Higher than expected: 2,60%". Both are releases for which ' +
      'no consensus exists. Where a forecast IS present they classify correctly — aug. 2026 forecast ' +
      '3,20% against actual 3,10% is Lower, iun. 2026 forecast 4,00% against actual 4,00% is Met. So ' +
      'a NULL forecast is being coerced to zero, every actual clears it, and the release scores ' +
      'Higher regardless of the number. That is exactly the +1 their board carries for the ' +
      '2026-07-22 print, whose consensus our feed also lacks.',
    confidence: 'PROVEN',
    rootCause:
      'Not our comparison and not a different series. A1 classifies a forecast-less release as a ' +
      'beat because null sorts as 0. Our own -1 on the same release comes from `compareByCurrency: ' +
      "{ GBP: 'previous' }` measuring 3.5 against a 4.0 previous, which is a different question from " +
      'the one A1 asks and happens to give the honest sign here.',
    productionAction:
      'NONE, and specifically DO NOT reproduce it. Imitating a null-coerced-to-zero comparison would ' +
      'put a +1 on every forecast-less release in the book. Our own cell is -1 and stays -1; it ' +
      'reaches that sign by a different route than their page does (3.1 against a 3.5 previous, ' +
      "where their page reads 3.1 against a 3.2 forecast), which is `compareByCurrency: { GBP: " +
      "'previous' }` doing what it was set up to do. Release selection was re-checked this round " +
      'and is correct: the 2026-08-19 print is the freshest before the board and is the one we ' +
      'score. CORRECTION 2026-08-31 to the paragraph this replaces, which claimed their page and ' +
      'board agree once the right bucket is read. That rested on their month buckets being ' +
      'REFERENCE months. They are RELEASE months — their `iul. 2026` pair is our 2026-07-22 release ' +
      'and their `aug. 2026` pair is our 2026-08-19 one, matching on all four numbers — so the ' +
      'aug. bucket WAS public five days before the board. Their page classifies it Lower and their ' +
      'board carries +1. The board is a release behind their own page, and the stale release scores ' +
      '+1 only because of the null coercion above. See `wasPublishedBy` in a1-self-consistency.ts, ' +
      'which now reports this as A1_RELEASE_DATE_AMBIGUOUS rather than asserting either way: the ' +
      'bucket names a month and the board names a day.',
  },
  {
    key: 'gdp:GBP',
    component: 'GDP',
    symbol: 'GBP',
    date: '2026-08-24',
    ours: '+1 (GBP leg)',
    a1: '0 (GBP leg)',
    classification: 'FIXED',
    evidence:
      "A1's own free GDP page, GBP release 2026-08-13, tooltip verbatim: As expected 0,4% | " +
      'Forecast 0,4% | Missed Forecast 0,0% | Beat Forecast 0,0%. The ONS published TWO growth ' +
      'series that morning and our calendar carries both: GDP (MoM) 0.3 against a 0.0 forecast, a ' +
      'beat; GDP (QoQ) 0.4 against a 0.4 forecast, a tie. A1s pair is the QUARTERLY one, actual and ' +
      'forecast, to the decimal. Their board agrees: the GBP gdp leg solves to 0 twice over, from ' +
      'GBPUSD +1 against a known USD leg of -1, and from their GBPX row.',
    confidence: 'PROVEN',
    rootCause:
      "`matchByCurrency` named `Gross Domestic Product (MoM)` first for GBP, on the strength of A1's " +
      'UK heatmap CARD naming its row GDP Growth MoM. That reading of the card was correct and the ' +
      'card is not what their board scores — a distinction this repo has already recorded on other ' +
      'economies, where the card and board row sets differ in both directions. Their GDP page is ' +
      'labelled MoM too and carries the quarterly NUMBERS; the numbers are what can be checked.',
    productionAction:
      'DONE, by DELETING the GBP override rather than adding anything. The UK now falls through to ' +
      'the quarterly-first default every other major uses. Canada keeps its override because it has ' +
      'no timely quarterly at all — an availability fact, not a preference — so this leaves exactly ' +
      'one special case where there were two. Moved GBPUSD gdp from MISMATCH to EXACT and brought ' +
      'the GBPX gdp cell onto their solved leg; no other cell changed.',
  },
  {
    key: 'retail-sales:GBP',
    component: 'Retail Sales',
    symbol: 'GBP',
    date: '2026-08-24',
    ours: '0',
    a1: '-1',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's own free Retail Sales page, GBP release 2026-08-21, tooltip verbatim: Retail Sales MoM " +
      '-0,50% | Forecast -0,40% | Revisions 0,00%. Actual -0.50 against forecast -0.40 is a miss, ' +
      '-1. Ours for the same release: the same actual -0.5% against a forecast of -0.5%, a tie, 0. ' +
      'Their -1 agrees with the GBP retail leg derived from their own board.',
    confidence: 'PROVEN',
    rootCause:
      'A 0.1 difference in the consensus our calendar carries - the same shape as `mpmi:GBP`, on ' +
      'the same currency. Both models apply the same rule and land either side of the line.',
    productionAction:
      'NONE, and the number to fabricate does not exist: FXStreet and TradingView independently ' +
      'carry -0.50 for this release. Of GBPs four disagreeing economic cells, gdp turned out to be ' +
      'ours (wrong series, now fixed), mpmi and this one are consensus differences of exactly 0.1, ' +
      'and ppi is A1 scoring a release their own page has superseded. Not one of the three ' +
      'remaining is a rule we have wrong.',
  },
  {
    key: 'rates:eur-policy-rate',
    component: 'Interest Rates',
    symbol: 'EUR',
    date: '2026-08-30',
    ours: '2.25 (ECB deposit facility)',
    a1: '2.40 on one page, 2.15 on another',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'Read on the same day from two A1 surfaces. Their Interest Rates page has EUR at 2.40% for ' +
      'jul. 2026 and aug. 2026; their Carry Trade Scanner has EUR at 2.15% (EURUSD row: base 2,15%, ' +
      'quote 3,75%). USD 3.75, GBP 3.75 and NZD 2.25 agree exactly across both pages - EUR is the ' +
      'only disagreement. The shape of their series identifies which ECB rate they track: 4.5, ' +
      '4.25, 3.65, 3.4, 3.15, 2.9, 2.65, 2.4, 2.15 is the Main Refinancing Operations rate step for ' +
      'step, not the deposit facility we read (4.0, 3.75, 3.5, 3.25, 3.0, 2.75, 2.5, 2.25, 2.0).',
    confidence: 'PROVEN',
    rootCause:
      'Their Carry Trade Scanner has not picked up the move their own Interest Rates page shows in ' +
      'jul. 2026. Their Data Updates Log refreshes `Central bank interest rates` daily and the ' +
      '`Carry trade scanner` four times a day, so this is a stale join on their side rather than ' +
      'two different definitions.',
    productionAction:
      'NONE today - against a 2.65 projection the EUR leg is +1 from either 2.15 or 2.40, so the ' +
      'cell is unaffected. Recorded because any future implementation of the rates rule must use ' +
      "A1's MRO series and not our deposit facility, and must prefer the Interest Rates page over " +
      'the carry scanner when the two disagree.',
  },
  {
    key: 'unemployment:CHF',
    component: 'Unemploy. Rate',
    symbol: 'EURCHF, CHFX',
    date: '2026-08-24',
    ours: '0 (CHF leg)',
    a1: '-1 (CHF leg)',
    classification: 'FIXED',
    evidence:
      'SECO publishes an ADJUSTED and an UNADJUSTED Swiss unemployment rate on the same morning and ' +
      'FXStreet carries only the adjusted one. Two pieces of A1 output name the unadjusted series, ' +
      'and neither is a board total. (1) Their free Unemployment Rate page, CHF, Dec 24 -> Jun 26: ' +
      '2,80 3,00 2,90 2,90 2,80 2,80 2,70 2,70 2,80 2,80 2,90 2,90 3,10 3,20 3,20 3,10 3,00 3,00 ' +
      '2,90 — winter highs and summer lows, which an adjusted series does not have; the last five ' +
      'agree with TradingView Switzerland to the decimal. (2) Their CH heatmap card, row dated ' +
      '`Jan 9, 26`: actual 3.1, forecast blank, previous 2.9 — no ADJUSTED print has ever gone ' +
      '2.9 -> 3.1, and the unadjusted one did, in December 2025. The board release is 2026-08-06 ' +
      '(period July): unadjusted 2.9 -> 3.0 is a RISE and scores -1; adjusted 3.1 -> 3.1 is flat ' +
      'and scores 0. Their leg is -1 on BOTH boards, by two independent routes.',
    confidence: 'PROVEN',
    rootCause:
      'A different series for the same statistic. `matchByCurrency` named ' +
      "`Unemployment Rate s.a (MoM)` for CHF, so the column read the adjusted rate, which is flat " +
      'by construction and therefore neutral for most of the year.',
    productionAction:
      'DONE. The unadjusted rate arrives through `TRADINGVIEW.actualSeries` — the same allowlist AUD ' +
      "household spending uses — published as `Unemployment Rate`, and CHF's matcher names that " +
      'string. NOT a scoring change: `scoreSlot`, `ternarySign` and the CHF previous-basis are all ' +
      'untouched, and the adjusted series is deliberately NOT kept as a fallback, because a silent ' +
      'swap to a different statistic produces a confident wrong cell where a blank would be honest. ' +
      'Moved EURCHF and CHFX unemployment from MISMATCH to EXACT; no other cell changed. ' +
      'THE PREVIOUS ROUND FILED THIS AS "would make it worse" AND THAT WAS A READING ERROR: their ' +
      "page's last value, 2,90, was read as the latest print. It is JUNE. July is 3,00 and the " +
      'board used July. Regression tests in lib/scoring/setups.test.ts hold both series in the pool ' +
      'at once, and lib/connectors/tradingview.test.ts pins the allowlist invariants.',
  },
  {
    key: 'spmi:NZD',
    component: 'sPMI',
    symbol: 'NZDX',
    date: '2026-08-25',
    ours: '0',
    a1: '-1',
    classification: 'FIXED',
    evidence:
      "BusinessNZ's Performance of Services Index, released 2026-08-16. FXStreet carries it as " +
      'actual 50.6, previous 50.6, revised 50.9 — the July print of 50.6 having since been restated ' +
      'to 50.9. Nobody forecasts this survey on any calendar, so the comparison is against the prior ' +
      "print, which is A1's own rule (their NZ card shows this row with a blank Forecast and a " +
      'Surprise of actual minus previous). Against the ANNOUNCED 50.6 the print is flat and scores ' +
      '0; against the RESTATED 50.9 it fell and scores -1. A1s 2026-08-25 board carries -1. ' +
      "TradingView's `previous` column for the same release independently reads 50.9.",
    confidence: 'PROVEN',
    rootCause:
      'A prior-print comparison was reading `previous` — last period as first announced — rather ' +
      'than `revised`, the restatement. After a revision the earlier figure is history, and every ' +
      'other calendar publishes only the restated one. Invisible on any series that is never ' +
      'revised, which is most of them.',
    productionAction:
      'DONE. `priorPrint(event)` in lib/scoring/discrete.ts returns `revised ?? previous`, used ' +
      'everywhere a prior print serves as the reference: `resolveSeries`, `scoreSlot` and ' +
      '`scoreCompositeSlot`. A forecast-based comparison is untouched — a revision restates last ' +
      "period's number, it cannot restate a consensus published before it. Moved NZDX sPMI from " +
      'MISMATCH to EXACT and moved nothing else in either direction; only one release in the ' +
      'current window carries both a prior-print basis and a revision. Regression tests in ' +
      'lib/scoring/setups.test.ts pin the revised case, the unrevised fallback and the ' +
      'forecast-basis no-op.',
  },
  {
    key: 'gdp:NZD',
    component: 'GDP',
    symbol: 'NZDX',
    date: '2026-08-25',
    ours: '-1',
    a1: '0',
    classification: 'UNKNOWN',
    evidence:
      'New Zealand published one GDP release in the window: 2026-06-17, Q1, GDP (QoQ) actual 0.8 ' +
      'against a 0.9 forecast. FXStreet and TradingView agree on both numbers, so the inputs are ' +
      'not in question, and a miss can only be -1. A1s 2026-08-25 board carries 0. The QoQ series ' +
      'is right — their own NZ card names the row GDP Growth QoQ.',
    confidence: 'STRONG',
    rootCause:
      'Unknown. THE OBVIOUS EXPLANATION IS ALREADY DISPROVEN: a staleness cut would do it, the ' +
      'release being 69 days old on that board — but A1 scores CHF GDP non-zero from a release of ' +
      '2026-06-01, which is 85 days old on the same board. So they do not zero a quarterly print at ' +
      'anything like that age. A different consensus would also do it (0.8 against 0.8 is a Met), ' +
      'and that is untested because their free GDP page was read for GBP and not for NZD.',
    productionAction:
      'NONE. No mechanism, and the one mechanism that fits is contradicted by another cell on the ' +
      'same board. The cheap next step is their free GDP page with the currency filter set to NZD, ' +
      'which would settle it the way the GBP reading settled `gdp:GBP`. ' +
      'CONFIRMED LIVE 2026-08-31 and the confidence is raised from WEAK on that basis. A live ' +
      'board screenshot taken that morning still prints 0 for NZDUSD GDP while our LIVE pipeline ' +
      '- no rewind, no fixture, calendar 1.6h old - scores -1 from the same 2026-06-17 release ' +
      'that both FXStreet and TradingView carry as 0.8 against a 0.9 forecast. So the difference ' +
      'is persistent across a week and is not an artifact of the replay harness. Still one ' +
      'release, so still no mechanism.',
  },
  {
    key: 'rates:projection-seam',
    component: 'Interest Rates',
    symbol: 'all',
    date: '2026-08-24',
    ours: 'scored from projections since 2026-09-01',
    a1: 'scored from projections',
    classification: 'FIXED',
    evidence:
      'THE RULE IS KNOWN AND THE HISTORICAL INPUT IS NOT, and those are separate facts. ' +
      "`sign(projection - standing policy rate)` off A1's own two free pages reproduces six of " +
      'their legs on the day it was read: USD 0, EUR +1, GBP +1, CHF 0, NZD +1. Applied to the ' +
      'EURCHF rates cell it gives their +1 exactly, where we print 0. But their Interest Rate ' +
      'Projections page has a currency filter and nothing else — no date control, no history, no ' +
      'revision log — so the number that reproduces it was read on 2026-08-30, six days after the ' +
      'board it would be scoring.',
    confidence: 'PROVEN',
    rootCause:
      'Not a scoring gap. A missing dated input, on a surface that publishes no history and can ' +
      'therefore only be accumulated forwards.',
    productionAction:
      'DONE 2026-09-01 - SHIPPED, and the blocker was the DATA, never the rule. A second reading ' +
      'of their Interest Rate Projections page covers all eight majors (the first covered five), ' +
      'taken from the bar chart tooltips which print every selected currency for one quarter at ' +
      'once. sign(current quarter - standing) then reproduces ALL EIGHT published legs on the ' +
      '2026-08-31 AND 2026-09-01 captures: EUR/GBP/JPY/NZD/USD +1, AUD/CAD/CHF 0. npm run ' +
      'board-parity puts the Rates column at 51 of 51 rows exact, from 28 agree / 23 differ. ' +
      'Two guards carry the safety the old refusal used to. resolveConsensusProjectionLegs is ' +
      'ALL-OR-NOTHING per board and is resolved once above the per-currency loop, so a leg from ' +
      'this rule can never be differenced against a leg from the fallback ladder - the exact ' +
      'cancellation seam rates:usd-leg records. And quarterValueStep records how coarsely each ' +
      'reading was transcribed, so a projection within half a step of the standing rate is ' +
      'refused rather than called: AUD 4.4 vs 4.35 and CAD 2.3 vs 2.25 are unreadable at one ' +
      'decimal, and A1 prints 0 for both. Strictly-backwards reads and the absence of any ' +
      'nearest-available fallback are UNCHANGED and must stay that way. The structural test ' +
      'narrowed rather than disappeared: rates.ts may import only the TYPE, so no per-currency ' +
      'call site can bypass the gate. See HARDENING.md 3. ' +
      'THE HISTORY BELOW STANDS AND IS STILL LOAD-BEARING. ' +
      'THEIR INTEREST RATES PAGE IS NOT A SAFE SOURCE FOR THE STANDING RATE, recorded 2026-08-31 ' +
      'for whoever wires this later. That page shows NZD at 2.25% from dec. 2025 through aug. ' +
      '2026. The RBNZ actually hiked to 2.50% on 2026-07-08 - our calendar carries that decision ' +
      'with actual 2.5 against a previous 2.25, and the next meeting on 2026-09-02 is forecast at ' +
      '2.75 against a standing 2.50. So A1s own rates page is a full hike behind. It does not ' +
      'change the NZD leg (2.75 is above both 2.25 and 2.50, so +1 either way), which is why this ' +
      'was invisible until the standing rate was read directly. Take the standing rate from the ' +
      'CALENDAR, never from their page. ' +
      'NONE IN SCORING, and the seam is deliberately left unwired. lib/scoring/rate-projections.ts ' +
      'takes DATED snapshots, reads strictly backwards from the date asked for, and returns an ' +
      'explicit NO_SNAPSHOT_YET for every date before the first reading — which today is every ' +
      'board on file. There is no nearest-available fallback and there must never be one: that is ' +
      'the same defect as `trend:as-of` and `cot:publication-lag`, both of which looked like ' +
      'harmless leniency and both of which silently invented parity. A test asserts the module is ' +
      'imported by no scoring path, and another asserts that it WOULD close EURCHF and still ' +
      'refuses the 2026-08-24 board. fixtures/a1-rate-projections.json is the append-only store; ' +
      'one snapshot is not a series - which is exactly what the second reading changed.',
  },
  {
    key: 'a1:ppi-pair-rows-read-the-stocks-impact',
    component: 'PPI YoY',
    symbol: 'all pairs',
    date: '2026-09-01',
    ours: 'leg(base) - leg(quote), following their currencyImpact',
    a1: 'the exact negation on every pair row',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'CONFIRMED ON 112 OBSERVATIONS ACROSS FOUR CAPTURES (2026-09-02). `npm run a1-truth-table` ' +
      'scores every FX pair row against the two index rows it differences, pooled over the ' +
      '2026-08-31, 09-01, 09-01 14:33 and 09-02 09:04 boards: PPI fits quote - base 112 of 112 and ' +
      'base - quote 28 of 112, while GDP, sPMI, Retail Sales, CPI, NFP, Unemployment Rate, ' +
      'Unemployment Claims, ADP and JOLTS all fit base - quote 112 of 112. The negation is exact, ' +
      'universal and stable across days. ' +
      'THE GLOBAL SIGN FLIP HAS A CAUSE AND IT IS NAMEABLE. Earlier rounds recorded that A1s pair ' +
      'rows negate PPI on all 21 differing cells and left it as unexplained breakage. Solving the ' +
      'pair rows ALONE for an eight-currency leg vector (lib/scoring/a1-pair-legs.ts, feeding the ' +
      'solver that already existed for row-sum checking) fits 29 of 29 pair rows exactly - a ' +
      'broken surface cannot do that. The solved vector is the exact negation of the index vector ' +
      'on all eight currencies. Their own country heatmap publishes currencyImpact AND ' +
      'stocksImpact per release, and the two are opposite whenever either is non-neutral: their ' +
      'INDEX legs follow currencyImpact and their PAIR legs follow stocksImpact, 8 economies of ' +
      '8, identical on the 2026-08-31 and 2026-09-01 captures.',
    confidence: 'PROVEN',
    rootCause:
      'A wiring error on their side, not noise: their pair board reads the wrong impact column ' +
      'for this series. The sign flip is the symptom.',
    productionAction:
      'NONE IN SCORING, and deliberately so. The tiebreak is the release, not a vote between two ' +
      'of their surfaces: UK PPI printed 3.1 against a 3.2 forecast, a miss is bearish for the ' +
      'currency that missed, their heatmap says Bearish and their index row says -1. We score -1 ' +
      'and we keep scoring -1. What shipped is visibility: npm run board-parity attributes these ' +
      '21 cells to A1-vs-A1 rather than to us (the column carries 61 points of absolute gap and ' +
      'exactly ONE of them is ours), and the A1 mirror toggle on Top Setups re-derives the column ' +
      'under their convention so the difference is checkable cell by cell. Pinned by test against ' +
      'both captures AND against their heatmap impact columns, so a capture where they fix it ' +
      'fails loudly. See HARDENING.md 7a.',
  },
  {
    key: 'macro:consumer-confidence-six-uncovered-legs',
    component: 'Cnsmr Conf',
    symbol: 'all pairs',
    date: '2026-09-01',
    ours: 'scored for AUD and NZD only',
    a1: 'a full ternary leg vector on all eight, on their PAIR rows',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      'THE MIRROR IMAGE OF THE PPI FINDING, AND IT POINTS AT US. Solving their pair rows for a leg ' +
      'vector fits 29 of 29 and yields GBP +1, CHF +1, AUD +1, EUR 0, JPY -1, NZD -1, CAD -1, ' +
      'USD -1 - while their index rows print 0 for seven of eight and NONE of their nine country ' +
      'heatmaps carries a consumer-confidence row for anyone but the US. So the pair board is the ' +
      'surface carrying information here and the index rows are the blank one, which is the exact ' +
      'reverse of PPI. The one leg both of their surfaces carry is USD at -1, and they agree. We ' +
      'score AUD (Westpac) and NZD (ANZ-Roy Morgan) and match their pair legs on BOTH.',
    confidence: 'STRONG',
    rootCause:
      'Coverage, not arithmetic. A1 scores a consumer-confidence series for six economies we do ' +
      'not resolve one for; the two currencies we do resolve agree with them.',
    productionAction:
      'NONE YET, and this is the strongest open lead on the board. Do NOT fill the six legs from ' +
      'their capture: a1:no-consumer-confidence-series records that no A1 surface names the ' +
      'series for these economies, so there is nothing to source a fix TO, and copying a leg ' +
      'vector is the artificial data modification this project exists to avoid. The next round ' +
      'should look for a per-country series against a PRIMARY source (GfK for the euro area, ' +
      'GfK/S&P for the UK, SECO for Switzerland, the Cabinet Office for Japan, the Conference ' +
      'Board of Canada) and score it on the merits - triangulate-against-primary-sources. Until ' +
      'then the A1 mirror shows their captured cell, labelled as transcribed rather than ' +
      'computed. See HARDENING.md 7a.',
  },
  {
    key: 'crowd:board-wide',
    component: 'Crowd Sentiment',
    symbol: 'all',
    date: null,
    ours: 'CFTC small traders',
    a1: 'retail broker book',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "The transformation is CONFIRMED: given A1's own dated long share, `resolveCrowd` returns A1's " +
      'own cell 8 times out of 8 across two dates, two majors, a cross, two metals and three currency ' +
      'indices (`npm run crowd-oracle`). What differs on a live board is the population.',
    confidence: 'PROVEN',
    rootCause:
      'CFTC small traders are a weekly US-futures reportable population. A1 reads a daily spot ' +
      'retail-broker population. No threshold converts one into the other.',
    productionAction:
      'NONE in scoring. The provider seam already exists (`CrowdProvider`). A1 names no upstream ' +
      'vendor on any page, and their own dashboards are an oracle, not a dependency.',
  },
  {
    key: 'crowd:DXY',
    component: 'Crowd Sentiment',
    symbol: 'DXY',
    date: '2026-08-23',
    ours: '-1',
    a1: '+1',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "The whole of DXY's 2-point board gap, per `npm run parity`s per-slot attribution. A1's own " +
      'dashboard shows the dollar index at 92.51% long — a two-decimal value matching no dollar ' +
      'pair, so it is its own instrument with its own book.',
    confidence: 'STRONG',
    rootCause:
      'Same population difference as the column at large, on the one symbol where no dollar pair can ' +
      'stand in for the missing feed.',
    productionAction:
      'NONE. Deriving DXY from EURUSD would invent a basket A1 does not use. Deliberately excluded ' +
      'from `indexFromDollarPair`.',
  },
  {
    key: 'gbpx:residual',
    component: 'board total',
    symbol: 'GBPX',
    date: '2026-08-23',
    ours: '+1',
    a1: '0',
    classification: 'UNKNOWN',
    evidence:
      'RE-DERIVED 2026-08-31 after the GDP series fix, and the halves have swapped. A1s GBP ' +
      'economic legs, derived as GBPUSD + USD from the same capture, sum to EXACTLY 0; their ' +
      'published GBPX total is also 0; so their four instrument columns sum to 0 too. OUR ' +
      'ECONOMIC BLOCK NOW ALSO SUMS TO 0 - but by cancellation, not agreement: mpmi 0 vs their ' +
      '-1, retail-sales 0 vs their -1, ppi -1 vs their +1, which is -1 either way. The whole ' +
      'residual is therefore in the instrument block, where ours reads +1 (trend +2, seasonality ' +
      '-1, COT 0, crowd 0) against their 0.',
    confidence: 'STRONG',
    rootCause:
      'TWO ERRORS AGAIN, not one. Their book had GBPUSD at 31% long on 2026-08-24, which their ' +
      'own rule turns into a GBPX crowd cell of +1 where our CFTC read gives 0 - so their crowd ' +
      'is +1 and their remaining three columns sum to -1, against our +1. We are ONE POINT LOW on ' +
      'crowd and TWO POINTS HIGH across trend, seasonality and COT. Trend is HISTORICAL as of ' +
      '2026-08-30 (the previous version of this entry said LIVE_ONLY and excused the gap as ' +
      'timing; that excuse is gone), so all three are genuinely replayable and none of them is ' +
      'explained.',
    productionAction:
      'NONE, and specifically do not infer the missing points from the total. Three unknown cells ' +
      'summing to a known number has a two-parameter family of solutions, which is how a fitted ' +
      'GBPX rule would get written. What settles it is a checksummed GBPX row - the `gbpx-row` ' +
      'request - and no FREE A1 surface carries a currency-index row at all (checked 2026-08-30: ' +
      'the Forex Scorecard is pairs only, the Asset Scorecard demo is locked to platinum). Note ' +
      'our GBPX COT cell (0) and our GBP COT leg (+1) differ BY DESIGN - an index row scores both ' +
      'COT components, a pair leg only the weekly change - so that is not the discrepancy it ' +
      'looks like.',
  },
  {
    key: 'polarity:silver',
    component: 'macro polarity',
    symbol: 'XAGUSD',
    date: '2026-08-24',
    ours: 'inverted (as gold)',
    a1: 'inverted (as gold)',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "A1's own GDP page says silver, copper, platinum and USOil score WITH the currency and that " +
      '"Gold is the exception". Their own cells say otherwise: on 2026-08-24 XAUUSD and XAGUSD carry ' +
      'identical gdp (+1), mpmi (-1) and consumer-confidence (+1) cells, which only works if silver ' +
      'inverts too.',
    confidence: 'STRONG',
    rootCause: "A1's published description does not match A1's published cells.",
    productionAction:
      'NONE. We follow their DATA and score silver inverted, which is why XAGUSD is 18/18 exact. Do ' +
      'not "fix" this to match their prose.',
  },
  {
    key: 'retail-sales:CAD-basis',
    component: 'Retail Sales',
    symbol: 'USDCAD, and every other Canadian pair',
    date: '2026-08-31',
    ours: '-1 (CAD leg), now +1',
    a1: 'unread',
    classification: 'FIXED',
    evidence:
      'FOUND BY TRIANGULATION AGAINST A PRIMARY SOURCE, NOT AGAINST A1. Statistics Canada put June ' +
      '2026 retail sales at +0.6 percent (The Daily, 2026-08-21) against a +0.4 percent consensus, ' +
      'carried by Reuters as a beat. We scored the CAD leg -1 by comparing +0.6 to the +1.0 prior ' +
      'print. The contradiction was also visible WITHOUT any external source: the leg printed a ' +
      'sigma of +0.86, computed against the consensus, beside a cell of -1.',
    confidence: 'PROVEN',
    rootCause:
      'An unconditional compareByCurrency { CAD: previous } on three slots — retail-sales, mPMI ' +
      'and sPMI. Its whole justification was one observation per slot: an A1 card whose Forecast ' +
      'column was BLANK and whose Surprise was actual minus previous. That evidence only ever ' +
      'described the no-forecast case, and scoreSlot ALREADY falls back to the prior print there. ' +
      'So the override was redundant exactly where its evidence applied, and active only where its ' +
      'evidence did not. It is the same defect class as the GBP GDP quarterly override, which was ' +
      'also fitted to one card and also removed rather than tuned.',
    productionAction:
      'DONE. All three CAD entries deleted from config/setups.config.ts. No formula changed: ' +
      'ternarySign, the polarity and the fallback are untouched, and only the reference handed to ' +
      'them moved. mPMI and sPMI are unaffected on the live board (Canada beat both consensus and ' +
      'prior print on one, missed both on the other); retail-sales moves the CAD leg by 2, which ' +
      'takes USDCAD from -11 to -13 — FURTHER from A1s -6, and that is the correct direction ' +
      'because the evidence is the release, not the board. Regression tests in ' +
      'lib/scoring/setups.test.ts pin both the beat and the blank-forecast fallback.',
  },
  {
    key: 'legs:revised-reference',
    component: 'Every economic column (reporting only)',
    symbol: 'NZDUSD sPMI is the live case',
    date: '2026-08-31',
    ours: 'cell -1, hover text said 50.6 vs 50.6',
    a1: 'n/a',
    classification: 'FIXED',
    evidence:
      'New Zealands PSI printed 50.6 against a raw previous of 50.6 that had been restated to 50.9. ' +
      'scoreSlot compares against priorPrint (revised ?? previous) and correctly returned -1, but ' +
      'the rendered leg reported event.previous, so the explanation a user reads was 50.6 vs 50.6 ' +
      '— a pair that implies 0 — printed beside a cell of -1.',
    confidence: 'PROVEN',
    rootCause:
      'toLegs in lib/scoring/setups.ts built reference from the raw previous while the score used ' +
      'the revised one. The comment directly above it asserted the two cannot quietly disagree ' +
      'later, and they disagreed for exactly as long as a revision existed. An explainability ' +
      'defect rather than a scoring one: no cell was ever wrong, but the sentence justifying the ' +
      'cell was, which is worse than useless on a board whose whole claim is that it shows its work.',
    productionAction:
      'DONE. toLegs now calls priorPrint. The raw previous is still carried separately on the leg, ' +
      'so nothing lost resolution. Regression test in lib/scoring/setups.test.ts.',
  },
  {
    key: 'sigma:reference-mismatch',
    component: 'Every economic column (reporting + diagnostics)',
    symbol: 'board-wide',
    date: '2026-08-31',
    ours: 'cell and sigma could disagree in sign',
    a1: 'n/a',
    classification: 'FIXED',
    evidence:
      'THE SYSTEMIC VERSION OF THE CANADIAN BUG. That one was found by a Statistics Canada ' +
      'release; this is the mechanism that let it hide. computeSurprise chose its OWN reference ' +
      'in three branches (FXStreets ratioDeviation, then consensus, then raw previous) with no ' +
      'knowledge of what scoreSlot had actually compared against. Whenever a per-currency basis, ' +
      'a no-consensus fallback or a revision moved the scored reference, the cell and the sigma ' +
      'printed beside it were measuring different comparisons. Live on 2026-08-31 that produced ' +
      'sigma +0.86 beside a cell of -1 on the Canadian retail leg: 0.6 against a 0.4 consensus ' +
      'for the sigma, 0.6 against a 1.0 prior print for the cell. Board-wide the audit now ' +
      'reports 0 violations across 270 cells.',
    confidence: 'PROVEN',
    rootCause:
      'Two independent choices of reference for one comparison. The fix removes the choice: ' +
      'computeSurprise now takes the scored reference and derives sigma from the same ' +
      'difference, so sign agreement holds BY CONSTRUCTION rather than by assertion. FXStreets ' +
      'own deviation is used only where we also scored against consensus AND it agrees in sign, ' +
      'because otherwise it is calibrated against a comparison we did not make.',
    productionAction:
      'DONE. lib/scoring/surprise.ts gained a scoredReference parameter; discrete.ts passes it. ' +
      'lib/scoring/consistency.ts audits a whole board for three properties: sigma may not ' +
      'oppose its cell, a legs printed actual/reference must reproduce its own cell, and a null ' +
      'cell may not claim scored. Wired into npm run freshness as a live diagnostic (currently 0 ' +
      'violations) and pinned by lib/scoring/consistency.test.ts, which injects the Canadian ' +
      'defect verbatim as a positive control.',
  },
  {
    key: 'consumer-confidence:NZD-AUD',
    component: 'Cnsmr Conf',
    symbol: 'NZDUSD, AUDUSD and every Antipodean cross',
    date: '2026-08-31',
    ours: '+1 per leg',
    a1: '-1 (NZD leg, inferred from their card)',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      'ANZ–Roy Morgan (NZD) and Westpac (AUD) are the monthly consumer confidence indices for ' +
      'those economies and BOTH ARE IN OUR FEED with actuals. NZ confidence ran 80.3, 86.5, ' +
      '91.3, 99.3 across four months; +1 is the honest read. A1s 2026-08-23 NZDUSD card implies ' +
      'a New Zealand leg of -1, and no NZ confidence series we carry reads bearish on that date.',
    confidence: 'STRONG',
    rootCause:
      'Unknown which series A1 reads. What IS known is why we were not scoring it: the series ' +
      'were wired on 2026-08-24 and removed the same day because TOTAL ABS GAP moved 96 to 102. ' +
      'That is a parity argument, and parity is not a reason to leave a current primary series ' +
      'unscored. The removal was the defect, not the wiring.',
    productionAction:
      'DONE — REVERSED. Both currencies are wired in the consumer-confidence matcher. The ANZ ' +
      'name carries an EN DASH in the feed, so the pattern accepts any of the three dashes ' +
      'rather than failing silently the way the GBP leg once did. COST, STATED PLAINLY: three ' +
      'component-parity cells moved from blank to MISMATCH and seven pairs moved away from A1. ' +
      'EXACT held at 108. Tests in lib/scoring/setups.test.ts, including the inverted guard that ' +
      'used to assert these resolved to nothing.',
  },
  {
    key: 'a1:pair-rows-invert-ppi',
    component: 'PPI',
    symbol: 'all 28 FX pairs',
    date: '2026-08-31',
    ours: 'polarity +1 (a beat is bullish)',
    a1: 'both, on two different pages',
    classification: 'A1_INCONSISTENCY',
    evidence:
      "EdgeFinder Free Week exposed A1's index rows and country heatmaps together for the first " +
      'time. The index rows reproduce the heatmaps 104 of 104 cells with zero mismatches, and ' +
      'GOLD/SILVER equal the negated US-DOLLAR row on 14 of 14 economic columns. Against those ' +
      'published legs the 28 pair rows are exactly leg-differenced on 9 columns — and on PPI they ' +
      'are the EXACT NEGATION, all 21 mismatches being clean sign flips. The heatmap shows its ' +
      'work: US PPI actual 4.7% against a 4.9% forecast is a miss, marked Bearish, index row -1. ' +
      'The pair row says +1. Reproduce with `npm run a1-surfaces`.',
    confidence: 'PROVEN',
    rootCause:
      "Two of A1's surfaces disagree on PPI polarity. Their heatmap arithmetic and index rows agree " +
      'with each other and with us; only the pair rows are inverted. Timing cannot explain a ' +
      'systematic sign flip — a stale feed produces noise, not a global negation.',
    productionAction:
      'NONE. Our polarity already matches the two A1 surfaces that show their work. Every PPI ' +
      'parity gap recorded before 2026-08-31 was measured against the inverted surface and must ' +
      'not be treated as pressure on scoring.',
  },
  {
    key: 'a1:no-consumer-confidence-series',
    component: 'Cnsmr Conf',
    symbol: 'all 8 majors',
    date: '2026-08-31',
    ours: 'scored for NZD, AUD and others',
    a1: '0 by absence',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      'PARTLY OVERTURNED 2026-09-02, and the overturned half is the important one. What follows ' +
      'remains true of the HEATMAPS. It is NOT true of A1 as a whole: their Economic Data > ' +
      'Economic Growth Data > Consumer Confidence page publishes an actual and a forecast series ' +
      'for all eight majors, and scoring it with the ordinary rule reproduces the leg vector their ' +
      'PAIR rows imply 7 of 8. See cnsmr-conf:index-rows-are-blank-not-neutral. The original ' +
      'observation, kept because it is what the heatmaps show: ' +
      'None of the 9 country heatmaps publishes a consumer confidence row. The board column ' +
      'labelled "Cnsmr Conf" is heatmap slot 8, which the US fills with Wage Growth YoY (3.2% ' +
      'against a 3.5% forecast, Bearish, index row -1) and every other country leaves empty. The ' +
      'index-row check treats an absent row as 0 and still lands 104 of 104, so the zeros are ' +
      'absence rather than measurement.',
    confidence: 'PROVEN',
    rootCause:
      'A gap in the HEATMAP surface, which is what was visible when this was written. Their ' +
      'Economic Data pages do publish the series; nothing there was reachable before full access. ' +
      'Original wording: No A1 surface that shows its arithmetic publishes a consumer confidence series. Their ' +
      'Forex Scorecard does print a "Consumer Confid." label, but for EURUSD it resolves to the ' +
      'USD slot-8 leg of -1, which the US heatmap names Wage Growth YoY. The pair rows do carry ' +
      'per-currency slot-8 values the heatmaps and index rows both score 0 - that contradiction ' +
      'is filed separately as a1:pair-rows-invert-ppi covers the same broken surface.',
    productionAction:
      'NONE to scoring, and the 2026-08-31 decision to wire NZ and AU consumer confidence still ' +
      'stands - it is a coverage gain, not an error. What changed is the NEXT step: there IS a ' +
      'surface to check the remaining six against, so "there is nothing to source a fix TO" is no ' +
      'longer a reason to leave them. Source them from the primary publishers and check against ' +
      'their Economic Data page; do NOT copy their leg vector.',
  },
  {
    key: 'rates:a1-policy-rates-disagree',
    component: 'Interest Rates',
    symbol: 'NZD, JPY, EUR',
    date: '2026-08-31',
    ours: 'NZD 2.50, JPY 1.00, EUR 2.25',
    a1: 'two different tables',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'A1 publishes policy rates on two pages that do not agree. Carry Trade Scanner: NZD 2.25, ' +
      'JPY 0.75, EUR 2.15, USD 3.75, GBP 3.75, AUD 4.35, CAD 2.25, CHF 0.00. Eco Strength Index, ' +
      'same day: NZD 2.50, JPY 1.00, EUR 2.40, USD 3.75, GBP 3.75, AUD 4.35, CAD 2.25, CHF 0.00. ' +
      'They differ on exactly the three currencies where we differ from the Carry page, and on ' +
      'NZD and JPY the Eco Strength values are OURS - 2.50 matches the RBNZ cut of 8 July and 1.00 ' +
      "matches the BoJ hike of June 2026. EUR splits three ways: 2.15 is the ECB's MRO, 2.40 the " +
      'marginal lending facility, and our 2.25 is on the deposit-facility basis the config names. ' +
      'USD 3.75 against our 3.63 is the target-range upper bound against the midpoint.',
    confidence: 'PROVEN',
    rootCause:
      'Two A1 surfaces read different rate tables. The Carry Trade Scanner lags an actual decision ' +
      'in NZD and JPY; the Eco Strength Index does not. Neither page says which basis it uses for ' +
      'the euro, where three defensible numbers exist.',
    productionAction:
      'NONE. Our NZD 2.50 and JPY 1.00 already match the current A1 surface and the central banks. ' +
      'Record the USD midpoint/upper-bound and EUR deposit/MRO/marginal conventions so future ' +
      'rates work does not read a basis difference as an error.',
  },
  {
    key: 'trend:conflicted-quadrant',
    component: 'Trend',
    symbol: 'every symbol on the board',
    date: '2026-09-01',
    ours: 'a dip below a RISING slow average scores -1, as it always did',
    a1: 'undecided - 15 of 27 such cases print -1, 12 print +2',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'ADOPTED AND REVERTED ON THE SAME DAY, and the reversal is the entry. Cross-tabulating A1s ' +
      'printed trend cell against the (crossover, slope) state over 51 symbols on TWO captures ' +
      'made the cross-/slope+ quadrant look like +2 in 67% against -1 in 33% (n=18), so the rule ' +
      'was changed to resolve that quadrant toward the slope. A THIRD capture, taken five hours ' +
      'after the second on the same day, pulled the quadrant to 15 against 12 - a coin flip with ' +
      '-1 back in front. Pooled over all three captures: cross+/slope+ is +2 in 96% (n=71), ' +
      'cross-/slope- is -2 in 89% (n=35), cross+/slope- is +1 in 70% (n=20), and cross-/slope+ ' +
      'is UNDECIDED at 56% (n=27). The docked rule also wins the candidate race outright once the ' +
      'third frame is in: 129 exact against 126, absolute error 61 against 70, and churn 14 ' +
      'against A1s own churn of 14 where the challenger moved 7. Reproduce with ' +
      '`npm run trend-solver`, which now prints the quadrant table.',
    confidence: 'STRONG',
    rootCause:
      'Not a rule of theirs that we had wrong. That quadrant is genuinely mixed in their output, ' +
      'and a 67% majority over n=18 was read as a rule when it was a sample. Their published ' +
      'description - a crossover with a slope modifier - is the only stable account of it.',
    productionAction:
      'NONE, and the code is back where it started: `scoreTrend` docks a conflicted crossover by ' +
      'one and never flips its sign. The revert IMPROVED the fresh measurement, which is the ' +
      'check that matters: against the 14:33 capture, Trend went from 40 agreeing and 11 ours to ' +
      '46 agreeing and 5 ours, absolute gap 33 -> 13. WHERE THE MEASUREMENT IS UNDECIDED, THE ' +
      'PUBLISHED DESCRIPTION WINS - that is the rule this cost a round to learn.',
  },
  {
    key: 'trend:fitted-on-one-day-picks-the-wrong-rule',
    component: 'Trend',
    symbol: 'method, not a symbol',
    date: '2026-09-01',
    ours: 'candidates scored on three captures, on churn, and on a quadrant table',
    a1: 'moved 0 trend cells overnight and 14 within one afternoon',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'THREE FITS, TWO REVERSALS, ONE LESSON. Fitted on the 2026-08-31 capture alone the docked ' +
      'rule scored 43/51 and was best of 27 candidates. The 2026-09-01 09:44 capture put it at ' +
      '38/51 while a challenger held 44 and 43, so the challenger was adopted. The 2026-09-01 ' +
      '14:33 capture - the SAME DAY, five hours later - put the challenger at 40/51 and the ' +
      'incumbent at 47/51, and the challenger was reverted. A1 moved zero trend cells overnight ' +
      'and fourteen within that afternoon, so the interval that mattered was never the one being ' +
      'sampled.',
    confidence: 'PROVEN',
    rootCause:
      'Counting captures is not the safeguard. Two captures a day apart were both taken in the ' +
      'same market state; a third from the same day overturned them. What actually protects a ' +
      'fit is the SIZE of the majority it rests on and whether the quadrant is decided at all.',
    productionAction:
      'NONE, this is a method note, and it now has teeth. `npm run trend-solver` prints A1s own ' +
      'cell distribution per (crossover, slope) quadrant pooled over every capture, and marks a ' +
      'quadrant UNDECIDED unless one value takes 60% of at least 20 observations. Do not overturn ' +
      'a rule read off their published description on anything weaker than that. Capture the ' +
      'board more than once a day: the intraday frame is what separates a rule that tracks the ' +
      'price series from one that tracks the clock.',
  },
  {
    key: 'seasonality:a1-lags-the-month-turn',
    component: 'Seasonality',
    symbol: 'all 51',
    date: '2026-09-01',
    ours: 'September bucket from 00:00 on 1 September',
    a1: 'rolled to September during 1 September, between 09:44 and 14:33 UTC',
    classification: 'TIMING',
    evidence:
      'THE LAG IS HOURS, NOT A MONTH, AND THE FIRST READING OF IT WAS TAKEN TOO EARLY IN THE DAY. ' +
      'Scored against the 09:44 capture our September signs matched 25 of 51 (49.0%, chance) ' +
      'while our AUGUST signs matched 45 (88.2%), which read as A1 not having turned the month at ' +
      'all. A second capture at 14:33 the same day reverses it: our September signs now match 43 ' +
      'of 51 (84.3%). Their seasonality column moved 20 cells between the two frames and not one ' +
      'macro cell moved. Reproduce with `npm run seasonality-probe` and `npm run board-parity`.',
    confidence: 'PROVEN',
    rootCause:
      'A1 recomputes seasonality during the first day of the month rather than at midnight. Our ' +
      'monthly averages agree with theirs either way - the 88% on August signs before the roll ' +
      'and the 84% on September signs after it are the same measurement taken on both sides of ' +
      'their refresh.',
    productionAction:
      'NONE, and specifically do NOT delay our own roll to match theirs. The divergence closes ' +
      'itself within a day. What this DID change is the measurement: board-parity now defaults to ' +
      'the newest capture and rewinds to the capture MINUTE, because a whole-day rewind gets ' +
      'exactly the intraday columns wrong. Against the 14:33 frame seasonality fell from 26 ' +
      'disagreements to 8. Do NOT re-introduce a magnitude threshold to damp our own flipping ' +
      'either - half the board carries a September mean under 0.5%, so the votes really are ' +
      'noise, but they are the SAME noise A1 scores.',
  },
  {
    key: 'macro:we-ingest-releases-first',
    component: 'mPMI, Retail Sales',
    symbol: 'JPY and CHF legs',
    date: '2026-09-01',
    ours: 'scored the 1 September prints',
    a1: 'still on the August prints at 09:44 UTC',
    classification: 'TIMING',
    evidence:
      'All 17 spurious macro moves in `npm run delta-parity` trace to exactly two legs: JPY mPMI ' +
      '(Jibun Bank Manufacturing PMI, released 2026-09-01) and CHF Retail Sales (Real Retail ' +
      'Sales YoY, released 2026-09-01). Every affected row is a yen or franc pair. A1 scored ' +
      'neither.',
    confidence: 'PROVEN',
    rootCause:
      'Release latency, in our favour. Their Data Updates Log lists no PMI feed at all and their ' +
      'economic calendar refreshes on its own cadence.',
    productionAction:
      'NONE. Being first to a genuine print is the behaviour we want. Recorded so a future round ' +
      'does not read these as scoring defects - the delta-parity report now prints the series ' +
      'name and release date beside every spurious macro move for exactly that reason.',
  },
  {
    key: 'technicals:spot-fx-friday-mis-dated',
    component: 'Trend, Seasonality',
    symbol: 'every =X FX pair',
    date: '2026-09-01',
    ours: "Friday's session re-dated from the Sunday stamp Yahoo gives it",
    a1: 'n/a - a data defect on our side, not a parity gap',
    classification: 'FIXED',
    evidence:
      "Yahoo's =X daily series returns Sunday, Monday, Tuesday, Wednesday, Thursday and never a " +
      'Friday. Measured across all eight dollar majors plus EURGBP over three months, the weekday ' +
      'histogram is identical on every one: Sun 14, Mon 13, Tue 14, Wed 13, Thu 13. Cross-checked ' +
      'against 6E=F futures on the same underlying: futures Fri 2026-08-28 closed 1.15875 against ' +
      'spot "Sun" 2026-08-30 at 1.15890, and futures Fri 2026-08-21 1.16930 against spot "Sun" ' +
      '2026-08-23 1.16816, while Monday through Thursday align exactly.',
    confidence: 'PROVEN',
    rootCause:
      "Friday's bar is stamped two days late. The previous round recorded these as junk weekend " +
      'bars kept for parity because filtering them cost twelve points; that measurement was right ' +
      'and its explanation was wrong. Filtering cost parity because it DELETED FRIDAY.',
    productionAction:
      'DONE - re-dated rather than dropped. Order is preserved, so no moving average and no ' +
      'live board cell changes - confirmed, leg-parity and trend-solver are identical before and ' +
      'after. What it repairs is every measurement that CUTS the series by date: seriesAsOf at a ' +
      "Friday close previously excluded that Friday's own session, so backtests and rewound parity " +
      'runs silently scored the week one bar short.',
  },
  {
    key: 'a1:index-rows-are-the-parity-target',
    component: 'all',
    symbol: 'the eight currency legs',
    date: '2026-09-01',
    ours: 'measured against A1 index rows',
    a1: 'index rows and pair rows disagree',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'Rewound to the capture date, `npm run leg-parity` puts the eight legs at 123 of 144 cells ' +
      'in agreement, with 11 unexplained. The signed gap is -10, of which TECHNICAL is -9 and ' +
      'MACRO is +5. DXY reproduces 18 of 18 exactly. Measured UN-rewound against the live board ' +
      'the same day, the gap reads -20 with TECHNICAL at -18 - half of it is the calendar, and ' +
      'all three seasonality mismatches vanish because A1 captured on 31 August and read the ' +
      'AUGUST bucket.',
    confidence: 'PROVEN',
    rootCause:
      'Two separate confounds made the macro engine look worse than it is. Comparing against pair ' +
      'rows lets two leg errors cancel - CADX and AUDX both matched A1 on total while carrying ' +
      'wrong cells - and comparing across a date boundary charges the model for the calendar.',
    productionAction:
      'Use `npm run leg-parity` as the headline measurement. Every parity number recorded before ' +
      '2026-09-01 was taken against the pair rows and is not comparable to it.',
  },
  {
    key: 'macro:gbp-consensus-differs',
    component: 'mPMI, Retail Sales',
    symbol: 'GBPX',
    date: '2026-09-01',
    ours: 'mPMI forecast 51.5, Retail Sales forecast -0.5',
    a1: 'mPMI forecast 51.6, Retail Sales forecast -0.4',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      'Both sides agree exactly on the ACTUALS - UK manufacturing PMI 51.5 and retail sales MoM ' +
      '-0.5, released 2026-08-21. Only the consensus differs, by 0.1 in each case, which is enough ' +
      'to turn a 0 into their -1 twice.',
    confidence: 'PROVEN',
    rootCause:
      'A consensus has no primary source. Different vendors poll different panels, so a 0.1 spread ' +
      'on a survey forecast is two providers, not an error in either.',
    productionAction:
      'NONE. Matching this would mean adopting their consensus vendor. The actual is what a ' +
      'statistics office publishes and we already agree on it.',
  },
  {
    key: 'macro:cad-spmi-a1-is-stale',
    component: 'sPMI',
    symbol: 'CADX',
    date: '2026-09-01',
    ours: '-1, Ivey PMI 55.1 vs 55.5 forecast, 25 days old',
    a1: '+1, Services PMI 50.6 vs 49.2 previous, 122 days old',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's own CA heatmap dates their services PMI row 2026-05-01 and prints daysSince 122. Ours " +
      'reads the Ivey index from 2026-08-06. Two different series, four months apart.',
    confidence: 'PROVEN',
    rootCause: 'A1 is scoring a print from May because no newer one entered their feed.',
    productionAction:
      'NONE, and do not close this. Ours is four months fresher. This is a case where parity and ' +
      'accuracy point in opposite directions and accuracy wins.',
  },
  {
    key: 'a1:positional-slots-jp-household-spending',
    component: 'PCE',
    symbol: 'JPYX',
    date: '2026-09-01',
    ours: 'blank - PCE is usOnly by construction',
    a1: '-1, from Household Spending',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's JP heatmap fills row 7 with Household Spending (-3.3% against a 1.0% forecast, " +
      'Bearish). Row 7 is the PCE column. Their slots are POSITIONAL and per-country, the same way ' +
      'row 8 is Cnsmr Conf on the board and Wage Growth YoY for the United States.',
    confidence: 'PROVEN',
    rootCause:
      "A1 fills each economy's slot with whatever that economy publishes in that position. Ours " +
      'are named columns with one meaning across all eight currencies.',
    productionAction:
      'NONE. We hold the series already - the household-spending slot - and it is deliberately ' +
      'heatmap-only. Promoting a GROWTH series into an INFLATION column because A1 stores it at ' +
      'that index would be an A1-specific workaround, and it would make the JPY leg measure ' +
      'something the seven legs it is differenced against do not.',
  },
  {
    key: 'cnsmr-conf:index-rows-are-blank-not-neutral',
    component: 'Consumer Confidence',
    symbol: 'GBP, JPY, CHF, CAD, AUD, NZD',
    date: '2026-09-02',
    ours: 'a leg per currency, from the release their own Economic Data page publishes',
    a1: 'index rows print 0 for six of eight; their PAIR rows carry the legs',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'THE COLUMN WAS NEVER UNSOLVED - THEIR INDEX ROWS WERE EMPTY. Under full access their ' +
      'Economic Data > Consumer Confidence page publishes actual and forecast per currency. ' +
      'Scoring sign(actual - forecast), and sign(actual - previous) where the series carries no ' +
      'forecast, against A1s own board: 3 of 8 against their INDEX rows and 7 of 8 against the leg ' +
      'vector solved from their PAIR rows, which fits 28 of 28. The five index-row disagreements ' +
      'are all A1 printing 0 where a release exists - GBP -14 vs forecast -18, JPY 35.2 vs 36.6, ' +
      'CHF -33 vs -34, CAD 48.19 vs previous 49.42, AUD -0.02 vs previous -0.09. Reproduce with ' +
      '`npm run a1-truth-table`, section 3.',
    confidence: 'PROVEN',
    rootCause:
      'A gap in A1s index rows, not in their rule and not in ours. The same rule that explains ' +
      'CPI and PPI explains this column too; their eight single-currency rows simply do not ' +
      'publish it, while the 28 pair rows do.',
    productionAction:
      'NONE to the formula - it is already the default `compare: forecast` with a previous-print ' +
      'fallback. What this DOES license is closing our own coverage: we score consumer confidence ' +
      'for two economies and their pair rows carry six more. Source those from the primary ' +
      'publishers, NOT by copying A1s leg vector, and do not treat a 0 on their index row as ' +
      'evidence that a currency has no reading.',
  },
  {
    key: 'bias-bands:their-chart-says-5-and-12',
    component: 'Aggregation',
    symbol: 'every row',
    date: '2026-09-02',
    ours: 'Bullish at +-4, Very Bullish at +-7',
    a1: 'board labels say +-4/+-7; their own score-history chart draws +-5 and +-12',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'THREE PUBLISHED CONSTANTS, AND THEY DISAGREE. Their Top Setups marketing page says "+5 or ' +
      'above is bullish". Their Forex Scorecard score-history chart draws its reference lines at ' +
      '-5, -12, +5 and +12. Their board labels a score of 4 Bullish and 7 Very Bullish. The board ' +
      'wins on measurement: across four captures the +-4/+-7 bands reproduce their printed bias on ' +
      '216 of 216 rows (54 rows x 4 captures), including 3 -> Neutral, 4 -> Bullish, 6 -> Bullish, ' +
      '7 -> Very Bullish and the mirror images. Reproduce with `npm run a1-truth-table`, section 0.',
    confidence: 'PROVEN',
    rootCause:
      'Their chart decoration and their marketing copy were not updated with the band constants ' +
      'the board actually uses. Neither is the scorer.',
    productionAction:
      'NONE. `biasFromScore` stays on +-4/+-7. This entry exists so the +-5/+-12 lines are not ' +
      'read as a finding the next time someone opens their scorecard.',
  },
  {
    key: 'econ:no-forecast-fallback-basis',
    component: 'every economic column',
    symbol: 'CHF PPI, NZD consumer confidence',
    date: '2026-09-02',
    ours: 'compare against the forecast; a handful of series carry a per-currency override',
    a1: 'compares against something when no forecast exists - which print is undetermined',
    classification: 'UNKNOWN',
    evidence:
      'TWO OBSERVATIONS, POINTING OPPOSITE WAYS. Several of their series carry no forecast at all ' +
      '(CHF and AUD PPI, CAD/AUD/NZD consumer confidence), and their board still scores them, so ' +
      'there is a fallback basis. CHF PPI ends -1.80, -2.10, -2.10 and A1 scores it 0, which needs ' +
      'the PREVIOUS ROW. NZD consumer confidence ends 94.7, 80.4, 80.4 and their pair-solved leg ' +
      'is -1, which needs the previous DISTINCT print. One observation each. Their pages ' +
      'forward-fill quarterly series, so a repeated value can be a fill or a genuinely unchanged ' +
      'release and the two cases are not separable from these charts.',
    confidence: 'WEAK',
    rootCause:
      'Not enough observations to distinguish the two rules, and the distinction only bites on a ' +
      'repeated print, which is rare. Fitting either one to a single cell is the mistake the trend ' +
      'column already cost a round to learn.',
    productionAction:
      'NONE, and specifically do not implement previous-distinct on the strength of NZD. ' +
      '`npm run a1-truth-table` uses the previous ROW because it is the simpler rule and fits PPI ' +
      '8/8; the contradiction is printed rather than resolved. Settle it by capturing a metric ' +
      'page with dated x-axis labels, where a fill and a repeat can be told apart.',
  },
  {
    key: 'spmi:chf-reads-the-euro-area',
    component: 'Services PMI',
    symbol: 'CHF (every CHF leg)',
    date: '2026-09-03',
    ours: 'Swiss services PMI, where our feed has one',
    a1: 'the euro-area series, unmodified',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      "A1's own Services PMI scanner (page p_wa6fla2ydd, currency filter df935) returns, for CHF, a " +
      'series byte-identical to the one it returns for EUR — all 24 published points, actual, ' +
      'forecast and revision alike, from 3 sept. 2025 to 21 aug. 2026. Captured to ' +
      'fixtures/a1-full-access/a1-econ-services-pmi-2026-09-03-1033.csv, whose build script asserts ' +
      'the identity and refuses to write the file if it ever stops holding. This was previously ' +
      'inferred from a single heatmap cell where the CH and EU services rows happened to agree; it ' +
      'is now the whole history, which no coincidence explains.',
    confidence: 'PROVEN',
    rootCause:
      'Switzerland has no S&P Global services PMI in the flash programme A1 reads (their own page ' +
      'states "Non-USD assets use Flash PMI Data"), so their pipeline falls back to the euro-area ' +
      'print for the Swiss row rather than leaving it blank.',
    productionAction:
      'None in the `ours` profile — where we hold a real Swiss services print, scoring it is the ' +
      'better read and the product should keep it. This is the seed entry for the Workstream C ' +
      "coverage table: in the `a1` mirror profile, CHF services must substitute the EU series so " +
      'that parity measures reproduction rather than disagreement.',
  },
  {
    key: 'spmi:cad-nzd-have-no-series',
    component: 'Services PMI',
    symbol: 'CAD, NZD',
    date: '2026-09-03',
    ours: 'Ivey (CAD); BusinessNZ PSI (NZD)',
    a1: 'a row frozen at 2026-05-01',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'The Services PMI scanner returns an EMPTY chart for both CAD and NZD, under filter codes that ' +
      'return full histories on the Manufacturing PMI page — so this is absent data, not a bad ' +
      'query. Yet their CA and NZ Economic Heatmaps both still print a Services PMI row, both dated ' +
      '1 May 2026: CA 50,6 vs 49,2 and NZ 47,5 vs 48,7. On the capture date that is 125 days stale.',
    confidence: 'PROVEN',
    rootCause:
      'Whatever fed the Canadian and New Zealand services rows stopped publishing in May and A1 kept ' +
      'scoring the last value instead of blanking the cell. Their scanner and their heatmap disagree ' +
      'about whether the series exists at all.',
    productionAction:
      'None, and specifically DO NOT reproduce it. Matching a 125-day-old frozen print would be ' +
      "copying a bug. Note this is the one place where removing our staleness cap (decision 1) makes " +
      'us MORE like them for the wrong reason — the cap was wrong as a rule, but this cell is why ' +
      'the card must still show ageDays.',
  },
  {
    key: 'pmi:missing-forecast-fallback-confirmed-at-source',
    component: 'Manufacturing PMI, Services PMI',
    symbol: 'CAD, NZD, AUD, JPY',
    date: '2026-09-03',
    ours: 'actual vs previous print, where no consensus exists',
    a1: 'the same',
    classification: 'FIXED',
    evidence:
      'The fallback in scoreSlot was adopted from heatmap arithmetic — wherever their Forecast cell ' +
      'was blank, their Surprise equalled `actual − previous`. Their Economic Data scanners now show ' +
      'the same thing one level upstream, in the data rather than in the arithmetic: the Forecast ' +
      'SERIES is empty for NZD manufacturing on 17 of 17 points, CAD manufacturing on 11 of 13, AUD ' +
      'manufacturing on 16 of 30, AUD services on 17 of 33 and JPY services on 6 of 11. Three ' +
      'independent current prints confirm the consequence: CA mPMI 53,0 against a prior 53,5 gives ' +
      'their heatmap −0,5; NZ mPMI 54,3 against a prior 59,7 gives −5,4; JP sPMI 52,3 against a ' +
      'prior 51,2 gives +1,1. None of the three has a forecast to have used.',
    confidence: 'PROVEN',
    rootCause:
      'No privately-run survey in New Zealand, Australia or Canada is polled ahead of publication, ' +
      'and A1 reads the S&P Global FLASH release for every non-USD currency (their words: "USD uses ' +
      'ISM PMI data for both manufacturing and services. Non-USD assets use Flash PMI Data"). Flash ' +
      'prints carry no consensus. The blank is structural, not a coverage gap either of us can fill.',
    productionAction:
      'DONE, and shipped in an earlier round rather than this one: the fallback lives in ' +
      'lib/scoring/discrete.ts (scoreSlot, the `referenceLabel = previous` branch) and needed no ' +
      'change. What this entry adds is the confirmation at SOURCE rather than in their arithmetic, ' +
      'so the next round does not re-litigate removing it for a third time. One nuance the capture ' +
      'adds: A1 DOES ' +
      'hold forecasts for the JP services FINAL prints and not for the flash, so the long-standing ' +
      'note that "A1 has a forecast for Jibun Bank Services PMI that our calendars do not carry" is ' +
      'true only of the final. Their most recent JP services cell is a flash, scored against the ' +
      'prior actual.',
  },
  {
    key: 'retail:cad-two-surfaces-two-series',
    component: 'Retail Sales',
    symbol: 'CAD',
    date: '2026-09-03',
    ours: '(see retail:cad-statcan)',
    a1: '-0,10 on their scanner, -0,8 on their heatmap',
    classification: 'A1_INCONSISTENCY',
    evidence:
      'For the 21 August 2026 Canadian retail release, A1 publishes two different actuals. Their ' +
      'Retail Sales scanner (page p_gp30uh2ydd, filter df964) shows -0,10 %; their CA Economic ' +
      'Heatmap shows an actual of -0,8 with a surprise of -1,8 against a previous of 1,0. Captured ' +
      'to fixtures/a1-full-access/a1-econ-retail-sales-2026-09-03-1040.csv and ' +
      'a1-econ-heatmaps-2026-09-03-0527.csv respectively. The other seven currencies reconcile ' +
      'between the two surfaces exactly, so this is specific to CAD and not an extraction fault: ' +
      "USD, GBP, EUR, JPY, NZD and CHF all match on both actual and forecast, and AUD is absent " +
      'from both.',
    confidence: 'PROVEN',
    rootCause:
      'UNKNOWN, with one strong candidate: StatCan publishes headline retail and retail ex-autos, ' +
      'and -0,1 headline beside -0,8 core is an unremarkable month. If that is what it is, the two ' +
      'A1 surfaces are reading different series rather than disagreeing about one. Neither page ' +
      'names its series, so this is NOT resolved by assumption. Their heatmap arithmetic is still ' +
      'internally consistent (-0,8 - 1,0 = -1,8), so no cell is broken - there are simply two.',
    productionAction:
      'None yet, and do not pick a side to close the gap. This is exactly the case ' +
      'triangulate-against-primary-sources describes: the answer comes from a StatCan release, not ' +
      'from whichever choice happens to move parity. Note the scanner also publishes NO forecast on ' +
      'any of its nine Canadian points, so CAD retail is scored against the prior actual either way.',
  },
  {
    key: 'cnsmr-conf:a1-has-the-series-but-abandoned-them',
    component: 'Consumer Confidence',
    symbol: 'AUD, NZD, JPY',
    date: '2026-09-03',
    ours: 'no consumer-confidence leg for these currencies',
    a1: 'a series that exists and stopped updating',
    classification: 'UNKNOWN',
    evidence:
      'None of the eight Economic Heatmaps carries a Consumer Confidence row, which is why this ' +
      'column has been reasoned about as something A1 does not publish. Their Consumer Confidence ' +
      'scanner (page p_i3yq86ivpd, filter df1150) does publish it, for eight currencies. Three of ' +
      'them are stale rather than absent: AUD last printed 13 ian. 2026 (233 days before capture), ' +
      'NZD 17 iun. 2026 (78 days), JPY 29 ian. 2025 (582 days). USD, CHF, EUR and GBP are current. ' +
      'Captured to fixtures/a1-full-access/a1-econ-consumer-confidence-2026-09-03-1046.csv.',
    confidence: 'PROVEN',
    rootCause:
      'The comment in lib/scoring/discrete.ts justifying the missing-forecast fallback describes ' +
      'Westpac and ANZ-Roy Morgan confidence as series "A1 does not have at all". That was inferred ' +
      'from the heatmaps, correctly, and is now too strong: A1 has them and abandoned them. Which ' +
      'means the interesting question is not coverage but what their pipeline does with a series ' +
      'that stops - it scores a 125-day-old CA services print but shows no heatmap row for a ' +
      '233-day-old AUD confidence print, so some threshold or staleness flag exists between those ' +
      'two ages that nothing has yet located.',
    productionAction:
      'None, and explicitly NOT a licence to pick a staleness threshold. Decision 1 was to drop our ' +
      'own maxAgeDays cap because it was our invention; this entry says the replacement is not ' +
      '"score everything forever" either, and that the observation which would settle it is a cell ' +
      'on their board fed by a series this old. Note also that the AUD series is an index CHANGE ' +
      '(values around 0,01-0,13), not a level, so any like-for-like comparison must not treat it as ' +
      'one.',
  },
  {
    key: 'crowd:crosses-are-published-behind-a-default-filter',
    component: 'Crowd',
    symbol: '22 crosses',
    date: '2026-09-03',
    ours: 'null - no cell scored',
    a1: 'a long/short percentage for every one',
    classification: 'SOURCE_DIFFERENCE',
    evidence:
      'Crowd is the largest single column of remaining gap (35) and our crosses score null rather ' +
      'than wrong, because no retail feed we hold covers them. A1 publishes all of them. Their ' +
      'Retail Sentiment page (p_5jasyzmtxc) opens with a Category filter set to "Major Currency ' +
      'Pairs, Metals, Indices, Commodities" and shows 20 symbols; requesting the remaining ' +
      'categories through df3624 returns 22 crosses plus US10T, Ethereum and BITCOIN. Captured to ' +
      'fixtures/a1-full-access/a1-retail-sentiment-2026-09-03-1053.csv.',
    confidence: 'PROVEN',
    rootCause:
      'Sourcing, not scoring - which the same capture also demonstrates. The page publishes A1s own ' +
      'Bearish/Neutral/Bullish label beside each percentage, and our existing 40/60 bands reproduce ' +
      'that label 42 times out of 42, with their Bearish minimum at 60,00 sitting directly against ' +
      'their Neutral maximum of 59,41. The rule was never the problem; Myfxbook rejecting its own ' +
      'session is (see myfxbook-invalid-session).',
    productionAction:
      'None from this file - it is a snapshot and must not become a data source. What it unblocks is ' +
      'MEASUREMENT: parity can now score the crowd column on crosses and say whether the remaining ' +
      'gap there is sourcing alone. Note the table is two providers blended - FX reports whole ' +
      'numbers, everything else two decimals - so a live replacement may need to be two feeds.',
  },
  {
    key: 'staleness:the-age-gate-was-ours',
    component: 'every economic column',
    symbol: 'all',
    date: '2026-09-03',
    ours: 'a resolved print past maxAgeDays scored null and rendered blank',
    a1: 'a resolved print scores at any age',
    classification: 'FIXED',
    evidence:
      'A1 carries a Canada services PMI dated 1 mai 2026 on their board and scores it, 125 days after ' +
      'publication. No captured A1 surface - eight country heatmaps, 51 Top Setups rows, six ' +
      'scanners - has ever shown a row that RESOLVED to a series and was then suppressed for age. ' +
      'Our 60-day default (120 for quarterly, 21 for weekly) was therefore modelling a rule only we ' +
      'had. MEASURED BOTH SIDES AND IT MOVED NOTHING: TOTAL ABS GAP 114 before and 114 after, 51 of ' +
      '51 symbols, 7 exact both times; leg parity 117 of 144 unchanged. That is not a weak result, ' +
      'it is the explanation - a census of all 72 resolved economic legs puts the OLDEST at 0,75x ' +
      'its window (NZD CPI, 45 of 60 days), and the same census on the rewound 2026-08-31 frame ' +
      'leg-parity scores against finds 0 stale cells on all 51 rows. The gate could not have fired ' +
      'on either frame, so the two numbers are identical by construction rather than by luck.',
    confidence: 'PROVEN',
    rootCause:
      'The window was invented to stop a five-month-old print reading as a confident zero, which is ' +
      'good economics and the wrong model: A1 does not make that judgement, and a cell we blank ' +
      'while they score it is a guaranteed miss rather than a cautious one. What the window is FOR ' +
      'survives untouched - resolveSeries still ranks a fresh unforecast print above a stale ' +
      'forecast one, which is the tier order NZD retail sales established and which the removed gate ' +
      'used to undo by rejecting the very print that ranking had just chosen.',
    productionAction:
      'DONE. The hard gate in scoreSlot and the per-component skip in scoreCompositeSlot are ' +
      'deleted; maxAgeFor and every maxAgeDays value are KEPT and now do one job, ranking candidates ' +
      'inside resolveSeries, plus a display-only SlotResult.stale that the scorecard pill, the ' +
      'heatmap date column and the matrix tooltip read. The `stale` CellStatus is gone from the ' +
      'union because nothing could produce it any more, and leaving an unreachable status would ' +
      'have read as a state the board can still be in. scripts/overrides.ts was re-deriving the ' +
      'window as `slot.maxAgeDays ?? 60`, skipping maxAgeDaysByCurrency, so its no-override arm ' +
      'ranked NZD retail sales against 75 days where production uses 120; it now calls maxAgeFor. ' +
      'THE OPEN QUESTION IS NOT CLOSED BY THIS: A1 drops a series SOMEWHERE - see ' +
      'cnsmr-conf:a1-has-the-series-but-abandoned-them, where their own scanner publishes AUD ' +
      'confidence 233 days stale and their heatmaps carry no row for it. Nothing observed locates ' +
      'that limit, so nothing here guesses at one. If a capture ever shows a board cell fed by a ' +
      'series that old, maxAgeFor is where the rule goes.',
  },
] as const;

export function ledgerByClassification(): Record<ParityClassification, ParityLedgerEntry[]> {
  const out: Record<ParityClassification, ParityLedgerEntry[]> = {
    FIXED: [],
    SOURCE_DIFFERENCE: [],
    A1_INCONSISTENCY: [],
    TIMING: [],
    TRANSCRIPTION_ERROR: [],
    UNKNOWN: [],
  };
  for (const entry of PARITY_LEDGER) out[entry.classification].push(entry);
  return out;
}

export function ledgerEntry(key: string): ParityLedgerEntry | undefined {
  return PARITY_LEDGER.find((entry) => entry.key === key);
}
