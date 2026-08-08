/**
 * Turns headlines into clusters, and clusters into the risk factors that feed
 * asset scoring.
 *
 * The single rule that matters here: corroboration counts DISTINCT DOMAINS, not
 * articles. A wire story republished by one outlet five times is one source. Any
 * other counting method lets a single newsroom manufacture "high confidence".
 */

import { CORROBORATION_DOMAINS, HALF_LIFE_HOURS } from '@/config/scoring.config';
import { KEYWORD_RULES } from '@/config/sources.config';
import { RISK_CATEGORIES } from '@/config/assets.config';
import { decayFactor } from '@/lib/scoring/currency';
import type { AssetFactors } from '@/config/assets.config';
import type { CurrencyStrength, NewsCluster, NewsItem } from '@/lib/types';
import { clamp } from '@/lib/scoring/surprise';

/** Words carrying no topical signal, dropped before headline comparison. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'says', 'say',
  'said', 'after', 'before', 'over', 'into', 'that', 'this', 'it', 'its', 'his', 'her', 'their',
  'new', 'more', 'than', 'will', 'would', 'could', 'may', 'about',
]);

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard overlap — cheap, dependency-free, and good enough for headlines. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

const CLUSTER_THRESHOLD = 0.3;

/**
 * Greedy single-pass clustering of headlines describing the same story.
 *
 * Deliberately simple: with a few hundred headlines per ingest, anything more
 * sophisticated costs more than it returns.
 */
export function clusterNews(items: NewsItem[]): NewsCluster[] {
  const clusters: { items: NewsItem[]; tokens: Set<string> }[] = [];

  // Newest first, so the freshest headline names the cluster.
  const sorted = [...items].sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc));

  for (const item of sorted) {
    const itemTokens = tokens(item.title);
    const match = clusters.find((c) => similarity(c.tokens, itemTokens) >= CLUSTER_THRESHOLD);

    if (match) {
      match.items.push(item);
      // Union keeps the cluster's vocabulary broad enough to attract related
      // wordings of the same story.
      for (const t of itemTokens) match.tokens.add(t);
    } else {
      clusters.push({ items: [item], tokens: itemTokens });
    }
  }

  return clusters
    .map((c) => {
      const domains = new Set(c.items.map((i) => i.domain));
      const dates = c.items.map((i) => i.publishedUtc).sort();

      return {
        id: c.items[0].id,
        headline: c.items[0].title,
        items: c.items,
        domainCount: domains.size,
        category: c.items[0].category,
        firstSeenUtc: dates[0],
        lastSeenUtc: dates[dates.length - 1],
      };
    })
    // Most corroborated first, then most recent.
    .sort((a, b) => b.domainCount - a.domainCount || b.lastSeenUtc.localeCompare(a.lastSeenUtc));
}

/** A story is only "high confidence" once independent outlets carry it. */
export function isCorroborated(cluster: NewsCluster): boolean {
  return cluster.domainCount >= CORROBORATION_DOMAINS;
}

/** Highest severity among the keyword rules a headline matched. */
export function clusterSeverity(cluster: NewsCluster): number {
  const text = `${cluster.headline} ${cluster.items.map((i) => i.summary ?? '').join(' ')}`;
  let severity = 0;
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) severity = Math.max(severity, rule.severity);
    }
  }
  return severity;
}

function clusterHasSupplyRisk(cluster: NewsCluster): boolean {
  const text = `${cluster.headline} ${cluster.items.map((i) => i.summary ?? '').join(' ')}`;
  return KEYWORD_RULES.some((r) => r.supplyRisk && r.patterns.some((p) => p.test(text)));
}

/**
 * Derives the factor inputs used by asset scoring.
 *
 * Corroborated clusters count fully; uncorroborated ones are damped to a third.
 * A single unverified headline should nudge the gold score, not drive it.
 */
export function computeRiskFactors(
  clusters: NewsCluster[],
  strengths: CurrencyStrength[],
  now = new Date(),
): AssetFactors {
  let riskOff = 0;
  let geopolitics = 0;
  let supplyRisk = 0;

  for (const cluster of clusters) {
    const severity = clusterSeverity(cluster);
    if (severity === 0) continue;

    const ageHours = (now.getTime() - new Date(cluster.lastSeenUtc).getTime()) / 3_600_000;
    if (ageHours > 48) continue;

    const decay = decayFactor(Math.max(0, ageHours), HALF_LIFE_HOURS.news);
    const credibility = isCorroborated(cluster) ? 1 : 0.33;
    const contribution = severity * decay * credibility;

    if (RISK_CATEGORIES.includes(cluster.category)) {
      riskOff += contribution;
    }
    if (cluster.category === 'geopolitics') {
      geopolitics += contribution;
    }
    if (clusterHasSupplyRisk(cluster)) {
      supplyRisk += contribution;
    }
  }

  const byCurrency = new Map(strengths.map((s) => [s.currency, s]));
  const usdStrength = byCurrency.get('USD')?.score ?? 0;

  // Growth impulse: the average strength of the growth-sensitive currencies,
  // which is the cleanest read on global activity we already compute.
  const growthCurrencies = (['AUD', 'NZD', 'CAD'] as const)
    .map((c) => byCurrency.get(c))
    .filter((s): s is CurrencyStrength => !!s && s.contributors > 0);
  const growth = growthCurrencies.length
    ? growthCurrencies.reduce((sum, s) => sum + s.score, 0) / growthCurrencies.length
    : 0;

  // Inflation impulse is approximated by overall currency strength dispersion —
  // hot inflation prints push their currency up, so a wide spread implies an
  // active inflation narrative somewhere in the majors.
  const scores = strengths.filter((s) => s.contributors > 0).map((s) => s.score);
  const inflation = scores.length
    ? clamp(Math.max(...scores) - Math.min(...scores), 0, 10) / 2
    : 0;

  // Factors are expressed on the same -10..+10 scale as everything else so the
  // betas in assets.config.ts are readable at a glance.
  return {
    usdStrength: clamp(usdStrength, -10, 10),
    riskOff: clamp(riskOff * 4, -10, 10),
    geopolitics: clamp(geopolitics * 4, -10, 10),
    growth: clamp(growth, -10, 10),
    supplyRisk: clamp(supplyRisk * 4, -10, 10),
    inflation: clamp(inflation, -10, 10),
  };
}
