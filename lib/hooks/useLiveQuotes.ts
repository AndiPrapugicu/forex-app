'use client';

/**
 * The latest price for one symbol or for fifty — streamed where that is
 * possible, polled everywhere else, and always polled underneath.
 *
 * STREAMING ON TOP OF POLLING, NOT INSTEAD OF IT. Yahoo's socket is
 * undocumented and protobuf-framed and may change shape without notice, so it
 * is wired as an accelerator over a transport that already worked: the poll
 * keeps running, and every way the socket can fail — refused, dropped,
 * half-open, or a market simply not trading — lands back on exactly the polling
 * behaviour that shipped before it. `lib/live/streams.ts` holds the socket and
 * the reasoning about which symbols it can actually serve.
 *
 * WHAT EACH TRANSPORT OWNS. The stream carries a price and a stamp and nothing
 * else, so the previous close, the day's range and therefore the percentage
 * change still come from the poll. A tick updates the price, restamps the
 * quote, and recomputes the change against the polled previous close — so the
 * number and the percentage beside it can never disagree.
 *
 * ONE LOOP FOR BOTH SHAPES. This started as a single-symbol hook for the chart;
 * every other page wants the whole board at once, and fifty single-symbol polls
 * is how you get thrown off an undocumented endpoint. `useLiveQuote` is now a
 * one-element wrapper, so there is one poll loop, one failure policy and one
 * server route to reason about rather than two of each.
 *
 * ONE LOOP PER SYMBOL SET, NOT PER COMPONENT. The loop lives in a module-level
 * store that components subscribe to, rather than inside the effect. Measured
 * before that change: the scorecard page has two consumers of the same symbol —
 * the header and the price-statistics panel — so it issued two requests every
 * tick and four on mount under StrictMode, and the two could render different
 * prices for a frame. Sharing by symbol-set key makes N consumers cost one
 * request and see the same number.
 *
 * Three rules keep it from becoming a nuisance:
 *
 *  - It stops while the tab is hidden. A chart left open in a background tab
 *    overnight would otherwise make ~5,700 requests and get the whole app
 *    rate-limited for every other page.
 *  - It stops on the first failure that is not transient, rather than retrying
 *    into a 429. `available: false` comes back from the route as a 200, so a
 *    dead upstream reads as "not live" rather than as an error loop.
 *  - A tick is never shown against a symbol it is not for. The map handed back
 *    is filtered to the requested set, so the frame between a symbol change and
 *    the first new poll shows nothing rather than the previous instrument.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { LiveQuotePayload, QuotesResponse } from '@/app/api/quotes/route';
import { findSymbol, streamTicker } from '@/config/symbols.config';
import { subscribeTicks, type StreamState } from '@/lib/live/streams';

export interface LiveQuote extends LiveQuotePayload {
  /** When WE received it. Drives the "updated Xs ago" label. */
  receivedAt: number;
  /** Which symbol this is for, so a stale tick can never label another market. */
  symbol: string;
  /**
   * Seconds between the exchange's own stamp and when we received it. Null when
   * the upstream sent no stamp.
   *
   * This is the difference between a badge that is true and one that is not.
   * Measured against wall clock: FX pairs and crypto come back 1–8 seconds old,
   * but every futures-priced symbol — gold, silver, platinum, copper, WTI, DXY —
   * is exactly 600 seconds behind under an exchange-mandated delay, and the
   * European cash indices 900. All of them used to render under the same pulsing
   * green "Live" dot.
   */
  ageSeconds: number | null;
  /**
   * Which transport delivered this price.
   *
   * On screen rather than internal: "polled every 15s" and "streaming" are
   * different promises about how current the number is, and the badge has no
   * business making the stronger one when it is on the weaker transport.
   */
  source: 'stream' | 'poll';
}

/** Slow enough to be polite, fast enough that the price feels live. */
export const POLL_MS = 15_000;

/**
 * The interval for a set where nothing is actually live.
 *
 * A symbol on a 10-minute exchange delay yields a new data point every 600
 * seconds. Polling it at 15s spends forty requests to learn one number, and
 * those requests share a host cooldown with everything else the app fetches
 * from Yahoo — so the waste is not merely waste, it is the most likely thing
 * tripping the 429 that silences the scorecard's price data too.
 */
export const DELAYED_POLL_MS = 60_000;

/** Above this a quote is not live, and the badge must stop saying that it is. */
export const LIVE_MAX_AGE_SECONDS = 60;

/** Beyond this, the market is far more likely closed than merely delayed. */
const CLOSED_AGE_SECONDS = 2 * 3600;

export type Freshness = 'live' | 'delayed' | 'closed' | 'unstamped';

