/**
 * Alert engine tests.
 *
 * Alerts are the only thing in this app that interrupts the user, so the rules
 * that decide NOT to fire matter as much as the ones that do.
 */

import { describe, expect, it } from 'vitest';
import {
  currencyClusterAlerts,
  evaluateAlerts,
  newsAlerts,
  surpriseAlerts,
  upcomingEventAlerts,
} from '@/lib/alerts/rules';
import { formatAlert } from '@/lib/alerts/telegram';
import { clusterNews } from '@/lib/scoring/news';
import { scoreEvent } from '@/lib/scoring/surprise';
import type { NewsItem, NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-08T12:00:00Z');

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'e1',
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
    sourceUrl: 'https://www.fxstreet.com/economic-calendar',
    lastUpdated: null,
    ...overrides,
  };
}

function makeNews(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Headline',
    url: 'https://example.com/a',
    domain: 'example.com',
    sourceName: 'Example',
    publishedUtc: NOW.toISOString(),
    summary: null,
    category: 'geopolitics',
    matchedKeywords: [],
    affects: [],
    ...overrides,
  };
}

function scoreOf(e: NormalizedEvent) {
  return { event: e, score: scoreEvent(e, NOW) };
}

describe('surpriseAlerts', () => {
  it('fires on a large miss against forecast', () => {
    const alerts = surpriseAlerts(
      [scoreOf(makeEvent({ actual: -23, consensus: 80, ratioDeviation: -2.0, actualSource: 'fxstreet' }))],
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/Nonfarm Payrolls/);
  });

  it('does NOT fire when there is no forecast to be surprised against', () => {
    // Regression: the Ivey PMI case observed live — 54.1 with no consensus was
    // alerting as "-1.5σ surprise vs n/a forecast", which is meaningless.
    const event = makeEvent({
      name: 'Ivey Purchasing Managers Index',
      currency: 'CAD',
      actual: 54.1,
      consensus: null,
      previous: 59.7,
      impact: 'MEDIUM',
      actualSource: 'fxstreet',
    });

    // The engine still scores it off `previous`...
    expect(scoreEvent(event, NOW).surprise).not.toBeNull();
    // ...but it must not interrupt the user.
    expect(surpriseAlerts([scoreOf(event)], NOW)).toHaveLength(0);
  });

  it('ignores small deviations', () => {
    const alerts = surpriseAlerts(
      [scoreOf(makeEvent({ actual: 82, consensus: 80, ratioDeviation: 0.2, actualSource: 'fxstreet' }))],
      NOW,
    );
    expect(alerts).toHaveLength(0);
  });

  it('ignores low-impact releases however far off forecast', () => {
    const alerts = surpriseAlerts(
      [scoreOf(makeEvent({ impact: 'LOW', actual: -23, consensus: 80, ratioDeviation: -3, actualSource: 'fxstreet' }))],
      NOW,
    );
    expect(alerts).toHaveLength(0);
  });

  it('keeps the hash stable across repeated runs so the cron cannot re-send', () => {
    const event = makeEvent({ actual: -23, consensus: 80, ratioDeviation: -2, actualSource: 'fxstreet' });
    const first = surpriseAlerts([scoreOf(event)], NOW)[0];
    const later = surpriseAlerts([scoreOf(event)], new Date('2026-08-08T12:40:00Z'))[0];
    expect(first.hash).toBe(later.hash);
  });

  it('changes the hash when the value is revised, so a revision does re-alert', () => {
    const a = surpriseAlerts(
      [scoreOf(makeEvent({ actual: -23, consensus: 80, ratioDeviation: -2, actualSource: 'fxstreet' }))],
      NOW,
    )[0];
    const b = surpriseAlerts(
      [scoreOf(makeEvent({ actual: -45, consensus: 80, ratioDeviation: -2.5, actualSource: 'fxstreet' }))],
      NOW,
    )[0];
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('upcomingEventAlerts', () => {
  it('fires for a high-impact release inside the window', () => {
    const alerts = upcomingEventAlerts(
      [makeEvent({ dateUtc: '2026-08-08T12:20:00Z', consensus: 80, previous: 57 })],
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/in 20m/);
  });

  it('ignores releases outside the window and lower-impact ones', () => {
    expect(
      upcomingEventAlerts([makeEvent({ dateUtc: '2026-08-08T18:00:00Z' })], NOW),
    ).toHaveLength(0);
    expect(
      upcomingEventAlerts([makeEvent({ dateUtc: '2026-08-08T12:20:00Z', impact: 'LOW' })], NOW),
    ).toHaveLength(0);
  });

  it('keeps a stable hash as the countdown ticks down', () => {
    const event = makeEvent({ dateUtc: '2026-08-08T12:25:00Z' });
    const a = upcomingEventAlerts([event], NOW)[0];
    const b = upcomingEventAlerts([event], new Date('2026-08-08T12:05:00Z'))[0];
    // Titles differ (25m vs 20m) but the alert is the same event — it must not
    // re-send on every cron pass.
    expect(a.title).not.toBe(b.title);
    expect(a.hash).toBe(b.hash);
  });
});

describe('newsAlerts', () => {
  it('caps an uncorroborated story at medium and says so plainly', () => {
    const alerts = newsAlerts(
      clusterNews([makeNews({ title: 'Invasion reported across the border', domain: 'bbc.co.uk' })]),
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('medium');
    expect(alerts[0].highConfidence).toBe(false);
    expect(alerts[0].body).toMatch(/SINGLE UNVERIFIED SOURCE/);
  });

  it('escalates to critical only once independent outlets corroborate', () => {
    const alerts = newsAlerts(
      clusterNews([
        makeNews({ title: 'Invasion reported across the border', domain: 'bbc.co.uk', sourceName: 'BBC' }),
        makeNews({ title: 'Invasion reported across the border', domain: 'reuters.com', sourceName: 'Reuters' }),
        makeNews({ title: 'Invasion reported across the border', domain: 'aljazeera.com', sourceName: 'Al Jazeera' }),
      ]),
      NOW,
    );
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].highConfidence).toBe(true);
    expect(alerts[0].body).toMatch(/3 independent sources/);
  });

  it('always carries source links', () => {
    const alerts = newsAlerts(
      clusterNews([makeNews({ title: 'Sanctions imposed on energy exports', url: 'https://bbc.co.uk/x' })]),
      NOW,
    );
    expect(alerts[0].sources.length).toBeGreaterThan(0);
    expect(alerts[0].sources[0].url).toBeTruthy();
  });

  it('ignores stale stories', () => {
    const alerts = newsAlerts(
      clusterNews([makeNews({ title: 'Invasion reported', publishedUtc: '2026-08-01T00:00:00Z' })]),
      NOW,
    );
    expect(alerts).toHaveLength(0);
  });

  it('ignores ordinary headlines with no risk language', () => {
    expect(newsAlerts(clusterNews([makeNews({ title: 'Company announces quarterly results' })]), NOW)).toHaveLength(0);
  });
});

describe('currencyClusterAlerts', () => {
  const strong = (id: string, name: string) =>
    scoreOf(makeEvent({ id, name, actual: 200, consensus: 80, ratioDeviation: 2, actualSource: 'fxstreet' }));

  it('fires when several aligned releases hit one currency', () => {
    const alerts = currencyClusterAlerts(
      [strong('a', 'Nonfarm Payrolls'), strong('b', 'ISM Manufacturing PMI'), strong('c', 'Retail Sales (MoM)')],
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/USD/);
  });

  it('stays quiet when the releases conflict', () => {
    const mixed = [
      strong('a', 'Nonfarm Payrolls'),
      scoreOf(makeEvent({ id: 'b', name: 'ISM Manufacturing PMI', actual: 40, consensus: 80, ratioDeviation: -2, actualSource: 'fxstreet' })),
      scoreOf(makeEvent({ id: 'c', name: 'Retail Sales (MoM)', actual: 40, consensus: 80, ratioDeviation: -2, actualSource: 'fxstreet' })),
    ];
    // Two down, one up — no direction has the required 3 aligned.
    expect(currencyClusterAlerts(mixed, NOW)).toHaveLength(0);
  });
});

describe('evaluateAlerts', () => {
  it('orders most severe first and dedupes within a run', () => {
    const event = makeEvent({ actual: -23, consensus: 80, ratioDeviation: -3, actualSource: 'fxstreet' });
    const alerts = evaluateAlerts({
      events: [event],
      scored: [scoreOf(event)],
      clusters: clusterNews([
        makeNews({ title: 'Invasion reported', domain: 'bbc.co.uk' }),
        makeNews({ title: 'Invasion reported', domain: 'reuters.com' }),
        makeNews({ title: 'Invasion reported', domain: 'aljazeera.com' }),
      ]),
      now: NOW,
    });

    const order = { critical: 0, high: 1, medium: 2, info: 3 };
    for (let i = 1; i < alerts.length; i++) {
      expect(order[alerts[i].severity]).toBeGreaterThanOrEqual(order[alerts[i - 1].severity]);
    }
    expect(new Set(alerts.map((a) => a.hash)).size).toBe(alerts.length);
  });
});

describe('formatAlert', () => {
  it('escapes markup so a headline cannot break the message', () => {
    const out = formatAlert({
      id: 'x',
      hash: 'x',
      kind: 'geopolitical',
      severity: 'high',
      title: 'Report <b>claims</b> & alleges',
      body: 'Body & text',
      affects: ['USD'],
      sources: [{ name: 'BBC', url: 'https://bbc.co.uk/a?x=1&y=2' }],
      createdUtc: NOW.toISOString(),
      highConfidence: true,
      eventId: null,
    });

    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('&amp;');
    // The bold wrapper we add ourselves must survive.
    expect(out).toMatch(/<b>.*<\/b>/);
  });

  it('marks uncorroborated alerts in the message body', () => {
    const out = formatAlert({
      id: 'x', hash: 'x', kind: 'geopolitical', severity: 'medium',
      title: 'Single report', body: 'One outlet only',
      affects: [], sources: [], createdUtc: NOW.toISOString(),
      highConfidence: false, eventId: null,
    });
    expect(out).toMatch(/Not corroborated/);
  });
});
