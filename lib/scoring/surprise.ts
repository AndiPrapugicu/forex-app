/**
 * Scores a single economic release.
 *
 * Pure and deterministic: no network, no module-level clock, no AI. The `now`
 * argument is injected so staleness decay is testable. Everything this file
 * decides is reconstructible from the event plus config/scoring.config.ts, which
 * is what lets the UI render the arithmetic instead of asking for trust.
 */

import {
  CONFIDENCE_BONUS,
  CONFIDENCE_FLOOR,
  CONFIDENCE_PENALTY,
  CURRENCY_REGIME,
  DEFAULT_EVENT_RULE,
  IMPACT_WEIGHT,
  MAX_SIGMA,
  REGIME_MULTIPLIER,
  SCORE_MAX,
  SCORE_MIN,
  SCORE_SCALE,
  SOURCE_CONFIDENCE,
  matchEventRule,
} from '@/config/scoring.config';
import type { Direction, EventScore, NormalizedEvent, ScoreTraceStep } from '@/lib/types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Surprise
// ---------------------------------------------------------------------------

export interface SurpriseResult {
  /** Signed sigma. Positive = the reading came in above expectations. */
  sigma: number | null;
  /** How it was derived, for the UI trace. */
  method: 'ratioDeviation' | 'config' | 'previous' | 'none';
  detail: string;
}

/**
 * Converts a print into a normalized surprise.
 *
 * Prefers FXStreet's `ratioDeviation`, which is calibrated against that series'
 * own release history — something we cannot reproduce from a single config
 * constant. Observed live: NFP missing by 103K scores -1.04 sigma while average
 * hourly earnings missing by 0.2pp scores -2.67 sigma. A fixed per-event divisor
 * would rank those two backwards.
 */
export function computeSurprise(event: NormalizedEvent): SurpriseResult {
  const rule = matchEventRule(event.name);

  if (event.actual === null) {
    return { sigma: null, method: 'none', detail: 'Not yet released' };
  }

  // Preferred: the feed's own historically-calibrated deviation.
  if (event.ratioDeviation !== null && Number.isFinite(event.ratioDeviation)) {
    return {
      sigma: clamp(event.ratioDeviation, -MAX_SIGMA, MAX_SIGMA),
      method: 'ratioDeviation',
      detail: `${event.ratioDeviation.toFixed(2)}σ vs this series' own history (FXStreet)`,
    };
  }

  // Fallback: normalize the raw miss by a configured typical deviation.
  if (event.consensus !== null && Number.isFinite(event.consensus)) {
    const raw = event.actual - event.consensus;
    const sigma = clamp(raw / rule.typicalDeviation, -MAX_SIGMA, MAX_SIGMA);
    return {
      sigma,
      method: 'config',
      detail: `${event.actual} vs ${event.consensus} forecast = ${raw > 0 ? '+' : ''}${round(raw)}, ` +
        `normalized by typical ±${rule.typicalDeviation}`,
    };
  }

  // Last resort: no forecast at all, so read direction off the prior print.
  // Deliberately damped — "above last month" is far weaker evidence than
  // "above what the market expected", and confidence is penalised as well.
  if (event.previous !== null && Number.isFinite(event.previous)) {
    const raw = event.actual - event.previous;
    const sigma = clamp(raw / rule.typicalDeviation, -MAX_SIGMA, MAX_SIGMA) * 0.5;
    return {
      sigma,
      method: 'previous',
      detail: `No forecast — ${event.actual} vs ${event.previous} previous (weak signal)`,
    };
  }

  return { sigma: null, method: 'none', detail: 'No forecast or previous to compare against' };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  event: NormalizedEvent;
  surprise: SurpriseResult;
  polarityConflict: boolean;
  unclassified: boolean;
  now: Date;
  /** Distinct corroborating domains, for AI-extracted actuals. */
  corroborationDomains?: number;
}

