/**
 * The component-level parity matrix: symbol x date x column -> how well our
 * cell agrees with A1's, and how much that agreement is worth trusting.
 *
 * WHY THIS EXISTS. `scripts/top-setups-parity.ts` already tallies EXACT/DIFF
 * for the handful of rows that passed a checksum, and `scripts/parity.ts`
 * already reads a currency's macro error off its own index row. Neither one
 * says, for a SPECIFIC cell, how confident the comparison is. A checksummed
 * cell and an algebraically solved leg are both "evidence", but not the same
 * strength of it, and a `rates` mismatch on a rewound historical date is not
 * the same kind of finding as one on the live board, because `rates` on DXY
 * (and `trend`, `crowd`, everywhere) is not rewound by `asOf` at all — see
 * `lib/scoring/backtest.ts`. Collapsing all of that into one number, as every
 * prior parity script does, is what let a live-only column's ordinary drift
 * get read as a scoring defect more than once.
 *
 * THREE EVIDENCE TIERS, load-bearing and never blended:
 *
 *   CHECKSUMMED_CELL  A1's own cell, read off a row whose 18 cells summed to
 *                      its own printed total (`fixtures/a1-top-setups-*.json`
 *                      `.cells`, or a validated `fixtures/a1-board.json` row).
 *                      The only tier that can produce EXACT or MISMATCH.
 *   SOLVED_LEG        No direct cell, but `lib/scoring/a1-legs.ts`'s exact
 *                      solver pinned every currency leg the cell needs from
 *                      OTHER checksummed rows. Real evidence, algebraic
 *                      rather than read, so it earns its own status
 *                      (NOT_CHECKSUMMED) instead of masquerading as a cell A1
 *                      actually printed.
 *   NONE              Nothing. UNKNOWN, not zero — see the round's own rule
 *                      against representing an unmeasured cell as neutral.
 *
 * REPRODUCIBILITY IS PER (SYMBOL, COMPONENT), NOT PER COMPONENT. `rates` is
 * the reason this matters: it is built from `events` — and so genuinely
 * rewound by `asOf` — for every FX pair and every non-USD currency-index row,
 * but DXY and every other non-FX asset read `scoreYield2y` off a live,
 * unrewound snapshot (`lib/scoring/setups.ts`'s `isFx` / `DXY` / currency-index
 * / else branches). A registry keyed only by column key would call EURCHF's
 * rates column live when it is not.
 */

import { SCORING_SLOTS, type SlotDefinition } from '@/config/setups.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { predictCell, type Leg } from '@/lib/scoring/a1-legs';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { Currency } from '@/lib/types';

export type EvidenceTier = 'CHECKSUMMED_CELL' | 'SOLVED_LEG' | 'NONE';
export type AsOfReproducibility = 'HISTORICAL' | 'PARTIAL' | 'LIVE_ONLY';
export type ParityStatus =
  | 'EXACT'
  | 'MISMATCH'
  | 'UNKNOWN'
  | 'NOT_VISIBLE'
  | 'NOT_CHECKSUMMED'
  | 'BLOCKED_SOURCE'
  | 'TIMING_CONFOUNDED';

export interface ComponentParityCell {
  symbol: string;
  date: string;
  component: string;
  ourValue: number | null;
  theirValue: number | null;
  evidenceTier: EvidenceTier;
  evidenceSource: string;
  reproducibility: AsOfReproducibility;
  status: ParityStatus;
  note?: string;
}

export interface ComponentParityMatrix {
  generatedAtUtc: string;
  cells: ComponentParityCell[];
}

/**
 * Per-component reproducibility, with `rates`'s per-symbol exception.
 *
 * `seasonality` is PARTIAL rather than HISTORICAL on purpose: `scoreSeasonality`
 * takes a date and picks the right calendar month, but the ten-year average
 * BEHIND that month is a live, current-day computation with no way to ask what
 * it looked like as of a past `asOf` — see `lib/scoring/history.ts`'s header.
 * `crowd` is labelled LIVE_ONLY uniformly even though its COT-fallback rung
 * (`lib/scoring/crowd.ts`'s rung 2) genuinely rewinds — a conservative
 * simplification: mislabelling that rare case costs a false TIMING_CONFOUNDED,
 * not a false EXACT, which is the safe direction for a diagnostic to be wrong.
 */
