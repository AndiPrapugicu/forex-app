/**
 * The REACTION reader: "X just moved — what happened?"
 *
 * A fixed panel of instruments read off Yahoo's 5-minute bars, the thresholds
 * that make a move worth naming, and the cross-asset patterns those moves
 * form. Nothing here is fitted; each band is a round number a trader would use,
 * and each pattern is the textbook reading of stocks against yields.
 *
 * Context for the analyst only. Nothing here feeds the board or the narrative.
 */

export type ReactionGroup = 'equities' | 'rates' | 'dollar' | 'havens' | 'commodities' | 'volatility' | 'crypto';

export interface ReactionInstrument {
  ticker: string;
  label: string;
  group: ReactionGroup;
  /**
   * How a move is stated. `yield` tickers quote a yield in percent, so their
   * change is in basis points; `note-futures` quote a PRICE, so a yield change is
   * derived from it (see `duration`); everything else is a percent change.
   */
  unit: 'pct' | 'yield' | 'note-futures';
  /** Modified duration, for turning a note future's price change into an approximate yield change. */
  duration?: number;
}

/**
 * The panel. ZT=F stands in for the 2-year because Yahoo has no intraday 2-year
 * yield; the cash yield indices (^FVX, ^TNX, ^TYX) only print during US hours.
 */
export const REACTION_PANEL: ReactionInstrument[] = [
  { ticker: 'NQ=F', label: 'Nasdaq 100 futures', group: 'equities', unit: 'pct' },
  { ticker: 'ES=F', label: 'S&P 500 futures', group: 'equities', unit: 'pct' },
  { ticker: 'RTY=F', label: 'Russell 2000 futures', group: 'equities', unit: 'pct' },
  // Two-year note futures: duration about 1.9 (CBOT ZT, cheapest-to-deliver).
  { ticker: 'ZT=F', label: 'US 2Y (from ZT futures)', group: 'rates', unit: 'note-futures', duration: 1.9 },
  { ticker: '^FVX', label: 'US 5Y yield', group: 'rates', unit: 'yield' },
  { ticker: '^TNX', label: 'US 10Y yield', group: 'rates', unit: 'yield' },
  { ticker: '^TYX', label: 'US 30Y yield', group: 'rates', unit: 'yield' },
  { ticker: 'DX-Y.NYB', label: 'Dollar index', group: 'dollar', unit: 'pct' },
  { ticker: 'JPY=X', label: 'USD/JPY', group: 'havens', unit: 'pct' },
  { ticker: 'CHF=X', label: 'USD/CHF', group: 'havens', unit: 'pct' },
  { ticker: 'GC=F', label: 'Gold', group: 'havens', unit: 'pct' },
  { ticker: 'CL=F', label: 'WTI crude', group: 'commodities', unit: 'pct' },
  { ticker: 'BZ=F', label: 'Brent crude', group: 'commodities', unit: 'pct' },
  { ticker: 'HG=F', label: 'Copper', group: 'commodities', unit: 'pct' },
  { ticker: '^VIX', label: 'VIX', group: 'volatility', unit: 'pct' },
  { ticker: 'BTC-USD', label: 'Bitcoin', group: 'crypto', unit: 'pct' },
];

/**
 * The symbol's own intraday ticker, where its daily one does not trade around
 * the clock: the cash indices print only in their session, the futures do not
 * stop. Anything not listed reads its own `yahoo` ticker.
 */
export const INTRADAY_TICKER: Record<string, string> = {
  NAS100: 'NQ=F',
  SPX500: 'ES=F',
  US30: 'YM=F',
  RUT2000: 'RTY=F',
};

