/**
 * Scoring engine tests.
 *
 * This is the deterministic core, so it is the part worth testing properly —
 * everything else in the app is I/O around it. Several cases use real prints
 * captured from the FXStreet feed during planning, so the expectations describe
 * actual market events rather than invented numbers.
 */

import { describe, expect, it } from 'vitest';
import { computeSurprise, scoreEvent, toDirection } from '@/lib/scoring/surprise';
import { computeCurrencyStrength, computeMarketMood, computePairScores, decayFactor } from '@/lib/scoring/currency';
import { clusterNews, computeRiskFactors, isCorroborated } from '@/lib/scoring/news';
import { computeAssetScores } from '@/lib/scoring/assets';
import { CONFIDENCE_FLOOR } from '@/config/scoring.config';
import type { NewsItem, NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-08T12:00:00Z');

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'test-1',
    seriesId: null,
    name: 'Nonfarm Payrolls',
    currency: 'USD',
    dateUtc: '2026-08-08T11:00:00Z',
    impact: 'HIGH',
    actual: null,
    consensus: null,
    previous: null,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: null,
    sourceUrl: null,
    lastUpdated: null,
    ...overrides,
  };
}

function makeNews(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Generic headline',
    url: 'https://example.com/a',
    domain: 'example.com',
    sourceName: 'Example',
    publishedUtc: '2026-08-08T11:00:00Z',
    summary: null,
    category: 'geopolitics',
    matchedKeywords: [],
    affects: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('computeSurprise', () => {
  it('prefers the feed ratioDeviation over config normalization', () => {
    const result = computeSurprise(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04 }),
    );
    expect(result.method).toBe('ratioDeviation');
    expect(result.sigma).toBeCloseTo(-1.04, 2);
  });

  it('falls back to config normalization when ratioDeviation is absent', () => {
    // NFP typicalDeviation is 50, so a 100K miss is -2 sigma.
    const result = computeSurprise(makeEvent({ actual: -20, consensus: 80 }));
    expect(result.method).toBe('config');
    expect(result.sigma).toBeCloseTo(-2, 2);
  });

  it('clamps extreme surprises to MAX_SIGMA', () => {
    const result = computeSurprise(makeEvent({ actual: 5000, consensus: 80 }));
    expect(result.sigma).toBe(3);
  });

  it('damps the previous-only path and marks it weak', () => {
    // No consensus: 100K above previous would be +2 sigma, halved to +1.
    const result = computeSurprise(makeEvent({ actual: 150, previous: 50 }));
    expect(result.method).toBe('previous');
    expect(result.sigma).toBeCloseTo(1, 2);
  });

  it('returns null for an unreleased event', () => {
    expect(computeSurprise(makeEvent({ consensus: 80 })).sigma).toBeNull();
  });

  it('returns null when there is nothing to compare against', () => {
    const result = computeSurprise(makeEvent({ actual: 100 }));
    expect(result.sigma).toBeNull();
    expect(result.method).toBe('none');
  });
});

describe('scoreEvent — polarity', () => {
  it('scores a payrolls miss as bearish for the dollar', () => {
    // Real print: NFP -23K vs 80K consensus, -1.04 sigma.
    const score = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'fxstreet' }),
      NOW,
    );
    expect(score.score).toBeLessThan(0);
    expect(score.direction).toBe('bearish');
  });

  it('inverts polarity for unemployment, where higher is worse', () => {
    // Real print: NZD unemployment 5.6 vs 5.4 expected — a rise, so bearish.
    const score = scoreEvent(
      makeEvent({
        name: 'Unemployment Rate',
        currency: 'NZD',
        actual: 5.6,
        consensus: 5.4,
        ratioDeviation: 1.96,
        actualSource: 'fxstreet',
      }),
      NOW,
    );
    expect(score.score).toBeLessThan(0);
    expect(score.direction).toBe('bearish');
  });

  it('scores an employment beat as bullish', () => {
    // Real print: CAD net change in employment 75.1K vs 15K.
    const score = scoreEvent(
      makeEvent({
        name: 'Net Change in Employment',
        currency: 'CAD',
        actual: 75.1,
        consensus: 15,
        ratioDeviation: 1.07,
        actualSource: 'fxstreet',
      }),
      NOW,
    );
    expect(score.score).toBeGreaterThan(0);
    expect(score.direction).toBe('bullish');
  });
});

