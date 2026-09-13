/**
 * Builds the committed PMI seed from A1's captured charts and heatmap.
 *
 *   npm run build:pmi-seed
 *
 * WHY A SEED IS NEEDED AT ALL. FXStreet's calendar carries every non-USD PMI
 * release with `actual: null` once the print stops being current — verified by
 * reading the live pool rewound one week, where EUR, GBP, JPY and AUD services
 * PMI have not one scoreable print between them. So the mPMI and sPMI columns
 * are scoreable only on the day of release and blank on every past date, which
 * is why they are the largest fixable gap against A1's board.
 *
 * WHY IT IS A BUILD PRODUCT UNDER `fixtures/derived/`. `fixtures/` holds
 * evidence — transcribed once, never re-derivable now A1's access window has
 * closed. This file is neither: it is a deterministic function of three of those
 * fixtures, and it is committed so the board does not depend on a build step.
 *
 * FIVE GATES. The script refuses to write the file if any of them fails, and
 * every series it declines to emit is recorded in `excluded` so that a hole in
 * the seed is visible rather than inferred from an absence.
 *
 *   G1  Dates are RECONSTRUCTED, never guessed. A1's renderer truncates its
 *       axis labels ("3 dec.…") and writes them in Romanian, so the day and the
 *       month prefix survive and the year does not. Rows are strictly ascending
 *       and span under thirteen months, so each label is resolved twice — once
 *       taking the EARLIEST feasible date walking forwards, once the LATEST
 *       walking backwards. They agree on a row only when that row admits exactly
 *       one date. A series where they disagree anywhere is excluded whole, and a
 *       series labelled UNALIGNED is excluded without being read.
 *   G2  Duplicate points are collapsed. A1's JPY and NZD manufacturing charts
 *       repeat rows verbatim; left in, `previous[i] = actual[i-1]` becomes
 *       `previous === actual` and manufactures a confident zero.
 *   G3  `previous` is the PRIOR ROW'S ACTUAL, and the capture's `revision`
 *       column is not used. That column carries two different meanings in one
 *       place — on some rows it restates the print, on others it simply repeats
 *       the preceding actual — and writing it to `revised` would corrupt
 *       `priorPrint()`, which reads `revised ?? previous`.
 *   G4  The last emitted point of every series must reproduce that economy's row
 *       in the independently captured heatmap, on the actual AND on the implied
 *       surprise. The fixture headers claim this check was done by hand; making
 *       it code is what keeps the seed honest the next time it is rebuilt.
 *   G5  Three series are declined on the merits rather than on data quality —
 *       see `PMI_SERIES_NOT_SEEDED` in `config/pmi-series.config.ts`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PMI_SERIES, PMI_SERIES_NOT_SEEDED } from '@/config/pmi-series.config';
import type { Currency } from '@/lib/types';

const ROOT = process.cwd();
const CAPTURES = {
  manufacturing: 'fixtures/a1-full-access/a1-econ-manufacturing-pmi-2026-09-03-1023.csv',
  services: 'fixtures/a1-full-access/a1-econ-services-pmi-2026-09-03-1033.csv',
  heatmaps: 'fixtures/a1-full-access/a1-econ-heatmaps-2026-09-03-0527.csv',
} as const;
const OUT = 'fixtures/derived/pmi-seed-2026-09-03.json';

/** The day the charts were read. Every reconstructed date must land on or before it. */
const CAPTURED_ON = '2026-09-03';
/** A1's charts ship a thirteen-month window; nothing may be dated before this. */
const EARLIEST = '2025-08-01';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PmiSeedRow {
  currency: Currency;
  slotKey: 'mpmi' | 'spmi';
  /** YYYY-MM-DD. */
  day: string;
  actual: number;
  /** A1's own forecast column, or null where they published none. */
  consensus: number | null;
  /** The immediately preceding published actual. Never the capture's `revision`. */
  previous: number | null;
  anchor: 'axis-label' | 'heatmap';
}

