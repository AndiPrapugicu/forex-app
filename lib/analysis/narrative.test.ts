/**
 * The user's own week (2026-09-28 → 10-03), as a fixture:
 *   - Fed officials say they don't want more hikes, and the fed funds strip
 *     prices hikes out;
 *   - Friday's payrolls, unemployment rate and average hourly earnings all go
 *     against USD;
 *   - Brent rallies on a Middle East escalation; France has a budget fight.
 */

import { describe, expect, it } from 'vitest';
import { findSymbol } from '@/config/symbols.config';
import { contractChain } from '@/lib/connectors/fed-futures';
import type { DatedObservation } from '@/lib/connectors/yields';
import { buildMarketState, labourBundle, MARKET, scoreReleases, type NarrativeInputs } from '@/lib/analysis/themes';
import { buildPairNarrative, effectsOf, verdictOf } from '@/lib/analysis/state';
import { narrativeLines } from '@/lib/analysis/narrative-text';
import type { Headline } from '@/lib/analysis/headlines';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-10-03T12:00:00Z');

function ev(p: Partial<NormalizedEvent> & Pick<NormalizedEvent, 'id' | 'name' | 'currency' | 'dateUtc'>): NormalizedEvent {
  return {
    countryCode: p.currency === 'USD' ? 'US' : p.currency === 'EUR' ? 'EMU' : null,
    impact: 'HIGH',
    actual: null,
    consensus: null,
    previous: null,
    revised: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fixture',
    actualSource: null,
    ...p,
  };
}

const series = (points: [string, number][]): DatedObservation[] => points.map(([date, value]) => ({ date, value }));

const events: NormalizedEvent[] = [
  // Friday's payrolls: all three against USD. UR ABOVE forecast is the USD-negative side.
  ev({ id: 'nfp', name: 'Nonfarm Payrolls', currency: 'USD', dateUtc: '2026-10-02T12:30:00Z', actual: 22, consensus: 110, previous: 142, unit: 'K' }),
  ev({ id: 'ur', name: 'Unemployment Rate', currency: 'USD', dateUtc: '2026-10-02T12:30:00Z', actual: 4.5, consensus: 4.3, previous: 4.3, unit: '%' }),
  ev({ id: 'ahe', name: 'Average Hourly Earnings (MoM)', currency: 'USD', dateUtc: '2026-10-02T12:30:00Z', actual: 0.1, consensus: 0.3, previous: 0.3, unit: '%' }),
  // Euro area inflation in line.
  ev({ id: 'hicp', name: 'Harmonized Index of Consumer Prices (YoY)', currency: 'EUR', dateUtc: '2026-10-01T09:00:00Z', actual: 2.2, consensus: 2.2, previous: 2.1, unit: '%' }),
  // Next week's US CPI: the flip.
  ev({ id: 'cpi', name: 'Consumer Price Index (MoM)', currency: 'USD', dateUtc: '2026-10-14T12:30:00Z', consensus: 0.3, previous: 0.4, unit: '%' }),
];

// Fed funds: hikes priced out over the week (implied rates fall ~10bp), still above EFFR six months out.
const contracts = contractChain(NOW, 8).map((c, k) => ({
  ...c,
  closes: series([
    ['2026-09-03', 95.95 - k * 0.07],
    ['2026-09-26', 95.92 - k * 0.07],
    ['2026-10-02', 96.03 - k * 0.07],
  ]),
}));

const headlines: Headline[] = [
  { title: "Fed's Waller says no further rate hikes needed", url: 'https://reuters.com/1', domain: 'reuters.com', publishedUtc: '2026-09-30T14:00:00Z' },
  { title: "Fed's Daly doesn't see more hikes this year", url: 'https://bloomberg.com/2', domain: 'bloomberg.com', publishedUtc: '2026-10-01T16:00:00Z' },
  { title: 'Iran fires missiles at tanker near Strait of Hormuz', url: 'https://reuters.com/3', domain: 'reuters.com', publishedUtc: '2026-10-02T08:00:00Z' },
  { title: 'Missiles hit tanker in Hormuz as Iran escalates', url: 'https://ft.com/4', domain: 'ft.com', publishedUtc: '2026-10-02T09:00:00Z' },
  { title: 'Iran strikes shipping in the Gulf, oil jumps', url: 'https://cnbc.com/5', domain: 'cnbc.com', publishedUtc: '2026-10-02T10:00:00Z' },
  { title: 'French government faces no-confidence vote over budget', url: 'https://ft.com/6', domain: 'ft.com', publishedUtc: '2026-10-01T07:00:00Z' },
];

