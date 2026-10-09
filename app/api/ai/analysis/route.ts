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
 * The work itself — reading the question (lib/analysis/intent.ts), the
 * question-specific dossier sections F, R, E and O, the chart reader and the
 * model rounds — is `answerQuestion` in lib/analysis/answer.ts, which the
 * evaluation script runs too.
 *
 * The response is NDJSON, one event per line:
 *   {type:'status', text}      what the server is doing
 *   {type:'vision', text, model} what the attached chart shows, as read
 *   {type:'understood', text}   how the question was read: the window, the move
 *   {type:'reasoning'}         the model is thinking (throttled; no text)
 *   {type:'delta', text}       answer text
 *   {type:'done', model, cost, requests, mode, seconds}
 *   {type:'error', message}
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ANALYST_LIMITS } from '@/config/ai.config';
import { findSymbol } from '@/config/symbols.config';
import { getOpenRouterConfig, OpenRouterError } from '@/lib/ai/openrouter';
import { ACCESS_COOKIE, createRateLimiter, hasAccess, isAccessConfigured } from '@/lib/analysis/access';
import { answerQuestion } from '@/lib/analysis/answer';
import { checkImages } from '@/lib/analysis/attachments';
import { readOpenPositions } from '@/lib/analysis/positions-load';
import { trimThread, type ThreadMessage } from '@/lib/analysis/prompt';

export const dynamic = 'force-dynamic';
/**
 * Five minutes. Nemotron thinks for one to two minutes before it writes, and a
 * full analysis can take as long again; 120 cut answers off mid-sentence. The
 * client's own limit is a silence timeout, not a duration (see openrouter.ts).
 */
export const maxDuration = 300;

const allowQuestion = createRateLimiter(ANALYST_LIMITS.perMinute);

function refuse(status: number, message: string) {
  return NextResponse.json({ type: 'error', message }, { status });
}

export async function POST(request: Request) {
  if (!isAccessConfigured()) return refuse(503, 'AI Analysis is off: AI_ACCESS_KEY is not set on the server.');
  const cookieStore = await cookies();
  if (!hasAccess(cookieStore.get(ACCESS_COOKIE)?.value)) return refuse(401, 'Locked. Enter the passphrase first.');

  const config = getOpenRouterConfig();
  if (!config) return refuse(503, 'No OpenRouter key on the server (OPENROUTER_API_KEY).');

  let body: { symbol?: unknown; messages?: unknown; mode?: unknown; images?: unknown };
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
  const checked = checkImages(body.images);
  if (!checked.ok) return refuse(400, checked.reason);

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
      try {
        // Past the passphrase gate above, so the user's own position may go in.
        const { positions } = await readOpenPositions();
        const result = await answerQuestion({
          def,
          thread: trimThread(raw),
          question: last.content,
          requestedMode: body.mode,
          images: checked.images,
          positions,
          model: config.model,
          signal: request.signal,
          emit: send,
        });
        send({
          type: 'done',
          model: config.model,
          cost: result.cost,
          requests: result.requests,
          mode: result.mode,
          seconds: Math.round((Date.now() - started) / 1000),
        });
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
