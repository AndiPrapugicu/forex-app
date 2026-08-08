/**
 * AI provider abstraction.
 *
 * Two implementations: OpenAI (hosted, used in production) and Ollama (local,
 * free, used in dev). Selected by AI_PROVIDER so the same code runs in both.
 *
 * HARD CONSTRAINT, enforced by the callers in prompts.ts: the model NEVER
 * produces a number that reaches a score. It writes prose about figures we
 * already computed deterministically. If the AI layer is removed entirely, every
 * score on the dashboard is unchanged — that is the test of whether this
 * boundary is real.
 */

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Returns null on any failure — AI is an enhancement, never a dependency. */
  complete(messages: AiMessage[], opts?: { maxTokens?: number }): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  async complete(messages: AiMessage[], opts: { maxTokens?: number } = {}): Promise<string | null> {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Low temperature: this is summarization of given facts, not writing.
          temperature: 0.2,
          max_completion_tokens: opts.maxTokens ?? 400,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(`[ai] openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return json.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      console.warn('[ai] openai failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

class OllamaProvider implements AiProvider {
  readonly name = 'ollama';

  constructor(
    private host: string,
    readonly model: string,
  ) {}

  async complete(messages: AiMessage[], opts: { maxTokens?: number } = {}): Promise<string | null> {
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: { temperature: 0.2, num_predict: opts.maxTokens ?? 400 },
        }),
        // Local models on a laptop are slow — a 13s cold start was measured on
        // llama3.2 during planning, so this timeout is deliberately generous.
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) return null;

      const json = (await res.json()) as { message?: { content?: string } };
      return json.message?.content?.trim() ?? null;
    } catch (err) {
      console.warn('[ai] ollama failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Returns null when no provider is configured, which is a fully supported state:
 * the app runs with rule-based scores and no prose.
 */
export function getAiProvider(): AiProvider | null {
  const preference = (process.env.AI_PROVIDER ?? '').toLowerCase();

  const openAiKey = process.env.OPENAI_API_KEY;
  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

  // A placeholder left in .env should not be treated as a real key.
  const hasOpenAi = Boolean(openAiKey && !openAiKey.startsWith('<') && openAiKey.length > 20);

  if (preference === 'ollama') {
    return new OllamaProvider(ollamaHost, process.env.OLLAMA_MODEL ?? 'llama3.2');
  }
  if (preference === 'none') return null;

  if (hasOpenAi) {
    return new OpenAiProvider(openAiKey!, process.env.OPENAI_MODEL ?? 'gpt-4o-mini');
  }

  // No explicit preference and no usable key: fall back to local if it is there.
  if (preference === 'openai') return null;
  return new OllamaProvider(ollamaHost, process.env.OLLAMA_MODEL ?? 'llama3.2');
}
