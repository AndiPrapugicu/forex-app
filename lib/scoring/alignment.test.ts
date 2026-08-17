/**
 * The alignment checklist and the written brief.
 *
 * Two properties matter more than the individual checks. A missing input must
 * count as UNKNOWN rather than as a failure — otherwise a symbol with no CFTC
 * contract looks worse than one whose speculators are actively selling it. And
 * the brief must never state a number the bundle does not contain, because it is
 * the exact text handed to the model, and a fabrication there propagates.
 */

import { describe, expect, it } from 'vitest';
import { buildAlignment } from '@/lib/scoring/alignment';
import { buildSetupBrief, invalidationLevel } from '@/lib/scoring/setup-brief';
import type { CotFlow } from '@/lib/scoring/cot-flow';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { StructureView } from '@/lib/scoring/structure';

function row(totalScore: number): SymbolRow {
  return {
    symbol: 'GBPUSD',
    label: 'GBP/USD',
    kind: 'fx',
    totalScore,
    bias: totalScore >= 7 ? 'Very Bullish' : totalScore >= 4 ? 'Bullish' : 'Neutral',
    categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 },
    cells: {},
    populated: 18,
    partial: 0,
    price: 1.35,
    changePct: 0,
  };
}

function flow(direction: 'buying' | 'selling'): CotFlow {
  return {
    contract: 'BRITISH POUND',
    kind: direction === 'buying' ? 'accumulation' : 'distribution',
    strength: 'heavy',
    percentile: 85,
    sampleWeeks: 120,
    direction,
    netChange: direction === 'buying' ? 7000 : -7000,
    longChange: 0,
    shortChange: 0,
    againstPosition: false,
    flipped: false,
    oiConfirms: true,
    netAfter: 1000,
    headline: 'Heavy accumulation',
    sentence: 'x',
  };
}

/** A bullish structure with a retracement into the golden zone. */
function view(overrides: Partial<StructureView> = {}): StructureView {
  const brk = {
    direction: 'bullish' as const,
    level: 1.34,
    brokenSwing: { index: 10, timestamp: 0, price: 1.34, kind: 'high' as const },
    breakIndex: 20,
    breakTimestamp: 0,
    barsSince: 5,
    retested: true,
    reclaimed: false,
    stale: false,
  };
  return {
    price: 1.35,
    atr: 0.0075,
    atrPct: 0.55,
    swings: [],
    structure: {
      latest: brk,
      direction: 'bullish',
      previous: null,
      changeOfCharacter: false,
      breaks: [brk],
      range: null,
    },
    fib: {
      direction: 'up',
      low: 1.3,
      high: 1.4,
      lowIndex: 0,
      highIndex: 20,
      levels: [
        { ratio: 0.382, price: 1.3618 },
        { ratio: 0.5, price: 1.35 },
        { ratio: 0.618, price: 1.3382 },
        { ratio: 0.786, price: 1.3214 },
      ],
      positionRatio: 0.5,
      inGoldenZone: false,
      inDiscountZone: true,
      legComplete: true,
      invalidated: false,
    },
    zones: [],
    nearestSupport: {
      price: 1.34,
      low: 1.34,
      high: 1.34,
      sources: [
        { kind: 'bos', label: 'broken high', price: 1.34 },
        { kind: 'sma', label: 'SMA 50', price: 1.34 },
      ],
      side: 'support',
      distancePct: -0.74,
      distanceAtr: 1.3,
    },
    nearestResistance: null,
    unconfirmedBars: 3,
    ...overrides,
  };
}

const base = {
  row: row(11),
  structure: view(),
  flow: flow('buying'),
  events: [],
  cluster: null,
  minScore: 7,
};

