/**
 * On-demand AI read of one setup.
 *
 * The brief is composed on the server and posted here, rather than the route
 * rebuilding it from a symbol. That means the model is provably shown the same
 * text the page is showing the user — there is no second code path that could
 * quietly feed it different numbers, which is the failure that would make its
 * output impossible to audit.
 *
 * On-demand, like the event explainer: prose is generated when someone asks for
 * it, so no cron run bills for paragraphs nobody reads.
 */

import { NextResponse } from 'next/server';
import { planSetup } from '@/lib/ai/prompts';
import { getAiProvider } from '@/lib/ai/provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Long enough for a real brief, short enough that the endpoint is not a relay. */
const MAX_BRIEF = 4000;

export async function POST(request: Request) {
  const provider = getAiProvider();
  if (!provider) {
    // A first-class state: the page already showed the rule-based brief.
    return NextResponse.json({ available: false, reason: 'No AI provider configured' });
  }

  let body: { symbol?: string; brief?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.symbol || !body.brief) {
    return NextResponse.json({ error: 'symbol and brief are required' }, { status: 400 });
  }
  if (body.brief.length > MAX_BRIEF) {
    return NextResponse.json({ error: 'brief too long' }, { status: 400 });
  }

  const plan = await planSetup(body.brief, body.symbol);

  if (!plan) {
    return NextResponse.json({ available: false, reason: 'Model unavailable' });
  }

  return NextResponse.json({ available: true, ...plan });
}
