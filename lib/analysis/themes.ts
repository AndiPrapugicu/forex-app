/**
 * The Market Narrative engine: what each economy and asset is being moved by,
 * read deterministically from dated inputs.
 *
 * Every theme returns an EFFECT on its subject (−2..+2, + = bullish for the
 * currency or asset), split into tactical (days to two weeks) and structural
 * (one to three months), with the dated evidence behind it. Same inputs, same
 * answer, every time — the AI explains this state; it never re-derives it.
 *
 * Pure, with the clock passed in, so the engine can be run a week back off the
 * same bars and releases to say what changed.
 *
 * NOT THE BOARD. Nothing here reaches a board score, a parity check or the
 * score history. Thresholds live in config/narrative.config.ts.
 */

import {
  ASSET_MOVE,
  ASSET_SUBJECT_LABEL,
  ASSET_THEMES,
  CURRENCY_THEMES,
  ENERGY_EXPOSURE,
  ENERGY_MOVE,
  EQUITY_ECONOMY,
  FED_PATH,
  GAS_EXPOSED,
  HEADLINE_WINDOW_DAYS,
  LABOUR_BUNDLE_KEYS,
  LABOUR_BUNDLE_MIN_ALIGNED,
  RELEASE_THEME,
  RELEASE_WINDOW,
  RISK,
  THEME_LABEL,
  TWO_YEAR,
  type AssetSubject,
  type Subject,
  type ThemeId,
} from '@/config/narrative.config';
import { SAFE_HAVEN } from '@/config/assets.config';
import { matchEventRule } from '@/config/scoring.config';
import { buildFedPath, pricedBp, type FedContractSeries, type FedPath } from '@/lib/connectors/fed-futures';
import type { DatedObservation, SovereignYield } from '@/lib/connectors/yields';
import type { EcoStrengthRow } from '@/lib/scoring/eco-strength';
import { resolveNextRateDecision } from '@/lib/scoring/rates';
import { computeSurprise } from '@/lib/scoring/surprise';
import { CURRENCIES, type Currency, type NormalizedEvent } from '@/lib/types';
import {
  conflictLevel,
  readConflicts,
  readFiscal,
  readOpec,
  readStance,
  type ConflictReading,
  type Headline,
  type StanceReading,
} from '@/lib/analysis/headlines';
import { band, changeBp, changePct, clampEffect, obsAt } from '@/lib/analysis/series';

export type Effect = -2 | -1 | 0 | 1 | 2;

export interface Evidence {
  text: string;
  /** ISO date or datetime of the observation, release or headline. */
  date: string | null;
  source: string;
  url?: string;
}

export interface ThemeReading {
  id: ThemeId;
  label: string;
  subject: Subject;
  /** A few words: "cooling", "dovish repricing", "headwind". */
  state: string;
  /** Null = this theme has no reading at this horizon (abstains, not neutral). */
  tactical: Effect | null;
  structural: Effect | null;
  evidence: Evidence[];
  notes: string[];
  /** Why the theme could not be read at all. */
  gap: string | null;
  /** Rebuildable a week back from dated inputs. Headline themes are not: the feeds keep 48 hours. */
  rewindable: boolean;
}

export interface SubjectState {
  subject: Subject;
  label: string;
  themes: ThemeReading[];
}

export interface MarketState {
  at: string;
  subjects: Partial<Record<Subject, SubjectState>>;
  fedPath: FedPath;
  conflicts: ConflictReading[];
  stance: Partial<Record<Currency, StanceReading>>;
  gaps: string[];
}

/** Everything the engine reads. All of it dated, none of it fetched here. */
export interface NarrativeInputs {
  events: NormalizedEvent[];
  policyRates: Map<Currency, number>;
  /** Current 2-year levels, whatever the source. */
  twoYear: Map<Currency, SovereignYield>;
  /** 2-year history, oldest first: FRED for USD, the ECB for EUR, our snapshots for the rest. */
  twoYearHistory: Partial<Record<Currency, DatedObservation[]>>;
  fed: { effr: DatedObservation[]; contracts: FedContractSeries[] };
  /** Daily closes by key — see MARKET below. */
  series: Record<string, DatedObservation[]>;
  headlines: Headline[];
  /** False when no headline source answered: headline themes become gaps, not "quiet". */
  headlinesAvailable: boolean;
  ecoStrength: EcoStrengthRow[];
}

/** Series keys the loader fills. */
export const MARKET = {
  brent: 'BZ=F',
  brentFar: 'BRENT_FAR',
  wti: 'CL=F',
  gas: 'TTF=F',
  copper: 'HG=F',
  vix: '^VIX',
  spx: '^GSPC',
  ndx: '^NDX',
  dxy: 'DX-Y.NYB',
  us10y: '^TNX',
  breakeven5y: 'FRED:T5YIE',
  realYield10y: 'FRED:DFII10',
} as const;

const DAY_MS = 86_400_000;

const fmt = (v: number | null, dp = 2) => (v === null || !Number.isFinite(v) ? 'n/a' : `${v > 0 ? '+' : ''}${Number(v.toFixed(dp))}`);
const lvl = (v: number | null, dp = 2) => (v === null || !Number.isFinite(v) ? 'n/a' : `${Number(v.toFixed(dp))}`);

function reading(id: ThemeId, subject: Subject, partial: Partial<ThemeReading>): ThemeReading {
  return {
    id,
    label: THEME_LABEL[id],
    subject,
    state: 'n/a',
    tactical: null,
    structural: null,
    evidence: [],
    notes: [],
    gap: null,
    rewindable: true,
    ...partial,
  };
}