export const REACTION = {
  /**
   * How far back the 5-minute bars go. Five days reaches "yesterday" and
   * "Monday"; verified 2026-10-09 (`range=5d&interval=5m` on spark).
   */
  range: '5d',
  interval: '5m',
  /** The look-back when the question names no moment. */
  searchHours: 8,
  /**
   * The user's clock, for "yesterday", "this morning" and "at 17:00". The user
   * trades from Romania; TradingView prints their charts in UTC+3 in summer.
   */
  userTimeZone: 'Europe/Bucharest',
  /** A described "2 hours" also matches a move up to this much longer. */
  durationSlack: 1.5,
  /**
   * "Dropped 2%" with no length means a sharp move, not a day-long drift: the
   * search first looks at moves up to this long, and only then at any length.
   */
  defaultMoveMinutes: 240,
  /** Below this share of the described size, the measured move is "smaller than described". */
  weakerShare: 0.5,
  /** An instrument's own move starts at the first bar past this share of its window move. */
  onsetShare: 0.25,
  /** Stock and rate onsets further apart than this may have separate causes. */
  splitOnsetMinutes: 30,
  /** Headlines that explain the move after the fact are read up to this long after it ended. */
  explainerHours: 12,
  /** Most attribution clusters shown per asset class. */
  attributionShown: 2,
  /** Scheduled events this close to the move count as inside it. */
  scheduledSlackMinutes: 45,
  /** Dated searches run per question, and hits kept per search. */
  maxSearches: 7,
  hitsPerSearch: 20,
  /** Fixed windows reported for every instrument, in hours. */
  windows: [1, 2, 4] as const,
  /** Below these a move is "flat" for the pattern. */
  flat: { pct: 0.25, bp: 2.5 },
  /** A move this large is "sharp". */
  sharp: { pct: 1, bp: 8 },
  /** Curve shape: one end must lead the other by this many bp. */
  curveLeadBp: 1.5,
  /** Headlines this long before the move began can still be its cause. */
  catalystLeadMinutes: 90,
  /** Most catalysts listed. */
  catalystsShown: 8,
  /** Cache for the batch call: a reaction question is about the last minutes. */
  cacheTtlSeconds: 60,
};

/**
 * A move verb makes a question about a move that already happened ("dropped",
 * "a scăzut"). "What happened today?" alone is a recap, not a move, and stays BRIEF.
 */
export const REACTION_WORDS =
  /\b(dropp?ed|drops|fell|plunged?|plunging|tanked|tanking|crash(ed|ing)?|sold off|sell-?off|dumped|dumping|spiked?|spiking|jumped|surged?|soared|rallied|ripped|pumped|whipsaw\w*|a (scăzut|scazut|crescut|căzut|cazut|picat|sărit|sarit|explodat)|scade|scad|crește|creste)\b/i;

// ---------------------------------------------------------------------------
// Words in a question: instruments, directions, events
// ---------------------------------------------------------------------------

/**
 * A whole-word pattern that also works next to Romanian diacritics, where
 * `\b` does not (ă, ț and ș are not "word" characters to a plain regex).
 */
export function wordsPattern(alternatives: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, flags);
}

export interface InstrumentAlias {
  pattern: RegExp;
  /** An app symbol (findSymbol), when the market is on the board. */
  symbol?: string;
  /** A reaction-panel ticker, when it is not (the yields, the VIX, Brent). */
  ticker?: string;
  label: string;
}

/**
 * What traders call the markets, in English and Romanian, as typed and as
 * TradingView and the brokers name them. "US30Y" is a yield and "US30" the Dow:
 * the yield patterns need the Y, so the two never collide.
 */