/**
 * What the badge is allowed to claim.
 *
 * Deliberately never guesses upward. An unstamped quote reads as 'unstamped'
 * rather than 'live', because "we cannot tell" and "it is current" are different
 * statements and only one of them is defensible.
 */
export function freshnessOf(quote: LiveQuote | null): {
  kind: Freshness;
  /** Short label for the badge itself. */
  label: string;
  /** The sentence behind it, for a tooltip. */
  detail: string;
} {
  if (!quote) return { kind: 'unstamped', label: 'Connecting…', detail: 'Waiting for the first tick.' };

  const age = quote.ageSeconds;
  if (age === null) {
    return {
      kind: 'unstamped',
      label: 'Polling',
      detail: 'The upstream sent no timestamp, so how current this price is cannot be verified.',
    };
  }

  if (age <= LIVE_MAX_AGE_SECONDS) {
    return { kind: 'live', label: 'Live', detail: `Quote stamped ${age}s ago.` };
  }

  if (age <= CLOSED_AGE_SECONDS) {
    const minutes = Math.round(age / 60);
    return {
      kind: 'delayed',
      label: `Delayed ${minutes}m`,
      detail:
        `The exchange publishes this feed on a ${minutes}-minute delay. The price is real; ` +
        'it is not current.',
    };
  }

  const hours = Math.round(age / 3600);
  return {
    kind: 'closed',
    label: `${hours}h old`,
    detail: 'Last trade was hours ago — this market is almost certainly closed.',
  };
}

/** How fast a feed should poll, given how fresh its freshest member actually is. */
export function pollIntervalFor(quotes: Iterable<LiveQuote>): number {
  let freshest: number | null = null;
  for (const quote of quotes) {
    if (quote.ageSeconds === null) continue;
    if (freshest === null || quote.ageSeconds < freshest) freshest = quote.ageSeconds;
  }

  // Nothing stamped means nothing known; poll at the normal rate rather than
  // slowing a feed that may well be live.
  if (freshest === null) return POLL_MS;
  return freshest <= LIVE_MAX_AGE_SECONDS ? POLL_MS : DELAYED_POLL_MS;
}

/** Three consecutive failures means the upstream is down or we are throttled. */
const MAX_FAILURES = 3;

/**
 * How long a feed survives its last subscriber.
 *
 * StrictMode mounts, unmounts and remounts every effect, and a route change
 * unmounts the old page before mounting the new one. Tearing the loop down the
 * instant the count hits zero would refetch on both, so the feed lingers a
 * moment and is reclaimed by the next subscriber instead.
 */
const IDLE_GRACE_MS = 3_000;

const EMPTY: ReadonlyMap<string, LiveQuote> = new Map();

/**
 * How often streamed ticks are pushed into React.
 *
 * FX arrives about once a second PER SYMBOL, so the board's fifty symbols would
 * be fifty re-renders a second if each tick emitted. Coalescing into a quarter
 * second is still four visible updates a second — well past what reads as
 * continuous motion — for a fiftieth of the work.
 */
const STREAM_FLUSH_MS = 250;

/**
 * A streamed symbol is considered live-by-socket for this long after its last
 * tick. Longer than any observed inter-tick gap in a trading market, short
 * enough that a market going quiet returns the feed to normal polling.
 */
const STREAM_ACTIVE_MS = 20_000;

interface Feed {
  key: string;
  refs: number;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
  reaper?: ReturnType<typeof setTimeout>;
  /** Replaced wholesale on each tick, so identity change means new data. */
  snapshot: ReadonlyMap<string, LiveQuote>;
  listeners: Set<() => void>;
  /** Torn down with the feed, so a dead feed cannot hold the socket open. */
  unstream?: () => void;
  streamState: StreamState;
  /** Symbol → when its last socket tick arrived. */
  streamedAt: Map<string, number>;
  flush?: ReturnType<typeof setTimeout>;
}

const feeds = new Map<string, Feed>();

function emit(feed: Feed) {
  for (const l of feed.listeners) l();
}

/**
 * True when the socket is currently carrying EVERY symbol in this feed.
 *
 * All rather than any, deliberately: a mixed set — the board holds streaming FX
 * beside ten-minute-delayed gold — must keep polling at the normal rate for the
 * sake of the members the socket cannot serve.
 */
function fullyStreamed(feed: Feed): boolean {
  const now = Date.now();
  for (const symbol of feed.key.split(',')) {
    const at = feed.streamedAt.get(symbol);
    if (at === undefined || now - at > STREAM_ACTIVE_MS) return false;
  }
  return true;
}

