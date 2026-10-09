/**
 * Assembles what the model reads: instructions, background, dossier, thread.
 *
 * Order matters and is fixed. The instructions come first (ANALYST.md, verbatim).
 * The background files come next, labelled as durable and dated. The dossier
 * comes last, labelled as the ONLY source of numbers, so the freshest and most
 * authoritative text sits closest to the question.
 */

import { ANALYST_LIMITS } from '@/config/ai.config';
import { REACTION_WORDS } from '@/config/reaction.config';
import type { ChatMessage, ToolDefinition } from '@/lib/ai/openrouter';
import type { KnowledgeSelection } from '@/lib/analysis/knowledge';
import type { SearchHit } from '@/lib/connectors/news-search';
import { age } from '@/lib/analysis/dossier';

export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_news',
    description:
      'Search recent news headlines (last 2 days, Google News) for something the dossier does not cover — ' +
      'for example "European gas prices", "Lagarde speech", "Japan intervention". Returns headlines, publishers and times only, not article text. ' +
      `At most ${ANALYST_LIMITS.queriesPerRound} queries, used once per question; prefer the dossier when it already answers.`,
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string', description: 'A short search phrase in English, under 80 characters.' },
          maxItems: ANALYST_LIMITS.queriesPerRound,
          minItems: 1,
        },
      },
      required: ['queries'],
    },
  },
};

/**
 * The last `threadMessages` turns, each capped, ending on a user turn.
 *
 * Old turns are dropped rather than summarised: a summary would be the model
 * writing its own memory, and a dropped turn is at least honest.
 */
export function trimThread(thread: ThreadMessage[]): ThreadMessage[] {
  const clean = thread
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .map((m) => ({
      role: m.role,
      // Assistant turns are the model's own long answers; cap them harder than
      // the user's, which are already capped at the route.
      content: m.content.slice(0, m.role === 'user' ? ANALYST_LIMITS.messageChars : 6_000),
    }));
  const recent = clean.slice(-ANALYST_LIMITS.threadMessages);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  return recent;
}

export type AnswerMode = 'brief' | 'decision' | 'reaction';

/**
 * Words that ask for a decision: an entry, a hold, a level, a thesis. Checked
 * before the brief words, because "what changed, and do I still hold?" is a
 * decision question that happens to start as a recap.
 */
const DECISION_WORDS =
  /\b(entry|enter|entries|intrare|intru|intra|hold|holding|țin|ţin|tin|close|închid|inchid|tp|sl|take profit|stop loss|flip\w*|invalid\w*|teza|teză|thesis|setup|long|short|buy|sell|cumpăr\w*|cumpar\w*|vând\w*|vand\w*|zones?|zona|zonă|nivel\w*|levels?|scenari\w*|full|complet\w*|analiz\w*|analysis)\b/i;
const BRIEF_WORDS =
  /(\b24 ?h\b|\bazi\b|\btoday\b|\bieri\b|\byesterday\b|ce s-a (întâmplat|intamplat)|what happened|what changed|\brecap\b|\brezumat\b|\bnews\b|știri|stiri|\bheadlines?\b|pe scurt|\bbriefly\b|\bquick\b)/i;

/** A trade action in the question: then it is a decision even if it starts with a move. */
const TRADE_WORDS = /\b(entry|enter|intrare|intru|hold|holding|țin|ţin|tp|sl|take profit|stop loss|thesis|teza|teză|setup)\b/i;
const LINK = /https?:\/\//i;

/**
 * How deep the answer goes. A quick prompt says which it is; free text is read
 * with fixed word lists, and anything unclear gets the full treatment.
 *
 * REACTION first: "the Nasdaq just dropped 2% — why?" or a pasted article is a
 * question about a move that already happened, unless it also asks for a trade.
 */
export function answerMode(question: string, requested?: unknown): AnswerMode {
  if (requested === 'brief' || requested === 'decision' || requested === 'reaction') return requested;
  if ((REACTION_WORDS.test(question) || LINK.test(question)) && !TRADE_WORDS.test(question)) return 'reaction';
  if (DECISION_WORDS.test(question)) return 'decision';
  if (BRIEF_WORDS.test(question)) return 'brief';
  return 'decision';
}

const MODE_TEXT: Record<AnswerMode, string> = {
  brief: [
    '# ANSWER MODE: BRIEF',
    'Open with ONE line restating the tactical verdict from section 0 (MARKET STATE). Then answer the question directly and shortly: ' +
      'what changed, with dates and sources, and whether it moves the state. No full template, no execution section.',
  ].join('\n'),
  decision: [
    '# ANSWER MODE: DECISION',
    'Use the DECISION template from your instructions: Current state → Why (themes, dated) → What changed this week → What would flip it → ' +
      'What would confirm it → Event risk → Board vs narrative → the answer to the question. Take the state, the flips and the confirmations from ' +
      'section 0 (MARKET STATE) as given; quote their thresholds and dates.',
  ].join('\n'),
  reaction: [
    '# ANSWER MODE: REACTION',
    'The question is about a move that already happened. Use the REACTION template from your instructions: What moved → The pattern → ' +
      'Candidate catalysts → Most likely explanation, and what does not fit → What it means for this market → What to watch next. ' +
      'Take every number and time from section R (WHAT JUST MOVED) as given. A headline can only be a cause if its time is at or before the ' +
      'start of the move; say "inference" when you connect them. Repeat any MISMATCH line from section R in plain words. If the user\'s numbers ' +
      'differ from section R, say so and use section R.',
  ].join('\n'),
};

/** How long the model thinks: a recap is quick, a decision or a reaction is not. */
export function effortFor(mode: AnswerMode): 'low' | 'medium' {
  return mode === 'brief' ? 'low' : 'medium';
}

export function buildMessages(knowledge: KnowledgeSelection, dossier: string, thread: ThreadMessage[], mode: AnswerMode = 'decision'): ChatMessage[] {
  const system = [
    knowledge.system,
    MODE_TEXT[mode],
    '---',
    '# BACKGROUND FILES',
    'Durable knowledge with dates and sources. Label anything you take from here as background. It is never today\'s data.',
    knowledge.background,
    '---',
    '# DOSSIER',
    'Live data built for this question. The ONLY source of numbers, levels and dates you may cite.',
    dossier,
  ].join('\n\n');

  return [{ role: 'system', content: system }, ...trimThread(thread)];
}

/** What the model gets back from `search_news`. */
export function formatSearchResults(results: { query: string; hits: SearchHit[] }[], now: Date): string {
  return results
    .map((r) =>
      [
        `Search "${r.query}":`,
        ...(r.hits.length === 0 ? ['(no results)'] : r.hits.map((h) => `- [${age(h.publishedUtc, now)} · ${h.source || h.domain}] ${h.title}`)),
      ].join('\n'),
    )
    .join('\n\n');
}

/** Pulls the query list out of a tool call's JSON arguments, defensively. */
export function parseSearchArgs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { queries?: unknown; query?: unknown };
    const list = Array.isArray(parsed.queries) ? parsed.queries : typeof parsed.query === 'string' ? [parsed.query] : [];
    return list.filter((q): q is string => typeof q === 'string' && q.trim() !== '').slice(0, ANALYST_LIMITS.queriesPerRound);
  } catch {
    return [];
  }
}
