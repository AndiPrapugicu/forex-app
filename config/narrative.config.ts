/**
 * The tuning surface of the Market Narrative engine (lib/analysis/themes.ts).
 *
 * THIS IS NOT THE BOARD. The board reproduces A1's published rules and is
 * measured against them; nothing here has an A1 counterpart, so nothing here is
 * fitted to A1 either. Every number below is a stated choice with its reason,
 * and the narrative never feeds a board score, a parity check or the history.
 *
 * The one rule the user set (2026-10-03): MARKET PRICES DECIDE THE STATE,
 * HEADLINES EXPLAIN IT. Futures and yields move the policy theme; a central
 * banker's words are evidence attached to it, never a vote of their own.
 */

import type { Currency } from '@/lib/types';
import type { SymbolDefinition } from '@/config/symbols.config';

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export type ThemeId =
  // Currencies
  | 'labour'
  | 'inflation'
  | 'growth'
  | 'policy'
  | 'energy'
  | 'risk'
  | 'fiscal'
  // Assets
  | 'real-yields'
  | 'dollar'
  | 'inventories'
  | 'supply'
  | 'curve'
  | 'demand'
  | 'yields';

export const THEME_LABEL: Record<ThemeId, string> = {
  labour: 'Labour',
  inflation: 'Inflation',
  growth: 'Growth',
  policy: 'Rate expectations',
  energy: 'Energy / terms of trade',
  risk: 'Risk & geopolitics',
  fiscal: 'Fiscal / political',
  'real-yields': 'Real yields',
  dollar: 'Dollar',
  inventories: 'Inventories',
  supply: 'Supply risk',
  curve: 'Futures curve',
  demand: 'Demand',
  yields: 'Bond yields',
};

/**
 * Rates count double (user's choice, round 3): a futures repricing is money
 * already committed, where a PMI beat is one data point. Real yields ARE the
 * rates theme for gold, so they carry the same weight there.
 */
export const THEME_WEIGHT: Record<ThemeId, number> = {
  labour: 1,
  inflation: 1,
  growth: 1,
  policy: 2,
  energy: 1,
  risk: 1,
  fiscal: 1,
  'real-yields': 2,
  dollar: 1,
  inventories: 1,
  supply: 1,
  curve: 1,
  demand: 1,
  yields: 1,
};

export const CURRENCY_THEMES: ThemeId[] = ['labour', 'inflation', 'growth', 'policy', 'energy', 'risk', 'fiscal'];

// ---------------------------------------------------------------------------
// Subjects: what a symbol's narrative is read off
// ---------------------------------------------------------------------------

export type AssetSubject =
  | 'gold'
  | 'silver'
  | 'platinum'
  | 'oil'
  | 'copper'
  | 'us-equities'
  | 'jp-equities'
  | 'eu-equities'
  | 'uk-equities'
  | 'crypto';

export type Subject = Currency | AssetSubject;

export const ASSET_SUBJECT_LABEL: Record<AssetSubject, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  oil: 'Oil',
  copper: 'Copper',
  'us-equities': 'US equities',
  'jp-equities': 'Japanese equities',
  'eu-equities': 'European equities',
  'uk-equities': 'UK equities',
  crypto: 'Crypto',
};

/** Which themes vote for each asset, in display order. */
export const ASSET_THEMES: Record<AssetSubject, ThemeId[]> = {
  gold: ['real-yields', 'dollar', 'risk'],
  silver: ['real-yields', 'dollar', 'risk', 'demand'],
  platinum: ['real-yields', 'dollar', 'risk', 'demand'],
  oil: ['inventories', 'supply', 'curve', 'demand', 'dollar', 'risk'],
  copper: ['demand', 'dollar', 'risk'],
  'us-equities': ['growth', 'policy', 'yields', 'risk'],
  'jp-equities': ['growth', 'policy', 'risk'],
  'eu-equities': ['growth', 'policy', 'risk'],
  'uk-equities': ['growth', 'policy', 'risk'],
  crypto: ['policy', 'dollar', 'risk'],
};

