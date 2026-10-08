/**
 * One symbol's narrative: the pair verdict, the conditions that would flip or
 * confirm it, and what changed in a week.
 *
 * A pair reads base minus quote theme by theme; anything else reads its one
 * subject. The verdict is a LABEL with a count ("BULLISH, 4 of 7 themes"), never
 * a number that could be mistaken for the board score.
 *
 * Flip conditions are generated here, never written by the AI. Each carries a
 * machine check, so the ingest run can tell when one fired and say so on
 * Telegram.
 */

import {
  ASSET_SUBJECT_LABEL,
  CURRENCY_THEMES,
  ASSET_THEMES,
  ENERGY_EXPOSURE,
  FED_PATH,
  FLIPS,
  RELEASE_THEME,
  THEME_LABEL,
  THEME_WEIGHT,
  VERDICT,
  subjectsOf,
  type AssetSubject,
  type Subject,
  type ThemeId,
} from '@/config/narrative.config';
import { SAFE_HAVEN } from '@/config/assets.config';
import { matchEventRule } from '@/config/scoring.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { pricedBp, type FedPath } from '@/lib/connectors/fed-futures';
import { resolveNextRateDecision } from '@/lib/scoring/rates';
import { isCurrency, type Currency, type NormalizedEvent } from '@/lib/types';
import type { LevelSet } from '@/lib/analysis/levels';
import { changePct, obsAt, valueAt } from '@/lib/analysis/series';
import { MARKET, type Effect, type MarketState, type NarrativeInputs, type ThemeReading } from '@/lib/analysis/themes';

export type Verdict = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type Side = 'bullish' | 'bearish';

export interface VerdictReading {
  label: Verdict;
  /** Weighted sum of the pair's theme effects. Shown for audit, never as "the score". */
  sum: number;
  bullish: number;
  bearish: number;
  /** Themes that had a reading at this horizon. */
  counted: number;
  text: string;
}

export interface PairTheme {
  id: ThemeId;
  label: string;
  weight: number;
  /** base − quote (or the subject's own effect). Null when neither leg read it. */
  tactical: number | null;
  structural: number | null;
  /** One leg had no reading and counted as 0. */
  partial: boolean;
  base: ThemeReading | null;
  quote: ThemeReading | null;
}

export type FlipCheck =
  | { type: 'release'; eventId: string; op: '>=' | '<='; threshold: number }
  | { type: 'close'; key: string; op: '>=' | '<='; threshold: number }
  | { type: 'yield2y'; currency: Currency; op: '>=' | '<='; threshold: number };

export interface FlipCondition {
  id: string;
  kind: 'calendar' | 'policy' | 'market' | 'price';
  theme: ThemeId | 'price';
  /** When it can fire, for scheduled ones. */
  dueUtc: string | null;
  text: string;
  /** Which side it pushes THIS symbol. */
  favours: Side;
  /** Against the tactical verdict = flip; with it = confirm; verdict neutral = tip. */
  role: 'flip' | 'confirm' | 'tip';
  check: FlipCheck;
}

export interface Change {
  theme: ThemeId | 'verdict';
  text: string;
}

export interface PairNarrative {
  symbol: string;
  label: string;
  base: Subject;
  quote: Subject | null;
  themes: PairTheme[];
  tactical: VerdictReading;
  structural: VerdictReading;
  flips: FlipCondition[];
  changes: Change[];
  /** What "this week" was compared against. */
  changeBasis: string | null;
}

// ---------------------------------------------------------------------------
// Effects, in a form a stored snapshot can also provide
// ---------------------------------------------------------------------------

export interface ThemeEffect {
  t: Effect | null;
  s: Effect | null;
  state: string;
  gap?: boolean;
  rewindable?: boolean;
}
export type SubjectEffects = Partial<Record<Subject, Partial<Record<ThemeId, ThemeEffect>>>>;

export function effectsOf(state: MarketState): SubjectEffects {
  const out: SubjectEffects = {};
  for (const [subject, s] of Object.entries(state.subjects)) {
    if (!s) continue;
    const row: Partial<Record<ThemeId, ThemeEffect>> = {};
    for (const t of s.themes) row[t.id] = { t: t.tactical, s: t.structural, state: t.state, gap: t.gap !== null || undefined, rewindable: t.rewindable };
    out[subject as Subject] = row;
  }
  return out;
}

