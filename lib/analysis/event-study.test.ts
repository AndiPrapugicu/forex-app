import { describe, expect, it } from 'vitest';
import { EVENT_ALIASES } from '@/config/reaction.config';
import type { IntradaySeries } from '@/lib/connectors/intraday';
import type { NormalizedEvent } from '@/lib/types';
import { eventStudyLines, pickSeries, studyEvent } from './event-study';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-09T09:00:00Z');

function cpi(dateUtc: string, actual: number | null, consensus: number | null, name = 'Consumer Price Index (MoM)'): NormalizedEvent {
  return { id: `${name}-${dateUtc}`, name, currency: 'USD', dateUtc, impact: 'HIGH', actual, consensus, previous: 0.3, revised: null, ratioDeviation: null } as NormalizedEvent;
}

/** Hourly bars, flat at 100, with a step after each release: −1% after a hot print, +0.5% after a soft one. */
function bars(steps: { at: string; pct: number }[]): IntradaySeries {
  const t: number[] = [];
  const c: number[] = [];
  const start = Date.parse('2026-06-01T00:00:00Z');
  let level = 100;
  for (let ms = start; ms < NOW; ms += HOUR) {
    for (const s of steps) if (ms === Date.parse(s.at)) level *= 1 + s.pct / 100;
    t.push(ms);
    c.push(level);
  }
  return { ticker: 'NQ=F', t, c };
}

const EVENTS = [
  cpi('2026-07-15T12:30:00Z', 0.4, 0.3),
  cpi('2026-08-12T12:30:00Z', 0.2, 0.3),
  cpi('2026-09-11T12:30:00Z', 0.5, 0.3),
  cpi('2026-10-14T12:30:00Z', null, 0.6),
  cpi('2026-09-11T12:30:00Z', 2.9, 2.8, 'Consumer Price Index (YoY)'),
];
// The bar opening at 13:00 closes at 14:00: the first close a full hour after a 12:30 release.
const BARS = bars([
  { at: '2026-07-15T13:00:00Z', pct: -1 },
  { at: '2026-08-12T13:00:00Z', pct: 0.5 },
  { at: '2026-09-11T13:00:00Z', pct: -1 },
]);

describe('event study', () => {
  it('studies one series, the most representative one, not MoM and YoY mixed', () => {
    const cpiAlias = EVENT_ALIASES.find((e) => e.key === 'cpi')!;
    const picked = pickSeries(EVENTS, cpiAlias, 'USD')!;
    expect(picked.name).toBe('Consumer Price Index (MoM)');
    expect(picked.list).toHaveLength(4);
  });

  it('measures from the close before the release to about 1h and 4h after', () => {
    const rows = studyEvent(EVENTS.slice(0, 4), BARS, NOW);
    expect(rows.map((r) => [r.dateUtc.slice(0, 10), r.surprise, r.move1h?.toFixed(2), r.move4h?.toFixed(2)])).toEqual([
      ['2026-09-11', 1, '-1.00', '-1.00'],
      ['2026-08-12', -1, '0.50', '0.50'],
      ['2026-07-15', 1, '-1.00', '-1.00'],
    ]);
  });

  it('prints the record with its sample size and the next release', () => {
    const lines = eventStudyLines({
      label: 'CPI',
      currency: 'USD',
      seriesName: 'Consumer Price Index (MoM)',
      symbol: 'NAS100',
      ticker: 'NQ=F',
      rows: studyEvent(EVENTS.slice(0, 4), BARS, NOW),
      next: { dateUtc: '2026-10-14T12:30:00Z', consensus: 0.6, previous: 0.3 },
    });
    expect(lines).toContain('Above forecast (n=2): average 1h −1.00%, 4h −1.00%. Below forecast (n=1): average 1h +0.50%, 4h +0.50%.');
    expect(lines).toContain('Sample: 3 releases — too few to call a pattern; say "tendency" at most.');
    expect(lines.at(-1)).toBe('Next release: 2026-10-14 12:30Z, forecast 0.6, previous 0.3.');
  });
});
