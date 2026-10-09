/**
 * Assembles what the model reads: instructions, background, dossier, thread.
 *
 * Order matters and is fixed. The instructions come first (ANALYST.md, verbatim).
 * The background files come next, labelled as durable and dated. The dossier
 * comes last, labelled as the ONLY source of numbers, so the freshest and most
 * authoritative text sits closest to the question.
 */

import { ANALYST_LIMITS } from '@/config/ai.config';
import { parseQuestion, type IntentKind } from '@/lib/analysis/intent';
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

export type AnswerMode = IntentKind;

/**
 * Which answer the question wants (lib/analysis/intent.ts). A quick prompt
 * says which; free text is read with fixed word lists, and anything unclear
 * gets a DECISION answer.
 */
export function answerMode(question: string, requested?: unknown, pageSymbol = ''): AnswerMode {
  return parseQuestion(question, pageSymbol, Date.now(), { requested }).kind;
}

/** The most words an answer may use, per mode. Short by default; FULL only on request. */
export const WORD_CAP: Record<AnswerMode, number> = {
  brief: 120,
  explain: 150,
  event: 200,
  compare: 200,
  reaction: 220,
  decision: 250,
  full: 600,
};

const MODE_TEXT: Record<AnswerMode, string> = {
  brief: [
    '# ANSWER MODE: BRIEF',
    'A recap. Bottom line: what changed, and whether it moves the tactical verdict in section 0 (name the verdict in a few words). ' +
      'Then up to four dated bullets. Then one Watch line.',
  ].join('\n'),
  explain: [
    '# ANSWER MODE: EXPLAIN',
    'The user asks how something works. Bottom line: the mechanism in one or two plain sentences. Then up to three bullets: the channel ' +
      '(what moves what, and why), a current example from the dossier with its date if there is one, and when the relationship breaks down. ' +
      'No market-state recital and no levels unless asked.',
  ].join('\n'),
  event: [
    '# ANSWER MODE: EVENT',
    'The user asks what a release or meeting does to this market. Use section E (how this symbol moved on past releases of it) and the ' +
      'flip conditions in section 0. Bottom line: the typical reaction from section E with its sample size, and the threshold from section 0 ' +
      'that would tip the state. Bullets: the next release with its date and forecast; above- vs below-forecast tendency; what else is on the ' +
      'calendar around it; the levels to watch from section 7. If section E is missing, say the reaction history is not in the data and label ' +
      'anything you add as background.',
  ].join('\n'),
  compare: [
    '# ANSWER MODE: COMPARE',
    'Use section O for the other markets and the board and section 0 for this one. Bottom line: which is stronger and why, in one sentence. ' +
      'Then one bullet per market: board total and bias, the cells or themes that drive it, the 1-week change. Then the one thing that would ' +
      'change the ranking.',
  ].join('\n'),
  reaction: [
    '# ANSWER MODE: REACTION',
    'The question is about a move that already happened. Section R measured it on OUR 5-minute bars; take every number and time from it. ' +
      'If section R says NO MATCH, say what was measured, ask for the date and time, and stop: never explain a different move. ' +
      'Bottom line: what moved and the most likely cause. If section R prints SPLIT, give the cause of the symbol\'s move and the cause of ' +
      'the bond move separately. Bullets: the move (size, from-to times, in UTC); the pattern and what it rules out; the evidence for each cause ' +
      '(a scheduled event inside the move, the market attribution with its outlet count and first time, a trigger published before the start); ' +
      'what does not fit (a trigger or story first seen after the start cannot have STARTED the move, though a story first seen inside it can have ' +
      'accelerated it; attribution headlines are after the fact by nature, so judge them by "story first seen"). One Watch line. Say "our 5-minute data" ' +
      'for section R and "your chart" for a chart reading; never present our bars as the user\'s timeframe.',
  ].join('\n'),
  decision: [
    '# ANSWER MODE: DECISION',
    'Bottom line: the answer to the question, with the tactical and structural verdicts from section 0 in a few words. Then at most five ' +
      'bullets: the two or three themes that carry the state, dated; the nearest flip condition with its threshold and date; the event risk ' +
      'before it; for an entry, zones from section 7 only, each with its condition and invalidation; for a hold, the thesis check. ' +
      'One Watch line. Mention once that a full read is available.',
  ].join('\n'),
  full: [
    '# ANSWER MODE: FULL READ',
    'Use the FULL READ template from your instructions: Current state → Why (themes, dated) → What changed this week → What would flip it → ' +
      'What would confirm it → Event risk → Board vs narrative → the answer to the question. Take the state, the flips and the confirmations ' +
      'from section 0 (MARKET STATE) as given; quote their thresholds and dates.',
  ].join('\n'),
};

/** The closing instruction: mode, length, and the shape every answer takes. Last, so it is what the model read most recently. */
export function modeInstruction(mode: AnswerMode): string {
  return [
    MODE_TEXT[mode],
    `LENGTH: at most ${WORD_CAP[mode]} words. Open with "**Bottom line:**" and answer the question in it. Bullets, not paragraphs. ` +
      'Answer in the language of the question. End with the one-line not-advice note.',
  ].join('\n');
}

/** How long the model thinks: a recap or an explanation is quick; the rest are not. */
export function effortFor(mode: AnswerMode): 'low' | 'medium' {
  return mode === 'brief' || mode === 'explain' ? 'low' : 'medium';
}

export function buildMessages(knowledge: KnowledgeSelection, dossier: string, thread: ThreadMessage[], mode: AnswerMode = 'decision'): ChatMessage[] {
  const system = [
    knowledge.system,
    '---',
    '# BACKGROUND FILES',
    'Durable knowledge with dates and sources. Label anything you take from here as background. It is never today\'s data.',
    knowledge.background,
    '---',
    '# DOSSIER',
    'Live data built for this question. The ONLY source of numbers, levels and dates you may cite.',
    dossier,
    '---',
    modeInstruction(mode),
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
