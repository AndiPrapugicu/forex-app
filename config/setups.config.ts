/**
 * The Top Setups scorecard: which indicators occupy which column, how a raw
 * surprise becomes a -2..+2 cell, and where the bias labels cut.
 *
 * Everything here is data. The matrix builder in lib/scoring/setups.ts contains
 * no indicator knowledge at all — if a column looks wrong, the fix is in this
 * file.
 *
 * The name patterns below were derived from two years of real FXStreet data
 * (19,856 major-currency events), not guessed. Two traps that cost real accuracy
 * if you get them wrong:
 *
 *  1. EUR events span the whole currency union. "Consumer Price Index (YoY)" for
 *     EUR is a MEMBER STATE print (DE, IT, ES...). The aggregate is called
 *     "Harmonized Index of Consumer Prices (YoY)" under country EMU. Filtering
 *     by PRIMARY_COUNTRY first is what stops German CPI being read as euro-area
 *     CPI.
 *  2. Most indicators have several near-identical variants (Retail Sales MoM vs
 *     YoY vs s.a. vs ex-Autos). `match` is an ORDERED preference list; the first
 *     pattern with actual data wins, so the canonical series is chosen
 *     deterministically rather than by whichever printed most recently.
 */

import type { SymbolKind } from '@/config/symbols.config';
import type { Currency } from '@/lib/types';

// ---------------------------------------------------------------------------
// Country scoping
// ---------------------------------------------------------------------------

/**
 * The country whose releases represent each currency.
 * Verified against the feed: USD->US, GBP->UK, JPY->JP, AUD->AU, NZD->NZ,
 * CAD->CA, CHF->CH, ZAR->ZA are all one-to-one; EUR is the only many-to-one
 * case.
 */
export const PRIMARY_COUNTRY: Record<Currency, string> = {
  USD: 'US',
  EUR: 'EMU',
  GBP: 'UK',
  JPY: 'JP',
  AUD: 'AU',
  NZD: 'NZ',
  CAD: 'CA',
  CHF: 'CH',
  ZAR: 'ZA',
};

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export type SlotCategory = 'technical' | 'sentiment' | 'growth' | 'inflation' | 'jobs';

export const SLOT_CATEGORIES: { key: SlotCategory; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'growth', label: 'Economic Growth & Consumer Strength' },
  { key: 'inflation', label: 'Inflation' },
  { key: 'jobs', label: 'Jobs Market' },
];

/**
 * A resolvable calendar series: an ordered preference list of name patterns,
 * with per-currency overrides for country-specific naming.
 *
 * Split out from SlotDefinition because composite slots (PMI) need several of
 * these under one column.
 */
export interface SeriesMatcher {
  /** Ordered preference list of event-name patterns. First with data wins. */
  match?: RegExp[];
  /** Per-currency overrides, for series with country-specific names. */
  matchByCurrency?: Partial<Record<Currency, RegExp[]>>;
}

export interface SlotDefinition extends SeriesMatcher {
  key: string;
  /** Column header. Kept short — the matrix is dense. */
  label: string;
  /** Longer name for the scorecard page and tooltips. */
  title: string;
  category: SlotCategory;
  /**
   * `economic` slots resolve to a calendar release and score off its surprise.
   * `technical` and `sentiment` slots are computed elsewhere and injected.
   */
  kind: 'economic' | 'technical' | 'sentiment' | 'rates';

  /**
   * Whether this slot's cell is added to the symbol's total.
   *
   * A1 publishes a specific column set, and their bias bands (+/-4, +/-7) are
   * ABSOLUTE rather than a fraction of some maximum. Adding a column therefore
   * silently shifts what "Bullish" means. Columns we carry that they do not are
   * marked `scoring: false`: still resolved, still rendered, never summed. That
   * keeps the extra information without breaking comparability with their
   * numbers.
   */
  scoring: boolean;

  /**
   * What the actual is measured against.
   *
   * `forecast` — actual vs consensus. Every column A1 scores uses this; their
   *              PMI page's talk of a previous-print change describes the number
   *              they DISPLAY, not the comparison they score (see the mPMI slot).
   * `previous` — actual vs the prior print. Unused today; kept because the
   *              distinction is real and a future column may need it.
   */
  compare?: 'forecast' | 'previous';

  /**
   * Per-currency override of `compare`, because forecast COVERAGE is a property
   * of the calendar, not of the indicator.
   *
   * The scoring rule is shared with A1 and settled: read the forecast where one
   * exists, read the prior print where none does. Two calendars running that
   * same rule still disagree whenever they disagree about which series carry a
   * forecast — and ours and theirs demonstrably do, in BOTH directions:
   *
   *   JP flash Services PMI   they have a forecast, we do not. We read 52.3
   *                           against last month's 51.2 and score +1; they read
   *                           it against a forecast above it and score -1.
   *   CH SECO Consumer Climate  we have one (-34), they appear not to. We read
   *                           -35 as a miss at -1; against the prior -40 it is
   *                           an improvement at +1.
   *   CH Producer & Import Prices  the same shape: -0.1 misses a 0.2 forecast,
   *                           but beats a -0.3 prior print.
   *
   * Same rule, opposite answers, because the inputs differ. This is the knob for
   * it — but ONLY with evidence. Their per-country heatmap cards publish the
   * Forecast column directly, so a blank there is the evidence.
   *
   * A BLANK ON ONE CARD IS A SNAPSHOT, NOT A PROPERTY OF THE SERIES. Set this
   * only where nobody forecasts the series at all — which is testable, because
   * our own feed will not carry a consensus for it either. Their JP card shows
   * CPI with a blank Forecast and that reads like the same evidence as the CH
   * rows below; it is not. Japan's core CPI is routinely forecast, ours carries
   * one, and forcing the prior print discarded a real number: 111 -> 118. The
   * CH rows work because Swiss producer prices and unemployment are genuinely
   * unforecast on both calendars. Do not set this
   * from a board total, and do not set it currency-wide: scoring every leg
   * against the prior print was simulated across all eight majors and helps CHF
   * (-3 -> +1, toward their +3) while wrecking JPY (-1 -> +3, away from their
   * -5) and CAD (+5 -> +1, away from their +4). The divergence is per SERIES.
   */
  compareByCurrency?: Partial<Record<Currency, 'forecast' | 'previous'>>;

  /** +1 = a higher reading is bullish for the currency. Economic slots only. */
  polarity?: 1 | -1;

  /**
   * Largest absolute value this slot may contribute, per leg.
   *
   * Defaults to 1: every economic category scores +/-1 per currency and reaches
   * +/-2 only once base and quote are differenced. Trend and COT override it.
   */
  maxCell?: number;

  /**
   * How old the latest print may be before the cell is treated as stale.
   * Stale renders greyed at 0 — a five-month-old GDP number must not look like
   * a confident neutral.
   */
  maxAgeDays?: number;

  /**
   * Per-currency override of `maxAgeDays`, because publication CADENCE is a
   * property of the country, not of the indicator.
   *
   * Retail sales is the case that forced it. Most majors publish monthly, so 75
   * days is generous; New Zealand publishes QUARTERLY, and a 75-day window
   * rejects a print that is merely one quarter old and perfectly current. A1
   * shows exactly that series on their NZ card at seven weeks. Worse, the
   * freshness tier in `resolveSeries` prefers a fresh-but-unscoreable print over
   * a stale-but-scoreable one, so the quarterly lost to Electronic Card even
   * when listed first — the window had to widen before the ordering could work.
   */
  maxAgeDaysByCurrency?: Partial<Record<Currency, number>>;

  /**
   * Show on the per-country heatmap, but NOT as a column on Top Setups.
   *
   * `scoring: false` is not enough on its own: those columns are still rendered
   * in the matrix as context, and A1's Top Setups has no column for these at
   * all. Their heatmaps do — the euro area's card carries Employment Change and
   * Japan's carries Household Spending, and both count toward the Impact
   * percentage on those cards.
   *
   * So this is about WHERE a slot appears, which is a different question from
   * whether it scores. A heatmap-only slot is always `scoring: false` too.
   */
  heatmapOnly?: boolean;

