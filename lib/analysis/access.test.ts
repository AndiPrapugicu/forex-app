import { afterEach, describe, expect, it } from 'vitest';
import { accessToken, createRateLimiter, hasAccess, isAccessConfigured, verifyKey } from '@/lib/analysis/access';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe('access', () => {
  it('fails closed when no passphrase is configured', () => {
    delete process.env.AI_ACCESS_KEY;
    expect(isAccessConfigured()).toBe(false);
    expect(verifyKey('anything')).toBe(false);
    expect(hasAccess(accessToken('anything'))).toBe(false);
  });

  it('accepts the passphrase and the cookie issued for it, nothing else', () => {
    process.env.AI_ACCESS_KEY = 'correct horse battery staple';
    expect(verifyKey('correct horse battery staple')).toBe(true);
    expect(verifyKey('wrong')).toBe(false);
    expect(hasAccess(accessToken('correct horse battery staple'))).toBe(true);
    expect(hasAccess(accessToken('wrong'))).toBe(false);
    expect(hasAccess(undefined)).toBe(false);
  });

  it('never puts the passphrase itself in the cookie', () => {
    const token = accessToken('secret-pass');
    expect(token).not.toContain('secret-pass');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a changed passphrase invalidates old cookies', () => {
    process.env.AI_ACCESS_KEY = 'old';
    const cookie = accessToken('old');
    process.env.AI_ACCESS_KEY = 'new';
    expect(hasAccess(cookie)).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('allows the limit per rolling window, then refuses', () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow(0)).toBe(true);
    expect(allow(10)).toBe(true);
    expect(allow(20)).toBe(false);
    expect(allow(1001)).toBe(true);
  });
});
