/**
 * One question to the analyst, end to end: read the question, build the
 * dossier and its question-specific sections, ask the free model (with one
 * optional search round), and report what happened through `emit`.
 *
 * The route (app/api/ai/analysis/route.ts) streams these events to the
 * browser; scripts/ai-eval.ts collects them. Both run exactly this code, so
 * what the evaluation measures is what the user gets.
 *
 * The question is read first by fixed rules (lib/analysis/intent.ts): which
 * answer it wants, WHEN it is about ("yesterday", a chart's date), the move it
 * describes, the markets and the release it names. That reading picks the
 * extra sections the dossier gets, all deterministic and printed FIRST:
 *   F  what the server understood, and what the attached charts show;
 *   R  a move that already happened, measured in the window the user means;
 *   E  how this symbol moved on past releases of the event asked about;
 *   O  a compact read of other markets named in the question.
 */

import { ANALYST_LIMITS } from '@/config/ai.config';
import { findSymbol, type SymbolDefinition } from '@/config/symbols.config';
import { describeImages, OpenRouterError, streamChat, type ChatMessage, type ChatOptions, type ToolCall } from '@/lib/ai/openrouter';
import { chartFacts, parseChartReadings, type ChartReading } from '@/lib/analysis/chart-reading';
import { buildDossier } from '@/lib/analysis/dossier';
import { eventStudyLines, loadEventStudy } from '@/lib/analysis/event-study';
import { factsLines } from '@/lib/analysis/facts';
import { parseQuestion } from '@/lib/analysis/intent';
import { selectKnowledge } from '@/lib/analysis/knowledge';
import { loadAnalysisInputs } from '@/lib/analysis/load';
import { loadOtherMarkets, otherMarketLines } from '@/lib/analysis/other-markets';
import { buildMessages, effortFor, formatSearchResults, parseSearchArgs, SEARCH_TOOL, type AnswerMode, type ThreadMessage } from '@/lib/analysis/prompt';
import { reactionLines } from '@/lib/analysis/reaction';
import { loadReaction } from '@/lib/analysis/reaction-load';
import { sanitizeQuery, searchNews } from '@/lib/connectors/news-search';
import { fetchTreasuryAuctions } from '@/lib/connectors/treasury-auctions';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import type { Position } from '@/lib/types';

export type AnswerEvent =
  | { type: 'status'; text: string }
  | { type: 'vision'; text: string; model: string }
  | { type: 'understood'; text: string }
  | { type: 'reasoning' }
  | { type: 'delta'; text: string };

export interface AnswerResult {
  mode: AnswerMode;
  /** Model requests used against the free allowance, retries included. */
  requests: number;
  cost: number | null;
  /** Characters of answer text. */
  answered: number;
  /** What the model was given, for the evaluation. */
  dossierText: string;
}

/** How often a "still thinking" tick may reach the browser. */
const REASONING_TICK_MS = 1_000;

export function firstReading(question: string, def: SymbolDefinition, requestedMode?: unknown) {
  return parseQuestion(question, def.symbol, Date.now(), { requested: requestedMode });
}

