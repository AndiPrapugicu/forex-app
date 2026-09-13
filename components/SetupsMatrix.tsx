'use client';

/**
 * The Top Setups matrix.
 *
 * Dense by design — the whole point is seeing 33 symbols against 18 indicators
 * at once. Choices that make that legible:
 *
 *  - Symbol and score columns are sticky, so a row stays identifiable while
 *    scrolling horizontally through the indicator columns.
 *  - Cell colour encodes sign, opacity encodes magnitude. A +2 and a +1 must be
 *    distinguishable at a glance without reading the digit.
 *  - Stale cells are visually distinct from zero cells. "We do not have current
 *    data" and "the data says neutral" are different statements and must not
 *    look the same.
 */

import { SetupsCards } from '@/components/SetupsCards';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MATRIX_SLOTS, SCORING_SLOTS, SLOT_CATEGORIES, type SlotCategory } from '@/config/setups.config';
import type { Bias } from '@/config/setups.config';
import type { MirrorOverlay } from '@/lib/scoring/a1-mirror';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';
import { heatStyle } from '@/lib/ui/heat';

type BiasFilter = 'all' | 'bullish' | 'bearish' | 'neutral';

/**
 * The hover text for one cell: what it means, then where the numbers came from.
 *
 * Provenance is appended rather than folded in, because it answers a different
 * question. "Beat forecast" invites "whose forecast?", and the answer was being
 * recorded on every borrowed consensus and read by nothing in the app. A cell
 * scored against a forecast this calendar never published, or built on an
 * actual FXStreet does not carry, has to be able to say so on hover.
 *
 * A blank cell gets the opposite treatment: it names the series that was looked
 * for, so "not published for that currency" reads as a checked absence rather
 * than as something the app forgot to fetch.
 */
function cellTooltip(label: string, cell: MatrixCell, mirrorWhy?: string): string {
  const lines = [`${label}: ${cell.explanation}`];

  /**
   * The mirror note goes FIRST after the explanation, because when the toggle
   * is on the number on screen is not ours, and that is the single most
   * important thing to say about it.
   */
  if (mirrorWhy) lines.push(`A1 MIRROR - ${mirrorWhy}`);

  const borrowed = new Set(
    (cell.legs ?? []).map((l) => l.consensusSource).filter((s): s is string => Boolean(s)),
  );
  if (borrowed.size > 0) {
    lines.push(`Forecast supplied by ${[...borrowed].join(', ')} — FXStreet published none.`);
  }

  const foreign = new Set(
    (cell.legs ?? [])
      .filter((l) => l.actualSource && l.actualSource !== 'fxstreet')
      .map((l) => `${l.seriesName ?? 'series'} via ${l.actualSource}`),
  );
  if (foreign.size > 0) {
    lines.push(`Not on FXStreet: ${[...foreign].join(', ')}.`);
  }

  /*
   * Said on hover rather than drawn in the grid, and said even though the cell
   * still counts. A reader deciding on this row is owed the fact that one leg
   * describes a month that ended a while ago.
   */
  if (cell.stale) {
    lines.push('One leg is past its usual publication cadence, and is scored anyway - as A1 does.');
  }

  if (cell.cell === null) {
    const looked = (cell.legs ?? [])
      .filter((l) => l.seriesName)
      .map((l) => `${l.currency} ${l.seriesName}`);
    if (looked.length > 0) lines.push(`Looked for: ${looked.join('; ')}.`);
  }

  return lines.join('\n');
}

/**
 * Cell background.
 *
 * Blue for positive rather than green: the bull/bear green means "this is the
 * verdict" on the score and bias columns, and a grid of 13 green cells competes
 * with the one number the row is actually about. The hue difference is a
 * hierarchy cue, not a claim that the scales differ — since the scorecard was
 * unified there is only one scale in the app.
 */
/**
 * A cell reads as its number or it reads as blank. There is no third state.
 *
 * `partial` — one leg expected and missing — used to draw an amber ring here.
 * It is real information, but a grid this dense can only carry so many states
 * before none of them are read, and a cell that VOTES like a normal cell should
 * LOOK like one. The distinction survives where it costs nothing: in the
 * per-cell tooltip, and in the `+N◐` marker beside each row's coverage count.
 */
