/**
 * OpenRouter, for the AI Analysis page — and ONLY a free model.
 *
 * Kept apart from `lib/ai/provider.ts` on purpose. That provider serves the
 * event Explain button on whatever key it is given; this one serves a chat that
 * anyone holding the access key can drive, so the thing that must never happen
 * is a bill. Four guards, each enough on its own to stop one way a paid call
 * could slip through:
 *
 *  1. STATIC. The model id must end in `:free`. An env override to a paid model
 *     is refused before any request is built.
 *  2. LIVE. OpenRouter's own endpoint listing for the model is read (cached an
 *     hour) and every endpoint must price prompt, completion and everything else
 *     at zero. A free variant that quietly gained a price stops here.
 *  3. SHAPE. `buildRequestBody` is the only place a request is assembled, and it
 *     never emits a fallback model list, a plugin (OpenRouter's web search costs
 *     money even on free models) or an `:online` id. A test pins that.
 *  4. AFTER THE FACT. Every request asks for usage accounting, and a reported
 *     cost above zero latches a kill switch for the rest of the process.
 *
 * Like the other provider, this never feeds a score. It writes prose about a
 * dossier the rule engine already computed.
 */

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** How long a passed pricing check is trusted before it is read again. */
const PRICING_TTL_MS = 60 * 60 * 1000;
/**
 * How long the stream may go SILENT before the request is abandoned.
 *
 * Was a 120-second cap on the whole request, which cut answers off mid-table:
 * Nemotron routinely thinks for one to two minutes and then writes for another.
 * Silence is the real failure signal — while the model reasons, OpenRouter
 * keeps sending `: OPENROUTER PROCESSING` comments and reasoning deltas, and
 * every one of them resets this clock.
 */
export const IDLE_TIMEOUT_MS = 90_000;
/** Outer bound on one request, kept under the route's `maxDuration` (300s). */
const REQUEST_TIMEOUT_MS = 280_000;
/**
 * Waits before each retry of a busy upstream. Two retries, so a question can
 * spend at most three requests on one round: the free endpoint answers "Service
 * temporarily overloaded" often enough that giving up on the first refusal made
 * the page look broken, and retrying faster than this just collects more 503s.
 */
export const RETRY_DELAYS_MS = [3_000, 8_000];

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  /** 'none' forbids another tool round, which is how a question stays at two requests. */
  toolChoice?: 'auto' | 'none';
  maxTokens?: number;
  signal?: AbortSignal;
  /** Test seam; production uses RETRY_DELAYS_MS. */
  retryDelaysMs?: readonly number[];
  /**
   * How long the model thinks. A recap of the last 24 hours does not need two
   * minutes of reasoning; an entry plan does. Defaults to medium.
   */
  effort?: 'low' | 'medium';
}

/**
 * Fixed, so the same dossier and question tend to the same answer. The model
 * honours `seed` on a best-effort basis; with the deterministic market state in
 * the dossier and a low temperature, it is one more push towards repeatability.
 */
export const ANALYST_SEED = 7;
export const ANALYST_TEMPERATURE = 0.2;

export type StreamEvent =
  | { type: 'content'; text: string }
  /** The model is thinking. The text is not forwarded, only the fact. */
  | { type: 'reasoning' }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; cost: number | null; promptTokens: number | null; completionTokens: number | null }
  /** The upstream was busy and the request is being sent again after `waitMs`. */
  | { type: 'retry'; attempt: number; of: number; waitMs: number; reason: string }
  | { type: 'finish'; reason: string | null };

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

// ---------------------------------------------------------------------------
// Guard 1 — the id
// ---------------------------------------------------------------------------

/**
 * `:free` suffix, and none of the ids that route somewhere we did not choose.
 * `openrouter/auto` picks a model per request, and `:online` adds a paid search.
 */
export function isFreeModelId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed.endsWith(':free')) return false;
  if (trimmed.includes(':online')) return false;
  if (trimmed.startsWith('openrouter/')) return false;
  return /^[\w.-]+\/[\w.:-]+$/.test(trimmed);
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

/** Null when no key is set, which the page reports as "not configured". */
export function getOpenRouterConfig(): OpenRouterConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith('<') || apiKey.length < 20) return null;
  return { apiKey, model: (process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL).trim() };
}

// ---------------------------------------------------------------------------
// Guard 2 — the price list
// ---------------------------------------------------------------------------

/**
 * Every endpoint, every priced field, zero.
 *
 * Read off OpenRouter's `/models/{id}/endpoints` payload. A field is a price if
 * it parses as a number; `discount` is the one numeric field that is not a
 * price and is skipped. An empty endpoint list is a refusal, not a pass — no
 * endpoint means we cannot say what a request would cost.
 */
