/**
 * Metals and oil are scored from named, inspectable factors rather than treated
 * as a ninth currency. Each beta below becomes one labelled row in the UI, so a
 * gold move can always be attributed to something — never "the model says so".
 */

import type { Asset, Category, Currency } from '@/lib/types';

/**
 * The factors an asset score can be built from. All are derived from data we
 * already compute for currencies, so assets add no new ingestion.
 */
export interface AssetFactors {
  /** Currency strength, signed as-is (USD strength is usually a headwind). */
  usdStrength: number;
  /** Risk-off intensity from news: escalation, emergency, crisis language. */
  riskOff: number;
  /** Geopolitical escalation specifically (war, missile, sanctions, invasion). */
  geopolitics: number;
  /** Global growth impulse: PMIs, GDP, retail sales across all majors. */
  growth: number;
  /** Oil supply disruption risk: OPEC, sanctions on producers, strait/pipeline. */
  supplyRisk: number;
  /** Inflation impulse across majors — supports hard assets. */
  inflation: number;
}

export interface AssetDefinition {
  asset: Asset;
  label: string;
  /** Yahoo Finance symbol, verified live during planning. */
  symbol: string;
  /** Factor -> beta. Rendered one row per entry with a human-readable reason. */
  betas: Partial<Record<keyof AssetFactors, { beta: number; reason: string }>>;
}

export const ASSET_DEFINITIONS: AssetDefinition[] = [
  {
    asset: 'XAU',
    label: 'Gold',
    symbol: 'GC=F',
    betas: {
      usdStrength: { beta: -0.6, reason: 'Priced in USD — a stronger dollar is a headwind' },
      riskOff: { beta: 0.8, reason: 'Primary safe-haven bid' },
      geopolitics: { beta: 0.7, reason: 'Escalation drives haven demand' },
      inflation: { beta: 0.35, reason: 'Store-of-value bid when inflation runs hot' },
    },
  },
  {
    asset: 'XAG',
    label: 'Silver',
    symbol: 'SI=F',
    betas: {
      usdStrength: { beta: -0.5, reason: 'Priced in USD' },
      riskOff: { beta: 0.45, reason: 'Partial haven bid — weaker than gold' },
      geopolitics: { beta: 0.35, reason: 'Follows gold on escalation, with a lag' },
      growth: { beta: 0.5, reason: 'Heavy industrial demand makes it growth-sensitive' },
      inflation: { beta: 0.3, reason: 'Hard-asset bid' },
    },
  },
  {
    asset: 'XPT',
    label: 'Platinum',
    symbol: 'PL=F',
    betas: {
      usdStrength: { beta: -0.4, reason: 'Priced in USD' },
      growth: { beta: 0.7, reason: 'Mostly an industrial/autocatalyst metal' },
      riskOff: { beta: 0.2, reason: 'Weak haven characteristics' },
      geopolitics: { beta: 0.25, reason: 'Supply concentrated in South Africa and Russia' },
    },
  },
  {
    asset: 'WTI',
    label: 'WTI Crude',
    symbol: 'CL=F',
    betas: {
      supplyRisk: { beta: 0.9, reason: 'Supply disruption is the dominant driver' },
      growth: { beta: 0.4, reason: 'Demand tracks global activity' },
      geopolitics: { beta: 0.45, reason: 'Producer-region conflict threatens supply' },
      usdStrength: { beta: -0.25, reason: 'Priced in USD' },
    },
  },
];

/** Extra price context on the dashboard. Not scored — reference only. */
export const CONTEXT_SYMBOLS = [
  { symbol: 'DX-Y.NYB', label: 'Dollar Index' },
  { symbol: 'EURUSD=X', label: 'EUR/USD' },
];

/**
 * Which currencies a category of news tends to push around, beyond the currency
 * the event is filed under. Drives the "affected pairs" list and news scoring.
 */
export const SAFE_HAVEN: Record<string, { currency: Currency; weight: number }[]> = {
  riskOff: [
    { currency: 'JPY', weight: 0.8 },
    { currency: 'CHF', weight: 0.75 },
    { currency: 'USD', weight: 0.5 },
    { currency: 'AUD', weight: -0.7 },
    { currency: 'NZD', weight: -0.7 },
    { currency: 'CAD', weight: -0.3 },
  ],
  riskOn: [
    { currency: 'AUD', weight: 0.7 },
    { currency: 'NZD', weight: 0.7 },
    { currency: 'CAD', weight: 0.35 },
    { currency: 'JPY', weight: -0.6 },
    { currency: 'CHF', weight: -0.5 },
  ],
};

/** Oil-linked currencies — a WTI move is a CAD move. */
export const OIL_LINKED: { currency: Currency; weight: number }[] = [
  { currency: 'CAD', weight: 0.6 },
  { currency: 'NOK' as Currency, weight: 0.5 }, // not a tracked major; ignored downstream
];

/** Categories that count as "risk sentiment" input to the asset factors. */
export const RISK_CATEGORIES: Category[] = ['geopolitics', 'risk-sentiment'];
