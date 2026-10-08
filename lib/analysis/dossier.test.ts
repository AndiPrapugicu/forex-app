import { describe, expect, it } from 'vitest';
import { TRADINGVIEW } from '@/config/sources.config';
import { findSymbol } from '@/config/symbols.config';
import { age, buildDossier, fmtPrice, type AnalysisInputs } from '@/lib/analysis/dossier';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-10-03T09:00:00Z');

function event(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, 'name' | 'currency' | 'dateUtc'>): NormalizedEvent {
  return {
    id: `${partial.name}-${partial.dateUtc}`,
    impact: 'HIGH',
    actual: null,
    consensus: null,
    previous: null,
    revised: null,
    unit: '%',
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'test',
    ...partial,
  } as NormalizedEvent;
}

const row: SymbolRow = {
  symbol: 'EURUSD',
  label: 'EUR/USD',
  kind: 'fx',
  base: 'EUR',
  quote: 'USD',
  totalScore: -2,
  bias: 'Neutral',
  categoryScores: { technical: -3, sentiment: -2, growth: 1, inflation: 1, jobs: 1 },
  cells: {
    trend: { slotKey: 'trend', cell: -2, status: 'scored', explanation: '3-day average is below the 14-day.' },
    cpi: {
      slotKey: 'cpi',
      cell: 1,
      status: 'scored',
      explanation: '',
      legs: [
        { currency: 'EUR', seriesName: 'HICP (YoY)', actual: 3.8, reference: 3.6, referenceLabel: 'forecast', consensus: 3.6, previous: 3.2, unit: '%', sigma: null, dateUtc: '2026-10-02T09:00:00Z', cell: 1, status: 'scored' },
        { currency: 'USD', seriesName: 'CPI (YoY)', actual: 3.4, reference: 3.4, referenceLabel: 'forecast', consensus: 3.4, previous: 3.4, unit: '%', sigma: null, dateUtc: '2026-09-11T12:30:00Z', cell: 0, status: 'scored' },
      ],
    },
    employment: {
      slotKey: 'employment',
      cell: 1,
      status: 'scored',
      explanation: '',
      legs: [
        { currency: 'EUR', seriesName: null, actual: null, reference: null, referenceLabel: 'forecast', consensus: null, previous: null, unit: null, sigma: null, dateUtc: null, cell: null, status: 'no-data' },
        { currency: 'USD', seriesName: 'Nonfarm Payrolls', actual: 29, reference: 90, referenceLabel: 'forecast', consensus: 90, previous: 162, unit: 'K', sigma: null, dateUtc: '2026-10-02T12:30:00Z', cell: -1, status: 'scored' },
      ],
    },
  },
  populated: 18,
  partial: 0,
  price: 1.1257,
  changePct: 0.16,
};

function inputs(overrides: Partial<AnalysisInputs> = {}): AnalysisInputs {
  return {
    def: findSymbol('EURUSD')!,
    economies: ['EUR', 'USD'],
    now: NOW,
    row,
    indexRows: [],
    events: [
      event({ name: TRADINGVIEW.rateDecisions.publishAs, currency: 'USD', dateUtc: '2026-09-16T18:00:00Z', actual: 4, previous: 3.75 }),
      event({ name: TRADINGVIEW.rateDecisions.publishAs, currency: 'USD', dateUtc: '2026-10-28T18:00:00Z', previous: 4 }),
      event({ name: 'ISM Services PMI', currency: 'USD', dateUtc: '2026-10-05T14:00:00Z', consensus: 55.7, previous: 55.4, unit: null }),
      event({ name: 'Nonfarm Payrolls', currency: 'USD', dateUtc: '2026-10-02T12:30:00Z', actual: 29, consensus: 90, previous: 162, unit: 'K' }),
    ],
    technicals: null,
    trend: null,
    sovereignYields: new Map([['USD', { currency: 'USD', value: 4.78, observedOn: '2026-10-01', source: 'FRED' }]]),
    policyRates: new Map([['EUR', 2.5], ['USD', 4]]),
    ecoStrength: [],
    strength: [],
    surprise: [],
    positioning: [],
    retail: null,
    history: [],
    levels: null,
    news: [],
    searches: [{ query: 'ECB rate outlook euro', hits: [{ title: 'ECB seen hiking in December', source: 'Reuters', domain: 'reuters.com', url: 'u', publishedUtc: '2026-10-02T13:00:00Z' }] }],
    drivers: [{ driver: { ticker: 'TTF=F', label: 'Dutch TTF gas', channel: 'energy importer' }, last: 74.76, date: '2026-10-02', change1wPct: 3.73, change1mPct: null }],
    droppedDrivers: ['Copper (HG=F)'],
    banks: [
      { currency: 'USD', bank: 'Federal Reserve', gap: null, documents: [{ bank: 'Federal Reserve', currency: 'USD', title: 'FOMC statement', url: 'https://fed/x', publishedUtc: '2026-09-16T18:00:00Z', text: 'The Committee decided to raise the target range.' }] },
      { currency: 'EUR', bank: 'European Central Bank', gap: 'official feed unreachable: timeout', documents: [] },
    ],
    risk: null,
    health: [{ source: 'Myfxbook', ok: false, detail: 'not configured', fetchedAtUtc: NOW.toISOString() }],
    cotReportDate: '2026-09-29',
    ...overrides,
  };
}

