# A1 Momentum Heatmap — captured 2026-09-01, EdgeFinder Free Week

Their "Technical Scanners → Momentum Heatmap", page footer
`Ultima actualizare a datelor: 01.09.2026 09:47:06`. Columns are price against
each simple moving average as Bullish / Bearish / Neutral, plus a volatility
band and the average one-day move over seven days.

Captured alongside `a1-top-setups-2026-09-01.csv`, whose footer reads
`01.09.2026 09:44:21` — **three minutes apart, so the two are same-day and
directly comparable.** That matters: the whole of this round's work established
that Trend is the column which moves overnight, and a cross-day comparison of it
measures the calendar.

**Only the first 24 rows were captured**, the table's visible page without
scrolling.

## Why this was captured

`HARDENING.md` §9 records that A1's Trend column does not reproduce from any of
27 candidate rules better than our shipped SMA 3/14, including every reading of
their own `4H/Daily Chart Trend` label. Technical Scanners was the best remaining
hope of finding the arithmetic published directly. **It is not there** — the
section holds only this page and a Volatility Heatmap.

## What it does settle

A1's Trend cell is **not** a price-vs-SMA reading, in any weighting.

| asset | 20 / 50 / 100 / 200 SMA | A1 Trend, same day |
|---|---|---|
| **EURCAD** | Bearish, Bearish, Bearish, Bearish | **+2** |
| NATGAS | Bullish, Neutral, Bearish, Bearish | +2 |
| EURO | Bearish, Bullish, Bullish, Bearish | +2 |
| GOLD | Bearish, Bullish, Bullish, Bearish | +2 |
| USDJPY | Bullish, Bearish, Bearish, Bullish | +2 |

EURCAD is a clean falsification: price below all four of their own moving
averages, and the maximum bullish trend reading beside it on the same refresh.
No rule that reads price against those averages can produce that, so the whole
family is ruled out — which is worth more than another candidate that fits
slightly better.

## The caveat on the rest of it

**Every one of the 24 captured rows carries Trend +2 on the board.** The table is
evidently sorted, so this is not a random sample and no rate can be computed from
it — "24 of 24 assets score +2" says something about the sort order, not about
the rule. The falsification above survives that, because a single counterexample
does not need a representative sample; a hit rate would.

To use this as a fitting set rather than a falsifier, scroll the table and
capture all of its rows. Free-week access runs to 2026-09-07.
