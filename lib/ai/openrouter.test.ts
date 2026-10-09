import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildRequestBody,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_VISION_MODELS,
  describedOnly,
  describeImages,
  endpointsAreFree,
  FORBIDDEN_BODY_KEYS,
  isFreeModelId,
  killReason,
  recordCost,
  resetOpenRouterStateForTests,
  splitSse,
  streamChat,
  type StreamEvent,
} from '@/lib/ai/openrouter';

const FREE_ENDPOINTS = {
  data: {
    id: DEFAULT_OPENROUTER_MODEL,
    endpoints: [{ name: 'Nvidia | nemotron:free', pricing: { prompt: '0', completion: '0', request: '0', discount: 0 } }],
  },
};

describe('guard 1: the model id', () => {
  it('accepts the default, which is the free Nemotron', () => {
    expect(DEFAULT_OPENROUTER_MODEL).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(isFreeModelId(DEFAULT_OPENROUTER_MODEL)).toBe(true);
  });

  it('refuses paid, routed and search-enabled ids', () => {
    expect(isFreeModelId('nvidia/nemotron-3-ultra-550b-a55b')).toBe(false);
    expect(isFreeModelId('openrouter/auto')).toBe(false);
    expect(isFreeModelId('openrouter/free:free')).toBe(false);
    expect(isFreeModelId('openai/gpt-5.5:online')).toBe(false);
    expect(isFreeModelId('nvidia/nemotron:online:free')).toBe(false);
  });
});

describe('guard 2: the price list', () => {
  it('passes when every endpoint prices at zero', () => {
    expect(endpointsAreFree(FREE_ENDPOINTS).free).toBe(true);
  });

  it('refuses any non-zero price, on any field', () => {
    const paid = { data: { endpoints: [{ name: 'x', pricing: { prompt: '0', completion: '0.0000004' } }] } };
    expect(endpointsAreFree(paid)).toMatchObject({ free: false });
    const search = { data: { endpoints: [{ name: 'x', pricing: { prompt: '0', completion: '0', web_search: '0.007' } }] } };
    expect(endpointsAreFree(search).free).toBe(false);
  });

  it('refuses when it cannot tell', () => {
    expect(endpointsAreFree({ data: { endpoints: [] } }).free).toBe(false);
    expect(endpointsAreFree(null).free).toBe(false);
    expect(endpointsAreFree({ data: { endpoints: [{ name: 'x' }] } }).free).toBe(false);
  });
});

describe('guard 3: the request body', () => {
  it('never carries a fallback list, a plugin or a search option', () => {
    const body = buildRequestBody(DEFAULT_OPENROUTER_MODEL, [{ role: 'user', content: 'hi' }], {
      tools: [{ type: 'function', function: { name: 'search_news', description: 'd', parameters: {} } }],
    });
    for (const key of FORBIDDEN_BODY_KEYS) expect(body).not.toHaveProperty(key);
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(body.usage).toEqual({ include: true });
    expect(body.provider).toEqual({ allow_fallbacks: false });
  });

  it('refuses to build a request for a paid model', () => {
    expect(() => buildRequestBody('anthropic/claude-opus-5.5', [])).toThrow(/not a free model/);
  });

  it('pins the seed and a low temperature, and thinks less for a brief answer', () => {
    const brief = buildRequestBody(DEFAULT_OPENROUTER_MODEL, [{ role: 'user', content: 'hi' }], { effort: 'low' });
    const full = buildRequestBody(DEFAULT_OPENROUTER_MODEL, [{ role: 'user', content: 'hi' }]);
    expect(brief).toMatchObject({ seed: 7, temperature: 0.2, reasoning: { effort: 'low' } });
    expect(full.reasoning).toEqual({ effort: 'medium' });
    for (const key of FORBIDDEN_BODY_KEYS) expect(brief).not.toHaveProperty(key);
  });
});

describe('guard 4: the bill', () => {
  beforeEach(() => resetOpenRouterStateForTests());

  it('latches on a reported cost and not on zero', () => {
    expect(recordCost(0, 'm')).toBe(false);
    expect(recordCost(null, 'm')).toBe(false);
    expect(killReason()).toBeNull();
    expect(recordCost(0.0001, 'm')).toBe(true);
    expect(killReason()).toMatch(/cost/);
  });
});