describe('buildDossier', () => {
  const { text, summary } = buildDossier(inputs());

  it('has every section, in order', () => {
    const order = ['## 1. Board', '## 3. Rates', '## 4. Macro', '## 5. Positioning', '## 6. Price', '## 7. Levels', '## 8. Calendar', '## 9. News', '## 10. Cross-asset', '## 11. Official', '## 12. Data gaps'];
    let at = -1;
    for (const heading of order) {
      const next = text.indexOf(heading);
      expect(next, heading).toBeGreaterThan(at);
      at = next;
    }
  });

  it('never leaks undefined, NaN or float noise to the model', () => {
    expect(text).not.toMatch(/undefined|NaN|Infinity|0000000/);
  });

  it('dates the numbers it carries', () => {
    expect(text).toContain('EUR HICP (YoY): actual 3.8% vs forecast 3.6%, previous 3.2%, released 2026-10-02, leg +1');
    expect(text).toContain('last decision on the TradingView calendar 2026-09-16: hiked to 4% from 3.75%');
    expect(text).toContain('next decision 2026-10-28, consensus not published yet');
    expect(text).toContain('Differentials EUR − USD: policy -1.5pp');
  });

  it('turns an economy with no such series into one line, not a row of n/a', () => {
    expect(text).toContain('EUR: publishes no such series, so this leg is 0 by construction');
  });

  it('forbids levels when it has none, and names every gap', () => {
    expect(text).toContain('Do not name any price level.');
    expect(text).toContain('European Central Bank: GAP — official feed unreachable: timeout.');
    expect(text).toContain('Unavailable this run: Copper (HG=F).');
    expect(summary.gaps).toEqual(['Myfxbook: not configured', 'European Central Bank: official feed unreachable: timeout']);
  });

  it('carries the official text and the search hits with their age', () => {
    expect(text).toContain('### Federal Reserve — FOMC statement (2026-09-16, 17 d ago)');
    expect(text).toContain('The Committee decided to raise the target range.');
    expect(text).toContain('- [20 h ago · Reuters] ECB seen hiking in December');
  });

  it('summarises for the page cards', () => {
    expect(summary.board).toEqual({ total: -2, bias: 'Neutral', max: 34, populated: 18 });
    expect(summary.nextEvent?.name).toBe('ISM Services PMI');
    expect(summary.rates.find((r) => r.currency === 'USD')?.next?.dateUtc).toBe('2026-10-28T18:00:00Z');
  });

  it('calls a missing decision calendar unknown, not "no meeting"', () => {
    const down = buildDossier(inputs({ events: inputs().events.filter((e) => e.name !== TRADINGVIEW.rateDecisions.publishAs) }));
    expect(down.text).toContain('decision dates are UNKNOWN here — not absent');
    expect(down.text).not.toContain('no next decision on the calendar');
    expect(down.summary.decisionCalendar).toBe(false);
    expect(summary.decisionCalendar).toBe(true);
  });

  it('says so when the symbol has no board row', () => {
    expect(buildDossier(inputs({ row: null })).text).toContain('every score below is missing, not neutral');
  });
});

describe('formatting helpers', () => {
  it('formats prices by magnitude and ages relative to the clock', () => {
    expect(fmtPrice(1.1257)).toBe('1.12570');
    expect(fmtPrice(157.65)).toBe('157.650');
    expect(fmtPrice(7722.72)).toBe('7722.72');
    expect(fmtPrice(null)).toBe('n/a');
    expect(age('2026-10-03T08:25:00Z', NOW)).toBe('35 min ago');
    expect(age('2026-09-30T09:00:00Z', NOW)).toBe('3 d ago');
  });
});
