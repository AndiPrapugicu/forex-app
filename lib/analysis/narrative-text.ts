/**
 * The market state as dossier text — the section the analyst must restate.
 *
 * Pure. Every line carries its date or names its source, and the flip list is
 * printed with its thresholds, so the model has no reason (and no licence) to
 * invent a trigger of its own.
 */

import { FLIPS, type Subject } from '@/config/narrative.config';
import { pricedBp, type FedPath } from '@/lib/connectors/fed-futures';
import type { FlipCondition, PairNarrative, PairTheme } from '@/lib/analysis/state';
import { subjectLabel } from '@/lib/analysis/state';
import type { MarketState, ThemeReading } from '@/lib/analysis/themes';

const signed = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'undated');

function legLine(subject: Subject, t: ThemeReading | null): string[] {
  if (!t) return [`    ${subjectLabel(subject)}: no reading`];
  if (t.gap) return [`    ${subjectLabel(subject)}: GAP — ${t.gap}`];
  const out = [`    ${subjectLabel(subject)}: ${t.state} (tactical ${signed(t.tactical)}, structural ${signed(t.structural)})`];
  for (const e of t.evidence.slice(0, 3)) out.push(`      · ${e.text} [${day(e.date)}, ${e.source}]`);
  for (const n of t.notes.slice(0, 3)) out.push(`      note: ${n}`);
  return out;
}

function themeBlock(p: PairNarrative, t: PairTheme): string[] {
  const head = `- ${t.label}${t.weight > 1 ? ' (×2)' : ''}: tactical ${signed(t.tactical)}, structural ${signed(t.structural)}${t.partial ? ' (one leg unread, counted as 0)' : ''}`;
  return [head, ...legLine(p.base, t.base), ...(p.quote ? legLine(p.quote, t.quote) : [])];
}

function flipLine(f: FlipCondition): string {
  const tag = f.role === 'flip' ? 'FLIP' : f.role === 'confirm' ? 'CONFIRM' : 'TIP';
  return `- [${tag} → ${f.favours}] ${f.text}`;
}

export function fedPathLines(path: FedPath, at: Date): string[] {
  if (!path.reference) return ['Fed path: no fed funds futures reading.'];
  const out = [`Fed path (CBOT 30-day fed funds; implied = 100 − price; vs ${path.reference.label} ${path.reference.value}% on ${path.reference.date}):`];
  for (const months of [1, 2, 3, 6]) {
    const p = pricedBp(path, at, months);
    if (!p || p.now === null) continue;
    out.push(`  ${p.point.month} (${p.point.ticker}): ${p.point.implied}% → ${signed(p.now)}bp priced; a week ago ${signed(p.weekAgo)}bp, a month ago ${signed(p.monthAgo)}bp`);
  }
  return out;
}

export function narrativeLines(p: PairNarrative, state: MarketState, opts: { positionLines?: string[] } = {}): string[] {
  const at = new Date(state.at);
  const flips = p.flips.filter((f) => f.role !== 'confirm');
  const confirms = p.flips.filter((f) => f.role === 'confirm');
  const usd = p.base === 'USD' || p.quote === 'USD' || !['EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'ZAR'].includes(String(p.base));

  const out = [
    `## 0. MARKET STATE (deterministic, computed ${state.at.slice(0, 16)}Z — restate it; do not re-derive it)`,
    'How to read: each theme has an effect on its subject from −2 to +2 (+ = bullish for that currency or asset), tactical (days to two weeks) and structural (one to three months). ' +
      `A pair is base minus quote. Rates count ×2. A verdict needs a weighted sum of ±3 with at least two themes on that side. This is NOT the board score.`,
    `Tactical verdict for ${p.symbol}: ${p.tactical.text} (weighted sum ${signed(p.tactical.sum)}).`,
    `Structural verdict for ${p.symbol}: ${p.structural.text} (weighted sum ${signed(p.structural.sum)}).`,
    'Themes:',
    ...p.themes.flatMap((t) => themeBlock(p, t)),
  ];

  if (usd) out.push(...fedPathLines(state.fedPath, at));

  out.push(flips.length ? 'What would flip or tip it (generated thresholds, nearest first):' : 'What would flip it: no scheduled release or market trigger inside the horizon.');
  out.push(...flips.slice(0, FLIPS.shown * 2).map(flipLine));
  if (confirms.length) {
    out.push('What would confirm it:');
    out.push(...confirms.slice(0, FLIPS.shown).map(flipLine));
  }

  out.push(p.changeBasis ? `What changed this week (against ${p.changeBasis}):` : 'What changed this week: no earlier state to compare with.');
  out.push(...(p.changes.length ? p.changes.map((c) => `- ${c.text}`) : p.changeBasis ? ['- No theme moved.'] : []));

  if (opts.positionLines?.length) out.push(...opts.positionLines);
  if (state.gaps.length) out.push(`Narrative gaps: ${state.gaps.join('; ')}.`);
  return out;
}