const inputs: NarrativeInputs = {
  events,
  policyRates: new Map([
    ['USD', 3.875],
    ['EUR', 2.0],
  ]),
  twoYear: new Map([['EUR', { currency: 'EUR', value: 3.11, observedOn: '2026-10-01', source: 'ECB Data Portal' }]]),
  twoYearHistory: {
    EUR: series([
      ['2026-09-03', 2.9],
      ['2026-09-25', 3.1],
      ['2026-10-01', 3.11],
    ]),
  },
  fed: { effr: series([['2026-10-01', 3.88]]), contracts },
  series: {
    [MARKET.brent]: series([
      ['2026-09-03', 91.6],
      ['2026-09-26', 97.0],
      ['2026-10-02', 102.25],
    ]),
    [MARKET.brentFar]: series([['2026-10-02', 93.78]]),
    [MARKET.gas]: series([
      ['2026-09-03', 40],
      ['2026-09-26', 41],
      ['2026-10-02', 42],
    ]),
    [MARKET.vix]: series([
      ['2026-09-03', 15],
      ['2026-09-26', 16],
      ['2026-10-02', 19],
    ]),
    [MARKET.spx]: series([
      ['2026-09-03', 6500],
      ['2026-09-26', 6600],
      ['2026-10-02', 6540],
    ]),
    [MARKET.dxy]: series([
      ['2026-09-03', 100],
      ['2026-09-26', 100.2],
      ['2026-10-02', 99.0],
    ]),
  },
  headlines,
  headlinesAvailable: true,
  ecoStrength: [],
};

const state = buildMarketState(inputs, NOW);
const usd = state.subjects.USD!;
const eur = state.subjects.EUR!;
const theme = (s: typeof usd, id: string) => s.themes.find((t) => t.id === id)!;

describe("the user's week, read deterministically", () => {
  it('reads Friday as a payrolls bundle: USD labour strongly cooling', () => {
    const labour = theme(usd, 'labour');
    expect(labour.tactical).toBe(-2);
    expect(labour.state).toContain('cooling');
    expect(labour.notes.join(' ')).toContain('3 of 3 prints missed for USD, none against');
  });

  it('reads the hike pricing-out as a sharp dovish repricing, with the speakers as evidence only', () => {
    const policy = theme(usd, 'policy');
    expect(policy.tactical).toBe(-2);
    expect(policy.state).toContain('dovish repricing');
    expect(policy.evidence[0].text).toMatch(/ZQF27\.CBT/);
    expect(policy.notes.join(' ')).toMatch(/Speakers lean dovish .* consistent with pricing/);
  });

  it('flags the oil rally as inflation pressure, and as a headwind for the euro', () => {
    expect(theme(usd, 'inflation').notes.join(' ')).toContain('headline inflation pressure');
    const energy = theme(eur, 'energy');
    expect(energy.tactical).toBe(-1);
    expect(energy.structural).toBe(-2);
    expect(energy.state).toContain('headwind');
    expect(theme(usd, 'energy').tactical).toBe(0);
  });

  it('reads the Middle East escalation as risk-off, which a haven gains from', () => {
    expect(theme(usd, 'risk').tactical).toBeGreaterThan(0);
    expect(theme(eur, 'risk').tactical).toBe(0);
    expect(theme(state.subjects.JPY!, 'risk').tactical).toBeGreaterThan(0);
    expect(theme(state.subjects.AUD!, 'risk').tactical).toBeLessThan(0);
  });

  it('counts the French budget fight against EUR', () => {
    expect(theme(eur, 'fiscal').tactical).toBe(-1);
  });

  it('calls EURUSD tactically BULLISH, with its count', () => {
    const pair = buildPairNarrative(findSymbol('EURUSD')!, state, inputs)!;
    expect(pair.tactical.label).toBe('BULLISH');
    expect(pair.tactical.text).toMatch(/^BULLISH — 2 of \d themes for incl\. rates ×2, \d against$/);
  });

  it('lists next week\'s US CPI as the flip, on the polarity-correct side', () => {
    const pair = buildPairNarrative(findSymbol('EURUSD')!, state, inputs)!;
    const hot = pair.flips.find((f) => f.id === 'cal:cpi:up')!;
    const cool = pair.flips.find((f) => f.id === 'cal:cpi:down')!;
    // A hot US CPI is USD-bullish, so EURUSD-bearish: against the verdict.
    expect(hot).toMatchObject({ favours: 'bearish', role: 'flip', check: { type: 'release', eventId: 'cpi', op: '>=', threshold: 0.5 } });
    expect(cool).toMatchObject({ favours: 'bullish', role: 'confirm', check: { op: '<=', threshold: 0.1 } });
    // Flips come before confirmations.
    expect(pair.flips[0].role).toBe('flip');
  });

  it('gives the Fed path back as a market flip, in futures-price terms', () => {
    const pair = buildPairNarrative(findSymbol('EURUSD')!, state, inputs)!;
    const back = pair.flips.find((f) => f.id === 'fed:ZQF27.CBT:up')!;
    expect(back.favours).toBe('bearish');
    // Back to last week's implied 4.29% ⇔ the contract at or below 95.71.
    expect(back.check).toEqual({ type: 'close', key: 'ZQF27.CBT', op: '<=', threshold: 95.71 });
  });

  it('reads gold as supported by the dovish Fed and the weaker dollar', () => {
    const gold = buildPairNarrative(findSymbol('XAUUSD')!, state, inputs)!;
    expect(gold.themes.map((t) => t.id)).toEqual(['real-yields', 'dollar', 'risk']);
    expect(gold.themes.find((t) => t.id === 'dollar')!.tactical).toBe(1);
    expect(gold.themes.find((t) => t.id === 'real-yields')!.tactical).toBeNull();
  });

  it('reads oil off the curve and the supply story', () => {
    const oil = state.subjects.oil!;
    expect(theme(oil, 'curve').structural).toBe(2);
    expect(theme(oil, 'supply').tactical).toBe(2);
  });
});

