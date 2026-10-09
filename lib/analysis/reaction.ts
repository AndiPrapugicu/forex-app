/**
 * "X just moved — what happened?", read by fixed rules.
 *
 *   1. The MOVE: the largest swing in the symbol's own 5-minute bars over the
 *      last few hours, with its start and end time.
 *   2. The FINGERPRINT: every instrument in the panel measured over that same
 *      window, then stocks against yields (risk-off, rates shock, dovish relief,
 *      reflation), the curve (which end led), and the haven confirmations.
 *   3. The CATALYSTS: headlines timed against the start of the move, the
 *      closest first, tagged by region and direction; plus the headlines behind
 *      any link the user pasted, found by the words in its address.
 *   4. The FIT: whether the leading headline explains the fingerprint, said
 *      plainly when it does not.
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
  if (!s) return null;
  const from = nowMs - hours * HOUR;
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
const MARKET = /\b(stocks?|equit\w*|Nasdaq|S&P|Dow|Wall Street|futures|yields?|Treasur\w*|bonds?|dollar|oil|crude|gold|tech|chips?|semiconductor\w*|AI|sell-?off|rally|tumbl\w*|slump\w*|surg\w*|Trump|White House|China|Iran|Russia|Ukraine|Israel|war|bank)\b/i;

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

const causalDistance =(minutes: number) => (minutes > 0 ? 2 * minutes : -minutes);

/** Headlines from shortly before the move to just after its end, closest to its start first. */
export function rankCatalysts(headlines: Headline[], move: MoveWindow): Catalyst[] {
  const from = move.startMs - REACTION.catalystLeadMinutes * MINUTE;
  const to = move.endMs + 15 * MINUTE;
  return headlines
    .map((h) => ({ h, ms: Date.parse(h.publishedUtc) }))
    .filter(
      ({ h, ms }) =>
        Number.isFinite(ms) && ms >= from && ms <= to && !BROKER_NOTE.test(h.title) && (MARKET.test(h.title) || tagHeadline(h.title).length > 0),
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
// Text for the dossier
// ---------------------------------------------------------------------------

const hhmm = (ms: number, nowMs: number) => {
  const iso = new Date(ms).toISOString();
  return new Date(nowMs).toISOString().slice(0, 10) === iso.slice(0, 10) ? `${iso.slice(11, 16)}Z` : `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;
};
const px = (v: number) => Number(v.toPrecision(6)).toString();

export interface ReactionReading {
  symbol: string;
  primaryTicker: string;
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
    `## R. WHAT JUST MOVED (deterministic, 5-minute bars, computed ${hhmm(now, now)} — restate it; do not re-derive it)`,
    'Every instrument is measured over the SAME window: the largest swing in this symbol over the last ' +
      `${REACTION.searchHours} hours. Yields are in basis points; the 2-year is derived from its note future and marked approx.`,
  ];
  if (!r.move) {
    out.push(`No 5-minute bars for ${r.symbol} (${r.primaryTicker}), so the move could not be located. Say so; do not estimate it.`);
  } else {
    const m = r.move;
    out.push(
      `Move: ${r.symbol} (${m.ticker}) ${m.changePct > 0 ? '+' : '−'}${Math.abs(m.changePct).toFixed(2)}% from ${px(m.from)} at ${hhmm(m.startMs, now)} ` +
        `to ${px(m.to)} at ${hhmm(m.endMs, now)} (${Math.round((m.endMs - m.startMs) / MINUTE)} minutes).`,
      'Same window, then the last 1h / 2h / 4h:',
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
  for (const l of r.links) {
    out.push(`Link the user gave (${l.link.domain}; the page itself was not opened) — searched "${l.link.query}":`);
    out.push(...(l.hits.length ? l.hits.map((h) => `- ${hhmm(Date.parse(h.publishedUtc), now)} · ${h.source} · ${h.title}`) : ['- no matching headline found']));
  }
  out.push(r.move ? 'Headlines timed against the start of the move (closest first; minutes relative to the start):' : 'Recent headlines:');
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