function cellStyle(cell: MatrixCell): { className: string; style?: React.CSSProperties; text: string } {
  /**
   * THERE USED TO BE A GREY ITALIC '·' HERE for a cell whose print had aged
   * out, and it is gone because the state it rendered is gone: age no longer
   * blanks a cell. A1 scores a 125-day-old Canadian services PMI, so an old
   * print now shows its number here like any other, and `cell.stale` marks it
   * in the tooltip and on the scorecard pill rather than in the grid — a grid
   * this dense can only carry so many states, which is the same reason
   * `partial` stopped drawing a ring.
   */
  if (cell.cell === null) {
    return { className: 'bg-transparent text-[var(--color-faint)]', text: '' };
  }

  /*
   * A1's grid: the cell is painted solid — blue up, red down, grey for a
   * measured zero — and the digit carries the magnitude. The old opacity ramp
   * read as "weak" rather than "+1", which is not what the cell says.
   */
  return { className: 'font-semibold', style: heatStyle(cell.cell), text: String(cell.cell) };
}

/**
 * Symbol, score and bias share one tint: the row's own verdict, shaded by
 * conviction. Layered over an opaque surface because the columns are sticky and
 * the grid scrolls underneath them.
 */
function rowTint(score: number): React.CSSProperties {
  const heat = heatStyle(score, { max: 10, zeroGrey: false });
  if (!heat.backgroundColor) return { backgroundColor: 'var(--color-surface)' };
  return {
    backgroundColor: 'var(--color-surface)',
    backgroundImage: `linear-gradient(${heat.backgroundColor}, ${heat.backgroundColor})`,
    color: heat.color,
  };
}

type SortKey = 'score' | 'symbol';

/**
 * Apply the mirror overlay to a board.
 *
 * The overlay carries only cells that MOVED and only totals that changed, so
 * this is a shallow patch rather than a second board — see `buildMirrorOverlay`
 * for why the wire format is a diff. A cell where A1's convention happens to
 * land on the same value as ours is absent from it, and so is never marked:
 * nothing about that cell differs.
 */
