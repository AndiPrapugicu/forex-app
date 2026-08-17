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
          /**
           * Temperature is sent ONLY to the gpt-4 family.
           *
           * The reasoning models reject any explicit value with a 400 — they
           * accept the default and nothing else. Sending 0.2 unconditionally
           * meant every gpt-5 model failed, and because `complete()` swallows
           * errors and returns null by contract, it failed as a blank panel
           * rather than as anything a user could diagnose.
           */
          ...(this.model.startsWith('gpt-4') ? { temperature: 0.2 } : {}),
          max_completion_tokens: opts.maxTokens ?? 400,
        }),
        // Reasoning models think before they answer; 30s was tuned for 4o-mini.
        signal: AbortSignal.timeout(90_000),
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
/**
 * Default when OPENAI_MODEL is unset.
 *
 * Was `gpt-4o-mini`, which is a summariser. The job on the Chart page is to read
 * a bundle of computed evidence and say where it contradicts itself — that is
 * reasoning, and it is exactly what the cheap model was worst at, producing
 * confident filler instead of naming the conflict. Both AI features are
 * button-triggered and cached in `ai_cache`, so the volume is a handful of calls
 * a day and the better model costs pennies.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5';

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
    return new OpenAiProvider(openAiKey!, process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL);
  }

  // No explicit preference and no usable key: fall back to local if it is there.
  if (preference === 'openai') return null;
  return new OllamaProvider(ollamaHost, process.env.OLLAMA_MODEL ?? 'llama3.2');
}
