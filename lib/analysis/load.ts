/**
 * Gathers the analyst's inputs for one symbol. All I/O lives here; the writing
 * is `buildDossier`, which is pure.
 *
 * Everything runs in parallel and nothing throws: a source that fails becomes a
 * named gap in the dossier, because the analyst must say what it could not see
 * rather than quietly reason around it.
 */

import { ALWAYS_DRIVERS, ASSET_READING, assetReadingKey, ECONOMY_READING, economiesOf, type CrossAssetDriver } from '@/config/ai.config';
import { ALL_SYMBOLS, type SymbolDefinition } from '@/config/symbols.config';
import { buildDossier, type AnalysisInputs, type Dossier, type DriverReading, type LegPositioning } from '@/lib/analysis/dossier';
import { buildLevels } from '@/lib/analysis/levels';
import { loadNarrative, pairFromBundle } from '@/lib/analysis/narrative-load';
import { evaluatePositions, type PositionView } from '@/lib/analysis/positions-load';
import { fetchBankCommunication } from '@/lib/connectors/central-banks';
import { searchNews } from '@/lib/connectors/news-search';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchDailyBars, type DailyBars } from '@/lib/connectors/technicals';
import { getStore } from '@/lib/db/client';
import { runSetupsPipeline, type SetupsPayload } from '@/lib/setups-pipeline';
import { scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import { buildSurpriseIndex } from '@/lib/scoring/market';
import { clusterNews } from '@/lib/scoring/news';
import { scoreTrend } from '@/lib/scoring/technical';
import type { Currency, NewsCluster, NewsItem, Position, ScoreSnapshot, SourceHealth } from '@/lib/types';

const NEWS_WINDOW_HOURS = 48;
const NEWS_CLUSTERS_MAX = 30;
const HISTORY_DAYS = 30;
const SEARCH_HITS = 6;

/** The currency-index symbol for an economy: EURX for EUR, DXY for USD. */
function indexSymbolFor(currency: Currency): SymbolDefinition | undefined {
  return ALL_SYMBOLS.find((s) => s.kind === 'currency' && s.macroEconomy === currency);
}

function uniqueBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
}

/** Last close and its 5- and 21-session changes, off whatever bars arrived. */
export function readDriver(driver: CrossAssetDriver, bars: DailyBars | null): DriverReading | null {
  if (!bars) return null;
  const points: { t: number; c: number }[] = [];
  for (let k = 0; k < bars.closes.length; k++) {
    const c = bars.closes[k];
    if (typeof c === 'number' && Number.isFinite(c)) points.push({ t: bars.timestamps[k], c });
  }
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const back = (n: number) => (points.length > n ? points[points.length - 1 - n].c : null);
  const pct = (from: number | null) => (from === null || from === 0 ? null : ((last.c - from) / from) * 100);
  return {
    driver,
    last: last.c,
    date: new Date(last.t * 1000).toISOString().slice(0, 10),
    change1wPct: pct(back(5)),
    change1mPct: pct(back(21)),
  };
}

/**
 * Official-feed items that are about banking supervision, not policy. The Fed's
 * press feed is mostly these, and they reach the "central-bank" category on the
 * feed's default rather than on anything they say.
 */
const ADMINISTRATIVE = /enforcement action|approval of application|application by|Regulation [A-Z]{1,2}\b|comment period|Court of Directors|appoint(s|ment|ed)|Market Participants Group|bank note|working paper|on-chain|cyber/i;

/** Headlines inside the window that touch these economies, a central bank, or geopolitics. */
export function relevantNews(items: NewsItem[], economies: Currency[], now: Date): NewsItem[] {
  const since = now.getTime() - NEWS_WINDOW_HOURS * 3_600_000;
  return items.filter((item) => {
    const t = Date.parse(item.publishedUtc);
    if (!(t >= since && t <= now.getTime() + 60_000)) return false;
    if (ADMINISTRATIVE.test(item.title)) return false;
    if (item.affects.some((a) => economies.includes(a as Currency))) return true;
    return item.category === 'central-bank' || item.category === 'geopolitics';
  });
}

/**
 * How much a story is about THIS symbol, for ranking only — never a score.
 *
 * Naming the pair outright counts most; touching both economies beats touching
 * one; policy, inflation and jobs stories beat market colour; and a story more
 * than one outlet carries beats a single one. A dollar story told through NZD/USD
 * still makes the cut on a EURUSD question, just below the euro's own.
 */
export function newsRelevance(cluster: NewsCluster, def: SymbolDefinition, economies: Currency[]): number {
  const text = `${cluster.headline} ${cluster.items.map((i) => i.summary ?? '').join(' ')}`;
  let score = 0;
  if (def.base && def.quote) {
    const pair = new RegExp(`${def.base}\\s*/?\\s*${def.quote}`, 'i');
    if (pair.test(text)) score += 3;
  } else if (text.toLowerCase().includes(def.label.toLowerCase())) {
    score += 3;
  }
  const touched = new Set(cluster.items.flatMap((i) => i.affects).filter((a) => economies.includes(a as Currency)));
  score += touched.size;
  if (['central-bank', 'inflation', 'labor', 'growth', 'geopolitics', 'energy'].includes(cluster.category)) score += 1;
  if (cluster.domainCount > 1) score += 1;
  return score;
}