function applyMirror(rows: SymbolRow[], overlay: MirrorOverlay): SymbolRow[] {
  return rows
    .map((row) => {
      const patch = overlay.cells[row.symbol];
      const total = overlay.totals[row.symbol];
      if (!patch && !total) return row;

      const cells = { ...row.cells };
      for (const [key, value] of Object.entries(patch ?? {})) {
        const existing = cells[key];
        if (!existing) continue;
        cells[key] = { ...existing, cell: value, status: value === null ? existing.status : 'scored' };
      }
      return {
        ...row,
        cells,
        totalScore: total?.score ?? row.totalScore,
        bias: (total?.bias as Bias) ?? row.bias,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Column presets, mirroring the variants A1 offers.
 *
 *   full    every column, scoring and context
 *   simple  no indicator columns at all — just the total and the block subtotals
 *   macro   economic columns only, which is how you read "what does the data say"
 *           without the technical and positioning noise
 */
type ViewKey = 'full' | 'simple' | 'macro';

const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'full', label: 'Full', hint: 'Every column' },
  { key: 'simple', label: 'Simple', hint: 'Totals and block subtotals only' },
  { key: 'macro', label: 'Macro', hint: 'Economic columns only' },
];

/** Every indicator column is this wide, so the grid reads as a grid. */
const INDICATOR_COL_WIDTH = 52;

/**
 * Explicit widths for the three sticky columns, and the left offsets derived
 * from them.
 *
 * These MUST be declared rather than left to the content. The offsets were
 * previously hardcoded against widths the browser chose, so changing the row
 * padding shifted the columns and the sticky Bias cell began covering the first
 * indicator column — Trend was clipped to "end" at scroll position zero.
 * Deriving the offsets from the widths makes that impossible.
 */
const STICKY = {
  delta: 40,
  symbol: 80,
  bias: 104,
  score: 46,
} as const;
/** A1's order: 1D Δ, Symbol, Bias, Score. */
const STICKY_LEFT = {
  delta: 0,
  symbol: STICKY.delta,
  bias: STICKY.delta + STICKY.symbol,
  score: STICKY.delta + STICKY.symbol + STICKY.bias,
} as const;
const STICKY_TOTAL = STICKY.delta + STICKY.symbol + STICKY.bias + STICKY.score;

export function SetupsMatrix({
  rows,
  cotReportDate,
  mirror,
  initialView = 'full',
  dayDeltas,
}: {
  rows: SymbolRow[];
  cotReportDate: string | null;
  initialView?: ViewKey;
  /**
   * Score now minus the score ~24h ago, per symbol, from `score_snapshots`.
   * Absent until the ingest cron has a day of history; the column then reads "—".
   */
  dayDeltas?: Record<string, number | null>;
  /** Null when no capture of A1's board is on disk — the toggle then hides. */
  mirror?: MirrorOverlay | null;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SlotCategory | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('score');
  const [biasFilter, setBiasFilter] = useState<BiasFilter>('all');
  const [view, setViewState] = useState<ViewKey>(initialView);
  /**
   * A view is a link: `/?view=macro` is the Macro Only board. `replaceState`
   * rather than a router push, so switching views neither re-runs the server
   * pipeline nor stacks history entries.
   */
  const setView = (next: ViewKey) => {
    setViewState(next);
    const url = new URL(window.location.href);
    if (next === 'full') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };
  const [mirrorOn, setMirrorOn] = useState(false);
  /**
   * CARDS OR GRID. Eighteen indicator columns cannot fit a phone, and A1 does
   * not try. `null` means "follow the screen": cards below md, the grid above.
   * An explicit choice overrides it, so a phone user who wants the grid can
   * still scroll it sideways.
   */
  const [layout, setLayout] = useState<'cards' | 'grid' | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * Mirror mode is PRESENTATION. It rewrites what this table shows and reaches
   * nothing else — not the change log, not the stored history, not any parity
   * script. `rows` is left untouched and a patched copy is rendered.
   */
  const board = useMemo(
    () => (mirrorOn && mirror ? applyMirror(rows, mirror) : rows),
    [rows, mirror, mirrorOn],
  );

  /**
   * View and category compose: Macro-Only narrowed to Inflation shows the
   * inflation economics and nothing else. `full` is the only view that shows
   * context columns — the whole point of Simple and Macro is fewer columns, and
   * a non-scoring column is the first thing to drop.
   */
  const visibleSlots = useMemo(() => {
    const byView =
      view === 'macro'
        ? MATRIX_SLOTS.filter((s) => s.scoring && s.kind !== 'technical' && s.kind !== 'sentiment')
        : view === 'simple'
          ? []
          : MATRIX_SLOTS;

    return category === 'all' ? byView : byView.filter((s) => s.category === category);
  }, [view, category]);

  const visibleCategories = useMemo(
    () =>
      SLOT_CATEGORIES.filter(
        (c) =>
          (category === 'all' || c.key === category) &&
          visibleSlots.some((s) => s.category === c.key),
      ),
    [category, visibleSlots],
  );

  const filtered = useMemo(() => {
    let out = board;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      out = out.filter((r) => r.symbol.includes(q) || r.label.toUpperCase().includes(q));
    }
    if (biasFilter === 'bullish') out = out.filter((r) => r.bias.includes('Bullish'));
    if (biasFilter === 'bearish') out = out.filter((r) => r.bias.includes('Bearish'));
    if (biasFilter === 'neutral') out = out.filter((r) => r.bias === 'Neutral');
    if (sort === 'symbol') out = [...out].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return out;
  }, [board, query, biasFilter, sort]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* --- Controls -------------------------------------------------- */}
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <h2 className="text-small font-semibold tracking-wide uppercase">Top Setups</h2>

        <div className="mr-auto flex rounded border border-[var(--color-border)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              title={v.hint}
              onClick={() => setView(v.key)}
              className={`min-h-9 rounded px-3 text-caption transition-colors md:min-h-0 md:px-2 md:py-0.5 md:text-micro ${
                view === v.key
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {mirror && (
          <div className="flex rounded border border-[var(--color-border)] p-0.5">
            <button
              type="button"
              title={
                'Our arithmetic: a pair cell is its base leg minus its quote leg, which is ' +
                "what A1's own currency rows and country heatmaps publish."
              }
              onClick={() => setMirrorOn(false)}
              className={`min-h-9 rounded px-3 text-caption transition-colors md:min-h-0 md:px-2 md:py-0.5 md:text-micro ${
                !mirrorOn
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              Ours
            </button>
            <button
              type="button"
              title={
                "A1 mirror: re-render the board under the conventions A1's PAIR rows use, " +
                "where those contradict A1's own currency rows. " +
                `Moves ${mirror.moved} cells.` +
                (mirror.capturedFrom
                  ? ` Captured cells read from their ${mirror.capturedFrom} board.`
                  : '')
              }
              onClick={() => setMirrorOn(true)}
              className={`min-h-9 rounded px-3 text-caption transition-colors md:min-h-0 md:px-2 md:py-0.5 md:text-micro ${
                mirrorOn
                  ? 'bg-[var(--color-uncertain)]/20 text-[var(--color-uncertain)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              A1 mirror
            </button>
          </div>
        )}

        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="setups-filters"
          onClick={() => setFiltersOpen((o) => !o)}
          className="min-h-9 rounded border border-[var(--color-border)] px-3 text-caption text-[var(--color-muted)] md:hidden"
        >
          Filters{query || category !== 'all' || biasFilter !== 'all' || sort !== 'score' ? ' •' : ''}
        </button>

        {/*
          On a phone the four filters took most of the first screen before a
          single symbol showed. They fold behind the button above; from md up
          `md:contents` removes this wrapper and they sit inline as before.
        */}
        <div
          id="setups-filters"
          className={`${filtersOpen ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-2 md:contents`}
        >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbol"
          className="min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-small outline-none focus:border-[var(--color-bull)] md:min-h-0 md:w-32 md:rounded md:px-2 md:py-1 md:text-caption"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as SlotCategory | 'all')}
          className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-small outline-none md:min-h-0 md:flex-none md:rounded md:py-1 md:text-caption"
        >
          <option value="all">All categories</option>
          {SLOT_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-small outline-none md:min-h-0 md:flex-none md:rounded md:py-1 md:text-caption"
        >
          <option value="score">Sort by score</option>
          <option value="symbol">Sort by symbol</option>
        </select>

        <select
          value={biasFilter}
          aria-label="Bias"
          onChange={(e) => setBiasFilter(e.target.value as BiasFilter)}
          className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-small outline-none md:min-h-0 md:flex-none md:rounded md:py-1 md:text-caption"
        >
          <option value="all">All biases</option>
          <option value="bullish">Bullish</option>
          <option value="bearish">Bearish</option>
          <option value="neutral">Neutral</option>
        </select>
        </div>

        <div className="flex rounded border border-[var(--color-border)] p-0.5 md:hidden" role="group" aria-label="Layout">
          {(['cards', 'grid'] as const).map((l) => {
            const active = (layout ?? 'cards') === l;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => setLayout(l)}
                className={`min-h-9 rounded px-3 text-caption capitalize ${
                  active ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      </header>

      {/* --- Cards: the default on a phone ------------------------------ */}
      <div className={layout === 'grid' ? 'hidden' : layout === 'cards' ? 'block md:hidden' : 'block md:hidden'}>
        <SetupsCards
          rows={filtered}
          slots={visibleSlots}
          mirrorCells={mirrorOn && mirror ? mirror.cells : undefined}
        />
      </div>

      {/* --- Matrix ------------------------------------------------------ */}
      <div
        className={`${layout === 'grid' ? 'block' : 'hidden md:block'} max-h-[calc(100dvh-13rem)] overflow-auto`}
      >
        <table className="w-full border-separate border-spacing-0 text-center text-caption">
          <thead className="sticky top-0 z-30 bg-[var(--color-surface)]">
            {/* Category band, A1's: "Output" over the verdict columns, then each block. */}
            <tr>
              <th
                style={{ left: 0, minWidth: STICKY_TOTAL }}
                className="table-head sticky z-20 border-r border-b border-[var(--color-border)] px-2 py-1.5 text-small font-semibold"
                colSpan={4}
              >
                Output
              </th>
              {visibleCategories.map((cat) => {
                const span = visibleSlots.filter((s) => s.category === cat.key).length;
                if (span === 0) return null;
                return (
                  <th
                    key={cat.key}
                    colSpan={span}
                    className="table-head border-b border-l border-[var(--color-border)] px-2 py-1.5 text-small font-semibold"
                  >
                    {cat.label}
                  </th>
                );
              })}
            </tr>
            {/* Column headers */}
            <tr>
              <th
                style={{ left: STICKY_LEFT.delta, width: STICKY.delta, minWidth: STICKY.delta }}
                className="sticky z-20 border-b border-[var(--color-border)] table-head px-1 py-1.5 text-micro font-semibold"
                title="Score change over the last 24 hours"
              >
                1D Δ
              </th>
              <th
                style={{ left: STICKY_LEFT.symbol, width: STICKY.symbol, minWidth: STICKY.symbol }}
                className="sticky z-20 border-b border-[var(--color-border)] table-head px-2 py-1.5 text-left text-micro font-semibold"
              >
                Symbol
              </th>
              <th
                style={{ left: STICKY_LEFT.bias, width: STICKY.bias, minWidth: STICKY.bias }}
                className="sticky z-20 border-b border-[var(--color-border)] table-head px-2 py-1.5 text-left text-micro font-semibold"
              >
                Bias
              </th>
              <th
                style={{ left: STICKY_LEFT.score, width: STICKY.score, minWidth: STICKY.score }}
                className="sticky z-20 border-r border-b border-[var(--color-border)] table-head px-1 py-1.5 text-micro font-semibold"
              >
                Score
              </th>
              {visibleSlots.map((slot) => (
                <th
                  key={slot.key}
                  title={
                    slot.scoring
                      ? slot.title
                      : `${slot.title} — context only, not counted in the score`
                  }
                  /* Fixed width on every indicator column. Without this the
                     header text sizes each one and the grid comes out ragged —
                     "Crowd Sentiment" was three times the width of "COT". */
                  style={{ width: INDICATOR_COL_WIDTH, minWidth: INDICATOR_COL_WIDTH }}
                  className={`border-b border-[var(--color-border)] table-head px-0.5 py-1.5 text-center text-micro leading-tight font-semibold ${
                    // A context column has to be tellable from a scoring one at a
                    // glance, or the row's total looks like it does not add up.
                    slot.scoring ? '' : 'italic opacity-60'
                  }`}
                >
                  {slot.label}
                  {!slot.scoring && <span className="align-super text-micro">°</span>}
                </th>
              ))}

              {/* Simple view swaps 19 indicator columns for 5 block subtotals. */}
              {view === 'simple' &&
                SLOT_CATEGORIES.map((cat) => (
                  <th
                    key={cat.key}
                    title={cat.label}
                    style={{ minWidth: 78 }}
                    className="table-head border-b border-[var(--color-border)] px-2 py-1.5 text-center text-micro leading-tight font-semibold"
                  >
                    {cat.label.split(' ')[0]}
                  </th>
                ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((row) => (
              <tr key={row.symbol} className="group">
                <td
                  style={{ left: STICKY_LEFT.delta, width: STICKY.delta, minWidth: STICKY.delta }}
                  className="tnum sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[var(--color-muted)]"
                >
                  {(() => {
                    const d = dayDeltas?.[row.symbol];
                    if (d === null || d === undefined) return <span className="text-[var(--color-faint)]">—</span>;
                    return (
                      <span className={d > 0 ? 'text-[var(--color-bull)]' : d < 0 ? 'text-[var(--color-bear)]' : ''}>
                        {d > 0 ? '+' : ''}
                        {d}
                      </span>
                    );
                  })()}
                </td>

                <td
                  style={{ left: STICKY_LEFT.symbol, width: STICKY.symbol, minWidth: STICKY.symbol, ...rowTint(row.totalScore) }}
                  className="sticky z-10 border-b border-[var(--color-border)] px-2 py-1 text-left"
                >
                  <Link
                    href={`/scorecard/${row.symbol}`}
                    className="font-mono text-caption font-semibold underline decoration-1 underline-offset-2 hover:decoration-2"
                  >
                    {row.symbol}
                  </Link>
                </td>

                <td
                  style={{ left: STICKY_LEFT.bias, width: STICKY.bias, minWidth: STICKY.bias, ...rowTint(row.totalScore) }}
                  className="sticky z-10 border-b border-[var(--color-border)] px-2 py-1 text-left whitespace-nowrap"
                >
                  <span className="text-caption font-medium">{row.bias}</span>
                  {/* Populated count keeps a thin row from reading as confident. */}
                  <span
                    className="ml-1.5 text-micro opacity-60"
                    title={`${row.populated} of ${SCORING_SLOTS.length} scored indicators resolved completely`}
                  >
                    {row.populated}
                  </span>
                  {/*
                    Partial cells are called out beside the coverage count rather
                    than folded into it: a row reading "16 +2◐" is saying two of
                    its numbers came from one leg, which is a different kind of
                    thinness from simply having fewer columns.
                  */}
                  {row.partial > 0 && (
                    <span
                      className="ml-1 text-micro text-[var(--color-uncertain)]"
                      title={`${row.partial} cell(s) built from one leg because the other was expected and did not arrive`}
                    >
                      +{row.partial}◐
                    </span>
                  )}
                </td>

                <td
                  style={{ left: STICKY_LEFT.score, width: STICKY.score, minWidth: STICKY.score, ...rowTint(row.totalScore) }}
                  className="tnum sticky z-10 border-r border-b border-[var(--color-border)] px-1 py-1 text-small font-bold"
                >
                  {row.totalScore > 0 ? '+' : ''}
                  {row.totalScore}
                </td>

                {visibleSlots.map((slot) => {
                  const cell = row.cells[slot.key];
                  const s = cellStyle(cell);
                  /*
                    A mirrored cell is OUTLINED rather than recoloured. Its sign
                    and magnitude still have to read at a glance, and swapping
                    the hue would make "A1 says bearish" look like a different
                    scale rather than a different source.
                  */
                  const swapped = mirrorOn && mirror?.cells[row.symbol]?.[slot.key] !== undefined;
                  return (
                    <td
                      key={slot.key}
                      title={cellTooltip(
                        slot.label,
                        cell,
                        swapped ? mirror?.conventions[slot.key]?.why : undefined,
                      )}
                      className={`tnum border-b border-r border-[var(--color-bg)] px-0.5 py-1 text-center ${s.className}${
                        swapped ? ' outline outline-1 -outline-offset-1 outline-[var(--color-uncertain)]' : ''
                      }`}
                      style={{ ...s.style, width: INDICATOR_COL_WIDTH, minWidth: INDICATOR_COL_WIDTH }}
                    >
                      {s.text}
                    </td>
                  );
                })}

                {view === 'simple' &&
                  SLOT_CATEGORIES.map((cat) => {
                    const value = row.categoryScores[cat.key];
                    return (
                      <td
                        key={cat.key}
                        className="tnum border-r border-b border-[var(--color-bg)] px-2 py-1 text-center font-semibold"
                        style={{ minWidth: 78, ...heatStyle(value, { max: 6 }) }}
                      >
                        {value > 0 ? '+' : ''}
                        {value}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-small text-[var(--color-muted)]">
          No symbols match the current filters.
        </p>
      )}

      <footer className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t md:flex border-[var(--color-border)] px-3 py-2 text-micro text-[var(--color-faint)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm" style={heatStyle(1)} />
          bullish
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm" style={heatStyle(-1)} />
          bearish
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm" style={heatStyle(0)} />
          measured, neutral
        </span>
        <span>blank = not published for that currency</span>
        {/* Only meaningful while some column is carried but not scored. */}
        {MATRIX_SLOTS.length > SCORING_SLOTS.length && (
          <span className="italic opacity-60">
            ° {MATRIX_SLOTS.length - SCORING_SLOTS.length} context columns — shown, never counted
          </span>
        )}
        {mirrorOn && mirror && (
          <span className="text-[var(--color-uncertain)]">
            A1 mirror on — {mirror.moved} outlined cells re-derived under their pair-row
            conventions{mirror.capturedFrom ? `, some read from their ${mirror.capturedFrom} board` : ''}.
            Not our reading.
          </span>
        )}
        <span className="ml-auto">
          The number after the bias is how many of {SCORING_SLOTS.length} scored indicators had data.
          {cotReportDate && ` COT as of ${cotReportDate}.`}
        </span>
      </footer>
    </div>
  );
}
