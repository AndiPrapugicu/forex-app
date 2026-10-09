/**
 * Section F of the dossier: how the server read the question, printed first,
 * so the model answers the question the user asked about the moment they
 * meant — and the user sees the same line under their question.
 */

import type { Intent } from '@/lib/analysis/intent';
import type { ReactionReading } from '@/lib/analysis/reaction';
import type { AuctionCalendar } from '@/lib/connectors/treasury-auctions';

const DAY = 86_400_000;

const stamp = (ms: number, nowMs: number) => {
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10) ? `${iso.slice(11, 16)}Z` : `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;
};

const KIND_TEXT: Record<Intent['kind'], string> = {
  reaction: 'REACTION (a move that already happened)',
  event: 'EVENT (what a release or meeting does to this market)',
  decision: 'DECISION (direction, entry, hold)',
  brief: 'BRIEF (a recap)',
  explain: 'EXPLAIN (how something works)',
  compare: 'COMPARE (several markets)',
  full: 'FULL READ',
};

export function describedText(d: Intent['described']): string | null {
  if (!d) return null;
  return `${d.direction < 0 ? 'down' : 'up'}${d.pct !== null ? ` ~${d.pct}%` : ''}${d.minutes !== null ? ` in ~${d.minutes} min` : ''}`;
}

export function factsLines(i: {
  intent: Intent;
  charts: string[];
  reaction: ReactionReading | null;
  auctions: AuctionCalendar | null;
  now: Date;
}): { lines: string[]; summary: string } {
  const nowMs = i.now.getTime();
  const { intent } = i;
  const lines = ['## F. QUESTION FACTS (how the server read the question; deterministic)', `- Answer kind: ${KIND_TEXT[intent.kind]}.`];
  const summary: string[] = [intent.kind];

  if (intent.anchor) {
    lines.push(
      `- When: ${intent.anchor.label} = ${stamp(intent.anchor.fromMs, nowMs)} to ${stamp(intent.anchor.toMs, nowMs)} (from ${intent.anchor.source === 'chart' ? "the user's chart" : 'the question'}).`,
    );
    summary.push(intent.anchor.label);
  } else if (intent.kind === 'reaction') {
    lines.push('- When: the question names no moment, so the last few hours were searched.');
  }
  const said = describedText(intent.described);
  if (said) {
    lines.push(`- Move described: ${said} (from ${intent.described!.source === 'chart' ? "the ruler on the user's chart" : 'their words'}).`);
    summary.push(`you said ${said}`);
  }
  if (intent.instruments.length) lines.push(`- Markets named: ${intent.instruments.map((m) => m.label).join(', ')}.`);
  if (intent.event) lines.push(`- Event asked about: ${intent.event.currency} ${intent.event.label}.`);
  if (i.charts.length) lines.push('- Attached charts (read from pixels by a vision model; approximate):', ...i.charts.map((c) => `  ${c}`));

  const r = i.reaction;
  if (r) {
    if (r.match?.status === 'no-match') {
      lines.push('- Measured: NO MATCH — our 5-minute bars hold no such move in that window (details in section R).');
      summary.push('no matching move found');
    } else if (r.move) {
      const m = r.move;
      const text = `${r.symbol} ${m.changePct > 0 ? '+' : '−'}${Math.abs(m.changePct).toFixed(2)}% ${stamp(m.startMs, nowMs)}–${stamp(m.endMs, nowMs)}`;
      lines.push(`- Measured on our 5-minute bars: ${text}${r.match?.status === 'smaller' ? ' (smaller than described)' : ''}.`);
      summary.push(`measured ${text}`);
    }
  }

  const upcoming = (i.auctions?.upcoming ?? []).filter((a) => a.closeMs > nowMs && a.closeMs < nowMs + 7 * DAY);
  if (upcoming.length) {
    lines.push(`- US Treasury coupon auctions in the next 7 days: ${upcoming.map((a) => `${a.label} ${stamp(a.closeMs, nowMs)}${a.offeringBn ? ` ($${a.offeringBn}bn)` : ''}`).join('; ')}.`);
  }

  return { lines, summary: summary.join(' · ') };
}