export interface PmiSeedFile {
  builtAtUtc: string;
  builtBy: string;
  sourceCaptures: string[];
  /** Series the builder REFUSED to emit, and why. Committed so the hole is visible. */
  excluded: { currency: Currency; slotKey: string; reason: string; points: number }[];
  rows: PmiSeedRow[];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function readCsv(rel: string): Record<string, string>[] {
  const text = readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = (parts[i] ?? '').trim();
    });
    return row;
  });
}

function num(s: string): number | null {
  if (s === '' || s === undefined) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// G1 — date reconstruction
// ---------------------------------------------------------------------------

/** Romanian month abbreviations, in calendar order. A1 renders its axis in ro-RO. */
const MONTHS_RO = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sept', 'oct', 'nov', 'dec'];

/** Day plus every month index the (possibly truncated) label is consistent with. */
function parseLabel(label: string): { day: number; months: number[] } | null {
  const cleaned = label.replace(/[….]/g, ' ').trim();
  const m = /^(\d{1,2})\s+([a-z]+)/i.exec(cleaned);
  if (!m) return null;
  const day = Number(m[1]);
  const prefix = m[2].toLowerCase();
  const months = MONTHS_RO.map((name, i) => (name.startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
  return months.length === 0 ? null : { day, months };
}

function iso(y: number, mIdx: number, d: number): string {
  return `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Every calendar date a label could denote inside the capture window. */
function candidates(label: string): string[] {
  const parsed = parseLabel(label);
  if (!parsed) return [];
  const out: string[] = [];
  for (const year of [2025, 2026]) {
    for (const mIdx of parsed.months) {
      const day = iso(year, mIdx, parsed.day);
      // Reject a day that does not exist in that month (31 Feb and friends).
      const probe = new Date(`${day}T00:00:00Z`);
      if (probe.getUTCDate() !== parsed.day || probe.getUTCMonth() !== mIdx) continue;
      if (day < EARLIEST || day > CAPTURED_ON) continue;
      out.push(day);
    }
  }
  return out.sort();
}

/**
 * Resolve a whole series' labels to dates, or refuse.
 *
 * Two greedy passes. Forwards, take the EARLIEST candidate strictly after the
 * previous row; backwards, the LATEST candidate strictly before the next. Both
 * produce a feasible strictly-ascending assignment when one exists, and they
 * agree on a row only when that row admits exactly one date. Disagreement
 * anywhere fails the whole series, because a series with one guessed date in it
 * is not a series anybody should score.
 */
function resolveDates(labels: string[]): { days: string[] } | { error: string } {
  const sets = labels.map(candidates);
  const bad = sets.findIndex((s) => s.length === 0);
  if (bad >= 0) return { error: `row ${bad + 1} has an unreadable axis label "${labels[bad]}"` };

  const forward: string[] = [];
  let floor = '';
  for (let i = 0; i < sets.length; i++) {
    const pick = sets[i].find((d) => d > floor);
    if (!pick) return { error: `row ${i + 1} ("${labels[i]}") admits no date after ${floor}` };
    forward.push(pick);
    floor = pick;
  }

  const backward: string[] = new Array(sets.length);
  let ceiling = '9999-99-99';
  for (let i = sets.length - 1; i >= 0; i--) {
    const pick = [...sets[i]].reverse().find((d) => d < ceiling);
    if (!pick) return { error: `row ${i + 1} ("${labels[i]}") admits no date before ${ceiling}` };
    backward[i] = pick;
    ceiling = pick;
  }

  for (let i = 0; i < sets.length; i++) {
    if (forward[i] !== backward[i]) {
      return {
        error:
          `row ${i + 1} ("${labels[i]}") is ambiguous — it could be ${forward[i]} or ${backward[i]}; ` +
          'the whole series is excluded rather than guessed',
      };
    }
  }

  return { days: forward };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface ChartRow {
  currency: string;
  idx: number;
  axisLabel: string;
  actual: number | null;
  forecast: number | null;
}

function chartRows(rel: string): Map<string, ChartRow[]> {
  const out = new Map<string, ChartRow[]>();
  for (const r of readCsv(rel)) {
    const list = out.get(r.currency) ?? [];
    list.push({
      currency: r.currency,
      idx: Number(r.idx),
      axisLabel: r.axisLabel,
      actual: num(r.actual),
      forecast: num(r.forecast),
    });
    out.set(r.currency, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.idx - b.idx);
  return out;
}

interface HeatmapPoint {
  day: string;
  actual: number;
  forecast: number | null;
  previous: number | null;
  surprise: number | null;
}

function heatmapPoints(): Map<string, HeatmapPoint> {
  const out = new Map<string, HeatmapPoint>();
  for (const r of readCsv(CAPTURES.heatmaps)) {
    const slotKey = /^Manufacturing PMIs$/i.test(r.series)
      ? 'mpmi'
      : /^Services PMIs$/i.test(r.series)
        ? 'spmi'
        : null;
    if (!slotKey) continue;
    const actual = num(r.actual);
    if (actual === null || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    out.set(`${r.country}|${slotKey}`, {
      day: r.date,
      actual,
      forecast: num(r.forecast),
      previous: num(r.previous),
      surprise: num(r.surprise),
    });
  }
  return out;
}

function main() {
  const charts = { mpmi: chartRows(CAPTURES.manufacturing), spmi: chartRows(CAPTURES.services) };
  const heatmap = heatmapPoints();

  const rows: PmiSeedRow[] = [];
  const excluded: PmiSeedFile['excluded'] = [];
  const failures: string[] = [];

  // G5 — declined on the merits, before any data is read.
  for (const d of PMI_SERIES_NOT_SEEDED) {
    excluded.push({ currency: d.currency, slotKey: d.slotKey, reason: d.why, points: 0 });
  }

  for (const def of PMI_SERIES) {
    const raw = charts[def.slotKey].get(def.currency) ?? [];
    const usable = raw.filter((r) => r.actual !== null);
    const aligned = usable.filter((r) => r.axisLabel !== 'UNALIGNED' && r.axisLabel !== '');

    let seeded: PmiSeedRow[] = [];

    if (aligned.length === 0) {
      excluded.push({
        currency: def.currency,
        slotKey: def.slotKey,
        reason:
          `A1 renders this chart with ${usable.length} points against fewer axis labels, so every row was ` +
          'captured as UNALIGNED. The VALUES are exact but no date can be attached to them without ' +
          'guessing, and a guessed date is a guessed score.',
        points: usable.length,
      });
    } else {
      const resolved = resolveDates(aligned.map((r) => r.axisLabel));
      if ('error' in resolved) {
        excluded.push({
          currency: def.currency,
          slotKey: def.slotKey,
          reason: `axis labels could not be reconstructed unambiguously: ${resolved.error}`,
          points: aligned.length,
        });
      } else {
        // G2 — collapse verbatim repeats. A1's JPY services and NZD
        // manufacturing charts render the SAME print twice, on the same day or
        // on two adjacent ones (NZ manufacturing appears at both 11 and 12 June
        // carrying 49.9). Left in, `previous[i] = actual[i-1]` reads the row's
        // own value and manufactures a confident zero.
        //
        // ADJACENCY IS PART OF THE RULE, not an optimisation. Collapsing on
        // equal values alone would delete a genuine flat month — euro-area
        // services really did print 51.7 on both 5 and 21 August, sixteen days
        // apart, and that pair is a real reading rather than a rendering
        // artifact.
        const DUPLICATE_WINDOW_DAYS = 2;
        const points: { day: string; actual: number; forecast: number | null }[] = [];
        aligned.forEach((r, i) => {
          const day = resolved.days[i];
          const last = points[points.length - 1];
          if (last && last.actual === r.actual) {
            const apart =
              (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last.day}T00:00:00Z`)) / 86_400_000;
            if (apart <= DUPLICATE_WINDOW_DAYS) return;
          }
          points.push({ day, actual: r.actual as number, forecast: r.forecast });
        });

        seeded = points.map((p, i) => ({
          currency: def.currency,
          slotKey: def.slotKey,
          day: p.day,
          actual: p.actual,
          consensus: p.forecast,
          // G3 — the prior row's actual, never the capture's `revision` column.
          previous: i === 0 ? null : points[i - 1].actual,
          anchor: 'axis-label' as const,
        }));
      }
    }

    // The heatmap carries one explicitly dated point per economy, with its own
    // actual, forecast and previous. It is the better record where it reaches,
    // so it supersedes the chart's tail and can rescue a series the chart could
    // not date at all.
    const tail = heatmap.get(`${def.a1Country}|${def.slotKey}`);
    if (tail) {
      const prior = seeded.filter((r) => r.day < tail.day);
      seeded = [
        ...prior,
        {
          currency: def.currency,
          slotKey: def.slotKey,
          day: tail.day,
          actual: tail.actual,
          consensus: tail.forecast,
          previous: tail.previous ?? prior[prior.length - 1]?.actual ?? null,
          anchor: 'heatmap',
        },
      ];

      // G4 — the tail must reproduce the heatmap's own published surprise.
      if (tail.surprise !== null) {
        const reference = tail.forecast ?? tail.previous ?? prior[prior.length - 1]?.actual ?? null;
        if (reference === null) {
          failures.push(
            `${def.currency} ${def.slotKey}: heatmap publishes a surprise with nothing to compare against`,
          );
        } else {
          const implied = Number((tail.actual - reference).toFixed(2));
          if (Math.abs(implied - tail.surprise) > 0.051) {
            failures.push(
              `${def.currency} ${def.slotKey}: heatmap surprise ${tail.surprise} but ` +
                `${tail.actual} - ${reference} = ${implied}`,
            );
          }
        }
      }
    }

    if (
      seeded.length === 0 &&
      !excluded.some((e) => e.currency === def.currency && e.slotKey === def.slotKey)
    ) {
      excluded.push({
        currency: def.currency,
        slotKey: def.slotKey,
        reason: 'no usable points in either capture',
        points: 0,
      });
    }
    rows.push(...seeded);
  }

  if (failures.length > 0) {
    console.error('REFUSING TO WRITE THE SEED — the tail check failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nA seed that disagrees with an independently captured heatmap is not evidence.');
    process.exit(1);
  }

  const file: PmiSeedFile = {
    builtAtUtc: new Date().toISOString(),
    builtBy: 'scripts/build-pmi-seed.ts',
    sourceCaptures: Object.values(CAPTURES),
    excluded: excluded.sort((a, b) =>
      `${a.currency}${a.slotKey}`.localeCompare(`${b.currency}${b.slotKey}`),
    ),
    rows: rows.sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        a.slotKey.localeCompare(b.slotKey) ||
        a.day.localeCompare(b.day),
    ),
  };

  mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
  writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(file, null, 2)}\n`, 'utf8');

  console.log(`wrote ${OUT}\n`);
  const bySeries = new Map<string, number>();
  for (const r of file.rows) {
    bySeries.set(`${r.currency} ${r.slotKey}`, (bySeries.get(`${r.currency} ${r.slotKey}`) ?? 0) + 1);
  }
  console.log('  SEEDED');
  for (const [k, n] of [...bySeries].sort()) {
    console.log(`    ${k.padEnd(12)} ${String(n).padStart(3)} points`);
  }
  console.log('\n  EXCLUDED');
  for (const e of file.excluded) {
    console.log(
      `    ${`${e.currency} ${e.slotKey}`.padEnd(12)} ${String(e.points).padStart(3)} points — ${e.reason.slice(0, 92)}…`,
    );
  }
}

main();