describe('scoreEvent — regime', () => {
  it('damps an inflation beat under a cutting cycle vs a hiking one', () => {
    // USD is configured as cutting, JPY as hiking. Same surprise, same impact.
    const usd = scoreEvent(
      makeEvent({
        name: 'Consumer Price Index (YoY)',
        currency: 'USD',
        actual: 3.4,
        consensus: 3.1,
        ratioDeviation: 1.5,
        actualSource: 'fxstreet',
      }),
      NOW,
    );
    const jpy = scoreEvent(
      makeEvent({
        name: 'Consumer Price Index (YoY)',
        currency: 'JPY',
        actual: 3.4,
        consensus: 3.1,
        ratioDeviation: 1.5,
        actualSource: 'fxstreet',
      }),
      NOW,
    );

    expect(usd.score).toBeGreaterThan(0);
    expect(jpy.score).toBeGreaterThan(usd.score);
  });

  it('leaves non-inflation-sensitive events untouched by regime', () => {
    const score = scoreEvent(
      makeEvent({ name: 'Retail Sales (MoM)', actual: 1.0, consensus: 0.5, actualSource: 'fxstreet' }),
      NOW,
    );
    expect(score.trace.some((t) => t.label === 'Policy regime')).toBe(false);
  });
});

describe('scoreEvent — impact weighting', () => {
  it('scales a low-impact print below an identical high-impact one', () => {
    const base = { actual: 55, consensus: 52, ratioDeviation: 2, actualSource: 'fxstreet' as const };
    const high = scoreEvent(makeEvent({ ...base, name: 'ISM Manufacturing PMI', impact: 'HIGH' }), NOW);
    const low = scoreEvent(makeEvent({ ...base, name: 'ISM Manufacturing PMI', impact: 'LOW' }), NOW);

    expect(Math.abs(high.score)).toBeGreaterThan(Math.abs(low.score));
  });
});

describe('scoreEvent — confidence', () => {
  it('renders uncertain rather than a direction below the floor', () => {
    // Aged well past the point where staleness decay drops it under the floor.
    const old = new Date('2026-08-01T12:00:00Z').toISOString();
    const score = scoreEvent(
      makeEvent({ dateUtc: old, actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'fxstreet' }),
      NOW,
    );
    expect(score.confidence).toBeLessThan(CONFIDENCE_FLOOR);
    expect(score.direction).toBe('uncertain');
  });

  it('ranks a manual actual above a feed actual', () => {
    const feed = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'fxstreet' }),
      NOW,
    );
    const manual = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'manual' }),
      NOW,
    );
    expect(manual.confidence).toBeGreaterThan(feed.confidence);
  });

  it('penalises an AI-extracted actual that nothing corroborates', () => {
    const ai = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'ai-extracted' }),
      NOW,
    );
    const feed = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'fxstreet' }),
      NOW,
    );
    expect(ai.confidence).toBeLessThan(feed.confidence);
  });

  it('penalises a missing forecast', () => {
    const withForecast = scoreEvent(
      makeEvent({ actual: 150, consensus: 100, actualSource: 'fxstreet' }),
      NOW,
    );
    const without = scoreEvent(makeEvent({ actual: 150, previous: 100, actualSource: 'fxstreet' }), NOW);
    expect(without.confidence).toBeLessThan(withForecast.confidence);
  });

  it('flags disagreement with the feed and reduces confidence', () => {
    // Employment beat, but the feed claims it was worse than expected.
    const conflicted = scoreEvent(
      makeEvent({
        name: 'Net Change in Employment',
        actual: 75,
        consensus: 15,
        ratioDeviation: 1.07,
        isBetterThanExpected: false,
        actualSource: 'fxstreet',
      }),
      NOW,
    );
    const agreed = scoreEvent(
      makeEvent({
        name: 'Net Change in Employment',
        actual: 75,
        consensus: 15,
        ratioDeviation: 1.07,
        isBetterThanExpected: true,
        actualSource: 'fxstreet',
      }),
      NOW,
    );

    expect(conflicted.polarityConflict).toBe(true);
    expect(agreed.polarityConflict).toBe(false);
    expect(conflicted.confidence).toBeLessThan(agreed.confidence);
  });

  it('does not flag conflict on inflation, where the two measure different things', () => {
    // Hot CPI is worse for the economy but bullish for the currency; the feed
    // and our rule are answering different questions, so this is not a conflict.
    const score = scoreEvent(
      makeEvent({
        name: 'Consumer Price Index (YoY)',
        actual: 3.4,
        consensus: 3.1,
        ratioDeviation: 1.5,
        isBetterThanExpected: false,
        actualSource: 'fxstreet',
      }),
      NOW,
    );
    expect(score.polarityConflict).toBe(false);
  });
});