export async function loadAnalysisInputs(
  def: SymbolDefinition,
  now = new Date(),
  /**
   * A board run the caller already started. The /ai page needs the board twice
   * (the symbol picker's scores and the dossier) and the pipeline does not
   * dedupe concurrent runs, so it starts one and hands it to both.
   */
  pipeline?: Promise<SetupsPayload>,
  opts: {
    /**
     * The user's open positions on this symbol. The caller decides whether the
     * viewer may see them (the passphrase cookie); this only evaluates them.
     */
    positions?: Position[];
  } = {},
): Promise<AnalysisInputs> {
  const economies = economiesOf(def);
  const readings = economies.map((c) => ECONOMY_READING[c]).filter((r) => r !== undefined);
  const assetKey = assetReadingKey(def);
  const asset = assetKey ? ASSET_READING[assetKey] : null;

  const queries = [...new Set([...readings.flatMap((r) => r.newsQueries), ...(asset?.newsQueries ?? [])])];
  const drivers = uniqueBy([...readings.flatMap((r) => r.drivers), ...(asset?.drivers ?? []), ...ALWAYS_DRIVERS], (d) => d.ticker);

  const store = getStore();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();

  // One board run, shared with the narrative engine.
  const board = pipeline ?? runSetupsPipeline(now);
  const [payload, newsRes, searches, symbolBars, driverBars, history, banks, narrative] = await Promise.all([
    board,
    fetchNews(),
    Promise.all(queries.map(async (query) => ({ query, hits: await searchNews(query, { limit: SEARCH_HITS }) }))),
    fetchDailyBars(def.yahoo).catch(() => null),
    Promise.all(drivers.map((d) => fetchDailyBars(d.ticker).catch(() => null))),
    store.getSnapshots(def.symbol, since).catch((): ScoreSnapshot[] => []),
    fetchBankCommunication(economies, now),
    loadNarrative(now, board).catch((err) => {
      console.error('[ai-analysis] narrative engine failed', err);
      return null;
    }),
  ]);

  const rows = payload.matrix.rows;
  const row = rows.find((r) => r.symbol === def.symbol) ?? null;
  const indexRows = def.kind === 'currency'
    ? []
    : economies
        .map((c) => indexSymbolFor(c)?.symbol)
        .map((symbol) => rows.find((r) => r.symbol === symbol))
        .filter((r) => r !== undefined);

  const technicals = payload.technicals.get(def.symbol) ?? null;

  // Pairs read each economy's own futures contract; everything else its own.
  const legContracts: { currency: Currency | null; contract: string; kind: 'fx' | 'asset' }[] =
    def.kind === 'fx'
      ? economies.flatMap((c) => {
          const contract = indexSymbolFor(c)?.cotContract;
          return contract ? [{ currency: c, contract, kind: 'fx' as const }] : [];
        })
      : def.cotContract
        ? [{ currency: def.kind === 'currency' ? (def.macroEconomy ?? null) : null, contract: def.cotContract, kind: def.kind === 'currency' ? 'fx' : 'asset' }]
        : [];
  const positioning: LegPositioning[] = legContracts.map((l) => ({
    currency: l.currency,
    contract: l.contract,
    cot: scoreCot(payload.cot.get(l.contract), l.kind),
    crowd: scoreCrowd(payload.cot.get(l.contract)),
  }));

  const readingsOut = drivers.map((d, k) => readDriver(d, driverBars[k]));
  const droppedDrivers = drivers.filter((_, k) => readingsOut[k] === null).map((d) => `${d.label} (${d.ticker})`);

  // Most relevant first to choose WHICH stories make the cut, then newest first
  // to read them, so the model sees a timeline rather than a ranking.
  const news = clusterNews(relevantNews(newsRes.ok ? newsRes.data : [], economies, now))
    .map((c) => ({ c, score: newsRelevance(c, def, economies) }))
    .sort((a, b) => b.score - a.score || b.c.lastSeenUtc.localeCompare(a.c.lastSeenUtc))
    .slice(0, NEWS_CLUSTERS_MAX)
    .map(({ c }) => c)
    .sort((a, b) => b.lastSeenUtc.localeCompare(a.lastSeenUtc));

  const health: SourceHealth[] = newsRes.ok
    ? payload.health
    : [...payload.health, { source: 'RSS news', ok: false, detail: newsRes.error, fetchedAtUtc: newsRes.fetchedAtUtc }];

  const levels = buildLevels(symbolBars, technicals?.price ?? row?.price ?? null, now);
  const pair = narrative ? pairFromBundle(narrative, def, levels) : null;

  const mine = (opts.positions ?? []).filter((p) => p.symbol === def.symbol && !p.closedAtUtc);
  const positions: PositionView[] = mine.length
    ? await evaluatePositions(mine, { now, payload, bundle: narrative })
        .then((r) => r.views)
        .catch((err) => {
          console.error('[ai-analysis] thesis check failed', err);
          return mine.map((position) => ({ position, report: null, gap: 'thesis check failed on this run' }));
        })
    : [];

  return {
    def,
    economies,
    now,
    row,
    indexRows,
    events: payload.events,
    technicals,
    trend: scoreTrend(technicals ?? undefined),
    sovereignYields: payload.sovereignYields,
    policyRates: payload.policyRates,
    ecoStrength: payload.ecoStrength,
    strength: payload.strength,
    surprise: economies.map((c) => buildSurpriseIndex(c, payload.events, now)),
    positioning,
    retail: payload.retailPositioning.get(def.symbol) ?? null,
    history,
    levels,
    news,
    searches,
    drivers: readingsOut.filter((r) => r !== null),
    droppedDrivers,
    banks,
    risk: payload.risk,
    health,
    cotReportDate: payload.matrix.cotReportDate,
    narrative: pair && narrative ? { pair, state: narrative.state } : null,
    positions,
  };
}

export async function loadDossier(def: SymbolDefinition, now = new Date(), pipeline?: Promise<SetupsPayload>): Promise<Dossier> {
  return buildDossier(await loadAnalysisInputs(def, now, pipeline));
}