export async function answerQuestion(args: {
  def: SymbolDefinition;
  /** Trimmed thread, ending on the user's question. */
  thread: ThreadMessage[];
  question: string;
  requestedMode?: unknown;
  images: string[];
  /** The user's open positions; the caller decides whether the viewer may see them. */
  positions: Position[];
  model: string;
  signal?: AbortSignal;
  now?: Date;
  emit: (e: AnswerEvent) => void;
}): Promise<AnswerResult> {
  const { def, thread, question, images, emit, signal } = args;
  const firstRead = firstReading(question, def, args.requestedMode);
  const mode = firstRead.kind;
  const effort = effortFor(mode);
  let requests = 0;
  let cost: number | null = null;
  let answered = 0;
  let lastTick = 0;

  /** One model request, streamed through; returns the tool calls it asked for. */
  const round = async (messages: ChatMessage[], opts: ChatOptions): Promise<ToolCall[]> => {
    requests++;
    let calls: ToolCall[] = [];
    for await (const event of streamChat(messages, { ...opts, signal })) {
      if (event.type === 'content') {
        answered += event.text.length;
        emit({ type: 'delta', text: event.text });
      } else if (event.type === 'reasoning') {
        if (Date.now() - lastTick > REASONING_TICK_MS) {
          lastTick = Date.now();
          emit({ type: 'reasoning' });
        }
      } else if (event.type === 'retry') {
        // A retry is another request against the free allowance; count it.
        requests++;
        emit({
          type: 'status',
          text: `The free model's provider is busy — trying again in ${Math.round(event.waitMs / 1000)}s (${event.attempt}/${event.of})…`,
        });
      } else if (event.type === 'tool_calls') {
        calls = event.calls;
      } else if (event.type === 'usage' && event.cost !== null) {
        cost = (cost ?? 0) + event.cost;
      }
    }
    return calls;
  };

  emit({
    type: 'status',
    text: images.length
      ? `Reading the attached chart${images.length > 1 ? 's' : ''}, the board, rates, calendar and headlines…`
      : mode === 'reaction'
        ? 'Measuring the move across stocks, yields, the dollar, havens and oil, and timing the headlines…'
        : 'Reading the board, rates, calendar, headlines and central-bank feeds…',
  });
  const now = args.now ?? new Date();
  const others = firstRead.otherSymbols.map((x) => findSymbol(x)).filter((d) => d !== undefined);
  const knowledge = selectKnowledge(def, undefined, { mode, others });
  // One board run for the dossier and the other-markets section.
  const board = runSetupsPipeline(now);
  const [inputs, vision, otherMarkets, auctions] = await Promise.all([
    loadAnalysisInputs(def, now, board, { positions: args.positions }),
    images.length
      ? (async () => {
          requests++;
          return describeImages(images, question, {
            signal,
            onRetry: () => {
              requests++;
            },
            onFallback: (model) => {
              requests++;
              emit({ type: 'status', text: `The first chart reader is busy — trying ${model}…` });
            },
          });
        })().catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      : Promise.resolve(null),
    firstRead.otherSymbols.length ? loadOtherMarkets(firstRead.otherSymbols, board, now).catch(() => []) : Promise.resolve([]),
    def.kind !== 'fx' || def.base === 'USD' || def.quote === 'USD' ? fetchTreasuryAuctions().catch(() => null) : Promise.resolve(null),
  ]);
  const dossier = buildDossier(inputs);
  let threadForModel = thread;
  let charts: ChartReading[] = [];
  if (vision && 'text' in vision) {
    if (vision.cost !== null) cost = (cost ?? 0) + vision.cost;
    emit({ type: 'vision', text: vision.text, model: vision.model });
    charts = parseChartReadings(vision.text, now.getTime());
    // The reading rides on the question it came with, so a follow-up still has it.
    threadForModel = thread.map((m, k) =>
      k === thread.length - 1
        ? { ...m, content: `${m.content}\n\n[CHART READING — the user's attached chart, read from pixels by ${vision.model}; approximate]\n${vision.text}` }
        : m,
    );
  } else if (vision && 'error' in vision) {
    emit({ type: 'status', text: `The chart could not be read (${vision.error}); answering from the data alone.` });
    threadForModel = thread.map((m, k) => (k === thread.length - 1 ? { ...m, content: `${m.content}\n\n[The user attached a chart, but it could not be read: say so.]` } : m));
  }

  // The full reading, now that the charts are in.
  const intent = parseQuestion(question, def.symbol, now.getTime(), { requested: args.requestedMode, charts });
  if (intent.kind === 'reaction') {
    emit({ type: 'status', text: `Measuring the move${intent.anchor ? ` (${intent.anchor.label})` : ''} across stocks, yields, the dollar, havens and oil, and timing the headlines…` });
  }
  const [reaction, study] = await Promise.all([
    intent.kind === 'reaction' ? loadReaction(def, question, now, intent, inputs.events).catch(() => null) : Promise.resolve(null),
    intent.event && (intent.kind === 'event' || intent.kind === 'decision' || intent.kind === 'full') && intent.event.names.length
      ? loadEventStudy(def, intent.event, inputs.events, now).catch(() => null)
      : Promise.resolve(null),
  ]);
  const facts = factsLines({ intent, charts: chartFacts(charts), reaction, auctions, now });
  emit({ type: 'understood', text: facts.summary });

  const dossierText = [
    ...facts.lines,
    '',
    ...(reaction ? [...reactionLines(reaction), ''] : []),
    ...(study ? [...eventStudyLines(study), ''] : []),
    ...(otherMarkets.length ? [...otherMarketLines(otherMarkets), ''] : []),
    dossier.text,
  ].join('\n');
  const docs = dossier.summary.banks.filter((b) => b.title).length;
  emit({
    type: 'status',
    text: `Dossier ready: ${dossier.summary.news.clusters} stories, ${dossier.summary.news.searchHits} search hits, ${docs} central-bank document${docs === 1 ? '' : 's'}. Asking ${args.model} (${mode} answer)…`,
  });

  const messages = buildMessages(knowledge, dossierText, threadForModel, mode);
  const calls = await round(messages, { tools: [SEARCH_TOOL], toolChoice: 'auto', effort });

  if (calls.length > 0) {
    const perCall = calls.map((call) => ({
      call,
      queries: call.function.name === 'search_news' ? parseSearchArgs(call.function.arguments) : [],
    }));
    const all = [...new Set(perCall.flatMap((p) => p.queries).map(sanitizeQuery).filter(Boolean))].slice(0, ANALYST_LIMITS.queriesPerRound);
    emit({ type: 'status', text: all.length ? `Searching: ${all.join(' · ')}` : 'The model asked for an unknown tool; continuing without it.' });

    const hits = new Map(await Promise.all(all.map(async (q) => [q, await searchNews(q, { limit: 8 })] as const)));
    const followUp: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: '', tool_calls: calls },
      ...perCall.map(({ call, queries }) => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content:
          call.function.name === 'search_news'
            ? formatSearchResults(
                queries
                  .map(sanitizeQuery)
                  .filter((q) => hits.has(q))
                  .map((q) => ({ query: q, hits: hits.get(q)! })),
                now,
              ) || '(no queries run)'
            : 'Unknown tool. Answer from the dossier.',
      })),
    ];
    if (answered > 0) emit({ type: 'delta', text: '\n\n' });
    await round(followUp, { tools: [SEARCH_TOOL], toolChoice: 'none', effort });
  }

  if (answered === 0) throw new OpenRouterError('The model returned an empty answer. Try again, or rephrase the question.');
  return { mode, requests, cost, answered, dossierText };
}