export const INSTRUMENT_ALIASES: InstrumentAlias[] = [
  { pattern: wordsPattern('us0?2y|2y|2-?year|2 year|two-year|doi ani'), ticker: 'ZT=F', label: 'US 2Y yield' },
  { pattern: wordsPattern('us0?5y|5y|5-?year|five-year'), ticker: '^FVX', label: 'US 5Y yield' },
  { pattern: wordsPattern('us10y|10y|10-?year|ten-year|tnx|zece ani'), ticker: '^TNX', label: 'US 10Y yield' },
  { pattern: wordsPattern('us20y|20y|20-?year'), ticker: '^TYX', label: 'US 30Y yield (nearest to the 20Y)' },
  { pattern: wordsPattern('us30y|30y|30-?year|thirty-year|long bond|30 de ani'), ticker: '^TYX', label: 'US 30Y yield' },
  { pattern: wordsPattern('nasdaq(?: 100)?|ndx|ndq(?:100)?|nas100|us100|ustec|nq|tech100'), symbol: 'NAS100', label: 'Nasdaq 100' },
  { pattern: wordsPattern('s&p(?: ?500)?|spx(?:500)?|spy|us500'), symbol: 'SPX500', label: 'S&P 500' },
  { pattern: wordsPattern('dow(?: jones)?|us30|dji'), symbol: 'US30', label: 'Dow Jones 30' },
  { pattern: wordsPattern('russell(?: 2000)?|rut(?:2000)?|rty|small caps?|us2000'), symbol: 'RUT2000', label: 'Russell 2000' },
  { pattern: wordsPattern('dax|ger40|de40|ger30'), symbol: 'GER40', label: 'DAX 40' },
  { pattern: wordsPattern('ftse(?: 100)?|uk100'), symbol: 'UK100', label: 'FTSE 100' },
  { pattern: wordsPattern('nikkei(?: 225)?|jp225|jpn225'), symbol: 'JP225', label: 'Nikkei 225' },
  { pattern: wordsPattern('gold|xau(?:usd)?|aur(?:ul|ului)?|bullion'), symbol: 'XAUUSD', label: 'Gold' },
  { pattern: wordsPattern('silver|xag(?:usd)?|argint(?:ul|ului)?'), symbol: 'XAGUSD', label: 'Silver' },
  { pattern: wordsPattern('platinum|xpt(?:usd)?'), symbol: 'XPTUSD', label: 'Platinum' },
  { pattern: wordsPattern('copper|cupru(?:l|lui)?|xcu(?:usd)?'), symbol: 'XCUUSD', label: 'Copper' },
  { pattern: wordsPattern('brent'), ticker: 'BZ=F', label: 'Brent crude' },
  { pattern: wordsPattern('oil|crude|wti(?:usd)?|usoil|petrol(?:ul|ului)?|țiței|titei'), symbol: 'WTIUSD', label: 'WTI crude' },
  { pattern: wordsPattern('bitcoin|btc(?:usd)?'), symbol: 'BTCUSD', label: 'Bitcoin' },
  { pattern: wordsPattern('ether(?:eum)?|eth(?:usd)?'), symbol: 'ETHUSD', label: 'Ethereum' },
  { pattern: wordsPattern('dxy|dollar index|indicele dolarului'), symbol: 'DXY', label: 'Dollar index' },
  { pattern: wordsPattern('vix|volatility index'), ticker: '^VIX', label: 'VIX' },
  { pattern: wordsPattern('cable'), symbol: 'GBPUSD', label: 'GBPUSD' },
  { pattern: wordsPattern('fiber'), symbol: 'EURUSD', label: 'EURUSD' },
  { pattern: wordsPattern('loonie'), symbol: 'USDCAD', label: 'USDCAD' },
  { pattern: wordsPattern('aussie'), symbol: 'AUDUSD', label: 'AUDUSD' },
  { pattern: wordsPattern('kiwi'), symbol: 'NZDUSD', label: 'NZDUSD' },
];

/** Six letters that name an FX pair, e.g. "EURUSD", "eur/usd". */
export const FX_PAIR = /(?<![A-Za-z])(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD|ZAR|MXN|SEK|NOK)\s?\/?\s?(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD|ZAR|MXN|SEK|NOK)(?![A-Za-z])/gi;

/** Which way the user says it went. Past and present, English and Romanian. */
export const DOWN_WORDS = wordsPattern(
  'dropp?ed|drops?|dropping|fell|falls?|falling|plunged?|plunging|tanked|tanking|crash(?:ed|ing)?|sold off|sell-?off|dumped|dumping|slid|slides?|sliding|sank|sinks?|tumbled?|tumbling|declined?|declining|dipped|slumped|a (?:scăzut|scazut|căzut|cazut|picat)|scade|scad|cade|pică|pica',
);
export const UP_WORDS = wordsPattern(
  'spiked?|spiking|jumped|jumps?|surged?|surging|soared|soaring|rallied|rally|rallying|ripped|pumped|rose|rises?|rising|climbed|gained|popped|a (?:crescut|sărit|sarit|explodat|urcat)|crește|creste|urcă|urca',
);

export interface EventAlias {
  key: string;
  label: string;
  /** How the user asks about it. */
  ask: RegExp;
  /** Calendar names to study, most representative first (FXStreet naming). */
  names: RegExp[];
}

