/**
 * The positions API against the memory store: the gate, then a full
 * add → edit → close → delete round trip. Never touches Supabase.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'ai_access' && cookieValue ? { name, value: cookieValue } : undefined) }),
}));

import { DELETE, GET, PATCH, POST } from '@/app/api/positions/route';
import { accessToken } from '@/lib/analysis/access';
import { __setStore, getStore } from '@/lib/db/client';

const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY, access: process.env.AI_ACCESS_KEY };

function req(method: string, body?: unknown) {
  return new Request('http://localhost/api/positions', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

const long = { symbol: 'EURUSD', side: 'long', entryDate: '2026-09-29', entryPrice: 1.085, stopLoss: 1.075, takeProfit: 1.11, thesis: 'test' };

beforeAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  __setStore(null);
  expect(getStore().kind).toBe('memory');
});

afterAll(() => {
  if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
  if (saved.key !== undefined) process.env.SUPABASE_SERVICE_KEY = saved.key;
  if (saved.access !== undefined) process.env.AI_ACCESS_KEY = saved.access;
  else delete process.env.AI_ACCESS_KEY;
  __setStore(null);
});

beforeEach(async () => {
  process.env.AI_ACCESS_KEY = 'test-passphrase';
  cookieValue = accessToken('test-passphrase');
  for (const p of await getStore().listPositions()) await getStore().deletePosition(p.id);
});

describe('/api/positions gate', () => {
  it('is off without AI_ACCESS_KEY', async () => {
    delete process.env.AI_ACCESS_KEY;
    expect((await GET()).status).toBe(503);
  });

  it('is locked without the cookie, on every method', async () => {
    cookieValue = undefined;
    expect((await GET()).status).toBe(401);
    expect((await POST(req('POST', long))).status).toBe(401);
    expect((await PATCH(req('PATCH', { id: 'x' }))).status).toBe(401);
    expect((await DELETE(req('DELETE', { id: 'x' }))).status).toBe(401);
    expect(await getStore().listPositions()).toEqual([]);
  });

  it('rejects a cookie issued for another passphrase', async () => {
    cookieValue = accessToken('old-passphrase');
    expect((await GET()).status).toBe(401);
  });
});

describe('/api/positions round trip', () => {
  it('adds, edits, closes and deletes', async () => {
    const added = await POST(req('POST', long));
    expect(added.status).toBe(200);
    const { position } = (await added.json()) as { position: { id: string; symbol: string } };
    expect(position.symbol).toBe('EURUSD');

    const listed = (await (await GET()).json()) as { positions: { id: string }[]; durable: boolean };
    expect(listed.positions.map((p) => p.id)).toEqual([position.id]);
    expect(listed.durable).toBe(false);

    const moved = await PATCH(req('PATCH', { id: position.id, stopLoss: 1.08 }));
    expect(((await moved.json()) as { position: { stopLoss: number } }).position.stopLoss).toBe(1.08);

    const wrong = await PATCH(req('PATCH', { id: position.id, stopLoss: 1.09 }));
    expect(wrong.status).toBe(400);

    const closed = await PATCH(req('PATCH', { id: position.id, close: true, closePrice: 1.1 }));
    const c = ((await closed.json()) as { position: { closedAtUtc: string | null; closePrice: number } }).position;
    expect(c.closedAtUtc).not.toBeNull();
    expect(c.closePrice).toBe(1.1);
    expect(await getStore().listPositions({ open: true })).toEqual([]);

    expect((await DELETE(req('DELETE', { id: position.id }))).status).toBe(200);
    expect((await DELETE(req('DELETE', { id: position.id }))).status).toBe(404);
  });

  it('says why a position is refused', async () => {
    const res = await POST(req('POST', { ...long, stopLoss: 1.2 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/stop loss 1.2 must be below entry/);
  });

  it('404s an unknown id and 400s a body without one', async () => {
    expect((await PATCH(req('PATCH', { id: 'nope', stopLoss: 1 }))).status).toBe(404);
    expect((await PATCH(req('PATCH', { stopLoss: 1 }))).status).toBe(400);
  });
});