describe('buildAlignment', () => {
  it('passes everything measurable when the evidence agrees', () => {
    const a = buildAlignment(base);

    expect(a.direction).toBe('long');
    expect(a.failures).toHaveLength(0);
    expect(a.passed).toBe(a.applicable);
  });

  it('treats a MISSING input as unknown, never as a failure', () => {
    /**
     * The distinction the whole denominator rests on. A symbol with no CFTC
     * contract has nothing to say about COT; scoring that as a failed check
     * would rank it below a symbol whose speculators are actively selling it.
     */
    const a = buildAlignment({ ...base, flow: null, cluster: null });
    const cot = a.checks.find((c) => c.key === 'cot')!;

    expect(cot.passed).toBeNull();
    expect(a.failures.map((f) => f.key)).not.toContain('cot');
    expect(a.applicable).toBeLessThan(a.checks.length);
  });

  it('fails the COT check when specs traded the other way', () => {
    const a = buildAlignment({ ...base, flow: flow('selling') });
    expect(a.failures.map((f) => f.key)).toContain('cot');
  });

  it('fails structure when the break runs against the score', () => {
    const bearish = view();
    bearish.structure.latest!.direction = 'bearish';
    bearish.structure.direction = 'bearish';

    expect(buildAlignment({ ...base, structure: bearish }).failures.map((f) => f.key)).toContain(
      'structure',
    );
  });

  it('fails structure in a range — no break is not agreement', () => {
    const ranging = view({
      structure: {
        latest: null,
        direction: null,
        previous: null,
        changeOfCharacter: false,
        breaks: [],
        range: { high: 1.36, low: 1.31, bars: 60 },
      },
      fib: null,
    });

    const a = buildAlignment({ ...base, structure: ranging });
    expect(a.failures.map((f) => f.key)).toContain('structure');
    // But the retracement check has nothing to say, rather than saying no.
    expect(a.checks.find((c) => c.key === 'location')!.passed).toBeNull();
  });

  it('reads a short setup against the mirrored conditions', () => {
    const a = buildAlignment({ ...base, row: row(-11), flow: flow('selling') });

    expect(a.direction).toBe('short');
    expect(a.checks.find((c) => c.key === 'cot')!.passed).toBe(true);
    // A bullish break disagrees with a short.
    expect(a.failures.map((f) => f.key)).toContain('structure');
  });

  it('counts an imminent high-impact release as a real objection', () => {
    const a = buildAlignment({
      ...base,
      events: [
        {
          name: 'Consumer Price Index (YoY)',
          currency: 'USD',
          dateUtc: '2026-08-12T12:30:00.000Z',
          hoursAway: 47.6,
          impact: 'HIGH',
        },
      ],
    });

    const events = a.checks.find((c) => c.key === 'events')!;
    expect(events.passed).toBe(false);
    expect(events.detail).toContain('47.6h');
  });
});

describe('buildSetupBrief', () => {
  const bundle = {
    symbol: 'GBPUSD',
    label: 'GBP/USD',
    row: row(11),
    view: view(),
    alignment: buildAlignment(base),
    timeframe: '1d' as const,
    structureTimeframe: '1d' as const,
  };

  it('states the score, the break and the level, and nothing else numeric', () => {
    const text = buildSetupBrief(bundle);

    expect(text).toContain('+11');
    expect(text).toContain('1.34000'); // the broken level
    expect(text).toContain('Very Bullish');

    /**
     * Every number in the brief must come from the bundle — this text is handed
     * verbatim to the model, so a fabrication here would be laundered into
     * something that looks sourced.
     */
    const allowed = new Set([
      '11', '18', // score and populated columns
      '1.34000', '1.30000', '1.40000', '1.33820', // broken level, impulse anchors, 0.618
      '50', '20', '1.3', '5', // % retraced, bars since, ATR distance, checks
      '0.5', '0.786', '0.618', // fib ratios, named in the pocket description
      '3', '6', // checks agreeing / applicable
    ]);
    for (const n of text.match(/\d+\.\d+|\d+/g) ?? []) {
      expect(allowed.has(n), `unexpected number ${n} in brief`).toBe(true);
    }
  });

  it('says plainly that there is nothing to check against without price history', () => {
    const text = buildSetupBrief({ ...bundle, view: null });
    expect(text).toContain('not enough price history');
  });

  it('names the objections rather than only counting them', () => {
    const withEvent = buildAlignment({
      ...base,
      events: [
        {
          name: 'Nonfarm Payrolls',
          currency: 'USD',
          dateUtc: '2026-08-12T12:30:00.000Z',
          hoursAway: 12,
          impact: 'HIGH',
        },
      ],
    });

    expect(buildSetupBrief({ ...bundle, alignment: withEvent })).toContain('nonfarm payrolls');
  });
});

describe('invalidationLevel', () => {
  it('is the broken level when structure supports the trade', () => {
    expect(invalidationLevel(view(), 'long')!.price).toBe(1.34);
  });

  it('falls back to the range floor for a long with no break', () => {
    const ranging = view({
      structure: {
        latest: null,
        direction: null,
        previous: null,
        changeOfCharacter: false,
        breaks: [],
        range: { high: 1.36, low: 1.31, bars: 60 },
      },
    });

    expect(invalidationLevel(ranging, 'long')!.price).toBe(1.31);
    expect(invalidationLevel(ranging, 'short')!.price).toBe(1.36);
  });

  it('offers no level rather than a guessed one when there is neither', () => {
    expect(invalidationLevel(null, 'long')).toBeNull();
  });
});
