/**
 * What the AI analyst reads beyond the board, per economy and per asset.
 *
 * Nothing here is a score or a view. It is a reading list: which central bank
 * speaks for a currency, which two headline searches are always worth running
 * before a question about it, and which cross-asset prices carry a known
 * channel into it. The channel label is a sentence the analyst reads as
 * BACKGROUND; the price beside it is the data.
 *
 * Every ticker below was probed on Yahoo's chart endpoint on 2026-10-03 and
 * returned daily bars. A ticker that later stops answering is dropped from the
 * dossier and named as a gap, never filled.
 */

import type { Currency } from '@/lib/types';
import type { SymbolDefinition } from '@/config/symbols.config';

export interface CrossAssetDriver {
  ticker: string;
  label: string;
  /** Why it matters for this economy — one line, read as background. */
  channel: string;
}

export interface EconomyReading {
  bank: string;
  /** Run before every question about this economy. Two, to stay inside the free budget. */
  newsQueries: [string, string];
  drivers: CrossAssetDriver[];
}

const US10Y: CrossAssetDriver = { ticker: '^TNX', label: 'US 10-year yield', channel: 'Global rate anchor; the yield gap against the US drives the pair' };
const BRENT: CrossAssetDriver = { ticker: 'BZ=F', label: 'Brent crude', channel: 'Energy import bill and headline inflation' };

export const ECONOMY_READING: Partial<Record<Currency, EconomyReading>> = {
  USD: {
    bank: 'Federal Reserve',
    newsQueries: ['Fed policy outlook dollar', 'Treasury yields dollar'],
    drivers: [US10Y, { ticker: 'DX-Y.NYB', label: 'Dollar index', channel: 'Broad dollar demand' }],
  },
  EUR: {
    bank: 'European Central Bank',
    newsQueries: ['ECB rate outlook euro', 'euro zone inflation economy'],
    drivers: [
      { ticker: 'TTF=F', label: 'Dutch TTF gas', channel: 'Euro area is a net energy importer: dearer gas worsens its terms of trade' },
      BRENT,
    ],
  },
  GBP: {
    bank: 'Bank of England',
    newsQueries: ['Bank of England rates', 'UK economy gilts'],
    drivers: [{ ticker: 'TTF=F', label: 'Dutch TTF gas', channel: 'UK gas prices track the European hub; energy feeds UK inflation' }],
  },
  JPY: {
    bank: 'Bank of Japan',
    newsQueries: ['Bank of Japan policy', 'yen intervention'],
    drivers: [
      { ...US10Y, channel: 'US–Japan yield gap is the main carry driver for the yen' },
      { ...BRENT, channel: 'Japan imports almost all its energy: dearer oil widens the trade deficit' },
    ],
  },
  CHF: {
    bank: 'Swiss National Bank',
    newsQueries: ['Swiss National Bank franc', 'Switzerland inflation'],
    drivers: [{ ticker: '^VIX', label: 'VIX', channel: 'Franc is a haven: stress tends to lift it' }],
  },
  AUD: {
    bank: 'Reserve Bank of Australia',
    newsQueries: ['RBA interest rates', 'China economy demand'],
    drivers: [{ ticker: 'HG=F', label: 'Copper', channel: 'Metals export prices and Chinese demand' }],
  },
  NZD: {
    bank: 'Reserve Bank of New Zealand',
    newsQueries: ['RBNZ official cash rate', 'New Zealand economy'],
    drivers: [{ ticker: 'HG=F', label: 'Copper', channel: 'Proxy for Chinese and Asian demand, NZ\'s main export market' }],
  },
  CAD: {
    bank: 'Bank of Canada',
    newsQueries: ['Bank of Canada rates', 'Canada economy oil'],
    drivers: [{ ticker: 'CL=F', label: 'WTI crude', channel: 'Oil is Canada\'s largest export' }],
  },
  ZAR: {
    bank: 'South African Reserve Bank',
    newsQueries: ['South African Reserve Bank rates', 'rand South Africa economy'],
    drivers: [{ ticker: 'GC=F', label: 'Gold', channel: 'Precious-metal exports' }],
  },
};

/** Read for every question: the state of risk appetite. */
export const ALWAYS_DRIVERS: CrossAssetDriver[] = [
  { ticker: '^VIX', label: 'VIX', channel: 'Equity stress; high VIX favours havens (USD, JPY, CHF, gold)' },
  { ticker: '^GSPC', label: 'S&P 500', channel: 'Global risk appetite' },
];

/** Assets that are not an economy get their own short list. */
export const ASSET_READING: Record<string, { newsQueries: string[]; drivers: CrossAssetDriver[] }> = {
  metals: {
    newsQueries: ['gold price outlook'],
    drivers: [
      { ...US10Y, channel: 'Higher real yields raise the cost of holding a non-yielding metal' },
      { ticker: 'DX-Y.NYB', label: 'Dollar index', channel: 'Metals are priced in dollars' },
    ],
  },
  energy: {
    newsQueries: ['oil prices OPEC supply'],
    drivers: [BRENT, { ticker: 'NG=F', label: 'US natural gas', channel: 'Energy complex' }],
  },
  copper: {
    newsQueries: ['copper price China demand'],
    drivers: [{ ticker: 'HG=F', label: 'Copper', channel: 'The instrument itself, for the 1-month change' }],
  },
  indices: {
    newsQueries: ['stock market outlook earnings'],
    drivers: [US10Y],
  },
  crypto: {
    newsQueries: ['bitcoin price crypto market'],
    drivers: [US10Y],
  },
};

/**
 * The economies a symbol reads: both legs of a pair, the one economy behind a
 * currency index or a single-economy asset, and the US for anything priced in
 * dollars with no economy of its own.
 */
export function economiesOf(def: SymbolDefinition): Currency[] {
  if (def.base && def.quote) return [def.base, def.quote];
  if (def.macroEconomy) return [def.macroEconomy];
  return ['USD'];
}

/** Which ASSET_READING entry a symbol takes, if any. */
export function assetReadingKey(def: SymbolDefinition): keyof typeof ASSET_READING | null {
  if (def.kind === 'crypto') return 'crypto';
  if (def.kind === 'index') return 'indices';
  if (def.kind !== 'commodity') return null;
  if (def.symbol === 'WTIUSD') return 'energy';
  if (def.symbol === 'XCUUSD') return 'copper';
  return 'metals';
}

/** Hard caps that keep one question inside OpenRouter's free budget. */
export const ANALYST_LIMITS = {
  /** Characters per user message. */
  messageChars: 2_000,
  /** Messages kept from the thread; older ones are dropped, never summarised. */
  threadMessages: 12,
  /** Tool rounds per question. One round means at most two model requests. */
  toolRounds: 1,
  /** Queries the model may ask for in that round. */
  queriesPerRound: 3,
  /** Questions per minute, per server process. OpenRouter's own limit is 20. */
  perMinute: 10,
} as const;
