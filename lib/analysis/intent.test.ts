/**
 * The question the user actually asked on Friday 2026-10-09 at 09:12Z, from
 * Romania, about Thursday afternoon's Nasdaq fall — and the other kinds of
 * question the analyst must tell apart.
 */

import { describe, expect, it } from 'vitest';
import { parseChartReadings } from '@/lib/analysis/chart-reading';
import { describedMove, namedEvent, namedInstruments, parseQuestion, questionAnchor } from '@/lib/analysis/intent';
import { factsLines } from '@/lib/analysis/facts';

const NOW = Date.parse('2026-10-09T09:12:00Z');
const ASKED =
  'Yesterday the NASDAQ dropped around 2% in around 2 hours while at the same time the US02Y/20Y/30Y dropped as well pretty significantly, could you tell me why is that?';
const iso = (ms: number) => new Date(ms).toISOString();

describe("the user's question", () => {
  const intent = parseQuestion(ASKED, 'NAS100', NOW);

  it('is a reaction, about yesterday in Bucharest, down ~2% in ~2 hours', () => {
    expect(intent.kind).toBe('reaction');
    expect(intent.anchor?.label).toBe('yesterday, Thu 08 Oct (Europe/Bucharest)');
    expect(iso(intent.anchor!.fromMs)).toBe('2026-10-07T21:00:00.000Z');
    expect(iso(intent.anchor!.toMs)).toBe('2026-10-08T21:00:00.000Z');
    expect(intent.described).toEqual({ direction: -1, pct: 2, minutes: 120, source: 'question' });
  });

  it('names the Nasdaq first, then the 2-year and the long end', () => {
    expect(intent.instruments.map((i) => i.symbol ?? i.ticker)).toEqual(['NAS100', 'ZT=F', '^TYX']);
    expect(intent.otherSymbols).toEqual([]);
  });

  it('takes the window and the size from an attached chart when there is one', () => {
    const charts = parseChartReadings(
      ['IMAGE 1', 'SYMBOL: NDQ100', 'TIMEFRAME: 1h', 'TIMEZONE: UTC+3', "CROSSHAIR_TIME: Thu 08 Oct '26 02:00", 'MEASURE: -578.29 (-1.86%) -57,829, 2 bars, -2h'].join('\n'),
      NOW,
    );
    const withChart = parseQuestion('Why did it drop here?', 'NAS100', NOW, { charts });
    expect(withChart.anchor?.source).toBe('chart');
    expect(iso(withChart.anchor!.fromMs)).toBe('2026-10-07T21:00:00.000Z');
    expect(withChart.anchor?.label).toBe('Thu 08 Oct (from your chart, 1H, NDQ100)');
    expect(withChart.described).toEqual({ direction: -1, pct: 1.86, minutes: 120, source: 'chart' });
  });

  it('prints what it understood as section F', () => {
    const f = factsLines({ intent, charts: [], reaction: null, auctions: null, now: new Date(NOW) });
    expect(f.lines[0]).toBe('## F. QUESTION FACTS (how the server read the question; deterministic)');
    expect(f.lines).toContain('- When: yesterday, Thu 08 Oct (Europe/Bucharest) = 10-07 21:00Z to 10-08 21:00Z (from the question).');
    expect(f.summary).toBe('reaction · yesterday, Thu 08 Oct (Europe/Bucharest) · you said down ~2% in ~120 min');
  });
});

