/**
 * The AI layer: one job, explaining an event that has already been scored.
 *
 * It used to also summarise news clusters and classify headlines. Both were
 * exported and called from nowhere — dead code with a live API key behind it —
 * so they are gone. If a genuine use appears, the provider and cache below are
 * what it should build on.
 *
 * Design rules, all of them defensive:
 *
 *  1. The model is given the numbers AND the verdict we already computed. It is
 *     asked to explain, never to decide. A model that disagrees with the rule
 *     engine is not consulted — the rule engine is the source of truth.
 *  2. Prompts forbid inventing figures and require the words "uncertain" when
 *     the input is thin, because a confident wrong sentence next to a real
 *     number is worse than no sentence.
 *  3. Output is capped short. Long model prose next to a score invites reading
 *     the prose as the analysis.
 *  4. Everything is cached by content hash, so the same headline is never paid
 *     for twice.
 */

import { stableId } from '@/lib/connectors/base';
import { getStore } from '@/lib/db/client';
import { getAiProvider, type AiMessage } from '@/lib/ai/provider';
import type { EventScore, NormalizedEvent } from '@/lib/types';

const SYSTEM = `You are a concise financial data explainer embedded in a forex dashboard.

STRICT RULES:
- Use ONLY the figures given to you. Never invent, estimate, or recall numbers.
- Never contradict the provided verdict. It comes from a deterministic rule engine and is the source of truth. Your job is to explain WHY it reads that way.
- If the information given is too thin to explain confidently, say "Uncertain" and state what is missing.
- No hedging filler, no disclaimers, no advice, no price targets, no trade recommendations.
- Plain English. Short sentences. A trader is scanning, not reading.`;

/** Small helper so prompts never contain "null". */
function val(v: number | null, unit?: string | null): string {
  if (v === null) return 'not available';
  return unit ? `${v}${unit}` : String(v);
}

async function cached<T>(
  kind: string,
  key: string,
  compute: (model: string) => Promise<T | null>,
): Promise<T | null> {
  const provider = getAiProvider();
  if (!provider) return null;

  const hash = stableId('ai', kind, provider.model, key);
  const store = getStore();

  const hit = await store.getAiCache(hash).catch(() => null);
  if (hit !== null && hit !== undefined) return hit as T;

  const result = await compute(provider.model);
  if (result === null) return null;

  await store.setAiCache(hash, kind, provider.model, result).catch(() => {});
  return result;
}

export interface AiExplanationResult {
  text: string;
  model: string;
  uncertain: boolean;
}

/**
 * Plain-English explanation of a single release.
 *
 * Note the verdict is passed IN. The model is explicitly told it may not
 * contradict it — this is what stops the prose and the gauge disagreeing, which
 * would undermine both.
 */
export async function explainEvent(
  event: NormalizedEvent,
  score: EventScore,
): Promise<AiExplanationResult | null> {
  // Nothing to explain before a release, and nothing worth paying for.
  if (event.actual === null) return null;

  const key = stableId(event.id, event.actual, score.score, score.confidence);

  return cached<AiExplanationResult>('explain', key, async (model) => {
    const provider = getAiProvider();
    if (!provider) return null;

    const verdict =
      score.direction === 'uncertain'
        ? `UNCERTAIN (confidence ${score.confidence} is below our threshold)`
        : `${score.direction.toUpperCase()} for ${event.currency}, score ${score.score} on a -10..+10 scale, confidence ${score.confidence}`;

    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Explain this economic release in 2-3 short sentences.

Release: ${event.name} (${event.currency})
Actual: ${val(event.actual, event.unit)}
Forecast: ${val(event.consensus, event.unit)}
Previous: ${val(event.previous, event.unit)}
Surprise: ${score.surprise === null ? 'not measurable' : `${score.surprise} standard deviations`}
Impact tier: ${event.impact}

Our rule engine's verdict: ${verdict}

Explain why this reading points that way for ${event.currency}. Mention the channel (rate expectations, growth, labour market) where relevant. Do not restate the numbers mechanically — explain what they mean.${
          score.direction === 'uncertain'
            ? ' The verdict is uncertain, so say so plainly and explain what would resolve it.'
            : ''
        }`,
      },
    ];

    const text = await provider.complete(messages, { maxTokens: 220 });
    if (!text) return null;

    return {
      text,
      model,
      uncertain: score.direction === 'uncertain' || /uncertain/i.test(text),
    };
  });
}



// ---------------------------------------------------------------------------
// Setup plan
// ---------------------------------------------------------------------------

export interface AiPlanResult {
  text: string;
  model: string;
}

/**
 * Reads a finished setup bundle and says where the evidence disagrees with
 * itself.
 *
 * THE DIVISION OF LABOUR IS THE POINT. Every number on the Chart page — the
 * score, the broken level, the retracement, the confluence, the COT flow — is
 * computed and testable. A model that invented a level here would be the single
 * worst failure this app could have, because a level is an instruction to place
 * an order. So the model is given the finished arithmetic and asked for the one
 * thing arithmetic cannot do: weigh conflicting evidence and name which
 * objection actually matters.
 *
 * It is also explicitly barred from choosing a direction. The direction comes
 * from the scorecard; a model that reverses it is not consulted, for the same
 * reason `explainEvent` may not contradict the rule engine.
 *
 * Cached on the bundle text, so it is paid for once per genuine data change
 * rather than once per page view.
 */
export async function planSetup(brief: string, symbol: string): Promise<AiPlanResult | null> {
  return cached<AiPlanResult>('plan', `${symbol}|${brief}`, async (model) => {
    const provider = getAiProvider();
    if (!provider) return null;

    const messages: AiMessage[] = [
      {
        role: 'system',
        content: `You are a trading desk colleague reviewing a setup someone else has already analysed.

Everything in the brief was computed by a deterministic engine. Your job is NOT to redo it.

STRICT RULES:
- Quote ONLY numbers that appear in the brief. Never compute, estimate, round differently, or recall a figure.
- Never change or argue with the direction. It comes from the scorecard and is fixed.
- Do not add price targets, position sizes, or entry prices. Those are not yours to give.
- No disclaimers, no hedging filler, no restating the brief back.

WHAT TO WRITE, in this order, 3-4 short sentences total:
1. The strongest tension in the evidence — the thing that most argues against taking this now. If nothing genuinely conflicts, say so in one sentence rather than inventing a concern.
2. Why that tension matters, or why it is survivable.
3. The single level or event that would settle it, taken from the brief.

Write like a colleague who is short on time and respects the reader. Plain English.`,
      },
      {
        role: 'user',
        content: `Setup brief for ${symbol}:\n\n${brief}`,
      },
    ];

    const text = await provider.complete(messages, { maxTokens: 2000 });
    if (!text) return null;

    return { text, model };
  });
}
