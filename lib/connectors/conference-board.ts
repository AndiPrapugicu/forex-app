/**
 * The Conference Board Consumer Confidence Index.
 *
 * This exists for one reason: it is the only series A1 scores that NEITHER of
 * our calendars carries. FXStreet schedules the release every month and
 * publishes actual, forecast and previous as null on every occurrence;
 * ForexFactory's own JSON feed has no `actual` key in its schema at all. Without
 * this the column falls back to the Michigan survey, which is a different index
 * on a different scale (~90 versus ~55) polling a different panel.
 *
 * WHICH CONSENSUS, AND WHY IT MATTERS. The actual is uncontroversial — every
 * source agrees July 2026 printed 90.8. The FORECAST is not, and it decides the
 * sign:
 *
 *   ForexFactory   92.4  -> miss   (what A1 shows on their card)
 *   TradingView    92.3  -> miss   (what we use)
 *   MQL5           89.5  -> BEAT   (the opposite reading)
 *
 * A first attempt used MQL5's CSV export and scored this a beat, disagreeing
 * with A1 by two points on every USD pair. TradingView's calendar carries the
 * same consensus ForexFactory publishes, to a rounding difference that cannot
 * change a ternary. So the source choice here is not cosmetic — it is the whole
 * cell.
 *
 * The endpoint is TradingView's own calendar widget API: keyless, JSON, and it
 * accepts a date range. Undocumented, like FXStreet and Yahoo, and treated the
 * same way — it degrades to Michigan rather than taking the page down.
 */

import { fetchJson, stableId, fixturesEnabled } from '@/lib/connectors/base';
import { ok, type NormalizedEvent, type Result } from '@/lib/types';

const TRADINGVIEW = {
  name: 'TradingView (Conference Board)',
  base: 'https://economic-calendar.tradingview.com/events',
  /** Their widget sends this; without it the endpoint can reject the request. */
  headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.tradingview.com' },
  /** Monthly series — nothing is gained by polling it harder. */
  cacheTtlSeconds: 12 * 3600,
  /** Matches the FXStreet history window, so staleness rules line up. */
  lookbackDays: 150,
} as const;

/**
 * The name we publish under.
 *
 * Deliberately "Consumer Confidence" — the exact string the consumer-confidence
 * slot already prefers ahead of Michigan in `config/setups.config.ts`. That
 * makes this a drop-in: no matcher change, and if FXStreet ever populates its
 * own rows this connector simply stops being needed.
 */
export const CONFERENCE_BOARD_EVENT_NAME = 'Consumer Confidence';

/** Their title for the series. */
const TRADINGVIEW_TITLE = 'CB Consumer Confidence';

interface TvEvent {
  title?: string;
  date?: string;
  actual?: number | null;
  forecast?: number | null;
  previous?: number | null;
}

/**
 * Maps TradingView's calendar rows onto our event shape.
 *
 * Exported for the tests: the parsing is where a schema change would bite, and
 * it is worth pinning without a network call.
 */
export function toConferenceBoardEvents(rows: TvEvent[]): NormalizedEvent[] {
  return rows
    .filter((e) => (e.title ?? '') === TRADINGVIEW_TITLE && typeof e.actual === 'number' && e.date)
    .map((e) => ({
      id: stableId('tradingview', 'cb-consumer-confidence', e.date as string),
      seriesId: 'tradingview:cb-consumer-confidence',
      name: CONFERENCE_BOARD_EVENT_NAME,
      currency: 'USD' as const,
      countryCode: 'US',
      dateUtc: new Date(e.date as string).toISOString(),
      impact: 'MEDIUM' as const,
      actual: e.actual ?? null,
      consensus: e.forecast ?? null,
      previous: e.previous ?? null,
      revised: null,
      unit: null,
      ratioDeviation: null,
      isBetterThanExpected: null,
      isSpeech: false,
      isPreliminary: false,
      source: 'tradingview' as const,
      actualSource: 'tradingview' as const,
      sourceUrl: 'https://www.tradingview.com/economic-calendar/',
      lastUpdated: null,
    }))
    .sort((a, b) => b.dateUtc.localeCompare(a.dateUtc));
}

/**
 * Recent Conference Board releases as calendar events.
 *
 * Never fails hard: on any error this returns an empty list and the column falls
 * back to Michigan exactly as before. One supplementary source must not be able
 * to take the scorecard down.
 */
export async function fetchConferenceBoard(now = new Date()): Promise<Result<NormalizedEvent[]>> {
  if (fixturesEnabled()) {
    const fixture = (await import('@/fixtures/sample-conference-board.json')).default as NormalizedEvent[];
    return ok('conference-board:fixture', fixture);
  }

  const from = new Date(now.getTime() - TRADINGVIEW.lookbackDays * 86_400_000);
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: now.toISOString(),
    countries: 'US',
  });

  const res = await fetchJson<{ status?: string; result?: TvEvent[] }>(
    TRADINGVIEW.name,
    `${TRADINGVIEW.base}?${params}`,
    {
      headers: { ...TRADINGVIEW.headers },
      cacheTtlSeconds: TRADINGVIEW.cacheTtlSeconds,
      cacheKey: 'tradingview:conference-board',
      timeoutMs: 20_000,
    },
  );

  if (!res.ok) {
    return ok(TRADINGVIEW.name, [], `unavailable — consumer confidence falls back to Michigan (${res.error})`);
  }

  const events = toConferenceBoardEvents(res.data.result ?? []);

  return ok(
    TRADINGVIEW.name,
    events,
    events.length === 0 ? 'no Conference Board releases parsed' : undefined,
  );
}
