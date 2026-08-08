/**
 * Aggregates individual event scores into per-currency strength, then into pair
 * scores. Pure functions with an injected clock.
 */

import {
  AGGREGATION_WINDOW_HOURS,
  CONFIDENCE_FLOOR,
  HALF_LIFE_HOURS,
  PAIR_SCALE,
  SCORE_MAX,
  SCORE_MIN,
  TRACKED_PAIRS,
} from '@/config/scoring.config';
import { MAJORS, type Currency, type CurrencyStrength, type EventScore, type NormalizedEvent, type PairScore } from '@/lib/types';
import { clamp, toDirection } from '@/lib/scoring/surprise';

/**
 * Exponential decay by half-life.
 * A print stops colouring the tape gradually rather than falling off a cliff at
 * an arbitrary cutoff.
 */
export function decayFactor(ageHours: number, halfLifeHours: number): number {
  if (ageHours <= 0) return 1; // future or just-released events are undecayed
  return 0.5 ** (ageHours / halfLifeHours);
}

export interface ScoredEvent {
  event: NormalizedEvent;
  score: EventScore;
}

/**
 * Currency strength = confidence-and-recency-weighted mean of that currency's
 * event scores.
 *
 * A weighted MEAN, not a sum: a sum would let a currency with many low-impact
 * releases outrank one with a single decisive print, which is backwards. Weight
 * combines recency (decay) with how much we trust each score (confidence).
 */
export function computeCurrencyStrength(
  scored: ScoredEvent[],
  now = new Date(),
): CurrencyStrength[] {
  const buckets = new Map<Currency, { weighted: number; weight: number; conf: number; n: number }>();

  for (const currency of MAJORS) {
    buckets.set(currency, { weighted: 0, weight: 0, conf: 0, n: 0 });
  }

  for (const { event, score } of scored) {
    const bucket = buckets.get(event.currency);
    if (!bucket) continue;

    // Unscored (upcoming) events contribute nothing — they are not evidence yet.
    if (score.surprise === null || score.score === 0) continue;

    const ageHours = (now.getTime() - new Date(event.dateUtc).getTime()) / 3_600_000;

    // Future events are excluded: an upcoming release must not move current
    // strength, or the dashboard would front-run its own calendar.
    if (ageHours < 0) continue;
    if (ageHours > AGGREGATION_WINDOW_HOURS) continue;

    const decay = decayFactor(ageHours, HALF_LIFE_HOURS.macro);
    const weight = decay * (score.confidence / 100);
    if (weight <= 0) continue;

    bucket.weighted += score.score * weight;
    bucket.weight += weight;
    bucket.conf += score.confidence * weight;
    bucket.n += 1;
  }

  return MAJORS.map((currency) => {
    const b = buckets.get(currency)!;

    if (b.weight === 0) {
      return {
        currency,
        score: 0,
        confidence: 0,
        direction: 'uncertain' as const,
        contributors: 0,
      };
    }

    const score = clamp(b.weighted / b.weight, SCORE_MIN, SCORE_MAX);
    const confidence = Math.round(b.conf / b.weight);

    return {
      currency,
      score: Math.round(score * 10) / 10,
      confidence,
      direction: toDirection(score, confidence),
      contributors: b.n,
    };
  });
}

/**
 * Pair score = base strength minus quote strength.
 *
 * Confidence is the MINIMUM of the two legs, not the average: a EUR/USD call is
 * only as trustworthy as the weaker side. Averaging would let a well-evidenced
 * EUR read paper over a USD side we know nothing about.
 */
export function computePairScores(strengths: CurrencyStrength[]): PairScore[] {
  const byCurrency = new Map(strengths.map((s) => [s.currency, s]));

  return TRACKED_PAIRS.map(([base, quote]) => {
    const b = byCurrency.get(base);
    const q = byCurrency.get(quote);

    const raw = (b?.score ?? 0) - (q?.score ?? 0);
    const score = Math.round(clamp(raw * PAIR_SCALE, SCORE_MIN, SCORE_MAX) * 10) / 10;
    const confidence = Math.min(b?.confidence ?? 0, q?.confidence ?? 0);

    return {
      pair: `${base}${quote}`,
      base,
      quote,
      score,
      confidence,
      direction: toDirection(score, confidence),
    };
  });
}

/**
 * Overall market mood: how risk-on or risk-off the tape reads.
 *
 * Built from the spread between commodity/growth currencies and havens rather
 * than by averaging all eight — averaging currencies is meaningless, since every
 * FX move is relative and the mean is nearly always ~0 by construction.
 */
export function computeMarketMood(strengths: CurrencyStrength[]): {
  score: number;
  label: string;
  confidence: number;
} {
  const byCurrency = new Map(strengths.map((s) => [s.currency, s]));
  const get = (c: Currency) => byCurrency.get(c);

  const riskOn: Currency[] = ['AUD', 'NZD', 'CAD'];
  const havens: Currency[] = ['JPY', 'CHF', 'USD'];

  const avg = (list: Currency[], pick: (s: CurrencyStrength) => number) => {
    const vals = list.map((c) => get(c)).filter((s): s is CurrencyStrength => !!s && s.contributors > 0);
    if (!vals.length) return null;
    return vals.reduce((sum, s) => sum + pick(s), 0) / vals.length;
  };

  const riskOnScore = avg(riskOn, (s) => s.score);
  const havenScore = avg(havens, (s) => s.score);

  if (riskOnScore === null || havenScore === null) {
    return { score: 0, label: 'No signal', confidence: 0 };
  }

  const score = Math.round(clamp(riskOnScore - havenScore, SCORE_MIN, SCORE_MAX) * 10) / 10;

  const confidence = Math.round(
    (avg(riskOn, (s) => s.confidence) ?? 0) * 0.5 + (avg(havens, (s) => s.confidence) ?? 0) * 0.5,
  );

  const label =
    confidence < CONFIDENCE_FLOOR
      ? 'Unclear'
      : score > 2
        ? 'Risk-on'
        : score > 0.5
          ? 'Mildly risk-on'
          : score < -2
            ? 'Risk-off'
            : score < -0.5
              ? 'Mildly risk-off'
              : 'Balanced';

  return { score, label, confidence };
}