  /**
   * The mirror of `heatmapOnly`: a column on Top Setups with no row on their
   * per-country card.
   *
   * NOT ONE of their nine published country cards — US, EU, UK, JP, CA, AU, NZ,
   * CH, CN — carries a Consumer Confidence row, while every one of their Top
   * Setups captures carries the Cnsmr Conf column. So the two surfaces genuinely
   * run different sets, in BOTH directions, and `heatmapOnly` alone could only
   * express one of them.
   *
   * This is not cosmetic. The card's Impact percentage is bullish over
   * bullish-plus-bearish, so an extra row moves the DENOMINATOR — and that
   * percentage drives the Economic Surprise Meter through `buildSurpriseIndex`.
   * Rendering a row they do not have makes both numbers disagree with theirs
   * even when every cell we score is right.
   *
   * `scoring` is a separate question and stays true: their board really does
   * have the column, and every captured `cells` row carries a value for it.
   */
  matrixOnly?: boolean;

  /**
   * The series exists for the US economy and nowhere else, so a row with no
   * dollar leg CANNOT carry a value here — not "does not today", cannot.
   *
   * Declarative only. Nothing in the scoring path reads it: the `match`
   * patterns are already US-only names, so those cells are blank for other
   * currencies whether or not this flag is set. It exists so a TRANSCRIPTION of
   * A1's board can be checked against it — see `checkStructuralZeros` in
   * `lib/scoring/a1-legs.ts`. That check catches the one error class the row-sum
   * checksum is structurally blind to, because a sum is invariant under
   * PERMUTATION: a row read with its columns shifted by one still adds to the
   * printed total, and five separately captured rows in this repo's own
   * fixtures turned out to be exactly that.
   */
  usOnly?: boolean;

  /**
   * Sub-series making up a composite column.
   *
   * Nothing uses this today — mPMI and sPMI are separate columns, matching A1's
   * table. Retained because the heatmap and the leg builder both handle it, and
   * it is the mechanism any future genuinely-composite column would need.
   */
  components?: (SeriesMatcher & { key: string; label: string })[];
}