describe('what changed this week', () => {
  it('rewinds the dated themes and refuses to compare the headline ones', () => {
    const past = buildMarketState(inputs, new Date(NOW.getTime() - 7 * 86_400_000));
    const pair = buildPairNarrative(findSymbol('EURUSD')!, state, inputs, { past: { effects: effectsOf(past), basis: 'rewound to 2026-09-26', rewound: true } })!;
    expect(pair.changes[0]).toEqual({ theme: 'verdict', text: 'Tactical verdict NEUTRAL → BULLISH' });
    expect(pair.changes.some((c) => c.theme === 'labour')).toBe(true);
    expect(pair.changeBasis).toContain('not compared');
    expect(pair.changeBasis).toContain('Risk & geopolitics');
  });
});

describe('verdict hysteresis', () => {
  const items = (sum: number) => [
    { weight: 2, effect: sum >= 0 ? 1 : -1 },
    { weight: 1, effect: sum - (sum >= 0 ? 2 : -2) },
  ];

  it('enters at 3 and stays down to 2', () => {
    expect(verdictOf(items(3)).label).toBe('BULLISH');
    expect(verdictOf(items(2)).label).toBe('NEUTRAL');
    expect(verdictOf(items(2), 'BULLISH').label).toBe('BULLISH');
    expect(verdictOf(items(1), 'BULLISH').label).toBe('NEUTRAL');
  });

  it('will not let one theme carry a verdict, rates included', () => {
    expect(verdictOf([{ weight: 1, effect: 4 }]).label).toBe('NEUTRAL');
    expect(verdictOf([{ weight: 2, effect: 2 }, { weight: 1, effect: 0 }]).label).toBe('NEUTRAL');
  });

  it('lets two agreeing themes carry it (live EURUSD, 2026-10-03: labour +2, inflation +4)', () => {
    expect(verdictOf([{ weight: 1, effect: 2 }, { weight: 1, effect: 4 }, { weight: 2, effect: 0 }]).label).toBe('BULLISH');
  });
});

describe('labourBundle', () => {
  it('needs two of three on one day', () => {
    const one = scoreReleases([events[0]], 'USD', ['nfp', 'unemployment-rate', 'wages'], NOW, { days: 35, halfLifeDays: 14 });
    expect(labourBundle(one.releases)).toBeNull();
    const all = scoreReleases(events, 'USD', ['nfp', 'unemployment-rate', 'wages'], NOW, { days: 35, halfLifeDays: 14 });
    expect(labourBundle(all.releases)).toMatchObject({ direction: -1, strength: 2, aligned: 3, of: 3, date: '2026-10-02' });
  });
});

describe('the dossier section', () => {
  it('prints the verdicts, every theme with both legs, the flips with thresholds, and the Fed path', () => {
    const pair = buildPairNarrative(findSymbol('EURUSD')!, state, inputs)!;
    const text = narrativeLines(pair, state).join('\n');
    expect(text).toMatch(/^## 0\. MARKET STATE \(deterministic, computed 2026-10-03T12:00Z/);
    expect(text).toContain('Tactical verdict for EURUSD: BULLISH');
    expect(text).toContain('- Labour: tactical +2');
    expect(text).toContain('    USD: strongly cooling (tactical −2, structural');
    expect(text).toContain('[FLIP → bearish] USD Consumer Price Index (MoM) (2026-10-14 12:30Z) at or above 0.5%');
    expect(text).toContain('Fed path (CBOT 30-day fed funds');
    expect(text).not.toMatch(/undefined|NaN/);
  });
});