const REPRODUCIBILITY: Record<string, AsOfReproducibility | ((def: SymbolDefinition) => AsOfReproducibility)> = {
  /**
   * HISTORICAL since 2026-08-30, when `pricesAsOf` reached the price series.
   *
   * It was LIVE_ONLY for as long as the pipeline scored a rewound board off
   * today's moving averages, and that label was correct then. Leaving it in
   * place after the fix would be the UNSAFE direction to be wrong in: a real
   * trend disagreement would be reported as clock noise. All eight checksummed
   * trend cells currently agree, so this changes no count today — it decides
   * what happens the first time one does not.
   */
  trend: 'HISTORICAL',
  seasonality: 'PARTIAL',
  cot: 'HISTORICAL',
  crowd: 'LIVE_ONLY',
  /**
   * STILL HISTORICAL, and the alternative was tried and reverted.
   *
   * `scoreRateExpectation` gained a branch that reads the consensus on a
   * decision which has not happened yet, and the calendar publishes no history
   * of its own forecast column — so that number is today's estimate however far
   * back the board is wound. Demoting the whole column to PARTIAL to express
   * that was measured and was worse: PARTIAL turns every non-DXY rates
   * disagreement into TIMING_CONFOUNDED, which swallowed the one real rates gap
   * left on file (EURCHF, 2026-08-24, ours 0 against their +1) and reported it
   * as clock noise. Hiding a live finding is the wrong direction for a
   * diagnostic to be wrong in. The anachronism is named in `ratesLimitationNote`
   * instead, where it annotates the cell rather than reclassifying it.
   */
  rates: () => {
    /**
     * HISTORICAL FOR EVERY ROW SINCE 2026-08-31, including DXY and the assets.
     *
     * That branch used to return LIVE_ONLY here, because `fetchYield2y` read a
     * live quote no cutoff could rewind. It now reads FRED DGS2 and takes
     * `pricesAsOf` like every other price-derived input, so the exemption is
     * gone with the leak that earned it.
     *
     * KEEPING THE OLD LABEL WOULD HAVE HIDDEN THE COST OF THAT FIX: the two
     * metal rate cells stop matching, and under LIVE_ONLY they would have
     * reported as TIMING_CONFOUNDED — clock noise — rather than as the real
     * disagreement they are. Same mistake `trend` was carrying a round ago.
     */
    return 'HISTORICAL';
  },
};

export function reproducibilityOf(def: SymbolDefinition, slot: SlotDefinition): AsOfReproducibility {
  const rule = REPRODUCIBILITY[slot.key];
  if (rule) return typeof rule === 'function' ? rule(def) : rule;
  if (slot.kind === 'economic') return 'HISTORICAL'; // all fourteen heatmap slots: scoreSlot, from events
  return 'LIVE_ONLY';
}

/**
 * A cell that is null for a KNOWN, already-diagnosed reason, rather than one
 * we simply have not looked at yet.
 *
 * Scoped to crowd/crosses today — the one place this codebase's own scoring
 * layer deliberately returns `null` rather than a value (`resolveCrowd`'s rung
 * 3, `lib/scoring/crowd.ts`). `rates` is NOT here: our rule scores non-USD
 * legs a real 0 "by construction" rather than null (see that file's own
 * comment), so a rates gap surfaces as an honest MISMATCH with an explanatory
 * note attached in `buildComponentParityMatrix`, not as BLOCKED_SOURCE — the
 * cell is not missing, it is a value known to be structurally limited.
 */