export const SLOTS: SlotDefinition[] = [
  // --- Technical ----------------------------------------------------------
  {
    /**
     * A1's rule from a1trading.com/edgefinder/trend/: a 3-day and a 14-day SMA,
     * where the CROSSOVER is the score (+/-2) and the 14-day slope only docks a
     * point when it disagrees. Range +/-2, values {-2, -1, +1, +2}.
     *
     * Reading their "+1 / -1" slope line as an addend gave +/-3 and produced a
     * Trend of +3, which their model cannot output. See scoreTrend.
     */
    key: 'trend',
    label: 'Trend',
    title: '3-day vs 14-day moving average, with the 14-day slope',
    category: 'technical',
    kind: 'technical',
    scoring: true,
    maxCell: 2,
  },
  {
    key: 'seasonality',
    label: 'Seasonality',
    title: "This calendar month's 10-year average return",
    category: 'technical',
    kind: 'technical',
    scoring: true,
    maxCell: 1,
  },

  // --- Sentiment ----------------------------------------------------------
  {
    key: 'cot',
    label: 'COT',
    title: 'Large speculator positioning from the weekly CFTC report',
    category: 'sentiment',
    kind: 'sentiment',
    scoring: true,
    maxCell: 2,
  },
  {
    key: 'crowd',
    label: 'Crowd Sentiment',
    title: 'Small-trader positioning, read contrarian',
    category: 'sentiment',
    kind: 'sentiment',
    scoring: true,
    // A1 scores retail +/-1 for the whole symbol, not per leg.
    maxCell: 1,
  },

  // --- Growth & consumer --------------------------------------------------
  {
    key: 'gdp',
    label: 'GDP',
    title: 'Gross Domestic Product',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    // Quarterly, and often revised weeks later, so a long window is correct.
    maxAgeDays: 120,
    match: [
      /^Gross Domestic Product \(QoQ\)$/i,
      /^Gross Domestic Product s\.a\. \(QoQ\)$/i,
      /^Gross Domestic Product Annualized/i,
      /^Gross Domestic Product \(YoY\)$/i,
    ],
    matchByCurrency: {
      /**
       * Canada is the one major that publishes GDP MONTHLY, and that release is
       * its headline growth read — the quarterly lands eleven weeks later.
       * Taking the quarterly gave every CAD pair an 80-day-old print carrying no
       * forecast, so the column could not be scored at all; the monthly is 17
       * days old and forecast by both calendars.
       */
      CAD: [
        /^Gross Domestic Product \(MoM\)$/i,
        /^Gross Domestic Product \(QoQ\)$/i,
        /^Gross Domestic Product Annualized$/i,
      ],
      /**
       * NO GBP ENTRY, AND ITS REMOVAL IS THE POINT.
       *
       * This used to name `Gross Domestic Product (MoM)` first, on the strength
       * of A1's UK heatmap card naming its row "GDP Growth MoM". That card is
       * real and the reading of it was right; it is simply not what their BOARD
       * scores, and their card and their board are known to differ — the row
       * sets differ in both directions on other economies too.
       *
       * The 2026-08-13 release is the case that separates them, because the ONS
       * published both series that morning:
       *
       *   GDP (MoM)   0.3 actual vs 0.0 forecast   ->  +1
       *   GDP (QoQ)   0.4 actual vs 0.4 forecast   ->   0
       *
       * A1's own GDP page publishes 0.4 against 0.4 for the UK, and their board
       * carries a GBP GDP leg of 0 — solved twice over, from GBPUSD against a
       * known dollar leg and from their GBPX row. Two dated A1 surfaces say
       * quarterly; one undated screenshot says monthly.
       *
       * So the UK is not a second Canada. Canada stays overridden because it has
       * no TIMELY quarterly at all — its GDP (QoQ) lands eleven weeks late and
       * carries no forecast, which is a data-availability fact rather than a
       * preference. Every other major, the UK included, falls through to the
       * quarterly-first default above.
       */
    },
  },
  {
    /**
     * TWO INDEPENDENT COLUMNS, scored against FORECAST.
     *
     * Their table carries mPMI and sPMI side by side, each reaching +/-2 for a
     * pair — their EURUSD reads mPMI -2 and sPMI +2 on the same day. Merging
     * them into one composite collapsed that to a single -1 and halved the
     * growth block.
     *
     * Their PMI page says "change from previous data to latest data", which
     * reads like a previous-print comparison. It is not what the product does.
     * On the same day's live figures, scoring against FORECAST reproduces all
     * four of their published PMI cells (EURUSD -2/+2, GOLD -1/+1); scoring
     * against PREVIOUS reproduces only two. The sentence describes the change
     * they DISPLAY, not the comparison they SCORE.
     */
    key: 'mpmi',
    label: 'mPMI',
    title: 'Manufacturing PMI, change from the previous print',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    // No CAD override: see the note on retail-sales. A blank forecast already
    // falls back to the prior print without one.
    maxAgeDays: 60,
    match: [/^ISM Manufacturing PMI$/i, /Manufacturing PMI$/i],
    matchByCurrency: {
      NZD: [/^Business NZ PMI$/i],
      // Australia has only the S&P Global print in this feed.
      AUD: [/^S&P Global Manufacturing PMI$/i, /Manufacturing PMI$/i],
      /**
       * Switzerland's manufacturing PMI is the SVME/procure.ch survey, and its
       * feed name contains neither "Manufacturing" nor "PMI" — so the generic
       * pattern above never matched and the CHF leg was silently absent.
       *
       * That blank is what made every franc cross read a single-leg number: on
       * GBPCHF the cell was GBP alone at -1 where A1 shows +2, because they have
       * the Swiss side at -1 and difference it.
       */
      CHF: [/^SVME - Purchasing Managers' Index$/i, /^procure\.ch PMI$/i],
    },
  },
  {
    key: 'spmi',
    label: 'sPMI',
    title: 'Services PMI, change from the previous print',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    // No CAD override: see the note on retail-sales. A blank forecast already
    // falls back to the prior print without one.
    maxAgeDays: 60,
    match: [/^ISM Services PMI$/i, /Services PMI$/i],
    matchByCurrency: {
      // Canada has no services PMI in this feed; Ivey is the closest activity read.
      CAD: [/^Ivey Purchasing Managers Index s\.a$/i, /^Ivey Purchasing Managers Index$/i],
      NZD: [/^Business NZ PSI$/i],
      /**
       * A PROXY, AND NOT A SERVICES PMI. Say so plainly, because the column
       * header will not.
       *
       * Switzerland has no services PMI on FXStreet or TradingView — across all
       * 70 Swiss rows in a 120-day window the only match for pmi/servic/purchas
       * is the SVME manufacturing survey, which the mPMI column already uses.
       * procure.ch does publish a services index in reality; neither feed
       * carries it. So the honest options were a permanently blank column or a
       * stand-in, and a stand-in was chosen deliberately.
       *
       * KOF is a composite leading indicator for the whole economy, not a
       * services survey. It is forecast on both feeds (4 prints, 4 consensus),
       * which is the only reason it can fill the slot at all.
       *
       * It has been REMOVED from the consumer-confidence fallback below in the
       * same change. Leaving it in both would let one survey vote twice on any
       * run where SECO dropped out — the exact double-count this column is
       * already at risk of, and the reason to fix it here rather than notice it
       * later on a board that looks fine.
       */
      CHF: [/^KOF Leading Indicator$/i],
    },
  },
  {
    key: 'retail-sales',
    label: 'Retail Sales',
    title: 'Retail sales',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    /**
     * NO CANADIAN OVERRIDE, AND IT WAS REMOVED ON EVIDENCE RATHER THAN TASTE.
     *
     * It used to read `compareByCurrency: { CAD: 'previous' }`, justified by one
     * observation: a card whose Forecast column was blank, whose Surprise was
     * actual minus previous. That justification proves only what happens when
     * there IS no forecast — and in that case `scoreSlot` ALREADY falls back to
     * the prior print. The override was therefore redundant exactly where its
     * evidence applied, and active only where its evidence did not.
     *
     * What it cost, on the live board of 2026-08-31: Statistics Canada put June
     * retail sales at +0.6% against a +0.4% consensus, reported everywhere as a
     * beat. Comparing that to the +1.0% prior print instead scored the CAD leg
     * -1 where the evidence says +1 — a two-point error on every Canadian pair,
     * with the leg's own sigma (+0.86, computed against consensus) carrying the
     * opposite sign to the cell it was printed beside.
     */
    maxAgeDays: 75,
    // New Zealand publishes quarterly; 75 days would reject a print one quarter
    // old and current. See `maxAgeDaysByCurrency`.
    maxAgeDaysByCurrency: { NZD: 120 },
    match: [/^Retail Sales \(MoM\)$/i, /^Retail Sales s\.a\. \(MoM\)$/i, /^Retail Sales \(YoY\)$/i],
    matchByCurrency: {
      JPY: [/^Retail Trade \(YoY\)$/i, /^Retail Trade s\.a \(MoM\)$/i],
      /**
       * QUARTERLY FIRST, against every other currency's monthly-first order.
       *
       * A1's NZ card names this row "Retail Sales QoQ" — the Stats NZ quarterly
       * release, not the monthly Electronic Card series that used to lead this
       * list. The distinction matters for more than fidelity: Electronic Card
       * carries a consensus on none of its prints, while the quarterly is
       * forecast, so leading with the monthly left the column unscoreable and
       * `resolveSeries` could not reach past it.
       */
      NZD: [/^Retail Sales \(QoQ\)$/i, /^Electronic Card Retail Sales {1,2}\(MoM\)$/i],
      CHF: [/^Real Retail Sales \(YoY\)$/i],
      /**
       * NOT AN FXSTREET SERIES. The ABS retired monthly Retail Trade in favour
       * of the Household Spending Indicator, and FXStreet carries neither —
       * checked across all 217 Australian rows in a 120-day window, there is no
       * Retail Sales (MoM), no (QoQ) and no Household Spending, so this column
       * was blank for the AUD leg of every Aussie pair and no aliasing could
       * change that.
       *
       * The print arrives through `TRADINGVIEW.actualSeries`, an explicit
       * allowlist of series FXStreet does not publish, and is republished under
       * the name below so this matcher targets one string. It carries
       * `actualSource: 'tradingview'` so the card can say where it came from.
       */
      AUD: [/^Household Spending \(MoM\)$/i],
    },
  },
  {
    /**
     * CANADA HAS NO ENTRY HERE, AND IT WAS CHECKED RATHER THAN OVERLOOKED.
     *
     * Across all 148 Canadian rows in a 120-day window, the only match for
     * confid/sentim/climate/survey is the Bank of Canada Business Outlook
     * Survey — quarterly, a business rather than consumer survey, and carrying
     * no actual at all. TradingView has no Canadian consumer confidence either.
     *
     * A proxy was considered and rejected on arithmetic, not taste. The nearest
     * candidate is the non-seasonally-adjusted Ivey index, and it carries a
     * consensus on none of its four prints, so it cannot be scored — it would
     * render blank exactly as the column does now, while implying the gap had
     * been dealt with. Lending it the s.a. variant's forecast would pair a
     * forecast of one series with the actual of another, which is the failure
     * `SERIES_ALIASES` exists to prevent. The s.a. variant itself is already
     * this currency's sPMI, so reusing it would let one survey vote twice.
     *
     * Blank is the honest answer until a feed carries the series.
     */
    key: 'consumer-confidence',
    label: 'Cnsmr Conf',
    title: 'Consumer confidence / sentiment',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    /**
     * ON THE BOARD, OFF THE CARDS. None of their nine country cards carries a
     * consumer-confidence row; every Top Setups capture carries the column. See
     * `matrixOnly` for why rendering it on a card moves their Impact percentage
     * away from ours even when the cell itself is right.
     */
    matrixOnly: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Consumer Confidence$/i, /^Consumer Confidence Index$/i, /^Michigan Consumer Sentiment Index$/i],
    matchByCurrency: {
      // The UK's series is GfK's, and nothing else here matches "Consumer
      // Confidence" for GBP — without this the leg silently scored 0.
      GBP: [/^GfK Consumer Confidence$/i],
      /**
       * SECO's Consumer Climate IS Switzerland's consumer confidence survey, and
       * it is in the feed. Its forecast comes from TradingView via the alias
       * already wired in `SERIES_ALIASES`.
       *
       * KOF WAS the fallback here and has been removed: it now fills the sPMI
       * slot, which has nothing else at all, and one survey must not be able to
       * vote in two columns. If SECO ever drops out this column goes blank,
       * which is the correct answer — a blank says "not published", while KOF
       * standing in twice would say something false twice.
       */
      CHF: [/^SECO Consumer Climate \(3m\)$/i],
      /**
       * NZD AND AUD ARE WIRED, AND THE REASON THEY WERE NOT IS WORTH READING.
       *
       * Both series were removed on 2026-08-24 with a careful measurement:
       * wiring them moved TOTAL ABS GAP against A1 from 96 to 102, and A1's own
       * NZDUSD card implies a New Zealand leg of -1 where every NZ confidence
       * series in our feed reads bullish. The conclusion drawn was that the gap
       * must be a SERIES we do not carry.
       *
       * That conclusion rested entirely on parity, and parity is no longer a
       * reason to leave a real economic series unscored. What is actually true:
       *
       *   – ANZ–Roy Morgan is THE monthly New Zealand consumer confidence index,
       *     and it is in our feed with actuals;
       *   – Westpac is the equivalent for Australia, monthly, also with actuals;
       *   – neither is forecast on any calendar, so both read against the prior
       *     print — a basis this engine supports explicitly and documents;
       *   – the readings are not marginal. NZ confidence ran 80.3 — 86.5 — 91.3 —
       *     99.3 across four months; a +1 is the honest read of that series.
       *
       * A1 scoring the NZ leg -1 remains unexplained and is recorded as a
       * source difference, not as evidence against our +1. Leaving a current,
       * primary, monthly series unscored to protect a parity number is the
       * failure mode this engine exists to avoid.
       *
       * The dash in the ANZ name is an EN DASH in the feed. The character class
       * accepts any of the three so a cosmetic change upstream cannot silently
       * blank the column — which is exactly how the GBP leg was lost once.
       */
      NZD: [
        /^ANZ\s*[-\u2013\u2014]\s*Roy Morgan Consumer Confidence$/i,
        /^Westpac Consumer Survey$/i,
      ],
      AUD: [/^Westpac Consumer Confidence$/i],
    },
  },

  // --- Inflation ----------------------------------------------------------
  {
    key: 'cpi',
    label: 'CPI YoY',
    title: 'Consumer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Consumer Price Index \(YoY\)$/i],
    matchByCurrency: {
      // The euro-area aggregate, not a member state.
      EUR: [/^Harmonized Index of Consumer Prices \(YoY\)$/i],
      /**
       * EX FRESH FOOD, not the headline — because the headline is not forecast.
       *
       * Japan is the only major whose HIGH-impact consensus coverage runs near
       * half (47%, against 80-92% everywhere else), and the CPI complex is the
       * whole of the difference. Measured over 120 days of the live feed:
       *
       *   National Consumer Price Index (YoY)     5 prints, 0 with a consensus
       *   National CPI ex Food, Energy (YoY)      5 prints, 0
       *   National CPI ex Fresh Food (YoY)        5 prints, 5   <- this one
       *
       * So the headline could never be scored at all: `resolveSeries` skipped it
       * for want of a forecast and the JPY leg of every yen cross lost the
       * column outright. Ex-fresh-food is the Bank of Japan's official core
       * measure and the series the street actually surveys, which is why it is
       * the one carrying forecasts on both calendars — TradingView corroborates
       * at 4/4 under the name "Core Inflation Rate YoY".
       *
       * The headline is kept as a second pattern so the column degrades to an
       * unscoreable-but-visible cell if the core series ever drops out, rather
       * than vanishing. Tokyo's advance print is still deliberately excluded.
       */
      JPY: [
        /^National CPI ex Fresh Food \(YoY\)$/i,
        /^National Consumer Price Index \(YoY\)$/i,
      ],
    },
  },
  {
    /**
     * A1 lists PPI and PCE as columns but publishes no rule for either, unlike
     * every other category. Treated as ordinary actual-vs-forecast reads, which
     * is what the rest of their macro block does — but it is an inference, not a
     * documented rule.
     */
    key: 'ppi',
    label: 'PPI YoY',
    title: 'Producer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    /**
     * 90 DAYS, because the SCOREABLE print lags further than the series does.
     *
     * `resolveSeries` deliberately reaches past a release that carries no
     * consensus, since a print with no forecast cannot produce a beat or a miss.
     * UK core PPI's recent entries are exactly that, so the newest usable print
     * sits two publication cycles back — measured at 61 days against a 60-day
     * window, which dropped the GBP leg on every sterling pair and left GBPUSD
     * reading +1 where A1 reads +2.
     *
     * The two rules were each right and were cancelling each other out. Widening
     * here is the narrow fix; the real one is a consensus source for UK PPI, at
     * which point the newest print scores directly and this window stops
     * mattering.
     */
    maxAgeDays: 90,
    match: [/^Producer Price Index \(YoY\)$/i, /^Producer Price Index \(MoM\)$/i],
    /**
     * Their CH card publishes this row with no Forecast, and the AU card is
     * blank too: 3.5 actual against a 3.4 previous, Surprise 0.1%.
     *
     * GBP IS THE THIRD, and their card says so as plainly as the other two:
     * `PPI YoY`, dated Jan 21 26, Actual 3.4, Forecast BLANK, Previous 3.4,
     * Surprise 0. Actual minus previous, with nothing else it could be. That
     * is also why the GBP series order below could be wrong for so long — a
     * forecast-basis slot disqualifies every UK producer-price series that
     * carries no consensus, which is all of the YoY ones.
     */
    compareByCurrency: { CHF: 'previous', AUD: 'previous', GBP: 'previous' },
    matchByCurrency: {
      /**
       * HEADLINE OUTPUT PRICES, YEAR ON YEAR — the series their card names.
       *
       * OLD RATIONALE, NOW REFUTED: "CORE output prices, not headline output or
       * input. Only the core series reproduces their GBPUSD cell: on the same
       * day headline output (0.0 vs 0.4) and input (-2.0 vs 0.2) both missed,
       * which would give GBPUSD 0, while core output (0.8 vs 0.4) beat and gives
       * the +2 they show."
       *
       * That was fitted to one cell, and it compared a FRESH headline print
       * against a STALE core one — the 0.0-vs-0.4 headline was 2026-07-22 while
       * the 0.8-vs-0.4 core was 2026-06-17, a month older. It never considered
       * the YoY series at all, because a forecast basis disqualified it.
       *
       * Their published UK card overrules the inference: `PPI YoY`, Actual 3.4,
       * Forecast blank, Previous 3.4, Surprise 0. YoY, not MoM; headline, not
       * core (core output YoY runs near 2.8 and input near 4.9, so 3.4 can only
       * be the headline); and against the previous print, which is what
       * `compareByCurrency` above now says.
       *
       * WHAT THE OLD ORDER COST. Core output MoM carries no consensus in recent
       * months, so a forecast basis reached PAST every fresh print to the last
       * one that had a forecast — 2026-06-17, sixty-eight days before the
       * capture, scoring +1 off it while 2026-08-19 sat unread four days back.
       * That print reads 3.1 against a 3.5 previous and a 3.2 consensus: -1 on
       * either basis. Two points, on the GBP leg of every sterling pair.
       */
      GBP: [
        /^Producer Price Index - Output \(YoY\) n\.s\.a$/i,
        /^Producer Price Index - Output \(MoM\) n\.s\.a$/i,
      ],
      /**
       * Each country names its producer-price series differently, and none of
       * the three below contains the words "Producer Price Index" in the order
       * the generic patterns expect. All three were resolving to nothing while
       * sitting in the feed:
       *
       *   CHF  Producer and Import Prices        released 4 days ago
       *   CAD  Industrial Product Price          released 24 days ago
       *   NZD  Producer Price Index - Output     quarterly, so often stale
       */
      /**
       * MoM FIRST for Switzerland, against the YoY-first order everywhere else.
       *
       * `resolveSeries` commits to the first pattern that has any released data,
       * so a leading YoY pattern wins the slot and then cannot be scored:
       * neither calendar forecasts the Swiss YoY series. The MoM variant is
       * forecast by both. Mixing MoM against another leg's YoY is fine here
       * because the cell is ternary — it reads the direction of the surprise,
       * not the level.
       */
      /**
       * YoY FIRST, reversing the MoM-first order the comment above defends.
       *
       * That comment is right that neither calendar forecasts the Swiss YoY
       * series — and irrelevant, because A1 does not score it against a
       * forecast. Their published CH card carries `PPI YoY` with the Forecast
       * column BLANK and a Surprise of -0.2% off an actual of -1.8% against a
       * previous of -1.6%: actual minus previous, exactly. `compareByCurrency`
       * below makes us read it the same way, at which point the absence of a
       * forecast stops disqualifying the series their card actually names.
       */
      CHF: [/^Producer and Import Prices \(YoY\)$/i, /^Producer and Import Prices \(MoM\)$/i],
      CAD: [/^Industrial Product Price \(MoM\)$/i],
      NZD: [/^Producer Price Index - Output \(QoQ\)$/i],
      /**
       * YoY FIRST, reversing the QoQ-first order the note below defended.
       *
       * OLD RATIONALE, NOW STALE: "Australia publishes producer prices
       * QUARTERLY, and only the QoQ variant is forecast — the YoY carries an
       * actual and nothing to score it against." True, and no longer
       * disqualifying: `compareByCurrency` above now reads this currency's
       * producer prices against the PREVIOUS PRINT, so the YoY series does not
       * need a forecast to be scoreable.
       *
       * Their AU card names the row `PPI YoY` outright and publishes it with the
       * Forecast column blank — 3.5% actual against a 3.4% previous, Surprise
       * 0.1% — which is the same series and the same basis this order now picks.
       */
      AUD: [/^Producer Price Index \(YoY\)$/i, /^Producer Price Index \(QoQ\)$/i],
    },
  },
  {
    // Rule inferred, same as PPI above.
    key: 'pce',
    label: 'PCE YoY',
    title: "Core PCE price index — the Fed's preferred inflation gauge",
    category: 'inflation',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    // US-only by construction. Other currencies leave this blank.
    usOnly: true,
    match: [/^Core Personal Consumption Expenditures - Price Index \(YoY\)$/i],
  },
  {
    /**
     * Rate EXPECTATIONS, not the last decision.
     *
     * A1 compares each currency's current policy rate against their own house
     * forecast for next quarter (a1trading.com/edgefinder/interest-rates/).
     *
     * The bank's OWN published projection is the only thing that scores here.
     * The Fed publishes one — the dot plot's Summary of Economic Projections —
     * and nobody else does, so seven of the eight majors score a permanent 0 on
     * this column and say so in the tooltip.
     *
     * A 2-year-yield proxy was tried and rejected: it is the MARKET's forecast
     * rather than the bank's, and the two disagreed outright — the US 2-year sat
     * above the policy rate implying hikes while the dots projected cuts. The
     * spread is still computed and shown for contrast; it does not vote.
     *
     * Scored in lib/scoring/rates.ts, not from the calendar.
     */
    key: 'rates',
    label: 'Interest Rates',
    title:
      "The central bank's own projected rate path. Only the Fed publishes numbers, " +
      'so every other currency scores 0 here rather than a guess.',
    category: 'inflation',
    kind: 'rates',
    scoring: true,
  },

  // --- Jobs ---------------------------------------------------------------
  {
    /**
     * US NON-FARM PAYROLLS ONLY.
     *
     * Their column is headed "NFP", and it only ever contributes +/-1 to a pair
     * — the US leg, inverted when USD is the quote. We also matched other
     * currencies' employment series, which gave AUDUSD a 2 where they read 1.
     *
     * PCE, claims, ADP and JOLTS are US-only for the same reason: they are US
     * series, and A1's columns name them as such.
     */
    key: 'employment',
    label: 'NFP',
    title: 'US non-farm payrolls',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    usOnly: true,
    // Anchored so "Nonfarm Payrolls (QoQ)" and the benchmark revision are excluded.
    match: [/^Nonfarm Payrolls$/i],
  },
  {
    key: 'unemployment',
    label: 'Unemploy. Rate',
    title: 'Unemployment rate',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: -1,
    /**
     * Switzerland's unemployment rate carries no forecast on A1's CH card — the
     * Forecast column is blank and the Surprise is 3.1% against a previous of
     * 2.9%, so 0.2% is actual minus previous. Every other economy on their cards
     * shows a forecast for this row, which is why this is one currency and not
     * the slot default.
     *
     * THAT ROW ALSO NAMES THE SERIES, which took three rounds to notice. It is
     * dated `Jan 9, 26` and no adjusted Swiss print has ever gone 2.9 -> 3.1:
     * the ADJUSTED series was flat at 3.0 either side of it. The UNADJUSTED one
     * read 2.90 in November 2025 and 3.10 in December, which is the release that
     * card is showing. Both halves of this slot's CHF handling — the basis here
     * and the matcher below — come off that single row.
     */
    compareByCurrency: { CHF: 'previous' }, // higher unemployment is bearish for the currency
    maxAgeDays: 60,
    match: [/^Unemployment Rate$/i, /^Unemployment Rate s\.a\.$/i],
    matchByCurrency: {
      GBP: [/^ILO Unemployment Rate \(3M\)$/i],
      /**
       * THE UNADJUSTED RATE, AND THE ADJUSTED ONE IS NOT A FALLBACK.
       *
       * SECO publishes both on the same morning. FXStreet carries only
       * `Unemployment Rate s.a (MoM)` — which this matcher used to name — and
       * the two series answer the same question with opposite signs whenever
       * the season turns. July 2026 is exactly that case: unadjusted 2.9 -> 3.0
       * is a RISE, adjusted 3.1 -> 3.1 is FLAT.
       *
       * A1 scores the unadjusted one. Two independent pieces of their own
       * published output say so and neither is a total:
       *
       *   their free Unemployment Rate page, CHF, Dec 24 -> Jun 26:
       *     2,80 3,00 2,90 2,90 2,80 2,80 2,70 2,70 2,80 2,80 2,90 2,90
       *     3,10 3,20 3,20 3,10 3,00 3,00 2,90
       *   winter highs and summer lows, which a seasonally adjusted series does
       *   not have; the last five agree with this series to the decimal.
       *
       *   their CH heatmap card, row dated `Jan 9, 26`: actual 3.1, forecast
       *   blank, previous 2.9 — the December 2025 unadjusted print, scored
       *   bearish off actual minus previous.
       *
       * The print arrives through `TRADINGVIEW.actualSeries`, the same
       * allowlist AUD household spending uses, and is republished under the
       * name below. Listing the adjusted series after it as a safety net was
       * considered and rejected: a fallback that silently swaps in a different
       * statistic is worse than a blank cell, because the cell it produces is
       * confident and wrong. If TradingView is down this column goes blank and
       * says so.
       */
      CHF: [/^Unemployment Rate$/i],
    },
  },
  {
    // Context from here down: real jobs-market information, but not columns A1
    // scores, so they must not move the total.
    key: 'claims',
    label: 'Unemploy. Claims',
    title: 'Initial jobless claims',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: -1,
    usOnly: true,
    maxAgeDays: 21, // weekly series
    match: [/^Initial Jobless Claims$/i],
  },
  {
    key: 'adp',
    label: 'ADP',
    title: 'ADP private payrolls',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    usOnly: true,
    maxAgeDays: 60,
    match: [/^ADP Employment Change$/i],
  },
  {
    key: 'jolts',
    label: 'JOLTS',
    title: 'JOLTS job openings',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    usOnly: true,
    maxAgeDays: 75, // published with a long lag
    match: [/^JOLTS Job Openings$/i],
  },

  // --- Heatmap only -------------------------------------------------------
  // Columns A1's per-country heatmaps carry and their Top Setups does not.
  // Both count toward the Impact percentage on their cards, so both are scored
  // here — they simply never reach the matrix. See `heatmapOnly`.
  {
    /**
     * The euro area's headline labour read, and the row A1's EU card carries
     * where every other economy's card has none.
     *
     * Quarterly, hence the long window. The YoY variant exists in the feed and
     * carries no consensus, so QoQ leads.
     */
    key: 'employment-change',
    label: 'Employment Change',
    title: 'Employment change',
    category: 'jobs',
    kind: 'economic',
    scoring: false,
    heatmapOnly: true,
    polarity: 1,
    maxAgeDays: 120,
    match: [/^Employment Change \(QoQ\)$/i, /^Employment Change \(YoY\)$/i],
    matchByCurrency: {
      /**
       * CANADA TOO, not just the euro area — their CA card carries this row as
       * the last line, where it is the Canadian analogue of the US payroll
       * print. Statistics Canada calls it Net Change in Employment, which none
       * of the generic patterns above reach, so the CA card was rendering one
       * row short of theirs.
       *
       * Monthly and forecast on every print in the feed, unlike the euro area's
       * quarterly, so it is the more reliable half of this slot.
       */
      CAD: [/^Net Change in Employment$/i, /^Employment Change$/i],
    },
  },
  {
    /**
     * Japan's household spending, the row A1's JP card carries in place of a
     * consumer-confidence reading.
     *
     * Their card reads this Bullish for the yen and Bearish for stocks, which is
     * the INFLATION polarity applied to a growth series. That looks like a slip
     * on their side, so it is filed under `growth` here and equities read it the
     * same way the currency does — noted rather than copied, because copying a
     * suspected bug is how it becomes permanent.
     */
    key: 'household-spending',
    label: 'Household Spending',
    title: 'Japanese household spending',
    category: 'growth',
    kind: 'economic',
    scoring: false,
    heatmapOnly: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Overall Household Spending \(YoY\)$/i, /^Household Spending \(YoY\)$/i],
  },
  {
    /**
     * WAGE GROWTH, AND THE UNITED STATES ONLY.
     *
     * Their US card carries a Wage Growth YoY row and it counts toward the
     * 58.33% Impact printed beneath it — seven bullish of twelve directional
     * rows, which only reconciles with this row present. We had no slot for it,
     * so the dollar's card ran one row short of theirs and the Economic Surprise
     * Meter inherited the difference.
     *
     * NOT WIDENED TO THE OTHER MAJORS, though the feed would allow it: Average
     * Earnings Including Bonus for the UK, Labor Cash Earnings for Japan,
     * Average Hourly Wages for Canada, the Wage Price Index for Australia and
     * Negotiated Wage Rates for the euro area all exist. No card outside the US
     * carries this row, and adding it would move those cards' Impact
     * denominators AWAY from theirs — the exact failure this slot fixes for the
     * dollar. `Average Hourly Earnings (YoY)` is a US-only name, so the
     * restriction needs no `matchByCurrency`, the same way `employment` is
     * confined by `/^Nonfarm Payrolls$/i`.
     *
     * `jobs` rather than `growth`, so equities read it the same way the dollar
     * does. Their card's Stocks Impact column agrees: a positive wage surprise
     * reads Bullish there as well as for the currency.
     */
    key: 'wage-growth',
    label: 'Wage Growth',
    title: 'Average hourly earnings, year on year',
    category: 'jobs',
    kind: 'economic',
    scoring: false,
    heatmapOnly: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Average Hourly Earnings \(YoY\)$/i],
  },
];