/**
 * The releases a trader asks "what happens on…?" about. US by default; a
 * country word in the question (euro, UK, Japan…) moves it, see `EVENT_COUNTRY`.
 */
export const EVENT_ALIASES: EventAlias[] = [
  {
    key: 'cpi',
    label: 'CPI',
    ask: wordsPattern('cpi|hicp|inflation (?:data|print|report|numbers?)|datele de inflație|datele de inflatie|inflația|inflatia'),
    names: [/^Consumer Price Index \(MoM\)$/i, /^Consumer Price Index ex Food & Energy \(MoM\)$/i, /^Consumer Price Index \(YoY\)$/i, /consumer price index|harmonized index/i],
  },
  {
    key: 'nfp',
    label: 'Nonfarm Payrolls',
    ask: wordsPattern('nfp|non-?farm(?: payrolls)?|payrolls?|jobs report|raportul (?:de )?(?:joburi|locuri de muncă|locuri de munca)'),
    names: [/nonfarm payrolls/i, /employment change/i],
  },
  {
    key: 'fomc',
    label: 'Fed decision',
    ask: wordsPattern('fomc|fed (?:decision|meeting)|rate decision|decizia fed|ședința fed|sedinta fed'),
    names: [/fed interest rate decision/i, /interest rate decision/i],
  },
  { key: 'pce', label: 'PCE', ask: wordsPattern('pce|core pce'), names: [/core personal consumption expenditures.*\(MoM\)/i, /personal consumption expenditures/i] },
  { key: 'ppi', label: 'PPI', ask: wordsPattern('ppi|producer prices?'), names: [/^Producer Price Index \(MoM\)$/i, /producer price index/i] },
  { key: 'gdp', label: 'GDP', ask: wordsPattern('gdp|pib'), names: [/gross domestic product annualized/i, /gross domestic product/i] },
  {
    key: 'retail',
    label: 'Retail Sales',
    ask: wordsPattern('retail sales|vânzările (?:cu amănuntul|retail)|vanzarile (?:cu amanuntul|retail)'),
    names: [/^Retail Sales \(MoM\)$/i, /retail sales/i],
  },
  { key: 'ism', label: 'ISM / PMI', ask: wordsPattern('ism|pmi'), names: [/ISM Manufacturing PMI/i, /ISM Services PMI/i, /PMI/i] },
  { key: 'claims', label: 'Jobless Claims', ask: wordsPattern('jobless claims|initial claims'), names: [/initial jobless claims/i] },
  { key: 'jolts', label: 'JOLTS', ask: wordsPattern('jolts|job openings'), names: [/JOLTS job openings/i] },
  { key: 'michigan', label: 'Michigan Sentiment', ask: wordsPattern('michigan|consumer sentiment'), names: [/michigan consumer sentiment/i] },
  {
    key: 'eia',
    label: 'EIA crude inventories',
    ask: wordsPattern('eia|crude (?:oil )?inventories|oil inventories|stocurile de petrol'),
    names: [/EIA crude oil stocks change/i, /crude oil inventories/i],
  },
  { key: 'auction', label: 'Treasury auction', ask: wordsPattern('auctions?|licitați\\p{L}*|licitati\\p{L}*'), names: [] },
  { key: 'opec', label: 'OPEC+ meeting', ask: wordsPattern('opec\\+?'), names: [] },
];

/** A country word moves an event off the US default: "euro CPI", "UK inflation". */
export const EVENT_COUNTRY: { pattern: RegExp; currency: string }[] = [
  { pattern: wordsPattern('euro ?zone|eurozone|euro area|ecb|zona euro|european|hicp|german|germany|germania'), currency: 'EUR' },
  { pattern: wordsPattern('uk|british|britain|boe|marea britanie|anglia'), currency: 'GBP' },
  { pattern: wordsPattern('japan|japanese|boj|japonia'), currency: 'JPY' },
  { pattern: wordsPattern('canada|canadian|boc'), currency: 'CAD' },
  { pattern: wordsPattern('australia|australian|rba'), currency: 'AUD' },
  { pattern: wordsPattern('new zealand|rbnz|noua zeelandă|noua zeelanda'), currency: 'NZD' },
  { pattern: wordsPattern('swiss|switzerland|snb|elveția|elvetia'), currency: 'CHF' },
];
