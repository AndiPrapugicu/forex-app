/**
 * "X just moved — what happened?", read by fixed rules.
 *
 *   1. The MOVE: in the window the user means ("yesterday", the chart's date,
 *      or the last few hours), the move they describe (down ~2% in ~2 hours),
 *      or the largest swing when they describe none. A described move that is
 *      not in the bars is NO MATCH, never swapped for a different move.
 *   2. The FINGERPRINT: every instrument in the panel measured over that same
 *      window, then stocks against yields (risk-off, rates shock, dovish relief,
 *      reflation), the curve (which end led), and the haven confirmations.
 *   3. The CATALYSTS: headlines timed against the start of the move, the
 *      closest first, tagged by region and direction; plus the headlines behind
 *      any link the user pasted, found by the words in its address.
 *   4. The FIT: whether the leading headline explains the fingerprint, said
 *      plainly when it does not.
 *   5. The ONSETS: when each asset's own move broke, so stocks and bonds
 *      moving on two different stories show as two different times.
 *   6. The ATTRIBUTION: headlines written after the move that say what moved
 *      it ("Nasdaq falls after report says OpenAI revenue missed"), clustered
 *      by cause and counted by outlet. The market's own explanation; not proof.
 *   7. SCHEDULED events inside the move: releases and Treasury auctions.
 *
 * Pure, with the clock injected. The analyst restates this; it never feeds a score.
 */

import { CONFLICT_REGIONS, CONFLICT_TERMS, DEESCALATION_TERMS } from '@/config/narrative.config';
import { REACTION, REACTION_PANEL, type ReactionInstrument } from '@/config/reaction.config';
import type { IntradaySeries } from '@/lib/connectors/intraday';
import type { Headline } from '@/lib/analysis/headlines';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A bar further than this from the moment asked for is not a reading of it. */
const STALE_BAR_MS = 45 * MINUTE;

export interface MoveWindow {
  ticker: string;
  startMs: number;
  endMs: number;
  from: number;
  to: number;
  changePct: number;
}

export interface Change {
  value: number;
  unit: '%' | 'bp';
  /** Derived (a yield from a note future's price), not quoted. */
  approx: boolean;
}

export interface PanelRow {
  inst: ReactionInstrument;
  /** Over the move's own window. */
  window: Change | null;
  /** Over the last 1, 2 and 4 hours. */
  fixed: (Change | null)[];
  last: number | null;
}

export type Pattern = 'risk-off' | 'rates-shock' | 'dovish-relief' | 'reflation' | 'equities-only' | 'rates-only' | 'quiet';

export interface Fingerprint {
  pattern: Pattern;
  text: string;
  curve: string | null;
  confirmations: string[];
  havens: { up: number; of: number };
  oil: string | null;
  /** Whether the equity move was broad or led by one corner of the market. */
  breadth: string | null;
}

export type CatalystTag = 'escalation' | 'de-escalation' | 'diplomacy' | 'fed' | 'trade' | 'data' | string;

export interface Catalyst {
  title: string;
  source: string;
  publishedUtc: string;
  /** Minutes from the start of the move; negative is before it. */
  minutesFromStart: number;
  tags: CatalystTag[];
}

export interface LinkQuery {
  url: string;
  domain: string;
  query: string;
}

