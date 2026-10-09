/**
 * End-to-end check of the AI analyst on a fixed set of questions, through the
 * same `answerQuestion` the /api/ai/analysis route runs.
 *
 *   npm run eval:ai                         every case
 *   npm run eval:ai -- --only=1,3           some cases
 *   npm run eval:ai -- --images=a.webp,b.webp   attach charts to case 1
 *
 * USES THE FREE ALLOWANCE: one or two requests per case, plus one for charts
 * (free models allow 50 a day, or 1,000 once 10 credits were ever bought).
 * Run it when a change to the analyst needs proving, not on every commit.
 *
 * Each answer is checked for what a trader needs: it opens with a bottom line,
 * stays under its word cap, names the facts that answer the question, and does
 * not name a cause the data rules out. A check is a smoke alarm, not a grade.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findSymbol } from '@/config/symbols.config';
import { getOpenRouterConfig } from '@/lib/ai/openrouter';
import { answerQuestion, type AnswerEvent } from '@/lib/analysis/answer';
import { WORD_CAP } from '@/lib/analysis/prompt';

interface Case {
  symbol: string;
  question: string;
  /** Kind the server must read the question as. */
  kind: string;
  /** Each must appear in the answer (case-insensitive). */
  expect?: RegExp[];
  /** None may appear in the answer. */
  forbid?: RegExp[];
  charts?: boolean;
}

const CASES: Case[] = [
  {
    symbol: 'NAS100',
    question:
      'Yesterday the NASDAQ dropped around 2% while at the same time the US02Y/20Y/30Y dropped as well pretty significantly, could you tell me why is that?',
    kind: 'reaction',
    charts: true,
    expect: [/openai/i, /auction/i],
    forbid: [/(iran|diplomac)\w*[^.\n]{0,60}\b(caused|triggered|started|drove)\b/i, /reflation/i],
  },
  { symbol: 'XAUUSD', question: 'Why did gold move today?', kind: 'reaction', expect: [/gold|xau/i] },
  { symbol: 'NAS100', question: 'What should I expect from the next US CPI for the Nasdaq?', kind: 'event', expect: [/cpi/i] },
  { symbol: 'EURUSD', question: 'What is a bull steepener, and why does it matter for EURUSD?', kind: 'explain', expect: [/front|2-?year|short end/i] },
  { symbol: 'EURUSD', question: 'EURUSD vs GBPUSD, which one is stronger right now?', kind: 'compare', expect: [/gbp/i, /eur/i] },
  { symbol: 'EURUSD', question: 'Where would I look to enter EURUSD, given the bias?', kind: 'decision' },
  { symbol: 'EURUSD', question: 'Ce s-a întâmplat în ultimele 24h pe EURUSD?', kind: 'brief' },
  { symbol: 'WTIUSD', question: 'How does an OPEC+ cut usually move oil, and what is priced now?', kind: 'explain', expect: [/opec/i] },
];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

function imagesFrom(list: string | undefined): string[] {
  if (!list) return [];
  return list.split(',').map((p) => {
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${readFileSync(p).toString('base64')}`;
  });
}

const words = (s: string) => s.replace(/[*_#>`|-]/g, ' ').split(/\s+/).filter(Boolean).length;
// The cap is the model's instruction; the check allows the not-advice line and a little slack.
const SLACK = 1.15;

async function main() {
  const config = getOpenRouterConfig();
  if (!config) throw new Error('OPENROUTER_API_KEY is not set (.env.local).');
  const only = arg('only')?.split(',').map(Number);
  const images = imagesFrom(arg('images'));
  let failures = 0;
  let requests = 0;

  for (const [k, c] of CASES.entries()) {
    const n = k + 1;
    if (only && !only.includes(n)) continue;
    const def = findSymbol(c.symbol)!;
    const events: AnswerEvent[] = [];
    let answer = '';
    const started = Date.now();
    console.log(`\n=== ${n}. [${c.symbol}] ${c.question}`);
    try {
      const r = await answerQuestion({
        def,
        thread: [{ role: 'user', content: c.question }],
        question: c.question,
        images: c.charts ? images : [],
        positions: [],
        model: config.model,
        emit: (e) => {
          events.push(e);
          if (e.type === 'delta') answer += e.text;
        },
      });
      requests += r.requests;
      const understood = events.find((e) => e.type === 'understood');
      const vision = events.find((e) => e.type === 'vision');
      const checks: [string, boolean][] = [
        [`read as ${c.kind} (got ${r.mode})`, r.mode === c.kind],
        ['opens with a bottom line', /^\W*(bottom line|concluzi|pe scurt|în concluzie)/i.test(answer.trim())],
        [`under ${WORD_CAP[r.mode]} words (got ${words(answer)})`, words(answer) <= WORD_CAP[r.mode] * SLACK],
        ...(c.expect ?? []).map((re): [string, boolean] => [`mentions ${re}`, re.test(answer)]),
        ...(c.forbid ?? []).map((re): [string, boolean] => [`does not say ${re}`, !re.test(answer)]),
      ];
      if (understood && understood.type === 'understood') console.log(`Read as: ${understood.text}`);
      if (vision && vision.type === 'vision') console.log(`Chart reader:\n${vision.text}\n`);
      console.log(answer.trim());
      console.log(`--- ${r.requests} request(s), ${Math.round((Date.now() - started) / 1000)}s, cost ${r.cost ?? 'n/a'}`);
      for (const [label, ok] of checks) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
        if (!ok) failures++;
      }
    } catch (err) {
      failures++;
      console.log(`FAIL  error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) failed`} · ${requests} model request(s) used`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
