import { describe, expect, it } from 'vitest';
import { ALERT_DISPLAY_WINDOW_HOURS, isCurrentAlert } from '@/lib/alerts/rules';
import type { Alert } from '@/lib/types';

const now = new Date('2026-09-13T12:00:00Z');
const feeds = new Set(['FXStreet', 'ECB Press']);

function alert(overrides: Partial<Alert>): Alert {
  return {
    id: 'a',
    hash: 'a',
    kind: 'surprise-deviation',
    severity: 'high',
    title: 't',
    body: 'b',
    affects: [],
    sources: [],
    createdUtc: '2026-09-13T10:00:00Z',
    highConfidence: true,
    eventId: null,
    ...overrides,
  };
}

const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('isCurrentAlert', () => {
  it('keeps a recent medium-or-above alert', () => {
    expect(isCurrentAlert(alert({}), now, feeds)).toBe(true);
  });

  it('drops alerts older than the display window', () => {
    expect(isCurrentAlert(alert({ createdUtc: hoursAgo(ALERT_DISPLAY_WINDOW_HOURS + 1) }), now, feeds)).toBe(false);
    // The month-old stored alerts that read "42799m ago".
    expect(isCurrentAlert(alert({ createdUtc: hoursAgo(713) }), now, feeds)).toBe(false);
  });

  it('drops the info severity', () => {
    expect(isCurrentAlert(alert({ severity: 'info' }), now, feeds)).toBe(false);
  });

  it('drops an unparseable timestamp', () => {
    expect(isCurrentAlert(alert({ createdUtc: 'not a date' }), now, feeds)).toBe(false);
  });

  it('drops news alerts from feeds that are no longer configured', () => {
    const bbc = alert({ kind: 'geopolitical', sources: [{ name: 'BBC World', url: 'https://bbc.co.uk/x' }] });
    const mixed = alert({
      kind: 'geopolitical',
      sources: [
        { name: 'FXStreet', url: 'https://fxstreet.com/x' },
        { name: 'Al Jazeera', url: 'https://aljazeera.com/x' },
      ],
    });
    const ecb = alert({ kind: 'central-bank', sources: [{ name: 'ECB Press', url: 'https://ecb.europa.eu/x' }] });
    expect(isCurrentAlert(bbc, now, feeds)).toBe(false);
    expect(isCurrentAlert(mixed, now, feeds)).toBe(false);
    expect(isCurrentAlert(ecb, now, feeds)).toBe(true);
  });

  it('does not require sources on calendar-driven alerts', () => {
    expect(isCurrentAlert(alert({ kind: 'news-cluster', sources: [] }), now, feeds)).toBe(true);
  });
});
