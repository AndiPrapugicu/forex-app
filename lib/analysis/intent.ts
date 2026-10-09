/**
 * What the question asks, read by fixed rules — no model request.
 *
 *   kind        which answer: reaction, event, decision, brief, explain, compare
 *   anchor      WHEN: "yesterday", "this morning", "Monday", "Oct 8", "at 17:00",
 *               "last 3 hours" — or the date on an attached chart, which wins
 *   described   the move as the user tells it: direction, size, length
 *   instruments every market named: Nasdaq, US02Y, gold, EURUSD…
 *   event       a release asked about: CPI, NFP, the Fed, an auction…
 *
 * The reaction reader measures the move the user means, in the window they
 * mean; without an anchor it falls back to the last few hours, as before.
 */

import {
  DOWN_WORDS,
  EVENT_ALIASES,
  EVENT_COUNTRY,
  FX_PAIR,
  INSTRUMENT_ALIASES,
  REACTION,
  REACTION_WORDS,
  UP_WORDS,
  wordsPattern,
  type EventAlias,
} from '@/config/reaction.config';
import { findSymbol } from '@/config/symbols.config';
import { chartMove, chartWindow, type ChartReading } from '@/lib/analysis/chart-reading';
import { addDays, dayBounds, dayLabel, localDay, monthNumber, zonedToUtc, type LocalDay, type Zone } from '@/lib/analysis/tz';

export type IntentKind = 'reaction' | 'event' | 'decision' | 'brief' | 'explain' | 'compare' | 'full';
export const INTENT_KINDS: IntentKind[] = ['reaction', 'event', 'decision', 'brief', 'explain', 'compare', 'full'];

export interface TimeAnchor {
  fromMs: number;
  toMs: number;
  /** "yesterday, Thu 08 Oct (Europe/Bucharest)". */
  label: string;
  source: 'question' | 'chart';
}

export interface DescribedMove {
  direction: 1 | -1;
  pct: number | null;
  minutes: number | null;
  source: 'question' | 'chart';
}

export interface NamedInstrument {
  label: string;
  symbol?: string;
  ticker?: string;
}