function blockedReason(def: SymbolDefinition, slot: SlotDefinition): string | null {
  if (slot.key !== 'crowd') return null;
  const isCross = !!def.base && !!def.quote && def.base !== 'USD' && def.quote !== 'USD';
  if (!isCross) return null;
  return (
    'No retail-positioning feed configured (Myfxbook is code-complete but dormant, and a valid ' +
    'login session is rejected server-side independent of credentials) and a cross has no CFTC ' +
    'contract of its own — see resolveCrowd in lib/scoring/crowd.ts.'
  );
}

/**
 * The explanatory note attached to a `rates` MISMATCH whose root cause is
 * already understood, so it does not read as new information every run.
 *
 * TWO THINGS TO SAY, and the column now needs both. The remaining LIMIT: a
 * currency with no dot plot and no decision inside the calendar's forward window
 * still has no forecast to compare against and scores 0 by construction. The
 * remaining ANACHRONISM: where the scheduled-decision branch does fire, the
 * consensus it reads is today's, because the calendar keeps no history of its
 * forecast column — so a rewound comparison on such a cell is not fully
 * historical even though the column is labelled that way.
 */
function ratesLimitationNote(def: SymbolDefinition): string | null {
  const legs = [def.base, def.quote, def.kind === 'currency' ? def.macroEconomy : undefined].filter(
    (c): c is Currency => !!c && c !== 'USD',
  );
  if (legs.length === 0 || def.symbol === 'DXY') return null;
  const currencies = [...new Set(legs)].join('/');
  return (
    `Rates for ${currencies} scores from the next scheduled decision's consensus where the ` +
    'calendar carries one, and 0 where it does not — no central bank but the Fed publishes its own ' +
    'projection. Two caveats on this cell: a 0 may mean "no forecast in the window" rather than ' +
    '"a hold is expected", and a non-zero one reads TODAY\'s consensus even at a rewound date, ' +
    'because the calendar keeps no history of its forecast column. See Rates in ' +
    'EdgeFinder-known-unknown-blocked.md.'
  );
}

/**
 * Whether this column does not apply to this row's economy at all — the
 * convention `scripts/top-setups-parity.ts` already proved: A1 prints 0 in a
 * US-only column (PCE, NFP, claims, ADP, JOLTS) on a row with no dollar leg,
 * and we render that cell blank rather than a scored neutral. Both encode "no
 * such series"; only one side spends a digit saying so.
 *
 * Deliberately checked ONLY against a checksummed A1 value. A `SOLVED_LEG`
 * prediction of 0 for the same reason is real evidence too, but weaker — it is
 * "no row has ever pinned this leg to anything but 0", not "A1's own card
 * prints 0 here" — so it is left to read as NOT_CHECKSUMMED rather than
 * upgraded to the same certainty as a cell someone actually saw.
 */
function isStructuralNotVisible(ourValue: number | null, theirCheckedValue: number): boolean {
  return ourValue === null && theirCheckedValue === 0;
}

export interface ComponentParityContext {
  /** The asOf date this comparison is anchored to, e.g. '2026-08-24'. */
  date: string;
  /** True only when `date` is today's live board — HISTORICAL-labelled columns aside, nothing else is rewound. */
  liveNow: boolean;
  /** Our board at this date, keyed by our symbol. */
  ourRows: Map<string, SymbolRow>;
  /** A1's checksummed cells for THIS date, our-symbol -> slotKey -> value. */
  checksummedCells: Record<string, Partial<Record<string, number>>>;
  /** Human-readable citation for where `checksummedCells` came from, e.g. a fixture filename. */
  checksummedSource: string;
  /** The exact leg solve to draw SOLVED_LEG predictions from. */
  legs: Map<Currency, Partial<Record<string, Leg>>>;
  /** Which of our symbols to build rows for. */
  symbols: SymbolDefinition[];
}

/**
 * Builds one date's slice of the parity matrix. Callers combine slices across
 * dates (2026-08-24, 2026-08-25, live-now) into one `ComponentParityMatrix`.
 */