const hhmm = (ms: number, nowMs: number) => {
  const iso = new Date(ms).toISOString();
  return new Date(nowMs).toISOString().slice(0, 10) === iso.slice(0, 10) ? `${iso.slice(11, 16)}Z` : `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;
};

// ---------------------------------------------------------------------------
// The move
// ---------------------------------------------------------------------------

/** The bar at or before `ms`, if it is recent enough to stand for that moment. */
export function closeAt(s: IntradaySeries | undefined, ms: number): number | null {
  if (!s) return null;
  for (let i = s.t.length - 1; i >= 0; i--) {
    if (s.t[i] <= ms) return ms - s.t[i] <= STALE_BAR_MS ? s.c[i] : null;
  }
  return null;
}

/** The largest swing, in either direction, inside the last `hours`. */
export function findMove(s: IntradaySeries | undefined, nowMs: number, hours = REACTION.searchHours): MoveWindow | null {
  return findMoveIn(s, nowMs - hours * HOUR, nowMs);
}

/** The largest swing, in either direction, between two moments. */
export function findMoveIn(s: IntradaySeries | undefined, from: number, nowMs: number): MoveWindow | null {
  if (!s) return null;
  let best: MoveWindow | null = null;
  let lo = -1;
  let hi = -1;
  for (let j = 0; j < s.t.length; j++) {
    if (s.t[j] < from || s.t[j] > nowMs) continue;
    if (lo < 0) {
      lo = hi = j;
      continue;
    }
    for (const i of [lo, hi]) {
      const pct = ((s.c[j] - s.c[i]) / s.c[i]) * 100;
      if (!best || Math.abs(pct) > Math.abs(best.changePct)) {
        best = { ticker: s.ticker, startMs: s.t[i], endMs: s.t[j], from: s.c[i], to: s.c[j], changePct: pct };
      }
    }
    // Ties move the extreme forward: a move starts when price LEAVES a level,
    // not when it first touched it.
    if (s.c[j] <= s.c[lo]) lo = j;
    if (s.c[j] >= s.c[hi]) hi = j;
  }
  return best;
}

/**
 * The strongest move ONE way (1 up, −1 down), no longer than `maxMinutes`.
 * On a tie the later start and the earlier end win: a move starts when price
 * leaves a level and ends when it first reaches the extreme.
 */
export function strongestMove(
  s: IntradaySeries | undefined,
  from: number,
  to: number,
  direction: 1 | -1,
  maxMinutes: number | null = null,
): MoveWindow | null {
  if (!s) return null;
  const idx: number[] = [];
  for (let k = 0; k < s.t.length; k++) if (s.t[k] >= from && s.t[k] <= to) idx.push(k);
  const span = maxMinutes === null ? Infinity : maxMinutes * MINUTE;
  let best: { i: number; j: number; score: number } | null = null;
  for (let b = 1; b < idx.length; b++) {
    const j = idx[b];
    for (let a = 0; a < b; a++) {
      const i = idx[a];
      if (s.t[j] - s.t[i] > span) continue;
      const score = ((s.c[j] - s.c[i]) / s.c[i]) * 100 * direction;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && j === best.j)) best = { i, j, score };
    }
  }
  if (!best || best.score <= 0) return null;
  return { ticker: s.ticker, startMs: s.t[best.i], endMs: s.t[best.j], from: s.c[best.i], to: s.c[best.j], changePct: best.score * direction };
}

export type MatchStatus = 'match' | 'smaller' | 'no-match' | 'largest';

export interface MoveMatch {
  move: MoveWindow | null;
  /** `largest` when the user described no direction; `smaller` when the move is under half what they said. */
  status: MatchStatus;
  /** The largest swing either way in the window, shown when it is not the move. */
  largest: MoveWindow | null;
}

/** The move the user describes, inside the window; never a different one. */
export function matchMove(
  s: IntradaySeries | undefined,
  from: number,
  to: number,
  described: { direction: 1 | -1; pct: number | null; minutes: number | null } | null,
): MoveMatch {
  const largest = findMoveIn(s, from, to);
  if (!described) return { move: largest, status: 'largest', largest };
  const maxMinutes = described.minutes ? described.minutes * REACTION.durationSlack : REACTION.defaultMoveMinutes;
  let move = strongestMove(s, from, to, described.direction, maxMinutes);
  // Too short for anything real in the bars, or well short of the size the
  // user gave: look again at any length.
  const tooSmall = (m: MoveWindow | null) =>
    !m ||
    Math.abs(m.changePct) < REACTION.flat.pct ||
    (!described.minutes && described.pct !== null && Math.abs(m.changePct) < described.pct * REACTION.weakerShare);
  if (tooSmall(move)) {
    const any = strongestMove(s, from, to, described.direction, null);
    if (any && (!move || Math.abs(any.changePct) > Math.abs(move.changePct))) move = any;
  }
  if (!move || Math.abs(move.changePct) < REACTION.flat.pct) return { move: null, status: 'no-match', largest };
  const smaller = described.pct !== null && Math.abs(move.changePct) < described.pct * REACTION.weakerShare;
  return { move, status: smaller ? 'smaller' : 'match', largest };
}

export function changeBetween(s: IntradaySeries | undefined, inst: ReactionInstrument, fromMs: number, toMs: number): Change | null {
  const a = closeAt(s, fromMs);
  const b = closeAt(s, toMs);
  if (a === null || b === null || a === 0) return null;
  if (inst.unit === 'yield') return { value: (b - a) * 100, unit: 'bp', approx: false };
  if (inst.unit === 'note-futures') {
    // Price up is yield down: Δy ≈ −(ΔP/P) / duration.
    return { value: (-((b - a) / a) / (inst.duration ?? 1.9)) * 10_000, unit: 'bp', approx: true };
  }
  return { value: ((b - a) / a) * 100, unit: '%', approx: false };
}

export function buildPanel(series: Map<string, IntradaySeries>, move: MoveWindow | null, nowMs: number): PanelRow[] {
  return REACTION_PANEL.map((inst) => {
    const s = series.get(inst.ticker);
    return {
      inst,
      window: move ? changeBetween(s, inst, move.startMs, move.endMs) : null,
      fixed: REACTION.windows.map((h) => changeBetween(s, inst, nowMs - h * HOUR, nowMs)),
      last: s ? s.c[s.c.length - 1] : null,
    };
  });
}

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

function dir(c: Change | null | undefined): -1 | 0 | 1 | null {
  if (!c) return null;
  const flat = c.unit === 'bp' ? REACTION.flat.bp : REACTION.flat.pct;
  return Math.abs(c.value) < flat ? 0 : c.value > 0 ? 1 : -1;
}

const row = (rows: PanelRow[], ticker: string) => rows.find((r) => r.inst.ticker === ticker)?.window ?? null;

export function fmtChange(c: Change | null): string {
  if (!c) return 'n/a';
  const v = c.unit === 'bp' ? c.value.toFixed(1) : c.value.toFixed(2);
  const signed = c.value > 0 ? `+${v}` : c.value < 0 ? `−${v.slice(1)}` : v;
  return `${signed}${c.unit === 'bp' ? 'bp' : '%'}${c.approx ? ' (approx)' : ''}`;
}

const PATTERN_TEXT: Record<Pattern, string> = {
  'risk-off': 'RISK-OFF WITH BONDS BID — stocks down and yields down together: a flight to safety or a growth scare. Not a rates or inflation shock.',
  'rates-shock': 'RATES SHOCK — stocks down while yields rise: a more hawkish Fed, hotter inflation or heavier supply is being priced.',
  'dovish-relief': 'DOVISH RELIEF — stocks up as yields fall: easier policy or cooler inflation is being priced.',
  reflation: 'GROWTH / REFLATION — stocks and yields up together: stronger growth is being priced.',
  'equities-only': 'EQUITY-LED — stocks moved and yields did not: look for a sector, earnings, flows or positioning story rather than macro.',
  'rates-only': 'RATES-LED — yields moved and stocks have not (yet).',
  quiet: 'NO CLEAR CROSS-ASSET MOVE — nothing in the panel moved past its flat band in this window.',
};

export function fingerprint(rows: PanelRow[]): Fingerprint {
  const eq = row(rows, 'NQ=F') ?? row(rows, 'ES=F');
  const tenY = row(rows, '^TNX') ?? row(rows, '^FVX') ?? row(rows, 'ZT=F');
  const e = dir(eq) ?? 0;
  const r = dir(tenY) ?? 0;
  const pattern: Pattern =
    e < 0 && r < 0 ? 'risk-off' : e < 0 && r > 0 ? 'rates-shock' : e > 0 && r < 0 ? 'dovish-relief' : e > 0 && r > 0 ? 'reflation' : e !== 0 ? 'equities-only' : r !== 0 ? 'rates-only' : 'quiet';

  // The curve: which end led.
  const front = row(rows, 'ZT=F');
  const back = row(rows, '^TYX') ?? row(rows, '^TNX');
  let curve: string | null = null;
  if (front && back) {
    const lead = Math.abs(front.value) - Math.abs(back.value);
    const both = Math.sign(front.value) === Math.sign(back.value) ? Math.sign(front.value) : 0;
    const f = `2Y ${fmtChange(front)}, ${back === row(rows, '^TYX') ? '30Y' : '10Y'} ${fmtChange(back)}`;
    if (Math.abs(front.value) < REACTION.flat.bp && Math.abs(back.value) < REACTION.flat.bp) curve = `Curve flat (${f}).`;
    else if (both < 0 && lead >= REACTION.curveLeadBp) curve = `BULL STEEPENER — the front end led lower (${f}): the market is pulling Fed cuts forward.`;
    else if (both < 0 && -lead >= REACTION.curveLeadBp) curve = `BULL FLATTENER — the long end led lower (${f}): growth fear or haven demand for duration.`;
    else if (both > 0 && -lead >= REACTION.curveLeadBp) curve = `BEAR STEEPENER — the long end led higher (${f}): term premium, supply, fiscal or inflation worry.`;
    else if (both > 0 && lead >= REACTION.curveLeadBp) curve = `BEAR FLATTENER — the front end led higher (${f}): a hawkish repricing of the Fed.`;
    else if (both === 0) curve = `TWIST — the two ends moved in opposite directions (${f}).`;
    else curve = `PARALLEL — both ends moved about the same (${f}).`;
  }

  // Havens: gold up, VIX up, the yen and the franc stronger (USD/JPY and USD/CHF down).
  const checks: [string, Change | null, 1 | -1][] = [
    ['gold', row(rows, 'GC=F'), 1],
    ['VIX', row(rows, '^VIX'), 1],
    ['yen', row(rows, 'JPY=X'), -1],
    ['franc', row(rows, 'CHF=X'), -1],
  ];
  const confirmations: string[] = [];
  let up = 0;
  let of = 0;
  for (const [name, c, sign] of checks) {
    const d = dir(c);
    if (d === null) continue;
    of++;
    if (d === sign) {
      up++;
      confirmations.push(`${name} bid (${fmtChange(c)}${name === 'yen' || name === 'franc' ? ` on USD/${name === 'yen' ? 'JPY' : 'CHF'}` : ''})`);
    }
  }
  const dxy = row(rows, 'DX-Y.NYB');
  if (dir(dxy)) confirmations.push(`dollar ${dxy!.value > 0 ? 'up' : 'down'} (${fmtChange(dxy)})`);

  const crude = row(rows, 'CL=F') ?? row(rows, 'BZ=F');
  const o = dir(crude);
  const oil =
    o === null || o === 0
      ? null
      : Math.abs(crude!.value) >= REACTION.sharp.pct
        ? `Oil ${crude!.value > 0 ? 'jumped' : 'dropped'} ${fmtChange(crude)}: ${crude!.value > 0 ? 'a supply-risk reading (escalation, OPEC, outage)' : 'de-escalation, more supply or a demand scare'}.`
        : `Oil ${fmtChange(crude)}.`;

  // Breadth: the Nasdaq against the S&P and the small caps.
  const nq = row(rows, 'NQ=F');
  const es = row(rows, 'ES=F');
  const rty = row(rows, 'RTY=F');
  let breadth: string | null = null;
  if (nq && es && Math.abs(nq.value) >= REACTION.flat.pct) {
    const opposite = rty && dir(rty) !== 0 && Math.sign(rty.value) !== Math.sign(nq.value);
    if (opposite || Math.abs(nq.value) >= 2 * Math.abs(es.value)) {
      breadth =
        `NARROW — the Nasdaq (${fmtChange(nq)}) moved far more than the S&P (${fmtChange(es)})` +
        `${rty ? ` and small caps went ${fmtChange(rty)}` : ''}: a tech / mega-cap-led move or a rotation, not a broad macro sell-off or rally.`;
    } else {
      breadth = `BROAD — the Nasdaq ${fmtChange(nq)}, the S&P ${fmtChange(es)}${rty ? `, small caps ${fmtChange(rty)}` : ''}.`;
    }
  }

  return { pattern, text: PATTERN_TEXT[pattern], curve, confirmations, havens: { up, of }, oil, breadth };
}

// ---------------------------------------------------------------------------
// Catalysts
// ---------------------------------------------------------------------------

const DIPLOMACY = /\b(talks?|productive|discussions?|deal|agreement|negotiat\w+|diplomac\w+|envoy|summit)\b/i;
const FED = /\b(Fed|FOMC|Powell|Federal Reserve|rate (cut|hike)s?)\b/i;
const TRADE = /\b(tariffs?|trade war|export (ban|controls?)|sanctions?)\b/i;
const DATA = /\b(CPI|PPI|PCE|payrolls?|NFP|jobless|unemployment|GDP|ISM|PMI|retail sales|inflation data)\b/i;
/** A headline about markets or macro at all; a broker's price target on one stock is not a catalyst. */
const MARKET = /\b(stocks?|equit\w*|Nasdaq|S&P|Dow|Wall Street|futures|yields?|Treasur\w*|dollar|oil|crude|gold|tech|chips?|semiconductor\w*|AI|sell-?off|rally|tumbl\w*|slump\w*|surg\w*|Trump|White House|China|Iran|Russia|Ukraine|Israel|war|central bank|Fed|ECB|auction)\b/i;

export function tagHeadline(title: string): CatalystTag[] {
  const tags: CatalystTag[] = [];
  for (const r of CONFLICT_REGIONS) if (r.pattern.test(title)) tags.push(r.label);
  if (DEESCALATION_TERMS.test(title)) tags.push('de-escalation');
  else if (CONFLICT_TERMS.test(title)) tags.push('escalation');
  if (DIPLOMACY.test(title)) tags.push('diplomacy');
  if (FED.test(title)) tags.push('fed');
  if (TRADE.test(title)) tags.push('trade');
  if (DATA.test(title)) tags.push('data');
  return tags;
}

/** One broker's view of one stock: never what moved an index. */
const BROKER_NOTE = /\b(price target|(raises|lifts|cuts|lowers) (its )?target|upgrades?|downgrades?|initiates coverage)\b/i;
/** Evergreen and product pieces: comparisons, buy lists, previews. Never a catalyst. */
const EVERGREEN = /\b(ETFs?|face-off|things to know|to (buy|watch)|best \w+ to|should you|is it time|price prediction|how to)\b|\bvs\./i;

const causalDistance =(minutes: number) => (minutes > 0 ? 2 * minutes : -minutes);

/** Headlines from shortly before the move to just after its end, closest to its start first. */
export function rankCatalysts(headlines: Headline[], move: MoveWindow): Catalyst[] {
  const from = move.startMs - REACTION.catalystLeadMinutes * MINUTE;
  const to = move.endMs + 15 * MINUTE;
  return headlines
    .map((h) => ({ h, ms: Date.parse(h.publishedUtc) }))
    .filter(
      ({ h, ms }) =>
        Number.isFinite(ms) && ms >= from && ms <= to && !BROKER_NOTE.test(h.title) && !EVERGREEN.test(h.title) && (MARKET.test(h.title) || tagHeadline(h.title).length > 0),
    )
    .map(({ h, ms }) => ({
      title: h.title,
      source: h.domain,
      publishedUtc: h.publishedUtc,
      minutesFromStart: Math.round((ms - move.startMs) / MINUTE),
      tags: tagHeadline(h.title),
    }))
    // A cause precedes its effect: a headline after the start counts double its distance.
    .sort((a, b) => causalDistance(a.minutesFromStart) - causalDistance(b.minutesFromStart))
    .slice(0, REACTION.catalystsShown);
}

/**
 * Search words from a pasted link's address — the page itself is never
 * fetched. "…/news/1430608-trump-having-productive-discussions-with-iran-we-will"
 * becomes "trump having productive discussions with iran we will".
 */
export function linkQueries(text: string): LinkQuery[] {
  const out: LinkQuery[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    let u: URL;
    try {
      u = new URL(m[0]);
    } catch {
      continue;
    }
    const segment = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const words = decodeURIComponent(segment)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .split(/[-_+]/)
      .filter((w) => w && !/^\d+$/.test(w))
      .join(' ')
      .trim();
    if (words.split(' ').length < 3) continue;
    out.push({ url: m[0], domain: u.hostname.replace(/^www\./, ''), query: words.slice(0, 80) });
  }
  return out.slice(0, 3);
}

/**
 * Does the leading headline explain the fingerprint? Said only when the
 * mismatch is clear-cut; otherwise nothing, and the analyst weighs it.
 */
export function fitNotes(
  fp: Fingerprint,
  catalysts: Catalyst[],
  move?: MoveWindow | null,
  linked: { publishedUtc: string }[] = [],
): string[] {
  const notes: string[] = [];
  // The story behind the user's own link: when did it first appear?
  const firstLinked = linked.map((h) => Date.parse(h.publishedUtc)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (move && firstLinked !== undefined) {
    const after = Math.round((firstLinked - move.startMs) / MINUTE);
    if (after > 15) {
      notes.push(
        `TIMING: the story behind the user's link first appears ${after} minutes AFTER the move began` +
          `${firstLinked > move.endMs ? ' and after it ended' : ''}: it cannot have started the move. It may have extended it, or be a reaction to it.`,
      );
    } else {
      notes.push(`TIMING: the story behind the user's link first appears ${after >= 0 ? `${after} minutes after` : `${-after} minutes before`} the move began — consistent with it being a trigger.`);
    }
  }
  const lead = catalysts[0];
  if (!lead) {
    notes.push('No headline was timed inside the window: the move may be flows, positioning, a technical break or a story not in the feeds.');
    return notes;
  }
  const calming = lead.tags.includes('de-escalation') || (lead.tags.includes('diplomacy') && !lead.tags.includes('escalation'));
  if (calming && (fp.pattern === 'risk-off' || fp.pattern === 'rates-shock')) {
    notes.push(
      'MISMATCH: the closest headline reads as de-escalation or diplomacy, which usually lifts stocks and pulls oil down. ' +
        `A ${fp.pattern === 'risk-off' ? 'risk-off move with bonds bid' : 'rates shock'} does not follow from it alone — look for a second catalyst, a reversal of the headline, or positioning unwinding.`,
    );
  }
  if (lead.tags.includes('escalation') && (fp.pattern === 'dovish-relief' || fp.pattern === 'reflation')) {
    notes.push('MISMATCH: the closest headline reads as escalation, yet stocks rose. Either the market had priced worse, or another story drove it.');
  }
  if (lead.minutesFromStart > 0) {
    notes.push(`The closest headline came ${lead.minutesFromStart} minutes AFTER the move began: it may describe the move rather than cause it.`);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Onsets: when each asset's own move broke
// ---------------------------------------------------------------------------

export interface Onset {
  inst: ReactionInstrument;
  /** The first bar past `onsetShare` of the instrument's own move: when it broke. */
  brokeMs: number;
  startMs: number;
  endMs: number;
  change: Change | null;
}

/**
 * The instrument's own move around the window, in the direction it went over
 * the window. A yield read off a note future moves its PRICE the other way.
 */
export function onsetOf(s: IntradaySeries | undefined, inst: ReactionInstrument, move: MoveWindow): Onset | null {
  if (!s) return null;
  const over = changeBetween(s, inst, move.startMs, move.endMs);
  const d = dir(over);
  if (!d) return null;
  const priceDir = (inst.unit === 'note-futures' ? -d : d) as 1 | -1;
  const from = move.startMs - HOUR;
  const to = move.endMs + HOUR;
  const own = strongestMove(s, from, to, priceDir, null);
  if (!own) return null;
  const total = Math.abs(own.to - own.from);
  let brokeMs = own.startMs;
  for (let k = 0; k < s.t.length; k++) {
    if (s.t[k] < own.startMs || s.t[k] > own.endMs) continue;
    if ((s.c[k] - own.from) * priceDir >= REACTION.onsetShare * total) {
      brokeMs = s.t[k];
      break;
    }
  }
  return { inst, brokeMs, startMs: own.startMs, endMs: own.endMs, change: changeBetween(s, inst, own.startMs, own.endMs) };
}

const RATE_TICKERS = ['ZT=F', '^FVX', '^TNX', '^TYX'];

/**
 * Did the symbol and the yields break together? Apart by more than
 * `splitOnsetMinutes`, they may be two stories, and the answer should explain
 * each on its own.
 */
export function splitNote(onsets: Onset[], primaryTicker: string, nowMs: number): string | null {
  const own = onsets.find((o) => o.inst.ticker === primaryTicker);
  const rates = RATE_TICKERS.map((t) => onsets.find((o) => o.inst.ticker === t)).filter((o): o is Onset => !!o);
  if (!own || rates.length === 0 || RATE_TICKERS.includes(primaryTicker)) return null;
  const first = rates.reduce((a, b) => (b.brokeMs < a.brokeMs ? b : a));
  const gap = Math.round((first.brokeMs - own.brokeMs) / MINUTE);
  const pair = `${own.inst.label} broke at ${hhmm(own.brokeMs, nowMs)}, ${first.inst.label} at ${hhmm(first.brokeMs, nowMs)}`;
  if (Math.abs(gap) < REACTION.splitOnsetMinutes) return `TOGETHER: ${pair} — one shared driver is plausible.`;
  return (
    `SPLIT: ${pair} (${Math.abs(gap)} minutes apart; ${gap > 0 ? 'the symbol moved first' : 'yields moved first'}). ` +
    'They may have separate drivers: explain the symbol and the bond move each on its own evidence.'
  );
}

// ---------------------------------------------------------------------------
// Attribution: what the headlines written after the move say moved it
// ---------------------------------------------------------------------------

export type AssetClass = 'equities' | 'rates' | 'dollar' | 'gold' | 'oil' | 'crypto';

/** Subjects a headline can be about. Treasuries and bonds are PRICES: they rally when yields fall. */
const SUBJECTS: { cls: AssetClass; re: RegExp; invert?: true }[] = [
  {
    cls: 'equities',
    re: /\b(stocks?|equit(?:y|ies)|shares|nasdaq(?: 100| composite)?|s&p(?: 500)?|dow(?: jones)?|wall street|tech(?: stocks| shares| sector)?|chip ?(?:stocks|makers)|chipmakers|semiconductors?|ai stocks|futures|indexes|indices|ixic|ndx)\b/gi,
  },
  { cls: 'rates', re: /\byields?\b/gi },
  { cls: 'rates', re: /\b(treasur(?:y|ies)|bonds?|gilts|bunds)\b(?!\s+yields?)/gi, invert: true },
  { cls: 'dollar', re: /\b(dollar|greenback|dxy)\b/gi },
  { cls: 'gold', re: /\b(gold|bullion)\b/gi },
  { cls: 'oil', re: /\b(oil|crude|brent|wti)\b/gi },
  { cls: 'crypto', re: /\b(bitcoin|crypto|ether)\b/gi },
];
const DOWN_VERB =
  /\b(falls?|fell|drops?|dropped|slides?|slid|sinks?|sank|tumbles?|tumbled|slumps?|slumped|declines?|declined|retreats?|retreated|dips?|dipped|plunges?|plunged|eases?|eased|cool(?:s|ed)?|loses?|lost|weakens?|weakened|sell-?offs?|selloffs?|sheds?|skids?|slips?|slipped|lower|turmoil|rout|tank(?:s|ed)?)\b/i;
const UP_VERB =
  /\b(rises?|rose|rall(?:y|ies|ied)|climbs?|climbed|jumps?|jumped|surges?|surged|gains?|gained|advances?|advanced|soars?|soared|rebounds?|rebounded|recovers?|recovered|spikes?|spiked|higher|strengthens?|strengthened|firms?|firmed|record highs?)\b/i;
/** "… after X", "… as X", "… on X" — but not "on Thursday" or "over 300 points". */
const CONNECTOR =
  /\b(after|as|amid|following|over|due to|on|despite)\s+(?![\d.,]+\s*(?:points?|pts|%|bp|basis|per ?cent)|(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|the day\b|the week\b|record\b|wall street\b)(.{6,})$/i;
/** "X sparks / triggers / rattles … Y": the cause is the subject. */
const CAUSE_VERB =
  /^(.{6,}?)\s+(sparks?|triggers?|rattles?|hits|sinks|weighs? on|drags?(?: down)?|dents?|unsettles?|spooks?|lifts?|boosts?|sends?|causes?|chills?|deepens?|pushe?s|pushing|knocks?|hammers?|batters?)\b(.*)$/i;
const CAUSE_STOP = /^(the|a|an|its|their|this|that)\s+/i;

export interface Explainer {
  cls: AssetClass;
  /** In the measured unit: a yield's direction, not a bond price's. */
  direction: 1 | -1;
  cause: string;
}

function firstVerb(text: string): { at: number; direction: 1 | -1; length: number } | null {
  const d = text.match(DOWN_VERB);
  const u = text.match(UP_VERB);
  const pick = [d && { at: d.index ?? 0, direction: -1 as const, length: d[0].length }, u && { at: u.index ?? 0, direction: 1 as const, length: u[0].length }]
    .filter((x): x is { at: number; direction: 1 | -1; length: number } => !!x)
    .sort((a, b) => a.at - b.at);
  return pick[0] ?? null;
}

function lastSubjectBefore(text: string, at: number): { cls: AssetClass; invert: boolean } | null {
  let best: { at: number; cls: AssetClass; invert: boolean } | null = null;
  for (const sub of SUBJECTS) {
    for (const m of text.matchAll(sub.re)) {
      const i = m.index ?? 0;
      if (i < at && (!best || i > best.at)) best = { at: i, cls: sub.cls, invert: !!sub.invert };
    }
  }
  return best;
}

function firstSubject(text: string): { cls: AssetClass; invert: boolean } | null {
  let best: { at: number; cls: AssetClass; invert: boolean } | null = null;
  for (const sub of SUBJECTS) {
    for (const m of text.matchAll(sub.re)) {
      const i = m.index ?? 0;
      if (!best || i < best.at) best = { at: i, cls: sub.cls, invert: !!sub.invert };
    }
  }
  return best;
}

/** A cause clause trimmed at the next headline separator ("…, Brent gains"), or, before a causal verb, after the last one ("Roundup: X"). */
const tidyCause = (raw: string, keep: 'first' | 'last' = 'first') => {
  const parts = raw.split(/\s[-–—|]\s|[,;:]\s|\s\(|\s\[|\?|!/);
  return (keep === 'first' ? parts[0] : parts[parts.length - 1])
    .replace(CAUSE_STOP, '')
    .replace(/[.,;:\s]+$/, '')
    .trim();
};

/** Causal verbs that carry their own direction: "X rattles chip stocks" is down without a second verb. */
const CAUSE_DOWN = /^(rattles?|sinks|weighs? on|drags?(?: down)?|dents?|unsettles?|spooks?|chills?|knocks?|hammers?|batters?|hits)$/i;
const CAUSE_UP = /^(lifts?|boosts?)$/i;

/** One headline read as "ASSET went UP/DOWN because CAUSE", or null. */
export function parseExplainer(title: string): Explainer | null {
  const text = title.replace(/[’‘]/g, "'");
  const causal = text.match(CAUSE_VERB);
  if (causal) {
    const rest = causal[3] ?? '';
    const own = CAUSE_DOWN.test(causal[2]) ? -1 : CAUSE_UP.test(causal[2]) ? 1 : 0;
    const verb = own ? { direction: own as 1 | -1 } : firstVerb(rest);
    const subject = firstSubject(rest);
    const cause = tidyCause(causal[1], 'last');
    if (verb && subject && cause.split(/\s+/).length >= 2 && !firstSubject(cause)) {
      return { cls: subject.cls, direction: (subject.invert ? -verb.direction : verb.direction) as 1 | -1, cause };
    }
  }
  const verb = firstVerb(text);
  if (!verb) return null;
  const subject = lastSubjectBefore(text, verb.at);
  if (!subject) return null;
  const after = text.slice(verb.at + verb.length);
  const m = after.match(CONNECTOR);
  if (!m) return null;
  const cause = tidyCause(m[2]);
  if (cause.split(/\s+/).length < 2) return null;
  return { cls: subject.cls, direction: (subject.invert ? -verb.direction : verb.direction) as 1 | -1, cause };
}

const STOPWORDS = new Set(
  'the a an of to in on and for with by at as is are be its it that this from after over amid us u.s says said new more than into about report reports reported stock stocks market markets shares investors investor wall street global traders while amid hits hit sends weighs'.split(
    ' ',
  ),
);

/** Words that name a market rather than a story, kept out of title-based clustering. */
const MARKET_WORDS = new Set(
  'nasdaq s&p dow jones yield yields treasury treasurie bond bonds note notes futures equitie equity index indexe indice tech chip chipmaker semiconductor dollar greenback gold bullion oil crude brent wti bitcoin crypto falls fall drop drops rise rises rally slide slides gain gains lower higher points percent cent'.split(
    ' ',
  ),
);

export function causeTokens(cause: string): string[] {
  return cause
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

export interface Attribution {
  cls: AssetClass;
  direction: 1 | -1;
  /** The cause in the shortest words a headline used. */
  label: string;
  /** Distinct publishers that gave this cause. */
  outlets: number;
  /** When the first of them was published. */
  firstMs: number;
  examples: { title: string; source: string; publishedUtc: string }[];
  /** The story's own words, most-cited first, for timing the story itself. */
  key: string[];
  /** The story's first appearance anywhere, found by searching its words (set by the loader). */
  firstSeen?: { ms: number; source: string; title: string } | null;
}

/** The earliest headline that carries the story's key word: when the story itself broke. */
export function firstSeen(hits: Headline[], key: string[]): { ms: number; source: string; title: string } | null {
  if (key.length === 0) return null;
  const word = new RegExp(`\\b${key[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const found = hits
    .map((h) => ({ h, ms: Date.parse(h.publishedUtc) }))
    .filter((x) => Number.isFinite(x.ms) && word.test(x.h.title))
    .sort((a, b) => a.ms - b.ms)[0];
  return found ? { ms: found.ms, source: found.h.domain, title: found.h.title } : null;
}

/**
 * Clusters the after-the-fact explanations by shared key words and counts the
 * outlets behind each. Only headlines published after the move began, about an
 * asset class that moved, in the direction it moved.
 */
export function attributeMove(headlines: Headline[], move: MoveWindow, measured: Partial<Record<AssetClass, 1 | -1>>): Attribution[] {
  const to = move.endMs + REACTION.explainerHours * HOUR;
  const parsed = headlines
    .map((h) => ({ h, ms: Date.parse(h.publishedUtc), e: parseExplainer(h.title) }))
    .filter(
      (x): x is { h: Headline; ms: number; e: Explainer } =>
        !!x.e && Number.isFinite(x.ms) && x.ms >= move.startMs && x.ms <= to && measured[x.e.cls] === x.e.direction,
    )
    .sort((a, b) => a.ms - b.ms);

  /** `tokens`: words of the causes, counted; `context`: story words from the rest of the titles. */
  type Cluster = { cls: AssetClass; direction: 1 | -1; tokens: Map<string, number>; context: Set<string>; items: typeof parsed };
  const clusters: Cluster[] = [];
  const strong = (t: string) => t.length >= 4 || /\d/.test(t);
  for (const x of parsed) {
    const toks = causeTokens(x.e.cause);
    if (toks.length === 0) continue;
    // The rest of the title can name the story the cause clause only hints at
    // ("OpenAI's revenue … ; Nasdaq falls as AI stocks slide"). Market words are
    // left out, or every stock headline would join every other.
    const context = causeTokens(x.h.title).filter((t) => !MARKET_WORDS.has(t) && strong(t));
    const known = (c: Cluster, t: string) => (c.tokens.get(t) ?? 0) > 0 || c.context.has(t);
    const shares = (c: Cluster) => toks.some((t) => strong(t) && known(c, t)) || context.some((t) => known(c, t));
    const home = clusters.find((c) => c.cls === x.e.cls && shares(c));
    const c = home ?? { cls: x.e.cls, direction: x.e.direction, tokens: new Map<string, number>(), context: new Set<string>(), items: [] };
    if (!home) clusters.push(c);
    c.items.push(x);
    for (const t of toks) c.tokens.set(t, (c.tokens.get(t) ?? 0) + 1);
    for (const t of context) c.context.add(t);
  }

  return clusters
    .map((c) => {
      const outlets = new Set(c.items.map((x) => x.h.domain.toLowerCase())).size;
      // The shortest cause that names the story word most of the cluster's titles carry.
      const freq = new Map<string, number>();
      for (const x of c.items) {
        for (const t of new Set(causeTokens(x.h.title).filter((w) => !MARKET_WORDS.has(w) && strong(w)))) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const top = ranked[0];
      const causes = c.items.map((x) => x.e.cause).filter((cause) => cause.split(/\s+/).length >= 2);
      const naming = top ? causes.filter((cause) => causeTokens(cause).includes(top)) : [];
      const label = (naming.length ? naming : causes).sort((a, b) => a.length - b.length)[0] ?? c.items[0].e.cause;
      return {
        cls: c.cls,
        direction: c.direction,
        label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
        outlets,
        firstMs: c.items[0].ms,
        examples: c.items.slice(0, 2).map((x) => ({ title: x.h.title, source: x.h.domain, publishedUtc: x.h.publishedUtc })),
        key: ranked.slice(0, 2),
      };
    })
    .sort((a, b) => b.outlets - a.outlets || a.firstMs - b.firstMs);
}

/** Which way each asset class moved over the window, for `attributeMove`. */
export function measuredDirections(rows: PanelRow[], primary?: { cls: AssetClass; change: Change | null }): Partial<Record<AssetClass, 1 | -1>> {
  const out: Partial<Record<AssetClass, 1 | -1>> = {};
  const set = (cls: AssetClass, c: Change | null) => {
    const d = dir(c);
    if (d && out[cls] === undefined) out[cls] = d;
  };
  if (primary) set(primary.cls, primary.change);
  set('equities', row(rows, 'NQ=F') ?? row(rows, 'ES=F'));
  set('rates', row(rows, '^TNX') ?? row(rows, 'ZT=F') ?? row(rows, '^TYX'));
  set('dollar', row(rows, 'DX-Y.NYB'));
  set('gold', row(rows, 'GC=F'));
  set('oil', row(rows, 'CL=F') ?? row(rows, 'BZ=F'));
  set('crypto', row(rows, 'BTC-USD'));
  return out;
}

// ---------------------------------------------------------------------------
// Scheduled events inside the move
// ---------------------------------------------------------------------------

export interface ScheduledEvent {
  ms: number;
  label: string;
  /** "strong demand: bid-to-cover 2.54 vs 2.51 average". */
  detail?: string;
}

export function scheduledInside(events: ScheduledEvent[], move: MoveWindow): (ScheduledEvent & { minutesFromStart: number })[] {
  const slack = REACTION.scheduledSlackMinutes * MINUTE;
  return events
    .filter((e) => e.ms >= move.startMs - slack && e.ms <= move.endMs + slack)
    .sort((a, b) => a.ms - b.ms)
    .map((e) => ({ ...e, minutesFromStart: Math.round((e.ms - move.startMs) / MINUTE) }));
}

// ---------------------------------------------------------------------------
// Text for the dossier
// ---------------------------------------------------------------------------

const px = (v: number) => Number(v.toPrecision(6)).toString();

export interface ReactionReading {
  symbol: string;
  primaryTicker: string;
  /** The window searched, and why that one. */
  window?: { fromMs: number; toMs: number; label: string };
  /** What the user described, and whether the bars hold it. */
  match?: { status: MatchStatus; described: { direction: 1 | -1; pct: number | null; minutes: number | null; source: string } | null; largest: MoveWindow | null };
  onsets?: Onset[];
  split?: string | null;
  attribution?: Attribution[];
  scheduled?: (ScheduledEvent & { minutesFromStart: number })[];
  /** Markets the user named, besides the symbol. */
  named?: string[];
  move: MoveWindow | null;
  rows: PanelRow[];
  fingerprint: Fingerprint | null;
  catalysts: Catalyst[];
  links: { link: LinkQuery; hits: { title: string; source: string; publishedUtc: string }[] }[];
  fit: string[];
  gaps: string[];
  computedAtMs: number;
}

export function reactionLines(r: ReactionReading): string[] {
  const now = r.computedAtMs;
  const out = [
    `## R. WHAT JUST MOVED (deterministic, OUR 5-minute bars, computed ${hhmm(now, now)} — restate it; do not re-derive it)`,
    r.window
      ? `Window searched: ${r.window.label} = ${hhmm(r.window.fromMs, now)} to ${hhmm(r.window.toMs, now)}. Every instrument is measured over the SAME move window below.`
      : 'Every instrument is measured over the SAME window: the largest swing in this symbol over the last ' + `${REACTION.searchHours} hours.`,
    'Yields are in basis points; the 2-year is derived from its note future and marked approx. These are our 5-minute bars, not the timeframe of any chart the user attached.',
  ];
  const d = r.match?.described;
  if (d) {
    const said = `${d.direction < 0 ? 'down' : 'up'}${d.pct !== null ? ` ~${d.pct}%` : ''}${d.minutes !== null ? ` in ~${d.minutes} minutes` : ''}`;
    if (r.match!.status === 'no-match') {
      const l = r.match!.largest;
      out.push(
        `NO MATCH: the user described a move ${said} (from ${d.source === 'chart' ? 'their chart' : 'their words'}); our bars hold no such move in this window.` +
          (l ? ` The largest swing there was ${l.changePct > 0 ? '+' : '−'}${Math.abs(l.changePct).toFixed(2)}% from ${hhmm(l.startMs, now)} to ${hhmm(l.endMs, now)}.` : '') +
          ' Say so, and ask the user for the date and time. Do NOT explain a different move instead.',
      );
    } else {
      out.push(
        `Matched the move the user described (${said}, from ${d.source === 'chart' ? 'their chart' : 'their words'})${r.match!.status === 'smaller' ? ' — SMALLER in our bars than described; say so' : ''}.`,
      );
    }
  }
  if (!r.move) {
    if (!d || r.match?.status !== 'no-match') out.push(`No 5-minute bars for ${r.symbol} (${r.primaryTicker}) in the window, so the move could not be located. Say so; do not estimate it.`);
  } else {
    const m = r.move;
    out.push(
      `Move: ${r.symbol} (${m.ticker}) ${m.changePct > 0 ? '+' : '−'}${Math.abs(m.changePct).toFixed(2)}% from ${px(m.from)} at ${hhmm(m.startMs, now)} ` +
        `to ${px(m.to)} at ${hhmm(m.endMs, now)} (${Math.round((m.endMs - m.startMs) / MINUTE)} minutes).`,
      `Same window, then the 1h / 2h / 4h up to ${hhmm(Math.min(r.window?.toMs ?? now, now), now)}:`,
      ...r.rows
        .filter((row) => row.window || row.fixed.some(Boolean))
        .map((row) => `- ${row.inst.label}: ${fmtChange(row.window)} | ${row.fixed.map(fmtChange).join(' / ')}`),
    );
  }
  if (r.fingerprint) {
    const fp = r.fingerprint;
    out.push(`Pattern: ${fp.text}`);
    if (fp.curve) out.push(`Curve: ${fp.curve}`);
    out.push(
      `Havens: ${fp.havens.up} of ${fp.havens.of} confirm${fp.confirmations.length ? ` — ${fp.confirmations.join(', ')}` : ''}.`,
    );
    if (fp.breadth) out.push(`Breadth: ${fp.breadth}`);
    if (fp.oil) out.push(fp.oil);
  }
  if (r.onsets?.length) {
    out.push(
      'When each moved (its own move around the window; "broke" = a quarter of the way through it):',
      ...r.onsets.map((o) => `- ${o.inst.label}: broke ${hhmm(o.brokeMs, now)} (ran ${hhmm(o.startMs, now)}–${hhmm(o.endMs, now)}, ${fmtChange(o.change)})`),
    );
  }
  if (r.split) out.push(`Timing: ${r.split}`);
  if (r.scheduled?.length) {
    out.push(
      'Scheduled inside the move:',
      ...r.scheduled.map((e) => `- ${hhmm(e.ms, now)} (${e.minutesFromStart >= 0 ? '+' : ''}${e.minutesFromStart} min) ${e.label}${e.detail ? ` — ${e.detail}` : ''}`),
    );
  }
  if (r.attribution?.length) {
    const CLASS_TEXT: Record<AssetClass, string> = { equities: 'stocks', rates: 'yields', dollar: 'the dollar', gold: 'gold', oil: 'oil', crypto: 'crypto' };
    out.push(
      "Market attribution — headlines that name the move's cause. They are written AFTER the move by nature, so their own time does not count against them; " +
        "what counts is when the STORY first appeared (\"story first seen\"): before the start = a possible trigger; inside the move = it can have driven or accelerated it; after the end = a reaction story.",
    );
    const shown = new Map<AssetClass, number>();
    for (const a of r.attribution) {
      const n = shown.get(a.cls) ?? 0;
      if (n >= REACTION.attributionShown) continue;
      shown.set(a.cls, n + 1);
      const seen = a.firstSeen && r.move ? a.firstSeen : null;
      const when = seen
        ? `; story first seen ${hhmm(seen.ms, now)} (${seen.ms < r.move!.startMs ? `${Math.round((r.move!.startMs - seen.ms) / MINUTE)} min BEFORE the start` : seen.ms <= r.move!.endMs ? `${Math.round((seen.ms - r.move!.startMs) / MINUTE)} min INTO the move` : `${Math.round((seen.ms - r.move!.endMs) / MINUTE)} min AFTER the end`}) · ${seen.source}: ${seen.title}`
        : '';
      out.push(
        `- ${CLASS_TEXT[a.cls]} ${a.direction < 0 ? 'down' : 'up'}: "${a.label}" — ${a.outlets} outlet${a.outlets === 1 ? '' : 's'}${when}` +
          ` (e.g. ${a.examples[0].source}: ${a.examples[0].title})`,
      );
    }
  }
  if (r.named?.length) out.push(`Markets the user named: ${r.named.join(', ')}.`);
  for (const l of r.links) {
    out.push(`Link the user gave (${l.link.domain}; the page itself was not opened) — searched "${l.link.query}":`);
    out.push(...(l.hits.length ? l.hits.map((h) => `- ${hhmm(Date.parse(h.publishedUtc), now)} · ${h.source} · ${h.title}`) : ['- no matching headline found']));
  }
  out.push(r.move ? 'Possible TRIGGERS — headlines timed against the start of the move (closest first; minutes relative to the start):' : 'Recent headlines:');
  out.push(
    ...(r.catalysts.length
      ? r.catalysts.map(
          (c) =>
            `- ${hhmm(Date.parse(c.publishedUtc), now)} (${c.minutesFromStart >= 0 ? '+' : ''}${c.minutesFromStart} min) · ${c.source} · ${c.title}${c.tags.length ? ` [${c.tags.join(', ')}]` : ''}`,
        )
      : ['- none in the window']),
  );
  if (r.fit.length) out.push(...r.fit.map((n) => `Fit: ${n}`));
  if (r.gaps.length) out.push(`Reaction gaps: ${r.gaps.join('; ')}.`);
  return out;
}
