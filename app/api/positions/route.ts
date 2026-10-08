/**
 * The user's own positions: list, add, edit or close, delete.
 *
 * Private to the passphrase holder. Every method checks the same `ai_access`
 * cookie as the AI chat; without `AI_ACCESS_KEY` the feature is off (503), and
 * without the cookie it is locked (401). Validation is `lib/analysis/positions.ts`.
 *
 * GET    → { ok, positions }                 open first, then closed (newest first)
 * POST   { symbol, side, entryDate, entryPrice, stopLoss?, takeProfit?, size?, riskPct?, thesis? }
 * PATCH  { id, close: true, closePrice? } | { id, stopLoss?, takeProfit?, size?, riskPct?, thesis? }
 * DELETE { id }
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, createRateLimiter, hasAccess, isAccessConfigured } from '@/lib/analysis/access';
import { validateNewPosition, validatePatch } from '@/lib/analysis/positions';
import { getStore, PositionsTableMissing } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/** Generous for a person, tight for a loop. */
const allowWrite = createRateLimiter(30);

function refuse(status: number, reason: string) {
  return NextResponse.json({ ok: false, reason }, { status });
}

async function gate(): Promise<NextResponse | null> {
  if (!isAccessConfigured()) return refuse(503, 'Positions are off: AI_ACCESS_KEY is not set on the server.');
  const jar = await cookies();
  if (!hasAccess(jar.get(ACCESS_COOKIE)?.value)) return refuse(401, 'Locked. Enter the passphrase first.');
  return null;
}

function storeError(err: unknown) {
  if (err instanceof PositionsTableMissing) return refuse(503, err.message);
  console.error('[positions]', err);
  return refuse(500, 'The store refused the request; nothing was changed.');
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const locked = await gate();
  if (locked) return locked;
  try {
    const all = await getStore().listPositions();
    const positions = [...all.filter((p) => !p.closedAtUtc), ...all.filter((p) => p.closedAtUtc)];
    return NextResponse.json({ ok: true, positions, durable: getStore().durable });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: Request) {
  const locked = await gate();
  if (locked) return locked;
  if (!allowWrite()) return refuse(429, 'Too many changes in a minute. Wait a moment.');
  const body = await readBody(request);
  if (!body) return refuse(400, 'invalid JSON body');

  const store = getStore();
  try {
    const open = await store.listPositions({ open: true });
    const checked = validateNewPosition(body, new Date(), open.length);
    if (!checked.ok) return refuse(400, checked.reason);
    const position = await store.savePosition(checked.value);
    return NextResponse.json({ ok: true, position });
  } catch (err) {
    return storeError(err);
  }
}

export async function PATCH(request: Request) {
  const locked = await gate();
  if (locked) return locked;
  if (!allowWrite()) return refuse(429, 'Too many changes in a minute. Wait a moment.');
  const body = await readBody(request);
  if (!body || typeof body.id !== 'string') return refuse(400, 'expected { id, … }');

  const store = getStore();
  try {
    const current = (await store.listPositions()).find((p) => p.id === body.id);
    if (!current) return refuse(404, 'no position with that id');
    const checked = validatePatch(body, current, new Date());
    if (!checked.ok) return refuse(400, checked.reason);
    const position = await store.updatePosition(current.id, checked.value);
    return position ? NextResponse.json({ ok: true, position }) : refuse(404, 'no position with that id');
  } catch (err) {
    return storeError(err);
  }
}

export async function DELETE(request: Request) {
  const locked = await gate();
  if (locked) return locked;
  if (!allowWrite()) return refuse(429, 'Too many changes in a minute. Wait a moment.');
  const body = await readBody(request);
  if (!body || typeof body.id !== 'string') return refuse(400, 'expected { id }');
  try {
    const deleted = await getStore().deletePosition(body.id);
    return deleted ? NextResponse.json({ ok: true }) : refuse(404, 'no position with that id');
  } catch (err) {
    return storeError(err);
  }
}