export function subjectLabel(s: Subject): string {
  return isCurrency(s) ? s : ASSET_SUBJECT_LABEL[s as AssetSubject];
}

function themeIdsFor(base: Subject, quote: Subject | null): ThemeId[] {
  if (quote !== null || isCurrency(base)) return CURRENCY_THEMES;
  return ASSET_THEMES[base as AssetSubject];
}

function diffEffect(a: Effect | null | undefined, b: Effect | null | undefined, hasQuote: boolean): { v: number | null; partial: boolean } {
  if (!hasQuote) return { v: a ?? null, partial: false };
  const an = a ?? null;
  const bn = b ?? null;
  if (an === null && bn === null) return { v: null, partial: false };
  return { v: (an ?? 0) - (bn ?? 0), partial: an === null || bn === null };
}

export function pairThemes(base: Subject, quote: Subject | null, effects: SubjectEffects, state?: MarketState): PairTheme[] {
  return themeIdsFor(base, quote).map((id) => {
    const be = effects[base]?.[id];
    const qe = quote ? effects[quote]?.[id] : undefined;
    const t = diffEffect(be?.t, qe?.t, quote !== null);
    const s = diffEffect(be?.s, qe?.s, quote !== null);
    return {
      id,
      label: THEME_LABEL[id],
      weight: THEME_WEIGHT[id],
      tactical: t.v,
      structural: s.v,
      partial: t.partial || s.partial,
      base: state?.subjects[base]?.themes.find((x) => x.id === id) ?? null,
      quote: quote ? state?.subjects[quote]?.themes.find((x) => x.id === id) ?? null : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function verdictOf(items: { weight: number; effect: number | null }[], previous?: Verdict | null): VerdictReading {
  const read = items.filter((i) => i.effect !== null) as { weight: number; effect: number }[];
  const sum = read.reduce((n, i) => n + i.weight * i.effect, 0);
  const up = read.filter((i) => i.effect > 0);
  const down = read.filter((i) => i.effect < 0);
  const counted = read.length;

  let label: Verdict = 'NEUTRAL';
  if (sum >= VERDICT.enter && up.length >= VERDICT.minAgreeingThemes) label = 'BULLISH';
  else if (sum <= -VERDICT.enter && down.length >= VERDICT.minAgreeingThemes) label = 'BEARISH';
  else if (previous === 'BULLISH' && sum >= VERDICT.stay) label = 'BULLISH';
  else if (previous === 'BEARISH' && sum <= -VERDICT.stay) label = 'BEARISH';

  // "incl. rates ×2" is why two themes can carry a verdict.
  const heavy = (list: typeof read) => (list.some((i) => i.weight > 1) ? ' incl. rates ×2' : '');
  const text =
    label === 'BULLISH'
      ? `BULLISH — ${up.length} of ${counted} themes for${heavy(up)}, ${down.length} against`
      : label === 'BEARISH'
        ? `BEARISH — ${down.length} of ${counted} themes for${heavy(down)}, ${up.length} against`
        : `NEUTRAL — ${up.length} bullish, ${down.length} bearish of ${counted}`;
  return { label, sum: Math.round(sum * 100) / 100, bullish: up.length, bearish: down.length, counted, text };
}

// ---------------------------------------------------------------------------
// Flip conditions, per subject
// ---------------------------------------------------------------------------

interface SubjectFlip {
  id: string;
  kind: FlipCondition['kind'];
  theme: ThemeId | 'price';
  dueUtc: string | null;
  text: string;
  /** Which side it pushes the SUBJECT. */
  favours: Side;
  check: FlipCheck;
}

const opposite = (s: Side): Side => (s === 'bullish' ? 'bearish' : 'bullish');
const sideOf = (sign: number): Side => (sign >= 0 ? 'bullish' : 'bearish');
const num = (v: number) => Number(v.toFixed(Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : 3));

/**
 * How a hot print in an economy pushes an asset: havens fall on strong data,
 * risk assets rise on growth and fall on inflation (A1's own polarities,
 * config/symbols.config.ts).
 */
const ASSET_SIGN: Record<AssetSubject, { economy: Currency; labour: number; growth: number; inflation: number; hawkish: number }> = {
  gold: { economy: 'USD', labour: -1, growth: -1, inflation: -1, hawkish: -1 },
  silver: { economy: 'USD', labour: -1, growth: -1, inflation: -1, hawkish: -1 },
  platinum: { economy: 'USD', labour: -1, growth: -1, inflation: -1, hawkish: -1 },
  oil: { economy: 'USD', labour: 1, growth: 1, inflation: -1, hawkish: 0 },
  copper: { economy: 'USD', labour: 1, growth: 1, inflation: -1, hawkish: 0 },
  'us-equities': { economy: 'USD', labour: 1, growth: 1, inflation: -1, hawkish: -1 },
  'jp-equities': { economy: 'JPY', labour: 1, growth: 1, inflation: -1, hawkish: -1 },
  'eu-equities': { economy: 'EUR', labour: 1, growth: 1, inflation: -1, hawkish: -1 },
  'uk-equities': { economy: 'GBP', labour: 1, growth: 1, inflation: -1, hawkish: -1 },
  crypto: { economy: 'USD', labour: 1, growth: 1, inflation: -1, hawkish: -1 },
};

/** How the subject moves when its (or its economy's) data/policy turns currency-bullish. */
function translate(subject: Subject, theme: 'labour' | 'growth' | 'inflation' | 'hawkish'): number {
  if (isCurrency(subject)) return 1;
  return ASSET_SIGN[subject as AssetSubject][theme];
}

function economyOf(subject: Subject): Currency {
  return isCurrency(subject) ? subject : ASSET_SIGN[subject as AssetSubject].economy;
}

function calendarFlips(subject: Subject, events: NormalizedEvent[], at: Date): SubjectFlip[] {
  const economy = economyOf(subject);
  const iso = at.toISOString();
  const horizon = new Date(at.getTime() + FLIPS.horizonDays * 86_400_000).toISOString();
  const out: SubjectFlip[] = [];
  const themeOfKey = (key: string): 'labour' | 'inflation' | 'growth' | null =>
    (Object.entries(RELEASE_THEME) as ['labour' | 'inflation' | 'growth', string[]][]).find(([, keys]) => keys.includes(key))?.[0] ?? null;

  for (const e of events) {
    if (e.currency !== economy || e.actual !== null || e.isSpeech) continue;
    if (e.dateUtc <= iso || e.dateUtc > horizon || !FLIPS.impact.includes(e.impact)) continue;
    if (economy === 'EUR' && e.countryCode && e.countryCode !== 'EMU') continue;
    const rule = matchEventRule(e.name);
    const theme = themeOfKey(rule.key);
    if (!theme) continue;
    const ref = e.consensus ?? e.previous;
    if (ref === null) continue;
    const sign = translate(subject, theme);
    if (sign === 0) continue;
    const refLabel = e.consensus !== null ? 'forecast' : 'previous (no forecast yet)';
    const unit = e.unit ?? '';
    const td = rule.typicalDeviation;
    const up = num(ref + td);
    const down = num(ref - td);
    const upSide = sideOf(rule.polarity * sign);
    const when = `${e.dateUtc.slice(0, 16).replace('T', ' ')}Z`;
    out.push({
      id: `cal:${e.id}:up`,
      kind: 'calendar',
      theme,
      dueUtc: e.dateUtc,
      text: `${e.currency} ${e.name} (${when}) at or above ${up}${unit} — ${refLabel} ${ref}${unit} plus one typical miss`,
      favours: upSide,
      check: { type: 'release', eventId: e.id, op: '>=', threshold: up },
    });
    out.push({
      id: `cal:${e.id}:down`,
      kind: 'calendar',
      theme,
      dueUtc: e.dateUtc,
      text: `${e.currency} ${e.name} (${when}) at or below ${down}${unit} — ${refLabel} ${ref}${unit} minus one typical miss`,
      favours: opposite(upSide),
      check: { type: 'release', eventId: e.id, op: '<=', threshold: down },
    });
  }
  return out;
}

function decisionFlips(subject: Subject, events: NormalizedEvent[], at: Date): SubjectFlip[] {
  const economy = economyOf(subject);
  const sign = translate(subject, 'hawkish');
  if (sign === 0) return [];
  const next = resolveNextRateDecision(economy, events, at);
  if (!next) return [];
  const event = events.find((e) => e.currency === economy && e.dateUtc === next.dateUtc && e.name === next.name);
  if (!event) return [];
  const step = matchEventRule(event.name).typicalDeviation;
  const when = next.dateUtc.slice(0, 10);
  return [
    {
      id: `dec:${event.id}:up`,
      kind: 'policy',
      theme: 'policy',
      dueUtc: next.dateUtc,
      text: `${economy} rate decision ${when}: ${num(next.consensus + step)}% or higher against a ${next.consensus}% consensus (hawkish surprise)`,
      favours: sideOf(sign),
      check: { type: 'release', eventId: event.id, op: '>=', threshold: num(next.consensus + step) },
    },
    {
      id: `dec:${event.id}:down`,
      kind: 'policy',
      theme: 'policy',
      dueUtc: next.dateUtc,
      text: `${economy} rate decision ${when}: ${num(next.consensus - step)}% or lower against a ${next.consensus}% consensus (dovish surprise)`,
      favours: sideOf(-sign),
      check: { type: 'release', eventId: event.id, op: '<=', threshold: num(next.consensus - step) },
    },
  ];
}

function pathFlips(subject: Subject, fedPath: FedPath, inputs: NarrativeInputs, at: Date): SubjectFlip[] {
  const economy = economyOf(subject);
  const sign = translate(subject, 'hawkish');
  if (sign === 0) return [];
  const bp = FLIPS.confirmRepricingBp / 100;

  if (economy === 'USD') {
    const q = pricedBp(fedPath, at, FED_PATH.tacticalMonthsAhead);
    if (!q || q.point.implied === null) return [];
    const nowRate = q.point.implied;
    const weekRate = q.point.impliedWeekAgo;
    const moved = weekRate === null ? 0 : nowRate - weekRate;
    // Implied rate ≥ X is price ≤ 100 − X.
    const atLeast = (rate: number) => ({ type: 'close' as const, key: q.point.ticker, op: '<=' as const, threshold: num(100 - rate) });
    const atMost = (rate: number) => ({ type: 'close' as const, key: q.point.ticker, op: '>=' as const, threshold: num(100 - rate) });
    const label = `${q.point.ticker} (${q.point.month}) implied rate`;
    const up = moved < -FED_PATH.repricing.moderate / 100 && weekRate !== null ? weekRate : nowRate + bp;
    const down = moved > FED_PATH.repricing.moderate / 100 && weekRate !== null ? weekRate : nowRate - bp;
    return [
      { id: `fed:${q.point.ticker}:up`, kind: 'market', theme: 'policy', dueUtc: null, text: `${label} back to ${num(up)}% or higher (now ${num(nowRate)}%${weekRate !== null ? `, a week ago ${num(weekRate)}%` : ''}) — hawkish repricing`, favours: sideOf(sign), check: atLeast(up) },
      { id: `fed:${q.point.ticker}:down`, kind: 'market', theme: 'policy', dueUtc: null, text: `${label} at ${num(down)}% or lower (now ${num(nowRate)}%) — dovish repricing`, favours: sideOf(-sign), check: atMost(down) },
    ];
  }

  const hist = inputs.twoYearHistory[economy];
  const now = obsAt(hist, at);
  if (!now) return [];
  const week = valueAt(hist, new Date(at.getTime() - 7 * 86_400_000));
  const moved = week === null ? 0 : now.value - week;
  const up = moved < -0.05 && week !== null ? week : now.value + bp;
  const down = moved > 0.05 && week !== null ? week : now.value - bp;
  return [
    { id: `y2:${economy}:up`, kind: 'market', theme: 'policy', dueUtc: null, text: `${economy} 2-year yield at ${num(up)}% or higher (now ${num(now.value)}%) — hawkish repricing`, favours: sideOf(sign), check: { type: 'yield2y', currency: economy, op: '>=', threshold: num(up) } },
    { id: `y2:${economy}:down`, kind: 'market', theme: 'policy', dueUtc: null, text: `${economy} 2-year yield at ${num(down)}% or lower (now ${num(now.value)}%) — dovish repricing`, favours: sideOf(-sign), check: { type: 'yield2y', currency: economy, op: '<=', threshold: num(down) } },
  ];
}

function energyFlips(subject: Subject, inputs: NarrativeInputs, at: Date): SubjectFlip[] {
  const exposure = subject === 'oil' ? 1 : isCurrency(subject) ? ENERGY_EXPOSURE[subject] ?? 0 : 0;
  if (exposure === 0) return [];
  const key = subject === 'CAD' ? MARKET.wti : MARKET.brent;
  const name = key === MARKET.wti ? 'WTI' : 'Brent';
  const series = inputs.series[key];
  const now = obsAt(series, at);
  const month = valueAt(series, new Date(at.getTime() - 30 * 86_400_000));
  const m = changePct(series, at, 30);
  if (!now || month === null || m === null || Math.abs(m) < 5) return [];
  const rising = m > 0;
  const further = num(now.value * (1 + (rising ? 1 : -1) * FLIPS.confirmOilPct / 100));
  const oilUp = sideOf(exposure);
  return [
    {
      id: `oil:${key}:${rising ? 'down' : 'up'}`,
      kind: 'market',
      theme: 'energy',
      dueUtc: null,
      text: `${name} back to its level a month ago, ${num(month)} (now ${num(now.value)}, ${m > 0 ? '+' : ''}${num(m)}%)`,
      favours: rising ? opposite(oilUp) : oilUp,
      check: { type: 'close', key, op: rising ? '<=' : '>=', threshold: num(month) },
    },
    {
      id: `oil:${key}:${rising ? 'up' : 'down'}`,
      kind: 'market',
      theme: 'energy',
      dueUtc: null,
      text: `${name} a further ${FLIPS.confirmOilPct}% ${rising ? 'higher' : 'lower'}, ${further}`,
      favours: rising ? oilUp : opposite(oilUp),
      check: { type: 'close', key, op: rising ? '>=' : '<=', threshold: further },
    },
  ];
}

function riskFlips(subject: Subject, inputs: NarrativeInputs, at: Date): SubjectFlip[] {
  let sensitivity: number;
  if (isCurrency(subject)) {
    const off = SAFE_HAVEN.riskOff.find((r) => r.currency === subject)?.weight ?? 0;
    sensitivity = off;
  } else {
    sensitivity = subject === 'gold' ? 1 : subject === 'silver' || subject === 'platinum' ? 0.5 : -1;
  }
  if (Math.abs(sensitivity) < 0.5) return [];
  const vix = obsAt(inputs.series[MARKET.vix], at);
  if (!vix) return [];
  const out: SubjectFlip[] = [];
  if (vix.value < FLIPS.vixRiskOff) {
    out.push({ id: 'vix:up', kind: 'market', theme: 'risk', dueUtc: null, text: `VIX closes at ${FLIPS.vixRiskOff} or higher (now ${num(vix.value)}) — risk-off`, favours: sideOf(sensitivity), check: { type: 'close', key: MARKET.vix, op: '>=', threshold: FLIPS.vixRiskOff } });
  }
  if (vix.value > FLIPS.vixRiskOn) {
    out.push({ id: 'vix:down', kind: 'market', theme: 'risk', dueUtc: null, text: `VIX closes at ${FLIPS.vixRiskOn} or lower (now ${num(vix.value)}) — risk-on`, favours: sideOf(-sensitivity), check: { type: 'close', key: MARKET.vix, op: '<=', threshold: FLIPS.vixRiskOn } });
  }
  return out;
}

export function subjectFlips(subject: Subject, state: MarketState, inputs: NarrativeInputs, at: Date): SubjectFlip[] {
  return [
    ...calendarFlips(subject, inputs.events, at),
    ...decisionFlips(subject, inputs.events, at),
    ...pathFlips(subject, state.fedPath, inputs, at),
    ...energyFlips(subject, inputs, at),
    ...riskFlips(subject, inputs, at),
  ];
}

/** The nearest swing on each side of price, as the price conditions for the symbol. */
export function priceFlips(def: SymbolDefinition, levels: LevelSet | null): SubjectFlip[] {
  if (!levels) return [];
  const below = levels.levels.filter((l) => l.label === 'Swing low' && l.side === 'below').sort((a, b) => b.price - a.price)[0];
  const above = levels.levels.filter((l) => l.label === 'Swing high' && l.side === 'above').sort((a, b) => a.price - b.price)[0];
  const out: SubjectFlip[] = [];
  if (below) {
    out.push({ id: `price:${def.symbol}:below`, kind: 'price', theme: 'price', dueUtc: null, text: `${def.symbol} daily close below the swing low ${num(below.price)}${below.date ? ` (${below.date})` : ''}`, favours: 'bearish', check: { type: 'close', key: def.yahoo, op: '<=', threshold: below.price } });
  }
  if (above) {
    out.push({ id: `price:${def.symbol}:above`, kind: 'price', theme: 'price', dueUtc: null, text: `${def.symbol} daily close above the swing high ${num(above.price)}${above.date ? ` (${above.date})` : ''}`, favours: 'bullish', check: { type: 'close', key: def.yahoo, op: '>=', threshold: above.price } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pair
// ---------------------------------------------------------------------------

const ROLE_ORDER = { flip: 0, tip: 1, confirm: 2 } as const;

function roleOf(favours: Side, label: Verdict): FlipCondition['role'] {
  if (label === 'NEUTRAL') return 'tip';
  return (favours === 'bullish') === (label === 'BULLISH') ? 'confirm' : 'flip';
}

export function buildPairNarrative(
  def: SymbolDefinition,
  state: MarketState,
  inputs: NarrativeInputs,
  opts: {
    levels?: LevelSet | null;
    previous?: { tactical: Verdict; structural: Verdict } | null;
    /** A week earlier, from a stored snapshot (preferred) or a rewind. */
    past?: { effects: SubjectEffects; basis: string; rewound: boolean } | null;
  } = {},
): PairNarrative | null {
  const subjects = subjectsOf(def);
  if (!subjects) return null;
  const { base, quote } = subjects;
  const at = new Date(state.at);
  const effects = effectsOf(state);
  const themes = pairThemes(base, quote, effects, state);

  const tactical = verdictOf(themes.map((t) => ({ weight: t.weight, effect: t.tactical })), opts.previous?.tactical);
  const structural = verdictOf(themes.map((t) => ({ weight: t.weight, effect: t.structural })), opts.previous?.structural);

  const toPair = (f: SubjectFlip, fromQuote: boolean): FlipCondition => {
    const favours = fromQuote ? opposite(f.favours) : f.favours;
    return { ...f, favours, role: roleOf(favours, tactical.label) };
  };
  const all = [
    ...subjectFlips(base, state, inputs, at).map((f) => toPair(f, false)),
    ...(quote ? subjectFlips(quote, state, inputs, at).map((f) => toPair(f, true)) : []),
    ...priceFlips(def, opts.levels ?? null).map((f) => ({ ...f, role: roleOf(f.favours, tactical.label) })),
  ];
  const seen = new Set<string>();
  const flips = all
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.dueUtc ?? '9999').localeCompare(b.dueUtc ?? '9999'));

  const { changes, basis } = opts.past ? diffAgainst(themes, base, quote, opts.past, tactical) : { changes: [], basis: null };

  return {
    symbol: def.symbol,
    label: def.label,
    base,
    quote,
    themes,
    tactical,
    structural,
    flips,
    changes,
    changeBasis: basis,
  };
}

const signed = (v: number | null) => (v === null ? 'n/a' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

function diffAgainst(
  themes: PairTheme[],
  base: Subject,
  quote: Subject | null,
  past: { effects: SubjectEffects; basis: string; rewound: boolean },
  tacticalNow: VerdictReading,
): { changes: Change[]; basis: string } {
  const before = pairThemes(base, quote, past.effects);
  const changes: Change[] = [];
  const skipped: string[] = [];
  for (const now of themes) {
    const then = before.find((b) => b.id === now.id);
    if (!then) continue;
    const rewindable = (past.effects[base]?.[now.id]?.rewindable ?? true) && (quote ? past.effects[quote]?.[now.id]?.rewindable ?? true : true);
    if (past.rewound && !rewindable) {
      skipped.push(now.label);
      continue;
    }
    if (then.tactical === now.tactical) continue;
    const legs = [base, quote]
      .filter((s): s is Subject => s !== null)
      .map((s) => {
        const was = past.effects[s]?.[now.id]?.state;
        const is = (s === base ? now.base : now.quote)?.state;
        return was && is && was !== is ? `${subjectLabel(s)} ${was} → ${is}` : null;
      })
      .filter(Boolean);
    changes.push({ theme: now.id, text: `${now.label}: ${signed(then.tactical)} → ${signed(now.tactical)}${legs.length ? ` (${legs.join('; ')})` : ''}` });
  }
  const thenVerdict = verdictOf(before.map((t) => ({ weight: t.weight, effect: past.rewound && skipped.includes(t.label) ? null : t.tactical })));
  if (thenVerdict.label !== tacticalNow.label) {
    changes.unshift({ theme: 'verdict', text: `Tactical verdict ${thenVerdict.label} → ${tacticalNow.label}` });
  }
  const basis = past.rewound
    ? `${past.basis}${skipped.length ? `; not compared (headline themes, the feeds keep 48 hours): ${skipped.join(', ')}` : ''}`
    : past.basis;
  return { changes, basis };
}
