/**
 * The 51 symbols on the scorecard, each mapped to its price ticker, its COT
 * contract, and its currency legs.
 *
 * All 28 pair tickers were verified against Yahoo before being written here, and
 * every CFTC contract name was read from the live report rather than guessed —
 * they are irregular ("NZ DOLLAR", not "NEW ZEALAND DOLLAR"; "WTI-PHYSICAL",
 * not "CRUDE OIL") and a typo produces a silently empty COT column rather than
 * an error.
 */

import type { Asset, Currency } from '@/lib/types';

/**
 * The kind drives real scoring rules, so it is not just a display label: which
 * COT rule applies, and whether the rate cell is a differential or the US
 * 2-year against its average.
 *
 * `currency` is a single currency as its own symbol — the euro rather than
 * EURUSD. It reads ONE economy like a commodity does, but it is still a
 * currency, so it takes the FX COT rule of weekly change only. A1's EURO row
 * confirms it: EUR speculators are 43.7% long (net positioning -1) while the
 * week's change was +1.22% (+1), and their card shows +1 — the weekly change
 * alone, not the sum.
 */
export type SymbolKind = 'fx' | 'currency' | 'commodity' | 'index' | 'crypto';

export interface SymbolDefinition {
  /** Display symbol, and the URL segment for /scorecard/[symbol]. */
  symbol: string;
  label: string;
  kind: SymbolKind;
  /** Yahoo Finance ticker for price history. */
  yahoo: string;

  /**
   * Currency legs. Fundamentals for a pair are base-minus-quote, so both matter.
   * Commodities have a base asset and no quote leg.
   */
  base?: Currency;
  quote?: Currency;
  asset?: Asset;

  /**
   * Exact CFTC `contract_market_name`. Absent means no COT column for this
   * symbol — crosses like EURGBP have no single contract, so their COT cell is
   * derived from the two legs' own contracts instead.
   */
  cotContract?: string;

  /**
   * For symbols with no currency legs: whose macro data to read.
   *
   * A pair differences two economies; gold, the S&P and Bitcoin each read ONE.
   * Without this an index scores only its technical and sentiment columns, which
   * is five of thirteen.
   */
  macroEconomy?: Currency;

  /**
   * Which way that economy's data reads, per category. Defaults to +1.
   *
   * The signs are not uniform across asset classes, and getting that wrong is a
   * real error rather than a nuance:
   *
   *   gold        strong growth is BEARISH — it is the safe-haven trade.
   *               "If the latest US GDP figure is higher than what was
   *               forecasted... this [is] bearish for gold."
   *   industrial  strong growth is BULLISH: silver, platinum and oil are
   *               demand-driven. "Strong GDP suggests increased demand for raw
   *               materials." We previously scored these exactly like gold,
   *               which had the sign backwards on every growth and jobs print.
   *   equities    strong growth is bullish, but hot inflation is BEARISH,
   *               because it prices in tighter policy.
   */
  macroPolarity?: Partial<Record<MacroCategory, 1 | -1>>;

}

/** The macro categories a single-economy symbol can read. */
export type MacroCategory = 'growth' | 'inflation' | 'jobs';

/**
 * EVERY non-FX asset reads a hotter-than-forecast print as BEARISH.
 *
 * This is the one sign that is uniform across the asset classes, and it is the
 * rates channel: a hot print prices in tighter policy, and tighter policy hurts
 * gold, equities, crypto and industrial commodities alike. A1 publishes it
 * identically for all three groups —
 *
 *   gold        "If latest US CPI is LOWER than forecasted, +1"
 *   commodities "If latest CPI is HIGHER than forecasted, -1 / LOWER, +1"
 *   indices/BTC "If latest CPI is HIGHER than forecasted, -1 / LOWER, +1"
 *
 * WE HAD THIS BACKWARDS FOR GOLD AND COMMODITIES. The intuition that gold is an
 * inflation hedge is about the RAW PRINT, but these polarities multiply a cell
 * that is already expressed as "bullish for the dollar" — so an inflation-hedge
 * reading of +1 turned a dollar-bearish CPI miss into a gold-bearish cell. Cooler
 * US inflation is bullish gold, and now scores that way.
 *
 * The level-based half of their inflation rule lives separately, in
 * lib/scoring/inflation.ts, and that one DOES differ by asset class.
 */