/** The columns that move the total. Everything else is displayed context. */
export const SCORING_SLOTS = SLOTS.filter((s) => s.scoring);

/**
 * The columns the Top Setups matrix renders — everything except the
 * heatmap-only ones. `SLOTS` remains the full set, and the per-country heatmap
 * is the only consumer that wants it.
 */
export const MATRIX_SLOTS = SLOTS.filter((s) => !s.heatmapOnly);

/**
 * The rows a per-country card renders — everything except the matrix-only ones.
 *
 * The complement of `MATRIX_SLOTS`, and the reason both exist: their two
 * surfaces publish different sets. `buildCurrencyHeatmap` is the only consumer.
 */
export const CARD_SLOTS = SLOTS.filter((s) => !s.matrixOnly);

/** Default staleness window when a slot does not set one. */
export const DEFAULT_MAX_AGE_DAYS = 60;

/**
 * REVISION_WINDOW_DAYS IS GONE, DELIBERATELY, AND THIS NOTE IS ITS HEADSTONE.
 *
 * It was the window inside which `resolveSeries` would reach past a confirming
 * revision to the flash that carried the actual surprise. A1 does not do that —
 * their 2026-08-23 EURUSD card only reconciles if the euro GDP leg reads the
 * 14 Aug revision rather than the 30 Jul flash. Removing the reach-back moved
 * TOTAL ABS GAP 96 -> 92 and exact rows 7 -> 9 against that capture, and touched
 * no currency but EUR.
 *
 * The full argument, including the one that was lost, is in `pickWithin` in
 * `lib/scoring/discrete.ts`. Restoring the constant alone will do nothing;
 * the rule that used it was removed with it.
 */

