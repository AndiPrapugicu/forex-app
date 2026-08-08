/**
 * AI tasks: explain, summarize, classify.
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
import type { Category, EventScore, NewsCluster, NormalizedEvent } from '@/lib/types';

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

/** One-line summary of a news cluster. */
export async function summarizeCluster(cluster: NewsCluster): Promise<AiExplanationResult | null> {
  const key = stableId('cluster', cluster.id, cluster.items.length);

  return cached<AiExplanationResult>('summarize', key, async (model) => {
    const provider = getAiProvider();
    if (!provider) return null;

    const headlines = cluster.items
      .slice(0, 6)
      .map((i) => `- [${i.sourceName}] ${i.title}`)
      .join('\n');

    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Summarize this news story in ONE sentence, then state in one short sentence what it means for currency markets.

Reported by ${cluster.domainCount} independent source${cluster.domainCount === 1 ? '' : 's'}:
${headlines}

${
  cluster.domainCount < 3
    ? 'IMPORTANT: this is NOT corroborated by enough independent sources. Say so explicitly and treat it as a claim, not a fact.'
    : ''
}`,
      },
    ];

    const text = await provider.complete(messages, { maxTokens: 160 });
    if (!text) return null;

    return { text, model, uncertain: cluster.domainCount < 3 };
  });
}

const CATEGORIES: Category[] = [
  'inflation',
  'labor',
  'growth',
  'central-bank',
  'risk-sentiment',
  'geopolitics',
  'energy',
  'other',
];

/**
 * Classification.
 *
 * The keyword scanner already assigns a category deterministically; this is a
 * second opinion for headlines the rules filed as "other". Anything the model
 * returns that is not in the allowed list is discarded rather than trusted.
 */
export async function classifyHeadline(title: string): Promise<Category | null> {
  const key = stableId('classify', title);

  return cached<Category>('classify', key, async () => {
    const provider = getAiProvider();
    if (!provider) return null;

    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Classify this headline into EXACTLY ONE of these categories. Reply with the category word only, nothing else.

Categories: ${CATEGORIES.join(', ')}

Headline: ${title}`,
      },
    ];

    const raw = await provider.complete(messages, { maxTokens: 12 });
    if (!raw) return null;

    const normalized = raw.toLowerCase().trim().replace(/[^a-z-]/g, '');
    // Strict allowlist — a hallucinated category is silently dropped.
    return CATEGORIES.includes(normalized as Category) ? (normalized as Category) : null;
  });
}