describe('scoreEvent — unclassified events', () => {
  it('scores weakly and does not pretend to know the polarity', () => {
    const known = scoreEvent(
      makeEvent({ name: 'Nonfarm Payrolls', actual: 150, consensus: 100, ratioDeviation: 1, actualSource: 'fxstreet' }),
      NOW,
    );
    const unknown = scoreEvent(
      makeEvent({ name: 'Zorblax Index of Things', actual: 150, consensus: 100, ratioDeviation: 1, actualSource: 'fxstreet' }),
      NOW,
    );

    expect(Math.abs(unknown.score)).toBeLessThan(Math.abs(known.score));
    expect(unknown.confidence).toBeLessThan(known.confidence);
  });
});

describe('scoreEvent — trace', () => {
  it('always explains itself', () => {
    const score = scoreEvent(
      makeEvent({ actual: -23, consensus: 80, ratioDeviation: -1.04, actualSource: 'fxstreet' }),
      NOW,
    );
    const labels = score.trace.map((t) => t.label);
    expect(labels).toContain('Surprise');
    expect(labels).toContain('Polarity');
    expect(labels).toContain('Impact');
    expect(labels).toContain('Score');
  });

  it('explains why an unreleased event has no score', () => {
    const score = scoreEvent(makeEvent({ consensus: 80 }), NOW);
    expect(score.score).toBe(0);
    expect(score.direction).toBe('uncertain');
    expect(score.trace[0].detail).toMatch(/not yet released/i);
  });
});

// ---------------------------------------------------------------------------

describe('decayFactor', () => {
  it('halves at one half-life', () => {
    expect(decayFactor(24, 24)).toBeCloseTo(0.5, 5);
    expect(decayFactor(48, 24)).toBeCloseTo(0.25, 5);
  });

  it('does not decay future or just-released events', () => {
    expect(decayFactor(0, 24)).toBe(1);
    expect(decayFactor(-5, 24)).toBe(1);
  });
});

describe('computeCurrencyStrength', () => {
  const scored = (e: Partial<NormalizedEvent>) => {
    const event = makeEvent(e);
    return { event, score: scoreEvent(event, NOW) };
  };

  it('reports zero confidence for a currency with no events', () => {
    const strengths = computeCurrencyStrength([], NOW);
    const eur = strengths.find((s) => s.currency === 'EUR')!;
    expect(eur.score).toBe(0);
    expect(eur.confidence).toBe(0);
    expect(eur.direction).toBe('uncertain');
  });

  it('excludes future events so the dashboard cannot front-run its calendar', () => {
    const future = scored({
      dateUtc: '2026-08-09T12:00:00Z',
      actual: 200,
      consensus: 80,
      ratioDeviation: 2,
      actualSource: 'fxstreet',
    });
    const strengths = computeCurrencyStrength([future], NOW);
    expect(strengths.find((s) => s.currency === 'USD')!.contributors).toBe(0);
  });

  it('weights a recent print above an older one', () => {
    const recent = computeCurrencyStrength(
      [scored({ dateUtc: '2026-08-08T11:00:00Z', actual: 200, consensus: 80, ratioDeviation: 2, actualSource: 'fxstreet' })],
      NOW,
    ).find((s) => s.currency === 'USD')!;

    const older = computeCurrencyStrength(
      [scored({ dateUtc: '2026-08-07T00:00:00Z', actual: 200, consensus: 80, ratioDeviation: 2, actualSource: 'fxstreet' })],
      NOW,
    ).find((s) => s.currency === 'USD')!;

    expect(recent.confidence).toBeGreaterThan(older.confidence);
  });

  it('averages rather than sums, so many small prints cannot outrank one big one', () => {
    const oneBig = computeCurrencyStrength(
      [scored({ actual: 300, consensus: 80, ratioDeviation: 3, actualSource: 'fxstreet' })],
      NOW,
    ).find((s) => s.currency === 'USD')!;

    const manySmall = computeCurrencyStrength(
      Array.from({ length: 5 }, (_, i) =>
        scored({ id: `s${i}`, name: 'JOLTS Job Openings', impact: 'LOW', actual: 100, consensus: 90, ratioDeviation: 0.3, actualSource: 'fxstreet' }),
      ),
      NOW,
    ).find((s) => s.currency === 'USD')!;

    expect(oneBig.score).toBeGreaterThan(manySmall.score);
  });
});

