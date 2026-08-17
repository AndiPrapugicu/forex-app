/**
 * Does the AI layer actually work?
 *
 * `complete()` returns null on every failure by contract, which is right for the
 * app — the AI is an enhancement and must never take a page down — and wrong for
 * debugging, because a bad model id, an expired key and a rate limit all look
 * identical from the UI: an empty panel. This script is the counterpart that
 * says which one it is.
 *
 * Run: npm run check:ai
 */

import { DEFAULT_OPENAI_MODEL, getAiProvider } from '@/lib/ai/provider';

/** Models worth suggesting, best first, if the configured one is unavailable. */
const PREFERRED = ['gpt-5.5', 'gpt-5.4', 'gpt-5.1', 'gpt-5', 'gpt-4.1'];

async function listModels(key: string): Promise<string[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.log(`  models endpoint returned ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id);
  } catch (err) {
    console.log(`  models endpoint failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  const provider = getAiProvider();

  console.log('AI configuration');
  console.log(`  AI_PROVIDER   ${process.env.AI_PROVIDER ?? '(unset — auto-detect)'}`);
  console.log(`  OPENAI_MODEL  ${process.env.OPENAI_MODEL ?? `(unset — default ${DEFAULT_OPENAI_MODEL})`}`);

  if (!provider) {
    console.log('\nNo provider configured.');
    console.log('This is a supported state: the app runs on rule-based text instead.');
    console.log('To enable, set OPENAI_API_KEY in .env.local, or AI_PROVIDER=ollama.');
    process.exit(0);
  }

  console.log(`  resolved      ${provider.name} / ${provider.model}\n`);

  const key = process.env.OPENAI_API_KEY;
  if (provider.name === 'openai' && key) {
    const models = await listModels(key);
    if (models) {
      const available = models.includes(provider.model);
      console.log(`Model availability: ${provider.model} ${available ? 'IS' : 'is NOT'} on this key`);
      if (!available) {
        const suggest = PREFERRED.filter((m) => models.includes(m));
        console.log(
          suggest.length > 0
            ? `  Try one of: ${suggest.join(', ')}`
            : '  None of the preferred models are available on this key.',
        );
      }
      console.log(`  (${models.length} models visible in total)\n`);
    }
  }

  // One real round-trip. Nothing else proves the request shape is accepted —
  // notably whether this model tolerates the temperature parameter.
  console.log('Sending one tiny completion…');
  const started = Date.now();
  const reply = await provider.complete(
    [
      { role: 'system', content: 'Reply with exactly one word.' },
      { role: 'user', content: 'Say OK.' },
    ],
    { maxTokens: 2000 },
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (reply === null) {
    console.log(`\nFAIL after ${elapsed}s — see the [ai] warning above for the reason.`);
    process.exit(1);
  }

  console.log(`\nPASS in ${elapsed}s. Model replied: ${JSON.stringify(reply.slice(0, 80))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