export function buildComponentParityMatrix(ctx: ComponentParityContext): ComponentParityMatrix {
  const cells: ComponentParityCell[] = [];

  for (const def of ctx.symbols) {
    const ourRow = ctx.ourRows.get(def.symbol);

    for (const slot of SCORING_SLOTS) {
      const ourValue = ourRow?.cells[slot.key]?.cell ?? null;
      const reproducibility = reproducibilityOf(def, slot);
      const theirChecksummed = ctx.checksummedCells[def.symbol]?.[slot.key];

      if (theirChecksummed !== undefined) {
        if (isStructuralNotVisible(ourValue, theirChecksummed)) {
          cells.push({
            symbol: def.symbol,
            date: ctx.date,
            component: slot.key,
            ourValue,
            theirValue: theirChecksummed,
            evidenceTier: 'CHECKSUMMED_CELL',
            evidenceSource: ctx.checksummedSource,
            reproducibility,
            status: 'NOT_VISIBLE',
            note: `${slot.label} does not apply to ${def.symbol}'s economy; A1 prints 0 for "no such series".`,
          });
          continue;
        }

        const blocked = ourValue === null ? blockedReason(def, slot) : null;
        if (blocked) {
          cells.push({
            symbol: def.symbol,
            date: ctx.date,
            component: slot.key,
            ourValue,
            theirValue: theirChecksummed,
            evidenceTier: 'CHECKSUMMED_CELL',
            evidenceSource: ctx.checksummedSource,
            reproducibility,
            status: 'BLOCKED_SOURCE',
            note: blocked,
          });
          continue;
        }

        if (ourValue === theirChecksummed) {
          cells.push({
            symbol: def.symbol,
            date: ctx.date,
            component: slot.key,
            ourValue,
            theirValue: theirChecksummed,
            evidenceTier: 'CHECKSUMMED_CELL',
            evidenceSource: ctx.checksummedSource,
            reproducibility,
            status: 'EXACT',
          });
          continue;
        }

        const timingConfounded = reproducibility !== 'HISTORICAL' && !ctx.liveNow;
        const note = slot.key === 'rates' ? (ratesLimitationNote(def) ?? undefined) : undefined;
        cells.push({
          symbol: def.symbol,
          date: ctx.date,
          component: slot.key,
          ourValue,
          theirValue: theirChecksummed,
          evidenceTier: 'CHECKSUMMED_CELL',
          evidenceSource: ctx.checksummedSource,
          reproducibility,
          status: timingConfounded ? 'TIMING_CONFOUNDED' : 'MISMATCH',
          note:
            note ??
            (timingConfounded
              ? `${slot.label} is not rewound by asOf (reproducibility: ${reproducibility}); this gap may be ` +
                `today's live reading compared against a ${ctx.date} capture, not a rule difference.`
              : undefined),
        });
        continue;
      }

      const predicted = predictCell(def, slot, ctx.legs);
      if (predicted) {
        const blocked = ourValue === null ? blockedReason(def, slot) : null;
        cells.push({
          symbol: def.symbol,
          date: ctx.date,
          component: slot.key,
          ourValue,
          theirValue: predicted.value,
          evidenceTier: 'SOLVED_LEG',
          evidenceSource: `solveA1Legs: ${slot.key} via ${predicted.currencies.join(', ')}`,
          reproducibility,
          status: blocked ? 'BLOCKED_SOURCE' : 'NOT_CHECKSUMMED',
          note:
            blocked ??
            (slot.key === 'rates' ? ratesLimitationNote(def) ?? undefined : undefined) ??
            `ours ${ourValue ?? 'null'} vs algebraically predicted ${predicted.value} — no checksummed cell exists for this row.`,
        });
        continue;
      }

      const blocked = ourValue === null ? blockedReason(def, slot) : null;
      cells.push({
        symbol: def.symbol,
        date: ctx.date,
        component: slot.key,
        ourValue,
        theirValue: null,
        evidenceTier: 'NONE',
        evidenceSource: 'no evidence',
        reproducibility,
        status: blocked ? 'BLOCKED_SOURCE' : 'UNKNOWN',
        note: blocked ?? undefined,
      });
    }
  }

  return { generatedAtUtc: new Date().toISOString(), cells };
}
