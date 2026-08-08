/**
 * Manual actual entry — the instant path.
 *
 * No free feed publishes a number the moment it hits the wire. Since this is a
 * single-user app, the fastest reliable input is the user typing what they just
 * saw. A manual value outranks every feed and rescoring is immediate.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStore } from '@/lib/db/client';
import { scoreEvent } from '@/lib/scoring/surprise';

export const dynamic = 'force-dynamic';

const Body = z.object({
  eventId: z.string().min(1),
  // Accepts a number, or a string like "142K" / "3.4%" from a quick paste.
  actual: z.union([z.number(), z.string()]),
  note: z.string().max(500).optional(),
});

/** Same permissive parsing the connectors use for feed values. */
function toNumber(raw: number | string): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const cleaned = raw.trim().replace(/[%,$€£¥]/g, '').replace(/,/g, '');
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?$/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() ?? ''] ?? 1;
  return value * mult;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'eventId and actual are required' }, { status: 400 });
  }

  const actual = toNumber(parsed.data.actual);
  if (actual === null) {
    return NextResponse.json(
      { error: `could not parse "${parsed.data.actual}" as a number` },
      { status: 400 },
    );
  }

  const store = getStore();
  const event = await store.getEvent(parsed.data.eventId);
  if (!event) {
    return NextResponse.json({ error: 'unknown event' }, { status: 404 });
  }

  await store.setManualActual(parsed.data.eventId, actual, parsed.data.note);

  // Score immediately so the caller gets the new verdict in the same round trip.
  // The feed's ratioDeviation described the feed's number, so it is dropped
  // unless the manual value matches — otherwise we would attach a surprise
  // magnitude computed for a different figure.
  const matchesFeed = event.actual === actual;
  const updated = {
    ...event,
    actual,
    actualSource: 'manual' as const,
    ratioDeviation: matchesFeed ? event.ratioDeviation : null,
    isBetterThanExpected: matchesFeed ? event.isBetterThanExpected : null,
  };

  const score = scoreEvent(updated);
  await store.saveScores([score]).catch(() => {});
  await store.upsertEvents([updated]).catch(() => {});

  return NextResponse.json({
    ok: true,
    event: updated,
    score,
    // Surfaced rather than hidden: if the feed already had a different number,
    // the user should know they are overriding it.
    conflictsWithFeed:
      event.actual !== null && event.actual !== actual
        ? { feed: event.actual, manual: actual }
        : null,
  });
}