/**
 * Where the standing policy rate is read from, per currency.
 *
 * No longer a scored column — `rates` scores expectations instead — but the
 * level itself is still needed for the carry scanner, for real yields, and as
 * the baseline the 2-year yield is compared against.
 */
export const POLICY_RATE_MATCH: SeriesMatcher = {
  match: [/Interest Rate Decision$/i, /^Official Cash Rate/i, /^Bank Rate$/i],
  matchByCurrency: {
    // The deposit facility is the effective policy rate, not the MRO.
    EUR: [/^ECB Rate On Deposit Facility$/i, /^ECB Main Refinancing Operations Rate$/i],
  },
};

/** How stale a policy rate may be before we stop trusting it. */
export const POLICY_RATE_MAX_AGE_DAYS = 120;

/**
 * The central bank's OWN forecast of its policy rate — the Fed's dot plot.
 *
 * This is what A1's interest-rate column actually compares: "current and next
 * quarter's forecasted interest rate ... Data from the Central Bank Forecast
 * Page". The FOMC publishes exactly that, and FXStreet carries it.
 *
 * ONLY THE FED PUBLISHES ONE. The ECB, BoE, RBA and the rest give guidance in
 * prose, not numbers, so every other currency scores 0 on this column — see
 * scoreRateExpectation for why 0 beats a guess here.
 *
 * Released quarterly with the FOMC's Summary of Economic Projections, so the
 * staleness window spans a full quarter with margin.
 */