const NON_FX_INFLATION: 1 | -1 = -1;

/** Gold: a haven. Weak growth and weak jobs lift it. */
const GOLD_POLARITY: Partial<Record<MacroCategory, 1 | -1>> = {
  growth: -1,
  jobs: -1,
  inflation: NON_FX_INFLATION,
};

/**
 * Oil: industrial demand, so strong growth and strong jobs are bullish. "Strong
 * GDP suggests increased demand for raw materials."
 *
 * SILVER AND PLATINUM ARE NOT IN THIS GROUP, despite their page grouping them
 * with oil and copper as "industrial commodities". A1's SILVER row is identical
 * to their GOLD row in every macro column — GDP +1, mPMI -1, sPMI +1, NFP +1,
 * unemployment -1, claims -1, ADP +1, JOLTS +1 — differing only on COT. Their
 * product reads the precious metals as havens, and putting silver here flipped
 * the sign on eight of its cells.
 */
const INDUSTRIAL_POLARITY: Partial<Record<MacroCategory, 1 | -1>> = {
  growth: 1,
  jobs: 1,
  inflation: NON_FX_INFLATION,
};

/** Equities and crypto: a growth trade with a rates problem. */
const RISK_ASSET_POLARITY: Partial<Record<MacroCategory, 1 | -1>> = {
  growth: 1,
  jobs: 1,
  inflation: NON_FX_INFLATION,
};

/**
 * Exported so the heatmap's "Stocks Impact" column reads the same table the
 * scorecard scores indices with, and so the parity tests can assert the signs
 * directly. Two copies of any of these would drift.
 */
export { GOLD_POLARITY, INDUSTRIAL_POLARITY, RISK_ASSET_POLARITY };

/**
 * CFTC contracts per currency, verified present in the 2026-08-04 report.
 * Used both for the FX majors directly and for deriving cross-pair COT.
 */
export const CURRENCY_COT_CONTRACT: Record<Currency, string> = {
  USD: 'USD INDEX',
  EUR: 'EURO FX',
  GBP: 'BRITISH POUND',
  JPY: 'JAPANESE YEN',
  AUD: 'AUSTRALIAN DOLLAR',
  NZD: 'NZ DOLLAR',
  CAD: 'CANADIAN DOLLAR',
  CHF: 'SWISS FRANC',
  ZAR: 'SO AFRICAN RAND',
};

const MAJORS: Currency[] = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

/**
 * All 28 unique combinations of the 8 majors.
 *
 * Order follows market convention rather than being alphabetised: EUR outranks
 * GBP outranks AUD/NZD outranks USD outranks CAD/CHF/JPY. Quoting EURUSD (not
 * USDEUR) matters because every score's sign is expressed relative to the base.
 */
function buildFxPairs(): SymbolDefinition[] {
  const out: SymbolDefinition[] = [];
  for (let i = 0; i < MAJORS.length; i++) {
    for (let j = i + 1; j < MAJORS.length; j++) {
      const base = MAJORS[i];
      const quote = MAJORS[j];
      const symbol = `${base}${quote}`;
      out.push({
        symbol,
        label: `${base}/${quote}`,
        kind: 'fx',
        yahoo: `${symbol}=X`,
        base,
        quote,
      });
    }
  }
  return out;
}

/**
 * Pairs that are NOT a cross of two majors, listed one at a time.
 *
 * USDZAR is on EdgeFinder's major list and was the last pair missing here. It
 * cannot come from `buildFxPairs`, because that function is a full cross
 * product — putting ZAR in `MAJORS` to reach one pair would also have created
 * EURZAR, GBPZAR, AUDZAR and five more that nothing asked for.
 *
 * It scores like any other pair, base minus quote. South Africa's calendar
 * coverage is real but partial — CPI, PPI, retail sales, GDP, unemployment and
 * manufacturing all publish; payrolls, PCE, claims, ADP, JOLTS and the PMIs do
 * not — so several cells inherit the inverted US reading through the missing
 * leg, exactly as NZDUSD does under Employment Change today. That is the
 * existing rule working, not a gap.
 */