/**
 * The poll interval, given what the socket is already doing.
 *
 * When the stream has every symbol, the poll is no longer the thing keeping the
 * price current — it exists only to refresh the previous close and the day
 * range, which change slowly. Dropping it to a minute is four fewer requests a
 * minute per feed against the one undocumented host the whole app shares.
 */
function intervalFor(feed: Feed): number {
  if (fullyStreamed(feed)) return DELAYED_POLL_MS;
  return pollIntervalFor(feed.snapshot.values());
}

function scheduleFlush(feed: Feed) {
  if (feed.flush) return;
  feed.flush = setTimeout(() => {
    feed.flush = undefined;
    if (feeds.has(feed.key)) emit(feed);
  }, STREAM_FLUSH_MS);
}

/**
 * Folds one socket tick into the snapshot.
 *
 * The polled entry is kept and amended rather than replaced — the stream has no
 * previous close, no day high and no day low, and throwing those away on the
 * first tick would blank out the change column the moment the socket connected.
 */
function applyTick(feed: Feed, symbol: string, price: number, time: number) {
  const previous = feed.snapshot.get(symbol);
  const receivedAt = Date.now();
  feed.streamedAt.set(symbol, receivedAt);

  const previousClose = previous?.previousClose ?? null;

  const next: LiveQuote = {
    price,
    previousClose,
    /**
     * Recomputed from the new price rather than carried over. A streaming price
     * beside a percentage change computed from a price a minute old is two
     * numbers that contradict each other on the same row.
     */
    changePct:
      previousClose !== null && previousClose > 0
        ? (price / previousClose - 1) * 100
        : (previous?.changePct ?? null),
    time,
    /**
     * The day's extremes still belong to the poll, but a streamed price outside
     * them is evidence they have moved — the poll simply has not caught up.
     * Widening is safe in a way that narrowing would not be.
     */
    dayHigh: previous?.dayHigh != null ? Math.max(previous.dayHigh, price) : (previous?.dayHigh ?? null),
    dayLow: previous?.dayLow != null ? Math.min(previous.dayLow, price) : (previous?.dayLow ?? null),
    symbol,
    receivedAt,
    ageSeconds: Math.max(0, Math.round(receivedAt / 1000 - time)),
    source: 'stream',
  };

  const merged = new Map(feed.snapshot);
  merged.set(symbol, next);
  feed.snapshot = merged;

  scheduleFlush(feed);
}

/**
 * Opens the socket for whichever of this feed's symbols it can actually serve.
 *
 * A feed of nothing but futures subscribes to nothing and never opens a socket,
 * which is the correct outcome — those are ten minutes delayed and a socket
 * would not make them otherwise.
 */
function attachStream(feed: Feed) {
  const tickers = new Map<string, string>();
  for (const symbol of feed.key.split(',')) {
    const def = findSymbol(symbol);
    if (!def) continue;
    const ticker = streamTicker(def);
    if (ticker) tickers.set(ticker, symbol);
  }

  if (tickers.size === 0) return;

  feed.unstream = subscribeTicks({
    tickers,
    onTick: ({ symbol, price, time }) => {
      if (!feeds.has(feed.key)) return;
      applyTick(feed, symbol, price, time);
    },
    onState: (streamState) => {
      if (!feeds.has(feed.key)) return;
      feed.streamState = streamState;
      /**
       * A dropped socket must not leave rows claiming to stream. Clearing the
       * marks returns them to `source: 'poll'` on the next poll and restores
       * the 15-second cadence immediately rather than a minute later.
       */
      if (streamState !== 'open') feed.streamedAt.clear();
    },
  });
}

