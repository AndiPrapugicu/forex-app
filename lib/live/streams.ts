'use client';

/**
 * The live tick, over a socket instead of a poll.
 *
 * `wss://streamer.finance.yahoo.com/?version=2` is keyless, accepts a browser
 * origin, and delivers FX roughly once a second — against a 15-second poll,
 * which is why a one-minute candle looked frozen no matter how fresh the number
 * behind it was. Frames are a JSON envelope wrapping a base64 protobuf body;
 * `lib/live/protobuf.ts` reads the three fields we need out of it.
 *
 * THE POLL DOES NOT STOP WHEN THIS CONNECTS, and that is the design rather than
 * a leftover. This endpoint is undocumented and may change shape or disappear
 * without notice, so it is only ever an accelerator on top of a transport that
 * works on its own. Every failure mode — refused, dropped, half-open, silent
 * market — degrades to exactly the polling behaviour that shipped before it.
 * The stream also carries only a price and a stamp, so the previous close, the
 * day range and the percentage change still come from the poll.
 *
 * WHY NOT BINANCE FOR CRYPTO, which the plan called for. Measured side by side:
 * Binance's `btcusdt@trade` sat a persistent **0.12% above** Yahoo's `BTC-USD`
 * — about $78 — for the whole sample, because BTC/USDT and BTC/USD are
 * different pairs. Our crypto BARS come from Yahoo, so a Binance tick would
 * open every forming candle $78 away from the close of the bar beside it: a
 * visible phantom gap, once a minute, forever. Binance is faster and it is the
 * wrong instrument. Yahoo streams `BTC-USD` about every four seconds, which is
 * far inside a one-minute candle, so the whole chart stays on one feed.
 *
 * ONE SOCKET FOR THE WHOLE APP, ref-counted by ticker, for the same reason the
 * poll is shared: the board and the chart both want GBPUSD and neither should
 * cost a second connection.
 */

import { asFloat, asString, asZigZag, decodeFields } from '@/lib/live/protobuf';

const URL = 'wss://streamer.finance.yahoo.com/?version=2';

export interface StreamTick {
  /** OUR symbol, already mapped back from the feed's own ticker. */
  symbol: string;
  price: number;
  /** The exchange's own stamp, in SECONDS, to match the polled shape. */
  time: number;
}

export type StreamState = 'connecting' | 'open' | 'down';

export interface StreamSubscription {
  /** Feed ticker → our symbol. Two of ours can never share one feed ticker. */
  tickers: Map<string, string>;
  onTick: (tick: StreamTick) => void;
  onState: (state: StreamState) => void;
}

const subscriptions = new Set<StreamSubscription>();

let socket: WebSocket | null = null;
let state: StreamState = 'down';
/** What the socket has actually been told to send, so a diff can be computed. */
let subscribed = new Set<string>();
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
let lastFrameAt = 0;

/**
 * Backoff, capped. Uncapped exponential means a socket that dropped overnight
 * comes back hours late; a flat retry means a refusing endpoint gets hammered.
 */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * How long a socket may sit silent before it is treated as half-open.
 *
 * Deliberately generous. A quiet socket is the NORMAL state at a weekend or
 * outside an index's session, and reconnecting into a closed market on a timer
 * would be a reconnect loop that achieves nothing. Three minutes is longer than
 * any gap observed while a market was actually trading, and the poll is
 * carrying the page regardless — so the cost of waiting is zero and the cost of
 * being trigger-happy is a loop.
 */
const SILENCE_MS = 180_000;

function setState(next: StreamState) {
  if (state === next) return;
  state = next;
  for (const sub of subscriptions) sub.onState(next);
}

/** Every ticker any live subscriber currently wants. */
function desired(): Set<string> {
  const out = new Set<string>();
  for (const sub of subscriptions) for (const ticker of sub.tickers.keys()) out.add(ticker);
  return out;
}