export const MINOR_FX_SYMBOLS: SymbolDefinition[] = [
  {
    symbol: 'USDZAR',
    label: 'USD/ZAR',
    kind: 'fx',
    yahoo: 'USDZAR=X',
    base: 'USD',
    quote: 'ZAR',
    // Verified present in the 2026-08-04 report, open interest 29,188.
    cotContract: 'SO AFRICAN RAND',
  },
];

export const FX_SYMBOLS = [...buildFxPairs(), ...MINOR_FX_SYMBOLS];

export const COMMODITY_SYMBOLS: SymbolDefinition[] = [
  {
    symbol: 'XAUUSD', label: 'Gold', kind: 'commodity', yahoo: 'GC=F', asset: 'XAU',
    cotContract: 'GOLD', macroEconomy: 'USD', macroPolarity: GOLD_POLARITY,
  },
  {
    symbol: 'XAGUSD', label: 'Silver', kind: 'commodity', yahoo: 'SI=F', asset: 'XAG',
    cotContract: 'SILVER', macroEconomy: 'USD', macroPolarity: GOLD_POLARITY,
  },
  {
    /**
     * INDUSTRIAL, unlike gold and silver — forced by arithmetic on A1's own table.
     *
     * Their Top Setups shows GOLD +11 and PLATINUM -4 in the same snapshot. Both
     * read the US economy, so if they shared a polarity every macro cell would be
     * identical and the two totals could only differ across the four per-symbol
     * slots: trend (+/-2), seasonality (+/-1), COT (+/-2) and crowd (+/-1) — a
     * maximum spread of 12. The observed spread is 15. Shared polarity is
     * therefore impossible, whatever date that table was captured on.
     *
     * Silver stays a haven: their SILVER row still matches GOLD column for
     * column, and the two score 10 against 11. Platinum was only ever grouped
     * with silver by assumption, and it is the one precious metal whose demand is
     * genuinely industrial — autocatalysts, not vaults.
     *
     * Flipping it here reproduces their -4 exactly, once its seasonality reads
     * the -1 their row shows.
     */
    symbol: 'XPTUSD', label: 'Platinum', kind: 'commodity', yahoo: 'PL=F', asset: 'XPT',
    cotContract: 'PLATINUM', macroEconomy: 'USD', macroPolarity: INDUSTRIAL_POLARITY,
  },
  {
    symbol: 'WTIUSD', label: 'WTI Crude', kind: 'commodity', yahoo: 'CL=F', asset: 'WTI',
    cotContract: 'WTI-PHYSICAL', macroEconomy: 'USD', macroPolarity: INDUSTRIAL_POLARITY,
  },
  /**
   * Copper: the last symbol EdgeFinder carries that we did not.
   *
   * INDUSTRIAL, not haven — the one commodity where that grouping is
   * uncontroversial. Silver and platinum sit under GOLD_POLARITY despite A1's
   * page filing them as industrial, because their product reads them as havens
   * (see the README); copper has no such conflict, and strong growth genuinely
   * lifts it.
   *
   * No `asset` entry: that union feeds the beta table in assets.config.ts,
   * which has no copper row. Indices already omit it for the same reason.
   *
   * `COPPER- #1` and not `COPPER`. Both names exist in the CFTC file and the
   * plain one is a dead legacy series whose last report is from 1989 — picking
   * it would have produced a silently 37-year-stale positioning cell rather
   * than an error. Verified live: `COPPER- #1` reports in the same weekly file
   * as gold, open interest 289,395.
   */
  {
    symbol: 'XCUUSD', label: 'Copper', kind: 'commodity', yahoo: 'HG=F',
    cotContract: 'COPPER- #1', macroEconomy: 'USD', macroPolarity: INDUSTRIAL_POLARITY,
  },
];

