/**
 * The AI Analysis passphrase.
 *
 * The site is public and single-user, and every question spends a share of a
 * free daily quota on the owner's OpenRouter key. So the chat is locked behind
 * `AI_ACCESS_KEY`, typed once and remembered in an httpOnly cookie.
 *
 * The cookie never holds the key itself, only an HMAC of it, so a leaked
 * cookie does not reveal the passphrase. Changing `AI_ACCESS_KEY` invalidates
 * every cookie issued under the old one.
 *
 * FAIL CLOSED: with no key configured the feature is off, locally as much as in
 * production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'ai_access';
export const ACCESS_COOKIE_MAX_AGE = 30 * 24 * 3600;

function configuredKey(): string | null {
  const key = process.env.AI_ACCESS_KEY?.trim();
  return key && !key.startsWith('<') ? key : null;
}

export function isAccessConfigured(): boolean {
  return configuredKey() !== null;
}

/** The cookie value for a passphrase. */
export function accessToken(key: string): string {
  return createHmac('sha256', key).update('ai-analysis').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when `input` is the configured passphrase. */
export function verifyKey(input: string): boolean {
  const key = configuredKey();
  return key !== null && safeEqual(accessToken(input), accessToken(key));
}

/** True when a request's cookie was issued for the configured passphrase. */
export function hasAccess(cookieValue: string | undefined): boolean {
  const key = configuredKey();
  return key !== null && typeof cookieValue === 'string' && safeEqual(cookieValue, accessToken(key));
}

/**
 * At most `limit` questions in any rolling minute, per server process.
 *
 * Per process is weak on a serverless platform, and that is acceptable: the
 * passphrase is the real gate, and OpenRouter enforces its own 20-a-minute
 * limit. This only stops one open tab from looping.
 */
export function createRateLimiter(limit: number, windowMs = 60_000) {
  const stamps: number[] = [];
  return (now = Date.now()): boolean => {
    while (stamps.length > 0 && now - stamps[0] >= windowMs) stamps.shift();
    if (stamps.length >= limit) return false;
    stamps.push(now);
    return true;
  };
}