/** The economy an equity subject reads its growth and rates from. */
export const EQUITY_ECONOMY: Partial<Record<AssetSubject, Currency>> = {
  'us-equities': 'USD',
  'jp-equities': 'JPY',
  'eu-equities': 'EUR',
  'uk-equities': 'GBP',
  crypto: 'USD',
};

/**
 * One symbol's narrative: a pair reads base minus quote; everything else reads
 * one subject. A currency index (EURX, DXY) is its own currency.
 */
export function subjectsOf(def: SymbolDefinition): { base: Subject; quote: Subject | null } | null {
  if (def.base && def.quote) return { base: def.base, quote: def.quote };
  if (def.kind === 'currency' && def.macroEconomy) return { base: def.macroEconomy, quote: null };
  if (def.kind === 'crypto') return { base: 'crypto', quote: null };
  if (def.kind === 'index') {
    const map: Partial<Record<Currency, AssetSubject>> = { USD: 'us-equities', JPY: 'jp-equities', EUR: 'eu-equities', GBP: 'uk-equities' };
    return { base: map[def.macroEconomy ?? 'USD'] ?? 'us-equities', quote: null };
  }
  if (def.kind === 'commodity') {
    const map: Record<string, AssetSubject> = { XAUUSD: 'gold', XAGUSD: 'silver', XPTUSD: 'platinum', WTIUSD: 'oil', XCUUSD: 'copper' };
    const s = map[def.symbol];
    return s ? { base: s, quote: null } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Release themes
// ---------------------------------------------------------------------------

/**
 * EVENT_RULES keys per theme. Average hourly earnings (`wages`) sits in LABOUR,
 * as A1's `wage-growth` slot does, even though the event engine files it under
 * inflation: here it is one of the three numbers in the payrolls bundle.
 */
export const RELEASE_THEME: Record<'labour' | 'inflation' | 'growth', string[]> = {
  labour: ['nfp', 'adp', 'unemployment-rate', 'wages', 'jobless-claims', 'job-openings', 'jobs-applicants-ratio', 'participation', 'job-cuts'],
  inflation: ['cpi', 'ppi', 'pce', 'inflation-gauge'],
  growth: ['gdp', 'mpmi', 'spmi', 'pmi', 'retail-sales', 'industrial-production', 'confidence-survey', 'housing', 'trade-balance', 'productivity'],
};

/** The three prints of a payrolls day: headline jobs, the jobless rate, wages. */
export const LABOUR_BUNDLE_KEYS = ['nfp', 'unemployment-rate', 'wages'] as const;

/**
 * Surprise aggregation. A release counts with sigma × polarity × rule weight ×
 * impact weight, decayed by its age. Tactical reads the last few weeks; the
 * structural read keeps a quarter of releases with a slower decay.
 */
export const RELEASE_WINDOW = {
  tactical: { days: 35, halfLifeDays: 14 },
  structural: { days: 100, halfLifeDays: 35 },
  /** A surprise smaller than this (in sigma) is "in line" and does not count. */
  minSigma: 0.25,
  impactWeight: { HIGH: 1, MEDIUM: 0.5, LOW: 0.2, NONE: 0 } as Record<string, number>,
  /** Aggregate → effect bands. */
  moderate: 0.75,
  strong: 2,
  /** Euro-area member prints count at half weight; only these members count at all. */
  euroMembers: ['DE', 'FR'],
};

/** A bundle is "strong" when this many of the three prints point the same way. */
export const LABOUR_BUNDLE_MIN_ALIGNED = 2;

// ---------------------------------------------------------------------------
// Market readings
// ---------------------------------------------------------------------------

/**
 * Fed funds futures. The contract that covers the month this many months ahead
 * is the tactical read ("a quarter out"); the structural read is the path six
 * months out. Implied rate = 100 − price.
 */
export const FED_PATH = {
  tacticalMonthsAhead: 3,
  structuralMonthsAhead: 6,
  chainLength: 8,
  /** bp of repricing in a week. */
  repricing: { moderate: 5, strong: 10 },
  /** bp priced over six months, relative to the effective rate. */
  priced: { moderate: 10, strong: 25 },
};

/** 2-year yields for the banks with no free futures: change in bp, level vs policy in bp. */
export const TWO_YEAR = {
  repricing: { moderate: 5, strong: 10 },
  spread: { moderate: 15, strong: 50 },
};

/**
 * Energy exposure per currency: the sign and size of a terms-of-trade hit when
 * oil and gas get dearer. Sources, read 2026-10-03:
 *   EUR  net importer, ~58% energy import dependency (Eurostat, nrg_ind_id, 2023)
 *   JPY  ~87% of primary energy imported (METI / IEA Japan country profile)
 *   GBP  net importer of gas and oil since the mid-2000s (DESNZ, DUKES 2024)
 *   NZD  imports all its refined fuel (MBIE energy statistics)
 *   CAD  oil is the largest export (Statistics Canada, merchandise trade)
 *   AUD  among the largest LNG and coal exporters (DISR Resources and Energy Quarterly)
 *   ZAR  imports most of its liquid fuel (SA Department of Mineral Resources and Energy)
 *   USD  net petroleum exporter since 2020 (EIA) — roughly neutral
 *   CHF  small energy share of imports — neutral
 */
export const ENERGY_EXPOSURE: Partial<Record<Currency, number>> = {
  EUR: -1,
  JPY: -1,
  GBP: -0.5,
  NZD: -0.5,
  ZAR: -0.5,
  CAD: 1,
  AUD: 0.5,
  USD: 0,
  CHF: 0,
};

/** Percent moves. Gas is twice as volatile as crude, so its bands are doubled. */
export const ENERGY_MOVE = {
  oil: { moderate: 5, strong: 10 },
  gas: { moderate: 10, strong: 20 },
};

/** Which currencies read TTF gas as well as Brent. */
export const GAS_EXPOSED: Currency[] = ['EUR', 'GBP'];

export const RISK = {
  /** VIX level bands (structural). */
  vixStress: 22,
  vixPanic: 30,
  vixCalm: 14,
  /** VIX 1-week percent change (tactical). */
  vixJump: 15,
  /** S&P 500 1-week percent change. */
  equityDrop: -3,
  equityRally: 2,
};

/** Asset market bands. */
export const ASSET_MOVE = {
  /** Real or nominal yield change in bp: tactical over a week, structural over a month. */
  yieldWeek: { moderate: 5, strong: 10 },
  yieldMonth: { moderate: 15, strong: 30 },
  /** US 10-year bp change that hurts equities over a week. */
  equityYieldWeek: { moderate: 15, strong: 25 },
  /** Dollar index percent change. */
  dollarWeek: { moderate: 1, strong: 2 },
  dollarMonth: { moderate: 2, strong: 4 },
  /** Brent front vs the contract three months later, percent of front. */
  backwardation: { moderate: 5, strong: 8 },
  contango: -2,
  /** Nasdaq 100 1-week percent change, for crypto risk appetite. */
  nasdaqWeek: { moderate: 2, strong: 5 },
};

// ---------------------------------------------------------------------------
// Pair verdict
// ---------------------------------------------------------------------------

/**
 * Weighted sum of the pair's theme effects → label. Entering a label takes a
 * sum of 3 AND at least two themes on that side, so no single theme — rates
 * included — can carry a verdict alone. Leaving it takes the sum falling back
 * through 2. That gap is hysteresis: a sum sitting on 3 would otherwise flip
 * the label (and send a Telegram) every time one input ticked.
 *
 * Two themes, not three: measured live on 2026-10-03, EURUSD had labour +2 and
 * inflation +4 with nothing against, and a three-theme rule called it neutral.
 */
export const VERDICT = {
  enter: 3,
  stay: 2,
  minAgreeingThemes: 2,
};

// ---------------------------------------------------------------------------
// Headline lexicon
// ---------------------------------------------------------------------------

/**
 * Which bank a headline is about. Patterns, not a roster of names: wire
 * headlines carry "Fed's", "ECB's", "BoE's" in front of the speaker, and a
 * roster would go stale with every appointment. The governors named below are
 * the ones whose surname alone routinely heads a story.
 */
export const BANK_PATTERN: Partial<Record<Currency, RegExp>> = {
  USD: /\b(Fed|Fed's|Federal Reserve|FOMC)\b/i,
  EUR: /\b(ECB|ECB's|European Central Bank|Lagarde)\b/i,
  GBP: /\b(BoE|BoE's|Bank of England|MPC)\b/i,
  JPY: /\b(BoJ|BoJ's|BOJ|Bank of Japan|Ueda)\b/i,
  AUD: /\b(RBA|RBA's|Reserve Bank of Australia|Bullock)\b/i,
  NZD: /\b(RBNZ|RBNZ's|Reserve Bank of New Zealand)\b/i,
  CAD: /\b(BoC|BoC's|BOC|Bank of Canada|Macklem)\b/i,
  CHF: /\b(SNB|SNB's|Swiss National Bank|Schlegel)\b/i,
  ZAR: /\b(SARB|South African Reserve Bank|Kganyago)\b/i,
};

/** One search per bank over seven days, for the speakers' tone. */
export const STANCE_QUERY: Partial<Record<Currency, string>> = {
  USD: 'Fed officials rate hikes cuts',
  EUR: 'ECB policymakers rates',
  GBP: 'Bank of England policymakers rates',
  JPY: 'Bank of Japan rate hike',
  AUD: 'RBA rates outlook',
  NZD: 'RBNZ cash rate outlook',
  CAD: 'Bank of Canada rate outlook',
  CHF: 'SNB rates franc',
};

export type Stance = 'hawkish' | 'dovish' | 'hold' | 'ambiguous';

/**
 * Phrases that NEGATE a stance word. Tested first, and their text is blanked
 * before the plain phrases run, so "no further hikes" can never also count as
 * "further hikes".
 */
export const STANCE_NEGATED: { stance: Stance; pattern: RegExp }[] = [
  { stance: 'dovish', pattern: /\bno (more|further|additional) (rate )?(hikes?|increases?|tightening)\b/i },
  { stance: 'dovish', pattern: /\bno (need|rush|hurry|case) (for|to) (further |more |another )?(rate )?(hikes?|increases?|raise|tighten(ing)?)\b/i },
  { stance: 'dovish', pattern: /\b(further|more|additional|another) (rate )?(hikes?|increases?|tightening) (is |are )?(not|un)(needed|necessary|warranted|likely)\b/i },
  { stance: 'dovish', pattern: /\b(do(es)?n'?t|do(es)? not|won'?t|will not) (want|see|expect|need|support) (more|further|another|additional) (rate )?(hikes?|increases?|tightening)\b/i },
  { stance: 'dovish', pattern: /\b(done|finished) (raising|hiking|tightening)\b/i },
  { stance: 'dovish', pattern: /\b(hiking|tightening) (cycle )?(is )?(over|done|complete)\b/i },
  { stance: 'hawkish', pattern: /\bnot (ready|in a hurry|in a rush|prepared|yet ready) to (cut|ease|lower)\b/i },
  { stance: 'hawkish', pattern: /\bno (rush|hurry|need|case) (to|for) (rate )?(cut|cuts|ease|easing|lower)\b/i },
  { stance: 'hawkish', pattern: /\b(rate )?(cuts?|easing) (is |are )?(not|un)(likely|warranted|needed|appropriate|on the table)\b/i },
  { stance: 'hawkish', pattern: /\btoo (early|soon) to (cut|ease|declare victory)\b/i },
  { stance: 'hawkish', pattern: /\b(cuts?|easing) (off the table)\b/i },
];

export const STANCE_PLAIN: { stance: Stance; pattern: RegExp }[] = [
  { stance: 'dovish', pattern: /\bdovish\b/i },
  { stance: 'dovish', pattern: /\b(rate )?cuts? (likely|coming|appropriate|warranted|on the table|soon|ahead)\b/i },
  { stance: 'dovish', pattern: /\b(open|room) to (cut|ease|lower)\b/i },
  { stance: 'dovish', pattern: /\b(supports?|favou?rs?|backs?|sees?|eyes?|signals?|calls? for|flags?) (a |an |another |more |further |two |three )?(rate )?(cuts?|easing|reductions?)\b/i },
  { stance: 'dovish', pattern: /\b(inflation|price pressures?|labou?r market|job market|jobs market) (is |are )?(cooling|easing|softening|weakening)\b/i },
  { stance: 'dovish', pattern: /\beasing bias\b/i },
  { stance: 'hawkish', pattern: /\bhawkish\b/i },
  { stance: 'hawkish', pattern: /\b(more|further|additional|another) (rate )?(hikes?|increases?|tightening)\b/i },
  { stance: 'hawkish', pattern: /\b(supports?|favou?rs?|backs?|sees?|eyes?|signals?|calls? for|flags?|open to) (a |an |another |more |further )?(rate )?(hikes?|increases?|tightening)\b/i },
  { stance: 'hawkish', pattern: /\b(wanted|voted for|vote for|backed|pushed for|dissent\w* in favou?r of) (a |an )?(rate )?(hikes?|increases?)\b/i },
  { stance: 'dovish', pattern: /\b(wanted|voted for|vote for|backed|pushed for|dissent\w* in favou?r of) (a |an )?(rate )?cuts?\b/i },
  { stance: 'hawkish', pattern: /\bhigher for longer\b/i },
  { stance: 'hawkish', pattern: /\b(restrictive|tight) for longer\b/i },
  { stance: 'hawkish', pattern: /\b(sticky|persistent|stubborn|elevated) (inflation|price pressures?)\b/i },
  { stance: 'hawkish', pattern: /\binflation (risks?|is) (to the upside|rising|re-?accelerating)\b/i },
  { stance: 'hold', pattern: /\b(paus(e|es|ed|ing)|hold(s|ing)? steady|on hold|(keeps?|kept|holds?|held|leaves?|left) (interest )?rates? (unchanged|steady|on hold)|holds? (interest )?rates?)\b/i },
];

/**
 * Region × topic, for the geopolitics and fiscal themes. A headline counts when
 * it names the region AND a topic word; neither alone is a story.
 */
export const CONFLICT_TERMS = /\b(attacks?|strikes?|missiles?|drones?|war|invasion|invades?|offensive|escalat\w*|conflict|clash(es)?|shelling|blockade|seiz\w+|retaliat\w+)\b/i;
export const DEESCALATION_TERMS = /\b(ceasefire|cease-fire|truce|peace (talks|deal|agreement)|de-?escalat\w*)\b/i;

export interface ConflictRegion {
  id: string;
  label: string;
  pattern: RegExp;
  /** Oil supply runs through it, so escalation is also a supply story. */
  oilSupply: boolean;
  /** Currencies hit directly by proximity, beyond the general haven flow. */
  proximity: Partial<Record<Currency, number>>;
}

export const CONFLICT_REGIONS: ConflictRegion[] = [
  {
    id: 'middle-east',
    label: 'Middle East',
    pattern: /\b(Middle East|Israel\w*|Iran\w*|Gaza|Lebanon|Hezbollah|Houthis?|Yemen|Saudi|Hormuz|Red Sea|Syria\w*|Iraq\w*|Gulf)\b/i,
    oilSupply: true,
    proximity: {},
  },
  {
    id: 'russia-ukraine',
    label: 'Russia / Ukraine',
    pattern: /\b(Russia\w*|Ukrain\w*|Kremlin|Moscow|Kyiv|NATO)\b/i,
    oilSupply: true,
    proximity: { EUR: -1 },
  },
  {
    id: 'asia',
    label: 'Taiwan / South China Sea / Korea',
    pattern: /\b(Taiwan|South China Sea|North Korea\w*|Pyongyang)\b/i,
    oilSupply: false,
    proximity: { JPY: 0, AUD: -1 },
  },
];

export const FISCAL_TERMS = /\b(budget (crisis|row|standoff|deficit|impasse)|deficit (blowout|concerns?|fears?)|downgrades?|downgraded|snap election|no[- ]confidence|government (collapses?|falls|crisis)|coalition (collapses?|crisis)|shutdown|debt ceiling|bond (rout|sell-?off|selloff)|spreads? (widen\w*|blow out))\b/i;

export const FISCAL_REGION: Partial<Record<Currency, RegExp>> = {
  USD: /\b(US|U\.S\.|United States|Treasury|Treasuries|Congress|White House)\b/,
  EUR: /\b(France|French|Italy|Italian|euro ?zone|eurozone|Germany|German|Spain|Spanish|EU|OAT|Bund|BTP)\b/,
  GBP: /\b(UK|U\.K\.|Britain|British|gilts?|Reeves|Westminster)\b/,
  JPY: /\b(Japan|Japanese|JGBs?|Tokyo)\b/,
  AUD: /\b(Australia|Australian)\b/,
  NZD: /\b(New Zealand)\b/,
  CAD: /\b(Canada|Canadian|Ottawa)\b/,
  CHF: /\b(Switzerland|Swiss)\b/,
  ZAR: /\b(South Africa|South African)\b/,
};

/** One search per economy over seven days for the fiscal and political story. */
export const FISCAL_QUERY: Partial<Record<Currency, string>> = {
  USD: 'US budget deficit Treasury shutdown',
  EUR: 'France Italy budget deficit bond spreads',
  GBP: 'UK budget gilts Reeves',
  JPY: 'Japan fiscal JGB yields election',
  AUD: 'Australia budget politics',
  NZD: 'New Zealand budget politics',
  CAD: 'Canada budget deficit politics',
  CHF: 'Switzerland franc politics',
};

export const OPEC_CUT = /\bOPEC\+?\b.*\b(cuts?|extends? cuts|curbs?|reduc\w+ (output|production))\b|\b(output|production) cuts?\b.*\bOPEC\+?\b/i;
export const OPEC_RAISE = /\bOPEC\+?\b.*\b(raise|raises|boost\w*|increase\w*|hike\w*|unwind\w*) (output|production|supply)\b/i;

/** How long headline evidence counts. */
export const HEADLINE_WINDOW_DAYS = 7;
/** A cluster carried by this many domains counts double. */
export const CORROBORATED_WEIGHT = 2;

// ---------------------------------------------------------------------------
// Flip conditions
// ---------------------------------------------------------------------------

export const FLIPS = {
  /**
   * Releases this far ahead can be a flip condition. Two weeks, so a month's
   * CPI is on the list from the payrolls Friday before it — the user holds
   * trades for weeks, and the next print that could break one is the point.
   */
  horizonDays: 14,
  /** Only HIGH-impact releases carry a threshold; MEDIUM ones are noise at this scale. */
  impact: ['HIGH'] as string[],
  /** Further repricing that would CONFIRM a policy move, in bp. */
  confirmRepricingBp: 10,
  /** VIX levels that tip risk appetite. */
  vixRiskOff: 25,
  vixRiskOn: 15,
  /** Further oil move that would confirm an energy theme, percent. */
  confirmOilPct: 5,
  /** Shown on /ai; the page lists all. */
  shown: 6,
};

// ---------------------------------------------------------------------------
// Positions and theses
// ---------------------------------------------------------------------------

export const THESIS = {
  /** The board band a position must stay in (±4 is the board's Bullish/Bearish cut). */
  band: 4,
  /** Score down this fraction from its value at entry, still in band → yellow. */
  erosion: 0.4,
  /** A flip-condition event this close → yellow. */
  eventDays: 3,
  /** Price within this many ATRs of the last HL / LH → yellow. */
  atrProximity: 0.5,
  atrPeriod: 14,
  /**
   * A flip condition that fired against a position keeps it RED this long. The
   * condition itself is gone from the next snapshot (its event printed, or its
   * thresholds were re-drawn), so without a memory RED would last one run.
   */
  firedMemoryDays: 3,
  maxOpen: 50,
  thesisChars: 1000,
};

// ---------------------------------------------------------------------------
// Snapshots and alerts
// ---------------------------------------------------------------------------

export const NARRATIVE_CACHE_KIND = 'narrative:snapshot';
/** Before London opens. The first ingest run at or after this hour sends the digest. */
export const DIGEST_HOUR_UTC = 6;
/**
 * Whose verdict changes the digest reports, besides the eight currency indexes
 * and the open positions. One row per asset theme set, so a gold flip is one
 * line, not three.
 */
export const DIGEST_WATCH_ASSETS = ['XAUUSD', 'XAGUSD', 'WTIUSD', 'SPX500', 'GER40', 'JP225', 'BTCUSD'];