/**
 * Stock indices.
 *
 * Every Yahoo ticker below was resolved live before being written here, and
 * every CFTC contract name was read from a real report rather than guessed —
 * they are irregular ("NASDAQ-100 Consolidated", "RUSSELL E-MINI") and a typo
 * produces a silently empty COT column rather than an error.
 *
 * GER40 and UK100 deliberately have NO `cotContract`. The DAX trades on Eurex
 * and the FTSE on ICE Europe, both outside the CFTC's remit, so no Commitments
 * of Traders report exists for them at any price. Their COT and Crowd cells are
 * blank by construction, not by oversight.
 */
/**
 * The eight currencies as standalone symbols.
 *
 * A1 carries these on Top Setups beside the pairs — EURO, GB-POUND, AU-DOLLAR
 * and so on — and they answer a different question from any pair: "is this
 * currency strong", not "is it stronger than that one". Without them, a EUR
 * reading could only be seen through whichever pair you happened to open.
 *
 * They score like gold does: ONE economy, read straight through rather than
 * differenced, so each macro cell spans +/-1. Everything they need already
 * exists — the CFTC contracts are the same ones the pairs derive their COT legs
 * from, and `macroEconomy` is the mechanism the commodities already use.
 *
 * PRICE comes from the CME currency futures rather than a trade-weighted index,
 * because no free trade-weighted index exists for anything but the dollar.
 * Every ticker below was resolved live. The consequence is that trend and
 * seasonality for, say, EURO track EURUSD rather than a basket — honest for the
 * dollar leg, and the same compromise A1's own numbers imply.
 *
 * `macroPolarity` is deliberately unset: a currency's own strong data is bullish
 * for it, which is the +1 default.
 *
 * THEY ARE SINGLE-ECONOMY ROWS, NOT PAIRS AGAINST THE DOLLAR, and that was
 * tested rather than assumed. A1's own board argues for the other reading: their
 * CA-DOLLAR row shows Cnsmr Conf 0 while their CADCHF shows -2, and CAD - CHF =
 * -2 with CAD = 0 needs CHF = +2, which no single leg can reach. Scoring these
 * rows as `CUR - USD` makes that algebra legal.
 *
 * It also makes the board worse. Simulated over all seven rows: total absolute
 * gap 20 -> 35, and every row moved by exactly +5 because the US macro leg sums
 * to -5 and was being subtracted uniformly. A1's currency rows average about +1
 * and ours average +0.7 as they stand, so the single-economy reading is the one
 * their totals support.
 *
 * The unexplained part is therefore one cell, not the model: CADCHF's Cnsmr Conf
 * is most likely mis-transcribed. Its row sums correctly, but the sum check
 * cannot see two errors that cancel — which has already happened once in this
 * fixture. Do not re-run this experiment without a re-read of that cell.
 */
export const CURRENCY_INDEX_SYMBOLS: SymbolDefinition[] = [
  { symbol: 'EURX', label: 'Euro', kind: 'currency', yahoo: '6E=F', macroEconomy: 'EUR', cotContract: 'EURO FX' },
  { symbol: 'GBPX', label: 'British Pound', kind: 'currency', yahoo: '6B=F', macroEconomy: 'GBP', cotContract: 'BRITISH POUND' },
  { symbol: 'JPYX', label: 'Japanese Yen', kind: 'currency', yahoo: '6J=F', macroEconomy: 'JPY', cotContract: 'JAPANESE YEN' },
  { symbol: 'AUDX', label: 'Australian Dollar', kind: 'currency', yahoo: '6A=F', macroEconomy: 'AUD', cotContract: 'AUSTRALIAN DOLLAR' },
  { symbol: 'NZDX', label: 'New Zealand Dollar', kind: 'currency', yahoo: '6N=F', macroEconomy: 'NZD', cotContract: 'NZ DOLLAR' },
  { symbol: 'CADX', label: 'Canadian Dollar', kind: 'currency', yahoo: '6C=F', macroEconomy: 'CAD', cotContract: 'CANADIAN DOLLAR' },
  { symbol: 'CHFX', label: 'Swiss Franc', kind: 'currency', yahoo: '6S=F', macroEconomy: 'CHF', cotContract: 'SWISS FRANC' },
];

