/**
 * One question to the AI analyst, answered as a stream.
 *
 * Gates, in order: the passphrase cookie, a configured OpenRouter key, a known
 * symbol, a non-empty question, and a per-process rate limit. Then a FRESH
 * dossier is built — board, rates, calendar, headlines, live search, central
 * bank feeds — so a headline from fifteen minutes ago is in it.
 *
 * Normally one or two model requests per question: one with the `search_news`
 * tool offered, and, only if the model used it, one more with tools switched
 * off. A busy provider (503 "temporarily overloaded" is common on free
 * endpoints) is retried twice per round before giving up, and every retry is
 * counted in the `requests` the answer reports.
 *
 * The response is NDJSON, one event per line:
 *   {type:'status', text}      what the server is doing
 *   {type:'reasoning'}         the model is thinking (throttled; no text)
 *   {type:'delta', text}       answer text
 *   {type:'done', model, cost, requests, mode, seconds}
 *   {type:'error', message}
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ANALYST_LIMITS } from '@/config/ai.config';
import { findSymbol } from '@/config/symbols.config';
import { getOpenRouterConfig, OpenRouterError, streamChat, type ChatMessage, type ChatOptions, type ToolCall } from '@/lib/ai/openrouter';
import { ACCESS_COOKIE, createRateLimiter, hasAccess, isAccessConfigured } from '@/lib/analysis/access';
import { buildDossier } from '@/lib/analysis/dossier';
import { selectKnowledge } from '@/lib/analysis/knowledge';
import { loadAnalysisInputs } from '@/lib/analysis/load';
import { readOpenPositions } from '@/lib/analysis/positions-load';
import { answerMode, buildMessages, formatSearchResults, parseSearchArgs, SEARCH_TOOL, trimThread, type ThreadMessage } from '@/lib/analysis/prompt';
import { sanitizeQuery, searchNews } from '@/lib/connectors/news-search';

export const dynamic = 'force-dynamic';
/**
 * Five minutes. Nemotron thinks for one to two minutes before it writes, and a
 * full analysis can take as long again; 120 cut answers off mid-sentence. The
 * client's own limit is a silence timeout, not a duration (see openrouter.ts).
 */
export const maxDuration = 300;

const allowQuestion = createRateLimiter(ANALYST_LIMITS.perMinute);

/** How often a "still thinking" tick may reach the browser. */
const REASONING_TICK_MS = 1_000;

function refuse(status: number, message: string) {
  return NextResponse.json({ type: 'error', message }, { status });
}

export async function POST(request: Request) {
  if (!isAccessConfigured()) return refuse(503, 'AI Analysis is off: AI_ACCESS_KEY is not set on the server.');
  const cookieStore = await cookies();
  if (!hasAccess(cookieStore.get(ACCESS_COOKIE)?.value)) return refuse(401, 'Locked. Enter the passphrase first.');

  const config = getOpenRouterConfig();
  if (!config) return refuse(503, 'No OpenRouter key on the server (OPENROUTER_API_KEY).');

  let body: { symbol?: unknown; messages?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return refuse(400, 'invalid JSON body');
  }

  const def = typeof body.symbol === 'string' ? findSymbol(body.symbol) : undefined;
  if (!def) return refuse(400, 'Unknown symbol.');

  const raw = Array.isArray(body.messages) ? (body.messages as ThreadMessage[]) : [];
  const last = raw.at(-1);
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || last.content.trim() === '') {
    return refuse(400, 'Ask a question.');
  }
  if (last.content.length > ANALYST_LIMITS.messageChars) {
    return refuse(400, `Keep a question under ${ANALYST_LIMITS.messageChars} characters.`);
  }
  const thread = trimThread(raw);
  // Brief for a recap, decision for an entry, a hold or a flip (lib/analysis/prompt.ts).
  const mode = answerMode(last.content, body.mode);
  const effort = mode === 'brief' ? 'low' : 'medium';

  if (!allowQuestion()) return refuse(429, 'Too many questions this minute. Wait a moment.');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: Record<string, unknown>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      const started = Date.now();
      let requests = 0;
      let cost: number | null = null;
      let answered = 0;
      let lastTick = 0;

      /** One model request, streamed through; returns the tool calls it asked for. */
      const round = async (messages: ChatMessage[], opts: ChatOptions): Promise<ToolCall[]> => {
        requests++;
        let calls: ToolCall[] = [];
        for await (const event of streamChat(messages, { ...opts, signal: request.signal })) {
          if (event.type === 'content') {
            answered += event.text.length;
            send({ type: 'delta', text: event.text });
          } else if (event.type === 'reasoning') {
            if (Date.now() - lastTick > REASONING_TICK_MS) {
              lastTick = Date.now();
              send({ type: 'reasoning' });
            }
          } else if (event.type === 'retry') {
            // A retry is another request against the free allowance; count it.
            requests++;
            send({
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

      try {
        send({ type: 'status', text: 'Reading the board, rates, calendar, headlines and central-bank feeds…' });
        const now = new Date();
        const knowledge = selectKnowledge(def);
        // Past the passphrase gate above, so the user's own position may go in.
        const { positions } = await readOpenPositions();
        const dossier = buildDossier(await loadAnalysisInputs(def, now, undefined, { positions }));
        const docs = dossier.summary.banks.filter((b) => b.title).length;
        send({
          type: 'status',
          text: `Dossier ready: ${dossier.summary.news.clusters} stories, ${dossier.summary.news.searchHits} search hits, ${docs} central-bank document${docs === 1 ? '' : 's'}. Asking ${config.model} (${mode} answer)…`,
        });

        const messages = buildMessages(knowledge, dossier.text, thread, mode);
        const calls = await round(messages, { tools: [SEARCH_TOOL], toolChoice: 'auto', effort });

        if (calls.length > 0) {
          const perCall = calls.map((call) => ({
            call,
            queries: call.function.name === 'search_news' ? parseSearchArgs(call.function.arguments) : [],
          }));
          const all = [...new Set(perCall.flatMap((p) => p.queries).map(sanitizeQuery).filter(Boolean))].slice(0, ANALYST_LIMITS.queriesPerRound);
          send({ type: 'status', text: all.length ? `Searching: ${all.join(' · ')}` : 'The model asked for an unknown tool; continuing without it.' });

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
                      queries.map(sanitizeQuery).filter((q) => hits.has(q)).map((q) => ({ query: q, hits: hits.get(q)! })),
                      now,
                    ) || '(no queries run)'
                  : 'Unknown tool. Answer from the dossier.',
            })),
          ];
          if (answered > 0) send({ type: 'delta', text: '\n\n' });
          await round(followUp, { tools: [SEARCH_TOOL], toolChoice: 'none', effort });
        }

        if (answered === 0) throw new OpenRouterError('The model returned an empty answer. Try again, or rephrase the question.');
        send({ type: 'done', model: config.model, cost, requests, mode, seconds: Math.round((Date.now() - started) / 1000) });
      } catch (err) {
        if (request.signal.aborted) return;
        const message =
          err instanceof OpenRouterError ? err.message : `The analysis failed: ${err instanceof Error ? err.message : String(err)}`;
        send({ type: 'error', message });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by an abort
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
