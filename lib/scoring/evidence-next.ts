/**
 * What to go and capture next, ranked from the ledger rather than from memory.
 *
 * WHY THIS EXISTS. Every round has ended with a hand-written "next best
 * evidence" list, and twice that list asked for something already on file or
 * something the free product provably cannot show. Worse, it ranked by which
 * gap felt largest rather than by how many unresolved cells a single capture
 * would actually settle.
 *
 * So the requests are declared here, but their RANK is derived: each names the
 * `parity-ledger` keys it would resolve, and the score comes from what the
 * ledger says about those keys — how many there are, whether they are still
 * UNKNOWN, and whether resolving them could reach production. A request that
 * names a key which no longer exists, or which has since been closed, loses its
 * standing automatically instead of being carried forward by inertia.
 *
 * NOTHING HERE SCORES ANYTHING. It reads the ledger and prints an ordering.
 */

import { PARITY_LEDGER, type ParityLedgerEntry, ledgerEntry } from '@/lib/scoring/parity-ledger';

/** Where a capture would have to come from. */
export type EvidenceAccess =
  /** Anyone can open the page today. */
  | 'FREE'
  /** Behind A1's paywall — a livestream frame or a subscriber's screenshot. */
  | 'PAID'
  /** Neither: no A1 surface carries it at all. */
  | 'NOT_PUBLISHED';

export interface EvidenceRequest {
  key: string;
  /** The exact screen, filter and symbol. Not a topic — an instruction. */
  capture: string;
  /** Ledger keys this capture could move. Verified to exist by the tests. */
  resolves: string[];
  access: EvidenceAccess;
  /** Can it be pinned to the same date as a board we hold? */
  dateMatchable: boolean;
  /**
   * Could resolving it plausibly change production scoring? A capture that can
   * only ever confirm a source difference is worth less than one that could
   * expose a rule of ours.
   */
  couldReachProduction: boolean;
  /** Why this capture and not a neighbouring one. */
  rationale: string;
}

export const EVIDENCE_REQUESTS: readonly EvidenceRequest[] = [
  {
    key: 'eurx-second-row',
    capture:
      'Top Setups, Symbol filter set to EURO alone so no adjacent row crowds the crop, board ' +
      'timestamp visible, on any date other than 2026-08-24.',
    resolves: ['rates:EURX', 'rates:usd-leg', 'unemployment:EUR'],
    access: 'PAID',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      'The 2026-08-24 EURX row carries the only observation anywhere that contradicts the rates ' +
      'rule, and its checksum cannot test that cell: the rates and unemployment cells are wrong by ' +
      '+1 and -1 under the evidence and cancel exactly, so the row sums to its printed 7 either way. ' +
      'A second row retests both at once. It is the only capture that could turn the rates rule from ' +
      'SUPPORTED into CONFIRMED or destroy it.',
  },
  {
    key: 'chf-third-board',
    capture:
      'Top Setups on any THIRD date, with CH-FRANC and one CHF cross both visible in the same ' +
      'frame, and the board timestamp in shot.',
    resolves: ['chf:legs-move-between-boards', 'consumer-confidence:CHF', 'mpmi:CHF'],
    access: 'PAID',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      "Three of CHF's columns carry different legs on A1's two consecutive boards with no release " +
      'between them, so the pair alone cannot say which value is their stable one — or whether ' +
      'either is. A third date breaks the tie: if it agrees with 2026-08-25 then their 08-24 board ' +
      'was the outlier and our cells are already right, and if it agrees with neither then the ' +
      'column is noise and must be retired as a parity target rather than chased.',
  },
  {
    key: 'gbpx-row',
    capture:
      'Top Setups, Symbol filter set to GB-POUND alone, all 18 cells and the printed Score visible.',
    resolves: ['gbpx:residual'],
    access: 'PAID',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      'GBPX now decomposes into an economic block that is +1 too high and an instrument block that ' +
      'is 2 too low, with crowd accounting for +1 of the latter. One point remains across trend, ' +
      'seasonality and COT, and no algebra can place it because those three columns come from the ' +
      'index instrument rather than any leg.',
  },
  {
    key: 'crowd-cross',
    capture:
      'Retail Sentiment for one FX cross — GBPCHF or EURJPY — with symbol, long %, and the reading ' +
      'timestamp.',
    resolves: ['crowd:board-wide'],
    access: 'PAID',
    dateMatchable: true,
    couldReachProduction: false,
    rationale:
      "The crowd oracle reproduces A1's cell 8 times out of 8, but every one of those is a major, a " +
      'metal or an index. No cross is covered, and a cross is exactly where our own resolver has no ' +
      'contract to fall back on. Confirmatory rather than corrective: the transformation is already ' +
      'CONFIRMED, so this widens the control without being able to change scoring.',
  },
  {
    key: 'platinum-rate-cell',
    capture:
      'The Asset Scorecard row the demo already unlocks - PLATINUM - on a dated day, with the ' +
      'Interest Rates cell and its hover text in shot. Best taken on a day the US 2-year is ' +
      'clearly off its 21-day average rather than sitting on it.',
    resolves: ['rates:assets-2026-08-24', 'rates:yield2y-source'],
    access: 'FREE',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      'THE CHEAPEST OPEN QUESTION IN THE REPO, and it went unasked for four rounds because the ' +
      'cells appeared to match. They matched on a futures quote that was 24bp from the series ' +
      'A1s own label names; on FRED DGS2 they do not match on either date we hold, and their ' +
      '2026-08-23 card calls the 2-year FALLING on a day DGS2 has it marginally rising. So the ' +
      'question is no longer whether the rule is right - their label states it - but WHICH ' +
      '2-year they read. A single dated row on a day the yield is unambiguously above or below ' +
      'its average answers that, because a stale or different quote cannot produce the right sign ' +
      'by accident twice. The demo already unlocks this row at no cost.',
  },
  {
    key: 'nzd-gdp-page',
    capture:
      "A1's free GDP page with the currency filter set to NZD — the tooltip's Actual and Forecast " +
      'for the 2026-06-17 release, which is the only New Zealand growth print in the window.',
    resolves: ['gdp:NZD'],
    access: 'FREE',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      'The same reading on the GBP filter is what closed `gdp:GBP` this round — their published ' +
      'pair named the series their board scores, where a board total could only have been guessed ' +
      'at. NZD is the last economic cell whose disagreement has no mechanism at all: both our ' +
      'calendars carry 0.8 against a 0.9 forecast, a miss can only be -1, and their board prints 0. ' +
      'One tooltip decides whether that is a consensus difference or something of ours.',
  },
  {
    key: 'chf-unemployment-forecast',
    capture:
      'Any A1 surface showing the Swiss unemployment FORECAST alongside the actual — a CH economic ' +
      'heatmap card with the Forecast column populated, or the Unemployment Rate page once its ' +
      'forecast chart stops erroring.',
    resolves: ['unemployment:CHF'],
    access: 'NOT_PUBLISHED',
    dateMatchable: false,
    couldReachProduction: false,
    rationale:
      'LARGELY SUPERSEDED, and kept only as a control. The series was the whole of this cell and ' +
      'the series is now settled: their own CH card, row dated Jan 9 26, reads actual 3.1 against a ' +
      'BLANK forecast and a previous of 2.9 — which is both the unadjusted December 2025 print and ' +
      'the previous-basis comparison, in one row. Their board now matches on both dates. This ' +
      'would only confirm that the blank Forecast column is a property of the series rather than ' +
      'of that snapshot, and their free unemployment page publishes the actual only, its forecast ' +
      'chart rendering COMING SOON! over a dataset error.',
  },
  {
    key: 'rates-projection-history',
    capture:
      'A dated snapshot of Interest Rate Projections — currency filter on USD, EUR, GBP, CHF, NZD — ' +
      'taken on a day a Top Setups board is also captured, and repeated on a second such day.',
    resolves: ['rates:usd-leg', 'rates:eur-policy-rate'],
    access: 'FREE',
    dateMatchable: true,
    couldReachProduction: true,
    rationale:
      'The rates rule is known and its input is free, but the projections page has a currency filter ' +
      'and nothing else — no date control, no history, no revision log — so a value read today ' +
      'cannot be rewound to a past board. Two independently dated snapshots are the only way to ' +
      'build a replayable series, and they have to be taken prospectively because the page keeps no ' +
      'past. This is the one request on the list that costs nothing but time.',
  },
];