describe('splitSse', () => {
  it('drops comments and DONE, and keeps the unfinished tail', () => {
    const { payloads, rest } = splitSse(': OPENROUTER PROCESSING\n\ndata: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"');
    expect(payloads).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });
});

describe('streamChat', () => {
  const env = { ...process.env };
  beforeEach(() => {
    resetOpenRouterStateForTests();
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key-000000000000000000';
    delete process.env.OPENROUTER_MODEL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  function sse(lines: string[]): Response {
    const body = new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  async function collect(gen: AsyncGenerator<StreamEvent>) {
    const out: StreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }

  it('checks the price before it sends, and assembles fragmented tool calls', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.endsWith('/endpoints')) return new Response(JSON.stringify(FREE_ENDPOINTS), { status: 200 });
      return sse([
        'data: {"choices":[{"delta":{"reasoning":"hm"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_news","arguments":"{\\"queries\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"[\\"ECB\\"]}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: {"choices":[],"usage":{"cost":0,"prompt_tokens":10,"completion_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]);
    }) as unknown as typeof fetch;

    const events = await collect(streamChat([{ role: 'user', content: 'q' }], {}, fetchImpl));
    expect(urls[0]).toContain('/models/nvidia/nemotron-3-ultra-550b-a55b:free/endpoints');
    expect(urls[1]).toContain('/chat/completions');
    expect(events.find((e) => e.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      calls: [{ id: 'c1', type: 'function', function: { name: 'search_news', arguments: '{"queries":["ECB"]}' } }],
    });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
    expect(killReason()).toBeNull();
  });

  it('sends nothing when the price check fails', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: { endpoints: [{ name: 'x', pricing: { prompt: '0.1', completion: '0' } }] } }));
    }) as unknown as typeof fetch;

    await expect(collect(streamChat([{ role: 'user', content: 'q' }], {}, fetchImpl))).rejects.toThrow(/Refused/);
    expect(urls).toHaveLength(1);
  });

  it('refuses an env override to a paid model without touching the network', async () => {
    process.env.OPENROUTER_MODEL = 'openai/gpt-5.5';
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    await expect(collect(streamChat([], {}, fetchImpl))).rejects.toThrow(/not a free model/);
    expect(called).toBe(false);
  });

  const OVERLOADED = 'data: {"error":{"code":503,"message":"Upstream error from Nvidia: Service temporarily overloaded"}}\n\n';
  const ANSWER = ['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'];

  /** Endpoint check, then the scripted chat responses in order. */
  function scripted(responses: (() => Response)[]) {
    let chats = 0;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/endpoints')) return new Response(JSON.stringify(FREE_ENDPOINTS));
      return responses[Math.min(chats++, responses.length - 1)]();
    }) as unknown as typeof fetch;
    return { fetchImpl, chats: () => chats };
  }

  it('retries a busy provider and says so, then answers', async () => {
    const { fetchImpl, chats } = scripted([() => sse([OVERLOADED]), () => sse(ANSWER)]);
    const events = await collect(streamChat([], { retryDelaysMs: [1, 1] }, fetchImpl));
    expect(chats()).toBe(2);
    expect(events.find((e) => e.type === 'retry')).toMatchObject({ type: 'retry', attempt: 1, of: 2 });
    expect(events.find((e) => e.type === 'content')).toEqual({ type: 'content', text: 'ok' });
  });

  it('gives up after its retries, and says how many times it tried', async () => {
    const { fetchImpl, chats } = scripted([() => sse([OVERLOADED])]);
    await expect(collect(streamChat([], { retryDelaysMs: [1, 1] }, fetchImpl))).rejects.toThrow(/overloaded.*tried 3 times/);
    expect(chats()).toBe(3);
  });

  it('never retries its own quota, and never retries once text has been shown', async () => {
    const quota = scripted([() => new Response('rate limited', { status: 429 })]);
    await expect(collect(streamChat([], { retryDelaysMs: [1, 1] }, quota.fetchImpl))).rejects.toThrow(/rate limited/);
    expect(quota.chats()).toBe(1);

    const midway = scripted([() => sse(['data: {"choices":[{"delta":{"content":"half"}}]}\n\n', OVERLOADED])]);
    await expect(collect(streamChat([], { retryDelaysMs: [1, 1] }, midway.fetchImpl))).rejects.toThrow(/overloaded/);
    expect(midway.chats()).toBe(1);
  });

  it('turns a 429 into words', async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith('/endpoints')
        ? new Response(JSON.stringify(FREE_ENDPOINTS))
        : new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    await expect(collect(streamChat([], {}, fetchImpl))).rejects.toThrow(/rate limited right now/);
  });

  it('reads a chart with the vision model, through the same price check', async () => {
    const urls: string[] = [];
    let sent: Record<string, unknown> | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/endpoints')) return new Response(JSON.stringify(FREE_ENDPOINTS));
      sent = JSON.parse(String(init?.body));
      return sse(['data: {"choices":[{"delta":{"content":"- NQ 5m, 30,870 to 30,220"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    const out = await describeImages(['data:image/jpeg;base64,AAAA'], 'why did it drop?', {}, fetchImpl);
    expect(out).toEqual({ text: '- NQ 5m, 30,870 to 30,220', model: DEFAULT_VISION_MODEL, cost: null });
    expect(urls[0]).toContain(`/models/${DEFAULT_VISION_MODEL}/endpoints`);
    expect(sent!.model).toBe(DEFAULT_VISION_MODEL);
    for (const key of FORBIDDEN_BODY_KEYS) expect(sent).not.toHaveProperty(key);
    const user = (sent!.messages as { role: string; content: unknown }[])[1];
    expect(user.content).toEqual([
      { type: 'text', text: "The trader's question, for context only: why did it drop?" },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
  });

  it('moves to the next free chart reader when the first is rate limited, as a separate request', async () => {
    delete process.env.OPENROUTER_VISION_MODEL;
    const models: string[] = [];
    const fallbacks: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/endpoints')) return new Response(JSON.stringify(FREE_ENDPOINTS));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      models.push(String(body.model));
      for (const key of FORBIDDEN_BODY_KEYS) expect(body).not.toHaveProperty(key);
      if (body.model === DEFAULT_VISION_MODELS[0]) return new Response('rate limited', { status: 429 });
      return sse(['data: {"choices":[{"delta":{"content":"IMAGE 1"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    const out = await describeImages(['data:image/png;base64,AAAA'], 'q', { onFallback: (m) => fallbacks.push(m) }, fetchImpl);
    expect(out.model).toBe(DEFAULT_VISION_MODELS[1]);
    expect(models).toEqual(DEFAULT_VISION_MODELS);
    expect(fallbacks).toEqual([DEFAULT_VISION_MODELS[1]]);
    expect(DEFAULT_VISION_MODELS.every((m) => m.endsWith(':free'))).toBe(true);
  });

  it("drops a verdict the chart reader adds on its own; explaining is the analyst's job", () => {
    const raw = 'IMAGE 1\nSYMBOL: NDQ100\n- Price fell 1.86%.\n\n**Answer:** The cause cannot be determined from the images.';
    expect(describedOnly(raw)).toBe('IMAGE 1\nSYMBOL: NDQ100\n- Price fell 1.86%.');
    expect(describedOnly('SYMBOL: US02Y')).toBe('SYMBOL: US02Y');
  });

  it('does not try another reader when the key or the balance is the problem', async () => {
    delete process.env.OPENROUTER_VISION_MODEL;
    let chats = 0;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/endpoints')) return new Response(JSON.stringify(FREE_ENDPOINTS));
      chats++;
      return new Response('payment required', { status: 402 });
    }) as unknown as typeof fetch;
    await expect(describeImages(['data:image/png;base64,AAAA'], 'q', {}, fetchImpl)).rejects.toThrow(/402/);
    expect(chats).toBe(1);
  });

  it('refuses a paid vision model before sending the image', async () => {
    process.env.OPENROUTER_VISION_MODEL = 'openai/gpt-5.5';
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    await expect(describeImages(['data:image/png;base64,AAAA'], 'q', {}, fetchImpl)).rejects.toThrow(/not a free model/);
    expect(called).toBe(false);
  });
});