export const RATE_PROJECTION_MATCH: { current: SeriesMatcher; nextYear: SeriesMatcher } = {
  current: { match: [/^Interest Rate Projections - Current$/i] },
  nextYear: { match: [/^Interest Rate Projections - 1st year$/i] },
};

export const RATE_PROJECTION_MAX_AGE_DAYS = 200;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Fundamentals are TERNARY: a release either beat, missed, or landed on
 * forecast. Magnitude is discarded, and that is A1's model rather than an
 * approximation of it — every macro category on their card contributes exactly
 * +/-1 per currency however large the surprise.
 *
 * The trade-off is real and accepted: a 0.15 sigma miss and a 3 sigma miss score
 * the same. Sigma is still computed, kept on the SlotResult, and rendered in the
 * detail column, so magnitude is one hover away.
 *
 * EPSILON absorbs float noise between values that are equal at the feed's own
 * precision (3.3 vs 3.3 must be 0). It is NOT a deadband — an earlier +/-0.25
 * sigma deadband quietly swallowed genuine misses.
 */
export const TERNARY_EPSILON = 1e-9;

/**
 * Default per-leg cell bounds. Individual slots widen this via `maxCell`
 * (trend +/-3) or narrow it (crowd +/-1).
 */
export const CELL_MIN = -1;
export const CELL_MAX = 1;

/** Bounds for a combined pair cell, before any slot-specific override. */
export const PAIR_CELL_MIN = -2;
export const PAIR_CELL_MAX = 2;

/**
 * Long-share bands for COT net positioning.
 *
 * Applies to standalone symbols — indices, commodities, crypto and the currency
 * indices. A1 scores the LEGS OF A PAIR purely on the weekly change
 * (a1trading.com/edgefinder/cot-data/); net positioning is the second component
 * only where a symbol reads one contract directly.
 *
 * 60/40, NOT the 55/45 we had. Two of their published cards pin this, and only
 * this band satisfies both at once:
 *
 *   USD INDEX  74.4% long, +0.95% change -> +1 +1 = +2, and their Sentiment+COT
 *              subtotal of +1 reconciles only as (+1 +1 -1).
 *   EURO FX    43.7% long, +1.22% change -> their cell reads +1. At 55/45 the
 *              long share scores -1 and the cell collapses to 0; at 60/40 it
 *              lands inside the neutral band and the change carries it alone.
 *
 * It is also the band they publish verbatim for retail sentiment below, which is
 * a reason to think one number governs both rather than a coincidence.
 */
export const COT_LONG_PCT_BUCKETS = {
  bullish: 60,
  bearish: 40,
} as const;

/**
 * Percentile bands, retained for DISPLAY only.
 *
 * Ranking a position against its own 3-year range is the more revealing measure
 * — it is what shows a huge gold net long sitting below its own median — but it
 * is not what A1 scores, so it informs the reader without moving the number.
 */