describe('computePairScores', () => {
  it('subtracts quote strength from base strength', () => {
    const strengths = computeCurrencyStrength([], NOW).map((s) =>
      s.currency === 'EUR'
        ? { ...s, score: 6, confidence: 80, contributors: 1 }
        : s.currency === 'USD'
          ? { ...s, score: -4, confidence: 70, contributors: 1 }
          : s,
    );

    const eurusd = computePairScores(strengths).find((p) => p.pair === 'EURUSD')!;
    // (6 - (-4)) * 0.5 = 5
    expect(eurusd.score).toBeCloseTo(5, 1);
    expect(eurusd.direction).toBe('bullish');
  });

  it('takes the weaker leg for confidence', () => {
    const strengths = computeCurrencyStrength([], NOW).map((s) =>
      s.currency === 'EUR'
        ? { ...s, score: 6, confidence: 90, contributors: 1 }
        : s.currency === 'USD'
          ? { ...s, score: -4, confidence: 30, contributors: 1 }
          : s,
    );
    const eurusd = computePairScores(strengths).find((p) => p.pair === 'EURUSD')!;
    expect(eurusd.confidence).toBe(30);
    // Below the floor, so no direction is asserted despite a large score.
    expect(eurusd.direction).toBe('uncertain');
  });
});

describe('computeMarketMood', () => {
  it('reads commodity strength against haven weakness as risk-on', () => {
    const strengths = computeCurrencyStrength([], NOW).map((s) =>
      ['AUD', 'NZD', 'CAD'].includes(s.currency)
        ? { ...s, score: 5, confidence: 80, contributors: 2 }
        : ['JPY', 'CHF', 'USD'].includes(s.currency)
          ? { ...s, score: -3, confidence: 80, contributors: 2 }
          : s,
    );
    const mood = computeMarketMood(strengths);
    expect(mood.score).toBeGreaterThan(0);
    expect(mood.label).toBe('Risk-on');
  });

  it('reports no signal when nothing has been scored', () => {
    expect(computeMarketMood(computeCurrencyStrength([], NOW)).label).toBe('No signal');
  });
});

// ---------------------------------------------------------------------------

describe('clusterNews', () => {
  it('groups differently-worded reports of the same story', () => {
    const clusters = clusterNews([
      makeNews({ title: 'Russian missile attacks near Kyiv kill three', domain: 'bbc.co.uk' }),
      makeNews({ title: 'Russian strikes near Ukrainian capital kill three people', domain: 'aljazeera.com' }),
      makeNews({ title: 'Gold prices rally to fresh record high', domain: 'cnbc.com' }),
    ]);

    const kyiv = clusters.find((c) => /kyiv|ukrainian/i.test(c.headline))!;
    expect(kyiv.items.length).toBe(2);
    expect(kyiv.domainCount).toBe(2);
  });

  it('counts distinct domains, so one outlet cannot corroborate itself', () => {
    const clusters = clusterNews([
      makeNews({ title: 'Sanctions imposed on Russian energy exports', domain: 'aljazeera.com' }),
      makeNews({ title: 'Sanctions imposed on Russian energy exports today', domain: 'aljazeera.com' }),
      makeNews({ title: 'New sanctions target Russian energy exports', domain: 'aljazeera.com' }),
    ]);

    expect(clusters[0].items.length).toBe(3);
    expect(clusters[0].domainCount).toBe(1);
    expect(isCorroborated(clusters[0])).toBe(false);
  });

  it('marks a story carried by three independent domains as corroborated', () => {
    const clusters = clusterNews([
      makeNews({ title: 'Sanctions imposed on Russian energy exports', domain: 'bbc.co.uk' }),
      makeNews({ title: 'Sanctions imposed on Russian energy exports', domain: 'reuters.com' }),
      makeNews({ title: 'Sanctions imposed on Russian energy exports', domain: 'aljazeera.com' }),
    ]);
    expect(clusters[0].domainCount).toBe(3);
    expect(isCorroborated(clusters[0])).toBe(true);
  });
});

