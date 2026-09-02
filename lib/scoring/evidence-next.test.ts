/**
 * The capture ranker.
 *
 * The failure this guards against is a stale ask: a request that names a ledger
 * key which has since been closed or renamed, carried forward round after round
 * because nobody re-read it. The ranker penalises that, and the first test here
 * makes it impossible to ship one silently.
 */

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_REQUESTS,
  rankEvidence,
  unaddressedLedgerKeys,
  type EvidenceRequest,
} from '@/lib/scoring/evidence-next';
import { ledgerEntry } from '@/lib/scoring/parity-ledger';

describe('every request points at ledger entries that exist', () => {
  it('names no key the ledger has dropped', () => {
    for (const req of EVIDENCE_REQUESTS) {
      for (const key of req.resolves) {
        expect(ledgerEntry(key), `${req.key} -> ${key}`).toBeDefined();
      }
    }
  });

  it('has no duplicate request keys', () => {
    const keys = EVIDENCE_REQUESTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('says exactly what to photograph, not what to look into', () => {
    for (const req of EVIDENCE_REQUESTS) {
      // A capture instruction that fits in a few words is a topic, not an
      // instruction — the previous rounds' lists failed on exactly this.
      expect(req.capture.length, req.key).toBeGreaterThan(60);
      expect(req.rationale.length, req.key).toBeGreaterThan(80);
      expect(req.resolves.length, req.key).toBeGreaterThan(0);
    }
  });
});

describe('ranking', () => {
  it('puts the EURX re-capture first', () => {
    // Not asserted for its own sake: it is the only capture that touches three
    // unresolved entries at once, two of them UNKNOWN, and the only one that
    // could settle the rates rule either way.
    expect(rankEvidence()[0].key).toBe('eurx-second-row');
  });

  it('ranks a free, date-matchable capture above a paid one, all else equal', () => {
    const base: EvidenceRequest = {
      key: 'a',
      capture: 'x'.repeat(70),
      resolves: ['gbpx:residual'],
      access: 'PAID',
      dateMatchable: false,
      couldReachProduction: false,
      rationale: 'y'.repeat(90),
    };
    const ranked = rankEvidence([
      base,
      { ...base, key: 'b', access: 'FREE', dateMatchable: true },
    ]);
    expect(ranked[0].key).toBe('b');
  });

  it('demotes a request that names a key the ledger no longer has', () => {
    const stale: EvidenceRequest = {
      key: 'stale',
      capture: 'x'.repeat(70),
      resolves: ['gbpx:residual', 'a-key-that-was-closed-two-rounds-ago'],
      access: 'FREE',
      dateMatchable: true,
      couldReachProduction: true,
      rationale: 'y'.repeat(90),
    };
    const [ranked] = rankEvidence([stale]);
    expect(ranked.missingKeys).toEqual(['a-key-that-was-closed-two-rounds-ago']);
    // The penalty has to actually bite, or a stale ask keeps its place.
    expect(ranked.score).toBeLessThan(rankEvidence([{ ...stale, resolves: ['gbpx:residual'] }])[0].score);
  });

  it('does not count a FIXED entry as something still worth capturing', () => {
    const req: EvidenceRequest = {
      key: 'already-done',
      capture: 'x'.repeat(70),
      resolves: ['trend:as-of'],
      access: 'FREE',
      dateMatchable: true,
      couldReachProduction: true,
      rationale: 'y'.repeat(90),
    };
    expect(rankEvidence([req])[0].unresolvedCount).toBe(0);
  });
});

describe('coverage', () => {
  it('reports the unresolved entries no capture would touch', () => {
    const unaddressed = unaddressedLedgerKeys();
    // These are proven source differences and A1-side bugs. No screenshot fixes
    // them, and the script says so rather than inventing an ask.
    expect(unaddressed).toContain('crowd:DXY');
    expect(unaddressed).toContain('polarity:silver');
    // A FIXED entry must never appear here.
    expect(unaddressed).not.toContain('trend:as-of');
  });
});