export const COT_PERCENTILE_BUCKETS = {
  veryBullish: 80,
  bullish: 60,
  bearish: 40,
  veryBearish: 20,
} as const;

/** How much history the percentile is measured against. */
export const COT_LOOKBACK_WEEKS = 156; // ~3 years

/**
 * Crowd sentiment, read CONTRARIAN — a crowded long is a bearish signal, which
 * is why these map to negative cells.
 *
 * A1's published thresholds, verbatim: ">= 60% long -> -1 score", "<= 40% long
 * -> +1". The 40-60% band is deliberately wide; most of the time the crowd is
 * not saying anything.
 *
 * THE THRESHOLDS ARE RIGHT AND THE INPUT IS NOT. Identified 2026-08-24 from
 * their own free Looker demo, which publishes the Retail Sentiment page live
 * (lookerstudio.google.com/embed/reporting/cfd37bd1-45ce-459a-8d11-b6b7eac72b0d).
 * Read against fxssi.com/tools/current-ratio in the same minute:
 *
 *   pair    EdgeFinder long%   FXSSI buyers%
 *   EURUSD        24               24
 *   GBPUSD        31               31
 *   AUDUSD        25               25
 *   NZDUSD        29               29
 *   USDCHF        80               80
 *   USDJPY        55               55
 *   USDCAD        63               62   <- their 30-minute refresh against FXSSI's 5
 *
 * Six of seven to the point. Their crowd column is a broker-aggregate retail
 * ratio — FXSSI aggregates Oanda, Dukascopy, IG, FIBO, InstaForex, Myfxbook,
 * FXBlue and ForexFactory — quoted LONG PERCENT ON THE PAIR AS NAMED. We read
 * CFTC small traders on the currency future instead, which is a different
 * population: 62.7% long the EURO FX contract on the same day their crowd was
 * 24% long EURUSD. Same rule, opposite input, and the whole of EURUSD's
 * remaining -2.
 *
 * Two consequences worth keeping:
 *   - There is no inversion problem. The feed is per SYMBOL, so USDJPY 55% long
 *     means 55% long USDJPY. Our `pairContract` sign flip exists only because a
 *     CME contract is always quoted CUR/USD; a retail feed would not need it.
 *   - METALS ARE THIS FEED TOO, which a previous round got wrong. It read the
 *     two-decimal formatting of the GOLD and SILVER rows as evidence they came
 *     from the put/call page instead. The formatting split is real and the
 *     inference was not: both appear in A1's own daily retail series, and on
 *     2026-08-24 they read 95.08% and 91.05% long -- which is -1 under these
 *     same bands, and is exactly A1's XAUUSD and XAGUSD crowd cell for that
 *     date. A put/call page does exist in their demo; it is not what the Crowd
 *     column reads. See `lib/scoring/crowd-oracle.ts`.
 *
 * THE BANDS ARE NOW READ OFF A1'S OWN CHART, not inferred from their prose.
 * Their free Retail Sentiment dashboard renders each row with an explicit
 * Bearish / Bullish / Neutral classification in its accessibility tree, and on
 * 2026-08-29 it partitioned exactly here:
 *
 *   Bullish   40, 39, 38, 33, 31, 30, 28, 27, 26, 24, 13, 10, 6
 *   Neutral   58, 54, 53, 48, 47, 44, 42
 *   Bearish   89, 84, 80, 75, 71, 62, 61, 60.84
 *
 * EURGBP AT EXACTLY 40 IS CLASSIFIED BULLISH, which pins the lower bound as
 * INCLUSIVE and is why `scoreRetailLongPct` uses `<=` rather than `<`. The upper
 * bound is bracketed rather than pinned: 58 is Neutral and 60.84 is Bearish, so
 * it lies in (58, 60.84], and A1's published ">= 60% long -> -1" sits inside
 * that interval.
 *
 * TWO APPARENT CONTRADICTIONS WERE THE INPUT, NOT THE RULE. Prior rounds
 * recorded EURCHF at ~48% long and GBPCHF at ~50% against A1 Top Setups cells of
 * +1, which the 40/60 bands cannot produce, and left the thresholds under
 * suspicion for several rounds. Both figures came from FXSSI standing in for
 * A1's own number, because A1's page was believed to carry no crosses. It does —
 * the Category filter simply defaults to excluding them. A1's OWN historical
 * feed for 2026-08-24, the day those cells were captured, reads:
 *
 *   EURCHF 32% long   GBPCHF 36%   GBPUSD 31%   EURUSD 25%
 *
 * All four are <= 40, all four score +1, and all four match the Top Setups cell
 * on file. The bands were never wrong. Do not move them.
 */
export const CROWD_LONG_PCT_BUCKETS = {
  bearish: 60, // crowd leaning long -> -1 (contrarian)
  bullish: 40, // crowd leaning short -> +1
} as const;

/**
 * Trend: a fast and a slow SMA, per a1trading.com/edgefinder/trend/.
 *
 * "3-day SMA: Captures short-term price trends. 14-day SMA: Captures longer-term
 * price trends." Crossover scores +/-2, the 14-day slope +/-1, and a
 * disagreement between them costs 1 — see scoreTrend for the composition.
 */
export const TREND_SMA = { fast: 3, slow: 14 } as const;

/** How far back the slow SMA's slope is measured. */
export const TREND_SLOPE_LOOKBACK_DAYS = 1;

/**
 * Seasonality is the SIGN of the 10-year average for the current calendar month,
 * nothing more: "If the current month's 10 year historical average performance
 * is positive, the EdgeFinder assigns a +2 [or +1]".
 *
 * We previously gated it behind a mean-return and win-rate threshold. That is
 * defensible analysis — a +2% average driven by one outlier year is not a
 * tendency — but it is not their rule, so both figures are still returned and
 * displayed while only the sign votes.
 */
export const SEASONALITY_MIN_YEARS = 5;

/**
 * +/-1 for EVERY asset class.
 *
 * Their seasonality page says indices and commodities get +/-2 "because seasonal
 * tendencies are very pronounced" there. Their live product does not do that:
 * GOLD and SILVER both show seasonality 1, and GOLD's published total of 8 only
 * reconciles with seasonality at 1 — at 2 it would be 9. No row anywhere in
 * their table shows +/-2 in this column.
 *
 * Where the documentation and the running product disagree, the product wins.
 * Kept as a per-kind map rather than a constant so the split is one edit away if
 * they ever ship what the page describes.
 */
export const SEASONALITY_CELL_MAX_BY_KIND = {
  fx: 1,
  currency: 1,
  index: 1,
  commodity: 1,
  crypto: 1,
} as const;

/**
 * Non-FX assets read interest rates off the US 2-year against its own average:
 * "If price is above the moving average, -1. If price is below the moving
 * average, +1" — a rising short yield tightens financial conditions, which is
 * bearish for indices, gold and crypto alike.
 *
 * 21 DAYS, not the 7 their interest-rates page implies. Their Asset Scorecard
 * labels this row verbatim "2 Yr Yield (21 day SMA)", and a product label naming
 * its own window beats a prose page describing it.
 */
export const YIELD_SMA_DAYS = 21;

/** Below this the 2-year is treated as flat against its average. */
export const YIELD_FLAT_BAND = 0.005;

/** Years of monthly history used for the seasonal average. */
export const SEASONALITY_YEARS = 10;


// ---------------------------------------------------------------------------
// Price structure
// ---------------------------------------------------------------------------

/**
 * Tunables for `lib/scoring/structure.ts`.
 *
 * These feed levels the user will place orders against, so every value below is
 * a stated judgement rather than a fitted parameter. None of them affect a
 * score: structure is display-only, because A1's bias bands are absolute and
 * adding an input would silently redefine "Bullish".
 *
 * Distances are expressed in ATR throughout, never in percent. A 0.3% band is
 * unreachable in a market whose daily range is 0.1% and trivially satisfied in
 * one that ranges 2%, so a percentage tolerance means something different for
 * every symbol on the board. ATR is the only unit under which "close together"
 * means the same thing for gold and for the franc.
 */