describe('kinds', () => {
  it.each([
    ['De ce a scăzut aurul azi?', 'reaction'],
    ['Gold spiked — is this a good entry for a long?', 'decision'],
    ['What should I expect from CPI on Wednesday for the Nasdaq?', 'event'],
    ['Cum reacționează aurul la NFP?', 'event'],
    ['What is a bull steepener?', 'explain'],
    ['Why does gold fall when real yields rise?', 'explain'],
    ['EURUSD vs GBPUSD, which is stronger?', 'compare'],
    ['What happened in the last 24h?', 'brief'],
    ['Give me a full analysis', 'full'],
    ['How does the Fed see inflation?', 'decision'],
  ])('%s → %s', (q, kind) => {
    expect(parseQuestion(q, 'NAS100', NOW).kind).toBe(kind);
  });

  it('lets a quick prompt decide', () => {
    expect(parseQuestion('anything', 'NAS100', NOW, { requested: 'full' }).kind).toBe('full');
    expect(parseQuestion('anything', 'NAS100', NOW, { requested: 'nonsense' }).kind).toBe('decision');
  });
});

describe('when', () => {
  const at = (q: string) => {
    const a = questionAnchor(q, NOW);
    return a && [iso(a.fromMs), iso(a.toMs)];
  };

  it('reads days, mornings, nights and clock times in the user’s zone', () => {
    expect(at('ce s-a întâmplat ieri pe aur')).toEqual(['2026-10-07T21:00:00.000Z', '2026-10-08T21:00:00.000Z']);
    expect(at('what moved this morning')).toEqual(['2026-10-09T03:00:00.000Z', '2026-10-09T09:00:00.000Z']);
    expect(at('the drop last night')).toEqual(['2026-10-08T15:00:00.000Z', '2026-10-09T05:00:00.000Z']);
    expect(at('on Monday the Nasdaq fell')).toEqual(['2026-10-04T21:00:00.000Z', '2026-10-05T21:00:00.000Z']);
    expect(at('the spike on 8 Oct')).toEqual(['2026-10-07T21:00:00.000Z', '2026-10-08T21:00:00.000Z']);
    expect(at('yesterday at 19:00 it dropped')).toEqual(['2026-10-08T14:30:00.000Z', '2026-10-08T18:30:00.000Z']);
    expect(at('at 16:00 UTC yesterday')).toEqual(['2026-10-08T14:30:00.000Z', '2026-10-08T18:30:00.000Z']);
    expect(at('in the last 3 hours')).toEqual(['2026-10-09T06:12:00.000Z', '2026-10-09T09:12:00.000Z']);
    expect(at('why did gold move')).toBeNull();
  });

  it('caps a window at now', () => {
    expect(at('azi')).toEqual(['2026-10-08T21:00:00.000Z', '2026-10-09T09:12:00.000Z']);
  });
});

describe('the parts', () => {
  it('reads a move as the user tells it', () => {
    expect(describedMove('EURUSD a scăzut 0,8% în 30 de minute')).toEqual({ direction: -1, pct: 0.8, minutes: 30, source: 'question' });
    expect(describedMove('gold spiked')).toEqual({ direction: 1, pct: null, minutes: null, source: 'question' });
    expect(describedMove('what happened in the last 24h')).toBeNull();
  });

  it('names markets by their trading names, not inside other words', () => {
    expect(namedInstruments('aurul și petrolul, plus US10Y și DXY').map((i) => i.symbol ?? i.ticker)).toEqual(['XAUUSD', 'WTIUSD', '^TNX', 'DXY']);
    expect(namedInstruments('EUR/USD vs cable')).toEqual([
      { label: 'EURUSD', symbol: 'EURUSD' },
      { label: 'GBPUSD', symbol: 'GBPUSD' },
    ]);
    expect(namedInstruments('US30 and the US30Y').map((i) => i.symbol ?? i.ticker)).toEqual(['US30', '^TYX']);
    expect(namedInstruments('this is a goldmine of information')).toEqual([]);
  });

  it('names an event, US by default and moved by a country word', () => {
    expect(namedEvent('what does CPI do to gold')).toMatchObject({ key: 'cpi', currency: 'USD' });
    expect(namedEvent('euro area inflation data next week')).toMatchObject({ key: 'cpi', currency: 'EUR' });
    expect(namedEvent('how will the market react to payrolls')).toMatchObject({ key: 'nfp' });
    expect(namedEvent('nothing here')).toBeNull();
  });
});
