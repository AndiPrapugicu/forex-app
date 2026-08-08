/**
 * Scores metals and oil from named factors.
 *
 * Every asset score decomposes into labelled contributions, each carrying the
 * reason from assets.config.ts. The UI renders them as rows, so "gold is +4.2"
 * is always followed by "because the dollar is soft (+1.8) and escalation risk
 * is elevated (+2.4)". No unattributable numbers.
 */

import { ASSET_DEFINITIONS, type AssetFactors } from '@/config/assets.config';
import { CONFIDENCE_FLOOR, SCORE_MAX, SCORE_MIN } from '@/config/scoring.config';
import { clamp, toDirection } from '@/lib/scoring/surprise';
import type { AssetContribution, AssetScore, CurrencyStrength, NewsCluster } from '@/lib/types';
import { isCorroborated } from '@/lib/scoring/news';

/**
 * Confidence for an asset comes from the evidence behind its inputs:
 * how well-evidenced the currency legs are, and whether the news driving the
 * risk factors is corroborated.
 */
function computeAssetConfidence(
  strengths: CurrencyStrength[],
  clusters: NewsCluster[],
  usesNews: boolean,
): number {
  const usd = strengths.find((s) => s.currency === 'USD');
  const usdConfidence = usd && usd.contributors > 0 ? usd.confidence : 0;

  if (!usesNews) return Math.round(usdConfidence);

  // News-driven factors are only as good as their corroboration.
  const relevant = clusters.filter((c) => c.domainCount > 0).slice(0, 10);
  const corroboratedShare = relevant.length
    ? relevant.filter(isCorroborated).length / relevant.length
    : 0;

  const newsConfidence = relevant.length === 0 ? 0 : 40 + corroboratedShare * 55;

  // Weighted toward whichever input is actually carrying the score.
  return Math.round(usdConfidence * 0.45 + newsConfidence * 0.55);
}

export function computeAssetScores(
  factors: AssetFactors,
  strengths: CurrencyStrength[],
  clusters: NewsCluster[],
): AssetScore[] {
  return ASSET_DEFINITIONS.map((def) => {
    const contributions: AssetContribution[] = [];
    let total = 0;
    let usesNews = false;

    for (const [factorName, spec] of Object.entries(def.betas)) {
      const key = factorName as keyof AssetFactors;
      const input = factors[key];
      if (input === undefined) continue;

      const contribution = spec.beta * input;

      // Drop negligible terms so the UI shows drivers, not noise.
      if (Math.abs(contribution) < 0.05) continue;

      if (key === 'riskOff' || key === 'geopolitics' || key === 'supplyRisk') usesNews = true;

      contributions.push({
        label: spec.reason,
        beta: spec.beta,
        input: Math.round(input * 100) / 100,
        contribution: Math.round(contribution * 100) / 100,
      });

      total += contribution;
    }

    // Largest driver first — the trader should see the "why" ranked.
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    const score = Math.round(clamp(total, SCORE_MIN, SCORE_MAX) * 10) / 10;
    const confidence = clamp(computeAssetConfidence(strengths, clusters, usesNews), 0, 100);

    return {
      asset: def.asset,
      score,
      confidence,
      direction: toDirection(score, confidence),
      contributions,
    };
  });
}

/** Human-readable one-liner for the asset panel and Telegram messages. */
export function describeAssetScore(score: AssetScore): string {
  if (score.confidence < CONFIDENCE_FLOOR) {
    return 'Not enough corroborated evidence to call a direction';
  }
  const top = score.contributions[0];
  if (!top) return 'No active drivers';
  const sign = top.contribution > 0 ? 'supporting' : 'weighing on';
  return `${top.label} is ${sign} it (${top.contribution > 0 ? '+' : ''}${top.contribution})`;
}