function send(message: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A send racing a close is not worth surfacing — the reconnect path
    // resubscribes from scratch anyway.
  }
}

/** Tells the socket about the difference between what it has and what we want. */
function reconcile() {
  if (socket?.readyState !== WebSocket.OPEN) return;

  const want = desired();
  const add = [...want].filter((t) => !subscribed.has(t));
  const drop = [...subscribed].filter((t) => !want.has(t));

  if (add.length > 0) send({ subscribe: add });
  if (drop.length > 0) send({ unsubscribe: drop });

  subscribed = want;
}

function onMessage(event: MessageEvent) {
  lastFrameAt = Date.now();

  let body: string;
  try {
    const envelope = JSON.parse(String(event.data)) as { type?: string; message?: string };
    if (envelope.type !== 'pricing' || typeof envelope.message !== 'string') return;
    body = envelope.message;
  } catch {
    return;
  }

  let fields;
  try {
    fields = decodeFields(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
  } catch {
    return;
  }

  const ticker = asString(fields.get(1));
  const price = asFloat(fields.get(2));
  const ms = asZigZag(fields.get(3));
  if (ticker === null || price === null || !Number.isFinite(price) || price <= 0) return;

  /**
   * A frame with no usable stamp is dated on ARRIVAL rather than dropped. The
   * price is real and it is the freshest thing we have; refusing it would leave
   * the chart on a 15-second poll for want of a field. Arrival time understates
   * nothing — it can only make a quote look very slightly older than it is.
   */
  const time = ms !== null && ms > 0 ? Math.round(ms / 1000) : Math.round(Date.now() / 1000);

  for (const sub of subscriptions) {
    const symbol = sub.tickers.get(ticker);
    if (symbol) sub.onTick({ symbol, price, time });
  }
}

function connect() {
  if (socket || typeof WebSocket === 'undefined') return;
  if (desired().size === 0) return;

  setState('connecting');
  subscribed = new Set();

  let ws: WebSocket;
  try {
    ws = new WebSocket(URL);
  } catch {
    // Constructing can throw outright under a strict CSP. Treat it as a drop so
    // the page stays on polling rather than dying here.
    setState('down');
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    attempt = 0;
    lastFrameAt = Date.now();
    setState('open');
    reconcile();
  };

  ws.onmessage = (event) => {
    if (socket === ws) onMessage(event);
  };

  ws.onerror = () => {
    // `onclose` always follows, and that is where the reconnect lives — doing
    // it in both would open two sockets.
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    subscribed = new Set();
    setState('down');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (retry || desired().size === 0) return;

  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  attempt += 1;
  retry = setTimeout(() => {
    retry = undefined;
    connect();
  }, delay);
}

function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (state !== 'open' || Date.now() - lastFrameAt < SILENCE_MS) return;
    // Half-open: the socket believes it is fine and nothing is arriving. Close
    // it and let the normal reconnect path run.
    lastFrameAt = Date.now();
    socket?.close();
  }, 30_000);
}

function teardownIfIdle() {
  if (subscriptions.size > 0) return;

  if (retry) {
    clearTimeout(retry);
    retry = undefined;
  }
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = undefined;
  }

  const ws = socket;
  socket = null;
  subscribed = new Set();
  attempt = 0;
  state = 'down';
  ws?.close();
}

/**
 * Subscribes to live ticks. Returns the unsubscribe.
 *
 * The caller owns the ticker→symbol map because only it knows which of our
 * symbols it is displaying: `JPY=X` is USDJPY on every page, but the map is
 * what stops a tick reaching a page that is not showing that market.
 */
export function subscribeTicks(sub: StreamSubscription): () => void {
  subscriptions.add(sub);
  sub.onState(state);

  if (socket) reconcile();
  else if (!retry) connect();
  startWatchdog();

  return () => {
    subscriptions.delete(sub);
    if (subscriptions.size === 0) teardownIfIdle();
    else reconcile();
  };
}
