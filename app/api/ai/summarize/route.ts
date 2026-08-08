/**
 * On-demand AI explanation for a single event.
 *
 * Deliberately NOT part of the ingest pipeline: explanations are generated when
 * someone actually opens an event, so a cron run over 200 events never bills the
 * user for prose nobody reads.
 */

import { NextResponse } from 'next/server';
import { explainEvent } from '@/lib/ai/prompts';
import { getAiProvider } from '@/lib/ai/provider';
import { getStore } from '@/lib/db/client';
import { scoreEvent } from '@/lib/scoring/surprise';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const provider = getAiProvider();
  if (!provider) {
    // A first-class state, not an error: the dashboard is fully usable without AI.
    return NextResponse.json({ available: false, reason: 'No AI provider configured' });
  }

  let body: { eventId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const event = await getStore().getEvent(body.eventId).catch(() => null);
  if (!event) {
    return NextResponse.json({ error: 'unknown event' }, { status: 404 });
  }

  const explanation = await explainEvent(event, scoreEvent(event));

  if (!explanation) {
    return NextResponse.json({
      available: false,
      reason: event.actual === null ? 'Not yet released' : 'Model unavailable',
    });
  }

  return NextResponse.json({ available: true, ...explanation });
}
