/**
 * Unlocks the AI Analysis chat for this browser.
 *
 * POST `{ key }` checks the passphrase against `AI_ACCESS_KEY` and, on a match,
 * sets an httpOnly cookie holding an HMAC of it — never the key. DELETE clears
 * it. See `lib/analysis/access.ts` for why the feature fails closed.
 */

import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE,
  accessToken,
  createRateLimiter,
  isAccessConfigured,
  verifyKey,
} from '@/lib/analysis/access';

export const dynamic = 'force-dynamic';

/** Slows a guessing loop without bothering a person who mistyped. */
const allowAttempt = createRateLimiter(10);

export async function POST(request: Request) {
  if (!isAccessConfigured()) {
    return NextResponse.json({ ok: false, reason: 'AI_ACCESS_KEY is not set on the server, so AI Analysis is off.' }, { status: 503 });
  }
  if (!allowAttempt()) {
    return NextResponse.json({ ok: false, reason: 'Too many attempts. Wait a minute.' }, { status: 429 });
  }

  let key = '';
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === 'string' ? body.key : '';
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid JSON body' }, { status: 400 });
  }

  if (!verifyKey(key)) {
    return NextResponse.json({ ok: false, reason: 'Wrong passphrase.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, accessToken(key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}
