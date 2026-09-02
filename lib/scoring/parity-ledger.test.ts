/**
 * The ledger's invariants.
 *
 * As with the source-confidence ledger, these cannot check that a
 * classification is RIGHT. They check that an entry cannot be written without
 * the thing that justifies it — the failure mode being a mismatch filed under a
 * comfortable label and never looked at again.
 */

import { describe, expect, it } from 'vitest';

import {
  FULL_ACCESS_FROM,
  PARITY_LEDGER,
  evidenceTierOf,
  ledgerByClassification,
  ledgerByEvidenceTier,
  ledgerEntry,
} from '@/lib/scoring/parity-ledger';

describe('the remaining-parity ledger', () => {
  it('has no duplicate keys', () => {
    const keys = PARITY_LEDGER.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('dates every entry that names a specific observation', () => {
    for (const entry of PARITY_LEDGER) {
      if (entry.date === null) continue;
      expect(entry.date, entry.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.date)), entry.key).toBe(false);
    }
  });

  it('carries both sides of every comparison', () => {
    for (const entry of PARITY_LEDGER) {
      expect(entry.ours.length, entry.key).toBeGreaterThan(0);
      expect(entry.a1.length, entry.key).toBeGreaterThan(0);
    }
  });

  it('requires evidence long enough to be a measurement', () => {
    for (const entry of PARITY_LEDGER) {
      expect(entry.evidence.length, entry.key).toBeGreaterThan(80);
      expect(entry.rootCause.length, entry.key).toBeGreaterThan(30);
    }
  });

  it('states a production action for every entry, "NONE" included', () => {
    for (const entry of PARITY_LEDGER) {
      expect(entry.productionAction.length, entry.key).toBeGreaterThan(10);
    }
  });

  /**
   * The classification that most needs a guard. SOURCE_DIFFERENCE means "their
   * rule is our rule, their number is not", so an entry filed there has to show
   * BOTH numbers — otherwise it is an assertion, not a finding.
   */
  it('requires a SOURCE_DIFFERENCE to quote both sides numbers', () => {
    for (const entry of ledgerByClassification().SOURCE_DIFFERENCE) {
      const digits = entry.evidence.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(digits.length, entry.key).toBeGreaterThanOrEqual(3);
    }
  });

  it('never lets a WEAK entry license a production change', () => {
    for (const entry of PARITY_LEDGER) {
      if (entry.confidence !== 'WEAK') continue;
      expect(entry.productionAction.startsWith('NONE'), entry.key).toBe(true);
    }
  });

  it('keeps the CHF consumer-confidence fix closed, and closed for the right reason', () => {
    // The single most re-proposed change in this project. It is a source
    // difference, not a basis difference, and the entry has to keep saying so.
    const entry = ledgerEntry('consumer-confidence:CHF');
    expect(entry?.classification).toBe('SOURCE_DIFFERENCE');
    expect(entry?.confidence).toBe('PROVEN');
    expect(entry?.evidence).toContain('-33');
    expect(entry?.evidence).toContain('-35');
    expect(entry?.productionAction).toContain('NONE');
  });

  it('records the rates rule as discovered but NOT implemented', () => {
    const entry = ledgerEntry('rates:usd-leg');
    expect(entry?.classification).toBe('UNKNOWN');
    expect(entry?.confidence).toBe('STRONG');
    // The measured negative result is the reason, and it has to stay in the file
    // or the next round re-runs the same experiment.
    expect(entry?.productionAction).toContain('82/98');
  });

  it('files a mismatch against A1s own published data as their inconsistency', () => {
    for (const key of ['mpmi:CHF', 'polarity:silver']) {
      expect(ledgerEntry(key)?.classification, key).toBe('A1_INCONSISTENCY');
    }
  });

  it('closes EUR unemployment against A1s own board rather than leaving it open', () => {
    // Three rounds carried this as UNKNOWN because A1 publishes no unemployment
    // forecast. It was settled from their cells instead, and the entry has to
    // keep the arithmetic or the "score against the previous print" proposal
    // comes back a fourth time.
    const entry = ledgerEntry('unemployment:EUR');
    expect(entry?.classification).toBe('A1_INCONSISTENCY');
    expect(entry?.evidence).toContain('-2');
    expect(entry?.productionAction.startsWith('NONE')).toBe(true);
  });

  it('records that the EURX row cannot be checksum-tested on its two suspect cells', () => {
    // The finding that removes the only counter-example to the rates rule. If
    // this sentence goes, the next round treats that cell as attested again.
    const entry = ledgerEntry('rates:EURX');
    expect(entry?.evidence).toContain('cancel');
    // And it must not have become a licence to edit the fixture.
    expect(entry?.productionAction).toContain('NOT a fixture edit');
  });

  it('accounts for every GBP economic cell that disagreed, and says whose each was', () => {
    // GBPX's economic block sat one point above A1's, spread over exactly four
    // cells. Each one needs a filed diagnosis and an action consistent with it.
    //
    // THIS USED TO ASSERT THAT NONE OF THE FOUR WAS A DEFECT IN OUR COMPARISON,
    // and that was wrong: GDP was ours, reading the monthly series where their
    // board scores the quarterly. An invariant that cannot be falsified by
    // finding a real bug is not testing anything, so it now checks that each
    // cell is ATTRIBUTED and that the attribution matches what was done.
    for (const key of ['gdp:GBP', 'mpmi:GBP', 'retail-sales:GBP', 'ppi:GBP']) {
      const entry = ledgerEntry(key);
      expect(entry, key).toBeDefined();
      expect(['SOURCE_DIFFERENCE', 'A1_INCONSISTENCY', 'FIXED'], key).toContain(
        entry!.classification,
      );
      const action = entry!.productionAction;
      expect(action.startsWith(entry!.classification === 'FIXED' ? 'DONE' : 'NONE'), key).toBe(true);
    }
  });

  it('keeps the record that GBP GDP was our series choice, not their feed', () => {
    // The one GBP cell that turned out to be ours. If this entry ever reverts to
    // SOURCE_DIFFERENCE the monthly override comes back with it.
    const entry = ledgerEntry('gdp:GBP');
    expect(entry?.classification).toBe('FIXED');
    expect(entry?.evidence).toContain('0,4%');
    expect(entry?.productionAction).toContain('DELETING');
  });

  it('holds every FIXED entry to the standard that class implies', () => {
    // This replaces "nothing is filed as FIXED", which stood for three rounds
    // and was deleted the round something genuinely was. FIXED is the only
    // class that claims credit, so it carries the heaviest bar: the evidence
    // must be a measurement with both before and after in it, and the action
    // must say what shipped rather than what should.
    //
    // ASSERTED OVER THE WHOLE CLASS, not over a count. An earlier version of
    // this test pinned `FIXED` at length 1, so the next genuine fix failed it
    // and the cheapest repair would have been to bump the number — which tests
    // nothing. Every entry must clear the bar; how many there are is not the
    // property worth defending.
    const fixed = ledgerByClassification().FIXED;
    expect(fixed.length).toBeGreaterThan(0);
    for (const entry of fixed) {
      expect(entry.confidence, entry.key).toBe('PROVEN');
      // Shipped, not proposed: an action that still says "should" is a plan.
      expect(entry.productionAction.startsWith('DONE'), entry.key).toBe(true);
      // A fix earns its class by being measured, so the evidence has to carry
      // the counts on both sides of it.
      expect(/\d/.test(entry.evidence), entry.key).toBe(true);
    }

    const trend = ledgerEntry('trend:as-of');
    expect(trend?.confidence).toBe('PROVEN');
    // Six live, eight rewound — the number that justified the change.
    expect(trend?.evidence).toContain('EIGHT of eight');
    expect(trend?.evidence).toContain('six');
    // And the guard that keeps it from becoming a formula change later.
    expect(trend?.productionAction).toContain('scoreTrend` and `TREND_SMA` are untouched');

    // The COT publication-lag fix, held to the same guard: it changed WHICH
    // report the scorers are handed, never how they score it.
    const cot = ledgerEntry('cot:publication-lag');
    expect(cot?.classification).toBe('FIXED');
    expect(cot?.productionAction).toContain('`scoreCot` and `scoreCrowd` are untouched');
    // The cell that made it observable rather than merely correct.
    expect(cot?.evidence).toContain('NZDX');
  });

  /**
   * THE TIERING, WHICH IS THE POINT OF THE FIELD.
   *
   * Everything measured before A1's Free Week was measured through a demo whose
   * Top Setups page read "Premium only feature". Those entries are kept, not
   * deleted -- but an entry must never silently present a demo-era measurement
   * as if it had been taken against the real product.
   */
  it('tiers every entry by which A1 it was observed against', () => {
    const tiers = ledgerByEvidenceTier();
    expect(tiers.DEMO_ERA.length + tiers.FULL_ACCESS.length).toBe(PARITY_LEDGER.length);
    for (const entry of PARITY_LEDGER) {
      if (entry.evidenceTier) continue;
      const expected =
        entry.date !== null && entry.date >= FULL_ACCESS_FROM ? 'FULL_ACCESS' : 'DEMO_ERA';
      expect(evidenceTierOf(entry), entry.key).toBe(expected);
    }
    // A standing structural finding has no date and cannot claim full access.
    for (const entry of PARITY_LEDGER) {
      if (entry.date === null && !entry.evidenceTier) {
        expect(evidenceTierOf(entry), entry.key).toBe('DEMO_ERA');
      }
    }
  });

  it('keeps consumer confidence filed as their blank index rows, not our missing rule', () => {
    // The column spent four rounds labelled unsolvable. Full access showed the
    // rule was the ordinary one and their INDEX rows were empty. If this entry
    // reverts, the next round starts fitting a bespoke rule to 28 cells again.
    const entry = ledgerEntry('cnsmr-conf:index-rows-are-blank-not-neutral');
    expect(entry?.classification).toBe('A1_INCONSISTENCY');
    expect(entry?.confidence).toBe('PROVEN');
    expect(entry?.evidence).toContain('7 of 8');
    expect(entry?.productionAction).toContain('NOT by copying');
  });

  it('keeps the +-4/+-7 bands defended against A1s own +-5/+-12 chart', () => {
    const entry = ledgerEntry('bias-bands:their-chart-says-5-and-12');
    expect(entry?.classification).toBe('A1_INCONSISTENCY');
    expect(entry?.evidence).toContain('216 of 216');
    expect(entry?.productionAction.startsWith('NONE')).toBe(true);
  });

  it('leaves the no-forecast fallback basis open rather than fitted to one cell', () => {
    const entry = ledgerEntry('econ:no-forecast-fallback-basis');
    expect(entry?.classification).toBe('UNKNOWN');
    expect(entry?.confidence).toBe('WEAK');
    expect(entry?.evidence).toContain('OPPOSITE WAYS');
    expect(entry?.evidence).toContain('PREVIOUS ROW');
    expect(entry?.evidence).toContain('DISTINCT');
  });
});