function gapReading(id: ThemeId, subject: Subject, gap: string, rewindable = true): ThemeReading {
  return reading(id, subject, { state: 'no data', gap, rewindable });
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export interface ScoredRelease {
  event: NormalizedEvent;
  ruleKey: string;
  sigma: number;
  /** sigma × polarity: + is bullish for the currency. */
  signed: number;
  contribution: number;
}

/**
 * Released prints of one theme for one currency inside a window, each with its
 * polarity-signed surprise and its decayed contribution.
 */
export function scoreReleases(
  events: NormalizedEvent[],
  currency: Currency,
  keys: readonly string[],
  at: Date,
  window: { days: number; halfLifeDays: number },
): { total: number; releases: ScoredRelease[] } {
  const atIso = at.toISOString();
  const from = new Date(at.getTime() - window.days * DAY_MS).toISOString();
  const releases: ScoredRelease[] = [];
  let total = 0;

  for (const event of events) {
    if (event.currency !== currency || event.isSpeech || event.actual === null) continue;
    if (event.dateUtc > atIso || event.dateUtc < from) continue;
    const rule = matchEventRule(event.name);
    if (!keys.includes(rule.key)) continue;

    let countryWeight = 1;
    if (currency === 'EUR' && event.countryCode && event.countryCode !== 'EMU') {
      if (!RELEASE_WINDOW.euroMembers.includes(event.countryCode)) continue;
      countryWeight = 0.5;
    }

    const sigma = computeSurprise(event).sigma;
    if (sigma === null || !Number.isFinite(sigma)) continue;
    const signed = sigma * rule.polarity;
    const ageDays = Math.max(0, (at.getTime() - Date.parse(event.dateUtc)) / DAY_MS);
    const decay = Math.pow(0.5, ageDays / window.halfLifeDays);
    const counts = Math.abs(sigma) >= RELEASE_WINDOW.minSigma;
    const contribution = counts
      ? signed * (rule.weight ?? 1) * (RELEASE_WINDOW.impactWeight[event.impact] ?? 0) * countryWeight * decay
      : 0;
    total += contribution;
    releases.push({ event, ruleKey: rule.key, sigma, signed, contribution });
  }
  releases.sort((a, b) => b.event.dateUtc.localeCompare(a.event.dateUtc));
  return { total, releases };
}

function releaseEvidence(r: ScoredRelease): Evidence {
  const e = r.event;
  const unit = e.unit ?? '';
  const ref = e.consensus !== null ? `forecast ${e.consensus}${unit}` : e.previous !== null ? `previous ${e.previous}${unit}` : 'no reference';
  const verdict = Math.abs(r.sigma) < RELEASE_WINDOW.minSigma ? 'in line' : r.signed > 0 ? `${e.currency}-positive` : `${e.currency}-negative`;
  return {
    text: `${e.name}: ${e.actual}${unit} vs ${ref} (${fmt(r.sigma)}σ, ${verdict})`,
    date: e.dateUtc,
    source: e.source,
    url: e.sourceUrl ?? undefined,
  };
}

/**
 * The payrolls day: headline jobs, the jobless rate and wages released together.
 * Two of the three pointing the same way is a bundle; three of three with none
 * against is a strong one. The most recent bundle in the window wins.
 */
export function labourBundle(releases: ScoredRelease[]): { direction: 1 | -1; strength: 1 | 2; date: string; aligned: number; of: number } | null {
  const byDay = new Map<string, ScoredRelease[]>();
  for (const r of releases) {
    if (!(LABOUR_BUNDLE_KEYS as readonly string[]).includes(r.ruleKey)) continue;
    const d = r.event.dateUtc.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const days = [...byDay.keys()].sort().reverse();
  for (const d of days) {
    // One print per series: m/m and y/y wages are one vote.
    const perKey = new Map<string, ScoredRelease>();
    for (const r of byDay.get(d)!) if (!perKey.has(r.ruleKey) || Math.abs(r.sigma) > Math.abs(perKey.get(r.ruleKey)!.sigma)) perKey.set(r.ruleKey, r);
    const votes = [...perKey.values()].filter((r) => Math.abs(r.sigma) >= RELEASE_WINDOW.minSigma);
    if (perKey.size < 2) continue;
    const pos = votes.filter((r) => r.signed > 0).length;
    const neg = votes.filter((r) => r.signed < 0).length;
    const aligned = Math.max(pos, neg);
    if (aligned < LABOUR_BUNDLE_MIN_ALIGNED) continue;
    const against = Math.min(pos, neg);
    return { direction: pos > neg ? 1 : -1, strength: against === 0 ? 2 : 1, date: d, aligned, of: perKey.size };
  }
  return null;
}

const STATE_WORDS: Record<'labour' | 'inflation' | 'growth', [string, string, string]> = {
  labour: ['cooling', 'steady', 'tight'],
  inflation: ['cooling', 'stable', 'heating'],
  growth: ['softening', 'steady', 'firming'],
};

function word(theme: 'labour' | 'inflation' | 'growth', e: Effect | null): string {
  if (e === null) return 'no data';
  const [neg, flat, pos] = STATE_WORDS[theme];
  const strong = Math.abs(e) === 2 ? 'strongly ' : '';
  return e > 0 ? `${strong}${pos}` : e < 0 ? `${strong}${neg}` : flat;
}

function releaseTheme(
  theme: 'labour' | 'inflation' | 'growth',
  currency: Currency,
  inputs: NarrativeInputs,
  at: Date,
): { reading: ThemeReading; tactical: { total: number; releases: ScoredRelease[] } } {
  const keys = RELEASE_THEME[theme];
  const tactical = scoreReleases(inputs.events, currency, keys, at, RELEASE_WINDOW.tactical);
  const structural = scoreReleases(inputs.events, currency, keys, at, RELEASE_WINDOW.structural);

  if (structural.releases.length === 0) {
    return { reading: gapReading(theme, currency, `no ${theme} release with a forecast in the last ${RELEASE_WINDOW.structural.days} days`), tactical };
  }

  let t: Effect = band(tactical.total, RELEASE_WINDOW.moderate, RELEASE_WINDOW.strong);
  let s: Effect = band(structural.total, RELEASE_WINDOW.moderate, RELEASE_WINDOW.strong);
  const notes: string[] = [];

  if (theme === 'labour') {
    const bundle = labourBundle(tactical.releases);
    if (bundle) {
      const sameSide = Math.sign(t) === bundle.direction;
      t = (bundle.direction * Math.max(bundle.strength, sameSide ? Math.abs(t) : 0)) as Effect;
      notes.push(`Payrolls bundle ${bundle.date}: ${bundle.aligned} of ${bundle.of} prints ${bundle.direction > 0 ? 'beat' : 'missed'} for ${currency}${bundle.strength === 2 ? ', none against' : ''}.`);
    }
  }

  if (theme === 'growth') {
    const eco = inputs.ecoStrength.find((r) => r.currency === currency);
    if (eco) {
      const adj = eco.bias === 'Bullish' ? 0.75 : eco.bias === 'Bearish' ? -0.75 : 0;
      s = band(structural.total + adj, RELEASE_WINDOW.moderate, RELEASE_WINDOW.strong);
      notes.push(`Eco Strength reads ${eco.bias} (${eco.componentsScored}/4 components).`);
    }
  }

  const evidence = tactical.releases.slice(0, 6).map(releaseEvidence);
  if (evidence.length === 0) evidence.push(...structural.releases.slice(0, 3).map(releaseEvidence));

  return {
    reading: reading(theme, currency, {
      state: t === s ? word(theme, t) : `${word(theme, t)} (quarter: ${word(theme, s)})`,
      tactical: t,
      structural: s,
      evidence,
      notes,
    }),
    tactical,
  };
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

function policyTheme(currency: Currency, inputs: NarrativeInputs, at: Date, fedPath: FedPath, stanceOut: Partial<Record<Currency, StanceReading>>): ThemeReading {
  const evidence: Evidence[] = [];
  const notes: string[] = [];
  let t: Effect | null = null;
  let s: Effect | null = null;
  let pricedDirection = 0;
  let source = '';

  const rate = inputs.policyRates.get(currency) ?? null;
  // The loader appends today's level to the history, so one lookup serves now and a week ago.
  const y2Now = obsAt(inputs.twoYearHistory[currency], at);
  const y2Level = y2Now?.value ?? null;

  if (currency === 'USD' && fedPath.reference) {
    const q = pricedBp(fedPath, at, FED_PATH.tacticalMonthsAhead);
    const h = pricedBp(fedPath, at, FED_PATH.structuralMonthsAhead);
    source = 'fed funds futures';
    if (q && q.now !== null) {
      const week = q.weekAgo === null ? null : q.now - q.weekAgo;
      t = week === null ? null : band(week, FED_PATH.repricing.moderate, FED_PATH.repricing.strong);
      evidence.push({
        text: `${q.point.ticker} (${q.point.month}) implies ${lvl(q.point.implied, 3)}% = ${fmt(q.now, 0)}bp vs ${fedPath.reference.label} ${lvl(fedPath.reference.value, 2)}%; a week ago ${fmt(q.weekAgo, 0)}bp, a month ago ${fmt(q.monthAgo, 0)}bp`,
        date: q.point.date,
        source: 'Yahoo (CBOT 30-day fed funds)',
      });
      if (week !== null) notes.push(`Repricing this week: ${fmt(week, 0)}bp ${week < 0 ? '(hike pricing out / cuts in)' : week > 0 ? '(hike pricing in / cuts out)' : ''}`.trim());
    }
    if (h && h.now !== null) {
      s = band(h.now, FED_PATH.priced.moderate, FED_PATH.priced.strong);
      pricedDirection = Math.sign(h.now);
      evidence.push({ text: `${h.point.ticker} (${h.point.month}): ${fmt(h.now, 0)}bp priced six months out`, date: h.point.date, source: 'Yahoo (CBOT 30-day fed funds)' });
    }
  } else {
    source = '2-year yield';
    const week = changeBp(inputs.twoYearHistory[currency], at, 7);
    if (week !== null) {
      t = band(week, TWO_YEAR.repricing.moderate, TWO_YEAR.repricing.strong);
      evidence.push({ text: `2-year ${lvl(y2Level)}%, ${fmt(week, 0)}bp in a week`, date: y2Now?.date ?? null, source: inputs.twoYear.get(currency)?.source ?? '2-year history' });
    } else {
      notes.push('No week of 2-year history for this currency yet (the daily narrative snapshots fill it), so tactical repricing is not read.');
    }
    if (y2Level !== null && rate !== null) {
      const spread = (y2Level - rate) * 100;
      s = band(spread, TWO_YEAR.spread.moderate, TWO_YEAR.spread.strong);
      pricedDirection = Math.abs(spread) >= TWO_YEAR.spread.moderate ? Math.sign(spread) : 0;
      evidence.push({ text: `2-year ${lvl(y2Level)}% vs policy rate ${lvl(rate)}%: ${fmt(spread, 0)}bp (positive = market prices higher rates)`, date: y2Now?.date ?? inputs.twoYear.get(currency)?.observedOn ?? null, source: inputs.twoYear.get(currency)?.source ?? '2-year' });
    }
  }

  const next = resolveNextRateDecision(currency, inputs.events, at);
  if (next) {
    const move = next.standing === null ? null : next.consensus - next.standing;
    evidence.push({
      text: `Next decision ${next.dateUtc.slice(0, 10)}: consensus ${lvl(next.consensus)}%${move === null ? '' : ` (${move > 0 ? 'hike' : move < 0 ? 'cut' : 'hold'} expected from ${lvl(next.standing)}%)`}`,
      date: next.dateUtc,
      source: 'calendar',
    });
    if (pricedDirection === 0 && move) pricedDirection = Math.sign(move);
  }

  if (inputs.headlinesAvailable) {
    const stance = readStance(inputs.headlines, currency, at, HEADLINE_WINDOW_DAYS, pricedDirection);
    stanceOut[currency] = stance;
    if (stance.net !== 'none') {
      evidence.push(...stance.evidence.slice(0, 4).map((e) => ({ text: `Speaker: ${e.text}`, date: e.date, source: e.source, url: e.url })));
      const tone = stance.net;
      if (t !== null && ((tone === 'dovish' && t >= 0) || (tone === 'hawkish' && t <= 0))) {
        notes.push(`Speakers lean ${tone} (${stance.hawkish} hawkish, ${stance.dovish} dovish, ${stance.hold} on hold) but prices have not moved that way — rhetoric not (yet) priced.`);
      } else if (tone !== 'mixed') {
        notes.push(`Speakers lean ${tone} (${stance.hawkish} hawkish, ${stance.dovish} dovish, ${stance.hold} on hold), consistent with pricing.`);
      } else {
        notes.push(`Speakers mixed (${stance.hawkish} hawkish, ${stance.dovish} dovish, ${stance.hold} on hold, ${stance.ambiguous} ambiguous).`);
      }
    }
  }

  if (t === null && s === null) return reading('policy', currency, { state: 'no data', gap: `no ${source || 'rate'} reading`, evidence, notes });

  const tWord = t === null ? null : t < 0 ? `${Math.abs(t) === 2 ? 'sharp ' : ''}dovish repricing` : t > 0 ? `${Math.abs(t) === 2 ? 'sharp ' : ''}hawkish repricing` : 'no repricing';
  const sWord = s === null ? null : s > 0 ? 'hikes priced' : s < 0 ? 'cuts priced' : 'flat path';
  return reading('policy', currency, {
    state: [tWord, sWord].filter(Boolean).join('; '),
    tactical: t,
    structural: s,
    evidence,
    notes: [`Read off ${source}.`, ...notes],
  });
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

function energyMoves(inputs: NarrativeInputs, at: Date, currency: Currency | null) {
  const oilKey = currency === 'CAD' ? MARKET.wti : MARKET.brent;
  const oil = inputs.series[oilKey];
  const gas = inputs.series[MARKET.gas];
  return {
    oilKey,
    oilName: oilKey === MARKET.wti ? 'WTI' : 'Brent',
    oilLast: obsAt(oil, at),
    oil1w: changePct(oil, at, 7),
    oil1m: changePct(oil, at, 30),
    gasLast: obsAt(gas, at),
    gas1w: changePct(gas, at, 7),
    gas1m: changePct(gas, at, 30),
  };
}

function energyTheme(currency: Currency, inputs: NarrativeInputs, at: Date): ThemeReading {
  const exposure = ENERGY_EXPOSURE[currency] ?? 0;
  const m = energyMoves(inputs, at, currency);
  if (!m.oilLast) return gapReading('energy', currency, 'no oil price');
  const gasToo = GAS_EXPOSED.includes(currency) && m.gasLast !== null;

  const strongest = (a: Effect, b: Effect): Effect => (Math.abs(b) > Math.abs(a) ? b : a);
  const tMove = strongest(band(m.oil1w, ENERGY_MOVE.oil.moderate, ENERGY_MOVE.oil.strong), gasToo ? band(m.gas1w, ENERGY_MOVE.gas.moderate, ENERGY_MOVE.gas.strong) : 0);
  const sMove = strongest(band(m.oil1m, ENERGY_MOVE.oil.moderate, ENERGY_MOVE.oil.strong), gasToo ? band(m.gas1m, ENERGY_MOVE.gas.moderate, ENERGY_MOVE.gas.strong) : 0);

  const evidence: Evidence[] = [
    { text: `${m.oilName} ${lvl(m.oilLast.value)}: ${fmt(m.oil1w, 1)}% in a week, ${fmt(m.oil1m, 1)}% in a month`, date: m.oilLast.date, source: 'Yahoo' },
  ];
  if (gasToo && m.gasLast) evidence.push({ text: `TTF gas ${lvl(m.gasLast.value)}: ${fmt(m.gas1w, 1)}% in a week, ${fmt(m.gas1m, 1)}% in a month`, date: m.gasLast.date, source: 'Yahoo' });

  const t = clampEffect(exposure * tMove);
  const s = clampEffect(exposure * sMove);
  const role = exposure < 0 ? 'net energy importer' : exposure > 0 ? 'energy exporter' : 'roughly energy-neutral';
  const stateOf = (e: Effect) => (e < 0 ? 'headwind' : e > 0 ? 'tailwind' : 'neutral');
  return reading('energy', currency, {
    state: exposure === 0 ? `neutral (${role})` : t === s ? stateOf(t) : `${stateOf(t)} (month: ${stateOf(s)})`,
    tactical: t,
    structural: s,
    evidence,
    notes: [`${currency} is a ${role} (exposure ${exposure}); dearer energy ${exposure < 0 ? 'worsens' : exposure > 0 ? 'improves' : 'barely moves'} its terms of trade.`],
  });
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export interface RiskRegime {
  /** + = risk-off. */
  tactical: Effect;
  structural: Effect;
  evidence: Evidence[];
  notes: string[];
  vix: number | null;
}

export function riskRegime(inputs: NarrativeInputs, at: Date, conflicts: ConflictReading[]): RiskRegime | null {
  const vixObs = obsAt(inputs.series[MARKET.vix], at);
  const spx = inputs.series[MARKET.spx];
  if (!vixObs && !obsAt(spx, at)) return null;
  const vix1w = changePct(inputs.series[MARKET.vix], at, 7);
  const spx1w = changePct(spx, at, 7);
  const evidence: Evidence[] = [];
  const notes: string[] = [];

  let t = 0;
  if (vix1w !== null && vix1w >= RISK.vixJump) t += 1;
  if (vix1w !== null && vix1w <= -RISK.vixJump) t -= 1;
  if (spx1w !== null && spx1w <= RISK.equityDrop) t += 1;
  if (spx1w !== null && spx1w >= RISK.equityRally) t -= 1;
  const hot = conflicts.filter((c) => conflictLevel(c) === 2);
  const easing = conflicts.filter((c) => conflictLevel(c) < 0);
  if (hot.length > 0) t += 1;
  else if (easing.length > 0 && conflicts.every((c) => conflictLevel(c) <= 0)) t -= 1;

  const vix = vixObs?.value ?? null;
  const s = vix === null ? 0 : vix >= RISK.vixPanic ? 2 : vix >= RISK.vixStress ? 1 : vix <= RISK.vixCalm ? -1 : 0;

  if (vixObs) evidence.push({ text: `VIX ${lvl(vix)} (${fmt(vix1w, 1)}% in a week)`, date: vixObs.date, source: 'Yahoo' });
  const spxObs = obsAt(spx, at);
  if (spxObs) evidence.push({ text: `S&P 500 ${fmt(spx1w, 1)}% in a week`, date: spxObs.date, source: 'Yahoo' });
  for (const c of conflicts) {
    if (c.escalation === 0 && c.deescalation === 0) continue;
    notes.push(`${c.region.label}: ${c.escalation} escalation and ${c.deescalation} de-escalation headlines over ${HEADLINE_WINDOW_DAYS} days, ${c.domains} outlet${c.domains === 1 ? '' : 's'}${c.corroborated ? ' (corroborated)' : ''}.`);
    evidence.push(...c.evidence.slice(0, 2).map((e) => ({ text: e.text, date: e.date, source: e.source, url: e.url })));
  }
  return { tactical: clampEffect(t), structural: s as Effect, evidence, notes, vix };
}

const regimeWord = (e: Effect | null) => (e === null ? 'n/a' : e >= 2 ? 'stress' : e === 1 ? 'risk-off' : e <= -1 ? 'risk-on' : 'calm');

function havenWeight(currency: Currency, riskOff: number): number {
  const table = riskOff > 0 ? SAFE_HAVEN.riskOff : SAFE_HAVEN.riskOn;
  return table.find((r) => r.currency === currency)?.weight ?? 0;
}

function riskThemeForCurrency(currency: Currency, regime: RiskRegime | null, conflicts: ConflictReading[]): ThemeReading {
  if (!regime) return gapReading('risk', currency, 'no VIX or S&P 500 reading', false);
  const effect = (r: Effect) => (r === 0 ? 0 : havenWeight(currency, r) * Math.abs(r));
  let t = effect(regime.tactical);
  const s = effect(regime.structural);
  const notes = [...regime.notes];
  for (const c of conflicts) {
    const p = c.region.proximity[currency];
    if (p && conflictLevel(c) === 2) {
      t += p;
      notes.push(`${currency} sits close to the ${c.region.label} escalation (${p}).`);
    }
  }
  const tE = clampEffect(t);
  const sE = clampEffect(s);
  return reading('risk', currency, {
    state: `${regimeWord(regime.tactical)} (backdrop: ${regimeWord(regime.structural)})`,
    tactical: tE,
    structural: sE,
    evidence: regime.evidence,
    notes: [
      havenWeight(currency, 1) > 0 ? `${currency} is a haven: risk-off lifts it.` : havenWeight(currency, 1) < 0 ? `${currency} is a risk currency: risk-off weighs on it.` : `${currency} carries no haven weight here.`,
      ...notes,
    ],
    rewindable: false,
  });
}

// ---------------------------------------------------------------------------
// Fiscal
// ---------------------------------------------------------------------------

function fiscalTheme(currency: Currency, inputs: NarrativeInputs, at: Date): ThemeReading {
  if (!inputs.headlinesAvailable) return gapReading('fiscal', currency, 'no headline source answered', false);
  const f = readFiscal(inputs.headlines, currency, at, HEADLINE_WINDOW_DAYS);
  const t: Effect = f.count === 0 ? 0 : f.corroborated ? -2 : -1;
  return reading('fiscal', currency, {
    state: f.count === 0 ? 'quiet' : f.corroborated ? 'stress (corroborated)' : 'stress',
    tactical: t,
    structural: null,
    evidence: f.evidence,
    notes: f.count === 0 ? [] : [`${f.count} fiscal/political stress headline${f.count === 1 ? '' : 's'} over ${HEADLINE_WINDOW_DAYS} days from ${f.domains} outlet${f.domains === 1 ? '' : 's'}.`],
    rewindable: false,
  });
}

// ---------------------------------------------------------------------------
// Currency subjects
// ---------------------------------------------------------------------------

function inflationTheme(currency: Currency, inputs: NarrativeInputs, at: Date, growth: ThemeReading): ThemeReading {
  const { reading: r } = releaseTheme('inflation', currency, inputs, at);
  const notes = [...r.notes];
  const evidence = [...r.evidence];
  let s = r.structural;

  if (currency === 'USD') {
    const be = inputs.series[MARKET.breakeven5y];
    const beObs = obsAt(be, at);
    const be1m = changeBp(be, at, 30);
    if (beObs) {
      evidence.push({ text: `5-year breakeven ${lvl(beObs.value)}% (${fmt(be1m, 0)}bp in a month)`, date: beObs.date, source: 'FRED T5YIE' });
      if (be1m !== null && s !== null && Math.abs(be1m) >= 15) s = clampEffect(s + Math.sign(be1m));
    }
  }

  const m = energyMoves(inputs, at, null);
  const exposure = ENERGY_EXPOSURE[currency] ?? 0;
  if (m.oil1m !== null && m.oil1m >= ENERGY_MOVE.oil.strong) {
    notes.push(`Brent is ${fmt(m.oil1m, 1)}% in a month: headline inflation pressure ahead.`);
    if (exposure < 0 && (r.tactical ?? 0) <= 0) {
      notes.push(`Energy-led and ${currency} imports its energy: a stagflation shock, which central banks tend to look through — not read as hawkish.`);
    } else if (exposure < 0 && (growth.tactical ?? 0) < 0) {
      notes.push('Prices heating while growth softens: stagflation risk; the hawkish read is weaker than the print suggests.');
    }
  }
  if (r.gap) return { ...r, notes, evidence };
  return { ...r, structural: s, notes, evidence };
}

function currencySubject(currency: Currency, inputs: NarrativeInputs, at: Date, fedPath: FedPath, regime: RiskRegime | null, conflicts: ConflictReading[], stance: Partial<Record<Currency, StanceReading>>): SubjectState {
  const labour = releaseTheme('labour', currency, inputs, at).reading;
  const growth = releaseTheme('growth', currency, inputs, at).reading;
  const inflation = inflationTheme(currency, inputs, at, growth);
  const themes: ThemeReading[] = [
    labour,
    inflation,
    growth,
    policyTheme(currency, inputs, at, fedPath, stance),
    energyTheme(currency, inputs, at),
    riskThemeForCurrency(currency, regime, conflicts),
    fiscalTheme(currency, inputs, at),
  ];
  return { subject: currency, label: currency, themes: CURRENCY_THEMES.map((id) => themes.find((t) => t.id === id)!) };
}

// ---------------------------------------------------------------------------
// Asset subjects
// ---------------------------------------------------------------------------

function negate(e: Effect | null): Effect | null {
  return e === null ? null : ((-e) as Effect);
}

function yieldTheme(id: ThemeId, subject: Subject, key: string, label: string, at: Date, inputs: NarrativeInputs, week: { moderate: number; strong: number }, month: { moderate: number; strong: number }): ThemeReading {
  const series = inputs.series[key];
  const o = obsAt(series, at);
  if (!o) return gapReading(id, subject, `no ${label}`);
  const w = changeBp(series, at, 7);
  const mo = changeBp(series, at, 30);
  // Rising yields hurt a non-yielding or rate-sensitive asset.
  const t = negate(band(w, week.moderate, week.strong));
  const s = negate(band(mo, month.moderate, month.strong));
  const stateOf = (e: Effect | null) => (e === null ? 'n/a' : e > 0 ? 'falling (supportive)' : e < 0 ? 'rising (headwind)' : 'steady');
  return reading(id, subject, {
    state: t === s ? stateOf(t) : `${stateOf(t)} (month: ${stateOf(s)})`,
    tactical: t,
    structural: s,
    evidence: [{ text: `${label} ${lvl(o.value)}%: ${fmt(w, 0)}bp in a week, ${fmt(mo, 0)}bp in a month`, date: o.date, source: key.startsWith('FRED:') ? key.slice(5) : 'Yahoo' }],
  });
}

function dollarTheme(subject: Subject, inputs: NarrativeInputs, at: Date): ThemeReading {
  const series = inputs.series[MARKET.dxy];
  const o = obsAt(series, at);
  if (!o) return gapReading('dollar', subject, 'no dollar index');
  const w = changePct(series, at, 7);
  const mo = changePct(series, at, 30);
  const t = negate(band(w, ASSET_MOVE.dollarWeek.moderate, ASSET_MOVE.dollarWeek.strong));
  const s = negate(band(mo, ASSET_MOVE.dollarMonth.moderate, ASSET_MOVE.dollarMonth.strong));
  const stateOf = (e: Effect | null) => (e === null ? 'n/a' : e > 0 ? 'weaker dollar (supportive)' : e < 0 ? 'stronger dollar (headwind)' : 'steady');
  return reading('dollar', subject, {
    state: t === s ? stateOf(t) : `${stateOf(t)} (month: ${stateOf(s)})`,
    tactical: t,
    structural: s,
    evidence: [{ text: `Dollar index ${lvl(o.value)}: ${fmt(w, 2)}% in a week, ${fmt(mo, 2)}% in a month`, date: o.date, source: 'Yahoo' }],
  });
}

function riskThemeForAsset(subject: AssetSubject, regime: RiskRegime | null, inputs: NarrativeInputs, at: Date): ThemeReading {
  if (!regime) return gapReading('risk', subject, 'no VIX or S&P 500 reading', false);
  const haven = subject === 'gold' ? 1 : subject === 'silver' || subject === 'platinum' ? 0.5 : -1;
  let t: number = haven * regime.tactical;
  const s: number = haven * regime.structural;
  const evidence = [...regime.evidence];
  if (subject === 'crypto') {
    const ndx = inputs.series[MARKET.ndx];
    const w = changePct(ndx, at, 7);
    const o = obsAt(ndx, at);
    if (w !== null && o) {
      t = band(w, ASSET_MOVE.nasdaqWeek.moderate, ASSET_MOVE.nasdaqWeek.strong);
      evidence.unshift({ text: `Nasdaq 100 ${fmt(w, 1)}% in a week`, date: o.date, source: 'Yahoo' });
    }
  }
  return reading('risk', subject, {
    state: `${regimeWord(regime.tactical)} (backdrop: ${regimeWord(regime.structural)})`,
    tactical: clampEffect(t),
    structural: clampEffect(s),
    evidence,
    notes: [haven > 0 ? `${ASSET_SUBJECT_LABEL[subject]} is a haven: risk-off supports it.` : `${ASSET_SUBJECT_LABEL[subject]} is a risk asset: risk-off weighs on it.`, ...regime.notes],
    rewindable: false,
  });
}

function averaged(a: Effect | null, b: Effect | null): Effect | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return clampEffect((a + b) / 2);
}

function demandTheme(subject: AssetSubject, us: SubjectState | undefined, au: SubjectState | undefined, inputs: NarrativeInputs, at: Date): ThemeReading {
  const usG = us?.themes.find((t) => t.id === 'growth');
  const auG = au?.themes.find((t) => t.id === 'growth');
  const t = averaged(usG?.tactical ?? null, auG?.tactical ?? null);
  const s = averaged(usG?.structural ?? null, auG?.structural ?? null);
  if (t === null && s === null) return gapReading('demand', subject, 'no US or Australian growth reading');
  const evidence: Evidence[] = [];
  if (usG) evidence.push({ text: `US growth: ${usG.state}`, date: null, source: 'narrative' });
  if (auG) evidence.push({ text: `Australian growth (proxy for Chinese demand): ${auG.state}`, date: null, source: 'narrative' });
  if (subject === 'copper') {
    const hg = inputs.series[MARKET.copper];
    const o = obsAt(hg, at);
    if (o) evidence.push({ text: `Copper ${lvl(o.value)}: ${fmt(changePct(hg, at, 30), 1)}% in a month`, date: o.date, source: 'Yahoo' });
  }
  const stateOf = (e: Effect | null) => (e === null ? 'n/a' : e > 0 ? 'firming' : e < 0 ? 'softening' : 'steady');
  return reading('demand', subject, { state: stateOf(t), tactical: t, structural: s, evidence, notes: ['Demand reads US growth and Australian growth as the free proxy for China.'] });
}

function oilSubject(inputs: NarrativeInputs, at: Date, regime: RiskRegime | null, conflicts: ConflictReading[], states: Partial<Record<Subject, SubjectState>>): ThemeReading[] {
  const subject: AssetSubject = 'oil';

  // Inventories: a draw (stock below forecast) is bullish oil. The event rule
  // has polarity −1, so the signed surprise is already "bullish for oil".
  const inv = scoreReleases(inputs.events, 'USD', ['oil-inventories'], at, { days: 21, halfLifeDays: 7 });
  const invS = scoreReleases(inputs.events, 'USD', ['oil-inventories'], at, { days: 60, halfLifeDays: 21 });
  const inventories = inv.releases.length + invS.releases.length === 0
    ? gapReading('inventories', subject, 'no EIA inventory release with a forecast in 60 days')
    : reading('inventories', subject, {
        state: inv.total > 0 ? 'draws (supportive)' : inv.total < 0 ? 'builds (headwind)' : 'in line',
        tactical: band(inv.total, RELEASE_WINDOW.moderate, RELEASE_WINDOW.strong),
        structural: band(invS.total, RELEASE_WINDOW.moderate, RELEASE_WINDOW.strong),
        evidence: inv.releases.slice(0, 4).map(releaseEvidence),
        notes: ['A stock change below forecast (a draw) reads bullish for oil.'],
      });

  let supply: ThemeReading;
  if (!inputs.headlinesAvailable) {
    supply = gapReading('supply', subject, 'no headline source answered', false);
  } else {
    const opec = readOpec(inputs.headlines, at, HEADLINE_WINDOW_DAYS);
    const oilRegions = conflicts.filter((c) => c.region.oilSupply);
    const war = Math.max(0, ...oilRegions.map(conflictLevel));
    const calm = oilRegions.some((c) => conflictLevel(c) < 0) && war === 0 ? -1 : 0;
    const opecNet = Math.sign(opec.cut - opec.raise);
    const t = clampEffect(war + calm + opecNet);
    supply = reading('supply', subject, {
      state: t > 0 ? 'supply at risk' : t < 0 ? 'supply easing' : 'no supply story',
      tactical: t,
      structural: null,
      evidence: [...oilRegions.flatMap((c) => c.evidence.slice(0, 2)), ...opec.evidence].slice(0, 6).map((e) => ({ text: e.text, date: e.date, source: e.source, url: e.url })),
      notes: [`OPEC+: ${opec.cut} cut and ${opec.raise} more-supply headlines.`, ...oilRegions.filter((c) => c.escalation + c.deescalation > 0).map((c) => `${c.region.label}: ${c.escalation} escalation, ${c.deescalation} de-escalation headlines.`)],
      rewindable: false,
    });
  }

  const front = obsAt(inputs.series[MARKET.brent], at);
  const far = obsAt(inputs.series[MARKET.brentFar], at);
  let curve: ThemeReading;
  if (!front || !far) {
    curve = gapReading('curve', subject, 'no Brent curve (front or later contract)');
  } else {
    const spread = ((front.value - far.value) / front.value) * 100;
    const s: Effect = spread >= ASSET_MOVE.backwardation.strong ? 2 : spread >= ASSET_MOVE.backwardation.moderate ? 1 : spread <= ASSET_MOVE.contango ? -1 : 0;
    curve = reading('curve', subject, {
      state: spread > 0 ? `backwardation ${lvl(spread, 1)}%` : `contango ${lvl(-spread, 1)}%`,
      tactical: null,
      structural: s,
      evidence: [{ text: `Brent front ${lvl(front.value)} vs three months later ${lvl(far.value)}: ${fmt(spread, 1)}% of front`, date: front.date, source: 'Yahoo (NYMEX Brent)' }],
      notes: ['Backwardation = prompt barrels scarcer than later ones: a tight physical market.'],
    });
  }

  return [
    inventories,
    supply,
    curve,
    demandTheme(subject, states.USD, states.AUD, inputs, at),
    dollarTheme(subject, inputs, at),
    riskThemeForAsset(subject, regime, inputs, at),
  ];
}

function equitySubject(subject: AssetSubject, inputs: NarrativeInputs, at: Date, regime: RiskRegime | null, states: Partial<Record<Subject, SubjectState>>): ThemeReading[] {
  const economy = EQUITY_ECONOMY[subject] ?? 'USD';
  const econ = states[economy];
  const pick = (id: ThemeId) => econ?.themes.find((t) => t.id === id);
  const growth = pick('growth');
  const policy = pick('policy');
  const labour = pick('labour');

  const out: ThemeReading[] = [];
  const want = ASSET_THEMES[subject];

  if (want.includes('growth')) {
    out.push(
      growth && !growth.gap
        ? reading('growth', subject, { state: `${economy} growth ${growth.state}`, tactical: growth.tactical, structural: growth.structural, evidence: growth.evidence.slice(0, 3), notes: ['Good data is good for earnings.'] })
        : gapReading('growth', subject, `no ${economy} growth reading`),
    );
  }

  if (want.includes('policy')) {
    if (!policy || policy.gap) {
      out.push(gapReading('policy', subject, `no ${economy} rate-expectations reading`));
    } else {
      let t = negate(policy.tactical);
      const notes = [`Hawkish ${economy} repricing weighs on ${ASSET_SUBJECT_LABEL[subject].toLowerCase()}; dovish supports it.`];
      // Cuts priced because the economy is cracking is not a tailwind.
      if ((policy.tactical ?? 0) < 0 && (labour?.tactical ?? 0) < 0 && (growth?.tactical ?? 0) < 0) {
        t = 0;
        notes.push('Dovish repricing is coming with cooling jobs AND softening growth: "bad news is bad news", so it is not read as supportive.');
      }
      out.push(reading('policy', subject, { state: policy.state, tactical: t, structural: negate(policy.structural), evidence: policy.evidence.slice(0, 3), notes }));
    }
  }

  if (want.includes('yields')) out.push(yieldTheme('yields', subject, MARKET.us10y, 'US 10-year', at, inputs, ASSET_MOVE.equityYieldWeek, ASSET_MOVE.yieldMonth));
  if (want.includes('dollar')) out.push(dollarTheme(subject, inputs, at));
  if (want.includes('risk')) out.push(riskThemeForAsset(subject, regime, inputs, at));
  return out;
}

function metalSubject(subject: AssetSubject, inputs: NarrativeInputs, at: Date, regime: RiskRegime | null, states: Partial<Record<Subject, SubjectState>>): ThemeReading[] {
  const real = yieldTheme('real-yields', subject, MARKET.realYield10y, 'US 10-year real yield (TIPS)', at, inputs, ASSET_MOVE.yieldWeek, ASSET_MOVE.yieldMonth);
  const usPolicy = states.USD?.themes.find((t) => t.id === 'policy');
  if (usPolicy && !usPolicy.gap) real.notes.push(`Fed path: ${usPolicy.state}.`);
  const themes = [real, dollarTheme(subject, inputs, at), riskThemeForAsset(subject, regime, inputs, at)];
  if (ASSET_THEMES[subject].includes('demand')) themes.push(demandTheme(subject, states.USD, states.AUD, inputs, at));
  if (subject === 'gold') themes[0].notes.push('Central-bank gold buying is background (knowledge/assets/gold.md), not a live series.');
  return themes;
}

function cryptoSubject(inputs: NarrativeInputs, at: Date, regime: RiskRegime | null, states: Partial<Record<Subject, SubjectState>>): ThemeReading[] {
  const policy = states.USD?.themes.find((t) => t.id === 'policy');
  const liquidity = !policy || policy.gap
    ? gapReading('policy', 'crypto', 'no Fed path')
    : reading('policy', 'crypto', {
        state: `Fed: ${policy.state}`,
        tactical: negate(policy.tactical),
        structural: negate(policy.structural),
        evidence: policy.evidence.slice(0, 2),
        notes: ['Read as liquidity: dovish Fed repricing supports crypto, hawkish weighs.'],
      });
  return [liquidity, dollarTheme('crypto', inputs, at), riskThemeForAsset('crypto', regime, inputs, at)];
}

// ---------------------------------------------------------------------------
// Whole market
// ---------------------------------------------------------------------------

export function buildMarketState(inputs: NarrativeInputs, at: Date): MarketState {
  const fedPath = buildFedPath(inputs.fed.effr, inputs.fed.contracts, at);
  const conflicts = inputs.headlinesAvailable ? readConflicts(inputs.headlines, at, HEADLINE_WINDOW_DAYS) : [];
  const regime = riskRegime(inputs, at, conflicts);
  const stance: Partial<Record<Currency, StanceReading>> = {};
  const subjects: Partial<Record<Subject, SubjectState>> = {};

  for (const c of CURRENCIES) subjects[c] = currencySubject(c, inputs, at, fedPath, regime, conflicts, stance);

  const order = (s: AssetSubject, themes: ThemeReading[]) => ASSET_THEMES[s].map((id) => themes.find((t) => t.id === id)!).filter(Boolean);
  for (const s of ['gold', 'silver', 'platinum'] as AssetSubject[]) {
    subjects[s] = { subject: s, label: ASSET_SUBJECT_LABEL[s], themes: order(s, metalSubject(s, inputs, at, regime, subjects)) };
  }
  subjects.oil = { subject: 'oil', label: ASSET_SUBJECT_LABEL.oil, themes: order('oil', oilSubject(inputs, at, regime, conflicts, subjects)) };
  subjects.copper = {
    subject: 'copper',
    label: ASSET_SUBJECT_LABEL.copper,
    themes: order('copper', [demandTheme('copper', subjects.USD, subjects.AUD, inputs, at), dollarTheme('copper', inputs, at), riskThemeForAsset('copper', regime, inputs, at)]),
  };
  for (const s of ['us-equities', 'jp-equities', 'eu-equities', 'uk-equities'] as AssetSubject[]) {
    subjects[s] = { subject: s, label: ASSET_SUBJECT_LABEL[s], themes: order(s, equitySubject(s, inputs, at, regime, subjects)) };
  }
  subjects.crypto = { subject: 'crypto', label: ASSET_SUBJECT_LABEL.crypto, themes: order('crypto', cryptoSubject(inputs, at, regime, subjects)) };

  const gaps: string[] = [];
  if (!fedPath.reference) gaps.push('Fed path: no fed funds futures or effective rate');
  else if (!fedPath.reference.label.startsWith('effective')) gaps.push(`Fed path reference: ${fedPath.reference.label}`);
  if (!inputs.headlinesAvailable) gaps.push('Headlines: no source answered — speaker tone, conflicts and fiscal stress are not read');
  if (!regime) gaps.push('Risk: no VIX or S&P 500 bars');

  return { at: at.toISOString(), subjects, fedPath, conflicts, stance, gaps };
}