describe('computeRiskFactors', () => {
  it('lets corroborated escalation outweigh a lone unverified headline', () => {
    const strengths = computeCurrencyStrength([], NOW);

    const corroborated = computeRiskFactors(
      clusterNews([
        makeNews({ title: 'Missile strikes hit capital', domain: 'bbc.co.uk', publishedUtc: NOW.toISOString() }),
        makeNews({ title: 'Missile strikes hit capital', domain: 'reuters.com', publishedUtc: NOW.toISOString() }),
        makeNews({ title: 'Missile strikes hit capital', domain: 'aljazeera.com', publishedUtc: NOW.toISOString() }),
      ]),
      strengths,
      NOW,
    );

    const single = computeRiskFactors(
      clusterNews([
        makeNews({ title: 'Missile strikes hit capital', domain: 'bbc.co.uk', publishedUtc: NOW.toISOString() }),
      ]),
      strengths,
      NOW,
    );

    expect(corroborated.geopolitics).toBeGreaterThan(single.geopolitics);
    expect(single.geopolitics).toBeGreaterThan(0);
  });

  it('detects oil supply risk from producer-region language', () => {
    const factors = computeRiskFactors(
      clusterNews([
        makeNews({ title: 'Strait of Hormuz shipping disrupted by strikes', domain: 'bbc.co.uk', publishedUtc: NOW.toISOString() }),
        makeNews({ title: 'Strait of Hormuz shipping disrupted', domain: 'reuters.com', publishedUtc: NOW.toISOString() }),
        makeNews({ title: 'Hormuz strait shipping disrupted by strikes', domain: 'cnbc.com', publishedUtc: NOW.toISOString() }),
      ]),
      computeCurrencyStrength([], NOW),
      NOW,
    );
    expect(factors.supplyRisk).toBeGreaterThan(0);
  });

  it('ignores stale news', () => {
    const factors = computeRiskFactors(
      clusterNews([
        makeNews({ title: 'Missile strikes hit capital', domain: 'bbc.co.uk', publishedUtc: '2026-07-01T00:00:00Z' }),
      ]),
      computeCurrencyStrength([], NOW),
      NOW,
    );
    expect(factors.geopolitics).toBe(0);
  });
});

describe('computeAssetScores', () => {
  const strengths = computeCurrencyStrength([], NOW);

  it('pushes gold up on a weak dollar', () => {
    const gold = computeAssetScores(
      { usdStrength: -5, riskOff: 0, geopolitics: 0, growth: 0, supplyRisk: 0, inflation: 0 },
      strengths,
      [],
    ).find((a) => a.asset === 'XAU')!;

    expect(gold.score).toBeGreaterThan(0);
    expect(gold.contributions[0].label).toMatch(/dollar/i);
  });

  it('pushes gold up on escalation', () => {
    const gold = computeAssetScores(
      { usdStrength: 0, riskOff: 5, geopolitics: 6, growth: 0, supplyRisk: 0, inflation: 0 },
      strengths,
      [],
    ).find((a) => a.asset === 'XAU')!;
    expect(gold.score).toBeGreaterThan(0);
  });

  it('separates gold from platinum on a growth shock, since platinum is industrial', () => {
    const factors = { usdStrength: 0, riskOff: 4, geopolitics: 0, growth: -6, supplyRisk: 0, inflation: 0 };
    const scores = computeAssetScores(factors, strengths, []);
    const gold = scores.find((a) => a.asset === 'XAU')!;
    const platinum = scores.find((a) => a.asset === 'XPT')!;

    // Gold catches a haven bid; platinum is dragged down by industrial demand.
    expect(gold.score).toBeGreaterThan(platinum.score);
    expect(platinum.score).toBeLessThan(0);
  });

  it('drives WTI primarily from supply risk', () => {
    const wti = computeAssetScores(
      { usdStrength: 0, riskOff: 0, geopolitics: 0, growth: 0, supplyRisk: 7, inflation: 0 },
      strengths,
      [],
    ).find((a) => a.asset === 'WTI')!;

    expect(wti.score).toBeGreaterThan(0);
    expect(wti.contributions[0].label).toMatch(/supply/i);
  });

  it('attributes every score to labelled drivers', () => {
    const scores = computeAssetScores(
      { usdStrength: -3, riskOff: 2, geopolitics: 4, growth: 1, supplyRisk: 5, inflation: 2 },
      strengths,
      [],
    );
    for (const s of scores) {
      expect(s.contributions.length).toBeGreaterThan(0);
      for (const c of s.contributions) {
        expect(c.label).toBeTruthy();
        expect(c.contribution).toBeCloseTo(c.beta * c.input, 1);
      }
    }
  });

  it('refuses a direction when the news behind it is uncorroborated', () => {
    const clusters = clusterNews([
      makeNews({ title: 'Unverified report of missile strike', domain: 'bbc.co.uk', publishedUtc: NOW.toISOString() }),
    ]);
    const gold = computeAssetScores(
      { usdStrength: 0, riskOff: 8, geopolitics: 8, growth: 0, supplyRisk: 0, inflation: 0 },
      strengths,
      clusters,
    ).find((a) => a.asset === 'XAU')!;

    expect(gold.confidence).toBeLessThan(CONFIDENCE_FLOOR);
    expect(gold.direction).toBe('uncertain');
  });
});

describe('toDirection', () => {
  it('gates on confidence before magnitude', () => {
    expect(toDirection(8, 90)).toBe('bullish');
    expect(toDirection(8, 20)).toBe('uncertain');
    expect(toDirection(-8, 90)).toBe('bearish');
    expect(toDirection(0.1, 90)).toBe('neutral');
  });
});
