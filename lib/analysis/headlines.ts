/**
 * Reading headlines with fixed phrase rules — never a model.
 *
 * Three readers: a central banker's tone, conflict escalation by region, and
 * fiscal or political stress by economy. Each returns counts and the headlines
 * behind them, so every state the engine prints can show its receipts.
 *
 * Headlines EXPLAIN the narrative; prices decide it (config/narrative.config.ts).
 * The tone reader therefore feeds evidence and a "not yet priced" note to the
 * policy theme, and votes nowhere.
 */

import {
  BANK_PATTERN,
  CONFLICT_REGIONS,
  CONFLICT_TERMS,
  DEESCALATION_TERMS,
  FISCAL_REGION,
  FISCAL_TERMS,
  OPEC_CUT,
  OPEC_RAISE,
  STANCE_NEGATED,
  STANCE_PLAIN,
  type ConflictRegion,
  type Stance,
} from '@/config/narrative.config';
import { CORROBORATION_DOMAINS } from '@/config/scoring.config';
import type { Currency } from '@/lib/types';

export interface Headline {
  title: string;
  url: string;
  domain: string;
  publishedUtc: string;
}

export interface HeadlineEvidence {
  text: string;
  date: string;
  source: string;
  url?: string;
}

const DAY_MS = 86_400_000;

/** Same story from two feeds, or the RSS and the search, counts once. */
export function dedupeHeadlines(list: Headline[]): Headline[] {
  const key = (h: Headline) => h.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const seen = new Map<string, Headline>();
  for (const h of list) {
    const k = key(h);
    const prior = seen.get(k);
    if (!prior || h.publishedUtc < prior.publishedUtc) seen.set(k, h);
  }
  return [...seen.values()].sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc));
}

export function inWindow(list: Headline[], at: Date, days: number): Headline[] {
  const from = at.getTime() - days * DAY_MS;
  return list.filter((h) => {
    const t = Date.parse(h.publishedUtc);
    return t >= from && t <= at.getTime() + 60_000;
  });
}

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

/**
 * One headline's stance. Negated phrases run first and are blanked out, so
 * "no further hikes" is dovish and can never also match "further hikes".
 * Both sides in one headline is AMBIGUOUS — reported, never resolved.
 */
export function classifyStance(text: string): Stance | null {
  let rest = text;
  const found = new Set<Stance>();
  for (const { stance, pattern } of STANCE_NEGATED) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    if (global.test(rest)) {
      found.add(stance);
      rest = rest.replace(global, ' ');
    }
  }
  for (const { stance, pattern } of STANCE_PLAIN) {
    if (pattern.test(rest)) found.add(stance);
  }
  const hawk = found.has('hawkish');
  const dove = found.has('dovish');
  if (hawk && dove) return 'ambiguous';
  if (hawk) return 'hawkish';
  if (dove) return 'dovish';
  if (found.has('hold')) return 'hold';
  return null;
}

/** The bank a headline is about: the one named first. */
export function bankOf(text: string): Currency | null {
  let best: { c: Currency; at: number } | null = null;
  for (const [c, pattern] of Object.entries(BANK_PATTERN) as [Currency, RegExp][]) {
    const m = pattern.exec(text);
    if (m && (best === null || m.index < best.at)) best = { c, at: m.index };
  }
  return best?.c ?? null;
}

export interface StanceReading {
  hawkish: number;
  dovish: number;
  /** "On hold" headlines, before they are read against what is priced. */
  hold: number;
  ambiguous: number;
  /** Net after a hold is read against pricing: holding while hikes are priced is dovish. */
  net: 'hawkish' | 'dovish' | 'mixed' | 'none';
  evidence: HeadlineEvidence[];
}

/**
 * The tone of one bank's speakers over the window.
 *
 * `pricedDirection` is what the market prices next (+ hikes, − cuts, 0 flat).
 * A "hold" headline only has a direction relative to that: holding while
 * hikes are priced takes them out (dovish), holding while cuts are priced
 * takes those out (hawkish).
 */