export function endpointsAreFree(payload: unknown): { free: boolean; reason: string } {
  const endpoints = (payload as { data?: { endpoints?: unknown } } | null)?.data?.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return { free: false, reason: 'OpenRouter lists no endpoint for this model, so its price cannot be checked' };
  }

  for (const endpoint of endpoints as { name?: string; pricing?: Record<string, unknown> }[]) {
    const pricing = endpoint.pricing;
    if (!pricing || typeof pricing !== 'object') {
      return { free: false, reason: `endpoint ${endpoint.name ?? '?'} publishes no pricing` };
    }
    for (const [field, raw] of Object.entries(pricing)) {
      if (field === 'discount') continue;
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isNaN(value)) continue;
      if (value !== 0) {
        return { free: false, reason: `endpoint ${endpoint.name ?? '?'} charges ${field} = ${String(raw)}` };
      }
    }
  }
  return { free: true, reason: `${endpoints.length} endpoint(s), all priced at zero` };
}

let pricingCheck: { model: string; at: number; free: boolean; reason: string } | null = null;

async function verifyFree(config: OpenRouterConfig, fetchImpl: typeof fetch): Promise<void> {
  if (pricingCheck && pricingCheck.model === config.model && Date.now() - pricingCheck.at < PRICING_TTL_MS) {
    if (!pricingCheck.free) throw new OpenRouterError(`Refused: ${pricingCheck.reason}.`);
    return;
  }

  let payload: unknown;
  try {
    const res = await fetchImpl(`${OPENROUTER_BASE}/models/${config.model}/endpoints`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    // Not cached: a network blip should not lock the page for an hour.
    throw new OpenRouterError(
      `Could not confirm the model is free (${err instanceof Error ? err.message : String(err)}), so nothing was sent.`,
    );
  }

  const verdict = endpointsAreFree(payload);
  pricingCheck = { model: config.model, at: Date.now(), ...verdict };
  if (!verdict.free) throw new OpenRouterError(`Refused: ${verdict.reason}.`);
}

// ---------------------------------------------------------------------------
// Guard 3 — the request
// ---------------------------------------------------------------------------

/** Keys that would let OpenRouter spend money or pick another model. */
export const FORBIDDEN_BODY_KEYS = ['models', 'plugins', 'web_search_options', 'route', 'preset'] as const;

export function buildRequestBody(model: string, messages: ChatMessage[], opts: ChatOptions = {}) {
  if (!isFreeModelId(model)) {
    throw new OpenRouterError(`Refused: "${model}" is not a free model id (it must end in ":free").`);
  }
  return {
    model,
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 8000,
    temperature: ANALYST_TEMPERATURE,
    seed: ANALYST_SEED,
    reasoning: { effort: opts.effort ?? 'medium' },
    // Asks OpenRouter to report what the request cost — guard 4 reads it.
    usage: { include: true },
    // One model, its own endpoints, nothing else.
    provider: { allow_fallbacks: false },
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools, tool_choice: opts.toolChoice ?? 'auto' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Guard 4 — the bill
// ---------------------------------------------------------------------------

let killed: string | null = null;

/** Why the analyst is switched off for this process, or null. */
export function killReason(): string | null {
  return killed;
}

/** Latches the kill switch when a request reports a cost. Returns true if it did. */
export function recordCost(cost: number | null, model: string): boolean {
  if (cost === null || !(cost > 0)) return false;
  killed = `OpenRouter reported a cost of ${cost} for ${model}; the analyst is off until the server restarts`;
  console.error(`[ai-analysis] ${killed}`);
  return true;
}

/** Test seam: every guard's memory, forgotten. */
export function resetOpenRouterStateForTests(): void {
  killed = null;
  pricingCheck = null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** OpenRouter's status codes, in the words a user can act on. */
export function describeHttpError(status: number, body: string): string {
  const detail = body.slice(0, 200);
  if (status === 401) return 'OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.';
  if (status === 402) {
    return 'OpenRouter returned 402: the account balance is negative, which blocks even free models. Bring it back to zero or above.';
  }
  if (status === 429) {
    return 'The free model is rate limited right now (20 a minute, and a daily cap). Try again later.';
  }
  if (status === 404 && /data policy|privacy/i.test(body)) {
    return 'OpenRouter found no endpoint matching your data policy. Free endpoints must be enabled in your OpenRouter privacy settings.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return `The free model's provider is overloaded right now (OpenRouter ${status}: ${detail}). This is on their side; try again in a minute.`;
  }
  return `OpenRouter returned ${status}: ${detail}`;
}

/**
 * Worth sending again: the provider was busy or timed out. NOT a 429 — that is
 * our own quota, and retrying it only spends more of it.
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof OpenRouterError)) return false;
  if (err.status === 502 || err.status === 503 || err.status === 504 || err.status === 408) return true;
  return err.status === null && /overloaded|temporarily unavailable|upstream error/i.test(err.message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OpenRouterError('Stopped.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new OpenRouterError('Stopped.'));
    }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
}

/**
 * Splits an SSE buffer into complete `data:` payloads and the unfinished tail.
 *
 * Lines starting with `:` are comments — OpenRouter sends `: OPENROUTER
 * PROCESSING` while a request queues — and are dropped. `[DONE]` is dropped
 * too; the caller ends on the stream closing.
 */
export function splitSse(buffer: string): { payloads: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const payloads: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '' || data === '[DONE]') continue;
    payloads.push(data);
  }
  return { payloads, rest };
}

/**
 * One chat completion, streamed, with the guards in front of it.
 *
 * Throws `OpenRouterError` for anything the user should be told; yields events
 * otherwise. Tool calls arrive in fragments keyed by index and are assembled
 * here, so the caller sees each call once, whole.
 *
 * A busy provider is retried (see `RETRY_DELAYS_MS`) — but only while nothing
 * of the answer has been yielded. Once text has reached the reader, sending
 * the request again would print a second, different answer under the first.
 */
export async function* streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<StreamEvent> {
  const config = getOpenRouterConfig();
  if (!config) throw new OpenRouterError('No OpenRouter key configured (OPENROUTER_API_KEY).');
  if (killed) throw new OpenRouterError(killed);
  if (!isFreeModelId(config.model)) {
    throw new OpenRouterError(`Refused: "${config.model}" is not a free model id (it must end in ":free").`);
  }

  await verifyFree(config, fetchImpl);
  const body = buildRequestBody(config.model, messages, opts);

  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    let produced = false;
    try {
      for await (const event of streamOnce(config, body, opts, fetchImpl)) {
        if (event.type === 'content' || event.type === 'tool_calls') produced = true;
        yield event;
      }
      return;
    } catch (err) {
      if (produced || attempt >= delays.length || !isRetryable(err) || opts.signal?.aborted) {
        if (err instanceof OpenRouterError && attempt > 0 && isRetryable(err)) {
          throw new OpenRouterError(`${err.message} (tried ${attempt + 1} times)`, err.status);
        }
        throw err;
      }
      const waitMs = delays[attempt];
      yield { type: 'retry', attempt: attempt + 1, of: delays.length, waitMs, reason: (err as Error).message };
      await sleep(waitMs, opts.signal);
    }
  }
}

/** One request, no retries. */
async function* streamOnce(
  config: OpenRouterConfig,
  body: ReturnType<typeof buildRequestBody>,
  opts: ChatOptions,
  fetchImpl: typeof fetch,
): AsyncGenerator<StreamEvent> {
  const idle = new AbortController();
  let idleTimer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  };
  const limits = [idle.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
  const signal = AbortSignal.any(opts.signal ? [opts.signal, ...limits] : limits);

  let res: Response;
  try {
    res = await fetchImpl(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fxintel.vercel.app',
        'X-Title': 'FX Intel',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    clearTimeout(idleTimer);
    throw new OpenRouterError(`Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok || !res.body) {
    throw new OpenRouterError(describeHttpError(res.status, await res.text().catch(() => '')), res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = new Map<number, ToolCall>();
  let finish: string | null = null;

  try {
    while (true) {
      let chunkRead: ReadableStreamReadResult<Uint8Array>;
      try {
        chunkRead = await reader.read();
      } catch (err) {
        if (idle.signal.aborted) {
          // A silent upstream is a busy upstream: retryable like a 504.
          throw new OpenRouterError(`The model went silent for ${IDLE_TIMEOUT_MS / 1000}s.`, 504);
        }
        throw err;
      }
      const { value, done } = chunkRead;
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = splitSse(buffer);
      buffer = rest;

      for (const data of payloads) {
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          continue;
        }

        // A failure after the 200 arrives inside the stream, not as a status.
        if (chunk.error) {
          throw new OpenRouterError(
            chunk.error.code ? describeHttpError(chunk.error.code, chunk.error.message ?? '') : chunk.error.message ?? 'stream error',
            chunk.error.code ?? null,
          );
        }

        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta;
          if (delta?.reasoning) yield { type: 'reasoning' };
          if (delta?.content) yield { type: 'content', text: delta.content };
          for (const fragment of delta?.tool_calls ?? []) {
            const index = fragment.index ?? 0;
            const call = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
            if (fragment.id) call.id = fragment.id;
            if (fragment.function?.name) call.function.name += fragment.function.name;
            if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
            calls.set(index, call);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }

        if (chunk.usage) {
          const cost = typeof chunk.usage.cost === 'number' ? chunk.usage.cost : null;
          recordCost(cost, config.model);
          yield {
            type: 'usage',
            cost,
            promptTokens: chunk.usage.prompt_tokens ?? null,
            completionTokens: chunk.usage.completion_tokens ?? null,
          };
        }
      }
    }
  } finally {
    clearTimeout(idleTimer);
    reader.releaseLock();
  }

  if (calls.size > 0) {
    yield {
      type: 'tool_calls',
      calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ ...c, id: c.id || `call_${i}` })),
    };
  }
  yield { type: 'finish', reason: finish };
}