export interface RankedEvidence extends EvidenceRequest {
  /** Ledger entries actually found for `resolves`. */
  entries: ParityLedgerEntry[];
  /** Keys named that the ledger no longer has — a stale request. */
  missingKeys: string[];
  unresolvedCount: number;
  score: number;
  /** The arithmetic, so the ordering can be argued with. */
  breakdown: string;
}

/**
 * The ranking.
 *
 * Weights are deliberately blunt and deliberately visible. The dominant term is
 * how many still-unresolved ledger entries a capture would touch, because that
 * is the thing a round actually spends itself on. `NOT_PUBLISHED` is penalised
 * rather than excluded: a capture that may not exist is still worth naming, but
 * it must not out-rank one that can be taken this afternoon.
 */
export function rankEvidence(
  requests: readonly EvidenceRequest[] = EVIDENCE_REQUESTS,
): RankedEvidence[] {
  const ranked = requests.map((req) => {
    const entries: ParityLedgerEntry[] = [];
    const missingKeys: string[] = [];
    for (const key of req.resolves) {
      const found = ledgerEntry(key);
      if (found) entries.push(found);
      else missingKeys.push(key);
    }

    // An entry still counts as unresolved unless it is FIXED outright.
    const unresolved = entries.filter((e) => e.classification !== 'FIXED');
    // UNKNOWN is where research is actually licensed, so it is worth more.
    const unknowns = unresolved.filter((e) => e.classification === 'UNKNOWN').length;

    const parts: string[] = [];
    let score = 0;

    score += unresolved.length * 10;
    parts.push(`${unresolved.length} unresolved x10`);

    if (unknowns > 0) {
      score += unknowns * 6;
      parts.push(`${unknowns} UNKNOWN x6`);
    }
    if (req.couldReachProduction) {
      score += 8;
      parts.push('could reach production +8');
    }
    if (req.dateMatchable) {
      score += 5;
      parts.push('date-matchable +5');
    }
    if (req.access === 'FREE') {
      score += 6;
      parts.push('free +6');
    } else if (req.access === 'NOT_PUBLISHED') {
      score -= 10;
      parts.push('not published -10');
    }
    if (missingKeys.length > 0) {
      score -= missingKeys.length * 12;
      parts.push(`${missingKeys.length} stale key(s) -12`);
    }

    return {
      ...req,
      entries,
      missingKeys,
      unresolvedCount: unresolved.length,
      score,
      breakdown: parts.join(', '),
    };
  });

  return ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/** Ledger entries no request would touch. Something to notice, not an error. */
export function unaddressedLedgerKeys(
  requests: readonly EvidenceRequest[] = EVIDENCE_REQUESTS,
): string[] {
  const named = new Set(requests.flatMap((r) => r.resolves));
  return PARITY_LEDGER.filter((e) => e.classification !== 'FIXED' && !named.has(e.key)).map(
    (e) => e.key,
  );
}