async function tick(feed: Feed) {
  if (!feeds.has(feed.key)) return;

  // Hidden tab: skip the request but keep the loop alive so it resumes the
  // moment the user comes back, without waiting for a visibility event.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    feed.timer = setTimeout(() => tick(feed), intervalFor(feed));
    return;
  }

  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(feed.key)}`, {
      cache: 'no-store',
    });
    const json: QuotesResponse = await res.json();

    if (!feeds.has(feed.key)) return;

    if (json.available) {
      feed.failures = 0;
      const receivedAt = Date.now();
      const next = new Map<string, LiveQuote>();

      for (const [symbol, q] of Object.entries(json.quotes)) {
        const polled: LiveQuote = {
          ...q,
          symbol,
          receivedAt,
          /**
           * Against the exchange's stamp, not against our previous poll.
           * Clamped at zero because a clock skew of a second or two between
           * the browser and the exchange must not render as a negative age.
           */
          ageSeconds: q.time === null ? null : Math.max(0, Math.round(receivedAt / 1000 - q.time)),
          source: 'poll',
        };

        /**
         * A POLL NEVER OVERWRITES A FRESHER STREAMED PRICE.
         *
         * The two transports race: a poll issued before a tick can resolve
         * after it, and Yahoo's REST snapshot lags its own socket by seconds
         * regardless. Letting the response win on arrival order made the price
         * jump backwards to a stale value roughly once a minute — the exact
         * flicker this whole feed exists to avoid. The poll's slower fields
         * are still taken; only the price and its stamp are protected.
         */
        const streamed = feed.snapshot.get(symbol);
        const keepStreamed =
          streamed?.source === 'stream' &&
          streamed.time !== null &&
          (q.time === null || streamed.time > q.time);

        next.set(
          symbol,
          keepStreamed
            ? {
                ...polled,
                price: streamed.price,
                time: streamed.time,
                changePct:
                  q.previousClose !== null && q.previousClose > 0
                    ? (streamed.price / q.previousClose - 1) * 100
                    : streamed.changePct,
                receivedAt: streamed.receivedAt,
                ageSeconds: streamed.ageSeconds,
                source: 'stream',
              }
            : polled,
        );
      }

      feed.snapshot = next;
      emit(feed);
    } else {
      feed.failures += 1;
    }
  } catch {
    feed.failures += 1;
  }

  if (feeds.has(feed.key) && feed.failures < MAX_FAILURES) {
    // Paced by what the feed actually delivers: a set of 10-minute-delayed
    // symbols is polled once a minute rather than forty times per data point,
    // and a fully streamed set drops to the same rate because the socket is
    // what keeps it current.
    feed.timer = setTimeout(() => tick(feed), intervalFor(feed));
  }
}

function acquire(key: string): Feed {
  let feed = feeds.get(key);

  if (!feed) {
    feed = {
      key,
      refs: 0,
      failures: 0,
      snapshot: EMPTY,
      listeners: new Set(),
      streamState: 'down',
      streamedAt: new Map(),
    };
    feeds.set(key, feed);
    // Poll first: it is the transport that always works, and it is what fills
    // the fields the socket does not carry.
    tick(feed);
    attachStream(feed);
  }

  // Reclaimed before the grace period expired — cancel the teardown.
  if (feed.reaper) {
    clearTimeout(feed.reaper);
    feed.reaper = undefined;
  }

  feed.refs += 1;
  return feed;
}

function release(feed: Feed) {
  feed.refs -= 1;
  if (feed.refs > 0) return;

  feed.reaper = setTimeout(() => {
    if (feed.refs > 0) return;
    if (feed.timer) clearTimeout(feed.timer);
    if (feed.flush) clearTimeout(feed.flush);
    // Releases this feed's tickers; the socket itself closes only when no feed
    // anywhere still wants one.
    feed.unstream?.();
    feeds.delete(feed.key);
  }, IDLE_GRACE_MS);
}

export function useLiveQuotes(
  symbols: string[],
  enabled: boolean,
): ReadonlyMap<string, LiveQuote> {
  /**
   * A fresh array every render would restart the poll on every render. The
   * sorted join is the actual identity of the request, and sorting also means
   * two components asking for the same set in a different order share both the
   * client feed and the server's cache entry.
   */
  const key = useMemo(() => [...new Set(symbols)].sort().join(','), [symbols]);
  const active = enabled && key !== '';

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return () => {};
      const feed = acquire(key);
      feed.listeners.add(onChange);
      return () => {
        feed.listeners.delete(onChange);
        release(feed);
      };
    },
    [key, active],
  );

  const getSnapshot = useCallback(
    () => (active ? (feeds.get(key)?.snapshot ?? EMPTY) : EMPTY),
    [key, active],
  );

  // The server has no live price by definition; rendering EMPTY there keeps the
  // markup identical to the client's first paint.
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  /**
   * Filtered against the requested set rather than trusted wholesale. A feed is
   * shared by key, so this is belt-and-braces — but it is the guarantee that a
   * tick can never be shown for a market that is not on screen.
   */
  return useMemo(() => {
    if (!active) return EMPTY;
    const wanted = new Set(key.split(','));
    const out = new Map<string, LiveQuote>();
    for (const [symbol, quote] of snapshot) {
      if (wanted.has(symbol)) out.set(symbol, quote);
    }
    return out;
  }, [snapshot, key, active]);
}

/** One symbol, for the chart and the scorecard header. Same loop, same rules. */
export function useLiveQuote(symbol: string, enabled: boolean): LiveQuote | null {
  const symbols = useMemo(() => [symbol], [symbol]);
  return useLiveQuotes(symbols, enabled).get(symbol) ?? null;
}