/** Bars either side of a candidate pivot. 3 gives the standard 7-bar fractal. */
export const SWING_LOOKBACK = 3;

/** Periods in the average true range. Wilder's original, and still the default. */
export const ATR_PERIOD = 14;

/**
 * Minimum distance from the previous kept swing, in ATR, for a pivot to count.
 *
 * Raw fractals fire constantly — on any real series most of them are noise. At
 * 1.5 the retained swings are the ones a person would mark by hand, which is the
 * bar this has to clear: the level has to be findable on the user's own chart.
 */
export const MIN_SWING_ATR = 1.5;

/** How close price must come, in ATR, to count as having retested a level. */
export const RETEST_ATR = 0.5;

/**
 * How far past a level a close must sit to count as a break.
 *
 * A close one tick beyond a swing high is not a break in any sense a trader
 * would recognise, and at five decimal places it is often just rounding. Small
 * on purpose: a large buffer turns break-of-structure into a momentum filter and
 * pushes the signal past the retest, which is where the entry is.
 */
export const BREAK_BUFFER_ATR = 0.1;

/**
 * Bars after which a break stops describing the current market.
 *
 * ~6 months of daily bars. Past that the market has usually re-ranged and the
 * level the break defined is one price has since traded through in both
 * directions. Reporting it as "where price broke structure" hands the user a
 * level the market has visibly stopped respecting.
 */
export const STALE_BREAK_BARS = 120;

/** Window used to state range edges when there is no live break. */
export const RANGE_LOOKBACK_BARS = 60;

/**
 * Round-number grid spacing, in ATR.
 *
 * Sized to enforce one invariant: `step / 2 > CONFLUENCE_ATR`, so a round number
 * can never be automatically within tolerance of the current price. With a fixed
 * grid this breaks — a 0.005 grid on EURUSD puts a round number within 25 pips
 * of any price, which on a 60-pip ATR is inside the tolerance always, so the
 * round-number vote becomes free and every confluence score inflates by one.
 */
export const ROUND_STEP_ATR = 2;

/** One source is not confluence. */
export const MIN_CONFLUENCE_SOURCES = 2;

/**
 * Furthest a zone can sit from price and still be worth listing, in ATR.
 *
 * Observed on EURUSD: a two-year-old untested low showed up 24 ATR below spot —
 * arithmetically a level, operationally irrelevant, and it crowded out the ones
 * price could actually reach this month. Ten ATR is roughly two weeks of range.
 */
export const MAX_ZONE_ATR = 10;

/** Zones listed at most. Sorted nearest-first, so the cut drops the furthest. */
export const MAX_ZONES = 8;

/**
 * Merge distance for confluence, in ATR.
 *
 * 0.35 is about a third of a day's range: near enough that price cannot
 * meaningfully distinguish the two levels within a session, which is the only
 * defensible meaning of "these line up".
 */
export const CONFLUENCE_ATR = 0.35;

/** Retracement ratios drawn. 0.618 is the one the UI emphasises. */
export const FIB_RATIOS = [0.382, 0.5, 0.618, 0.786] as const;

/** How near 0.618 price must sit to be called "in the golden zone". */
export const FIB_ZONE_TOLERANCE = 0.05;

/**
 * Shortest impulse leg worth retracing, in ATR.
 *
 * Derived, not guessed. The closest pair of ratios drawn is 0.5 and 0.618, which
 * sit `0.118 x leg` apart. For those two to be distinguishable — at least one
 * confluence tolerance apart — the leg must satisfy `0.118 x leg >= 0.35`, i.e.
 * `leg >= 2.97` ATR. Below that the grid renders four lines a trader could not
 * place separate orders at, which is noise wearing the costume of precision.
 */
export const MIN_LEG_ATR = 3;

/** Fewest bars before any structure is computed at all. */
export const STRUCTURE_MIN_BARS = 60;


/**
 * Percentile bands for how big a week's COT flow was.
 *
 * Measured against the contract's OWN 156 weekly changes, never an absolute
 * contract count — 5,000 contracts is a huge week in NZD and noise in gold, so
 * a fixed threshold would rank the largest markets top every single week.
 */
export const COT_FLOW_BANDS = {
  extreme: 95,
  heavy: 80,
  notable: 50,
} as const;


// ---------------------------------------------------------------------------
// Bias labels
// ---------------------------------------------------------------------------

export type Bias = 'Very Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Very Bearish';

/**
 * Total score -> label. Published verbatim at
 * a1trading.com/edgefinder/top-setups/: "'Bullish' if the total score is greater
 * or equal to +4, and 'Very Bullish' if the total score is greater or equal
 * to +7", mirrored for the downside.
 *
 * THESE CUTS ARE ABSOLUTE, NOT A FRACTION OF THE MAXIMUM. A1 never moved them as
 * they added columns, which is why a EURUSD can print 14 and still just be "Very
 * Bullish" — 14 is twice the threshold, not near a cap.
 *
 * The direct consequence: adding a scoring column silently redefines what
 * "Bullish" means. That is the entire reason SlotDefinition carries a `scoring`
 * flag, and why MAX_PAIR_SCORE below is asserted in the test suite.
 */
export const BIAS_THRESHOLDS: { min: number; bias: Bias }[] = [
  { min: 7, bias: 'Very Bullish' },
  { min: 4, bias: 'Bullish' },
  { min: -3, bias: 'Neutral' },
  { min: -6, bias: 'Bearish' },
  { min: -Infinity, bias: 'Very Bearish' },
];

export function biasFromScore(score: number): Bias {
  return BIAS_THRESHOLDS.find((t) => score >= t.min)?.bias ?? 'Neutral';
}

/**
 * Largest total a symbol of this kind can reach.
 *
 * THIS DIFFERS BY ASSET CLASS. An FX pair DIFFERENCES two economies, so each
 * macro cell spans +/-2; gold, an index or a crypto reads ONE economy, so the
 * same cell spans only +/-1. A single-economy asset can never reach an FX pair's
 * total, and drawing it on an FX dial permanently understates it — that is what
 * made Gold read "+5 out of 25".
 *
 * Both numbers are large relative to the +/-7 "Very Bullish" cut, and that is
 * A1's design rather than a flaw in ours: their bands are absolute and never
 * moved as they added columns, so their own EURUSD prints 9 and their GBPUSD 11
 * on the same 18-column table.
 *
 * Computed from the slot list rather than written down, so it tracks changes,
 * and asserted in the test suite so adding a column has to be deliberate.
 */
export function maxScoreForKind(kind: SymbolKind): number {
  return SCORING_SLOTS.reduce((total, slot) => total + maxCellFor(slot.key, kind), 0);
}

/**
 * Largest value ONE cell of this slot can reach, for this asset class.
 *
 * Extracted from `maxScoreForKind` rather than duplicated, because the UI needs
 * exactly this number to say whether "+2" is a strong reading or a maximal one,
 * and the total is defined as the sum of these. Two copies of the rule would
 * eventually let a cell be labelled "Very Bullish" on a scale the total does not
 * agree exists.
 */
export function maxCellFor(slotKey: string, kind: SymbolKind): number {
  const slot = SLOTS.find((s) => s.key === slotKey);

  if (slotKey === 'seasonality') return SEASONALITY_CELL_MAX_BY_KIND[kind];
  if (slotKey === 'trend') return slot?.maxCell ?? CELL_MAX;
  if (slotKey === 'cot') return slot?.maxCell ?? PAIR_CELL_MAX;
  if (slotKey === 'crowd') return slot?.maxCell ?? CELL_MAX;

  // Everything else is an economic cell: only a pair differences two legs, so
  // it spans +/-2 where a single-economy asset spans +/-1.
  return kind === 'fx' ? PAIR_CELL_MAX : CELL_MAX;
}

/** Convenience for the FX case, which is what most callers mean. */
export function maxPairScore(): number {
  return maxScoreForKind('fx');
}