export function readStance(headlines: Headline[], currency: Currency, at: Date, days: number, pricedDirection: number): StanceReading {
  const out: StanceReading = { hawkish: 0, dovish: 0, hold: 0, ambiguous: 0, net: 'none', evidence: [] };
  for (const h of inWindow(headlines, at, days)) {
    if (bankOf(h.title) !== currency) continue;
    const stance = classifyStance(h.title);
    if (!stance) continue;
    out[stance === 'ambiguous' ? 'ambiguous' : stance] += 1;
    let read: string = stance;
    if (stance === 'hold') read = pricedDirection > 0 ? 'hold while hikes are priced → dovish' : pricedDirection < 0 ? 'hold while cuts are priced → hawkish' : 'hold';
    out.evidence.push({ text: `${h.title} [${read}]`, date: h.publishedUtc, source: h.domain, url: h.url });
  }
  const holdDovish = pricedDirection > 0 ? out.hold : 0;
  const holdHawkish = pricedDirection < 0 ? out.hold : 0;
  const hawk = out.hawkish + holdHawkish;
  const dove = out.dovish + holdDovish;
  out.net = hawk === 0 && dove === 0 ? 'none' : hawk > dove * 1.5 ? 'hawkish' : dove > hawk * 1.5 ? 'dovish' : 'mixed';
  out.evidence = out.evidence.slice(0, 6);
  return out;
}

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------

export interface ConflictReading {
  region: ConflictRegion;
  escalation: number;
  deescalation: number;
  /** Distinct outlets carrying escalation headlines. */
  domains: number;
  corroborated: boolean;
  evidence: HeadlineEvidence[];
}

export function readConflicts(headlines: Headline[], at: Date, days: number): ConflictReading[] {
  const window = inWindow(headlines, at, days);
  return CONFLICT_REGIONS.map((region) => {
    const domains = new Set<string>();
    const out: ConflictReading = { region, escalation: 0, deescalation: 0, domains: 0, corroborated: false, evidence: [] };
    for (const h of window) {
      if (!region.pattern.test(h.title)) continue;
      // A ceasefire headline usually names the war too; it is de-escalation.
      if (DEESCALATION_TERMS.test(h.title)) {
        out.deescalation += 1;
        out.evidence.push({ text: `${h.title} [de-escalation]`, date: h.publishedUtc, source: h.domain, url: h.url });
      } else if (CONFLICT_TERMS.test(h.title)) {
        out.escalation += 1;
        domains.add(h.domain);
        out.evidence.push({ text: `${h.title} [escalation]`, date: h.publishedUtc, source: h.domain, url: h.url });
      }
    }
    out.domains = domains.size;
    out.corroborated = domains.size >= CORROBORATION_DOMAINS;
    out.evidence = out.evidence.slice(0, 5);
    return out;
  });
}

/** −2..+2: + is escalation. Corroboration is what makes it strong. */
export function conflictLevel(r: ConflictReading): number {
  const net = r.escalation - r.deescalation;
  if (net <= 0) return r.deescalation > r.escalation ? -1 : 0;
  return r.corroborated ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Fiscal / political
// ---------------------------------------------------------------------------

export interface FiscalReading {
  count: number;
  domains: number;
  corroborated: boolean;
  evidence: HeadlineEvidence[];
}

export function readFiscal(headlines: Headline[], currency: Currency, at: Date, days: number): FiscalReading {
  const region = FISCAL_REGION[currency];
  const out: FiscalReading = { count: 0, domains: 0, corroborated: false, evidence: [] };
  if (!region) return out;
  const domains = new Set<string>();
  for (const h of inWindow(headlines, at, days)) {
    if (!region.test(h.title) || !FISCAL_TERMS.test(h.title)) continue;
    out.count += 1;
    domains.add(h.domain);
    out.evidence.push({ text: h.title, date: h.publishedUtc, source: h.domain, url: h.url });
  }
  out.domains = domains.size;
  out.corroborated = domains.size >= CORROBORATION_DOMAINS;
  out.evidence = out.evidence.slice(0, 5);
  return out;
}

// ---------------------------------------------------------------------------
// OPEC
// ---------------------------------------------------------------------------

export function readOpec(headlines: Headline[], at: Date, days: number): { cut: number; raise: number; evidence: HeadlineEvidence[] } {
  const out = { cut: 0, raise: 0, evidence: [] as HeadlineEvidence[] };
  for (const h of inWindow(headlines, at, days)) {
    const raise = OPEC_RAISE.test(h.title);
    const cut = !raise && OPEC_CUT.test(h.title);
    if (!raise && !cut) continue;
    out[raise ? 'raise' : 'cut'] += 1;
    out.evidence.push({ text: `${h.title} [${raise ? 'more supply' : 'less supply'}]`, date: h.publishedUtc, source: h.domain, url: h.url });
  }
  out.evidence = out.evidence.slice(0, 4);
  return out;
}
