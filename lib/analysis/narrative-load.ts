/**
 * Gathers the narrative engine's inputs. All I/O lives here; the reading is
 * `buildMarketState` (themes.ts) and `buildPairNarrative` (state.ts), both pure.
 *
 * Nothing throws. A source that fails becomes a theme with a named gap, never
 * a neutral reading: "no data" and "nothing happening" are different claims.
 */

import { FED_PATH, FISCAL_QUERY, STANCE_QUERY } from '@/config/narrative.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { fetchFedPathInputs } from '@/lib/connectors/fed-futures';
import { searchNews } from '@/lib/connectors/news-search';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchDailyBars } from '@/lib/connectors/technicals';
import { fetchEcbTwoYearSeries, fetchFredSeries, type DatedObservation } from '@/lib/connectors/yields';
import { getStore } from '@/lib/db/client';
import { runSetupsPipeline, type SetupsPayload } from '@/lib/setups-pipeline';
import type { Currency } from '@/lib/types';
import { dedupeHeadlines, type Headline } from '@/lib/analysis/headlines';
import type { LevelSet } from '@/lib/analysis/levels';
import { barsToSeries } from '@/lib/analysis/series';
import { dayKey, isSnapshot, LATEST_KEY, mergeYieldHistory, type NarrativeSnapshot } from '@/lib/analysis/snapshot';
import { buildPairNarrative, effectsOf, type PairNarrative, type SubjectEffects } from '@/lib/analysis/state';
import { buildMarketState, MARKET, type MarketState, type NarrativeInputs } from '@/lib/analysis/themes';

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const DAY_MS = 86_400_000;
/** Standing searches refresh at most every half hour: 16 queries, every render. */
const STANDING_SEARCH_TTL = 1800;
const SEARCH_HITS = 10;

/**
 * Brent three months behind the front. NYMEX Brent's front month is two
 * calendar months ahead (in October it is December), so "three months later"
 * is five ahead. Verified 2026-10-03: BZZ26 102.25, BZH27 93.78.
 */
export function brentFarTicker(now: Date): string {
  const m = now.getUTCMonth() + 5;
  const y = now.getUTCFullYear() + Math.floor(m / 12);
  return `BZ${MONTH_CODES[m % 12]}${String(y).slice(2)}.NYM`;
}

const MARKET_TICKERS = [MARKET.brent, MARKET.wti, MARKET.gas, MARKET.copper, MARKET.vix, MARKET.spx, MARKET.ndx, MARKET.dxy, MARKET.us10y];

export interface NarrativeBundle {
  now: Date;
  inputs: NarrativeInputs;
  state: MarketState;
  /** The last stored snapshot: previous verdicts (hysteresis) and live flips. */
  latest: NarrativeSnapshot | null;
  past: { effects: SubjectEffects; basis: string; rewound: boolean } | null;
}

async function readSnapshot(key: string): Promise<NarrativeSnapshot | null> {
  const v = await getStore().getAiCache(key).catch(() => null);
  return isSnapshot(v) ? v : null;
}

/** The stored day nearest a week back: 7, then 6, then 8 days. */
async function weekAgoSnapshot(now: Date): Promise<NarrativeSnapshot | null> {
  for (const d of [7, 6, 8]) {
    const snap = await readSnapshot(dayKey(new Date(now.getTime() - d * DAY_MS).toISOString().slice(0, 10)));
    if (snap) return snap;
  }
  return null;
}

export async function loadNarrativeInputs(
  now: Date,
  pipeline?: Promise<SetupsPayload>,
): Promise<{ inputs: NarrativeInputs; latest: NarrativeSnapshot | null; weekAgo: NarrativeSnapshot | null }> {
  const queries = [...new Set([...Object.values(STANCE_QUERY), ...Object.values(FISCAL_QUERY)])];

  const [payload, fed, bars, far, fred, ecb, rss, searches, latest, weekAgo] = await Promise.all([
    pipeline ?? runSetupsPipeline(now),
    fetchFedPathInputs(now, FED_PATH.chainLength),
    Promise.all(MARKET_TICKERS.map((t) => fetchDailyBars(t).catch(() => null))),
    fetchDailyBars(brentFarTicker(now)).catch(() => null),
    Promise.all(['DGS2', 'T5YIE', 'DFII10'].map((id) => fetchFredSeries(id).catch(() => null))),
    fetchEcbTwoYearSeries().catch((): DatedObservation[] => []),
    fetchNews(),
    Promise.all(queries.map((q) => searchNews(q, { days: 7, limit: SEARCH_HITS, cacheTtlSeconds: STANDING_SEARCH_TTL }).catch(() => []))),
    readSnapshot(LATEST_KEY),
    weekAgoSnapshot(now),
  ]);

  const series: Record<string, DatedObservation[]> = {};
  MARKET_TICKERS.forEach((t, k) => (series[t] = barsToSeries(bars[k])));
  series[MARKET.brentFar] = barsToSeries(far);
  const [dgs2, t5yie, dfii10] = fred.map((r) => (r && r.ok ? r.data.slice(-500) : []));
  series[MARKET.breakeven5y] = t5yie;
  series[MARKET.realYield10y] = dfii10;

  // 2-year history: the issuers' own series for USD and EUR, our snapshots for
  // the rest, each with today's level appended so one lookup serves "now".
  const carried = mergeYieldHistory(latest?.twoYearHistory, payload.sovereignYields, now);
  const twoYearHistory: Partial<Record<Currency, DatedObservation[]>> = { ...carried };
  if (dgs2.length > 0) twoYearHistory.USD = dgs2;
  if (ecb.length > 0) twoYearHistory.EUR = mergeYieldHistory({ EUR: ecb }, new Map([...payload.sovereignYields].filter(([c]) => c === 'EUR')), now).EUR;

  const rssItems = rss.ok ? rss.data : [];
  const headlines: Headline[] = dedupeHeadlines([
    ...rssItems.map((i) => ({ title: i.title, url: i.url, domain: i.domain, publishedUtc: i.publishedUtc })),
    ...searches.flat().map((h) => ({ title: h.title, url: h.url, domain: h.domain, publishedUtc: h.publishedUtc })),
  ]);

  return {
    inputs: {
      events: payload.events,
      policyRates: payload.policyRates,
      twoYear: payload.sovereignYields,
      twoYearHistory,
      fed,
      series,
      headlines,
      headlinesAvailable: rss.ok || headlines.length > 0,
      ecoStrength: payload.ecoStrength,
    },
    latest,
    weekAgo,
  };
}

export async function loadNarrative(now = new Date(), pipeline?: Promise<SetupsPayload>): Promise<NarrativeBundle> {
  const { inputs, latest, weekAgo } = await loadNarrativeInputs(now, pipeline);
  const state = buildMarketState(inputs, now);
  const weekBack = new Date(now.getTime() - 7 * DAY_MS);
  const past = weekAgo
    ? { effects: weekAgo.effects, basis: `the stored narrative of ${weekAgo.date}`, rewound: false }
    : { effects: effectsOf(buildMarketState(inputs, weekBack)), basis: `a state rebuilt from dated inputs as of ${weekBack.toISOString().slice(0, 10)}`, rewound: true };
  return { now, inputs, state, latest, past };
}

export function pairFromBundle(bundle: NarrativeBundle, def: SymbolDefinition, levels?: LevelSet | null): PairNarrative | null {
  const prev = bundle.latest?.verdicts[def.symbol];
  return buildPairNarrative(def, bundle.state, bundle.inputs, {
    levels: levels ?? null,
    previous: prev ? { tactical: prev.tactical, structural: prev.structural } : null,
    past: bundle.past,
  });
}