export interface Intent {
  kind: IntentKind;
  anchor: TimeAnchor | null;
  described: DescribedMove | null;
  instruments: NamedInstrument[];
  /** App symbols named in the question other than the page's own. */
  otherSymbols: string[];
  event: (EventAlias & { currency: string }) | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------------------
// Kind
// ---------------------------------------------------------------------------

/** A trade action: then it is a decision even if it starts with a move. */
const TRADE_WORDS = wordsPattern('entry|enter|intrare|intru|hold|holding|țin|ţin|tp|sl|take profit|stop loss|thesis|teza|teză|setup');
const LINK = /https?:\/\//i;
const DECISION_WORDS = wordsPattern(
  'entry|enter|entries|intrare|intru|intra|hold|holding|țin|ţin|tin|close|închid|inchid|tp|sl|take profit|stop loss|flip\\p{L}*|invalid\\p{L}*|teza|teză|thesis|setup|long|short|buy|sell|cumpăr\\p{L}*|cumpar\\p{L}*|vând\\p{L}*|vand\\p{L}*|zones?|zona|zonă|nivel\\p{L}*|levels?|scenari\\p{L}*|analiz\\p{L}*|analysis|bias',
);
const BRIEF_WORDS = wordsPattern(
  '24 ?h|azi|today|ieri|yesterday|ce s-a (?:întâmplat|intamplat)|what happened|what changed|recap|rezumat|news|știri|stiri|headlines?|pe scurt|briefly|quick',
);
const FULL_WORDS = wordsPattern('full (?:read|analysis|fundamental read)|analiză completă|analiza completa|complete analysis|deep dive');
const EXPLAIN = new RegExp(
  [
    // "what is a bull steepener", not "what is the outlook for EURUSD"
    "^\\s*what(?:\\s+is|'s)\\s+(?:a|an)\\s+\\p{L}",
    'what does .+ mean',
    '^\\s*explain',
    '^\\s*(?:explică|explica)',
    'ce (?:înseamnă|inseamna|este|e un|e o)',
    '(?:why|how) (?:do|does|would|can) .{1,60} (?:when|if)\\s',
    'de ce .{1,60} (?:când|cand|dacă|daca)\\s',
    'what is the (?:relationship|link|correlation)',
    'care e (?:legătura|legatura|relația|relatia)',
  ].join('|'),
  'iu',
);
const COMPARE = wordsPattern('vs\\.?|versus|compare|compară|compara|which is (?:stronger|weaker|better)|stronger|weaker|mai (?:puternic|slab|bun)\\p{L}*|or');
const FORWARD = wordsPattern(
  'expect\\p{L}*|ahead of|before|into|if|when|how (?:will|would|does|do|did)|react\\p{L}*|impact|affect\\p{L}*|happens? (?:to|on)|aștept\\p{L}*|astept\\p{L}*|înainte de|inainte de|dacă|daca|cum (?:va|vor|reacționează|reactioneaza|afectează|afecteaza)|ce se (?:întâmplă|intampla)|next|upcoming|următor\\p{L}*|urmator\\p{L}*',
);

export function classify(question: string, opts: { otherSymbols: number; event: boolean }, requested?: unknown): IntentKind {
  if (typeof requested === 'string' && (INTENT_KINDS as string[]).includes(requested)) return requested as IntentKind;
  const q = question;
  if (FULL_WORDS.test(q)) return 'full';
  if ((REACTION_WORDS.test(q) || LINK.test(q)) && !TRADE_WORDS.test(q)) return 'reaction';
  if (opts.event && FORWARD.test(q) && !TRADE_WORDS.test(q)) return 'event';
  if (EXPLAIN.test(q)) return 'explain';
  if (opts.otherSymbols >= 2 || (opts.otherSymbols >= 1 && COMPARE.test(q))) return 'compare';
  if (DECISION_WORDS.test(q)) return 'decision';
  if (BRIEF_WORDS.test(q)) return 'brief';
  if (opts.event) return 'event';
  return 'decision';
}

// ---------------------------------------------------------------------------
// Instruments and events
// ---------------------------------------------------------------------------

export function namedInstruments(question: string): NamedInstrument[] {
  const out: NamedInstrument[] = [];
  const seen = new Set<string>();
  const add = (i: NamedInstrument) => {
    const key = i.symbol ?? i.ticker ?? i.label;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };
  // In the order they appear, so "Nasdaq … while US02Y …" lists the Nasdaq first.
  const hits: { at: number; i: NamedInstrument }[] = [];
  for (const m of question.matchAll(FX_PAIR)) {
    const sym = `${m[1]}${m[2]}`.toUpperCase();
    if (findSymbol(sym)) hits.push({ at: m.index ?? 0, i: { label: sym, symbol: sym } });
  }
  for (const a of INSTRUMENT_ALIASES) {
    const g = new RegExp(a.pattern.source, `${a.pattern.flags.replace('g', '')}g`);
    for (const m of question.matchAll(g)) {
      hits.push({ at: m.index ?? 0, i: { label: a.label, ...(a.symbol ? { symbol: a.symbol } : { ticker: a.ticker }) } });
    }
  }
  for (const h of hits.sort((a, b) => a.at - b.at)) add(h.i);
  return out;
}

export function namedEvent(question: string, defaultCurrency = 'USD'): Intent['event'] {
  const alias = EVENT_ALIASES.find((e) => e.ask.test(question));
  if (!alias) return null;
  const currency = EVENT_COUNTRY.find((c) => c.pattern.test(question))?.currency ?? defaultCurrency;
  return { ...alias, currency };
}

// ---------------------------------------------------------------------------
// The described move
// ---------------------------------------------------------------------------

export function describedMove(question: string): DescribedMove | null {
  const down = question.match(DOWN_WORDS);
  const up = question.match(UP_WORDS);
  const first = [down, up].filter((m): m is RegExpMatchArray => !!m).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  if (!first) return null;
  const direction: 1 | -1 = first === down ? -1 : 1;
  const pct = question.match(/(\d+(?:[.,]\d+)?)\s?%/);
  // "2 hours", "2h", "30 de minute"
  const dur = question.match(/(\d+(?:[.,]\d+)?)\s*(?:de\s+)?(hours?|hrs?|h|ore|oră|ora|minutes?|mins?|min|minute)(?![\p{L}])/iu);
  const n = (s: string) => Number(s.replace(',', '.'));
  // "In the last 24h" is when, not how long the move took.
  const lastN = dur && /(last|past|ultimele|ultima)\s*$/i.test(question.slice(0, dur.index));
  return {
    direction,
    pct: pct ? n(pct[1]) : null,
    minutes: dur && !lastN ? Math.round(n(dur[1]) * (/^(m|min)/i.test(dur[2]) ? 1 : 60)) : null,
    source: 'question',
  };
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

const WEEKDAYS: [RegExp, number][] = [
  [wordsPattern('sunday|duminic(?:ă|a|ii)'), 0],
  [wordsPattern('monday|luni'), 1],
  [wordsPattern('tuesday|marți|marti|marțea|martea'), 2],
  [wordsPattern('wednesday|miercuri'), 3],
  [wordsPattern('thursday|joi'), 4],
  [wordsPattern('friday|vineri'), 5],
  [wordsPattern('saturday|sâmbătă|sambata'), 6],
];
const MONTH_WORD = '(january|february|march|april|may|june|july|august|september|october|november|december|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|septembrie|octombrie|noiembrie|decembrie|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|ian|iun|iul|noi)\\.?';
const DAY_MONTH = new RegExp(`(?<![\\p{N}])(\\d{1,2})\\s*${MONTH_WORD}(?![\\p{L}])`, 'iu');
const MONTH_DAY = new RegExp(`(?<![\\p{L}])${MONTH_WORD}\\s+(\\d{1,2})(?![\\p{N}%])`, 'iu');
const ISO_DAY = /(\d{4})-(\d{2})-(\d{2})/;
const CLOCK = /(?<![\d.,])(\d{1,2})[:h](\d{2})(?![\d%])\s*(utc|gmt|z|et|ny)?/i;

function dayFromText(q: string, today: LocalDay): { day: LocalDay; label: string } | null {
  let m = q.match(ISO_DAY);
  if (m) {
    const day = addDays({ y: +m[1], m: +m[2], d: +m[3], weekday: 0 }, 0);
    return { day, label: dayLabel(day) };
  }
  m = q.match(DAY_MONTH) ?? null;
  let d: number | null = null;
  let month: number | null = null;
  if (m) {
    d = +m[1];
    month = monthNumber(m[2]);
  } else if ((m = q.match(MONTH_DAY))) {
    month = monthNumber(m[1]);
    d = +m[2];
  }
  if (d && month && d <= 31) {
    let day = addDays({ y: today.y, m: month, d, weekday: 0 }, 0);
    if (Date.UTC(day.y, day.m - 1, day.d) > Date.UTC(today.y, today.m - 1, today.d)) day = addDays({ y: today.y - 1, m: month, d, weekday: 0 }, 0);
    return { day, label: dayLabel(day) };
  }
  if (wordsPattern('yesterday|ieri').test(q)) {
    const day = addDays(today, -1);
    return { day, label: `yesterday, ${dayLabel(day)}` };
  }
  if (wordsPattern('alaltăieri|alaltaieri|day before yesterday').test(q)) {
    const day = addDays(today, -2);
    return { day, label: dayLabel(day) };
  }
  for (const [re, wd] of WEEKDAYS) {
    if (!re.test(q)) continue;
    let back = (today.weekday - wd + 7) % 7;
    if (back === 0 && wordsPattern('last|trecut\\p{L}*').test(q)) back = 7;
    const day = addDays(today, -back);
    return { day, label: dayLabel(day) };
  }
  return null;
}

/** When the question says the move happened, as a UTC window; null when it does not say. */
export function questionAnchor(question: string, nowMs: number, zone: Zone = REACTION.userTimeZone): TimeAnchor | null {
  const q = question;
  const today = localDay(nowMs, zone);
  const zoneName = typeof zone === 'string' ? zone : `UTC${zone >= 0 ? '+' : '−'}${Math.abs(zone) / 60}`;
  const at = (day: LocalDay, hh: number, mm = 0) => zonedToUtc(day.y, day.m, day.d, hh, mm, zone);
  const cap = (a: TimeAnchor): TimeAnchor | null => (a.fromMs >= nowMs ? null : { ...a, toMs: Math.min(a.toMs, nowMs) });

  // "last 3 hours", "în ultima oră"
  const lastN = q.match(/(?:last|past|ultimele|ultima|ultimul)\s+(\d+)?\s*(hours?|hrs?|h|ore|oră|ora|minutes?|mins?|minute)(?![\p{L}])/iu);
  if (lastN && !/24/.test(lastN[1] ?? '')) {
    const n = lastN[1] ? +lastN[1] : 1;
    const ms = /^m/i.test(lastN[2]) ? n * MINUTE : n * HOUR;
    return { fromMs: nowMs - ms, toMs: nowMs, label: `the last ${lastN[1] ?? 1} ${/^m/i.test(lastN[2]) ? 'minutes' : 'hours'}`, source: 'question' };
  }

  const named = dayFromText(q, today);
  const clock = q.match(CLOCK);
  if (clock) {
    const day = named?.day ?? today;
    const hh = +clock[1];
    const mm = +clock[2];
    if (hh <= 23 && mm <= 59) {
      const tz = clock[3]?.toLowerCase();
      const t =
        tz === 'utc' || tz === 'gmt' || tz === 'z'
          ? Date.UTC(day.y, day.m - 1, day.d, hh, mm)
          : tz === 'et' || tz === 'ny'
            ? zonedToUtc(day.y, day.m, day.d, hh, mm, 'America/New_York')
            : at(day, hh, mm);
      return cap({
        fromMs: t - 90 * MINUTE,
        toMs: t + 150 * MINUTE,
        label: `around ${clock[0].trim()}${named ? ` on ${named.label}` : ''}${tz ? '' : ` (${zoneName})`}`,
        source: 'question',
      });
    }
  }

  if (wordsPattern('last night|overnight|aseară|aseara|azi-?noapte|astă-?noapte|asta noapte|în timpul nopții|in timpul noptii').test(q)) {
    const y = addDays(today, -1);
    return cap({ fromMs: at(y, 18), toMs: at(today, 8), label: `overnight into ${dayLabel(today)} (${zoneName})`, source: 'question' });
  }
  if (wordsPattern('this morning|azi dimineață|azi dimineata|în dimineața asta|dimineața|dimineata').test(q) && !named) {
    return cap({ fromMs: at(today, 6), toMs: at(today, 12), label: `this morning, ${dayLabel(today)} (${zoneName})`, source: 'question' });
  }
  if (named) {
    const { fromMs, toMs } = dayBounds(named.day, zone);
    return cap({ fromMs, toMs, label: `${named.label} (${zoneName})`, source: 'question' });
  }
  if (wordsPattern('today|azi|astăzi|astazi').test(q)) {
    const { fromMs } = dayBounds(today, zone);
    return cap({ fromMs, toMs: nowMs, label: `today, ${dayLabel(today)} (${zoneName})`, source: 'question' });
  }
  return null;
}

// ---------------------------------------------------------------------------
// All together
// ---------------------------------------------------------------------------

export function parseQuestion(
  question: string,
  pageSymbol: string,
  nowMs: number,
  opts: { requested?: unknown; charts?: ChartReading[]; zone?: Zone } = {},
): Intent {
  const zone = opts.zone ?? REACTION.userTimeZone;
  const instruments = namedInstruments(question);
  const otherSymbols = [...new Set(instruments.map((i) => i.symbol).filter((s): s is string => !!s && s !== pageSymbol))];
  const def = findSymbol(pageSymbol);
  const event = namedEvent(question, def?.kind === 'fx' && def.base && def.base !== 'USD' && def.quote !== 'USD' ? def.base : 'USD');
  const kind = classify(question, { otherSymbols: otherSymbols.length, event: !!event }, opts.requested);

  const charts = opts.charts ?? [];
  const fromChart = charts.length ? chartWindow(charts, zone, nowMs) : null;
  const anchor: TimeAnchor | null = fromChart ? { ...fromChart, source: 'chart' } : questionAnchor(question, nowMs, zone);

  const said = describedMove(question);
  const measured = charts.length ? chartMove(charts, pageSymbol) : null;
  // The user's words decide the direction; the chart's ruler fills in the size and length.
  const described: DescribedMove | null =
    said || measured
      ? {
          direction: said?.direction ?? measured!.direction,
          pct: measured?.pct ?? said?.pct ?? null,
          minutes: measured?.minutes ?? said?.minutes ?? null,
          source: measured ? 'chart' : 'question',
        }
      : null;

  return { kind, anchor, described, instruments, otherSymbols, event };
}