export function computeConfidence(input: ConfidenceInput): number {
  const { event, surprise, polarityConflict, unclassified, now } = input;

  // Base: how much we trust wherever the `actual` came from.
  const sourceKey = event.actualSource ?? event.source;
  let confidence: number = SOURCE_CONFIDENCE[sourceKey] ?? 50;

  if (surprise.method === 'previous' || surprise.method === 'none') {
    confidence -= CONFIDENCE_PENALTY.noConsensus;
  }
  if (polarityConflict) {
    confidence -= CONFIDENCE_PENALTY.polarityConflict;
  }
  if (unclassified) {
    confidence -= CONFIDENCE_PENALTY.unclassified;
  }

  // An LLM-extracted figure nobody has corroborated is the weakest input we
  // accept at all, so it is penalised twice: once via the low base above, once
  // here unless independent domains back it up.
  if (event.actualSource === 'ai-extracted') {
    const domains = input.corroborationDomains ?? 0;
    if (domains >= 3) confidence += CONFIDENCE_BONUS.corroborated;
    else confidence -= CONFIDENCE_PENALTY.aiUncorroborated;
  }

  // Staleness: a print loses relevance as the session moves on. Future events
  // are not stale, so clamp the age at zero.
  const ageHours = Math.max(0, (now.getTime() - new Date(event.dateUtc).getTime()) / 3_600_000);
  confidence -= ageHours * CONFIDENCE_PENALTY.stalenessPerHour;

  return clamp(Math.round(confidence), 0, 100);
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

/**
 * Confidence gates direction, not score magnitude.
 * Below the floor we say "uncertain" rather than show a weak call — a hedged
 * bullish arrow reads as a signal, and being wrong quietly is the failure mode
 * worth engineering against.
 */
export function toDirection(score: number, confidence: number): Direction {
  if (confidence < CONFIDENCE_FLOOR) return 'uncertain';
  if (score > 0.5) return 'bullish';
  if (score < -0.5) return 'bearish';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function scoreEvent(event: NormalizedEvent, now = new Date()): EventScore {
  const rule = matchEventRule(event.name);
  const unclassified = rule.key === DEFAULT_EVENT_RULE.key;
  const surprise = computeSurprise(event);

  const trace: ScoreTraceStep[] = [];

  // --- 1. Surprise --------------------------------------------------------
  const sigma = surprise.sigma;
  trace.push({
    label: 'Surprise',
    detail: surprise.detail,
    value: sigma === null ? 0 : round(sigma),
    op: 'signed',
  });

  if (sigma === null) {
    // Upcoming or unscoreable: report zero with the reason, never a guess.
    const confidence = computeConfidence({ event, surprise, polarityConflict: false, unclassified, now });
    return {
      eventId: event.id,
      currency: event.currency,
      score: 0,
      confidence,
      direction: 'uncertain',
      surprise: null,
      trace,
      polarityConflict: false,
      scoredAtUtc: now.toISOString(),
    };
  }

  // --- 2. Polarity --------------------------------------------------------
  // Turns "the number went up" into "the currency should go up".
  trace.push({
    label: 'Polarity',
    detail:
      rule.polarity === 1
        ? `Higher ${rule.key} is bullish for ${event.currency}`
        : `Higher ${rule.key} is bearish for ${event.currency}`,
    value: rule.polarity,
    op: 'multiplier',
  });

  /**
   * Cross-check against the feed's own verdict.
   *
   * `isBetterThanExpected` is polarity-aware for the ECONOMY (higher
   * unemployment => false). Our polarity is for the CURRENCY. Those usually
   * agree, but not always — hot inflation is bad economic news and a bullish
   * currency signal at once. So a mismatch is not automatically an error; it
   * only costs confidence, and only where the two are directly comparable.
   */
  const directionalAgreement = rule.polarity === 1 ? sigma > 0 : sigma < 0;
  const polarityConflict =
    event.isBetterThanExpected !== null &&
    rule.category !== 'inflation' &&
    rule.category !== 'central-bank' &&
    event.isBetterThanExpected !== directionalAgreement;

  if (polarityConflict) {
    trace.push({
      label: 'Source disagreement',
      detail: `${event.source} rates this print as ${event.isBetterThanExpected ? 'better' : 'worse'} ` +
        `than expected, which conflicts with our rule — confidence reduced`,
      value: 0,
      op: 'plain',
    });
  }

  // --- 3. Impact ----------------------------------------------------------
  const impactWeight = IMPACT_WEIGHT[event.impact];
  trace.push({
    label: 'Impact',
    detail: `${event.impact} impact release`,
    value: impactWeight,
    op: 'multiplier',
  });

  // --- 4. Regime ----------------------------------------------------------
  // The policy-context dial: the same CPI beat means different things depending
  // on whether the central bank is hiking or cutting.
  const regime = CURRENCY_REGIME[event.currency];
  const regimeMultiplier = rule.inflationSensitive ? REGIME_MULTIPLIER[regime] : 1;

  if (rule.inflationSensitive) {
    trace.push({
      label: 'Policy regime',
      detail:
        regime === 'cutting'
          ? `${event.currency} is in a cutting cycle — an upside inflation surprise delays cuts rather than inviting hikes, so it carries less force`
          : regime === 'hiking'
            ? `${event.currency} is in a hiking cycle — inflation surprises translate directly into rate expectations`
            : `${event.currency} policy is on hold — inflation surprises are partially discounted`,
      value: regimeMultiplier,
      op: 'multiplier',
    });
  }

  // --- 5. Series weight ---------------------------------------------------
  const weight = rule.weight ?? 1;
  if (weight !== 1) {
    trace.push({
      label: 'Series weight',
      detail: unclassified
        ? 'Event type not recognised — scored weakly and flagged'
        : `${rule.key} is weighted ${weight}x relative to a standard release`,
      value: weight,
      op: 'multiplier',
    });
  }

  // --- 6. Combine ---------------------------------------------------------
  const raw = sigma * rule.polarity * impactWeight * regimeMultiplier * weight;
  const score = clamp(round(raw * SCORE_SCALE, 1), SCORE_MIN, SCORE_MAX);

  trace.push({
    label: 'Score',
    detail: `${round(sigma)}σ × ${rule.polarity} polarity × ${impactWeight} impact` +
      (regimeMultiplier !== 1 ? ` × ${regimeMultiplier} regime` : '') +
      (weight !== 1 ? ` × ${weight} weight` : '') +
      ` × ${SCORE_SCALE} scale`,
    value: score,
    op: 'signed',
  });

  const confidence = computeConfidence({ event, surprise, polarityConflict, unclassified, now });

  return {
    eventId: event.id,
    currency: event.currency,
    score,
    confidence,
    direction: toDirection(score, confidence),
    surprise: round(sigma),
    trace,
    polarityConflict,
    scoredAtUtc: now.toISOString(),
  };
}