export const INDEX_SYMBOLS: SymbolDefinition[] = [
  {
    /**
     * The dollar is the one currency with a real trade-weighted index, so it
     * uses that rather than a futures proxy. Reads its own economy straight
     * through, exactly like the seven above.
     */
    symbol: 'DXY',
    label: 'Dollar Index',
    kind: 'currency',
    yahoo: 'DX-Y.NYB',
    macroEconomy: 'USD',
    cotContract: 'USD INDEX',
  },
  {
    symbol: 'SPX500', label: 'S&P 500', kind: 'index', yahoo: '^GSPC',
    cotContract: 'E-MINI S&P 500', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
  {
    symbol: 'NAS100', label: 'Nasdaq 100', kind: 'index', yahoo: '^NDX',
    cotContract: 'NASDAQ-100 Consolidated', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
  {
    symbol: 'US30', label: 'Dow Jones 30', kind: 'index', yahoo: '^DJI',
    cotContract: 'DJIA Consolidated', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
  {
    symbol: 'RUT2000', label: 'Russell 2000', kind: 'index', yahoo: '^RUT',
    cotContract: 'RUSSELL E-MINI', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
  /**
   * Non-US indices read their OWN economy. A1's docs spell out that US GDP
   * scores the US indices but say nothing about the DAX or Nikkei; reading the
   * home economy is the only reading that makes sense, and it is what makes
   * these rows more than a technical score.
   */
  {
    symbol: 'JP225', label: 'Nikkei 225', kind: 'index', yahoo: '^N225',
    cotContract: 'NIKKEI STOCK AVERAGE YEN DENOM', macroEconomy: 'JPY', macroPolarity: RISK_ASSET_POLARITY,
  },
  // No CFTC contract — Eurex and ICE Europe respectively.
  { symbol: 'GER40', label: 'DAX 40', kind: 'index', yahoo: '^GDAXI', macroEconomy: 'EUR', macroPolarity: RISK_ASSET_POLARITY },
  { symbol: 'UK100', label: 'FTSE 100', kind: 'index', yahoo: '^FTSE', macroEconomy: 'GBP', macroPolarity: RISK_ASSET_POLARITY },
];

/**
 * Crypto. Both CFTC contracts carry real speculator and small-trader legs,
 * though retail participation is thin (~1,700 contracts on Bitcoin against
 * ~419,000 on the E-mini S&P), so the crowd cell will often decline to score.
 */
export const CRYPTO_SYMBOLS: SymbolDefinition[] = [
  /**
   * Scored as risk assets rather than as digital gold. A1 groups BTC with the
   * indices for both the interest-rate and the CPI-location rules, and publishes
   * no separate growth rule for it, so following the index treatment is the
   * closest defensible reading. Ether gets the same by extension — they document
   * no crypto beyond Bitcoin at all.
   */
  {
    symbol: 'BTCUSD', label: 'Bitcoin', kind: 'crypto', yahoo: 'BTC-USD',
    cotContract: 'BITCOIN', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
  {
    symbol: 'ETHUSD', label: 'Ethereum', kind: 'crypto', yahoo: 'ETH-USD',
    cotContract: 'ETHER CASH SETTLED', macroEconomy: 'USD', macroPolarity: RISK_ASSET_POLARITY,
  },
];

/**
 * TradingView symbols, for the embedded chart only.
 *
 * A THIRD ticker namespace, and unavoidable: Yahoo's `GC=F` and `BTC-USD` mean
 * nothing to TradingView, whose symbols are exchange-qualified. Kept as an
 * override table rather than a field on every definition because the FX
 * majors — 28 of the 49 rows — follow one rule and need no entry at all.
 *
 * Exchange prefixes are pinned rather than left bare. An unqualified "GOLD"
 * resolves to whichever feed TradingView picks for the viewer, which can be a
 * different contract with different prices from the one we scored.
 */
const TRADINGVIEW_SYMBOL: Record<string, string> = {
  XAUUSD: 'TVC:GOLD',
  XAGUSD: 'TVC:SILVER',
  XPTUSD: 'TVC:PLATINUM',
  WTIUSD: 'TVC:USOIL',
  /**
   * The COMEX front month, because TradingView has no `TVC:COPPER` to match the
   * other three metals. Without an entry here `XCUUSD` fell through to the
   * fallback below and was sent to the widget verbatim — not an invalid ticker
   * in a way that errors, just one TradingView cannot resolve, so the panel came
   * up blank with no indication that the symbol was the problem.
   */
  XCUUSD: 'COMEX:HG1!',

  DXY: 'TVC:DXY',
  // Currency-index rows price off CME futures, so the chart shows the same
  // contract the trend and seasonality cells were computed from.
  EURX: 'CME:6E1!',
  GBPX: 'CME:6B1!',
  JPYX: 'CME:6J1!',
  AUDX: 'CME:6A1!',
  NZDX: 'CME:6N1!',
  CADX: 'CME:6C1!',
  CHFX: 'CME:6S1!',

  SPX500: 'SP:SPX',
  NAS100: 'NASDAQ:NDX',
  US30: 'DJ:DJI',
  RUT2000: 'TVC:RUT',
  JP225: 'TVC:NI225',
  GER40: 'XETR:DAX',
  UK100: 'TVC:UKX',

  BTCUSD: 'BITSTAMP:BTCUSD',
  ETHUSD: 'BITSTAMP:ETHUSD',
};

/** The chart symbol for a definition. FX majors fall through to the convention. */
export function tradingViewSymbol(def: SymbolDefinition): string {
  return TRADINGVIEW_SYMBOL[def.symbol] ?? (def.kind === 'fx' ? `FX:${def.symbol}` : def.symbol);
}

/**
 * The ticker Yahoo's streaming socket knows this instrument by, or null when it
 * does not stream at all.
 *
 * TWO QUIRKS, BOTH MEASURED RATHER THAN ASSUMED — see `lib/live/streams.ts`.
 *
 * USD-BASE PAIRS ARE KEYED WITHOUT THE USD. Subscribing to `USDJPY=X` is
 * accepted and then silently never ticks; the stream carries the same
 * instrument as `JPY=X`. Verified over 40 seconds: `USDJPY=X`, `USDCHF=X` and
 * `USDCAD=X` produced zero frames while `JPY=X`, `CHF=X` and `CAD=X` produced
 * 39, 27 and 38. The price is the same quotation — `JPY=X` came back 159.355
 * against USDJPY's 159.335 on a broker feed, not its reciprocal — so this is a
 * naming difference, not a different market, and no inversion is involved.
 *
 * FUTURES DO NOT STREAM. `GC=F`, `SI=F`, `CL=F` and `HG=F` all accept the
 * subscription and send nothing, which is consistent with them being exactly
 * ten minutes delayed over the REST endpoint. The CME currency-index contracts
 * (`6E=F` and friends) are the same product and get the same treatment. Those
 * symbols stay on polling, which is the honest transport for a delayed feed.
 *
 * Cash indices DO stream, but only while their own session is open — `^FTSE`
 * ticked 34 times in the same window that `^GSPC` sat silent at 12:00 UTC. That
 * is a closed market, not a missing feed, so they are mapped and their silence
 * is left to mean what it means.
 */
export function streamTicker(def: SymbolDefinition): string | null {
  if (def.yahoo.endsWith('=F')) return null;

  const usdBase = /^USD([A-Z]{3})=X$/.exec(def.yahoo);
  return usdBase ? `${usdBase[1]}=X` : def.yahoo;
}

export const ALL_SYMBOLS: SymbolDefinition[] = [
  ...FX_SYMBOLS,
  ...COMMODITY_SYMBOLS,
  ...CURRENCY_INDEX_SYMBOLS,
  ...INDEX_SYMBOLS,
  ...CRYPTO_SYMBOLS,
];

/**
 * Instruments fetched for their price only — never scored, never a scorecard row.
 *
 * The risk gauge needs VIX and the 10-year yield, and neither is a thing you
 * would trade a bias on here. Adding them to ALL_SYMBOLS would put two
 * meaningless cards on Top Setups and, worse, drag them into the bullish/bearish
 * counts in the header.
 */
export const AUX_TICKERS: { symbol: string; yahoo: string; label: string }[] = [
  { symbol: 'VIX', yahoo: '^VIX', label: 'Volatility index' },
  { symbol: 'US10Y', yahoo: '^TNX', label: '10-year Treasury yield' },
];

export function findSymbol(symbol: string): SymbolDefinition | undefined {
  const target = symbol.toUpperCase();
  return ALL_SYMBOLS.find((s) => s.symbol === target);
}

/**
 * Short display tickers for CFTC contract names.
 *
 * The raw names are a mouthful — "NIKKEI STOCK AVERAGE YEN DENOM", "ETHER CASH
 * SETTLED", "CANADIAN DOLLAR" — and on a dense table or a bar chart they force
 * the contract column three times wider than every other, or squash the bars to
 * fit their labels. These are the tickers A1 uses on their own COT screen.
 *
 * Unmapped contracts fall through to their raw name, so adding a CFTC contract
 * never silently loses its label.
 */
export const COT_CONTRACT_TICKER: Record<string, string> = {
  'EURO FX': 'EUR',
  'BRITISH POUND': 'GBP',
  'JAPANESE YEN': 'JPY',
  'AUSTRALIAN DOLLAR': 'AUD',
  'NZ DOLLAR': 'NZD',
  'CANADIAN DOLLAR': 'CAD',
  'SWISS FRANC': 'CHF',
  'USD INDEX': 'USD',
  'SO AFRICAN RAND': 'ZAR',

  GOLD: 'GOLD',
  SILVER: 'SILVER',
  PLATINUM: 'PLATINUM',
  'WTI-PHYSICAL': 'USOil',
  // The CFTC's own name, punctuation and all. Left raw it is the widest label
  // in the table, which on the COT positioning chart sets the bar width and
  // makes copper read as though it matters five times more than gold.
  'COPPER- #1': 'COPPER',

  'E-MINI S&P 500': 'SPX',
  'NASDAQ-100 Consolidated': 'NASDAQ',
  'DJIA Consolidated': 'DOW',
  'RUSSELL E-MINI': 'RUSSELL',
  'NIKKEI STOCK AVERAGE YEN DENOM': 'NIKKEI',

  BITCOIN: 'BTC',
  'ETHER CASH SETTLED': 'ETH',
};

/** Short ticker for a contract, falling back to the raw CFTC name. */
export function cotTicker(contract: string): string {
  return COT_CONTRACT_TICKER[contract] ?? contract;
}

/** Every distinct CFTC contract we need to fetch, deduped. */
export const REQUIRED_COT_CONTRACTS: string[] = [
  ...new Set([
    ...Object.values(CURRENCY_COT_CONTRACT),
    ...ALL_SYMBOLS.map((s) => s.cotContract).filter((c): c is string => !!c),
  ]),
];

/** Yahoo tickers needed for technicals, deduped. Includes the aux instruments. */
export const REQUIRED_YAHOO_TICKERS: string[] = [
  ...new Set([...ALL_SYMBOLS.map((s) => s.yahoo), ...AUX_TICKERS.map((t) => t.yahoo)]),
];

/** Everything fetchTechnicals should be asked for: scored symbols plus aux. */
export const TECHNICALS_TARGETS: { symbol: string; yahoo: string }[] = [
  ...ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo })),
  ...AUX_TICKERS.map((t) => ({ symbol: t.symbol, yahoo: t.yahoo })),
];
